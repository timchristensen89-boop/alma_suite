import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { trainingService } from '../services/training.service.js';

export const trainingRouter = Router();

trainingRouter.get('/overview', async (_req, res, next) => {
  try {
    res.json(await trainingService.overview());
  } catch (error) {
    next(error);
  }
});

trainingRouter.post('/modules', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await trainingService.createModule(req.body));
  } catch (error) {
    next(error);
  }
});

trainingRouter.patch('/modules/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await trainingService.updateModule(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});

trainingRouter.post('/pay-rules', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await trainingService.upsertPayRule(req.body));
  } catch (error) {
    next(error);
  }
});

trainingRouter.post('/assignments', requireManager, async (req, res, next) => {
  try {
    res.status(201).json(await trainingService.assign(req.body));
  } catch (error) {
    next(error);
  }
});

trainingRouter.patch('/records/:id', requireManager, async (req, res, next) => {
  try {
    res.json(await trainingService.updateRecord(String(req.params.id), req.body));
  } catch (error) {
    next(error);
  }
});
