import { Router, type NextFunction, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import {
  constructStripeWebhookEvent,
  giftCardService
} from '../services/gift-card.service.js';

export const giftCardsRouter = Router();

/**
 * Redeeming at the counter is a floor action, not a management one. The venue
 * iPads sign in as VENUE_DEVICE accounts, which are granted GIFTCARDS
 * redeem permission at creation (device.service DEVICE_APP_ACCESS) — but the
 * route demanded requireManager, and isManager() refuses every device account
 * outright. So a balance check worked and the redeem itself 403'd with
 * "manager-only action" on the day staff first tried it. Managers pass as
 * before; devices (and any staff explicitly given the redeem permission) pass
 * too. Cancel/void stay manager-only.
 */
function requireGiftCardRedeemer(req: Request, _res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) return next(new HttpError(401, 'You’re not signed in. Sign in with your Alma account or the venue device.'));
  const isManagerLike = user.accountType !== 'VENUE_DEVICE' && (user.role === 'ADMIN' || user.role === 'MANAGER' || user.isAdmin);
  const giftAccess = user.appAccess.find((access) => access.appId === 'GIFTCARDS' && access.status === 'ENABLED');
  const canRedeem = Boolean(giftAccess?.permissions?.redeem) || giftAccess?.role === 'ADMIN' || giftAccess?.role === 'MANAGER';
  if (isManagerLike || canRedeem) return next();
  return next(new HttpError(403, 'This account can’t redeem gift cards. Ask a manager, or use the venue iPad.'));
}

function requireGiftCardOwner(req: Request, res: Response, next: NextFunction) {
  requireManager(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (!giftCardService.canManagePromoCodes(req.user)) {
      return next(new HttpError(403, 'Only Tim can manage gift card promo codes and checkout settings.'));
    }
    return next();
  });
}

