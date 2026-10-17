import type { AuthUser } from '@alma/shared';
import { accessibleSuiteApps } from './appAccess';
import { SUITE_APPS, suiteLauncherInfo, type SuiteAppIdentity } from './SuiteApps';

/*
 * Who sees which app on Alma Home, and how the launcher search ranks them.
 * Kept beside the registry rather than inside Home so the rules can be tested
 * and any other launcher (the switcher, a future iPad home) reads the same.
 */

/** A shared venue device: the kiosk account itself, or a PIN session on one. */
export function isSharedDeviceUser(user: Pick<AuthUser, 'accountType' | 'deviceAccount'> | null | undefined) {
  return Boolean(user && (user.accountType === 'VENUE_DEVICE' || user.deviceAccount));
}

/** Live apps with somewhere to go — preview and unfinished apps never show. */
export function launchableSuiteApps(apps: SuiteAppIdentity[] = SUITE_APPS): SuiteAppIdentity[] {
  return apps.filter((app) => app.status === 'active' && Boolean(app.href));
}

/**
 * What a person is offered. Staff are filtered by their app-access rows with
 * the same rule the API enforces; admins and managers get their full list. A
 * shared venue device and the signed-out screens never advertise back-office
 * apps, whoever is standing at it. Destinations still enforce their own
 * permissions — this only decides what the launcher shows.
 */
export function launcherAppsForUser(user: AuthUser | null | undefined, apps: SuiteAppIdentity[] = SUITE_APPS): SuiteAppIdentity[] {
  const all = launchableSuiteApps(apps);
  if (!user || isSharedDeviceUser(user)) return all.filter((app) => !suiteLauncherInfo(app.id).managementOnly);
  return accessibleSuiteApps(user, all);
}

function normalise(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim();
}

/** Rank an app against a search: name beats keyword beats description. 0 = no match. */
export function suiteLauncherMatch(app: Pick<SuiteAppIdentity, 'id' | 'label' | 'shortLabel' | 'description'>, query: string): number {
  const q = normalise(query);
  if (!q) return 1;
  const info = suiteLauncherInfo(app.id);
  const name = normalise(app.label);
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 80;
  if (normalise(app.shortLabel).includes(q)) return 70;
  if (info.keywords.some((word) => normalise(word).startsWith(q))) return 60;
  if (info.keywords.some((word) => normalise(word).includes(q))) return 40;
  if (normalise(`${info.tagline} ${app.description}`).includes(q)) return 20;
  return 0;
}

/** Apps matching a search, best first; ties keep registry order. */
export function searchSuiteLauncher<T extends Pick<SuiteAppIdentity, 'id' | 'label' | 'shortLabel' | 'description'>>(apps: T[], query: string): T[] {
  return apps
    .map((app, index) => ({ app, index, score: suiteLauncherMatch(app, query) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.app);
}
