import { createHmac } from 'node:crypto';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import { env } from '../env.js';
import { posService } from './pos.service.js';

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

export const qrOrderService = {
  // The guest page's bootstrap: where am I, what can I order.
  async context(token: string) {
    const { venue, tableLabel } = parseToken(token);
    const menu = (await posService.registerMenu()) as {
      categories: Array<{ name: string; items: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null }> }>;
      eightySix?: string[];
    };
    const eightySix = new Set(menu.eightySix ?? []);
    return {
      venue,
      tableLabel,
      categories: menu.categories
        .map((category) => ({
          name: category.name,
          items: category.items
            .filter((item) => !eightySix.has(item.recipeId))
            .filter((item) => !item.venue || item.venue === venue)
            .map((item) => ({ recipeId: item.recipeId, title: item.title, priceCents: item.priceCents }))
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

    // The table's open bill, or a fresh one.
    let order = await prisma.posOrder.findFirst({
      where: { venue, status: 'OPEN', training: false, tableLabel: { equals: tableLabel, mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, notes: true }
    });
    if (!order) {
      const created = (await posService.createOrder({ venue, tableLabel, openedByName: 'QR order' })) as { id: string };
      order = { id: created.id, notes: null };
    }
    const orderId = order.id;
    if (guestName) {
      const tag = `QR: ${guestName}`;
      if (!(order.notes ?? '').includes(tag)) {
        await prisma.posOrder.update({
          where: { id: orderId },
          data: { notes: order.notes ? `${order.notes} · ${tag}` : tag }
        });
      }
    }

    const drinkish = (kind: string | null, category: string | null) =>
      /bar|drink|beverage|cocktail|wine|beer|spirit/i.test(`${kind ?? ''} ${category ?? ''}`);
    const created = await prisma.$transaction(
      wanted.map((line) => {
        const recipe = recipeById.get(line.recipeId)!;
        return prisma.posOrderLine.create({
          data: {
            orderId,
            recipeId: recipe.id,
            name: recipe.title,
            unitPriceCents: recipe.salePriceCents ?? 0,
            quantity: line.quantity,
            totalCents: (recipe.salePriceCents ?? 0) * line.quantity,
            course: drinkish(recipe.kind, recipe.category) ? 'Drinks' : 'Mains',
            notes: line.notes ? `${line.notes}${guestName ? ` — ${guestName}` : ''}` : guestName ? `— ${guestName}` : null
          },
          select: { id: true }
        });
      })
    );
    await posService.recomputeOrderTotals(orderId);
    // Fire only the QR lines — any lines a waiter is still building stay held.
    await posService.sendOrder(orderId, { lineIds: created.map((line) => line.id) });

    const final = await prisma.posOrder.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNumber: true, totalCents: true }
    });
    return { ok: true, orderNumber: final.orderNumber, tableLabel, itemCount: wanted.reduce((sum, line) => sum + line.quantity, 0) };
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
