import { Router, type Request } from 'express';
import { requireAdmin, requireManager } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { staffService } from '../services/staff.service.js';

export const staffRouter = Router();

function canManageSettingsAccess(req: Request) {
  const user = req.user;
  if (!user) return false;
  if (user.isAdmin || user.role === 'ADMIN') return true;
  const settingsAccess = user.appAccess.find((access) => access.appId === 'SETTINGS' && access.status === 'ENABLED');
  return Boolean(settingsAccess?.role === 'ADMIN' || settingsAccess?.permissions?.admin);
}

function grantsSettingsAccess(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const apps = (input as { apps?: unknown }).apps;
  if (!Array.isArray(apps)) return false;

  return apps.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const app = entry as { appId?: unknown; status?: unknown; role?: unknown; permissions?: unknown };
    if (app.appId !== 'SETTINGS') return false;
    const permissions =
      app.permissions && typeof app.permissions === 'object' && !Array.isArray(app.permissions)
        ? (app.permissions as Record<string, unknown>)
        : {};
    return (
      app.status !== 'DISABLED' ||
      String(app.role ?? '').toUpperCase() === 'ADMIN' ||
      Object.values(permissions).some(Boolean)
    );
  });
}

function grantsAdminAppAccess(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const apps = (input as { apps?: unknown }).apps;
  if (!Array.isArray(apps)) return false;

  return apps.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const app = entry as { role?: unknown; permissions?: unknown };
    const permissions =
      app.permissions && typeof app.permissions === 'object' && !Array.isArray(app.permissions)
        ? (app.permissions as Record<string, unknown>)
        : {};
    return String(app.role ?? '').toUpperCase() === 'ADMIN' || Boolean(permissions.admin);
  });
}

function canGrantAdminAppAccess(req: Request) {
  const user = req.user;
  return Boolean(user?.isAdmin || user?.role === 'ADMIN');
}

function redactManagerOnlyPay<T extends { payProfile?: unknown }>(profile: T): T & { payProfile: null } {
  return { ...profile, payProfile: null };
}

