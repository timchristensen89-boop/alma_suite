import { Router, type NextFunction, type Request, type Response } from 'express';
import type Stripe from 'stripe';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import {
  constructStripeWebhookEvent,
  giftCardService
} from '../services/gift-card.service.js';

export const giftCardsRouter = Router();

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

giftCardsRouter.get('/cards/:code', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.lookup(String(req.params.code)));
  } catch (error) {
    next(error);
  }
});

giftCardsRouter.post('/redeem', requireManager, async (req, res, next) => {
  try {
    res.json(await giftCardService.redeem(req.body, req.user?.id));
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
