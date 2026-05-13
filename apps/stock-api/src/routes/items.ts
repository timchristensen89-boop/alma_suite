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

itemsRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await itemsService.updateItem(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
