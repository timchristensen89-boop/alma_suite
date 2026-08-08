import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';

// ── Alma POS — counter-mode register MVP ─────────────────────────────────────
// The register sells the menu that already lives in the suite: active recipes
// with a sale price (dishes, drinks, set menus). Orders are GST-inclusive
// (menu prices are inc-GST; gst = total/11). Payments: cash (with tendered/
// change) and CARD_EXTERNAL (recorded — the amount was taken on a standalone
// EFTPOS terminal). STRIPE_TERMINAL is reserved for the reader integration.
//
// POS day totals deliberately do NOT write SalesActualEntry yet — while the
// register runs alongside the venue POS (gift-card counter, functions,
// pop-ups) that would double-count. Promoting POS to the venue's till flips
// that on later.

const GST_DIVISOR = 11;

function sydneyTodayUtcMidnight(): Date {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
  return new Date(`${key}T00:00:00Z`);
}

function asInt(value: unknown, label: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new HttpError(400, `${label} must be a whole number.`);
  if (opts.min !== undefined && n < opts.min) throw new HttpError(400, `${label} must be ≥ ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw new HttpError(400, `${label} must be ≤ ${opts.max}.`);
  return n;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const ORDER_INCLUDE = {
  lines: { orderBy: { createdAt: 'asc' as const } },
  payments: { orderBy: { createdAt: 'asc' as const } }
};

type LineInput = { recipeId?: string | null; name: string; unitPriceCents: number; quantity: number; notes?: string | null };

function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'lines must be an array.');
  return raw.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const name = str(row.name);
    if (!name) throw new HttpError(400, `Line ${index + 1}: name is required.`);
    return {
      recipeId: str(row.recipeId) || null,
      name: name.slice(0, 120),
      unitPriceCents: asInt(row.unitPriceCents, `Line ${index + 1} price`, { min: 0, max: 1_000_000 }),
      quantity: asInt(row.quantity, `Line ${index + 1} quantity`, { min: 1, max: 999 }),
      notes: str(row.notes) ? str(row.notes).slice(0, 200) : null
    };
  });
}

export const posService = {
  // The sellable menu, grouped for the register grid: active non-prep recipes
  // with a price, plus set menus. Categories keep the recipe's own category.
  async registerMenu() {
    const recipes = await prisma.recipe.findMany({
      where: { status: 'ACTIVE', isPrepRecipe: false, salePriceCents: { gt: 0 } },
      select: { id: true, title: true, kind: true, category: true, venue: true, salePriceCents: true },
      orderBy: [{ category: 'asc' }, { title: 'asc' }]
    });
    const byCategory = new Map<string, { name: string; kind: string; items: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null }> }>();
    for (const recipe of recipes) {
      const name = recipe.kind === 'SET_MENU' ? 'Set Menus' : recipe.category?.trim() || 'Other';
      const group = byCategory.get(name) ?? { name, kind: recipe.kind ?? 'FOOD', items: [] };
      group.items.push({
        recipeId: recipe.id,
        title: recipe.title,
        priceCents: recipe.salePriceCents ?? 0,
        venue: recipe.venue
      });
      byCategory.set(name, group);
    }
    const categories = Array.from(byCategory.values()).sort((a, b) => {
      if (a.name === 'Set Menus') return -1;
      if (b.name === 'Set Menus') return 1;
      return a.name.localeCompare(b.name);
    });
    return { categories, itemCount: recipes.length };
  },

  async createOrder(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    return prisma.posOrder.create({
      data: { venue, openedByName: str(body.openedByName) || null },
      include: ORDER_INCLUDE
    });
  },

  async listOpenOrders(venue: string | null) {
    return prisma.posOrder.findMany({
      where: { status: 'OPEN', ...(venue ? { venue } : {}) },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  },

  async getOrder(id: string) {
    const order = await prisma.posOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new HttpError(404, 'Order not found.');
    return order;
  },

  // Replace the order's lines and recompute totals (register sends the whole
  // cart on every change — simplest correct model for a single-operator MVP).
  async setLines(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const lines = parseLines(body.lines);
    const discountCents = body.discountCents === undefined ? 0 : asInt(body.discountCents, 'discount', { min: 0 });
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is ${order.status} — start a new sale.`);

    const subtotalCents = lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
    if (discountCents > subtotalCents) throw new HttpError(400, 'Discount exceeds the subtotal.');
    const totalCents = subtotalCents - discountCents;
    const gstCents = Math.round(totalCents / GST_DIVISOR);

    await prisma.$transaction([
      prisma.posOrderLine.deleteMany({ where: { orderId: id } }),
      prisma.posOrderLine.createMany({
        data: lines.map((line) => ({
          orderId: id,
          recipeId: line.recipeId,
          name: line.name,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          totalCents: line.unitPriceCents * line.quantity,
          notes: line.notes
        }))
      }),
      prisma.posOrder.update({ where: { id }, data: { subtotalCents, discountCents, totalCents, gstCents } })
    ]);
    return this.getOrder(id);
  },

  async payOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const method = str(body.method).toUpperCase();
    if (!['CASH', 'CARD_EXTERNAL'].includes(method)) {
      throw new HttpError(400, 'method must be CASH or CARD_EXTERNAL (Stripe Terminal comes with the reader).');
    }
    const tipCents = body.tipCents === undefined ? 0 : asInt(body.tipCents, 'tip', { min: 0, max: 500_000 });

    const order = await prisma.posOrder.findUnique({ where: { id }, include: { lines: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is already ${order.status}.`);
    if (order.lines.length === 0) throw new HttpError(400, 'Add at least one item before charging.');

    const dueCents = order.totalCents + tipCents;
    let tenderedCents: number | null = null;
    let changeCents: number | null = null;
    if (method === 'CASH') {
      tenderedCents = asInt(body.tenderedCents ?? dueCents, 'tendered amount', { min: 0 });
      if (tenderedCents < dueCents) throw new HttpError(400, 'Tendered amount is less than the total.');
      changeCents = tenderedCents - dueCents;
    }

    const [, paid] = await prisma.$transaction([
      prisma.posPayment.create({
        data: {
          orderId: id,
          method,
          amountCents: order.totalCents,
          tipCents,
          tenderedCents,
          changeCents,
          reference: str(body.reference) || null
        }
      }),
      prisma.posOrder.update({
        where: { id },
        data: { status: 'PAID', tipCents, paidAt: new Date(), serviceDate: sydneyTodayUtcMidnight() },
        include: ORDER_INCLUDE
      })
    ]);
    return { ...paid, changeCents };
  },

  async voidOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status === 'VOID') return this.getOrder(id);
    if (order.status === 'PAID') throw new HttpError(400, 'Paid orders cannot be voided from the register (refunds come with Stripe Terminal).');
    return prisma.posOrder.update({
      where: { id },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: str(body.reason) || null },
      include: ORDER_INCLUDE
    });
  },

  // X-read: today's picture for the drawer count and the manager.
  async daySummary(venue: string | null, dateKey: string | null) {
    const serviceDate = dateKey && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)
      ? new Date(`${dateKey}T00:00:00Z`)
      : sydneyTodayUtcMidnight();
    const where = { status: 'PAID', serviceDate, ...(venue ? { venue } : {}) };
    const orders = await prisma.posOrder.findMany({ where, include: { payments: true, lines: true } });

    const byMethod = new Map<string, { count: number; amountCents: number; tipCents: number }>();
    const byItem = new Map<string, { name: string; quantity: number; totalCents: number }>();
    let totalCents = 0;
    let gstCents = 0;
    let tipCents = 0;
    for (const order of orders) {
      totalCents += order.totalCents;
      gstCents += order.gstCents;
      tipCents += order.tipCents;
      for (const payment of order.payments) {
        const bucket = byMethod.get(payment.method) ?? { count: 0, amountCents: 0, tipCents: 0 };
        bucket.count += 1;
        bucket.amountCents += payment.amountCents;
        bucket.tipCents += payment.tipCents;
        byMethod.set(payment.method, bucket);
      }
      for (const line of order.lines) {
        const bucket = byItem.get(line.name) ?? { name: line.name, quantity: 0, totalCents: 0 };
        bucket.quantity += line.quantity;
        bucket.totalCents += line.totalCents;
        byItem.set(line.name, bucket);
      }
    }
    return {
      serviceDate: serviceDate.toISOString().slice(0, 10),
      venue,
      orderCount: orders.length,
      totalCents,
      gstCents,
      tipCents,
      methods: Object.fromEntries(byMethod),
      topItems: Array.from(byItem.values()).sort((a, b) => b.totalCents - a.totalCents).slice(0, 12)
    };
  }
};
