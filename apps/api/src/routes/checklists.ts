import { Router } from 'express';
import { checklistService } from '../services/checklist.service.js';

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

checklistsRouter.post('/runs', async (req, res, next) => {
  try {
    const run = await checklistService.createRun(req.body);
    res.status(201).json(run);
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
