/**
 * Corporate gift cards — real-database integration tests.
 *
 * Opt-in: runs only when ALMA_TEST_DATABASE_URL points at a Postgres that
 * has the migration history applied (an empty scratch database after
 * `prisma migrate deploy`). Without it every test here is skipped, so the
 * ordinary `pnpm --filter @alma/api test` stays database-free.
 *
 *   ALMA_TEST_DATABASE_URL=postgresql://user@127.0.0.1:5433/alma_corp_test \
 *     node --import tsx --test src/services/corporate-gift-card.integration.test.ts
 *
 * Every row these tests create is tagged (company names start with
 * "ITEST ") and deleted again in setup, so a run can be repeated.
 */
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

const TEST_DB = process.env.ALMA_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

type Harness = {
  prisma: typeof import('@alma/db').prisma;
  corporate: typeof import('./corporate-gift-card.service.js').corporateGiftCardService;
  giftCards: typeof import('./gift-card.service.js').giftCardService;
  mail: typeof import('./mail.service.js').mailService;
  ledger: typeof import('../lib/gift-card-ledger.js');
  HttpError: typeof import('../lib/http.js').HttpError;
};

let h: Harness;
const sentTo: string[] = [];
let mailOutcome: 'sent' | 'failed' = 'sent';
const actor = { id: 'itest-staff', email: 'itest@almagroup.com.au', firstName: 'I', lastName: 'Test' } as unknown as import('@alma/shared').AuthUser;

const TIERS = {
  minimumQuantity: 5,
  tiers: [
    { minQuantity: 5, discountBps: 250 },
    { minQuantity: 10, discountBps: 500 },
    { minQuantity: 50, discountBps: 750 }
  ]
};

async function setSettings(patch: Record<string, unknown>) {
  const current = await h.prisma.appSettings.upsert({ where: { id: 'singleton' }, update: {}, create: { id: 'singleton' }, select: { giftCardSettings: true } });
  const base = (current.giftCardSettings ?? {}) as Record<string, unknown>;
  await h.prisma.appSettings.update({ where: { id: 'singleton' }, data: { giftCardSettings: { ...base, ...patch } as import('@prisma/client').Prisma.InputJsonValue } });
}

