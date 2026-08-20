import Stripe from 'stripe';
import { Prisma } from '@prisma/client';
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
  WASTAGE: ['Dropped / spilled', 'Kitchen error', 'Wrong order', 'Expired / off', 'Customer return', 'Over-prepped', 'Training']
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
export function kindBucket(kind: string | null, category: string | null): 'FOOD' | 'BEVERAGE' {
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

export function sydneyTodayUtcMidnight(): Date {
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
  // A gift card is a FACE VALUE VOUCHER, not a sale of food: it attracts no
  // GST at the point of sale (GST is accounted for when it's redeemed), and
  // it must never be surcharged or discounted — $100 of card costs $100.
  const giftCents = lines.filter((line) => line.isGiftCard).reduce((sum, line) => sum + line.totalCents, 0);
  const goodsCents = lines.filter((line) => !line.isGiftCard).reduce((sum, line) => sum + line.totalCents, 0);
  const subtotalCents = goodsCents + giftCents;
  const { surcharge, discounts } = await applicableRules();
  const surchargeCents = surcharge ? Math.round((goodsCents * surcharge.percent) / 100) : 0;
  const autoDiscount = discounts[0] ?? null;
  const discountCents = autoDiscount ? Math.round((goodsCents * autoDiscount.percent) / 100) : 0;
  const existing = await prisma.posOrder.findUnique({ where: { id }, select: { manualDiscountCents: true } });
  const manualDiscountCents = Math.min(existing?.manualDiscountCents ?? 0, goodsCents);
  const goodsTotalCents = Math.max(0, goodsCents - discountCents - manualDiscountCents + surchargeCents);
  const totalCents = goodsTotalCents + giftCents;
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
      // GST on the food and drink only.
      gstCents: Math.round(goodsTotalCents / GST_DIVISOR)
    }
  });
}

