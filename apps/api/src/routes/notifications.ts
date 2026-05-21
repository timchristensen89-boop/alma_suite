import { Router } from 'express';
import { notificationsService } from '../services/notifications.service.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    res.json(await notificationsService.list(req.user));
  } catch (error) {
    next(error);
  }
});
