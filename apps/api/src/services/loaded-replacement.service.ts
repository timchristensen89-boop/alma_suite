// Loaded replacement tracking.
//
// Persists the cutover checklist + Loaded comparison data on
// AppSettings.loadedCutoverState (single JSON column, single org row).
// Computes cancellation readiness from the check statuses + the
// presence of two completed parallel-run comparison cycles.
//
// The check catalogue lives here in code (not in the DB) so we can add
// new checks without a migration. Statuses are saved per-check.

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

export type LoadedCutoverCategory =
  | 'reports'
  | 'stocktake'
  | 'historical_data'
  | 'comparison'
  | 'cutover';

export type LoadedCutoverStatus =
  | 'not_started'
  | 'needs_work'
  | 'ready'
  | 'verified';

type CheckDefinition = {
  id: string;
  label: string;
  category: LoadedCutoverCategory;
  // Sort order within the category; smaller renders first.
  order: number;
  // Required for cancellation readiness — every required check must be
  // at least 'ready' before we'll let the admin mark Loaded ready to cancel.
  requiredForCutover: boolean;
};

type StoredCheck = {
  status: LoadedCutoverStatus;
  notes?: string;
  updatedAt: string;
  updatedBy: string;
};

type StoredState = {
  checks?: Record<string, StoredCheck>;
  // Parallel-run comparison cycles. Admin enters Loaded values + the
  // Alma values are computed/recorded; the cycle is "explained" once a
  // human confirms the variance is understood.
  comparisons?: LoadedComparisonCycle[];
  // Free-text notes per category — sits beneath the checklist on the
  // admin page so the operator can drop a paragraph of context.
  categoryNotes?: Partial<Record<LoadedCutoverCategory, string>>;
};

export type LoadedComparisonCycle = {
  id: string;
  label: string;
  cycleNumber: number;
  recordedAt: string;
  recordedBy: string;
  loaded: {
    stockValueCents: number | null;
    salesCents: number | null;
    cogsCents: number | null;
    categoryTotals: Record<string, number>;
  };
  alma: {
    stockValueCents: number | null;
    salesCents: number | null;
    cogsCents: number | null;
    categoryTotals: Record<string, number>;
  };
  notes?: string;
  explained: boolean;
  explainedBy?: string;
  explainedAt?: string;
};

