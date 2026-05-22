import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stockDeliveryCheckCreateInputSchema,
  stockDeliveryCheckUpdateInputSchema,
  stockReorderNoticeResolveInputSchema,
  stockWastageCreateInputSchema,
  type AuthUser,
  type StockDeliveryCheck,
  type StockDeliveryChecksPayload,
  type StockReorderNotice,
  type StockReorderNoticesPayload,
  type StockWastagePayload,
  type StockWastageRecord
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type Tx = Prisma.TransactionClient;

const itemSelect = {
  id: true,
  sku: true,
  name: true,
  unit: true,
  onHand: true,
  avgCostCents: true,
  parLevel: true,
  reorderPoint: true,
  status: true,
  category: { select: { id: true, name: true } }
} satisfies Prisma.StockItemSelect;

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requestedVenue?: string | null) {
  const venue = requestedVenue?.trim() || null;
  if (!actor || isAdminActor(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, 'Stock access requires a venue-scoped staff profile.');
  if (venue && venue !== actor.venue) throw new HttpError(403, 'Stock access is limited to your venue.');
  return actor.venue;
}

async function assertKnownVenue(venue: string, actor?: AuthUser | null) {
  if (!venue.trim()) throw new HttpError(400, 'Venue is required');
  actorVenueScope(actor, venue);
}

function dateOrNow(value?: string | null) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Invalid date');
  return date;
}

function textOrNull(value?: string | null) {
  return value?.trim() || null;
}

function moneyImpactCents(quantity: number, avgCostCents: number | null | undefined) {
  return avgCostCents ? Math.round(quantity * avgCostCents) : null;
}

async function venuesForActor(actor?: AuthUser | null) {
  if (actor?.venue && !isAdminActor(actor)) return [actor.venue];
  const rows = await prisma.venueStockItem.findMany({
    distinct: ['venue'],
    where: { active: true },
    select: { venue: true },
    orderBy: { venue: 'asc' }
  });
  return rows.map((row) => row.venue);
}

async function itemsForActor(actor?: AuthUser | null, venue?: string | null) {
  const scopeVenue = actorVenueScope(actor, venue);
  const rows = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    include: {
      category: { select: { id: true, name: true } },
      venueStock: scopeVenue ? { where: { venue: scopeVenue }, take: 1 } : false
    },
    orderBy: { name: 'asc' }
  });
  return rows.map((row) => ({
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
    updatedAt: row.updatedAt.toISOString(),
    venueStock: row.venueStock?.[0]
      ? {
          id: row.venueStock[0].id,
          venue: row.venueStock[0].venue,
          stockItemId: row.venueStock[0].stockItemId,
          parLevel: row.venueStock[0].parLevel,
          reorderPoint: row.venueStock[0].reorderPoint,
          onHand: row.venueStock[0].onHand,
          unitOverride: row.venueStock[0].unitOverride,
          active: row.venueStock[0].active,
          createdAt: row.venueStock[0].createdAt.toISOString(),
          updatedAt: row.venueStock[0].updatedAt.toISOString()
        }
      : null
  }));
}

async function getVenueStock(tx: Tx, stockItemId: string, venue: string) {
  const item = await tx.stockItem.findUnique({ where: { id: stockItemId }, select: itemSelect });
  if (!item) throw new HttpError(404, 'Stock item not found');
  const row = await tx.venueStockItem.upsert({
    where: { venue_stockItemId: { venue, stockItemId } },
    create: {
      venue,
      stockItemId,
      parLevel: item.parLevel,
      reorderPoint: item.reorderPoint,
      onHand: item.onHand,
      active: true
    },
    update: {},
    select: { id: true, onHand: true, parLevel: true, reorderPoint: true, unitOverride: true, active: true }
  });
  return { item, venueStock: row };
}

