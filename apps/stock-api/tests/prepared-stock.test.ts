import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '@alma/db';
import { compareCountCategories, isPreparedStockCategory, type AuthUser } from '@alma/shared';
import { stocktakesService } from '../src/services/stocktakes.service.js';
import { itemsService } from '../src/services/items.service.js';
import { listPrepRecipeOptions, listPrepRecipesForLinking } from '../src/services/prep-recipes.service.js';

/**
 * Batch Cocktails and Kitchen Prep: a prepared product is a stock item in its
 * own section, counted in litres or kilos (or whole containers), valued at its
 * cost per litre/kilo, optionally linked to the prep recipe it is made from —
 * and never counted a second time through that recipe's ingredients.
 */
const NO_DB = { skip: !process.env.DATABASE_URL };

const MANAGER = {
  id: 'test-manager', firstName: 'Test', lastName: 'Manager', email: 'm@example.com', roleTitle: 'Venue Manager',
  venue: 'St Alma', accountType: 'HUMAN', isAdmin: false, trainingOnly: false, role: 'MANAGER', appAccess: []
} as unknown as AuthUser;

test('the two sections exist as their own count sections, after every bought category', () => {
  assert.ok(isPreparedStockCategory('Batch Cocktails'));
  assert.ok(isPreparedStockCategory('kitchen prep'));
  assert.ok(!isPreparedStockCategory('Spirits — Tequila & Mezcal'));
  for (const bought of ['Spirits — Tequila & Mezcal', 'Non-Alcoholic & Mixers', 'Produce', 'Other']) {
    assert.ok(compareCountCategories(bought, 'Batch Cocktails') < 0, `${bought} before Batch Cocktails`);
  }
  assert.ok(compareCountCategories('Batch Cocktails', 'Kitchen Prep') < 0);
});

async function fixture(tag: string) {
  const batchSection = await prisma.stockCategory.findUniqueOrThrow({ where: { name: 'Batch Cocktails' } });
  const tequila = await prisma.stockItem.create({ data: { name: `Tequila ${tag}`, unit: 'bottle', countUnit: 'bottle', conversionFactor: 1, measurePerCountUnit: 700, measureUnit: 'ml', avgCostCents: 4900, onHand: 0, parLevel: 0, status: 'ACTIVE', venueStock: { create: [{ venue: 'St Alma', onHand: 10, active: true }] } } });
  const lime = await prisma.stockItem.create({ data: { name: `Lime juice ${tag}`, unit: 'L', countUnit: 'L', conversionFactor: 1, avgCostCents: 760, onHand: 0, parLevel: 0, status: 'ACTIVE', venueStock: { create: [{ venue: 'St Alma', onHand: 4, active: true }] } } });
  // 700 mL tequila ($49.00) + 300 mL lime ($2.28) makes 1 L: $51.28 per litre.
  const recipe = await prisma.recipe.create({
    data: {
      title: `Margarita Batch ${tag}`, venue: 'St Alma', isPrepRecipe: true, status: 'ACTIVE', yieldQuantity: 1000, yieldUnit: 'ml',
      lines: { create: [
        { ingredientName: tequila.name, quantity: 700, unit: 'ml', itemId: tequila.id, position: 1 },
        { ingredientName: lime.name, quantity: 300, unit: 'ml', itemId: lime.id, position: 2 },
        { ingredientName: '(10 portions)', quantity: 1, unit: 'l', position: 3 },
        // The import split some names over two lines; the fragment has no amount.
        { ingredientName: 'Blanco', quantity: null, unit: 'bottle', itemId: tequila.id, position: 4 }
      ] }
    }
  });
  const batch = await itemsService.createItem({
    name: `Margarita Batch ${tag}`, categoryId: batchSection.id, unit: 'container', countUnit: 'L', conversionFactor: 5,
    prepRecipeId: recipe.id, avgCostCents: 1650, parLevel: 0, status: 'ACTIVE'
  }, MANAGER);
  const ids = [tequila.id, lime.id, batch.id];
  async function cleanup(stocktakeIds: string[]) {
    await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
    await prisma.stocktake.deleteMany({ where: { id: { in: stocktakeIds } } });
    await prisma.venueStockItem.deleteMany({ where: { stockItemId: { in: ids } } });
    await prisma.stockItem.deleteMany({ where: { id: { in: ids } } });
    await prisma.recipe.delete({ where: { id: recipe.id } }).catch(() => undefined);
  }
  return { tequila, lime, recipe, batch, cleanup };
}

