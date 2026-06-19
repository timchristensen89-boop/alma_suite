#!/usr/bin/env node
/**
 * Domain boundary guard.
 *
 * Reads packages/db/domain-map.json and flags any app that directly accesses a
 * Prisma model belonging to a domain it does not own. This is the enforcement
 * mechanism for the stock-forward separation: it keeps the suite from reaching
 * back into stock's tables (and, later, into the extracted workforce engine's).
 *
 * Detection: `prisma.<model>`, `tx.<model>`, `db.<model>` accessor calls.
 * Mode: WARN by default (exit 0). Pass --strict to exit 1 on any violation.
 *
 * Usage:
 *   node scripts/check-domain-boundaries.mjs
 *   node scripts/check-domain-boundaries.mjs --strict
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STRICT = process.argv.includes('--strict');

const map = JSON.parse(readFileSync(join(ROOT, 'packages/db/domain-map.json'), 'utf8'));
const modelDomain = map.models; // { ModelName: domain }
const appOwnership = map.appOwnership; // { "apps/x": [domains] }

// accessor (camelCase) -> domain
const accessorDomain = {};
for (const [model, domain] of Object.entries(modelDomain)) {
  const accessor = model.charAt(0).toLowerCase() + model.slice(1);
  accessorDomain[accessor] = domain;
}

const IGNORE_DIRS = new Set(['node_modules', 'dist', '.next', 'build', 'tests', '__tests__', '.git']);
const CODE_RE = /\.(ts|tsx|js|jsx|mjs)$/;
const ACCESS_RE = /\b(?:prisma|tx|db)\.([a-z][A-Za-z0-9]*)\b/g;

function walk(dir, acc) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (CODE_RE.test(entry)) acc.push(full);
  }
}

function appOf(relPath) {
  const m = relPath.match(/^(apps\/[^/]+|packages\/[^/]+)/);
  return m ? m[1] : null;
}

const files = [];
for (const base of ['apps', 'packages']) {
  const p = join(ROOT, base);
  try { walk(p, files); } catch {}
}

// Maintenance code legitimately touches any table: one-off scripts, Prisma
// migrations/seeds. These are not the running app, so exclude them from the
// runtime boundary policy (but count them so the exclusion is visible).
const MAINTENANCE_RE = /(^|\/)scripts\/|^packages\/db\/(prisma|dist)\//;
let maintenanceSkipped = 0;

const violations = []; // {app, file, accessor, domain, line, count}
for (const file of files) {
  const rel = relative(ROOT, file);
  const app = appOf(rel);
  if (!app) continue;
  if (MAINTENANCE_RE.test(rel)) { maintenanceSkipped++; continue; }
  const allowed = appOwnership[app];
  if (!allowed) continue; // app not governed
  if (allowed.includes('allowAll')) continue;

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, idx) => {
    // Ignore comments so prose like "prisma.stockItem" in docs isn't flagged.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
    const code = line.split('//')[0];
    let m;
    ACCESS_RE.lastIndex = 0;
    while ((m = ACCESS_RE.exec(code)) !== null) {
      const accessor = m[1];
      const domain = accessorDomain[accessor];
      if (!domain) continue; // not a known model accessor
      if (allowed.includes(domain)) continue; // permitted
      violations.push({ app, file: rel, accessor, domain, line: idx + 1 });
    }
  });
}

// ---- Report ----
const byApp = {};
for (const v of violations) {
  byApp[v.app] ??= {};
  byApp[v.app][v.domain] ??= { count: 0, files: {} };
  byApp[v.app][v.domain].count++;
  byApp[v.app][v.domain].files[v.file] ??= [];
  byApp[v.app][v.domain].files[v.file].push(`${v.accessor}@${v.line}`);
}

console.log('\n=== Domain Boundary Guard ===');
console.log(`Mode: ${STRICT ? 'STRICT (fail on violation)' : 'WARN (report only)'}`);
console.log(`Scanned ${files.length} files (${maintenanceSkipped} maintenance files excluded). Found ${violations.length} runtime cross-domain accesses.\n`);

if (violations.length === 0) {
  console.log('No boundary violations. ✅');
  process.exit(0);
}

const appNames = Object.keys(byApp).sort();
for (const app of appNames) {
  const allowed = appOwnership[app];
  console.log(`▶ ${app}  (owns: ${allowed.join(', ') || 'none'})`);
  for (const domain of Object.keys(byApp[app]).sort()) {
    const d = byApp[app][domain];
    console.log(`   ✗ accesses '${domain}' domain — ${d.count} call(s):`);
    for (const f of Object.keys(d.files).sort()) {
      console.log(`       ${f}  [${d.files[f].join(', ')}]`);
    }
  }
  console.log('');
}

// Priority hint: biggest offenders
const fileTotals = {};
for (const v of violations) fileTotals[v.file] = (fileTotals[v.file] ?? 0) + 1;
const top = Object.entries(fileTotals).sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log('Top files to route through an owning API first:');
for (const [f, n] of top) console.log(`   ${n.toString().padStart(3)}  ${f}`);
console.log('');

process.exit(STRICT ? 1 : 0);
