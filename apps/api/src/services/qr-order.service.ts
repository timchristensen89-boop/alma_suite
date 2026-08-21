import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import { squareTerminalContext, squareTerminalGet, squareTerminalPost } from './integration.service.js';
import { env } from '../env.js';
import { posService, stripeForVenue } from './pos.service.js';

const stripe = env.stripe.secretKey ? new Stripe(env.stripe.secretKey) : null;

// ── QR table ordering, natively on ALMA POS ────────────────────────────────
// A guest scans the QR at their table and orders from their phone: the order
// lands on that table's open bill (or opens one) and the new lines fire
// straight to the kitchen screens. No guest accounts, no client-side prices —
// the table is identified by a signed token and every line is repriced
// server-side from the recipe.

const QR_KEY = `alma-qr::${env.sessionSecret}`;

function sign(venue: string, tableLabel: string): string {
  return createHmac('sha256', QR_KEY).update(`${venue}::${tableLabel}`).digest('hex').slice(0, 16);
}

export function tableToken(venue: string, tableLabel: string): string {
  return Buffer.from(`${venue}::${tableLabel}::${sign(venue, tableLabel)}`, 'utf8').toString('base64url');
}

function parseToken(token: string): { venue: string; tableLabel: string } {
  let decoded = '';
  try {
    decoded = Buffer.from(String(token ?? ''), 'base64url').toString('utf8');
  } catch {
    throw new HttpError(401, 'That QR code is not valid.');
  }
  const parts = decoded.split('::');
  if (parts.length !== 3) throw new HttpError(401, 'That QR code is not valid.');
  const [venue, tableLabel, signature] = parts as [string, string, string];
  if (signature !== sign(venue, tableLabel)) throw new HttpError(401, 'That QR code is not valid.');
  return { venue, tableLabel };
}

// Simple per-IP throttle: ordering is a human activity.
const hits = new Map<string, { count: number; windowStart: number }>();
function throttle(ip: string | undefined) {
  const key = ip ?? 'unknown';
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now - rec.windowStart > 60_000) {
    hits.set(key, { count: 1, windowStart: now });
    return;
  }
  rec.count += 1;
  if (rec.count > 20) throw new HttpError(429, 'Slow down a moment and try again.');
  if (hits.size > 5000) {
    for (const [candidate, entry] of hits) {
      if (now - entry.windowStart > 60_000) hits.delete(candidate);
    }
  }
}

// Turn a PAID pending basket into real lines on the table's bill, record the
// money, and fire it to the kitchen. Only ever called after Square has
// confirmed — see confirmPaid, which holds the latch.
async function materialisePending(pending: {
  id: string;
  venue: string;
  tableLabel: string;
  guestName: string | null;
  notes: string | null;
  dietary: unknown;
  lines: unknown;
  totalCents: number;
  squareOrderId: string | null;
}) {
  const venue = pending.venue;
  const tableLabel = pending.tableLabel;
  const guestName = pending.guestName ?? '';
  const guestDietary = (Array.isArray(pending.dietary) ? pending.dietary : []).map((entry) => String(entry));
  const lines = (Array.isArray(pending.lines) ? pending.lines : []) as Array<{
    recipeId: string;
    name: string;
    unitPriceCents: number;
    quantity: number;
    notes: string | null;
  }>;

  // The table's open bill, or a fresh one.
  let order = await prisma.posOrder.findFirst({
    where: { venue, status: 'OPEN', training: false, tableLabel: { equals: tableLabel, mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, notes: true, dietary: true }
  });
  if (!order) {
    const created = (await posService.createOrder({ venue, tableLabel, openedByName: 'QR order' })) as { id: string };
    order = { id: created.id, notes: null, dietary: [] };
  }
  const orderId = order.id;

  // Merge the guest's dietary flags into the order's, keeping anything staff
  // already recorded. Table-wide (seat null) — the guest is telling us about
  // their own meal but we can't know their seat number.
  if (guestDietary.length > 0) {
    const current = (order.dietary as Array<{ tag: string; seat: number | null }> | null) ?? [];
    const merged = [...current];
    for (const tag of guestDietary) {
      if (!merged.some((entry) => entry.tag.toLowerCase() === tag.toLowerCase())) merged.push({ tag, seat: null });
    }
    if (merged.length !== current.length) {
      await prisma.posOrder.update({ where: { id: orderId }, data: { dietary: merged.slice(0, 12) } });
    }
  }
  if (guestName) {
    const tag = `QR: ${guestName}`;
    if (!(order.notes ?? '').includes(tag)) {
      await prisma.posOrder.update({
        where: { id: orderId },
        data: { notes: order.notes ? `${order.notes} · ${tag}` : tag }
      });
    }
  }

  const created = await prisma.$transaction(
    lines.map((line) =>
      prisma.posOrderLine.create({
        data: {
          orderId,
          recipeId: line.recipeId,
          name: line.name,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
          totalCents: line.unitPriceCents * line.quantity,
          course: 'NOW',
          notes: line.notes ? `${line.notes}${guestName ? ` — ${guestName}` : ''}` : guestName ? `— ${guestName}` : null
        },
        select: { id: true }
      })
    )
  );
  await posService.recomputeOrderTotals(orderId);

  // The guest has already paid Square for exactly this round, so the money
  // goes on the bill now. Without this the table would look unpaid and could
  // be charged twice.
  await prisma.posPayment.create({
    data: {
      orderId,
      method: 'ONLINE',
      amountCents: pending.totalCents,
      tipCents: 0,
      reference: pending.squareOrderId
    }
  });

  // Fire only this round — anything a waiter is still building stays held.
  await posService.sendOrder(orderId, { lineIds: created.map((line) => line.id) });

  const final = await prisma.posOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { orderNumber: true }
  });
  return {
    orderId,
    orderNumber: final.orderNumber,
    tableLabel,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0)
  };
}

