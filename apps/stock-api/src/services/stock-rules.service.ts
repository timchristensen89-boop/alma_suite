// Stock app operating rules.
//
// The 10 rules the user wants the Stock app to live by, codified in one
// place so individual services can call into them. Each rule has its own
// function so we can unit-test the heuristic in isolation and tune the
// thresholds without hunting through unrelated code.
//
//  1. Recipe cost sanity — flag recipes that look "stupidly expensive"
//     (likely a unit/conversion mistake).
//  2. Unit conversion catalog — kg↔g and L↔ml are interchangeable with
//     their parent; box↔unit always requires manual review.
//  3. Default wastage 2% — recipes without explicit wastage get +2%.
//  4. Auto-attach name matches — recipes that share a name with a stock
//     item or a Square menu item get suggested for manual review.
//  5. Invoice daily import 9am — scheduler hook lives in
//     integration-jobs.ts; this file owns the time + tag.
//  6. Statement detection — invoices with 0 lines + a total = STATEMENT.
//  7. WET awareness — wine invoices include Wine Equalisation Tax on
//     top of GST. Detect + surface separately.
//  8. GST line validation — subtotal + tax must equal total (within
//     ±5c rounding). Flag any drift.
//  9. Staff consumption prompts — weekly to head chef (food) + venue
//     manager (drinks). Hook lives in integration-jobs.ts.
// 10. Over-portion alert — escalation chain head chef → venue manager →
//     owner when actual cost exceeds expected by >5%.

import { prisma } from '@alma/db';

// ─── Rule 1: Recipe cost sanity ──────────────────────────────────────

// Defaults — overridable per call. These are the "sniff test" thresholds
// for spotting unit/conversion mistakes in imported recipes.
const SANITY_DEFAULTS = {
  // Absolute ceiling — even premium hospitality plates rarely cost this much.
  // Anything over this is almost certainly a unit error.
  hardCeilingDollarsPerServing: 80,
  // Relative ceiling — a recipe whose cost is more than N× the category
  // median is suspicious even if the absolute value looks reasonable.
  categoryMedianMultiplier: 3,
  // Min sample size for the category median check to be meaningful.
  minCategorySampleSize: 4
};

export type RecipeCostSanityResult = {
  ok: boolean;
  warnings: string[];
  estimatedDollarsPerServing: number | null;
  thresholds: {
    hardCeilingDollarsPerServing: number;
    categoryMedianDollarsPerServing: number | null;
    categoryMedianMultiplier: number;
  };
};

export async function recipeCostSanity(recipeId: string, overrides: Partial<typeof SANITY_DEFAULTS> = {}): Promise<RecipeCostSanityResult> {
  const cfg = { ...SANITY_DEFAULTS, ...overrides };
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { id: true, title: true, category: true, portionSize: true, estimatedCost: true, salePriceCents: true }
  });
  if (!recipe) {
    return { ok: true, warnings: [], estimatedDollarsPerServing: null, thresholds: { hardCeilingDollarsPerServing: cfg.hardCeilingDollarsPerServing, categoryMedianDollarsPerServing: null, categoryMedianMultiplier: cfg.categoryMedianMultiplier } };
  }
  const portionSize = recipe.portionSize && recipe.portionSize > 0 ? recipe.portionSize : 1;
  const dollarsPerServing = recipe.estimatedCost / portionSize;

  const warnings: string[] = [];
  if (dollarsPerServing > cfg.hardCeilingDollarsPerServing) {
    warnings.push(
      `Estimated cost is $${dollarsPerServing.toFixed(2)} per serving — above the $${cfg.hardCeilingDollarsPerServing} sanity ceiling. Almost certainly a unit / conversion mistake. Check kg↔g and L↔ml first.`
    );
  }

  // Category median check — pull the active recipes in the same category
  // and compare against their median. If no category or too few peers, skip.
  let medianDollarsPerServing: number | null = null;
  if (recipe.category) {
    const peers = await prisma.recipe.findMany({
      where: {
        category: recipe.category,
        status: 'ACTIVE',
        id: { not: recipe.id },
        portionSize: { gt: 0 },
        estimatedCost: { gt: 0 }
      },
      select: { estimatedCost: true, portionSize: true }
    });
    if (peers.length >= cfg.minCategorySampleSize) {
      const perServing = peers.map((peer) => peer.estimatedCost / (peer.portionSize ?? 1)).sort((a, b) => a - b);
      medianDollarsPerServing = perServing[Math.floor(perServing.length / 2)] ?? null;
      if (medianDollarsPerServing && dollarsPerServing > medianDollarsPerServing * cfg.categoryMedianMultiplier) {
        warnings.push(
          `Cost ($${dollarsPerServing.toFixed(2)}/serving) is more than ${cfg.categoryMedianMultiplier}× the ${recipe.category} category median ($${medianDollarsPerServing.toFixed(2)}). Likely a mistake — verify ingredient units.`
        );
      }
    }
  }

  return {
    ok: warnings.length === 0,
    warnings,
    estimatedDollarsPerServing: dollarsPerServing,
    thresholds: {
      hardCeilingDollarsPerServing: cfg.hardCeilingDollarsPerServing,
      categoryMedianDollarsPerServing: medianDollarsPerServing,
      categoryMedianMultiplier: cfg.categoryMedianMultiplier
    }
  };
}

