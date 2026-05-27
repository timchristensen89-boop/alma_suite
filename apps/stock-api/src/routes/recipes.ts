import { Router } from 'express';
import { requireStockManager } from '../lib/stock-permissions.js';
import { recipesService } from '../services/recipes.service.js';

export const recipesRouter = Router();

recipesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await recipesService.list());
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await recipesService.summary());
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/categories', async (_req, res, next) => {
  try {
    res.json(await recipesService.listCategories());
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/ingredient-options', async (_req, res, next) => {
  try {
    res.json(await recipesService.ingredientOptions());
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/categories', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await recipesService.createCategory(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.updateCategory(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/:id/cost', async (req, res, next) => {
  try {
    res.json(await recipesService.cost(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

// Rule 1: cost-sanity check. Returns warnings if a recipe's estimated
// cost looks "stupidly expensive" (likely a unit / conversion mistake).
// The recipe detail UI surfaces this above the line list.
recipesRouter.get('/:id/sanity', async (req, res, next) => {
  try {
    const { recipeCostSanity } = await import('../services/stock-rules.service.js');
    res.json(await recipeCostSanity(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await recipesService.get(String(req.params.id)));
  } catch (error) {
    next(error);
  }
});

recipesRouter.post('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.status(201).json(await recipesService.createRecipe(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.delete('/', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.deleteRecipes(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/:id', async (req, res, next) => {
  try {
    requireStockManager(req.user);
    res.json(await recipesService.updateRecipe(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
