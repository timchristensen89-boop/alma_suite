import { timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '@alma/db';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { mailService } from '../services/mail.service.js';
import { loyaltyService } from '../services/loyalty.service.js';
import { posService } from '../services/pos.service.js';
import { posTerminalService } from '../services/pos-terminal.service.js';

// Register endpoints: any authenticated identity may ring up sales — a venue
// device (the counter iPad) or a signed-in staff/manager account. The ONE
// exception is /print-poll/: the Epson printer polls it with no session —
// the unguessable station cuid in the path is the credential.
export const posRouter = Router();

// A full manager or admin login approves money-reversing actions on its own;
// a floor-staff or device-PIN session must enter a manager PIN. (Refunds
// require one from every session and check it in the service regardless.)
function needsManagerPin(req: { user?: { role?: string; isAdmin?: boolean } | null }): boolean {
  const user = req.user;
  if (!user) return true;
  return user.role !== 'MANAGER' && user.role !== 'ADMIN' && !user.isAdmin;
}

// The money-reversing endpoints all accept a manager PIN in the body, and a
// PIN has no per-account lockout to lean on here (a failed try does not say
// WHOSE PIN it was guessing). This is the brute-force bound: generous for a
// venue's real refunds/voids, fatal to an automated 4-digit sweep. Per IP.
const managerPinLimiter = rateLimit({
  windowMs: 5 * 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts — wait a few minutes and try again.' }
});

// Constant-time check of the print-station secret. Production refuses to boot
// without one (env.ts), so an empty expected only happens in local dev.
function printSecretOk(provided: string): boolean {
  const expected = env.posPrintSecret;
  if (!expected) return true; // dev only — prod always has a secret configured
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

posRouter.use((req, _res, next) => {
  // The printers and the print-bridge poll these endpoints with no session —
  // polling, the station list, and the bridge's own heartbeat. They must
  // present POS_PRINT_SECRET (?k=… or the x-alma-print-secret header); it is
  // required in production (env.ts), so these endpoints are never open to an
  // anonymous caller there. Empty is tolerated only in local dev.
  const printPath =
    req.path.startsWith('/print-poll/') || req.path === '/print-stations' || req.path === '/print-bridge/heartbeat';
  if (printPath) {
    const provided = typeof req.query.k === 'string' ? req.query.k : req.header('x-alma-print-secret') ?? '';
    if (!printSecretOk(provided)) return next(new HttpError(401, 'Print station credential required.'));
    return next();
  }
  if (!req.user && !req.deviceUser) return next(new HttpError(401, 'Sign in the register first.'));
  next();
});

posRouter.get('/menu', async (_req, res, next) => {
  try {
    res.json(await posService.registerMenu());
  } catch (error) {
    next(error);
  }
});

posRouter.get('/orders', async (req, res, next) => {
  try {
    res.json(
      await posService.listOpenOrders(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.status === 'string' ? req.query.status : null
      )
    );
  } catch (error) {
    next(error);
  }
});

// ── Bug reports from the floor ─────────────────────────────────────────────
// Staff hit the problem; staff report it, in their words, while they still
// remember what they were doing. Everything else is attached automatically.

posRouter.post('/bug-reports', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (text.length < 3) throw new HttpError(400, 'Tell us what happened.');
    const created = await prisma.posBugReport.create({
      data: {
        venue: typeof body.venue === 'string' ? body.venue : 'Unknown',
        body: text.slice(0, 4000),
        screen: typeof body.screen === 'string' ? body.screen.slice(0, 80) : null,
        orderId: typeof body.orderId === 'string' ? body.orderId.slice(0, 40) : null,
        appVersion: typeof body.appVersion === 'string' ? body.appVersion.slice(0, 80) : null,
        userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 300) : null,
        reportedBy: typeof body.reportedBy === 'string' ? body.reportedBy.slice(0, 80) : null,
        clientError: typeof body.clientError === 'string' ? body.clientError.slice(0, 2000) : null,
        severity: body.severity === 'BLOCKING' ? 'BLOCKING' : 'NORMAL'
      }
    });
    // A report that says "we can't serve" must not wait for the next sweep.
    // The agent still picks it up on its tick; this is so a human knows now.
    if (created.severity === 'BLOCKING') {
      void mailService
        .sendDocument({
          to: (process.env.POS_SUPPORT_EMAIL ?? 'tim@almagroup.com.au').trim(),
          subject: `ALMA POS BLOCKING — ${created.venue}${created.reportedBy ? ` (${created.reportedBy})` : ''}`,
          text: [
            created.body,
            '',
            `venue: ${created.venue}`,
            `screen: ${created.screen ?? '—'}`,
            `bill: ${created.orderId ?? '—'}`,
            `build: ${created.appVersion ?? '—'}`,
            `browser error: ${created.clientError ?? 'none'}`
          ].join('\n'),
          html: `<p><strong>${escapeForMail(created.body)}</strong></p><ul>${[
            ['venue', created.venue],
            ['screen', created.screen],
            ['bill', created.orderId],
            ['build', created.appVersion],
            ['browser error', created.clientError]
          ]
            .map(([label, value]) => `<li>${label}: ${escapeForMail(String(value ?? '—'))}</li>`)
            .join('')}</ul>`
        })
        .catch(() => undefined);
    }
    res.json({ id: created.id, ok: true });
  } catch (error) {
    next(error);
  }
});

