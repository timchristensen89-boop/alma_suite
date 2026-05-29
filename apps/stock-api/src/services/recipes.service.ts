import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  recipeBulkDeleteInputSchema,
  recipeCategoryCreateInputSchema,
  recipeCategoryUpdateInputSchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  type Recipe,
  type RecipeActualSales,
  type RecipeCategory,
  type RecipeCategoryKind,
  type RecipeCostLine,
  type RecipeCostPayload,
  type RecipeIngredientOption,
  type RecipeLine,
  type RecipeStatus,
  type RecipeWithLines,
  type RecipesPayload,
  type RecipesSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { applyDefaultWastage, attachMatchesForReview, recipeCostSanity } from './stock-rules.service.js';

type RecipeRow = Prisma.RecipeGetPayload<{
  include: { _count: { select: { lines: true } } };
}>;

type RecipeWithLinesRow = Prisma.RecipeGetPayload<{
  include: {
    lines: {
      include: {
        item: { select: { id: true; name: true; unit: true; avgCostCents: true } };
        subRecipe: { select: { id: true; title: true; yieldQuantity: true; yieldUnit: true; estimatedCost: true; isPrepRecipe: true } };
      };
    };
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
    if (row.unit && row.item.unit && row.unit !== row.item.unit) {
      warnings.push(`Unit ${row.unit} differs from stock item unit ${row.item.unit}; no conversion is applied`);
    }
    const unitCostCents = row.item.avgCostCents;
    const lineCostCents =
      unitCostCents !== null && quantity !== null
        ? roundCents(unitCostCents * quantity * wasteMultiplier)
        : null;
    return {
      lineId: row.id,
      ingredientName: row.ingredientName,
      quantity,
      unit: row.unit ?? row.item.unit,
      wastePercent: row.wastePercent,
      source: lineCostCents === null ? 'MISSING' : 'STOCK_ITEM',
      unitCostCents,
      lineCostCents,
      warnings
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
    if (row.unit && row.subRecipe.yieldUnit && row.unit !== row.subRecipe.yieldUnit) {
      warnings.push(`Unit ${row.unit} differs from prep recipe yield unit ${row.subRecipe.yieldUnit}; no conversion is applied`);
    }
    const unitCostCents =
      batchCostCents !== null && yieldQuantity && yieldQuantity > 0
        ? batchCostCents / yieldQuantity
        : null;
    const lineCostCents =
      unitCostCents !== null && quantity !== null
        ? roundCents(unitCostCents * quantity * wasteMultiplier)
        : null;
    return {
      lineId: row.id,
      ingredientName: row.ingredientName,
      quantity,
      unit: row.unit ?? row.subRecipe.yieldUnit,
      wastePercent: row.wastePercent,
      source: lineCostCents === null ? 'MISSING' : 'PREP_RECIPE',
      unitCostCents: unitCostCents === null ? null : roundCents(unitCostCents),
      lineCostCents,
      warnings
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
    warnings
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
          item: { select: { id: true, name: true, unit: true, avgCostCents: true } },
          subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
        }
      }
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
          item: { select: { id: true, name: true, unit: true, avgCostCents: true } },
          subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
        }
      }
    }
  });
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

export const recipesService = {
  async list(options?: { withSalesLookbackDays?: number | null }): Promise<RecipesPayload> {
    const lookbackDays = options?.withSalesLookbackDays && options.withSalesLookbackDays > 0
      ? Math.min(Math.floor(options.withSalesLookbackDays), 365)
      : null;

    const [recipes, recipeCategories] = await Promise.all([
      prisma.recipe.findMany({
        include: { _count: { select: { lines: true } } },
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

  async ingredientOptions(): Promise<{ options: RecipeIngredientOption[] }> {
    const [items, prepRecipes] = await Promise.all([
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, unit: true, avgCostCents: true, category: { select: { name: true } } },
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
          unit: item.unit,
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
          : undefined
      },
      include: {
        lines: {
          include: {
            item: { select: { id: true, name: true, unit: true, avgCostCents: true } },
            subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
          }
        }
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
        })
      },
      include: {
        lines: {
          include: {
            item: { select: { id: true, name: true, unit: true, avgCostCents: true } },
            subRecipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true, estimatedCost: true, isPrepRecipe: true } }
          }
        }
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
