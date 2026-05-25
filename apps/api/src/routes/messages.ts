/**
 * /api/messages — legacy route kept for backwards compatibility with the
 * staff-web CommunicationsPage. New code should use /api/comms instead.
 * Both routes use the same messaging.service.ts functions.
 */
import { Router } from 'express';
import {
  acknowledgeThread,
  addMessage,
  createThread,
  getThreadForUser,
  listInboxForUser,
  listRecipientOptions,
  markThreadRead
} from '../services/messaging.service.js';
import { HttpError } from '../lib/http.js';

export const messagesRouter = Router();

messagesRouter.use((req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  next();
});

messagesRouter.get('/inbox', async (req, res, next) => {
  try {
    res.json({ threads: await listInboxForUser(req.user!) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.get('/recipient-options', async (req, res, next) => {
  try {
    res.json(await listRecipientOptions(req.user!));
  } catch (error) {
    next(error);
  }
});

messagesRouter.post('/threads', async (req, res, next) => {
  try {
    res.status(201).json({ thread: await createThread(req.user!, req.body) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.get('/threads/:id', async (req, res, next) => {
  try {
    const thread = await getThreadForUser(req.params.id, req.user!);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({ thread });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post('/threads/:id/messages', async (req, res, next) => {
  try {
    res.status(201).json({ message: await addMessage(req.user!, req.params.id, req.body) });
  } catch (error) {
    next(error);
  }
});

messagesRouter.post('/threads/:id/read', async (req, res, next) => {
  try {
    res.json(await markThreadRead(req.user!, req.params.id));
  } catch (error) {
    next(error);
  }
});

messagesRouter.post('/threads/:id/acknowledge', async (req, res, next) => {
  try {
    res.json(await acknowledgeThread(req.user!, req.params.id));
  } catch (error) {
    next(error);
  }
});
