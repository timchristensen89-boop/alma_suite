import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { transfersService } from '../services/transfers.service.js';

export const transfersRouter = Router();

transfersRouter.get('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const venue = typeof req.query.venue === 'string' ? req.query.venue : undefined;
    res.json(await transfersService.list(venue));
  } catch (error) {
    next(error);
  }
});

transfersRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await transfersService.create(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});
