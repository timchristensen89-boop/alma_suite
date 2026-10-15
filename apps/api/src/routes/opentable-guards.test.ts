import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Every venue route under /api/integrations/opentable must name its venue
 * guard, and the one route that writes menus to OpenTable must name the
 * publisher guard. Same idea as menus-guards.test.ts: a route added without
 * deciding who may reach it fails here, not in production.
 */
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, 'opentable.ts'), 'utf8');

type Route = { method: string; path: string; guard: string | null };

function routes(): Route[] {
  const pattern = /openTableRouter\.(get|post|put|patch|delete)\(\s*'([^']+)'\s*,\s*([A-Za-z_][A-Za-z0-9_]*)?/g;
  const found: Route[] = [];
  for (const match of source.matchAll(pattern)) {
    const guard = match[3];
    found.push({ method: match[1] ?? '', path: match[2] ?? '', guard: guard && guard !== 'async' ? guard : null });
  }
  return found;
}

describe('every OpenTable venue route names its guard', () => {
  it('registers the admin-only gate for the whole router (isAdmin, not a settings grant)', () => {
    assert.match(source, /openTableRouter\.use\(requireAdmin\)/);
    assert.doesNotMatch(source, /requireSettingsAdmin|requireManager/);
  });

  it('scopes every /venues/:venueId route to the user’s Menus venues', () => {
    const all = routes();
    assert.ok(all.length >= 10, `expected the full route set, found ${all.length}`);
    for (const route of all) {
      if (route.path === '/') continue;
      assert.ok(route.path.startsWith('/venues/:venueId'), `${route.method.toUpperCase()} ${route.path} is not venue-addressed`);
      assert.ok(route.guard === 'venueScope' || route.guard === 'venuePublisher', `${route.method.toUpperCase()} ${route.path} names no venue guard`);
    }
  });

  it('requires a venue publisher for the menu push and only there', () => {
    const publishers = routes().filter((route) => route.guard === 'venuePublisher');
    assert.deepEqual(publishers.map((route) => `${route.method} ${route.path}`), ['post /venues/:venueId/menus/publish']);
  });
});
