import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { purchaseOrdersService } from '../services/purchase-orders.service.js';

export const purchaseOrdersRouter = Router();

purchaseOrdersRouter.get('/', async (req, res, next) => {
  try {
    res.json(await purchaseOrdersService.list(req.user, typeof req.query.venue === 'string' ? req.query.venue : null));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.get('/price-list', async (req, res, next) => {
  try {
    res.json(await purchaseOrdersService.listPriceList(req.user, typeof req.query.supplierId === 'string' ? req.query.supplierId : null));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/price-list', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await purchaseOrdersService.upsertPriceListItem(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.delete('/price-list/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.deletePriceListItem(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await purchaseOrdersService.get(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await purchaseOrdersService.create(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.update(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/:id/send', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.setStatus(String(req.params.id), 'SENT', req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.setStatus(String(req.params.id), 'CANCELLED', req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/:id/receive', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.receive(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

purchaseOrdersRouter.post('/:id/match', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await purchaseOrdersService.match(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});
