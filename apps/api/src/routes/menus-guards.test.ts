import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

/**
 * Every route under /api/menus must name its venue guard. This reads the two
 * route files and checks each registration, so a new route cannot be added
 * without deciding who may reach it — the kind of omission that reads fine
 * in review and opens the other venue's menus to a limited grant.
 *
 * Rules:
 *   - the module homes (GET '/') filter their payload by scope instead;
 *   - every other GET names a read guard (readMenu / readVersion /
 *     readPromotion);
 *   - every POST/PUT/PATCH/DELETE names a read guard or a publisher guard
 *     (publishMenu / publishPromotion / requireMenuPublisherFor(...)).
 */
const here = dirname(fileURLToPath(import.meta.url));

type Route = { method: string; path: string; guard: string | null; file: string };

function routesOf(file: string, router: string): Route[] {
  const source = readFileSync(join(here, file), 'utf8');
  const pattern = new RegExp(`${router}\\.(get|post|put|patch|delete)\\(\\s*(['\`][^'\`]+['\`])\\s*,\\s*([A-Za-z_][A-Za-z0-9_]*(?:\\([^)]*\\))?)?`, 'g');
  const routes: Route[] = [];
  for (const match of source.matchAll(pattern)) {
    const method = match[1] ?? '';
    const path = match[2] ?? '';
    const guard = match[3];
    routes.push({ method, path, guard: guard && guard !== 'async' ? guard : null, file });
  }
  return routes;
}

const READ_GUARDS = ['readMenu', 'readVersion', 'readPromotion'];
const isPublishGuard = (guard: string) => guard === 'publishMenu' || guard === 'publishPromotion' || guard.startsWith('requireMenuPublisherFor(');

describe('every /api/menus route names its venue guard', () => {
  const routes = [...routesOf('menus.ts', 'menusRouter'), ...routesOf('promotions.ts', 'promotionsRouter')];

  it('finds the routes it expects to audit', () => {
    assert.ok(routes.length >= 25, `only ${routes.length} routes matched — the audit regex no longer fits the route files`);
    assert.ok(routes.some((route) => route.path.includes('draft/publish')));
    assert.ok(routes.some((route) => route.path.includes('promotionId}/${action}') || route.path.includes(':promotionId/${action}')));
  });

  for (const route of routes) {
    const label = `${route.file} ${route.method.toUpperCase()} ${route.path}`;
    if (route.path === "'/'" && route.method === 'get') {
      it(`${label} filters by scope in the handler`, () => {
        const source = readFileSync(join(here, route.file), 'utf8');
        assert.match(source, /canAccessMenuVenue\(/, `${route.file} home must filter with canAccessMenuVenue`);
      });
      continue;
    }
    it(`${label} is guarded`, () => {
      assert.ok(route.guard, `${label} has no guard`);
      const guard = route.guard as string;
      if (route.method === 'get') assert.ok(READ_GUARDS.includes(guard), `${label} uses ${guard}, expected a read guard`);
      else assert.ok(READ_GUARDS.includes(guard) || isPublishGuard(guard), `${label} uses ${guard}, expected a read or publisher guard`);
    });
  }

  it('publishing, adding, renaming, archiving, hiding and ending are publisher-guarded', () => {
    const mustPublish = routes.filter((route) =>
      /draft\/publish|\/archive|\/unarchive|promotionId\/publish|\${action}/.test(route.path) ||
      (route.method === 'patch' && route.path === "'/:menuId'") ||
      (route.method === 'post' && route.path === "'/'")
    );
    assert.ok(mustPublish.length >= 7, `expected the publish/manage routes, found ${mustPublish.length}`);
    for (const route of mustPublish) assert.ok(route.guard && isPublishGuard(route.guard), `${route.file} ${route.method} ${route.path} must be publisher-guarded`);
  });
});
