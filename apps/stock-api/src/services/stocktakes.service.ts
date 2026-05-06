import type { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stocktakeCorrectionInputSchema,
  stocktakeBulkDeleteInputSchema,
  stocktakeCreateInputSchema,
  stocktakeReversalInputSchema,
  stocktakeUpdateInputSchema,
  type ApplyStocktakeResult,
  type InventoryMovement,
  type StocktakeMovement,
  type StocktakeMovementHistoryPayload,
  type StocktakeMovementResult,
  type Stocktake,
  type StocktakeLine,
  type StocktakeWithLines,
  type StocktakesPayload,
  type AuthUser,
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
      include: { item: { select: { id: true; name: true; unit: true; onHand: true } } };
    };
  };
}>;

type StocktakeLineRow = StocktakeWithLinesRow['lines'][number];

type InventoryMovementRow = Prisma.InventoryMovementGetPayload<object>;

type InventoryMovementWithContextRow = Prisma.InventoryMovementGetPayload<{
  include: {
    item: { select: { id: true; name: true; unit: true; onHand: true } };
    sourceStocktakeLine: {
      select: { id: true; label: true; countedQty: true; unit: true; location: true };
    };
  };
}>;

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

function toMovementWithContextPayload(row: InventoryMovementWithContextRow): StocktakeMovement {
  return {
    ...toMovementPayload(row),
    item: row.item,
    sourceStocktakeLine: row.sourceStocktakeLine
  };
}

function reviewerLabel(reviewer?: AuthUser | null) {
  if (!reviewer) return null;
  return `${reviewer.firstName} ${reviewer.lastName}`.trim() || reviewer.email || reviewer.id;
}

function notesWithContext(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(' · ');
}

