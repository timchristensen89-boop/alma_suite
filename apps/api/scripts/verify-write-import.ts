/**
 * WRITE-parity test (state-snapshot methodology).
 *
 * Writes can't be shadow-diffed (running twice mutates state), so instead:
 * reset → run OLD path → snapshot → reset → run NEW path → snapshot → compare.
 *
 * Here: the suite's loaded-import.commitItemImport (OLD) vs stock-api's
 * loaded-import.commitItemImport (NEW, the delegate target) must produce the
 * IDENTICAL stock items for clean CSV data. (The services have diverged in
 * preview warnings / outlier detection — see docs/WRITE_PATHS.md — but the
 * committed item rows for clean data must match for the delegate to be safe.)
 *
 * Run with DATABASE_URL set:
 *   node --import tsx apps/api/scripts/verify-write-import.ts
 */
import assert from 'node:assert';
import { prisma } from '@alma/db';
import { loadedImportService as suiteImport } from '../src/services/loaded-import.service.js';
import { loadedImportService as stockImport } from '../../stock-api/src/services/loaded-import.service.js';

const actor = { isAdmin: true } as any;
const csv = ['name,category,unit', 'WTEST Flour,WTEST Cat,kg', 'WTEST Butter,WTEST Cat,kg', 'WTEST Salt,WTEST Cat,each'].join('\n');

async function reset() {
  await prisma.stockItem.deleteMany({ where: { name: { startsWith: 'WTEST' } } });
  await prisma.stockCategory.deleteMany({ where: { name: 'WTEST Cat' } });
}
async function snapshot() {
  const items = await prisma.stockItem.findMany({
    where: { name: { startsWith: 'WTEST' } },
    select: { name: true, unit: true, category: { select: { name: true } } },
    orderBy: { name: 'asc' }
  });
  return items.map((i) => ({ name: i.name, unit: i.unit, category: i.category?.name ?? null }));
}

async function main() {
  await reset();
  const rA = await suiteImport.commitItemImport(actor, csv);
  const snapA = await snapshot();

  await reset();
  const rB = await stockImport.commitItemImport(actor, csv);
  const snapB = await snapshot();

  console.log('suite  commit:', JSON.stringify(rA));
  console.log('stock  commit:', JSON.stringify(rB));
  console.log('suite  items :', JSON.stringify(snapA));
  console.log('stock  items :', JSON.stringify(snapB));

  assert.deepEqual(snapB, snapA, 'committed stock items differ between suite and stock-api import');
  assert.equal(snapA.length, 3, `expected 3 items committed, got ${snapA.length}`);
  assert.equal(rA.created, 3, `suite created should be 3, got ${rA.created}`);
  assert.equal(rB.created, 3, `stock created should be 3, got ${rB.created}`);

  await reset();
  console.log('WRITE PARITY OK ✅ — suite & stock-api imports commit identical items (clean data); delegate is data-safe');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('WRITE PARITY FAILED ❌');
  console.error(e);
  try { await reset(); await prisma.$disconnect(); } catch {}
  process.exit(1);
});
