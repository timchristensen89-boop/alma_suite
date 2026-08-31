// Counting what the kitchen has already made.
//
// A venue's stock is not all on a shelf in the form it was bought. On the day
// of the first count under this app the chef finished the sheet and then wrote
// twenty-two things out by hand at the bottom, because there was nowhere to put
// them:
//
//     Chipotle mayo      11.707 kg
//     Bean purée          8.884 kg
//     Mole for broccolini 7.414 kg
//     …
//
// Every one of those is stock. The mayonnaise, the beans and the chillies in
// them were bought, are unsold, and are sitting in the production fridge — but
// to the count sheet they had ceased to exist the moment they were cooked,
// because the only countable thing in the system was a StockItem on a shelf.
// The variance report then reads the whole production fridge as shrinkage,
// every count, forever.
//
// This module is the arithmetic that fixes it: given a counted quantity of a
// made item, work out which raw stock items are bound up in it and how much of
// each. The caller adds those quantities to the same items' counted lines.
//
// Three rules run through all of it:
//
//  1. REFUSE TO GUESS. Mirrors the same rule in stocktake valuation and recipe
//     costing. A prep recipe with no yield, or counted in a unit that cannot be
//     converted to its yield unit, explodes to NOTHING and says why. Guessing
//     here would book invented kilograms of raw material into stock on hand.
//
//  2. NET, NOT GROSS. Wastage percentages are deliberately not applied. A 2%
//     trim allowance is material that went in the bin during production; it is
//     not in the tub, so it is not on hand. Costing inflates by waste because
//     you must BUY the trim; a stocktake must not, because you cannot COUNT it.
//     Erring this way understates on-hand, which is the safe direction — the
//     opposite invents stock and hides real shrinkage.
//
//  3. NOTHING IS BOOKED AGAINST A RECIPE. Recipes are not stock and hold no
//     on-hand balance. A prep line's only effect on the ledger is through the
//     raw items it explodes into.

import {
  convertBetweenUnits,
  convertQuantityToCostUnit,
  isMeasureUnit,
  type CostUnitItem,
  type StocktakePrepApplySummary,
  type StocktakePrepContribution,
  type StocktakePrepLineSummary
} from '@alma/shared';

/** One ingredient line of a prep recipe, as far as the explosion cares. */
export type PrepRecipeLine = {
  ingredientName: string;
  quantity: number | null;
  unit: string | null;
  /** Set for a raw stock item. */
  itemId: string | null;
  /** Set when this line is itself a prep recipe (birria adobo inside birria). */
  subRecipeId: string | null;
  /** Costed, never plated — a drinks allowance on a set menu. Never physical. */
  costingOnly?: boolean;
};

export type PrepRecipeSpec = {
  id: string;
  title: string;
  /** How much ONE batch makes, in `yieldUnit`. */
  yieldQuantity: number | null;
  yieldUnit: string | null;
  lines: PrepRecipeLine[];
};

/** A stock item, as far as the explosion cares. */
export type PrepStockItem = CostUnitItem & {
  id: string;
  name: string;
  /** Cents per count unit. Null when the item has never been costed. */
  avgCostCents: number | null;
};

export type PrepComponent = {
  itemId: string;
  itemName: string;
  /** Quantity in the item's own count/cost unit — ready to add to its count. */
  quantity: number;
  unit: string;
  /** Null when the item carries no average cost. */
  valueCents: number | null;
  /** The prep recipe this came through, for "…via Beef Birria Adobo". */
  viaRecipeTitle: string;
};

export type PrepExplosion = {
  recipeId: string;
  recipeTitle: string;
  /** How many batches the counted quantity represents. Null when unresolvable. */
  batches: number | null;
  components: PrepComponent[];
  /**
   * Total value of the raw material in the counted prep, in cents. Null when
   * ANY component is missing a cost — a partial total reads as a real number
   * and silently understates the stocktake.
   */
  valueCents: number | null;
  /** Everything that could not be resolved, in plain words. Never thrown. */
  warnings: string[];
};

/** How deep sub-recipes may nest before we stop. Real prep is 1–2 deep. */
const MAX_DEPTH = 5;

