import type { AuthUser } from '@alma/shared';
import { HttpError } from './http.js';

export function requireStockManager(user: AuthUser | undefined) {
  if (!user) throw new HttpError(401, 'Not authenticated');
  if (!user.isAdmin && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    throw new HttpError(403, 'Manager access required');
  }
}
