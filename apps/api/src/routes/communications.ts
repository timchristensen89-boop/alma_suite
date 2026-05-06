import { Router } from 'express';
import { almaAppIdSchema } from '@alma/shared';
import { requireManager } from '../lib/auth-middleware.js';
import { communicationsService } from '../services/communications.service.js';

export const communicationsRouter = Router();

function appIdFromQuery(value: unknown) {
  const parsed = almaAppIdSchema.safeParse(String(value ?? '').toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

communicationsRouter.get('/', async (req, res, next) => {
  try {
    res.json(await communicationsService.list({
      appId: String(req.query.appId ?? ''),
      venue: String(req.query.venue ?? ''),
      channel: String(req.query.channel ?? ''),
      channelId: String(req.query.channelId ?? ''),
      recipientId: String(req.query.recipientId ?? '')
    }, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.get('/admin', requireManager, async (req, res, next) => {
  try {
    res.json(await communicationsService.adminList(req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.get('/channels', async (req, res, next) => {
  try {
    res.json(await communicationsService.listChannels({
      appId: appIdFromQuery(req.query.appId),
      venue: String(req.query.venue ?? ''),
      includeInactive: req.query.includeInactive === 'true'
    }, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.post('/channels', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await communicationsService.createChannel(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.patch('/channels/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await communicationsService.updateChannel(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.delete('/channels/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await communicationsService.removeChannel(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.post('/announcements', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await communicationsService.createAnnouncement(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.patch('/announcements/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await communicationsService.updateAnnouncement(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.delete('/announcements/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await communicationsService.removeAnnouncement(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.post('/chat', async (req, res, next) => {
  try {
    res.status(201).json(await communicationsService.createChatMessage(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.patch('/chat/:id', async (req, res, next) => {
  try {
    res.json(await communicationsService.updateChatMessage(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

communicationsRouter.delete('/chat/:id', async (req, res, next) => {
  try {
    res.json(await communicationsService.removeChatMessage(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});
