import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

// Purchase-order lifecycle: DRAFT → SENT → PARTIALLY_RECEIVED / RECEIVED → MATCHED.
// Receiving posts DELIVERY_RECEIPT movements and lifts venue on-hand; matching
// compares the PO against a supplier invoice (3-way: ordered vs received vs
// billed) and against the supplier price catalogue.

type PoStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'MATCHED' | 'CANCELLED';

function isAdmin(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function actorVenueScope(actor?: AuthUser | null, requested?: string | null) {
  const venue = requested?.trim() || null;
  if (!actor || isAdmin(actor)) return venue;
  if (!actor.venue) throw new HttpError(403, 'Stock access requires a venue-scoped staff profile.');
  if (venue && venue !== actor.venue) throw new HttpError(403, 'Stock access is limited to your venue.');
  return actor.venue;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
function optText(value: unknown): string | null {
  const t = text(value);
  return t || null;
}
function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function dateOrNull(value: unknown): Date | null {
  const t = text(value);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
function centsFromDollars(value: unknown): number {
  return Math.round(num(value) * 100);
}

type LineInput = {
  id?: string;
  stockItemId?: string | null;
  description: string;
  orderedQuantity: number;
  unit?: string | null;
  unitCostCents: number;
};

function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const description = text(record.description) || text(record.name);
      const orderedQuantity = num(record.orderedQuantity ?? record.quantity);
      if (!description || orderedQuantity <= 0) return null;
      const unitCostCents =
        record.unitCostCents !== undefined ? Math.round(num(record.unitCostCents)) : centsFromDollars(record.unitCost);
      const line: LineInput = {
        stockItemId: optText(record.stockItemId),
        description,
        orderedQuantity,
        unit: optText(record.unit),
        unitCostCents: Math.max(0, unitCostCents)
      };
      return line;
    })
    .filter((line): line is LineInput => line !== null);
}

const poInclude = {
  supplier: { select: { id: true, name: true, email: true } },
  lines: { include: { stockItem: { select: { id: true, name: true, unit: true, countUnit: true } } } },
  matchedInvoice: { select: { id: true, invoiceNumber: true, totalCents: true } }
} satisfies Prisma.PurchaseOrderInclude;

async function resolveSupplierId(supplierId: string | null, supplierName: string): Promise<string | null> {
  if (supplierId) return supplierId;
  const canonical = supplierName.trim().toLowerCase();
  if (!canonical) return null;
  const candidates = await prisma.supplier.findMany({ select: { id: true, name: true } });
  return candidates.find((s) => s.name.trim().toLowerCase() === canonical)?.id ?? null;
}

async function loadPo(id: string, actor?: AuthUser | null) {
  const venue = actorVenueScope(actor);
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, ...(venue ? { venue } : {}) },
    include: poInclude
  });
  if (!po) throw new HttpError(404, 'Purchase order not found');
  return po;
}

// Lift venue on-hand and record a DELIVERY_RECEIPT movement for a received line.
async function receiveIntoStock(
  tx: Prisma.TransactionClient,
  params: { stockItemId: string; venue: string; quantity: number; unit: string | null; poRef: string }
) {
  const item = await tx.stockItem.findUnique({ where: { id: params.stockItemId }, select: { id: true, onHand: true } });
  if (!item) return;
  const vsi = await tx.venueStockItem.upsert({
    where: { venue_stockItemId: { venue: params.venue, stockItemId: params.stockItemId } },
    create: { venue: params.venue, stockItemId: params.stockItemId, onHand: item.onHand, active: true },
    update: {},
    select: { id: true, onHand: true }
  });
  const before = vsi.onHand ?? 0;
  const after = before + params.quantity;
  await tx.venueStockItem.update({ where: { id: vsi.id }, data: { onHand: after, active: true } });
  await tx.inventoryMovement.create({
    data: {
      itemId: params.stockItemId,
      movementType: 'DELIVERY_RECEIPT',
      quantityDelta: params.quantity,
      quantityBefore: before,
      quantityAfter: after,
      unit: params.unit,
      notes: `PO receipt: ${params.poRef}`
    }
  });
}

