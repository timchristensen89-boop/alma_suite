import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  orderQuantityToPar,
  holdBackImplausibleGuideSuggestions,
  IMPLAUSIBLE_COUNT_SHARE,
  IMPLAUSIBLE_COUNT_FLOOR_CENTS,
  stockPurchaseOrderBatchInputSchema,
  stockPurchaseOrderSendInputSchema,
  type AuthUser,
  type StockFullOrderGuidePayload,
  type StockOrderGuideLine,
  type StockOrderGuidePayload,
  type StockPurchaseOrderSendEmail
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { sendStockEmail } from '../lib/resend.js';
import { actorPinnedVenue, isVenueUnscopedActor } from '../lib/venue-scope.js';
import { itemsService } from './items.service.js';

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
  if (!actor || isVenueUnscopedActor(actor)) return venue;
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

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const QTY = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 2 });

// The email a supplier receives. Plain text on purpose: every wholesaler's
// inbox can read it, nothing renders "creatively" on an old warehouse PC, and
// the exact same text is what gets stored on the order and what the UI offers
// for copy-paste when email isn't configured.
function buildPurchaseOrderEmail(
  po: {
    supplierName: string;
    venue: string | null;
    reference: string | null;
    expectedAt: Date | null;
    notes: string | null;
    subtotalCents: number;
    lines: Array<{ description: string; orderedQuantity: number; unit: string | null; unitCostCents: number }>;
  },
  message?: string | null
) {
  const where = po.venue ?? 'Alma';
  const subject = `Alma purchase order - ${where}${po.reference ? ` (${po.reference})` : ''}`;
  const anyPrice = po.lines.some((line) => line.unitCostCents > 0);
  const body = [
    `Hi ${po.supplierName},`,
    '',
    `Please supply the following order for ${where}:`,
    message?.trim() ? '' : null,
    message?.trim() ? message.trim() : null,
    '',
    ...po.lines.map((line) => {
      const qty = QTY.format(line.orderedQuantity);
      const unit = line.unit ? ` ${line.unit}` : '';
      // Our expected price rides along when we know it — the supplier seeing
      // what we last paid is half of holding prices steady.
      const price = line.unitCostCents > 0 ? ` @ ${AUD.format(line.unitCostCents / 100)}` : '';
      return `- ${qty}${unit} x ${line.description}${price}`;
    }),
    '',
    anyPrice && po.subtotalCents > 0 ? `Expected total: ${AUD.format(po.subtotalCents / 100)}` : null,
    po.expectedAt
      ? `Delivery needed by: ${po.expectedAt.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}`
      : null,
    po.reference ? `Our reference: ${po.reference}` : null,
    po.notes?.trim() ? `Notes: ${po.notes.trim()}` : null,
    '',
    'Please reply to confirm.',
    '',
    'Thanks,',
    'Alma Stock'
  ]
    .filter((line): line is string => line !== null)
    .filter((line, index, values) => line || values[index - 1] !== '')
    .join('\n');
  return { subject, body };
}

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
  /**
   * What needs ordering, grouped by who to buy it from.
   *
   * This is the step the app was missing entirely. Production had 664
   * low-stock notices and zero purchase orders ever created: it could say what
   * was running out, and then there was nowhere to go. Quantities come back in
   * whole purchase units at the last price actually paid, so a suggestion can
   * become an order without anybody retyping it.
   */
  async suggestions(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue ?? null);

    // Par levels are held per venue, not on the item — every one of the 716
    // items has an item-level par of 0, while 444 and 506 venue rows carry
    // real ones. Without a venue there is nothing to compare on-hand against,
    // and returning an empty list would read as "nothing to order" when the
    // truth is "you have not said where".
    if (!venue) {
      return {
        venue: null,
        suppliers: [],
        itemsBelowPar: 0,
        itemsWithNoSupplier: 0,
        needsVenue: true,
        generatedAt: new Date().toISOString()
      };
    }

    const [items, facts, openOrderLines] = await Promise.all([
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true, name: true, unit: true, countUnit: true, conversionFactor: true,
          parLevel: true, reorderPoint: true, onHand: true, latestCostCents: true,
          venueStock: { where: { venue }, select: { onHand: true, parLevel: true, reorderPoint: true } }
        }
      }),
      itemsService.purchaseFacts(),
      // Stock already on the way must not be ordered a second time.
      prisma.purchaseOrderLine.findMany({
        where: {
          stockItemId: { not: null },
          purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] }, ...(venue ? { venue } : {}) }
        },
        select: { stockItemId: true, orderedQuantity: true, receivedQuantity: true }
      })
    ]);

    const onOrderByItem = new Map<string, number>();
    for (const line of openOrderLines) {
      if (!line.stockItemId) continue;
      const outstanding = Math.max(0, line.orderedQuantity - (line.receivedQuantity ?? 0));
      onOrderByItem.set(line.stockItemId, (onOrderByItem.get(line.stockItemId) ?? 0) + outstanding);
    }

    const groups = new Map<string, {
      supplierId: string | null;
      supplierName: string;
      lines: Array<Record<string, unknown>>;
      subtotalCents: number;
    }>();
    let itemsBelowPar = 0;
    let itemsWithNoSupplier = 0;

    for (const item of items) {
      const venueRow = Array.isArray(item.venueStock) ? item.venueStock[0] : null;
      const onHand = venueRow?.onHand ?? item.onHand;
      const parLevel = venueRow?.parLevel ?? item.parLevel;
      if (!parLevel || parLevel <= 0) continue;

      const factor = item.conversionFactor && item.conversionFactor > 0 ? item.conversionFactor : 1;
      const onOrderCountUnits = (onOrderByItem.get(item.id) ?? 0) * factor;
      const quantity = orderQuantityToPar({
        onHand,
        parLevel,
        conversionFactor: factor,
        onOrder: onOrderCountUnits
      });
      if (quantity <= 0) continue;
      itemsBelowPar += 1;

      const fact = facts.get(item.id) ?? null;
      if (!fact?.supplierId) itemsWithNoSupplier += 1;

      const key = fact?.supplierId ?? '__none__';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId: fact?.supplierId ?? null,
          supplierName: fact?.supplierName ?? 'No known supplier',
          lines: [],
          subtotalCents: 0
        });
      }
      const group = groups.get(key)!;
      // Null rather than 0 when nothing has ever been paid: a zero would total
      // up into an order that looks free.
      const unitCostCents = fact?.lastPriceCents ?? item.latestCostCents ?? null;
      group.lines.push({
        stockItemId: item.id,
        description: item.name,
        unit: item.unit,
        orderedQuantity: quantity,
        unitCostCents,
        lineTotalCents: unitCostCents === null ? null : Math.round(unitCostCents * quantity),
        onHand,
        parLevel,
        onOrder: onOrderByItem.get(item.id) ?? 0,
        lastPurchasedAt: fact?.lastPurchasedAt ?? null,
        priceMovement: fact?.priceMovement ?? null
      });
      if (unitCostCents !== null) group.subtotalCents += Math.round(unitCostCents * quantity);
    }

    // Par levels derived from a count made in the wrong unit produce order
    // lines nobody would ever place: St Alma's suggestion was $2.17M, 99% of
    // it five lines, the worst being 21,724 bottles of gin because someone
    // counted millilitres. Proposing those alongside real ones makes the whole
    // screen untrustworthy — which is why not one purchase order has ever been
    // raised in production. So they come out of the totals and are listed
    // separately for somebody to fix at the item.
    const allLines = [...groups.values()].flatMap((group) => group.lines);
    const suggestedTotal = allLines.reduce(
      (sum, line) => sum + Math.max(0, Number(line.lineTotalCents) || 0),
      0
    );
    const needsCheck: Array<Record<string, unknown>> = [];
    if (suggestedTotal > 0) {
      for (const group of groups.values()) {
        const keep: Array<Record<string, unknown>> = [];
        for (const line of group.lines) {
          const cents = Math.max(0, Number(line.lineTotalCents) || 0);
          const share = cents / suggestedTotal;
          if (cents >= IMPLAUSIBLE_COUNT_FLOOR_CENTS && share >= IMPLAUSIBLE_COUNT_SHARE) {
            needsCheck.push({ ...line, supplierName: group.supplierName, shareOfSuggested: Math.round(share * 100) / 100 });
            group.subtotalCents -= cents;
            continue;
          }
          keep.push(line);
        }
        group.lines = keep;
      }
    }

    const suppliers = [...groups.values()]
      .filter((group) => group.lines.length > 0)
      .sort((a, b) => {
        if (a.supplierId === null) return 1;
        if (b.supplierId === null) return -1;
        return b.subtotalCents - a.subtotalCents;
      });

    return {
      venue,
      suppliers,
      // Order lines left out of the totals because the par behind them cannot
      // be right. Named so the screen can say so rather than quietly dropping
      // them: the stock still needs ordering, the par just needs fixing first.
      needsCheck,
      needsCheckTotalCents: needsCheck.reduce((sum, line) => sum + (Number(line.lineTotalCents) || 0), 0),
      itemsBelowPar,
      // Honest about the gap rather than quietly dropping these: an item with
      // no purchase history still needs ordering, somebody just has to say
      // from whom.
      itemsWithNoSupplier,
      needsVenue: false,
      generatedAt: new Date().toISOString()
    };
  },

  async list(actor?: AuthUser | null, requestedVenue?: string | null) {
    const venue = actorVenueScope(actor, requestedVenue);
    const orders = await prisma.purchaseOrder.findMany({
      where: venue ? { venue } : {},
      include: poInclude,
      orderBy: [{ createdAt: 'desc' }],
      take: 100
    });
    const pinnedVenue = actorPinnedVenue(actor);
    const venues = pinnedVenue
      ? [pinnedVenue]
      : (await prisma.venueStockItem.findMany({ distinct: ['venue'], where: { active: true }, select: { venue: true }, orderBy: { venue: 'asc' } })).map((v) => v.venue);
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

  /**
   * Send the order to the supplier — for real.
   *
   * "Send" used to be a status flip: production had the button, the supplier
   * never received anything, and the actual ordering happened in a parallel
   * unpersisted email path on the reorder screen. Now one action does both:
   * the email goes out (Resend), and what was sent — address, subject, body —
   * is stored on the order.
   *
   * Degrades instead of blocking: no supplier email, or email not configured,
   * still marks the order SENT (it may go by phone) and hands back the exact
   * text to copy, with a warning saying why it wasn't delivered.
   */
  async send(id: string, input: unknown, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = stockPurchaseOrderSendInputSchema.parse(input ?? {});
    const existing = await loadPo(id, actor);
    if (existing.status !== 'DRAFT' && existing.status !== 'SENT') {
      throw new HttpError(409, `A ${existing.status.toLowerCase().replace('_', ' ')} purchase order cannot be sent`);
    }
    const to = (data.to?.trim() || existing.supplier?.email || '').trim() || null;
    const { subject, body } = buildPurchaseOrderEmail(existing, data.message ?? null);

    let status: StockPurchaseOrderSendEmail['status'];
    if (!to) {
      status = 'NO_RECIPIENT';
    } else {
      status = (await sendStockEmail({ to, subject, body })) ? 'SENT' : 'EMAIL_NOT_CONFIGURED';
    }
    const delivered = status === 'SENT';
    const now = new Date();
    await prisma.purchaseOrder.update({
      where: { id },
      data: {
        status: 'SENT',
        orderedAt: existing.orderedAt ?? now,
        sentSubject: subject,
        sentBody: body,
        ...(delivered ? { sentAt: now, sentTo: to } : {})
      }
    });

    const email: StockPurchaseOrderSendEmail = {
      status,
      to,
      subject,
      body,
      sentAt: delivered ? now.toISOString() : null,
      warning: delivered
        ? null
        : status === 'NO_RECIPIENT'
          ? 'The supplier has no email address — copy the order text below, and add their email on the Suppliers tab for next time.'
          : 'Stock supplier email is not configured. Copy the order text, or add RESEND_API_KEY and STOCK_ORDER_EMAIL_FROM.'
    };
    return { purchaseOrder: await loadPo(id, actor), email };
  },

  /**
   * The order guide: everything we buy from one supplier, priced and ready to
   * order — the way FoodByUs presents a supplier's list.
   *
   * Two sources merge. The supplier price list carries the agreed price (kept
   * current automatically whenever an invoice cost is applied), and invoice
   * history carries what was actually last paid. An item can be in either or
   * both; showing both prices side by side is the whole point — that gap is a
   * price rise nobody has agreed to.
   */
  async orderGuide(actor: AuthUser | null | undefined, supplierId: string, requestedVenue?: string | null): Promise<StockOrderGuidePayload> {
    const venue = actorVenueScope(actor, requestedVenue ?? null);
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true, name: true, email: true }
    });
    if (!supplier) throw new HttpError(404, 'Supplier not found');

    const [priceList, facts] = await Promise.all([
      prisma.supplierPriceListItem.findMany({
        where: { supplierId },
        include: { stockItem: { select: { id: true, name: true, unit: true } } }
      }),
      itemsService.purchaseFacts()
    ]);

    const byKey = new Map<string, StockOrderGuideLine>();
    const keyFor = (stockItemId: string | null, description: string) =>
      stockItemId ?? `desc:${description.trim().toLowerCase()}`;

    for (const row of priceList) {
      const key = keyFor(row.stockItemId, row.description);
      byKey.set(key, {
        stockItemId: row.stockItemId,
        description: row.stockItem?.name ?? row.description,
        unit: row.unit ?? row.stockItem?.unit ?? null,
        onHand: null,
        parLevel: null,
        agreedCostCents: row.unitCostCents,
        agreedEffectiveAt: row.effectiveAt.toISOString(),
        lastPaidCents: null,
        lastPurchasedAt: null,
        priceMovement: null,
        suggestedQuantity: 0
      });
    }

    // Items whose purchase history says this supplier is where they come from.
    const historyItemIds: string[] = [];
    for (const [itemId, fact] of facts) {
      if (fact.supplierId !== supplierId) continue;
      historyItemIds.push(itemId);
      const key = keyFor(itemId, '');
      const line = byKey.get(key);
      if (line) {
        line.lastPaidCents = fact.lastPriceCents;
        line.lastPurchasedAt = fact.lastPurchasedAt;
        line.priceMovement = fact.priceMovement;
      } else {
        byKey.set(key, {
          stockItemId: itemId,
          description: '',
          unit: null,
          onHand: null,
          parLevel: null,
          agreedCostCents: null,
          agreedEffectiveAt: null,
          lastPaidCents: fact.lastPriceCents,
          lastPurchasedAt: fact.lastPurchasedAt,
          priceMovement: fact.priceMovement,
          suggestedQuantity: 0
        });
      }
    }

    // Names, units, on-hand, par and open orders for every item involved —
    // the guide shows where each line stands, not just what it costs.
    const itemIds = [...new Set([...priceList.map((row) => row.stockItemId), ...historyItemIds].filter((id): id is string => Boolean(id)))];
    if (itemIds.length > 0) {
      const [items, openOrderLines] = await Promise.all([
        prisma.stockItem.findMany({
          where: { id: { in: itemIds } },
          select: {
            id: true, name: true, unit: true, conversionFactor: true, parLevel: true, onHand: true,
            venueStock: venue ? { where: { venue }, select: { onHand: true, parLevel: true } } : false
          }
        }),
        prisma.purchaseOrderLine.findMany({
          where: {
            stockItemId: { in: itemIds },
            purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] }, ...(venue ? { venue } : {}) }
          },
          select: { stockItemId: true, orderedQuantity: true, receivedQuantity: true }
        })
      ]);
      const onOrderByItem = new Map<string, number>();
      for (const line of openOrderLines) {
        if (!line.stockItemId) continue;
        const outstanding = Math.max(0, line.orderedQuantity - (line.receivedQuantity ?? 0));
        onOrderByItem.set(line.stockItemId, (onOrderByItem.get(line.stockItemId) ?? 0) + outstanding);
      }
      for (const item of items) {
        const line = byKey.get(item.id);
        if (!line) continue;
        const venueRow = Array.isArray(item.venueStock) ? item.venueStock[0] : null;
        const onHand = venueRow?.onHand ?? item.onHand;
        const parLevel = venueRow?.parLevel ?? item.parLevel;
        const factor = item.conversionFactor && item.conversionFactor > 0 ? item.conversionFactor : 1;
        line.description = line.description || item.name;
        line.unit = line.unit ?? item.unit;
        line.onHand = onHand;
        line.parLevel = parLevel;
        line.suggestedQuantity =
          parLevel && parLevel > 0
            ? orderQuantityToPar({
                onHand,
                parLevel,
                conversionFactor: factor,
                onOrder: (onOrderByItem.get(item.id) ?? 0) * factor
              })
            : 0;
      }
    }

    const lines = [...byKey.values()]
      .filter((line) => line.description)
      .sort((a, b) => a.description.localeCompare(b.description));

    return { supplier, venue, lines, generatedAt: new Date().toISOString() };
  },

  /**
   * The whole ordering universe on one screen: every supplier's guide at once,
   * plus below-par items whose supplier nobody knows yet.
   *
   * The per-supplier guide asked the buyer to already know who sells what and
   * to work through suppliers one dropdown at a time. Real ordering runs the
   * other way — walk everything the venue buys, set quantities, and let the
   * orders split themselves by supplier at the end. Sources are the same two
   * as the per-supplier guide (agreed price lists and invoice history), so
   * anything ever bought or priced is on this list.
   */
  async fullOrderGuide(actor?: AuthUser | null, requestedVenue?: string | null): Promise<StockFullOrderGuidePayload> {
    const venue = actorVenueScope(actor, requestedVenue ?? null);

    const [suppliers, priceList, facts, items, openOrderLines] = await Promise.all([
      prisma.supplier.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      }),
      prisma.supplierPriceListItem.findMany({
        include: { stockItem: { select: { id: true, name: true, unit: true } } }
      }),
      itemsService.purchaseFacts(),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: {
          id: true, name: true, unit: true, conversionFactor: true,
          parLevel: true, onHand: true, latestCostCents: true,
          venueStock: venue ? { where: { venue }, select: { onHand: true, parLevel: true } } : false
        }
      }),
      prisma.purchaseOrderLine.findMany({
        where: {
          stockItemId: { not: null },
          purchaseOrder: { status: { in: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED'] }, ...(venue ? { venue } : {}) }
        },
        select: { stockItemId: true, orderedQuantity: true, receivedQuantity: true }
      })
    ]);

    const supplierById = new Map(suppliers.map((s) => [s.id, s]));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const onOrderByItem = new Map<string, number>();
    for (const line of openOrderLines) {
      if (!line.stockItemId) continue;
      const outstanding = Math.max(0, line.orderedQuantity - (line.receivedQuantity ?? 0));
      onOrderByItem.set(line.stockItemId, (onOrderByItem.get(line.stockItemId) ?? 0) + outstanding);
    }

    type ItemRow = (typeof items)[number];
    const standing = (item: ItemRow) => {
      const venueRow = Array.isArray(item.venueStock) ? item.venueStock[0] : null;
      const onHand = venueRow?.onHand ?? item.onHand;
      const parLevel = venueRow?.parLevel ?? item.parLevel;
      const factor = item.conversionFactor && item.conversionFactor > 0 ? item.conversionFactor : 1;
      const suggestedQuantity =
        parLevel && parLevel > 0
          ? orderQuantityToPar({
              onHand,
              parLevel,
              conversionFactor: factor,
              onOrder: (onOrderByItem.get(item.id) ?? 0) * factor
            })
          : 0;
      return { onHand, parLevel, suggestedQuantity };
    };

    // One line map per supplier, keyed like the per-supplier guide so a price
    // list row and the invoice history for the same item merge into one line.
    const groups = new Map<string, { supplier: { id: string; name: string; email: string | null }; byKey: Map<string, StockOrderGuideLine> }>();
    const groupFor = (supplierId: string) => {
      const supplier = supplierById.get(supplierId);
      if (!supplier) return null; // archived supplier — nothing orderable from them
      let group = groups.get(supplierId);
      if (!group) {
        group = { supplier, byKey: new Map() };
        groups.set(supplierId, group);
      }
      return group;
    };
    const keyFor = (stockItemId: string | null, description: string) =>
      stockItemId ?? `desc:${description.trim().toLowerCase()}`;

    for (const row of priceList) {
      const group = groupFor(row.supplierId);
      if (!group) continue;
      group.byKey.set(keyFor(row.stockItemId, row.description), {
        stockItemId: row.stockItemId,
        description: row.stockItem?.name ?? row.description,
        unit: row.unit ?? row.stockItem?.unit ?? null,
        onHand: null,
        parLevel: null,
        agreedCostCents: row.unitCostCents,
        agreedEffectiveAt: row.effectiveAt.toISOString(),
        lastPaidCents: null,
        lastPurchasedAt: null,
        priceMovement: null,
        suggestedQuantity: 0
      });
    }

    for (const [itemId, fact] of facts) {
      if (!fact.supplierId) continue;
      const group = groupFor(fact.supplierId);
      if (!group) continue;
      const existing = group.byKey.get(itemId);
      if (existing) {
        existing.lastPaidCents = fact.lastPriceCents;
        existing.lastPurchasedAt = fact.lastPurchasedAt;
        existing.priceMovement = fact.priceMovement;
      } else {
        group.byKey.set(itemId, {
          stockItemId: itemId,
          description: '',
          unit: null,
          onHand: null,
          parLevel: null,
          agreedCostCents: null,
          agreedEffectiveAt: null,
          lastPaidCents: fact.lastPriceCents,
          lastPurchasedAt: fact.lastPurchasedAt,
          priceMovement: fact.priceMovement,
          suggestedQuantity: 0
        });
      }
    }

    // Names, units, on-hand, par and suggested quantities for every guide line
    // that is a real catalogue item.
    for (const group of groups.values()) {
      for (const line of group.byKey.values()) {
        if (!line.stockItemId) continue;
        const item = itemById.get(line.stockItemId);
        if (!item) continue;
        const { onHand, parLevel, suggestedQuantity } = standing(item);
        line.description = line.description || item.name;
        line.unit = line.unit ?? item.unit;
        line.onHand = onHand;
        line.parLevel = parLevel;
        line.suggestedQuantity = suggestedQuantity;
      }
    }

    // Below par with nobody on record to buy it from. Shown rather than
    // dropped: the stock still needs ordering, somebody just has to say from
    // whom — and the moment one of their invoices is matched, the item moves
    // under its supplier on its own.
    const unassigned: StockOrderGuideLine[] = [];
    for (const item of items) {
      const fact = facts.get(item.id);
      if (fact?.supplierId && supplierById.has(fact.supplierId)) continue;
      const { onHand, parLevel, suggestedQuantity } = standing(item);
      if (suggestedQuantity <= 0) continue;
      unassigned.push({
        stockItemId: item.id,
        description: item.name,
        unit: item.unit,
        onHand,
        parLevel,
        agreedCostCents: null,
        agreedEffectiveAt: null,
        lastPaidCents: fact?.lastPriceCents ?? item.latestCostCents ?? null,
        lastPurchasedAt: fact?.lastPurchasedAt ?? null,
        priceMovement: fact?.priceMovement ?? null,
        suggestedQuantity
      });
    }

    const supplierGroups = [...groups.values()]
      .map((group) => ({
        supplier: group.supplier,
        lines: [...group.byKey.values()]
          .filter((line) => line.description)
          .sort((a, b) => a.description.localeCompare(b.description))
      }))
      .filter((group) => group.lines.length > 0)
      .sort((a, b) => a.supplier.name.localeCompare(b.supplier.name));
    unassigned.sort((a, b) => a.description.localeCompare(b.description));

    // A par derived from a count made in the wrong unit must not prefill
    // 21,724 bottles of gin — same guard as the below-par suggestions.
    holdBackImplausibleGuideSuggestions([
      ...supplierGroups.flatMap((group) => group.lines),
      ...unassigned
    ]);

    return { venue, suppliers: supplierGroups, unassigned, generatedAt: new Date().toISOString() };
  },

  /**
   * One review, one send: raise a draft per supplier and (optionally) email
   * each one, in a single request. Per-order failures come back as rows rather
   * than failing the batch — four suppliers' orders should not die because a
   * fifth had a bad line.
   */
  async createBatch(input: unknown, actor?: AuthUser | null) {
    if (!actor) throw new HttpError(401, 'Not authenticated');
    const data = stockPurchaseOrderBatchInputSchema.parse(input ?? {});
    const venue = actorVenueScope(actor, data.venue ?? null);
    if (!venue) throw new HttpError(400, 'Venue is required');

    const results: Array<{
      supplierName: string;
      purchaseOrder: Awaited<ReturnType<typeof loadPo>> | null;
      email: StockPurchaseOrderSendEmail | null;
      error: string | null;
    }> = [];
    for (const order of data.orders) {
      try {
        const created = await this.create(
          {
            supplierId: order.supplierId ?? undefined,
            supplierName: order.supplierName,
            venue,
            expectedAt: data.expectedAt || undefined,
            notes: 'Raised from the order guide',
            lines: order.lines
          },
          actor
        );
        if (data.send) {
          const sent = await this.send(created.id, { message: data.message ?? '' }, actor);
          results.push({ supplierName: order.supplierName, purchaseOrder: sent.purchaseOrder, email: sent.email, error: null });
        } else {
          results.push({ supplierName: order.supplierName, purchaseOrder: created, email: null, error: null });
        }
      } catch (error) {
        results.push({
          supplierName: order.supplierName,
          purchaseOrder: null,
          email: null,
          error: error instanceof HttpError ? error.message : 'Could not raise this order.'
        });
      }
    }
    return { venue, results, generatedAt: new Date().toISOString() };
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
