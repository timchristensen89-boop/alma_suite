import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  invoiceExclusionRuleInputSchema,
  aliasKey,
  matchInvoiceLine,
  suggestItems,
  normaliseSupplierName,
  stockInvoiceMatchingStatusSchema,
  stockInvoiceDeleteInputSchema,
  stockInvoiceImportInputSchema,
  stockInvoiceLineRematchInputSchema,
  stockInvoiceMarkNeedsReviewInputSchema,
  stockInvoiceMarkNoItemInputSchema,
  stockInvoiceRipInputSchema,
  stockInvoiceOcrInputSchema,
  stockInvoicePasteLinesInputSchema,
  stockInvoicePaymentInputSchema,
  parseInvoicePaste,
  reconcilePaste,
  type InvoiceExclusionRule,
  type StockInvoicePaymentStatus,
  type StockPaymentsSummary,
  type StockInvoiceApplyAllCostsResult,
  type StockInvoiceAssignee,
  type StockInvoiceAssigneesPayload,
  type StockInvoiceImportResult,
  type StockInvoiceMatchingStatus,
  type StockInvoiceRipResult,
  type StockInvoiceTriageStatus,
  type StockInvoicesPayload,
  type StockInvoicesSummary,
  type StockUnmatchedSpendPayload,
  type StockUnmatchedSpendRow,
  type StockSupplierInvoice,
  type StockSupplierInvoiceLine
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { recomputeRecipeCostsForItems } from './recipes.service.js';

type JsonRecord = Record<string, unknown>;

const lineItemSelect = {
  id: true,
  name: true,
  unit: true,
  countUnit: true,
  conversionFactor: true,
  onHand: true,
  latestCostCents: true,
  latestCostAt: true,
  avgCostCents: true
} satisfies Prisma.StockItemSelect;

const matchItemSelect = {
  ...lineItemSelect,
  sku: true,
  status: true
} satisfies Prisma.StockItemSelect;

type MatchItemRow = Prisma.StockItemGetPayload<{ select: typeof matchItemSelect }>;
type InvoiceLineRow = Prisma.SupplierInvoiceLineGetPayload<{
  include: { item: { select: typeof lineItemSelect } };
}>;
const assigneeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  roleTitle: true
} satisfies Prisma.StaffProfileSelect;

const invoiceInclude = {
  lines: { include: { item: { select: lineItemSelect } } },
  triagedBy: { select: assigneeSelect },
  assignedTo: { select: assigneeSelect },
  // Metadata only (not the blob) so list queries stay light.
  document: { select: { id: true } }
} satisfies Prisma.SupplierInvoiceInclude;

type InvoiceRow = Prisma.SupplierInvoiceGetPayload<{ include: typeof invoiceInclude }>;
type AssigneeRow = Prisma.StaffProfileGetPayload<{ select: typeof assigneeSelect }>;

type NormalisedLine = {
  lineNumber: number;
  lineKey: string;
  externalLineId: string | null;
  description: string;
  itemCode: string | null;
  accountCode: string | null;
  quantity: number;
  unit: string | null;
  unitAmountCents: number;
  lineAmountCents: number;
  taxAmountCents: number;
  sourceMetadata: JsonRecord;
};

