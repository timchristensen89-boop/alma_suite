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

// Blank printable count sheet for a template. Anyone who can count may print
// it; that is who prints it.
stocktakeTemplatesRouter.get('/:id/count-sheet', async (req, res, next) => {
  try {
    const blind = req.query.blind === undefined ? undefined : req.query.blind !== '0' && req.query.blind !== 'false';
    const venue = typeof req.query.venue === 'string' ? req.query.venue : null;
    res.json(await stocktakeTemplatesService.countSheet(String(req.params.id), req.user, { blind, venue }));
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
