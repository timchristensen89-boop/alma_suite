import { Router } from 'express';
import { temperatureService } from '../services/temperature.service.js';

export const temperaturesRouter = Router();

temperaturesRouter.get('/assets', async (_req, res, next) => {
  try {
    res.json(await temperatureService.listAssets());
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/assets', async (req, res, next) => {
  try {
    res.status(201).json(await temperatureService.createAsset(req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.get('/assets/:id', async (req, res, next) => {
  try {
    res.json(await temperatureService.getAssetById(req.params.id));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/assets/:id/logs', async (req, res, next) => {
  try {
    res.status(201).json(await temperatureService.addLog(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.get('/logs', async (_req, res, next) => {
  try {
    res.json(await temperatureService.listLogs());
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.get('/integrations', async (_req, res, next) => {
  try {
    res.json(await temperatureService.listIntegrations());
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.get('/sensors', async (_req, res, next) => {
  try {
    res.json(await temperatureService.listSensors());
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/integrations/govee/connect', async (req, res, next) => {
  try {
    res.json(await temperatureService.connectGoveeIntegration(req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/integrations/govee/discover', async (req, res, next) => {
  try {
    res.json(await temperatureService.discoverGoveeSensors(req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.patch('/sensors/:id', async (req, res, next) => {
  try {
    res.json(await temperatureService.mapSensor(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/integrations/webhook', async (req, res, next) => {
  try {
    res.status(201).json(await temperatureService.ingestExternalReading(req.body));
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.get('/meta', async (_req, res, next) => {
  try {
    res.json(await temperatureService.summary());
  } catch (error) {
    next(error);
  }
});

temperaturesRouter.post('/sync/govee', async (req, res, next) => {
  try {
    res.json(await temperatureService.syncGovee(typeof req.body?.assetId === 'string' ? req.body.assetId : undefined));
  } catch (error) {
    next(error);
  }
});