// Single source of truth for the checklist. Adding a new item here makes
// it appear in the admin page immediately, with status 'not_started'.
const CHECK_CATALOGUE: CheckDefinition[] = [
  // Reports
  { id: 'reports.daily_sales_ready', label: 'Daily sales report ready', category: 'reports', order: 1, requiredForCutover: true },
  { id: 'reports.weekly_sales_ready', label: 'Weekly sales report ready', category: 'reports', order: 2, requiredForCutover: true },
  { id: 'reports.wage_percent_ready', label: 'Wage % report ready', category: 'reports', order: 3, requiredForCutover: true },
  { id: 'reports.prime_cost_ready', label: 'Prime cost report ready', category: 'reports', order: 4, requiredForCutover: true },
  { id: 'reports.gift_card_liability_ready', label: 'Gift card liability report ready', category: 'reports', order: 5, requiredForCutover: false },
  { id: 'reports.csv_exports_ready', label: 'CSV exports for sales / wages / stock ready', category: 'reports', order: 6, requiredForCutover: true },

  // Stocktake
  { id: 'stock.items_imported', label: 'Loaded item catalogue imported into Alma Stock', category: 'stocktake', order: 1, requiredForCutover: true },
  { id: 'stock.units_confirmed', label: 'Purchase + count units confirmed on every item', category: 'stocktake', order: 2, requiredForCutover: true },
  { id: 'stock.costs_confirmed', label: 'Latest cost confirmed on every item', category: 'stocktake', order: 3, requiredForCutover: true },
  { id: 'stock.areas_configured', label: 'Count areas configured per venue (bar / kitchen / cool room…)', category: 'stocktake', order: 4, requiredForCutover: true },
  { id: 'stock.stocktake_draft_works', label: 'Draft stocktake creates lines for every active item', category: 'stocktake', order: 5, requiredForCutover: true },
  { id: 'stock.stocktake_submit_works', label: 'Submitted stocktake locks down for review', category: 'stocktake', order: 6, requiredForCutover: true },
  { id: 'stock.stocktake_review_lock_works', label: 'Review + lock flow proven end-to-end', category: 'stocktake', order: 7, requiredForCutover: true },
  { id: 'stock.variance_warnings_work', label: 'Variance warnings show high-variance + missing counts', category: 'stocktake', order: 8, requiredForCutover: true },
  { id: 'stock.stocktake_export_ready', label: 'Stocktake CSV export downloads cleanly', category: 'stocktake', order: 9, requiredForCutover: true },
  { id: 'stock.reports_consume_stocktake', label: 'Reports pick up locked stocktake values', category: 'stocktake', order: 10, requiredForCutover: true },

  // Historical data
  { id: 'historical.loaded_sales_exported', label: 'Loaded sales reports exported + archived', category: 'historical_data', order: 1, requiredForCutover: true },
  { id: 'historical.loaded_stocktakes_exported', label: 'Loaded stocktake history exported', category: 'historical_data', order: 2, requiredForCutover: true },
  { id: 'historical.loaded_items_exported', label: 'Loaded item catalogue exported', category: 'historical_data', order: 3, requiredForCutover: true },
  { id: 'historical.loaded_cogs_exported', label: 'Loaded COGS / category reports exported', category: 'historical_data', order: 4, requiredForCutover: true },
  { id: 'historical.loaded_wage_exported', label: 'Loaded wage reports exported', category: 'historical_data', order: 5, requiredForCutover: false },
  { id: 'historical.loaded_month_end_exported', label: 'Loaded month-end reports exported', category: 'historical_data', order: 6, requiredForCutover: false },
  { id: 'historical.loaded_csv_archive_stored', label: 'Loaded CSV archive stored in shared drive', category: 'historical_data', order: 7, requiredForCutover: true },

  // Comparison cycles
  { id: 'comparison.loaded_parallel_cycle_1_done', label: 'Parallel cycle 1: Loaded vs Alma reconciled', category: 'comparison', order: 1, requiredForCutover: true },
  { id: 'comparison.loaded_parallel_cycle_2_done', label: 'Parallel cycle 2: Loaded vs Alma reconciled', category: 'comparison', order: 2, requiredForCutover: true },
  { id: 'comparison.variance_understood', label: 'Variance between Loaded + Alma understood + documented', category: 'comparison', order: 3, requiredForCutover: true },

  // Cutover readiness
  { id: 'cutover.managers_trained', label: 'Managers + chefs trained on Alma Stock + Reports', category: 'cutover', order: 1, requiredForCutover: true },
  { id: 'cutover.fallback_procedure_documented', label: 'Fallback procedure documented (paper count sheet)', category: 'cutover', order: 2, requiredForCutover: true },
  { id: 'cutover.loaded_cancel_ready', label: 'Loaded cancellation booked + comms drafted', category: 'cutover', order: 3, requiredForCutover: false }
];

type ReadinessOverview = {
  generatedAt: string;
  checks: Array<{
    id: string;
    label: string;
    category: LoadedCutoverCategory;
    order: number;
    requiredForCutover: boolean;
    status: LoadedCutoverStatus;
    notes: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  }>;
  categoryNotes: Partial<Record<LoadedCutoverCategory, string>>;
  comparisons: LoadedComparisonCycle[];
  summary: {
    total: number;
    ready: number;
    needsWork: number;
    notStarted: number;
    verified: number;
  };
  cancellationReady: boolean;
  blockers: string[];
};

