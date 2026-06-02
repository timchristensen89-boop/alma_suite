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

// GET /api/notifications/mutes — available categories + the user's muted set
notificationsRouter.get('/mutes', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    res.json(await notificationsService.mutes(req.user));
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications/mutes { category, muted } — toggle a category mute
notificationsRouter.post('/mutes', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    const category = typeof req.body?.category === 'string' ? req.body.category : '';
    const muted = Boolean(req.body?.muted);
    res.json(await notificationsService.setMute(req.user, category, muted));
  } catch (error) {
    next(error);
  }
});

// POST /api/notifications/reads { ids?: string[], all?: boolean } — mark
// notifications read for the current user. Read state is server-side so it
// syncs across every app in the suite.
notificationsRouter.post('/reads', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    if (req.body?.all === true) {
      res.json(await notificationsService.markAllRead(req.user));
      return;
    }
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string')
      : [];
    res.json(await notificationsService.markRead(req.user, ids));
  } catch (error) {
    next(error);
  }
});

// DELETE /api/notifications/reads — clear all read markers (restore to unread)
notificationsRouter.delete('/reads', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    res.json(await notificationsService.clearReads(req.user));
  } catch (error) {
    next(error);
  }
});
