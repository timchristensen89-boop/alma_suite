import { randomUUID } from 'node:crypto';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import {
  squareTerminalContext,
  squareTerminalGet,
  squareTerminalPost,
  type SquareTerminalContext
} from './integration.service.js';
import { posService } from './pos.service.js';

// ── Square Terminal on the ALMA register ────────────────────────────────────
//
// Square Terminals are not driven over the LAN — there is no IP to point at.
// The flow is entirely cloud-side:
//
//   1. We ask Square for a device code. Staff type those 8 characters into the
//      terminal once, and it stays paired until someone signs it out.
//   2. To take money we POST a checkout naming that device. Square pushes it
//      to the hardware over the internet, wherever it is.
//   3. We poll until Square says COMPLETED, then — and only then — tender the
//      bill.
//
// Card data never reaches us, which is what keeps this out of PCI scope.

type SquareDeviceCode = {
  id: string;
  code: string;
  name?: string;
  status?: string; // UNKNOWN | UNPAIRED | PAIRED | EXPIRED
  device_id?: string;
  pair_by?: string;
};

type SquareCheckout = {
  id: string;
  status?: string; // PENDING | IN_PROGRESS | CANCEL_REQUESTED | CANCELED | COMPLETED
  cancel_reason?: string;
  payment_ids?: string[];
  amount_money?: { amount?: number; currency?: string };
};

