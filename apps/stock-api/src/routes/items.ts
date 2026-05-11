import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { itemsService } from '../services/items.service.js';

export const itemsRouter = Router();

itemsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await itemsService.list());
  } catch (error) {
    next(error);
  }
});

itemsRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await itemsService.summary());
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
    res.status(201).json(await itemsService.createItem(req.body));
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
    res.json(await itemsService.updateItem(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
