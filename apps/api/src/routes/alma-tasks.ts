// Phase 5.9: AlmaTask routes
//
// All routes need a signed-in user (auth middleware enforces it
// globally; this file is not in PUBLIC_PATHS). RBAC is venue-scoped
// inside the service layer — admins see everything, non-admins see
// their venue + suite-wide tasks.

import { Router } from 'express';
import { almaTaskService } from '../services/alma-tasks.service.js';
import { taskSyncService } from '../services/task-sync.service.js';
import { HttpError } from '../lib/http.js';

export const almaTasksRouter = Router();

function requireUser(req: Parameters<Parameters<typeof almaTasksRouter.get>[1]>[0]) {
  if (!req.user) throw new HttpError(401, 'Not authenticated.');
  return req.user;
}

// Reconcile derived tasks (critical/overdue issues, pending leave, …)
// before reading. Throttled in the service so frequent polls don't
// re-scan, and never blocks the read if a reconciler fails.
async function syncBeforeRead() {
  await taskSyncService.reconcile().catch((error) => {
    console.error('[tasks] pre-read reconcile failed:', error);
  });
}

// POST /api/tasks/sync — force an immediate reconcile (e.g. after an
// action that should surface a task right away).
almaTasksRouter.post('/sync', async (_req, res, next) => {
  try {
    res.json(await taskSyncService.reconcile(true));
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/summary  — chrome counts for Home + iPad TopBar
// Listed before /:id so the path is not swallowed by the id route.
almaTasksRouter.get('/summary', async (req, res, next) => {
  try {
    const user = requireUser(req);
    await syncBeforeRead();
    res.json(await almaTaskService.summary(user));
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks  — filtered list (defaults to all visible)
// Query: venue, status, priority, sourceApp, ownerStaffProfileId,
//        outstanding=true (shortcut for OPEN | IN_PROGRESS | BLOCKED).
almaTasksRouter.get('/', async (req, res, next) => {
  try {
    const user = requireUser(req);
    await syncBeforeRead();
    const result = await almaTaskService.list(req.query, user);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks  — create a task from the API. Other services
// should call createTaskFromSource() directly instead of round-tripping
// through this endpoint.
almaTasksRouter.post('/', async (req, res, next) => {
  try {
    const task = await almaTaskService.create(req.body, requireUser(req));
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id
almaTasksRouter.get('/:id', async (req, res, next) => {
  try {
    const task = await almaTaskService.get(String(req.params.id), requireUser(req));
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/tasks/:id  — update title/desc/owner/dueAt/priority OR
// flip status between OPEN/IN_PROGRESS/BLOCKED. Use the dedicated
// /:id/complete and /:id/dismiss for terminal states.
almaTasksRouter.patch('/:id', async (req, res, next) => {
  try {
    const task = await almaTaskService.update(String(req.params.id), req.body, requireUser(req));
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/complete  — flip to DONE, stamp completedBy
almaTasksRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const task = await almaTaskService.complete(String(req.params.id), requireUser(req));
    res.json(task);
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/dismiss  — flip to DISMISSED, stamp dismissedBy
almaTasksRouter.post('/:id/dismiss', async (req, res, next) => {
  try {
    const task = await almaTaskService.dismiss(String(req.params.id), requireUser(req));
    res.json(task);
  } catch (err) {
    next(err);
  }
});