test('a batch is counted in litres, mL or whole containers, and valued per litre', NO_DB, async () => {
  const tag = `prep-${Date.now()}`;
  const f = await fixture(tag);
  const stocktakeIds: string[] = [];
  try {
    const sheet = await stocktakesService.createStocktake(
      { name: `Bar ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(), lines: [{ itemId: f.batch.id, label: f.batch.name, unit: 'L' }] },
      MANAGER
    );
    stocktakeIds.push(sheet.id);
    const lineId = sheet.lines[0]!.id;
    const save = async (countedQty: number | string, unit: string) => (await stocktakesService.updateLines(sheet.id, { lines: [{ id: lineId, countedQty, unit }] }, MANAGER)).lines[0]!;

    let line = await save(2.5, 'L');
    assert.deepEqual([line.countedQty, line.unit, line.stockValueCents], [2.5, 'L', 4125], '2.5 L recorded as 2.5 L, $16.50 × 2.5');
    line = await save(2500, 'mL');
    assert.deepEqual([line.countedQty, line.unit], [2.5, 'L'], '2500 mL is 2.5 L');
    line = await save(1, 'container');
    assert.deepEqual([line.countedQty, line.unit, line.stockValueCents], [5, 'L', 8250], 'one 5 L container is 5 L');
    line = await save(0.5, 'container');
    assert.deepEqual([line.countedQty, line.unit], [2.5, 'L'], 'half a container is 2.5 L');

    // Applying books 2.5 L of batch and leaves the ingredients exactly as they were.
    await stocktakesService.updateStocktake(sheet.id, { status: 'SUBMITTED' }, MANAGER);
    const applied = await stocktakesService.applyStocktake(sheet.id, MANAGER);
    assert.equal(applied.movements.length, 1);
    assert.equal(applied.prep.contributions.length, 0, 'counting the batch credits no ingredient');
    const holding = await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: f.batch.id, venue: 'St Alma' } });
    assert.equal(holding.onHand, 2.5);
    const tequila = await prisma.venueStockItem.findFirstOrThrow({ where: { stockItemId: f.tequila.id, venue: 'St Alma' } });
    assert.equal(tequila.onHand, 10, 'tequila untouched');
  } finally {
    await f.cleanup(stocktakeIds);
  }
});

test('the linked recipe suggests the cost per litre, ignoring import leftovers', NO_DB, async () => {
  const f = await fixture(`cost-${Date.now()}`);
  try {
    const item = await itemsService.getItem(f.batch.id);
    assert.equal(item.prepRecipeId, f.recipe.id);
    assert.ok(item.prepRecipe);
    assert.equal(item.prepRecipe!.batchCostCents, 5128);
    assert.equal(item.prepRecipe!.costPerCountUnitCents, 5128, '$51.28 for 1 L');
    assert.equal(item.prepRecipe!.note, null, 'the "(10 portions)" leftover and the "Blanco" name fragment are not missing ingredients');
    // Unlinking clears the suggestion; linking a dish (not a prep recipe) is refused.
    const dish = await prisma.recipe.create({ data: { title: `Dish ${f.recipe.id}`, isPrepRecipe: false, status: 'ACTIVE' } });
    await assert.rejects(itemsService.updateItem(f.batch.id, { prepRecipeId: dish.id }), /Only a prep recipe/);
    await prisma.recipe.delete({ where: { id: dish.id } });
    const unlinked = await itemsService.updateItem(f.batch.id, { prepRecipeId: '' });
    assert.equal(unlinked.prepRecipeId, null);
  } finally {
    await f.cleanup([]);
  }
});

test('a batch with its own item cannot also be counted through its recipe', NO_DB, async () => {
  const tag = `guard-${Date.now()}`;
  const f = await fixture(tag);
  const stocktakeIds: string[] = [];
  try {
    // Not offered in the prepped-item picker; still offered for linking (as linked).
    assert.ok(!(await listPrepRecipeOptions()).some((option) => option.id === f.recipe.id));
    const forLinking = (await listPrepRecipesForLinking()).find((option) => option.id === f.recipe.id);
    assert.equal(forLinking?.linkedItem?.id, f.batch.id);

    const sheet = await stocktakesService.createStocktake(
      { name: `Bar ${tag}`, venue: 'St Alma', countedAt: new Date().toISOString(), lines: [{ itemId: f.batch.id, label: f.batch.name, unit: 'L', countedQty: 2 }] },
      MANAGER
    );
    stocktakeIds.push(sheet.id);
    await assert.rejects(stocktakesService.addLine(sheet.id, { recipeId: f.recipe.id }, MANAGER), (error: { statusCode?: number; message: string }) =>
      error.statusCode === 409 && /is counted as "Margarita Batch/.test(error.message));

    // A prep line written straight to the table (an old count, an import) next to the item: apply refuses.
    await prisma.stocktakeLine.create({ data: { stocktakeId: sheet.id, position: 2, label: f.recipe.title, recipeId: f.recipe.id, countedQty: 1, unit: 'L' } });
    await stocktakesService.updateStocktake(sheet.id, { status: 'SUBMITTED' }, MANAGER);
    await assert.rejects(stocktakesService.applyStocktake(sheet.id, MANAGER), (error: { statusCode?: number; message: string }) =>
      error.statusCode === 409 && /counted twice: as stock and as a prepped item/.test(error.message));
  } finally {
    await f.cleanup(stocktakeIds);
  }
});
