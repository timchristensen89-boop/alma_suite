import { randomUUID } from 'node:crypto';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';
import {
  squareTerminalContext,
  squareTerminalGet,
  squareTerminalPost,
  type SquareTerminalContext
} from './integration.service.js';
import { applyRefund, posService, requireReason, verifyManagerPin } from './pos.service.js';

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

type SquareTerminalRefund = {
  id: string;
  status?: string; // PENDING | IN_PROGRESS | CANCELED | COMPLETED
  cancel_reason?: string;
  refund_id?: string;
  payment_id?: string;
  reason?: string;
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

// Square's cancel reasons are constants like SELLER_CANCELED and
// BUYER_CANCELED. They are fine in a log and useless on a register — a server
// mid-service should read a sentence, not an enum.
function cancelReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'SELLER_CANCELED':
      return 'Cancelled on the terminal.';
    case 'BUYER_CANCELED':
      return 'The guest cancelled on the terminal.';
    case 'TIMED_OUT':
      return 'The terminal timed out waiting for a card.';
    case 'CANCELED_BY_API':
      return 'Cancelled from the register.';
    case 'PAYMENT_METHOD_NOT_SUPPORTED':
      return 'That card type is not accepted on this terminal.';
    case 'AMOUNT_TOO_HIGH':
      return 'That amount is over the terminal\'s limit.';
    default:
      return reason ? `The terminal stopped: ${reason.replace(/_/g, ' ').toLowerCase()}.` : 'The card was cancelled.';
  }
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
    // A terminal charges a real card. Marking the bill `training` afterwards
    // does not give the money back, so a practice bill never reaches one — the
    // refusal lives here as well as in payOrder because this route starts the
    // charge, and the tender is only recorded once the card has already gone
    // through.
    if (order.training) {
      throw new HttpError(400, 'This is a training bill — it cannot charge a card. Practise with Cash or Card instead.');
    }

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

    // Who picks the tip. On the terminal the guest chooses in private, which
    // is the fairer arrangement and the reason it's the default here. The
    // register only sends a tip of its own when someone has already keyed one
    // in — a phone order, or a guest who asked the server to add it.
    const tipOnDevice = body.tipOnDevice !== false && tipCents === 0;

    const context = await contextForDevice(device);
    const created = await squareTerminalPost<{ checkout?: SquareCheckout }>(context, '/terminals/checkouts', {
      idempotency_key: idempotencyKey(),
      checkout: {
        // Tipping on the device means Square adds the tip on top of what we
        // send, and we read back what the guest chose. A tip keyed in here is
        // charged as one amount and split out again when we tender.
        amount_money: { amount: amountCents + (tipOnDevice ? 0 : tipCents), currency: context.currency },
        reference_id: `alma-${order.orderNumber}`,
        note: order.tableLabel ? `Table ${order.tableLabel}` : `Bill #${order.orderNumber}`,
        device_options: {
          device_id: device.squareDeviceId,
          // The register prints (or emails) the receipt, and a guest waiting
          // for the terminal to finish asking about receipts holds up the pass.
          skip_receipt_screen: true,
          collect_signature: false,
          ...(tipOnDevice
            ? {
                tip_settings: {
                  allow_tipping: true,
                  // Its own screen, so tipping is a deliberate choice rather
                  // than something folded into the total.
                  separate_tip_screen: true,
                  // "Custom" — a regular leaving $50 on a big table shouldn't
                  // be capped by whichever three percentages we picked.
                  custom_tip_field: true,
                  tip_percentages: [5, 10, 15]
                }
              }
            : {})
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
        data: { status, failureReason: cancelReasonText(checkout?.cancel_reason) }
      });
      return { status, settled: false, reason: cancelReasonText(checkout?.cancel_reason) };
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

    // What the guest actually tipped is only knowable from the payment — the
    // checkout doesn't carry it. Ask Square rather than assume: if they used
    // the custom field, no percentage we know about would match.
    let tipCents = row.tipCents;
    if (squarePaymentId) {
      try {
        const paid = await squareTerminalGet<{ payment?: { tip_money?: { amount?: number } } }>(
          context,
          `/payments/${squarePaymentId}`
        );
        const tipped = paid.payment?.tip_money?.amount;
        if (typeof tipped === 'number' && tipped >= 0) tipCents = tipped;
      } catch {
        // Reading the tip back is not worth failing a settled payment over.
        // The bill still closes for the right amount; the tip stays as keyed.
      }
    }

    try {
      const order = await posService.payOrder(row.orderId, {
        method: 'SQUARE_TERMINAL',
        amountCents: row.amountCents,
        tipCents,
        reference: squarePaymentId
      });
      if (tipCents !== row.tipCents) {
        await prisma.posTerminalCheckout.update({ where: { id: row.id }, data: { tipCents } });
      }
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

  // ── Giving money back ────────────────────────────────────────────────────

  // Which card payments on this bill can be refunded to the terminal, and how
  // much is left on each. The register asks before offering the option, so a
  // cash-only bill never shows a terminal refund it can't do.
  async refundableCards(orderId: string) {
    const order = await prisma.posOrder.findUnique({
      where: { id: orderId },
      include: { payments: true, terminalRefunds: true }
    });
    if (!order) throw new HttpError(404, 'Bill not found.');
    const devices = await prisma.posTerminalDevice.findMany({
      where: { venue: order.venue, status: 'PAIRED' },
      orderBy: { createdAt: 'asc' }
    });
    return order.payments
      .filter((payment) => payment.method === 'SQUARE_TERMINAL' && payment.amountCents > 0 && payment.reference)
      .map((payment) => {
        // Money already sent back against this same card.
        const returned = order.terminalRefunds
          .filter((refund) => refund.squarePaymentId === payment.reference && refund.refundPaymentId)
          .reduce((sum, refund) => sum + refund.amountCents, 0);
        return {
          squarePaymentId: payment.reference!,
          paidCents: payment.amountCents + payment.tipCents,
          refundedCents: returned,
          refundableCents: payment.amountCents + payment.tipCents - returned
        };
      })
      .filter((row) => row.refundableCents > 0)
      .map((row) => ({ ...row, devices: devices.map((device) => ({ id: device.id, name: device.name })) }));
  },

  // Push a refund to the terminal. The manager PIN is checked HERE, before any
  // money moves — by the time Square confirms, the approval is already on the
  // record and the books settle without asking again.
  async startRefund(orderId: string, input: unknown) {
    const body = (input ?? {}) as Record<string, unknown>;
    const deviceId = text(body.deviceId);
    if (!deviceId) throw new HttpError(400, 'Pick a terminal.');
    const reason = text(body.reason);
    requireReason('COMP', reason);
    const approvedBy = await verifyManagerPin(text(body.managerPin), 'refunds');

    const order = await prisma.posOrder.findUnique({ where: { id: orderId }, include: { payments: true } });
    if (!order) throw new HttpError(404, 'Bill not found.');
    if (order.status !== 'PAID') throw new HttpError(400, 'Only paid bills can be refunded.');

    const cards = await posTerminalService.refundableCards(orderId);
    const squarePaymentId = text(body.squarePaymentId) || cards[0]?.squarePaymentId || '';
    const card = cards.find((row) => row.squarePaymentId === squarePaymentId);
    if (!card) throw new HttpError(400, 'Nothing on this bill was paid on a Square terminal.');

    const amountCents =
      body.amountCents === undefined || body.amountCents === null
        ? card.refundableCents
        : Math.round(Number(body.amountCents));
    if (!Number.isFinite(amountCents) || amountCents < 1) throw new HttpError(400, 'Refund must be at least 1c.');
    if (amountCents > card.refundableCents) {
      throw new HttpError(400, `Only ${(card.refundableCents / 100).toFixed(2)} is left on that card.`);
    }

    const device = await prisma.posTerminalDevice.findUnique({ where: { id: deviceId } });
    if (!device?.squareDeviceId || device.status !== 'PAIRED') throw new HttpError(400, 'That terminal isn\'t paired.');

    const inFlight = await prisma.posTerminalRefund.findFirst({
      where: { orderId, status: { in: ['PENDING', 'IN_PROGRESS'] } }
    });
    if (inFlight) throw new HttpError(409, 'A refund is already on a terminal for this bill.');

    const context = await squareTerminalContext(order.venue);
    const created = await squareTerminalPost<{ refund?: SquareTerminalRefund }>(context, '/terminals/refunds', {
      idempotency_key: idempotencyKey(),
      refund: {
        payment_id: squarePaymentId,
        amount_money: { amount: amountCents, currency: context.currency },
        reason: reason.slice(0, 192),
        device_id: device.squareDeviceId
      }
    });
    const refund = created.refund;
    if (!refund?.id) throw new HttpError(502, 'Square did not return a refund.');

    const row = await prisma.posTerminalRefund.create({
      data: {
        id: refund.id,
        orderId,
        deviceId: device.id,
        venue: order.venue,
        amountCents,
        status: refund.status ?? 'PENDING',
        squarePaymentId,
        approvedBy,
        staffName: `${text(body.staffName) || 'Unknown'} (approved by ${approvedBy})`,
        reason
      }
    });
    return { refundId: row.id, status: row.status, amountCents, deviceName: device.name };
  },

  // Poll a refund. The books move only once Square says the money is back.
  async pollRefund(refundId: string) {
    const row = await prisma.posTerminalRefund.findUnique({ where: { id: refundId } });
    if (!row) throw new HttpError(404, 'Refund not found.');
    if (row.refundPaymentId) {
      return { status: 'COMPLETED', settled: true, order: await posService.getOrder(row.orderId) };
    }
    if (row.status === 'CANCELED') return { status: 'CANCELED', settled: false, reason: row.failureReason };

    const context = await squareTerminalContext(row.venue);
    const response = await squareTerminalGet<{ refund?: SquareTerminalRefund }>(context, `/terminals/refunds/${row.id}`);
    const status = response.refund?.status ?? row.status;

    if (!TERMINAL_DONE.has(status)) {
      if (status !== row.status) await prisma.posTerminalRefund.update({ where: { id: row.id }, data: { status } });
      return { status, settled: false };
    }
    if (status === 'CANCELED') {
      await prisma.posTerminalRefund.update({
        where: { id: row.id },
        data: { status, failureReason: cancelReasonText(response.refund?.cancel_reason) }
      });
      return { status, settled: false, reason: cancelReasonText(response.refund?.cancel_reason) };
    }

    // Same latch as the charge: claim the row before touching the books.
    const claimed = await prisma.posTerminalRefund.updateMany({
      where: { id: row.id, refundPaymentId: null },
      data: { status, refundPaymentId: 'PENDING' }
    });
    if (claimed.count === 0) {
      return { status: 'COMPLETED', settled: true, order: await posService.getOrder(row.orderId) };
    }

    try {
      const order = await applyRefund({
        orderId: row.orderId,
        amountCents: row.amountCents,
        reason: row.reason,
        staffName: row.staffName,
        method: 'REFUND'
      });
      const payment = await prisma.posPayment.findFirst({
        where: { orderId: row.orderId, method: 'REFUND' },
        orderBy: { createdAt: 'desc' }
      });
      await prisma.posTerminalRefund.update({
        where: { id: row.id },
        data: { refundPaymentId: payment?.id ?? row.id }
      });
      return { status: 'COMPLETED', settled: true, order };
    } catch (error) {
      // The guest HAS their money back — Square said so. Keep the latch shut
      // so nobody refunds a second time, and make the mismatch loud.
      await prisma.posTerminalRefund.update({
        where: { id: row.id },
        data: {
          failureReason: `Refunded on Square but the bill did not update: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        }
      });
      throw new HttpError(
        500,
        'The refund went through on the card but the bill did not update. Do NOT refund again — fix the bill by hand.'
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
