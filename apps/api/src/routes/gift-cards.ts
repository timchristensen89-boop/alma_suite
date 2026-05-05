import { Router } from 'express';
import type Stripe from 'stripe';
import { requireManager } from '../lib/auth-middleware.js';
import {
  constructStripeWebhookEvent,
  giftCardService
} from '../services/gift-card.service.js';

export const giftCardsRouter = Router();

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

giftCardsRouter.get('/print/:code', async (req, res, next) => {
  try {
    res.json(await giftCardService.getPrintableByCode(String(req.params.code)));
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
