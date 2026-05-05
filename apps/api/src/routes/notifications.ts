import { Router } from 'express';
import { notificationsService } from '../services/notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await notificationsService.list());
  } catch (error) {
    next(error);
  }
});
