import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { reportsService } from '../services/reports.service.js';
import { supplierSpendService } from '../services/supplier-spend.service.js';

export const reportsRouter = Router();

// Projected spend per supplier per week: Xero P&L COGS-vs-sales trend applied
// to the sales forecast, split food/bev, then split by supplier share.
reportsRouter.get('/projected-supplier-spend', requireManager, async (req, res, next) => {
  try {
    res.json(await supplierSpendService.projectedSpend(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

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

// Stocktake status widget data (Sprint 2.4). Returns per-venue latest
// LOCKED stocktake + freshness + quality grade so Reports can show
// whether their stock value is trustworthy.
reportsRouter.get('/stocktake-status', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.stocktakeStatus(req.user!));
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

reportsRouter.get('/monthly-recap', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.monthlyRecap(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/monthly-recap/email', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.emailMonthlyRecap(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.post('/monthly-recap/sync', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.syncMonthlyRecapSources(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/menu-profitability', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.menuProfitability({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : '',
      accountKey: typeof req.query.accountKey === 'string' ? req.query.accountKey : 'all',
      category: typeof req.query.category === 'string' ? req.query.category : '',
      mappingStatus: typeof req.query.mappingStatus === 'string' ? req.query.mappingStatus : 'all'
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

// Set-menu margin roll-up: tasting / grazing / bottomless revenue vs the COGS
// of their $0 component lines.
reportsRouter.get('/menu-cogs', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.menuCostOfGoods({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }, req.user!));
  } catch (error) {
    next(error);
  }
});

// What a set menu is actually worth per dish: package revenue shared across
// the dishes each table was served, against per-portion cost.
reportsRouter.get('/banquets', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.banquets({
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

// Sales CSV upload. Defaults to a DRY RUN: nothing is written unless the
// caller explicitly sets dryRun false, so a preview can never surprise anyone.
reportsRouter.post('/sales/import-csv', requireManager, async (req, res, next) => {
  try {
    res.json(await reportsService.importActualSalesCsv(req.body ?? {}, req.user!));
  } catch (error) {
    next(error);
  }
});

reportsRouter.get('/sales/template.csv', requireManager, (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="alma-sales-template.csv"');
  res.send(reportsService.salesTemplate());
});

// Existing entries for a range, so the manual grid can prefill rather than
// silently overwrite what is already recorded.
reportsRouter.get('/sales/range', requireManager, async (req, res, next) => {
  try {
    res.json(
      await reportsService.listActualSalesRange(
        {
          venue: typeof req.query.venue === 'string' ? req.query.venue : null,
          from: String(req.query.from ?? ''),
          to: String(req.query.to ?? '')
        },
        req.user!
      )
    );
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
