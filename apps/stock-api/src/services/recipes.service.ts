import type { Prisma } from '@prisma/client';
import { prisma, computeActualCogs } from '@alma/db';
import {
  recipeBulkDeleteInputSchema,
  recipeCategoryCreateInputSchema,
  recipeCategoryUpdateInputSchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  recipePortionsCreateInputSchema,
  type PortionChild,
  type PortionParentType,
  type PortionTreePayload,
  type Recipe,
  type RecipeActualSales,
  type RecipeCategory,
  type RecipeCategoryKind,
  type RecipeCostLine,
  type RecipeCostLineTrace,
  type RecipeCostPayload,
  type RecipeIngredientOption,
  type RecipeLine,
  type RecipeStatus,
  type RecipeWithLines,
  type RecipesPayload,
  type RecipesSummary,
  type StockCostOfGoodsPayload
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { applyDefaultWastage, attachMatchesForReview, recipeCostSanity } from './stock-rules.service.js';
import { convertBetweenUnits, convertQuantityToCostUnit } from './units.js';

type RecipeRow = Prisma.RecipeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    venuePrices: { select: { venue: true; salePriceCents: true } };
  };
}>;

type RecipeWithLinesRow = Prisma.RecipeGetPayload<{
  include: {
    lines: {
      include: {
        item: { select: { id: true; name: true; unit: true; countUnit: true; conversionFactor: true; measurePerCountUnit: true; measureUnit: true; avgCostCents: true } };
        subRecipe: { select: { id: true; title: true; yieldQuantity: true; yieldUnit: true; estimatedCost: true; isPrepRecipe: true } };
      };
    };
    venuePrices: { select: { venue: true; salePriceCents: true } };
  };
}>;

type RecipeLineRow = RecipeWithLinesRow['lines'][number];

type RecipeCategoryRow = Prisma.RecipeCategoryGetPayload<Record<string, never>>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function isPresentString(value: string | null | undefined): value is string {
  return Boolean(value);
}

function normaliseRecipeCategoryKind(value: string): RecipeCategoryKind {
  return value === 'BEVERAGE' || value === 'OTHER' ? value : 'FOOD';
}

function normaliseRecipeStatus(value: string): RecipeStatus {
  return value === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';
}

function inferPrepRecipeFlag(input: {
  isPrepRecipe?: boolean;
  category?: string | null;
  subcategory?: string | null;
  notes?: string | null;
}) {
  if (input.isPrepRecipe !== undefined) return input.isPrepRecipe;
  const value = [input.category ?? '', input.subcategory ?? '', input.notes ?? '']
    .join(' ')
    .toLowerCase();
  return input.category === 'Production Recipes' || /\b(prep|batch|production)\b/.test(value);
}