// ─── Rule 2: Unit conversion catalog ─────────────────────────────────

// Sibling units that are always interchangeable with their parent, plus
// the conversion factor (count units per parent). When data quality
// warnings fire on missing_conversion, this is the first place to look.
//
// box ↔ unit lives in a separate `manualSiblings` map because the
// conversion factor depends on the specific item (a box of 6 vs 12 vs
// 24 bottles) and must always be confirmed by a human.

export const UNIT_SIBLINGS = {
  kg: { child: 'g', factor: 1000, autoApply: true },
  g: { parent: 'kg', factor: 0.001, autoApply: true },
  L: { child: 'ml', factor: 1000, autoApply: true },
  l: { child: 'ml', factor: 1000, autoApply: true },
  ml: { parent: 'L', factor: 0.001, autoApply: true },
  box: { child: 'unit', factor: null as number | null, autoApply: false, manualNote: 'Box → unit conversion varies by supplier. Confirm pack size manually.' },
  case: { child: 'unit', factor: null as number | null, autoApply: false, manualNote: 'Case → unit conversion varies by supplier. Confirm pack size manually.' }
} as const;

export type UnitSuggestion = {
  fromUnit: string;
  toUnit: string;
  factor: number | null;
  autoApply: boolean;
  note?: string;
};

export function suggestUnitConversion(purchaseUnit: string, countUnit: string): UnitSuggestion | null {
  const pu = purchaseUnit.trim().toLowerCase();
  const cu = countUnit.trim().toLowerCase();
  if (pu === cu) return null;
  const entry = (UNIT_SIBLINGS as Record<string, { child?: string; parent?: string; factor: number | null; autoApply: boolean; manualNote?: string }>)[pu];
  if (entry && entry.child === cu) {
    return { fromUnit: pu, toUnit: cu, factor: entry.factor, autoApply: entry.autoApply, note: entry.manualNote };
  }
  if (entry && entry.parent === cu) {
    return { fromUnit: pu, toUnit: cu, factor: entry.factor, autoApply: entry.autoApply, note: entry.manualNote };
  }
  return null;
}

// ─── Rule 3: Default wastage (2%) ────────────────────────────────────

export const DEFAULT_WASTE_PERCENT = 2;

export function applyDefaultWastage(line: { wastePercent: number | null | undefined }): { wastePercent: number; defaulted: boolean } {
  if (line.wastePercent !== null && line.wastePercent !== undefined && line.wastePercent >= 0) {
    return { wastePercent: line.wastePercent, defaulted: false };
  }
  return { wastePercent: DEFAULT_WASTE_PERCENT, defaulted: true };
}

