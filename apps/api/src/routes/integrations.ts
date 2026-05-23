import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAdmin } from '../lib/auth-middleware.js';
import { integrationService } from '../services/integration.service.js';

export const integrationsRouter = Router();

integrationsRouter.get('/meta/callback', async (req, res, next) => {
  try {
    const redirectUrl = await integrationService.handleMetaCallback(req.query);
    res.redirect(302, redirectUrl);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/:provider/callback', async (req, res, next) => {
  try {
    const redirectUrl = await integrationService.handleCallback(String(req.params.provider), req.query);
    res.redirect(302, redirectUrl);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.use(requireAdmin);

integrationsRouter.get('/meta/connect', async (req, res, next) => {
  try {
    const payload = await integrationService.startMetaConnect(req.user!);
    res.redirect(302, payload.authorizationUrl);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/square/connect', async (req, res, next) => {
  try {
    const payload = await integrationService.startConnect('square', req.user!, req.query.account);
    res.redirect(302, payload.authorizationUrl);
  } catch (error) {
    next(error);
  }
});

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
    res.json(provider === 'SQUARE' ? (payload.squareAccounts ?? { primary: payload.square }) : payload.xero);
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/square/health-check', async (req, res, next) => {
  try {
    res.json(await integrationService.checkSquareHealth(req.user!, req.query.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/square/refresh', async (req, res, next) => {
  try {
    res.json(await integrationService.refreshSquare(req.user!, req.query.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/square/sync-locations', async (req, res, next) => {
  try {
    res.json(await integrationService.syncSquareLocations(req.user!, req.query.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/square/import-sales', async (req, res, next) => {
  try {
    res.json(await integrationService.importSquareSales({
      ...(req.body && typeof req.body === 'object' ? req.body : {}),
      account: req.query.account ?? req.body?.account
    }, req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/square/sync-catalog', async (req, res, next) => {
  try {
    res.json(await integrationService.syncSquareCatalog(req.user!, req.query.account ?? req.body?.accountKey ?? req.body?.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/xero/health-check', async (req, res, next) => {
  try {
    res.json(await integrationService.checkXeroHealth(req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/xero/supplier-contacts/preview', async (req, res, next) => {
  try {
    res.json(await integrationService.previewXeroSupplierContacts(req.query));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/xero/supplier-contacts/import', async (req, res, next) => {
  try {
    res.status(201).json(await integrationService.importXeroSupplierContacts(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.get('/xero/supplier-bills/preview', async (req, res, next) => {
  try {
    res.json(await integrationService.previewXeroSupplierBills(req.query));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/xero/supplier-bills/import', async (req, res, next) => {
  try {
    res.status(201).json(await integrationService.importXeroSupplierBills(req.body, req.user!));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/connect', async (req, res, next) => {
  try {
    res.json(await integrationService.startConnect(String(req.params.provider), req.user!, req.query.account ?? req.body?.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/disconnect', async (req, res, next) => {
  try {
    res.json(await integrationService.disconnect(String(req.params.provider), req.user!, req.query.account ?? req.body?.account));
  } catch (error) {
    next(error);
  }
});

integrationsRouter.post('/:provider/test', async (req, res, next) => {
  try {
    res.json(await integrationService.test(String(req.params.provider), req.user!, req.query.account ?? req.body?.account));
  } catch (error) {
    next(error);
  }
});

export async function squareWebhookReceiver(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await integrationService.handleSquareWebhook(req, req.params.accountKey));
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
