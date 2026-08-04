// Seed the forecasting module from the creditor proposal and its model.
//
//   pnpm --filter @alma/api seed:forecast-module            # apply
//   pnpm --filter @alma/api seed:forecast-module -- --dry   # report only
//
// Idempotent: safe to re-run. Companies, venues and scenarios upsert on their
// natural keys; assumptions upsert on (company, venue, key, version); the
// proposal is matched by company + name and its payment schedule is rebuilt.
//
// Nothing here is invented. Every assumption carries the sourceNote and
// confirmed flag from packages/db/prisma/seeds/forecast-assumptions.ts, which
// records where each figure came from. Figures that remain unevidenced —
// the COGS targets, the wage structure, the menu-price uplifts — seed as
// confirmed = false and must stay that way until they are demonstrated.

import { prisma } from '@alma/db';
import { SEED_COMPANIES, SEED_SCENARIOS, type SeedCompany } from '../../../packages/db/prisma/seeds/forecast-assumptions.js';
import { buildSeasonalSchedule, distributionAtRateCents } from '../src/lib/forecast/creditors.js';

const DRY_RUN = process.argv.includes('--dry');

/** Forecast start, per both source documents: 1 August 2026. */
const FORECAST_START = new Date(Date.UTC(2026, 7, 1));

const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

/**
 * The calendar month an instalment falls in.
 *
 * Proposal year 1 runs Aug 2026 – Jul 2027, so its December is Dec 2026 and
 * its January is Jan 2027 — the January belongs to the NEXT calendar year.
 */
function instalmentPeriod(yearNumber: number, month: 'DECEMBER' | 'JANUARY') {
  const decemberYear = FORECAST_START.getUTCFullYear() + (yearNumber - 1);
  const year = month === 'DECEMBER' ? decemberYear : decemberYear + 1;
  const monthIndex = month === 'DECEMBER' ? 11 : 0;
  return {
    periodStart: new Date(Date.UTC(year, monthIndex, 1)),
    periodEnd: new Date(Date.UTC(year, monthIndex + 1, 0)),
  };
}

async function seedCompany(seed: SeedCompany) {
  const lines: string[] = [];

  const company = await prisma.fcCompany.upsert({
    where: { code: seed.code },
    create: { code: seed.code, legalName: seed.legalName, tradingName: seed.tradingName },
    update: { legalName: seed.legalName, tradingName: seed.tradingName },
  });
  lines.push(`company ${seed.code} — ${seed.legalName}`);

  await prisma.fcVenue.upsert({
    where: { code: seed.venue.code },
    create: {
      companyId: company.id,
      code: seed.venue.code,
      name: seed.venue.name,
      legacyVenueName: seed.venue.legacyVenueName,
    },
    update: { companyId: company.id, name: seed.venue.name, legacyVenueName: seed.venue.legacyVenueName },
  });
  lines.push(`venue ${seed.venue.code} -> legacy "${seed.venue.legacyVenueName}"`);

  // Assumptions. Version 1 is the seeded baseline; later revisions supersede it
  // rather than overwriting, which is why version is part of the unique key.
  // These are company-level assumptions, so venueId is null — and Prisma
  // cannot match null inside a compound unique key, so upsert is unavailable
  // here. Find-then-write keeps the seeder idempotent all the same.
  let confirmedCount = 0;
  for (const assumption of seed.assumptions) {
    const existingAssumption = await prisma.fcAssumption.findFirst({
      where: { companyId: company.id, venueId: null, key: assumption.key, version: 1 },
    });
    const values = {
      valueNumeric: assumption.valueNumeric ?? null,
      valueText: assumption.valueText ?? null,
      unit: assumption.unit,
      confirmed: assumption.confirmed ?? false,
      sourceNote: assumption.sourceNote,
    };
    if (existingAssumption) {
      await prisma.fcAssumption.update({ where: { id: existingAssumption.id }, data: values });
    } else {
      await prisma.fcAssumption.create({
        data: {
          companyId: company.id,
          key: assumption.key,
          version: 1,
          effectiveFrom: FORECAST_START,
          authorLabel: 'Seed — creditor proposal v5 + corrected model v2',
          ...values,
        },
      });
    }
    if (assumption.confirmed) confirmedCount += 1;
  }
  lines.push(
    `${seed.assumptions.length} assumptions (${confirmedCount} confirmed, ${seed.assumptions.length - confirmedCount} awaiting evidence)`,
  );

  for (const scenario of SEED_SCENARIOS) {
    await prisma.fcScenario.upsert({
      where: { companyId_key: { companyId: company.id, key: scenario.key } },
      create: {
        companyId: company.id,
        key: scenario.key,
        name: scenario.name,
        description: scenario.description,
        adjustments: scenario.adjustments,
        isDefault: scenario.isDefault,
      },
      update: {
        name: scenario.name,
        description: scenario.description,
        adjustments: scenario.adjustments,
        isDefault: scenario.isDefault,
      },
    });
  }
  lines.push(`${SEED_SCENARIOS.length} scenarios`);

  // Creditor proposal. The RATE is the contractual term; the dollar figures are
  // a snapshot against the current pool estimate and move when it is admitted.
  const { proposal } = seed;
  const pool = proposal.estimatedExternalPoolCents;
  const baseCents = distributionAtRateCents(pool, proposal.baseCentsInDollar);
  const performanceCents = distributionAtRateCents(pool, proposal.performanceCentsInDollar);

  const existing = await prisma.fcCreditorProposal.findFirst({
    where: { companyId: company.id, name: proposal.name },
  });
  const data = {
    companyId: company.id,
    name: proposal.name,
    fixedTotalCents: baseCents,
    baseCentsInDollar: proposal.baseCentsInDollar,
    performanceCentsInDollar: proposal.performanceCentsInDollar,
    estimatedExternalPoolCents: pool,
    yearShares: proposal.yearShares as unknown as number[],
    decemberShare: proposal.decemberShare,
    termMonths: proposal.termMonths,
    performanceCapCents: performanceCents,
    // Every non-external class stays out unless the Administrator admits it.
    includeDirectorLoans: false,
    includeIntercompany: false,
    includeSecuredShortfall: false,
    includePriorityClaims: false,
    includeContingentClaims: false,
    status: 'DRAFT',
  };
  const record = existing
    ? await prisma.fcCreditorProposal.update({ where: { id: existing.id }, data })
    : await prisma.fcCreditorProposal.create({ data });

  lines.push(
    `proposal ${proposal.baseCentsInDollar}c base + ${proposal.performanceCentsInDollar}c performance on ${money(pool)} = ${money(baseCents)} / ${money(baseCents + performanceCents)} max`,
  );

  // Rebuild the schedule so a changed pool or profile cannot leave stale rows.
  await prisma.fcCreditorPaymentSchedule.deleteMany({ where: { proposalId: record.id } });
  const instalments = buildSeasonalSchedule({
    totalCents: baseCents,
    yearShares: proposal.yearShares,
    decemberShare: proposal.decemberShare,
  });
  for (const instalment of instalments) {
    const period = instalmentPeriod(instalment.yearNumber, instalment.month);
    await prisma.fcCreditorPaymentSchedule.create({
      data: {
        proposalId: record.id,
        companyId: company.id,
        yearNumber: instalment.yearNumber,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        fixedCents: instalment.cents,
        status: 'SCHEDULED',
      },
    });
  }

  const scheduled = instalments.reduce((sum, instalment) => sum + instalment.cents, 0);
  if (scheduled !== baseCents) {
    throw new Error(`${seed.code}: schedule totals ${money(scheduled)} but the distribution is ${money(baseCents)}`);
  }
  lines.push(
    `${instalments.length} instalments: ${instalments
      .map((i) => `${i.month === 'DECEMBER' ? 'Dec' : 'Jan'} y${i.yearNumber} ${money(i.cents)}`)
      .join(', ')}`,
  );
  lines.push(`schedule reconciles to ${money(scheduled)}`);

  return lines;
}

