import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { winesService } from '../services/wines.service.js';

export const winesRouter = Router();

winesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await winesService.list({ venue: typeof req.query.venue === 'string' ? req.query.venue : null }));
  } catch (error) {
    next(error);
  }
});

winesRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await winesService.update(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Registered above '/:id/...' patterns that could shadow it.
winesRouter.delete('/pours/:pourId', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await winesService.unlinkPour(String(req.params.pourId)));
  } catch (error) {
    next(error);
  }
});

winesRouter.post('/:id/pours', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await winesService.linkPour(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