type NormalisedInvoice = {
  source: string;
  invoiceKey: string;
  externalInvoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string;
  supplierEmail: string | null;
  venue: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  currencyCode: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  sourceFileName: string | null;
  sourceFileType: string | null;
  sourceMetadata: JsonRecord;
  lines: NormalisedLine[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimText(value: unknown): string {
  return String(value ?? '').trim();
}

function optionalText(value: unknown): string | null {
  const text = trimText(value);
  return text ? text : null;
}

function normaliseKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normaliseMatchText(value: unknown) {
  return trimText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function unitCostFromPurchaseCost(purchaseCostCents: number, item: Pick<MatchItemRow, 'conversionFactor'>) {
  return Math.round(purchaseCostCents / Math.max(item.conversionFactor || 1, 1));
}

// Weighted moving average cost: blend the item's existing avg cost with this
// purchase, weighted by current on-hand vs quantity received. Falls back to the
// new unit cost when there's no reliable history to blend (no on-hand, no prior
// avg, or no received qty) — so it's never wilder than plain last-price, but
// smooths price swings when stock is already on the shelf. countUnits = purchase
// quantity × conversionFactor (the item's cost/count unit).
function weightedAverageCostCents(params: {
  onHand: number | null | undefined;
  currentAvgCents: number | null | undefined;
  receivedCountUnits: number;
  newUnitCostCents: number;
}): number {
  const onHand = params.onHand ?? 0;
  const oldAvg = params.currentAvgCents ?? 0;
  const received = params.receivedCountUnits;
  if (onHand <= 0 || oldAvg <= 0 || received <= 0) return params.newUnitCostCents;
  const blended = (onHand * oldAvg + received * params.newUnitCostCents) / (onHand + received);
  return Math.round(blended);
}

function toLookupRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  return Object.entries(value).reduce<JsonRecord>((accumulator, [key, entry]) => {
    accumulator[normaliseKey(key)] = entry;
    return accumulator;
  }, {});
}

function pickValue(record: JsonRecord, aliases: string[]): unknown {
  for (const alias of aliases) {
    const value = record[normaliseKey(alias)];
    if (value !== undefined && value !== null && trimText(value)) return value;
  }
  return undefined;
}

function pickOptionalString(record: JsonRecord, aliases: string[]) {
  return optionalText(pickValue(record, aliases));
}

function pickString(record: JsonRecord, aliases: string[], fallback = '') {
  return optionalText(pickValue(record, aliases)) ?? fallback;
}

function pickNumber(record: JsonRecord, aliases: string[], fallback = 0) {
  const value = pickValue(record, aliases);
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(trimText(value).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moneyToCents(value: unknown) {
  const amount = typeof value === 'number' ? value : pickNumber({ amount: value }, ['amount']);
  return Math.round(amount * 100);
}

function parseDate(value: unknown): Date | null {
  const text = trimText(value);
  if (!text) return null;

  const xeroJsonDate = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(text);
  const date = xeroJsonDate?.[1]
    ? new Date(Number(xeroJsonDate[1]))
    : new Date(text);

  return Number.isNaN(date.getTime()) ? null : date;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function buildHash(parts: Array<string | number | null | undefined>) {
  const hash = createHash('sha1');
  hash.update(parts.map((part) => trimText(part)).join('|'));
  return hash.digest('hex');
}

function matchingStatus(value: string): StockInvoiceMatchingStatus {
  // Parsed against the schema rather than a second hand-written list — the
  // duplicate list here silently coerced NON_STOCK back to NEEDS_REVIEW, so
  // charge lines kept reappearing in the queue after being set aside.
  const parsed = stockInvoiceMatchingStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : 'NEEDS_REVIEW';
}

function triageStatusValue(value: string): StockInvoiceTriageStatus {
  if (value === 'NO_ITEM' || value === 'NEEDS_REVIEW' || value === 'PENDING') {
    return value;
  }
  return 'PENDING';
}

function paymentStatusValue(value: string): StockInvoicePaymentStatus {
  if (value === 'PAID' || value === 'PARTIALLY_PAID') return value;
  return 'UNPAID';
}

// Applying an invoice cost is the one moment we KNOW what this supplier
// charges today, so the supplier price list follows automatically. The list
// held 0 rows in production precisely because it was a second catalogue to
// maintain by hand next to the invoices already being processed — now the
// invoices maintain it, and the order guide prices from it.
async function syncPriceListFromLine(
  tx: Prisma.TransactionClient,
  supplierId: string | null | undefined,
  line: { itemId: string | null; description: string; unit: string | null; unitAmountCents: number },
  itemName?: string | null
) {
  if (!supplierId || !line.itemId || line.unitAmountCents <= 0) return;
  await tx.supplierPriceListItem.upsert({
    where: { supplierId_stockItemId: { supplierId, stockItemId: line.itemId } },
    create: {
      supplierId,
      stockItemId: line.itemId,
      description: itemName?.trim() || line.description,
      unit: line.unit,
      unitCostCents: line.unitAmountCents,
      effectiveAt: new Date()
    },
    update: {
      unitCostCents: line.unitAmountCents,
      ...(line.unit ? { unit: line.unit } : {}),
      effectiveAt: new Date()
    }
  });
}

function toAssigneePayload(row: AssigneeRow | null): StockInvoiceAssignee | null {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    roleTitle: row.roleTitle
  };
}

function normaliseImportBody(input: unknown): unknown {
  if (Array.isArray(input)) {
    return { source: 'XERO', invoices: input };
  }
  if (!isRecord(input)) return input;

  const lookup = toLookupRecord(input);
  const invoices = pickValue(lookup, ['invoices', 'Invoices']);
  if (Array.isArray(invoices) && !Array.isArray(input.invoices)) {
    return { ...input, invoices };
  }
  return input;
}

function normaliseLine(rawLine: unknown, index: number): NormalisedLine {
  const raw = isRecord(rawLine) ? rawLine : { description: rawLine };
  const lookup = toLookupRecord(raw);
  const externalLineId = pickOptionalString(lookup, ['LineItemID', 'lineItemId', 'id']);
  const description = pickString(lookup, ['Description', 'description', 'item', 'name'], 'Invoice line');
  const itemCode = pickOptionalString(lookup, ['ItemCode', 'itemCode', 'sku', 'code']);
  const accountCode = pickOptionalString(lookup, ['AccountCode', 'accountCode']);
  const quantity = pickNumber(lookup, ['Quantity', 'quantity', 'qty'], 0);
  const unit = pickOptionalString(lookup, ['Unit', 'unit', 'unitName']);
  const unitAmountSource = pickValue(lookup, ['UnitAmount', 'unitAmount', 'unitPrice', 'price']);
  const lineAmountSource = pickValue(lookup, ['LineAmount', 'lineAmount', 'amount', 'total']);
  const taxAmountSource = pickValue(lookup, ['TaxAmount', 'taxAmount', 'tax']);
  const lineKey =
    externalLineId ??
    pickOptionalString(lookup, ['lineKey', 'key']) ??
    buildHash([index, description, itemCode, quantity, trimText(lineAmountSource)]);

  return {
    lineNumber: index + 1,
    lineKey,
    externalLineId,
    description,
    itemCode,
    accountCode,
    quantity,
    unit,
    unitAmountCents: moneyToCents(unitAmountSource),
    lineAmountCents: moneyToCents(lineAmountSource),
    taxAmountCents: moneyToCents(taxAmountSource),
    sourceMetadata: raw
  };
}

function normaliseInvoice(
  rawInvoice: JsonRecord,
  index: number,
  defaults: {
    source: string;
    venue: string | null;
    sourceFileName: string | null;
    sourceFileType: string | null;
    sourceMetadata: JsonRecord;
  }
): NormalisedInvoice {
  const lookup = toLookupRecord(rawInvoice);
  const contact = toLookupRecord(pickValue(lookup, ['Contact', 'contact']) ?? {});
  const supplierName =
    pickOptionalString(contact, ['Name', 'name']) ??
    pickOptionalString(lookup, ['supplierName', 'supplier', 'contactName']) ??
    'Unknown supplier';
  const supplierEmail =
    pickOptionalString(contact, ['EmailAddress', 'emailAddress', 'email']) ??
    pickOptionalString(lookup, ['supplierEmail', 'email']);
  const externalInvoiceId = pickOptionalString(lookup, ['InvoiceID', 'invoiceId', 'id']);
  const invoiceNumber = pickOptionalString(lookup, ['InvoiceNumber', 'invoiceNumber', 'number']);
  const invoiceDate = parseDate(pickValue(lookup, ['DateString', 'dateString', 'Date', 'date']));
  const dueDate = parseDate(pickValue(lookup, ['DueDateString', 'dueDateString', 'DueDate', 'dueDate']));
  const currencyCode = pickString(lookup, ['CurrencyCode', 'currencyCode', 'currency'], 'AUD').toUpperCase();
  const status = pickString(lookup, ['Status', 'status'], 'DRAFT').toUpperCase();
  const subtotalSource = pickValue(lookup, ['SubTotal', 'subtotal', 'subtotalAmount']);
  const taxSource = pickValue(lookup, ['TotalTax', 'tax', 'taxAmount']);
  const totalSource = pickValue(lookup, ['Total', 'total', 'totalAmount']);
  const rawLines =
    pickValue(lookup, ['LineItems', 'lineItems', 'lines', 'items']) ??
    [];
  const lines = Array.isArray(rawLines)
    ? rawLines.map((line, lineIndex) => normaliseLine(line, lineIndex))
    : [];
  const derivedSubtotal = lines.reduce((total, line) => total + line.lineAmountCents, 0);
  const taxCents = moneyToCents(taxSource);
  const subtotalCents = moneyToCents(subtotalSource) || derivedSubtotal;
  const totalCents = moneyToCents(totalSource) || subtotalCents + taxCents;
  const invoiceKey =
    pickOptionalString(lookup, ['invoiceKey', 'key']) ??
    externalInvoiceId ??
    buildHash([
      defaults.source,
      supplierName,
      invoiceNumber,
      invoiceDate?.toISOString() ?? null,
      totalCents,
      index
    ]);

  return {
    source: defaults.source,
    invoiceKey,
    externalInvoiceId,
    invoiceNumber,
    supplierName,
    supplierEmail,
    venue: defaults.venue,
    invoiceDate,
    dueDate,
    currencyCode,
    status,
    subtotalCents,
    taxCents,
    totalCents,
    sourceFileName: defaults.sourceFileName,
    sourceFileType: defaults.sourceFileType,
    sourceMetadata: { ...defaults.sourceMetadata, rawInvoice },
    lines
  };
}

/**
 * Wraps the shared matcher so the service, its tests and any review screen all
 * decide a match the same way. The old logic here was exact SKU, exact name,
 * or item-name-as-substring — which left 71% of production lines unmatched
 * because supplier descriptions interleave brand, pack size and order
 * commentary through the product name.
 */
function findItemMatch(
  line: NormalisedLine,
  items: MatchItemRow[],
  context: { supplierName?: string | null; aliases?: Map<string, string> } = {}
): { itemId: string | null; status: StockInvoiceMatchingStatus } {
  const match = matchInvoiceLine(
    { description: line.description, itemCode: line.itemCode },
    items.map((item) => ({ id: item.id, name: item.name, sku: item.sku })),
    context
  );
  return { itemId: match.itemId, status: match.status };
}

async function ensureSupplier(
  tx: Prisma.TransactionClient,
  supplierName: string,
  supplierEmail: string | null
) {
  const name = supplierName.trim();
  const canonical = normaliseSupplierName(name);
  if (!canonical) return null; // blank or the "Unknown supplier" sentinel

  // Match on the canonical name (punctuation/whitespace-insensitive, same key
  // the Xero importer uses) so "Food By Us" and "FoodByUs Pty Ltd" don't spawn
  // a second row; fall back to an email match. The Supplier table is small, so
  // fetch-and-match in JS instead of a punctuation-blind SQL equals.
  const candidates = await tx.supplier.findMany({ select: { id: true, name: true, email: true } });
  const email = supplierEmail?.trim().toLowerCase() || '';
  const existing =
    candidates.find((s) => normaliseSupplierName(s.name) === canonical) ??
    (email ? candidates.find((s) => (s.email ?? '').trim().toLowerCase() === email) : undefined);

  if (existing) {
    if (supplierEmail && !existing.email) {
      await tx.supplier.update({ where: { id: existing.id }, data: { email: supplierEmail } });
    }
    return existing.id;
  }

  const created = await tx.supplier.create({
    data: { name, email: supplierEmail, status: 'ACTIVE' }
  });
  return created.id;
}

/**
 * Apply a freshly-taught alias to the lines already in the review queue.
 *
 * Supplier wording repeats verbatim: 471 unmatched lines in production are only
 * 138 distinct descriptions, and the worst offender wears the same words eleven
 * times. Teaching the alias without sweeping them means a manager answers the
 * same question eleven times.
 *
 * Scoped to lines that are still unmatched — a manual match somebody made by
 * hand is never overwritten — and to the supplier the alias was learned from
 * when it is supplier-specific.
 */
async function applyAliasToWaitingLines(
  key: string,
  itemId: string,
  supplierId: string | null,
  exceptLineId: string
): Promise<number> {
  const candidates = await prisma.supplierInvoiceLine.findMany({
    where: {
      id: { not: exceptLineId },
      itemId: null,
      matchingStatus: 'NEEDS_REVIEW',
      ...(supplierId ? { invoice: { supplierId } } : {})
    },
    select: { id: true, description: true }
  });
  const ids = candidates.filter((line) => aliasKey(line.description) === key).map((line) => line.id);
  if (ids.length === 0) return 0;
  const result = await prisma.supplierInvoiceLine.updateMany({
    where: { id: { in: ids } },
    data: { itemId, matchingStatus: 'AUTO_MATCHED' }
  });
  return result.count;
}

function toLinePayload(row: InvoiceLineRow): StockSupplierInvoiceLine {
  return {
    id: row.id,
    supplierInvoiceId: row.supplierInvoiceId,
    lineNumber: row.lineNumber,
    lineKey: row.lineKey,
    externalLineId: row.externalLineId,
    description: row.description,
    itemCode: row.itemCode,
    accountCode: row.accountCode,
    quantity: row.quantity,
    unit: row.unit,
    unitAmountCents: row.unitAmountCents,
    lineAmountCents: row.lineAmountCents,
    taxAmountCents: row.taxAmountCents,
    itemId: row.itemId,
    item: row.item
      ? {
          ...row.item,
          latestCostAt: row.item.latestCostAt?.toISOString() ?? null
        }
      : null,
    matchingStatus: matchingStatus(row.matchingStatus),
    notes: row.notes,
    costAppliedAt: row.costAppliedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toInvoicePayload(row: InvoiceRow): StockSupplierInvoice {
  const lines = row.lines.map(toLinePayload);
  const matchedLineCount = lines.filter((line) => line.itemId).length;
  const needsReviewLineCount = lines.filter((line) => line.matchingStatus === 'NEEDS_REVIEW').length;

  return {
    id: row.id,
    source: row.source,
    invoiceKey: row.invoiceKey,
    externalInvoiceId: row.externalInvoiceId,
    invoiceNumber: row.invoiceNumber,
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    supplierEmail: row.supplierEmail,
    venue: row.venue,
    invoiceDate: row.invoiceDate?.toISOString() ?? null,
    dueDate: row.dueDate?.toISOString() ?? null,
    currencyCode: row.currencyCode,
    status: row.status,
    subtotalCents: row.subtotalCents,
    taxCents: row.taxCents,
    totalCents: row.totalCents,
    sourceFileName: row.sourceFileName,
    sourceFileType: row.sourceFileType,
    hasDocument: Boolean(row.document),
    importedAt: row.importedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lineCount: lines.length,
    matchedLineCount,
    needsReviewLineCount,
    triageStatus: triageStatusValue(row.triageStatus),
    triagedAt: row.triagedAt?.toISOString() ?? null,
    triagedBy: toAssigneePayload(row.triagedBy ?? null),
    assignedTo: toAssigneePayload(row.assignedTo ?? null),
    triageNotes: row.triageNotes,
    paymentStatus: paymentStatusValue(row.paymentStatus),
    amountPaidCents: row.amountPaidCents,
    paidAt: row.paidAt?.toISOString() ?? null,
    paymentReference: row.paymentReference,
    paymentNotes: row.paymentNotes,
    lines
  };
}

async function getInvoicePayload(id: string) {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: {
      ...invoiceInclude,
      lines: {
        include: { item: { select: lineItemSelect } },
        orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }]
      }
    }
  });
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  return toInvoicePayload(invoice);
}

function extractTextLineValue(lines: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    for (const line of lines) {
      const match = pattern.exec(line);
      if (match?.[1]) return match[1].trim();
    }
  }
  return null;
}

// ── Invoice exclusion rules ──────────────────────────────────────────
// Skip non-supplier documents (e.g. Square sales payouts) on import.

type ExclusionField = 'title' | 'body' | 'supplier' | 'invoiceNumber';
type ExclusionCondition = { field: ExclusionField; value: string };
type LoadedExclusionRule = { id: string; name: string; conditions: ExclusionCondition[] };

// Pull every string out of a JSON blob so a "body contains X" condition can
// match document/email text stored in sourceMetadata.
function flattenJsonText(value: unknown, depth = 0): string {
  if (depth > 6 || value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((item) => flattenJsonText(item, depth + 1)).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((item) => flattenJsonText(item, depth + 1))
      .join(' ');
  }
  return '';
}

// The text an exclusion rule matches against, per field, lower-cased.
function exclusionMatchFields(invoice: NormalisedInvoice): Record<ExclusionField, string> {
  const bodyText = [
    flattenJsonText(invoice.sourceMetadata),
    ...invoice.lines.map((line) => line.description)
  ]
    .join(' ')
    .toLowerCase();
  return {
    // Xero-synced invoices carry no sourceFileName — their visible "title" is
    // the invoiceNumber (e.g. "St Alma Square and Other Fees on 13 June 2026").
    // A rule written against "title" must match that, so fold both in; otherwise
    // title-based rules silently match an empty string and never fire.
    title: `${invoice.sourceFileName ?? ''} ${invoice.invoiceNumber ?? ''}`.trim().toLowerCase(),
    body: bodyText,
    supplier: (invoice.supplierName ?? '').toLowerCase(),
    invoiceNumber: (invoice.invoiceNumber ?? '').toLowerCase()
  };
}

function parseExclusionConditions(raw: unknown): ExclusionCondition[] {
  if (!Array.isArray(raw)) return [];
  const allowed: ExclusionField[] = ['title', 'body', 'supplier', 'invoiceNumber'];
  return raw
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const field = trimText(entry.field) as ExclusionField;
      const value = trimText(entry.value);
      if (!allowed.includes(field) || !value) return null;
      return { field, value };
    })
    .filter((entry): entry is ExclusionCondition => entry !== null);
}

