import { Router } from 'express';
import {
  acknowledgeCommsThread,
  addCommsMessage,
  createCommsThread,
  evaluateCommsAlertsDryRun,
  getCommsThread,
  listCommsRecipientOptions,
  listCommsInbox,
  markCommsThreadRead
} from '../services/comms.service.js';
import { requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';

export const commsRouter = Router();

// Require any authenticated user (staff, manager, admin — not device accounts for messaging)
commsRouter.use((req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  next();
});

commsRouter.get('/inbox', async (req, res, next) => {
  try {
    res.json({ threads: await listCommsInbox(req.user!) });
  } catch (error) {
    next(error);
  }
});

commsRouter.get('/recipient-options', async (req, res, next) => {
  try {
    res.json(await listCommsRecipientOptions(req.user!));
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/threads', async (req, res, next) => {
  try {
    res.status(201).json({ thread: await createCommsThread(req.body, req.user!) });
  } catch (error) {
    next(error);
  }
});

commsRouter.get('/threads/:id', async (req, res, next) => {
  try {
    const thread = await getCommsThread(req.params.id, req.user!);
    if (!thread) {
      res.status(404).json({ error: 'Thread not found' });
      return;
    }
    res.json({ thread });
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/threads/:id/messages', async (req, res, next) => {
  try {
    res.status(201).json({ message: await addCommsMessage(req.params.id, req.body, req.user!) });
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/threads/:id/read', async (req, res, next) => {
  try {
    res.json(await markCommsThreadRead(req.params.id, req.user!));
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/threads/:id/acknowledge', async (req, res, next) => {
  try {
    res.json(await acknowledgeCommsThread(req.params.id, req.user!));
  } catch (error) {
    next(error);
  }
});

// Announcements — was returning [] stub; now reads from DB filtered by category
commsRouter.get('/announcements', async (req, res, next) => {
  try {
    res.json({ threads: await listCommsInbox(req.user!, 'ANNOUNCEMENT' as const) });
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/announcements', requireManager, async (req, res, next) => {
  try {
    res.status(201).json({
      thread: await createCommsThread(
        { ...req.body, category: 'ANNOUNCEMENT', priority: req.body.priority ?? 'NORMAL' },
        req.user!
      )
    });
  } catch (error) {
    next(error);
  }
});

// Handover notes — was returning [] stub; now reads from DB filtered by category
commsRouter.get('/handover', async (req, res, next) => {
  try {
    res.json({ threads: await listCommsInbox(req.user!, 'HANDOVER' as const) });
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/handover', requireManager, async (req, res, next) => {
  try {
    res.status(201).json({
      thread: await createCommsThread(
        { ...req.body, category: 'HANDOVER', priority: req.body.priority ?? 'NORMAL' },
        req.user!
      )
    });
  } catch (error) {
    next(error);
  }
});

commsRouter.post('/alerts/evaluate', requireManager, async (_req, res, next) => {
  try {
    res.json(await evaluateCommsAlertsDryRun());
  } catch (error) {
    next(error);
  }
});
