import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { captureApiError } from './sentry.js';

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, 'Route not found'));
}

/**
 * Every failed request leaves one structured line in the container log —
 * method, path, status, message, who — plus, for the money-touching gift
 * card routes, the card code and amount from the body. Bodies are otherwise
 * never logged (PINs, passwords, card data). Discovered the hard way: on
 * launch day the venues' redemptions 403'd for a full shift and left no
 * trace anywhere, so the codes staff had tried were unrecoverable.
 */
function actor(req: Request): string {
  const user = req.user;
  if (user) return `${user.accountType ?? 'user'}:${user.email ?? user.firstName ?? user.id}`;
  if (req.deviceUser) return `device:${req.deviceUser.venue ?? req.deviceUser.firstName ?? req.deviceUser.id}`;
  return 'anon';
}

function safeContext(req: Request): string {
  if (!/^\/api\/gift-cards\//.test(req.path)) return '';
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  // Never the full code — it's the bearer secret. Enough tail to correlate.
  if (typeof body.code === 'string') parts.push(`code=***${body.code.slice(-4)}`);
  if (typeof body.amountCents === 'number') parts.push(`amountCents=${body.amountCents}`);
  if (typeof body.venue === 'string') parts.push(`venue=${body.venue}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function logFailure(req: Request, status: number, message: string) {
  // 404s on lookups are routine (typos at the counter); everything else is a
  // real failure someone will ask about.
  const line = `[api] ${req.method} ${req.originalUrl.split('?')[0]} -> ${status} "${message}" by ${actor(req)}${safeContext(req)}`;
  if (status >= 500) console.error(line);
  else console.warn(line);
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const status = error instanceof ZodError ? 400 : error instanceof HttpError ? error.statusCode : 500;
  const message =
    error instanceof ZodError
      ? error.issues[0]?.message ?? 'Validation failed'
      : error instanceof Error
        ? error.message
        : 'Unknown server error';
  logFailure(req, status, message);
  // Only genuine breakage goes to monitoring — expected 4xx (validation,
  // wrong PIN, not-found) is normal service, not an incident.
  if (status >= 500) captureApiError(error, req);

  if (error instanceof ZodError) {
    return res.status(400).json({
      message: error.issues[0]?.message ?? 'Validation failed',
      details: error.issues
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      message: error.message,
      details: error.details ?? null
    });
  }

  if (error instanceof Error) {
    return res.status(500).json({
      message: error.message
    });
  }

  return res.status(500).json({
    message: 'Unknown server error'
  });
}
