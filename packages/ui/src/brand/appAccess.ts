import type { AuthUser, AlmaAppId } from '@alma/shared';
import type { SuiteAppId, SuiteAppIdentity } from './SuiteApps';

// Map a suite-switcher app id to the StaffAppAccess app id it's gated by.
// Apps not in this map (home, comms, etc.) are never access-gated.
const SUITE_APP_ACCESS_MAP: Partial<Record<SuiteAppId, AlmaAppId>> = {
  compliance: 'COMPLIANCE',
  stock: 'STOCK',
  staff: 'STAFF',
  reports: 'REPORTS',
  reserve: 'RESERVE',
  marketing: 'MARKETING',
  giftcards: 'GIFTCARDS',
  training: 'TRAINING',
  academy: 'TRAINING',
  learning: 'TRAINING',
  settings: 'SETTINGS'
};

export function almaAppIdForSuiteApp(id: SuiteAppId): AlmaAppId | null {
  return SUITE_APP_ACCESS_MAP[id] ?? null;
}

// Whether a user may use a given app. Admins and managers always can — only
// STAFF are scoped by their per-app access (mirrors the API's auth middleware:
// empty appAccess implies COMPLIANCE access, ENABLED status grants the app).
export function canUseApp(user: AuthUser | null | undefined, appId: AlmaAppId): boolean {
  if (!user) return false;
  if (user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  if (appId === 'COMPLIANCE' && user.appAccess.length === 0) return true;
  return user.appAccess.some((access) => access.appId === appId && access.status === 'ENABLED');
}

// Filter a list of suite apps to the ones the user may open. Admins/managers
// (and the logged-out login pages) see the full list; only STAFF are filtered.
export function accessibleSuiteApps<T extends Pick<SuiteAppIdentity, 'id'>>(
  user: AuthUser | null | undefined,
  apps: T[]
): T[] {
  if (!user || user.isAdmin || user.role === 'ADMIN' || user.role === 'MANAGER') return apps;
  return apps.filter((app) => {
    const almaId = SUITE_APP_ACCESS_MAP[app.id as SuiteAppId];
    if (!almaId) return true;
    return canUseApp(user, almaId);
  });
}
