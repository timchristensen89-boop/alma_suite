/**
 * Restate quantities that were typed in the wrong unit (mL on bottle items,
 * g/kg on items counted by the pack) — October 2026. The same reviewed-file
 * format also carries `costs`: per-unit costs that hold a case or drum price
 * (docs/stock-case-price-fix-2026-10/case-price-fixes.json).
 *
 * Reads the reviewed list docs/stock-duplicate-resolution-2026-10/unit-fixes.json:
 * item measures, lines on the two unapplied 1 October sheets, and holdings
 * already written from such a line. Dry run by default: prints every change
 * with its evidence and what it does to stock value, and refuses the whole run
 * if any target has changed since the review. `--apply` writes, in one
 * transaction, after snapshotting every row to _stock_unit_fix_backup.
 * `--rollback <runId>` restores them and deletes the correction movements.
 *
 *   DATABASE_URL=… tsx scripts/fix-unit-entries-2026-10.ts                       # dry run
 *   DATABASE_URL=… tsx scripts/fix-unit-entries-2026-10.ts --apply
 *   DATABASE_URL=… tsx scripts/fix-unit-entries-2026-10.ts --rollback 20261017-090000   (add --force to restore over later edits)
 *   DATABASE_URL=… tsx scripts/fix-unit-entries-2026-10.ts --confidence high      # leave medium/low for a shelf check
 *   DATABASE_URL=… tsx scripts/fix-unit-entries-2026-10.ts --list-runs
 *
 * Writes to anything but a local database need --i-mean-production.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@alma/db';
import {
  applyUnitFix,
  ensureUnitFixBackupTable,
  loadUnitAliases,
  planUnitFix,
  printUnitFixPlan,
  rollbackUnitFix,
  verifyUnitFix,
  UNIT_FIX_BACKUP_TABLE,
  type Confidence,
  type UnitFixFile
} from './lib/unit-fix.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

async function main() {
  const apply = flag('--apply');
  const url = process.env.DATABASE_URL ?? '';
  const local = /@(localhost|127\.0\.0\.1|postgres|db)[:/]/.test(url) || url === '';
  if (!local && (apply || option('--rollback')) && !flag('--i-mean-production')) {
    throw new Error('DATABASE_URL is not a local database. Add --i-mean-production to write to it.');
  }
  // A tunnel to production looks like localhost, so the host alone is not
  // enough: the production database is named, and naming it needs the flag.
  const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
  const production = db === 'alma_suite_v18';
  if ((production || !local) && (apply || option('--rollback')) && !flag('--i-mean-production')) {
    throw new Error(`Connected to ${db}${production ? ' (production)' : ''}. Add --i-mean-production to write to it.`);
  }
  console.log(`database: ${db}${production ? ' — PRODUCTION' : ''}`);
  const file = option('--fixes') ?? resolve(process.cwd(), 'docs/stock-duplicate-resolution-2026-10/unit-fixes.json');
  const fixes = JSON.parse(readFileSync(file, 'utf8')) as UnitFixFile;
  const sheetIds = Object.values(fixes.sheets ?? {});

  if (flag('--list-runs')) {
    await ensureUnitFixBackupTable();
    const runs = await prisma.$queryRawUnsafe<Array<{ runId: string; started: Date; rolledBack: boolean }>>(
      `SELECT "runId", min("createdAt") AS started, bool_or(step = 'rolled_back') AS "rolledBack" FROM "${UNIT_FIX_BACKUP_TABLE}" GROUP BY 1 ORDER BY 2`
    );
    for (const r of runs) console.log(`${r.runId}  ${r.started.toISOString()}${r.rolledBack ? '  (rolled back)' : ''}`);
    return;
  }
  const rollbackRun = option('--rollback');
  if (rollbackRun) {
    await ensureUnitFixBackupTable();
    await rollbackUnitFix(rollbackRun, { force: flag('--force') });
    await verifyUnitFix(sheetIds);
    return;
  }

  await loadUnitAliases();
  const confidence = option('--confidence')?.split(',').map((c) => c.trim()) as Confidence[] | undefined;
  const plan = await planUnitFix(fixes, { confidence });
  console.log(`Unit fixes from ${file}${confidence ? ` (confidence: ${confidence.join(', ')})` : ''}${apply ? ' — APPLYING' : ' — dry run'}`);
  printUnitFixPlan(plan);
  if (plan.refusals.length) {
    console.log(`\n${plan.refusals.length} refusal(s): nothing will be written. Re-review those targets against the database and update the fixes file.`);
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply (a snapshot is taken first; --rollback <runId> restores it).');
    await verifyUnitFix(sheetIds);
    return;
  }
  await ensureUnitFixBackupTable();
  const runId = option('--run-id') ?? new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const result = await applyUnitFix(runId, plan);
  console.log(`\nApplied run ${runId}: ${plan.costs.length} cost(s), ${plan.measures.length} measure(s), ${plan.lines.length} line(s), ${plan.holdings.length} holding(s) with ${result.movementIds.length} correction movement(s).`);
  console.log(`Rollback: --rollback ${runId}`);
  await verifyUnitFix(sheetIds);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