function dollarsToCents(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function centsToDollars(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  return Math.round(value) / 100;
}

function roundCents(value: number) {
  return Math.round(value);
}

// Trim a converted quantity to a readable precision for the cost trace.
function tidyQty(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

// Human label for how a stock-item line's quantity was converted to its cost
// unit — the "show the working" line under each costed ingredient.
function stockConversionLabel(
  quantity: number,
  fromUnit: string | null,
  convertedQuantity: number,
  costUnit: string | null,
  via: RecipeCostLineTrace['conversionMethod']
): string | null {
  if (via === 'same-unit' || via === 'none') return null;
  const from = `${tidyQty(quantity)} ${fromUnit ?? ''}`.trim();
  const to = `${tidyQty(convertedQuantity)} ${costUnit ?? ''}`.trim();
  const note =
    via === 'pack'
      ? ' (pack size)'
      : via === 'measure'
        ? ' (metric)'
        : via === 'measure-pack'
          ? ' (measure bridge)'
          : '';
  return `${from} → ${to}${note}`;
}

function inferRecipeCategoryKind(
  categoryName: string,
  recipes: Array<Pick<RecipeRow, 'category' | 'kind' | 'subcategory'>>
): RecipeCategoryKind {
  const related = recipes.filter((recipe) => recipe.category === categoryName);
  const value = [
    categoryName,
    ...related.flatMap((recipe) => [recipe.kind ?? '', recipe.subcategory ?? ''])
  ]
    .join(' ')
    .toLowerCase();

  if (
    /\b(bar|bev|beverage|cocktail|drink|wine|beer|spirit|liquor|coffee|tea|juice)\b/.test(
      value
    )
  ) {
    return 'BEVERAGE';
  }

  if (/\b(food|dish|prep|kitchen|menu|meal|sauce|dessert|starter|main)\b/.test(value)) {
    return 'FOOD';
  }

  return 'FOOD';
}

function toRecipeCategoryPayload(row: RecipeCategoryRow, recipeCount: number): RecipeCategory {
  return {
    id: row.id,
    name: row.name,
    kind: normaliseRecipeCategoryKind(row.kind),
    description: row.description,
    recipeCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toRecipePayload(row: RecipeRow): Recipe {
  return {
    id: row.id,
    legacyId: row.legacyId,
    title: row.title,
    kind: row.kind,
    category: row.category,
    subcategory: row.subcategory,
    venue: row.venue,
    salePriceCents: row.salePriceCents,
    portionSize: row.portionSize,
    portionUnit: row.portionUnit,
    yieldQuantity: row.yieldQuantity,
    yieldUnit: row.yieldUnit,
    isPrepRecipe: row.isPrepRecipe,
    status: normaliseRecipeStatus(row.status),
    estimatedCost: row.estimatedCost,
    notes: row.notes,
    lineCount: row._count.lines,
    venuePrices: row.venuePrices?.map((p) => ({ venue: p.venue, salePriceCents: p.salePriceCents })) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toLinePayload(row: RecipeLineRow): RecipeLine {
  return {
    id: row.id,
    legacyId: row.legacyId,
    recipeId: row.recipeId,
    position: row.position,
    ingredientName: row.ingredientName,
    quantity: row.quantity,
    unit: row.unit,
    cost: row.cost,
    wastePercent: row.wastePercent,
    itemId: row.itemId,
    item: row.item ?? null,
    subRecipeId: row.subRecipeId,
    subRecipe: row.subRecipe ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toRecipeWithLinesPayload(row: RecipeWithLinesRow): RecipeWithLines {
  return {
    id: row.id,
    legacyId: row.legacyId,
    title: row.title,
    kind: row.kind,
    category: row.category,
    subcategory: row.subcategory,
    venue: row.venue,
    salePriceCents: row.salePriceCents,
    portionSize: row.portionSize,
    portionUnit: row.portionUnit,
    yieldQuantity: row.yieldQuantity,
    yieldUnit: row.yieldUnit,
    isPrepRecipe: row.isPrepRecipe,
    status: normaliseRecipeStatus(row.status),
    estimatedCost: row.estimatedCost,
    notes: row.notes,
    lineCount: row.lines.length,
    venuePrices: row.venuePrices?.map((p) => ({ venue: p.venue, salePriceCents: p.salePriceCents })) ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toLinePayload)
  };
}

function costForLine(row: RecipeLineRow): RecipeCostLine {
  const warnings: string[] = [];
  const wasteMultiplier = 1 + Math.max(0, row.wastePercent ?? 0) / 100;
  const quantity = row.quantity ?? null;

  if (row.itemId) {
    if (!row.item) {
      return {
        lineId: row.id,
        ingredientName: row.ingredientName,
        quantity,
        unit: row.unit,
        wastePercent: row.wastePercent,
        source: 'MISSING',
        unitCostCents: null,
        lineCostCents: null,
        warnings: ['Linked stock item could not be found']
      };
    }
    if (row.item.avgCostCents === null) warnings.push('Stock item average cost is missing');
    if (quantity === null) warnings.push('Ingredient quantity is missing');
    const stockCostUnit = row.item.countUnit ?? row.item.unit;
    // Express the line quantity in the item's cost unit so the per-cost-unit
    // price (avgCostCents) is applied correctly. Only warn when the units differ
    // and no conversion can be resolved — otherwise we'd silently mis-cost.
    const conversion =
      quantity !== null ? convertQuantityToCostUnit(quantity, row.unit, row.item) : null;
    // A genuinely unconvertible unit must NOT be costed off the raw quantity —
    // that silently fabricates a wrong number (e.g. "2 kg" of a per-each item
    // costed as 2 each). Refuse to cost the line and tell the user exactly what
    // to set, so the recipe shows "cost unavailable" rather than a bad figure.
    const conversionFailed = Boolean(
      quantity !== null &&
      conversion?.via === 'unknown' &&
      row.unit &&
      stockCostUnit &&
      row.unit !== stockCostUnit
    );
    if (conversionFailed) {
      warnings.push(`Can't convert “${row.unit}” to this item's cost unit (“${stockCostUnit}”). Fix it on the item: set the pack size (how many ${stockCostUnit} per ${row.item.unit}) or the measure-per-unit (e.g. grams/ml in one ${stockCostUnit}), or enter this line in ${stockCostUnit}. This line is not counted in the cost until then.`);
    }
    // Null when the unit can't convert — never fall back to the raw quantity.
    const costQuantity = conversionFailed ? null : (conversion?.quantity ?? quantity);
    const unitCostCents = row.item.avgCostCents;
    const lineCostCents =
      unitCostCents !== null && costQuantity !== null
        ? roundCents(unitCostCents * costQuantity * wasteMultiplier)
        : null;
    const via = (conversion?.via ?? 'none') as RecipeCostLineTrace['conversionMethod'];
    const trace: RecipeCostLineTrace = {
      costUnitLabel: stockCostUnit,
      costSource: 'Average stock cost',
      convertedQuantity: costQuantity,
      conversionMethod: conversionFailed ? 'unknown' : via,
      conversionLabel:
        costQuantity !== null && quantity !== null
          ? stockConversionLabel(quantity, row.unit, costQuantity, stockCostUnit, via)
          : null,
      wasteMultiplier
    };
    return {
      lineId: row.id,
      ingredientName: row.ingredientName,
      quantity,
      unit: row.unit ?? stockCostUnit,
      wastePercent: row.wastePercent,
      source: lineCostCents === null ? 'MISSING' : 'STOCK_ITEM',
      unitCostCents,
      lineCostCents,
      warnings,
      trace
    };
  }

  if (row.subRecipeId) {
    if (!row.subRecipe) {
      return {
        lineId: row.id,
        ingredientName: row.ingredientName,
        quantity,
        unit: row.unit,
        wastePercent: row.wastePercent,
        source: 'MISSING',
        unitCostCents: null,
        lineCostCents: null,
        warnings: ['Linked prep recipe could not be found']
      };
    }
    const batchCostCents = dollarsToCents(row.subRecipe.estimatedCost);
    const yieldQuantity = row.subRecipe.yieldQuantity;
    if (batchCostCents === null || batchCostCents <= 0) warnings.push('Prep recipe batch cost is missing');
    if (!yieldQuantity || yieldQuantity <= 0) warnings.push('Prep recipe yield quantity is missing');
    if (quantity === null) warnings.push('Ingredient quantity is missing');

    // Express the line quantity in the prep recipe's yield unit, so a per-yield
    // cost applies correctly even when units differ (e.g. 200 mL used from a
    // recipe that yields in L — previously mis-costed by 1000×).
    let subCostQuantity: number | null = quantity;
    if (quantity !== null) {
      const converted = convertBetweenUnits(quantity, row.unit, row.subRecipe.yieldUnit);
      if (converted === null) {
        // Don't cost off the raw quantity when the unit can't convert — that
        // mis-costs by up to 1000× (e.g. mL against an L yield).
        warnings.push(`Can't convert “${row.unit}” to the prep recipe's yield unit (“${row.subRecipe.yieldUnit}”). Enter this line in ${row.subRecipe.yieldUnit} or a compatible metric unit. This line is not counted in the cost until then.`);
        subCostQuantity = null;
      } else {
        subCostQuantity = converted;
      }
    }

    const unitCostCents =
      batchCostCents !== null && yieldQuantity && yieldQuantity > 0
        ? batchCostCents / yieldQuantity
        : null;
    const lineCostCents =
      unitCostCents !== null && subCostQuantity !== null
        ? roundCents(unitCostCents * subCostQuantity * wasteMultiplier)
        : null;
    const yieldUnit = row.subRecipe.yieldUnit;
    const batchDollars = centsToDollars(batchCostCents);
    const prepCostSource =
      batchDollars !== null && yieldQuantity && yieldQuantity > 0
        ? `Prep batch $${batchDollars.toFixed(2)} ÷ ${tidyQty(yieldQuantity)} ${yieldUnit ?? ''}`.trim()
        : 'Prep batch ÷ yield';
    const trace: RecipeCostLineTrace = {
      costUnitLabel: yieldUnit,
      costSource: prepCostSource,
      convertedQuantity: subCostQuantity,
      conversionMethod: 'prep-yield',
      conversionLabel:
        subCostQuantity !== null && quantity !== null && yieldUnit && row.unit && row.unit !== yieldUnit
          ? `${tidyQty(quantity)} ${row.unit} → ${tidyQty(subCostQuantity)} ${yieldUnit}`
          : null,
      wasteMultiplier
    };
    return {
      lineId: row.id,
      ingredientName: row.ingredientName,
      quantity,
      unit: row.unit ?? row.subRecipe.yieldUnit,
      wastePercent: row.wastePercent,
      source: lineCostCents === null ? 'MISSING' : 'PREP_RECIPE',
      unitCostCents: unitCostCents === null ? null : roundCents(unitCostCents),
      lineCostCents,
      warnings,
      trace
    };
  }

  const manualCostCents = dollarsToCents(row.cost);
  if (manualCostCents === null) warnings.push('No linked stock item, prep recipe, or manual line cost');
  return {
    lineId: row.id,
    ingredientName: row.ingredientName,
    quantity,
    unit: row.unit,
    wastePercent: row.wastePercent,
    source: manualCostCents === null ? 'MISSING' : 'MANUAL',
    unitCostCents: null,
    lineCostCents: manualCostCents,
    warnings,
    trace: manualCostCents === null
      ? undefined
      : {
          costUnitLabel: row.unit,
          costSource: 'Manual line cost',
          convertedQuantity: null,
          conversionMethod: 'none',
          conversionLabel: null,
          wasteMultiplier: 1
        }
  };
}

function calculateRecipeCost(row: RecipeWithLinesRow): RecipeCostPayload {
  const lines = row.lines
    .slice()
    .sort((a, b) => a.position - b.position)
    .map(costForLine);
  const warnings = lines.flatMap((line) =>
    line.warnings.map((warning) => `${line.ingredientName}: ${warning}`)
  );
  const missingCostCount = lines.filter((line) => line.lineCostCents === null).length;
  const manualBatchCostCents = dollarsToCents(row.estimatedCost);
  const batchCostCents =
    lines.length === 0 && manualBatchCostCents !== null && manualBatchCostCents > 0
      ? manualBatchCostCents
      : missingCostCount > 0
      ? null
      : lines.reduce((total, line) => total + (line.lineCostCents ?? 0), 0);
  const portions =
    row.portionSize && row.portionSize > 0 && row.yieldQuantity && row.yieldQuantity > 0
      ? row.yieldQuantity / row.portionSize
      : row.yieldQuantity && row.yieldQuantity > 0
        ? row.yieldQuantity
        : null;
  if (!row.yieldQuantity || row.yieldQuantity <= 0) warnings.push('Recipe yield quantity is missing');
  if (lines.length === 0 && (!manualBatchCostCents || manualBatchCostCents <= 0)) {
    warnings.push('Add ingredient lines or a manual batch cost before using this recipe for COGS');
  }
  if (!row.isPrepRecipe && row.salePriceCents === null) warnings.push('Sale price is missing');
  const costPerPortionCents =
    batchCostCents !== null && portions && portions > 0
      ? roundCents(batchCostCents / portions)
      : batchCostCents;
  const grossProfitCents =
    row.salePriceCents !== null && costPerPortionCents !== null
      ? row.salePriceCents - costPerPortionCents
      : null;
  const foodCostPercent =
    row.salePriceCents !== null && row.salePriceCents > 0 && costPerPortionCents !== null
      ? Math.round((costPerPortionCents / row.salePriceCents) * 1000) / 10
      : null;

  return {
    recipeId: row.id,
    batchCostCents,
    costPerPortionCents,
    salePriceCents: row.salePriceCents,
    grossProfitCents,
    foodCostPercent,
    yieldQuantity: row.yieldQuantity,
    yieldUnit: row.yieldUnit,
    portionSize: row.portionSize,
    portionUnit: row.portionUnit,
    missingCostCount,
    warnings,
    lines
  };
}

async function findRecipeWithLines(id: string) {
  const row = await prisma.recipe.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          item: { select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true } },
          subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
        }
      },
      venuePrices: { select: { venue: true, salePriceCents: true } }
    }
  });
  if (!row) throw new HttpError(404, 'Recipe not found');
  return row;
}

async function refreshRecipeEstimatedCost(id: string) {
  const row = await findRecipeWithLines(id);
  const cost = calculateRecipeCost(row);
  if (cost.batchCostCents === null) return row;
  return prisma.recipe.update({
    where: { id },
    data: { estimatedCost: centsToDollars(cost.batchCostCents) ?? 0 },
    include: {
      lines: {
        include: {
          item: { select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true } },
          subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
        }
      },
      venuePrices: { select: { venue: true, salePriceCents: true } }
    }
  });
}