giftCardsRouter.post('/checkout', async (req, res, next) => {
  try {
    res.status(201).json(await giftCardService.createCheckout(req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/session/:sessionId', async (req, res, next) => {
  try {
    res.json(await giftCardService.getByCheckoutSession(String(req.params.sessionId)));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/settings/public', async (_req, res, next) => {
  try {
    res.json(await giftCardService.getPublicSettings());
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/public/config', async (_req, res, next) => {
  try {
    res.json(await giftCardService.getPublicConfig());
  } catch (error) {
    next(error);
  }
});

// Settings images, served once and cached, instead of riding along inside the
// public config on every page load. The fingerprint in the path means a new
// upload gets a new URL, so a long cache can never serve a stale card.
giftCardsRouter.get('/assets/:field/:fingerprint', async (req, res, next) => {
  try {
    const asset = await giftCardService.readSettingsImage(String(req.params.field));
    if (!asset) {
      res.status(404).json({ message: 'No such image.' });
      return;
    }
    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(asset.body);
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/public/orders', async (req, res, next) => {
  try {
    res.status(201).json(await giftCardService.createCheckout(req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/admin/orders', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.listOrders({
      query: typeof req.query.query === 'string' ? req.query.query : undefined
    }));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/report/purchases', requireManager, async (req, res, next) => {
  try {
    const q = (key: string) => (typeof req.query[key] === 'string' ? (req.query[key] as string) : undefined);
    res.json(await giftCardService.purchaseReport({ from: q('from'), to: q('to'), source: q('source'), query: q('query') }));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/report', requireManager, async (req, res, next) => {
  try {
    res.json(
      await giftCardService.report({
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
        includeTest: req.query.includeTest === 'true'
      })
    );
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/promo/quote', async (req, res, next) => {
  try {
    res.json(await giftCardService.quotePromo(req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/print/:code', async (req, res, next) => {
  try {
    res.json(await giftCardService.getPrintableByCode(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

// Customer-designed "Create your own" artwork. Public by card code — the code
// itself is the secret, matching /qr/:code and /print/:code.
giftCardsRouter.get('/artwork/:code', async (req, res, next) => {
  try {
    const artwork = await giftCardService.getArtworkByCode(String(req.params.code));
    res.setHeader('Content-Type', artwork.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(artwork.data);
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/qr/:code', async (req, res, next) => {
  try {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(await giftCardService.qrCodeSvg(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/wallet/apple/:code', async (req, res, next) => {
  try {
    const code = String(req.params.code);
    const pass = await giftCardService.appleWalletPass(code);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${code}.pkpass"`);
    res.send(pass);
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/wallet/google/:code', async (req, res, next) => {
  try {
    res.redirect(await giftCardService.googleWalletSaveUrl(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/settings', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.getAdminSettings(req.user));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.patch('/settings', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.json(await giftCardService.updateSettings(req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/promo-codes', requireManager, async (_req, res, next) => {
  try {
    res.json(await giftCardService.listPromoCodes());
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/promo-codes', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.status(201).json(await giftCardService.createPromoCode(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.patch('/promo-codes/:id', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.json(await giftCardService.updatePromoCode(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.delete('/promo-codes/:id', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.json(await giftCardService.removePromoCode(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/cards', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.list({
      query: typeof req.query.query === 'string' ? req.query.query : undefined
    }));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.get('/cards/:code', requireGiftCardRedeemer, async (req, res, next) => {
  try {
    res.json(await giftCardService.lookup(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

// Counter sale paid by card through Stripe. Staff show the returned URL as a
// QR; the customer pays on their own phone, so no card details reach the iPad
// and no reader hardware is needed. Poll /session/:id to see it land.
giftCardsRouter.post('/counter/checkout', requireManager, async (req, res, next) => {
  try {
    res.json(
      await giftCardService.createCheckout(req.body, {
        counter: true,
        soldByStaffId: req.user?.id ?? null
      })
    );
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/physical/activate', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await giftCardService.activatePhysicalCard(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ */
/* Donations and sponsorship                                           */
/* ------------------------------------------------------------------ */

/*
 * Owner-only, not manager-only.
 *
 * Giving one away spends a scarce, group-wide resource — one of twelve for the
 * year — and the policy's templates are signed by the director. requireManager
 * would let any venue manager burn an allocation the whole group shares.
 * requireGiftCardOwner is the same gate that guards promo codes and checkout
 * settings: Tim, by email, and nobody else.
 */

// What is left of this year's twelve. Read by both the admin screen and the
// counter iPad before either offers the button.
giftCardsRouter.get('/donations/allocation', requireGiftCardOwner, async (req, res, next) => {
  try {
    const year = typeof req.query.year === 'string' ? Number(req.query.year) : undefined;
    res.json(await giftCardService.donationAllocation(Number.isFinite(year) ? year : undefined));
  } catch (error) {
    next(error);
  }
});

// The donation register: separate from the purchase report on purpose. A
// donated voucher is never a sale — it carries no paidAt, so it cannot show up
// in takings — and the question asked of it is a different one: what did the
// programme actually cost, against what it looks like from the outside.
giftCardsRouter.get('/donations/report', requireGiftCardOwner, async (req, res, next) => {
  try {
    const year = typeof req.query.year === 'string' ? Number(req.query.year) : undefined;
    res.json(await giftCardService.donationReport({ year: Number.isFinite(year) ? year : undefined }));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/donations', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.status(201).json(await giftCardService.recordDonation(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

// Record the listing after the event: the email confirming you were named is
// what supports treating this as sponsorship rather than a gift.
giftCardsRouter.patch('/donations/:id', requireGiftCardOwner, async (req, res, next) => {
  try {
    res.json(await giftCardService.updateDonation(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/redeem', requireGiftCardRedeemer, async (req, res, next) => {
  try {
    const card = await giftCardService.redeem(req.body, req.user?.id);
    // The successful counterpart of the error handler's failure line, so a
    // day's redemptions can be reconstructed from the log alone.
    const body = (req.body ?? {}) as { amountCents?: unknown; venue?: unknown };
    console.info(
      `[gift-cards] redeemed code=${card.code} amountCents=${String(body.amountCents)} venue=${String(body.venue)} ` +
        `balanceCents=${card.balanceCents} by ${req.user?.accountType ?? 'user'}:${req.user?.email ?? req.user?.firstName ?? req.user?.id}`
    );
    res.json(card);
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/cards/:code/cancel', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.cancel(String(req.params.code), req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

export async function stripeGiftCardWebhook(req: { body: Buffer; header(name: string): string | undefined }, res: { json(body: unknown): void }, next: (error?: unknown) => void) {
  try {
    const event = constructStripeWebhookEvent(req.body, req.header('stripe-signature'));
    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded'
    ) {
      await giftCardService.handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }
    if (
      event.type === 'checkout.session.expired' ||
      event.type === 'checkout.session.async_payment_failed'
    ) {
      await giftCardService.disregardUnconfirmedCheckout(
        event.data.object as Stripe.Checkout.Session,
        event.type === 'checkout.session.expired'
          ? 'Stripe checkout expired before payment was confirmed.'
          : 'Stripe asynchronous payment failed.'
      );
    }
    res.json({ received: true });
  } catch (error) {
    next(error);
  }
}
