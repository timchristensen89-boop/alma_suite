import Stripe from 'stripe';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import { env } from '../env.js';
import { nswHolidayName } from '../lib/nsw-holidays.js';
import { mailService } from './mail.service.js';
import { authService } from './auth.service.js';
import { giftCardService } from './gift-card.service.js';

const stripe = env.stripe?.secretKey ? new Stripe(env.stripe.secretKey) : null;

// Fixed, auditable reason lists — the register offers ONLY these.
export const ADJUST_REASONS: Record<string, string[]> = {
  DISCOUNT: ['Service recovery', 'Regular guest', 'Staff meal', 'Marketing promo', 'Manager goodwill'],
  COMP: ['Service recovery', 'Kitchen error', 'Long wait', 'Spillage / return', 'Manager comp'],
  PRICE_CHANGE: ['Menu price wrong', 'Happy hour manual', 'Damaged item', 'Manager override'],
  WASTAGE: ['Spillage', 'Kitchen error', 'Expired', 'Customer return', 'Training']
};

function requireReason(kind: string, reason: string) {
  const allowed = ADJUST_REASONS[kind] ?? [];
  if (!allowed.includes(reason)) {
    throw new HttpError(400, `Pick a reason: ${allowed.join(', ')}.`);
  }
}

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

// Recipes carry loose kind strings ("Bar Dish", "Dish", "FOOD", "BEVERAGE").
// Everything drink-ish routes to the bar; the rest is kitchen food.
function kindBucket(kind: string | null, category: string | null): 'FOOD' | 'BEVERAGE' {
  const value = `${kind ?? ''} ${category ?? ''}`.toLowerCase();
  return /bar|bev|cocktail|drink|wine|beer|spirit|liquor|coffee|tea|juice|margarita|mezcal|tequila|vodka|gin|whiskey/.test(value)
    ? 'BEVERAGE'
    : 'FOOD';
}

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
  const existing = await prisma.posOrder.findUnique({ where: { id }, select: { manualDiscountCents: true } });
  const manualDiscountCents = Math.min(existing?.manualDiscountCents ?? 0, subtotalCents);
  const totalCents = Math.max(0, subtotalCents - discountCents - manualDiscountCents + surchargeCents);
  return prisma.posOrder.update({
    where: { id },
    data: {
      subtotalCents,
      surchargeCents,
      surchargeLabel: surcharge?.label ?? null,
      discountCents,
      discountLabel: autoDiscount?.label ?? null,
      manualDiscountCents,
      totalCents,
      gstCents: Math.round(totalCents / GST_DIVISOR)
    }
  });
}

// When a venue's POS is its till, its settled orders roll up into the same
// actuals the rest of the suite reads: SalesActualEntry (ex-GST + covers,
// source alma-pos) and StaffTipCardEntry (card tips). Idempotent per day.
// Australian cash rounding: cash amounts round to the nearest 5 cents.
function roundCash5(cents: number): number {
  return Math.round(cents / 5) * 5;
}

// Manager approval for register voids/refunds from floor-staff (device PIN)
// sessions: the PIN must belong to an active profile whose role reads as a
// manager. Suite logins (full accounts) bypass the gate.
const MANAGER_ROLE = /manager|owner|director|licensee/i;

async function verifyManagerPin(pin: string): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(403, 'Manager PIN required.');
  const managers = await prisma.staffProfile.findMany({
    where: {
      accountType: 'HUMAN',
      employmentStatus: 'ACTIVE',
      mergedIntoStaffProfileId: null,
      pinHash: { not: null }
    },
    select: { firstName: true, lastName: true, roleTitle: true, pinHash: true, pinLockedUntil: true }
  });
  for (const profile of managers) {
    if (!MANAGER_ROLE.test(profile.roleTitle)) continue;
    if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) continue;
    if (await authService.comparePin(pin, profile.pinHash!)) return `${profile.firstName} ${profile.lastName}`.trim();
  }
  throw new HttpError(403, 'That PIN does not belong to a manager.');
}

async function postPosActuals(venue: string) {
  const setting = await prisma.posVenueSetting.findUnique({ where: { venue } });
  if (!setting?.postToReports) return;
  const serviceDate = sydneyTodayUtcMidnight();
  const orders = await prisma.posOrder.findMany({
    where: { venue, serviceDate, status: 'PAID', training: false },
    include: { payments: true }
  });
  const totalIncCents = orders.reduce((sum, order) => sum + order.totalCents, 0);
  const refunds = orders
    .flatMap((order) => order.payments)
    .filter((payment) => payment.amountCents < 0)
    .reduce((sum, payment) => sum - payment.amountCents, 0);
  const netIncCents = Math.max(0, totalIncCents - refunds);
  const exGstCents = Math.round((netIncCents * 10) / 11);
  const covers = orders.reduce((sum, order) => sum + (order.covers ?? 0), 0);
  const cardTips = orders
    .flatMap((order) => order.payments)
    .filter((payment) => payment.method !== 'CASH' && payment.tipCents > 0)
    .reduce((sum, payment) => sum + payment.tipCents, 0);
  const source = 'alma-pos';
  const externalId = `${source}:${venue}:${serviceDate.toISOString().slice(0, 10)}`;
  await prisma.salesActualEntry.upsert({
    where: { venue_serviceDate_source_externalId: { venue, serviceDate, source, externalId } },
    create: {
      venue,
      serviceDate,
      salesCents: exGstCents,
      coversCount: covers || null,
      source,
      externalId,
      notes: 'ALMA POS day total (ex GST).'
    },
    update: { salesCents: exGstCents, coversCount: covers || null }
  });
  if (cardTips > 0) {
    const importKey = `alma-pos:${venue}:${serviceDate.toISOString().slice(0, 10)}`;
    await prisma.staffTipCardEntry.upsert({
      where: { importKey },
      create: {
        venue,
        serviceDate,
        amountCents: cardTips,
        source: 'alma-pos',
        importKey,
        notes: 'Card tips taken on ALMA POS.'
      },
      update: { amountCents: cardTips }
    });
  }
}

// Cash expected in a drawer: float + cash payments (incl. cash tips) taken
// while it was open. Change was returned to guests, so payments count net.
async function drawerExpectedCents(drawer: { venue: string; openingFloatCents: number; openedAt: Date }) {
  const cash = await prisma.posPayment.findMany({
    where: {
      method: 'CASH',
      createdAt: { gte: drawer.openedAt },
      order: { venue: drawer.venue, training: false }
    },
    select: { amountCents: true, tipCents: true, tenderedCents: true, changeCents: true }
  });
  // Physical cash in the drawer is what was handed over minus change given —
  // that differs from amount+tip by the 5c rounding on each payment.
  return (
    drawer.openingFloatCents +
    cash.reduce(
      (sum, payment) =>
        sum +
        (payment.tenderedCents !== null && payment.changeCents !== null
          ? payment.tenderedCents - payment.changeCents
          : payment.amountCents + payment.tipCents),
      0
    )
  );
}

