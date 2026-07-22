import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { env } from '../env.js';
import { authService } from '../services/auth.service.js';
import { HttpError } from './http.js';
import { parseSessionToken } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/handoff/consume',
  '/api/auth/me',
  '/api/auth/logout',
  '/stock-api/api/health',
  '/stock-api/api/auth/login',
  '/stock-api/api/auth/handoff/consume',
  '/stock-api/api/auth/me',
  '/stock-api/api/auth/logout'
]);

function hasEnabledStockAccess(user: AuthUser) {
  if (user.isAdmin) return true;
  return user.appAccess.some((access) => access.appId === 'STOCK' && access.status === 'ENABLED');
}

function isWrite(req: Request) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
}

// Mirror of the suite API's read-only rule: an account whose every ENABLED
// app access carries permissions.readOnly can see everything its access
// allows but never change it (applies to isAdmin viewer logins too).
function isReadOnlyAccount(user: AuthUser) {
  const enabled = user.appAccess.filter((access) => access.status === 'ENABLED');
  if (enabled.length === 0) return false;
  return enabled.every((access) => {
    const perms = access.permissions;
    return Boolean(perms && typeof perms === 'object' && (perms as { readOnly?: unknown }).readOnly === true);
  });
}

function bearerToken(req: Request) {
  const header = req.header('authorization') ?? '';
  const match = header.match(/^bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const cookieToken = req.cookies?.[env.sessionCookieName] as string | undefined;
  const payload = parseSessionToken(cookieToken) ?? parseSessionToken(bearerToken(req) ?? undefined);

  if (payload) {
    const user = await authService.getById(payload.userId);
    if (user) req.user = user;
  }

  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  if (!req.user) {
    return next(new HttpError(401, 'Not authenticated'));
  }

  if (!hasEnabledStockAccess(req.user)) {
    return next(new HttpError(403, 'Stock access disabled'));
  }

  if (req.user.accountType === 'VENUE_DEVICE' && isWrite(req)) {
    return next(new HttpError(403, 'Staff PIN context is required on this shared device.'));
  }

  if (isWrite(req) && isReadOnlyAccount(req.user)) {
    return next(new HttpError(403, 'This account is read-only — viewing is fine, changes are off.'));
  }

  return next();
}