// Gift card lines are rebuilt from the sale records after any line edit, so
// a client that echoes or drops them cannot corrupt the bill.
async function syncGiftCardLines(orderId: string) {
  const sales = await prisma.posGiftCardSale.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
  await prisma.posOrderLine.deleteMany({ where: { orderId, isGiftCard: true } });
  if (sales.length === 0) return;
  await prisma.posOrderLine.createMany({
    data: sales.map((sale) => ({
      orderId,
      recipeId: null,
      name: `Gift card${sale.recipientName ? ` - ${sale.recipientName}` : ''}`,
      unitPriceCents: sale.amountCents,
      quantity: 1,
      totalCents: sale.amountCents,
      course: null,
      isGiftCard: true
    }))
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
const MANAGER_ROLE = /manager|owner|director|licensee|admin/i;

// St Alma and Alma Avalon are separate companies with separate Stripe
// accounts: STRIPE_SECRET_KEY__ST_ALMA / __ALMA_AVALON override the default
// key per venue so each company's takings land in its own account.
const stripeByVenue = new Map<string, Stripe | null>();
export function stripeForVenue(venue: string | null | undefined): Stripe | null {
  const slug = (venue ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!slug) return stripe;
  if (!stripeByVenue.has(slug)) {
    const key = process.env[`STRIPE_SECRET_KEY__${slug}`];
    stripeByVenue.set(slug, key ? new Stripe(key) : null);
  }
  return stripeByVenue.get(slug) ?? stripe;
}

async function verifyManagerPin(pin: string, permission?: string): Promise<string> {
  if (!/^\d{4,8}$/.test(pin)) throw new HttpError(403, 'Manager PIN required.');
  const managers = await prisma.staffProfile.findMany({
    where: {
      accountType: 'HUMAN',
      employmentStatus: 'ACTIVE',
      mergedIntoStaffProfileId: null,
      pinHash: { not: null }
    },
    select: { firstName: true, lastName: true, roleTitle: true, pinHash: true, pinLockedUntil: true, posPermissions: true }
  });
  for (const profile of managers) {
    const granted =
      permission !== undefined &&
      ((profile.posPermissions as Record<string, boolean> | null)?.[permission] === true);
    if (!MANAGER_ROLE.test(profile.roleTitle) && !granted) continue;
    if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) continue;
    if (await authService.comparePin(pin, profile.pinHash!)) return `${profile.firstName} ${profile.lastName}`.trim();
  }
  throw new HttpError(403, 'That PIN does not belong to a manager.');
}

// Pull dietary flags out of booking free-text (SevenRooms notes / special
// requests) so they follow the table onto the register automatically.
const DIETARY_PATTERNS: Array<[RegExp, string]> = [
  [/gluten[- ]?free|coeliac|celiac|\bgf\b/i, 'GF'],
  [/dairy[- ]?free|lactose|\bdf\b/i, 'DF'],
  [/\bvegan\b/i, 'Vegan'],
  [/vegetarian/i, 'Vegetarian'],
  [/\bnut\b|peanut|almond|cashew|walnut/i, 'Nut allergy'],
  [/shellfish|crustacean|prawn|oyster|lobster/i, 'Shellfish allergy'],
  [/pescatarian/i, 'Pescatarian'],
  [/halal/i, 'Halal'],
  [/kosher/i, 'Kosher'],
  [/allerg|anaphyla|intoleran/i, 'Allergy — see note']
];
function dietaryFromText(text: string): Array<{ tag: string; seat: number | null }> {
  if (!text) return [];
  const tags: Array<{ tag: string; seat: number | null }> = [];
  for (const [pattern, tag] of DIETARY_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (tag === 'Allergy — see note' && tags.some((entry) => /allergy/i.test(entry.tag))) continue;
    if (!tags.some((entry) => entry.tag === tag)) tags.push({ tag, seat: null });
  }
  return tags.slice(0, 8);
}

type DocketPayload = {
  profile: string;
  kind?: 'FIRE' | 'HOLD' | 'FULL';
  orderType?: string | null;
  tableLabel: string | null;
  orderNumber: number;
  covers: number | null;
  openedByName: string | null;
  firedByName?: string | null;
  orderedAt?: string | null;
  firedAt?: string | null;
  orderNotes?: string | null;
  dietary?: Array<{ tag: string; seat: number | null }>;
  lines: Array<{
    id: string;
    name: string;
    quantity: number;
    course: string | null;
    seat?: number | null;
    modifiers?: Array<{ name: string }>;
    notes?: string | null;
  }>;
};

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A docket as ePOS-Print XML: big table header, unmissable dietary banner,
// ruled course headings, per-line tags, feed and cut.
// Just the drawer kick — no text, no cut, no paper.
function buildDrawerXml(jobId: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<PrintRequestInfo Version="2.00">
<ePOSPrint>
<Parameter>
<devid>local_printer</devid>
<timeout>10000</timeout>
<printjobid>${jobId}</printjobid>
</Parameter>
<PrintData>
<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
<pulse drawer="1" time="100"/>
</epos-print>
</PrintData>
</ePOSPrint>
</PrintRequestInfo>`;
}

function buildPrintRequestXml(jobId: string, docket: DocketPayload) {
  const parts: string[] = [];
  const line = (text = '') => parts.push(`<text>${xmlEscape(text)}&#10;</text>`);
  // Kitchen wall clock, Sydney — never an ISO string on paper.
  const clock = (iso?: string | null) =>
    iso
      ? new Date(iso)
          .toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' })
          .toLowerCase()
          .replace(' ', '')
      : '';
  parts.push('<text lang="en"/>');
  parts.push('<text align="center"/>');
  // What this docket IS, before anything else.
  parts.push('<text width="2" height="2" em="true" reverse="true"/>');
  line(docket.kind === 'HOLD' ? ' HOLD - DO NOT MAKE ' : docket.kind === 'FULL' ? ' FULL ORDER - REF ' : ' FIRE - MAKE NOW ');
  parts.push('<text reverse="false"/>');
  line(docket.tableLabel ? `TABLE ${docket.tableLabel}` : `ORDER #${docket.orderNumber}`);
  parts.push('<text width="1" height="1" em="false"/>');
  parts.push('<text width="2" height="1" em="true"/>');
  line(
    `${(docket.orderType ?? 'DINE_IN') === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE IN'}${docket.covers ? ` - ${docket.covers} GUESTS` : ''}`
  );
  parts.push('<text width="1" height="1" em="false"/>');
  line(docket.profile);
  parts.push('<text align="left"/>');
  // Timestamps: the kitchen-performance trail lives on the paper too.
  const stamps = [
    docket.orderedAt ? `Ordered ${clock(docket.orderedAt)}` : '',
    docket.firedAt ? `Fired ${clock(docket.firedAt)}` : '',
    `Printed ${clock(new Date().toISOString())}`
  ].filter(Boolean);
  line(stamps.join('  '));
  const people = [
    docket.openedByName ? `Taken by ${docket.openedByName}` : '',
    docket.firedByName ? `Away by ${docket.firedByName}` : ''
  ].filter(Boolean);
  if (people.length > 0) line(people.join('  '));
  const dietary = docket.dietary ?? [];
  if (dietary.length > 0) {
    parts.push('<text em="true"/>');
    line('****** DIETARY ******');
    for (const tag of dietary) line(`* ${tag.tag}${tag.seat ? ` (S${tag.seat})` : ''}`);
    line('*********************');
    parts.push('<text em="false"/>');
  }
  if (docket.orderNotes) line(`NOTE: ${docket.orderNotes}`);
  line('------------------------------------------');
  let currentCourse: string | null = null;
  for (const row of docket.lines) {
    const course = row.course ?? 'NOW';
    if (course !== currentCourse) {
      currentCourse = course;
      parts.push('<text em="true"/>');
      line(`--- ${course.toUpperCase()} ---`);
      parts.push('<text em="false"/>');
    }
    parts.push('<text width="2" height="1"/>');
    line(`${row.quantity} x ${row.name}${row.seat ? `  S${row.seat}` : ''}`);
    parts.push('<text width="1" height="1"/>');
    const mods = (row.modifiers ?? []).map((modifier) => modifier.name).join(', ');
    if (mods) line(`   ${mods}`);
    if (row.notes) line(`   ${row.notes}`);
    if (dietary.length > 0) {
      const seat = row.seat ?? null;
      const tags = dietary.filter((tag) => tag.seat === null || seat === null || tag.seat === seat);
      if (tags.length > 0) line(`   !! ${tags.map((tag) => tag.tag).join(' / ')}`);
    }
  }
  parts.push('<feed line="3"/>');
  parts.push('<cut type="feed"/>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<PrintRequestInfo Version="2.00">
<ePOSPrint>
<Parameter>
<devid>local_printer</devid>
<timeout>10000</timeout>
<printjobid>${jobId}</printjobid>
</Parameter>
<PrintData>
<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
${parts.join('\n')}
</epos-print>
</PrintData>
</ePOSPrint>
</PrintRequestInfo>`;
}

type ReceiptPayload = {
  kind: 'RECEIPT';
  businessName: string;
  abn: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  venue: string;
  paid: boolean;
  tableLabel: string | null;
  orderNumber: number;
  covers: number | null;
  lines: Array<{ name: string; quantity: number; totalCents: number; modifiers: string[] }>;
  subtotalCents: number;
  discountCents: number;
  discountLabel: string;
  surchargeCents: number;
  surchargeLabel: string;
  totalCents: number;
  gstCents: number;
  tipCents: number;
  payments: Array<{ method: string; amountCents: number }>;
};

// 42-column receipt: identity header, price-aligned lines, totals, GST.
function buildReceiptXml(jobId: string, receipt: ReceiptPayload) {
  const WIDTH = 42;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const row = (label: string, value: string) => {
    const space = Math.max(1, WIDTH - label.length - value.length);
    return `${label.slice(0, WIDTH - value.length - 1)}${' '.repeat(space)}${value}`;
  };
  const parts: string[] = [];
  const line = (text = '') => parts.push(`<text>${xmlEscape(text)}&#10;</text>`);
  parts.push('<text lang="en"/>');
  parts.push('<text align="center"/>');
  parts.push('<text width="2" height="2" em="true"/>');
  line(receipt.businessName.toUpperCase());
  parts.push('<text width="1" height="1" em="false"/>');
  if (receipt.abn) line(`ABN ${receipt.abn}`);
  if (receipt.address) line(receipt.address);
  if (receipt.phone) line(receipt.phone);
  line();
  line(
    `${receipt.tableLabel ? `Table ${receipt.tableLabel}` : `Order #${receipt.orderNumber}`}${receipt.covers ? ` - ${receipt.covers} guests` : ''}`
  );
  line(new Date().toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }));
  parts.push('<text align="left"/>');
  line('-'.repeat(WIDTH));
  for (const item of receipt.lines) {
    line(row(`${item.quantity} x ${item.name}`, dollars(item.totalCents)));
    for (const modifier of item.modifiers) line(`   ${modifier}`);
  }
  line('-'.repeat(WIDTH));
  line(row('Subtotal', dollars(receipt.subtotalCents)));
  if (receipt.discountCents > 0) line(row(receipt.discountLabel, `-${dollars(receipt.discountCents)}`));
  if (receipt.surchargeCents > 0) line(row(receipt.surchargeLabel, `+${dollars(receipt.surchargeCents)}`));
  parts.push('<text em="true" width="2" height="2"/>');
  // Double-width text halves the columns: pad TOTAL to 21 chars.
  {
    const value = dollars(receipt.totalCents);
    line(`TOTAL${' '.repeat(Math.max(1, 21 - 5 - value.length))}${value}`);
  }
  parts.push('<text em="false" width="1" height="1"/>');
  line(row('GST included', dollars(receipt.gstCents)));
  if (receipt.tipCents > 0) line(row('Tip', dollars(receipt.tipCents)));
  if (receipt.payments.length > 0) {
    line();
    for (const payment of receipt.payments) line(row(payment.method, dollars(payment.amountCents)));
  }
  line();
  parts.push('<text align="center"/>');
  line(receipt.paid ? 'Paid - thank you' : 'Not yet paid');
  if (receipt.website) line(receipt.website);
  parts.push('<feed line="3"/>');
  parts.push('<cut type="feed"/>');
  return `<?xml version="1.0" encoding="UTF-8"?>
<PrintRequestInfo Version="2.00">
<ePOSPrint>
<Parameter>
<devid>local_printer</devid>
<timeout>10000</timeout>
<printjobid>${jobId}</printjobid>
</Parameter>
<PrintData>
<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">
${parts.join('\n')}
</epos-print>
</PrintData>
</ePOSPrint>
</PrintRequestInfo>`;
}

// Turn every unissued gift card sale on a settled bill into a real card.
// Failures are logged, never thrown: the guest has already paid, and losing
// the payment because an email bounced would be far worse than a card that
// needs re-issuing from the sale record (which is still sitting right here).
async function issuePendingGiftCards(orderId: string, method: string, venue: string) {
  const pending = await prisma.posGiftCardSale.findMany({ where: { orderId, issuedAt: null } });
  if (pending.length === 0) return [] as Array<{ code: string; amountCents: number }>;
  const tender = method === 'CASH' ? 'CASH' : method === 'CARD_EXTERNAL' ? 'EFTPOS' : 'CARD';
  const issued: Array<{ code: string; amountCents: number }> = [];
  for (const sale of pending) {
    try {
      const card = await giftCardService.activatePhysicalCard({
        code: sale.requestedCode ?? undefined,
        initialValueCents: sale.amountCents,
        purchaserName: 'Counter sale',
        recipientName: sale.recipientName ?? undefined,
        recipientEmail: sale.recipientEmail ?? undefined,
        tender,
        tenderReference: `POS ${venue}`
      });
      await prisma.posGiftCardSale.update({
        where: { id: sale.id },
        data: { issuedCode: card.code, issuedAt: new Date() }
      });
      issued.push({ code: card.code, amountCents: sale.amountCents });
    } catch (err) {
      console.error('[pos] gift card issue failed', sale.id, err);
    }
  }
  return issued;
}

async function postPosActuals(venue: string) {
  const setting = await prisma.posVenueSetting.findUnique({ where: { venue } });
  if (!setting?.postToReports) return;
  const serviceDate = sydneyTodayUtcMidnight();
  const orders = await prisma.posOrder.findMany({
    where: { venue, serviceDate, status: 'PAID', training: false },
    include: { payments: true, lines: { where: { isGiftCard: true }, select: { totalCents: true } } }
  });
  // Selling a gift card is not revenue — it is a liability until the card is
  // spent, and the spend is what shows up as a sale. Counting it here would
  // book the same money twice.
  const giftIncCents = orders.reduce(
    (sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.totalCents, 0),
    0
  );
  const totalIncCents = orders.reduce((sum, order) => sum + order.totalCents, 0) - giftIncCents;
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
  id?: string | null;
  recipeId?: string | null;
  name: string;
  // Kitchen docket/KDS override, snapshotted from the menu item's printTitle
  // at add-to-cart time. Optional — most items have none.
  printName?: string | null;
  unitPriceCents: number;
  quantity: number;
  course?: string | null;
  seat?: number | null;
  modifiers?: Array<{ name: string; priceCents: number }> | null;
  notes?: string | null;
  // The set menu that paid for this line — set on the $0 dishes a banquet
  // rings, NULL on anything sold on its own.
  packagedBy?: string | null;
  isGiftCard?: boolean;
};

function parseLines(raw: unknown): LineInput[] {
  if (!Array.isArray(raw)) throw new HttpError(400, 'lines must be an array.');
  return raw.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const name = str(row.name);
    if (!name) throw new HttpError(400, `Line ${index + 1}: name is required.`);
    return {
      id: str(row.id) || null,
      recipeId: str(row.recipeId) || null,
      name: name.slice(0, 120),
      printName: str(row.printName) ? str(row.printName).slice(0, 120) : null,
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
      notes: str(row.notes) ? str(row.notes).slice(0, 200) : null,
      packagedBy: str(row.packagedBy) || null,
      isGiftCard: row.isGiftCard === true
    };
  });
}