// Returns the first enabled rule that fully matches the invoice, or null.
// ALL conditions in a rule must match (AND); any matching rule excludes.
function findMatchingExclusionRule(
  invoice: NormalisedInvoice,
  rules: LoadedExclusionRule[]
): LoadedExclusionRule | null {
  if (rules.length === 0) return null;
  const fields = exclusionMatchFields(invoice);
  for (const rule of rules) {
    if (rule.conditions.length === 0) continue;
    const matchesAll = rule.conditions.every((condition) =>
      fields[condition.field].includes(condition.value.toLowerCase())
    );
    if (matchesAll) return rule;
  }
  return null;
}

export const invoicesService = {
  /**
   * COGS invoice lines for suite prime-cost reporting (reports read #7).
   * Item-linked lines whose invoice falls in the date range; minimal projection
   * (the report sums lineAmountCents by invoice venue).
   */
  async listCogsLinesForReport(params: { venue?: string | null; from?: string | null; to?: string | null }) {
    const invoiceDate: { gte?: Date; lt?: Date } = {};
    if (params.from) invoiceDate.gte = new Date(params.from);
    if (params.to) invoiceDate.lt = new Date(params.to);
    const hasRange = params.from != null || params.to != null;
    const rows = await prisma.supplierInvoiceLine.findMany({
      where: {
        itemId: { not: null },
        invoice: {
          ...(hasRange ? { invoiceDate } : {}),
          ...(params.venue ? { venue: params.venue } : {})
        }
      },
      select: { lineAmountCents: true, invoice: { select: { venue: true } } }
    });
    return rows.map((r) => ({ venue: r.invoice.venue, lineAmountCents: r.lineAmountCents }));
  },

  async listExclusionRules(): Promise<InvoiceExclusionRule[]> {
    const rows = await prisma.invoiceExclusionRule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      conditions: parseExclusionConditions(row.conditions),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    }));
  },

  async upsertExclusionRule(input: unknown, id?: string): Promise<InvoiceExclusionRule> {
    const data = invoiceExclusionRuleInputSchema.parse(input);
    const payload = {
      name: data.name,
      enabled: data.enabled ?? true,
      conditions: data.conditions as unknown as Prisma.InputJsonValue
    };
    const row = id
      ? await prisma.invoiceExclusionRule.update({ where: { id }, data: payload })
      : await prisma.invoiceExclusionRule.create({ data: payload });
    // Immediately clear any already-waiting invoices the (now saved) rules
    // match — so creating a rule affects the invoices sitting in triage, not
    // just future imports. Don't fail the save if the sweep errors.
    try {
      await this.applyExclusionRulesToExisting();
    } catch (err) {
      console.error('[invoices] retroactive exclusion sweep failed', err);
    }
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      conditions: parseExclusionConditions(row.conditions),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  },

  async deleteExclusionRule(id: string): Promise<{ deleted: boolean }> {
    await prisma.invoiceExclusionRule.delete({ where: { id } });
    return { deleted: true };
  },

  // Retroactively apply enabled exclusion rules to already-imported invoices
  // still awaiting triage. Matches are deleted (lines cascade) — the same
  // outcome the import path produces by never creating them. This is what
  // catches invoices that arrived via the Xero bill sync (which doesn't run
  // the rules at import time) and anything imported before a rule existed.
  async applyExclusionRulesToExisting(): Promise<{ excluded: number; rules: number; sample: string[] }> {
    const rules: LoadedExclusionRule[] = (
      await prisma.invoiceExclusionRule.findMany({ where: { enabled: true } })
    ).map((row) => ({ id: row.id, name: row.name, conditions: parseExclusionConditions(row.conditions) }));
    const usable = rules.filter((rule) => rule.conditions.length > 0);
    if (usable.length === 0) return { excluded: 0, rules: 0, sample: [] };

    const pending = await prisma.supplierInvoice.findMany({
      where: { triageStatus: { in: ['PENDING', 'NEEDS_REVIEW'] } },
      select: {
        id: true,
        supplierName: true,
        invoiceNumber: true,
        sourceFileName: true,
        lines: { select: { description: true } }
      }
    });

    const toExclude: Array<{ id: string; label: string }> = [];
    for (const inv of pending) {
      const fields: Record<ExclusionField, string> = {
        // Mirror exclusionMatchFields: Xero-synced invoices carry no
        // sourceFileName, so their visible "title" is the invoiceNumber —
        // a title rule must match that here too, or the sweep never fires
        // for Xero rows even though the same rule fires at import time.
        title: `${inv.sourceFileName ?? ''} ${inv.invoiceNumber ?? ''}`.trim().toLowerCase(),
        body: inv.lines.map((line) => line.description ?? '').join(' ').toLowerCase(),
        supplier: (inv.supplierName ?? '').toLowerCase(),
        invoiceNumber: (inv.invoiceNumber ?? '').toLowerCase()
      };
      const matched = usable.some((rule) =>
        rule.conditions.every((condition) => fields[condition.field].includes(condition.value.toLowerCase()))
      );
      if (matched) toExclude.push({ id: inv.id, label: inv.invoiceNumber || inv.supplierName });
    }

    if (toExclude.length > 0) {
      await prisma.supplierInvoice.deleteMany({ where: { id: { in: toExclude.map((x) => x.id) } } });
    }
    return { excluded: toExclude.length, rules: usable.length, sample: toExclude.slice(0, 10).map((x) => x.label) };
  },

  async list(options?: { includeNoItem?: boolean; unpaidOnly?: boolean }): Promise<StockInvoicesPayload> {
    const includeNoItem = options?.includeNoItem === true;
    const unpaidOnly = options?.unpaidOnly === true;
    const invoices = await prisma.supplierInvoice.findMany({
      where: {
        // Payments cares about every bill, matched to items or not — the
        // triage split is about the stock catalogue, not money owed.
        ...(includeNoItem || unpaidOnly ? {} : { triageStatus: { not: 'NO_ITEM' } }),
        ...(unpaidOnly ? { paymentStatus: { not: 'PAID' } } : {})
      },
      include: {
        ...invoiceInclude,
        lines: {
          include: { item: { select: lineItemSelect } },
          orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }]
        }
      },
      orderBy: unpaidOnly ? [{ dueDate: 'asc' }, { invoiceDate: 'desc' }] : [{ invoiceDate: 'desc' }, { importedAt: 'desc' }],
      take: unpaidOnly ? 500 : 100
    });
    return { invoices: invoices.map(toInvoicePayload) };
  },

  async summary(): Promise<StockInvoicesSummary> {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalInvoices,
      needsReviewLines,
      matchedLines,
      importedThisWeek,
      pendingTriageInvoices,
      needsReviewTriageInvoices,
      noItemInvoices
    ] = await Promise.all([
      prisma.supplierInvoice.count(),
      prisma.supplierInvoiceLine.count({ where: { matchingStatus: 'NEEDS_REVIEW' } }),
      prisma.supplierInvoiceLine.count({ where: { itemId: { not: null } } }),
      prisma.supplierInvoice.count({ where: { importedAt: { gte: weekAgo } } }),
      prisma.supplierInvoice.count({ where: { triageStatus: 'PENDING' } }),
      prisma.supplierInvoice.count({ where: { triageStatus: 'NEEDS_REVIEW' } }),
      prisma.supplierInvoice.count({ where: { triageStatus: 'NO_ITEM' } })
    ]);

    const needsReviewInvoiceRows = await prisma.supplierInvoice.findMany({
      where: { lines: { some: { matchingStatus: 'NEEDS_REVIEW' } } },
      select: { id: true }
    });

    return {
      totalInvoices,
      needsReviewInvoices: needsReviewInvoiceRows.length,
      needsReviewLines,
      matchedLines,
      importedThisWeek,
      pendingTriageInvoices,
      needsReviewTriageInvoices,
      noItemInvoices
    };
  },

  async listAssignees(): Promise<StockInvoiceAssigneesPayload> {
    const assignees = await prisma.staffProfile.findMany({
      where: {
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        // Admins/owners often have no explicit STOCK appAccess row (they pass
        // via isAdmin), so include them too — otherwise the assignee dropdown
        // comes back empty for the very people who triage invoices.
        OR: [
          { isAdmin: true },
          {
            appAccess: {
              some: {
                appId: 'STOCK',
                status: 'ENABLED',
                role: { in: ['ADMIN', 'MANAGER'] }
              }
            }
          }
        ]
      },
      select: assigneeSelect,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
    });
    return { assignees: assignees.map((row) => toAssigneePayload(row)).filter((row): row is StockInvoiceAssignee => row !== null) };
  },

  async markNoItem(
    id: string,
    triagedByStaffProfileId: string,
    input: unknown
  ): Promise<StockSupplierInvoice> {
    const data = stockInvoiceMarkNoItemInputSchema.parse(input ?? {});
    const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Invoice not found');

    await prisma.supplierInvoice.update({
      where: { id },
      data: {
        triageStatus: 'NO_ITEM',
        triagedAt: new Date(),
        triagedByStaffProfileId,
        assignedToStaffProfileId: null,
        triageNotes: optionalText(data.notes) ?? existing.triageNotes
      }
    });
    return getInvoicePayload(id);
  },

  async markNeedsReview(
    id: string,
    triagedByStaffProfileId: string,
    input: unknown
  ): Promise<StockSupplierInvoice> {
    const data = stockInvoiceMarkNeedsReviewInputSchema.parse(input);
    const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Invoice not found');

    const assignee = await prisma.staffProfile.findUnique({
      where: { id: data.assigneeStaffProfileId },
      select: { id: true, employmentStatus: true, accountType: true }
    });
    if (!assignee || assignee.accountType !== 'HUMAN' || assignee.employmentStatus !== 'ACTIVE') {
      throw new HttpError(400, 'Pick an active manager to review this invoice');
    }

    await prisma.supplierInvoice.update({
      where: { id },
      data: {
        triageStatus: 'NEEDS_REVIEW',
        triagedAt: new Date(),
        triagedByStaffProfileId,
        assignedToStaffProfileId: assignee.id,
        triageNotes: optionalText(data.notes) ?? existing.triageNotes
      }
    });
    return getInvoicePayload(id);
  },

  async resetTriage(id: string): Promise<StockSupplierInvoice> {
    const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Invoice not found');

    await prisma.supplierInvoice.update({
      where: { id },
      data: {
        triageStatus: 'PENDING',
        triagedAt: null,
        triagedByStaffProfileId: null,
        assignedToStaffProfileId: null
      }
    });
    return getInvoicePayload(id);
  },

  async deleteInvoice(id: string, input: unknown): Promise<{ id: string }> {
    stockInvoiceDeleteInputSchema.parse(input);
    const existing = await prisma.supplierInvoice.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Invoice not found');
    if (existing.triageStatus !== 'NO_ITEM') {
      throw new HttpError(
        400,
        'Mark this invoice as "no item" before deleting it'
      );
    }
    const matchedLine = await prisma.supplierInvoiceLine.findFirst({
      where: { supplierInvoiceId: id, costAppliedAt: { not: null } },
      select: { id: true }
    });
    if (matchedLine) {
      throw new HttpError(
        400,
        'Cannot delete: a line on this invoice has already applied its cost to a stock item'
      );
    }
    await prisma.supplierInvoice.delete({ where: { id } });
    return { id };
  },

  ripInvoiceText(input: unknown): StockInvoiceRipResult {
    const data = stockInvoiceRipInputSchema.parse(input);
    const lines = data.text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const supplierName =
      extractTextLineValue(lines, [/^(?:supplier|from)\s*[:#-]\s*(.+)$/i]) ??
      lines[0] ??
      'Unknown supplier';
    const invoiceNumber = extractTextLineValue(lines, [
      /\binvoice\s*(?:number|no|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]+)/i
    ]);
    const invoiceDate = extractTextLineValue(lines, [
      /\bdate\s*[:#-]?\s*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{2,4})/i
    ]);
    const total = extractTextLineValue(lines, [
      /\btotal\s*(?:amount|due)?\s*[:#-]?\s*\$?\s*([0-9,]+(?:\.[0-9]{2})?)/i
    ]);
    const parsedLines = lines.flatMap((line) => {
      const match = /^(.+?)\s+(\d+(?:\.\d+)?)\s+(?:x\s*)?\$?([0-9,]+(?:\.[0-9]{2})?)\s+\$?([0-9,]+(?:\.[0-9]{2})?)$/i.exec(line);
      if (!match?.[1] || !match[2] || !match[3] || !match[4]) return [];
      return [
        {
          Description: match[1].trim(),
          Quantity: Number(match[2]),
          UnitAmount: Number(match[3].replace(/,/g, '')),
          LineAmount: Number(match[4].replace(/,/g, ''))
        }
      ];
    });
    const warnings: string[] = [];
    if (!invoiceNumber) warnings.push('Could not find an invoice number.');
    if (parsedLines.length === 0) warnings.push('No item lines were confidently parsed.');

    return {
      warnings,
      invoices: [
        {
          Contact: { Name: supplierName },
          InvoiceNumber: invoiceNumber ?? buildHash([supplierName, total, data.sourceFileName]),
          Date: invoiceDate ?? undefined,
          Total: total ? Number(total.replace(/,/g, '')) : undefined,
          LineItems: parsedLines,
          sourceMetadata: {
            rippedFromText: true,
            originalLineCount: lines.length
          }
        }
      ]
    };
  },

  // Read a scanned/photographed invoice (PDF or image) with Claude vision and
  // return the same shape as ripInvoiceText, so the existing import → match flow
  // handles it unchanged. Gated on ANTHROPIC_API_KEY — no key, clear error.
  async ocrInvoiceImage(input: unknown): Promise<StockInvoiceRipResult> {
    const data = stockInvoiceOcrInputSchema.parse(input);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new HttpError(
        503,
        'Invoice OCR is not configured. Set ANTHROPIC_API_KEY on the stock-api to enable it.'
      );
    }

    const client = new Anthropic({ apiKey });
    const source =
      data.mimeType === 'application/pdf'
        ? ({ type: 'base64', media_type: 'application/pdf', data: data.fileBase64 } as const)
        : ({ type: 'base64', media_type: data.mimeType, data: data.fileBase64 } as const);
    const fileBlock =
      data.mimeType === 'application/pdf'
        ? ({ type: 'document', source } as const)
        : ({ type: 'image', source } as const);

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        supplierName: { type: 'string' },
        invoiceNumber: { type: 'string' },
        invoiceDate: { type: 'string' },
        total: { type: 'number' },
        lineItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitAmount: { type: 'number' },
              lineAmount: { type: 'number' }
            },
            required: ['description', 'quantity', 'unitAmount', 'lineAmount']
          }
        }
      },
      required: ['supplierName', 'invoiceNumber', 'invoiceDate', 'total', 'lineItems']
    };

    let message;
    try {
      message = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 8000,
        // Constrain the response to our invoice schema so parsing can't drift.
        output_config: { format: { type: 'json_schema', schema } },
        messages: [
          {
            role: 'user',
            content: [
              fileBlock,
              {
                type: 'text',
                text:
                  'Extract this supplier invoice. Return the supplier name, invoice number, ' +
                  'invoice date (ISO YYYY-MM-DD if you can), the invoice total, and every line ' +
                  'item with its description, quantity, unit price (ex-GST unit amount), and line ' +
                  'total. Use the printed unit price for unitAmount and the printed line total for ' +
                  'lineAmount. If a value is genuinely absent, use 0. Do not invent lines.'
              }
            ]
          }
        ]
        // output_config is a valid Messages API field; SDK typings lag it.
      } as unknown as Anthropic.MessageCreateParamsNonStreaming);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      throw new HttpError(502, `Invoice OCR failed: ${detail}`);
    }

    const textBlock = message.content.find((block) => block.type === 'text');
    const raw = textBlock && 'text' in textBlock ? textBlock.text : '';
    let parsed: {
      supplierName?: string;
      invoiceNumber?: string;
      invoiceDate?: string;
      total?: number;
      lineItems?: Array<{ description?: string; quantity?: number; unitAmount?: number; lineAmount?: number }>;
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(502, 'Invoice OCR returned an unreadable result. Try a clearer scan.');
    }

    const warnings: string[] = [];
    const supplierName = optionalText(parsed.supplierName) ?? 'Unknown supplier';
    const invoiceNumber = optionalText(parsed.invoiceNumber);
    const lineItems = (parsed.lineItems ?? [])
      .map((line) => ({
        Description: optionalText(line.description) ?? '',
        Quantity: Number(line.quantity ?? 0) || 0,
        UnitAmount: Number(line.unitAmount ?? 0) || 0,
        LineAmount: Number(line.lineAmount ?? 0) || 0
      }))
      .filter((line) => line.Description.length > 0);
    if (!invoiceNumber) warnings.push('Could not read an invoice number — check before importing.');
    if (lineItems.length === 0) warnings.push('No line items were read — the scan may be too low quality.');

    return {
      warnings,
      invoices: [
        {
          Contact: { Name: supplierName },
          InvoiceNumber: invoiceNumber ?? buildHash([supplierName, String(parsed.total ?? ''), data.sourceFileName]),
          Date: optionalText(parsed.invoiceDate) ?? undefined,
          Total: typeof parsed.total === 'number' ? parsed.total : undefined,
          LineItems: lineItems,
          sourceMetadata: {
            ocrScanned: true,
            sourceFileName: data.sourceFileName ?? null
          }
        }
      ]
    };
  },

  // Stream the original uploaded scan back so the invoice screen can open it.
  async getDocument(invoiceId: string): Promise<{ fileName: string | null; mimeType: string; data: Buffer }> {
    const doc = await prisma.supplierInvoiceDocument.findUnique({ where: { invoiceId } });
    if (!doc) throw new HttpError(404, 'No original document is stored for this invoice.');
    return { fileName: doc.fileName, mimeType: doc.mimeType, data: Buffer.from(doc.data) };
  },

  async importInvoices(input: unknown): Promise<StockInvoiceImportResult> {
    const data = stockInvoiceImportInputSchema.parse(normaliseImportBody(input));
    const source = data.source.trim().toUpperCase();
    const sourceFileName = optionalText(data.sourceFileName) ?? 'Manual invoice import';
    const sourceFileType = optionalText(data.sourceFileType);
    const venue = optionalText(data.venue);
    // Original uploaded scan, kept against the created invoice so a manager can
    // reopen it and enter lines by hand when OCR only read a total.
    const documentBuffer = data.documentBase64 ? Buffer.from(data.documentBase64, 'base64') : null;
    const documentMimeType = optionalText(data.documentMimeType);
    const documentFileName = optionalText(data.documentFileName);
    const defaults = {
      source,
      venue,
      sourceFileName,
      sourceFileType,
      sourceMetadata: data.sourceMetadata ?? {}
    };
    const normalisedInvoices = data.invoices.map((invoice, index) =>
      normaliseInvoice(invoice, index, defaults)
    );
    const matchItems = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      select: matchItemSelect,
      orderBy: { name: 'asc' }
    });
    // Load enabled exclusion rules once; non-supplier documents that match
    // are skipped before any supplier/invoice rows are written.
    const exclusionRules: LoadedExclusionRule[] = (
      await prisma.invoiceExclusionRule.findMany({ where: { enabled: true } })
    ).map((row) => ({ id: row.id, name: row.name, conditions: parseExclusionConditions(row.conditions) }));
    const warnings: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let lineCount = 0;
    let matchedLineCount = 0;
    let needsReviewLineCount = 0;
    let skippedCount = 0;
    const skipped: Array<{ invoice: string; rule: string }> = [];
    const importedInvoiceIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const invoiceInput of normalisedInvoices) {
        const matchedRule = findMatchingExclusionRule(invoiceInput, exclusionRules);
        if (matchedRule) {
          skippedCount += 1;
          skipped.push({
            invoice:
              invoiceInput.invoiceNumber ?? invoiceInput.sourceFileName ?? invoiceInput.supplierName,
            rule: matchedRule.name
          });
          continue;
        }
        const supplierId = await ensureSupplier(
          tx,
          invoiceInput.supplierName,
          invoiceInput.supplierEmail
        );
        const existing = await tx.supplierInvoice.findUnique({
          where: {
            source_invoiceKey: {
              source: invoiceInput.source,
              invoiceKey: invoiceInput.invoiceKey
            }
          }
        });
        const invoiceData = {
          externalInvoiceId: invoiceInput.externalInvoiceId,
          invoiceNumber: invoiceInput.invoiceNumber,
          supplierId,
          supplierName: invoiceInput.supplierName,
          supplierEmail: invoiceInput.supplierEmail,
          venue: invoiceInput.venue,
          invoiceDate: invoiceInput.invoiceDate,
          dueDate: invoiceInput.dueDate,
          currencyCode: invoiceInput.currencyCode,
          status: invoiceInput.status,
          subtotalCents: invoiceInput.subtotalCents,
          taxCents: invoiceInput.taxCents,
          totalCents: invoiceInput.totalCents,
          sourceFileName: invoiceInput.sourceFileName,
          sourceFileType: invoiceInput.sourceFileType,
          sourceMetadata: toJson(invoiceInput.sourceMetadata),
          importedAt: new Date()
        };
        const invoice = existing
          ? await tx.supplierInvoice.update({
              where: { id: existing.id },
              data: invoiceData
            })
          : await tx.supplierInvoice.create({
              data: {
                source: invoiceInput.source,
                invoiceKey: invoiceInput.invoiceKey,
                ...invoiceData
              }
            });

        if (existing) updatedCount += 1;
        else createdCount += 1;
        importedInvoiceIds.push(invoice.id);

        if (documentBuffer && documentMimeType) {
          await tx.supplierInvoiceDocument.upsert({
            where: { invoiceId: invoice.id },
            create: {
              invoiceId: invoice.id,
              fileName: documentFileName,
              mimeType: documentMimeType,
              data: documentBuffer
            },
            update: { fileName: documentFileName, mimeType: documentMimeType, data: documentBuffer }
          });
        }

        // Matches somebody already confirmed for this supplier's wording, so an
        // import never re-asks a question that has been answered.
        const aliasRows = await tx.stockItemAlias.findMany({
          where: { OR: [{ supplierId: null }, ...(invoice.supplierId ? [{ supplierId: invoice.supplierId }] : [])] },
          select: { aliasKey: true, supplierId: true, stockItemId: true }
        });
        const importAliases = new Map<string, string>();
        for (const row of aliasRows) {
          // A supplier-specific alias wins over a global one: the same words
          // can mean different products in two catalogues.
          if (row.supplierId === null && importAliases.has(row.aliasKey)) continue;
          importAliases.set(row.aliasKey, row.stockItemId);
        }

        const lineKeys = invoiceInput.lines.map((line) => line.lineKey);
        await tx.supplierInvoiceLine.deleteMany({
          where: {
            supplierInvoiceId: invoice.id,
            ...(lineKeys.length > 0 ? { lineKey: { notIn: lineKeys } } : {})
          }
        });

        for (const line of invoiceInput.lines) {
          const existingLine = await tx.supplierInvoiceLine.findUnique({
            where: {
              supplierInvoiceId_lineKey: {
                supplierInvoiceId: invoice.id,
                lineKey: line.lineKey
              }
            }
          });
          const autoMatch = findItemMatch(line, matchItems, {
            supplierName: invoiceInput.supplierName,
            aliases: importAliases
          });
          const preserveManualMatch =
            existingLine?.matchingStatus === 'MANUAL_MATCHED' && existingLine.itemId;
          const itemId = preserveManualMatch ? existingLine.itemId : autoMatch.itemId;
          const status = preserveManualMatch ? 'MANUAL_MATCHED' : autoMatch.status;

          await tx.supplierInvoiceLine.upsert({
            where: {
              supplierInvoiceId_lineKey: {
                supplierInvoiceId: invoice.id,
                lineKey: line.lineKey
              }
            },
            create: {
              supplierInvoiceId: invoice.id,
              lineNumber: line.lineNumber,
              lineKey: line.lineKey,
              externalLineId: line.externalLineId,
              description: line.description,
              itemCode: line.itemCode,
              accountCode: line.accountCode,
              quantity: line.quantity,
              unit: line.unit,
              unitAmountCents: line.unitAmountCents,
              lineAmountCents: line.lineAmountCents,
              taxAmountCents: line.taxAmountCents,
              itemId,
              matchingStatus: status,
              sourceMetadata: toJson(line.sourceMetadata)
            },
            update: {
              lineNumber: line.lineNumber,
              externalLineId: line.externalLineId,
              description: line.description,
              itemCode: line.itemCode,
              accountCode: line.accountCode,
              quantity: line.quantity,
              unit: line.unit,
              unitAmountCents: line.unitAmountCents,
              lineAmountCents: line.lineAmountCents,
              taxAmountCents: line.taxAmountCents,
              itemId,
              matchingStatus: status,
              sourceMetadata: toJson(line.sourceMetadata)
            }
          });

          lineCount += 1;
          if (itemId) matchedLineCount += 1;
          if (status === 'NEEDS_REVIEW') {
            needsReviewLineCount += 1;
            warnings.push(`Needs review: ${line.description}`);
          }
        }
      }
    });

    const invoices = await prisma.supplierInvoice.findMany({
      where: { id: { in: importedInvoiceIds } },
      include: {
        ...invoiceInclude,
        lines: {
          include: { item: { select: lineItemSelect } },
          orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }]
        }
      },
      orderBy: [{ invoiceDate: 'desc' }, { importedAt: 'desc' }]
    });

    if (skippedCount > 0) {
      warnings.unshift(
        `${skippedCount} document${skippedCount === 1 ? '' : 's'} skipped by exclusion rule${
          skippedCount === 1 ? '' : 's'
        }.`
      );
    }

    return {
      importedCount: normalisedInvoices.length - skippedCount,
      createdCount,
      updatedCount,
      lineCount,
      matchedLineCount,
      needsReviewLineCount,
      skippedCount,
      skipped,
      warnings,
      invoices: invoices.map(toInvoicePayload)
    };
  },

  async rematchLine(lineId: string, input: unknown): Promise<StockSupplierInvoiceLine> {
    const data = stockInvoiceLineRematchInputSchema.parse(input);
    const itemId = optionalText(data.itemId);
    const existing = await prisma.supplierInvoiceLine.findUnique({ where: { id: lineId } });
    if (!existing) throw new HttpError(404, 'Invoice line not found');

    if (itemId) {
      const item = await prisma.stockItem.findUnique({ where: { id: itemId } });
      if (!item) throw new HttpError(400, 'Stock item not found');
    }

    const line = await prisma.supplierInvoiceLine.update({
      where: { id: lineId },
      data: {
        itemId,
        matchingStatus: itemId ? 'MANUAL_MATCHED' : 'NEEDS_REVIEW',
        notes: optionalText(data.notes) ?? existing.notes
      },
      include: { item: { select: lineItemSelect } }
    });

    // Remember the answer. The same supplier wording recurs verbatim month
    // after month, and without this every occurrence asks again — which is why
    // the review queue never shrank however much of it got cleared.
    if (itemId) {
      const invoice = await prisma.supplierInvoice.findUnique({
        where: { id: existing.supplierInvoiceId },
        select: { supplierId: true }
      });
      const key = aliasKey(existing.description);
      if (key) {
        // Not an upsert: the unique key includes a nullable supplierId, and a
        // NULL cannot be targeted by a compound unique lookup.
        const supplierId = invoice?.supplierId ?? null;
        const current = await prisma.stockItemAlias.findFirst({ where: { aliasKey: key, supplierId } });
        if (current) {
          await prisma.stockItemAlias.update({
            where: { id: current.id },
            data: { stockItemId: itemId, sourceText: existing.description }
          });
        } else {
          await prisma.stockItemAlias.create({
            data: { aliasKey: key, supplierId, stockItemId: itemId, sourceText: existing.description }
          });
        }
        // ...and apply it to the lines already waiting. The alias only used to
        // help the *next* import, so identifying "BEEF SHORT RIBS GRAINFED
        // 3 RIB" cleared one line and left the other ten sitting in the queue
        // wearing the same words. One decision should settle all of them.
        await applyAliasToWaitingLines(key, itemId, supplierId, lineId);
      }
    }

    return toLinePayload(line);
  },

  /**
   * Load remembered matches for a supplier. A supplier-specific alias wins over
   * a global one for the same wording — the same words can mean different
   * products in two catalogues.
   */
  async loadAliases(supplierId: string | null): Promise<Map<string, string>> {
    const rows = await prisma.stockItemAlias.findMany({
      where: { OR: [{ supplierId: null }, ...(supplierId ? [{ supplierId }] : [])] },
      select: { aliasKey: true, supplierId: true, stockItemId: true }
    });
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.supplierId === null && map.has(row.aliasKey)) continue;
      map.set(row.aliasKey, row.stockItemId);
    }
    return map;
  },

  /**
   * Re-run matching over lines that never found an item.
   *
   * Needed because matching improves — a better matcher, a new alias, or a
   * stock item that did not exist when the invoice arrived. Without this the
   * backlog stays exactly as wrong as the day it was imported.
   *
   * Only ever touches NEEDS_REVIEW lines: a match a human made is never
   * second-guessed by a machine.
   */
  async rematchUnresolved(options: { invoiceId?: string | null; dryRun?: boolean } = {}) {
    const lines = await prisma.supplierInvoiceLine.findMany({
      where: {
        matchingStatus: 'NEEDS_REVIEW',
        ...(options.invoiceId ? { supplierInvoiceId: options.invoiceId } : {})
      },
      select: {
        id: true, description: true, itemCode: true,
        invoice: { select: { supplierId: true, supplierName: true } }
      }
    });
    const items = await prisma.stockItem.findMany({ where: { status: 'ACTIVE' }, select: matchItemSelect });
    const candidates = items.map((item) => ({ id: item.id, name: item.name, sku: item.sku }));

    const aliasCache = new Map<string, Map<string, string>>();
    let matched = 0;
    let nonStock = 0;
    const updates: Array<{ id: string; itemId: string | null; status: StockInvoiceMatchingStatus }> = [];

    for (const line of lines) {
      const supplierId = line.invoice?.supplierId ?? null;
      const cacheKey = supplierId ?? '__global__';
      if (!aliasCache.has(cacheKey)) aliasCache.set(cacheKey, await this.loadAliases(supplierId));
      const result = matchInvoiceLine(
        { description: line.description, itemCode: line.itemCode },
        candidates,
        { supplierName: line.invoice?.supplierName ?? null, aliases: aliasCache.get(cacheKey) }
      );
      if (result.status === 'NON_STOCK') {
        nonStock += 1;
        updates.push({ id: line.id, itemId: null, status: 'NON_STOCK' });
      } else if (result.itemId) {
        matched += 1;
        updates.push({ id: line.id, itemId: result.itemId, status: 'AUTO_MATCHED' });
      }
    }

    if (!options.dryRun) {
      for (const update of updates) {
        await prisma.supplierInvoiceLine.update({
          where: { id: update.id },
          data: { itemId: update.itemId, matchingStatus: update.status }
        });
      }
    }

    return {
      examined: lines.length,
      matched,
      nonStock,
      stillNeedsReview: lines.length - matched - nonStock,
      dryRun: Boolean(options.dryRun)
    };
  },

  /** Ranked candidates for a line a human has to decide. */
  async suggestionsForLine(lineId: string) {
    const line = await prisma.supplierInvoiceLine.findUnique({
      where: { id: lineId },
      select: { description: true }
    });
    if (!line) throw new HttpError(404, 'Invoice line not found');
    const items = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, sku: true, unit: true }
    });
    return suggestItems(line.description, items, 6).map((row) => ({
      itemId: row.item.id,
      name: row.item.name,
      confidence: row.confidence
    }));
  },

  async applyLineCost(lineId: string): Promise<StockSupplierInvoiceLine> {
    const existing = await prisma.supplierInvoiceLine.findUnique({
      where: { id: lineId },
      include: { item: { select: lineItemSelect }, invoice: { select: { supplierId: true } } }
    });
    if (!existing) throw new HttpError(404, 'Invoice line not found');
    if (!existing.itemId) throw new HttpError(400, 'Match this line to a stock item first');
    if (!existing.item) throw new HttpError(400, 'Matched stock item could not be found');
    const matchedItemId = existing.itemId;
    const matchedItem = existing.item;
    if (existing.unitAmountCents <= 0) {
      throw new HttpError(400, 'This line does not have a unit cost to apply');
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.stockItem.update({
        where: { id: matchedItemId },
        data: {
          latestCostCents: existing.unitAmountCents,
          latestCostAt: new Date(),
          avgCostCents: weightedAverageCostCents({
            onHand: matchedItem.onHand,
            currentAvgCents: matchedItem.avgCostCents,
            receivedCountUnits: existing.quantity * Math.max(matchedItem.conversionFactor || 1, 1),
            newUnitCostCents: unitCostFromPurchaseCost(existing.unitAmountCents, matchedItem)
          })
        }
      });
      await syncPriceListFromLine(tx, existing.invoice?.supplierId, existing, matchedItem.name);
      return tx.supplierInvoiceLine.update({
        where: { id: lineId },
        data: { costAppliedAt: new Date() },
        include: { item: { select: lineItemSelect } }
      });
    });

    // Keep recipe costs (and theoretical COGS) current now this item's cost moved.
    await recomputeRecipeCostsForItems([matchedItemId]).catch(() => undefined);

    return toLinePayload(updated);
  },

  // Apply cost for every eligible matched line on one invoice in a single
  // transaction — same per-line writes as applyLineCost, just batched. Lines
  // that aren't matched / have no unit cost are skipped and reported; lines
  // already applied are skipped silently (idempotent).
  async applyInvoiceCosts(invoiceId: string): Promise<StockInvoiceApplyAllCostsResult> {
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { include: { item: { select: lineItemSelect } } } }
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');

    const skipped: StockInvoiceApplyAllCostsResult['skipped'] = [];
    const eligible = invoice.lines.filter((line) => {
      if (line.costAppliedAt) return false;
      if (!line.itemId || !line.item) {
        skipped.push({ lineId: line.id, description: line.description, reason: 'Not matched to a stock item' });
        return false;
      }
      if (line.unitAmountCents <= 0) {
        skipped.push({ lineId: line.id, description: line.description, reason: 'No unit cost on this line' });
        return false;
      }
      return true;
    });

    if (eligible.length > 0) {
      await prisma.$transaction(async (tx) => {
        for (const line of eligible) {
          await tx.stockItem.update({
            where: { id: line.itemId! },
            data: {
              latestCostCents: line.unitAmountCents,
              latestCostAt: new Date(),
              avgCostCents: weightedAverageCostCents({
                onHand: line.item!.onHand,
                currentAvgCents: line.item!.avgCostCents,
                receivedCountUnits: line.quantity * Math.max(line.item!.conversionFactor || 1, 1),
                newUnitCostCents: unitCostFromPurchaseCost(line.unitAmountCents, line.item!)
              })
            }
          });
          await syncPriceListFromLine(tx, invoice.supplierId, line, line.item!.name);
          await tx.supplierInvoiceLine.update({ where: { id: line.id }, data: { costAppliedAt: new Date() } });
        }
      });
      // Recompute recipe costs for every item whose cost just changed.
      await recomputeRecipeCostsForItems(eligible.map((line) => line.itemId!)).catch(() => undefined);
    }

    return {
      appliedCount: eligible.length,
      skippedCount: skipped.length,
      skipped,
      invoice: await getInvoicePayload(invoiceId)
    };
  },

  // ── Payments: matching bills to money actually going out ─────────────────

  /**
   * Record a payment against an invoice. Amount defaults to whatever is still
   * owing, so the everyday case — paid in full — is one tap; a smaller amount
   * records a part-payment and the invoice shows PARTIALLY_PAID until the
   * rest lands. Reversible with markUnpaid, so no typed confirmation.
   */
  async recordPayment(invoiceId: string, input: unknown): Promise<StockSupplierInvoice> {
    const data = stockInvoicePaymentInputSchema.parse(input ?? {});
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, totalCents: true, amountPaidCents: true, paymentReference: true, paymentNotes: true }
    });
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    const owing = Math.max(0, invoice.totalCents - invoice.amountPaidCents);
    const amount = data.amountCents ?? owing;
    if (amount <= 0) throw new HttpError(400, 'This invoice is already fully paid.');
    const paidAt = data.paidAt?.trim() ? new Date(data.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) throw new HttpError(400, 'Invalid payment date');
    const amountPaidCents = invoice.amountPaidCents + amount;
    await prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: {
        amountPaidCents,
        paidAt,
        paymentStatus: amountPaidCents >= invoice.totalCents ? 'PAID' : 'PARTIALLY_PAID',
        ...(data.reference?.trim() ? { paymentReference: data.reference.trim() } : {}),
        ...(data.notes?.trim() ? { paymentNotes: data.notes.trim() } : {})
      }
    });
    return getInvoicePayload(invoiceId);
  },

  async markUnpaid(invoiceId: string): Promise<StockSupplierInvoice> {
    const invoice = await prisma.supplierInvoice.findUnique({ where: { id: invoiceId }, select: { id: true } });
    if (!invoice) throw new HttpError(404, 'Invoice not found');
    await prisma.supplierInvoice.update({
      where: { id: invoiceId },
      data: { paymentStatus: 'UNPAID', amountPaidCents: 0, paidAt: null, paymentReference: null, paymentNotes: null }
    });
    return getInvoicePayload(invoiceId);
  },

  /**
   * What's owed to whom right now. NO_ITEM invoices are included on purpose:
   * a bill with nothing for the stock catalogue on it is still a bill that
   * needs paying — the triage split is about item matching, not money.
   */
  async paymentsSummary(): Promise<StockPaymentsSummary> {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [unpaid, paidRecently] = await Promise.all([
      prisma.supplierInvoice.findMany({
        where: { paymentStatus: { not: 'PAID' } },
        select: {
          supplierId: true,
          supplierName: true,
          totalCents: true,
          amountPaidCents: true,
          dueDate: true
        }
      }),
      prisma.supplierInvoice.aggregate({
        where: { paymentStatus: 'PAID', paidAt: { gte: monthAgo } },
        _sum: { amountPaidCents: true }
      })
    ]);

    let unpaidTotalCents = 0;
    let overdueCount = 0;
    let overdueTotalCents = 0;
    const bySupplier = new Map<string, StockPaymentsSummary['suppliers'][number]>();
    for (const row of unpaid) {
      const owing = Math.max(0, row.totalCents - row.amountPaidCents);
      if (owing <= 0) continue;
      unpaidTotalCents += owing;
      const overdue = Boolean(row.dueDate && row.dueDate.getTime() < now.getTime());
      if (overdue) {
        overdueCount += 1;
        overdueTotalCents += owing;
      }
      const key = row.supplierId ?? `name:${row.supplierName.trim().toLowerCase()}`;
      const entry = bySupplier.get(key) ?? {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        unpaidCount: 0,
        unpaidTotalCents: 0,
        oldestDueDate: null as string | null
      };
      entry.unpaidCount += 1;
      entry.unpaidTotalCents += owing;
      if (row.dueDate && (!entry.oldestDueDate || row.dueDate.toISOString() < entry.oldestDueDate)) {
        entry.oldestDueDate = row.dueDate.toISOString();
      }
      bySupplier.set(key, entry);
    }

    return {
      unpaidCount: unpaid.filter((row) => row.totalCents - row.amountPaidCents > 0).length,
      unpaidTotalCents,
      overdueCount,
      overdueTotalCents,
      paidLast30DaysCents: paidRecently._sum.amountPaidCents ?? 0,
      suppliers: [...bySupplier.values()].sort((a, b) => b.unpaidTotalCents - a.unpaidTotalCents),
      generatedAt: now.toISOString()
    };
  },

  /**
   * Rebuild an invoice's lines from text pasted off the original document.
   *
   * Some bills arrive as one summary line — a Xero sync that carried a single
   * "Alcoholic Beverages $1,035.25" row, or a scan OCR only read the total
   * from. Everything on that invoice then sits uncosted, and there was no way
   * to get the detail in short of retyping it as a new invoice.
   *
   * A manager selects the table on the PDF, pastes it here, and the existing
   * lines are replaced with the real ones — matched to stock items by the same
   * matcher the importer uses, so aliases and manual matches behave identically.
   *
   * Two things this deliberately does NOT do. It never edits the invoice
   * header: the supplier's own total is the thing worth reconciling against,
   * so overwriting it would destroy the only independent check there is. And
   * it refuses to write when the lines do not add up to that total, unless the
   * caller says otherwise — a variance nearly always means a row was left out
   * of the selection.
   */
  async pasteLines(invoiceId: string, input: unknown) {
    const data = stockInvoicePasteLinesInputSchema.parse(input);
    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        supplierName: true,
        supplierId: true,
        subtotalCents: true,
        taxCents: true,
        totalCents: true
      }
    });
    if (!invoice) throw new HttpError(404, 'That invoice no longer exists.');

    const parsed = parseInvoicePaste(data.text);
    const reconciliation = reconcilePaste(parsed, invoice);

    const preview = {
      dryRun: data.dryRun === true,
      applied: false,
      lines: parsed.lines,
      columnsApplied: parsed.columnsApplied,
      warnings: parsed.warnings,
      unparsed: parsed.unparsed,
      parsedSubtotalCents: parsed.subtotalCents,
      parsedTaxCents: parsed.taxCents,
      parsedTotalCents: parsed.totalCents,
      invoiceTotalCents: invoice.totalCents,
      ...reconciliation,
      matchedCount: 0,
      needsReviewCount: 0,
      replacedLineCount: 0
    };

    if (data.dryRun) {
      // Match on the preview too, so the screen can show what will and won't
      // find a stock item before anything is written.
      const matchItems = await prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: matchItemSelect,
        orderBy: { name: 'asc' }
      });
      const aliases = await invoicesService.loadAliases(invoice.supplierId);
      let matched = 0;
      for (const line of parsed.lines) {
        const match = findItemMatch(
          { description: line.description, itemCode: line.itemCode } as NormalisedLine,
          matchItems,
          { supplierName: invoice.supplierName, aliases }
        );
        if (match.itemId) matched += 1;
      }
      return { ...preview, matchedCount: matched, needsReviewCount: parsed.lines.length - matched };
    }

    if (parsed.lines.length === 0) {
      throw new HttpError(400, 'No item lines could be read from that text.');
    }

    if (!reconciliation.matches && data.acceptVariance !== true) {
      const variance = reconciliation.totalVarianceCents / 100;
      throw new HttpError(
        400,
        `Those lines come to $${(parsed.totalCents / 100).toFixed(2)} but the invoice total is $${(
          invoice.totalCents / 100
        ).toFixed(2)} — ${variance > 0 ? '$' + variance.toFixed(2) + ' over' : '$' + Math.abs(variance).toFixed(2) + ' short'}. Check for a row missed off the copy, or confirm to save anyway.`
      );
    }

    const matchItems = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      select: matchItemSelect,
      orderBy: { name: 'asc' }
    });
    const aliases = await invoicesService.loadAliases(invoice.supplierId);

    let matchedCount = 0;
    let needsReviewCount = 0;
    let replacedLineCount = 0;

    await prisma.$transaction(async (tx) => {
      // Replace wholesale. A pasted table is the whole invoice, so keeping old
      // lines alongside it would double the cost of everything on the bill.
      const removed = await tx.supplierInvoiceLine.deleteMany({ where: { supplierInvoiceId: invoiceId } });
      replacedLineCount = removed.count;

      for (const line of parsed.lines) {
        const normalised: NormalisedLine = {
          lineNumber: line.lineNumber,
          // Stable per invoice and per line, so pasting twice updates in place
          // rather than stacking duplicates.
          lineKey: buildHash(['paste', line.lineNumber, line.itemCode, line.description, line.lineAmountCents]),
          externalLineId: null,
          description: line.description,
          itemCode: line.itemCode,
          accountCode: null,
          quantity: line.quantity,
          unit: line.pack,
          unitAmountCents: line.unitAmountCents,
          lineAmountCents: line.lineAmountCents,
          taxAmountCents: line.taxAmountCents,
          sourceMetadata: {
            pastedFromDocument: true,
            printedQuantity: line.printedQuantity,
            pack: line.pack,
            parseWarnings: line.warnings
          }
        };
        const match = findItemMatch(normalised, matchItems, {
          supplierName: invoice.supplierName,
          aliases
        });
        if (match.itemId) matchedCount += 1;
        else needsReviewCount += 1;

        await tx.supplierInvoiceLine.create({
          data: {
            supplierInvoiceId: invoiceId,
            lineNumber: normalised.lineNumber,
            lineKey: normalised.lineKey,
            description: normalised.description,
            itemCode: normalised.itemCode,
            quantity: normalised.quantity,
            unit: normalised.unit,
            unitAmountCents: normalised.unitAmountCents,
            lineAmountCents: normalised.lineAmountCents,
            taxAmountCents: normalised.taxAmountCents,
            itemId: match.itemId,
            matchingStatus: match.status,
            notes: line.warnings.length > 0 ? line.warnings.join(' ') : null,
            sourceMetadata: toJson(normalised.sourceMetadata)
          }
        });
      }

      // The invoice was a single unreviewed line; now it has real ones waiting
      // to be matched, so put it back in the triage queue rather than leaving
      // it looking done.
      await tx.supplierInvoice.update({
        where: { id: invoiceId },
        data: { triageStatus: needsReviewCount > 0 ? 'PENDING' : 'REVIEWED' }
      });
    });

    return {
      ...preview,
      applied: true,
      matchedCount,
      needsReviewCount,
      replacedLineCount,
      invoice: await getInvoicePayload(invoiceId)
    };
  },

  /**
   * Where the unattributed spend actually is.
   *
   * 471 lines sit unmatched in production, but they are only 138 distinct
   * descriptions and $45,593 of spend — and 88% of that money is in the top
   * twenty wordings. Reviewed one line at a time that is 471 decisions; grouped
   * by what the supplier calls it, it is an afternoon.
   *
   * Two different problems live in this list and they need opposite actions,
   * so they are separated rather than piled together:
   *
   *  - A *summary line* — "Alcoholic Beverages", "Xero bill line", a bare
   *    supplier name — is not a product and will never match an item. It needs
   *    the invoice's real lines pasted in. That is the single biggest chunk:
   *    $15,290 of Paramount alone.
   *  - A *real product* the venue buys — beef short ribs, snapper fillets —
   *    that simply is not in the catalogue yet.
   */
  async unmatchedSpend(): Promise<StockUnmatchedSpendPayload> {
    const lines = await prisma.supplierInvoiceLine.findMany({
      where: { itemId: null, matchingStatus: 'NEEDS_REVIEW' },
      select: {
        id: true,
        description: true,
        lineAmountCents: true,
        invoice: { select: { id: true, supplierName: true, invoiceDate: true, lines: { select: { id: true } } } }
      }
    });

    const groups = new Map<string, {
      description: string;
      lineCount: number;
      totalCents: number;
      suppliers: Set<string>;
      lastSeen: Date | null;
      invoiceIds: Set<string>;
      summaryLineInvoices: number;
    }>();

    for (const line of lines) {
      // The supplier's order commentary — ". Ordered: 1 unit, Supplied Qty: 1
      // unit" — is appended to otherwise identical descriptions, so the same
      // product appears twice in the queue. Group on the wording without it.
      const clean = line.description.replace(/\.\s*Ordered:.*$/i, '').trim() || line.description;
      const key = clean.toLowerCase();
      const group = groups.get(key) ?? {
        description: clean,
        lineCount: 0,
        totalCents: 0,
        suppliers: new Set<string>(),
        lastSeen: null as Date | null,
        invoiceIds: new Set<string>(),
        summaryLineInvoices: 0
      };
      group.lineCount += 1;
      group.totalCents += line.lineAmountCents;
      if (line.invoice?.supplierName) group.suppliers.add(line.invoice.supplierName);
      if (line.invoice?.invoiceDate && (!group.lastSeen || line.invoice.invoiceDate > group.lastSeen)) {
        group.lastSeen = line.invoice.invoiceDate;
      }
      if (line.invoice?.id) {
        group.invoiceIds.add(line.invoice.id);
        // An invoice with one line is a bill that arrived summarised.
        if ((line.invoice.lines?.length ?? 0) <= 1) group.summaryLineInvoices += 1;
      }
      groups.set(key, group);
    }

    const rows: StockUnmatchedSpendRow[] = [...groups.values()]
      .map((group) => ({
        description: group.description,
        lineCount: group.lineCount,
        totalCents: group.totalCents,
        suppliers: [...group.suppliers].sort(),
        lastSeen: group.lastSeen?.toISOString() ?? null,
        invoiceIds: [...group.invoiceIds],
        // Every line of it came off a one-line invoice: there is no product to
        // create here, the bill needs its detail pasted in.
        looksSummarised: group.summaryLineInvoices >= group.lineCount && group.lineCount > 0
      }))
      .sort((a, b) => b.totalCents - a.totalCents);

    const totalCents = rows.reduce((sum, row) => sum + row.totalCents, 0);
    const summarisedCents = rows
      .filter((row) => row.looksSummarised)
      .reduce((sum, row) => sum + row.totalCents, 0);

    return {
      rows: rows.slice(0, 60),
      distinctDescriptions: rows.length,
      lineCount: lines.length,
      totalCents,
      // Split out because the two halves need opposite actions.
      summarisedCents,
      catalogueGapCents: totalCents - summarisedCents
    };
  },

  get: getInvoicePayload
};