async function main() {
  console.log(DRY_RUN ? 'Forecast module seed — DRY RUN, nothing written\n' : 'Forecast module seed\n');

  for (const seed of SEED_COMPANIES) {
    if (DRY_RUN) {
      const pool = seed.proposal.estimatedExternalPoolCents;
      const base = distributionAtRateCents(pool, seed.proposal.baseCentsInDollar);
      const instalments = buildSeasonalSchedule({
        totalCents: base,
        yearShares: seed.proposal.yearShares,
        decemberShare: seed.proposal.decemberShare,
      });
      console.log(`${seed.legalName} / ${seed.tradingName}`);
      console.log(`  ${seed.assumptions.length} assumptions, ${SEED_SCENARIOS.length} scenarios`);
      console.log(`  ${seed.proposal.baseCentsInDollar}c on ${money(pool)} = ${money(base)}`);
      for (const instalment of instalments) {
        console.log(`    y${instalment.yearNumber} ${instalment.month.padEnd(8)} ${money(instalment.cents)}`);
      }
      console.log();
      continue;
    }
    const lines = await seedCompany(seed);
    console.log(`${seed.legalName} / ${seed.tradingName}`);
    for (const line of lines) console.log(`  ${line}`);
    console.log();
  }

  if (!DRY_RUN) {
    const [companies, venues, assumptions, scenarios, proposals, schedules] = await Promise.all([
      prisma.fcCompany.count(),
      prisma.fcVenue.count(),
      prisma.fcAssumption.count(),
      prisma.fcScenario.count(),
      prisma.fcCreditorProposal.count(),
      prisma.fcCreditorPaymentSchedule.count(),
    ]);
    console.log(
      `Totals — companies ${companies}, venues ${venues}, assumptions ${assumptions}, scenarios ${scenarios}, proposals ${proposals}, instalments ${schedules}`,
    );

    // Entity separation is the one invariant that must never break.
    const orphaned = await prisma.fcAssumption.count({ where: { companyId: '' } });
    if (orphaned > 0) throw new Error(`${orphaned} assumptions are not attached to a company`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
