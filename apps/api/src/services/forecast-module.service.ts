// Forecasting module service.
//
// Thin orchestration over the tested pure engines in lib/forecast. The rule
// that shapes every signature here: companyId is a REQUIRED argument, never an
// optional filter, so no query can accidentally span both legal entities.

import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import {
  admittedExternalPoolCents,
  buildPaymentSchedule,
  computeDistribution,
  type CreditorClaimInput,
  type ParticipationSwitches
} from '../lib/forecast/creditors.js';
import { computeBasReserve, computeCashPosition } from '../lib/forecast/gst.js';
import {
  applyScenario,
  compareScenarios,
  DEFAULT_SCENARIOS,
  groupComparison,
  projectYear,
  runScenario,
  type AssumptionSet,
  type ScenarioDefinition
} from '../lib/forecast/scenarios.js';
import { DATASETS, buildSampleCsv, datasetByKey } from '../lib/forecast/import-templates.js';
import { buildErrorReportCsv, parseCsv, validateRows } from '../lib/forecast/import-validate.js';

/** Assumption keys → the typed set the engines expect. */
const ASSUMPTION_KEYS: Record<keyof AssumptionSet, string> = {
  annualBaseSalesCents: 'annual_base_sales',
  annualGrowthPercent: 'annual_growth_percent',
  menuPriceUpliftPerItemCents: 'menu_price_uplift_per_item',
  menuPriceRealisationPercent: 'menu_price_realisation_percent',
  grossWagesWeeklyCents: 'gross_wages_weekly',
  superPercent: 'super_percent',
  cogsTargetPercent: 'cogs_target_percent',
  monthlyRentExGstCents: 'monthly_rent_ex_gst',
  monthlyCleaningCents: 'monthly_cleaning',
  monthlySoftwareCents: 'monthly_software',
  otherOperatingPercent: 'other_operating_percent',
  maintenanceReservePercent: 'maintenance_reserve_percent',
  financeRepaymentsMonthlyCents: 'finance_repayments_monthly',
  administrationFeeTotalCents: 'administration_fee_total',
  openingCashCents: 'opening_cash',
  netGstReservePercent: 'net_gst_reserve_percent'
};

const FALLBACK: AssumptionSet = {
  annualBaseSalesCents: 0,
  annualGrowthPercent: 0,
  menuPriceUpliftPerItemCents: 0,
  menuPriceRealisationPercent: 100,
  grossWagesWeeklyCents: 0,
  superPercent: 12,
  cogsTargetPercent: 0,
  monthlyRentExGstCents: 0,
  monthlyCleaningCents: 0,
  monthlySoftwareCents: 0,
  otherOperatingPercent: 0,
  maintenanceReservePercent: 0,
  financeRepaymentsMonthlyCents: 0,
  administrationFeeTotalCents: 0,
  openingCashCents: 0,
  netGstReservePercent: 0
};

export interface AssumptionProvenance {
  key: string;
  value: number;
  unit: string | null;
  confirmed: boolean;
  sourceNote: string | null;
  version: number;
}

async function requireCompany(companyId: string) {
  const company = await prisma.fcCompany.findUnique({ where: { id: companyId } });
  if (!company) throw new HttpError(404, 'Company not found.');
  return company;
}

/** Active assumptions for one company, with their provenance. */
async function loadAssumptions(companyId: string): Promise<{ set: AssumptionSet; provenance: AssumptionProvenance[] }> {
  const rows = await prisma.fcAssumption.findMany({
    where: { companyId, active: true },
    orderBy: [{ key: 'asc' }, { version: 'desc' }]
  });

  const latestByKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latestByKey.has(row.key)) latestByKey.set(row.key, row);

  const set = { ...FALLBACK };
  const provenance: AssumptionProvenance[] = [];

  for (const [field, key] of Object.entries(ASSUMPTION_KEYS) as Array<[keyof AssumptionSet, string]>) {
    const row = latestByKey.get(key);
    if (!row) continue;
    const value = row.valueNumeric ? Number(row.valueNumeric) : 0;
    set[field] = value;
    provenance.push({
      key,
      value,
      unit: row.unit,
      confirmed: row.confirmed,
      sourceNote: row.sourceNote,
      version: row.version
    });
  }

  return { set, provenance };
}