// Settling an order refreshes the guest's CRM row: lifetime spend from their
// settled POS orders + reservation spend stays additive (we only add POS
// deltas), visits bump once per Sydney day, favourites cached to preferences.
async function updateGuestFromOrder(guestId: string) {
  const [guest, posTotals, favourites] = await Promise.all([
    prisma.reserveGuest.findUnique({ where: { id: guestId }, select: { lastVisitAt: true, preferences: true } }),
    prisma.posOrder.aggregate({ where: { guestId, status: 'PAID', training: false }, _sum: { totalCents: true, tipCents: true } }),
    prisma.posOrderLine.groupBy({
      by: ['name'],
      where: { order: { guestId, status: 'PAID', training: false } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 3
    })
  ]);
  if (!guest) return;
  const today = sydneyTodayUtcMidnight();
  const sameDay = guest.lastVisitAt && guest.lastVisitAt >= today;
  const preferences = {
    ...((guest.preferences ?? {}) as Record<string, unknown>),
    posSpendCents: (posTotals._sum.totalCents ?? 0) + (posTotals._sum.tipCents ?? 0),
    favouriteItems: favourites.map((row) => row.name)
  };
  await prisma.reserveGuest.update({
    where: { id: guestId },
    data: {
      totalSpendCents: { increment: 0 },
      ...(sameDay ? {} : { totalVisits: { increment: 1 } }),
      lastVisitAt: new Date(),
      preferences: preferences as object
    }
  });
  // Lifetime spend: recompute additively — reservation-side spend plus POS
  // spend lives in preferences; totalSpendCents gets the POS running total
  // when it exceeds what's recorded (never decrements CRM history).
  const current = await prisma.reserveGuest.findUnique({ where: { id: guestId }, select: { totalSpendCents: true } });
  const posSpend = (posTotals._sum.totalCents ?? 0) + (posTotals._sum.tipCents ?? 0);
  if (current && posSpend > current.totalSpendCents) {
    await prisma.reserveGuest.update({ where: { id: guestId }, data: { totalSpendCents: posSpend } });
  }
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
  payments: { orderBy: { createdAt: 'asc' as const } },
  guest: { select: { id: true, firstName: true, lastName: true, totalVisits: true, totalSpendCents: true, tags: true, allergyNotes: true, dietaryNotes: true } }
};

type LineInput = {
  recipeId?: string | null;
  name: string;
  unitPriceCents: number;
  quantity: number;
  course?: string | null;
  seat?: number | null;
  modifiers?: Array<{ name: string; priceCents: number }> | null;
  notes?: string | null;
};

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
      seat: row.seat === undefined || row.seat === null || row.seat === '' ? null : asInt(row.seat, `Line ${index + 1} seat`, { min: 1, max: 200 }),
      modifiers: Array.isArray(row.modifiers)
        ? (row.modifiers as Array<Record<string, unknown>>)
            .map((modifier) => ({ name: str(modifier.name).slice(0, 60), priceCents: Number.isFinite(Number(modifier.priceCents)) ? Math.round(Number(modifier.priceCents)) : 0 }))
            .filter((modifier) => modifier.name)
            .slice(0, 12)
        : null,
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
      const group = byCategory.get(name) ?? {
        name,
        kind: recipe.kind === 'SET_MENU' ? 'SET_MENU' : kindBucket(recipe.kind, recipe.category),
        items: []
      };
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
    const [eightySix, modifierGroups] = await Promise.all([
      prisma.pos86.findMany({ select: { recipeId: true } }),
      prisma.posModifierGroup.findMany({
        where: { active: true },
        include: { options: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' }
      })
    ]);
    return {
      categories,
      itemCount: recipes.length,
      eightySix: eightySix.map((row) => row.recipeId),
      modifierGroups: modifierGroups.map((group) => ({
        id: group.id,
        name: group.name,
        required: group.required,
        maxSelect: group.maxSelect,
        categories: group.categoriesCsv.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean),
        options: group.options.map((option) => ({ id: option.id, name: option.name, priceCents: option.priceCents }))
      }))
    };
  },

  // 86 list: toggle an item sold-out; every register sees it on next menu load.
  async toggle86(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const recipeId = str(body.recipeId);
    if (!recipeId) throw new HttpError(400, 'recipeId required.');
    const existing = await prisma.pos86.findUnique({ where: { recipeId } });
    if (existing) {
      await prisma.pos86.delete({ where: { recipeId } });
      return { recipeId, eightySixed: false };
    }
    await prisma.pos86.create({ data: { recipeId, staffName: str(body.staffName) || null } });
    return { recipeId, eightySixed: true };
  },

  // Modifier group CRUD (register settings — keep it simple: whole-group save).
  async saveModifierGroup(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const name = str(body.name);
    if (!name) throw new HttpError(400, 'Group name required.');
    const options = (Array.isArray(body.options) ? (body.options as Array<Record<string, unknown>>) : [])
      .map((option, index) => ({
        name: str(option.name),
        priceCents: Number.isFinite(Number(option.priceCents)) ? Math.round(Number(option.priceCents)) : 0,
        sortOrder: index
      }))
      .filter((option) => option.name);
    if (options.length === 0) throw new HttpError(400, 'Add at least one option.');
    const data = {
      name,
      categoriesCsv: str(body.categoriesCsv),
      required: body.required === true,
      maxSelect: Number.isFinite(Number(body.maxSelect)) ? Math.max(1, Math.round(Number(body.maxSelect))) : 3
    };
    const id = str(body.id);
    if (id) {
      await prisma.posModifier.deleteMany({ where: { groupId: id } });
      return prisma.posModifierGroup.update({
        where: { id },
        data: { ...data, options: { create: options } },
        include: { options: true }
      });
    }
    return prisma.posModifierGroup.create({ data: { ...data, options: { create: options } }, include: { options: true } });
  },

  async deleteModifierGroup(id: string) {
    await prisma.posModifierGroup.delete({ where: { id } }).catch(() => undefined);
    return { deleted: true };
  },

  async createOrder(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const tableLabel = str(body.tableLabel) || null;
    const idempotencyKey = str(body.idempotencyKey) || null;
    if (idempotencyKey) {
      const existing = await prisma.posOrder.findUnique({ where: { idempotencyKey }, include: ORDER_INCLUDE });
      if (existing) return existing;
    }

    // Guest matching: tonight's reservation on this table links the order to
    // the guest's CRM profile (spend + favourites update at settle).
    let guestId: string | null = null;
    let reservationId: string | null = null;
    if (tableLabel) {
      const reservation = await prisma.reserveReservation.findFirst({
        where: {
          venue,
          serviceDate: sydneyTodayUtcMidnight(),
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          OR: [
            { table: { label: { equals: tableLabel, mode: 'insensitive' } } },
            { tableLabels: { contains: tableLabel, mode: 'insensitive' } }
          ]
        },
        orderBy: { startsAt: 'asc' },
        select: { id: true, guestId: true }
      });
      if (reservation) {
        guestId = reservation.guestId;
        reservationId = reservation.id;
      }
    }

    try {
      return await prisma.posOrder.create({
        data: {
          venue,
          idempotencyKey,
          training: body.training === true,
          openedByName: str(body.openedByName) || null,
          tableLabel,
          guestId,
          reservationId,
          covers: body.covers === undefined || body.covers === null || body.covers === '' ? null : asInt(body.covers, 'covers', { min: 1, max: 200 })
        },
        include: ORDER_INCLUDE
      });
    } catch (err) {
      // Unique race on idempotencyKey: another replay of the same queued sale
      // won the create — return that order instead of erroring.
      if (idempotencyKey && (err as { code?: string }).code === 'P2002') {
        const existing = await prisma.posOrder.findUnique({ where: { idempotencyKey }, include: ORDER_INCLUDE });
        if (existing) return existing;
      }
      throw err;
    }
  },

  // Adjust table details mid-service (covers changes constantly on the floor).
  async updateOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, 'Only open orders can be edited.');
    const data: Record<string, unknown> = {};
    if (body.covers !== undefined) {
      data.covers = body.covers === null || body.covers === '' ? null : asInt(body.covers, 'covers', { min: 1, max: 200 });
    }
    if (body.tableLabel !== undefined) data.tableLabel = str(body.tableLabel) || null;
    await prisma.posOrder.update({ where: { id }, data });
    return this.getOrder(id);
  },

  async listOpenOrders(venue: string | null, status?: string | null) {
    const wanted = (status ?? 'OPEN').toUpperCase();
    return prisma.posOrder.findMany({
      where: {
        ...(wanted === 'ALL' ? { status: { in: ['PAID', 'VOID', 'OPEN'] } } : { status: wanted }),
        ...(venue ? { venue } : {}),
        ...(wanted !== 'OPEN'
          ? { OR: [{ serviceDate: sydneyTodayUtcMidnight() }, { createdAt: { gte: new Date(Date.now() - 18 * 3600_000) } }] }
          : {})
      },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 60
    });
  },

  // Merge another open bill into this one: lines and payments move across,
  // totals recompute, and the source order voids with an audit note.
  async mergeOrders(targetId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const sourceId = str(body.sourceOrderId);
    if (!sourceId || sourceId === targetId) throw new HttpError(400, 'Pick a different bill to merge in.');
    const [target, source] = await Promise.all([
      prisma.posOrder.findUnique({ where: { id: targetId }, select: { status: true, venue: true, tableLabel: true, orderNumber: true, covers: true } }),
      prisma.posOrder.findUnique({ where: { id: sourceId }, select: { status: true, venue: true, tableLabel: true, orderNumber: true, covers: true } })
    ]);
    if (!target || !source) throw new HttpError(404, 'Bill not found.');
    if (target.status !== 'OPEN' || source.status !== 'OPEN') throw new HttpError(400, 'Both bills must be open to merge.');
    await prisma.$transaction([
      prisma.posOrderLine.updateMany({ where: { orderId: sourceId }, data: { orderId: targetId } }),
      prisma.posPayment.updateMany({ where: { orderId: sourceId }, data: { orderId: targetId } }),
      prisma.posOrder.update({
        where: { id: targetId },
        data: { covers: (target.covers ?? 0) + (source.covers ?? 0) || null }
      }),
      prisma.posOrder.update({
        where: { id: sourceId },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidReason: `Merged into ${target.tableLabel ? `table ${target.tableLabel}` : `#${target.orderNumber}`}`
        }
      })
    ]);
    await recomputeOrder(targetId);
    return this.getOrder(targetId);
  },

  // Bring a paid bill back to the floor (adds more items, settles again).
  async reopenOrder(id: string) {
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    if (order.status !== 'PAID') throw new HttpError(400, 'Only paid bills can be reopened.');
    await prisma.posOrder.update({ where: { id }, data: { status: 'OPEN', paidAt: null, serviceDate: null } });
    return this.getOrder(id);
  },

  // Refund a settled bill, fully or partially — a negative REFUND payment
  // plus a mandatory-reason audit record. Cash refunds count against the
  // open drawer's expected cash automatically (negative CASH sum).
  async refundOrder(id: string, input: unknown, requireManager = false) {
    const body = (input ?? {}) as Record<string, unknown>;
    const reason = str(body.reason);
    requireReason('COMP', reason);
    let staffName = str(body.staffName) || 'Unknown';
    if (requireManager) {
      const approvedBy = await verifyManagerPin(str(body.managerPin));
      staffName = `${staffName} (approved by ${approvedBy})`;
    }
    const method = str(body.method).toUpperCase() === 'CASH' ? 'CASH' : 'REFUND';
    const order = await prisma.posOrder.findUnique({ where: { id }, include: { payments: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    if (order.status !== 'PAID') throw new HttpError(400, 'Only paid bills can be refunded.');
    const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents + payment.tipCents, 0);
    const amountCents = body.amountCents === undefined ? paid : asInt(body.amountCents, 'refund amount', { min: 1 });
    if (amountCents > paid) throw new HttpError(400, `Only ${(paid / 100).toFixed(2)} was paid on this bill.`);
    await prisma.posPayment.create({
      data: { orderId: id, method, amountCents: -amountCents, tipCents: 0, reference: 'refund' }
    });
    await prisma.posAdjustment.create({
      data: {
        venue: order.venue,
        orderId: id,
        kind: 'COMP',
        reason,
        staffName,
        itemName: `REFUND ${order.tableLabel ? `table ${order.tableLabel}` : `#${order.orderNumber}`}`,
        amountCents
      }
    });
    await postPosActuals(order.venue).catch(() => undefined);
    return this.getOrder(id);
  },

  // ── Venue till settings / shift report / email receipt ─────────────────
  async getVenueSetting(venue: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const row = await prisma.posVenueSetting.findUnique({ where: { venue } });
    return { venue, postToReports: row?.postToReports ?? false };
  },

  async setVenueSetting(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const postToReports = body.postToReports === true;
    await prisma.posVenueSetting.upsert({
      where: { venue },
      create: { venue, postToReports },
      update: { postToReports }
    });
    if (postToReports) await postPosActuals(venue).catch(() => undefined);
    return { venue, postToReports };
  },

  // Per-server shift report: what this staff member rang up today.
  async shiftReport(venue: string | null, staffName: string | null) {
    if (!venue || !staffName) throw new HttpError(400, 'venue and staffName required.');
    const serviceDate = sydneyTodayUtcMidnight();
    const [orders, adjustments] = await Promise.all([
      prisma.posOrder.findMany({
        where: { venue, serviceDate, status: 'PAID', openedByName: staffName, training: false },
        include: { payments: true, lines: true }
      }),
      prisma.posAdjustment.findMany({
        where: { venue, staffName, createdAt: { gte: serviceDate } },
        orderBy: { createdAt: 'desc' }
      })
    ]);
    const byMethod = new Map<string, { count: number; amountCents: number; tipCents: number }>();
    let totalCents = 0;
    let tipCents = 0;
    let itemCount = 0;
    for (const order of orders) {
      totalCents += order.totalCents;
      tipCents += order.tipCents;
      itemCount += order.lines.reduce((sum, line) => sum + line.quantity, 0);
      for (const payment of order.payments) {
        const bucket = byMethod.get(payment.method) ?? { count: 0, amountCents: 0, tipCents: 0 };
        bucket.count += 1;
        bucket.amountCents += payment.amountCents;
        bucket.tipCents += payment.tipCents;
        byMethod.set(payment.method, bucket);
      }
    }
    return {
      staffName,
      venue,
      serviceDate: serviceDate.toISOString().slice(0, 10),
      orderCount: orders.length,
      itemCount,
      totalCents,
      tipCents,
      methods: Object.fromEntries(byMethod),
      adjustments: adjustments.map((adjustment) => ({
        kind: adjustment.kind,
        reason: adjustment.reason,
        itemName: adjustment.itemName,
        amountCents: adjustment.amountCents
      }))
    };
  },

  // Email a settled bill's receipt to the guest.
  async emailReceipt(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const to = str(body.to).toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError(400, 'Enter a valid email.');
    const order = await prisma.posOrder.findUnique({ where: { id }, include: { lines: true, payments: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    const rows = order.lines
      .map(
        (line) =>
          `<tr><td>${line.quantity}× ${line.name}${
            ((line.modifiers as Array<{ name: string }> | null) ?? []).length
              ? `<br><small style="color:#777">${((line.modifiers as Array<{ name: string }>) ?? []).map((modifier) => modifier.name).join(', ')}</small>`
              : ''
          }</td><td align="right">${money(line.totalCents)}</td></tr>`
      )
      .join('');
    const extras = [
      order.discountCents > 0 ? `<tr><td>${order.discountLabel ?? 'Discount'}</td><td align="right">−${money(order.discountCents)}</td></tr>` : '',
      order.manualDiscountCents > 0 ? `<tr><td>${order.manualDiscountLabel ?? 'Discount'}</td><td align="right">−${money(order.manualDiscountCents)}</td></tr>` : '',
      order.surchargeCents > 0 ? `<tr><td>${order.surchargeLabel ?? 'Surcharge'}</td><td align="right">+${money(order.surchargeCents)}</td></tr>` : ''
    ].join('');
    const html = `
      <div style="font-family:Georgia,serif;max-width:420px;margin:0 auto;color:#1F2A1E">
        <h2 style="letter-spacing:0.2em;text-align:center">ALMA</h2>
        <p style="text-align:center;color:#666">${order.venue}<br>${order.tableLabel ? `Table ${order.tableLabel}` : `Order #${order.orderNumber}`} · ${new Date().toLocaleDateString('en-AU')}</p>
        <table width="100%" style="border-collapse:collapse;font-size:14px">${rows}${extras}
          <tr><td style="border-top:1px solid #ccc;padding-top:8px"><b>Total (incl. ${money(order.gstCents)} GST${order.tipCents ? ` + ${money(order.tipCents)} tip` : ''})</b></td>
          <td align="right" style="border-top:1px solid #ccc;padding-top:8px"><b>${money(order.totalCents + order.tipCents)}</b></td></tr>
        </table>
        <p style="text-align:center;color:#666;margin-top:24px">Thank you — see you again soon.<br>almagroup.com.au</p>
      </div>`;
    const result = await mailService.sendDocument({
      to,
      subject: `Your receipt — ALMA ${order.venue}`,
      text: `ALMA receipt — total ${money(order.totalCents + order.tipCents)}`,
      html
    });
    return { sent: result.status === 'sent', status: result.status };
  },

  // Move a floor table (drag-edit in POS writes the shared Reserve layout).
  async moveTable(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const posX = Number(body.posX);
    const posY = Number(body.posY);
    if (!Number.isFinite(posX) || !Number.isFinite(posY)) throw new HttpError(400, 'posX/posY required.');
    return prisma.reserveTable.update({
      where: { id },
      data: {
        posX: Math.min(96, Math.max(0, posX)),
        posY: Math.min(96, Math.max(0, posY))
      },
      select: { id: true, posX: true, posY: true }
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
          seat: line.seat,
          modifiers: (line.modifiers ?? undefined) as object[] | undefined,
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
    if (!['CASH', 'CARD_EXTERNAL', 'STRIPE_TERMINAL', 'GIFT_CARD', 'ONLINE'].includes(method)) {
      throw new HttpError(400, 'method must be CASH, CARD_EXTERNAL, STRIPE_TERMINAL, GIFT_CARD or ONLINE.');
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
      // Physical cash rounds to the nearest 5c; the order still settles on the
      // exact amount — the few cents' difference is rounding, absorbed at the
      // drawer (drawerExpectedCents counts tendered − change).
      const roundedDueCents = roundCash5(dueCents);
      tenderedCents = asInt(body.tenderedCents ?? roundedDueCents, 'tendered amount', { min: 0 });
      if (tenderedCents < roundedDueCents) throw new HttpError(400, 'Tendered amount is less than this payment.');
      changeCents = tenderedCents - roundedDueCents;
    }

    // Gift card: debit the card atomically BEFORE recording the payment — the
    // gift card service guards balance/status under concurrency, and a failed
    // redemption must leave the order untouched.
    let giftCardRemainingCents: number | null = null;
    let giftReference: string | null = null;
    if (method === 'GIFT_CARD') {
      const code = str(body.giftCardCode).toUpperCase();
      if (!code) throw new HttpError(400, 'Gift card code is required.');
      const redeemed = (await giftCardService.redeem(
        { code, amountCents: dueCents, venue: order.venue, notes: `ALMA POS #${order.orderNumber}` },
        undefined
      )) as { balanceCents: number; code: string };
      giftCardRemainingCents = redeemed.balanceCents;
      giftReference = code;
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
        reference: giftReference ?? (str(body.reference) || null)
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
    if (settled && updated.guestId) {
      await updateGuestFromOrder(updated.guestId).catch(() => undefined);
    }
    if (settled) {
      await postPosActuals(updated.venue).catch(() => undefined);
    }
    return { ...updated, changeCents, giftCardRemainingCents, balanceCents: settled ? 0 : balanceCents - amountCents };
  },

  async voidOrder(id: string, input: unknown, requireManager = false) {
    const body = (input ?? {}) as Record<string, unknown>;
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true, training: true, lines: { select: { id: true }, take: 1 } } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status === 'VOID') return this.getOrder(id);
    if (order.status === 'PAID') throw new HttpError(400, 'Paid orders cannot be voided from the register (refunds come with Stripe Terminal).');
    let approvedBy: string | null = null;
    // Empty and training orders void freely; a real order with items needs a
    // manager when the session is a floor-staff PIN login.
    if (requireManager && !order.training && order.lines.length > 0) {
      approvedBy = await verifyManagerPin(str(body.managerPin));
    }
    const reason = str(body.reason) || null;
    return prisma.posOrder.update({
      where: { id },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: approvedBy ? `${reason ?? 'Void'} — approved by ${approvedBy}` : reason },
      include: ORDER_INCLUDE
    });
  },

  // Owner's live board: today-so-far for every venue in one call — the
  // register app renders it at /#live for a phone. Training excluded.
  async liveBoard() {
    const serviceDate = sydneyTodayUtcMidnight();
    const [paidOrders, openOrders] = await Promise.all([
      prisma.posOrder.findMany({
        where: { serviceDate, status: 'PAID', training: false },
        include: { payments: true, lines: true }
      }),
      prisma.posOrder.findMany({
        where: { status: 'OPEN', training: false },
        include: { payments: true }
      })
    ]);
    const sydneyHour = (date: Date) =>
      Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', hour12: false }).format(date));
    const venues = new Map<string, {
      venue: string;
      totalCents: number;
      tipCents: number;
      covers: number;
      orderCount: number;
      openCount: number;
      openOwingCents: number;
      items: Map<string, { name: string; quantity: number; totalCents: number }>;
      servers: Map<string, { name: string; totalCents: number; orders: number }>;
      hourly: Map<number, number>;
    }>();
    const bucket = (venue: string) => {
      let entry = venues.get(venue);
      if (!entry) {
        entry = { venue, totalCents: 0, tipCents: 0, covers: 0, orderCount: 0, openCount: 0, openOwingCents: 0, items: new Map(), servers: new Map(), hourly: new Map() };
        venues.set(venue, entry);
      }
      return entry;
    };
    for (const order of paidOrders) {
      const entry = bucket(order.venue);
      entry.totalCents += order.totalCents;
      entry.tipCents += order.tipCents;
      entry.covers += order.covers ?? 0;
      entry.orderCount += 1;
      if (order.paidAt) {
        const hour = sydneyHour(order.paidAt);
        entry.hourly.set(hour, (entry.hourly.get(hour) ?? 0) + order.totalCents);
      }
      const server = order.openedByName ?? 'Unknown';
      const serverEntry = entry.servers.get(server) ?? { name: server, totalCents: 0, orders: 0 };
      serverEntry.totalCents += order.totalCents;
      serverEntry.orders += 1;
      entry.servers.set(server, serverEntry);
      for (const line of order.lines) {
        const item = entry.items.get(line.name) ?? { name: line.name, quantity: 0, totalCents: 0 };
        item.quantity += line.quantity;
        item.totalCents += line.totalCents;
        entry.items.set(line.name, item);
      }
    }
    for (const order of openOrders) {
      const entry = bucket(order.venue);
      entry.openCount += 1;
      const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
      entry.openOwingCents += Math.max(0, order.totalCents - paid);
    }
    return {
      serviceDate: serviceDate.toISOString().slice(0, 10),
      generatedAt: new Date().toISOString(),
      venues: [...venues.values()]
        .sort((a, b) => b.totalCents - a.totalCents)
        .map((entry) => ({
          venue: entry.venue,
          totalCents: entry.totalCents,
          tipCents: entry.tipCents,
          covers: entry.covers,
          orderCount: entry.orderCount,
          avgPerCoverCents: entry.covers > 0 ? Math.round(entry.totalCents / entry.covers) : null,
          openCount: entry.openCount,
          openOwingCents: entry.openOwingCents,
          topItems: [...entry.items.values()].sort((a, b) => b.totalCents - a.totalCents).slice(0, 5),
          servers: [...entry.servers.values()].sort((a, b) => b.totalCents - a.totalCents),
          hourly: [...entry.hourly.entries()].sort((a, b) => a[0] - b[0]).map(([hour, cents]) => ({ hour, cents }))
        }))
    };
  },

  // Gift card balance check for the charge sheet. Mirrors redeem()'s gate
  // (status ACTIVE + not expired) rather than lookup()'s paid-online check —
  // counter-activated and comp cards have no Stripe payment but redeem fine.
  async giftCardBalance(code: string) {
    const clean = code.trim().toUpperCase();
    if (!clean) throw new HttpError(400, 'Enter the gift card code.');
    const card = await prisma.giftCard.findUnique({
      where: { code: clean },
      select: { code: true, status: true, balanceCents: true, recipientName: true, expiresAt: true }
    });
    if (!card) throw new HttpError(404, 'No gift card with that code.');
    if (card.status !== 'ACTIVE') throw new HttpError(400, `That gift card is ${card.status.replace('_', ' ').toLowerCase()}.`);
    if (card.expiresAt && card.expiresAt < new Date()) throw new HttpError(400, 'That gift card has expired.');
    return { code: card.code, balanceCents: card.balanceCents, recipientName: card.recipientName ?? null };
  },

  // Standalone check so the register can pre-clear an approval sheet.
  async managerApprove(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const name = await verifyManagerPin(str(body.pin));
    return { ok: true, name };
  },

  async listRules() {
    return activeRules();
  },

  // ── Courses (register cycle order + docket grouping) ───────────────────
  async listCourses() {
    const count = await prisma.posCourse.count();
    if (count === 0) {
      await prisma.posCourse.createMany({
        data: ['Entrée', 'Mains', 'Sides', 'Dessert', 'Drinks'].map((name, index) => ({ name, sortOrder: index }))
      });
    }
    return prisma.posCourse.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  },

  // ── Printer profiles (docket routing) ──────────────────────────────────
  async listPrinterProfiles() {
    const count = await prisma.posPrinterProfile.count();
    if (count === 0) {
      await prisma.posPrinterProfile.createMany({
        data: [
          { name: 'Kitchen', matchKind: 'FOOD', sortOrder: 0 },
          { name: 'Bar', matchKind: 'BEVERAGE', sortOrder: 1 }
        ]
      });
    }
    return prisma.posPrinterProfile.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
  },

  // Send the order's unsent lines to their printer profiles: returns dockets
  // grouped per profile (course-ordered) and stamps the lines as sent. The
  // register prints each docket (browser/AirPrint now; ePOS network printers
  // when profiles carry an IP).
  // QR orders append while a waiter may still be building held lines — expose
  // the recompute so appended lines flow into totals without a full setLines.
  async recomputeOrderTotals(id: string) {
    await recomputeOrder(id);
  },

  async sendOrder(id: string, input?: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const fireCourses = Array.isArray(body.courses) ? (body.courses as unknown[]).map(String) : null;
    const onlyLineIds = Array.isArray(body.lineIds) ? new Set((body.lineIds as unknown[]).map(String)) : null;
    const order = await prisma.posOrder.findUnique({
      where: { id },
      include: { lines: { where: { sentAt: null }, orderBy: { createdAt: 'asc' } } }
    });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (onlyLineIds) order.lines = order.lines.filter((line) => onlyLineIds.has(line.id));
    if (fireCourses) order.lines = order.lines.filter((line) => fireCourses.includes(line.course ?? 'Mains'));
    if (order.lines.length === 0) return { dockets: [], sent: 0 };
    const [profiles, courses, recipeRows] = await Promise.all([
      this.listPrinterProfiles(),
      this.listCourses(),
      prisma.recipe.findMany({
        where: { id: { in: order.lines.map((line) => line.recipeId).filter((v): v is string => Boolean(v)) } },
        select: { id: true, kind: true, category: true }
      })
    ]);
    const recipeMeta = new Map(recipeRows.map((recipe) => [recipe.id, recipe]));
    const courseRank = new Map(courses.map((course, index) => [course.name, index]));

    const dockets = profiles
      .map((profile) => {
        const categories = profile.categoriesCsv.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
        const lines = order.lines.filter((line) => {
          const meta = line.recipeId ? recipeMeta.get(line.recipeId) : null;
          // No recipe link: route by the line's course (Drinks → bar).
          const kind = meta ? kindBucket(meta.kind, meta.category) : line.course === 'Drinks' ? 'BEVERAGE' : 'FOOD';
          if (categories.length > 0) return categories.includes((meta?.category ?? '').toLowerCase());
          return kind === profile.matchKind;
        });
        if (lines.length === 0) return null;
        const sorted = lines
          .slice()
          .sort((a, b) => (courseRank.get(a.course ?? '') ?? 99) - (courseRank.get(b.course ?? '') ?? 99));
        return {
          profile: profile.name,
          printerIp: profile.printerIp,
          tableLabel: order.tableLabel,
          orderNumber: order.orderNumber,
          covers: order.covers,
          openedByName: order.openedByName,
          lines: sorted.map((line) => ({
            id: line.id,
            name: line.name,
            quantity: line.quantity,
            course: line.course,
            seat: line.seat,
            modifiers: (line.modifiers as Array<{ name: string; priceCents: number }> | null) ?? [],
            notes: line.notes
          }))
        };
      })
      .filter((docket): docket is NonNullable<typeof docket> => docket !== null);

    await prisma.posOrderLine.updateMany({
      where: { id: { in: order.lines.map((line) => line.id) } },
      data: { sentAt: new Date() }
    });
    // Persist each docket as a KDS ticket. Training orders never reach the
    // kitchen screens or printers — the register shows the docket preview only.
    if (dockets.length > 0 && !order.training) {
      await prisma.posTicket.createMany({
        data: dockets.map((docket) => ({
          venue: order.venue,
          station: docket.profile,
          orderId: order.id,
          orderNumber: order.orderNumber,
          tableLabel: order.tableLabel,
          covers: order.covers,
          openedByName: order.openedByName,
          lines: docket.lines as object[]
        }))
      });
    }
    return { dockets, sent: order.lines.length };
  },

  // ── Cash drawer ────────────────────────────────────────────────────────
  async drawerStatus(venue: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const drawer = await prisma.posDrawer.findFirst({ where: { venue, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    const expectedCents = drawer ? await drawerExpectedCents(drawer) : null;
    return { drawer, expectedCents };
  },

  async openDrawer(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const existing = await prisma.posDrawer.findFirst({ where: { venue, status: 'OPEN' } });
    if (existing) throw new HttpError(400, 'A drawer is already open for this venue — close it first.');
    return prisma.posDrawer.create({
      data: {
        venue,
        openingFloatCents: asInt(body.openingFloatCents ?? 0, 'opening float', { min: 0 }),
        openedByName: str(body.openedByName) || null
      }
    });
  },

  // Close with a denomination count: expected = float + cash takings while
  // the drawer was open; variance = counted − expected.
  async closeDrawer(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    const drawer = await prisma.posDrawer.findFirst({ where: { venue, status: 'OPEN' } });
    if (!drawer) throw new HttpError(404, 'No open drawer for this venue.');
    const denominations = (body.denominations ?? {}) as Record<string, unknown>;
    let countedCents = 0;
    const clean: Record<string, number> = {};
    for (const [denomination, qty] of Object.entries(denominations)) {
      const denomCents = Number(denomination);
      const quantity = Number(qty);
      if (!Number.isInteger(denomCents) || denomCents <= 0 || !Number.isInteger(quantity) || quantity < 0) continue;
      if (quantity > 0) clean[String(denomCents)] = quantity;
      countedCents += denomCents * quantity;
    }
    const expectedCents = await drawerExpectedCents(drawer);
    return prisma.posDrawer.update({
      where: { id: drawer.id },
      data: {
        status: 'CLOSED',
        countedCents,
        expectedCents,
        varianceCents: countedCents - expectedCents,
        denominations: clean,
        closedByName: str(body.closedByName) || null,
        notes: str(body.notes) || null,
        closedAt: new Date()
      }
    });
  },

  // ── Close of day ───────────────────────────────────────────────────────
  // Checklist gates first (open bills, open drawer), then the audit report.
  async closeDayStatus(venue: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const [openBills, drawer, alreadyClosed] = await Promise.all([
      prisma.posOrder.count({ where: { venue, status: 'OPEN' } }),
      prisma.posDrawer.findFirst({ where: { venue, status: 'OPEN' } }),
      prisma.posDayClose.findUnique({
        where: { venue_serviceDate: { venue, serviceDate: sydneyTodayUtcMidnight() } }
      })
    ]);
    return {
      openBills,
      drawerOpen: Boolean(drawer),
      alreadyClosed: Boolean(alreadyClosed),
      ready: openBills === 0 && !drawer && !alreadyClosed
    };
  },

  async closeDay(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const gate = await this.closeDayStatus(venue);
    if (gate.alreadyClosed) throw new HttpError(400, 'Close of day has already been run for today.');
    if (gate.openBills > 0) throw new HttpError(400, `${gate.openBills} bill(s) are still open — close or void them first.`);
    if (gate.drawerOpen) throw new HttpError(400, 'The cash drawer is still open — count and close it first.');

    const serviceDate = sydneyTodayUtcMidnight();
    const [summary, drawers] = await Promise.all([
      this.daySummary(venue, null),
      prisma.posDrawer.findMany({
        where: { venue, status: 'CLOSED', closedAt: { gte: new Date(serviceDate.getTime() - 12 * 3600_000) } },
        orderBy: { closedAt: 'asc' }
      })
    ]);
    const report = {
      ...summary,
      drawers: drawers.map((drawer) => ({
        openedAt: drawer.openedAt,
        closedAt: drawer.closedAt,
        openingFloatCents: drawer.openingFloatCents,
        expectedCents: drawer.expectedCents,
        countedCents: drawer.countedCents,
        varianceCents: drawer.varianceCents,
        closedByName: drawer.closedByName
      }))
    };
    await prisma.posDayClose.create({
      data: {
        venue,
        serviceDate,
        report: report as object,
        closedByName: str(body.closedByName) || null
      }
    });
    return report;
  },

  // ── Audited adjustments ────────────────────────────────────────────────
  adjustReasons() {
    return ADJUST_REASONS;
  },

  // Order-level manual discount (percent or fixed) with a mandatory reason.
  async discountOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const reason = str(body.reason);
    requireReason('DISCOUNT', reason);
    const staffName = str(body.staffName) || 'Unknown';
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true, venue: true, subtotalCents: true, tableLabel: true, orderNumber: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, 'Only open orders can be discounted.');
    const percent = body.percent === undefined ? null : Number(body.percent);
    const amountCents =
      percent !== null && Number.isFinite(percent) && percent > 0 && percent <= 100
        ? Math.round((order.subtotalCents * percent) / 100)
        : asInt(body.amountCents ?? 0, 'discount amount', { min: 1 });
    await prisma.posOrder.update({
      where: { id },
      data: { manualDiscountCents: amountCents, manualDiscountLabel: reason }
    });
    await recomputeOrder(id);
    await prisma.posAdjustment.create({
      data: {
        venue: order.venue,
        orderId: id,
        kind: 'DISCOUNT',
        reason,
        staffName,
        itemName: order.tableLabel ? `Table ${order.tableLabel}` : `Order #${order.orderNumber}`,
        amountCents
      }
    });
    return this.getOrder(id);
  },

  // Comp a line to $0, or change its price — both reason-audited.
  async adjustLine(orderId: string, lineId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const kind = str(body.kind).toUpperCase();
    if (!['COMP', 'PRICE_CHANGE'].includes(kind)) throw new HttpError(400, 'kind must be COMP or PRICE_CHANGE.');
    const reason = str(body.reason);
    requireReason(kind, reason);
    const staffName = str(body.staffName) || 'Unknown';
    const line = await prisma.posOrderLine.findUnique({ where: { id: lineId }, include: { order: { select: { status: true, venue: true } } } });
    if (!line || line.orderId !== orderId) throw new HttpError(404, 'Line not found.');
    if (line.order.status !== 'OPEN') throw new HttpError(400, 'Only open orders can be adjusted.');
    const newUnit = kind === 'COMP' ? 0 : asInt(body.unitPriceCents, 'new price', { min: 0, max: 1_000_000 });
    const delta = (line.unitPriceCents - newUnit) * line.quantity;
    await prisma.posOrderLine.update({
      where: { id: lineId },
      data: { unitPriceCents: newUnit, totalCents: newUnit * line.quantity }
    });
    await recomputeOrder(orderId);
    await prisma.posAdjustment.create({
      data: {
        venue: line.order.venue,
        orderId,
        kind,
        reason,
        staffName,
        itemName: `${line.quantity}× ${line.name}`,
        amountCents: delta
      }
    });
    return this.getOrder(orderId);
  },

  // Wastage from the homescreen: item + qty + reason, valued at recipe cost.
  async recordWastage(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const reason = str(body.reason);
    requireReason('WASTAGE', reason);
    const staffName = str(body.staffName) || 'Unknown';
    const quantity = asInt(body.quantity ?? 1, 'quantity', { min: 1, max: 999 });
    const recipeId = str(body.recipeId) || null;
    let itemName = str(body.itemName);
    let amountCents = 0;
    if (recipeId) {
      const recipe = await prisma.recipe.findUnique({ where: { id: recipeId }, select: { title: true, estimatedCost: true } });
      if (recipe) {
        itemName = itemName || recipe.title;
        amountCents = Math.round((recipe.estimatedCost ?? 0) * 100) * quantity;
      }
    }
    if (!itemName) throw new HttpError(400, 'Pick the wasted item.');
    return prisma.posAdjustment.create({
      data: { venue, kind: 'WASTAGE', reason, staffName, itemName: `${quantity}× ${itemName}`, amountCents }
    });
  },

  async listAdjustments(venue: string | null) {
    return prisma.posAdjustment.findMany({
      where: { ...(venue ? { venue } : {}), createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
  },

  // Register audit for Reports: every discount/comp/price-change/wastage,
  // void and refund in a date window, with who and why. Sydney-day bounds.
  async auditReport(venue: string | null, fromKey: string | null, toKey: string | null) {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!fromKey || !toKey || !dayRe.test(fromKey) || !dayRe.test(toKey)) {
      throw new HttpError(400, 'from and to (YYYY-MM-DD) are required.');
    }
    const from = new Date(`${fromKey}T00:00:00+10:00`);
    const to = new Date(`${toKey}T00:00:00+10:00`);
    const venueWhere = venue ? { venue } : {};
    const [adjustments, voids, refunds] = await Promise.all([
      prisma.posAdjustment.findMany({
        where: { ...venueWhere, createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: 'desc' },
        take: 500
      }),
      prisma.posOrder.findMany({
        where: { ...venueWhere, status: 'VOID', voidedAt: { gte: from, lt: to } },
        orderBy: { voidedAt: 'desc' },
        take: 200,
        select: {
          orderNumber: true,
          venue: true,
          tableLabel: true,
          totalCents: true,
          voidReason: true,
          voidedAt: true,
          openedByName: true,
          lines: { select: { name: true, quantity: true }, take: 4 }
        }
      }),
      prisma.posPayment.findMany({
        where: { amountCents: { lt: 0 }, createdAt: { gte: from, lt: to }, order: venueWhere },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          amountCents: true,
          method: true,
          createdAt: true,
          order: { select: { orderNumber: true, venue: true, tableLabel: true } }
        }
      })
    ]);
    const totals = { discountCents: 0, compCents: 0, wastageCount: 0, priceChangeCount: 0 };
    for (const adjustment of adjustments) {
      if (adjustment.kind === 'DISCOUNT') totals.discountCents += adjustment.amountCents ?? 0;
      else if (adjustment.kind === 'COMP') totals.compCents += adjustment.amountCents ?? 0;
      else if (adjustment.kind === 'WASTAGE') totals.wastageCount += 1;
      else if (adjustment.kind === 'PRICE_CHANGE') totals.priceChangeCount += 1;
    }
    return {
      from: fromKey,
      to: toKey,
      venue,
      totals: {
        ...totals,
        voidCount: voids.length,
        voidCents: voids.reduce((sum, order) => sum + order.totalCents, 0),
        refundCents: refunds.reduce((sum, payment) => sum - payment.amountCents, 0)
      },
      adjustments,
      voids,
      refunds
    };
  },

  // ── Per-operator homescreen ────────────────────────────────────────────
  async getHomescreen(userKey: string | null) {
    const defaults = { buttons: ['open-till', 'discount', 'comp', 'wastage', 'price'], pins: [] as unknown[], landingCategory: null as string | null, categories: null as object | null };
    if (!userKey) return defaults;
    const row = await prisma.posHomescreen.findUnique({ where: { userKey: userKey.toLowerCase() } });
    return row
      ? { buttons: row.buttons as string[], pins: row.pins as unknown[], landingCategory: row.landingCategory, categories: (row.categories as object | null) ?? null }
      : defaults;
  },

  async saveHomescreen(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const userKey = str(body.userKey).toLowerCase();
    if (!userKey) throw new HttpError(400, 'userKey is required.');
    const buttons = Array.isArray(body.buttons) ? (body.buttons as unknown[]).map(String).slice(0, 12) : [];
    // Pins are rich objects ({t:'i',id} items / {t:'f',name,items} folders) —
    // pass through with a shallow shape check; legacy string pins upgrade.
    const pins = (Array.isArray(body.pins) ? (body.pins as unknown[]) : [])
      .map((pin) => {
        if (typeof pin === 'string') return { t: 'i', id: pin };
        if (pin && typeof pin === 'object') {
          const row = pin as Record<string, unknown>;
          // label = display-only rename (dockets/KDS keep the recipe title);
          // s = tile size ('w' wide, 'b' big; absent = standard).
          const pinExtras = {
            ...(typeof row.c === 'string' ? { c: row.c } : {}),
            ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim().slice(0, 40) } : {}),
            ...(row.s === 'w' || row.s === 'b' ? { s: row.s } : {})
          };
          if (row.t === 'i' && typeof row.id === 'string') {
            return { t: 'i', id: row.id, ...pinExtras };
          }
          if (row.t === 'f' && typeof row.name === 'string' && Array.isArray(row.items)) {
            return {
              t: 'f',
              name: row.name.slice(0, 40),
              items: (row.items as unknown[]).map(String).slice(0, 40),
              ...pinExtras
            };
          }
        }
        return null;
      })
      .filter((pin): pin is NonNullable<typeof pin> => pin !== null)
      .slice(0, 24);
    const landingCategory = str(body.landingCategory) || null;
    // Category tab customisation: order + hidden + grouped tabs.
    let categories: object | null = null;
    if (body.categories && typeof body.categories === 'object') {
      const raw = body.categories as Record<string, unknown>;
      categories = {
        order: (Array.isArray(raw.order) ? raw.order : []).map(String).slice(0, 60),
        hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).map(String).slice(0, 60),
        groups: (Array.isArray(raw.groups) ? raw.groups : [])
          .map((group) => {
            if (!group || typeof group !== 'object') return null;
            const row = group as Record<string, unknown>;
            if (typeof row.name !== 'string' || !Array.isArray(row.cats)) return null;
            return {
              name: row.name.trim().slice(0, 30),
              cats: (row.cats as unknown[]).map(String).slice(0, 20),
              ...(typeof row.c === 'string' ? { c: row.c } : {})
            };
          })
          .filter((group): group is NonNullable<typeof group> => group !== null)
          .slice(0, 12)
      };
    }
    return prisma.posHomescreen.upsert({
      where: { userKey },
      create: { userKey, buttons, pins, categories: categories ?? undefined, landingCategory, updatedBy: str(body.updatedBy) || null },
      update: { buttons, pins, categories: categories ?? undefined, landingCategory, updatedBy: str(body.updatedBy) || null }
    });
  },

  // ── Stripe Terminal ────────────────────────────────────────────────────
  async terminalConnectionToken() {
    if (!stripe) throw new HttpError(503, 'Stripe is not configured on the server.');
    const token = await stripe.terminal.connectionTokens.create();
    return { secret: token.secret };
  },

  async terminalPaymentIntent(input: unknown) {
    if (!stripe) throw new HttpError(503, 'Stripe is not configured on the server.');
    const body = (input ?? {}) as Record<string, unknown>;
    const amountCents = asInt(body.amountCents, 'amount', { min: 50 });
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'aud',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: str(body.description) || 'ALMA POS'
    });
    return { id: intent.id, clientSecret: intent.client_secret };
  },

  // Live guest profile for the register: CRM totals + favourite items
  // aggregated from every POS order they've settled.
  async guestProfile(id: string) {
    const guest = await prisma.reserveGuest.findUnique({
      where: { id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        totalVisits: true,
        totalSpendCents: true,
        lastVisitAt: true,
        tags: true,
        allergyNotes: true,
        dietaryNotes: true,
        visitNotes: true
      }
    });
    if (!guest) throw new HttpError(404, 'Guest not found.');
    const favourites = await prisma.posOrderLine.groupBy({
      by: ['name'],
      where: { order: { guestId: id, status: 'PAID' } },
      _sum: { quantity: true, totalCents: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5
    });
    return {
      ...guest,
      favourites: favourites.map((row) => ({
        name: row.name,
        quantity: row._sum.quantity ?? 0,
        totalCents: row._sum.totalCents ?? 0
      }))
    };
  },

  // ── Kitchen display ────────────────────────────────────────────────────
  async kdsBoard(venue: string | null, station: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const where = { venue, ...(station ? { station } : {}) };
    const [active, recent] = await Promise.all([
      prisma.posTicket.findMany({ where: { ...where, bumpedAt: null }, orderBy: { firedAt: 'asc' }, take: 60 }),
      prisma.posTicket.findMany({
        where: { ...where, bumpedAt: { not: null } },
        orderBy: { bumpedAt: 'desc' },
        take: 6
      })
    ]);
    // All-day counts: what the station still owes across active tickets.
    const allDay = new Map<string, number>();
    for (const ticket of active) {
      for (const line of ticket.lines as Array<{ name: string; quantity: number }>) {
        allDay.set(line.name, (allDay.get(line.name) ?? 0) + line.quantity);
      }
    }
    return {
      tickets: active,
      recent,
      allDay: Array.from(allDay.entries())
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 12)
    };
  },

  async kdsBump(id: string, recall = false) {
    const ticket = await prisma.posTicket.findUnique({ where: { id }, select: { id: true } });
    if (!ticket) throw new HttpError(404, 'Ticket not found.');
    return prisma.posTicket.update({ where: { id }, data: { bumpedAt: recall ? null : new Date() } });
  },

  // Tonight's bookings for the floor overlay — matched to tables by label.
  async floorReservations(venue: string | null) {
    if (!venue) return [];
    const serviceDate = sydneyTodayUtcMidnight();
    const reservations = await prisma.reserveReservation.findMany({
      where: {
        venue,
        serviceDate,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] }
      },
      select: {
        id: true,
        guestName: true,
        covers: true,
        startsAt: true,
        status: true,
        area: true,
        tableLabels: true,
        table: { select: { label: true } },
        guest: { select: { firstName: true, lastName: true } }
      },
      orderBy: { startsAt: 'asc' }
    });
    return reservations.map((reservation) => ({
      id: reservation.id,
      name:
        reservation.guestName ??
        `${reservation.guest?.firstName ?? ''} ${reservation.guest?.lastName ?? ''}`.trim() ??
        'Guest',
      covers: reservation.covers,
      startsAt: reservation.startsAt,
      status: reservation.status,
      area: reservation.area,
      tableLabel: reservation.table?.label ?? reservation.tableLabels?.split(/[,;/]/)[0]?.trim() ?? null
    }));
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
    const where = { status: 'PAID', serviceDate, training: false, ...(venue ? { venue } : {}) };
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