// Recompute stored estimatedCost for every recipe affected by a change to the
// given stock items' costs — directly (a recipe that uses the item) and then
// up the prep-recipe chain (recipes that use those recipes as ingredients), so
// nested costs stay current. Called after supplier-bill costs are applied, so
// recipe costs and theoretical COGS never go stale. Idempotent + best-effort.
export async function recomputeRecipeCostsForItems(itemIds: string[]): Promise<{ recipesRefreshed: number }> {
  const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
  if (uniqueItemIds.length === 0) return { recipesRefreshed: 0 };

  const directLines = await prisma.recipeLine.findMany({
    where: { itemId: { in: uniqueItemIds } },
    select: { recipeId: true },
    distinct: ['recipeId']
  });

  const seen = new Set<string>();
  let frontier = directLines.map((line) => line.recipeId);
  let depth = 0;
  // Cap the cascade depth as a guard against a (mis-configured) prep-recipe cycle.
  while (frontier.length > 0 && depth < 8) {
    const next = new Set<string>();
    for (const recipeId of frontier) {
      if (seen.has(recipeId)) continue;
      seen.add(recipeId);
      await refreshRecipeEstimatedCost(recipeId).catch(() => undefined);
      const dependents = await prisma.recipeLine.findMany({
        where: { subRecipeId: recipeId },
        select: { recipeId: true },
        distinct: ['recipeId']
      });
      dependents.forEach((dependent) => next.add(dependent.recipeId));
    }
    frontier = [...next].filter((id) => !seen.has(id));
    depth += 1;
  }

  return { recipesRefreshed: seen.size };
}

async function recipeCountMapByCategory() {
  const rows = await prisma.recipe.groupBy({
    by: ['category'],
    _count: { _all: true }
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.category) counts.set(row.category, row._count._all);
  }
  return counts;
}

