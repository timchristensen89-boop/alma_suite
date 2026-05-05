import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { websiteMenuService } from '../services/website-menu.service.js';

export const websiteRouter = Router();

websiteRouter.post('/menu/validate', requireManager, async (req, res, next) => {
  try {
    res.json(websiteMenuService.validate({ ...req.body, dryRun: true }));
  } catch (error) {
    next(error);
  }
});

websiteRouter.post('/menu/publish', requireManager, async (req, res, next) => {
  try {
    res.json(await websiteMenuService.publish(req.body, req.user));
  } catch (error) {
    next(error);
  }
});
