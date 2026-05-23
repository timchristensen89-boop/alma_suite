import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { reportsService } from '../services/reports.service.js';

export const reportsRouter = Router();

reportsRouter.get('/overview', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.overview(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/staff', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.staff(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/compliance', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.compliance(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/stock', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.stock(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/prime-cost', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.primeCost({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/sales', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.listActualSales({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/item-sales', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.listItemActualSales({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/sales/import', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.importActualSales(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/sales/clear', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.clearActualSales(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.delete('/sales/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.deleteActualSalesEntry(String(req.params.id), req.user!));
  } catch (error) {
    next(error);
  }
});