// Everything a refund does AFTER a manager has approved it: the negative
// payment, the reason-audited adjustment, any gift cards the bill issued, and
// the actuals repost.
//
// Split out of refundOrder so the Square Terminal refund can reuse it. That
// flow takes the manager PIN BEFORE it touches the card — asking again once
// the money is already back on the guest's card would be both absurd and
// unsafe, and duplicating the bookkeeping here is how the two drift apart.
async function applyRefund(input: {
  orderId: string;
  amountCents?: number;
  reason: string;
  staffName: string; // already carries "(approved by …)"
  method: 'CASH' | 'REFUND';
}) {
  const { orderId, reason, staffName, method } = input;
  requireReason('COMP', reason);
  const order = await prisma.posOrder.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) throw new HttpError(404, 'Bill not found.');
  if (order.status !== 'PAID') throw new HttpError(400, 'Only paid bills can be refunded.');
  const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents + payment.tipCents, 0);
  const amountCents = input.amountCents ?? paid;
  if (amountCents > paid) throw new HttpError(400, `Only ${(paid / 100).toFixed(2)} was paid on this bill.`);
  await prisma.posPayment.create({
    data: { orderId, method, amountCents: -amountCents, tipCents: 0, reference: 'refund' }
  });
  await prisma.posAdjustment.create({
    data: {
      venue: order.venue,
      orderId,
      kind: 'COMP',
      reason,
      staffName,
      itemName: `REFUND ${order.tableLabel ? `table ${order.tableLabel}` : `#${order.orderNumber}`}`,
      amountCents
    }
  });
  // A refunded bill must not leave a live card in the wild. Only a FULL
  // refund kills the cards — a partial refund is usually one dish, not the
  // voucher, so those are reported instead of cancelled.
  const giftNotes: string[] = [];
  const sold = await prisma.posGiftCardSale.findMany({ where: { orderId, issuedCode: { not: null } } });
  if (sold.length > 0) {
    if (amountCents >= paid) {
      for (const sale of sold) {
        try {
          await giftCardService.cancel(sale.issuedCode!, {
            reason: `Bill refunded: ${reason}`,
            refundNote: `POS refund of ${order.tableLabel ? `table ${order.tableLabel}` : `#${order.orderNumber}`}`
          });
          giftNotes.push(`${sale.issuedCode} cancelled`);
        } catch (err) {
          // Already spent or already cancelled — say so rather than fail the
          // refund the guest is standing there waiting for.
          giftNotes.push(`${sale.issuedCode} could NOT be cancelled: ${(err as Error).message}`);
        }
      }
    } else {
      giftNotes.push(
        `Partial refund — ${sold.map((sale) => sale.issuedCode).join(', ')} left ACTIVE. Cancel in Gift Cards if the card is coming back.`
      );
    }
    await prisma.posAdjustment.create({
      data: {
        venue: order.venue,
        orderId,
        kind: 'COMP',
        reason,
        staffName,
        itemName: `GIFT CARDS: ${giftNotes.join(' · ')}`.slice(0, 190),
        amountCents: 0
      }
    });
  }
  await postPosActuals(order.venue).catch(() => undefined);
  const refunded = await posService.getOrder(orderId);
  return { ...refunded, giftCardNotes: giftNotes };
}

export { applyRefund, requireReason, verifyManagerPin };

// ── Homescreen pin sanitizing ────────────────────────────────────────────
// Pins are rich objects ({t:'i',id} items / {t:'f',name,items} folders) —
// pass through with a shallow shape check; legacy string pins upgrade.
// label = display-only rename (dockets/KDS keep the recipe title);
// s = tile size ('w' wide, 'b' big; absent = standard); look = how a
// folder shows its items (square tiles or full-menu list rows).
// Exported pure so the shape rules can be exercised without a database.
export type SavedPinExtras = { c?: string; label?: string; s?: 'w' | 'b'; d?: 'sh' | 'hs' | 'big'; look?: 'tiles' | 'list' };
export type SavedFolder = SavedPinExtras & { t: 'f'; name: string; items: string[]; folders?: SavedFolder[] };
export type SavedPin = ({ t: 'i'; id: string } & SavedPinExtras) | ({ t: 'm'; key: string } & SavedPinExtras) | SavedFolder;

export function sanitizeHomescreenPins(raw: unknown): SavedPin[] {
  const pinExtrasOf = (row: Record<string, unknown>): SavedPinExtras => ({
    ...(typeof row.c === 'string' ? { c: row.c } : {}),
    ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label.trim().slice(0, 40) } : {}),
    ...(row.s === 'w' || row.s === 'b' ? { s: row.s } : {}),
    ...(row.d === 'sh' || row.d === 'hs' || row.d === 'big' ? { d: row.d } : {}),
    ...(row.look === 'tiles' || row.look === 'list' ? { look: row.look } : {})
  });
  // Folders nest (Wine → Red → By the glass): the same shape at every
  // level, three levels deep at most so a hostile payload can't recurse.
  const sanitizeFolder = (row: Record<string, unknown>, depth: number): SavedFolder | null => {
    if (typeof row.name !== 'string' || !Array.isArray(row.items)) return null;
    const folders =
      depth < 3 && Array.isArray(row.folders)
        ? (row.folders as unknown[])
            .map((child) =>
              child && typeof child === 'object' ? sanitizeFolder(child as Record<string, unknown>, depth + 1) : null
            )
            .filter((child): child is SavedFolder => child !== null)
            .slice(0, 12)
        : [];
    return {
      t: 'f',
      name: row.name.slice(0, 40),
      items: (row.items as unknown[]).map(String).slice(0, 40),
      ...(folders.length ? { folders } : {}),
      ...pinExtrasOf(row)
    };
  };
  return (Array.isArray(raw) ? (raw as unknown[]) : [])
    .map((pin): SavedPin | null => {
      if (typeof pin === 'string') return { t: 'i', id: pin };
      if (pin && typeof pin === 'object') {
        const row = pin as Record<string, unknown>;
        if (row.t === 'i' && typeof row.id === 'string') {
          return { t: 'i', id: row.id, ...pinExtrasOf(row) };
        }
        // Management actions are pins too, so they move and size like the rest.
        if (row.t === 'm' && typeof row.key === 'string') {
          return { t: 'm', key: row.key.slice(0, 40), ...pinExtrasOf(row) };
        }
        if (row.t === 'f') return sanitizeFolder(row, 1);
      }
      return null;
    })
    .filter((pin): pin is SavedPin => pin !== null)
    .slice(0, 24);
}