// Square's own vocabulary for a terminal that has finished with a card.
const TERMINAL_DONE = new Set(['COMPLETED', 'CANCELED']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireVenue(value: unknown): string {
  const venue = text(value);
  if (!venue) throw new HttpError(400, 'Venue is required.');
  return venue;
}

// Square wants a fresh idempotency key per request; a repeat of the SAME key
// returns the original result rather than charging twice.
function idempotencyKey() {
  return randomUUID();
}

async function contextForDevice(device: { venue: string }): Promise<SquareTerminalContext> {
  return squareTerminalContext(device.venue);
}

export const posTerminalService = {
  // ── Pairing ──────────────────────────────────────────────────────────────

  // Ask Square for a device code. The terminal shows a "Sign in with a device
  // code" prompt; whoever is standing at it types this in.
  async pairDevice(input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const venue = requireVenue(body.venue);
    const name = text(body.name) || `${venue} terminal`;
    const context = await squareTerminalContext(venue);

    const created = await squareTerminalPost<{ device_code?: SquareDeviceCode }>(context, '/devices/codes', {
      idempotency_key: idempotencyKey(),
      device_code: {
        name: name.slice(0, 128),
        product_type: 'TERMINAL_API',
        location_id: context.locationId
      }
    });
    const deviceCode = created.device_code;
    if (!deviceCode?.id || !deviceCode.code) {
      throw new HttpError(502, 'Square did not return a device code.');
    }

    const device = await prisma.posTerminalDevice.create({
      data: {
        venue,
        name,
        deviceCodeId: deviceCode.id,
        code: deviceCode.code,
        status: deviceCode.status === 'PAIRED' ? 'PAIRED' : 'PAIRING',
        squareDeviceId: deviceCode.device_id ?? null,
        pairedAt: deviceCode.status === 'PAIRED' ? new Date() : null,
        locationId: context.locationId,
        accountKey: context.accountKey
      }
    });
    return { ...device, pairBy: deviceCode.pair_by ?? null };
  },

  // List a venue's terminals, refreshing anything still waiting to be paired.
  // The register polls this while the pairing screen is open, so the code
  // flips to "Ready" on its own the moment someone finishes typing.
  async listDevices(venueInput: unknown) {
    const venue = requireVenue(venueInput);
    const devices = await prisma.posTerminalDevice.findMany({
      where: { venue },
      orderBy: { createdAt: 'asc' }
    });

    const pending = devices.filter((device) => device.status === 'PAIRING');
    if (pending.length > 0) {
      const context = await squareTerminalContext(venue).catch(() => null);
      if (context) {
        for (const device of pending) {
          try {
            const response = await squareTerminalGet<{ device_code?: SquareDeviceCode }>(
              context,
              `/devices/codes/${device.deviceCodeId}`
            );
            const code = response.device_code;
            if (!code) continue;
            if (code.status === 'PAIRED' && code.device_id) {
              await prisma.posTerminalDevice.update({
                where: { id: device.id },
                data: { status: 'PAIRED', squareDeviceId: code.device_id, pairedAt: new Date() }
              });
            } else if (code.status === 'EXPIRED') {
              await prisma.posTerminalDevice.update({ where: { id: device.id }, data: { status: 'EXPIRED' } });
            }
          } catch {
            // A pairing check failing must never take the terminal list down —
            // the already-paired devices still need to show.
          }
        }
      }
    }

    return prisma.posTerminalDevice.findMany({ where: { venue }, orderBy: { createdAt: 'asc' } });
  },

  // Forget a terminal here. Square keeps the device signed in, so this is
  // "stop offering it on this register", not a remote sign-out.
  async removeDevice(id: string) {
    const device = await prisma.posTerminalDevice.findUnique({ where: { id } });
    if (!device) throw new HttpError(404, 'Terminal not found.');
    await prisma.posTerminalDevice.delete({ where: { id } });
    return { ok: true };
  },

  // ── Taking a payment ─────────────────────────────────────────────────────

  // Push a charge to a paired terminal. Returns immediately with a checkout to
  // poll — the guest still has to tap, and the register stays responsive while
  // they do.
  async startCheckout(orderId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const deviceId = text(body.deviceId);
    if (!deviceId) throw new HttpError(400, 'Pick a terminal.');

    const order = await prisma.posOrder.findUnique({
      where: { id: orderId },
      include: { lines: { select: { id: true }, take: 1 }, payments: true }
    });
    if (!order) throw new HttpError(404, 'Order not found.');
    if (order.status !== 'OPEN') throw new HttpError(400, `Order is already ${order.status}.`);
    if (order.lines.length === 0) throw new HttpError(400, 'Add at least one item before charging.');

    const device = await prisma.posTerminalDevice.findUnique({ where: { id: deviceId } });
    if (!device) throw new HttpError(404, 'Terminal not found.');
    if (device.status !== 'PAIRED' || !device.squareDeviceId) {
      throw new HttpError(400, `${device.name} isn't paired yet.`);
    }
    if (device.venue !== order.venue) {
      throw new HttpError(400, `${device.name} belongs to ${device.venue}, not ${order.venue}.`);
    }

    const paidSoFarCents = order.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const balanceCents = order.totalCents - paidSoFarCents;
    const amountCents =
      body.amountCents === undefined || body.amountCents === null
        ? balanceCents
        : Math.round(Number(body.amountCents));
    if (!Number.isFinite(amountCents) || amountCents < 1) throw new HttpError(400, 'Amount must be at least 1c.');
    if (amountCents > balanceCents) {
      throw new HttpError(400, `Only ${(balanceCents / 100).toFixed(2)} is owing on this order.`);
    }
    const tipCents = body.tipCents === undefined ? 0 : Math.max(0, Math.round(Number(body.tipCents) || 0));

    // A bill can only have one card up in the air at a time — two live
    // checkouts on the same order is how you double-charge a table.
    const inFlight = await prisma.posTerminalCheckout.findFirst({
      where: { orderId, status: { in: ['PENDING', 'IN_PROGRESS', 'CANCEL_REQUESTED'] } }
    });
    if (inFlight) {
      throw new HttpError(409, 'This bill already has a card on a terminal. Finish or cancel it first.', {
        checkoutId: inFlight.id
      });
    }

    const context = await contextForDevice(device);
    const created = await squareTerminalPost<{ checkout?: SquareCheckout }>(context, '/terminals/checkouts', {
      idempotency_key: idempotencyKey(),
      checkout: {
        // Square charges the card for amount + tip in one go; we split them
        // back out when we tender, so the tip lands where reports expect it.
        amount_money: { amount: amountCents + tipCents, currency: context.currency },
        reference_id: `alma-${order.orderNumber}`,
        note: order.tableLabel ? `Table ${order.tableLabel}` : `Bill #${order.orderNumber}`,
        device_options: {
          device_id: device.squareDeviceId,
          // The register prints (or emails) the receipt, and a guest waiting
          // for the terminal to finish asking about receipts holds up the pass.
          skip_receipt_screen: true,
          collect_signature: false
        }
      }
    });
    const checkout = created.checkout;
    if (!checkout?.id) throw new HttpError(502, 'Square did not return a checkout.');

    const row = await prisma.posTerminalCheckout.create({
      data: {
        id: checkout.id,
        orderId,
        deviceId: device.id,
        venue: order.venue,
        amountCents,
        tipCents,
        status: checkout.status ?? 'PENDING'
      }
    });
    await prisma.posTerminalDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
    return { checkoutId: row.id, status: row.status, amountCents, tipCents, deviceName: device.name };
  },

  // Poll a checkout. When Square first reports COMPLETED this tenders the
  // bill; every later poll returns the same answer without paying twice.
  async pollCheckout(checkoutId: string) {
    const row = await prisma.posTerminalCheckout.findUnique({ where: { id: checkoutId } });
    if (!row) throw new HttpError(404, 'Checkout not found.');

    // Already settled — hand back the same answer. The register may well ask
    // again after a dropped connection.
    if (row.paymentId) {
      return { status: 'COMPLETED', settled: true, order: await posService.getOrder(row.orderId) };
    }
    if (row.status === 'CANCELED') {
      return { status: 'CANCELED', settled: false, reason: row.failureReason };
    }

    const context = await squareTerminalContext(row.venue);
    const response = await squareTerminalGet<{ checkout?: SquareCheckout }>(context, `/terminals/checkouts/${row.id}`);
    const checkout = response.checkout;
    const status = checkout?.status ?? row.status;

    if (!TERMINAL_DONE.has(status)) {
      if (status !== row.status) {
        await prisma.posTerminalCheckout.update({ where: { id: row.id }, data: { status } });
      }
      return { status, settled: false };
    }

    if (status === 'CANCELED') {
      await prisma.posTerminalCheckout.update({
        where: { id: row.id },
        data: { status, failureReason: checkout?.cancel_reason ?? 'Cancelled on the terminal' }
      });
      return { status, settled: false, reason: checkout?.cancel_reason ?? 'Cancelled on the terminal' };
    }

    // COMPLETED. Claim the row before tendering: the conditional update is the
    // lock, so two polls racing each other can only produce one payment.
    const squarePaymentId = checkout?.payment_ids?.[0] ?? null;
    const claimed = await prisma.posTerminalCheckout.updateMany({
      where: { id: row.id, paymentId: null },
      data: { status, squarePaymentId, paymentId: 'PENDING' }
    });
    if (claimed.count === 0) {
      // Someone else got there first.
      return { status: 'COMPLETED', settled: true, order: await posService.getOrder(row.orderId) };
    }

    try {
      const order = await posService.payOrder(row.orderId, {
        method: 'SQUARE_TERMINAL',
        amountCents: row.amountCents,
        tipCents: row.tipCents,
        reference: squarePaymentId
      });
      const payment = await prisma.posPayment.findFirst({
        where: { orderId: row.orderId, method: 'SQUARE_TERMINAL' },
        orderBy: { createdAt: 'desc' }
      });
      await prisma.posTerminalCheckout.update({
        where: { id: row.id },
        data: { paymentId: payment?.id ?? row.id }
      });
      return { status: 'COMPLETED', settled: true, order };
    } catch (error) {
      // The card WAS charged — Square told us so. Releasing the latch would
      // risk charging again, so keep it and surface the problem loudly: this
      // needs a human, not a retry.
      await prisma.posTerminalCheckout.update({
        where: { id: row.id },
        data: {
          failureReason: `Charged on Square (${squarePaymentId ?? 'unknown payment'}) but the bill did not settle: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        }
      });
      throw new HttpError(
        500,
        'The card was charged but the bill did not settle. Do NOT charge again — check Square and settle by hand.',
        { squarePaymentId }
      );
    }
  },

  // Take the charge off the terminal screen (guest changed their mind, wrong
  // amount, split differently). Square only accepts this before the card is
  // presented; after that it comes back COMPLETED and the poll settles it.
  async cancelCheckout(checkoutId: string) {
    const row = await prisma.posTerminalCheckout.findUnique({ where: { id: checkoutId } });
    if (!row) throw new HttpError(404, 'Checkout not found.');
    if (row.paymentId) throw new HttpError(400, 'That payment already went through.');

    const context = await squareTerminalContext(row.venue);
    try {
      const response = await squareTerminalPost<{ checkout?: SquareCheckout }>(
        context,
        `/terminals/checkouts/${row.id}/cancel`,
        {}
      );
      const status = response.checkout?.status ?? 'CANCELED';
      await prisma.posTerminalCheckout.update({
        where: { id: row.id },
        data: { status, failureReason: 'Cancelled from the register' }
      });
      return { status };
    } catch (error) {
      // Too late to cancel usually means the guest just tapped. Let the next
      // poll find the completed payment rather than reporting a false failure.
      const latest = await posTerminalService.pollCheckout(row.id).catch(() => null);
      if (latest?.settled) return { status: 'COMPLETED', settled: true, order: latest.order };
      throw error;
    }
  }
};
