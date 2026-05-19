import { Router } from 'express';
import {
  acknowledgeCommsThread,
  addCommsMessage,
  createCommsThread,
  evaluateCommsAlertsDryRun,
  getCommsThread,
  listCommsInbox,
  markCommsThreadRead
} from '../services/comms.service.js';
import { requireManager } from '../lib/auth-middleware.js';

export const commsRouter = Router();

commsRouter.use(requireManager);

function handleError(res: any, error: unknown) {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number((error as any).statusCode) : 400;
  const message = error instanceof Error ? error.message : 'Request failed';
  res.status(statusCode || 400).json({ error: message });
}

commsRouter.get('/inbox', async (req, res) => {
  try {
    res.json({ threads: await listCommsInbox(req.user) });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.post('/threads', async (req, res) => {
  try {
    res.status(201).json({ thread: await createCommsThread(req.body, req.user) });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.get('/threads/:id', async (req, res) => {
  try {
    const thread = await getCommsThread(req.params.id, req.user);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({ thread });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.post('/threads/:id/messages', async (req, res) => {
  try {
    res.status(201).json({ message: await addCommsMessage(req.params.id, req.body, req.user) });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.post('/threads/:id/read', async (req, res) => {
  try {
    res.json(await markCommsThreadRead(req.params.id, req.user));
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.post('/threads/:id/acknowledge', async (req, res) => {
  try {
    res.json(await acknowledgeCommsThread(req.params.id, req.user));
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.get('/announcements', async (_req, res) => {
  res.json({ threads: [] });
});

commsRouter.post('/announcements', async (req, res) => {
  try {
    res.status(201).json({
      thread: await createCommsThread(
        {
          ...req.body,
          category: 'ANNOUNCEMENT',
          priority: req.body.priority ?? 'NORMAL'
        },
        req.user
      )
    });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.get('/handover', async (_req, res) => {
  res.json({ threads: [] });
});

commsRouter.post('/handover', async (req, res) => {
  try {
    res.status(201).json({
      thread: await createCommsThread(
        {
          ...req.body,
          category: 'HANDOVER',
          priority: req.body.priority ?? 'NORMAL'
        },
        req.user
      )
    });
  } catch (error) {
    handleError(res, error);
  }
});

commsRouter.post('/alerts/evaluate', async (_req, res) => {
  try {
    res.json(await evaluateCommsAlertsDryRun());
  } catch (error) {
    handleError(res, error);
  }
});