export const purchaseOrdersService = {
  async list(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue);
    const orders = await prisma.purchaseOrder.findMany({
      where: venue ? { venue } : {},
      include: poInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 100
    });
    const venues = isAdmin(actor)
      ? (await prisma.venueStockItem.findMany({ distinct: ['venue'], where: { active: true }, select: { venue: true }, orderBy: { venue: 'asc' } })).map((v) => v.venue)
      : actor?.venue
        ? [actor.venue]
        : [];
    const suppliers = await prisma.supplier.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    });
    return { orders, venues, suppliers, scope: { venue, admin: isAdmin(actor) } };
  },

  async get(id: string, actor?: AuthUser | null) {
    return loadPo(id, actor);
  },

  async create(input: unknown, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = (input ?? {}) as Record<string, unknown>;
    const supplierName = text(data.supplierName);
    if (!supplierName) throw new HttpError(400, 'Supplier is required');
    const venue = actorVenueScope(actor, optText(data.venue));
    if (!venue) throw new HttpError(400, 'Venue is required');
    const lines = parseLines(data.lines);
    if (!lines.length) throw new HttpError(400, 'Add at least one order line');
    const subtotalCents = lines.reduce((sum, l) => sum + Math.round(l.unitCostCents * l.orderedQuantity), 0);
    const supplierId = await resolveSupplierId(optText(data.supplierId), supplierName);
    const created = await prisma.purchaseOrder.create({
      data: {
        supplierId,
        supplierName,
        venue,
        reference: optText(data.reference),
        status: 'DRAFT',
        expectedAt: dateOrNull(data.expectedAt),
        notes: optText(data.notes),
        subtotalCents,
        createdById: actor.id,
        lines: {
          create: lines.map((l) => ({
            stockItemId: l.stockItemId,
            description: l.description,
            orderedQuantity: l.orderedQuantity,
            unit: l.unit,
            unitCostCents: l.unitCostCents,
            lineTotalCents: Math.round(l.unitCostCents * l.orderedQuantity)
          }))
        }
      },
      include: poInclude
    });
    return created;
  },

  async update(id: string, input: unknown, actor?: AuthUser | null) {
    const existing = await loadPo(id, actor);
    if (existing.status !== 'DRAFT') throw new HttpError(409, 'Only draft purchase orders can be edited');
    const data = (input ?? {}) as Record<string, unknown>;
    const lines = parseLines(data.lines);
    if (!lines.length) throw new HttpError(400, 'Add at least one order line');
    const supplierName = text(data.supplierName) || existing.supplierName;
    const subtotalCents = lines.reduce((sum, l) => sum + Math.round(l.unitCostCents * l.orderedQuantity), 0);
    await prisma.$transaction([
      prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } }),
      prisma.purchaseOrder.update({
        where: { id },
        data: {
          supplierName,
          supplierId: await resolveSupplierId(optText(data.supplierId), supplierName),
          reference: optText(data.reference),
          expectedAt: dateOrNull(data.expectedAt),
          notes: optText(data.notes),
          subtotalCents,
          lines: {
            create: lines.map((l) => ({
              stockItemId: l.stockItemId,
              description: l.description,
              orderedQuantity: l.orderedQuantity,
              unit: l.unit,
              unitCostCents: l.unitCostCents,
              lineTotalCents: Math.round(l.unitCostCents * l.orderedQuantity)
            }))
          }
        }
      })
    ]);
    return loadPo(id, actor);
  },

  async setStatus(id: string, status: PoStatus, actor?: AuthUser | null) {
    const existing = await loadPo(id, actor);
    if (existing.status === 'MATCHED') throw new HttpError(409, 'A matched purchase order is closed');
    await prisma.purchaseOrder.update({
      where: { id },
      data: { status, ...(status === 'SENT' ? { orderedAt: new Date() } : {}) }
    });
    return loadPo(id, actor);
  },

  // Receive: set received quantities, lift on-hand, post movements, update status.
  async receive(id: string, input: unknown, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const existing = await loadPo(id, actor);
    if (existing.status === 'CANCELLED' || existing.status === 'MATCHED') {
      throw new HttpError(409, `Cannot receive a ${existing.status.toLowerCase()} purchase order`);
    }
    if (!existing.venue) throw new HttpError(400, 'Purchase order has no venue');
    const venue = existing.venue;
    const data = (input ?? {}) as Record<string, unknown>;
    const receiptById = new Map<string, number>();
    if (Array.isArray(data.lines)) {
      for (const entry of data.lines as Array<Record<string, unknown>>) {
        const lineId = text(entry.id);
        if (lineId) receiptById.set(lineId, Math.max(0, num(entry.receivedQuantity)));
      }
    }
    const poRef = existing.reference || existing.id.slice(0, 8);

    await prisma.$transaction(async (tx) => {
      for (const line of existing.lines) {
        // Default: receive the full ordered qty unless a specific value was sent.
        const received = receiptById.has(line.id) ? receiptById.get(line.id)! : line.orderedQuantity;
        const alreadyReceived = line.receivedQuantity ?? 0;
        const delta = received - alreadyReceived;
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQuantity: received } });
        if (line.stockItemId && Math.abs(delta) > 0.0001) {
          await receiveIntoStock(tx, { stockItemId: line.stockItemId, venue, quantity: delta, unit: line.unit, poRef });
        }
      }
      const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id }, select: { orderedQuantity: true, receivedQuantity: true } });
      const fully = lines.every((l) => (l.receivedQuantity ?? 0) >= l.orderedQuantity - 0.0001);
      const any = lines.some((l) => (l.receivedQuantity ?? 0) > 0.0001);
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: fully ? 'RECEIVED' : any ? 'PARTIALLY_RECEIVED' : existing.status, receivedAt: fully ? new Date() : existing.receivedAt }
      });
    });
    return loadPo(id, actor);
  },

  // 3-way match: ordered vs received vs the linked invoice's billed amount.
  async match(id: string, input: unknown, actor?: AuthUser | null) {
    const existing = await loadPo(id, actor);
    const data = (input ?? {}) as Record<string, unknown>;
    const invoiceId = optText(data.invoiceId);
    if (!invoiceId) throw new HttpError(400, 'Select an invoice to match against');
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { select: { description: true, quantity: true, lineAmountCents: true, itemId: true } } }
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');

    const orderedTotal = existing.subtotalCents;
    const billedTotal = invoice.subtotalCents || invoice.totalCents;
    const receivedTotal = existing.lines.reduce((sum, l) => sum + Math.round(l.unitCostCents * (l.receivedQuantity ?? 0)), 0);
    const discrepancies: Array<{ description: string; issue: string }> = [];
    // Line-level: match invoice line to PO line by stock item, else by description.
    for (const poLine of existing.lines) {
      const inv = invoice.lines.find((il) =>
        (poLine.stockItemId && il.itemId === poLine.stockItemId) ||
        il.description.trim().toLowerCase() === poLine.description.trim().toLowerCase()
      );
      if (!inv) {
        discrepancies.push({ description: poLine.description, issue: 'Not found on the invoice' });
        continue;
      }
      const poLineTotal = Math.round(poLine.unitCostCents * poLine.orderedQuantity);
      if (Math.abs(inv.lineAmountCents - poLineTotal) > 50) {
        discrepancies.push({
          description: poLine.description,
          issue: `Billed ${(inv.lineAmountCents / 100).toFixed(2)} vs ordered ${(poLineTotal / 100).toFixed(2)}`
        });
      }
      if (poLine.receivedQuantity != null && inv.quantity != null && Math.abs(inv.quantity - poLine.receivedQuantity) > 0.01) {
        discrepancies.push({ description: poLine.description, issue: `Billed qty ${inv.quantity} vs received ${poLine.receivedQuantity}` });
      }
    }

    await prisma.purchaseOrder.update({ where: { id }, data: { matchedInvoiceId: invoiceId, status: 'MATCHED' } });
    const po = await loadPo(id, actor);
    return {
      purchaseOrder: po,
      match: {
        orderedTotalCents: orderedTotal,
        receivedTotalCents: receivedTotal,
        billedTotalCents: billedTotal,
        totalVarianceCents: billedTotal - receivedTotal,
        discrepancies,
        clean: discrepancies.length === 0
      }
    };
  },

  // ── Supplier price catalogue ──────────────────────────────────────
  async listPriceList(actor?: AuthUser | null, supplierId?: string | null) {
    return prisma.supplierPriceListItem.findMany({
      where: supplierId ? { supplierId } : {},
      include: { supplier: { select: { id: true, name: true } }, stockItem: { select: { id: true, name: true } } },
      orderBy: [{ supplier: { name: 'asc' } }, { description: 'asc' }],
      take: 500
    });
  },

  async upsertPriceListItem(input: unknown, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = (input ?? {}) as Record<string, unknown>;
    const supplierId = optText(data.supplierId);
    if (!supplierId) throw new HttpError(400, 'Supplier is required');
    const description = text(data.description);
    if (!description) throw new HttpError(400, 'Description is required');
    const stockItemId = optText(data.stockItemId);
    const unitCostCents = data.unitCostCents !== undefined ? Math.round(num(data.unitCostCents)) : centsFromDollars(data.unitCost);
    if (stockItemId) {
      return prisma.supplierPriceListItem.upsert({
        where: { supplierId_stockItemId: { supplierId, stockItemId } },
        create: { supplierId, stockItemId, description, unit: optText(data.unit), unitCostCents, effectiveAt: new Date() },
        update: { description, unit: optText(data.unit), unitCostCents, effectiveAt: new Date() },
        include: { supplier: { select: { id: true, name: true } }, stockItem: { select: { id: true, name: true } } }
      });
    }
    return prisma.supplierPriceListItem.create({
      data: { supplierId, stockItemId: null, description, unit: optText(data.unit), unitCostCents, effectiveAt: new Date() },
      include: { supplier: { select: { id: true, name: true } }, stockItem: { select: { id: true, name: true } } }
    });
  },

  async deletePriceListItem(id: string, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    await prisma.supplierPriceListItem.delete({ where: { id } }).catch(() => undefined);
    return { ok: true };
  }
};
