import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { stocktakesService } from '../services/stocktakes.service.js';

export const stocktakeRouter = Router();

stocktakeRouter.get('/', async (req, res, next) => {
  try {
    res.json(await stocktakesService.list(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/summary', async (req, res, next) => {
  try {
    res.json(await stocktakesService.summary(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/review', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reviewQueue(req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/apply', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/approve', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.applyStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id/movements', async (req, res, next) => {
  try {
    res.json(await stocktakesService.getMovementHistory(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/corrections', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.createCorrection(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reverse', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reverseStocktake(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.get(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await stocktakesService.createStocktake(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.delete('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.deleteStocktakes(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reopen', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.reopenStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.updateStocktake(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

// Loaded replacement state machine endpoints — IN_PROGRESS → SUBMITTED →
// REVIEWED → LOCKED. Reopen with reason flips any of those back to
// REOPENED. See stocktakes.service.ts for full guards.
stocktakeRouter.post('/:id/submit', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.submitStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/review', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    res.json(await stocktakesService.reviewStocktake(String(req.params.id), req.user, { notes }));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/lock', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stocktakesService.lockStocktake(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/reopen-with-reason', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';
    res.json(await stocktakesService.reopenStocktakeWithReason(String(req.params.id), req.user, reason));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id/export.csv', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const { filename, csv } = await stocktakesService.exportCsv(String(req.params.id), req.user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});
