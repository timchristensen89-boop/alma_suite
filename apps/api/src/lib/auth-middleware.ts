import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { env } from '../env.js';
import { authService } from '../services/auth.service.js';
import { HttpError } from './http.js';
import { DEVICE_PIN_SESSION_COOKIE, parseDevicePinSessionToken, parseSessionToken } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    deviceUser?: AuthUser;
    pinUser?: AuthUser;
  }
}

// Publicly accessible paths — no session required.
// Every API endpoint not listed here requires a valid session cookie.
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/handoff/consume',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/complete',
  '/api/gift-cards/checkout',
  '/api/gift-cards/public/config',
  '/api/gift-cards/public/orders',
  '/api/gift-cards/settings/public',
  '/api/gift-cards/promo/quote',
  '/api/integrations/square/callback',
  '/api/integrations/xero/callback',
  '/api/integrations/meta/callback'
]);

const PUBLIC_PREFIXES = [
  '/api/gift-cards/session/',
  '/api/gift-cards/print/',
  '/api/gift-cards/qr/',
  '/api/gift-cards/wallet/apple/',
  '/api/gift-cards/wallet/google/',
  '/api/staff/invites/by-token/',
  '/api/reserve/public-widget/',
  '/api/reserve/public/'
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

function hasAnyEnabledAppAccess(user: AuthUser, appIds: AuthUser['appAccess'][number]['appId'][]) {
  return appIds.some((appId) => hasEnabledAppAccess(user, appId));
}

function isManager(user: AuthUser) {
  if (user.accountType === 'VENUE_DEVICE') return false;
  return user.role === 'ADMIN' || user.role === 'MANAGER' || user.isAdmin;
}

function hasSettingsAccess(user: AuthUser) {
  if (user.accountType === 'VENUE_DEVICE' || user.deviceAccount) return false;
  if (user.isAdmin || user.role === 'ADMIN') return true;
  const settingsAccess = user.appAccess.find((access) => access.appId === 'SETTINGS' && access.status === 'ENABLED');
  return Boolean(settingsAccess?.role === 'ADMIN' || settingsAccess?.permissions?.admin);
}

function isWrite(req: Request) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase());
}

function isStaffWriteAllowed(req: Request) {
  if (!isWrite(req)) return true;
  if (req.path.startsWith('/api/issues')) return true;
  if (req.path === '/api/incidents' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/checklists/runs')) return true;
  if (/^\/api\/shift-task-assignments\/[^/]+\/start-checklist$/.test(req.path) && req.method === 'POST') return true;
  if (req.path.startsWith('/api/audits/runs') && !req.path.includes('/export/')) return true;
  if (req.path === '/api/communications/chat' && req.method === 'POST') return true;
  if (req.path === '/api/device/pin-login' && req.method === 'POST') return true;
  if (req.path === '/api/device/pin-logout' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/pin' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/leave' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock/in' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock/out' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock-in' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock-out' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock/break/start' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/clock/break/end' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/break-start' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/break-end' && req.method === 'POST') return true;
  if (/^\/api\/staff\/me\/shifts\/[^/]+\/confirm$/.test(req.path) && req.method === 'POST') return true;
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
    const sessionUser = await authService.getById(payload.userId);
    if (sessionUser) {
      req.user = sessionUser;
      if (sessionUser.accountType === 'VENUE_DEVICE') {
        const pinPayload = parseDevicePinSessionToken(req.cookies?.[DEVICE_PIN_SESSION_COOKIE] as string | undefined);
        if (pinPayload?.deviceUserId === sessionUser.id) {
          const pinUser = await authService.getActiveHumanById(pinPayload.pinUserId);
          if (
            pinUser &&
            pinUser.venue &&
            sessionUser.venue &&
            pinUser.venue.trim().toLowerCase() === sessionUser.venue.trim().toLowerCase()
          ) {
            req.deviceUser = sessionUser;
            req.pinUser = pinUser;
            // TODO: add durable deviceUserId audit fields for shared device actions.
            req.user = authService.effectiveDeviceUser(sessionUser, pinUser);
          }
        }
      }
    }
  }

  if (isPublic(req.path)) {
    return next();
  }

  if (!req.user) {
    return next(new HttpError(401, 'Not authenticated'));
  }

  if (req.user.accountType === 'VENUE_DEVICE' && isWrite(req) && !req.path.startsWith('/api/device')) {
    return next(new HttpError(403, 'Staff PIN required on this shared device.'));
  }

  const settingsRequest = req.path.startsWith('/api/settings') || req.path.startsWith('/api/shift-task-rules');

  if (settingsRequest && !hasSettingsAccess(req.user)) {
    return next(new HttpError(403, 'Settings access required'));
  }

  if (!settingsRequest) {
    if (req.path.startsWith('/api/staff')) {
      if (!hasAnyEnabledAppAccess(req.user, ['STAFF', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Staff access disabled'));
      }
    } else if (req.path.startsWith('/api/reports')) {
      if (!hasAnyEnabledAppAccess(req.user, ['REPORTS', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Reports access disabled'));
      }
    } else if (req.path.startsWith('/api/reserve')) {
      if (!hasAnyEnabledAppAccess(req.user, ['RESERVE', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Reserve access disabled'));
      }
    } else if (req.path.startsWith('/api/marketing')) {
      if (!hasAnyEnabledAppAccess(req.user, ['MARKETING', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Marketing access disabled'));
      }
    } else if (req.path.startsWith('/api/gift-cards')) {
      if (!hasAnyEnabledAppAccess(req.user, ['GIFTCARDS', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Gift cards access disabled'));
      }
    } else if (req.path.startsWith('/api/notifications')) {
      if (!hasAnyEnabledAppAccess(req.user, ['COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'RESERVE', 'MARKETING', 'GIFTCARDS', 'TRAINING', 'SETTINGS'])) {
        return next(new HttpError(403, 'Suite access disabled'));
      }
    } else if (!hasEnabledAppAccess(req.user, 'COMPLIANCE')) {
      return next(new HttpError(403, 'Compliance access disabled'));
    }
  }

  if (!isManager(req.user) && !isStaffWriteAllowed(req)) {
    return next(new HttpError(403, 'Manager access required'));
  }

  return next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (req.user.accountType === 'VENUE_DEVICE' || req.user.deviceAccount) return next(new HttpError(403, 'Admin access required'));
  if (!req.user.isAdmin) return next(new HttpError(403, 'Admin access required'));
  return next();
}

export function requireManager(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (!isManager(req.user)) return next(new HttpError(403, 'Manager access required'));
  return next();
}

export function requireSettingsAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'Not authenticated'));
  if (!hasSettingsAccess(req.user)) return next(new HttpError(403, 'Settings admin access required'));
  return next();
}
