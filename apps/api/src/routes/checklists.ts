import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { checklistService } from '../services/checklist.service.js';
import { shiftTaskService } from '../services/shift-task.service.js';

export const checklistsRouter = Router();

checklistsRouter.get('/templates', async (_req, res, next) => {
  try {
    res.json(await checklistService.listTemplates());
  } catch (error) {
    next(error);
  }
});

checklistsRouter.post('/templates', async (req, res, next) => {
  try {
    res.status(201).json(await checklistService.createTemplate(req.body));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.get('/templates/:id', async (req, res, next) => {
  try {
    res.json(await checklistService.getTemplateById(req.params.id));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.put('/templates/:id', async (req, res, next) => {
  try {
    res.json(await checklistService.updateTemplate(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.delete('/templates/:id', async (req, res, next) => {
  try {
    res.json(await checklistService.deleteTemplate(req.params.id));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.get('/runs', async (_req, res, next) => {
  try {
    res.json(await checklistService.listRuns());
  } catch (error) {
    next(error);
  }
});

checklistsRouter.get('/shift-tasks', async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await shiftTaskService.listForVenue(
      req.user,
      typeof req.query.venue === 'string' ? req.query.venue : undefined
    ));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.post('/runs', async (req, res, next) => {
  try {
    const run = await checklistService.createRun(req.body);
    res.status(201).json(run);
  } catch (error) {
    next(error);
  }
});

// Cron-callable: generate today's checklist runs from every template.
// Point Cloud Scheduler at this with a daily morning trigger.
checklistsRouter.post('/auto-schedule', async (_req, res, next) => {
  try {
    res.json(await checklistService.autoScheduleDailyRuns());
  } catch (error) {
    next(error);
  }
});

checklistsRouter.get('/runs/:id', async (req, res, next) => {
  try {
    res.json(await checklistService.getRunById(req.params.id));
  } catch (error) {
    next(error);
  }
});

checklistsRouter.put('/runs/:runId/items/:itemId', async (req, res, next) => {
  try {
    res.json(await checklistService.updateItem(req.params.runId, req.params.itemId, req.body));
  } catch (error) {
    next(error);
  }
});
