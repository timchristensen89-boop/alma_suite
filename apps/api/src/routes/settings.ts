import { Router } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { settingsService } from '../services/settings.service.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await settingsService.get());
  } catch (error) {
    next(error);
  }
});

settingsRouter.patch('/', requireAdmin, async (req, res, next) => {
  try {
    res.json(await settingsService.update(req.body));
  } catch (error) {
    next(error);
  }
});
