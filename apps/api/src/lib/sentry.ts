import type { Request } from 'express';
import { env } from '../env.js';
import { loggablePath, maskCardCodesInPath } from './log-path.js';

/**
 * Error monitoring, off by default.
 *
 * Without SENTRY_DSN set nothing here runs — the SDK is never even imported,
 * so local dev and any deployment that hasn't opted in pay zero cost. With it
 * set, every unexpected 500 (and any uncaught crash — the SDK installs
 * process-level handlers) lands in Sentry with the request path and actor
 * attached, instead of living only in the container log.
 *
 * Expected 4xx failures (bad PIN, validation, not-found) never go to Sentry;
 * they are the floor using the system, not the system breaking.
 */

type SentryModule = typeof import('@sentry/node');

let sentry: SentryModule | null = null;

export async function initSentry() {
  if (!env.sentryDsn) return;
  try {
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn: env.sentryDsn,
      environment: env.isProduction ? 'production' : 'development',
      // Errors only — tracing would sample every request and this API's
      // performance story is already covered by the container logs.
      tracesSampleRate: 0,
      // The request URL the SDK attaches can carry a gift card code
      // (/api/invoices/gift-cards/:code) — a bearer secret. Mask it the way
      // the container log does.
      beforeSend(event) {
        if (event.request?.url) event.request.url = maskCardCodesInPath(event.request.url);
        if (event.transaction) event.transaction = maskCardCodesInPath(event.transaction);
        return event;
      }
    });
    sentry = Sentry;
    console.log('[sentry] error monitoring on');
  } catch (error) {
    // Monitoring must never take the API down with it.
    console.error('[sentry] init failed, continuing without monitoring:', error);
  }
}

/** Called from the express error handler for 5xx only. */
export function captureApiError(error: unknown, req: Request) {
  if (!sentry) return;
  try {
    sentry.captureException(error, {
      tags: { path: loggablePath(req.originalUrl), method: req.method }
    });
  } catch {
    // Never let reporting throw inside the error handler.
  }
}
