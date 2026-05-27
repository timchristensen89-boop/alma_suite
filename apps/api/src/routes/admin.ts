import { Router } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { adminService } from '../services/admin.service.js';
import { deviceService } from '../services/device.service.js';
import { exportsService } from '../services/exports.service.js';
import { loadedReplacementService } from '../services/loaded-replacement.service.js';

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

// Compose and send the Monday weekly summary email. Runnable manually from
// the admin UI; Cloud Scheduler can hit this endpoint every Monday 7am.
adminRouter.post('/weekly-summary/send', async (req, res, next) => {
  try {
    const previewOnly = req.query.preview === '1' || req.query.preview === 'true';
    res.json(await adminService.sendWeeklySummary({ previewOnly }));
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

// Phase 4.5 — Scheduled exports. CSV download endpoints, Admin-only.
// Drive scheduling will plug on top of these once OAuth is wired.
adminRouter.get('/exports', async (_req, res, next) => {
  try {
    res.json({ exports: await exportsService.listAvailable() });
  } catch (error) {
    next(error);
  }
});

adminRouter.get('/exports/:kind', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const { filename, csv } = await exportsService.generate(
      req.params.kind as 'sales-by-day' | 'wages-by-week' | 'timesheets' | 'stocktake-variance' | 'low-stock',
      {
        start: typeof req.query.start === 'string' ? req.query.start : undefined,
        end: typeof req.query.end === 'string' ? req.query.end : undefined,
        venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
      },
      req.user
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// Loaded replacement tracking — admin-only readiness dashboard. The
// data shape is owned by loaded-replacement.service.ts.
adminRouter.get('/loaded-replacement', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    res.json(await loadedReplacementService.getOverview(req.user));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/loaded-replacement/check/:id', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const status = typeof req.body?.status === 'string' ? req.body.status : '';
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : undefined;
    res.json(await loadedReplacementService.updateCheck(req.user, String(req.params.id), {
      status: status as 'not_started' | 'needs_work' | 'ready' | 'verified',
      notes
    }));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/loaded-replacement/notes/:category', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : '';
    res.json(await loadedReplacementService.updateCategoryNotes(
      req.user,
      String(req.params.category) as 'reports' | 'stocktake' | 'historical_data' | 'comparison' | 'cutover',
      notes
    ));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/loaded-replacement/comparison', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const body = req.body ?? {};
    res.json(await loadedReplacementService.recordComparison(req.user, {
      label: typeof body.label === 'string' ? body.label : '',
      loaded: body.loaded ?? { stockValueCents: null, salesCents: null, cogsCents: null, categoryTotals: {} },
      alma: body.alma ?? { stockValueCents: null, salesCents: null, cogsCents: null, categoryTotals: {} },
      notes: typeof body.notes === 'string' ? body.notes : undefined
    }));
  } catch (error) {
    next(error);
  }
});

adminRouter.post('/loaded-replacement/comparison/:id/explained', async (req, res, next) => {
  try {
    if (!req.user) throw new Error('Not authenticated');
    const explained = Boolean(req.body?.explained);
    res.json(await loadedReplacementService.markComparisonExplained(req.user, String(req.params.id), explained));
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