export const forecastModuleService = {
  /** Companies, for the entity selector. Never returns a combined row. */
  async listCompanies() {
    const companies = await prisma.fcCompany.findMany({
      where: { active: true },
      include: { venues: { where: { active: true } } },
      orderBy: { code: 'asc' }
    });
    return {
      companies: companies.map((company) => ({
        id: company.id,
        code: company.code,
        legalName: company.legalName,
        tradingName: company.tradingName,
        venues: company.venues.map((venue) => ({ id: venue.id, code: venue.code, name: venue.name }))
      })),
      note: 'These are separate legal entities. Cash, creditors and liabilities are never combined.'
    };
  },

  async getAssumptions(companyId: string) {
    const company = await requireCompany(companyId);
    const { set, provenance } = await loadAssumptions(companyId);
    const unconfirmed = provenance.filter((entry) => !entry.confirmed);
    return {
      companyId: company.id,
      companyCode: company.code,
      legalName: company.legalName,
      assumptions: set,
      provenance,
      unconfirmedCount: unconfirmed.length,
      warning:
        unconfirmed.length > 0
          ? `${unconfirmed.length} of ${provenance.length} assumptions are not yet evidenced — operating targets, estimates and proxies such as the COGS rate, the wage structure and the menu-price uplift. Each carries its source; treat them as management assumptions rather than demonstrated results.`
          : null
    };
  },

  /** Operating projection for one company, GST exclusive. */
  async operatingForecast(companyId: string, options: { years?: number; scenarioKey?: string } = {}) {
    const company = await requireCompany(companyId);
    const { set, provenance } = await loadAssumptions(companyId);
    const years = Math.min(10, Math.max(1, options.years ?? 3));

    const stored = await prisma.fcScenario.findMany({ where: { companyId, active: true } });
    const scenarios: ScenarioDefinition[] = stored.length
      ? stored.map((row) => ({
          key: row.key,
          name: row.name,
          description: row.description ?? '',
          adjustments: (row.adjustments ?? {}) as ScenarioDefinition['adjustments']
        }))
      : DEFAULT_SCENARIOS;

    const selected = options.scenarioKey
      ? scenarios.filter((scenario) => scenario.key === options.scenarioKey)
      : scenarios;
    if (selected.length === 0) throw new HttpError(404, 'Scenario not found for this company.');

    return {
      companyId: company.id,
      companyCode: company.code,
      legalName: company.legalName,
      basis: 'GST_EXCLUSIVE' as const,
      note: 'Operating figures are GST exclusive. GST timing is shown separately in the BAS view.',
      scenarios: compareScenarios(company.id, set, selected, { years }).comparisons,
      provenance
    };
  },

  /** BAS reserve timing — deliberately separate from the operating view. */
  async basReserve(companyId: string, grossReceiptsCents: number, actualNetGstCents?: number | null) {
    await requireCompany(companyId);
    const { set } = await loadAssumptions(companyId);
    const reserve = computeBasReserve({
      grossReceiptsCents,
      netGstReservePercent: set.netGstReservePercent,
      actualNetGstCents: actualNetGstCents ?? null
    });
    return {
      ...reserve,
      note:
        reserve.basis === 'ESTIMATED_RATE'
          ? 'Estimated from the historical net-GST rate. This is a timing assumption, not a lodged figure.'
          : 'From an actual BAS.'
    };
  },

  /** Cash buckets: bank cash is not spendable cash. */
  async cashPosition(companyId: string) {
    await requireCompany(companyId);
    const latest = await prisma.fcBankBalanceSnapshot.findFirst({
      where: { companyId },
      orderBy: { asAt: 'desc' }
    });
    if (!latest) {
      return {
        companyId,
        hasBankBalance: false,
        message: 'No bank balance recorded. Enter one before relying on the cash forecast.'
      };
    }
    const outstandingGst = await prisma.fcTaxObligation.aggregate({
      where: { companyId, obligationType: 'BAS', paidDate: null },
      _sum: { netGstCents: true, paygCents: true }
    });
    const position = computeCashPosition({
      bankCashCents: latest.balanceCents,
      gstReserveCents: outstandingGst._sum.netGstCents ?? 0,
      paygPayableCents: outstandingGst._sum.paygCents ?? 0
    });
    return { companyId, hasBankBalance: true, asAt: latest.asAt, bankAccount: latest.bankAccount, ...position };
  },

  /** Creditor position. Only external claims participate unless switched on. */
  async creditorPosition(companyId: string, proposalId?: string) {
    const company = await requireCompany(companyId);
    const [claims, proposal] = await Promise.all([
      prisma.fcCreditorClaim.findMany({ where: { companyId } }),
      proposalId
        ? prisma.fcCreditorProposal.findUnique({ where: { id: proposalId } })
        : prisma.fcCreditorProposal.findFirst({ where: { companyId }, orderBy: { createdAt: 'desc' } })
    ]);

    if (!proposal) {
      return { companyId, companyCode: company.code, hasProposal: false, claims: claims.length };
    }

    const switches: ParticipationSwitches = {
      includeDirectorLoans: proposal.includeDirectorLoans,
      includeIntercompany: proposal.includeIntercompany,
      includeSecuredShortfall: proposal.includeSecuredShortfall,
      includePriorityClaims: proposal.includePriorityClaims,
      includeContingentClaims: proposal.includeContingentClaims
    };

    const claimInputs: CreditorClaimInput[] = claims.map((claim) => ({
      creditorName: claim.creditorName,
      creditorClass: claim.creditorClass as CreditorClaimInput['creditorClass'],
      claimedAmountCents: claim.claimedAmountCents,
      admittedAmountCents: claim.admittedAmountCents,
      proofOfDebtStatus: claim.proofOfDebtStatus as CreditorClaimInput['proofOfDebtStatus'],
      excludedFromDistribution: claim.excludedFromDistribution
    }));

    // Before any proof of debt is admitted there are no claims, so a pool
    // computed from claims alone is zero — and a zero pool reports a 0 cent
    // return, the opposite of what is being offered. Fall back to the
    // proposal's working estimate, and say which one is in use so an estimate
    // is never mistaken for an adjudicated figure.
    const poolFromClaims = admittedExternalPoolCents(claimInputs, switches);
    const usingEstimate = poolFromClaims === 0 && (proposal.estimatedExternalPoolCents ?? 0) > 0;
    const pool = usingEstimate ? proposal.estimatedExternalPoolCents! : poolFromClaims;

    const distribution = computeDistribution({
      fixedTotalCents: proposal.fixedTotalCents,
      performanceCapCents: proposal.performanceCapCents,
      admittedExternalPoolCents: pool,
      deedCostsFundedFromProposalCents: proposal.deedCostsCents
    });

    const schedules = await prisma.fcCreditorPaymentSchedule.findMany({
      where: { proposalId: proposal.id },
      // By period, not year: a year holds two instalments (December and
      // January) and ordering by year alone leaves them in no fixed order.
      orderBy: { periodStart: 'asc' }
    });
    const schedule = schedules.length
      ? schedules.map((row) => ({
          yearNumber: row.yearNumber,
          periodStart: row.periodStart.toISOString().slice(0, 10),
          fixedCents: row.fixedCents,
          performanceCents: row.performanceCents,
          totalCents: row.fixedCents + row.performanceCents
        }))
      : buildPaymentSchedule(
          [Math.round(proposal.fixedTotalCents / 3), Math.round(proposal.fixedTotalCents / 3), proposal.fixedTotalCents - 2 * Math.round(proposal.fixedTotalCents / 3)],
          distribution.performancePaymentCents
        );

    return {
      companyId,
      companyCode: company.code,
      legalName: company.legalName,
      hasProposal: true,
      proposal: {
        id: proposal.id,
        name: proposal.name,
        termMonths: proposal.termMonths,
        fixedTotalCents: proposal.fixedTotalCents,
        performanceCapCents: proposal.performanceCapCents,
        deedCostsCents: proposal.deedCostsCents,
        // The contractual term is a RATE, so the dollar figures above move with
        // the admitted pool rather than being renegotiated.
        baseCentsInDollar: proposal.baseCentsInDollar ? Number(proposal.baseCentsInDollar) : null,
        performanceCentsInDollar: proposal.performanceCentsInDollar ? Number(proposal.performanceCentsInDollar) : null,
        estimatedExternalPoolCents: proposal.estimatedExternalPoolCents,
        participation: switches
      },
      distribution,
      poolSource: usingEstimate ? 'PROPOSAL_ESTIMATE' : 'ADMITTED_CLAIMS',
      schedule,
      claimsByClass: claims.reduce<Record<string, { count: number; claimedCents: number; admittedCents: number }>>(
        (acc, claim) => {
          const bucket = acc[claim.creditorClass] ?? { count: 0, claimedCents: 0, admittedCents: 0 };
          bucket.count += 1;
          bucket.claimedCents += claim.claimedAmountCents;
          bucket.admittedCents += claim.admittedAmountCents ?? 0;
          acc[claim.creditorClass] = bucket;
          return acc;
        },
        {}
      ),
      note: usingEstimate
        ? 'No proofs of debt are admitted yet, so this uses the proposal\'s working pool estimate. Returns recalculate automatically as claims are admitted — the rate is the committed term, not the dollar amount.'
        : 'Distribution is capped at 100 cents in the dollar of admitted external claims.'
    };
  },

  /** Group view — a comparison, never a pooled position. */
  async groupComparison(options: { years?: number } = {}) {
    const companies = await prisma.fcCompany.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
    const entries = [];
    for (const company of companies) {
      const { set } = await loadAssumptions(company.id);
      entries.push({
        companyId: company.id,
        companyName: company.legalName,
        comparison: runScenario(DEFAULT_SCENARIOS[0]!, set, { years: options.years ?? 3 })
      });
    }
    return groupComparison(entries);
  },

  /** Import templates for the import centre. */
  listTemplates() {
    return {
      datasets: DATASETS.map((dataset) => ({
        key: dataset.key,
        title: dataset.title,
        description: dataset.description,
        naturalKey: dataset.naturalKey,
        columns: dataset.columns.map((column) => ({
          name: column.name,
          type: column.type,
          required: column.required ?? false,
          gstBasis: column.gstBasis ?? 'NA',
          description: column.description
        }))
      }))
    };
  },

  templateCsv(datasetKey: string) {
    const dataset = datasetByKey(datasetKey);
    if (!dataset) throw new HttpError(404, 'Unknown import template.');
    return { fileName: `${dataset.key}.csv`, csv: buildSampleCsv(dataset) };
  },

  /**
   * Dry-run validation. Uses exactly the same code path as an apply would, so
   * the preview cannot disagree with the result.
   */
  async validateImport(companyId: string, datasetKey: string, csvText: string, options: { allOrNothing?: boolean } = {}) {
    await requireCompany(companyId);
    const dataset = datasetByKey(datasetKey);
    if (!dataset) throw new HttpError(404, 'Unknown import template.');

    const rows = parseCsv(csvText);
    const result = validateRows(dataset, rows, { allOrNothing: options.allOrNothing });

    return {
      dataset: dataset.key,
      totalRows: result.totalRows,
      validRows: result.validRows.length,
      errorRows: result.errors.filter((error) => error.severity === 'BLOCKING').length,
      duplicateRows: result.duplicateRowNumbers.length,
      unknownColumns: result.unknownColumns,
      missingColumns: result.missingColumns,
      canApply: result.canApply,
      errors: result.errors.slice(0, 200),
      errorReportCsv: result.errors.length ? buildErrorReportCsv(result) : null,
      preview: result.validRows.slice(0, 10).map((row) => ({ rowNumber: row.rowNumber, values: row.values }))
    };
  },

  /** Scenario definitions available to a company. */
  async listScenarios(companyId: string) {
    await requireCompany(companyId);
    const stored = await prisma.fcScenario.findMany({ where: { companyId, active: true }, orderBy: { key: 'asc' } });
    return {
      companyId,
      scenarios: stored.length
        ? stored.map((row) => ({ key: row.key, name: row.name, description: row.description, adjustments: row.adjustments, isDefault: row.isDefault }))
        : DEFAULT_SCENARIOS.map((scenario) => ({ ...scenario, isDefault: scenario.key === 'BASE' }))
    };
  },

  /** Preview a scenario without saving it. */
  async previewScenario(companyId: string, adjustments: ScenarioDefinition['adjustments'], years = 3) {
    await requireCompany(companyId);
    const { set } = await loadAssumptions(companyId);
    return {
      companyId,
      base: projectYear(set),
      scenario: projectYear(applyScenario(set, adjustments)),
      years: runScenario({ key: 'PREVIEW', name: 'Preview', description: '', adjustments }, set, { years })
    };
  },

  /** Open data-quality issues, most severe first. */
  async dataQuality(companyId: string) {
    await requireCompany(companyId);
    const issues = await prisma.fcDataQualityIssue.findMany({
      where: { companyId, resolved: false },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      take: 200
    });
    return {
      companyId,
      blocking: issues.filter((issue) => issue.severity === 'BLOCKING').length,
      warning: issues.filter((issue) => issue.severity === 'WARNING').length,
      informational: issues.filter((issue) => issue.severity === 'INFORMATIONAL').length,
      issues
    };
  },

  /** Sync freshness, for the data-freshness indicator. */
  async syncStatus(companyId: string) {
    await requireCompany(companyId);
    const [cursors, runs] = await Promise.all([
      prisma.fcSyncCursor.findMany({ where: { companyId } }),
      prisma.fcSyncRun.findMany({ where: { companyId }, orderBy: { startedAt: 'desc' }, take: 20 })
    ]);
    return { companyId, cursors, recentRuns: runs };
  },

  /** Model accuracy, for the model-performance page. */
  async modelPerformance(companyId: string) {
    await requireCompany(companyId);
    const [champions, accuracy] = await Promise.all([
      prisma.fcModelVersion.findMany({ where: { isChampion: true } }),
      prisma.fcModelAccuracyResult.findMany({ where: { companyId }, orderBy: { computedAt: 'desc' }, take: 50 })
    ]);
    return { companyId, champions, accuracy };
  }
};
