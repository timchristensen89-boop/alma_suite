/**
 * Import a count out of a Loaded PDF export.
 *
 * Counting is the last thing still living in Loaded, and the only way out is
 * the PDF export. This reads one, checks the parse against the sheet's own
 * printed totals, matches each line to an Alma stock item, and — with --apply —
 * writes it in as a stocktake ready to review.
 *
 *   node --import tsx scripts/import-loaded-stocktake.ts <file.pdf>
 *   node --import tsx scripts/import-loaded-stocktake.ts <file.pdf> --apply
 *
 * It refuses to write when the parse does not reconcile, and refuses to write a
 * blank sheet at all — the St Alma food sheet dated 2/08 lists 81 items and has
 * not one of them counted, and importing it would zero the venue's food.
 *
 * The stocktake lands as IN_PROGRESS, not applied. A count that came in through
 * a script still gets looked at by a person before it moves stock on hand.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { prisma } from '@alma/db';
import {
  parseLoadedStocktake,
  aliasKey,
  catalogueKey,
  valuationOutliers,
  reconcileWithEvidence,
  type PdfRow
} from '@alma/shared';

/**
 * Pull the PDF back into rows: text runs grouped by line, ordered left to right.
 *
 * Accepts a `.json` file of pre-extracted rows as well, so the reading and the
 * importing can happen in different places — the API image has no PDF reader,
 * and this ran against production before it had one.
 */
