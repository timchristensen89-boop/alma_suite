// Projected spend per supplier per week (reports, built for Cameron).
//
// Method, in order:
//   1. Trend COGS% against sales from Xero P&L MONTHLY TOTALS (not individual
//      supplier invoices — imports are still patchy, P&L totals are trusted).
//   2. Apply the projected COGS% to the forecast's weekly sales.
//   3. Split projected COGS food / beverage / other using the trailing P&L
//      account mix.
//   4. Split each bucket across suppliers by their trailing share of invoiced
//      spend (shares are robust to missing invoices in a way totals are not).

import { prisma } from '@alma/db';
import type {
  AuthUser,
  SupplierSpendBucket,
  SupplierSpendPayload,
  SupplierSpendSupplier,
  SupplierSpendWeek
} from '@alma/shared';
import { z } from 'zod';
import { HttpError } from '../lib/http.js';
import { forecastService } from './forecast.service.js';
import { integrationService, type XeroPlMonth } from './integration.service.js';

const querySchema = z.object({
  weeks: z.coerce.number().int().min(2).max(13).optional().default(8),
  venue: z.string().trim().optional()
});

const SUPPLIER_WINDOW_DAYS = 84; // 12 weeks of invoice history for shares
const MIN_MONTH_SALES_CENTS = 100_000; // ignore months with < $1k sales (partial/closed)
const MIN_SUPPLIER_SHARE = 0.02; // below 2% of bucket → grouped into "Other suppliers"
const MAX_SUPPLIERS_PER_BUCKET = 12;

// Mirrors FINALISED_STOCK_INVOICE_WHERE in @alma/db cogs.ts — drafts and
// no-item imports are noise, not spend.
const FINALISED_INVOICE_WHERE = {
  status: { not: 'DRAFT' },
  triageStatus: { not: 'NO_ITEM' }
} as const;

const BEV_NAME_PATTERN = /bever|liquor|wine|beer|spirit|drink|coffee|roaster|alcohol|keg|brew|cellar|vintner|distill/i;
const FOOD_NAME_PATTERN = /food|produce|meat|seafood|fish|bakery|dairy|grocer|butch|veg|fruit|farm|poultry|smallgood/i;

function leastSquares(values: number[]): { intercept: number; slope: number } {
  const n = values.length;
  if (n === 0) return { intercept: 0, slope: 0 };
  if (n === 1) return { intercept: values[0] ?? 0, slope: 0 };
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, v) => sum + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * ((values[i] ?? 0) - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator === 0 ? 0 : numerator / denominator;
  return { intercept: yMean - slope * xMean, slope };
}

function classifySupplier(name: string, categoryVotes: Map<SupplierSpendBucket, number>): SupplierSpendBucket {
  // Stock-category cents votes first (strongest signal), then name keywords.
  let best: SupplierSpendBucket | null = null;
  let bestCents = 0;
  for (const [bucket, cents] of categoryVotes) {
    if (cents > bestCents) {
      best = bucket;
      bestCents = cents;
    }
  }
  if (best) return best;
  if (BEV_NAME_PATTERN.test(name)) return 'beverage';
  if (FOOD_NAME_PATTERN.test(name)) return 'food';
  return 'food'; // hospitality default: unclassified suppliers are almost always food
}

function bucketFromCategoryName(category: string): SupplierSpendBucket {
  if (BEV_NAME_PATTERN.test(category)) return 'beverage';
  if (FOOD_NAME_PATTERN.test(category)) return 'food';
  return 'other';
}