function roundQuantity(value: number): number {
  // Six places: enough that 950 g of a 30 kg batch survives, short of the
  // float noise that makes two identical counts differ in the last digit.
  return Math.round(value * 1e6) / 1e6;
}

function countUnitOf(item: PrepStockItem): string {
  return item.countUnit ?? item.unit;
}

/**
 * Batches of `recipe` represented by `countedQty` of it.
 *
 * Returns null (with a reason) rather than a number whenever the answer would
 * be a guess: no yield to divide by, or a counted unit that does not convert to
 * the yield unit. "6 kg of birria" against a recipe that yields "12 portions"
 * is not 0.5 batches and is not 6 batches — it is unanswerable, and saying so
 * is the only safe response.
 */
export function batchesForCount(
  countedQty: number,
  countedUnit: string | null | undefined,
  recipe: Pick<PrepRecipeSpec, 'title' | 'yieldQuantity' | 'yieldUnit'>
): { batches: number | null; warning: string | null } {
  if (!Number.isFinite(countedQty)) {
    return { batches: null, warning: `${recipe.title}: the counted quantity is not a number.` };
  }
  if (countedQty === 0) return { batches: 0, warning: null };
  if (!recipe.yieldQuantity || recipe.yieldQuantity <= 0) {
    return {
      batches: null,
      warning: `${recipe.title} has no batch yield, so a count of it cannot be turned into ingredients. Set "makes" on the recipe.`
    };
  }
  const inYieldUnit = convertBetweenUnits(countedQty, countedUnit ?? null, recipe.yieldUnit ?? null);
  if (inYieldUnit === null) {
    return {
      batches: null,
      warning: `${recipe.title} was counted in ${countedUnit} but the recipe makes ${recipe.yieldUnit}. Count it in ${recipe.yieldUnit}, or set the recipe's yield unit to ${countedUnit}.`
    };
  }
  return { batches: inYieldUnit / recipe.yieldQuantity, warning: null };
}

type WalkArgs = {
  recipe: PrepRecipeSpec;
  /** Batches of THIS recipe represented by the count. */
  batches: number;
  recipesById: Map<string, PrepRecipeSpec>;
  itemsById: Map<string, PrepStockItem>;
  /** Recipe ids already open on this branch — a cycle guard, not a visited set. */
  chain: string[];
  depth: number;
  out: Map<string, PrepComponent>;
  warnings: string[];
};

function addComponent(out: Map<string, PrepComponent>, next: PrepComponent) {
  const existing = out.get(next.itemId);
  if (!existing) {
    out.set(next.itemId, next);
    return;
  }
  // The same raw item can arrive down two branches (chilli in the adobo AND in
  // the finished birria). One line per item, quantities summed.
  existing.quantity = roundQuantity(existing.quantity + next.quantity);
  existing.valueCents =
    existing.valueCents === null || next.valueCents === null
      ? null
      : existing.valueCents + next.valueCents;
  if (!existing.viaRecipeTitle.includes(next.viaRecipeTitle)) {
    existing.viaRecipeTitle = `${existing.viaRecipeTitle}, ${next.viaRecipeTitle}`;
  }
}

