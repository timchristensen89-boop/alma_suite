import type { NextFunction, Request, Response } from 'express';
import type { AuthUser } from '@alma/shared';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * SCAFFOLD auth middleware.
 *
 * The real implementation must mirror stock-api: verify the suite handoff token
 * / session cookie, hydrate the AuthUser, and gate access to users with an
 * ENABLED 'STAFF' app-access entry. That requires porting session.ts +
 * auth.service from the monolith, which is tracked as a follow-up (see
 * docs/WORKLOG.md → PARKED).
 *
 * Until then this is a permissive pass-through so the skeleton can boot and
 * serve /health. It attaches NO user and the workforce routes are stubs that
 * touch no data, so there is no data-exposure risk in this state.
 */
export function authMiddleware(_req: Request, _res: Response, next: NextFunction) {
  // TODO(workforce-extraction): verify suite token, hydrate req.user, enforce
  // STAFF app access for non-public paths before any route reads workforce data.
  next();
}

export function requireStaffAccess(req: Request, res: Response, next: NextFunction) {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  const allowed = user.isAdmin || user.appAccess?.some((a) => a.appId === 'STAFF' && a.status === 'ENABLED');
  if (!allowed) {
    return res.status(403).json({ message: 'Staff app access required' });
  }
  next();
}
