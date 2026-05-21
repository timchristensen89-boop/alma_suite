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

export const messagesRouter = Router();

function handleError(res: import('express').Response, error: unknown) {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as any).statusCode) : 400;
  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(statusCode || 400).json({ error: message });
}

messagesRouter.use((req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
});

messagesRouter.get('/inbox', async (req, res) => {
  try {
    res.json({ threads: await listInboxForUser(req.user!) });
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.get('/recipient-options', async (req, res) => {
  try {
    res.json(await listRecipientOptions(req.user!));
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.post('/threads', async (req, res) => {
  try {
    res.status(201).json({ thread: await createThread(req.user!, req.body) });
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.get('/threads/:id', async (req, res) => {
  try {
    const thread = await getThreadForUser(req.params.id, req.user!);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({ thread });
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.post('/threads/:id/messages', async (req, res) => {
  try {
    res.status(201).json({ message: await addMessage(req.user!, req.params.id, req.body) });
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.post('/threads/:id/read', async (req, res) => {
  try {
    res.json(await markThreadRead(req.user!, req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});

messagesRouter.post('/threads/:id/acknowledge', async (req, res) => {
  try {
    res.json(await acknowledgeThread(req.user!, req.params.id));
  } catch (error) {
    handleError(res, error);
  }
});