async function adjustVenueOnHand(tx: Tx, input: {
  stockItemId: string;
  venue: string;
  quantityDelta: number;
  movementType: 'WASTAGE' | 'DELIVERY_RECEIPT';
  unit: string | null;
  notes: string;
  sourceWastageId?: string;
  sourceDeliveryCheckItemId?: string;
}) {
  const { item, venueStock } = await getVenueStock(tx, input.stockItemId, input.venue);
  const before = venueStock.onHand ?? 0;
  const after = before + input.quantityDelta;
  await tx.venueStockItem.update({
    where: { id: venueStock.id },
    data: { onHand: after, active: true }
  });
  const movement = await tx.inventoryMovement.create({
    data: {
      itemId: input.stockItemId,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      quantityBefore: before,
      quantityAfter: after,
      unit: input.unit,
      notes: input.notes,
      sourceWastageId: input.sourceWastageId,
      sourceDeliveryCheckItemId: input.sourceDeliveryCheckItemId
    }
  });
  await evaluateReorderForItem(tx, input.stockItemId, input.venue);
  return { movement, item, before, after };
}

async function evaluateReorderForItem(tx: Tx, stockItemId: string, venue: string) {
  const row = await tx.venueStockItem.findUnique({
    where: { venue_stockItemId: { venue, stockItemId } },
    include: { stockItem: { select: itemSelect } }
  });
  if (!row || !row.active || row.stockItem.status !== 'ACTIVE') return;
  const onHand = row.onHand ?? 0;
  const parLevel = row.parLevel ?? row.stockItem.parLevel;
  const reorderPoint = row.reorderPoint ?? row.stockItem.reorderPoint;
  const threshold = reorderPoint ?? parLevel;
  const unit = row.unitOverride ?? row.stockItem.unit;
  const open = await tx.stockReorderNotice.findFirst({
    where: { stockItemId, venue, status: 'OPEN' },
    orderBy: { createdAt: 'desc' }
  });

  if (threshold > 0 && onHand <= threshold) {
    const reorderQuantity = Math.max((parLevel || threshold) - onHand, 0);
    const data = {
      currentOnHand: onHand,
      parLevel,
      reorderPoint,
      reorderQuantity,
      unit,
      message: `${row.stockItem.name} is below ${reorderPoint ? 'reorder point' : 'par'} at ${venue}.`
    };
    if (open) {
      await tx.stockReorderNotice.update({ where: { id: open.id }, data });
    } else {
      await tx.stockReorderNotice.create({
        data: { stockItemId, venue, status: 'OPEN', ...data }
      });
    }
    return;
  }

  if (open) {
    await tx.stockReorderNotice.update({
      where: { id: open.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() }
    });
  }
}

function toWastagePayload(row: Prisma.StockWastageRecordGetPayload<{ include: { stockItem: { select: typeof itemSelect } } }>): StockWastageRecord {
  return {
    id: row.id,
    stockItemId: row.stockItemId,
    venue: row.venue,
    quantity: row.quantity,
    unit: row.unit,
    reason: row.reason,
    note: row.note,
    wastedAt: row.wastedAt.toISOString(),
    recordedById: row.recordedById,
    costImpactCents: row.costImpactCents,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    stockItem: row.stockItem
  };
}

function toDeliveryPayload(row: Prisma.StockDeliveryCheckGetPayload<{
  include: {
    supplier: { select: { id: true; name: true } };
    items: { include: { stockItem: { select: typeof itemSelect } } };
  };
}>): StockDeliveryCheck {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    venue: row.venue,
    invoiceNumber: row.invoiceNumber,
    deliveryDate: row.deliveryDate.toISOString(),
    invoiceReference: row.invoiceReference,
    status: row.status,
    notes: row.notes,
    createdById: row.createdById,
    completedAt: row.completedAt?.toISOString() ?? null,
    completedById: row.completedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    supplier: row.supplier,
    items: row.items.map((item) => ({
      id: item.id,
      deliveryCheckId: item.deliveryCheckId,
      stockItemId: item.stockItemId,
      description: item.description,
      expectedQuantity: item.expectedQuantity,
      receivedQuantity: item.receivedQuantity,
      unit: item.unit,
      checked: item.checked,
      discrepancy: item.discrepancy,
      discrepancyReason: item.discrepancyReason,
      notes: item.notes,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      stockItem: item.stockItem
    }))
  };
}

