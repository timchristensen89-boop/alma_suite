import { Router } from 'express';
import { requireSettingsAdmin } from '../lib/auth-middleware.js';
import { HttpError } from '../lib/http.js';
import { shiftTaskService } from '../services/shift-task.service.js';

export const shiftTaskRulesRouter = Router();

shiftTaskRulesRouter.get('/', requireSettingsAdmin, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await shiftTaskService.listRules(req.user));
  } catch (error) {
    next(error);
  }
});

shiftTaskRulesRouter.post('/', requireSettingsAdmin, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.status(201).json(await shiftTaskService.createRule(req.body, req.user));
  } catch (error) {
    next(error);
  }
});

shiftTaskRulesRouter.patch('/:id', requireSettingsAdmin, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await shiftTaskService.updateRule(String(req.params.id), req.body, req.user));
  } catch (error) {
    next(error);
  }
});

shiftTaskRulesRouter.post('/preview', requireSettingsAdmin, async (req, res, next) => {
  try {
    if (!req.user) throw new HttpError(401, 'Not authenticated');
    res.json(await shiftTaskService.previewRule(req.body, req.user));
  } catch (error) {
    next(error);
  }
});
