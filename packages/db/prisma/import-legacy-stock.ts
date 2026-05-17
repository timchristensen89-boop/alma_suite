/**
 * Import data from the legacy "alma control" stock export into the new
 * Alma Stock schema.
 *
 * Source file can be either:
 *   - a JSON export produced by extract-legacy-stock.ts, or
 *   - an Alma Control seed.js file containing `window.ALMA_SEED = {...}`.
 *
 * What we import:
 *   - StockCategory: one per distinct legacy product category/department.
 *   - StockItem: one per legacy product, including mapped product, venue,
 *     pack/cost details and aliases in notes.
 *   - Recipe + RecipeLine: recipe headers and ingredient rows linked back to
 *     StockItem where the legacy product id matches.
 *   - Stocktake + StocktakeLine when the source export includes stocktakes.
 *
 * The import is idempotent: re-running with the same file upserts by
 * legacyId rather than duplicating rows. To wipe stock data and start clean,
 * pass --replace.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/prisma.js';

type LegacyExport = {
  extractedAt?: string;
  normalized?: {
    products?: LegacyProduct[];
    stocktakes?: LegacyStocktake[];
    stocktakeLines?: LegacyStocktakeLine[];
    recipes?: LegacyRecipe[];
    recipeLines?: LegacyRecipeLine[];
  };
  products?: ControlSeedProduct[];
  recipes?: ControlSeedRecipe[];
};

type LegacyProduct = {
  id: string;
  name: string;
  active: boolean;
  categoryName: string | null;
  purchaseUnit: string | null;
  baseUnit: string | null;
  currentCost: number | null;
  mappedProduct?: string | null;
  venue?: string | null;
  sourceFile?: string | null;
  packQty?: number | null;
  packUnit?: string | null;
  baseQty?: number | null;
  currentCostPerBaseUnit?: number | null;
  packSize?: string | null;
  aliases?: string[];
  storage?: { locations?: string[]; department?: string | null } | null;
};

type LegacyStocktake = {
  id: string;
  date?: string | null;
  venueId?: string | null;
  venue?: string | null;
  template?: string | null;
  name?: string | null;
  status?: string | null;
};

type LegacyStocktakeLine = {
  id?: string | null;
  stocktakeId: string;
  productId: string | null;
  countedQty: number | null;
  label?: string | null;
  baseUnit?: string | null;
  location?: string | null;
  stockValue?: number | null;
};

type LegacyRecipe = {
  id: string;
  title: string | null;
  kind?: string | null;
  category?: string | null;
  subcategory?: string | null;
  venue?: string | null;
  estimatedCost?: number | null;
};

type LegacyRecipeLine = {
  recipeId: string;
  lineOrder?: number | null;
  name?: string | null;
  qty?: number | null;
  unit?: string | null;
  cost?: number | null;
  productId?: string | null;
};

type ControlSeedProduct = {
  id: string;
  venue?: string | null;
  department?: string | null;
  ingredientName?: string | null;
  mappedProduct?: string | null;
  packQty?: number | null;
  packUnit?: string | null;
  packCost?: number | null;
  baseQty?: number | null;
  baseUnit?: string | null;
  costPerBaseUnit?: number | null;
  sourceFile?: string | null;
  barcode?: string | null;
  location?: string | null;
};

type ControlSeedRecipe = {
  id: string;
  venue?: string | null;
  kind?: string | null;
  title?: string | null;
  category?: string | null;
  subcategory?: string | null;
  estimatedCost?: number | null;
  file?: string | null;
  lines?: Array<{
    name?: string | null;
    qty?: number | null;
    unit?: string | null;
    cost?: number | null;
    productId?: string | null;
    matchedProduct?: string | null;
  }>;
};

type ImportArgs = {
  file: string;
  replace: boolean;
  dryRun: boolean;
};

type ProductGroup = {
  key: string;
  primary: LegacyProduct;
  products: LegacyProduct[];
};

const CATEGORY_LABELS: Record<string, string> = {
  beer: 'Beer',
  dairy: 'Dairy',
  dry_goods: 'Dry Goods',
  meat: 'Meat',
  other: 'Other',
  produce: 'Produce',
  seafood: 'Seafood',
  spirits: 'Spirits',
  wine: 'Wine'
};

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function categoryDisplayName(rawName: string) {
  return CATEGORY_LABELS[rawName.toLowerCase()] ?? titleCase(rawName);
}

function categoryLegacyId(rawName: string) {
  return `legacy-category:${rawName.toLowerCase()}`;
}

function normaliseDedupeText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemDedupeKey(product: LegacyProduct) {
  const name = normaliseDedupeText(product.name);
  const unit = normaliseDedupeText(product.purchaseUnit || product.baseUnit || 'ea');
  return `${name}|${unit}`;
}

function productCompletenessScore(product: LegacyProduct) {
  return [
    product.active,
    product.categoryName,
    product.currentCost,
    product.currentCostPerBaseUnit,
    product.packSize,
    product.baseQty,
    product.storage?.locations?.length,
    product.sourceFile
  ].filter(Boolean).length;
}

function buildProductGroups(products: LegacyProduct[]) {
  const groupsByKey = new Map<string, LegacyProduct[]>();
  for (const product of products) {
    if (!product.id || !product.name) continue;
    const key = itemDedupeKey(product);
    const group = groupsByKey.get(key) ?? [];
    group.push(product);
    groupsByKey.set(key, group);
  }

  return Array.from(groupsByKey.entries())
    .map(([key, group]): ProductGroup => {
      const primary = group
        .slice()
        .sort((a, b) => {
          const scoreDiff = productCompletenessScore(b) - productCompletenessScore(a);
          if (scoreDiff !== 0) return scoreDiff;
          return a.id.localeCompare(b.id, undefined, { numeric: true });
        })[0]!;
      return { key, primary, products: group };
    })
    .sort((a, b) => a.primary.name.localeCompare(b.primary.name));
}

function mergeProductGroup(group: ProductGroup): LegacyProduct {
  const primary = group.primary;
  const aliases = new Set<string>();
  const locations = new Set<string>();
  const venues = new Set<string>();
  const sourceFiles = new Set<string>();

  for (const product of group.products) {
    if (product.name && product.name.trim().toLowerCase() !== primary.name.trim().toLowerCase()) {
      aliases.add(product.name.trim());
    }
    for (const alias of product.aliases ?? []) {
      if (alias.trim().toLowerCase() !== primary.name.trim().toLowerCase()) {
        aliases.add(alias.trim());
      }
    }
    for (const location of product.storage?.locations ?? []) {
      if (location.trim()) locations.add(location.trim());
    }
    if (product.venue?.trim()) venues.add(product.venue.trim());
    if (product.sourceFile?.trim()) sourceFiles.add(product.sourceFile.trim());
  }

  return {
    ...primary,
    active: group.products.some((product) => product.active),
    aliases: Array.from(aliases).sort((a, b) => a.localeCompare(b)),
    venue: venues.size > 0 ? Array.from(venues).sort((a, b) => a.localeCompare(b)).join(', ') : primary.venue,
    sourceFile:
      sourceFiles.size > 0
        ? Array.from(sourceFiles).sort((a, b) => a.localeCompare(b)).join(', ')
        : primary.sourceFile,
    storage: {
      department: primary.storage?.department ?? primary.categoryName,
      locations: Array.from(locations).sort((a, b) => a.localeCompare(b))
    }
  };
}

function sumLatestQtyForGroup(group: ProductGroup, qtyByProduct: Map<string, number>) {
  return group.products.reduce((total, product) => total + (qtyByProduct.get(product.id) ?? 0), 0);
}

async function cleanupStockItemMultiples() {
  const items = await prisma.stockItem.findMany({
    include: { category: { select: { name: true } } },
    orderBy: [{ createdAt: 'asc' }, { name: 'asc' }]
  });
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = [
      normaliseDedupeText(item.name),
      normaliseDedupeText(item.unit),
      normaliseDedupeText(item.category?.name ?? '')
    ].join('|');
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = group
      .slice()
      .sort((a, b) => {
        if (a.legacyId && !b.legacyId) return -1;
        if (!a.legacyId && b.legacyId) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })[0]!;
    const duplicateIds = group.filter((item) => item.id !== keeper.id).map((item) => item.id);
    await prisma.$transaction(async (tx) => {
      await tx.recipeLine.updateMany({
        where: { itemId: { in: duplicateIds } },
        data: { itemId: keeper.id }
      });
      await tx.stocktakeLine.updateMany({
        where: { itemId: { in: duplicateIds } },
        data: { itemId: keeper.id }
      });
      const result = await tx.stockItem.deleteMany({ where: { id: { in: duplicateIds } } });
      removed += result.count;
    });
  }
  return removed;
}

async function cleanupRecipeMultiples() {
  const recipes = await prisma.recipe.findMany({
    include: { _count: { select: { lines: true } } },
    orderBy: [{ createdAt: 'asc' }, { title: 'asc' }]
  });
  const groups = new Map<string, typeof recipes>();
  for (const recipe of recipes) {
    const key = [
      normaliseDedupeText(recipe.title),
      normaliseDedupeText(recipe.venue ?? ''),
      normaliseDedupeText(recipe.kind ?? ''),
      normaliseDedupeText(recipe.category ?? ''),
      normaliseDedupeText(recipe.subcategory ?? '')
    ].join('|');
    const group = groups.get(key) ?? [];
    group.push(recipe);
    groups.set(key, group);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const keeper = group
      .slice()
      .sort((a, b) => {
        const lineDiff = b._count.lines - a._count.lines;
        if (lineDiff !== 0) return lineDiff;
        if (a.legacyId && !b.legacyId) return -1;
        if (!a.legacyId && b.legacyId) return 1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })[0]!;
    const duplicateIds = group.filter((recipe) => recipe.id !== keeper.id).map((recipe) => recipe.id);
    const result = await prisma.recipe.deleteMany({ where: { id: { in: duplicateIds } } });
    removed += result.count;
  }
  return removed;
}

function parseArgs(argv: string[]): ImportArgs {
  const resolveFrom = process.env.INIT_CWD ?? process.cwd();
  let file = path.resolve(resolveFrom, 'tmp/legacy-stock-export.json');
  let replace = false;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--') continue;
    if (current === '--file') {
      const next = argv[index + 1];
      if (!next) throw new Error('Missing value for --file argument.');
      file = path.resolve(resolveFrom, next);
      index += 1;
      continue;
    }
    if (current === '--replace') {
      replace = true;
      continue;
    }
    if (current === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (current === '--help' || current === '-h') {
      console.log(`Usage: pnpm db:import:legacy-stock -- --file tmp/legacy-stock-export.json [--dry-run] [--replace]

Options:
  --file <path>  Legacy stock JSON export or Alma Control seed.js.
  --dry-run      Parse and summarize without writing to the database.
  --replace      Clear existing stock data before import. Ignored in dry-run mode.`);
      process.exit(0);
    }
  }

  return { file, replace, dryRun };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseSourceFile(raw: string, file: string): LegacyExport {
  try {
    return JSON.parse(raw) as LegacyExport;
  } catch {
    const seedMatch = raw.match(/window\.ALMA_SEED\s*=\s*(\{[\s\S]*\});?\s*$/);
    if (!seedMatch) {
      throw new Error(`Could not parse ${file} as JSON or Alma Control seed.js`);
    }
    return Function(`"use strict"; return (${seedMatch[1]});`)() as LegacyExport;
  }
}

function normaliseControlSeed(payload: LegacyExport): Required<NonNullable<LegacyExport['normalized']>> {
  const seedProducts = payload.products ?? [];
  const seedRecipes = payload.recipes ?? [];

  const products: LegacyProduct[] = seedProducts.map((product) => {
    const name = (product.ingredientName || product.mappedProduct || product.id).trim();
    const mappedProduct = product.mappedProduct?.trim() || null;
    const aliases = mappedProduct && mappedProduct.toLowerCase() !== name.toLowerCase()
      ? [mappedProduct]
      : [];
    const packQty = finiteNumber(product.packQty);
    const packUnit = product.packUnit?.trim() || null;
    const packSize = packQty && packUnit ? `${packQty} ${packUnit}` : null;

    return {
      id: product.id,
      name,
      active: true,
      categoryName: product.department?.trim() || 'Other',
      purchaseUnit: packUnit || product.baseUnit?.trim() || null,
      baseUnit: product.baseUnit?.trim() || null,
      currentCost: finiteNumber(product.packCost),
      currentCostPerBaseUnit: finiteNumber(product.costPerBaseUnit),
      mappedProduct,
      venue: product.venue?.trim() || null,
      sourceFile: product.sourceFile?.trim() || null,
      packQty,
      packUnit,
      baseQty: finiteNumber(product.baseQty),
      packSize,
      aliases,
      storage: {
        department: product.department?.trim() || null,
        locations: product.location ? [product.location] : []
      }
    };
  });

  const recipes: LegacyRecipe[] = seedRecipes.map((recipe) => ({
    id: recipe.id,
    title: recipe.title?.trim() || recipe.id,
    kind: recipe.kind?.trim() || null,
    category: recipe.category?.trim() || null,
    subcategory: recipe.subcategory?.trim() || null,
    venue: recipe.venue?.trim() || null,
    estimatedCost: finiteNumber(recipe.estimatedCost)
  }));

  const recipeLines: LegacyRecipeLine[] = seedRecipes.flatMap((recipe) =>
    (recipe.lines ?? []).map((line, index) => ({
      recipeId: recipe.id,
      lineOrder: index + 1,
      name: line.name?.trim() || line.matchedProduct?.trim() || null,
      qty: finiteNumber(line.qty),
      unit: line.unit?.trim() || null,
      cost: finiteNumber(line.cost),
      productId: line.productId?.trim() || null
    }))
  );

  return {
    products,
    stocktakes: [],
    stocktakeLines: [],
    recipes,
    recipeLines
  };
}

function normalisePayload(payload: LegacyExport): Required<NonNullable<LegacyExport['normalized']>> {
  if (payload.normalized) {
    return {
      products: payload.normalized.products ?? [],
      stocktakes: payload.normalized.stocktakes ?? [],
      stocktakeLines: payload.normalized.stocktakeLines ?? [],
      recipes: payload.normalized.recipes ?? [],
      recipeLines: payload.normalized.recipeLines ?? []
    };
  }

  if (payload.products || payload.recipes) {
    return normaliseControlSeed(payload);
  }

  return {
    products: [],
    stocktakes: [],
    stocktakeLines: [],
    recipes: [],
    recipeLines: []
  };
}

/**
 * Build a map of productId → summed countedQty across the latest stocktake
 * per (venueId, template). This widens coverage compared to "latest per
 * venue" because Avalon's bar and kitchen are counted on different cadences.
 */
