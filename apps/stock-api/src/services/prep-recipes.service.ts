// Loading prep recipes so a count of a made item can be turned back into
// ingredients. The arithmetic is in lib/prep-explosion.ts; this is the reading.
import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type { StocktakePrepRecipeOption } from '@alma/shared';
import { prepCountReadiness, type PrepRecipeSpec, type PrepStockItem } from '../lib/prep-explosion.js';

// Recipe lines nest (birria contains birria adobo), so the recipes needed to
// explode a count are not known until the first level is read. Walk the tree
// breadth-first; the explosion itself caps depth and guards cycles, this only
// has to stop fetching.
const PREP_FETCH_ROUNDS = 6;

export const prepRecipeSelect = {
  id: true,
  title: true,
  yieldQuantity: true,
  yieldUnit: true,
  lines: {
    select: {
      ingredientName: true,
      quantity: true,
      unit: true,
      itemId: true,
      subRecipeId: true,
      costingOnly: true
    },
    orderBy: { position: 'asc' }
  }
} satisfies Prisma.RecipeSelect;

/** The given recipes plus every sub-recipe reachable from them. */
export async function loadPrepRecipes(
  client: Prisma.TransactionClient,
  rootRecipeIds: string[]
): Promise<Map<string, PrepRecipeSpec>> {
  const specs = new Map<string, PrepRecipeSpec>();
  let wanted = [...new Set(rootRecipeIds.filter(Boolean))];
  for (let round = 0; round < PREP_FETCH_ROUNDS && wanted.length > 0; round += 1) {
    const rows = await client.recipe.findMany({ where: { id: { in: wanted } }, select: prepRecipeSelect });
    for (const row of rows) specs.set(row.id, row);
    wanted = [
      ...new Set(
        rows.flatMap((row) =>
          row.lines
            .map((line) => line.subRecipeId)
            .filter((id): id is string => id !== null && !specs.has(id))
        )
      )
    ];
  }
  return specs;
}

/** Every stock item referenced by the given recipes, costed. */
export async function loadPrepItems(
  client: Prisma.TransactionClient,
  specs: Map<string, PrepRecipeSpec>
): Promise<Map<string, PrepStockItem>> {
  const ids = [
    ...new Set(
      [...specs.values()].flatMap((spec) =>
        spec.lines.map((line) => line.itemId).filter((id): id is string => Boolean(id))
      )
    )
  ];
  if (!ids.length) return new Map();
  const rows = await client.stockItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      unit: true,
      countUnit: true,
      conversionFactor: true,
      measurePerCountUnit: true,
      measureUnit: true,
      avgCostCents: true
    }
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * Every active prep recipe offered as a countable made item, each carrying
 * whether it can actually be exploded and what stops it.
 *
 * An un-countable recipe is still returned. Hiding it is how a feature comes
 * to look like it works: the mole simply never appears on the count sheet and
 * nobody can say why. Named with its reason, it is a five-second fix on the
 * recipe.
 */
export async function listPrepRecipeOptions(
  recipeIds?: string[]
): Promise<StocktakePrepRecipeOption[]> {
  const rows = await prisma.recipe.findMany({
    where: recipeIds ? { id: { in: recipeIds } } : { status: 'ACTIVE', isPrepRecipe: true },
    select: { ...prepRecipeSelect, category: true },
    orderBy: [{ category: 'asc' }, { title: 'asc' }]
  });
  if (!rows.length) return [];

  // Sub-recipes below the listed ones are needed to judge readiness, but are
  // not themselves offered.
  const specs = await loadPrepRecipes(prisma, rows.map((row) => row.id));
  const items = await loadPrepItems(prisma, specs);

  const order = recipeIds ? new Map(recipeIds.map((id, index) => [id, index] as const)) : null;
  const options = rows.map((row) => {
    const readiness = prepCountReadiness(specs.get(row.id) ?? row, specs, items);
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      yieldQuantity: row.yieldQuantity,
      yieldUnit: row.yieldUnit,
      countable: readiness.countable,
      problems: readiness.problems
    };
  });
  // When an explicit list was asked for, keep the caller's order — a count
  // sheet lists its prep in the order the manager arranged it.
  return order
    ? options.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    : options;
}