async function wipe() {
  const accounts = await h.prisma.corporateAccount.findMany({ where: { companyName: { startsWith: 'ITEST ' } }, select: { id: true } });
  const orders = await h.prisma.corporateGiftCardOrder.findMany({ where: { corporateAccountId: { in: accounts.map((a) => a.id) } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await h.prisma.giftCardRedemption.deleteMany({ where: { giftCard: { corporateOrderId: { in: orderIds } } } });
  await h.prisma.giftCard.deleteMany({ where: { corporateOrderId: { in: orderIds } } });
  await h.prisma.corporateGiftCardOrder.deleteMany({ where: { id: { in: orderIds } } });
  await h.prisma.corporateAccount.deleteMany({ where: { id: { in: accounts.map((a) => a.id) } } });
  await h.prisma.giftCard.deleteMany({ where: { purchaserEmail: 'itest-consumer@example.com' } });
}

async function newAccount(over: Record<string, unknown> = {}) {
  return h.corporate.createAccount({
    companyName: `ITEST ${over.companyName ?? 'Beaches Realty'}`,
    contactName: 'Pat Buyer',
    contactEmail: 'pat@beaches.example',
    ...over,
    ...(over.companyName ? { companyName: `ITEST ${over.companyName}` } : {})
  }, actor);
}

async function issuedOrder(quantity = 5, faceValueCents = 5000, accountOver: Record<string, unknown> = {}) {
  const account = await newAccount(accountOver);
  // Small pools keep the concurrency and CSV tests readable; the global
  // minimum is 5, so lift it for this account only.
  if (quantity < TIERS.minimumQuantity) await h.corporate.updateAccountTerms(account.id, { minimumQuantityOverride: 1 }, actor);
  const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity, faceValueCents, paymentMethod: 'MANUAL_OFFLINE', defaultMessage: 'Enjoy dinner on us.' }, actor);
  const paid = await h.corporate.recordManualPayment(order.id, { tender: 'BANK_TRANSFER', paymentReference: 'INV-1' }, actor);
  return { account, order: paid };
}

async function rejects(promise: Promise<unknown>, status: number, pattern?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof h.HttpError, `expected HttpError, got ${String(error)}`);
    assert.equal(error.statusCode, status, `expected ${status}: ${error.message}`);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

describe('corporate gift cards against a real database', { skip: TEST_DB ? false : 'ALMA_TEST_DATABASE_URL is not set' }, () => {
  before(async () => {
    const [{ prisma }, { corporateGiftCardService }, { giftCardService }, { mailService }, ledger, { HttpError }] = await Promise.all([
      import('@alma/db'),
      import('./corporate-gift-card.service.js'),
      import('./gift-card.service.js'),
      import('./mail.service.js'),
      import('../lib/gift-card-ledger.js'),
      import('../lib/http.js')
    ]);
    h = { prisma, corporate: corporateGiftCardService, giftCards: giftCardService, mail: mailService, ledger, HttpError };
    // The mail seam: record who a voucher would go to instead of sending.
    (h.mail as { sendGiftCard: unknown }).sendGiftCard = async (input: { to: string }) => {
      sentTo.push(input.to);
      return mailOutcome === 'sent' ? { status: 'sent', to: input.to, provider: 'smtp' } : { status: 'failed', reason: 'ITEST mail down' };
    };
    await setSettings({ testCheckoutEnabled: false, corporate: TIERS });
  });

  beforeEach(async () => {
    sentTo.length = 0;
    mailOutcome = 'sent';
    await setSettings({ testCheckoutEnabled: false, corporate: TIERS });
    await wipe();
  });

  after(async () => {
    if (h) {
      await wipe();
      await h.prisma.$disconnect();
    }
  });

  /* ---- orders and issuance ---- */

  it('an offline order is priced from the tiers, waits for payment, then issues its pool exactly once', async () => {
    const account = await newAccount();
    const { order, checkoutUrl } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 10, faceValueCents: 10000, paymentMethod: 'MANUAL_OFFLINE' }, actor);
    assert.equal(checkoutUrl, null);
    assert.equal(order.status, 'AWAITING_PAYMENT');
    assert.equal(order.paymentStatus, 'AWAITING_PAYMENT');
    assert.equal(order.faceValueTotalCents, 100_000);
    assert.equal(order.discountSource, 'GLOBAL_TIER');
    assert.equal(order.discountBps, 500);
    assert.equal(order.discountCents, 5_000);
    assert.equal(order.amountDueCents, 95_000);
    assert.equal(order.serviceFeeCents, 0);
    assert.equal(order.cards.length, 0);
    assert.match(order.reference, /^CG-\d{4}$/);

    await rejects(h.corporate.allocate(order.id, { recipientName: 'A', recipientEmail: 'a@example.com' }, actor), 409, /paid and issued/);

    const paid = await h.corporate.recordManualPayment(order.id, { tender: 'BANK_TRANSFER', paymentReference: 'BT-77' }, actor);
    assert.equal(paid.status, 'ISSUED');
    assert.equal(paid.paymentStatus, 'PAID');
    assert.equal(paid.amountPaidCents, 95_000);
    assert.equal(paid.tender, 'BANK_TRANSFER');
    assert.equal(paid.cards.length, 10);
    assert.deepEqual(paid.pool, { total: 10, allocated: 0, unallocated: 10, emailed: 0, emailFailed: 0, scheduled: 0, redeemedCards: 0, cancelledCards: 0, outstandingCents: 100_000 });

    const cards = await h.prisma.giftCard.findMany({ where: { corporateOrderId: order.id } });
    assert.equal(cards.length, 10);
    for (const card of cards) {
      assert.equal(card.status, 'ACTIVE');
      assert.equal(card.allocationStatus, 'UNALLOCATED');
      assert.equal(card.balanceCents, 10000);
      assert.equal(card.initialValueCents, 10000);
      assert.equal(card.recipientEmail, null);
      assert.equal(card.scheduledDeliveryAt, null);
      assert.equal(card.stripeCheckoutSessionId, null, 'a pool card is never reachable through the public session poll');
      assert.equal(card.saleChannel, 'CORPORATE');
      assert.equal(card.testMode, false);
      assert.ok(card.paidAt);
      assert.ok(card.expiresAt && card.expiresAt.getTime() > Date.now());
    }
    assert.equal(cards.reduce((sum, card) => sum + card.discountCents, 0), 5_000, 'per-card discounts sum to the order discount');
    assert.equal(cards.reduce((sum, card) => sum + (card.amountPaidCents ?? 0), 0), 95_000);
    assert.equal(new Set(cards.map((card) => card.code)).size, 10);

    // No second payment, no second pool.
    await rejects(h.corporate.recordManualPayment(order.id, { tender: 'CASH' }, actor), 409, /already been paid/);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 10);
  });

  it('refuses invoice/PO purchasing, below-minimum orders, inactive accounts and out-of-range values', async () => {
    const account = await newAccount();
    await rejects(h.corporate.createOrder({ corporateAccountId: account.id, quantity: 10, faceValueCents: 10000, paymentMethod: 'INVOICE' }, actor), 400, /not switched on/);
    await rejects(h.corporate.createOrder({ corporateAccountId: account.id, quantity: 4, faceValueCents: 10000, paymentMethod: 'MANUAL_OFFLINE' }, actor), 400, /at least 5 cards/);
    await rejects(h.corporate.createOrder({ corporateAccountId: account.id, quantity: 10, faceValueCents: 100, paymentMethod: 'MANUAL_OFFLINE' }, actor), 400, /Card value/);
    await h.corporate.updateAccount(account.id, { active: false });
    await rejects(h.corporate.createOrder({ corporateAccountId: account.id, quantity: 10, faceValueCents: 10000, paymentMethod: 'MANUAL_OFFLINE' }, actor), 400, /inactive/);
    assert.equal(await h.prisma.corporateGiftCardOrder.count({ where: { corporateAccountId: account.id } }), 0);
  });

  it('an account override replaces the tiers and is snapshotted on the order', async () => {
    const account = await newAccount({ companyName: 'Override Co' });
    await h.corporate.updateAccountTerms(account.id, { discountOverrideBps: 1200, minimumQuantityOverride: 2 }, actor);
    const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 2, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE' }, actor);
    assert.equal(order.discountSource, 'ACCOUNT_OVERRIDE');
    assert.equal(order.discountBps, 1200);
    assert.equal(order.discountCents, 1200);
    const snapshot = order.pricingSnapshot as { appliedBps: number; accountDiscountOverrideBps: number | null; tiers: unknown[] };
    assert.equal(snapshot.appliedBps, 1200);
    assert.equal(snapshot.accountDiscountOverrideBps, 1200);
    assert.equal(snapshot.tiers.length, 3);
    // Changing the terms afterwards does not touch the order.
    await h.corporate.updateAccountTerms(account.id, { discountOverrideBps: null }, actor);
    const again = await h.corporate.getOrder(order.id);
    assert.equal(again.discountBps, 1200);
  });

  it('a retried create with the same clientRequestId returns the same order', async () => {
    const account = await newAccount();
    const input = { corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE', clientRequestId: 'itest-request-0001' };
    const first = await h.corporate.createOrder(input, actor);
    const second = await h.corporate.createOrder(input, actor);
    assert.equal(first.order.id, second.order.id);
    assert.equal(await h.prisma.corporateGiftCardOrder.count({ where: { corporateAccountId: account.id } }), 1);
  });

  it('an unpaid order can be cancelled; an issued one cannot', async () => {
    const account = await newAccount();
    const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE' }, actor);
    const cancelled = await h.corporate.cancelOrder(order.id, { reason: 'Customer changed their mind' }, actor);
    assert.equal(cancelled.status, 'CANCELLED');
    assert.equal(cancelled.paymentStatus, 'CANCELLED');
    await rejects(h.corporate.recordManualPayment(order.id, { tender: 'CASH' }, actor), 409, /cancelled/);
    const { order: issued } = await issuedOrder(5);
    await rejects(h.corporate.cancelOrder(issued.id, { reason: 'too late' }, actor), 409, /Cancel individual cards/);
  });

  it('a paid order whose issuance failed is not cancellable, not re-payable, and is recovered without duplicating the pool', async () => {
    const account = await newAccount();
    const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE' }, actor);

    // Make issuance itself fail AFTER the payment is persisted: a trigger that
    // rejects every pool-card insert. The payment transaction commits, the
    // pool transaction aborts — exactly what a crash between the two leaves.
    await h.prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION itest_block_pool_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'ITEST issuance failure'; END $$ LANGUAGE plpgsql`);
    await h.prisma.$executeRawUnsafe(`CREATE TRIGGER itest_block_pool_insert BEFORE INSERT ON "GiftCard" FOR EACH ROW WHEN (NEW."corporateOrderId" IS NOT NULL) EXECUTE FUNCTION itest_block_pool_insert()`);
    try {
      await assert.rejects(h.corporate.recordManualPayment(order.id, { tender: 'BANK_TRANSFER', paymentReference: 'BT-CRASH' }, actor), (error: unknown) => {
        assert.match(JSON.stringify(error, Object.getOwnPropertyNames(error as object)), /ITEST issuance failure/);
        return true;
      });
    } finally {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS itest_block_pool_insert ON "GiftCard"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS itest_block_pool_insert()`);
    }

    const stranded = await h.prisma.corporateGiftCardOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(stranded.status, 'AWAITING_PAYMENT');
    assert.equal(stranded.paymentStatus, 'PAID');
    assert.equal(stranded.amountPaidCents, order.amountDueCents);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 0, 'payment persisted, no cards: the stranded state');

    // Money in, no cards: neither cancellable nor payable again.
    await rejects(h.corporate.cancelOrder(order.id, { reason: 'Trying to back out of a paid order' }, actor), 409, /has been paid/);
    await rejects(h.corporate.recordManualPayment(order.id, { tender: 'CASH' }, actor), 409, /already been paid/);
    const untouched = await h.prisma.corporateGiftCardOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(`${untouched.status}/${untouched.paymentStatus}`, 'AWAITING_PAYMENT/PAID');

    // Reading the order recovers it: the pool is created, the payment untouched.
    const recovered = await h.corporate.getOrder(order.id);
    assert.equal(recovered.status, 'ISSUED');
    assert.equal(recovered.paymentStatus, 'PAID');
    assert.equal(recovered.cards.length, 5);
    assert.equal(recovered.paidAt, stranded.paidAt?.toISOString());
    assert.equal(recovered.paymentReference, 'BT-CRASH');
    assert.equal(recovered.amountPaidCents, order.amountDueCents);

    // Every further retry path is a no-op: a second read, a duplicate Stripe
    // webhook for the (now settled) order, and a direct reconcile.
    assert.equal((await h.corporate.getOrder(order.id)).cards.length, 5);
    await h.corporate.handleStripeSession(
      { id: 'cs_itest_dup', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: order.amountDueCents, metadata: { corporateOrderId: order.id } } as unknown as Parameters<typeof h.corporate.handleStripeSession>[0],
      'completed'
    );
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 5);
    await rejects(h.corporate.cancelOrder(order.id, { reason: 'still no' }, actor), 409, /Cancel individual cards/);
  });

  it('concurrent recoveries of a paid-but-unissued order (webhook, poll, reads) create exactly one pool', async () => {
    const account = await newAccount();
    const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE' }, actor);
    // Put the order straight into the stranded state (what the previous test
    // proved a mid-issuance failure leaves behind).
    await h.prisma.corporateGiftCardOrder.update({ where: { id: order.id }, data: { paymentStatus: 'PAID', paidAt: new Date(), amountPaidCents: order.amountDueCents, tender: 'BANK_TRANSFER' } });
    const session = { id: 'cs_itest_race', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: order.amountDueCents, metadata: { corporateOrderId: order.id } } as unknown as Parameters<typeof h.corporate.handleStripeSession>[0];
    const results = await Promise.allSettled([
      h.corporate.getOrder(order.id),
      h.corporate.getOrder(order.id),
      h.corporate.handleStripeSession(session, 'completed'),
      h.corporate.handleStripeSession(session, 'completed'),
      h.corporate.getOrder(order.id)
    ]);
    for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
    const row = await h.prisma.corporateGiftCardOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(`${row.status}/${row.paymentStatus}`, 'ISSUED/PAID');
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 5, 'one pool, however many recoveries raced');
    assert.equal(new Set((await h.prisma.giftCard.findMany({ where: { corporateOrderId: order.id }, select: { code: true } })).map((card) => card.code)).size, 5);
  });

  it('a payment and a cancellation racing on the same order never produce CANCELLED + PAID', async () => {
    const account = await newAccount();
    let paidWins = 0;
    let cancelWins = 0;
    for (let round = 0; round < 6; round += 1) {
      const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'MANUAL_OFFLINE' }, actor);
      // Alternate who gets the first tick so both orderings are exercised.
      const pay = () => h.corporate.recordManualPayment(order.id, { tender: 'CASH' }, actor);
      const cancel = () => h.corporate.cancelOrder(order.id, { reason: 'Racing the payment' }, actor);
      const results = await Promise.allSettled(round % 2 === 0 ? [pay(), cancel()] : [cancel(), pay()]);
      const fulfilled = results.filter((result) => result.status === 'fulfilled').length;
      assert.equal(fulfilled, 1, `exactly one side wins: ${results.map((result) => (result.status === 'rejected' ? String((result.reason as Error).message) : 'ok')).join(' | ')}`);
      for (const result of results) {
        if (result.status === 'rejected') assert.equal((result.reason as { statusCode?: number }).statusCode, 409);
      }
      const row = await h.prisma.corporateGiftCardOrder.findUniqueOrThrow({ where: { id: order.id } });
      const cards = await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } });
      assert.notEqual(`${row.status}/${row.paymentStatus}`, 'CANCELLED/PAID');
      if (row.status === 'CANCELLED') {
        cancelWins += 1;
        assert.equal(row.paymentStatus, 'CANCELLED');
        assert.equal(row.amountPaidCents ?? 0, 0);
        assert.equal(cards, 0);
      } else {
        paidWins += 1;
        assert.equal(`${row.status}/${row.paymentStatus}`, 'ISSUED/PAID');
        assert.equal(cards, 5);
        assert.equal(row.cancelledAt, null);
      }
    }
    assert.equal(paidWins + cancelWins, 6);
  });

  it('test checkout mode issues immediately with no money and keeps those cards out of the account figures', async () => {
    await setSettings({ testCheckoutEnabled: true, corporate: TIERS });
    const account = await newAccount({ companyName: 'Test Mode Co' });
    const { order } = await h.corporate.createOrder({ corporateAccountId: account.id, quantity: 5, faceValueCents: 5000, paymentMethod: 'STRIPE' }, actor);
    assert.equal(order.testMode, true);
    assert.equal(order.status, 'ISSUED');
    assert.equal(order.amountPaidCents, 0);
    assert.equal(order.serviceFeeCents, 0);
    assert.ok(order.cards.every((card) => card.status === 'ACTIVE'));
    const cards = await h.prisma.giftCard.findMany({ where: { corporateOrderId: order.id } });
    assert.ok(cards.every((card) => card.testMode && card.amountPaidCents === 0));
    const { account: summary } = await h.corporate.getAccount(account.id);
    assert.equal(summary.stats.orderCount, 0);
    assert.equal(summary.stats.cardsPurchased, 0);
    assert.equal(summary.stats.outstandingCents, 0);
  });

  /* ---- liability ---- */

  it('pool cards are outstanding liability from issuance, and the ledger still reconciles', async () => {
    const { order } = await issuedOrder(5, 5000);
    const cards = await h.prisma.giftCard.findMany({ where: { status: { not: 'PENDING_PAYMENT' } }, select: { id: true, status: true, testMode: true, initialValueCents: true, balanceCents: true, paidAt: true, promoCodeSnapshot: true, saleChannel: true } });
    const redemptions = await h.prisma.giftCardRedemption.findMany({ select: { giftCardId: true, status: true, amountCents: true, venue: true, redeemedAt: true, giftCard: { select: { testMode: true } } } });
    const ledger = h.ledger.buildGiftCardLedger({
      cards,
      redemptions: redemptions.map((row) => ({ giftCardId: row.giftCardId, status: row.status, amountCents: row.amountCents, venue: row.venue, redeemedAt: row.redeemedAt, cardTestMode: row.giftCard.testMode }))
    });
    const corporate = ledger.byOrigin.find((row) => row.origin === 'CORPORATE');
    assert.ok(corporate);
    assert.equal(corporate.activeCards, 5);
    assert.equal(corporate.activeBalanceCents, 25_000);
    const { issued, explained } = h.ledger.giftCardLedgerBalances(ledger);
    assert.equal(explained, issued);

    // Allocation moves nothing on the books: same balance, same count.
    await h.corporate.allocate(order.id, { recipientName: 'Sarah', recipientEmail: 'sarah@example.com' }, actor);
    const after = await h.corporate.getOrder(order.id);
    assert.equal(after.pool.outstandingCents, 25_000);
    assert.equal(after.pool.total, 5);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 5);
  });

  /* ---- allocation ---- */

  it('allocating a pool card fills in the SAME card and emails the recipient only', async () => {
    const { order } = await issuedOrder(3);
    const before = (await h.prisma.giftCard.findMany({ where: { corporateOrderId: order.id }, select: { id: true } })).map((card) => card.id).sort();
    const result = await h.corporate.allocate(order.id, { recipientName: 'Sarah Matthews', recipientEmail: 'Sarah@Example.com', reference: '12 Ocean St' }, actor);
    assert.equal(result.alreadyAllocated, false);
    assert.equal(result.emailed, true);
    assert.equal(result.emailError, null);
    assert.ok(before.includes(result.card.id), 'the allocated card existed in the pool before allocation');
    assert.equal(result.card.allocationStatus, 'ALLOCATED');
    assert.equal(result.card.recipientEmail, 'sarah@example.com');
    assert.equal(result.card.message, 'Enjoy dinner on us.', 'the order default message fills an empty message');
    assert.equal(result.card.reference, '12 Ocean St');
    assert.equal(result.card.balanceCents, 5000);
    assert.deepEqual(sentTo, ['sarah@example.com'], 'the company contact is never mailed a voucher');
    const after = await h.corporate.getOrder(order.id);
    assert.equal(after.pool.allocated, 1);
    assert.equal(after.pool.unallocated, 2);
    assert.equal(after.pool.emailed, 1);
    assert.equal(after.pool.total, 3);
  });

  it('a failed send stays visible on the card and the pool, and resend recovers it', async () => {
    const { order } = await issuedOrder(2);
    mailOutcome = 'failed';
    const result = await h.corporate.allocate(order.id, { recipientName: 'Tom', recipientEmail: 'tom@example.com' }, actor);
    assert.equal(result.emailed, false);
    assert.match(result.emailError ?? '', /ITEST mail down/);
    assert.equal(result.card.allocationStatus, 'ALLOCATED');
    let detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.emailFailed, 1);
    assert.equal(detail.pool.emailed, 0);

    mailOutcome = 'sent';
    sentTo.length = 0;
    const resent = await h.corporate.resend(result.card.id);
    assert.ok(resent.emailedAt);
    assert.equal(resent.emailError, null);
    assert.deepEqual(sentTo, ['tom@example.com']);
    detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.emailFailed, 0);
    assert.equal(detail.pool.emailed, 1);
  });

  it('never allocates the same card twice under concurrency, and stops when the pool is empty', async () => {
    const { order } = await issuedOrder(3);
    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, (_, index) => h.corporate.allocate(order.id, { recipientName: `R${index}`, recipientEmail: `r${index}@example.com` }, actor))
    );
    const won = attempts.filter((attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof h.corporate.allocate>>> => attempt.status === 'fulfilled');
    const lost = attempts.filter((attempt) => attempt.status === 'rejected');
    assert.equal(won.length, 3);
    assert.equal(lost.length, 3);
    assert.equal(new Set(won.map((attempt) => attempt.value.card.id)).size, 3, 'three different cards');
    for (const attempt of lost) {
      assert.ok((attempt as PromiseRejectedResult).reason instanceof h.HttpError);
      assert.match(((attempt as PromiseRejectedResult).reason as Error).message, /No unallocated cards left/);
    }
    const allocated = await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } });
    assert.equal(allocated, 3);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id } }), 3, 'no card was created by allocation');
  });

  it('a retry with the same allocationKey returns the card already allocated to it', async () => {
    const { order } = await issuedOrder(3);
    const first = await h.corporate.allocate(order.id, { recipientName: 'Jo', recipientEmail: 'jo@example.com', allocationKey: 'crm:settlement-42' }, actor);
    const second = await h.corporate.allocate(order.id, { recipientName: 'Jo', recipientEmail: 'jo@example.com', allocationKey: 'crm:settlement-42' }, actor);
    assert.equal(second.alreadyAllocated, true);
    assert.equal(second.card.id, first.card.id);
    assert.equal(sentTo.length, 1, 'one email, not two');
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } }), 1);
  });

  /* ---- scheduling and the drain ---- */

  it('a scheduled allocation waits for the drain; an unallocated card is never drained', async () => {
    const { order } = await issuedOrder(3);
    const future = new Date(Date.now() + 2 * 24 * 3600_000).toISOString();
    const scheduled = await h.corporate.allocate(order.id, { recipientName: 'Later', recipientEmail: 'later@example.com', scheduledDeliveryAt: future }, actor);
    assert.equal(scheduled.emailed, false);
    assert.equal(scheduled.card.emailedAt, null);
    assert.ok(scheduled.card.scheduledDeliveryAt);
    assert.deepEqual(sentTo, []);
    let detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.scheduled, 1);

    // Nothing is due yet; nothing goes out.
    let drained = await h.giftCards.drainScheduledGiftCardSends();
    assert.deepEqual(sentTo, []);

    // Force a past schedule onto an UNALLOCATED pool card — the one state the
    // drain must ignore however the row looks — and onto the allocated one.
    const unallocated = await h.prisma.giftCard.findFirstOrThrow({ where: { corporateOrderId: order.id, allocationStatus: 'UNALLOCATED' } });
    const past = new Date(Date.now() - 3600_000);
    await h.prisma.giftCard.update({ where: { id: unallocated.id }, data: { scheduledDeliveryAt: past } });
    await h.prisma.giftCard.update({ where: { id: scheduled.card.id }, data: { scheduledDeliveryAt: past } });
    drained = await h.giftCards.drainScheduledGiftCardSends();
    assert.deepEqual(sentTo, ['later@example.com'], 'only the allocated card was sent');
    assert.ok(drained.sent >= 1);
    const untouched = await h.prisma.giftCard.findUniqueOrThrow({ where: { id: unallocated.id } });
    assert.equal(untouched.emailedAt, null);
    assert.equal(untouched.emailError, null);
    assert.equal(untouched.allocationStatus, 'UNALLOCATED');
    const delivered = await h.prisma.giftCard.findUniqueOrThrow({ where: { id: scheduled.card.id } });
    assert.ok(delivered.emailedAt);
    detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.scheduled, 0);
    assert.equal(detail.pool.emailed, 1);
  });

  it('an unallocated card cannot be emailed, resent, printed, QR-coded or redeemed', async () => {
    const { order } = await issuedOrder(2);
    const card = await h.prisma.giftCard.findFirstOrThrow({ where: { corporateOrderId: order.id }, include: { redemptions: true } });
    const settings = (await h.giftCards.getAdminSettings()).settings;
    const afterSend = await h.giftCards.sendGiftCardEmail(card, settings);
    assert.equal(afterSend.emailedAt, null);
    assert.deepEqual(sentTo, []);
    await rejects(h.corporate.resend(card.id), 409, /not been allocated/);
    await rejects(h.giftCards.resendGiftCardEmail(card.code), 400, /not been allocated/);
    await rejects(h.giftCards.getPrintableByCode(card.code), 404);
    await rejects(h.giftCards.qrCodeSvg(card.code), 404);
    await rejects(h.giftCards.redeem({ code: card.code, amountCents: 100, venue: 'St Alma' }, actor.id), 400, /not been allocated/);
    const still = await h.prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    assert.equal(still.balanceCents, 5000);
    assert.equal(await h.prisma.giftCardRedemption.count({ where: { giftCardId: card.id } }), 0);
  });

  it('an allocated card redeems like any other gift card, at the venue, with no order involvement', async () => {
    const { order } = await issuedOrder(2);
    const { card } = await h.corporate.allocate(order.id, { recipientName: 'Diner', recipientEmail: 'diner@example.com' }, actor);
    const printable = await h.giftCards.getPrintableByCode(card.code);
    assert.equal(printable.balanceCents, 5000);
    const redeemed = await h.giftCards.redeem({ code: card.code, amountCents: 1250, venue: 'Alma Avalon' }, actor.id);
    assert.equal(redeemed.balanceCents, 3750);
    assert.equal(redeemed.redemptions[0]?.venue, 'Alma Avalon');
    const detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.outstandingCents, 5000 + 3750);
    const { account } = await h.corporate.getAccount(order.corporateAccountId);
    assert.equal(account.stats.redeemedCents, 1250);
    assert.equal(account.stats.outstandingCents, 8750);
  });

  it('re-addressing is allowed until the voucher has gone out', async () => {
    const { order } = await issuedOrder(2);
    const future = new Date(Date.now() + 24 * 3600_000).toISOString();
    const scheduled = await h.corporate.allocate(order.id, { recipientName: 'Old', recipientEmail: 'old@example.com', scheduledDeliveryAt: future }, actor);
    const moved = await h.corporate.reassign(scheduled.card.id, { recipientName: 'New', recipientEmail: 'new@example.com' }, actor);
    assert.equal(moved.card.id, scheduled.card.id);
    assert.equal(moved.card.recipientEmail, 'new@example.com');
    assert.equal(moved.emailed, true, 'no schedule on the reassignment means send now');
    assert.deepEqual(sentTo, ['new@example.com']);
    await rejects(h.corporate.reassign(moved.card.id, { recipientName: 'Third', recipientEmail: 'third@example.com' }, actor), 409, /already been emailed/);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } }), 1);
  });

  /* ---- CSV ---- */

  it('a CSV is validated whole, allocated once, and a retry allocates nothing new', async () => {
    const { order } = await issuedOrder(4);
    const csv = 'firstName,lastName,email,message,scheduledDeliveryAt,reference\nSarah,Matthews,sarah@example.com,"Congratulations on your new home.",,12 Ocean St\nTom,Reed,tom@example.com,,,\nJo,Bloggs,jo@example.com,,' + new Date(Date.now() + 48 * 3600_000).toISOString() + ',\n';

    const dry = await h.corporate.importRecipients(order.id, { csv, dryRun: true }, actor);
    assert.equal(dry.valid, true);
    assert.equal(dry.summary.rowCount, 3);
    assert.equal(dry.summary.toAllocate, 3);
    assert.equal(dry.summary.available, 4);
    assert.equal(dry.allocated, undefined);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } }), 0, 'a dry run allocates nothing');

    const real = await h.corporate.importRecipients(order.id, { csv }, actor);
    assert.equal(real.valid, true);
    assert.equal(real.allocated?.length, 3);
    assert.deepEqual(sentTo.sort(), ['sarah@example.com', 'tom@example.com'], 'two sent now, one scheduled');
    const detail = await h.corporate.getOrder(order.id);
    assert.equal(detail.pool.allocated, 3);
    assert.equal(detail.pool.unallocated, 1);
    assert.equal(detail.pool.scheduled, 1);
    const sarah = detail.cards.find((card) => card.recipientEmail === 'sarah@example.com');
    assert.equal(sarah?.reference, '12 Ocean St');
    assert.equal(sarah?.message, 'Congratulations on your new home.');
    const tom = detail.cards.find((card) => card.recipientEmail === 'tom@example.com');
    assert.equal(tom?.message, 'Enjoy dinner on us.', 'blank message falls back to the order default');

    sentTo.length = 0;
    const retry = await h.corporate.importRecipients(order.id, { csv }, actor);
    assert.equal(retry.valid, true);
    assert.equal(retry.summary.alreadyAllocated, 3);
    assert.equal(retry.summary.toAllocate, 0);
    assert.deepEqual(sentTo, [], 'a retried file sends nothing again');
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } }), 3);
  });

  it('a CSV larger than the pool, or with a bad row, allocates nothing at all', async () => {
    const { order } = await issuedOrder(2);
    const tooMany = 'firstName,lastName,email\nA,B,a@example.com\nC,D,c@example.com\nE,F,e@example.com\n';
    const over = await h.corporate.importRecipients(order.id, { csv: tooMany }, actor);
    assert.equal(over.valid, false);
    assert.equal(over.summary.shortfall, 1);
    assert.match(over.errors[0]?.message ?? '', /only 2 unallocated/);
    const badRow = 'firstName,lastName,email\nA,B,a@example.com\nC,D,not-an-email\n';
    const bad = await h.corporate.importRecipients(order.id, { csv: badRow }, actor);
    assert.equal(bad.valid, false);
    assert.deepEqual(bad.errors.map((error) => error.row), [2]);
    assert.equal(await h.prisma.giftCard.count({ where: { corporateOrderId: order.id, allocationStatus: 'ALLOCATED' } }), 0);
    assert.deepEqual(sentTo, []);
  });

  /* ---- reporting ---- */

  it('account figures and the export reflect the pool', async () => {
    const { account, order } = await issuedOrder(5, 10000);
    await h.corporate.allocate(order.id, { recipientName: 'Sarah', recipientEmail: 'sarah@example.com' }, actor);
    const list = await h.corporate.listAccounts({ query: 'ITEST Beaches' });
    const summary = list.find((row) => row.id === account.id);
    assert.ok(summary);
    assert.equal(summary.stats.orderCount, 1);
    assert.equal(summary.stats.cardsPurchased, 5);
    assert.equal(summary.stats.faceValueCents, 50_000);
    assert.equal(summary.stats.discountCents, 1_250);
    assert.equal(summary.stats.amountPaidCents, 48_750);
    assert.equal(summary.stats.allocated, 1);
    assert.equal(summary.stats.unallocated, 4);
    assert.equal(summary.stats.emailed, 1);
    assert.equal(summary.stats.outstandingCents, 50_000);
    const exported = await h.corporate.exportAccountCards(account.id);
    assert.equal(exported.rows.length, 5);
    assert.match(exported.csv, /^order,code,status,allocation,/);
    assert.equal(exported.rows.filter((row) => row.allocationStatus === 'ALLOCATED').length, 1);
  });

  /* ---- regression: the consumer flows are untouched ---- */

  it('a consumer card still emails purchaser and recipient, drains on schedule and redeems', async () => {
    const consumer = await h.prisma.giftCard.create({
      data: {
        code: `ALMA-ITEST${Date.now().toString(36).toUpperCase().slice(-6)}`,
        status: 'ACTIVE',
        initialValueCents: 5000,
        balanceCents: 5000,
        currency: 'aud',
        purchaserName: 'Consumer',
        purchaserEmail: 'itest-consumer@example.com',
        recipientName: 'Friend',
        recipientEmail: 'friend@example.com',
        paidAt: new Date(),
        amountPaidCents: 5175,
        scheduledDeliveryAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() + 365 * 24 * 3600_000)
      },
      include: { redemptions: true }
    });
    assert.equal(consumer.corporateOrderId, null);
    assert.equal(consumer.allocationStatus, null);
    await h.giftCards.drainScheduledGiftCardSends();
    assert.deepEqual(sentTo.sort(), ['friend@example.com', 'itest-consumer@example.com']);
    const redeemed = await h.giftCards.redeem({ code: consumer.code, amountCents: 5000, venue: 'St Alma' }, actor.id);
    assert.equal(redeemed.status, 'REDEEMED');
    assert.ok(await h.giftCards.getPrintableByCode(consumer.code));
  });
});