// ─── Rule 4: Auto-attach matching names ──────────────────────────────

// When a recipe shares a name with a stock item or a Square menu item,
// surface the match so the user can confirm or reject it. Called on
// recipe create + when an unmapped Square menu item appears.
export async function findMatchingItemsForRecipe(recipeName: string) {
  const name = recipeName.trim();
  if (!name) return { stockItems: [], squareMenuItems: [] };
  const [stockItems, squareMappings] = await Promise.all([
    prisma.stockItem.findMany({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, unit: true, latestCostCents: true, avgCostCents: true }
    }),
    prisma.squareMenuRecipeMapping.findMany({
      where: { squareItemName: { equals: name, mode: 'insensitive' }, status: { in: ['UNMAPPED', 'NEEDS_REVIEW'] } },
      select: { id: true, squareItemId: true, squareItemName: true, priceMoneyAmount: true, status: true }
    })
  ]);
  return { stockItems, squareMenuItems: squareMappings };
}

export async function attachMatchesForReview(recipeId: string, recipeName: string) {
  const matches = await findMatchingItemsForRecipe(recipeName);
  // For Square mappings: link to this recipe + flip to NEEDS_REVIEW so
  // the manual reviewer sees it in the mapping queue. We never auto-confirm.
  if (matches.squareMenuItems.length > 0) {
    await prisma.squareMenuRecipeMapping.updateMany({
      where: { id: { in: matches.squareMenuItems.map((m) => m.id) } },
      data: { almaRecipeId: recipeId, status: 'NEEDS_REVIEW' }
    });
  }
  return matches;
}

// ─── Rule 5: 9am invoice import schedule ─────────────────────────────

// The cron itself lives in Cloud Scheduler and hits a route in
// integration-jobs.ts. We expose the schedule string + tag here so the
// admin "Integration health" page can render the configured time
// consistently.
export const INVOICE_IMPORT_SCHEDULE = {
  cron: '0 9 * * *', // 9:00 AM every day
  timezone: 'Australia/Sydney',
  description: 'Daily 9am Xero supplier invoice pull (rule 5)'
};

// ─── Rule 6: Statement detection ─────────────────────────────────────

// An "invoice" that has zero lines but a non-zero total is a statement.
// The Xero importer should label it so accounting doesn't try to match
// it against PO lines or run COGS off it.
export function detectStatement(invoice: { lines: Array<unknown>; totalCents: number }): { isStatement: boolean; reason?: string } {
  if (invoice.lines.length === 0 && invoice.totalCents > 0) {
    return { isStatement: true, reason: 'No line items + non-zero total — Xero treats this as a statement, not an invoice.' };
  }
  return { isStatement: false };
}

// ─── Rules 7 + 8: Wine + GST + WET ───────────────────────────────────

// AU Wine Equalisation Tax = 29% on the wholesale value of wine,
// charged BEFORE GST. So a wine invoice should break down as:
//   wholesale × (1 + WET_RATE) × (1 + GST_RATE) = invoice total
const WET_RATE = 0.29;
const GST_RATE = 0.10;
const GST_TOLERANCE_CENTS = 5; // ±5c rounding allowed

const WINE_SUPPLIER_HINTS = [
  'winery', 'wines', 'wine co', 'vineyard', 'cellar', 'pinot', 'noir', 'riesling',
  'shiraz', 'sauv blanc', 'champagne', 'sparkling', 'estate'
];

export function isWineInvoice(invoice: { supplierName: string; lines: Array<{ description: string }> }): boolean {
  const supplier = invoice.supplierName.toLowerCase();
  if (WINE_SUPPLIER_HINTS.some((hint) => supplier.includes(hint))) return true;
  const wineKeywordHits = invoice.lines.filter((line) => {
    const desc = line.description.toLowerCase();
    return /\b(wine|red|white|rosé|rose|sparkling|champagne|pinot|shiraz|chard|riesling|merlot|cabernet|sauvignon|grenache|tempranillo)\b/.test(desc);
  });
  return wineKeywordHits.length >= Math.max(1, Math.floor(invoice.lines.length * 0.3));
}

