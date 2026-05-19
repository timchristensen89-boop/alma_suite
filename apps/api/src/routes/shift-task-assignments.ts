import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { shiftTaskService } from '../services/shift-task.service.js';

export const shiftTaskAssignmentsRouter = Router();

shiftTaskAssignmentsRouter.post('/:id/start-checklist', async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.status(201).json(await shiftTaskService.startAssignedChecklist(req.params.id, req.user));
  } catch (error) {
    next(error);
  }
});