async function syncRecipeCategoriesFromRecipes() {
  const recipes = await prisma.recipe.findMany({
    where: { category: { not: null } },
    select: { category: true, kind: true, subcategory: true }
  });
  const existing = await prisma.recipeCategory.findMany({ select: { name: true } });
  const existingNames = new Set(existing.map((category) => category.name));
  const recipeCategoryNames = Array.from(
    new Set(recipes.map((recipe) => recipe.category).filter((name): name is string => Boolean(name)))
  );

  const missing = recipeCategoryNames.filter((name) => !existingNames.has(name));
  if (missing.length === 0) return;

  await prisma.$transaction(
    missing.map((name) =>
      prisma.recipeCategory.create({
        data: {
          name,
          kind: inferRecipeCategoryKind(name, recipes)
        }
      })
    )
  );
}

async function recipeDependsOnRecipe(startRecipeId: string, targetRecipeId: string) {
  const seen = new Set<string>();
  const queue = [startRecipeId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    const links = await prisma.recipeLine.findMany({
      where: { recipeId: current, subRecipeId: { not: null } },
      select: { subRecipeId: true }
    });

    for (const link of links) {
      if (!link.subRecipeId) continue;
      if (link.subRecipeId === targetRecipeId) return true;
      if (!seen.has(link.subRecipeId)) queue.push(link.subRecipeId);
    }
  }

  return false;
}

async function validateRecipeLineLinks(
  recipeId: string | null,
  lines: Array<{ subRecipeId?: string | null }>
) {
  const subRecipeIds = Array.from(
    new Set(
      lines
        .map((line) => normaliseOptionalText(line.subRecipeId ?? undefined))
        .filter(isPresentString)
    )
  );
  if (subRecipeIds.length === 0) return;

  if (recipeId && subRecipeIds.includes(recipeId)) {
    throw new HttpError(400, 'A recipe cannot use itself as a production recipe ingredient');
  }

  const found = await prisma.recipe.findMany({
    where: { id: { in: subRecipeIds } },
    select: { id: true }
  });
  const foundIds = new Set(found.map((row) => row.id));
  const missing = subRecipeIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) throw new HttpError(400, 'One or more production recipes could not be found');

  if (!recipeId) return;

  for (const subRecipeId of subRecipeIds) {
    if (await recipeDependsOnRecipe(subRecipeId, recipeId)) {
      throw new HttpError(400, 'That production recipe would create a circular recipe chain');
    }
  }
}

async function listRecipeCategories(syncFromRecipes: boolean) {
  if (syncFromRecipes) await syncRecipeCategoriesFromRecipes();

  const [rows, counts] = await Promise.all([
    prisma.recipeCategory.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
    recipeCountMapByCategory()
  ]);

  return rows.map((row) => toRecipeCategoryPayload(row, counts.get(row.name) ?? 0));
}

const VOLUME_UNIT_TOKENS = ['ml', 'cl', 'dl', 'l', 'litre', 'litres', 'liter', 'liters', 'millilitre', 'milliliter'];
const MASS_UNIT_TOKENS = ['mg', 'g', 'kg', 'gram', 'grams', 'kilogram', 'kilograms', 'kilo'];
function unitKindOf(unit: string | null | undefined): 'volume' | 'mass' | 'count' {
  const u = (unit ?? '').trim().toLowerCase();
  if (VOLUME_UNIT_TOKENS.includes(u)) return 'volume';
  if (MASS_UNIT_TOKENS.includes(u)) return 'mass';
  return 'count';
}
// What kind of portion unit a parent item yields: a measure-per-unit bridge or a
// metric cost unit means weight/volume; otherwise it's counted (each).
function stockItemUnitKind(item: { unit: string; countUnit: string | null; measureUnit: string | null; measurePerCountUnit: number | null }): 'volume' | 'mass' | 'count' {
  if (item.measurePerCountUnit && item.measurePerCountUnit > 0 && item.measureUnit) {
    const kind = unitKindOf(item.measureUnit);
    if (kind !== 'count') return kind;
  }
  return unitKindOf(item.countUnit ?? item.unit);
}

