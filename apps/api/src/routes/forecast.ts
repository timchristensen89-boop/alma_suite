import { Router } from 'express';
import { requireManager } from '../lib/auth-middleware.js';
import { forecastService } from '../services/forecast.service.js';

export const forecastRouter = Router();

// Per-venue daily/weekly outlook: covers, sales, wages, COGS.
forecastRouter.get('/outlook', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastService.outlook(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

// Org-wide weekly cash-flow projection.
forecastRouter.get('/cashflow', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastService.cashflow(req.query, req.user!));
  } catch (error) {
    next(error);
  }
});

// Forecast-vs-actual accuracy from stored snapshots.
forecastRouter.get('/accuracy', requireManager, async (_req, res, next) => {
  try {
    res.json(await forecastService.accuracy());
  } catch (error) {
    next(error);
  }
});

forecastRouter.get('/config', requireManager, async (_req, res, next) => {
  try {
    res.json(await forecastService.getConfig());
  } catch (error) {
    next(error);
  }
});

forecastRouter.patch('/config', requireManager, async (req, res, next) => {
  try {
    res.json(await forecastService.updateConfig(req.body ?? {}));
  } catch (error) {
    next(error);
  }
});

// Walk-forward backtest: how the model would have scored over recent weeks.
forecastRouter.get('/backtest', requireManager, async (_req, res, next) => {
  try {
    res.json(await forecastService.backtest());
  } catch (error) {
    next(error);
  }
});
