import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { reserveService } from '../services/reserve.service.js';

export const reserveRouter = Router();

reserveRouter.get('/diary', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.diary({
      start: typeof req.query.start === 'string' ? req.query.start : undefined,
      end: typeof req.query.end === 'string' ? req.query.end : undefined,
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/guests', requireManager, async (_req, res, next) => {
  try {
    res.json(await reserveService.listGuests());
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/guests', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createGuest(req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.get('/tables', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.listTables(typeof req.query.venue === 'string' ? req.query.venue : undefined));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/tables', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createTable(req.body));
  } catch (error) {
    next(error);
  }
});

reserveRouter.post('/reservations', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await reserveService.createReservation(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

reserveRouter.patch('/reservations/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reserveService.updateReservation(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