export const recipesService = {
  // Full recipe-book CSV export — every recipe with its type, category, venue,
  // portion/yield, sale price, estimated cost, line count and ingredient list.
  async exportCsv(): Promise<{ filename: string; csv: string }> {
    const recipes = await prisma.recipe.findMany({
      include: {
        _count: { select: { lines: true } },
        lines: {
          select: {
            quantity: true,
            unit: true,
            item: { select: { name: true } },
            subRecipe: { select: { title: true } }
          }
        }
      },
      orderBy: [{ category: 'asc' }, { title: 'asc' }]
    });

    const csvCell = (value: unknown): string => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const headers = [
      'recipe', 'kind', 'category', 'subcategory', 'venue', 'is_prep', 'status',
      'portion_size', 'portion_unit', 'yield_qty', 'yield_unit',
      'sale_price_cents', 'estimated_cost', 'line_count', 'ingredients'
    ];
    const rows = recipes.map((r) => [
      r.title,
      r.kind ?? '',
      r.category ?? '',
      r.subcategory ?? '',
      r.venue ?? '',
      r.isPrepRecipe ? 'yes' : 'no',
      r.status,
      r.portionSize ?? '',
      r.portionUnit ?? '',
      r.yieldQuantity ?? '',
      r.yieldUnit ?? '',
      r.salePriceCents ?? '',
      r.estimatedCost ?? '',
      r._count.lines,
      r.lines
        .map((l) => `${l.quantity ?? ''}${l.unit ? ' ' + l.unit : ''} ${l.item?.name ?? l.subRecipe?.title ?? ''}`.trim())
        .filter(Boolean)
        .join('; ')
    ]);

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    return { filename: 'alma-recipes.csv', csv };
  },

  // Cost of Goods summary for the stock dashboard.
  // Theoretical COGS = Σ (recipe cost × units sold) from Square sales.
  // Actual COGS     = Σ supplier purchases (invoice totals) in the window.
  async costOfGoods(options?: { venue?: string | null; days?: number }): Promise<StockCostOfGoodsPayload> {
    const lookbackDays = Math.min(Math.max(Math.floor(options?.days ?? 30), 1), 365);
    const venue = options?.venue?.trim() || null;
    const venueKey = venue ? venue.toLowerCase() : null;

    const { recipes } = await this.list({ withSalesLookbackDays: lookbackDays });
    const scoped = venueKey
      ? recipes.filter((recipe) => !recipe.venue || recipe.venue.toLowerCase() === venueKey)
      : recipes;

    let theoreticalCogsCents = 0;
    let netSalesCents = 0;
    let mappedRecipes = 0;
    let unmappedRecipes = 0;
    let marginSum = 0;
    let marginCount = 0;
    for (const recipe of scoped) {
      const sales = recipe.actualSales;
      const qty = sales?.quantitySold ?? 0;
      const costCents = Math.round((recipe.estimatedCost ?? 0) * 100);
      if (sales && qty > 0) {
        mappedRecipes += 1;
        theoreticalCogsCents += costCents * qty;
        netSalesCents += sales.netSalesCents;
        if (recipe.salePriceCents && recipe.salePriceCents > 0) {
          marginSum += ((recipe.salePriceCents - costCents) / recipe.salePriceCents) * 100;
          marginCount += 1;
        }
      } else {
        unmappedRecipes += 1;
      }
    }

    // Actual COGS comes from the suite-wide canonical helper (ex-GST, finalised
    // stock purchases, stocktake-bounded with a purchases-only fallback) so this
    // dashboard agrees with the Reports Prime Cost and Monthly Recap for the same
    // period instead of using its own formula.
    const windowEnd = new Date();
    const since = new Date(windowEnd);
    since.setDate(since.getDate() - lookbackDays);
    const actualCogs = await computeActualCogs({ venue: venue ?? null, start: since, end: windowEnd });
    const actualCogsCents = actualCogs.cogsCents;

    const varianceCents = actualCogsCents - theoreticalCogsCents;
    const variancePercent =
      theoreticalCogsCents > 0 ? (varianceCents / theoreticalCogsCents) * 100 : null;
    const cogsPercentOfSales = netSalesCents > 0 ? (theoreticalCogsCents / netSalesCents) * 100 : null;

    // Supplier price movement: per item, compare earliest vs latest unit cost
    // across invoice lines in the window.
    const priceLines = await prisma.supplierInvoiceLine.findMany({
      where: {
        itemId: { not: null },
        unitAmountCents: { gt: 0 },
        invoice: {
          invoiceDate: { gte: since },
          triageStatus: { not: 'NO_ITEM' },
          ...(venue ? { venue } : {})
        }
      },
      select: { itemId: true, unitAmountCents: true, invoice: { select: { invoiceDate: true } } },
      orderBy: { invoice: { invoiceDate: 'asc' } }
    });
    const firstLast = new Map<string, { first: number; last: number }>();
    for (const line of priceLines) {
      if (!line.itemId) continue;
      const existing = firstLast.get(line.itemId);
      if (existing) existing.last = line.unitAmountCents;
      else firstLast.set(line.itemId, { first: line.unitAmountCents, last: line.unitAmountCents });
    }
    let increasedItems = 0;
    let decreasedItems = 0;
    for (const { first, last } of firstLast.values()) {
      if (last > first) increasedItems += 1;
      else if (last < first) decreasedItems += 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      venue,
      lookbackDays,
      theoreticalCogsCents,
      actualCogsCents,
      actualMethod: 'supplier_purchases',
      varianceCents,
      variancePercent,
      netSalesCents,
      cogsPercentOfSales,
      dishMargin: {
        mappedRecipes,
        unmappedRecipes,
        avgMarginPercent: marginCount > 0 ? marginSum / marginCount : null
      },
      priceMovement: { increasedItems, decreasedItems }
    };
  },

  async list(options?: { withSalesLookbackDays?: number | null }): Promise<RecipesPayload> {
    const lookbackDays = options?.withSalesLookbackDays && options.withSalesLookbackDays > 0
      ? Math.min(Math.floor(options.withSalesLookbackDays), 365)
      : null;

    const [recipes, recipeCategories] = await Promise.all([
      prisma.recipe.findMany({
        include: {
          _count: { select: { lines: true } },
          venuePrices: { select: { venue: true, salePriceCents: true } }
        },
        orderBy: [{ category: 'asc' }, { title: 'asc' }]
      }),
      listRecipeCategories(false)
    ]);
    const categories = Array.from(
      new Set([
        ...recipeCategories.map((category) => category.name),
        ...recipes.map((r) => r.category).filter((c): c is string => Boolean(c))
      ])
    ).sort((a, b) => a.localeCompare(b));

    // Join actual Square sales when the caller asks for them. Aggregates
    // SalesItemActualEntry rows over the lookback window by recipeId.
    // Mappings live in SquareMenuRecipeMapping — we surface whether a
    // recipe has at least one CONFIRMED mapping so the UI can flag
    // "no Square data because no mapping yet" vs "mapped but zero sales".
    let salesByRecipeId: Map<string, RecipeActualSales> = new Map();
    if (lookbackDays !== null) {
      const toDate = new Date();
      toDate.setUTCHours(23, 59, 59, 999);
      const fromDate = new Date(toDate);
      // Inclusive on both ends — subtract lookbackDays-1 so withSales=7
      // covers exactly 7 daily serviceDate buckets, not 8.
      fromDate.setUTCDate(fromDate.getUTCDate() - (lookbackDays - 1));
      fromDate.setUTCHours(0, 0, 0, 0);

      const [salesAgg, mappedRecipeRows] = await Promise.all([
        prisma.salesItemActualEntry.groupBy({
          by: ['recipeId'],
          where: {
            recipeId: { not: null },
            serviceDate: { gte: fromDate, lte: toDate }
          },
          _sum: {
            quantity: true,
            netSalesCents: true,
            grossSalesCents: true,
            orderCount: true,
            lineCount: true
          }
        }),
        prisma.squareMenuRecipeMapping.findMany({
          where: { almaRecipeId: { not: null }, status: { in: ['CONFIRMED', 'MAPPED'] } },
          select: { almaRecipeId: true },
          distinct: ['almaRecipeId']
        })
      ]);

      const mappedIds = new Set(mappedRecipeRows.map((row) => row.almaRecipeId!).filter(Boolean));
      const fromIso = fromDate.toISOString().slice(0, 10);
      const toIso = toDate.toISOString().slice(0, 10);
      for (const row of salesAgg) {
        if (!row.recipeId) continue;
        salesByRecipeId.set(row.recipeId, {
          lookbackDays,
          fromDate: fromIso,
          toDate: toIso,
          quantitySold: row._sum.quantity ?? 0,
          netSalesCents: row._sum.netSalesCents ?? 0,
          grossSalesCents: row._sum.grossSalesCents ?? 0,
          orderCount: row._sum.orderCount ?? 0,
          lineCount: row._sum.lineCount ?? 0,
          hasMapping: mappedIds.has(row.recipeId)
        });
      }
      // Recipes with mappings but zero sales: still surface the mapping
      // so the UI doesn't say "unmapped" when it's just a slow seller.
      for (const id of mappedIds) {
        if (!salesByRecipeId.has(id)) {
          salesByRecipeId.set(id, {
            lookbackDays,
            fromDate: fromIso,
            toDate: toIso,
            quantitySold: 0,
            netSalesCents: 0,
            grossSalesCents: 0,
            orderCount: 0,
            lineCount: 0,
            hasMapping: true
          });
        }
      }
      // Recipes with no Square mapping AND no sales: surface them with
      // hasMapping=false so the UI shows "Not mapped to Square" instead
      // of "—" (which is indistinguishable from a sales gap).
      for (const recipe of recipes) {
        if (!salesByRecipeId.has(recipe.id)) {
          salesByRecipeId.set(recipe.id, {
            lookbackDays,
            fromDate: fromIso,
            toDate: toIso,
            quantitySold: 0,
            netSalesCents: 0,
            grossSalesCents: 0,
            orderCount: 0,
            lineCount: 0,
            hasMapping: false
          });
        }
      }
    }

    const recipesPayload = recipes.map((row) => {
      const base = toRecipePayload(row);
      return lookbackDays !== null
        ? { ...base, actualSales: salesByRecipeId.get(row.id) ?? null }
        : base;
    });

    return {
      recipes: recipesPayload,
      categories,
      recipeCategories
    };
  },

  async listCategories(): Promise<RecipeCategory[]> {
    return listRecipeCategories(true);
  },

  async createCategory(input: unknown): Promise<RecipeCategory> {
    const data = recipeCategoryCreateInputSchema.parse(input);
    const name = data.name.trim();
    const existing = await prisma.recipeCategory.findUnique({ where: { name } });
    if (existing) throw new HttpError(409, 'A recipe category with that name already exists');

    const row = await prisma.recipeCategory.create({
      data: {
        name,
        kind: data.kind,
        description: normaliseOptionalText(data.description) ?? null
      }
    });
    const counts = await recipeCountMapByCategory();
    return toRecipeCategoryPayload(row, counts.get(row.name) ?? 0);
  },

  async updateCategory(id: string, input: unknown): Promise<RecipeCategory> {
    const data = recipeCategoryUpdateInputSchema.parse(input);
    const existing = await prisma.recipeCategory.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Recipe category not found');

    const name = data.name !== undefined ? data.name.trim() : undefined;
    if (name && name !== existing.name) {
      const conflict = await prisma.recipeCategory.findUnique({ where: { name } });
      if (conflict) throw new HttpError(409, 'A recipe category with that name already exists');
    }

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.recipeCategory.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(data.kind !== undefined && { kind: data.kind }),
          ...(data.description !== undefined && {
            description: normaliseOptionalText(data.description) ?? null
          })
        }
      });

      if (name && name !== existing.name) {
        await tx.recipe.updateMany({
          where: { category: existing.name },
          data: { category: name }
        });
      }

      return updated;
    });

    const counts = await recipeCountMapByCategory();
    return toRecipeCategoryPayload(row, counts.get(row.name) ?? 0);
  },

  async summary(): Promise<RecipesSummary> {
    const [totalRecipes, totalLines, costAgg, byCategory, activeRecipes, archivedRecipes, prepRecipes, missingCostRecipes] = await Promise.all([
      prisma.recipe.count(),
      prisma.recipeLine.count(),
      prisma.recipe.aggregate({ _avg: { estimatedCost: true } }),
      prisma.recipe.groupBy({
        by: ['category'],
        _count: { _all: true },
        orderBy: { _count: { category: 'desc' } }
      }),
      prisma.recipe.count({ where: { status: 'ACTIVE' } }),
      prisma.recipe.count({ where: { status: 'ARCHIVED' } }),
      prisma.recipe.count({ where: { isPrepRecipe: true } }),
      prisma.recipe.count({ where: { estimatedCost: { lte: 0 } } })
    ]);

    const categoryCounts = byCategory
      .filter((row): row is typeof row & { category: string } =>
        Boolean(row.category)
      )
      .map((row) => ({ category: row.category, count: row._count._all }));

    return {
      totalRecipes,
      totalLines,
      averageEstimatedCost: costAgg._avg.estimatedCost ?? 0,
      activeRecipes,
      archivedRecipes,
      prepRecipes,
      itemRecipes: Math.max(totalRecipes - prepRecipes, 0),
      missingCostRecipes,
      categoryCounts
    };
  },

  async get(id: string): Promise<RecipeWithLines> {
    const row = await findRecipeWithLines(id);
    return toRecipeWithLinesPayload(row);
  },

  async cost(id: string): Promise<RecipeCostPayload> {
    const row = await findRecipeWithLines(id);
    return calculateRecipeCost(row);
  },

  // Cost an UNSAVED recipe draft so the builder can show cost + per-line warnings
  // live as the user types, without saving. Resolves linked items/prep-recipes
  // from the ids in the draft, then runs the same costing as the saved endpoint.
  async costPreview(input: unknown): Promise<RecipeCostPayload> {
    const body = (input ?? {}) as Record<string, unknown>;
    const rawLines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
    const num = (value: unknown): number | null => {
      const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : null;
      return parsed !== null && Number.isFinite(parsed) ? parsed : null;
    };
    const str = (value: unknown): string => (typeof value === 'string' ? value : '');
    const optId = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

    const itemIds = [...new Set(rawLines.map((line) => optId(line.itemId)).filter((id): id is string => Boolean(id)))];
    const subRecipeIds = [...new Set(rawLines.map((line) => optId(line.subRecipeId)).filter((id): id is string => Boolean(id)))];

    const [items, subRecipes] = await Promise.all([
      itemIds.length
        ? prisma.stockItem.findMany({
            where: { id: { in: itemIds } },
            select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true }
          })
        : Promise.resolve([]),
      subRecipeIds.length
        ? prisma.recipe.findMany({
            where: { id: { in: subRecipeIds } },
            select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true }
          })
        : Promise.resolve([])
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const subMap = new Map(subRecipes.map((recipe) => [recipe.id, recipe]));

    const lines = rawLines.map((line, index) => {
      const itemId = optId(line.itemId);
      const subRecipeId = optId(line.subRecipeId);
      return {
        id: `preview-${index}`,
        position: index,
        ingredientName: str(line.ingredientName) || `Line ${index + 1}`,
        quantity: num(line.quantity),
        unit: str(line.unit) || null,
        wastePercent: num(line.wastePercent) ?? 0,
        cost: num(line.cost),
        itemId,
        subRecipeId,
        item: itemId ? itemMap.get(itemId) ?? null : null,
        subRecipe: subRecipeId ? subMap.get(subRecipeId) ?? null : null
      };
    });

    const pseudoRow = {
      id: 'preview',
      yieldQuantity: num(body.yieldQuantity),
      yieldUnit: str(body.yieldUnit) || null,
      portionSize: num(body.portionSize),
      portionUnit: str(body.portionUnit) || null,
      salePriceCents: num(body.salePriceCents),
      isPrepRecipe: Boolean(body.isPrepRecipe),
      estimatedCost: num(body.estimatedCost),
      lines,
      venuePrices: []
    } as unknown as RecipeWithLinesRow;

    return calculateRecipeCost(pseudoRow);
  },

  // The parent → child "serves" tree: child recipes that draw a portion from this
  // parent (a stock item bottle/keg/case, or a bulk production recipe), each
  // costed from the parent so you see cost + margin per serve.
  async portionTree(parentType: PortionParentType, parentId: string): Promise<PortionTreePayload> {
    let parentLabel = '';
    let parentUnitKind: 'volume' | 'mass' | 'count' = 'count';
    if (parentType === 'item') {
      const item = await prisma.stockItem.findUnique({
        where: { id: parentId },
        select: { name: true, unit: true, countUnit: true, measureUnit: true, measurePerCountUnit: true }
      });
      if (!item) throw new HttpError(404, 'Stock item not found');
      parentLabel = item.name;
      parentUnitKind = stockItemUnitKind(item);
    } else {
      const recipe = await prisma.recipe.findUnique({ where: { id: parentId }, select: { title: true, yieldUnit: true } });
      if (!recipe) throw new HttpError(404, 'Recipe not found');
      parentLabel = recipe.title;
      parentUnitKind = unitKindOf(recipe.yieldUnit);
    }

    const rows = await prisma.recipe.findMany({
      where: parentType === 'recipe' ? { lines: { some: { subRecipeId: parentId } } } : { lines: { some: { itemId: parentId } } },
      include: {
        lines: {
          include: {
            item: { select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true } },
            subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
          }
        },
        venuePrices: { select: { venue: true, salePriceCents: true } },
        squareMenuMappings: { where: { status: { in: ['MAPPED', 'CONFIRMED'] } }, select: { id: true } }
      },
      orderBy: { title: 'asc' }
    });

    const children: PortionChild[] = rows.map((row) => {
      const cost = calculateRecipeCost(row as unknown as RecipeWithLinesRow);
      const portionLine = row.lines.find((line) => (parentType === 'recipe' ? line.subRecipeId === parentId : line.itemId === parentId));
      const portionLabel = portionLine && portionLine.quantity != null
        ? `${portionLine.quantity} ${portionLine.unit ?? ''}`.trim()
        : null;
      return {
        recipeId: row.id,
        title: row.title,
        portionLabel,
        salePriceCents: row.salePriceCents,
        costPerPortionCents: cost.costPerPortionCents,
        foodCostPercent: cost.foodCostPercent,
        grossProfitCents: cost.grossProfitCents,
        squareMapped: row.squareMenuMappings.length > 0,
        warnings: cost.warnings
      };
    });

    return { parentType, parentId, parentLabel, parentUnitKind, children };
  },

  // Create one sellable child recipe per portion, each a single line drawing the
  // portion from the parent. Costs auto-derive; a Square sold-item match is
  // attached for review (same as a normal recipe create). Returns the new tree.
  async createPortions(input: unknown): Promise<PortionTreePayload> {
    const data = recipePortionsCreateInputSchema.parse(input);
    let parentName = '';
    if (data.parentType === 'item') {
      const item = await prisma.stockItem.findUnique({ where: { id: data.parentId }, select: { name: true } });
      if (!item) throw new HttpError(404, 'Stock item not found');
      parentName = item.name;
    } else {
      const recipe = await prisma.recipe.findUnique({ where: { id: data.parentId }, select: { title: true } });
      if (!recipe) throw new HttpError(404, 'Recipe not found');
      parentName = recipe.title;
    }

    for (const portion of data.portions) {
      const created = await prisma.recipe.create({
        data: {
          title: portion.name.trim(),
          isPrepRecipe: false,
          status: 'ACTIVE',
          estimatedCost: 0,
          salePriceCents: portion.salePriceCents ?? null,
          portionSize: 1,
          portionUnit: 'serve',
          yieldQuantity: 1,
          yieldUnit: 'serve',
          lines: {
            create: [{
              position: 1,
              ingredientName: parentName,
              quantity: portion.quantity,
              unit: portion.unit,
              wastePercent: portion.wastePercent ?? 0,
              itemId: data.parentType === 'item' ? data.parentId : null,
              subRecipeId: data.parentType === 'recipe' ? data.parentId : null
            }]
          }
        }
      });
      await refreshRecipeEstimatedCost(created.id).catch(() => undefined);
      await attachMatchesForReview(created.id, created.title).catch(() => undefined);
    }

    return recipesService.portionTree(data.parentType, data.parentId);
  },

  async ingredientOptions(): Promise<{ options: RecipeIngredientOption[] }> {
    const [items, prepRecipes] = await Promise.all([
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, unit: true, countUnit: true, avgCostCents: true, category: { select: { name: true } } },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }]
      }),
      prisma.recipe.findMany({
        where: { status: 'ACTIVE', isPrepRecipe: true },
        select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, category: true },
        orderBy: [{ category: 'asc' }, { title: 'asc' }]
      })
    ]);

    return {
      options: [
        ...items.map((item) => ({
          id: item.id,
          type: 'STOCK_ITEM' as const,
          label: item.name,
          description: item.category?.name ?? null,
          unit: item.countUnit ?? item.unit,
          unitCostCents: item.avgCostCents,
          missingCost: item.avgCostCents === null
        })),
        ...prepRecipes.map((recipe) => {
          const batchCostCents = dollarsToCents(recipe.estimatedCost);
          const unitCostCents =
            batchCostCents !== null && recipe.yieldQuantity && recipe.yieldQuantity > 0
              ? roundCents(batchCostCents / recipe.yieldQuantity)
              : null;
          return {
            id: recipe.id,
            type: 'PREP_RECIPE' as const,
            label: recipe.title,
            description: recipe.category,
            unit: recipe.yieldUnit,
            unitCostCents,
            missingCost: unitCostCents === null
          };
        })
      ]
    };
  },

  async createRecipe(input: unknown): Promise<RecipeWithLines> {
    const data = recipeCreateInputSchema.parse(input);
    await validateRecipeLineLinks(null, data.lines ?? []);
    const row = await prisma.recipe.create({
      data: {
        title: data.title.trim(),
        kind: normaliseOptionalText(data.kind) ?? null,
        category: normaliseOptionalText(data.category) ?? null,
        subcategory: normaliseOptionalText(data.subcategory) ?? null,
        venue: normaliseOptionalText(data.venue) ?? null,
        salePriceCents: data.salePriceCents ?? null,
        portionSize: data.portionSize ?? null,
        portionUnit: normaliseOptionalText(data.portionUnit) ?? null,
        yieldQuantity: data.yieldQuantity ?? null,
        yieldUnit: normaliseOptionalText(data.yieldUnit) ?? null,
        isPrepRecipe: inferPrepRecipeFlag(data),
        status: data.status ?? 'ACTIVE',
        estimatedCost: data.estimatedCost ?? 0,
        notes: normaliseOptionalText(data.notes) ?? null,
        // Rule 3: recipes without explicit per-line wastage default to 2%.
        // The applyDefaultWastage helper records whether each line was
        // defaulted so we can surface it in the UI.
        lines: data.lines
          ? {
              create: data.lines.map((line, index) => ({
                position: index + 1,
                ingredientName: line.ingredientName.trim(),
                quantity: line.quantity ?? null,
                unit: normaliseOptionalText(line.unit) ?? null,
                cost: line.cost ?? null,
                wastePercent: applyDefaultWastage({ wastePercent: line.wastePercent }).wastePercent,
                itemId: normaliseOptionalText(line.itemId) ?? null,
                subRecipeId: normaliseOptionalText(line.subRecipeId) ?? null
              }))
            }
          : undefined,
        // Per-venue sale price overrides are independent rows; they do not
        // change the default Recipe.salePriceCents.
        venuePrices:
          data.venuePrices && data.venuePrices.length
            ? {
                create: data.venuePrices
                  .filter((vp) => vp.venue.trim() !== '' && vp.salePriceCents >= 0)
                  .map((vp) => ({ venue: vp.venue.trim(), salePriceCents: vp.salePriceCents }))
              }
            : undefined
      },
      include: {
        lines: {
          include: {
            item: { select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true } },
            subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
          }
        },
        venuePrices: { select: { venue: true, salePriceCents: true } }
      }
    });
    const refreshed = await refreshRecipeEstimatedCost(row.id);
    // Rule 4: auto-attach Square menu items / stock items that share this
    // recipe's title for manual review. Best-effort — failures don't
    // block recipe creation.
    try {
      await attachMatchesForReview(row.id, row.title);
    } catch (err) {
      console.warn('[stock-rules] attachMatchesForReview failed', err);
    }
    return toRecipeWithLinesPayload(refreshed);
  },

  async updateRecipe(id: string, input: unknown): Promise<RecipeWithLines> {
    const data = recipeUpdateInputSchema.parse(input);
    const existing = await prisma.recipe.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Recipe not found');
    if (data.lines !== undefined) await validateRecipeLineLinks(id, data.lines);

    // If lines are provided, treat it as a full replacement: delete the old
    // lines and create the new set. This keeps the API simple — partial line
    // edits live in a follow-up if/when the UI needs them.
    if (data.lines !== undefined) {
      await prisma.recipeLine.deleteMany({ where: { recipeId: id } });
    }

    // Per-venue price overrides use the same replace-all semantics as lines.
    // A provided (possibly empty) array clears the old overrides and writes the
    // new set; these rows are independent of the default Recipe.salePriceCents.
    if (data.venuePrices !== undefined) {
      await prisma.recipeVenuePrice.deleteMany({ where: { recipeId: id } });
    }

    const row = await prisma.recipe.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.kind !== undefined && { kind: normaliseOptionalText(data.kind) }),
        ...(data.category !== undefined && {
          category: normaliseOptionalText(data.category)
        }),
        ...(data.subcategory !== undefined && {
          subcategory: normaliseOptionalText(data.subcategory)
        }),
        ...(data.venue !== undefined && { venue: normaliseOptionalText(data.venue) }),
        ...(data.salePriceCents !== undefined && {
          salePriceCents: data.salePriceCents ?? null
        }),
        ...(data.portionSize !== undefined && {
          portionSize: data.portionSize ?? null
        }),
        ...(data.portionUnit !== undefined && {
          portionUnit: normaliseOptionalText(data.portionUnit)
        }),
        ...(data.yieldQuantity !== undefined && {
          yieldQuantity: data.yieldQuantity
        }),
        ...(data.yieldUnit !== undefined && {
          yieldUnit: normaliseOptionalText(data.yieldUnit)
        }),
        ...((data.isPrepRecipe !== undefined ||
          data.category !== undefined ||
          data.subcategory !== undefined ||
          data.notes !== undefined) && {
          isPrepRecipe: inferPrepRecipeFlag({
            isPrepRecipe: data.isPrepRecipe,
            category:
              data.category !== undefined
                ? normaliseOptionalText(data.category)
                : existing.category,
            subcategory:
              data.subcategory !== undefined
                ? normaliseOptionalText(data.subcategory)
                : existing.subcategory,
            notes: data.notes !== undefined ? normaliseOptionalText(data.notes) : existing.notes
          })
        }),
        ...(data.status !== undefined && {
          status: data.status
        }),
        ...(data.estimatedCost !== undefined && {
          estimatedCost: data.estimatedCost
        }),
        ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) }),
        ...(data.lines !== undefined && {
          lines: {
            create: data.lines.map((line, index) => ({
              position: index + 1,
              ingredientName: line.ingredientName.trim(),
              quantity: line.quantity ?? null,
              unit: normaliseOptionalText(line.unit) ?? null,
              cost: line.cost ?? null,
              wastePercent: line.wastePercent ?? null,
              itemId: normaliseOptionalText(line.itemId) ?? null,
              subRecipeId: normaliseOptionalText(line.subRecipeId) ?? null
            }))
          }
        }),
        ...(data.venuePrices !== undefined && {
          venuePrices: {
            create: data.venuePrices
              .filter((vp) => vp.venue.trim() !== '' && vp.salePriceCents >= 0)
              .map((vp) => ({ venue: vp.venue.trim(), salePriceCents: vp.salePriceCents }))
          }
        })
      },
      include: {
        lines: {
          include: {
            item: { select: { id: true, name: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true, avgCostCents: true } },
            subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
          }
        },
        venuePrices: { select: { venue: true, salePriceCents: true } }
      }
    });
    return toRecipeWithLinesPayload(await refreshRecipeEstimatedCost(row.id));
  },

  async deleteRecipes(input: unknown): Promise<{ deleted: number }> {
    const { ids } = recipeBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const result = await prisma.recipe.deleteMany({
      where: { id: { in: uniqueIds } }
    });
    return { deleted: result.count };
  }
};