function reversalSinceAppliedWhere(stocktakeId: string, appliedAt: Date | null) {
  return {
    sourceStocktakeId: stocktakeId,
    movementType: 'STOCKTAKE_REVERSAL' as const,
    ...(appliedAt ? { createdAt: { gte: appliedAt } } : {})
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
          include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
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
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
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
    let reversedAfterApply = false;
    if (existing.appliedAt) {
      reversedAfterApply = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, existing.appliedAt)
      }) > 0;
      if (!reversedAfterApply) {
        throw new HttpError(409, 'Applied stocktakes cannot be edited until a reversal movement exists');
      }
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
          ...(reversedAfterApply && {
            appliedAt: null,
            status: data.status ?? 'IN_PROGRESS'
          }),
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
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });
      return updated;
    });
    return toStocktakeWithLinesPayload(row);
  },

  async applyStocktake(id: string, reviewer?: AuthUser | null): Promise<ApplyStocktakeResult> {
    const reviewedBy = reviewerLabel(reviewer);
    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
          lines: {
            orderBy: [{ position: 'asc' }, { label: 'asc' }],
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
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
            notes: notesWithContext([
              `Applied stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
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
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
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

  async getMovementHistory(id: string): Promise<StocktakeMovementHistoryPayload> {
    const stocktake = await prisma.stocktake.findUnique({
      where: { id },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    if (!stocktake) throw new HttpError(404, 'Stocktake not found');

    const movements = await prisma.inventoryMovement.findMany({
      where: { sourceStocktakeId: id },
      include: {
        item: { select: { id: true, name: true, unit: true, onHand: true } },
        sourceStocktakeLine: {
          select: { id: true, label: true, countedQty: true, unit: true, location: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const hasReversal = movements.some(
      (movement) =>
        movement.movementType === 'STOCKTAKE_REVERSAL' &&
        (!stocktake.appliedAt || movement.createdAt >= stocktake.appliedAt)
    );

    return {
      stocktake: toStocktakePayload(stocktake),
      movements: movements.map(toMovementWithContextPayload),
      canReverse: Boolean(stocktake.appliedAt && !hasReversal),
      hasReversal
    };
  },

  async createCorrection(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeCorrectionInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be corrected');
      }

      const hasReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (hasReversal) {
        throw new HttpError(409, 'Reversed stocktakes must be edited and resubmitted instead of corrected');
      }

      const linesById = new Map(stocktake.lines.map((line) => [line.id, line]));
      const movements: InventoryMovementWithContextRow[] = [];

      for (const correction of data.corrections) {
        const line = linesById.get(correction.sourceStocktakeLineId);
        if (!line || !line.itemId) {
          throw new HttpError(400, 'Correction line must be linked to a stock item');
        }

        const item = await tx.stockItem.findUnique({
          where: { id: line.itemId },
          select: { id: true, unit: true, onHand: true }
        });
        if (!item) throw new HttpError(404, `Stock item not found for ${line.label}`);

        const quantityBefore = item.onHand;
        const quantityAfter = correction.quantityAfter;
        const quantityDelta = quantityAfter - quantityBefore;
        if (Math.abs(quantityDelta) <= 0.0001) continue;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            movementType: 'STOCKTAKE_CORRECTION',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: line.unit ?? item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: notesWithContext([
              `Correction for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              `Reason: ${correction.reason.trim()}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await tx.stockItem.update({
          where: { id: item.id },
          data: { onHand: quantityAfter }
        });
      }

      if (movements.length === 0) {
        throw new HttpError(400, 'Correction does not change any balances');
      }

      const updatedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      return { stocktake: updatedStocktake, movements };
    });

    return {
      stocktake: toStocktakeWithLinesPayload(result.stocktake),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async reverseStocktake(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeReversalInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);
    const reason = data.reason?.trim() || 'Manager reversal';

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({ where: { id } });
      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be reversed');
      }

      const existingReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (existingReversal) {
        throw new HttpError(409, 'Stocktake has already been reversed');
      }

      const sourceMovements = await tx.inventoryMovement.findMany({
        where: {
          sourceStocktakeId: id,
          movementType: { in: ['STOCKTAKE_ADJUSTMENT', 'STOCKTAKE_CORRECTION'] },
          createdAt: { gte: stocktake.appliedAt }
        },
        orderBy: { createdAt: 'asc' }
      });

      if (sourceMovements.length === 0) {
        throw new HttpError(409, 'No stocktake ledger movements exist to reverse');
      }

      const netByLine = new Map<
        string,
        { itemId: string; sourceStocktakeLineId: string | null; unit: string | null; quantityDelta: number }
      >();
      for (const movement of sourceMovements) {
        const key = `${movement.itemId}:${movement.sourceStocktakeLineId ?? 'stocktake'}`;
        const current = netByLine.get(key) ?? {
          itemId: movement.itemId,
          sourceStocktakeLineId: movement.sourceStocktakeLineId,
          unit: movement.unit,
          quantityDelta: 0
        };
        current.quantityDelta += movement.quantityDelta;
        current.unit = movement.unit ?? current.unit;
        netByLine.set(key, current);
      }

      const movements: InventoryMovementWithContextRow[] = [];
      for (const group of netByLine.values()) {
        if (Math.abs(group.quantityDelta) <= 0.0001) continue;
        const item = await tx.stockItem.findUnique({
          where: { id: group.itemId },
          select: { id: true, unit: true, onHand: true }
        });
        if (!item) continue;

        const quantityBefore = item.onHand;
        const quantityDelta = -group.quantityDelta;
        const quantityAfter = quantityBefore + quantityDelta;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: item.id,
            movementType: 'STOCKTAKE_REVERSAL',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: group.unit ?? item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: group.sourceStocktakeLineId,
            notes: notesWithContext([
              `Reversal for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              `Reason: ${reason}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await tx.stockItem.update({
          where: { id: item.id },
          data: { onHand: quantityAfter }
        });
      }

      if (movements.length === 0) {
        throw new HttpError(409, 'Stocktake movements already net to zero');
      }

      const updatedStocktake = await tx.stocktake.update({
        where: { id },
        data: { appliedAt: null, status: 'IN_PROGRESS' },
        include: {
          lines: {
            include: { item: { select: { id: true, name: true, unit: true, onHand: true } } }
          }
        }
      });

      return { stocktake: updatedStocktake, movements };
    });

    return {
      stocktake: toStocktakeWithLinesPayload(result.stocktake),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async deleteStocktakes(input: unknown): Promise<{ deleted: number }> {
    const { ids } = stocktakeBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const applied = await prisma.stocktake.findMany({
      where: { id: { in: uniqueIds }, appliedAt: { not: null } },
      select: { id: true, name: true, appliedAt: true }
    });
    const blocked: string[] = [];
    for (const stocktake of applied) {
      const hasReversal = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(stocktake.id, stocktake.appliedAt)
      });
      if (!hasReversal) blocked.push(stocktake.name);
    }
    if (blocked.length > 0) {
      throw new HttpError(
        409,
        `Applied stocktakes cannot be deleted without a reversal: ${blocked.join(', ')}`
      );
    }
    const result = await prisma.stocktake.deleteMany({
      where: { id: { in: uniqueIds } }
    });
    return { deleted: result.count };
  }
};
