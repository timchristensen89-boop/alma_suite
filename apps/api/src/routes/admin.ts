import { Router } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { adminService } from '../services/admin.service.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/overview', async (_req, res, next) => {
  try {
    res.json(await adminService.overview());
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
