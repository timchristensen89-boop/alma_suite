import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { adminService } from '../services/admin.service.js';
import { integrationService } from '../services/integration.service.js';
import { temperatureService } from '../services/temperature.service.js';

export const integrationJobsRouter = Router();

function secretFromRequest(headerValue: string | undefined) {
  const bearer = /^Bearer\s+(.+)$/i.exec(headerValue ?? '');
  return bearer?.[1] ?? null;
}

function safeSecretEqual(value: string | null, expected: string) {
  if (!value || !expected) return false;
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

integrationJobsRouter.use((req, _res, next) => {
  if (!env.integrations.schedulerSecret) {
    next(new HttpError(503, 'Integration scheduler is not configured.'));
    return;
  }
  const provided = secretFromRequest(req.header('authorization')) ?? req.header('x-alma-scheduler-secret') ?? null;
  if (!safeSecretEqual(provided, env.integrations.schedulerSecret)) {
    next(new HttpError(401, 'Invalid integration scheduler credentials.'));
    return;
  }
  next();
});

integrationJobsRouter.post('/square/sync', async (req, res, next) => {
  try {
    res.json(await integrationService.runScheduledSquareSync(req.body ?? {}));
  } catch (error) {
    next(error);
  }
});

integrationJobsRouter.post('/xero/import', async (req, res, next) => {
  try {
    res.json(await integrationService.runScheduledXeroImport(req.body ?? {}));
  } catch (error) {
    next(error);
  }
});

integrationJobsRouter.post('/run', async (req, res, next) => {
  try {
    res.json(await integrationService.runScheduledIntegrationImports(req.body ?? {}));
  } catch (error) {
    next(error);
  }
});

// Govee temperature pull — invoked hourly by Cloud Scheduler so the dashboard
// stays current without anyone clicking "Sync".
integrationJobsRouter.post('/govee/sync', async (_req, res, next) => {
  try {
    res.json(await temperatureService.syncGovee());
  } catch (error) {
    next(error);
  }
});

// Weekly summary email — Monday 7am Sydney by Cloud Scheduler. Body { previewOnly:true }
// is supported for safe dry-runs from the scheduler config.
integrationJobsRouter.post('/weekly-summary', async (req, res, next) => {
  try {
    const previewOnly = Boolean((req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).previewOnly : undefined));
    res.json(await adminService.sendWeeklySummary({ previewOnly }));
  } catch (error) {
    next(error);
  }
});