function walk(args: WalkArgs): void {
  const { recipe, batches, recipesById, itemsById, chain, depth, out, warnings } = args;

  if (depth > MAX_DEPTH) {
    warnings.push(`${recipe.title}: sub-recipes nest more than ${MAX_DEPTH} deep — stopped there.`);
    return;
  }

  for (const line of recipe.lines) {
    if (line.costingOnly) continue;
    const quantity = line.quantity ?? 0;

    if (line.itemId) {
      const item = itemsById.get(line.itemId);
      if (!item) {
        warnings.push(`${recipe.title}: "${line.ingredientName}" is linked to a stock item that no longer exists.`);
        continue;
      }
      if (quantity <= 0) continue;
      const conv = convertQuantityToCostUnit(quantity, line.unit, item);
      if (conv.via === 'unknown') {
        // Same refusal as stocktake valuation: a line we cannot convert is
        // dropped and named, never multiplied through in the wrong unit.
        warnings.push(
          `${recipe.title}: "${item.name}" is used in ${line.unit} but counted in ${countUnitOf(item)}, and the two do not convert. It is not included.`
        );
        continue;
      }
      const componentQty = roundQuantity(batches * conv.quantity);
      if (componentQty <= 0) continue;
      addComponent(out, {
        itemId: item.id,
        itemName: item.name,
        quantity: componentQty,
        unit: countUnitOf(item),
        valueCents: item.avgCostCents === null ? null : Math.round(item.avgCostCents * componentQty),
        viaRecipeTitle: recipe.title
      });
      continue;
    }

    if (line.subRecipeId) {
      if (chain.includes(line.subRecipeId)) {
        warnings.push(`${recipe.title}: "${line.ingredientName}" refers back to a recipe already in the chain — stopped to avoid a loop.`);
        continue;
      }
      const sub = recipesById.get(line.subRecipeId);
      if (!sub) {
        warnings.push(`${recipe.title}: the sub-recipe behind "${line.ingredientName}" could not be loaded.`);
        continue;
      }
      if (quantity <= 0) continue;
      // How many batches of the SUB recipe this line consumes: the line's
      // quantity, expressed in the sub-recipe's yield unit, over its yield.
      const subBatches = batchesForCount(quantity, line.unit, sub);
      if (subBatches.batches === null) {
        if (subBatches.warning) warnings.push(subBatches.warning);
        continue;
      }
      walk({
        recipe: sub,
        batches: batches * subBatches.batches,
        recipesById,
        itemsById,
        chain: [...chain, line.subRecipeId],
        depth: depth + 1,
        out,
        warnings
      });
      continue;
    }

    // A free-text ingredient. Real and physical, but nothing to book it
    // against, so it is named rather than silently dropped.
    if (quantity > 0) {
      warnings.push(`${recipe.title}: "${line.ingredientName}" is not linked to a stock item, so it is not counted back into stock.`);
    }
  }
}

/**
 * Explode a counted quantity of a prepped item into the raw stock items it
 * holds.
 *
 * The result is additive: each component's quantity is already in that item's
 * own count unit and is meant to be ADDED to whatever was counted loose on the
 * shelf. It never replaces a count.
 */
export function explodePrepCount(args: {
  countedQty: number;
  countedUnit: string | null | undefined;
  recipe: PrepRecipeSpec;
  recipesById: Map<string, PrepRecipeSpec>;
  itemsById: Map<string, PrepStockItem>;
}): PrepExplosion {
  const { countedQty, countedUnit, recipe, recipesById, itemsById } = args;
  const warnings: string[] = [];
  const { batches, warning } = batchesForCount(countedQty, countedUnit, recipe);
  if (warning) warnings.push(warning);
  if (batches === null) {
    return { recipeId: recipe.id, recipeTitle: recipe.title, batches: null, components: [], valueCents: null, warnings };
  }

  const out = new Map<string, PrepComponent>();
  walk({
    recipe,
    batches,
    recipesById,
    itemsById,
    chain: [recipe.id],
    depth: 0,
    out,
    warnings
  });

  const components = [...out.values()].sort((a, b) => a.itemName.localeCompare(b.itemName));
  // A total that silently skips the uncosted components is worse than no total:
  // it reads as the value of the tub and understates the count.
  const anyMissingCost = components.some((component) => component.valueCents === null);
  const valueCents = anyMissingCost
    ? null
    : components.reduce((sum, component) => sum + (component.valueCents ?? 0), 0);
  if (anyMissingCost) {
    const names = components.filter((c) => c.valueCents === null).map((c) => c.itemName);
    warnings.push(`${recipe.title} cannot be valued: no average cost for ${names.join(', ')}.`);
  }

  return { recipeId: recipe.id, recipeTitle: recipe.title, batches, components, valueCents, warnings };
}

