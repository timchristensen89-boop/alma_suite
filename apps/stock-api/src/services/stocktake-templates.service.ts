import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AuthUser,
  StocktakeTemplate,
  StocktakeTemplatesPayload,
  StocktakeTemplateResolved
} from '@alma/shared';
import { stocktakeTemplateInputSchema } from '@alma/shared';
import { HttpError } from '../lib/http.js';

type TemplateRow = Prisma.StocktakeTemplateGetPayload<Record<string, never>>;

function toPayload(row: TemplateRow, resolvedItemCount: number): StocktakeTemplate {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    blindDefault: row.blindDefault,
    countAreas: row.countAreas,
    categoryIds: row.categoryIds,
    includeItemIds: row.includeItemIds,
    excludeItemIds: row.excludeItemIds,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedItemCount
  };
}

// Base = active items whose countArea ∈ countAreas OR category ∈ categoryIds.
// An empty base (no areas, no categories) means "all active items". Then apply
// the per-template tweaks: + includeItemIds, − excludeItemIds.
function baseWhere(countAreas: string[], categoryIds: string[]): Prisma.StockItemWhereInput {
  const or: Prisma.StockItemWhereInput[] = [];
  if (countAreas.length) or.push({ countArea: { in: countAreas } });
  if (categoryIds.length) or.push({ categoryId: { in: categoryIds } });
  return or.length ? { OR: or } : {};
}

async function resolveItemIds(row: TemplateRow): Promise<Set<string>> {
  const base = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE', ...baseWhere(row.countAreas, row.categoryIds) },
    select: { id: true }
  });
  const set = new Set(base.map((item) => item.id));
  for (const id of row.includeItemIds) set.add(id);
  for (const id of row.excludeItemIds) set.delete(id);
  return set;
}

function normaliseInput(input: unknown) {
  const data = stocktakeTemplateInputSchema.parse(input);
  return {
    name: data.name.trim(),
    venue: data.venue?.trim() ? data.venue.trim() : null,
    blindDefault: data.blindDefault ?? true,
    countAreas: Array.from(new Set((data.countAreas ?? []).map((v) => v.trim()).filter(Boolean))),
    categoryIds: Array.from(new Set((data.categoryIds ?? []).filter(Boolean))),
    includeItemIds: Array.from(new Set((data.includeItemIds ?? []).filter(Boolean))),
    excludeItemIds: Array.from(new Set((data.excludeItemIds ?? []).filter(Boolean))),
    active: data.active ?? true
  };
}

export const stocktakeTemplatesService = {
  async list(_actor?: AuthUser | null): Promise<StocktakeTemplatesPayload> {
    const [templates, categories, areaRows, venueRows] = await Promise.all([
      prisma.stocktakeTemplate.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      prisma.stockCategory.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE', countArea: { not: null } },
        distinct: ['countArea'],
        select: { countArea: true },
        orderBy: { countArea: 'asc' }
      }),
      prisma.venueStockItem.findMany({ distinct: ['venue'], where: { active: true }, select: { venue: true }, orderBy: { venue: 'asc' } })
    ]);
    const resolvedCounts = await Promise.all(templates.map((row) => resolveItemIds(row).then((set) => set.size)));
    return {
      templates: templates.map((row, index) => toPayload(row, resolvedCounts[index] ?? 0)),
      countAreas: areaRows.map((row) => row.countArea as string),
      categories,
      venues: venueRows.map((row) => row.venue)
    };
  },

  async create(input: unknown, _actor?: AuthUser | null): Promise<StocktakeTemplate> {
    const data = normaliseInput(input);
    const row = await prisma.stocktakeTemplate.create({ data });
    return toPayload(row, (await resolveItemIds(row)).size);
  },

  async update(id: string, input: unknown, _actor?: AuthUser | null): Promise<StocktakeTemplate> {
    const existing = await prisma.stocktakeTemplate.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Template not found');
    const data = normaliseInput(input);
    const row = await prisma.stocktakeTemplate.update({ where: { id }, data });
    return toPayload(row, (await resolveItemIds(row)).size);
  },

  async remove(id: string, _actor?: AuthUser | null): Promise<{ id: string }> {
    const existing = await prisma.stocktakeTemplate.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Template not found');
    await prisma.stocktakeTemplate.delete({ where: { id } });
    return { id };
  },

  // Concrete item list for starting a count — active items only, ordered by
  // count area (walking order) then name.
  async resolve(id: string, _actor?: AuthUser | null): Promise<StocktakeTemplateResolved> {
    const row = await prisma.stocktakeTemplate.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, 'Template not found');
    const ids = await resolveItemIds(row);
    const items = await prisma.stockItem.findMany({
      where: { id: { in: [...ids] }, status: 'ACTIVE' },
      select: { id: true, name: true, unit: true, countUnit: true, countArea: true, category: { select: { name: true } } },
      orderBy: [{ countArea: 'asc' }, { name: 'asc' }]
    });
    return {
      template: toPayload(row, items.length),
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        countUnit: item.countUnit,
        countArea: item.countArea,
        categoryName: item.category?.name ?? null
      }))
    };
  }
};
