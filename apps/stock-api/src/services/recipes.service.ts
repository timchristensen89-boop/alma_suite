import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  recipeBulkDeleteInputSchema,
  recipeCategoryCreateInputSchema,
  recipeCategoryUpdateInputSchema,
  recipeCreateInputSchema,
  recipeUpdateInputSchema,
  type Recipe,
  type RecipeCategory,
  type RecipeCategoryKind,
  type RecipeLine,
  type RecipeWithLines,
  type RecipesPayload,
  type RecipesSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type RecipeRow = Prisma.RecipeGetPayload<{
  include: { _count: { select: { lines: true } } };
}>;

type RecipeWithLinesRow = Prisma.RecipeGetPayload<{
  include: {
    lines: {
      include: { item: { select: { id: true; name: true; unit: true } } };
    };
  };
}>;

type RecipeLineRow = RecipeWithLinesRow['lines'][number];

type RecipeCategoryRow = Prisma.RecipeCategoryGetPayload<Record<string, never>>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function normaliseRecipeCategoryKind(value: string): RecipeCategoryKind {
  return value === 'BEVERAGE' || value === 'OTHER' ? value : 'FOOD';
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
    itemId: row.itemId,
    item: row.item ?? null,
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

async function listRecipeCategories(syncFromRecipes: boolean) {
  if (syncFromRecipes) await syncRecipeCategoriesFromRecipes();

  const [rows, counts] = await Promise.all([
    prisma.recipeCategory.findMany({ orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
    recipeCountMapByCategory()
  ]);

  return rows.map((row) => toRecipeCategoryPayload(row, counts.get(row.name) ?? 0));
}

export const recipesService = {
  async list(): Promise<RecipesPayload> {
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
    return {
      recipes: recipes.map(toRecipePayload),
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
    const [totalRecipes, totalLines, costAgg, byCategory] = await Promise.all([
      prisma.recipe.count(),
      prisma.recipeLine.count(),
      prisma.recipe.aggregate({ _avg: { estimatedCost: true } }),
      prisma.recipe.groupBy({
        by: ['category'],
        _count: { _all: true },
        orderBy: { _count: { category: 'desc' } }
      })
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
      categoryCounts
    };
  },

  async get(id: string): Promise<RecipeWithLines> {
    const row = await prisma.recipe.findUnique({
      where: { id },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, unit: true } } }
        }
      }
    });
    if (!row) throw new HttpError(404, 'Recipe not found');
    return toRecipeWithLinesPayload(row);
  },

  async createRecipe(input: unknown): Promise<RecipeWithLines> {
    const data = recipeCreateInputSchema.parse(input);
    const row = await prisma.recipe.create({
      data: {
        title: data.title.trim(),
        kind: normaliseOptionalText(data.kind) ?? null,
        category: normaliseOptionalText(data.category) ?? null,
        subcategory: normaliseOptionalText(data.subcategory) ?? null,
        venue: normaliseOptionalText(data.venue) ?? null,
        estimatedCost: data.estimatedCost ?? 0,
        notes: normaliseOptionalText(data.notes) ?? null,
        lines: data.lines
          ? {
              create: data.lines.map((line, index) => ({
                position: index + 1,
                ingredientName: line.ingredientName.trim(),
                quantity: line.quantity ?? null,
                unit: normaliseOptionalText(line.unit) ?? null,
                cost: line.cost ?? null,
                itemId: normaliseOptionalText(line.itemId) ?? null
              }))
            }
          : undefined
      },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, unit: true } } }
        }
      }
    });
    return toRecipeWithLinesPayload(row);
  },

  async updateRecipe(id: string, input: unknown): Promise<RecipeWithLines> {
    const data = recipeUpdateInputSchema.parse(input);
    const existing = await prisma.recipe.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Recipe not found');

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
              itemId: normaliseOptionalText(line.itemId) ?? null
            }))
          }
        })
      },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, unit: true } } }
        }
      }
    });
    return toRecipeWithLinesPayload(row);
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
