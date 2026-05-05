import { Router } from 'express';
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

recipesRouter.post('/categories', async (req, res, next) => {
  try {
    res.status(201).json(await recipesService.createCategory(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/categories/:id', async (req, res, next) => {
  try {
    res.json(await recipesService.updateCategory(String(req.params.id), req.body));
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
    res.status(201).json(await recipesService.createRecipe(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.delete('/', async (req, res, next) => {
  try {
    res.json(await recipesService.deleteRecipes(req.body));
  } catch (error) {
    next(error);
  }
});

recipesRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await recipesService.updateRecipe(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
