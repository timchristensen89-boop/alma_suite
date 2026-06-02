import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { issueService } from '../services/issue.service.js';

export const issuesRouter = Router();

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
    const issue = await issueService.escalate(String(req.params.id), req.user);
    res.json(issue);
  } catch (error) {
    next(error);
  }
});