export type GstValidation = {
  ok: boolean;
  reason: string | null;
  expectedTotalCents: number;
  actualTotalCents: number;
  driftCents: number;
  // For wine invoices, surface the decomposition explicitly so the bookkeeper
  // can sanity-check WET separately from GST.
  decomposition: {
    isWine: boolean;
    subtotalCents: number;
    wetCents: number | null;
    gstCents: number;
    totalCents: number;
  };
};

export function validateInvoiceGst(invoice: { supplierName: string; subtotalCents: number; taxCents: number; totalCents: number; lines: Array<{ description: string }> }): GstValidation {
  const isWine = isWineInvoice(invoice);
  const expectedTotalCents = invoice.subtotalCents + invoice.taxCents;
  const driftCents = invoice.totalCents - expectedTotalCents;
  const ok = Math.abs(driftCents) <= GST_TOLERANCE_CENTS;

  // For wine: try to back-derive WET vs GST from the recorded tax amount.
  // If only one tax bucket is present (Xero often collapses these), we
  // flag the bookkeeper to split manually.
  let wetCents: number | null = null;
  if (isWine) {
    // Educated guess: if tax > 10% of subtotal it includes WET+GST.
    const taxRatio = invoice.subtotalCents > 0 ? invoice.taxCents / invoice.subtotalCents : 0;
    if (taxRatio > 0.11) {
      // Approximate: WET applies to subtotal, GST applies to (subtotal + WET).
      // So tax = WET_RATE × subtotal + GST_RATE × subtotal × (1 + WET_RATE).
      // tax = subtotal × (WET_RATE + GST_RATE × (1 + WET_RATE)) = subtotal × 0.419
      // WET portion = subtotal × WET_RATE = subtotal × 0.29
      wetCents = Math.round(invoice.subtotalCents * WET_RATE);
    }
  }

  return {
    ok,
    reason: ok ? null : `Invoice subtotal + tax (${expectedTotalCents}c) doesn't match total (${invoice.totalCents}c). Drift ${driftCents}c. Don't file this in a BAS until reconciled.`,
    expectedTotalCents,
    actualTotalCents: invoice.totalCents,
    driftCents,
    decomposition: {
      isWine,
      subtotalCents: invoice.subtotalCents,
      wetCents,
      gstCents: wetCents !== null ? Math.max(invoice.taxCents - wetCents, 0) : invoice.taxCents,
      totalCents: invoice.totalCents
    }
  };
}

// ─── Rule 11: "portion / portions" lines are yield, not ingredients ─

// When a recipe line's ingredient text reads "portion", "portions",
// "serves", "yields", or "makes N portions" it isn't an ingredient — it
// states the recipe's total portion count. The cost calc must skip it
// and write the parsed count into Recipe.portionSize.
const PORTION_LINE_RE = /\b(portion|portions|serves|serving|yields?|makes)\b/i;
const PORTION_NUMBER_RE = /(-?\d+(?:\.\d+)?)/;

export type PortionLineParse = {
  isPortionLine: boolean;
  portionCount: number | null;
  reason?: string;
};

export function parsePortionLine(line: { ingredientName: string; quantity?: number | null }): PortionLineParse {
  const name = (line.ingredientName ?? '').trim();
  if (!name) return { isPortionLine: false, portionCount: null };
  if (!PORTION_LINE_RE.test(name)) return { isPortionLine: false, portionCount: null };

  // Prefer the explicit quantity field if it's present — Loaded sometimes
  // ships "portions" as the unit with the count in quantity.
  if (typeof line.quantity === 'number' && line.quantity > 0) {
    return {
      isPortionLine: true,
      portionCount: line.quantity,
      reason: `"${name}" recognised as portion line — using quantity ${line.quantity} as total servings.`
    };
  }

  // Otherwise pull the first number out of the ingredient text itself.
  const match = name.match(PORTION_NUMBER_RE);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      return {
        isPortionLine: true,
        portionCount: value,
        reason: `"${name}" recognised as portion line — parsed ${value} servings from the text.`
      };
    }
  }
  return {
    isPortionLine: true,
    portionCount: null,
    reason: `"${name}" looks like a portion line but the count couldn't be parsed. Set Recipe.portionSize manually.`
  };
}