/**
 * What stops a prep recipe being countable — and, separately, what merely
 * costs it accuracy.
 *
 * The distinction is the whole value of this function, and the first version
 * got it wrong. It treated an ingredient that is not linked to a stock item as
 * a blocker, and against the real catalogue that made every single prep recipe
 * un-countable: the recipe import left a junk line in each one, named things
 * like "(1 portions)" and "(500 portions)" — a yield note that became an
 * ingredient row. Recipes with a good yield and a full set of linked
 * ingredients were reported as unusable because of a line that is not food.
 *
 * So the bar is what the count will actually DO:
 *
 *   BLOCKER  — a count of it books nothing at all. No yield to divide by, no
 *              ingredient lines, or one batch that explodes into zero
 *              components. There is nothing to gain by offering it.
 *   WARNING  — a count of it books less than everything. An unlinked
 *              ingredient, a unit that will not convert, a sub-recipe that
 *              would not load. Booking most of a tub beats booking none of
 *              it, and the direction of the error is the safe one: stock is
 *              understated, never invented.
 */
export function prepCountReadiness(
  recipe: PrepRecipeSpec,
  recipesById: Map<string, PrepRecipeSpec>,
  itemsById: Map<string, PrepStockItem>
): {
  recipeId: string;
  title: string;
  countable: boolean;
  unit: string | null;
  problems: string[];
  warnings: string[];
} {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!recipe.yieldQuantity || recipe.yieldQuantity <= 0) {
    problems.push('No batch yield — set how much one batch makes.');
  }
  if (!recipe.yieldUnit || !recipe.yieldUnit.trim()) {
    problems.push('No yield unit — set kg, L, each or portion.');
  }
  const physical = recipe.lines.filter((line) => !line.costingOnly);
  if (physical.length === 0) {
    problems.push('No ingredient lines — a count of it explodes into nothing.');
  }

  // A kitchen weighs what it has made. Every one of the twenty-two items the
  // chef wrote out by hand was a weight — 11.707 kg, 468 g — so a recipe that
  // yields "60 portions" cannot be counted off a scale: batchesForCount will
  // refuse the conversion and the line books nothing.
  //
  // The dry run below cannot see this, because it counts one batch in the
  // recipe's OWN unit, where the conversion always succeeds. It has to be
  // checked separately or the recipe reads as ready and then quietly does
  // nothing the first time someone weighs it.
  if (recipe.yieldUnit && recipe.yieldUnit.trim() && !isMeasureUnit(recipe.yieldUnit)) {
    warnings.push(
      `Yields ${recipe.yieldUnit}, so it can only be counted in ${recipe.yieldUnit} — weighing it will book nothing. Give it a weight or volume yield if the kitchen weighs it.`
    );
  }

  const unlinked = physical.filter((line) => !line.itemId && !line.subRecipeId && (line.quantity ?? 0) > 0);
  if (unlinked.length > 0) {
    warnings.push(
      `${unlinked.length} ingredient${unlinked.length === 1 ? '' : 's'} not linked to a stock item, so ${
        unlinked.length === 1 ? 'it is' : 'they are'
      } not counted back into stock (${unlinked
        .slice(0, 3)
        .map((line) => line.ingredientName)
        .join(', ')}${unlinked.length > 3 ? '…' : ''}).`
    );
  }

  // Dry-run one batch: catches unit mismatches and broken sub-recipe links that
  // the field checks above cannot see.
  if (recipe.yieldQuantity && recipe.yieldQuantity > 0) {
    const dryRun = explodePrepCount({
      countedQty: recipe.yieldQuantity,
      countedUnit: recipe.yieldUnit,
      recipe,
      recipesById,
      itemsById
    });
    for (const warning of dryRun.warnings) {
      // Valuation is a bonus: an uncosted ingredient still books the right
      // QUANTITY, which is the point of counting it.
      if (warning.includes('cannot be valued')) continue;
      const stripped = warning.startsWith(`${recipe.title}: `) ? warning.slice(recipe.title.length + 2) : warning;
      if (!warnings.includes(stripped)) warnings.push(stripped);
    }
    if (dryRun.components.length === 0 && problems.length === 0) {
      problems.push('One batch explodes into nothing — no ingredient on it is linked to a stock item.');
    }
  }

  return {
    recipeId: recipe.id,
    title: recipe.title,
    countable: problems.length === 0,
    unit: recipe.yieldUnit,
    problems,
    warnings
  };
}

/* ------------------------------------------------------------------ merge */

