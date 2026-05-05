import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stocktakeBulkDeleteInputSchema,
  stocktakeCreateInputSchema,
  stocktakeUpdateInputSchema,
  type ApplyStocktakeResult,
  type InventoryMovement,
  type Stocktake,
  type StocktakeLine,
  type StocktakeWithLines,
  type StocktakesPayload,
  type StocktakesSummary
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type StocktakeRow = Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: { select: { stockValueCents: true } };
  };
}>;

type StocktakeWithLinesRow = Prisma.StocktakeGetPayload<{
  include: {
    lines: {
      include: { item: { select: { id: true; name: true; unit: true } } };
    };
  };
}>;

type StocktakeLineRow = StocktakeWithLinesRow['lines'][number];

type InventoryMovementRow = Prisma.InventoryMovementGetPayload<object>;

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function sumLineValueCents(lines: { stockValueCents: number | null }[]): number {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

function toStocktakePayload(row: StocktakeRow): Stocktake {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    lineCount: row._count.lines,
    totalValueCents: sumLineValueCents(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toLinePayload(row: StocktakeLineRow): StocktakeLine {
  return {
    id: row.id,
    legacyId: row.legacyId,
    stocktakeId: row.stocktakeId,
    itemId: row.itemId,
    item: row.item ?? null,
    position: row.position,
    label: row.label,
    countedQty: row.countedQty,
    unit: row.unit,
    location: row.location,
    stockValueCents: row.stockValueCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toStocktakeWithLinesPayload(row: StocktakeWithLinesRow): StocktakeWithLines {
  const totalValueCents = row.lines.reduce(
    (sum, line) => sum + (line.stockValueCents ?? 0),
    0
  );
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    lineCount: row.lines.length,
    totalValueCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines
      .slice()
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.label.localeCompare(b.label);
      })
      .map(toLinePayload)
  };
}

function toMovementPayload(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    itemId: row.itemId,
    movementType: row.movementType,
    quantityDelta: row.quantityDelta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    unit: row.unit,
    sourceStocktakeId: row.sourceStocktakeId,
    sourceStocktakeLineId: row.sourceStocktakeLineId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString()
  };
}

export const stocktakesService = {
  async list(): Promise<StocktakesPayload> {
    const stocktakes = await prisma.stocktake.findMany({
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      },
      orderBy: { countedAt: 'desc' }
    });
    return { stocktakes: stocktakes.map(toStocktakePayload) };
  },

  async summary(): Promise<StocktakesSummary> {
    const [total, inProgress, submitted, latest, valueAgg] = await Promise.all([
      prisma.stocktake.count(),
      prisma.stocktake.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.stocktake.count({ where: { status: 'SUBMITTED' } }),
      prisma.stocktake.findFirst({
        orderBy: { countedAt: 'desc' },
        select: { countedAt: true }
      }),
      prisma.stocktakeLine.aggregate({ _sum: { stockValueCents: true } })
    ]);

    return {
      totalStocktakes: total,
      inProgress,
      submitted,
      lastCountedAt: latest?.countedAt.toISOString() ?? null,
      totalValueCents: valueAgg._sum.stockValueCents ?? 0
    };
  },

  async get(id: string): Promise<StocktakeWithLines> {
    const row = await prisma.stocktake.findUnique({
      where: { id },
      include: {
        lines: {
          include: { item: { select: { id: true, name: true, unit: true } } }
        }
      }
    });
    if (!row) throw new HttpError(404, 'Stocktake not found');
    return toStocktakeWithLinesPayload(row);
  },

  async createStocktake(input: unknown): Promise<StocktakeWithLines> {
    const data = stocktakeCreateInputSchema.parse(input);
    const countedAt = new Date(data.countedAt);
    if (Number.isNaN(countedAt.getTime())) {
      throw new HttpError(400, 'countedAt is not a valid date');
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.stocktake.create({
        data: {
          name: data.name.trim(),
          venue: normaliseOptionalText(data.venue) ?? null,
          template: normaliseOptionalText(data.template) ?? null,
          countedAt,
          status: data.status,
          notes: normaliseOptionalText(data.notes) ?? null,
          lines: data.lines
            ? {
                create: data.lines.map((line, index) => ({
                  position: index + 1,
                  label: line.label.trim(),
                  itemId: normaliseOptionalText(line.itemId) ?? null,
                  countedQty: line.countedQty,
                  unit: normaliseOptionalText(line.unit) ?? null,
                  location: normaliseOptionalText(line.location) ?? null,
                  stockValueCents:
                    line.stockValueCents !== undefined ? line.stockValueCents : null,
                  notes: normaliseOptionalText(line.notes) ?? null
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
      return created;
    });
    return toStocktakeWithLinesPayload(row);
  },

  async updateStocktake(id: string, input: unknown): Promise<StocktakeWithLines> {
    const data = stocktakeUpdateInputSchema.parse(input);
    const existing = await prisma.stocktake.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.appliedAt) {
      throw new HttpError(409, 'Applied stocktakes cannot be edited');
    }

    let countedAt: Date | undefined;
    if (data.countedAt !== undefined) {
      countedAt = new Date(data.countedAt);
      if (Number.isNaN(countedAt.getTime())) {
        throw new HttpError(400, 'countedAt is not a valid date');
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      if (data.lines !== undefined) {
        await tx.stocktakeLine.deleteMany({ where: { stocktakeId: id } });
      }

      const updated = await tx.stocktake.update({
        where: { id },
        data: {
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.venue !== undefined && { venue: normaliseOptionalText(data.venue) }),
          ...(data.template !== undefined && {
            template: normaliseOptionalText(data.template)
          }),
          ...(countedAt !== undefined && { countedAt }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) }),
          ...(data.lines !== undefined && {
            lines: {
              create: data.lines.map((line, index) => ({
                position: index + 1,
                label: line.label.trim(),
                itemId: normaliseOptionalText(line.itemId) ?? null,
                countedQty: line.countedQty,
                unit: normaliseOptionalText(line.unit) ?? null,
                location: normaliseOptionalText(line.location) ?? null,
                stockValueCents:
                  line.stockValueCents !== undefined ? line.stockValueCents : null,
                notes: normaliseOptionalText(line.notes) ?? null
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
      return updated;
    });
    return toStocktakeWithLinesPayload(row);
  },

  async applyStocktake(id: string): Promise<ApplyStocktakeResult> {
    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
          lines: {
            orderBy: [{ position: 'asc' }, { label: 'asc' }],
            include: { item: { select: { id: true, name: true, unit: true } } }
          }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (stocktake.status !== 'SUBMITTED') {
        throw new HttpError(400, 'Only submitted stocktakes can be applied');
      }
      if (stocktake.appliedAt) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }

      const appliedAt = new Date();
      const applied = await tx.stocktake.updateMany({
        where: { id, status: 'SUBMITTED', appliedAt: null },
        data: { appliedAt }
      });
      if (applied.count !== 1) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }

      const movements: InventoryMovementRow[] = [];
      for (const line of stocktake.lines) {
        if (!line.itemId) continue;
        const item = await tx.stockItem.findUnique({
          where: { id: line.itemId },
          select: { id: true, unit: true, onHand: true }
        });
        if (!item) continue;

        const quantityBefore = item.onHand;
        const quantityAfter = line.countedQty;
        const quantityDelta = quantityAfter - quantityBefore;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            movementType: 'STOCKTAKE_ADJUSTMENT',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: line.unit ?? item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: `Applied stocktake: ${stocktake.name}`
          }
        });
        movements.push(movement);

        await tx.stockItem.update({
          where: { id: item.id },
          data: { onHand: quantityAfter }
        });
      }

      const appliedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true } } }
          }
        }
      });

      return { stocktake: appliedStocktake, movements };
    });

    return {
      stocktake: toStocktakeWithLinesPayload(result.stocktake),
      movements: result.movements.map(toMovementPayload)
    };
  },

  async deleteStocktakes(input: unknown): Promise<{ deleted: number }> {
    const { ids } = stocktakeBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const result = await prisma.stocktake.deleteMany({
      where: { id: { in: uniqueIds } }
    });
    return { deleted: result.count };
  }
};