function buildLatestQtyByProduct(
  stocktakes: LegacyStocktake[],
  lines: LegacyStocktakeLine[]
) {
  const latestByKey = new Map<string, LegacyStocktake>();
  for (const st of stocktakes) {
    if (!st.venueId) continue;
    const key = `${st.venueId}::${st.template ?? 'unknown'}`;
    const current = latestByKey.get(key);
    const a = current?.date ?? '';
    const b = st.date ?? '';
    if (!current || b > a) latestByKey.set(key, st);
  }

  const keepStocktakeIds = new Set(
    Array.from(latestByKey.values()).map((st) => st.id)
  );

  const qtyByProduct = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    if (!keepStocktakeIds.has(line.stocktakeId)) continue;
    const qty = typeof line.countedQty === 'number' ? line.countedQty : 0;
    qtyByProduct.set(line.productId, (qtyByProduct.get(line.productId) ?? 0) + qty);
  }
  return qtyByProduct;
}

function buildItemNotes(product: LegacyProduct) {
  const fragments: string[] = [];
  if (product.venue) fragments.push(`Venue: ${product.venue}`);
  if (product.mappedProduct) fragments.push(`Mapped product: ${product.mappedProduct}`);
  if (product.packSize) fragments.push(`Pack: ${product.packSize}`);
  if (typeof product.baseQty === 'number' && product.baseUnit) {
    fragments.push(`Base: ${product.baseQty} ${product.baseUnit}`);
  }
  if (typeof product.currentCostPerBaseUnit === 'number' && product.baseUnit) {
    fragments.push(`Cost per ${product.baseUnit}: ${product.currentCostPerBaseUnit}`);
  }
  if (product.storage?.locations?.length) {
    fragments.push(`Storage: ${product.storage.locations.join(', ')}`);
  }
  if (product.storage?.department) {
    fragments.push(`Dept: ${product.storage.department}`);
  }
  const aliases = (product.aliases ?? []).filter(
    (alias) => alias && alias.trim().toLowerCase() !== product.name.trim().toLowerCase()
  );
  if (aliases.length > 0) {
    fragments.push(`Also known as: ${aliases.join(' • ')}`);
  }
  if (product.sourceFile) fragments.push(`Source: ${product.sourceFile}`);
  return fragments.length > 0 ? fragments.join('\n') : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.file, 'utf8');
  const payload = parseSourceFile(raw, args.file);
  const norm = normalisePayload(payload);
  const products = norm.products;
  const stocktakes = norm.stocktakes;
  const stocktakeLines = norm.stocktakeLines;
  const recipes = norm.recipes;
  const recipeLines = norm.recipeLines;
  const productGroups = buildProductGroups(products);
  const duplicateProductRows = products.length - productGroups.length;

  if (products.length === 0) {
    console.error(
      `No legacy products found in ${args.file}. Has the legacy extract step been run?`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Legacy products — ${products.length} source rows collapsed to ${productGroups.length} stock items (${duplicateProductRows} duplicate rows merged).`
  );

  if (args.dryRun) {
    const distinctCategoryNames = Array.from(
      new Set(productGroups.map((group) => group.primary.categoryName).filter((n): n is string => Boolean(n)))
    );
    console.log('Mode: DRY RUN - no writes.');
    console.log(`Would upsert ${distinctCategoryNames.length} categories.`);
    console.log(`Would process ${productGroups.length} stock items.`);
    console.log(`Would process ${recipes.length} recipes and ${recipeLines.length} recipe lines.`);
    console.log(`Would process ${stocktakes.length} stocktakes and ${stocktakeLines.length} stocktake lines.`);
    return;
  }

  if (args.replace) {
    console.log(
      'Replace mode: clearing StocktakeLine, Stocktake, RecipeLine, Recipe, StockItem and StockCategory rows.'
    );
    // Order matters: lines reference recipes/stocktakes and items; we drop
    // line tables first, then their parents, then items, then categories.
    await prisma.stocktakeLine.deleteMany();
    await prisma.stocktake.deleteMany();
    await prisma.recipeLine.deleteMany();
    await prisma.recipe.deleteMany();
    await prisma.stockItem.deleteMany();
    await prisma.stockCategory.deleteMany();
  }

  // Categories — distinct names off products, then upsert one row each.
  const distinctCategoryNames = Array.from(
    new Set(productGroups.map((group) => group.primary.categoryName).filter((n): n is string => Boolean(n)))
  ).sort((a, b) => a.localeCompare(b));

  const categoryIdByName = new Map<string, string>();
  for (const rawName of distinctCategoryNames) {
    const legacyId = categoryLegacyId(rawName);
    const name = categoryDisplayName(rawName);
    const existingByLegacy = await prisma.stockCategory.findUnique({ where: { legacyId } });
    const existingByName = existingByLegacy
      ? null
      : await prisma.stockCategory.findUnique({ where: { name } });
    const upserted = existingByLegacy
      ? await prisma.stockCategory.update({
          where: { id: existingByLegacy.id },
          data: { name }
        })
      : existingByName
        ? await prisma.stockCategory.update({
            where: { id: existingByName.id },
            data: { legacyId: existingByName.legacyId ?? legacyId }
          })
        : await prisma.stockCategory.create({ data: { legacyId, name } });
    categoryIdByName.set(rawName, upserted.id);
  }

  console.log(`Upserted ${categoryIdByName.size} categories.`);

  // Items — derive on-hand from the latest stocktake per (venue, template).
  const qtyByProduct = buildLatestQtyByProduct(stocktakes, stocktakeLines);
  const itemIdByLegacyProduct = new Map<string, string>();

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let mergedDuplicates = 0;

  for (const group of productGroups) {
    const product = mergeProductGroup(group);
    if (!product.id || !product.name) {
      skipped += 1;
      continue;
    }
    const categoryId = product.categoryName
      ? categoryIdByName.get(product.categoryName) ?? null
      : null;

    const onHand = sumLatestQtyForGroup(group, qtyByProduct);
    const unit = (product.purchaseUnit || product.baseUnit || 'ea').trim();
    const avgCostCents =
      typeof product.currentCost === 'number'
        ? Math.max(0, Math.round(product.currentCost * 100))
        : null;
    const status: 'ACTIVE' | 'ARCHIVED' = product.active ? 'ACTIVE' : 'ARCHIVED';

    const data = {
      name: product.name.trim(),
      categoryId,
      unit,
      onHand,
      parLevel: 0,
      reorderPoint: null,
      avgCostCents,
      status,
      notes: buildItemNotes(product)
    };

    const legacyIds = group.products.map((groupProduct) => groupProduct.id);
    const existingMatches = await prisma.stockItem.findMany({
      where: { legacyId: { in: legacyIds } },
      orderBy: { createdAt: 'asc' }
    });
    const existing =
      existingMatches.find((match) => match.legacyId === product.id) ?? existingMatches[0] ?? null;

    let keeperId: string;
    if (existing) {
      await prisma.stockItem.update({
        where: { id: existing.id },
        data: {
          ...data,
          legacyId: product.id
        }
      });
      keeperId = existing.id;
      updated += 1;
    } else {
      const createdRow = await prisma.stockItem.create({ data: { legacyId: product.id, ...data } });
      keeperId = createdRow.id;
      created += 1;
    }

    const duplicateMatches = existingMatches.filter((match) => match.id !== keeperId);
    if (duplicateMatches.length > 0) {
      const duplicateIds = duplicateMatches.map((match) => match.id);
      await prisma.$transaction(async (tx) => {
        await tx.recipeLine.updateMany({
          where: { itemId: { in: duplicateIds } },
          data: { itemId: keeperId }
        });
        await tx.stocktakeLine.updateMany({
          where: { itemId: { in: duplicateIds } },
          data: { itemId: keeperId }
        });
        await tx.stockItem.deleteMany({ where: { id: { in: duplicateIds } } });
      });
      mergedDuplicates += duplicateMatches.length;
    }

    for (const groupProduct of group.products) {
      itemIdByLegacyProduct.set(groupProduct.id, keeperId);
    }
  }

  console.log(
    `Items — created: ${created}, updated: ${updated}, skipped: ${skipped}, merged existing duplicates: ${mergedDuplicates} (total processed: ${products.length}).`
  );
  console.log(
    `On-hand sourced from latest stocktake per (venue, template) for ${qtyByProduct.size} products.`
  );

  // Recipes — bring across the legacy recipe headers + their ingredient
  // lines. Lines link back to StockItem via the legacy product id we stored
  // earlier.
  if (recipes.length > 0) {
    // Group recipe lines by recipeId so we can write them in one pass per
    // recipe rather than 1.6k individual line lookups.
    const linesByRecipe = new Map<string, LegacyRecipeLine[]>();
    for (const line of recipeLines) {
      if (!line.recipeId) continue;
      const list = linesByRecipe.get(line.recipeId) ?? [];
      list.push(line);
      linesByRecipe.set(line.recipeId, list);
    }

    let recipesCreated = 0;
    let recipesUpdated = 0;
    let recipesSkipped = 0;
    let totalLinesWritten = 0;
    let linesLinkedToItem = 0;

    for (const recipe of recipes) {
      if (!recipe.id || !recipe.title) {
        recipesSkipped += 1;
        continue;
      }

      // Sort + collect this recipe's lines, defaulting position to the
      // legacy lineOrder where present (1-based) and falling back to array
      // index for stragglers without ordering metadata.
      const rawLines = (linesByRecipe.get(recipe.id) ?? []).slice().sort((a, b) => {
        const ao = typeof a.lineOrder === 'number' ? a.lineOrder : Number.POSITIVE_INFINITY;
        const bo = typeof b.lineOrder === 'number' ? b.lineOrder : Number.POSITIVE_INFINITY;
        return ao - bo;
      });
      const linesData = rawLines.map((line, index) => {
        const itemId = line.productId
          ? itemIdByLegacyProduct.get(line.productId) ?? null
          : null;
        if (itemId) linesLinkedToItem += 1;
        const legacyLineId = `${recipe.id}:line:${index + 1}`;
        return {
          legacyId: legacyLineId,
          position:
            typeof line.lineOrder === 'number' && line.lineOrder > 0
              ? line.lineOrder
              : index + 1,
          ingredientName: (line.name ?? '').trim() || 'Unnamed ingredient',
          quantity:
            typeof line.qty === 'number' && Number.isFinite(line.qty) ? line.qty : null,
          unit: line.unit ? line.unit.trim() || null : null,
          cost:
            typeof line.cost === 'number' && Number.isFinite(line.cost)
              ? line.cost
              : null,
          itemId
        };
      });

      const data = {
        title: recipe.title.trim(),
        kind: recipe.kind?.trim() || null,
        category: recipe.category?.trim() || null,
        subcategory: recipe.subcategory?.trim() || null,
        venue: recipe.venue?.trim() || null,
        yieldQuantity: null,
        yieldUnit: null,
        estimatedCost:
          typeof recipe.estimatedCost === 'number' && Number.isFinite(recipe.estimatedCost)
            ? recipe.estimatedCost
            : 0,
        notes: null
      };

      const existing = await prisma.recipe.findUnique({
        where: { legacyId: recipe.id }
      });
      if (existing) {
        // Replace lines wholesale — simpler and correct for a bulk import.
        await prisma.recipeLine.deleteMany({ where: { recipeId: existing.id } });
        await prisma.recipe.update({
          where: { id: existing.id },
          data: {
            ...data,
            lines: linesData.length > 0 ? { create: linesData } : undefined
          }
        });
        recipesUpdated += 1;
      } else {
        await prisma.recipe.create({
          data: {
            legacyId: recipe.id,
            ...data,
            lines: linesData.length > 0 ? { create: linesData } : undefined
          }
        });
        recipesCreated += 1;
      }
      totalLinesWritten += linesData.length;
    }

    console.log(
      `Recipes — created: ${recipesCreated}, updated: ${recipesUpdated}, skipped: ${recipesSkipped} (total processed: ${recipes.length}).`
    );
    console.log(
      `Recipe lines — wrote ${totalLinesWritten}, of which ${linesLinkedToItem} were linked to a StockItem by legacy product id.`
    );
  } else {
    console.log('No legacy recipes in export — skipping recipe import.');
  }

  // Stocktakes — bring across the historical counts. The import-level map
  // points every legacy product id, including duplicate source ids, to the
  // one kept StockItem row.
  if (stocktakes.length > 0) {
    const linesByStocktake = new Map<string, LegacyStocktakeLine[]>();
    for (const line of stocktakeLines) {
      if (!line.stocktakeId) continue;
      const list = linesByStocktake.get(line.stocktakeId) ?? [];
      list.push(line);
      linesByStocktake.set(line.stocktakeId, list);
    }

    let stocktakesCreated = 0;
    let stocktakesUpdated = 0;
    let stocktakesSkipped = 0;
    let totalLinesWritten = 0;
    let linesLinkedToItem = 0;

    for (const stocktake of stocktakes) {
      if (!stocktake.id) {
        stocktakesSkipped += 1;
        continue;
      }

      // Date can come as 'YYYY-MM-DD' or full ISO; both parse fine via
      // new Date(). Reject only if it can't be parsed at all.
      const countedAt = stocktake.date ? new Date(stocktake.date) : new Date();
      if (Number.isNaN(countedAt.getTime())) {
        stocktakesSkipped += 1;
        continue;
      }

      const status: 'IN_PROGRESS' | 'SUBMITTED' =
        (stocktake.status ?? '').toLowerCase() === 'submitted'
          ? 'SUBMITTED'
          : 'IN_PROGRESS';

      const rawLines = linesByStocktake.get(stocktake.id) ?? [];
      const linesData = rawLines.map((line, index) => {
        const itemId = line.productId
          ? itemIdByLegacyProduct.get(line.productId) ?? null
          : null;
        if (itemId) linesLinkedToItem += 1;
        const stockValueCents =
          typeof line.stockValue === 'number' && Number.isFinite(line.stockValue)
            ? Math.max(0, Math.round(line.stockValue * 100))
            : null;
        // Some legacy line IDs are reused across venues, so namespace every
        // line by its stocktake ID to keep the import idempotent and unique.
        const legacyLineId = `${stocktake.id}:line:${line.id ?? index + 1}`;
        return {
          legacyId: legacyLineId,
          position: index + 1,
          label:
            (line.label ?? '').trim() ||
            (line.productId ? `Item ${line.productId}` : `Line ${index + 1}`),
          countedQty:
            typeof line.countedQty === 'number' && Number.isFinite(line.countedQty)
              ? line.countedQty
              : 0,
          unit: line.baseUnit ? line.baseUnit.trim() || null : null,
          location: line.location ? line.location.trim() || null : null,
          stockValueCents,
          itemId,
          notes: null
        };
      });

      const data = {
        name:
          (stocktake.name && stocktake.name.trim()) ||
          stocktake.id.replace(/_/g, ' '),
        venue: stocktake.venue?.trim() || null,
        template: stocktake.template?.trim() || null,
        countedAt,
        status,
        notes: null
      };

      const existing = await prisma.stocktake.findUnique({
        where: { legacyId: stocktake.id }
      });
      if (existing) {
        await prisma.stocktakeLine.deleteMany({
          where: { stocktakeId: existing.id }
        });
        await prisma.stocktake.update({
          where: { id: existing.id },
          data: {
            ...data,
            lines: linesData.length > 0 ? { create: linesData } : undefined
          }
        });
        stocktakesUpdated += 1;
      } else {
        await prisma.stocktake.create({
          data: {
            legacyId: stocktake.id,
            ...data,
            lines: linesData.length > 0 ? { create: linesData } : undefined
          }
        });
        stocktakesCreated += 1;
      }
      totalLinesWritten += linesData.length;
    }

    console.log(
      `Stocktakes — created: ${stocktakesCreated}, updated: ${stocktakesUpdated}, skipped: ${stocktakesSkipped} (total processed: ${stocktakes.length}).`
    );
    console.log(
      `Stocktake lines — wrote ${totalLinesWritten}, of which ${linesLinkedToItem} were linked to a StockItem by legacy product id.`
    );
  } else {
    console.log('No legacy stocktakes in export — skipping stocktake import.');
  }

  const [stockItemMultiplesRemoved, recipeMultiplesRemoved] = await Promise.all([
    cleanupStockItemMultiples(),
    cleanupRecipeMultiples()
  ]);
  console.log(
    `Final cleanup — removed ${stockItemMultiplesRemoved} duplicate stock items and ${recipeMultiplesRemoved} duplicate recipes.`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
