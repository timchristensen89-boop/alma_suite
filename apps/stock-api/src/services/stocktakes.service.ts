import type { Prisma } from '@prisma/client';
import { prisma, prismaCogsReader, stockBracket, type StockBracket } from '@alma/db';
import {
  stocktakeCorrectionInputSchema,
  stocktakeBulkDeleteInputSchema,
  stocktakeLineAddInputSchema,
  stocktakeLinesPatchInputSchema,
  stocktakeCreateInputSchema,
  stocktakeReversalInputSchema,
  stocktakeUpdateInputSchema,
  type ApplyStocktakeResult,
  type InventoryMovement,
  type StocktakeMovement,
  type StocktakeMovementHistoryPayload,
  type StocktakeMovementResult,
  type StocktakeReviewItem,
  type Stocktake,
  type StocktakeLine,
  type StocktakeLinesPatchResult,
  type StocktakeWithLines,
  type StocktakeCountSheet,
  type StocktakeLineInput,
  type StocktakesPayload,
  type AuthUser,
  type StocktakePrepApplySummary,
  type StocktakePrepPreview,
  type StocktakesSummary,
  STOCKTAKE_PREP_AREA,
  STOCKTAKE_STALE_DAYS,
  resolveVenueLabel,
  scopeForTemplate,
  type ScopeDerivation,
  type StocktakeScope
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { buildCountSheetSections } from '../lib/count-sheet.js';
import { inCountUnit } from '../lib/apply-unit-guard.js';
import { assertMayEnterCounts, isStockManager } from '../lib/stock-permissions.js';
import {
  explodePrepCount,
  summarisePrepLines,
  type PrepExplosion,
  type PrepSummaryLine
} from '../lib/prep-explosion.js';
import { loadPrepItems, loadPrepRecipes } from './prep-recipes.service.js';
import { convertQuantityToCostUnit } from './units.js';
import { isVenueUnscopedActor } from '../lib/venue-scope.js';

type LineCostItem = {
  unit: string;
  countUnit: string | null;
  conversionFactor: number | null;
  avgCostCents: number | null;
  measurePerCountUnit: number | null;
  measureUnit: string | null;
};

// Value a stocktake line server-side: counted quantity (converted into the
// item's cost unit) × the item's average cost. Client-supplied values are NOT
// trusted. Lines with no linked item or no cost basis are left unvalued (null).
//
// Refuse-to-mis-value: if the counted unit can't be converted to the item's
// cost unit (`via: 'unknown'`), we return null rather than multiplying the raw
// counted quantity by the cost. Doing the latter is exactly what blows a single
// line up to an absurd value (e.g. costing 750 mL of wine at the per-bottle
// price). An unvalued line is honest; a silently mis-valued one corrupts the
// whole stocktake — and through it, COGS. Mirrors recipe `costForLine`.
function stocktakeLineValueCents(
  countedQty: number | null | undefined,
  unit: string | null | undefined,
  item: LineCostItem | undefined
): number | null {
  if (!item || item.avgCostCents === null || countedQty === null || countedQty === undefined) {
    return null;
  }
  const { quantity, via } = convertQuantityToCostUnit(countedQty, unit ?? null, item);
  if (via === 'unknown') {
    return null;
  }
  return Math.round(item.avgCostCents * quantity);
}

// Store every counted line in its item's count unit, converting on the way in
// when the conversion is reliable (see inCountUnit). `changed` limits this to
// lines being entered or edited now: a line already on the sheet keeps exactly
// what it holds, so editing a count never rewrites its history. A quantity
// that can't be converted reliably is refused, naming the line.
function linesInCountUnits<T extends { itemId?: string | null; recipeId?: string | null; countedQty: number | null; unit?: string | null; label: string }>(
  lines: T[],
  items: Map<string, LineCostItem>,
  changed: (line: T) => boolean = () => true
): T[] {
  const refused: string[] = [];
  const out = lines.map((line) => {
    const itemId = normaliseOptionalText(line.itemId ?? undefined);
    if (!itemId || normaliseOptionalText(line.recipeId ?? undefined) || !changed(line)) return line;
    const item = items.get(itemId);
    if (!item) return line;
    const result = inCountUnit(line.countedQty, line.unit, item, { label: line.label.trim() });
    if (!result.ok) {
      refused.push(result.message);
      return line;
    }
    return { ...line, countedQty: result.countedQty, unit: result.unit };
  });
  if (refused.length) {
    throw new HttpError(400, `${refused.slice(0, 8).join(' ')}${refused.length > 8 ? ` …and ${refused.length - 8} more.` : ''}`);
  }
  return out;
}

async function loadLineCostItems(
  client: Prisma.TransactionClient,
  lines: { itemId?: string | null }[] | undefined
): Promise<Map<string, LineCostItem>> {
  const ids = [
    ...new Set(
      (lines ?? [])
        .map((line) => (line.itemId ? line.itemId.trim() : ''))
        .filter((value): value is string => value.length > 0)
    )
  ];
  if (!ids.length) return new Map();
  const items = await client.stockItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, unit: true, countUnit: true, conversionFactor: true, avgCostCents: true, measurePerCountUnit: true, measureUnit: true }
  });
  return new Map(items.map((item) => [item.id, item]));
}

type StocktakeRow = Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: { select: { stockValueCents: true } };
  };
}>;

// Every read of a stocktake's lines carries the prep recipe alongside the
// stock item, so a prepped-item line is never rendered as a bare label.
const lineInclude = {
  item: { select: { id: true, name: true, unit: true, onHand: true } },
  recipe: { select: { id: true, title: true, yieldQuantity: true, yieldUnit: true } }
} satisfies Prisma.StocktakeLineInclude;

type StocktakeWithLinesRow = Prisma.StocktakeGetPayload<{
  include: { lines: { include: typeof lineInclude } };
}>;

type StocktakeLineRow = StocktakeWithLinesRow['lines'][number];

type InventoryMovementRow = Prisma.InventoryMovementGetPayload<object>;

type InventoryMovementWithContextRow = Prisma.InventoryMovementGetPayload<{
  include: {
    item: { select: { id: true; name: true; unit: true; onHand: true } };
    sourceStocktakeLine: {
      select: { id: true; label: true; countedQty: true; unit: true; location: true };
    };
  };
}>;

type StocktakeReviewRow = Prisma.StocktakeGetPayload<{
  include: {
    _count: { select: { lines: true } };
    lines: {
      select: {
        countedQty: true;
        stockValueCents: true;
        unit: true;
        item: { select: { id: true; onHand: true } };
      };
    };
  };
}>;

