import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { integrationService } from '../services/integration.service.js';

export const integrationsRouter = Router();

integrationsRouter.get('/:provider/callback', async (req, res, next) => {
  try {
    const redirectUrl = await integrationService.handleCallback(String(req.params.provider), req.query);
    res.redirect(302, redirectUrl);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.use(requireAdmin);

integrationsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await integrationService.status());
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/:provider/status', async (_req, res, next) => {
  try {
    const payload = await integrationService.status();
    const provider = integrationService.normaliseProvider(String(_req.params.provider));
    res.json(provider === 'SQUARE' ? payload.square : payload.xero);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/connect', async (req, res, next) => {
  try {
    res.json(await integrationService.startConnect(String(req.params.provider), req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/disconnect', async (req, res, next) => {
  try {
    res.json(await integrationService.disconnect(String(req.params.provider), req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/test', async (req, res, next) => {
  try {
    res.json(await integrationService.test(String(req.params.provider), req.user!));
  } catch (error) {
    next(error);
  }
});

export async function squareWebhookReceiver(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await integrationService.handleSquareWebhook(req));
  } catch (error) {
    next(error);
  }
}

export async function xeroWebhookReceiver(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await integrationService.handleXeroWebhook(req));
  } catch (error) {
    next(error);
  }
}
