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

// Publicly accessible paths — no session required.
// Every API endpoint not listed here requires a valid session cookie.
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/gift-cards/checkout'
]);

const PUBLIC_PREFIXES = [
  '/api/gift-cards/session/',
  '/api/staff/invites/by-token/'
];

function isPublic(path: string) {
  if (PUBLIC_PATHS.has(path)) return true;
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function hasEnabledAppAccess(user: AuthUser, appId: AuthUser['appAccess'][number]['appId']) {
  if (user.isAdmin) return true;
  if (appId === 'COMPLIANCE' && user.appAccess.length === 0) return true;
  return user.appAccess.some((access) => access.appId === appId && access.status === 'ENABLED');
}

function isManager(user: AuthUser) {
  return user.role === 'ADMIN' || user.role === 'MANAGER' || user.isAdmin;
}

function isWrite(req: Request) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
}

function isStaffWriteAllowed(req: Request) {
  if (!isWrite(req)) return true;
  if (req.path.startsWith('/api/issues')) return true;
  if (req.path === '/api/incidents' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/checklists/runs')) return true;
  if (req.path.startsWith('/api/audits/runs') && !req.path.includes('/export/')) return true;
  if (req.path === '/api/staff/timesheets' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/staff/timesheets/') && req.method === 'PATCH') return true;
  return false;
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

  if (isPublic(req.path)) {
    return next();
  }

  if (!req.user) {
    return next(new HttpError(401, 'Not authenticated'));
  }

  if (!hasEnabledAppAccess(req.user, 'COMPLIANCE')) {
    return next(new HttpError(403, 'Compliance access disabled'));
  }

  if (
    req.path.startsWith('/api/staff') &&
    !hasEnabledAppAccess(req.user, 'STAFF') &&
    !hasEnabledAppAccess(req.user, 'COMPLIANCE')
  ) {
    return next(new HttpError(403, 'Staff access disabled'));
  }

  if (req.path.startsWith('/api/settings') && !isManager(req.user)) {
    return next(new HttpError(403, 'Manager access required'));
  }

  if (!isManager(req.user) && !isStaffWriteAllowed(req)) {
    return next(new HttpError(403, 'Manager access required'));
  }

  return next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (!req.user.isAdmin) return next(new HttpError(403, 'Admin access required'));
  return next();
}

export function requireManager(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (!isManager(req.user)) return next(new HttpError(403, 'Manager access required'));
  return next();
}
