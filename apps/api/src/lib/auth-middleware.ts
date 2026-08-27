import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';
import { env } from '../env.js';
import { authService } from '../services/auth.service.js';
import { HttpError } from './http.js';
import { isPublic } from './public-paths.js';
import { DEVICE_PIN_SESSION_COOKIE, parseDevicePinSessionToken, parseSessionToken } from './session.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    deviceUser?: AuthUser;
    pinUser?: AuthUser;
  }
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

// A read-only account: every ENABLED app access carries permissions.readOnly.
// Deliberately checked even for isAdmin accounts — the flag is only ever set
// on purpose (e.g. an external administrator/accountant viewer login), and a
// read-only admin can see everything but change nothing.
function isReadOnlyAccount(user: AuthUser) {
  const enabled = user.appAccess.filter((access) => access.status === 'ENABLED');
  if (enabled.length === 0) return false;
  return enabled.every((access) => {
    const perms = access.permissions;
    return Boolean(perms && typeof perms === 'object' && (perms as { readOnly?: unknown }).readOnly === true);
  });
}

/**
 * API surfaces the ALMA Staff app exposes to an ordinary staff member.
 *
 * These are the pages in the staff app's own navigation — Report an issue,
 * Today's checks, Temperatures, Academy, Handbook. A new hire is created with
 * STAFF access only, so anything here that demanded COMPLIANCE was a dead link
 * for the people it was built for.
 */
const STAFF_APP_SURFACES = [
  '/api/issues',
  '/api/incidents',
  '/api/checklists',
  '/api/temperatures',
  '/api/training',
  '/api/handbook-documents'
];

