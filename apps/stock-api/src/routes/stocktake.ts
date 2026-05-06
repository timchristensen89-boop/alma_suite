import { Router } from 'express';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { stocktakesService } from '../services/stocktakes.service.js';

export const stocktakeRouter = Router();

function requireManager(user: AuthUser | undefined) {
  if (!user) throw new HttpError(401, 'Not authenticated');
  if (!user.isAdmin && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    throw new HttpError(403, 'Manager access required');
  }
}

stocktakeRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await stocktakesService.list());
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await stocktakesService.summary());
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/apply', async (req, res, next) => {
  try {
    requireManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/approve', async (req, res, next) => {
  try {
    requireManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id/movements', async (req, res, next) => {
  try {
    res.json(await stocktakesService.getMovementHistory(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/corrections', async (req, res, next) => {
  try {
    requireManager(req.user);
    res.json(await stocktakesService.createCorrection(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reverse', async (req, res, next) => {
  try {
    requireManager(req.user);
    res.json(await stocktakesService.reverseStocktake(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await stocktakesService.createStocktake(req.body));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.delete('/', async (req, res, next) => {
  try {
    res.json(await stocktakesService.deleteStocktakes(req.body));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.updateStocktake(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
