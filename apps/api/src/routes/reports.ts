import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { reportsService } from '../services/reports.service.js';

export const reportsRouter = Router();

reportsRouter.get('/sales', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.listActualSales({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/sales/import', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.importActualSales(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/sales/clear', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.clearActualSales(req.body));
  } catch (error) {
    next(error);
  }
});

reportsRouter.delete('/sales/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.deleteActualSalesEntry(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});