function actorName(actor: AuthUser): string {
  return `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email || actor.id;
}

function assertAdmin(actor: AuthUser) {
  if (!(actor.isAdmin || actor.role === 'ADMIN')) {
    throw new HttpError(403, 'Loaded replacement tracking is admin-only.');
  }
}

async function readState(): Promise<StoredState> {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { loadedCutoverState: true }
  });
  return (settings?.loadedCutoverState as StoredState) ?? {};
}

async function writeState(next: StoredState): Promise<void> {
  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: { loadedCutoverState: next as never },
    create: {
      id: 'singleton',
      loadedCutoverState: next as never
    }
  });
}

export const loadedReplacementService = {
  CHECK_CATALOGUE,

  async getOverview(actor: AuthUser): Promise<ReadinessOverview> {
    assertAdmin(actor);
    const state = await readState();
    const storedChecks = state.checks ?? {};

    const checks = CHECK_CATALOGUE.map((definition) => {
      const stored = storedChecks[definition.id];
      return {
        id: definition.id,
        label: definition.label,
        category: definition.category,
        order: definition.order,
        requiredForCutover: definition.requiredForCutover,
        status: stored?.status ?? 'not_started',
        notes: stored?.notes ?? null,
        updatedAt: stored?.updatedAt ?? null,
        updatedBy: stored?.updatedBy ?? null
      };
    });

    const ready = checks.filter((check) => check.status === 'ready' || check.status === 'verified').length;
    const verified = checks.filter((check) => check.status === 'verified').length;
    const needsWork = checks.filter((check) => check.status === 'needs_work').length;
    const notStarted = checks.filter((check) => check.status === 'not_started').length;

    // Cancellation readiness — every required check at least 'ready', PLUS
    // both parallel comparison cycles must be marked explained.
    const requiredChecks = checks.filter((check) => check.requiredForCutover);
    const requiredNotReady = requiredChecks.filter((check) => check.status !== 'ready' && check.status !== 'verified');
    const comparisons = (state.comparisons ?? []).slice().sort((a, b) => a.cycleNumber - b.cycleNumber);
    const explainedCycles = comparisons.filter((cycle) => cycle.explained);
    const cancellationReady = requiredNotReady.length === 0 && explainedCycles.length >= 2;

    const blockers: string[] = [];
    if (requiredNotReady.length > 0) {
      blockers.push(`${requiredNotReady.length} required check${requiredNotReady.length === 1 ? '' : 's'} not yet ready: ` + requiredNotReady.map((c) => c.label).slice(0, 3).join(', ') + (requiredNotReady.length > 3 ? '…' : ''));
    }
    if (explainedCycles.length < 2) {
      blockers.push(`Need ${2 - explainedCycles.length} more explained parallel-run comparison cycle${2 - explainedCycles.length === 1 ? '' : 's'} before cancellation is safe.`);
    }

    return {
      generatedAt: new Date().toISOString(),
      checks: checks.sort((a, b) => (a.category === b.category ? a.order - b.order : a.category.localeCompare(b.category))),
      categoryNotes: state.categoryNotes ?? {},
      comparisons,
      summary: { total: checks.length, ready, needsWork, notStarted, verified },
      cancellationReady,
      blockers
    };
  },

  async updateCheck(actor: AuthUser, checkId: string, input: { status: LoadedCutoverStatus; notes?: string }): Promise<ReadinessOverview> {
    assertAdmin(actor);
    const definition = CHECK_CATALOGUE.find((entry) => entry.id === checkId);
    if (!definition) {
      throw new HttpError(404, `Unknown check id "${checkId}".`);
    }
    if (!['not_started', 'needs_work', 'ready', 'verified'].includes(input.status)) {
      throw new HttpError(400, 'Invalid status — must be not_started | needs_work | ready | verified.');
    }
    const state = await readState();
    const checks = { ...(state.checks ?? {}) };
    checks[checkId] = {
      status: input.status,
      notes: typeof input.notes === 'string' ? input.notes.trim() : checks[checkId]?.notes,
      updatedAt: new Date().toISOString(),
      updatedBy: actorName(actor)
    };
    await writeState({ ...state, checks });
    return this.getOverview(actor);
  },

  async updateCategoryNotes(actor: AuthUser, category: LoadedCutoverCategory, notes: string): Promise<ReadinessOverview> {
    assertAdmin(actor);
    const state = await readState();
    const categoryNotes = { ...(state.categoryNotes ?? {}) };
    categoryNotes[category] = notes.trim();
    await writeState({ ...state, categoryNotes });
    return this.getOverview(actor);
  },

  async recordComparison(actor: AuthUser, input: {
    label: string;
    loaded: LoadedComparisonCycle['loaded'];
    alma: LoadedComparisonCycle['alma'];
    notes?: string;
  }): Promise<ReadinessOverview> {
    assertAdmin(actor);
    const state = await readState();
    const existing = state.comparisons ?? [];
    const cycleNumber = existing.length + 1;
    const cycle: LoadedComparisonCycle = {
      id: `cycle-${Date.now()}`,
      label: input.label.trim() || `Parallel cycle ${cycleNumber}`,
      cycleNumber,
      recordedAt: new Date().toISOString(),
      recordedBy: actorName(actor),
      loaded: input.loaded,
      alma: input.alma,
      notes: input.notes?.trim(),
      explained: false
    };
    await writeState({ ...state, comparisons: [...existing, cycle] });
    return this.getOverview(actor);
  },

  async markComparisonExplained(actor: AuthUser, cycleId: string, explained: boolean): Promise<ReadinessOverview> {
    assertAdmin(actor);
    const state = await readState();
    const cycles = (state.comparisons ?? []).map((cycle) => {
      if (cycle.id !== cycleId) return cycle;
      return {
        ...cycle,
        explained,
        explainedBy: explained ? actorName(actor) : undefined,
        explainedAt: explained ? new Date().toISOString() : undefined
      };
    });
    await writeState({ ...state, comparisons: cycles });
    return this.getOverview(actor);
  }
};