export const supplierSpendService = {
  async projectedSpend(query: unknown, actor: AuthUser): Promise<SupplierSpendPayload> {
    const parsed = querySchema.parse(query ?? {});
    const venue = parsed.venue && parsed.venue.toLowerCase() !== 'all' ? parsed.venue : null;
    const notes: string[] = [];

    // ── 1. COGS% trend from Xero P&L ────────────────────────────────────────
    let trend: Awaited<ReturnType<typeof integrationService.xeroProfitAndLossTrend>>;
    try {
      trend = await integrationService.xeroProfitAndLossTrend(7);
    } catch (error) {
      // A 401 from Xero on the Reports endpoint means the connection predates
      // the accounting.reports.read scope — a reconnect grants it.
      const message = error instanceof Error ? error.message : '';
      if (/HTTP 401/.test(message)) {
        throw new HttpError(
          409,
          'Xero needs to be reconnected to grant P&L report access (Admin, Integrations, Xero, Reconnect). One click by the owner, then this report goes live.'
        );
      }
      throw error;
    }
    let plMonths: XeroPlMonth[] = trend.months;
    let plSource: 'venue' | 'group' = 'group';
    if (venue && trend.perVenue[venue]?.length) {
      plMonths = trend.perVenue[venue];
      plSource = 'venue';
    } else if (venue) {
      notes.push(
        `No Xero organisation matched "${venue}" — COGS trend uses the group P&L instead.`
      );
    }

    const usable = plMonths.filter((month) => month.salesCents >= MIN_MONTH_SALES_CENTS);
    if (usable.length < 2) {
      throw new HttpError(
        409,
        'Not enough Xero P&L history to trend COGS against sales (need at least two months with sales).'
      );
    }

    const pctSeries = usable.map((month) => month.cogsCents / month.salesCents);
    const { intercept, slope } = leastSquares(pctSeries);
    const rawProjected = intercept + slope * usable.length; // one step past the last month
    const trailing = pctSeries.slice(-3);
    const trailingMean = trailing.reduce((sum, v) => sum + v, 0) / trailing.length;
    const softMin = trailingMean - 0.06;
    const softMax = trailingMean + 0.06;
    let projectedPct = Math.min(softMax, Math.max(softMin, rawProjected));
    projectedPct = Math.min(0.55, Math.max(0.1, projectedPct));
    const clamped = projectedPct !== rawProjected;
    if (clamped) {
      notes.push(
        `Trend projected ${(rawProjected * 100).toFixed(1)}% — clamped to ${(projectedPct * 100).toFixed(1)}% (kept within 6pts of the trailing three month mean).`
      );
    }

    // ── 2. Food / beverage / other split from trailing P&L mix ─────────────
    const splitWindow = usable.slice(-3);
    let foodSum = 0;
    let bevSum = 0;
    let otherSum = 0;
    for (const month of splitWindow) {
      foodSum += month.foodCogsCents;
      bevSum += month.bevCogsCents;
      otherSum += month.otherCogsCents;
    }
    const splitTotal = foodSum + bevSum + otherSum;
    const split =
      splitTotal > 0
        ? { food: foodSum / splitTotal, beverage: bevSum / splitTotal, other: otherSum / splitTotal }
        : { food: 0.7, beverage: 0.3, other: 0 };
    if (splitTotal === 0) {
      notes.push('Xero COGS accounts could not be classified food vs beverage — using a 70/30 default split.');
    }

    // ── 3. Weekly sales forecast ────────────────────────────────────────────
    const outlook = await forecastService.outlook(
      { weeks: parsed.weeks, ...(venue ? { venue } : {}) },
      actor
    );
    const forecastWeeks = outlook.totals.weeks.slice(0, parsed.weeks);
    if (forecastWeeks.length === 0) {
      throw new HttpError(409, 'No forecast weeks available — run the forecast first.');
    }

    // ── 4. Supplier shares from trailing invoices ───────────────────────────
    const windowStart = new Date(Date.now() - SUPPLIER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const lines = await prisma.supplierInvoiceLine.findMany({
      where: {
        invoice: {
          invoiceDate: { gte: windowStart },
          ...FINALISED_INVOICE_WHERE,
          ...(venue ? { venue } : {})
        }
      },
      select: {
        lineAmountCents: true,
        invoice: { select: { supplierName: true, subtotalCents: true, totalCents: true } },
        item: { select: { category: { select: { name: true } } } }
      }
    });

    type SupplierAccumulator = {
      cents: number;
      votes: Map<SupplierSpendBucket, number>;
    };
    const bySupplier = new Map<string, SupplierAccumulator>();
    for (const line of lines) {
      const name = (line.invoice.supplierName ?? '').trim() || 'Unknown supplier';
      const entry = bySupplier.get(name) ?? { cents: 0, votes: new Map() };
      entry.cents += line.lineAmountCents ?? 0;
      const category = line.item?.category?.name;
      if (category) {
        const bucket = bucketFromCategoryName(category);
        entry.votes.set(bucket, (entry.votes.get(bucket) ?? 0) + (line.lineAmountCents ?? 0));
      }
      bySupplier.set(name, entry);
    }
    if (bySupplier.size === 0) {
      notes.push('No finalised supplier invoices in the trailing 12 weeks — supplier split unavailable, showing bucket totals only.');
    }

    const bucketTotals: Record<SupplierSpendBucket, number> = { food: 0, beverage: 0, other: 0 };
    const classified: Array<{ name: string; bucket: SupplierSpendBucket; cents: number }> = [];
    for (const [name, entry] of bySupplier) {
      const bucket = classifySupplier(name, entry.votes);
      bucketTotals[bucket] += entry.cents;
      classified.push({ name, bucket, cents: entry.cents });
    }

    // ── Assemble weekly matrix ──────────────────────────────────────────────
    const weeks: SupplierSpendWeek[] = forecastWeeks.map((week) => {
      const cogsCents = Math.round(week.salesForecastCents * projectedPct);
      return {
        weekStart: week.weekStart,
        salesForecastCents: week.salesForecastCents,
        cogsCents,
        foodCents: Math.round(cogsCents * split.food),
        bevCents: Math.round(cogsCents * split.beverage),
        otherCents: Math.round(cogsCents * split.other)
      };
    });

    const suppliers: SupplierSpendSupplier[] = [];
    for (const bucket of ['food', 'beverage', 'other'] as const) {
      const inBucket = classified
        .filter((entry) => entry.bucket === bucket && entry.cents > 0)
        .sort((a, b) => b.cents - a.cents);
      const total = bucketTotals[bucket];
      if (total <= 0 || inBucket.length === 0) continue;

      const kept = inBucket
        .filter((entry) => entry.cents / total >= MIN_SUPPLIER_SHARE)
        .slice(0, MAX_SUPPLIERS_PER_BUCKET);
      const keptCents = kept.reduce((sum, entry) => sum + entry.cents, 0);
      const remainder = total - keptCents;

      const rows = [...kept.map((entry) => ({ name: entry.name, cents: entry.cents }))];
      if (remainder > 0) rows.push({ name: 'Other suppliers', cents: remainder });

      for (const row of rows) {
        const share = row.cents / total;
        const weekly = weeks.map((week) => {
          const bucketCents =
            bucket === 'food' ? week.foodCents : bucket === 'beverage' ? week.bevCents : week.otherCents;
          return Math.round(bucketCents * share);
        });
        suppliers.push({
          name: row.name,
          bucket,
          share,
          weekly,
          totalCents: weekly.reduce((sum, cents) => sum + cents, 0),
          trailingCents: row.cents
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      venue,
      venues: outlook.venues.map((entry) => entry.venue),
      weeks,
      suppliers,
      basis: {
        plMonths: plMonths.map((month) => ({
          month: month.month,
          salesCents: month.salesCents,
          cogsCents: month.cogsCents,
          cogsPct: month.salesCents > 0 ? month.cogsCents / month.salesCents : null,
          foodShare: month.cogsCents > 0 ? month.foodCogsCents / month.cogsCents : null,
          bevShare: month.cogsCents > 0 ? month.bevCogsCents / month.cogsCents : null,
          otherShare: month.cogsCents > 0 ? month.otherCogsCents / month.cogsCents : null
        })),
        plSource,
        projectedCogsPct: projectedPct,
        cogsPctTrendPerMonth: slope,
        clamped,
        split,
        supplierWindowDays: SUPPLIER_WINDOW_DAYS,
        notes
      }
    };
  }
};
