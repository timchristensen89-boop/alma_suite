// Rehearsal harness (read the README in docs/stock-merge-safety-2026-10): run duplicate groups
// through the safe merge on a RESTORED COPY, never production. Usage:
//   DATABASE_URL=<local copy> tsx scripts/rehearse-safe-merge.ts none|recent [groups.txt]
// Rehearsal on a restored production copy: run every current duplicate group
// through the new merge with NO decisions, then again picking the most
// recently counted record wherever a decision is needed. Measure totals,
// quantities and history before and after.
import { prisma } from '@alma/db';
import { itemsService } from '../src/services/items.service.js';
const ADMIN = { id: 'rehearsal', firstName: 'Rehearsal', lastName: '', email: 'r@local.test', isAdmin: true, role: 'ADMIN', venue: null, accountType: 'HUMAN', appAccess: [] } as never;
const q = async (sql: string) => prisma.$queryRawUnsafe<any[]>(sql);
const value = async () => q(`select v.venue, round(sum(v."onHand"*s."avgCostCents"))::float c, round(sum(v."onHand")::numeric,4)::float qty from "VenueStockItem" v join "StockItem" s on s.id=v."stockItemId" where s.status='ACTIVE' and v.venue in ('Alma Avalon','St Alma') and v."onHand" is not null and s."avgCostCents" is not null group by 1 order by 1`);
const history = async () => (await q(`select md5(string_agg(row(id,"stocktakeId","countedQty","stockValueCents",notes,unit,label)::text, ',' order by id)) h, count(*)::int n from "StocktakeLine"`))[0];
const moves = async () => (await q(`select md5(string_agg(row(id,"quantityBefore","quantityAfter","quantityDelta","sourceStocktakeLineId",unit)::text, ',' order by id)) h, count(*)::int n from "InventoryMovement" where "movementType" <> 'STOCKTAKE_CORRECTION'`))[0];
const mode = process.argv[2] ?? 'none';
const [{ db }] = await prisma.$queryRawUnsafe<Array<{ db: string }>>('SELECT current_database() AS db');
if (db === 'alma_suite_v18' || !/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) throw new Error('Rehearsals run on a local restored copy only.');
const before = { value: await value(), history: await history(), moves: await moves() };
const fs = await import('node:fs');
const groupFile = process.argv[3];
const report = groupFile
  ? { groups: fs.readFileSync(groupFile, 'utf8').trim().split('\n').map((line: string) => { const [parent, ...rest] = line.split(','); return { suggestedParentId: parent!, items: [parent!, ...rest].map((id) => ({ id, name: id })) }; }) }
  : await itemsService.duplicates();
let merged = 0, refusedDecision = 0, blocked = 0, other = 0; const notes: string[] = [];
let raisedVenue = 0;
for (const g of report.groups) {
  const parentId = g.suggestedParentId; const dups = g.items.filter((i) => i.id !== parentId).map((i) => i.id);
  let preview;
  try { preview = await itemsService.previewMerge({ parentId, duplicateIds: dups }, ADMIN); } catch (e: any) { other++; notes.push(`preview ${g.items[0]?.name}: ${e.message}`); continue; }
  if (preview.blockers.length) { blocked++; notes.push(`blocked ${preview.parentName}: ${preview.blockers[0]}`); continue; }
  const needs = preview.venues.filter((v) => v.needsDecision);
  let holdings: any[] | undefined;
  if (needs.length) {
    if (mode === 'none') { refusedDecision++; continue; }
    holdings = needs.map((v) => {
      const pick = v.members.find((m) => m.itemId === v.suggestedItemId && m.onHandInKeptUnit !== null) ?? v.members.find((m) => m.isKept)!;
      return pick.isKept ? { venue: v.venue, keep: 'keep' } : { venue: v.venue, keep: 'duplicate', itemId: pick.itemId };
    });
  }
  const venueMax = new Map(preview.venues.map((v) => [v.venue, Math.max(0, ...v.members.map((m) => m.onHandInKeptUnit ?? (m.isKept ? m.onHand ?? 0 : 0)))]));
  try {
    const r = await itemsService.mergeItems({ parentId, duplicateIds: dups, confirmationText: 'MERGE ITEMS', holdings, planToken: preview.planToken }, ADMIN);
    merged++;
    for (const h of r.holdings ?? []) if ((h.after ?? 0) > (venueMax.get(h.venue) ?? 0) + 1e-9) { raisedVenue++; notes.push(`RAISED ${preview.parentName} @ ${h.venue}: ${h.after} > ${venueMax.get(h.venue)}`); }
  } catch (e: any) { other++; notes.push(`merge ${preview.parentName}: ${e.message}`); }
}
const after = { value: await value(), history: await history(), moves: await moves() };
console.log(JSON.stringify({ mode, groups: report.groups.length, merged, needDecision: refusedDecision, blocked, errors: other, raisedVenue, before: before.value, after: after.value,
  historyIdentical: before.history.h === after.history.h, lines: [before.history.n, after.history.n], movementsIdentical: before.moves.h === after.moves.h }, null, 1));
for (const n of notes.slice(0, 15)) console.log(' -', n);
await prisma.$disconnect();
