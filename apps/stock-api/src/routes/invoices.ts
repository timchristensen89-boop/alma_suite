import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { requireStockManager } from '../lib/stock-permissions.js';
import { invoicesService } from '../services/invoices.service.js';

export const invoicesRouter = Router();

invoicesRouter.get('/', async (req, res, next) => {
  try {
    const includeNoItem = req.query.includeNoItem === '1' || req.query.includeNoItem === 'true';
    res.json(await invoicesService.list({ includeNoItem }));
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

invoicesRouter.get('/assignees', async (_req, res, next) => {
  try {
    res.json(await invoicesService.listAssignees());
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

// Exclusion rules — defined before "/:id" so the path isn't swallowed.
invoicesRouter.get('/exclusion-rules', async (_req, res, next) => {
  try {
    res.json(await invoicesService.listExclusionRules());
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/exclusion-rules', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await invoicesService.upsertExclusionRule(req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.put('/exclusion-rules/:ruleId', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await invoicesService.upsertExclusionRule(req.body, String(req.params.ruleId)));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.delete('/exclusion-rules/:ruleId', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await invoicesService.deleteExclusionRule(String(req.params.ruleId)));
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

invoicesRouter.post('/:id/mark-no-item', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const user = req.user;
    if (!user) throw new HttpError(401, 'Sign in to triage invoices');
    res.json(await invoicesService.markNoItem(String(req.params.id), user.id, req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/:id/mark-needs-review', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    const user = req.user;
    if (!user) throw new HttpError(401, 'Sign in to triage invoices');
    res.json(await invoicesService.markNeedsReview(String(req.params.id), user.id, req.body));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.post('/:id/reset-triage', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await invoicesService.resetTriage(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

invoicesRouter.delete('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await invoicesService.deleteInvoice(String(req.params.id), req.body));
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
