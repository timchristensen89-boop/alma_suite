import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stockCategoryCreateInputSchema,
  stockCategoryUpdateInputSchema,
  stockItemBulkDeleteInputSchema,
  stockItemCreateInputSchema,
  stockItemUpdateInputSchema,
  type StockCategory,
  type StockItem,
  type StockItemsPayload,
  type StockItemsSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type StockItemRow = Prisma.StockItemGetPayload<{
  include: { category: { select: { id: true; name: true } } };
}>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function normaliseOptionalNumber(value: number | undefined) {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return value;
}

function assertNoDirectOnHandMutation(input: unknown) {
  if (input && typeof input === 'object' && 'onHand' in input) {
    throw new HttpError(400, 'Stock on hand can only be changed by inventory movements');
  }
}

function toCategoryPayload(row: {
  id: string;
  legacyId: string | null;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}): StockCategory {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toItemPayload(row: StockItemRow): StockItem {
  return {
    id: row.id,
    legacyId: row.legacyId,
    sku: row.sku,
    name: row.name,
    categoryId: row.categoryId,
    category: row.category,
    unit: row.unit,
    onHand: row.onHand,
    parLevel: row.parLevel,
    reorderPoint: row.reorderPoint,
    avgCostCents: row.avgCostCents,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

async function assertCategoryExists(categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.stockCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw new HttpError(400, 'Category not found');
}

export const itemsService = {
  async list(): Promise<StockItemsPayload> {
    const [items, categories] = await Promise.all([
      prisma.stockItem.findMany({
        include: { category: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { name: 'asc' }]
      }),
      prisma.stockCategory.findMany({
        orderBy: { name: 'asc' }
      })
    ]);

    return {
      items: items.map(toItemPayload),
      categories: categories.map(toCategoryPayload)
    };
  },

  async summary(): Promise<StockItemsSummary> {
    const [totalItems, activeItems, categories, activeRows] = await Promise.all([
      prisma.stockItem.count(),
      prisma.stockItem.count({ where: { status: 'ACTIVE' } }),
      prisma.stockCategory.count(),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: { onHand: true, parLevel: true, reorderPoint: true }
      })
    ]);

    const lowStockItems = activeRows.filter((item) => {
      const threshold = item.reorderPoint ?? item.parLevel;
      return threshold > 0 && item.onHand <= threshold;
    }).length;
    const totalOnHand = activeRows.reduce((total, item) => total + item.onHand, 0);

    return { totalItems, activeItems, lowStockItems, categories, totalOnHand };
  },

  async createCategory(input: unknown): Promise<StockCategory> {
    const data = stockCategoryCreateInputSchema.parse(input);
    const existing = await prisma.stockCategory.findUnique({
      where: { name: data.name.trim() }
    });
    if (existing) throw new HttpError(409, 'A category with that name already exists');

    const row = await prisma.stockCategory.create({
      data: {
        name: data.name.trim(),
        description: normaliseOptionalText(data.description) ?? null
      }
    });
    return toCategoryPayload(row);
  },

  async updateCategory(id: string, input: unknown): Promise<StockCategory> {
    const data = stockCategoryUpdateInputSchema.parse(input);
    const existing = await prisma.stockCategory.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Category not found');

    const name = data.name !== undefined ? data.name.trim() : undefined;
    if (name && name !== existing.name) {
      const conflict = await prisma.stockCategory.findUnique({ where: { name } });
      if (conflict) throw new HttpError(409, 'A category with that name already exists');
    }

    const row = await prisma.stockCategory.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(data.description !== undefined && {
          description: normaliseOptionalText(data.description) ?? null
        })
      }
    });
    return toCategoryPayload(row);
  },

  async createItem(input: unknown): Promise<StockItem> {
    assertNoDirectOnHandMutation(input);
    const data = stockItemCreateInputSchema.parse(input);
    const sku = normaliseOptionalText(data.sku);
    const categoryId = normaliseOptionalText(data.categoryId);
    await assertCategoryExists(categoryId);

    if (sku) {
      const existing = await prisma.stockItem.findUnique({ where: { sku } });
      if (existing) throw new HttpError(409, 'An item with that SKU already exists');
    }

    const row = await prisma.stockItem.create({
      data: {
        sku: sku ?? null,
        name: data.name.trim(),
        categoryId: categoryId ?? null,
        unit: data.unit.trim(),
        parLevel: data.parLevel,
        reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null,
        avgCostCents: normaliseOptionalNumber(data.avgCostCents) ?? null,
        status: data.status,
        notes: normaliseOptionalText(data.notes) ?? null
      },
      include: { category: { select: { id: true, name: true } } }
    });

    return toItemPayload(row);
  },

  async updateItem(id: string, input: unknown): Promise<StockItem> {
    assertNoDirectOnHandMutation(input);
    const data = stockItemUpdateInputSchema.parse(input);
    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Item not found');

    const sku = data.sku !== undefined ? normaliseOptionalText(data.sku) : undefined;
    const categoryId =
      data.categoryId !== undefined ? normaliseOptionalText(data.categoryId) : undefined;
    await assertCategoryExists(categoryId);

    if (sku && sku !== existing.sku) {
      const conflict = await prisma.stockItem.findUnique({ where: { sku } });
      if (conflict) throw new HttpError(409, 'An item with that SKU already exists');
    }

    const row = await prisma.stockItem.update({
      where: { id },
      data: {
        ...(data.sku !== undefined && { sku: sku ?? null }),
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.categoryId !== undefined && { categoryId: categoryId ?? null }),
        ...(data.unit !== undefined && { unit: data.unit.trim() }),
        ...(data.parLevel !== undefined && { parLevel: data.parLevel }),
        ...(data.reorderPoint !== undefined && {
          reorderPoint: normaliseOptionalNumber(data.reorderPoint) ?? null
        }),
        ...(data.avgCostCents !== undefined && {
          avgCostCents: normaliseOptionalNumber(data.avgCostCents) ?? null
        }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) })
      },
      include: { category: { select: { id: true, name: true } } }
    });

    return toItemPayload(row);
  },

  async deleteItems(input: unknown): Promise<{ deleted: number }> {
    const { ids } = stockItemBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));

    const result = await prisma.$transaction(async (tx) => {
      await tx.recipeLine.updateMany({
        where: { itemId: { in: uniqueIds } },
        data: { itemId: null }
      });
      await tx.stocktakeLine.updateMany({
        where: { itemId: { in: uniqueIds } },
        data: { itemId: null }
      });
      return tx.stockItem.deleteMany({ where: { id: { in: uniqueIds } } });
    });

    return { deleted: result.count };
  }
};