function escapeForMail(value: string) {
  return value.replace(/[&<>]/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : '&gt;'));
}

posRouter.get('/bug-reports', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(
      await prisma.posBugReport.findMany({
        where: status ? { status } : { status: { in: ['NEW', 'TRIAGED', 'NEEDS_INFO'] } },
        orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }],
        take: 100
      })
    );
  } catch (error) {
    next(error);
  }
});

posRouter.patch('/bug-reports/:id', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.status === 'string') patch.status = body.status;
    if (typeof body.resolution === 'string') patch.resolution = body.resolution.slice(0, 2000);
    if (body.status === 'FIXED' || body.status === 'WONTFIX') patch.resolvedAt = new Date();
    res.json(await prisma.posBugReport.update({ where: { id: String(req.params.id) }, data: patch }));
  } catch (error) {
    next(error);
  }
});

// Split a bill into N bills of its own — 71 (1), 71 (2), 71 (3) — each with
// an equal share of every item, each payable and tippable on its own.
posRouter.post('/orders/:id/split-evenly', async (req, res, next) => {
  try {
    res.json(await posService.splitEvenly(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/merge', async (req, res, next) => {
  try {
    res.json(await posService.mergeOrders(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/reopen', managerPinLimiter, async (req, res, next) => {
  try {
    res.json(await posService.reopenOrder(String(req.params.id), req.body, needsManagerPin(req)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/refund', managerPinLimiter, async (req, res, next) => {
  try {
    res.json(await posService.refundOrder(String(req.params.id), req.body, !req.user && Boolean(req.deviceUser)));
  } catch (error) {
    next(error);
  }
});

posRouter.patch('/tables/:id/position', async (req, res, next) => {
  try {
    res.json(await posService.moveTable(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders', async (req, res, next) => {
  try {
    res.status(201).json(await posService.createOrder(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/orders/:id', async (req, res, next) => {
  try {
    res.json(await posService.getOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.patch('/orders/:id', async (req, res, next) => {
  try {
    res.json(await posService.updateOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/guests/:id', async (req, res, next) => {
  try {
    res.json(await posService.guestProfile(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/orders/:id/lines', async (req, res, next) => {
  try {
    res.json(await posService.setLines(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/pay', async (req, res, next) => {
  try {
    res.json(await posService.payOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// ── Square Terminal ────────────────────────────────────────────────────────
// Pairing is per venue; charging is per bill. The register starts a checkout
// and then polls it — the guest still has to tap, and Square is the only one
// who knows when they have.

posRouter.get('/terminals', async (req, res, next) => {
  try {
    res.json(await posTerminalService.listDevices(req.query.venue));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminals/pair', async (req, res, next) => {
  try {
    res.json(await posTerminalService.pairDevice(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.delete('/terminals/:id', async (req, res, next) => {
  try {
    res.json(await posTerminalService.removeDevice(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/terminal-checkout', async (req, res, next) => {
  try {
    res.json(await posTerminalService.startCheckout(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/terminal-checkouts/:checkoutId', async (req, res, next) => {
  try {
    res.json(await posTerminalService.pollCheckout(String(req.params.checkoutId)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminal-checkouts/:checkoutId/cancel', async (req, res, next) => {
  try {
    res.json(await posTerminalService.cancelCheckout(String(req.params.checkoutId)));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/orders/:id/refundable-cards', async (req, res, next) => {
  try {
    res.json(await posTerminalService.refundableCards(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/terminal-refund', managerPinLimiter, async (req, res, next) => {
  try {
    res.json(await posTerminalService.startRefund(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/terminal-refunds/:refundId', async (req, res, next) => {
  try {
    res.json(await posTerminalService.pollRefund(String(req.params.refundId)));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/payments/:paymentId/undo', managerPinLimiter, async (req, res, next) => {
  try {
    res.json(await posService.undoPayment(String(req.params.id), String(req.params.paymentId), req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/orders/:id/void', managerPinLimiter, async (req, res, next) => {
  try {
    res.json(await posService.voidOrder(String(req.params.id), req.body, needsManagerPin(req)));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/tables', async (req, res, next) => {
  try {
    res.json(await posService.floorTables(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/qr-tables', async (req, res, next) => {
  try {
    const { qrOrderService } = await import('../services/qr-order.service.js');
    res.json(await qrOrderService.tableTokens(req.query.venue ? String(req.query.venue) : null));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/audit', async (req, res, next) => {
  try {
    res.json(
      await posService.auditReport(
        req.query.venue ? String(req.query.venue) : null,
        req.query.from ? String(req.query.from) : null,
        req.query.to ? String(req.query.to) : null
      )
    );
  } catch (err) {
    next(err);
  }
});

posRouter.get('/live', async (_req, res, next) => {
  try {
    res.json(await posService.liveBoard());
  } catch (err) {
    next(err);
  }
});

posRouter.post('/open-drawer', async (req, res, next) => {
  try {
    res.json(await posService.openCashDrawer(String(req.body?.venue ?? '')));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/print-stations', async (req, res, next) => {
  try {
    res.json(await posService.listPrintStations(req.query.venue ? String(req.query.venue) : null));
  } catch (err) {
    next(err);
  }
});

const printPollBody = express.urlencoded({ extended: true });

posRouter.post('/print-poll/:profileId', printPollBody, async (req, res, next) => {
  try {
    const result = await posService.printPoll(req.params.profileId, (req.body ?? {}) as Record<string, unknown>);
    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.send(result.xml);
  } catch (err) {
    next(err);
  }
});

posRouter.get('/print-poll/:profileId', async (req, res, next) => {
  try {
    const result = await posService.printPoll(req.params.profileId, {});
    res.set('Content-Type', 'text/xml; charset=utf-8');
    res.send(result.xml);
  } catch (err) {
    next(err);
  }
});

// The bridge announces itself (hostname, LAN IPs) so the Office can show
// whether dockets have a working path — and where the box driving them is.
// The heartbeat is public like /print-poll; reading the status needs a
// session like every other Office call.
posRouter.post('/print-bridge/heartbeat', async (req, res, next) => {
  try {
    res.json(await posService.recordPrintBridgeHeartbeat(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/print-bridge/status', async (req, res, next) => {
  try {
    res.json(await posService.printBridgeStatus(req.query.venue ? String(req.query.venue) : null));
  } catch (err) {
    next(err);
  }
});

// Xero daily sales: status for a venue/day, and the push itself. The nightly
// cron hits the scheduler route; these are the manual controls.
// Tables waiting on someone, and clearing a call once it's answered.
posRouter.get('/top-items', async (req, res, next) => {
  try {
    res.json(await posService.topItems(req.query.venue ? String(req.query.venue) : null));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/service-calls', async (req, res, next) => {
  try {
    res.json(await posService.listServiceCalls(req.query.venue ? String(req.query.venue) : null));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/service-calls/:id/clear', async (req, res, next) => {
  try {
    res.json(await posService.clearServiceCall(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/xero/status', async (req, res, next) => {
  try {
    const { integrationService } = await import('../services/integration.service.js');
    const venue = String(req.query.venue ?? '');
    if (!venue) throw new HttpError(400, 'venue is required.');
    const dateText = String(req.query.serviceDate ?? '');
    const serviceDate = dateText ? new Date(`${dateText}T00:00:00.000Z`) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    serviceDate.setUTCHours(0, 0, 0, 0);
    res.json(await integrationService.posXeroStatus(venue, serviceDate));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/xero/accounts', async (req, res, next) => {
  try {
    const { integrationService } = await import('../services/integration.service.js');
    const tenantId = String(req.query.tenantId ?? '');
    if (!tenantId) throw new HttpError(400, 'tenantId is required.');
    res.json(await integrationService.posXeroAccounts(tenantId));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/xero/push', async (req, res, next) => {
  try {
    const { integrationService } = await import('../services/integration.service.js');
    const venue = String(req.body?.venue ?? '');
    if (!venue) throw new HttpError(400, 'venue is required.');
    const dateText = String(req.body?.serviceDate ?? '');
    const serviceDate = dateText ? new Date(`${dateText}T00:00:00.000Z`) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    serviceDate.setUTCHours(0, 0, 0, 0);
    res.json(await integrationService.pushPosDayToXero({ venue, serviceDate, force: req.body?.force === true, dryRun: req.body?.dryRun === true }));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/specials', async (_req, res, next) => {
  try {
    res.json(await posService.listSpecials());
  } catch (err) {
    next(err);
  }
});

posRouter.post('/specials', async (req, res, next) => {
  try {
    res.json(await posService.createSpecial(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/specials/:id', async (req, res, next) => {
  try {
    res.json(await posService.retireSpecial(req.params.id));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/orders/:id/print-receipt', async (req, res, next) => {
  try {
    res.json(await posService.printReceipt(req.params.id));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/printer-profiles/:id/test', async (req, res, next) => {
  try {
    res.json(await posService.printTest(req.params.id));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/orders/:id/meta', async (req, res, next) => {
  try {
    res.json(await posService.setOrderMeta(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/unlock', async (req, res, next) => {
  try {
    res.json(await posService.unlockPin(req.body, (req as unknown as { user?: { email?: string | null } }).user?.email ?? null));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/variants', async (_req, res, next) => {
  try {
    res.json(await posService.listVariants());
  } catch (err) {
    next(err);
  }
});

posRouter.put('/variants/:parentId', async (req, res, next) => {
  try {
    res.json(await posService.saveVariants(req.params.parentId, req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/variants/:parentId', async (req, res, next) => {
  try {
    res.json(await posService.deleteVariantGroup(req.params.parentId));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/variants/:parentId/pour', async (req, res, next) => {
  try {
    res.json(await posService.createPourVariant(req.params.parentId, req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/menu-hides', async (_req, res, next) => {
  try {
    res.json(await posService.listMenuHides());
  } catch (err) {
    next(err);
  }
});

posRouter.post('/menu-hides', async (req, res, next) => {
  try {
    res.json(await posService.hideMenu(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/menu-hides/:id', async (req, res, next) => {
  try {
    res.json(await posService.unhideMenu(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/gift-card', async (req, res, next) => {
  try {
    res.json(await posService.giftCardBalance(String(req.query.code ?? '')));
  } catch (err) {
    next(err);
  }
});

// ── Loyalty ────────────────────────────────────────────────────────────────
// Staff-authenticated like every other POS route. Join and attach are
// service-floor actions; settings, report and adjust live in the Office.
posRouter.get('/loyalty/settings', async (_req, res, next) => {
  try {
    res.json(await loyaltyService.settings());
  } catch (err) {
    next(err);
  }
});

posRouter.put('/loyalty/settings', async (req, res, next) => {
  try {
    res.json(await loyaltyService.updateSettings(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/loyalty/join', async (req, res, next) => {
  try {
    res.json(await loyaltyService.join(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/loyalty/member', async (req, res, next) => {
  try {
    res.json(await loyaltyService.memberByHandle(String(req.query.handle ?? '')));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/loyalty/report', async (_req, res, next) => {
  try {
    res.json(await loyaltyService.report());
  } catch (err) {
    next(err);
  }
});

posRouter.post('/loyalty/adjust', async (req, res, next) => {
  try {
    res.json(await loyaltyService.adjust({ ...(req.body ?? {}), createdBy: req.user?.email ?? req.deviceUser?.firstName ?? null }));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/orders/:id/loyalty', async (req, res, next) => {
  try {
    res.json(await posService.attachLoyalty(req.params.id, String(req.body?.handle ?? '')));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/orders/:id/loyalty', async (req, res, next) => {
  try {
    res.json(await posService.detachLoyalty(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Selling a card at the till. Staff-authenticated like every other POS
// route; the seller is recorded on the card.
posRouter.post('/orders/:id/gift-cards', async (req, res, next) => {
  try {
    res.json(await posService.addGiftCardSale(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/orders/:id/gift-cards/:saleId', async (req, res, next) => {
  try {
    res.json(await posService.removeGiftCardSale(req.params.id, req.params.saleId));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/orders/:id/gift-cards', async (req, res, next) => {
  try {
    res.json(await posService.listGiftCardSales(req.params.id));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/manager-approve', async (req, res, next) => {
  try {
    res.json(await posService.managerApprove(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/rules', async (_req, res, next) => {
  try {
    res.json(await posService.listRules());
  } catch (error) {
    next(error);
  }
});

posRouter.get('/courses', async (_req, res, next) => {
  try {
    res.json(await posService.listCourses());
  } catch (error) {
    next(error);
  }
});

posRouter.post('/printer-profiles', async (req, res, next) => {
  try {
    res.json(await posService.savePrinterProfile(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/printer-profiles/:id', async (req, res, next) => {
  try {
    res.json(await posService.deletePrinterProfile(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

posRouter.post('/rules', async (req, res, next) => {
  try {
    res.json(await posService.saveRule(req.body));
  } catch (err) {
    next(err);
  }
});

posRouter.delete('/rules/:id', async (req, res, next) => {
  try {
    res.json(await posService.deleteRule(String(req.params.id)));
  } catch (err) {
    next(err);
  }
});

posRouter.get('/printer-profiles', async (_req, res, next) => {
  try {
    res.json(await posService.listPrinterProfiles());
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/send', async (req, res, next) => {
  try {
    res.json(await posService.sendOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/drawer', async (req, res, next) => {
  try {
    res.json(await posService.drawerStatus(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/drawer/open', async (req, res, next) => {
  try {
    res.status(201).json(await posService.openDrawer(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/drawer/close', async (req, res, next) => {
  try {
    res.json(await posService.closeDrawer(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/close-day', async (req, res, next) => {
  try {
    res.json(await posService.closeDayStatus(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/close-day', async (req, res, next) => {
  try {
    res.json(await posService.closeDay(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/eighty-six', async (req, res, next) => {
  try {
    res.json(await posService.toggle86(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/modifier-groups', async (req, res, next) => {
  try {
    res.json(await posService.saveModifierGroup(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.delete('/modifier-groups/:id', async (req, res, next) => {
  try {
    res.json(await posService.deleteModifierGroup(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/venue-settings', async (req, res, next) => {
  try {
    res.json(await posService.getVenueSetting(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/venue-settings', async (req, res, next) => {
  try {
    res.json(await posService.setVenueSetting(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/shift-report', async (req, res, next) => {
  try {
    res.json(
      await posService.shiftReport(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.staffName === 'string' ? req.query.staffName : null
      )
    );
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/email-receipt', async (req, res, next) => {
  try {
    res.json(await posService.emailReceipt(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/kds', async (req, res, next) => {
  try {
    res.json(
      await posService.kdsBoard(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.station === 'string' ? req.query.station : null
      )
    );
  } catch (error) {
    next(error);
  }
});

posRouter.post('/kds/:id/bump', async (req, res, next) => {
  try {
    res.json(await posService.kdsBump(String(req.params.id), false));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/kds/:id/recall', async (req, res, next) => {
  try {
    res.json(await posService.kdsBump(String(req.params.id), true));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/adjust-reasons', (_req, res) => {
  res.json(posService.adjustReasons());
});

posRouter.post('/orders/:id/discount', async (req, res, next) => {
  try {
    res.json(await posService.discountOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders/:id/lines/:lineId/adjust', async (req, res, next) => {
  try {
    res.json(await posService.adjustLine(String(req.params.id), String(req.params.lineId), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/wastage', async (req, res, next) => {
  try {
    res.status(201).json(await posService.recordWastage(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/adjustments', async (req, res, next) => {
  try {
    res.json(await posService.listAdjustments(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/homescreen', async (req, res, next) => {
  try {
    res.json(await posService.getHomescreen(typeof req.query.userKey === 'string' ? req.query.userKey : null));
  } catch (error) {
    next(error);
  }
});

posRouter.put('/homescreen', async (req, res, next) => {
  try {
    res.json(await posService.saveHomescreen(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminal/connection-token', async (req, res, next) => {
  try {
    res.json(await posService.terminalConnectionToken((req.body as { venue?: string })?.venue ?? null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/terminal/payment-intent', async (req, res, next) => {
  try {
    res.json(await posService.terminalPaymentIntent(req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/floor-reservations', async (req, res, next) => {
  try {
    res.json(await posService.floorReservations(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/day-summary', async (req, res, next) => {
  try {
    res.json(
      await posService.daySummary(
        typeof req.query.venue === 'string' ? req.query.venue : null,
        typeof req.query.date === 'string' ? req.query.date : null
      )
    );
  } catch (error) {
    next(error);
  }
});
