import type { AuthUser } from '@alma/shared';

export type BetaRole = AuthUser['role'];

const roleRank: Record<BetaRole, number> = {
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3
};

export function hasRole(user: AuthUser | null, minimum: BetaRole) {
  if (!user) return false;
  return roleRank[user.role] >= roleRank[minimum];
}

export function canManage(user: AuthUser | null) {
  return hasRole(user, 'MANAGER');
}

export function canAdmin(user: AuthUser | null) {
  return hasRole(user, 'ADMIN');
}
