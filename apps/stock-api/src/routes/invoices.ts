import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { requireStockManager } from '../lib/stock-permissions.js';
import { invoicesService } from '../services/invoices.service.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await invoicesService.list());
  } catch (error) {
    next(error);
  }
});

invoicesRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await invoicesService.summary());
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/rip', async (req, res, next) => {
  try {
    res.json(invoicesService.ripInvoiceText(req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/import', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await invoicesService.importInvoices(req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await invoicesService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/lines/:lineId/rematch', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await invoicesService.rematchLine(String(req.params.lineId), req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/lines/:lineId/apply-cost', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    if (req.body?.confirmationText !== 'APPLY COST') {
      throw new HttpError(400, 'Type APPLY COST to confirm invoice cost changes');
    }
    res.json(await invoicesService.applyLineCost(String(req.params.lineId)));
  } catch (error) {
    next(error);
  }
});
