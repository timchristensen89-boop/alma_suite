import { prisma } from '@alma/db';
import {
  staffPayRateSelect,
  staffCostingRate,
  weeklyFixedCostCents
} from '../src/lib/staff-pay-rates.js';

const money = (c: number | null | undefined) => (c == null ? '—' : '$' + (c / 100).toFixed(2));
const pad = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n);
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—');

// Split a name into normalised letter-only tokens (accent-stripped, lowercased)
// so "Rodrigo Golçalves" and "Rodrigo Golcalves" tokenise identically.
function tokenize(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter(Boolean)
  );
}
function subsetOf(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

async function main() {
  // Every ACTIVE human staffer — the exact population the costing report costs.
  const staff = await prisma.staffProfile.findMany({
    where: { accountType: 'HUMAN', mergedIntoStaffProfileId: null, employmentStatus: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, ...staffPayRateSelect },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
  });

  const rows = staff.map((p) => {
    const rate = staffCostingRate(p as unknown as Parameters<typeof staffCostingRate>[0]);
    const weekly = weeklyFixedCostCents(rate);
    const klass = weekly > 0 ? 'SALARIED' : rate.rateCents ? 'HOURLY' : 'NO-RATE';
    return {
      id: p.id,
      name: `${p.firstName} ${p.lastName}`.trim(),
      tokens: tokenize(`${p.firstName} ${p.lastName}`),
      venue: p.venue ?? '—',
      role: p.roleTitle ?? '—',
      klass,
      rateCents: rate.rateCents,
      weekly,
      source: rate.source,
      hasProfile: !!p.payProfile
    };
  });

  console.log(`\n=== ACTIVE STAFF COSTABILITY (n=${rows.length}) ===`);
  for (const r of [...rows].sort((a, b) => a.klass.localeCompare(b.klass) || a.name.localeCompare(b.name))) {
    console.log(
      `${pad(r.klass, 9)} ${pad(r.name, 24)} ${pad(r.venue, 15)} hr:${pad(money(r.rateCents), 9)} wk:${pad(money(r.weekly), 11)} [${r.source}]`
    );
  }

  const salaried = rows.filter((r) => r.klass === 'SALARIED');
  const hourly = rows.filter((r) => r.klass === 'HOURLY');
  const noRate = rows.filter((r) => r.klass === 'NO-RATE');
  console.log(`\nSALARIED ${salaried.length} | HOURLY ${hourly.length} | NO-RATE ${noRate.length}`);

  // ── WORKLIST: everyone with no pay setup, with the signal to action them ──
  // Pull shift history (count + last shift) so we can tell a real worker who's
  // just missing a rate from a dormant/placeholder/duplicate account.
  const noRateIds = noRate.map((r) => r.id);
  const tsAgg = noRateIds.length
    ? await prisma.timesheet.groupBy({
        by: ['staffProfileId'],
        where: { staffProfileId: { in: noRateIds } },
        _count: { _all: true },
        _max: { workDate: true }
      })
    : [];
  const shifts = new Map<string, { count: number; last: Date | null }>();
  for (const t of tsAgg) shifts.set(t.staffProfileId, { count: t._count._all, last: t._max.workDate });

  const MGR = /manager|chef|head|sous|owner|director|\bgm\b|general manager|admin/i;

  function twinFor(r: (typeof rows)[number]): { name: string; rated: boolean } | null {
    for (const other of rows) {
      if (other.id === r.id) continue;
      if (subsetOf(r.tokens, other.tokens) || subsetOf(other.tokens, r.tokens)) {
        return { name: other.name, rated: other.klass !== 'NO-RATE' };
      }
    }
    return null;
  }

  function action(r: (typeof rows)[number], s: { count: number; last: Date | null } | undefined): string {
    const twin = twinFor(r);
    if (twin) return `DUP? ↔ ${twin.name}${twin.rated ? ' (rated)' : ''} — keep one, archive the other`;
    if (/^unallocated/i.test(r.name)) return 'roster placeholder (not a person) — leave as-is';
    if (MGR.test(r.role)) return 'SALARIED → set Full-time + pay amount';
    if ((s?.count ?? 0) > 0) return 'HOURLY → set hourly rate (has shifts)';
    return 'no shifts on record — archive, or set a rate if active';
  }

  console.log(`\n=== WORKLIST — ${noRate.length} staff with NO pay setup (cost $0 today) ===`);
  console.log(`${pad('NAME', 24)} ${pad('VENUE', 13)} ${pad('ROLE', 20)} ${pad('SHIFTS', 7)} ${pad('LAST SHIFT', 11)} ACTION`);
  for (const r of [...noRate].sort((a, b) => (shifts.get(b.id)?.count ?? 0) - (shifts.get(a.id)?.count ?? 0) || a.name.localeCompare(b.name))) {
    const s = shifts.get(r.id);
    console.log(
      `${pad(r.name, 24)} ${pad(r.venue, 13)} ${pad(r.role, 20)} ${pad(String(s?.count ?? 0), 7)} ${pad(isoDay(s?.last), 11)} ${action(r, s)}`
    );
  }

  console.log('\nLegend:');
  console.log('  SALARIED → set the person to Full-time + a weekly/annual pay amount; the rule then costs full wage + 12% super every week.');
  console.log('  HOURLY   → set their hourly rate; they cost from timesheets automatically.');
  console.log('  DUP?     → two accounts share a name; keep the one with the rate/shifts, archive the empty twin.');
  console.log('  placeholder → "Unallocated …" are roster stand-ins, not real people; expected to have no rate.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
