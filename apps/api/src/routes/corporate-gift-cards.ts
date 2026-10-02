import { Router, type NextFunction, type Request, type Response } from 'express';
import { CORPORATE_RECIPIENT_CSV_TEMPLATE } from '@alma/shared';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { corporateGiftCardService } from '../services/corporate-gift-card.service.js';
import { giftCardService } from '../services/gift-card.service.js';

/**
 * Corporate gift cards — staff API, mounted at /api/gift-cards/corporate.
 *
 * Two gates, reusing the ones the gift-card app already has:
 *
 *   requireManager — a person (never a venue iPad) with the ADMIN or MANAGER
 *   role, or Alma Admin. Sees accounts and orders, creates accounts and
 *   orders at the account's configured terms, allocates and re-addresses
 *   pool cards, uploads recipient files, resends vouchers, exports.
 *
 *   requireCorporateOwner — the gift card owner (the same email gate that
 *   guards promo codes, checkout settings and donations). Changes commercial
 *   terms (discount override, minimum), records an offline payment as
 *   received, and cancels an unpaid order. A manager can never alter a
 *   discount: the price of an order is whatever the owner configured.
 */
export function requireCorporateOwner(req: Request, res: Response, next: NextFunction) {
  requireManager(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (!giftCardService.canManagePromoCodes(req.user)) {
      return next(new HttpError(403, 'Only Tim can change corporate pricing, record offline payments or cancel corporate orders.'));
    }
    return next();
  });
}

export const corporateGiftCardsRouter = Router();

const queryText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/* ---- accounts ---- */

corporateGiftCardsRouter.get('/accounts', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.listAccounts({ query: queryText(req.query.query), includeInactive: req.query.includeInactive === 'true' }));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/accounts', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await corporateGiftCardService.createAccount(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.get('/accounts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.getAccount(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.patch('/accounts/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.updateAccount(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.patch('/accounts/:id/terms', requireCorporateOwner, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.updateAccountTerms(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.get('/accounts/:id/export.csv', requireManager, async (req, res, next) => {
  try {
    const { filename, csv } = await corporateGiftCardService.exportAccountCards(String(req.params.id));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

/* ---- quotes and orders ---- */

corporateGiftCardsRouter.post('/quote', requireManager, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    res.json(
      await corporateGiftCardService.quote({
        corporateAccountId: String(body.corporateAccountId ?? ''),
        quantity: Number(body.quantity),
        faceValueCents: Number(body.faceValueCents),
        paymentMethod: typeof body.paymentMethod === 'string' ? body.paymentMethod : undefined
      })
    );
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.get('/orders', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.listOrders({ status: queryText(req.query.status), query: queryText(req.query.query) }));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/orders', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await corporateGiftCardService.createOrder(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.get('/orders/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.getOrder(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/orders/:id/stripe-checkout', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.refreshStripeCheckout(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/orders/:id/manual-payment', requireCorporateOwner, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.recordManualPayment(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/orders/:id/cancel', requireCorporateOwner, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.cancelOrder(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

/* ---- pool ---- */

corporateGiftCardsRouter.post('/orders/:id/allocate', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await corporateGiftCardService.allocate(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

// Validate-only with dryRun: true; allocate with dryRun false/absent.
corporateGiftCardsRouter.post('/orders/:id/recipients', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.importRecipients(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.get('/recipients-template.csv', requireManager, (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="alma-corporate-recipients-template.csv"');
  res.send(CORPORATE_RECIPIENT_CSV_TEMPLATE);
});

corporateGiftCardsRouter.post('/cards/:id/reassign', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.reassign(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

corporateGiftCardsRouter.post('/cards/:id/resend', requireManager, async (req, res, next) => {
  try {
    res.json(await corporateGiftCardService.resend(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});