/** A stocktake line, as far as the merge cares. */
export type PrepSummaryLine = {
  id: string;
  label: string;
  itemId: string | null;
  recipeId: string | null;
  countedQty: number | null;
  unit: string | null;
};

/**
 * Fold a count's prepped-item lines together with its item lines.
 *
 * `explosions[i]` corresponds to `lines[i]` and is null for anything that is
 * not a counted prep line.
 *
 * The split between `contributions` and `notOnSheet` is the safety rule of the
 * whole feature, and the reason this is a pure function with tests rather than
 * three lines inside a transaction. A prep line says how much mayonnaise is
 * inside a tub. It says NOTHING about how much is loose on the shelf. So if
 * mayonnaise has no counted line, booking the tub's share as its on-hand would
 * record every loose jar as shrinkage — a bigger error than the one this
 * feature exists to fix. Those items are left completely alone and named
 * instead.
 */
export function summarisePrepLines(
  lines: PrepSummaryLine[],
  explosions: Array<PrepExplosion | null>
): StocktakePrepApplySummary {
  const lineSummaries: StocktakePrepLineSummary[] = [];
  const warnings: string[] = [];
  const byItem = new Map<string, StocktakePrepContribution>();

  lines.forEach((line, index) => {
    const recipeId = line.recipeId;
    if (!recipeId) return;
    const explosion = explosions[index] ?? null;
    lineSummaries.push({
      lineId: line.id,
      recipeId,
      label: line.label,
      countedQty: line.countedQty,
      unit: line.unit,
      batches: explosion?.batches ?? null,
      valueCents: explosion?.valueCents ?? null,
      componentCount: explosion?.components.length ?? 0,
      warnings: explosion?.warnings ?? []
    });
    for (const warning of explosion?.warnings ?? []) {
      if (!warnings.includes(warning)) warnings.push(warning);
    }
    for (const component of explosion?.components ?? []) {
      const existing = byItem.get(component.itemId);
      if (existing) {
        existing.quantity = roundQuantity(existing.quantity + component.quantity);
        existing.valueCents =
          existing.valueCents === null || component.valueCents === null
            ? null
            : existing.valueCents + component.valueCents;
        if (!existing.fromPrep.includes(line.label)) existing.fromPrep.push(line.label);
      } else {
        byItem.set(component.itemId, {
          itemId: component.itemId,
          itemName: component.itemName,
          unit: component.unit,
          quantity: component.quantity,
          valueCents: component.valueCents,
          fromPrep: [line.label],
          countedOnSheet: null,
          totalToBook: null
        });
      }
    }
  });

  // What each of those items was counted loose. Summed, because a sheet may
  // legitimately count one item in two locations.
  const countedByItem = new Map<string, number>();
  for (const line of lines) {
    if (!line.itemId || line.countedQty === null) continue;
    countedByItem.set(line.itemId, (countedByItem.get(line.itemId) ?? 0) + line.countedQty);
  }

  const contributions: StocktakePrepContribution[] = [];
  const notOnSheet: StocktakePrepContribution[] = [];
  for (const contribution of [...byItem.values()].sort((a, b) => a.itemName.localeCompare(b.itemName))) {
    const counted = countedByItem.get(contribution.itemId);
    if (counted === undefined) {
      notOnSheet.push(contribution);
      continue;
    }
    contribution.countedOnSheet = counted;
    contribution.totalToBook = roundQuantity(counted + contribution.quantity);
    contributions.push(contribution);
  }

  for (const orphan of notOnSheet) {
    warnings.push(
      `${orphan.itemName} is held inside ${orphan.fromPrep.join(', ')} (${orphan.quantity} ${orphan.unit}) but is not counted on this sheet, so its stock is left untouched. Add it to the count sheet to include it.`
    );
  }

  // One unvalued line makes the total unvalued: a part-total reads as the
  // value of the prep and quietly understates the count.
  const anyUnvalued = lineSummaries.some((line) => line.valueCents === null);
  const totalValueCents = anyUnvalued
    ? null
    : lineSummaries.reduce((sum, line) => sum + (line.valueCents ?? 0), 0);

  return { lines: lineSummaries, contributions, notOnSheet, totalValueCents, warnings };
}
