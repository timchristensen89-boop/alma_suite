import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { posService } from '../services/pos.service.js';

// Register endpoints: any authenticated identity may ring up sales — a venue
// device (the counter iPad) or a signed-in staff/manager account. Nothing
// here is public.
export const posRouter = Router();

posRouter.use((req, _res, next) => {
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
    res.json(await posService.listOpenOrders(typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

posRouter.post('/orders', async (req, res, next) => {
  try {
    res.status(201).json(await posService.createOrder(req.body));
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

posRouter.post('/orders/:id/void', async (req, res, next) => {
  try {
    res.json(await posService.voidOrder(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

posRouter.get('/rules', async (_req, res, next) => {
  try {
    res.json(await posService.listRules());
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
