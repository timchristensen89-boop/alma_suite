import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { itemsService } from '../services/items.service.js';

export const itemsRouter = Router();

itemsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await itemsService.list(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/export.csv', async (req, res, next) => {
  try {
    const { filename, csv } = await itemsService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/summary', async (req, res, next) => {
  try {
    res.json(await itemsService.summary(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/dashboard', async (req, res, next) => {
  try {
    res.json(await itemsService.dashboard(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/low-stock', async (req, res, next) => {
  try {
    res.json(await itemsService.lowStock(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

// Data quality report (Loaded replacement Sprint 1 #5) — surfaces
// catalogue warnings: missing unit / count unit / conversion / category
// / count area / latest cost, plus a stale-cost flag.
itemsRouter.get('/data-quality', async (req, res, next) => {
  try {
    const staleDays = typeof req.query.staleDays === 'string' ? Number(req.query.staleDays) : undefined;
    res.json(await itemsService.dataQualityReport(req.user, { staleDays: Number.isFinite(staleDays) ? staleDays : undefined }));
  } catch (error) {
    next(error);
  }
});

// Costing-trust health: active items mis-configured so they cost $0 or wrong,
// ranked by impact, with the affected recipes named. Drives the worklist panel.
itemsRouter.get('/config-health', async (req, res, next) => {
  try {
    const staleDays = typeof req.query.staleDays === 'string' ? Number(req.query.staleDays) : undefined;
    res.json(await itemsService.configHealth({ staleDays: Number.isFinite(staleDays) ? staleDays : undefined }));
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/:id/usage-history', async (req, res, next) => {
  try {
    res.json(await itemsService.usageHistory(String(req.params.id), {
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined,
      weeks: typeof req.query.weeks === 'string' ? Number(req.query.weeks) : 12
    }));
  } catch (error) {
    next(error);
  }
});

itemsRouter.post('/categories', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await itemsService.createCategory(req.body));
  } catch (error) {
    next(error);
  }
});

itemsRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.updateCategory(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

itemsRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await itemsService.createItem(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

itemsRouter.patch('/:id/venue-stock', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.upsertVenueStock(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

itemsRouter.delete('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.deleteItems(req.body));
  } catch (error) {
    next(error);
  }
});

itemsRouter.post('/bulk', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.bulkUpdate(req.body));
  } catch (error) {
    next(error);
  }
});

itemsRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.updateItem(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