async function pdfRows(path: string): Promise<PdfRow[]> {
  if (path.endsWith('.json')) {
    return JSON.parse(readFileSync(path, 'utf8')) as PdfRow[];
  }
  // Built at runtime so the bundler cannot hoist it: the API image carries no
  // PDF reader, and this script must still run there against a .json.
  const pdfjs = 'pdfjs-dist/legacy/build/pdf.mjs';
  const { getDocument } = (await import(pdfjs)) as typeof import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true }).promise;
  const rows: PdfRow[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    /** Rounded because glyphs on one line jitter a fraction of a point. */
    const byLine = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]! * 2) / 2;
      if (!byLine.has(y)) byLine.set(y, []);
      byLine.get(y)!.push({ x: item.transform[4]!, str: item.str });
    }
    for (const [, cells] of [...byLine.entries()].sort((a, b) => b[0] - a[0])) {
      rows.push(cells.sort((a, b) => a.x - b.x).map((c) => c.str));
    }
  }
  return rows;
}

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function main() {
  const path = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!path) throw new Error('Usage: import-loaded-stocktake.ts <file.pdf> [--apply]');

  const sheet = parseLoadedStocktake(await pdfRows(path));

  console.log(`\n${basename(path)}`);
  console.log(`  Venue      ${sheet.venue ?? '(none found)'}`);
  console.log(`  Counted    ${sheet.countedAtText ?? '(none found)'} by ${sheet.countedBy ?? '(unknown)'}`);
  console.log(`  Lines      ${sheet.lines.length}`);
  console.log(`  Value      ${money(sheet.summedTotalCents)}${
    sheet.printedTotalCents !== null ? ` (sheet prints ${money(sheet.printedTotalCents)})` : ''
  }`);

  if (sheet.isBlank) {
    console.log('\n  This is a BLANK count sheet — every quantity is zero. Nothing to import.');
    console.log('  Importing it would set the whole venue to zero. Refusing.');
    return;
  }
  if (sheet.discrepancies.length > 0) {
    console.log('\n  The parse does not reconcile with the sheet:');
    for (const line of sheet.discrepancies) console.log(`    - ${line}`);
    console.log('  Refusing to import a count we cannot read correctly.');
    process.exitCode = 1;
    return;
  }
  console.log(`  Reconciles against all ${sheet.categoryTotals.length} category totals and the sheet total.`);

  // Match to Alma's catalogue. Exact name first, then the same normalised key
  // the invoice matcher uses, so the two paths agree on what "the same item" is.
  const items = await prisma.stockItem.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      name: true,
      countUnit: true,
      unit: true,
      avgCostCents: true,
      measurePerCountUnit: true,
      measureUnit: true
    }
  });
  const byExact = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const index = (key: (name: string) => string) => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const k = key(item.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(item);
    }
    return map;
  };
  const byAlias = index(aliasKey);
  const byCatalogue = index(catalogueKey);

  // Wordings already recorded against an item — including the ones the
  // catalogue backfill wrote, so a name reconciled once stays reconciled.
  const byId = new Map(items.map((i) => [i.id, i]));
  const recorded = new Map<string, (typeof items)[number]>();
  for (const alias of await prisma.stockItemAlias.findMany({ select: { aliasKey: true, stockItemId: true } })) {
    const item = byId.get(alias.stockItemId);
    if (item) recorded.set(alias.aliasKey, item);
  }

  const matched: Array<{ item: (typeof items)[number]; line: (typeof sheet.lines)[number] }> = [];
  const unmatched: typeof sheet.lines = [];
  const ambiguous: Array<{ line: (typeof sheet.lines)[number]; candidates: string[] }> = [];
  for (const line of sheet.lines) {
    const exact = byExact.get(line.name.trim().toLowerCase());
    // Only trust a normalised key when it points at exactly one item. Where it
    // points at several, Alma holds the same wine twice and picking one would
    // be a guess with a price on it.
    const alias = byAlias.get(aliasKey(line.name));
    const loose = byCatalogue.get(catalogueKey(line.name));
    const hit =
      exact ??
      recorded.get(aliasKey(line.name)) ??
      (alias?.length === 1 ? alias[0] : undefined) ??
      (loose?.length === 1 ? loose[0] : undefined);
    if (hit) {
      matched.push({ item: hit, line });
    } else {
      unmatched.push(line);
      const candidates = (loose?.length ?? 0) > 1 ? loose! : [];
      if (candidates.length > 0) ambiguous.push({ line, candidates: candidates.map((c) => c.name) });
    }
  }

  const matchedValue = matched.reduce((t, m) => t + m.line.valueCents, 0);
  console.log(
    `\n  Matched    ${matched.length}/${sheet.lines.length} lines (${(
      (matched.length / sheet.lines.length) * 100
    ).toFixed(1)}%), ${money(matchedValue)} of ${money(sheet.summedTotalCents)} by value`
  );

  if (unmatched.length > 0) {
    console.log(`\n  Not in the Alma catalogue (${unmatched.length}) — these would be dropped:`);
    for (const line of [...unmatched].sort((a, b) => b.valueCents - a.valueCents).slice(0, 20)) {
      console.log(`    ${money(line.valueCents).padStart(12)}  ${line.quantity.toFixed(2).padStart(9)} ${line.unit.padEnd(9)} ${line.name}`);
    }
    if (unmatched.length > 20) console.log(`    …and ${unmatched.length - 20} more`);
  }

  if (ambiguous.length > 0) {
    console.log(`\n  Alma holds these twice — merge them, then re-import (${ambiguous.length}):`);
    for (const a of ambiguous) console.log(`    ${a.line.name}\n      ${a.candidates.join('\n      ')}`);
  }

  // Reconcile the unit each line was counted in. Loaded counts four of these
  // items in millilitres where Alma counts bottles; copying the raw number
  // across is what put $1.13M of gin on the books.
  const reconciled = matched.map((m) => ({
    ...m,
    unit: reconcileWithEvidence(
      m.line.unit,
      m.line.quantity,
      {
        countUnit: m.item.countUnit ?? m.item.unit,
        measurePerCountUnit: m.item.measurePerCountUnit,
        measureUnit: m.item.measureUnit,
        unitCostCents: m.item.avgCostCents
      },
      m.line.valueCents
    )
  }));

  const convertedLines = reconciled.filter((r) => r.unit.converted);
  if (convertedLines.length > 0) {
    console.log(`\n  Counted in a different unit to Alma's — converted (${convertedLines.length}):`);
    for (const r of convertedLines) {
      console.log(`    ${r.item.name.padEnd(40)} ${r.unit.note}`);
    }
  }

  const unconvertible = reconciled.filter((r) => r.unit.warning);
  if (unconvertible.length > 0) {
    console.log(`\n  Unresolved — no cost to judge the unit by (${unconvertible.length}):`);
    for (const r of unconvertible) console.log(`    ${r.item.name}\n      ${r.unit.warning}`);
  }

  // Check each line against Loaded's own valuation of it. The counting screen's
  // out-of-scale check asks whether a line looks large next to its neighbours,
  // which is the best it can do while counting; here there is something better
  // to compare against, and it does not care that only half the sheet matched.
  const suspect = valuationOutliers(
    reconciled.map((m) => ({
      name: m.item.name,
      loadedCents: m.line.valueCents,
      almaCents: Math.round(m.unit.quantity * (m.item.avgCostCents ?? 0))
    }))
  );
  if (suspect.length > 0) {
    console.log(`\n  Alma and Loaded disagree on these — check before applying (${suspect.length}):`);
    for (const line of suspect) console.log(`    ${line.name}\n      ${line.message}`);
  } else {
    console.log('\n  Every matched line agrees with what Loaded valued it at.');
  }

  if (!apply) {
    console.log('\n  Dry run. Re-run with --apply to write it in as a stocktake to review.\n');
    return;
  }

  const countedAt = new Date();
  const stocktake = await prisma.$transaction(async (tx) => {
    const created = await tx.stocktake.create({
      data: {
        name: `${sheet.venue ?? 'Venue'} — ${sheet.countedAtText ?? basename(path)} (from Loaded)`,
        venue: sheet.venue,
        countedAt,
        status: 'IN_PROGRESS',
        importSource: `loaded-pdf:${basename(path)}`,
        notes: `Imported from the Loaded export "${basename(path)}". Counted ${
          sheet.countedAtText ?? 'unknown date'
        } by ${sheet.countedBy ?? 'unknown'}. ${matched.length} of ${sheet.lines.length} lines matched; ${
          unmatched.length
        } not in the catalogue.`
      }
    });
    await tx.stocktakeLine.createMany({
      data: reconciled.map((m, position) => ({
        stocktakeId: created.id,
        itemId: m.item.id,
        position,
        label: m.item.name,
        countedQty: m.unit.quantity,
        // Alma's unit, because the quantity is now in Alma's unit.
        unit: m.item.countUnit ?? m.item.unit,
        // The value Loaded printed, kept so the import can be checked against
        // the sheet later without re-reading the PDF.
        stockValueCents: m.line.valueCents,
        location: m.line.category,
        notes: m.unit.note ? `Loaded counted ${m.line.quantity} ${m.line.unit}. ${m.unit.note}` : null
      }))
    });
    return created;
  });

  console.log(`\n  Written as stocktake ${stocktake.id} (IN_PROGRESS) with ${matched.length} lines.`);
  console.log('  Review it in Stock → Stocktakes, then apply and lock it as the baseline.\n');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
