import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { stockOperationsService } from '../services/stock-operations.service.js';

export const operationsRouter = Router();

operationsRouter.get('/wastage', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.listWastage(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/wastage', async (req, res, next) => {
  try {
    res.status(201).json(await stockOperationsService.createWastage(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/staff-usage', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.listStaffUsage(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/staff-usage', async (req, res, next) => {
  try {
    res.status(201).json(await stockOperationsService.createStaffUsage(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/deliveries', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.listDeliveries(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/deliveries', async (req, res, next) => {
  try {
    res.status(201).json(await stockOperationsService.createDelivery(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.patch('/deliveries/:id', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.updateDelivery(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/deliveries/:id/complete', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.completeDelivery(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

// Attach (or clear) a photo on a delivery line — used after the browser has
// uploaded directly to Cloud Storage via /api/uploads/sign.
operationsRouter.patch('/deliveries/lines/:lineId/photo', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const photoUrl = typeof body.photoUrl === 'string' && body.photoUrl ? body.photoUrl : null;
    res.json(await stockOperationsService.updateDeliveryLinePhoto(String(req.params.lineId), photoUrl, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/reorder-notices', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.listReorderNotices(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

operationsRouter.get('/menu-par-recommendations', async (req, res, next) => {
  try {
    res.json(await stockOperationsService.getMenuParRecommendations(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/supplier-order-email', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stockOperationsService.sendSupplierOrderEmail(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

operationsRouter.post('/reorder-notices/:id/resolve', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await stockOperationsService.resolveReorderNotice(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});