// Apply rule 11 to a recipe's lines: separate the portion declaration
// from the actual ingredients + return the resolved portion count.
export function splitPortionFromIngredients<TLine extends { ingredientName: string; quantity?: number | null }>(
  lines: TLine[]
): { portionCount: number | null; ingredientLines: TLine[]; portionLines: TLine[]; warnings: string[] } {
  const ingredientLines: TLine[] = [];
  const portionLines: TLine[] = [];
  const warnings: string[] = [];
  let portionCount: number | null = null;

  for (const line of lines) {
    const parsed = parsePortionLine(line);
    if (parsed.isPortionLine) {
      portionLines.push(line);
      if (parsed.portionCount !== null && portionCount === null) {
        portionCount = parsed.portionCount;
      }
      if (parsed.reason) warnings.push(parsed.reason);
    } else {
      ingredientLines.push(line);
    }
  }
  if (portionLines.length > 1) {
    warnings.push(`${portionLines.length} portion lines found — using the first valid count. Remove duplicates.`);
  }
  return { portionCount, ingredientLines, portionLines, warnings };
}

// ─── Rule 12: pull unit hints from the item name ─────────────────────

// Most supplier catalogues encode the unit of measure in the item name.
// "Eggs Free Range 60g x 12" → "12 each, each = 60g". This regex hunts
// for the common patterns and returns the best guess so the manual
// editor doesn't have to dig.
const UNIT_HINT_REGEXES: Array<{ re: RegExp; unit: string; multiplier?: number }> = [
  // 750ml, 1.5L, 250g, 2kg, 12oz
  { re: /(\d+(?:\.\d+)?)\s?ml\b/i, unit: 'ml' },
  { re: /(\d+(?:\.\d+)?)\s?l\b/i, unit: 'L' },
  { re: /(\d+(?:\.\d+)?)\s?g\b/i, unit: 'g' },
  { re: /(\d+(?:\.\d+)?)\s?kg\b/i, unit: 'kg' },
  { re: /(\d+(?:\.\d+)?)\s?oz\b/i, unit: 'oz' },
  { re: /(\d+(?:\.\d+)?)\s?lb\b/i, unit: 'lb' },
  { re: /(\d+(?:\.\d+)?)\s?(?:fl\.?\s?oz|floz)\b/i, unit: 'fl_oz' }
];
const PACK_RE = /\b(?:x|×|pack of)\s?(\d+)\b/i;

export type UnitHintFromName = {
  packCount: number | null;
  baseQuantity: number | null;
  baseUnit: string | null;
  derived: boolean;
  reason?: string;
};

export function pickUnitHintFromName(name: string): UnitHintFromName {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return { packCount: null, baseQuantity: null, baseUnit: null, derived: false };

  // Pack count — "x 12", "× 6", "pack of 24"
  const packMatch = trimmed.match(PACK_RE);
  const packCount = packMatch ? Number(packMatch[1]) : null;

  for (const candidate of UNIT_HINT_REGEXES) {
    const match = trimmed.match(candidate.re);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return {
          packCount,
          baseQuantity: value,
          baseUnit: candidate.unit,
          derived: true,
          reason: `Unit "${candidate.unit}" parsed from item name. ${packCount ? `Pack of ${packCount}.` : ''}`.trim()
        };
      }
    }
  }
  return { packCount, baseQuantity: null, baseUnit: null, derived: false };
}

// ─── Rule 13: prefer metric base units (kg, g, L, ml) ────────────────

