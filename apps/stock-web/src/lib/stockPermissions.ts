import type { AuthUser } from '@alma/shared';

export function canManageStock(user: AuthUser | null | undefined) {
  return Boolean(user && (user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER'));
}
