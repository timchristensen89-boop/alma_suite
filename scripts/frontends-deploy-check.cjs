#!/usr/bin/env node
// Which suite frontends are live with STALE code?
//
// The frontends don't auto-deploy: a PR merged on GitHub reaches the venues
// only when someone rebuilds and runs `firebase deploy` from a Mac. On
// 2026-08-15 the gift cards app sat one deploy behind for a whole shift with
// nobody the wiser. This script makes that visible in one command.
//
// How: `stamp` writes dist/version.json ({commit, builtAt}) into every built
// app — run it after building, before deploying. `check` (default) fetches
// /version.json from each live site and compares to the current HEAD.
//
//   node scripts/frontends-deploy-check.cjs            # check live sites
//   node scripts/frontends-deploy-check.cjs stamp      # after `pnpm build`
//
// Exit code 1 when any site is stale or unstamped, so it can gate a deploy.
//
// WHY .cjs AND NOT .mjs. firebase.json runs `stamp` as a hosting predeploy
// hook, and the firebase CLI most people install on a Mac is the standalone
// pkg binary: it carries its own embedded Node and starts a predeploy script
// through require(), which cannot load an ES module. As .mjs this failed
// EVERY deploy with ERR_REQUIRE_ESM — the check meant to stop stale frontends
// shipping was itself stopping every frontend from shipping. CommonJS runs
// under both that loader and a normal node, so it stays CommonJS.
const { execSync } = require('node:child_process');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const firebase = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
const sites = firebase.hosting.map((entry) => ({ site: entry.site, dist: entry.public }));

const head = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
const headShort = head.slice(0, 7);

function stamp() {
  let stamped = 0;
  for (const { site, dist } of sites) {
    const dir = join(root, dist);
    if (!existsSync(dir)) continue; // not built this round — fine
    writeFileSync(
      join(dir, 'version.json'),
      JSON.stringify({ commit: head, builtAt: new Date().toISOString(), site }, null, 2)
    );
    stamped += 1;
  }
  console.log(`stamped ${stamped}/${sites.length} built dists with ${headShort}`);
}

/** Commits reachable from HEAD that touch this app's directory since `commit`. */
function changesSince(commit, dist) {
  const appDir = dist.replace(/\/dist$/, '');
  try {
    // Shared packages change app behaviour too — include them.
    const out = execSync(
      `git log --oneline ${commit}..HEAD -- ${appDir} packages/shared packages/ui 2>/dev/null`,
      { cwd: root }
    )
      .toString()
      .trim();
    return out ? out.split('\n') : [];
  } catch {
    return null; // commit unknown locally (e.g. built from a branch we don't have)
  }
}

async function check() {
  let stale = 0;
  const rows = [];
  for (const { site, dist } of sites) {
    const url = `https://${site}.web.app/version.json`;
    let live;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      live = await res.json();
    } catch {
      rows.push([site, 'UNSTAMPED', '—', 'live build predates the stamp step — deploy once with stamp']);
      stale += 1;
      continue;
    }
    const liveShort = String(live.commit ?? '').slice(0, 7);
    if (live.commit === head) {
      rows.push([site, 'current', liveShort, '']);
      continue;
    }
    const pending = changesSince(live.commit, dist);
    if (pending === null) {
      rows.push([site, 'UNKNOWN', liveShort, 'live commit not in local history']);
      stale += 1;
    } else if (pending.length === 0) {
      rows.push([site, 'current', liveShort, 'older commit, but nothing for this app changed since']);
    } else {
      rows.push([site, 'STALE', liveShort, `${pending.length} pending: ${pending[0]}${pending.length > 1 ? ' …' : ''}`]);
      stale += 1;
    }
  }
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log(`HEAD ${headShort}\n`);
  for (const [site, status, commit, note] of rows) {
    console.log(`${site.padEnd(w)}  ${status.padEnd(9)}  ${commit.padEnd(7)}  ${note}`);
  }
  console.log(`\n${stale === 0 ? 'all frontends current' : `${stale} site(s) need a deploy`}`);
  process.exit(stale === 0 ? 0 : 1);
}

if (process.argv[2] === 'stamp') {
  stamp();
} else {
  check().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
