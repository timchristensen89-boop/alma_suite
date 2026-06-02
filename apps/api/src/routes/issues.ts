import { Router } from 'express';
import { requireAdmin, requireManager } from '../lib/auth-middleware.js';
import { issueService } from '../services/issue.service.js';

export const issuesRouter = Router();

// Area → assignee rules (auto-assign source). Listed before "/:id" so the path
// is not swallowed by the id route.
issuesRouter.get('/area-rules', requireManager, async (_req, res, next) => {
  try {
    res.json(await issueService.listAreaRules());
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/area-rules', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await issueService.upsertAreaRule(req.body));
  } catch (error) {
    next(error);
  }
});

issuesRouter.delete('/area-rules/:id', requireAdmin, async (req, res, next) => {
  try {
    await issueService.deleteAreaRule(String(req.params.id));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

issuesRouter.get('/', async (req, res, next) => {
  try {
    const issues = await issueService.list({
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined
    });

    res.json(issues);
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/', async (req, res, next) => {
  try {
    const issue = await issueService.create(req.body, req.user);
    res.status(201).json(issue);
  } catch (error) {
    next(error);
  }
});

issuesRouter.get('/meta', async (_req, res) => {
  res.json(await issueService.meta());
});

issuesRouter.get('/assignees', async (_req, res) => {
  res.json(await issueService.assignees());
});

// Configured area names for the issue form dropdown. Available to any
// authenticated user (no manager guard) — exposes names only, not the
// area→assignee mapping that /area-rules returns.
issuesRouter.get('/areas', async (_req, res, next) => {
  try {
    res.json(await issueService.listAreaNames());
  } catch (error) {
    next(error);
  }
});

issuesRouter.get('/:id', async (req, res, next) => {
  try {
    const issue = await issueService.getById(req.params.id);
    res.json(issue);
  } catch (error) {
    next(error);
  }
});

issuesRouter.put('/:id', async (req, res, next) => {
  try {
    const issue = await issueService.update(req.params.id, req.body, req.user);
    res.json(issue);
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/:id/complete', async (req, res, next) => {
  try {
    const issue = await issueService.complete(req.params.id, req.body);
    res.json(issue);
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/:id/activity', async (req, res, next) => {
  try {
    const activity = await issueService.addActivity(req.params.id, req.body);
    res.status(201).json(activity);
  } catch (error) {
    next(error);
  }
});

issuesRouter.post('/:id/escalate', requireManager, async (req, res, next) => {
  try {
    const issue = await issueService.escalate(String(req.params.id), req.user, req.body);
    res.json(issue);
  } catch (error) {
    next(error);
  }
});