// Imperial → metric conversion factors. Apply when we detect lb / oz / fl_oz
// either in the item name (via rule 12) or in a recipe line's unit field.
const METRIC_BASE_CONVERSION: Record<string, { factor: number; to: 'kg' | 'g' | 'L' | 'ml' }> = {
  lb: { factor: 0.45359237, to: 'kg' },
  pound: { factor: 0.45359237, to: 'kg' },
  pounds: { factor: 0.45359237, to: 'kg' },
  oz: { factor: 28.3495231, to: 'g' },
  ounce: { factor: 28.3495231, to: 'g' },
  ounces: { factor: 28.3495231, to: 'g' },
  fl_oz: { factor: 29.5735296, to: 'ml' },
  cup: { factor: 250, to: 'ml' },       // AU metric cup
  cups: { factor: 250, to: 'ml' },
  tbsp: { factor: 20, to: 'ml' },        // AU metric tablespoon (not US)
  tbs: { factor: 20, to: 'ml' },
  tsp: { factor: 5, to: 'ml' }
};

export type MetricNormalisation = {
  quantity: number;
  unit: 'kg' | 'g' | 'L' | 'ml' | string;
  converted: boolean;
  factor: number;
  reason?: string;
};

export function normaliseToMetric(quantity: number, unit: string): MetricNormalisation {
  const u = (unit ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  const passthrough = ['kg', 'g', 'l', 'ml'];
  if (passthrough.includes(u)) {
    return { quantity, unit: u === 'l' ? 'L' : (u as MetricNormalisation['unit']), converted: false, factor: 1 };
  }
  const entry = METRIC_BASE_CONVERSION[u];
  if (entry) {
    return {
      quantity: quantity * entry.factor,
      unit: entry.to,
      converted: true,
      factor: entry.factor,
      reason: `Converted ${quantity}${unit} → ${(quantity * entry.factor).toFixed(2)}${entry.to} (factor ${entry.factor}).`
    };
  }
  return { quantity, unit, converted: false, factor: 1 };
}

// ─── Rule 10: Over-portion alert escalation ──────────────────────────

const OVER_PORTION_THRESHOLD_PCT = 5;

export type OverPortionAlert = {
  shouldAlert: boolean;
  severity: 'info' | 'warning' | 'critical';
  escalateTo: 'head_chef' | 'venue_manager' | 'owner';
  pctOver: number;
  expectedCostCents: number;
  actualCostCents: number;
  message: string;
};

export function overPortionAlert(input: { expectedCostCents: number; actualCostCents: number; recipeName?: string; venue?: string }): OverPortionAlert {
  const expected = Math.max(input.expectedCostCents, 1);
  const actual = input.actualCostCents;
  const pctOver = ((actual - expected) / expected) * 100;

  if (pctOver <= OVER_PORTION_THRESHOLD_PCT) {
    return {
      shouldAlert: false,
      severity: 'info',
      escalateTo: 'head_chef',
      pctOver,
      expectedCostCents: expected,
      actualCostCents: actual,
      message: 'Within expected portion variance.'
    };
  }
  // Escalation chain:
  //   5–10%  → head chef
  //   10–20% → venue manager
  //   >20%   → owner
  const escalateTo: OverPortionAlert['escalateTo'] = pctOver < 10 ? 'head_chef' : pctOver < 20 ? 'venue_manager' : 'owner';
  const severity: OverPortionAlert['severity'] = pctOver < 10 ? 'info' : pctOver < 20 ? 'warning' : 'critical';
  const recipe = input.recipeName ? `"${input.recipeName}"` : 'a recipe';
  const venueLine = input.venue ? ` at ${input.venue}` : '';
  return {
    shouldAlert: true,
    severity,
    escalateTo,
    pctOver,
    expectedCostCents: expected,
    actualCostCents: actual,
    message: `${recipe}${venueLine} is portioning ${pctOver.toFixed(1)}% over expected cost (target $${(expected / 100).toFixed(2)}, actual $${(actual / 100).toFixed(2)}). Escalating to ${escalateTo.replace('_', ' ')}.`
  };
}
