import { Router } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { adminService } from '../services/admin.service.js';
import { deviceService } from '../services/device.service.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/overview', async (_req, res, next) => {
  try {
    res.json(await adminService.overview());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/access/users', async (_req, res, next) => {
  try {
    res.json(await adminService.accessUsers());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/staff/costing-report', async (req, res, next) => {
  try {
    res.json(await adminService.staffCostingReport(req.query));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/access/users', async (req, res, next) => {
  try {
    res.status(201).json(await adminService.createAccessUser(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/access/bulk-update', async (req, res, next) => {
  try {
    res.json(await adminService.bulkUpdateAccess(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/venue-devices', async (_req, res, next) => {
  try {
    res.json(await deviceService.listVenueDevices());
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/venue-devices', async (req, res, next) => {
  try {
    res.status(201).json(await deviceService.createVenueDevice(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch('/venue-devices/:id', async (req, res, next) => {
  try {
    res.json(await deviceService.updateVenueDevice(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/integrations/status', async (_req, res, next) => {
  try {
    res.json(await adminService.integrationsStatus());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/system-health', async (_req, res, next) => {
  try {
    res.json(await adminService.systemHealth());
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/audit-events', async (req, res, next) => {
  try {
    const eventType = typeof req.query.eventType === 'string' && req.query.eventType.trim()
      ? req.query.eventType.trim()
      : undefined;
    res.json(await adminService.auditEvents(eventType));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/meta-review-demo/human-agent-reply', async (req, res, next) => {
  try {
    const reply = typeof req.body?.reply === 'string' ? req.body.reply.trim() : '';
    if (reply.length < 10) {
      res.status(400).json({ message: 'Type a one to one customer support reply before sending the demo.' });
      return;
    }

    res.json({
      mode: 'DEMO',
      delivered: false,
      tag: 'human_agent',
      channel: 'Meta Messenger / Instagram Messaging',
      message:
        'Demo sent. In production this would call Meta Messenger API with the human_agent tag for a one to one customer support reply.',
      guardrails: [
        'Human Agent only',
        'Support only',
        'One to one reply',
        'Within 7 days',
        'No marketing',
        'No bulk messaging'
      ],
      simulatedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});