function toReorderPayload(row: Prisma.StockReorderNoticeGetPayload<{ include: { stockItem: { select: typeof itemSelect } } }>): StockReorderNotice {
  return {
    id: row.id,
    stockItemId: row.stockItemId,
    venue: row.venue,
    status: row.status,
    currentOnHand: row.currentOnHand,
    parLevel: row.parLevel,
    reorderPoint: row.reorderPoint,
    reorderQuantity: row.reorderQuantity,
    unit: row.unit,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    stockItem: row.stockItem
  };
}

async function loadDelivery(id: string, actor?: AuthUser | null) {
  const row = await prisma.stockDeliveryCheck.findFirst({
    where: { id, ...(actorVenueScope(actor) ? { venue: actorVenueScope(actor) as string } : {}) },
    include: {
      supplier: { select: { id: true, name: true } },
      items: { orderBy: { createdAt: 'asc' }, include: { stockItem: { select: itemSelect } } }
    }
  });
  if (!row) throw new HttpError(404, 'Delivery check not found');
  return row;
}

export const stockOperationsService = {
  async listWastage(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockWastagePayload> {
    const venue = actorVenueScope(actor, requestedVenue);
    const [records, items, venues] = await Promise.all([
      prisma.stockWastageRecord.findMany({
        where: venue ? { venue } : {},
        include: { stockItem: { select: itemSelect } },
        orderBy: { wastedAt: 'desc' },
        take: 100
      }),
      itemsForActor(actor, venue),
      venuesForActor(actor)
    ]);
    return {
      records: records.map(toWastagePayload),
      items,
      venues,
      scope: { venue, admin: isAdminActor(actor) }
    };
  },

  async createWastage(input: unknown, actor?: AuthUser | null): Promise<StockWastageRecord> {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = stockWastageCreateInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue);
    if (!venue) throw new HttpError(400, 'Venue is required');
    await assertKnownVenue(venue, actor);

    const created = await prisma.$transaction(async (tx) => {
      const { item } = await getVenueStock(tx, data.stockItemId, venue);
      const wastage = await tx.stockWastageRecord.create({
        data: {
          stockItemId: data.stockItemId,
          venue,
          quantity: data.quantity,
          unit: data.unit,
          reason: data.reason,
          note: textOrNull(data.note),
          wastedAt: dateOrNow(data.wastedAt),
          recordedById: actor.id,
          costImpactCents: moneyImpactCents(data.quantity, item.avgCostCents)
        },
        include: { stockItem: { select: itemSelect } }
      });
      await adjustVenueOnHand(tx, {
        stockItemId: data.stockItemId,
        venue,
        quantityDelta: -Math.abs(data.quantity),
        movementType: 'WASTAGE',
        unit: data.unit,
        notes: `Wastage: ${data.reason}${data.note ? ` — ${data.note}` : ''}`,
        sourceWastageId: wastage.id
      });
      return wastage;
    });

    return toWastagePayload(created);
  },

  async listDeliveries(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockDeliveryChecksPayload> {
    const venue = actorVenueScope(actor, requestedVenue);
    const [checks, items, suppliers, venues] = await Promise.all([
      prisma.stockDeliveryCheck.findMany({
        where: venue ? { venue } : {},
        include: {
          supplier: { select: { id: true, name: true } },
          items: { orderBy: { createdAt: 'asc' }, include: { stockItem: { select: itemSelect } } }
        },
        orderBy: { deliveryDate: 'desc' },
        take: 80
      }),
      itemsForActor(actor, venue),
      prisma.supplier.findMany({ where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } }),
      venuesForActor(actor)
    ]);
    return {
      checks: checks.map(toDeliveryPayload),
      items,
      suppliers: suppliers.map((supplier) => ({
        id: supplier.id,
        legacyId: supplier.legacyId,
        name: supplier.name,
        contactName: supplier.contactName,
        email: supplier.email,
        phone: supplier.phone,
        website: supplier.website,
        address: supplier.address,
        accountNumber: supplier.accountNumber,
        paymentTerms: supplier.paymentTerms,
        notes: supplier.notes,
        status: supplier.status,
        createdAt: supplier.createdAt.toISOString(),
        updatedAt: supplier.updatedAt.toISOString()
      })),
      venues,
      scope: { venue, admin: isAdminActor(actor) }
    };
  },

  async createDelivery(input: unknown, actor?: AuthUser | null): Promise<StockDeliveryCheck> {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = stockDeliveryCheckCreateInputSchema.parse(input);
    const venue = actorVenueScope(actor, data.venue);
    if (!venue) throw new HttpError(400, 'Venue is required');
    const row = await prisma.stockDeliveryCheck.create({
      data: {
        supplierId: textOrNull(data.supplierId),
        supplierName: data.supplierName.trim(),
        venue,
        invoiceNumber: textOrNull(data.invoiceNumber),
        deliveryDate: dateOrNow(data.deliveryDate),
        invoiceReference: textOrNull(data.invoiceReference),
        notes: textOrNull(data.notes),
        createdById: actor.id,
        items: {
          create: data.items.map((item) => ({
            stockItemId: textOrNull(item.stockItemId),
            description: item.description.trim(),
            expectedQuantity: item.expectedQuantity ?? null,
            receivedQuantity: item.receivedQuantity ?? null,
            unit: textOrNull(item.unit),
            checked: item.checked ?? false,
            discrepancy: item.discrepancy ?? false,
            discrepancyReason: textOrNull(item.discrepancyReason),
            notes: textOrNull(item.notes)
          }))
        }
      }
    });
    return toDeliveryPayload(await loadDelivery(row.id, actor));
  },

  async updateDelivery(id: string, input: unknown, actor?: AuthUser | null): Promise<StockDeliveryCheck> {
    const existing = await loadDelivery(id, actor);
    if (existing.status === 'COMPLETED') throw new HttpError(409, 'Completed delivery checks cannot be edited');
    const data = stockDeliveryCheckUpdateInputSchema.parse(input);
    const venue = data.venue ? actorVenueScope(actor, data.venue) : existing.venue;
    if (!venue) throw new HttpError(400, 'Venue is required');
    const row = await prisma.$transaction(async (tx) => {
      if (data.items) await tx.stockDeliveryCheckItem.deleteMany({ where: { deliveryCheckId: id } });
      await tx.stockDeliveryCheck.update({
        where: { id },
        data: {
          ...(data.supplierId !== undefined && { supplierId: textOrNull(data.supplierId) }),
          ...(data.supplierName !== undefined && { supplierName: data.supplierName.trim() }),
          ...(data.venue !== undefined && { venue }),
          ...(data.invoiceNumber !== undefined && { invoiceNumber: textOrNull(data.invoiceNumber) }),
          ...(data.deliveryDate !== undefined && { deliveryDate: dateOrNow(data.deliveryDate) }),
          ...(data.invoiceReference !== undefined && { invoiceReference: textOrNull(data.invoiceReference) }),
          ...(data.notes !== undefined && { notes: textOrNull(data.notes) }),
          ...(data.status !== undefined && { status: data.status }),
          ...(data.items && {
            items: {
              create: data.items.map((item) => ({
                stockItemId: textOrNull(item.stockItemId),
                description: item.description.trim(),
                expectedQuantity: item.expectedQuantity ?? null,
                receivedQuantity: item.receivedQuantity ?? null,
                unit: textOrNull(item.unit),
                checked: item.checked ?? false,
                discrepancy: item.discrepancy ?? false,
                discrepancyReason: textOrNull(item.discrepancyReason),
                notes: textOrNull(item.notes)
              }))
            }
          })
        }
      });
      return tx.stockDeliveryCheck.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: { select: { id: true, name: true } },
          items: { orderBy: { createdAt: 'asc' }, include: { stockItem: { select: itemSelect } } }
        }
      });
    });
    return toDeliveryPayload(row);
  },

  async completeDelivery(id: string, actor?: AuthUser | null): Promise<StockDeliveryCheck> {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const existing = await loadDelivery(id, actor);
    if (existing.status === 'COMPLETED') throw new HttpError(409, 'Delivery check is already completed');
    const hasDiscrepancy = existing.items.some((item) => item.discrepancy);

    await prisma.$transaction(async (tx) => {
      for (const item of existing.items) {
        if (!item.stockItemId || !item.receivedQuantity || item.receivedQuantity <= 0) continue;
        await adjustVenueOnHand(tx, {
          stockItemId: item.stockItemId,
          venue: existing.venue,
          quantityDelta: item.receivedQuantity,
          movementType: 'DELIVERY_RECEIPT',
          unit: item.unit,
          notes: `Delivery receipt: ${existing.supplierName}${existing.invoiceNumber ? ` invoice ${existing.invoiceNumber}` : ''}`,
          sourceDeliveryCheckItemId: item.id
        });
      }
      await tx.stockDeliveryCheck.update({
        where: { id },
        data: {
          status: hasDiscrepancy ? 'DISCREPANCY' : 'COMPLETED',
          completedAt: new Date(),
          completedById: actor.id
        }
      });
    });
    return toDeliveryPayload(await loadDelivery(id, actor));
  },

  async listReorderNotices(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockReorderNoticesPayload> {
    const venue = actorVenueScope(actor, requestedVenue);
    const venueRows = await prisma.venueStockItem.findMany({
      where: {
        ...(venue ? { venue } : {}),
        active: true,
        stockItem: { status: 'ACTIVE' }
      },
      include: { stockItem: { select: itemSelect } }
    });
    await prisma.$transaction(async (tx) => {
      for (const row of venueRows) await evaluateReorderForItem(tx, row.stockItemId, row.venue);
    });
    const [notices, venues] = await Promise.all([
      prisma.stockReorderNotice.findMany({
        where: { ...(venue ? { venue } : {}), status: 'OPEN' },
        include: { stockItem: { select: itemSelect } },
        orderBy: { updatedAt: 'desc' }
      }),
      venuesForActor(actor)
    ]);
    const lowStockItems = venueRows
      .filter((row) => {
        const threshold = row.reorderPoint ?? row.parLevel ?? row.stockItem.reorderPoint ?? row.stockItem.parLevel;
        return row.onHand !== null && threshold > 0 && row.onHand <= threshold;
      })
      .map((row) => {
        const parLevel = row.parLevel ?? row.stockItem.parLevel;
        const reorderPoint = row.reorderPoint ?? row.stockItem.reorderPoint;
        const threshold = reorderPoint ?? parLevel;
        const unit = row.unitOverride ?? row.stockItem.unit;
        return {
          id: row.stockItem.id,
          venueStockItemId: row.id,
          venue: row.venue,
          sku: row.stockItem.sku,
          name: row.stockItem.name,
          category: row.stockItem.category,
          unit,
          onHand: row.onHand,
          parLevel,
          reorderPoint,
          status: 'ACTIVE' as const,
          updatedAt: row.updatedAt.toISOString(),
          threshold,
          stockStatus: (row.onHand ?? 0) <= 0 ? 'OUT_OF_STOCK' as const : reorderPoint && (row.onHand ?? 0) <= reorderPoint ? 'LOW_STOCK' as const : 'BELOW_PAR' as const,
          suggestedAction: (row.onHand ?? 0) <= 0 ? 'Out of stock' : reorderPoint && (row.onHand ?? 0) <= reorderPoint ? 'Order soon' : 'Below par'
        };
      });
    return { notices: notices.map(toReorderPayload), lowStockItems, venues, scope: { venue, admin: isAdminActor(actor) } };
  },

  async resolveReorderNotice(id: string, input: unknown, actor?: AuthUser | null): Promise<StockReorderNotice> {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = stockReorderNoticeResolveInputSchema.parse(input);
    const existing = await prisma.stockReorderNotice.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Reorder notice not found');
    actorVenueScope(actor, existing.venue);
    const row = await prisma.stockReorderNotice.update({
      where: { id },
      data: data.status === 'DISMISSED'
        ? { status: 'DISMISSED', dismissedAt: new Date(), dismissedById: actor.id }
        : { status: 'RESOLVED', resolvedAt: new Date(), resolvedById: actor.id },
      include: { stockItem: { select: itemSelect } }
    });
    return toReorderPayload(row);
  }
};
