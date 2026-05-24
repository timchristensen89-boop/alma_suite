import { Router } from 'express';
import { requireAdmin, requireManager } from '../lib/auth-middleware.js';
import { integrationService } from '../services/integration.service.js';

export const menuMappingsRouter = Router();

menuMappingsRouter.get('/square', requireManager, async (req, res, next) => {
  try {
    res.json(await integrationService.listSquareMenuMappings(req.query));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.post('/square/sync', requireAdmin, async (req, res, next) => {
  try {
    res.json(await integrationService.syncSquareCatalog(req.user!, req.body?.accountKey ?? req.query.accountKey ?? req.body?.account));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.post('/square/auto-match', requireAdmin, async (req, res, next) => {
  try {
    res.json(await integrationService.autoMatchSquareMenuMappings(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.patch('/square/:id', requireAdmin, async (req, res, next) => {
  try {
    res.json(await integrationService.updateSquareMenuMapping(String(req.params.id), req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.post('/square/:id/ignore', requireAdmin, async (req, res, next) => {
  try {
    res.json(await integrationService.ignoreSquareMenuMapping(String(req.params.id), req.user!));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.post('/square/:id/clear', requireAdmin, async (req, res, next) => {
  try {
    res.json(await integrationService.clearSquareMenuMapping(String(req.params.id), req.user!));
  } catch (error) {
    next(error);
  }
});

menuMappingsRouter.get('/recipe-options', requireManager, async (_req, res, next) => {
  try {
    res.json(await integrationService.squareRecipeOptions());
  } catch (error) {
    next(error);
  }
});
