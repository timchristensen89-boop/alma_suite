import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import { adminService } from '../services/admin.service.js';
import { checklistService } from '../services/checklist.service.js';
import { deputyService } from '../services/deputy.service.js';
import { giftCardService } from '../services/gift-card.service.js';
import { integrationService } from '../services/integration.service.js';
import { marketingService } from '../services/marketing.service.js';
import { reportsService } from '../services/reports.service.js';
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

// Cron entrypoint: generate today's checklist runs from every template.
// Point Cloud Scheduler at POST /api/integration-jobs/checklists/auto-schedule
// with the scheduler secret (this router is secret-guarded above and mounted
// before session auth). Replaces the old session-only checklists/auto-schedule.
integrationJobsRouter.post('/checklists/auto-schedule', async (_req, res, next) => {
  try {
    res.json(await checklistService.autoScheduleDailyRuns());
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

// Deputy sync — invoked by Cloud Scheduler. Runs employee, document, and
// roster sync in order so document sync can match newly-imported employees.
integrationJobsRouter.post('/deputy/sync', async (_req, res, next) => {
  try {
    res.json(await deputyService.runScheduledSync());
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

// Drains gift cards whose scheduledDeliveryAt has arrived (e.g.
// birthday-scheduled cards). Designed to be called every few minutes
// by Cloud Scheduler.
integrationJobsRouter.post('/gift-cards/drain', async (_req, res, next) => {
  try {
    res.json(await giftCardService.drainScheduledGiftCardSends());
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

// Monthly recap email — 1st of month 9am Sydney by Cloud Scheduler. Emails the
// just-finished month's all-venues recap to MONTHLY_RECAP_RECIPIENTS. Body
// { previewOnly:true } supported for safe dry-runs.
integrationJobsRouter.post('/monthly-recap', async (req, res, next) => {
  try {
    const previewOnly = Boolean(
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).previewOnly : undefined
    );
    res.json(await reportsService.sendScheduledMonthlyRecap({ previewOnly }));
  } catch (error) {
    next(error);
  }
});

// Marketing automation runner — daily (e.g. 8am Sydney) by Cloud Scheduler.
// Fires every active automation: builds the eligible audience, dedups, consent-
// checks, and sends via Resend. Body { dryRun:true } previews without sending.
integrationJobsRouter.post('/marketing/run-automations', async (req, res, next) => {
  try {
    const dryRun = Boolean(req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).dryRun : undefined);
    res.json(await marketingService.runDueAutomations({ dryRun }));
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

// Rule 5: daily 9am Xero supplier invoice import. Schedule this cron in
// Cloud Scheduler with cron='0 9 * * *' and timezone='Australia/Sydney'.
// Same body shape as /xero/import (legacy) but distinct path so the
// scheduler intent is obvious in logs.
integrationJobsRouter.post('/xero/daily-bills-9am', async (req, res, next) => {
  try {
    res.json(await integrationService.runScheduledXeroImport(req.body ?? {}));
  } catch (error) {
    next(error);
  }
});

// Rule 9: weekly staff consumption prompt — Sunday 5pm Sydney. Sends
// the head chef a "log staff food spend" note and the venue manager a
// "log staff drink spend" note. Currently surfaces in Comms as an
// announcement; on first real send we'll route to per-recipient DM.
integrationJobsRouter.post('/staff-consumption-prompt', async (_req, res, next) => {
  try {
    const sent: string[] = [];
    // Best-effort prompt — if comms / messaging isn't reachable, the
    // weekly summary will pick it up the following Monday anyway.
    try {
      await adminService.sendWeeklySummary({ previewOnly: false });
      sent.push('weekly-summary');
    } catch (err) {
      console.warn('[stock-rules] staff consumption prompt — weekly summary path failed', err);
    }
    res.json({
      sent,
      note: 'Weekly nudge issued. Head chef logs food spend, venue manager logs drinks spend. Both feed the staff-meal COGS line in Reports.',
      ranAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});
