// The editable unit-alias table behind Stock → Setup → Units.
//
// Rows are spellings of a UNIT ("kilo" → kg, "unit" → each, "btl" → bottle),
// not product names — product wordings live in stock_item_aliases. The table
// is loaded into @alma/shared's unit registry (setActiveUnitAliases) so every
// conversion in this API — stocktake valuation, recipe costing, invoice
// paste — reads units through it; the web app fetches the same list and loads
// its own copy of the registry.
//
// Once the table holds any rows they replace the built-in defaults entirely,
// which is what makes deleting a seeded alias actually turn it off. The
// migration seeds the defaults, so the table starts populated.

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { setActiveUnitAliases } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { requireStockManager } from '../lib/stock-permissions.js';

export type UnitAliasRow = {
  id: string;
  alias: string;
  canonical: string;
  createdAt: Date;
  updatedAt: Date;
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Lowercase, trim, collapse whitespace, drop trailing dots — the same shape
 * normaliseUnitLabel produces, so a stored alias always matches its lookups. */
function normaliseKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.+$/, '');
}

async function loadIntoRegistry(): Promise<void> {
  const rows = await prisma.stockUnitAlias.findMany({ select: { alias: true, canonical: true } });
  if (rows.length === 0) {
    // Empty table (defaults deliberately cleared, or migration not yet run):
    // fall back to the built-in list rather than losing all aliasing.
    setActiveUnitAliases(null);
    return;
  }
  setActiveUnitAliases(Object.fromEntries(rows.map((row) => [row.alias, row.canonical])));
}

/** Prime the registry at boot and keep it fresh; safe to call once from server.ts. */
export function scheduleUnitAliasRefresh(): void {
  void loadIntoRegistry().catch((error) => {
    console.error('[unit-aliases] initial load failed — using built-in defaults', error);
  });
  setInterval(() => {
    void loadIntoRegistry().catch((error) => {
      console.error('[unit-aliases] refresh failed — keeping last loaded table', error);
    });
  }, REFRESH_INTERVAL_MS).unref();
}

function validate(alias: string, canonical: string): { alias: string; canonical: string } {
  const cleanAlias = normaliseKey(alias);
  const cleanCanonical = normaliseKey(canonical);
  if (!cleanAlias || !cleanCanonical) {
    throw new HttpError(400, 'Both the alias and the unit it means are required.');
  }
  if (/\d/.test(cleanAlias)) {
    throw new HttpError(
      400,
      `Pack sizes like "700ml" are recognised automatically — aliases are for words ("kilo", "btl", "unit").`
    );
  }
  if (cleanAlias === cleanCanonical) {
    throw new HttpError(400, 'The alias and the unit it means are already the same word.');
  }
  return { alias: cleanAlias, canonical: cleanCanonical };
}

export const unitAliasesService = {
  async list(): Promise<UnitAliasRow[]> {
    // The settings page (and the stocktake screen) fetch this on load, which
    // doubles as a registry refresh — edits made elsewhere take effect here
    // without waiting for the interval.
    await loadIntoRegistry();
    return prisma.stockUnitAlias.findMany({
      select: { id: true, alias: true, canonical: true, createdAt: true, updatedAt: true },
      orderBy: [{ canonical: 'asc' }, { alias: 'asc' }]
    });
  },

  async create(actor: AuthUser | undefined, input: { alias: string; canonical: string }): Promise<UnitAliasRow> {
    requireStockManager(actor);
    const { alias, canonical } = validate(input.alias ?? '', input.canonical ?? '');
    const existing = await prisma.stockUnitAlias.findUnique({ where: { alias } });
    if (existing) {
      throw new HttpError(400, `"${alias}" is already an alias for "${existing.canonical}".`);
    }
    const created = await prisma.stockUnitAlias.create({
      data: { alias, canonical, createdById: actor?.id ?? null },
      select: { id: true, alias: true, canonical: true, createdAt: true, updatedAt: true }
    });
    await loadIntoRegistry();
    return created;
  },

  async update(
    actor: AuthUser | undefined,
    id: string,
    input: { alias?: string; canonical?: string }
  ): Promise<UnitAliasRow> {
    requireStockManager(actor);
    const current = await prisma.stockUnitAlias.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'Unit alias not found.');
    const { alias, canonical } = validate(input.alias ?? current.alias, input.canonical ?? current.canonical);
    const clash = await prisma.stockUnitAlias.findUnique({ where: { alias } });
    if (clash && clash.id !== id) {
      throw new HttpError(400, `"${alias}" is already an alias for "${clash.canonical}".`);
    }
    const updated = await prisma.stockUnitAlias.update({
      where: { id },
      data: { alias, canonical },
      select: { id: true, alias: true, canonical: true, createdAt: true, updatedAt: true }
    });
    await loadIntoRegistry();
    return updated;
  },

  async remove(actor: AuthUser | undefined, id: string): Promise<void> {
    requireStockManager(actor);
    const current = await prisma.stockUnitAlias.findUnique({ where: { id } });
    if (!current) throw new HttpError(404, 'Unit alias not found.');
    await prisma.stockUnitAlias.delete({ where: { id } });
    await loadIntoRegistry();
  }
};
