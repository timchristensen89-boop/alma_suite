import { Router } from 'express';
import { incidentService } from '../services/incident.service.js';

export const incidentsRouter = Router();

incidentsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await incidentService.list());
  } catch (error) {
    next(error);
  }
});

incidentsRouter.post('/', async (req, res, next) => {
  try {
    res.status(201).json(await incidentService.create(req.body));
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/meta', async (_req, res, next) => {
  try {
    res.json(await incidentService.summary());
  } catch (error) {
    next(error);
  }
});

incidentsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await incidentService.getById(req.params.id));
  } catch (error) {
    next(error);
  }
});

incidentsRouter.patch('/:id', async (req, res, next) => {
  try {
    res.json(await incidentService.update(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});
