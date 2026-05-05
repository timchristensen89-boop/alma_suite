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

  return next();
}
