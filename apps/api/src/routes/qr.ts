import { Router } from 'express';
import { qrOrderService } from '../services/qr-order.service.js';

// PUBLIC router — guests are anonymous; the signed table token is the auth.
export const qrRouter = Router();

qrRouter.get('/context', async (req, res, next) => {
  try {
    res.json(await qrOrderService.context(String(req.query.t ?? '')));
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/call', async (req, res, next) => {
  try {
    res.json(await qrOrderService.call(req.body, req.ip));
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/pay-intent', async (req, res, next) => {
  try {
    res.json(await qrOrderService.payIntent(req.body, req.ip));
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/pay-confirm', async (req, res, next) => {
  try {
    res.json(await qrOrderService.payConfirm(req.body, req.ip));
  } catch (err) {
    next(err);
  }
});

qrRouter.post('/order', async (req, res, next) => {
  try {
    res.json(await qrOrderService.submit(req.body, req.ip));
  } catch (err) {
    next(err);
  }
});

// The guest is back from Square's checkout. Verified server-side against
// Square before anything reaches the bill — the redirect proves nothing.
qrRouter.post('/confirm', async (req, res, next) => {
  try {
    res.json(await qrOrderService.confirmPaid(req.body, req.ip));
  } catch (error) {
    next(error);
  }
});
