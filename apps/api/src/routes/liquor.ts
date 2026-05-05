import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { liquorService } from '../services/liquor.service.js';

export const liquorRouter = Router();

liquorRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await liquorService.list());
  } catch (error) {
    next(error);
  }
});

liquorRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await liquorService.summary());
  } catch (error) {
    next(error);
  }
});

liquorRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await liquorService.get(req.params.id));
  } catch (error) {
    next(error);
  }
});

liquorRouter.post('/', requireManager, async (req, res, next) => {
  try {
    const licence = await liquorService.create(req.body);
    res.status(201).json(licence);
  } catch (error) {
    next(error);
  }
});

liquorRouter.patch('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await liquorService.update(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

liquorRouter.delete('/:id', requireManager, async (req, res, next) => {
  try {
    await liquorService.remove(String(req.params.id));
    res.json({ id: String(req.params.id) });
  } catch (error) {
    next(error);
  }
});
