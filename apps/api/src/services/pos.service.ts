import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import { nswHolidayName } from '../lib/nsw-holidays.js';

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

function sydneyNow(): { dateKey: string; weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    dateKey,
    weekday: weekdayNames.indexOf(get('weekday').slice(0, 3)),
    minute: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

function sydneyTodayUtcMidnight(): Date {
  return new Date(`${sydneyNow().dateKey}T00:00:00Z`);
}

// Seeded once: Alma's standing pricing rules (from the menu smallprint).
const DEFAULT_RULES = [
  { kind: 'SURCHARGE', label: 'Weekend surcharge 10%', percent: 10, weekdays: '0,6', holidays: false },
  { kind: 'SURCHARGE', label: 'Public holiday surcharge 15%', percent: 15, weekdays: '', holidays: true }
];

async function activeRules() {
  const count = await prisma.posRule.count();
  if (count === 0) {
    await prisma.posRule.createMany({ data: DEFAULT_RULES });
  }
  return prisma.posRule.findMany({ where: { active: true } });
}

// Which rules bite right now (Sydney)? Holiday surcharges REPLACE weekend
// ones when both match (a public-holiday Saturday charges 15%, not 25%).
async function applicableRules() {
  const now = sydneyNow();
  const holiday = nswHolidayName(now.dateKey) !== null;
  const rules = (await activeRules()).filter((rule) => {
    const weekdayHit = rule.weekdays.split(',').filter(Boolean).map(Number).includes(now.weekday);
    const holidayHit = rule.holidays && holiday;
    if (!weekdayHit && !holidayHit) return false;
    if (rule.startMinute != null && now.minute < rule.startMinute) return false;
    if (rule.endMinute != null && now.minute >= rule.endMinute) return false;
    return true;
  });
  const surcharges = rules.filter((rule) => rule.kind === 'SURCHARGE');
  const holidaySurcharge = surcharges.find((rule) => rule.holidays && holiday);
  return {
    surcharge: holidaySurcharge ?? surcharges[0] ?? null,
    discounts: rules.filter((rule) => rule.kind === 'DISCOUNT')
  };
}

// Recompute an order's money from its lines + the rules in force right now.
async function recomputeOrder(id: string) {
  const lines = await prisma.posOrderLine.findMany({ where: { orderId: id } });
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const { surcharge, discounts } = await applicableRules();
  const surchargeCents = surcharge ? Math.round((subtotalCents * surcharge.percent) / 100) : 0;
  const autoDiscount = discounts[0] ?? null;
  const discountCents = autoDiscount ? Math.round((subtotalCents * autoDiscount.percent) / 100) : 0;
  const totalCents = Math.max(0, subtotalCents - discountCents + surchargeCents);
  return prisma.posOrder.update({
    where: { id },
    data: {
      subtotalCents,
      surchargeCents,
      surchargeLabel: surcharge?.label ?? null,
      discountCents,
      discountLabel: autoDiscount?.label ?? null,
      totalCents,
      gstCents: Math.round(totalCents / GST_DIVISOR)
    }
  });
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

type LineInput = { recipeId?: string | null; name: string; unitPriceCents: number; quantity: number; course?: string | null; notes?: string | null };

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
      course: str(row.course) ? str(row.course).slice(0, 30) : null,
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
      data: {
        venue,
        openedByName: str(body.openedByName) || null,
        tableLabel: str(body.tableLabel) || null,
        covers: body.covers === undefined || body.covers === null || body.covers === '' ? null : asInt(body.covers, 'covers', { min: 1, max: 200 })
      },
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

  // Replace the order's lines, then recompute totals with the pricing rules
  // (weekend/holiday surcharge, timed discounts) in force right now.
  async setLines(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const lines = parseLines(body.lines);
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is ${order.status} — start a new sale.`);

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
          course: line.course,
          notes: line.notes
        }))
      })
    ]);
    await recomputeOrder(id);
    return this.getOrder(id);
  },

  // Take a payment — full or PARTIAL (split bills). The order closes when the
  // payments (excluding tips) cover the total. Rules are re-applied first so a
  // table opened Friday that pays after midnight Saturday gets the surcharge.
  async payOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const method = str(body.method).toUpperCase();
    if (!['CASH', 'CARD_EXTERNAL'].includes(method)) {
      throw new HttpError(400, 'method must be CASH or CARD_EXTERNAL (Stripe Terminal comes with the reader).');
    }
    const tipCents = body.tipCents === undefined ? 0 : asInt(body.tipCents, 'tip', { min: 0, max: 500_000 });

    let order = await prisma.posOrder.findUnique({ where: { id }, include: { lines: true, payments: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is already ${order.status}.`);
    if (order.lines.length === 0) throw new HttpError(400, 'Add at least one item before charging.');
    if (order.payments.length === 0) {
      await recomputeOrder(id);
      order = (await prisma.posOrder.findUnique({ where: { id }, include: { lines: true, payments: true } }))!;
    }

    const paidSoFarCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = order.totalCents - paidSoFarCents;
    const amountCents =
      body.amountCents === undefined || body.amountCents === null
        ? balanceCents
        : asInt(body.amountCents, 'amount', { min: 1 });
    if (amountCents > balanceCents) throw new HttpError(400, `Only ${(balanceCents / 100).toFixed(2)} is owing on this order.`);

    const dueCents = amountCents + tipCents;
    let tenderedCents: number | null = null;
    let changeCents: number | null = null;
    if (method === 'CASH') {
      tenderedCents = asInt(body.tenderedCents ?? dueCents, 'tendered amount', { min: 0 });
      if (tenderedCents < dueCents) throw new HttpError(400, 'Tendered amount is less than this payment.');
      changeCents = tenderedCents - dueCents;
    }

    const settled = amountCents >= balanceCents;
    await prisma.posPayment.create({
      data: {
        orderId: id,
        method,
        amountCents,
        tipCents,
        tenderedCents,
        changeCents,
        reference: str(body.reference) || null
      }
    });
    const updated = await prisma.posOrder.update({
      where: { id },
      data: settled
        ? {
            status: 'PAID',
            tipCents: order.tipCents + tipCents,
            paidAt: new Date(),
            serviceDate: sydneyTodayUtcMidnight()
          }
        : { tipCents: order.tipCents + tipCents },
      include: ORDER_INCLUDE
    });
    return { ...updated, changeCents, balanceCents: settled ? 0 : balanceCents - amountCents };
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

  async listRules() {
    return activeRules();
  },

  // The venue's floor plan — the SAME tables the Reserve app's floor-plan
  // editor manages (ReserveTable geometry), so POS and Reserve share one
  // layout. Register auth (device or staff), unlike the manager-gated
  // reserve endpoints.
  async floorTables(venue: string | null) {
    if (!venue) return [];
    return prisma.reserveTable.findMany({
      where: { venue, isActive: true },
      select: {
        id: true,
        label: true,
        area: true,
        posX: true,
        posY: true,
        width: true,
        height: true,
        rotation: true,
        shape: true,
        seats: true,
        maxCovers: true,
        sortOrder: true
      },
      orderBy: [{ area: 'asc' }, { sortOrder: 'asc' }, { label: 'asc' }]
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