export const qrOrderService = {
  // The guest page's bootstrap: where am I, what can I order.
  async context(token: string) {
    const { venue, tableLabel } = parseToken(token);
    const menu = (await posService.registerMenu()) as {
      categories: Array<{
        name: string;
        kind: string;
        items: Array<{
          recipeId: string;
          title: string;
          priceCents: number;
          venue: string | null;
          dietary?: string[];
          variantOf?: string;
        }>;
      }>;
      eightySix?: string[];
    };
    const eightySix = new Set(menu.eightySix ?? []);
    // What guests may order is curated separately from what staff sell. The
    // register menu has already had its own hides applied; these are the
    // guest-only ones on top.
    const qrHides = await prisma.posMenuHide.findMany({
      where: { kind: { in: ['QR_ITEM', 'QR_CATEGORY'] } },
      select: { kind: true, key: true }
    });
    const qrHiddenItems = new Set(qrHides.filter((hide) => hide.kind === 'QR_ITEM').map((hide) => hide.key));
    const qrHiddenCats = new Set(
      qrHides.filter((hide) => hide.kind === 'QR_CATEGORY').map((hide) => hide.key.toLowerCase())
    );
    return {
      venue,
      tableLabel,
      categories: menu.categories
        .filter((category) => !qrHiddenCats.has(category.name.toLowerCase()))
        .map((category) => ({
          name: category.name,
          // Kitchen or bar, and whether it is a set menu. The guest page needs
          // it to offer "food / drinks" the way the register's full menu does,
          // and to put the banquets first.
          kind: category.kind,
          items: category.items
            .filter((item) => !eightySix.has(item.recipeId))
            .filter((item) => !qrHiddenItems.has(item.recipeId))
            .filter((item) => !item.venue || item.venue === venue)
            // A variant row (the 250mL of a wine, say) belongs under its
            // parent at the register, not as its own line on a guest menu.
            .filter((item) => !item.variantOf)
            .map((item) => ({
              recipeId: item.recipeId,
              title: item.title,
              priceCents: item.priceCents,
              // Empty means nobody has checked, never "no allergens" — the
              // guest page has to say that, not imply the dish is safe.
              dietary: item.dietary ?? []
            }))
        }))
        .filter((category) => category.items.length > 0)
    };
  },

  // Submit the guest's round: reprice server-side, append to the table's open
  // bill (or open one), fire ONLY these lines to the kitchen.
  async submit(input: unknown, ip?: string) {
    throttle(ip);
    const body = (input ?? {}) as Record<string, unknown>;
    const { venue, tableLabel } = parseToken(String(body.t ?? ''));
    const guestName = String(body.name ?? '').trim().slice(0, 60);
    // Dietary flags the guest ticked. They join the order's flags (never
    // replace staff-entered ones) and print on the kitchen docket like any
    // other — a guest telling us about an allergy has to reach the pass.
    const guestDietary = (Array.isArray(body.dietary) ? body.dietary : [])
      .map((entry) => String(entry ?? '').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 8);
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length === 0) throw new HttpError(400, 'Add something to your order first.');
    if (rawLines.length > 30) throw new HttpError(400, 'That order is too large for one round.');

    const wanted = rawLines.map((raw) => {
      const line = (raw ?? {}) as Record<string, unknown>;
      const recipeId = String(line.recipeId ?? '');
      const quantity = Number(line.quantity ?? 1);
      if (!recipeId || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
        throw new HttpError(400, 'Order lines are not valid.');
      }
      return { recipeId, quantity, notes: String(line.notes ?? '').trim().slice(0, 120) || null };
    });

    // Server-side pricing — the client's prices are never trusted.
    const [recipes, eightySixed] = await Promise.all([
      prisma.recipe.findMany({
        where: { id: { in: wanted.map((line) => line.recipeId) }, status: 'ACTIVE', isPrepRecipe: false, salePriceCents: { gt: 0 } },
        select: { id: true, title: true, kind: true, category: true, salePriceCents: true }
      }),
      prisma.pos86.findMany({ where: { recipeId: { in: wanted.map((line) => line.recipeId) } }, select: { recipeId: true } })
    ]);
    const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const soldOut = new Set(eightySixed.map((row) => row.recipeId));
    for (const line of wanted) {
      if (!recipeById.has(line.recipeId)) throw new HttpError(400, 'An item on your order is no longer available.');
      if (soldOut.has(line.recipeId)) {
        throw new HttpError(409, `${recipeById.get(line.recipeId)!.title} has just sold out — please adjust your order.`);
      }
    }

    // Nothing touches the bill or the kitchen yet. Hold the priced basket and
    // send the guest to Square; confirmPaid turns it into real lines once the
    // money is in. An abandoned checkout leaves a dead row here rather than
    // phantom items on a table that a server has to notice and strip out.
    const totalCents = wanted.reduce(
      (sum, line) => sum + (recipeById.get(line.recipeId)!.salePriceCents ?? 0) * line.quantity,
      0
    );
    if (totalCents <= 0) throw new HttpError(400, 'That order came to nothing — please order with your server.');

    const pending = await prisma.posQrPendingOrder.create({
      data: {
        venue,
        tableLabel,
        guestName: guestName || null,
        notes: String(body.notes ?? '').trim().slice(0, 120) || null,
        dietary: guestDietary,
        totalCents,
        lines: wanted.map((line) => {
          const recipe = recipeById.get(line.recipeId)!;
          return {
            recipeId: recipe.id,
            name: recipe.title,
            unitPriceCents: recipe.salePriceCents ?? 0,
            quantity: line.quantity,
            notes: line.notes
          };
        })
      }
    });

    // Square's hosted checkout, on this venue's own merchant account.
    const context = await squareTerminalContext(venue);
    const link = await squareTerminalPost<{
      payment_link?: { id?: string; order_id?: string; url?: string; long_url?: string };
    }>(context, '/online-checkout/payment-links', {
      // The pending row's id is a natural idempotency key: retrying the same
      // basket returns the same link instead of a second one.
      idempotency_key: pending.id,
      quick_pay: {
        name: `ALMA ${venue} · table ${tableLabel}`,
        price_money: { amount: totalCents, currency: context.currency },
        location_id: context.locationId
      },
      checkout_options: {
        redirect_url: `https://alma-pos.web.app/?qrp=${pending.id}#o/${String(body.t ?? '')}`,
        ask_for_shipping_address: false
      }
    });
    const checkoutUrl = link.payment_link?.url ?? link.payment_link?.long_url ?? null;
    if (!checkoutUrl) {
      await prisma.posQrPendingOrder.update({ where: { id: pending.id }, data: { status: 'EXPIRED' } });
      throw new HttpError(502, 'Could not start the payment. Please order with your server.');
    }
    await prisma.posQrPendingOrder.update({
      where: { id: pending.id },
      data: {
        squarePaymentLinkId: link.payment_link?.id ?? null,
        squareOrderId: link.payment_link?.order_id ?? null,
        checkoutUrl
      }
    });
    return { pendingId: pending.id, checkoutUrl, totalCents };
  },

  // The guest is back from Square. The redirect proves nothing on its own —
  // anyone can type that URL — so ask Square whether the money is actually in,
  // and only then put the round on the bill and fire it.
  async confirmPaid(input: unknown, ip?: string) {
    throttle(ip);
    const body = (input ?? {}) as Record<string, unknown>;
    const pending = await prisma.posQrPendingOrder.findUnique({ where: { id: String(body.pendingId ?? '') } });
    if (!pending) throw new HttpError(404, 'That order was not found.');
    // Already done. A refreshed success page must not order a second round.
    if (pending.posOrderId && pending.posOrderId !== 'PENDING') {
      return { ok: true, alreadyDone: true };
    }
    if (!pending.squareOrderId) throw new HttpError(409, 'That order never reached Square.');

    const context = await squareTerminalContext(pending.venue);
    const squareOrder = await squareTerminalGet<{ order?: { state?: string } }>(
      context,
      `/orders/${pending.squareOrderId}`
    );
    const state = squareOrder.order?.state ?? 'OPEN';
    if (state !== 'COMPLETED') {
      return { ok: false, state, message: 'That payment has not completed yet.' };
    }

    // Claim it before touching the bill: the conditional update is the lock,
    // so two tabs coming back at once can only produce one round.
    const claimed = await prisma.posQrPendingOrder.updateMany({
      where: { id: pending.id, posOrderId: null },
      data: { posOrderId: 'PENDING', status: 'PAID', paidAt: new Date() }
    });
    if (claimed.count === 0) return { ok: true, alreadyDone: true };

    const result = await materialisePending(pending);
    await prisma.posQrPendingOrder.update({ where: { id: pending.id }, data: { posOrderId: result.orderId } });
    return { ok: true, ...result };
  },

  // The guest's bill so far. When checkout=true a Stripe Checkout session is
  // created (hosted page — secret key only, wallets included) and its URL
  // returned; the guest comes back with ?csid= for pay-confirm.
  // "Can someone come over" / "can we get the bill" from the table.
  async call(input: unknown, ip?: string) {
    throttle(ip);
    const body = (input ?? {}) as Record<string, unknown>;
    const { venue, tableLabel } = parseToken(String(body.t ?? ''));
    const kind = String(body.kind ?? 'WAITER') === 'BILL' ? 'BILL' : 'WAITER';
    const note = String(body.note ?? '').trim().slice(0, 120) || null;
    // One open call per table per kind — tapping twice doesn't spam the floor.
    const existing = await prisma.posServiceCall.findFirst({
      where: { venue, tableLabel, kind, clearedAt: null }
    });
    if (existing) return { ok: true, alreadyWaiting: true };
    await prisma.posServiceCall.create({ data: { venue, tableLabel, kind, note } });
    return { ok: true, alreadyWaiting: false };
  },

  async payIntent(input: unknown, ip?: string) {
    throttle(ip);
    const body = (input ?? {}) as Record<string, unknown>;
    const { venue, tableLabel } = parseToken(String(body.t ?? ''));
    const venueStripe = stripeForVenue(venue) ?? stripe;
    if (body.checkout === true && !venueStripe) throw new HttpError(503, 'Online payment is not available right now.');
    const tipCents = Math.min(50_000, Math.max(0, Math.round(Number(body.tipCents ?? 0)) || 0));
    const order = await prisma.posOrder.findFirst({
      where: { venue, status: 'OPEN', training: false, tableLabel: { equals: tableLabel, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      include: { payments: true, lines: true }
    });
    if (!order || order.lines.length === 0) throw new HttpError(404, 'There is no open bill on this table yet.');
    const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = order.totalCents - paid;
    if (balanceCents <= 0) throw new HttpError(400, 'This bill is already settled.');

    let checkoutUrl: string | null = null;
    if (body.checkout === true) {
      const token = String(body.t);
      const session = await venueStripe!.checkout.sessions.create({
        mode: 'payment',
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'aud',
              unit_amount: balanceCents + tipCents,
              product_data: { name: `ALMA ${venue} · table ${tableLabel} · bill #${order.orderNumber}${tipCents > 0 ? ' (incl. tip)' : ''}` }
            }
          }
        ],
        success_url: `https://alma-pos.web.app/?csid={CHECKOUT_SESSION_ID}#o/${token}`,
        cancel_url: `https://alma-pos.web.app/#o/${token}`,
        payment_intent_data: {
          description: `ALMA ${venue} · table ${tableLabel} · bill #${order.orderNumber}`,
          metadata: { posOrderId: order.id, tipCents: String(tipCents), venue, tableLabel }
        },
        metadata: { posOrderId: order.id, tipCents: String(tipCents), venue, tableLabel }
      });
      checkoutUrl = session.url;
    }
    return {
      checkoutUrl,
      balanceCents,
      tipCents,
      orderNumber: order.orderNumber,
      lines: order.lines.map((line) => ({ name: line.name, quantity: line.quantity, totalCents: line.totalCents }))
    };
  },

  // After the guest returns from Checkout: verify the session with Stripe and
  // record the payment on the bill. Idempotent on the payment-intent id.
  async payConfirm(input: unknown, ip?: string) {
    throttle(ip);
    const body = (input ?? {}) as Record<string, unknown>;
    const { venue, tableLabel } = parseToken(String(body.t ?? ''));
    const venueStripe = stripeForVenue(venue) ?? stripe;
    if (!venueStripe) throw new HttpError(503, 'Online payment is not available right now.');
    const sessionId = String(body.sessionId ?? '');
    if (!sessionId.startsWith('cs_')) throw new HttpError(400, 'sessionId is required.');
    let intent;
    try {
      const session = await venueStripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
      if (session.payment_status !== 'paid') throw new HttpError(400, 'That payment has not completed.');
      intent = session.payment_intent as Stripe.PaymentIntent | null;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, 'That payment could not be found.');
    }
    if (!intent || typeof intent === 'string') throw new HttpError(400, 'That payment could not be found.');
    if (intent.status !== 'succeeded') throw new HttpError(400, `Payment is ${intent.status}.`);
    const orderId = String(intent.metadata?.posOrderId ?? '');
    const tipCents = Math.max(0, Number(intent.metadata?.tipCents ?? 0) || 0);
    if (!orderId || intent.metadata?.venue !== venue || intent.metadata?.tableLabel !== tableLabel) {
      throw new HttpError(400, 'That payment does not belong to this table.');
    }
    const existing = await prisma.posPayment.findFirst({ where: { orderId, reference: intent.id }, select: { id: true } });
    if (existing) return { ok: true, alreadyRecorded: true };
    const order = await prisma.posOrder.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    if (order.status !== 'OPEN') return { ok: true, alreadyRecorded: true };
    const paid = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = order.totalCents - paid;
    const received = intent.amount_received;
    // If the bill shrank between intent and charge (a waiter took a payment),
    // everything beyond the outstanding balance is recorded as tip so the
    // money is never lost or double-applied.
    const amountCents = Math.max(1, Math.min(balanceCents, received - tipCents));
    const finalTip = received - amountCents;
    await posService.payOrder(orderId, { method: 'ONLINE', amountCents, tipCents: finalTip, reference: intent.id });
    return { ok: true, paidCents: received };
  },

  // Staff-side: the printable token list for a venue's tables.
  async tableTokens(venue: string | null) {
    if (!venue) throw new HttpError(400, 'venue is required.');
    const tables = await prisma.reserveTable.findMany({
      where: { venue },
      orderBy: { label: 'asc' },
      select: { label: true }
    });
    return tables.map((table) => ({
      label: table.label,
      token: tableToken(venue, table.label),
      url: `https://alma-pos.web.app/#o/${tableToken(venue, table.label)}`
    }));
  }
};
