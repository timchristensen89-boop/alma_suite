// Loaded migration imports — bring the Loaded item catalogue and the
// historical stocktake archive across into Alma Stock so the team can
// retire Loaded.
//
// Two flows, both two-step (preview → commit):
//   importItems     — POST /api/imports/loaded/items/{preview|commit}
//   importStocktake — POST /api/imports/loaded/stocktakes/{preview|commit}
//
// The CSV parser is the same one used by the Deputy importer. Item
// matching is by name (case-insensitive trim) — Loaded doesn't emit a
// SKU we can rely on. Historical stocktakes land as LOCKED sessions
// with `importSource: 'Loaded'` so reports treat them as authoritative
// but they can't be edited without a manager reopen + reason.

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

// ─── CSV parsing (shared with Deputy import) ──────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\r' && next === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index += 1; continue; }
    if (char === '\n' || char === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function toObjects(rows: string[][]): Record<string, string>[] {
  const headers = rows[0]?.map((header) => header.trim().toLowerCase()) ?? [];
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => { object[header] = row[index]?.trim() ?? ''; });
    return object;
  });
}

// Tolerant column name lookup — Loaded exports use varied casing/spacing.
function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = row[key.toLowerCase()];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function parseNumber(text: string): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[$,\s]/g, '');
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseCostToCents(text: string): number | null {
  const n = parseNumber(text);
  return n === null ? null : Math.round(n * 100);
}

// ─── Outlier guard for imported line values ───────────────────────
// Loaded's `value` column is trusted verbatim, but a single mis-keyed or
// mis-unit line (e.g. a value of $492,498 where it should be $4,924) silently
// corrupts the whole session — and through it, closing stock and COGS. We don't
// reject the value; we flag lines that are implausibly large so a human checks
// them BEFORE committing the import.

// A single stocktake line worth this much is almost always a unit/typo error
// for a hospitality venue — flag it on its own merit.
const LINE_VALUE_ABSOLUTE_CEILING_CENTS = 25_000_00;
// …or a line that towers over the rest of its own session: this many times the
// session's median line value, and at least this large in absolute terms.
const LINE_VALUE_OUTLIER_MULTIPLE = 30;
const LINE_VALUE_OUTLIER_FLOOR_CENTS = 2_000_00;

