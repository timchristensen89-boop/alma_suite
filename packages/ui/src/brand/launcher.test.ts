import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthUser } from '@alma/shared';
import { SUITE_APPS, SUITE_LAUNCHER_GROUPS, suiteLauncherInfo } from './SuiteApps.js';
import { launchableSuiteApps, launcherAppsForUser, searchSuiteLauncher } from './launcher.js';

/**
 * Alma Home is the front door to every app. What it offers each person, and
 * where each card goes, comes from the shared registry — these pin the rules
 * so a change to one app's entry can't quietly hide another, or put a
 * back-office app on the iPad on the pass.
 */

const user = (extra: Partial<AuthUser>): AuthUser => ({
  id: 'u1',
  firstName: 'Test',
  lastName: 'User',
  email: null,
  roleTitle: 'Staff',
  venue: 'Alma Avalon',
  accountType: 'HUMAN',
  isAdmin: false,
  trainingOnly: false,
  role: 'STAFF',
  appAccess: [],
  deviceAccount: null,
  ...extra
});

const access = (...ids: string[]) =>
  ids.map((appId) => ({ appId, status: 'ENABLED', role: null, permissions: [] })) as unknown as AuthUser['appAccess'];

const ids = (apps: { id: string }[]) => apps.map((app) => app.id).sort();

test('every launchable app has a real https destination and its own launcher entry', () => {
  const apps = launchableSuiteApps();
  assert.ok(apps.length >= 10, `expected the full suite, got ${apps.length}`);
  const groups = new Set(SUITE_LAUNCHER_GROUPS.map((group) => group.id));
  for (const app of apps) {
    assert.match(app.href ?? '', /^https:\/\/alma-[a-z0-9-]+\.web\.app(\/|$)/, `${app.id} href ${app.href}`);
    const info = suiteLauncherInfo(app.id);
    assert.ok(groups.has(info.group), `${app.id} has no launcher group`);
    assert.ok(info.keywords.length > 0, `${app.id} has no search keywords — it is on the default entry`);
    assert.ok(info.tagline.length <= 48, `${app.id} tagline is too long for a card: "${info.tagline}"`);
  }
});

test('Menus opens its own site, never the Compliance placeholder', () => {
  const menus = SUITE_APPS.find((app) => app.id === 'menus');
  assert.equal(menus?.href, 'https://alma-menus.web.app');
});

test('preview and unfinished apps stay off the launcher', () => {
  const offered = ids(launchableSuiteApps());
  for (const app of SUITE_APPS) {
    if (app.status !== 'active' || !app.href) assert.ok(!offered.includes(app.id), `${app.id} should be hidden`);
  }
});

test('admins and managers see their full list, Admin included', () => {
  const all = ids(launchableSuiteApps());
  assert.deepEqual(ids(launcherAppsForUser(user({ isAdmin: true, role: 'ADMIN' }))), all);
  assert.deepEqual(ids(launcherAppsForUser(user({ role: 'MANAGER' }))), all);
  assert.ok(all.includes('settings'));
});

test('staff see only the apps their access rows enable, plus the register', () => {
  const chef = launcherAppsForUser(user({ appAccess: access('STOCK', 'MENUS', 'COMPLIANCE', 'STAFF') }));
  assert.deepEqual(ids(chef), ['compliance', 'menus', 'pos', 'staff', 'stock']);

  const disabled = [{ appId: 'REPORTS', status: 'DISABLED', role: null, permissions: [] }] as unknown as AuthUser['appAccess'];
  const floor = launcherAppsForUser(user({ appAccess: [...access('STAFF'), ...disabled] }));
  assert.deepEqual(ids(floor), ['pos', 'staff']);
});

test('a shared venue device never offers back-office apps, even to a manager', () => {
  const onThePass = launcherAppsForUser(user({ role: 'MANAGER', deviceAccount: { id: 'd1', name: 'Pass iPad', venue: 'Alma Avalon' } }));
  const kiosk = launcherAppsForUser(user({ accountType: 'VENUE_DEVICE' }));
  for (const apps of [onThePass, kiosk, launcherAppsForUser(null)]) {
    for (const back of ['settings', 'reports', 'marketing']) {
      assert.ok(!ids(apps).includes(back), `${back} offered on a shared screen`);
    }
    assert.ok(ids(apps).includes('pos'));
  }
});

test('search finds apps by name and by what people call them', () => {
  const apps = launchableSuiteApps();
  const first = (query: string) => searchSuiteLauncher(apps, query)[0]?.id;
  assert.equal(first('stock'), 'stock');
  assert.equal(first('menus'), 'menus');
  assert.equal(first('compliance'), 'compliance');
  assert.equal(first('staff'), 'staff');
  assert.equal(first('Gift'), 'giftcards');
  assert.equal(first('admin'), 'settings');
  // Comms was folded into Staff — its old name should still get you there.
  assert.equal(first('comms'), 'staff');
  assert.equal(first('roster'), 'staff');
  assert.equal(first('bookings'), 'reserve');
  assert.equal(first('  STOCK  '), 'stock');
  assert.deepEqual(searchSuiteLauncher(apps, 'zzzz'), []);
});
