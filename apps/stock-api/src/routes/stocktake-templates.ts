import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { stocktakeTemplatesService } from '../services/stocktake-templates.service.js';

export const stocktakeTemplatesRouter = Router();

stocktakeTemplatesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await stocktakeTemplatesService.list(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeTemplatesRouter.get('/:id/resolve', async (req, res, next) => {
  try {
    res.json(await stocktakeTemplatesService.resolve(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeTemplatesRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await stocktakeTemplatesService.create(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeTemplatesRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakeTemplatesService.update(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeTemplatesRouter.delete('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakeTemplatesService.remove(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});
