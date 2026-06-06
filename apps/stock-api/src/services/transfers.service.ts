import { prisma } from '@alma/db';
import { stockTransferCreateInputSchema, type AuthUser, type StockTransfer } from '@alma/shared';
import { HttpError } from '../lib/http.js';

type TransferRow = {
  id: string;
  stockItemId: string;
  fromVenue: string;
  toVenue: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  createdByName: string | null;
  fromOnHandAfter: number | null;
  toOnHandAfter: number | null;
  createdAt: Date;
  stockItem: { name: string };
};

function toPayload(row: TransferRow): StockTransfer {
  return {
    id: row.id,
    stockItemId: row.stockItemId,
    itemName: row.stockItem.name,
    fromVenue: row.fromVenue,
    toVenue: row.toVenue,
    quantity: row.quantity,
    unit: row.unit,
    notes: row.notes,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    fromOnHandAfter: row.fromOnHandAfter,
    toOnHandAfter: row.toOnHandAfter
  };
}

export const transfersService = {
  async list(venue?: string | null, limit = 50): Promise<StockTransfer[]> {
    const trimmed = venue?.trim();
    const rows = await prisma.stockTransfer.findMany({
      where: trimmed ? { OR: [{ fromVenue: trimmed }, { toVenue: trimmed }] } : {},
      include: { stockItem: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit))
    });
    return rows.map(toPayload);
  },

  async create(input: unknown, actor: AuthUser): Promise<StockTransfer> {
    const data = stockTransferCreateInputSchema.parse(input);
    const fromVenue = data.fromVenue.trim();
    const toVenue = data.toVenue.trim();
    if (fromVenue === toVenue) throw new HttpError(400, 'From and To venues must be different.');

    return prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.findUnique({
        where: { id: data.stockItemId },
        select: { id: true, name: true, onHand: true, parLevel: true, reorderPoint: true, unit: true, countUnit: true }
      });
      if (!item) throw new HttpError(404, 'Stock item not found.');

      // Resolve (or create) the per-venue rows. Effective on-hand falls back to
      // the global item on-hand the same way the stocktake variance does.
      const fromRow = await tx.venueStockItem.upsert({
        where: { venue_stockItemId: { venue: fromVenue, stockItemId: item.id } },
        create: { venue: fromVenue, stockItemId: item.id, parLevel: item.parLevel, reorderPoint: item.reorderPoint, onHand: null, active: true },
        update: {}
      });
      const toRow = await tx.venueStockItem.upsert({
        where: { venue_stockItemId: { venue: toVenue, stockItemId: item.id } },
        create: { venue: toVenue, stockItemId: item.id, parLevel: item.parLevel, reorderPoint: item.reorderPoint, onHand: null, active: true },
        update: {}
      });

      const fromCurrent = fromRow.onHand ?? item.onHand ?? 0;
      const toCurrent = toRow.onHand ?? item.onHand ?? 0;
      const fromAfter = Math.round((fromCurrent - data.quantity) * 1000) / 1000;
      const toAfter = Math.round((toCurrent + data.quantity) * 1000) / 1000;

      await tx.venueStockItem.update({ where: { id: fromRow.id }, data: { onHand: fromAfter, active: true } });
      await tx.venueStockItem.update({ where: { id: toRow.id }, data: { onHand: toAfter, active: true } });

      const created = await tx.stockTransfer.create({
        data: {
          stockItemId: item.id,
          fromVenue,
          toVenue,
          quantity: data.quantity,
          unit: (data.unit?.trim() || item.countUnit || item.unit) ?? null,
          notes: data.notes?.trim() || null,
          createdByName: `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || null,
          createdByUserId: actor.id ?? null,
          fromOnHandAfter: fromAfter,
          toOnHandAfter: toAfter
        },
        include: { stockItem: { select: { name: true } } }
      });
      return toPayload(created);
    });
  }
};