function medianCents(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

// Returns a human reason if this line's value looks suspect against its session,
// otherwise null. `median` is the session's median positive line value.
function suspectValueReason(valueCents: number | null, median: number): string | null {
  if (valueCents === null || valueCents <= 0) return null;
  if (valueCents >= LINE_VALUE_ABSOLUTE_CEILING_CENTS) {
    return `Value ${money(valueCents)} is very high for one line — check the unit and value.`;
  }
  if (
    median > 0 &&
    valueCents >= LINE_VALUE_OUTLIER_FLOOR_CENTS &&
    valueCents >= median * LINE_VALUE_OUTLIER_MULTIPLE
  ) {
    return `Value ${money(valueCents)} is ${Math.round(valueCents / median)}× the typical line in this count — check it.`;
  }
  return null;
}

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Loaded sometimes stores cost as cents already (rare). When the
// dollar interpretation gives a suspiciously small per-unit cost
// for an item with a sensible quantity, the import is fine — we
// trust the dollar interpretation by default.

// ─── Item import ──────────────────────────────────────────────────

type ItemRowAction = 'create' | 'update' | 'skip' | 'error';

type ItemRowReport = {
  csvRow: number;
  name: string;
  matchedItemId: string | null;
  action: ItemRowAction;
  warnings: string[];
  reason?: string;
  proposed: {
    name: string;
    categoryName: string | null;
    unit: string;
    countUnit: string | null;
    conversionFactor: number;
    countArea: string | null;
    latestCostCents: number | null;
    active: boolean;
  };
};

function assertCanImport(actor: AuthUser) {
  if (actor.isAdmin || actor.role === 'ADMIN') return;
  if (actor.role === 'MANAGER') return;
  const access = actor.appAccess?.find((entry) => entry.appId === 'STOCK' && entry.status === 'ENABLED');
  const isStockAdmin = access?.role === 'ADMIN' || Boolean(access?.permissions?.admin);
  if (!isStockAdmin) {
    throw new HttpError(403, 'Loaded import is restricted to managers and admins.');
  }
}

function classifyItemRow(row: Record<string, string>, existingByName: Map<string, { id: string; name: string }>): { matchedId: string | null; warnings: string[]; proposed: ItemRowReport['proposed'] } {
  const name = pick(row, 'item', 'item name', 'name', 'product').trim();
  const categoryName = pick(row, 'category', 'group') || null;
  const unit = pick(row, 'purchase unit', 'purchaseunit', 'unit') || 'each';
  const countUnit = pick(row, 'count unit', 'countunit') || null;
  const conversionText = pick(row, 'conversion', 'conversion factor', 'factor');
  const conversionFactor = parseNumber(conversionText) ?? 1;
  const countArea = pick(row, 'area', 'count area', 'location') || null;
  const costText = pick(row, 'cost', 'latest cost', 'price', 'unit cost');
  const latestCostCents = parseCostToCents(costText);
  const activeText = pick(row, 'active', 'status').toLowerCase();
  const active = !['inactive', 'archived', 'no', '0', 'false', 'n'].includes(activeText);

  const warnings: string[] = [];
  if (!name) warnings.push('missing name');
  if (!unit) warnings.push('missing purchase unit');
  if (countUnit && countUnit !== unit && conversionFactor === 1 && !conversionText) warnings.push('count unit differs from purchase unit but no conversion supplied');
  if (latestCostCents === null) warnings.push('missing cost');

  const lookup = existingByName.get(name.toLowerCase());
  return {
    matchedId: lookup?.id ?? null,
    warnings,
    proposed: { name, categoryName, unit, countUnit, conversionFactor, countArea, latestCostCents, active }
  };
}

export const loadedImportService = {
  // ─── Item catalogue import ───────────────────────────────────

  async previewItemImport(actor: AuthUser, csv: string): Promise<{ rows: ItemRowReport[]; summary: Record<ItemRowAction, number>; duplicateNames: string[] }> {
    assertCanImport(actor);
    if (!csv?.trim()) throw new HttpError(400, 'CSV content is required.');

    const rows = toObjects(parseCsv(csv.replace(/^﻿/, '')));
    if (rows.length === 0) throw new HttpError(400, 'No rows found in the CSV. Make sure the header row is included.');

    const existing = await prisma.stockItem.findMany({ select: { id: true, name: true } });
    const byName = new Map<string, { id: string; name: string }>();
    for (const item of existing) byName.set(item.name.toLowerCase(), item);

    const seenNames = new Set<string>();
    const duplicateNames: string[] = [];
    const report: ItemRowReport[] = rows.map((raw, index) => {
      const csvRow = index + 2;
      const { matchedId, warnings, proposed } = classifyItemRow(raw, byName);
      if (!proposed.name) {
        return { csvRow, name: '', matchedItemId: null, action: 'error', warnings, reason: 'Row has no item name.', proposed };
      }
      const dedupeKey = proposed.name.toLowerCase();
      if (seenNames.has(dedupeKey)) {
        duplicateNames.push(proposed.name);
        return { csvRow, name: proposed.name, matchedItemId: null, action: 'skip', warnings, reason: 'Duplicate name within the same CSV.', proposed };
      }
      seenNames.add(dedupeKey);
      return {
        csvRow,
        name: proposed.name,
        matchedItemId: matchedId,
        action: matchedId ? 'update' : 'create',
        warnings,
        proposed
      };
    });

    const summary: Record<ItemRowAction, number> = { create: 0, update: 0, skip: 0, error: 0 };
    for (const row of report) summary[row.action] += 1;

    return { rows: report, summary, duplicateNames };
  },

  async commitItemImport(actor: AuthUser, csv: string): Promise<{ created: number; updated: number; skipped: number; errors: number }> {
    assertCanImport(actor);
    const preview = await this.previewItemImport(actor, csv);

    // Build category lookup, creating any missing ones referenced in the CSV.
    const categoryNames = Array.from(new Set(
      preview.rows
        .filter((row) => (row.action === 'create' || row.action === 'update') && row.proposed.categoryName)
        .map((row) => row.proposed.categoryName as string)
    ));
    const existingCategories = await prisma.stockCategory.findMany({
      where: { name: { in: categoryNames } },
      select: { id: true, name: true }
    });
    const categoryByName = new Map<string, string>();
    for (const cat of existingCategories) categoryByName.set(cat.name.toLowerCase(), cat.id);
    for (const name of categoryNames) {
      if (!categoryByName.has(name.toLowerCase())) {
        const created = await prisma.stockCategory.create({ data: { name } });
        categoryByName.set(name.toLowerCase(), created.id);
      }
    }

    let created = 0;
    let updated = 0;
    let skipped = preview.summary.skip + preview.summary.error;

    for (const row of preview.rows) {
      if (row.action !== 'create' && row.action !== 'update') continue;
      const p = row.proposed;
      const data = {
        name: p.name,
        unit: p.unit,
        countUnit: p.countUnit,
        conversionFactor: p.conversionFactor,
        countArea: p.countArea,
        latestCostCents: p.latestCostCents,
        latestCostAt: p.latestCostCents !== null ? new Date() : null,
        categoryId: p.categoryName ? categoryByName.get(p.categoryName.toLowerCase()) ?? null : null,
        status: p.active ? ('ACTIVE' as const) : ('ARCHIVED' as const),
        notes: row.warnings.length ? `Loaded import warnings: ${row.warnings.join('; ')}` : null
      };
      try {
        if (row.action === 'create') {
          await prisma.stockItem.create({ data });
          created += 1;
        } else if (row.matchedItemId) {
          await prisma.stockItem.update({ where: { id: row.matchedItemId }, data });
          updated += 1;
        }
      } catch (err) {
        skipped += 1;
        console.error('[loaded-import] item commit failed', { name: p.name, err });
      }
    }

    return { created, updated, skipped, errors: preview.summary.error };
  },

  // ─── Historical stocktake import ─────────────────────────────

  async previewStocktakeImport(actor: AuthUser, csv: string) {
    assertCanImport(actor);
    if (!csv?.trim()) throw new HttpError(400, 'CSV content is required.');

    const rows = toObjects(parseCsv(csv.replace(/^﻿/, '')));
    if (rows.length === 0) throw new HttpError(400, 'No rows found in the CSV.');

    const allItems = await prisma.stockItem.findMany({ select: { id: true, name: true } });
    const itemByName = new Map<string, { id: string; name: string }>();
    for (const item of allItems) itemByName.set(item.name.toLowerCase(), item);

    // Group rows by (date, venue) into separate sessions.
    type SessionGroup = {
      date: string;
      venue: string;
      lines: Array<{
        csvRow: number;
        itemName: string;
        matchedItemId: string | null;
        category: string | null;
        area: string | null;
        quantity: number | null;
        unit: string | null;
        valueCents: number | null;
        costCents: number | null;
        suspectReason: string | null;
      }>;
    };
    const groups = new Map<string, SessionGroup>();
    let matched = 0;
    let unmatched = 0;

    rows.forEach((raw, index) => {
      const csvRow = index + 2;
      const date = pick(raw, 'date', 'counted at', 'count date') || new Date().toISOString().slice(0, 10);
      const venue = pick(raw, 'venue', 'location') || 'Unspecified';
      const itemName = pick(raw, 'item', 'item name', 'name');
      const category = pick(raw, 'category', 'group') || null;
      const area = pick(raw, 'area', 'count area', 'location') || null;
      const quantity = parseNumber(pick(raw, 'quantity', 'qty', 'count'));
      const unit = pick(raw, 'unit', 'count unit') || null;
      const valueCents = parseCostToCents(pick(raw, 'value', 'stock value'));
      const costCents = parseCostToCents(pick(raw, 'cost', 'latest cost'));

      const key = `${date}|${venue}`;
      const existing = groups.get(key) ?? { date, venue, lines: [] };
      const match = itemByName.get(itemName.toLowerCase());
      if (match) matched += 1;
      else unmatched += 1;
      existing.lines.push({
        csvRow,
        itemName,
        matchedItemId: match?.id ?? null,
        category,
        area,
        quantity,
        unit,
        valueCents,
        costCents,
        suspectReason: null
      });
      groups.set(key, existing);
    });

    // Second pass: flag implausibly large line values against each session's own
    // distribution so a human reviews them before committing the import.
    let flaggedValueLines = 0;
    for (const session of groups.values()) {
      const median = medianCents(
        session.lines.map((line) => line.valueCents ?? 0).filter((value) => value > 0)
      );
      for (const line of session.lines) {
        line.suspectReason = suspectValueReason(line.valueCents, median);
        if (line.suspectReason) flaggedValueLines += 1;
      }
    }

    return {
      sessions: Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date)),
      summary: {
        totalRows: rows.length,
        matchedItems: matched,
        unmatchedItems: unmatched,
        sessionCount: groups.size,
        flaggedValueLines
      }
    };
  },

  async commitStocktakeImport(actor: AuthUser, csv: string, options: { skipUnmatched: boolean } = { skipUnmatched: true }) {
    assertCanImport(actor);
    const preview = await this.previewStocktakeImport(actor, csv);

    let sessionsCreated = 0;
    let linesCreated = 0;
    let linesSkipped = 0;

    for (const session of preview.sessions) {
      const countedAt = new Date(`${session.date}T12:00:00`);
      if (Number.isNaN(countedAt.getTime())) {
        linesSkipped += session.lines.length;
        continue;
      }
      const stocktake = await prisma.stocktake.create({
        data: {
          name: `Loaded import · ${session.venue} · ${session.date}`,
          venue: session.venue,
          countedAt,
          status: 'LOCKED',
          lockedAt: new Date(),
          lockedByUserId: actor.id ?? null,
          importSource: `Loaded CSV import ${new Date().toISOString().slice(0, 10)}`,
          notes: `Imported from Loaded by ${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim()
        }
      });
      sessionsCreated += 1;

      const linesToCreate = session.lines
        .map((line, index) => ({
          stocktakeId: stocktake.id,
          itemId: line.matchedItemId,
          position: index,
          label: line.itemName || `Unmatched row ${line.csvRow}`,
          countedQty: line.quantity ?? 0,
          unit: line.unit,
          location: line.area,
          stockValueCents: line.valueCents
        }))
        .filter((line) => {
          if (options.skipUnmatched && line.itemId === null) {
            linesSkipped += 1;
            return false;
          }
          return true;
        });

      if (linesToCreate.length > 0) {
        await prisma.stocktakeLine.createMany({ data: linesToCreate });
        linesCreated += linesToCreate.length;
      }
    }

    return { sessionsCreated, linesCreated, linesSkipped };
  }
};