staffRouter.get('/', async (_req, res, next) => {
  try {
    if (_req.user?.role === 'STAFF') {
      res.json([redactManagerOnlyPay(await staffService.getById(_req.user.id))]);
      return;
    }
    res.json(await staffService.list(_req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.create(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/meta', async (_req, res, next) => {
  try {
    res.json(await staffService.summary(_req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/award-rates', requireManager, async (_req, res, next) => {
  try {
    res.json(await staffService.listAwardRates());
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/profiles', async (_req, res, next) => {
  try {
    if (_req.user?.role === 'STAFF') {
      res.json([redactManagerOnlyPay(await staffService.getById(_req.user.id))]);
      return;
    }
    res.json(await staffService.list(_req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/profiles', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.create(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/merge', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await staffService.mergeDuplicateStaff(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

// Invite endpoints — declared BEFORE /:id so /invites isn't read as an id
staffRouter.get('/invites', async (_req, res, next) => {
  try {
    res.json(await staffService.listInvites());
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/invites', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.createInvite(req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/invites/reonboard', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.reonboardStaff(req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/invites/:id/resend', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.resendInvite(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/profiles/:id/reonboard', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.reonboardProfile(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

// Public onboarding endpoints (no auth), exposed by token only.
staffRouter.get('/invites/by-token/:token', async (req, res, next) => {
  try {
    const { invite, profile, onboardingSettings } = await staffService.getInviteOnboardingContext(String(req.params.token));
    // Strip internal fields before sending
    res.json({
      token: invite.token,
      email: invite.email,
      note: invite.note,
      firstName: profile?.firstName ?? '',
      lastName: profile?.lastName ?? '',
      roleTitle: profile?.roleTitle ?? '',
      venue: profile?.venue ?? '',
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      onboardingSettings
    });
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/invites/by-token/:token/complete', async (req, res, next) => {
  try {
    res.status(201).json(await staffService.completeInvite(String(req.params.token), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/roster', async (req, res, next) => {
  try {
    const start = typeof req.query.start === 'string' ? req.query.start : undefined;
    const end = typeof req.query.end === 'string' ? req.query.end : undefined;
    const staffProfileId = req.user?.role === 'STAFF' ? req.user.id : undefined;
    res.json(await staffService.listRoster(start, end, staffProfileId));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/roster', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.createRosterShift(req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.patch('/roster/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.updateRosterShift(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.delete('/roster/:id', requireManager, async (req, res, next) => {
  try {
    await staffService.deleteRosterShift(String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/roster/publish', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.publishRoster(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/roster/forecast-snapshots', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.listRosterForecastSnapshots({
      start: typeof req.query.start === 'string' ? req.query.start : undefined,
      end: typeof req.query.end === 'string' ? req.query.end : undefined,
      venue: typeof req.query.venue === 'string' ? req.query.venue : undefined
    }));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/manager-dashboard', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.getManagerDashboard({
      date: typeof req.query.date === 'string' ? req.query.date : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/timesheets', async (req, res, next) => {
  try {
    const start = typeof req.query.start === 'string' ? req.query.start : undefined;
    const end = typeof req.query.end === 'string' ? req.query.end : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const venue = typeof req.query.venue === 'string' ? req.query.venue : undefined;
    const staffProfileId = req.user?.role === 'STAFF' ? req.user.id : undefined;
    res.json(await staffService.listTimesheets(start, end, status, venue, staffProfileId));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/timesheets', async (req, res, next) => {
  try {
    if (req.user?.role === 'STAFF' && req.body?.staffProfileId !== req.user.id) {
      req.body = { ...req.body, staffProfileId: req.user.id };
    }
    res.status(201).json(await staffService.createTimesheet(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

staffRouter.patch('/timesheets/:id', async (req, res, next) => {
  try {
    res.json(await staffService.updateTimesheet(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/timesheets/:id/approve', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.approveTimesheet(String(req.params.id), String(req.user?.id)));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/timesheets/:id/reject', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.rejectTimesheet(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/timesheets/:id/cash-paid', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.markTimesheetCashPaid(String(req.params.id), String(req.user?.id), req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/timesheets/export/xero', requireManager, async (req, res, next) => {
  try {
    const result = await staffService.exportTimesheetsForXero(req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/tips/me', async (req, res, next) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }
    res.json(await staffService.listMyTips(req.user.id));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/tips', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.getTipsSummary({
      start: typeof req.query.start === 'string' ? req.query.start : '',
      end: typeof req.query.end === 'string' ? req.query.end : '',
      venue: typeof req.query.venue === 'string' ? req.query.venue : ''
    }));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/tips/cash-entry', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.saveTipsCashEntry(req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/tips/card-import', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.importTipsCardEntries(req.body));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/tips/export/csv', requireManager, async (req, res, next) => {
  try {
    const csv = await staffService.exportTipsCsv(req.body);
    res.json({ csv });
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/tips/mark-paid', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.markTipsPaid(req.body, req.user?.id));
  } catch (error) {
    next(error);
  }
});

staffRouter.delete('/profiles/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.delete(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.put('/:id/app-access', requireManager, async (req, res, next) => {
  try {
    if (grantsAdminAppAccess(req.body) && !canGrantAdminAppAccess(req)) {
      throw new HttpError(403, 'Admin access is required to grant app admin access.');
    }
    if (grantsSettingsAccess(req.body) && !canManageSettingsAccess(req)) {
      throw new HttpError(403, 'Settings access required to change Admin access.');
    }
    res.json(await staffService.updateAppAccess(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.put('/:id/pay-profile', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await staffService.updatePayProfile(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/:id/management-events', requireAdmin, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await staffService.listManagementEvents(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/:id/manager-notes', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await staffService.listManagerNotes(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/:id/password-reset', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await staffService.requestPasswordReset(String(req.params.id), req.body, req.user, {
      requestOrigin: req.header('origin'),
      requestIp: req.ip,
      userAgent: req.header('user-agent')
    }));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/:id/manager-notes', requireManager, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.status(201).json(await staffService.addManagerNote(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/:id/records', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await staffService.addRecord(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/:id/records/:recordId/approve', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.approveRecord(String(req.params.id), String(req.params.recordId), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.delete('/:id/records/:recordId', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.deleteRecord(String(req.params.id), String(req.params.recordId), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.post('/:id/onboarding/approve', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.approveOnboarding(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.get('/:id', async (req, res, next) => {
  try {
    if (req.user?.role === 'STAFF') {
      if (String(req.params.id) !== req.user.id) {
        throw new HttpError(403, 'Staff profiles are limited to your own account.');
      }
      res.json(redactManagerOnlyPay(await staffService.getById(String(req.params.id))));
      return;
    }
    res.json(await staffService.getById(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.patch('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.update(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

staffRouter.delete('/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await staffService.delete(String(req.params.id), req.user));
  } catch (error) {
    next(error);
  }
});
