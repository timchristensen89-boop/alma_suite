import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The migration history has to replay from an EMPTY database, because that is
 * what `pnpm db:migrate` does on a new machine — db:prepare creates a blank
 * database and Prisma applies all of them in name order.
 *
 * Production never exercises that. There, `migrate deploy` only ever applies
 * what is pending, in whatever order the migrations were authored, and it does
 * not re-sort or re-check what it has already done. So a migration can be
 * timestamped earlier than the one it depends on, work perfectly in production
 * forever, and still make a fresh checkout unbuildable.
 *
 * That is exactly what happened: 20260809150000_pos_venue_identity ALTERs
 * "PosVenueSetting", and 20260809160000_pos_fusion — which sorts LATER —
 * creates it. Production applied pos_fusion first in wall-clock time and never
 * noticed. A fresh database stopped dead at the ALTER, and the whole chain with
 * it.
 *
 * This test is the cheap version of that discovery: pure file reading, no
 * database, so it catches the same mistake the next time somebody hand-writes
 * a timestamp or copies a migration folder.
 */

const MIGRATIONS = join(import.meta.dirname, 'migrations');

type Op = { migration: string; table: string; creates: boolean };

function readOperations(): Op[] {
  const ops: Op[] = [];
  for (const name of readdirSync(MIGRATIONS).sort()) {
    let sql: string;
    try {
      sql = readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8');
    } catch {
      continue; // not a migration directory
    }
    // Strip line comments so a table named only in prose doesn't count.
    const body = sql.replace(/^\s*--.*$/gm, '');
    for (const match of body.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"/g)) {
      ops.push({ migration: name, table: match[1], creates: true });
    }
    for (const match of body.matchAll(/ALTER TABLE (?:ONLY )?"([^"]+)"/g)) {
      ops.push({ migration: name, table: match[1], creates: false });
    }
  }
  return ops;
}

test('no migration alters a table before one creates it', () => {
  const ops = readOperations();
  const createdBy = new Map<string, string>();
  for (const op of ops) {
    if (op.creates && !createdBy.has(op.table)) createdBy.set(op.table, op.migration);
  }

  const tooEarly: string[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    if (op.creates) { seen.add(op.table); continue; }
    // A table nothing ever creates is inherited from before this history began
    // (the v17 database it was cut from), which is fine — it exists everywhere
    // the history is ever replayed against. The bug is only ever ordering.
    if (!createdBy.has(op.table)) continue;
    if (!seen.has(op.table)) {
      tooEarly.push(`${op.migration} alters "${op.table}", which ${createdBy.get(op.table)} creates later`);
    }
  }

  assert.deepEqual(
    tooEarly,
    [],
    `A fresh database replays these in name order and will stop here:\n  ${tooEarly.join('\n  ')}\n\n` +
      'Fix by making both migrations order-independent (CREATE TABLE IF NOT EXISTS / ' +
      'ADD COLUMN IF NOT EXISTS) rather than by renaming a directory — the old name is ' +
      'recorded in production\'s _prisma_migrations and renaming it strands that row.'
  );
});

test('every migration directory holds a migration.sql', () => {
  const missing = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        readFileSync(join(MIGRATIONS, entry.name, 'migration.sql'));
        return false;
      } catch {
        return true;
      }
    })
    .map((entry) => entry.name);
  assert.deepEqual(missing, [], 'Prisma treats a directory with no migration.sql as a failed migration.');
});