function isStaffWriteAllowed(req: Request) {
  if (!isWrite(req)) return true;
  if (req.path.startsWith('/api/issues')) return true;
  if (req.path === '/api/incidents' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/checklists/runs')) return true;
  if (/^\/api\/shift-task-assignments\/[^/]+\/start-checklist$/.test(req.path) && req.method === 'POST') return true;
  if (req.path.startsWith('/api/audits/runs') && !req.path.includes('/export/')) return true;
  if (req.path === '/api/communications/chat' && req.method === 'POST') return true;
  if (req.path.startsWith('/api/messages/threads') && req.method === 'POST') return true;
  if (/^\/api\/messages\/threads\/[^/]+\/messages$/.test(req.path) && req.method === 'POST') return true;
  if (/^\/api\/messages\/threads\/[^/]+\/read$/.test(req.path) && req.method === 'POST') return true;
  if (/^\/api\/messages\/threads\/[^/]+\/acknowledge$/.test(req.path) && req.method === 'POST') return true;
  if (/^\/api\/comms\/threads\/[^/]+\/messages$/.test(req.path) && req.method === 'POST') return true;
  if (/^\/api\/comms\/threads\/[^/]+\/read$/.test(req.path) && req.method === 'POST') return true;
  if (/^\/api\/comms\/threads\/[^/]+\/acknowledge$/.test(req.path) && req.method === 'POST') return true;
  if (req.path === '/api/device/pin-login' && req.method === 'POST') return true;
  if (req.path === '/api/device/pin-logout' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/pin' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/leave' && req.method === 'POST') return true;
  // Availability is the staff member's own to state. The service still checks
  // ownership on every one of these — this allowlist only decides whether a
  // non-manager may attempt the write at all.
  if (req.path === '/api/staff/me/availability' && req.method === 'PUT') return true;
  // Claiming an open shift is a request, not an assignment — the service still
  // refuses clashes, leave and other venues, and a manager decides the outcome.
  if (/^\/api\/staff\/me\/open-shifts\/[^/]+\/(claim|withdraw)$/.test(req.path) && req.method === 'POST') return true;
  // Offering your own shift for swap is likewise a request, not a handover:
  // the shift stays yours, and stays costed against you, until a manager
  // approves someone taking it. The service checks you own the shift.
  if (/^\/api\/staff\/me\/shifts\/[^/]+\/(offer-swap|cancel-swap)$/.test(req.path) && req.method === 'POST') return true;
  // Burning your own calendar link is yours to do — a lost phone at 11pm
  // shouldn't wait on a manager. The route only ever rotates the caller's own
  // token; resetting somebody else's stays on the manager-guarded route.
  if (req.path === '/api/staff/me/calendar/rotate' && req.method === 'POST') return true;
  // Turning notifications on and off for your own phone. Both are writes by a
  // non-manager, and without these the "Notifications" card answers "this is a
  // manager-only action" to the person whose phone it is.
  if (req.path === '/api/staff/me/push/subscribe' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/push/unsubscribe' && req.method === 'POST') return true;
  if (req.path === '/api/staff/me/unavailability' && req.method === 'POST') return true;
  if (/^\/api\/staff\/unavailability\/[^/]+$/.test(req.path) && req.method === 'DELETE') return true;
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
    // getSessionUser drops archived (offboarded) humans, so a terminated person's
    // open session stops resolving — they're logged out on their next request.
    const sessionUser = await authService.getSessionUser(payload.userId);
    if (sessionUser) {
      req.user = sessionUser;
      if (sessionUser.accountType === 'VENUE_DEVICE') {
        const pinPayload = parseDevicePinSessionToken(
          (req.cookies?.[DEVICE_PIN_SESSION_COOKIE] as string | undefined) ??
            (req.headers['x-device-pin-session'] as string | undefined)
        );
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
    return next(new HttpError(403, 'Shared-device sign-in only lets you read the venue board. Sign in as a staff PIN to take this action.'));
  }

  // Read-only accounts can view everything their access allows but never
  // change anything. /api/auth stays open so they can sign out and manage
  // their own password.
  if (isWrite(req) && !req.path.startsWith('/api/auth') && isReadOnlyAccount(req.user)) {
    return next(new HttpError(403, 'This account is read-only — viewing is fine, changes are off.'));
  }

  const settingsRequest = req.path.startsWith('/api/settings') || req.path.startsWith('/api/shift-task-rules');

  if (settingsRequest && !hasSettingsAccess(req.user)) {
    return next(new HttpError(403, 'This is an Admin setting. Ask an Alma admin if you need access.'));
  }

  if (!settingsRequest) {
    if (req.path.startsWith('/api/staff')) {
      if (!hasAnyEnabledAppAccess(req.user, ['STAFF', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Your Alma Staff access is turned off. Ask an Alma admin to enable it.'));
      }
    } else if (STAFF_APP_SURFACES.some((prefix) => req.path.startsWith(prefix))) {
      // Pages the ALMA Staff app puts in its own navigation: report an issue,
      // today's checks, fridge temperatures, the academy, the handbook.
      //
      // A new hire is created with STAFF access and nothing else, so requiring
      // Compliance here meant a brand-new floor staffer could open "Report an
      // issue" and be told Compliance isn't enabled on their account. The write
      // allowlist below already says staff may raise an issue and complete a
      // checklist run — this gate was contradicting it. Manager-only actions on
      // these routes are still enforced by that allowlist and by the routes.
      if (!hasAnyEnabledAppAccess(req.user, ['STAFF', 'COMPLIANCE', 'TRAINING'])) {
        return next(new HttpError(403, 'Your Alma Staff access is turned off. Ask an Alma admin to enable it.'));
      }
    } else if (req.path.startsWith('/api/reports') || req.path.startsWith('/api/forecast')) {
      // /api/forecast is part of the Reports app (Reports → Forecast section).
      if (!hasAnyEnabledAppAccess(req.user, ['REPORTS', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Alma Reports is restricted to managers and admins. Ask an Alma admin if you need access.'));
      }
    } else if (req.path.startsWith('/api/reserve')) {
      if (!hasAnyEnabledAppAccess(req.user, ['RESERVE', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Alma Reserve is currently in Preview and isn’t open to your role.'));
      }
    } else if (req.path.startsWith('/api/marketing')) {
      if (!hasAnyEnabledAppAccess(req.user, ['MARKETING', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Alma Marketing is currently in Preview and isn’t open to your role.'));
      }
    } else if (req.path.startsWith('/api/gift-cards')) {
      if (!hasAnyEnabledAppAccess(req.user, ['GIFTCARDS', 'COMPLIANCE'])) {
        return next(new HttpError(403, 'Gift Cards isn’t enabled on your account. Ask a manager.'));
      }
    } else if (req.path.startsWith('/api/notifications') || req.path.startsWith('/api/messages') || req.path.startsWith('/api/communications')) {
      if (!hasAnyEnabledAppAccess(req.user, ['COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'RESERVE', 'MARKETING', 'GIFTCARDS', 'TRAINING', 'SETTINGS'])) {
        return next(new HttpError(403, 'Your Alma Suite access is turned off. Ask an Alma admin.'));
      }
    } else if (!hasEnabledAppAccess(req.user, 'COMPLIANCE')) {
      return next(new HttpError(403, 'Alma Compliance isn’t enabled on your account. Ask an Alma admin.'));
    }
  }

  if (!isManager(req.user) && !isStaffWriteAllowed(req)) {
    return next(new HttpError(403, 'This is a manager-only action. Ask your manager to do it.'));
  }

  return next();
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'You’re not signed in. Sign in with your Alma account.'));
  if (req.user.accountType === 'VENUE_DEVICE' || req.user.deviceAccount) {
    return next(new HttpError(403, 'Admin tools aren’t available on a shared device. Open Alma Admin on a personal device.'));
  }
  if (!req.user.isAdmin) return next(new HttpError(403, 'This needs Alma Admin access. Ask the owner if you need it.'));
  return next();
}

export function requireManager(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'You’re not signed in. Sign in with your Alma account.'));
  if (!isManager(req.user)) return next(new HttpError(403, 'This is a manager-only action. Ask your manager to do it.'));
  return next();
}

export function requireSettingsAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, 'You’re not signed in. Sign in with your Alma account.'));
  if (!hasSettingsAccess(req.user)) return next(new HttpError(403, 'This is an Alma Admin setting. Ask an Alma admin if you need access.'));
  return next();
}