export const posService = {
  // The sellable menu, grouped for the register grid: active non-prep recipes
  // with a price, plus set menus. Categories keep the recipe's own category.
  async registerMenu() {
    const hides = await prisma.posMenuHide.findMany({ select: { kind: true, key: true } });
    const hiddenItems = new Set(hides.filter((hide) => hide.kind === 'ITEM').map((hide) => hide.key));
    const hiddenCats = new Set(hides.filter((hide) => hide.kind === 'CATEGORY').map((hide) => hide.key.toLowerCase()));
    const recipes = await prisma.recipe.findMany({
      where: { status: 'ACTIVE', isPrepRecipe: false, salePriceCents: { gt: 0 } },
      select: { id: true, title: true, printTitle: true, kind: true, category: true, venue: true, salePriceCents: true, canonicalId: true },
      orderBy: [{ category: 'asc' }, { title: 'asc' }]
    });
    // Per-venue price overrides. RecipeVenuePrice is maintained by the Square
    // sync and editable in Stock, but the register never read it — venue
    // prices could drift from what Square was actually charging. A recipe
    // that is venue-tagged gets its own venue's override applied directly;
    // the full map still ships so a shared (venue-null) recipe can price per
    // register at the client.
    const venuePriceRows = await prisma.recipeVenuePrice.findMany({
      select: { recipeId: true, venue: true, salePriceCents: true }
    });
    const venuePriceMap = new Map<string, Record<string, number>>();
    for (const row of venuePriceRows) {
      const entry = venuePriceMap.get(row.recipeId) ?? {};
      entry[row.venue] = row.salePriceCents;
      venuePriceMap.set(row.recipeId, entry);
    }
    type RegisterItem = {
      recipeId: string;
      title: string;
      printTitle?: string | null;
      priceCents: number;
      venue: string | null;
      canonicalId?: string | null;
      venuePrices?: Record<string, number>;
      variantOf?: string;
      variants?: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null; label: string }>;
    };
    const byCategory = new Map<string, { name: string; kind: string; items: RegisterItem[] }>();
    const itemRefs = new Map<string, RegisterItem>();
    for (const recipe of recipes) {
      if (hiddenItems.has(recipe.id)) continue;
      const name = recipe.kind === 'SET_MENU' ? 'Set Menus' : recipe.category?.trim() || 'Other';
      if (hiddenCats.has(name.toLowerCase())) continue;
      const group = byCategory.get(name) ?? {
        name,
        kind: recipe.kind === 'SET_MENU' ? 'SET_MENU' : kindBucket(recipe.kind, recipe.category),
        items: []
      };
      const overrides = venuePriceMap.get(recipe.id);
      const item: RegisterItem = {
        recipeId: recipe.id,
        title: recipe.title,
        printTitle: recipe.printTitle,
        priceCents:
          (recipe.venue ? overrides?.[recipe.venue] : undefined) ?? recipe.salePriceCents ?? 0,
        venue: recipe.venue,
        canonicalId: recipe.canonicalId ?? null,
        ...(overrides ? { venuePrices: overrides } : {})
      };
      group.items.push(item);
      itemRefs.set(recipe.id, item);
      byCategory.set(name, group);
    }
    const categories = Array.from(byCategory.values()).sort((a, b) => {
      if (a.name === 'Set Menus') return -1;
      if (b.name === 'Set Menus') return 1;
      return a.name.localeCompare(b.name);
    });
    // Everything the banquet picker needs, shipped with the menu so tapping a
    // set menu opens instantly instead of waiting on a second request.
    const setMenuIds = recipes.filter((recipe) => recipe.kind === 'SET_MENU').map((recipe) => recipe.id);
    const [eightySix, modifierGroups, variantLinks, setMenuLines, setMenuCourses, wineRows] = await Promise.all([
      prisma.pos86.findMany({ select: { recipeId: true } }),
      prisma.posModifierGroup.findMany({
        where: { active: true },
        include: { options: { where: { active: true }, orderBy: { sortOrder: 'asc' } } },
        orderBy: { sortOrder: 'asc' }
      }),
      prisma.posVariantLink.findMany({ orderBy: [{ parentRecipeId: 'asc' }, { sortOrder: 'asc' }] }),
      setMenuIds.length
        ? prisma.recipeLine.findMany({
            where: { recipeId: { in: setMenuIds } },
            orderBy: { position: 'asc' },
            select: {
              recipeId: true,
              ingredientName: true,
              quantity: true,
              perGuests: true,
              subRecipeId: true,
              subRecipe: { select: { title: true, printTitle: true } }
            }
          })
        : Promise.resolve([]),
      setMenuIds.length
        ? prisma.setMenuCourse.findMany({
            where: { setMenuRecipeId: { in: setMenuIds } },
            orderBy: { sortOrder: 'asc' },
            include: {
              options: {
                // Tonight's menu only — an option that is switched off should
                // not be a tile someone can tap by mistake.
                where: { available: true },
                orderBy: { sortOrder: 'asc' },
                include: { recipe: { select: { title: true, salePriceCents: true, estimatedCost: true } } }
              }
            }
          })
        : Promise.resolve([]),
      // Wine sells differently from everything else: the guest asks for a
      // grape, a region or a number, never for a tile. The register lists it
      // instead of gridding it, which needs the detail alongside the price.
      prisma.wine.findMany({
        where: { status: 'ACTIVE', pours: { some: {} } },
        orderBy: [{ venue: 'asc' }, { sortOrder: 'asc' }],
        include: {
          pours: {
            orderBy: { ml: 'asc' },
            include: { recipe: { select: { id: true, title: true, printTitle: true, salePriceCents: true, status: true } } }
          }
        }
      })
    ]);
    // Variants: children fold under their parent's tile on the register (the
    // QR menu keeps the flat rows). A self-row labels the parent option.
    const variantsByParent = new Map<string, NonNullable<RegisterItem['variants']>>();
    for (const link of variantLinks) {
      const child = itemRefs.get(link.childRecipeId);
      if (!child) continue;
      const list = variantsByParent.get(link.parentRecipeId) ?? [];
      list.push({ recipeId: child.recipeId, title: child.title, priceCents: child.priceCents, venue: child.venue, label: link.label });
      variantsByParent.set(link.parentRecipeId, list);
      if (link.childRecipeId !== link.parentRecipeId) child.variantOf = link.parentRecipeId;
    }
    for (const [parentId, options] of variantsByParent) {
      const parent = itemRefs.get(parentId);
      if (!parent) continue;
      if (!options.some((option) => option.recipeId === parentId)) {
        options.unshift({ recipeId: parent.recipeId, title: parent.title, priceCents: parent.priceCents, venue: parent.venue, label: 'Standard' });
      }
      parent.variants = options;
    }
    // A set menu with no courses is just a priced tile — the picker only opens
    // for menus that actually ask a question, so the existing $0 package flow
    // keeps working untouched for the ones nobody has set up yet.
    const setMenus = setMenuIds
      .map((recipeId) => {
        const recipe = itemRefs.get(recipeId);
        const courses = setMenuCourses
          .filter((course) => course.setMenuRecipeId === recipeId)
          .map((course) => ({
            id: course.id,
            name: course.name,
            posCourse: course.posCourse,
            pick: course.pick,
            perGuests: course.perGuests,
            sortOrder: course.sortOrder,
            options: course.options.map((option) => ({
              id: option.id,
              recipeId: option.recipeId,
              title: option.recipe.title,
              supplementCents: option.supplementCents,
              available: option.available,
              salePriceCents: option.recipe.salePriceCents,
              estimatedCost: option.recipe.estimatedCost,
              sortOrder: option.sortOrder
            }))
          }));
        return {
          recipeId,
          title: recipe?.title ?? '',
          salePriceCents: recipe?.priceCents ?? null,
          fixed: setMenuLines
            .filter((line) => line.recipeId === recipeId)
            .map((line) => ({
              name: line.subRecipe?.title ?? line.ingredientName,
              printName: line.subRecipe?.printTitle ?? null,
              recipeId: line.subRecipeId,
              quantity: line.quantity ?? 1,
              perGuests: line.perGuests
            })),
          courses
        };
      })
      .filter((plan) => plan.courses.length > 0 || plan.fixed.length > 0);
    // A pour with no price cannot be sold, and a wine with no sellable pour is
    // not on the list — both are reported in Stock, not papered over here.
    const wines = wineRows
      .map((wine) => ({
        id: wine.id,
        venue: wine.venue,
        name: `${wine.producer}${wine.cuvee ? ` '${wine.cuvee}'` : ''}`,
        producer: wine.producer,
        cuvee: wine.cuvee,
        grape: wine.grape,
        region: wine.region,
        origin: wine.origin,
        vintage: wine.vintage,
        section: wine.section,
        styleBand: wine.styleBand,
        pairsWith: wine.pairsWith,
        tastingNote: wine.tastingNote,
        sommelierPour: wine.sommelierPour,
        limitedStock: wine.limitedStock,
        serveChilled: wine.serveChilled,
        pours: wine.pours
          .filter((pour) => pour.recipe.status === 'ACTIVE' && pour.recipe.salePriceCents !== null)
          .map((pour) => ({
            recipeId: pour.recipe.id,
            ml: pour.ml,
            priceCents: pour.recipe.salePriceCents as number,
            title: pour.recipe.title,
            printName: pour.recipe.printTitle
          }))
      }))
      .filter((wine) => wine.pours.length > 0);
    return {
      categories,
      wines,
      setMenus,
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

  // Order-wide note + dietary flags. Seat null = the whole table; dockets
  // print tags on the header and under each dish (shared/unassigned dishes
  // carry every tag — when unsure it prints on everything).
  async setOrderMeta(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const data: { notes?: string | null; dietary?: Array<{ tag: string; seat: number | null }> } = {};
    if (body.notes !== undefined) data.notes = str(body.notes).slice(0, 500) || null;
    if (body.dietary !== undefined) {
      const rows = Array.isArray(body.dietary) ? body.dietary : [];
      data.dietary = rows
        .map((entry) => {
          const row = (entry ?? {}) as Record<string, unknown>;
          const tag = str(row.tag).slice(0, 40);
          if (!tag) return null;
          const seat = row.seat === null || row.seat === undefined || row.seat === '' ? null : Number(row.seat);
          return { tag, seat: Number.isFinite(seat) && (seat as number) > 0 ? Math.round(seat as number) : null };
        })
        .filter((row): row is { tag: string; seat: number | null } => row !== null)
        .slice(0, 12);
    }
    return prisma.posOrder.update({ where: { id }, data, include: ORDER_INCLUDE });
  },

  // ── Epson Server Direct Print ─────────────────────────────────────────
  // The printer polls us: GetRequest → oldest queued job as ePOS-Print XML;
  // SetResponse → mark the job printed/failed. (If the printer posts a body
  // we can't parse, it just falls through to GetRequest — printing still
  // works, only the status tracking is skipped.)
  async printPoll(profileId: string, body: Record<string, unknown>) {
    const connectionType = str(body.ConnectionType ?? body.connectiontype);
    if (/setresponse/i.test(connectionType)) {
      const file = str(body.ResponseFile ?? body.responsefile);
      const jobId = /printjobid>([^<]+)</i.exec(file)?.[1] ?? /printjobid="([^"]+)"/i.exec(file)?.[1] ?? '';
      const success = /success\s*=\s*"?(true|1)/i.test(file);
      if (jobId) {
        await prisma.posPrintJob
          .updateMany({ where: { id: jobId }, data: { status: success ? 'PRINTED' : 'FAILED', doneAt: new Date() } })
          .catch(() => undefined);
      }
      return { xml: '<?xml version="1.0" encoding="UTF-8"?>\n<PrintResponseInfo Version="2.00"/>' };
    }
    const job = await prisma.posPrintJob.findFirst({
      where: { profileId, status: 'QUEUED' },
      orderBy: { createdAt: 'asc' }
    });
    if (!job) return { xml: '' };
    await prisma.posPrintJob.update({ where: { id: job.id }, data: { status: 'SENT', sentAt: new Date() } });
    const payload = job.payload as { kind?: string };
    if (payload.kind === 'DRAWER') {
      return { xml: buildDrawerXml(job.id) };
    }
    return {
      xml:
        payload.kind === 'RECEIPT'
          ? buildReceiptXml(job.id, job.payload as ReceiptPayload)
          : buildPrintRequestXml(job.id, job.payload as DocketPayload)
    };
  },

  // The till's receipt printer: prints the customer bill (open orders) or
  // the paid receipt on demand. Stations with matchKind RECEIPT never get
  // kitchen dockets — line routing can't match them.
  async printReceipt(orderId: string) {
    const order = await prisma.posOrder.findUnique({ where: { id: orderId }, include: { lines: true, payments: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    // Same rule as dockets: only this venue's receipt stations.
    const stations = (
      await prisma.posPrinterProfile.findMany({ where: { active: true, matchKind: 'RECEIPT', printerIp: { not: null } } })
    ).filter((station) => !station.venue || station.venue === order.venue);
    if (stations.length === 0) throw new HttpError(409, 'No receipt station configured — add one in the Office with kind Receipts and a printer.');
    const identity = await prisma.posVenueSetting.findUnique({ where: { venue: order.venue } });
    const payload = {
      kind: 'RECEIPT',
      businessName: identity?.businessName ?? order.venue,
      abn: identity?.abn ?? null,
      address: identity?.address ?? null,
      phone: identity?.phone ?? null,
      website: identity?.website ?? null,
      venue: order.venue,
      paid: order.status === 'PAID',
      tableLabel: order.tableLabel,
      orderNumber: order.orderNumber,
      covers: order.covers,
      lines: order.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        totalCents: line.totalCents,
        modifiers: ((line.modifiers as Array<{ name: string }> | null) ?? []).map((modifier) => modifier.name)
      })),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents + order.manualDiscountCents,
      discountLabel: order.manualDiscountLabel ?? order.discountLabel ?? 'Discount',
      surchargeCents: order.surchargeCents,
      surchargeLabel: order.surchargeLabel ?? 'Surcharge',
      totalCents: order.totalCents,
      gstCents: order.gstCents,
      tipCents: order.tipCents,
      payments: order.payments.map((payment) => ({ method: payment.method, amountCents: payment.amountCents }))
    };
    await prisma.posPrintJob.createMany({ data: stations.map((station) => ({ profileId: station.id, payload })) });
    return { queued: stations.length };
  },

  // Daily specials: real recipes in 'Food Specials' / 'Drink Specials', so
  // they flow through menus, docket routing, sales and reports like any dish.
  async listSpecials() {
    return prisma.recipe.findMany({
      where: { status: 'ACTIVE', category: { in: ['Food Specials', 'Drink Specials'] } },
      select: { id: true, title: true, salePriceCents: true, category: true, venue: true },
      orderBy: { createdAt: 'desc' }
    });
  },

  async createSpecial(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const name = str(body.name).slice(0, 80);
    const priceCents = Math.round(Number(body.priceCents));
    const kind = str(body.kind) === 'BEVERAGE' ? 'BEVERAGE' : 'FOOD';
    const venue = str(body.venue) || null;
    if (!name) throw new HttpError(400, 'Name the special.');
    if (!Number.isFinite(priceCents) || priceCents <= 0) throw new HttpError(400, 'A price is required.');
    return prisma.recipe.create({
      data: {
        title: name,
        kind,
        category: kind === 'BEVERAGE' ? 'Drink Specials' : 'Food Specials',
        venue,
        salePriceCents: priceCents,
        status: 'ACTIVE',
        isPrepRecipe: false,
        notes: 'Register special — created in the POS Office.'
      },
      select: { id: true, title: true, salePriceCents: true, category: true, venue: true }
    });
  },

  async retireSpecial(id: string) {
    await prisma.recipe.updateMany({
      where: { id, category: { in: ['Food Specials', 'Drink Specials'] } },
      data: { status: 'ARCHIVED' }
    });
    return { ok: true };
  },

  async printTest(profileId: string) {
    const profile = await prisma.posPrinterProfile.findUnique({ where: { id: profileId } });
    if (!profile) throw new HttpError(404, 'Station not found.');
    await prisma.posPrintJob.create({
      data: {
        profileId,
        payload: {
          profile: profile.name,
          tableLabel: null,
          orderNumber: 0,
          covers: null,
          openedByName: 'ALMA POS',
          orderNotes: 'Test docket — if you can read this, the direct line works.',
          dietary: [],
          lines: [{ id: 'test', name: 'Direct print test', quantity: 1, course: 'NOW', seat: null, modifiers: [], notes: null }]
        }
      }
    });
    return { queued: true };
  },

  async listServiceCalls(venue: string | null) {
    return prisma.posServiceCall.findMany({
      where: { clearedAt: null, ...(venue ? { venue } : {}) },
      orderBy: { createdAt: 'asc' }
    });
  },

  async clearServiceCall(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    await prisma.posServiceCall.update({
      where: { id },
      data: { clearedAt: new Date(), clearedBy: str(body.staffName) || null }
    });
    return { ok: true };
  },

  // What this venue actually sells, last 30 days — drives the pin
  // suggestions so a new board starts from reality, not a guess.
  async topItems(venue: string | null, limit = 24) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await prisma.posOrderLine.groupBy({
      by: ['recipeId'],
      where: {
        recipeId: { not: null },
        order: { status: 'PAID', training: false, createdAt: { gte: since }, ...(venue ? { venue } : {}) }
      },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: limit
    });
    return rows
      .filter((row) => row.recipeId)
      .map((row) => ({ recipeId: row.recipeId!, sold: row._sum.quantity ?? 0 }));
  },

  // Lock-screen code: any ACTIVE staff member's PIN unlocks the register.
  async unlockPin(input: unknown, sessionEmail?: string | null) {
    const body = (input ?? {}) as Record<string, unknown>;
    const pin = str(body.pin);
    if (!/^\d{4,8}$/.test(pin)) throw new HttpError(403, 'Enter your staff code.');
    // Any ACTIVE staff code unlocks; the signed-in user's own code always
    // works too (they already hold the session, whatever their roster state).
    const staff = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        mergedIntoStaffProfileId: null,
        pinHash: { not: null },
        OR: [{ employmentStatus: 'ACTIVE' }, ...(sessionEmail ? [{ email: sessionEmail }] : [])]
      },
      select: { firstName: true, lastName: true, pinHash: true, pinLockedUntil: true }
    });
    for (const profile of staff) {
      if (profile.pinLockedUntil && profile.pinLockedUntil.getTime() > Date.now()) continue;
      if (await authService.comparePin(pin, profile.pinHash!)) {
        return { name: `${profile.firstName} ${profile.lastName}`.trim() };
      }
    }
    throw new HttpError(403, 'That code does not match any staff member.');
  },

  // ── Variants: one tile, several pours off the same stock ──────────────
  async listVariants() {
    const links = await prisma.posVariantLink.findMany({ orderBy: [{ parentRecipeId: 'asc' }, { sortOrder: 'asc' }] });
    const ids = [...new Set(links.flatMap((link) => [link.parentRecipeId, link.childRecipeId]))];
    const recipes = ids.length
      ? await prisma.recipe.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, salePriceCents: true } })
      : [];
    const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const groups = new Map<
      string,
      { parentRecipeId: string; parentTitle: string; options: Array<{ recipeId: string; label: string; title: string; priceCents: number; self: boolean }> }
    >();
    for (const link of links) {
      const group = groups.get(link.parentRecipeId) ?? {
        parentRecipeId: link.parentRecipeId,
        parentTitle: recipeById.get(link.parentRecipeId)?.title ?? '(missing item)',
        options: []
      };
      const recipe = recipeById.get(link.childRecipeId);
      group.options.push({
        recipeId: link.childRecipeId,
        label: link.label,
        title: recipe?.title ?? '(missing item)',
        priceCents: recipe?.salePriceCents ?? 0,
        self: link.childRecipeId === link.parentRecipeId
      });
      groups.set(link.parentRecipeId, group);
    }
    return Array.from(groups.values());
  },

  async saveVariants(parentRecipeId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const raw = Array.isArray(body.options) ? body.options : [];
    const parent = await prisma.recipe.findUnique({ where: { id: parentRecipeId }, select: { id: true } });
    if (!parent) throw new HttpError(404, 'Parent item not found.');
    const rows = raw.map((entry, index) => {
      const option = (entry ?? {}) as Record<string, unknown>;
      const recipeId = str(option.recipeId);
      const label = str(option.label).slice(0, 40);
      if (!recipeId || !label) throw new HttpError(400, 'Each option needs an item and a label.');
      return { parentRecipeId, childRecipeId: recipeId, label, sortOrder: index };
    });
    const childIds = rows.map((row) => row.childRecipeId);
    if (new Set(childIds).size !== childIds.length) throw new HttpError(400, 'Each item can only appear once in the group.');
    const clash = await prisma.posVariantLink.findFirst({
      where: {
        OR: [
          { childRecipeId: { in: childIds }, NOT: { parentRecipeId } },
          { parentRecipeId: { in: childIds.filter((id) => id !== parentRecipeId) } }
        ]
      }
    });
    if (clash) throw new HttpError(409, 'One of those items already belongs to another variant group.');
    await prisma.$transaction([
      prisma.posVariantLink.deleteMany({ where: { parentRecipeId } }),
      ...(rows.length ? [prisma.posVariantLink.createMany({ data: rows })] : [])
    ]);
    return { ok: true };
  },

  async deleteVariantGroup(parentRecipeId: string) {
    await prisma.posVariantLink.deleteMany({ where: { parentRecipeId } });
    return { ok: true };
  },

  // Turnkey pour: "150ml glass of X at $15" becomes a real Recipe holding a
  // fractional sub-recipe line to the parent, so a glass sold decrements the
  // same stock as the bottle (150/750 of it) and costs cascade on updates.
  async createPourVariant(parentRecipeId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const label = str(body.label).slice(0, 40) || 'Glass';
    const ml = Number(body.ml);
    const parentMl = Number(body.parentMl) || 750;
    const priceCents = Math.round(Number(body.priceCents));
    if (!Number.isFinite(ml) || ml <= 0 || ml > parentMl) throw new HttpError(400, 'Pour size must be between 1ml and the bottle size.');
    if (!Number.isFinite(priceCents) || priceCents <= 0) throw new HttpError(400, 'A price is required.');
    const parent = await prisma.recipe.findUnique({
      where: { id: parentRecipeId },
      select: { id: true, title: true, kind: true, category: true, venue: true, estimatedCost: true }
    });
    if (!parent) throw new HttpError(404, 'Parent item not found.');
    const factor = ml / parentMl;
    const cost = (parent.estimatedCost ?? 0) * factor;
    const recipe = await prisma.recipe.create({
      data: {
        title: `${parent.title} — ${label}`,
        kind: parent.kind,
        category: parent.category,
        venue: parent.venue,
        salePriceCents: priceCents,
        status: 'ACTIVE',
        isPrepRecipe: false,
        estimatedCost: cost,
        portionSize: ml,
        portionUnit: 'ml',
        notes: `Pour variant: ${ml}ml of the ${parentMl}ml ${parent.title}.`,
        lines: { create: [{ ingredientName: parent.title, quantity: factor, unit: 'serve', subRecipeId: parent.id, cost, position: 0 }] }
      }
    });
    const existing = await prisma.posVariantLink.findMany({ where: { parentRecipeId }, orderBy: { sortOrder: 'asc' } });
    const needSelfRow = !existing.some((link) => link.childRecipeId === parentRecipeId);
    await prisma.$transaction([
      ...(needSelfRow
        ? [prisma.posVariantLink.create({ data: { parentRecipeId, childRecipeId: parentRecipeId, label: str(body.parentLabel).slice(0, 40) || 'Bottle', sortOrder: 0 } })]
        : []),
      prisma.posVariantLink.create({ data: { parentRecipeId, childRecipeId: recipe.id, label, sortOrder: existing.length + 1 } })
    ]);
    return { recipeId: recipe.id, title: recipe.title, priceCents };
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
    let bookingNotes: string | null = null;
    let bookingDietary: Array<{ tag: string; seat: number | null }> = [];
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
        select: { id: true, guestId: true, notes: true, specialRequests: true }
      });
      if (reservation) {
        guestId = reservation.guestId;
        reservationId = reservation.id;
        const bookingText = [reservation.notes, reservation.specialRequests].filter(Boolean).join(' · ');
        if (bookingText) {
          bookingNotes = `Booking: ${bookingText}`.slice(0, 500);
          bookingDietary = dietaryFromText(bookingText);
        }
      }
    }

    try {
      return await prisma.posOrder.create({
        data: {
          venue,
          idempotencyKey,
          training: body.training === true,
          openedByName: str(body.openedByName) || null,
          orderType: str(body.orderType).toUpperCase() === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN',
          tableLabel,
          guestId,
          reservationId,
          notes: bookingNotes,
          dietary: bookingDietary,
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
    if (body.orderType !== undefined) {
      data.orderType = str(body.orderType).toUpperCase() === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN';
    }
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
  // Split a bill into N bills of its own — 71 (1), 71 (2), 71 (3) — each
  // holding an equal share of EVERY item. Each is then a normal bill: it can
  // go to the card machine on its own, and its guest picks their own tip.
  //
  // The share is taken on each line's TOTAL, never its unit price. A $20 item
  // three ways is 6.67 / 6.67 / 6.66 — dividing the unit price instead drifts
  // by a cent per line per bill, and the parts stop adding back up to the
  // whole, which is the one thing a split must never do.
  async splitEvenly(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const ways = asInt(body.ways, 'ways', { min: 2, max: 12 });
    const order = await prisma.posOrder.findUnique({
      where: { id },
      include: { lines: { orderBy: { createdAt: 'asc' } }, payments: true, giftCardSales: true }
    });
    if (!order) throw new HttpError(404, 'Bill not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Bill is already ${order.status}.`);
    if (order.lines.length === 0) throw new HttpError(400, 'Nothing to split.');
    // A part-paid bill has money that belongs to whoever already paid; there
    // is no honest way to spread it across new bills.
    if (order.payments.length > 0) {
      throw new HttpError(400, 'This bill already has a payment on it — finish or refund it before splitting.');
    }
    // A gift card is a specific voucher for a specific buyer, not a share of
    // a table. Splitting one into thirds would be meaningless.
    if (order.giftCardSales.length > 0) {
      throw new HttpError(400, 'Bills selling gift cards cannot be split — take the cards on their own bill.');
    }
    // The share is computed from line totals, so a manual discount sitting on
    // the order would simply be dropped. Say so rather than quietly lose it.
    if (order.manualDiscountCents > 0) {
      throw new HttpError(400, 'Take the manual discount off first, split, then re-apply it to each bill.');
    }

    const base = order.tableLabel ?? `#${order.orderNumber}`;
    const created: string[] = [];

    for (let part = 0; part < ways; part += 1) {
      const child = await prisma.posOrder.create({
        data: {
          venue: order.venue,
          training: order.training,
          tableLabel: `${base} (${part + 1})`,
          // Covers follow the split so per-head reporting still means
          // something; the remainder lands on the first bills.
          covers: order.covers ? Math.floor(order.covers / ways) + (part < order.covers % ways ? 1 : 0) || null : null,
          orderType: order.orderType,
          dietary: order.dietary as Prisma.InputJsonValue,
          notes: order.notes,
          openedByName: order.openedByName,
          // Only the first child keeps the guest/reservation link — copying it
          // to all of them would multiply one visit into N in the CRM.
          guestId: part === 0 ? order.guestId : null,
          reservationId: part === 0 ? order.reservationId : null,
          lines: {
            create: order.lines.map((line) => {
              const lineTotal = line.unitPriceCents * line.quantity;
              const share = Math.floor(lineTotal / ways) + (part < lineTotal % ways ? 1 : 0);
              return {
                recipeId: line.recipeId,
                // Quantity 1 at the share price, so the money is exact. The
                // name carries what it actually is.
                name: line.quantity > 1 ? `${line.quantity}× ${line.name} (1/${ways})` : `${line.name} (1/${ways})`,
                unitPriceCents: share,
                quantity: 1,
                totalCents: share,
                course: line.course,
                seat: line.seat,
                modifiers: (line.modifiers ?? undefined) as Prisma.InputJsonValue | undefined,
                notes: line.notes,
                // Already fired — carry that across so splitting a bill at the
                // end of service can't re-print the whole table's food.
                sentAt: line.sentAt,
                sentByName: line.sentByName
              };
            })
          }
        }
      });
      await recomputeOrder(child.id);
      created.push(child.id);
    }

    // The parent stops existing as a payable bill. Same shape as a merge: the
    // lines have gone somewhere, and the void reason says where.
    await prisma.$transaction([
      prisma.posOrderLine.deleteMany({ where: { orderId: id } }),
      prisma.posOrder.update({
        where: { id },
        data: {
          status: 'VOID',
          voidedAt: new Date(),
          voidReason: `Split ${ways} ways into ${base} (1)–(${ways})`,
          subtotalCents: 0,
          totalCents: 0,
          gstCents: 0
        }
      })
    ]);

    return Promise.all(created.map((childId) => posService.getOrder(childId)));
  },

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
  async refundOrder(id: string, input: unknown, _requireManager = false) {
    // 'refunds' permission (or any manager role) approves.
    const body = (input ?? {}) as Record<string, unknown>;
    const reason = str(body.reason);
    requireReason('COMP', reason);
    // Refunds are management-only for EVERY session type: a manager PIN is
    // entered for this one action and the approver lands on the audit trail.
    const approvedBy = await verifyManagerPin(str(body.managerPin), 'refunds');
    return applyRefund({
      orderId: id,
      amountCents: body.amountCents === undefined ? undefined : asInt(body.amountCents, 'refund amount', { min: 1 }),
      reason,
      staffName: `${str(body.staffName) || 'Unknown'} (approved by ${approvedBy})`,
      method: str(body.method).toUpperCase() === 'CASH' ? 'CASH' : 'REFUND'
    });
  },

  // ── Venue till settings / shift report / email receipt ─────────────────
  async getVenueSetting(venue: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const row = await prisma.posVenueSetting.findUnique({ where: { venue } });
    return {
      venue,
      postToReports: row?.postToReports ?? false,
      businessName: row?.businessName ?? venue,
      abn: row?.abn ?? null,
      address: row?.address ?? null,
      phone: row?.phone ?? null,
      email: row?.email ?? null,
      website: row?.website ?? null,
      receiptLogo: row?.receiptLogo ?? null,
      xeroTenantId: row?.xeroTenantId ?? null,
      xeroSalesAccount: row?.xeroSalesAccount ?? null,
      xeroTipsAccount: row?.xeroTipsAccount ?? null
    };
  },

  async setVenueSetting(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = str(body.venue);
    if (!venue) throw new HttpError(400, 'venue is required.');
    const patch: Record<string, unknown> = {};
    if (body.postToReports !== undefined) patch.postToReports = body.postToReports === true;
    if (body.businessName !== undefined) patch.businessName = str(body.businessName).slice(0, 80) || null;
    if (body.abn !== undefined) patch.abn = str(body.abn).slice(0, 20) || null;
    if (body.address !== undefined) patch.address = str(body.address).slice(0, 160) || null;
    if (body.phone !== undefined) patch.phone = str(body.phone).slice(0, 30) || null;
    if (body.email !== undefined) patch.email = str(body.email).slice(0, 80) || null;
    if (body.website !== undefined) patch.website = str(body.website).slice(0, 80) || null;
    if (body.xeroTenantId !== undefined) patch.xeroTenantId = str(body.xeroTenantId).slice(0, 80) || null;
    if (body.xeroSalesAccount !== undefined) patch.xeroSalesAccount = str(body.xeroSalesAccount).slice(0, 20) || null;
    if (body.xeroTipsAccount !== undefined) patch.xeroTipsAccount = str(body.xeroTipsAccount).slice(0, 20) || null;
    if (body.receiptLogo !== undefined) {
      const logo = str(body.receiptLogo);
      if (logo && (!logo.startsWith('data:image/') || logo.length > 400_000)) {
        throw new HttpError(400, 'Logo must be an image under ~300KB.');
      }
      patch.receiptLogo = logo || null;
    }
    await prisma.posVenueSetting.upsert({
      where: { venue },
      create: { venue, postToReports: false, ...patch },
      update: patch
    });
    if (patch.postToReports === true) await postPosActuals(venue).catch(() => undefined);
    return this.getVenueSetting(venue);
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
    const identity = await prisma.posVenueSetting.findUnique({ where: { venue: order.venue } });
    const businessName = identity?.businessName ?? order.venue;
    const abnLine = identity?.abn ? `<p style="text-align:center;font-size:11px;color:#777;margin:2px 0 0">ABN ${identity.abn}</p>` : '';
    const logoBlock = identity?.receiptLogo
      ? `<div style="text-align:center;margin-bottom:6px"><img src="${identity.receiptLogo}" alt="" style="max-width:150px;max-height:80px"/></div>`
      : '';
    const detailBits = [identity?.address, identity?.phone, identity?.email, identity?.website].filter(Boolean).join(' · ');
    const detailsLine = detailBits ? `<p style="text-align:center;font-size:11px;color:#777;margin:2px 0 0">${detailBits}</p>` : '';
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
        ${logoBlock}
        <h2 style="letter-spacing:0.2em;text-align:center">${businessName}</h2>
        ${abnLine}
        ${detailsLine}
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
    const lines = parseLines(body.lines).filter((line) => !line.isGiftCard);
    const order = await prisma.posOrder.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is ${order.status} — start a new sale.`);

    // A call-away is NEVER reverted by an edit: lines that already exist
    // (matched by id) keep their fired stamp; only genuinely new lines are
    // unsent. Without this, every save wiped sentAt and refires re-sent the
    // whole course to the kitchen.
    const existingLines = await prisma.posOrderLine.findMany({
      where: { orderId: id },
      select: { id: true, sentAt: true }
    });
    const sentById = new Map(existingLines.map((line) => [line.id, line.sentAt]));
    await prisma.$transaction([
      prisma.posOrderLine.deleteMany({ where: { orderId: id } }),
      prisma.posOrderLine.createMany({
        data: lines.map((line) => ({
          orderId: id,
          recipeId: line.recipeId,
          name: line.name,
          printName: line.printName ?? null,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          totalCents: line.unitPriceCents * line.quantity,
          course: line.course,
          seat: line.seat,
          modifiers: (line.modifiers ?? undefined) as object[] | undefined,
          notes: line.notes,
          packagedBy: line.packagedBy ?? null,
          sentAt: line.id ? sentById.get(line.id) ?? null : null
        }))
      })
    ]);
    // The client echoes the whole bill back, gift cards included — those are
    // the server's to own, so they're rebuilt from the sale records rather
    // than trusted from the payload.
    await syncGiftCardLines(id);
    await recomputeOrder(id);
    return this.getOrder(id);
  },

  // Take a payment — full or PARTIAL (split bills). The order closes when the
  // payments (excluding tips) cover the total. Rules are re-applied first so a
  // table opened Friday that pays after midnight Saturday gets the surcharge.
  async payOrder(id: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const method = str(body.method).toUpperCase();
    if (!['CASH', 'CARD_EXTERNAL', 'STRIPE_TERMINAL', 'SQUARE_TERMINAL', 'GIFT_CARD', 'ONLINE'].includes(method)) {
      throw new HttpError(400, 'method must be CASH, CARD_EXTERNAL, STRIPE_TERMINAL, SQUARE_TERMINAL, GIFT_CARD or ONLINE.');
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
    // Bill settled: NOW the cards become real. Not a moment earlier — an
    // unpaid or voided bill must never put a live card in someone's hand.
    if (settled) {
      await issuePendingGiftCards(id, method, updated.venue);
    }
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
      approvedBy = await verifyManagerPin(str(body.managerPin), 'voids');
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

  // Undo a recorded payment — management-only (manager PIN per action).
  // Removes the payment record, reopens the bill if it was settled, audits
  // the approver. Gift-card payments must be reversed through the gift card
  // system so the card balance stays true.
  async undoPayment(orderId: string, paymentId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const approvedBy = await verifyManagerPin(str(body.managerPin), 'refunds');
    const payment = await prisma.posPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new HttpError(404, 'Payment not found on this bill.');
    if (payment.method === 'GIFT_CARD') {
      throw new HttpError(409, 'Gift card payments are reversed through the Gift Cards admin so the card balance stays right.');
    }
    // Undo DELETES the payment. For a tender we only recorded (cash, EFTPOS)
    // that's honest — someone else moved the money and someone else can move
    // it back. For a card we actually charged, it would take the money off our
    // books and leave it on the guest's card, which is the worst of both. Send
    // it to Refund, which reverses the card and leaves an audit trail.
    if (payment.method === 'SQUARE_TERMINAL' || payment.method === 'STRIPE_TERMINAL') {
      throw new HttpError(
        409,
        'That card was really charged — use Refund so the money goes back to the guest. Undo would only remove it from this bill.'
      );
    }
    const order = await prisma.posOrder.findUnique({ where: { id: orderId }, select: { venue: true, status: true, orderNumber: true, tableLabel: true, tipCents: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    await prisma.posPayment.delete({ where: { id: paymentId } });
    await prisma.posOrder.update({
      where: { id: orderId },
      data: {
        status: 'OPEN',
        paidAt: null,
        serviceDate: null,
        tipCents: Math.max(0, order.tipCents - payment.tipCents)
      }
    });
    await prisma.posAdjustment.create({
      data: {
        venue: order.venue,
        orderId,
        kind: 'PAYMENT_UNDO',
        reason: 'Manager approved',
        staffName: approvedBy,
        itemName: `${payment.method} ${(payment.amountCents / 100).toFixed(2)} on ${order.tableLabel ? `table ${order.tableLabel}` : `#${order.orderNumber}`}`,
        amountCents: payment.amountCents
      }
    });
    await postPosActuals(order.venue).catch(() => undefined);
    return this.getOrder(orderId);
  },

  // Menu curation: hide/restore categories and items globally.
  async listMenuHides() {
    return prisma.posMenuHide.findMany({ orderBy: { createdAt: 'desc' } });
  },

  // QR_* kinds hide something from the GUEST menu only. What a venue is happy
  // for a table to order unattended is not the same list the staff sell from:
  // a bottle of Barolo, a set menu that needs explaining, anything age-gated.
  // Hiding on the register still hides everywhere, guests included.
  async hideMenu(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const raw = str(body.kind).toUpperCase();
    const kind =
      raw === 'CATEGORY' ? 'CATEGORY' : raw === 'QR_CATEGORY' ? 'QR_CATEGORY' : raw === 'QR_ITEM' ? 'QR_ITEM' : 'ITEM';
    const key = str(body.key);
    if (!key) throw new HttpError(400, 'key is required.');
    return prisma.posMenuHide.upsert({
      where: { kind_key: { kind, key } },
      create: { kind, key, hiddenBy: str(body.hiddenBy) || null },
      update: {}
    });
  },

  async unhideMenu(id: string) {
    await prisma.posMenuHide.delete({ where: { id } });
    return { ok: true };
  },

  // Gift card balance check for the charge sheet. Mirrors redeem()'s gate
  // (status ACTIVE + not expired) rather than lookup()'s paid-online check —
  // counter-activated and comp cards have no Stripe payment but redeem fine.
  // The print bridge asks which stations to serve and where they live, so a
  // printer IP changed in the Office takes effect without restarting it.
  // Public like /print-poll (a bridge has no session); returns nothing but
  // station names and LAN addresses.
  async listPrintStations(venue: string | null) {
    const rows = await prisma.posPrinterProfile.findMany({
      where: { active: true, printerIp: { not: null } },
      orderBy: [{ venue: 'asc' }, { sortOrder: 'asc' }]
    });
    return rows
      .filter((row) => !venue || !row.venue || row.venue === venue)
      .map((row) => ({ id: row.id, name: row.name, venue: row.venue, printerIp: row.printerIp, matchKind: row.matchKind }));
  },

  // The cash drawer is wired to the receipt printer (RJ12), so opening it
  // means sending that printer a kick. Queued like any other print job, so it
  // goes through whatever is driving that station — bridge or i-printer.
  async openCashDrawer(venue: string) {
    const stations = (
      await prisma.posPrinterProfile.findMany({ where: { active: true, matchKind: 'RECEIPT', printerIp: { not: null } } })
    ).filter((station) => !station.venue || station.venue === venue);
    if (stations.length === 0) {
      throw new HttpError(409, 'No till printer set up for this venue — add a Receipts station with its IP in the Office.');
    }
    await prisma.posPrintJob.createMany({
      data: stations.map((station) => ({ profileId: station.id, status: 'QUEUED', payload: { kind: 'DRAWER' } }))
    });
    return { ok: true, stations: stations.map((station) => station.name) };
  },

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

  // Add a gift card to the CURRENT BILL. It is not a card yet — just a line
  // the guest is about to pay for. That way the money goes through the till,
  // the drawer and the day's takings like any other tender.
  async addGiftCardSale(orderId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const order = await prisma.posOrder.findUnique({ where: { id: orderId }, select: { status: true } });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is ${order.status} — start a new sale.`);
    const amountCents = asInt(body.amountCents, 'amountCents', { min: 500, max: 100000 });
    const requestedCode = str(body.code).toUpperCase() || null;
    if (requestedCode) {
      if (!/^[A-Z0-9-]+$/.test(requestedCode)) throw new HttpError(400, 'A card number may only contain letters, numbers and dashes.');
      const clash = await prisma.giftCard.findUnique({ where: { code: requestedCode }, select: { id: true } });
      if (clash) throw new HttpError(409, `Card ${requestedCode} is already in use.`);
    }
    await prisma.posGiftCardSale.create({
      data: {
        orderId,
        amountCents,
        requestedCode,
        recipientName: str(body.recipientName) || null,
        recipientEmail: str(body.recipientEmail).toLowerCase() || null
      }
    });
    await syncGiftCardLines(orderId);
    await recomputeOrder(orderId);
    return this.getOrder(orderId);
  },

  async removeGiftCardSale(orderId: string, saleId: string) {
    const sale = await prisma.posGiftCardSale.findUnique({ where: { id: saleId } });
    if (!sale || sale.orderId !== orderId) throw new HttpError(404, 'Gift card sale not found.');
    if (sale.issuedAt) throw new HttpError(400, 'That card has already been issued — refund the bill instead.');
    await prisma.posGiftCardSale.delete({ where: { id: saleId } });
    await syncGiftCardLines(orderId);
    await recomputeOrder(orderId);
    return this.getOrder(orderId);
  },

  // Codes issued against a bill, so the register can show and print them.
  async listGiftCardSales(orderId: string) {
    return prisma.posGiftCardSale.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, amountCents: true, recipientName: true, recipientEmail: true, issuedCode: true, issuedAt: true }
    });
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
        data: ['NOW', 'Course 1', 'Course 2', 'Course 3', 'Course 4', 'Course 5', 'Course 6'].map((name, index) => ({ name, sortOrder: index }))
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

  // Back office: printer profile + rule management.
  async savePrinterProfile(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const data = {
      name: str(body.name).slice(0, 40),
      // Blank = every venue (how it worked before St Alma had its own).
      venue: str(body.venue).slice(0, 60) || null,
      // RECEIPT is a real kind (the till printer) — coercing it to FOOD is why
      // "Receipts (till)" wouldn't stick and the station kept printing dockets.
      matchKind: ['BEVERAGE', 'RECEIPT'].includes(str(body.matchKind).toUpperCase())
        ? str(body.matchKind).toUpperCase()
        : 'FOOD',
      categoriesCsv: str(body.categoriesCsv).slice(0, 400),
      printerIp: str(body.printerIp).slice(0, 60) || null,
      active: body.active !== false,
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0
    };
    if (!data.name) throw new HttpError(400, 'Profile name is required.');
    const id = str(body.id);
    if (id) return prisma.posPrinterProfile.update({ where: { id }, data });
    return prisma.posPrinterProfile.create({ data });
  },

  async deletePrinterProfile(id: string) {
    await prisma.posPrinterProfile.delete({ where: { id } });
    return { ok: true };
  },

  async saveRule(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw new HttpError(400, 'percent must be 1-100.');
    const data = {
      kind: str(body.kind).toUpperCase() === 'DISCOUNT' ? 'DISCOUNT' : 'SURCHARGE',
      label: str(body.label).slice(0, 60) || 'Rule',
      percent,
      weekdays: str(body.weekdays)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => /^[0-6]$/.test(value))
        .join(','),
      holidays: body.holidays === true,
      startMinute: body.startMinute === undefined || body.startMinute === null || body.startMinute === '' ? null : asInt(body.startMinute, 'startMinute', { min: 0, max: 1439 }),
      endMinute: body.endMinute === undefined || body.endMinute === null || body.endMinute === '' ? null : asInt(body.endMinute, 'endMinute', { min: 0, max: 1439 }),
      active: body.active !== false
    };
    const id = str(body.id);
    if (id) return prisma.posRule.update({ where: { id }, data });
    return prisma.posRule.create({ data });
  },

  async deleteRule(id: string) {
    await prisma.posRule.delete({ where: { id } });
    return { ok: true };
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
    const firedBy = str(body.firedByName) || null;
    const firedAt = new Date();
    const fireCourses = Array.isArray(body.courses) ? (body.courses as unknown[]).map(String) : null;
    const onlyLineIds = Array.isArray(body.lineIds) ? new Set((body.lineIds as unknown[]).map(String)) : null;
    const order = await prisma.posOrder.findUnique({
      where: { id },
      include: { lines: { where: { sentAt: null }, orderBy: { createdAt: 'asc' } } }
    });
    if (!order) throw new HttpError(404, 'Order not found.');
    // A gift card is not something anyone cooks.
    order.lines = order.lines.filter((line) => !line.isGiftCard);
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
    // A set menu line is the money, not a dish — what the kitchen cooks is the
    // $0 lines underneath it. Printing it too would put "Sunday Banquet x18"
    // on the pass above the same eighteen plates. It is still stamped as sent
    // below, so it leaves the fire list with the course it belongs to.
    const cookable = order.lines.filter((line) => recipeMeta.get(line.recipeId ?? '')?.kind !== 'SET_MENU');

    const dockets = profiles
      // A station belongs to its venue: St Alma's dockets must never come out
      // of Avalon's kitchen. Unset venue = shared, as before.
      .filter((profile) => !profile.venue || profile.venue === order.venue)
      .map((profile) => {
        const categories = profile.categoriesCsv.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
        const lines = cookable.filter((line) => {
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
          // A call-away: the kitchen makes this now.
          kind: 'FIRE' as const,
          orderType: order.orderType,
          tableLabel: order.tableLabel,
          orderNumber: order.orderNumber,
          covers: order.covers,
          openedByName: order.openedByName,
          firedByName: firedBy,
          orderedAt: order.createdAt.toISOString(),
          firedAt: firedAt.toISOString(),
          orderNotes: order.notes,
          dietary: (order.dietary as Array<{ tag: string; seat: number | null }> | null) ?? [],
          lines: sorted.map((line) => ({
            id: line.id,
            // The kitchen's own name for this dish, if it has one — the
            // register tile and the guest's receipt keep line.name.
            name: line.printName ?? line.name,
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
      // Same instant as the docket says, and who called it — the kitchen
      // performance trail is ordered-at → fired-at → by whom.
      data: { sentAt: firedAt, sentByName: firedBy }
    });
    // Persist each docket as a KDS ticket. Training orders never reach the
    // kitchen screens or printers — the register shows the docket preview only.
    if (dockets.length > 0 && !order.training) {
      const directJobs = dockets
        .filter((docket) => docket.printerIp)
        .map((docket) => {
          const profile = profiles.find((candidate) => candidate.name === docket.profile);
          return profile ? { profileId: profile.id, payload: docket as object } : null;
        })
        .filter((job): job is { profileId: string; payload: object } => job !== null);
      if (directJobs.length > 0) {
        await prisma.posPrintJob.createMany({ data: directJobs });
      }
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
    // Management tiles can be sized like pins: { 'open-till': 'w' | 'b' }.
    const buttonSizes: Record<string, string> = {};
    if (body.buttonSizes && typeof body.buttonSizes === 'object') {
      for (const [key, value] of Object.entries(body.buttonSizes as Record<string, unknown>)) {
        if (value === 'w' || value === 'b') buttonSizes[key.slice(0, 40)] = value;
      }
    }
    const pins = sanitizeHomescreenPins(body.pins);
    const landingCategory = str(body.landingCategory) || null;
    // Category tab customisation: order + hidden + grouped tabs.
    let categories: object | null = null;
    if (body.categories && typeof body.categories === 'object') {
      const raw = body.categories as Record<string, unknown>;
      // Per-category mark overrides: name -> icon key ('' = deliberately none).
      const icons: Record<string, string> = {};
      if (raw.icons && typeof raw.icons === 'object') {
        for (const [name, value] of Object.entries(raw.icons as Record<string, unknown>)) {
          if (typeof value === 'string' && value.length <= 20) icons[name.slice(0, 60)] = value;
        }
      }
      categories = {
        order: (Array.isArray(raw.order) ? raw.order : []).map(String).slice(0, 60),
        hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).map(String).slice(0, 60),
        icons,
        groups: (Array.isArray(raw.groups) ? raw.groups : [])
          .map((group) => {
            if (!group || typeof group !== 'object') return null;
            const row = group as Record<string, unknown>;
            if (typeof row.name !== 'string' || !Array.isArray(row.cats)) return null;
            return {
              name: row.name.trim().slice(0, 30),
              cats: (row.cats as unknown[]).map(String).slice(0, 20),
              ...(typeof row.c === 'string' ? { c: row.c } : {}),
              ...(row.look === 'tiles' || row.look === 'list' ? { look: row.look } : {})
            };
          })
          .filter((group): group is NonNullable<typeof group> => group !== null)
          .slice(0, 12)
      };
    }
    return prisma.posHomescreen.upsert({
      where: { userKey },
      create: { userKey, buttons, pins, categories: categories ?? undefined, buttonSizes, landingCategory, updatedBy: str(body.updatedBy) || null },
      update: { buttons, pins, categories: categories ?? undefined, buttonSizes, landingCategory, updatedBy: str(body.updatedBy) || null }
    });
  },

  // ── Stripe Terminal ────────────────────────────────────────────────────
  async terminalConnectionToken(venue?: string | null) {
    const client = stripeForVenue(venue) ?? stripe;
    if (!client) throw new HttpError(503, 'Stripe is not configured on the server.');
    const token = await client.terminal.connectionTokens.create();
    return { secret: token.secret };
  },

  async terminalPaymentIntent(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    // Each venue is its own company: the charge must be created on THAT
    // venue's Stripe account, or the takings land in the wrong entity.
    const venueStripe = stripeForVenue(str(body.venue) || null);
    if (!venueStripe) throw new HttpError(503, 'Stripe is not configured on the server.');
    const amountCents = asInt(body.amountCents, 'amount', { min: 50 });
    const intent = await venueStripe.paymentIntents.create({
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
