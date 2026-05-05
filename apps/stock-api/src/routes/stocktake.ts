import { Router } from 'express';
import { stocktakesService } from '../services/stocktakes.service.js';

export const stocktakeRouter = Router();

stocktakeRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await stocktakesService.list());
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await stocktakesService.summary());
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/:id/apply', async (req, res, next) => {
  try {
    res.json(await stocktakesService.applyStocktake(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await stocktakesService.createStocktake(req.body));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.delete('/', async (req, res, next) => {
  try {
    res.json(await stocktakesService.deleteStocktakes(req.body));
  } catch (error) {
    next(error);
  }
});

stocktakeRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await stocktakesService.updateStocktake(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