function startOfDay(value: Date) {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function startOfNextDay(value: Date) {
  const day = startOfDay(value);
  day.setDate(day.getDate() + 1);
  return day;
}

function normaliseOptionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

/**
 * The scope a new count gets, from evidence: an explicit reviewed choice,
 * else the categories of the template it was started from, else the
 * template's name. Never from its value; UNKNOWN when nothing supports it.
 */
async function deriveCountScope(input: { scope?: StocktakeScope; template: string | null; venue: string | null; actor?: AuthUser | null }): Promise<ScopeDerivation> {
  if (input.scope) return { scope: input.scope, evidence: `set to ${input.scope} by ${input.actor?.email ?? 'unknown user'} on creation` };
  if (!input.template) return { scope: 'UNKNOWN', evidence: 'no template' };
  const template = await prisma.stocktakeTemplate.findFirst({
    where: { name: input.template, ...(input.venue ? { OR: [{ venue: input.venue }, { venue: null }] } : {}) },
    orderBy: [{ venue: 'desc' }, { updatedAt: 'desc' }],
    select: { name: true, categoryIds: true }
  });
  const categoryNames = template?.categoryIds.length
    ? (await prisma.stockCategory.findMany({ where: { id: { in: template.categoryIds } }, select: { name: true } })).map((c) => c.name)
    : [];
  return scopeForTemplate({ name: template?.name ?? input.template, categoryNames });
}

/** Why a stock-on-hand value is unavailable, in operator words. */
function describeUnavailableBracket(bracket: StockBracket, venue: string | null): string[] {
  if (bracket.status === 'ok') return [];
  if (venue == null && bracket.venuesWithoutCount.length > 0) return bracket.venuesWithoutCount.map((v) => `${v.venue}: ${v.detail}`);
  if (bracket.status === 'missing') return [`No finalised stocktake in the last ${bracket.windowDays} days.`];
  const lone = bracket.rejected.filter((r) => r.reason === 'no_counterpart').map((r) => `${r.scope} count ${r.countedOn} has no ${r.scope === 'FOOD' ? 'BEVERAGE' : 'FOOD'} counterpart`);
  const unknown = bracket.rejected.filter((r) => r.reason === 'unknown_scope').map((r) => `${r.countedOn} "${r.name}" has no scope set`);
  const unvalued = bracket.rejected.filter((r) => r.reason === 'unvalued').map((r) => `${r.countedOn} "${r.name}": ${r.detail}`);
  return [...lone, ...unknown, ...unvalued];
}

function sumLineValueCents(lines: { stockValueCents: number | null }[]): number {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

function toStocktakePayload(row: StocktakeRow): Stocktake {
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    scope: row.scope,
    scopeEvidence: row.scopeEvidence,
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row._count.lines,
    totalValueCents: sumLineValueCents(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toLinePayload(row: StocktakeLineRow): StocktakeLine {
  return {
    id: row.id,
    legacyId: row.legacyId,
    stocktakeId: row.stocktakeId,
    itemId: row.itemId,
    item: row.item ?? null,
    recipeId: row.recipeId,
    recipe: row.recipe ?? null,
    position: row.position,
    label: row.label,
    countedQty: row.countedQty,
    unit: row.unit,
    location: row.location,
    stockValueCents: row.stockValueCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toStocktakeWithLinesPayload(row: StocktakeWithLinesRow): StocktakeWithLines {
  const totalValueCents = row.lines.reduce(
    (sum, line) => sum + (line.stockValueCents ?? 0),
    0
  );
  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    scope: row.scope,
    scopeEvidence: row.scopeEvidence,
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row.lines.length,
    totalValueCents,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lines: row.lines
      .slice()
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.label.localeCompare(b.label);
      })
      .map(toLinePayload)
  };
}

function toMovementPayload(row: InventoryMovementRow): InventoryMovement {
  return {
    id: row.id,
    itemId: row.itemId,
    movementType: row.movementType,
    quantityDelta: row.quantityDelta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    unit: row.unit,
    sourceStocktakeId: row.sourceStocktakeId,
    sourceStocktakeLineId: row.sourceStocktakeLineId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString()
  };
}

function toMovementWithContextPayload(row: InventoryMovementWithContextRow): StocktakeMovement {
  return {
    ...toMovementPayload(row),
    item: row.item,
    sourceStocktakeLine: row.sourceStocktakeLine
  };
}

function reviewerLabel(reviewer?: AuthUser | null) {
  if (!reviewer) return null;
  return `${reviewer.firstName} ${reviewer.lastName}`.trim() || reviewer.email || reviewer.id;
}

function notesWithContext(parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(' · ');
}

function reversalSinceAppliedWhere(stocktakeId: string, appliedAt: Date | null) {
  return {
    sourceStocktakeId: stocktakeId,
    movementType: 'STOCKTAKE_REVERSAL' as const,
    ...(appliedAt ? { createdAt: { gte: appliedAt } } : {})
  };
}

function isAdminActor(actor?: AuthUser | null) {
  return Boolean(actor?.isAdmin || actor?.role === 'ADMIN');
}

function stocktakeScope(actor?: AuthUser | null): Prisma.StocktakeWhereInput {
  if (!actor || isVenueUnscopedActor(actor)) return {};
  if (!actor.venue) return { id: '__no_stocktake_scope__' };
  return { OR: [{ venue: actor.venue }, { venue: null }] };
}

function scopedStocktakeWhere(id: string, actor?: AuthUser | null): Prisma.StocktakeWhereInput {
  return { AND: [{ id }, stocktakeScope(actor)] };
}

function targetVenueForActor(requestedVenue: string | null | undefined, actor?: AuthUser | null) {
  if (!actor || isVenueUnscopedActor(actor)) return requestedVenue ?? null;
  if (!actor.venue) throw new HttpError(403, 'Stocktake actions require a venue-scoped manager.');
  if (requestedVenue && requestedVenue !== actor.venue) {
    throw new HttpError(403, 'Stocktake actions are limited to your venue.');
  }
  return actor.venue;
}

/**
 * The venue a count is filed under must be one the business has. On 1 Sep
 * 2026 a manager typed "Avalon" into what was then a free-text box and the
 * API created a third venue with 830 empty holdings. Known spellings
 * ("Avalon", "Freshwater") resolve to the configured name; anything else is
 * refused rather than stored. Blank stays blank (an unassigned count).
 */
async function canonicalVenue(requested: string | null | undefined): Promise<string | null> {
  const trimmed = requested?.trim();
  if (!trimmed) return null;
  const configured = await prismaCogsReader.configuredVenues();
  if (configured.length === 0) return trimmed;
  const resolved = resolveVenueLabel(trimmed, configured);
  if ((resolved.status === 'canonical' || resolved.status === 'alias') && resolved.venue) return resolved.venue;
  throw new HttpError(400, `Venue must be one of: ${configured.join(', ')}`);
}

function assertVenueChangeAllowed(
  requestedVenue: string | null | undefined,
  existingVenue: string | null,
  actor?: AuthUser | null
) {
  if (!actor || isVenueUnscopedActor(actor)) return requestedVenue ?? existingVenue;
  return targetVenueForActor(requestedVenue ?? existingVenue, actor);
}

async function balanceTargetForItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  venue: string | null
) {
  const item = await tx.stockItem.findUnique({
    where: { id: itemId },
    select: { id: true, unit: true, onHand: true, parLevel: true, reorderPoint: true }
  });
  if (!item) return null;

  if (!venue) {
    return {
      item,
      quantityBefore: item.onHand,
      updateQuantityAfter: (quantityAfter: number) =>
        tx.stockItem.update({
          where: { id: item.id },
          data: { onHand: quantityAfter }
        })
    };
  }

  const venueStock = await tx.venueStockItem.upsert({
    where: { venue_stockItemId: { venue, stockItemId: item.id } },
    create: {
      venue,
      stockItemId: item.id,
      parLevel: item.parLevel,
      reorderPoint: item.reorderPoint,
      onHand: null,
      active: true
    },
    update: {}
  });

  return {
    item,
    // A venue row with a null on-hand means this venue has never counted this
    // item — so its prior holding is zero, not the group total. Falling back to
    // `item.onHand` (the SUM across every venue) booked the OTHER venue's stock
    // as this one's opening balance: counting 3 kg of hominy at Avalon, which
    // had no row, wrote "before 4, after 3, delta −1" using St Alma's 4, and
    // recorded a shrink the kitchen never had. 96 of the 308 active kitchen
    // items are in exactly that state at Avalon.
    quantityBefore: venueStock.onHand ?? 0,
    updateQuantityAfter: async (quantityAfter: number) => {
      await tx.venueStockItem.update({
        where: { id: venueStock.id },
        data: { onHand: quantityAfter, active: true }
      });
      // Keep the item-level on-hand (shown on the Items page) in sync with the
      // counts: it's the total across every venue that has been counted, so an
      // approved stocktake is reflected there regardless of venue scope.
      const rows = await tx.venueStockItem.findMany({
        where: { stockItemId: item.id, onHand: { not: null } },
        select: { onHand: true }
      });
      const total = rows.reduce((sum, row) => sum + (row.onHand ?? 0), 0);
      await tx.stockItem.update({ where: { id: item.id }, data: { onHand: total } });
    }
  };
}

async function ensureVenueStockRowsForLines(
  tx: Prisma.TransactionClient,
  venue: string | null,
  itemIds: Array<string | null | undefined>
) {
  if (!venue) return;
  // This is the write that turns a string into a venue with a full catalogue
  // of holdings. It must never do that for a venue the business does not have.
  const configured = await prismaCogsReader.configuredVenues();
  if (configured.length > 0 && !configured.includes(venue)) {
    throw new HttpError(400, `Venue must be one of: ${configured.join(', ')}`);
  }
  const uniqueItemIds = Array.from(new Set(itemIds.filter((id): id is string => Boolean(id))));
  if (uniqueItemIds.length === 0) return;
  const items = await tx.stockItem.findMany({
    where: { id: { in: uniqueItemIds } },
    select: { id: true, parLevel: true, reorderPoint: true, status: true }
  });
  for (const item of items) {
    await tx.venueStockItem.upsert({
      where: { venue_stockItemId: { venue, stockItemId: item.id } },
      create: {
        venue,
        stockItemId: item.id,
        parLevel: item.parLevel,
        reorderPoint: item.reorderPoint,
        onHand: null,
        active: item.status === 'ACTIVE'
      },
      update: {}
    });
  }
}

// Refuse a save built on a stale copy of the count. Two people on one sheet
// used to be "the last iPad to save wins" — a whole area's counts gone with
// no sign anything happened. Clients send the updatedAt they loaded; a save
// after someone else's is a 409 with enough context to reload, not a
// silent overwrite. Clients that do not send it are unchanged.
function assertNotStale(existing: { updatedAt: Date }, expectedUpdatedAt: string | undefined) {
  const expected = normaliseOptionalText(expectedUpdatedAt);
  if (!expected) return;
  const expectedAt = new Date(expected);
  if (Number.isNaN(expectedAt.getTime())) return;
  // Postgres keeps microseconds and JSON keeps milliseconds; compare loosely.
  if (Math.abs(existing.updatedAt.getTime() - expectedAt.getTime()) <= 1000) return;
  const when = existing.updatedAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  throw new HttpError(
    409,
    `Someone else saved this count at ${when}, after you opened it. Reload to see their numbers before saving, or your counts would overwrite theirs.`
  );
}

type StocktakeLineWrite = {
  position: number;
  label: string;
  itemId: string | null;
  recipeId: string | null;
  countedQty: number | null;
  unit: string | null;
  location: string | null;
  stockValueCents: number | null;
  notes: string | null;
};

// Write the sheet back without throwing away the rows. A save used to delete
// every line and recreate it, so every line id changed on every save and the
// ledger's sourceStocktakeLineId (SET NULL on delete) lost its anchor to the
// line it came from. Now a line that arrives with the id it was loaded with is
// updated in place — and only if something on it changed, so a save that
// touched twelve lines writes twelve rows, not seven hundred. Lines without a
// known id are created; existing lines the client no longer sends are removed.
async function writeStocktakeLines(
  tx: Prisma.TransactionClient,
  stocktakeId: string,
  lines: StocktakeLineInput[],
  toWrite: (line: StocktakeLineInput, index: number) => StocktakeLineWrite
) {
  const existing = await tx.stocktakeLine.findMany({
    where: { stocktakeId },
    select: {
      id: true,
      position: true,
      label: true,
      itemId: true,
      recipeId: true,
      countedQty: true,
      unit: true,
      location: true,
      stockValueCents: true,
      notes: true
    }
  });
  const existingById = new Map(existing.map((line) => [line.id, line]));
  const keep = new Set<string>();
  for (const line of lines) {
    if (line.id && existingById.has(line.id) && !keep.has(line.id)) keep.add(line.id);
  }
  if (keep.size < existing.length) {
    await tx.stocktakeLine.deleteMany({ where: { stocktakeId, id: { notIn: Array.from(keep) } } });
  }
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const values = toWrite(line, index);
    const current = line.id && !seen.has(line.id) ? existingById.get(line.id) : undefined;
    if (current) {
      seen.add(current.id);
      const changed = (Object.keys(values) as Array<keyof StocktakeLineWrite>).some(
        (key) => (current[key] ?? null) !== (values[key] ?? null)
      );
      if (changed) await tx.stocktakeLine.update({ where: { id: current.id }, data: values });
    } else {
      await tx.stocktakeLine.create({ data: { ...values, stocktakeId } });
    }
  }
}

// The rule for touching lines on a count, shared by the per-line writes:
// anyone who can count may write lines on an OPEN count; managers may also
// correct a SUBMITTED or REVIEWED one; a LOCKED baseline is closed to everyone
// until it is reopened with a reason (that reopen is the audit trail); a count
// that has been applied to stock is closed until it is reversed. Always called
// on a row read inside the writing transaction, under the count's row lock.
async function assertLinesWritable(
  existing: { id: string; status: string; appliedAt: Date | null },
  actor: AuthUser | null | undefined,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  if (existing.status === 'LOCKED') {
    throw new HttpError(409, 'This count is locked as a baseline. Reopen it with a reason before changing lines.');
  }
  if (!isStockManager(actor)) assertMayEnterCounts(existing, undefined);
  if (existing.appliedAt) {
    const reversed = await client.inventoryMovement.count({ where: reversalSinceAppliedWhere(existing.id, existing.appliedAt) });
    if (!reversed) throw new HttpError(409, 'This count has been applied to stock and cannot be changed until it is reversed.');
  }
}

// Serialise every write to one count: the count's row is locked for the
// rest of the transaction, so two counters' saves, an add and a remove, or a
// save and a submit queue behind each other instead of interleaving.
async function lockStocktakeRow(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "Stocktake" WHERE id = ${id} FOR UPDATE`;
  const row = await tx.stocktake.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, 'Stocktake not found');
  return row;
}

async function venueOnHandLookup(
  rows: Array<{
    venue: string | null;
    lines: Array<{ itemId?: string | null; item: { id: string } | null }>;
  }>
) {
  const venues = Array.from(
    new Set(rows.map((row) => row.venue?.trim()).filter((venue): venue is string => Boolean(venue)))
  );
  const itemIds = Array.from(
    new Set(
      rows.flatMap((row) =>
        row.lines.flatMap((line) => {
          const itemId = line.itemId ?? line.item?.id ?? null;
          return itemId ? [itemId] : [];
        })
      )
    )
  );

  if (venues.length === 0 || itemIds.length === 0) {
    return new Map<string, number | null>();
  }

  const venueRows = await prisma.venueStockItem.findMany({
    where: {
      venue: { in: venues },
      stockItemId: { in: itemIds }
    },
    select: { venue: true, stockItemId: true, onHand: true }
  });

  return new Map(venueRows.map((row) => [`${row.venue}:${row.stockItemId}`, row.onHand] as const));
}

function effectiveVenueOnHand(
  venue: string | null,
  itemId: string | null | undefined,
  fallback: number,
  venueOnHandByKey?: Map<string, number | null>
) {
  if (!venue || !itemId) return fallback;
  const venueOnHand = venueOnHandByKey?.get(`${venue}:${itemId}`);
  return venueOnHand ?? fallback;
}

async function hydrateStocktakeWithVenueOnHand(row: StocktakeWithLinesRow) {
  const venueOnHandByKey = await venueOnHandLookup([row]);
  return {
    ...row,
    lines: row.lines.map((line) =>
      line.item
        ? {
            ...line,
            item: {
              ...line.item,
              onHand: effectiveVenueOnHand(row.venue, line.itemId ?? line.item.id, line.item.onHand, venueOnHandByKey)
            }
          }
        : line
    )
  };
}

async function loadStocktakeWithVenueOnHand(id: string, actor?: AuthUser | null): Promise<StocktakeWithLines> {
  const row = await prisma.stocktake.findFirst({
    where: scopedStocktakeWhere(id, actor),
    include: {
      lines: { include: lineInclude }
    }
  });
  if (!row) throw new HttpError(404, 'Stocktake not found');
  const hydrated = await hydrateStocktakeWithVenueOnHand(row);
  return toStocktakeWithLinesPayload(hydrated);
}

function reviewLineValue(lines: StocktakeReviewRow['lines']) {
  return lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
}

function toStocktakeReviewPayload(
  row: StocktakeReviewRow,
  venueOnHandByKey?: Map<string, number | null>
): StocktakeReviewItem {
  const variance = row.lines.reduce(
    (summary, line) => {
      if (!line.item || line.countedQty == null) return summary;
      const onHand = effectiveVenueOnHand(row.venue, line.item.id, line.item.onHand, venueOnHandByKey);
      const delta = line.countedQty - onHand;
      if (Math.abs(delta) > 0.0001) summary.varianceLineCount += 1;
      summary.totalVarianceQuantity += delta;
      if (delta > 0) summary.positiveVarianceQuantity += delta;
      if (delta < 0) summary.negativeVarianceQuantity += delta;
      return summary;
    },
    {
      varianceLineCount: 0,
      totalVarianceQuantity: 0,
      positiveVarianceQuantity: 0,
      negativeVarianceQuantity: 0
    }
  );

  return {
    id: row.id,
    legacyId: row.legacyId,
    name: row.name,
    venue: row.venue,
    template: row.template,
    countedAt: row.countedAt.toISOString(),
    scope: row.scope,
    scopeEvidence: row.scopeEvidence,
    status: row.status,
    notes: row.notes,
    appliedAt: row.appliedAt?.toISOString() ?? null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    submittedByUserId: row.submittedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: row.reviewedByUserId,
    lineCount: row._count.lines,
    totalValueCents: reviewLineValue(row.lines),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...variance
  };
}

// Theoretical ingredient usage over a window, exploded from Square item-sales
// through recipe BOMs (+ one level of prep sub-recipe). Returns count-unit
// quantities per stock item. Unconvertible line units are skipped (never
// mis-counted), mirroring recipe costing's refuse-to-mis-value rule. This is
// the depletion basis for expected-vs-counted variance — computed on demand,
// so live on-hand is never mutated by sales (no drift, no double-count).
const usageItemSelect = {
  id: true,
  unit: true,
  countUnit: true,
  conversionFactor: true,
  measurePerCountUnit: true,
  measureUnit: true
} satisfies Prisma.StockItemSelect;

async function theoreticalUsageByItem(
  venue: string | null,
  from: Date,
  to: Date
): Promise<Map<string, number>> {
  const sales = await prisma.salesItemActualEntry.groupBy({
    by: ['recipeId'],
    where: {
      serviceDate: { gte: from, lte: to },
      ...(venue ? { venue } : {}),
      recipeId: { not: null }
    },
    _sum: { quantity: true }
  });
  const soldByRecipe = new Map<string, number>();
  for (const row of sales) {
    if (row.recipeId) soldByRecipe.set(row.recipeId, row._sum.quantity ?? 0);
  }
  if (soldByRecipe.size === 0) return new Map();

  const recipes = await prisma.recipe.findMany({
    where: { id: { in: [...soldByRecipe.keys()] } },
    include: {
      lines: {
        include: {
          item: { select: usageItemSelect },
          subRecipe: { include: { lines: { include: { item: { select: usageItemSelect } } } } }
        }
      }
    }
  });

  const usage = new Map<string, number>();
  const add = (itemId: string, qty: number) => {
    if (!Number.isFinite(qty) || qty <= 0) return;
    usage.set(itemId, (usage.get(itemId) ?? 0) + qty);
  };

  for (const recipe of recipes) {
    const sold = soldByRecipe.get(recipe.id) ?? 0;
    if (sold <= 0) continue;
    for (const line of recipe.lines) {
      const waste = 1 + Math.max(0, line.wastePercent ?? 0) / 100;
      if (line.itemId && line.item) {
        const conv = convertQuantityToCostUnit(line.quantity ?? 0, line.unit, line.item);
        if (conv.via !== 'unknown') add(line.itemId, sold * conv.quantity * waste);
      } else if (line.subRecipeId && line.subRecipe) {
        const yieldQty = line.subRecipe.yieldQuantity && line.subRecipe.yieldQuantity > 0 ? line.subRecipe.yieldQuantity : 1;
        const perSale = line.quantity ? line.quantity / yieldQty : 0;
        if (perSale <= 0) continue;
        for (const subLine of line.subRecipe.lines) {
          if (!subLine.itemId || !subLine.item) continue;
          const subWaste = 1 + Math.max(0, subLine.wastePercent ?? 0) / 100;
          const conv = convertQuantityToCostUnit(subLine.quantity ?? 0, subLine.unit, subLine.item);
          if (conv.via !== 'unknown') add(subLine.itemId, sold * perSale * conv.quantity * subWaste * waste);
        }
      }
    }
  }
  return usage;
}

/* -------------------------------------------------------------------------
 * Prepped items
 *
 * A stocktake line may count something the kitchen MADE rather than something
 * it bought. Counting it books nothing against the recipe — recipes hold no
 * stock — and instead explodes into the raw items the tub still holds, which
 * are ADDED to those items' own counted quantities.
 *
 * The arithmetic (and every refusal in it) lives in lib/prep-explosion.ts and
 * is tested there. What is here is the loading and the merge.
 * ---------------------------------------------------------------------- */

type CountedPrepLine = { recipeId?: string | null; countedQty?: number | null; unit?: string | null };

// Explode a list of lines in place: index i of the result corresponds to index
// i of the input, and is null for anything that is not a counted prep line.
// Used both to value lines on save (where they have no ids yet) and to apply
// a whole stocktake.
async function explodePrepLines(
  client: Prisma.TransactionClient,
  lines: CountedPrepLine[] | undefined
): Promise<Array<PrepExplosion | null>> {
  const list = lines ?? [];
  const roots = list
    .map((line) => normaliseOptionalText(line.recipeId ?? undefined))
    .filter((id): id is string => Boolean(id));
  if (!roots.length) return list.map(() => null);

  const specs = await loadPrepRecipes(client, roots);
  const items = await loadPrepItems(client, specs);

  return list.map((line) => {
    const recipeId = normaliseOptionalText(line.recipeId ?? undefined);
    if (!recipeId) return null;
    // A prep line nobody has counted yet contributes nothing, exactly like an
    // uncounted item line.
    if (line.countedQty === null || line.countedQty === undefined) return null;
    const recipe = specs.get(recipeId);
    if (!recipe) {
      return {
        recipeId,
        recipeTitle: 'Unknown recipe',
        batches: null,
        components: [],
        valueCents: null,
        warnings: ['This prepped-item line points at a recipe that no longer exists.']
      };
    }
    return explodePrepCount({
      countedQty: line.countedQty,
      countedUnit: line.unit ?? recipe.yieldUnit,
      recipe,
      recipesById: specs,
      itemsById: items
    });
  });
}

/**
 * What the prepped-item lines on a stocktake work out to. Loads what the
 * arithmetic needs; the merge itself is pure and tested in
 * lib/prep-explosion.ts.
 */
async function buildPrepSummary(
  client: Prisma.TransactionClient,
  lines: PrepSummaryLine[]
): Promise<StocktakePrepApplySummary> {
  return summarisePrepLines(lines, await explodePrepLines(client, lines));
}

const EMPTY_PREP_SUMMARY: StocktakePrepApplySummary = {
  lines: [],
  contributions: [],
  notOnSheet: [],
  totalValueCents: 0,
  warnings: []
};

export const stocktakesService = {
  async list(actor?: AuthUser | null): Promise<StocktakesPayload> {
    const stocktakes = await prisma.stocktake.findMany({
      where: stocktakeScope(actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      },
      orderBy: { countedAt: 'desc' }
    });
    return { stocktakes: stocktakes.map(toStocktakePayload) };
  },

  async summary(actor?: AuthUser | null): Promise<StocktakesSummary> {
    const scope = stocktakeScope(actor);
    // The value shown is the LATEST valid finalised count (per venue, summed
    // for the group) through the canonical stock-value rule in @alma/db —
    // never a sum over every stocktake line ever recorded, which is what the
    // old aggregate returned and grew with every count taken.
    const valueVenue = !actor || isVenueUnscopedActor(actor) ? null : actor.venue ?? null;
    const [total, inProgress, submitted, applied, latest, bracket] = await Promise.all([
      prisma.stocktake.count({ where: scope }),
      prisma.stocktake.count({ where: { AND: [scope, { status: 'IN_PROGRESS' }] } }),
      prisma.stocktake.count({ where: { AND: [scope, { status: 'SUBMITTED' }] } }),
      prisma.stocktake.count({ where: { AND: [scope, { appliedAt: { not: null } }] } }),
      prisma.stocktake.findFirst({
        where: scope,
        orderBy: { countedAt: 'desc' },
        select: { countedAt: true }
      }),
      // Operational freshness window (STOCKTAKE_STALE_DAYS), not the ±7-day
      // period-boundary window: this tile answers "what is on hand now?".
      stockBracket(prismaCogsReader, valueVenue, new Date(), STOCKTAKE_STALE_DAYS)
    ]);

    return {
      totalStocktakes: total,
      inProgress,
      submitted,
      applied,
      lastCountedAt: latest?.countedAt.toISOString() ?? null,
      latestCount: {
        status: bracket.status,
        valueCents: bracket.valueCents,
        countedOn: bracket.countedOn,
        distanceDays: bracket.distanceDays,
        windowDays: bracket.windowDays,
        composition: bracket.composition,
        venuesWithoutCount: bracket.venuesWithoutCount.map((v) => v.venue),
        reasons: describeUnavailableBracket(bracket, valueVenue)
      }
    };
  },

  /**
   * Per-venue stocktake status (suite reports). Ported verbatim from the suite's
   * reports.service.stocktakeStatus so the suite can delegate here instead of
   * reading stocktake tables directly. `venue` optional: one venue, else all.
   */
  async venueStatus(params: { venue?: string | null } = {}) {
    const requested = params.venue?.trim() || null;
    const venues = requested
      ? [requested]
      : Array.from(
          new Set(
            (
              await prisma.stocktake.findMany({
                where: { venue: { not: null } },
                select: { venue: true },
                distinct: ['venue']
              })
            )
              .map((s) => s.venue!)
              .filter(Boolean)
          )
        );

    const STALE_DAYS = STOCKTAKE_STALE_DAYS;
    const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);

    const venueStatuses = await Promise.all(
      venues.map(async (v) => {
        const latestLocked = await prisma.stocktake.findFirst({
          where: { venue: v, status: 'LOCKED' },
          orderBy: [{ countedAt: 'desc' }],
          include: { _count: { select: { lines: true } }, lines: { select: { stockValueCents: true } } }
        });
        const latestAny = await prisma.stocktake.findFirst({
          where: { venue: v },
          orderBy: [{ countedAt: 'desc' }],
          select: { id: true, status: true, countedAt: true, name: true }
        });
        // A venue's count is split across sessions — the bar and the kitchen
        // count separately, minutes apart. Reading the value off the single
        // most-recent locked count reported one section as the whole venue
        // (St Alma read $7,048.72, its kitchen, against $70,025.50 counted).
        // Sum every locked count the venue recorded on that same day, the way
        // stockValueForVenueAtCents in @alma/db does.
        const sameDaySessions = latestLocked
          ? await prisma.stocktake.findMany({
              where: {
                venue: v,
                status: 'LOCKED',
                countedAt: {
                  gte: startOfDay(latestLocked.countedAt),
                  lt: startOfNextDay(latestLocked.countedAt)
                }
              },
              include: { _count: { select: { lines: true } }, lines: { select: { stockValueCents: true } } }
            })
          : [];
        const stockValueCents = latestLocked
          ? sameDaySessions.reduce(
              (sum, session) => sum + session.lines.reduce((s, line) => s + (line.stockValueCents ?? 0), 0),
              0
            )
          : null;
        const sessionLineCount = sameDaySessions.reduce((sum, session) => sum + session._count.lines, 0);
        const stale = latestLocked ? latestLocked.countedAt < staleCutoff : true;
        return {
          venue: v,
          latestLocked: latestLocked
            ? {
                id: latestLocked.id,
                name: latestLocked.name,
                countedAt: latestLocked.countedAt.toISOString(),
                lockedAt: latestLocked.lockedAt?.toISOString() ?? null,
                lineCount: sessionLineCount || latestLocked._count.lines,
                sessionCount: sameDaySessions.length,
                stockValueCents,
                stale
              }
            : null,
          latestAny: latestAny
            ? {
                id: latestAny.id,
                name: latestAny.name,
                status: latestAny.status,
                countedAt: latestAny.countedAt.toISOString()
              }
            : null,
          quality: latestLocked
            ? stale
              ? 'partial'
              : 'good'
            : latestAny && (latestAny.status === 'SUBMITTED' || latestAny.status === 'REVIEWED')
              ? 'partial'
              : 'poor'
        };
      })
    );

    return { generatedAt: new Date().toISOString(), staleDays: STALE_DAYS, venues: venueStatuses };
  },

  async get(id: string, actor?: AuthUser | null): Promise<StocktakeWithLines> {
    return loadStocktakeWithVenueOnHand(id, actor);
  },

  async createStocktake(input: unknown, actor?: AuthUser | null): Promise<StocktakeWithLines> {
    const data = stocktakeCreateInputSchema.parse(input);
    const countedAt = new Date(data.countedAt);
    if (Number.isNaN(countedAt.getTime())) {
      throw new HttpError(400, 'countedAt is not a valid date');
    }
    const requestedVenue = normaliseOptionalText(data.venue);
    const venue = await canonicalVenue(targetVenueForActor(requestedVenue, actor));
    const submittedAt = data.status === 'SUBMITTED' ? new Date() : null;
    const scope = await deriveCountScope({ scope: data.scope, template: normaliseOptionalText(data.template) ?? null, venue, actor });

    const row = await prisma.$transaction(async (tx) => {
      const costById = await loadLineCostItems(tx, data.lines);
      if (data.lines) data.lines = linesInCountUnits(data.lines, costById);
      // A prepped-item line has no stock item to cost against; its value is
      // the raw material the tub holds.
      const prepByIndex = await explodePrepLines(tx, data.lines);
      const created = await tx.stocktake.create({
        data: {
          name: data.name.trim(),
          venue,
          template: normaliseOptionalText(data.template) ?? null,
          countedAt,
          countedAtSource: 'entered',
          scope: scope.scope,
          scopeEvidence: scope.evidence,
          status: data.status,
          submittedAt,
          submittedByUserId: submittedAt ? actor?.id ?? null : null,
          notes: normaliseOptionalText(data.notes) ?? null,
          lines: data.lines
            ? {
                create: data.lines.map((line, index) => ({
                  position: index + 1,
                  label: line.label.trim(),
                  itemId: normaliseOptionalText(line.itemId) ?? null,
                  recipeId: normaliseOptionalText(line.recipeId) ?? null,
                  countedQty: line.countedQty,
                  unit: normaliseOptionalText(line.unit) ?? null,
                  location: normaliseOptionalText(line.location) ?? null,
                  stockValueCents: normaliseOptionalText(line.recipeId)
                    ? prepByIndex[index]?.valueCents ?? null
                    : stocktakeLineValueCents(
                        line.countedQty,
                        line.unit,
                        costById.get(normaliseOptionalText(line.itemId) ?? '')
                      ),
                  notes: normaliseOptionalText(line.notes) ?? null
                }))
              }
            : undefined
        },
        include: {
          lines: { include: lineInclude }
        }
      });
      await ensureVenueStockRowsForLines(
        tx,
        venue,
        created.lines.map((line) => line.itemId)
      );
      return created;
    });
    return loadStocktakeWithVenueOnHand(row.id, actor);
  },

  async updateStocktake(
    id: string,
    input: unknown,
    actor?: AuthUser | null
  ): Promise<StocktakeWithLines> {
    const parsed = stocktakeUpdateInputSchema.parse(input);
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    assertNotStale(existing, parsed.expectedUpdatedAt);

    // Non-managers count; they don't run the count. They may write lines and
    // notes on a stocktake that is open for counting, and nothing else: not
    // its name, venue, template or date, not its status, and never one that
    // has already been applied to stock. Narrowing the payload here rather
    // than rejecting it keeps the existing web form working unchanged — it
    // PATCHes the whole record on every save, including fields it never
    // edited.
    let data = parsed;
    if (!isStockManager(actor)) {
      assertMayEnterCounts(existing, parsed.status);
      // Every field on the update schema is optional (it is .partial()), so
      // dropping the rest is a valid payload rather than a cast.
      const narrowed: typeof parsed = {};
      if (parsed.lines !== undefined) narrowed.lines = parsed.lines;
      if (parsed.notes !== undefined) narrowed.notes = parsed.notes;
      data = narrowed;
    }

    let reversedAfterApply = false;
    if (existing.appliedAt) {
      reversedAfterApply = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, existing.appliedAt)
      }) > 0;
      if (!reversedAfterApply) {
        throw new HttpError(409, 'Applied stocktakes cannot be edited until a reversal movement exists');
      }
    }

    let countedAt: Date | undefined;
    if (data.countedAt !== undefined) {
      countedAt = new Date(data.countedAt);
      if (Number.isNaN(countedAt.getTime())) {
        throw new HttpError(400, 'countedAt is not a valid date');
      }
    }

    const requestedVenue =
      data.venue !== undefined ? normaliseOptionalText(data.venue) : existing.venue;
    const allowedVenue = assertVenueChangeAllowed(requestedVenue, existing.venue, actor);
    // Only a venue actually being changed is checked; a count already filed
    // under an odd label stays editable until it is cleaned up.
    const venue = data.venue !== undefined ? await canonicalVenue(allowedVenue) : allowedVenue;
    const statusChanged = data.status !== undefined && data.status !== existing.status;
    const nextStatus = data.status ?? existing.status;
    const now = new Date();

    const row = await prisma.$transaction(async (tx) => {
      const costById = await loadLineCostItems(tx, data.lines);
      if (data.lines !== undefined) {
        const stored = new Map(
          (await tx.stocktakeLine.findMany({ where: { stocktakeId: id }, select: { id: true, countedQty: true, unit: true } })).map((line) => [line.id, line])
        );
        data.lines = linesInCountUnits(data.lines, costById, (line) => {
          const before = line.id ? stored.get(line.id) : undefined;
          return !before || before.countedQty !== line.countedQty || (before.unit ?? null) !== (normaliseOptionalText(line.unit) ?? null);
        });
      }
      const prepByIndex = await explodePrepLines(tx, data.lines);

      if (data.lines !== undefined) {
        await writeStocktakeLines(tx, id, data.lines, (line, index) => ({
          position: index + 1,
          label: line.label.trim(),
          itemId: normaliseOptionalText(line.itemId) ?? null,
          recipeId: normaliseOptionalText(line.recipeId) ?? null,
          countedQty: line.countedQty,
          unit: normaliseOptionalText(line.unit) ?? null,
          location: normaliseOptionalText(line.location) ?? null,
          stockValueCents: normaliseOptionalText(line.recipeId)
            ? prepByIndex[index]?.valueCents ?? null
            : stocktakeLineValueCents(
                line.countedQty,
                line.unit,
                costById.get(normaliseOptionalText(line.itemId) ?? '')
              ),
          notes: normaliseOptionalText(line.notes) ?? null
        }));
      }

      const updated = await tx.stocktake.update({
        where: { id },
        data: {
          // Always bump, even when only lines changed, so the stale-write
          // guard above sees every save.
          updatedAt: now,
          ...(data.name !== undefined && { name: data.name.trim() }),
          ...(data.venue !== undefined && { venue }),
          ...(data.template !== undefined && {
            template: normaliseOptionalText(data.template)
          }),
          // A scope sent on an update is a reviewed decision; history is
          // never re-derived or silently rewritten.
          ...(data.scope !== undefined && data.scope !== existing.scope && {
            scope: data.scope,
            scopeEvidence: `set to ${data.scope} on review by ${actor?.email ?? 'unknown user'} (was ${existing.scope})`
          }),
          ...(countedAt !== undefined && { countedAt }),
          ...(data.status !== undefined && { status: data.status }),
          ...(statusChanged && nextStatus === 'SUBMITTED' && {
            submittedAt: now,
            submittedByUserId: actor?.id ?? null
          }),
          ...(statusChanged && nextStatus === 'IN_PROGRESS' && {
            submittedAt: null,
            submittedByUserId: null,
            reviewedAt: null,
            reviewedByUserId: null
          }),
          ...(data.notes !== undefined && { notes: normaliseOptionalText(data.notes) }),
          ...(reversedAfterApply && {
            appliedAt: null,
            status: data.status ?? 'IN_PROGRESS'
          })
        },
        include: {
          lines: { include: lineInclude }
        }
      });
      await ensureVenueStockRowsForLines(
        tx,
        venue,
        updated.lines.map((line) => line.itemId)
      );
      return updated;
    }, { maxWait: 15_000, timeout: 30_000 });
    return loadStocktakeWithVenueOnHand(row.id, actor);
  },

  /**
   * Autosave from the counting screen: the changed lines only, by id.
   *
   * The whole-sheet PATCH above sends every line back and refuses the save
   * when anyone else has saved since, which is right for editing the count's
   * identity and wrong for counting it — two people on one sheet each lost
   * the other's shelves to the 409. Writing the touched lines alone makes
   * the sheet safe to share: the only line a save can overwrite is one the
   * same person is standing in front of. Values are recomputed server-side
   * exactly as the full save does; the client's number is never trusted.
   *
   * The count is re-read under its row lock inside the transaction, so a
   * save that races a submit, a reopen or another device's edit sees the
   * state it is actually writing into. A line that no longer exists (removed
   * from another device) is reported in `missing`, not allowed to fail the
   * rest of the batch — a phone that has been offline for an hour has a
   * queue full of other people's shelves too.
   */
  async updateLines(id: string, input: unknown, actor?: AuthUser | null): Promise<StocktakeLinesPatchResult> {
    const data = stocktakeLinesPatchInputSchema.parse(input);
    const scoped = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor), select: { id: true, venue: true } });
    if (!scoped) throw new HttpError(404, 'Stocktake not found');
    // One entry per line, later fields winning — a batch that carries the
    // same line twice is one line with two edits, not two reverts.
    const merged = new Map<string, (typeof data.lines)[number]>();
    for (const patch of data.lines) merged.set(patch.id, { ...(merged.get(patch.id) ?? {}), ...patch, id: patch.id });

    const now = new Date();
    const { updated, missing } = await prisma.$transaction(async (tx) => {
      const existing = await lockStocktakeRow(tx, id);
      await assertLinesWritable(existing, actor, tx);
      const ids = Array.from(merged.keys());
      const current = await tx.stocktakeLine.findMany({ where: { stocktakeId: id, id: { in: ids } } });
      const byId = new Map(current.map((line) => [line.id, line]));
      const missingIds = ids.filter((lineId) => !byId.has(lineId));
      const costById = await loadLineCostItems(tx, current);
      const written: string[] = [];
      for (const [lineId, patch] of merged) {
        const line = byId.get(lineId);
        if (!line) continue;
        let countedQty = patch.countedQty !== undefined ? patch.countedQty : line.countedQty;
        let unit = patch.unit !== undefined ? normaliseOptionalText(patch.unit) ?? null : line.unit;
        const label = patch.label !== undefined ? patch.label.trim() || line.label : line.label;
        if (line.itemId && (patch.countedQty !== undefined || patch.unit !== undefined)) {
          const [inUnits] = linesInCountUnits([{ itemId: line.itemId, countedQty, unit, label }], costById);
          countedQty = inUnits!.countedQty;
          unit = inUnits!.unit ?? null;
        }
        const notes = patch.notes !== undefined ? normaliseOptionalText(patch.notes) ?? null : line.notes;
        let stockValueCents: number | null;
        if (line.recipeId) {
          const [prep] = await explodePrepLines(tx, [{ recipeId: line.recipeId, countedQty, unit }]);
          stockValueCents = prep?.valueCents ?? null;
        } else {
          stockValueCents = stocktakeLineValueCents(countedQty, unit, costById.get(line.itemId ?? ''));
        }
        await tx.stocktakeLine.update({ where: { id: line.id }, data: { countedQty, unit, label, notes, stockValueCents } });
        written.push(line.id);
      }
      // Bump so the whole-sheet stale guard sees this save too.
      await tx.stocktake.update({ where: { id }, data: { updatedAt: now } });
      const rows = written.length ? await tx.stocktakeLine.findMany({ where: { id: { in: written } }, include: lineInclude }) : [];
      return { updated: rows, missing: missingIds };
    }, { maxWait: 15_000, timeout: 30_000 });

    const onHand = await venueOnHandLookup([{ venue: scoped.venue, lines: updated.map((line) => ({ itemId: line.itemId, item: line.item ? { id: line.item.id } : null })) }]);
    return {
      updatedAt: now.toISOString(),
      missing,
      lines: updated.map((row) => ({
        ...toLinePayload(row),
        item: row.item ? { ...row.item, onHand: effectiveVenueOnHand(scoped.venue, row.item.id, row.item.onHand, onHand) } : null
      }))
    };
  },

  /** Put one more item (or prepped item) on an open count, at the end. */
  async addLine(id: string, input: unknown, actor?: AuthUser | null): Promise<StocktakeLine> {
    const data = stocktakeLineAddInputSchema.parse(input);
    const scoped = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor), select: { id: true } });
    if (!scoped) throw new HttpError(404, 'Stocktake not found');

    const row = await prisma.$transaction(async (tx) => {
      const existing = await lockStocktakeRow(tx, id);
      await assertLinesWritable(existing, actor, tx);
      const last = await tx.stocktakeLine.findFirst({ where: { stocktakeId: id }, orderBy: { position: 'desc' }, select: { position: true } });
      const position = (last?.position ?? 0) + 1;
      if (data.itemId) {
        const duplicate = await tx.stocktakeLine.findFirst({ where: { stocktakeId: id, itemId: data.itemId }, select: { id: true } });
        if (duplicate) throw new HttpError(409, 'That item is already on this count.');
        const item = await tx.stockItem.findUnique({
          where: { id: data.itemId },
          select: { id: true, name: true, unit: true, countUnit: true, countArea: true, category: { select: { name: true } } }
        });
        if (!item) throw new HttpError(404, 'Item not found');
        const created = await tx.stocktakeLine.create({
          data: {
            stocktakeId: id,
            position,
            label: item.name,
            itemId: item.id,
            countedQty: null,
            unit: item.countUnit ?? item.unit,
            location: item.countArea && item.countArea !== 'Default' ? item.countArea : item.category?.name ?? null,
            stockValueCents: null
          },
          include: lineInclude
        });
        await ensureVenueStockRowsForLines(tx, existing.venue, [item.id]);
        await tx.stocktake.update({ where: { id }, data: { updatedAt: new Date() } });
        return created;
      }
      const recipeId = data.recipeId!;
      const duplicate = await tx.stocktakeLine.findFirst({ where: { stocktakeId: id, recipeId }, select: { id: true } });
      if (duplicate) throw new HttpError(409, 'That prepped item is already on this count.');
      const recipe = await tx.recipe.findUnique({ where: { id: recipeId }, select: { id: true, title: true, yieldUnit: true } });
      if (!recipe) throw new HttpError(404, 'Recipe not found');
      const created = await tx.stocktakeLine.create({
        data: {
          stocktakeId: id,
          position,
          label: recipe.title,
          recipeId: recipe.id,
          countedQty: null,
          unit: recipe.yieldUnit ?? null,
          location: STOCKTAKE_PREP_AREA,
          stockValueCents: null
        },
        include: lineInclude
      });
      await tx.stocktake.update({ where: { id }, data: { updatedAt: new Date() } });
      return created;
    }, { maxWait: 15_000, timeout: 30_000 });
    return toLinePayload(row);
  },

  /**
   * Take a line off a count. Refused once the ledger refers to it — a count
   * that was applied and reversed keeps its movements anchored to the line,
   * and deleting the anchor would orphan them; clear the count instead.
   */
  async removeLine(id: string, lineId: string, actor?: AuthUser | null): Promise<{ id: string }> {
    const scoped = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor), select: { id: true } });
    if (!scoped) throw new HttpError(404, 'Stocktake not found');
    await prisma.$transaction(async (tx) => {
      const existing = await lockStocktakeRow(tx, id);
      await assertLinesWritable(existing, actor, tx);
      const line = await tx.stocktakeLine.findFirst({ where: { id: lineId, stocktakeId: id }, select: { id: true } });
      if (!line) throw new HttpError(404, 'Line not found on this count');
      const anchored = await tx.inventoryMovement.count({ where: { sourceStocktakeLineId: line.id } });
      if (anchored > 0) throw new HttpError(409, 'This line has ledger history from an earlier apply. Clear its count instead of removing it.');
      await tx.stocktakeLine.delete({ where: { id: line.id } });
      await tx.stocktake.update({ where: { id }, data: { updatedAt: new Date() } });
    }, { maxWait: 15_000, timeout: 30_000 });
    return { id: lineId };
  },

  async applyStocktake(id: string, reviewer?: AuthUser | null): Promise<ApplyStocktakeResult> {
    const reviewedBy = reviewerLabel(reviewer);
    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findUnique({
        where: { id },
        include: {
          lines: {
            orderBy: [{ position: 'asc' }, { label: 'asc' }],
            include: lineInclude
          }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (
        reviewer &&
        !isVenueUnscopedActor(reviewer) &&
        (!reviewer.venue || (stocktake.venue !== reviewer.venue && stocktake.venue !== null))
      ) {
        throw new HttpError(403, 'Stocktake review is limited to your venue.');
      }
      // Applied first: applying moves the status to REVIEWED, so checking the
      // status before appliedAt told a manager who pressed the button twice
      // "only submitted stocktakes can be applied" instead of the truth.
      if (stocktake.appliedAt) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }
      // A count reviewed through POST /:id/review is still waiting to be
      // applied; the review queue offers both.
      if (stocktake.status !== 'SUBMITTED' && stocktake.status !== 'REVIEWED') {
        throw new HttpError(400, 'Only submitted stocktakes can be applied');
      }

      // Every holding is stored in the item's count unit. A line in another
      // unit is converted here when the conversion is exact (cases → bottles
      // by pack size, g → kg); one that would depend on the item's measure
      // ("970 g" of a bag, "22 ml" on a bottle) is refused and named before
      // anything is written — the number has to be restated by someone who
      // knows what was counted.
      const countedItemIds = [
        ...new Set(stocktake.lines.filter((line) => line.itemId && line.countedQty != null).map((line) => line.itemId as string))
      ];
      const unitItems = new Map(
        (
          await tx.stockItem.findMany({
            where: { id: { in: countedItemIds } },
            select: { id: true, unit: true, countUnit: true, conversionFactor: true, measurePerCountUnit: true, measureUnit: true }
          })
        ).map((item) => [item.id, item])
      );
      const inCountUnits = new Map<string, { countedQty: number; unit: string; converted: boolean }>();
      const refused: string[] = [];
      for (const line of stocktake.lines) {
        if (!line.itemId || line.countedQty == null) continue;
        const item = unitItems.get(line.itemId);
        if (!item) continue;
        const result = inCountUnit(line.countedQty, line.unit, item, { label: line.label, allowMeasure: false });
        if (!result.ok) refused.push(result.message);
        else inCountUnits.set(line.id, { countedQty: result.countedQty as number, unit: result.unit, converted: result.converted });
      }
      if (refused.length) {
        const shown = refused.slice(0, 8).join(' ');
        throw new HttpError(
          409,
          `${refused.length} line${refused.length === 1 ? '' : 's'} can't be applied yet. ${shown}${refused.length > 8 ? ` …and ${refused.length - 8} more.` : ''}`
        );
      }

      // Applying is the review, so it has to move the status as well as stamp
      // reviewedAt. Without that the count stays SUBMITTED for ever: applied,
      // reviewed, its stock long since written, and still sitting in the
      // review queue. Twenty-six of them had piled up that way, which made the
      // queue read as twenty-six counts waiting for a decision when every one
      // of them was finished. The appliedAt guard above is what kept it
      // harmless - a second apply is refused - but the queue was lying.

      const appliedAt = new Date();
      const applied = await tx.stocktake.updateMany({
        where: { id, status: { in: ['SUBMITTED', 'REVIEWED'] }, appliedAt: null },
        data: {
          status: 'REVIEWED',
          appliedAt,
          reviewedAt: appliedAt,
          reviewedByUserId: reviewer?.id ?? null
        }
      });
      if (applied.count !== 1) {
        throw new HttpError(409, 'Stocktake has already been applied');
      }

      // What the prepped-item lines hold, before anything is written. A
      // contribution is ADDED to the item's counted quantity; the tub and the
      // shelf are both stock, and booking either alone loses the other.
      const prep = await buildPrepSummary(tx, stocktake.lines);
      const prepByItem = new Map(prep.contributions.map((row) => [row.itemId, row]));

      // Which line credits a prep contribution, when an item is counted on
      // more than one line. The loop below writes the item's on-hand once per
      // line and the last write stands, so the credit has to land on the last
      // counted line for that item or it would be overwritten.
      const lastCountedLineForItem = new Map<string, string>();
      for (const line of stocktake.lines) {
        if (!line.itemId || line.countedQty == null) continue;
        lastCountedLineForItem.set(line.itemId, line.id);
      }

      const movements: InventoryMovementRow[] = [];
      for (const line of stocktake.lines) {
        // Prepped-item lines never adjust a recipe — they were already
        // exploded into the item lines above.
        if (!line.itemId) continue;
        // Not-yet-counted lines (null) carry no count — never adjust the ledger
        // for them, or we'd zero a real item's on-hand.
        if (line.countedQty == null) continue;
        const balanceTarget = await balanceTargetForItem(tx, line.itemId, stocktake.venue);
        if (!balanceTarget) continue;

        const contribution =
          lastCountedLineForItem.get(line.itemId) === line.id ? prepByItem.get(line.itemId) : undefined;
        const quantityBefore = balanceTarget.quantityBefore;
        const counted = inCountUnits.get(line.id) ?? { countedQty: line.countedQty, unit: line.unit ?? balanceTarget.item.unit, converted: false };
        const quantityAfter = contribution
          ? Math.round((counted.countedQty + contribution.quantity) * 1e6) / 1e6
          : counted.countedQty;
        const quantityDelta = quantityAfter - quantityBefore;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_ADJUSTMENT',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: counted.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: notesWithContext([
              `Applied stocktake: ${stocktake.name}`,
              counted.converted ? `Counted ${line.countedQty} ${line.unit ?? ''} = ${counted.countedQty} ${counted.unit}` : null,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              // Spelled out on the movement itself so the arithmetic is
              // legible a year later, without re-deriving it from recipes
              // that may since have changed.
              contribution
                ? `Counted ${counted.countedQty} loose + ${contribution.quantity} ${contribution.unit} held in ${contribution.fromPrep.join(', ')}`
                : null,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      const appliedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: { include: lineInclude }
        }
      });

      return { stocktake: appliedStocktake, movements, prep };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementPayload),
      prep: result.prep
    };
  },

  // The same arithmetic as applying, run without writing anything: what the
  // prepped-item lines will book, and what they cannot. Managers review this
  // before approving a count — a prep line that silently explodes into nothing
  // is the failure mode worth catching before it reaches the ledger.
  async prepPreview(id: string, actor?: AuthUser | null): Promise<StocktakePrepPreview> {
    const stocktake = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      select: {
        id: true,
        name: true,
        lines: {
          orderBy: [{ position: 'asc' }, { label: 'asc' }],
          select: { id: true, label: true, itemId: true, recipeId: true, countedQty: true, unit: true }
        }
      }
    });
    if (!stocktake) throw new HttpError(404, 'Stocktake not found');
    const summary = stocktake.lines.some((line) => line.recipeId)
      ? await buildPrepSummary(prisma, stocktake.lines)
      : EMPTY_PREP_SUMMARY;
    return {
      ...summary,
      stocktakeId: stocktake.id,
      stocktakeName: stocktake.name,
      generatedAt: new Date().toISOString()
    };
  },

  async getMovementHistory(
    id: string,
    actor?: AuthUser | null
  ): Promise<StocktakeMovementHistoryPayload> {
    const stocktake = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    if (!stocktake) throw new HttpError(404, 'Stocktake not found');

    const movements = await prisma.inventoryMovement.findMany({
      where: { sourceStocktakeId: id },
      include: {
        item: { select: { id: true, name: true, unit: true, onHand: true } },
        sourceStocktakeLine: {
          select: { id: true, label: true, countedQty: true, unit: true, location: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    const hasReversal = movements.some(
      (movement) =>
        movement.movementType === 'STOCKTAKE_REVERSAL' &&
        (!stocktake.appliedAt || movement.createdAt >= stocktake.appliedAt)
    );

    return {
      stocktake: toStocktakePayload(stocktake),
      movements: movements.map(toMovementWithContextPayload),
      canReverse: Boolean(stocktake.appliedAt && !hasReversal),
      hasReversal
    };
  },

  async createCorrection(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeCorrectionInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findFirst({
        where: scopedStocktakeWhere(id, reviewer),
        include: {
          lines: { include: lineInclude }
        }
      });

      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be corrected');
      }

      const hasReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (hasReversal) {
        throw new HttpError(409, 'Reversed stocktakes must be edited and resubmitted instead of corrected');
      }

      const linesById = new Map(stocktake.lines.map((line) => [line.id, line]));
      const movements: InventoryMovementWithContextRow[] = [];

      for (const correction of data.corrections) {
        const line = linesById.get(correction.sourceStocktakeLineId);
        if (!line || !line.itemId) {
          throw new HttpError(400, 'Correction line must be linked to a stock item');
        }

        const balanceTarget = await balanceTargetForItem(tx, line.itemId, stocktake.venue);
        if (!balanceTarget) throw new HttpError(404, `Stock item not found for ${line.label}`);

        const quantityBefore = balanceTarget.quantityBefore;
        const quantityAfter = correction.quantityAfter;
        const quantityDelta = quantityAfter - quantityBefore;
        if (Math.abs(quantityDelta) <= 0.0001) continue;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_CORRECTION',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: line.unit ?? balanceTarget.item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: line.id,
            notes: notesWithContext([
              `Correction for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              line.location ? `Location: ${line.location}` : null,
              `Reason: ${correction.reason.trim()}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      if (movements.length === 0) {
        throw new HttpError(400, 'Correction does not change any balances');
      }

      const updatedStocktake = await tx.stocktake.findUniqueOrThrow({
        where: { id },
        include: {
          lines: { include: lineInclude }
        }
      });

      return { stocktake: updatedStocktake, movements };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async reverseStocktake(
    id: string,
    input: unknown,
    reviewer?: AuthUser | null
  ): Promise<StocktakeMovementResult> {
    const data = stocktakeReversalInputSchema.parse(input);
    const reviewedBy = reviewerLabel(reviewer);
    const reason = data.reason?.trim() || 'Manager reversal';

    const result = await prisma.$transaction(async (tx) => {
      const stocktake = await tx.stocktake.findFirst({ where: scopedStocktakeWhere(id, reviewer) });
      if (!stocktake) throw new HttpError(404, 'Stocktake not found');
      if (!stocktake.appliedAt) {
        throw new HttpError(409, 'Only applied stocktakes can be reversed');
      }

      const existingReversal = await tx.inventoryMovement.count({
        where: reversalSinceAppliedWhere(id, stocktake.appliedAt)
      });
      if (existingReversal) {
        throw new HttpError(409, 'Stocktake has already been reversed');
      }

      const sourceMovements = await tx.inventoryMovement.findMany({
        where: {
          sourceStocktakeId: id,
          movementType: { in: ['STOCKTAKE_ADJUSTMENT', 'STOCKTAKE_CORRECTION'] },
          createdAt: { gte: stocktake.appliedAt }
        },
        orderBy: { createdAt: 'asc' }
      });

      if (sourceMovements.length === 0) {
        throw new HttpError(409, 'No stocktake ledger movements exist to reverse');
      }

      const netByLine = new Map<
        string,
        { itemId: string; sourceStocktakeLineId: string | null; unit: string | null; quantityDelta: number }
      >();
      for (const movement of sourceMovements) {
        const key = `${movement.itemId}:${movement.sourceStocktakeLineId ?? 'stocktake'}`;
        const current = netByLine.get(key) ?? {
          itemId: movement.itemId,
          sourceStocktakeLineId: movement.sourceStocktakeLineId,
          unit: movement.unit,
          quantityDelta: 0
        };
        current.quantityDelta += movement.quantityDelta;
        current.unit = movement.unit ?? current.unit;
        netByLine.set(key, current);
      }

      const movements: InventoryMovementWithContextRow[] = [];
      for (const group of netByLine.values()) {
        if (Math.abs(group.quantityDelta) <= 0.0001) continue;
        const balanceTarget = await balanceTargetForItem(tx, group.itemId, stocktake.venue);
        if (!balanceTarget) continue;

        const quantityBefore = balanceTarget.quantityBefore;
        const quantityDelta = -group.quantityDelta;
        const quantityAfter = quantityBefore + quantityDelta;

        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: balanceTarget.item.id,
            movementType: 'STOCKTAKE_REVERSAL',
            quantityDelta,
            quantityBefore,
            quantityAfter,
            unit: group.unit ?? balanceTarget.item.unit,
            sourceStocktakeId: stocktake.id,
            sourceStocktakeLineId: group.sourceStocktakeLineId,
            notes: notesWithContext([
              `Reversal for stocktake: ${stocktake.name}`,
              stocktake.venue ? `Venue: ${stocktake.venue}` : null,
              `Reason: ${reason}`,
              reviewedBy ? `Reviewed by: ${reviewedBy}` : null
            ])
          },
          include: {
            item: { select: { id: true, name: true, unit: true, onHand: true } },
            sourceStocktakeLine: {
              select: { id: true, label: true, countedQty: true, unit: true, location: true }
            }
          }
        });
        movements.push(movement);

        await balanceTarget.updateQuantityAfter(quantityAfter);
      }

      if (movements.length === 0) {
        throw new HttpError(409, 'Stocktake movements already net to zero');
      }

      const updatedStocktake = await tx.stocktake.update({
        where: { id },
        data: { appliedAt: null, status: 'IN_PROGRESS' },
        include: {
          lines: { include: lineInclude }
        }
      });

      return { stocktake: updatedStocktake, movements };
    }, { maxWait: 15_000, timeout: 30_000 });

    return {
      stocktake: await loadStocktakeWithVenueOnHand(result.stocktake.id, reviewer),
      movements: result.movements.map(toMovementWithContextPayload)
    };
  },

  async reviewQueue(actor?: AuthUser | null): Promise<{ stocktakes: StocktakeReviewItem[] }> {
    const rows = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { status: 'SUBMITTED', appliedAt: null }] },
      include: {
        _count: { select: { lines: true } },
        lines: {
          select: {
            countedQty: true,
            stockValueCents: true,
            unit: true,
            item: { select: { id: true, onHand: true } }
          }
        }
      },
      orderBy: [{ submittedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 50
    });
    const venueOnHandByKey = await venueOnHandLookup(rows);
    return { stocktakes: rows.map((row) => toStocktakeReviewPayload(row, venueOnHandByKey)) };
  },

  async reopenStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.appliedAt) {
      throw new HttpError(409, 'Applied stocktakes must be reversed before reopening.');
    }
    if (existing.status !== 'SUBMITTED' && existing.status !== 'REVIEWED') {
      throw new HttpError(400, 'Only submitted or reviewed stocktakes can be reopened.');
    }

    // Reopening un-submits. It used to stamp reviewedAt as well, recording a
    // review that never happened on a count going back to draft.
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'IN_PROGRESS',
        submittedAt: null,
        submittedByUserId: null,
        reviewedAt: null,
        reviewedByUserId: null,
        reopenedAt: new Date(),
        reopenedByUserId: actor?.id ?? null
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async deleteStocktakes(input: unknown, actor?: AuthUser | null): Promise<{ deleted: number }> {
    const { ids } = stocktakeBulkDeleteInputSchema.parse(input);
    const uniqueIds = Array.from(new Set(ids));
    const visible = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds } }] },
      select: { id: true }
    });
    if (visible.length !== uniqueIds.length) {
      throw new HttpError(403, 'Stocktake deletion is limited to your venue.');
    }

    const applied = await prisma.stocktake.findMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds }, appliedAt: { not: null } }] },
      select: { id: true, name: true, appliedAt: true }
    });
    const blocked: string[] = [];
    for (const stocktake of applied) {
      const hasReversal = await prisma.inventoryMovement.count({
        where: reversalSinceAppliedWhere(stocktake.id, stocktake.appliedAt)
      });
      if (!hasReversal) blocked.push(stocktake.name);
    }
    if (blocked.length > 0) {
      throw new HttpError(
        409,
        `Applied stocktakes cannot be deleted without a reversal: ${blocked.join(', ')}`
      );
    }
    const result = await prisma.stocktake.deleteMany({
      where: { AND: [stocktakeScope(actor), { id: { in: uniqueIds } }] }
    });
    return { deleted: result.count };
  },

  // ──────────────────────────────────────────────────────────────
  // Stocktake state machine (Loaded replacement Sprint 1)
  //
  // IN_PROGRESS → SUBMITTED → REVIEWED → LOCKED. LOCKED can be
  // REOPENED back to IN_PROGRESS with a reason. Once LOCKED, reports
  // prefer this stocktake when computing stock value + COGS.
  // ──────────────────────────────────────────────────────────────

  // Submitting is the moment a count stops being a work in progress and
  // becomes an assertion about the venue — which is what finally settles what
  // a BLANK line means.
  //
  // While counting, blank has to mean "nobody has looked at this yet", or a
  // half-finished sheet would zero every shelf the counter had not reached.
  // But a finished count says otherwise: if the sheet covers the item and
  // nothing was written next to it, there is none. Leaving it blank forever
  // was the worse of the two readings — apply skips it, so the item keeps
  // whatever on-hand it had LAST time, and an empty shelf quietly carries
  // yesterday's phantom stock into the new count.
  //
  // So blanks become zeros here, at submit, and nowhere earlier. Nobody has to
  // type 0 three hundred times at the end of a long day, and no draft can
  // destroy a count that is still being taken.
  async submitStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    // REOPENED is a draft handed back for correction; once corrected it goes
    // through review again. Refusing it left a reopened count with no way
    // forward except a manager hand-editing its status.
    if (existing.status !== 'IN_PROGRESS' && existing.status !== 'REOPENED') {
      throw new HttpError(409, `Stocktake is ${existing.status}, only draft (IN_PROGRESS or REOPENED) stocktakes can be submitted.`);
    }

    const { row, blankLinesZeroed } = await prisma.$transaction(async (tx) => {
      // A counted zero is worth zero, whatever the item costs, so the value
      // needs no per-line arithmetic — one statement covers the whole sheet.
      const zeroed = await tx.stocktakeLine.updateMany({
        where: { stocktakeId: id, countedQty: null },
        data: { countedQty: 0, stockValueCents: 0 }
      });
      const updated = await tx.stocktake.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          submittedByUserId: actor?.id ?? null
        },
        include: {
          _count: { select: { lines: true } },
          lines: { select: { stockValueCents: true } }
        }
      });
      return { row: updated, blankLinesZeroed: zeroed.count };
    }, { maxWait: 15_000, timeout: 30_000 });

    return { ...toStocktakePayload(row), blankLinesZeroed };
  },

  async reviewStocktake(id: string, actor: AuthUser | undefined | null, input: { notes?: string }): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (existing.status !== 'SUBMITTED') {
      throw new HttpError(409, `Stocktake is ${existing.status}, only SUBMITTED stocktakes can be reviewed.`);
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'REVIEWED',
        reviewedAt: new Date(),
        reviewedByUserId: actor?.id ?? null,
        ...(input.notes ? { notes: existing.notes ? `${existing.notes}\n\nReviewer: ${input.notes.trim()}` : `Reviewer: ${input.notes.trim()}` } : {})
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async lockStocktake(id: string, actor?: AuthUser | null): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (!['REVIEWED', 'SUBMITTED'].includes(existing.status)) {
      throw new HttpError(409, `Stocktake is ${existing.status}, only REVIEWED or SUBMITTED stocktakes can be locked.`);
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'LOCKED',
        lockedAt: new Date(),
        lockedByUserId: actor?.id ?? null
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  async reopenStocktakeWithReason(id: string, actor: AuthUser | undefined | null, reason: string): Promise<Stocktake> {
    const existing = await prisma.stocktake.findFirst({ where: scopedStocktakeWhere(id, actor) });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    if (!['SUBMITTED', 'REVIEWED', 'LOCKED'].includes(existing.status)) {
      throw new HttpError(409, `Stocktake is ${existing.status}, only SUBMITTED / REVIEWED / LOCKED stocktakes can be reopened.`);
    }
    if (!reason || reason.trim().length < 5) {
      throw new HttpError(400, 'Reopen requires a reason of at least 5 characters — it goes into the audit log.');
    }
    const row = await prisma.stocktake.update({
      where: { id },
      data: {
        status: 'REOPENED',
        reopenedAt: new Date(),
        reopenedByUserId: actor?.id ?? null,
        reopenReason: reason.trim()
      },
      include: {
        _count: { select: { lines: true } },
        lines: { select: { stockValueCents: true } }
      }
    });
    return toStocktakePayload(row);
  },

  // Variance review (#9). Compares the target stocktake to the previous
  // LOCKED stocktake at the same venue. Returns line-level deltas + a
  // categorised summary so the manager can spot the worst movers fast.
  async varianceReport(id: string, actor?: AuthUser | null) {
    const target = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        lines: { include: { item: { include: { category: true } } } }
      }
    });
    if (!target) throw new HttpError(404, 'Stocktake not found');

    // What the prepped-item lines hold, folded into the counted side.
    //
    // This is the whole reason the feature exists. Expected-on-hand is
    // anchored on the previous count and depleted by SALES, so raw material
    // that was cooked but not sold has left the shelf without leaving the
    // building — and comparing it against a loose-only count reports the
    // entire production fridge as unexplained loss, every single week.
    const prepByItem = target.lines.some((line) => line.recipeId)
      ? new Map(
          (await buildPrepSummary(prisma, target.lines)).contributions.map((row) => [row.itemId, row.quantity])
        )
      : new Map<string, number>();

    // Find the previous LOCKED stocktake at the same venue, before this one.
    const previous = await prisma.stocktake.findFirst({
      where: {
        ...(target.venue ? { venue: target.venue } : {}),
        status: 'LOCKED',
        id: { not: target.id },
        countedAt: { lt: target.countedAt }
      },
      orderBy: [{ countedAt: 'desc' }],
      include: { lines: true }
    });

    // The opening balance is folded the same way, for the same reason: the
    // previous count's line holds only what was loose, while the on-hand it
    // applied included its prep. Comparing a prep-folded count against a
    // loose-only opening would report the whole production fridge as a GAIN —
    // the same error with its sign flipped.
    const previousPrepByItem = previous?.lines.some((line) => line.recipeId)
      ? new Map(
          (await buildPrepSummary(prisma, previous.lines)).contributions.map((row) => [row.itemId, row.quantity])
        )
      : new Map<string, number>();

    const previousByItemId = new Map<string, { qty: number; valueCents: number | null }>();
    if (previous) {
      for (const line of previous.lines) {
        if (!line.itemId || line.countedQty == null) continue;
        previousByItemId.set(line.itemId, {
          qty: Math.round((line.countedQty + (previousPrepByItem.get(line.itemId) ?? 0)) * 1e6) / 1e6,
          valueCents: line.stockValueCents
        });
      }
    }

    // Expected-on-hand since the previous locked count, per item:
    //   expected = opening count + (deliveries − wastage from the ledger)
    //              − theoretical sales usage (recipe BOM × Square units)
    // counted − expected = the real, unexplained shrinkage/loss. Only computable
    // when a previous locked count anchors the opening balance.
    const usageByItem = previous
      ? await theoreticalUsageByItem(target.venue ?? null, previous.countedAt, target.countedAt)
      : new Map<string, number>();
    const ledgerByItem = new Map<string, number>();
    if (previous) {
      const venue = target.venue ?? null;
      const movements = await prisma.inventoryMovement.findMany({
        where: {
          movementType: { in: ['DELIVERY_RECEIPT', 'WASTAGE'] },
          createdAt: { gt: previous.countedAt, lte: target.countedAt },
          ...(venue
            ? {
                OR: [
                  { sourceWastage: { venue } },
                  { sourceDeliveryCheckItem: { deliveryCheck: { venue } } }
                ]
              }
            : {})
        },
        select: { itemId: true, quantityDelta: true }
      });
      for (const movement of movements) {
        ledgerByItem.set(movement.itemId, (ledgerByItem.get(movement.itemId) ?? 0) + movement.quantityDelta);
      }
    }

    const HIGH_VARIANCE_THRESHOLD = 0.2; // ±20% qty change flags as high
    let highVarianceCount = 0;
    let missingCount = 0;
    let zeroCount = 0;
    let newItemCount = 0;
    let unexplainedShrinkageValueCents = 0;

    const rows = target.lines.map((line) => {
      const prev = line.itemId ? previousByItemId.get(line.itemId) : undefined;
      // Counted = loose on the shelf + held inside the prep that was counted.
      // Both are stock; comparing only the first is what produced the phantom
      // shrinkage.
      const prepQty = line.itemId && line.countedQty !== null ? prepByItem.get(line.itemId) ?? 0 : 0;
      const countedQty =
        line.countedQty === null ? null : Math.round((line.countedQty + prepQty) * 1e6) / 1e6;
      const varianceQty = prev !== undefined && countedQty !== null ? countedQty - prev.qty : null;
      const varianceValueCents = prev !== undefined && prev.valueCents !== null && line.stockValueCents !== null
        ? line.stockValueCents - prev.valueCents
        : null;
      const variancePct = prev !== undefined && prev.qty > 0 && countedQty !== null
        ? (countedQty - prev.qty) / prev.qty
        : null;

      // Expected-vs-counted: what the shelf *should* hold given usage + movements.
      const theoreticalUsageQty = line.itemId ? usageByItem.get(line.itemId) ?? 0 : 0;
      const ledgerDelta = line.itemId ? ledgerByItem.get(line.itemId) ?? 0 : 0;
      const expectedQty = prev !== undefined ? prev.qty + ledgerDelta - theoreticalUsageQty : null;
      const expectedVarianceQty =
        expectedQty !== null && countedQty !== null ? countedQty - expectedQty : null;
      const countUnitCostCents = line.item?.avgCostCents ?? null;
      const expectedVarianceValueCents =
        expectedVarianceQty !== null && countUnitCostCents !== null
          ? Math.round(expectedVarianceQty * countUnitCostCents)
          : null;
      if (expectedVarianceValueCents !== null && expectedVarianceValueCents < 0) {
        unexplainedShrinkageValueCents += expectedVarianceValueCents;
      }

      const isMissing = line.countedQty === null || Number.isNaN(line.countedQty);
      const isZero = countedQty === 0;
      const isNew = prev === undefined && line.itemId !== null;
      const isHighVariance = variancePct !== null && Math.abs(variancePct) > HIGH_VARIANCE_THRESHOLD;

      if (isMissing) missingCount += 1;
      else if (isZero) zeroCount += 1;
      if (isHighVariance) highVarianceCount += 1;
      if (isNew) newItemCount += 1;

      return {
        lineId: line.id,
        itemId: line.itemId,
        label: line.label,
        category: line.item?.category?.name ?? null,
        countArea: line.location ?? line.item?.countArea ?? null,
        unit: line.unit ?? line.item?.countUnit ?? line.item?.unit ?? null,
        // What kind of line this is, so a reader can tell a tub of mole from a
        // shelf item that happens to share its name.
        lineKind: line.recipeId ? ('PREPPED_ITEM' as const) : ('STOCK_ITEM' as const),
        currentQty: countedQty,
        // The split behind currentQty: how much of it was counted loose, and
        // how much came out of the prep. Zero on every line of a count with no
        // prepped items.
        countedLooseQty: line.countedQty,
        heldInPrepQty: prepQty,
        previousQty: prev?.qty ?? null,
        varianceQty,
        variancePct,
        currentValueCents: line.stockValueCents,
        previousValueCents: prev?.valueCents ?? null,
        varianceValueCents,
        flags: {
          missing: isMissing,
          zero: isZero,
          newItem: isNew,
          highVariance: isHighVariance
        },
        latestCostCents: line.item?.latestCostCents ?? line.item?.avgCostCents ?? null,
        theoreticalUsageQty: prev !== undefined && line.itemId ? theoreticalUsageQty : null,
        expectedQty,
        expectedVarianceQty,
        expectedVarianceValueCents
      };
    });

    return {
      generatedAt: new Date().toISOString(),
      stocktakeId: target.id,
      stocktakeName: target.name,
      stocktakeStatus: target.status,
      countedAt: target.countedAt.toISOString(),
      previousLocked: previous
        ? { id: previous.id, name: previous.name, countedAt: previous.countedAt.toISOString() }
        : null,
      summary: {
        totalLines: rows.length,
        highVariance: highVarianceCount,
        missing: missingCount,
        zero: zeroCount,
        newItems: newItemCount,
        highVarianceThresholdPct: HIGH_VARIANCE_THRESHOLD * 100,
        // Expected-vs-counted: total value of unexplained loss (counted below
        // expected). null when no previous locked count anchors the period.
        expectedAvailable: previous !== null,
        unexplainedShrinkageValueCents: previous !== null ? unexplainedShrinkageValueCents : null
      },
      // Worst variances first so the manager sees the most surprising lines.
      rows: rows.sort((a, b) => {
        const av = a.varianceValueCents === null ? 0 : Math.abs(a.varianceValueCents);
        const bv = b.varianceValueCents === null ? 0 : Math.abs(b.varianceValueCents);
        return bv - av;
      })
    };
  },

  // The paper count sheet for an existing stocktake. Staff said it is easier
  // to print a sheet and write on it than count into any app, so this is a
  // first-class output, not a screenshot: grouped by count area in walking
  // order, one row per line, a box to write the count in, and the expected
  // on-hand only when the sheet is not blind. Readable by anyone who can
  // count, since the counter is the one who prints it.
  async countSheet(
    id: string,
    actor: AuthUser | undefined | null,
    options: { blind?: boolean } = {}
  ): Promise<StocktakeCountSheet> {
    const existing = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        lines: {
          include: {
            item: { include: { category: { select: { name: true } } } },
            recipe: { select: { id: true, title: true, yieldUnit: true } }
          },
          orderBy: [{ position: 'asc' }]
        }
      }
    });
    if (!existing) throw new HttpError(404, 'Stocktake not found');
    const blind = options.blind ?? true;
    const venueOnHandByKey = await venueOnHandLookup([existing]);
    const rows = existing.lines.map((line) => {
      const kind = line.recipeId ? ('PREPPED_ITEM' as const) : ('STOCK_ITEM' as const);
      const item = line.item;
      const expected = item
        ? effectiveVenueOnHand(existing.venue, item.id, item.onHand, venueOnHandByKey)
        : null;
      return {
        lineId: line.id,
        itemId: line.itemId,
        recipeId: line.recipeId,
        // The item's current name, as the counting screen shows it; the
        // line keeps its own label as the record of what was counted.
        label: item?.name ?? line.label,
        sku: item?.sku ?? null,
        category: item?.category?.name ?? null,
        unit: line.unit ?? item?.countUnit ?? item?.unit ?? line.recipe?.yieldUnit ?? '',
        purchaseUnit: item && item.countUnit && item.countUnit !== item.unit ? item.unit : null,
        conversionFactor: item && item.countUnit && item.countUnit !== item.unit ? item.conversionFactor : null,
        expectedQty: blind ? null : expected,
        parLevel: item?.parLevel ?? null,
        countedQty: line.countedQty,
        notes: line.notes,
        kind,
        area: line.location ?? item?.countArea ?? item?.category?.name ?? null
      };
    });
    return {
      source: 'stocktake',
      stocktakeId: existing.id,
      templateId: null,
      name: existing.name,
      venue: existing.venue,
      template: existing.template,
      countedAt: existing.countedAt.toISOString(),
      status: existing.status,
      blind,
      generatedAt: new Date().toISOString(),
      lineCount: rows.length,
      sections: buildCountSheetSections(rows)
    };
  },

  // CSV export — drops the stocktake into a one-row-per-line CSV.
  // Used by the Loaded replacement archive flow + ad-hoc downloads.
  async exportCsv(id: string, actor?: AuthUser | null): Promise<{ filename: string; csv: string }> {
    const existing = await prisma.stocktake.findFirst({
      where: scopedStocktakeWhere(id, actor),
      include: {
        lines: {
          include: { item: { include: { category: true } }, recipe: { select: { title: true } } },
          orderBy: [{ position: 'asc' }]
        }
      }
    });
    if (!existing) throw new HttpError(404, 'Stocktake not found');

    function csvCell(value: unknown): string {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }

    // line_kind separates the two things a row can be. Without it a prepped
    // item reads as an ordinary count of an item that does not exist, and the
    // archive silently double-counts against the exploded ingredients.
    const headers = [
      'stocktake_id', 'name', 'venue', 'status', 'counted_at',
      'area', 'category', 'line_kind', 'item', 'sku', 'quantity', 'unit',
      'latest_cost_cents', 'stock_value_cents', 'notes'
    ];
    const rows = existing.lines.map((line) => ({
      stocktake_id: existing.id,
      name: existing.name,
      venue: existing.venue ?? '',
      status: existing.status,
      counted_at: existing.countedAt?.toISOString().slice(0, 10) ?? '',
      area: line.location ?? line.item?.countArea ?? '',
      category: line.item?.category?.name ?? '',
      line_kind: line.recipeId ? 'PREPPED_ITEM' : 'STOCK_ITEM',
      item: line.label,
      sku: line.item?.sku ?? '',
      quantity: line.countedQty,
      unit: line.unit ?? line.item?.countUnit ?? line.item?.unit ?? '',
      latest_cost_cents: line.item?.latestCostCents ?? line.item?.avgCostCents ?? '',
      stock_value_cents: line.stockValueCents ?? '',
      notes: line.notes ?? ''
    }));

    const csv = [headers, ...rows.map((row) => headers.map((header) => csvCell((row as Record<string, unknown>)[header])))]
      .map((row) => row.map((cell) => (typeof cell === 'string' ? cell : csvCell(cell))).join(','))
      .join('\n');

    return {
      filename: `alma-stocktake-${existing.name.replace(/\s+/g, '-').toLowerCase()}-${existing.id}.csv`,
      csv
    };
  }
};
