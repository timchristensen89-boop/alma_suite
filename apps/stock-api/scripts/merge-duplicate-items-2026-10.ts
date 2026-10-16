/**
 * Resolve the duplicate stock items found by the October 2026 audit.
 *
 * Reads a REVIEWED decisions file (docs/stock-duplicate-resolution-2026-10/
 * decisions.json — one entry per cluster Tim has approved), and for each:
 *
 *   1. snapshots every row the merge will touch into _stock_merge_backup;
 *   2. applies the decision's pre-merge treatments — a twin's STALE venue
 *      holding is set to 0 (never summed into the survivor), and a duplicate
 *      line on a sheet where the survivor was counted too is emptied (never
 *      double counted);
 *   3. calls itemsService.mergeItems, the same merge the Items page runs, so
 *      recipes, invoices, aliases, movements, stocktake lines and venue stock
 *      all repoint to the survivor and the twins are archived — nothing is
 *      deleted from history;
 *   4. records what moved.
 *
 * Dry run by default: prints the plan with before/after holdings and refuses
 * anything unsafe. `--apply` writes. `--rollback <runId>` restores every
 * cluster of that run from its snapshot, newest first. `--only 12,40` limits
 * to those cluster indices.
 *
 *   DATABASE_URL=… ./apps/stock-api/node_modules/.bin/tsx apps/stock-api/scripts/merge-duplicate-items-2026-10.ts
 *   DATABASE_URL=… … --apply
 *   DATABASE_URL=… … --rollback 20261016-143000      (add --force to restore over rows created since the merge)
 *   DATABASE_URL=… … --list-runs
 *
 * Writes to anything but a local database need --i-mean-production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import { applyCluster, checkRun, dollars, ensureBackupTable, planCluster, printPlan, rollback, verify, type Decision, type Plan, BACKUP_TABLE } from './lib/duplicate-merge.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

async function main() {
  const apply = flag('--apply');
  // A merge against production is a deliberate act, named as such.
  const url = process.env.DATABASE_URL ?? '';
  const local = /@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(url) || url === '';
  if (!local && (apply || option('--rollback')) && !flag('--i-mean-production')) {
    throw new Error('DATABASE_URL is not a local database. Add --i-mean-production to write to it.');
  }
  if (flag('--list-runs')) {
    await ensureBackupTable();
    const runs = await prisma.$queryRawUnsafe<Array<{ runId: string; clusters: number; started: Date }>>(`SELECT "runId", count(distinct "clusterIndex")::int AS clusters, min("createdAt") AS started FROM "${BACKUP_TABLE}" GROUP BY 1 ORDER BY 3`);
    for (const r of runs) console.log(`${r.runId}  ${r.clusters} clusters  ${r.started.toISOString()}`);
    return;
  }
  const rollbackRun = option('--rollback');
  if (rollbackRun) {
    await ensureBackupTable();
    await rollback(rollbackRun, { force: flag('--force') });
    await verify();
    return;
  }
  const file = option('--decisions') ?? resolve(process.cwd(), 'docs/stock-duplicate-resolution-2026-10/decisions.json');
  const decisions = (JSON.parse(readFileSync(file, 'utf8')) as Decision[]).filter((d) => d.action === 'merge' || d.action === 'merge_partial');
  const only = option('--only')?.split(',').map((value) => Number(value.trim())).filter((n) => Number.isFinite(n));
  const chosen = only?.length ? decisions.filter((d) => only.includes(d.index)) : decisions;
  const runProblems = checkRun(chosen);
  for (const problem of runProblems) console.error(`REFUSED (whole run): ${problem}`);
  if (runProblems.length) {
    process.exitCode = 1;
    return;
  }
  console.log(`${chosen.length} merge decision${chosen.length === 1 ? '' : 's'} from ${file}${apply ? ' — APPLYING' : ' — dry run'}`);

  const plans: Plan[] = [];
  for (const d of chosen) plans.push(await planCluster(d));
  for (const plan of plans) printPlan(plan, apply);
  const refused = plans.filter((p) => !p.check.ok);
  const ready = plans.filter((p) => p.check.ok);
  const discardedCents = ready.reduce((sum, p) => sum + p.discarded.reduce((acc, x) => acc + x.valueCents, 0), 0);
  const recountCents = ready.reduce((sum, p) => sum + p.recount.reduce((acc, x) => acc + x.valueCents, 0), 0);
  console.log(`\n${ready.length} ready, ${refused.length} refused. Stale holdings to discard: ${dollars(discardedCents)}; carried across for recount: ${dollars(recountCents)}.`);
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply to merge (a snapshot is taken first; --rollback <runId> restores it).');
    return;
  }
  await ensureBackupTable();
  const runId = option('--run-id') ?? new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  console.log(`run id ${runId}`);
  let done = 0;
  for (const plan of ready) {
    try {
      const result = await applyCluster(runId, plan);
      done += 1;
      console.log(`  #${plan.d.index} merged: lines ${result.moved.stocktakeLines}, recipes ${result.moved.recipeLines}, invoices ${result.moved.invoiceLines}, movements ${result.moved.movements}, aliases ${result.moved.aliases}`);
    } catch (error) {
      console.error(`  #${plan.d.index} FAILED: ${error instanceof Error ? error.message : String(error)}`);
      console.error(`  stopping. Roll back what was applied with --rollback ${runId}`);
      break;
    }
  }
  console.log(`\nApplied ${done} of ${ready.length}. Rollback: --rollback ${runId}`);
  await verify();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
