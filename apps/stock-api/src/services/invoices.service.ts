import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  stockInvoiceDeleteInputSchema,
  stockInvoiceImportInputSchema,
  stockInvoiceLineRematchInputSchema,
  stockInvoiceMarkNeedsReviewInputSchema,
  stockInvoiceMarkNoItemInputSchema,
  stockInvoiceRipInputSchema,
  type StockInvoiceAssignee,
  type StockInvoiceAssigneesPayload,
  type StockInvoiceImportResult,
  type StockInvoiceMatchingStatus,
  type StockInvoiceRipResult,
  type StockInvoiceTriageStatus,
  type StockInvoicesPayload,
  type StockInvoicesSummary,
  type StockSupplierInvoice,
  type StockSupplierInvoiceLine
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type JsonRecord = Record<string, unknown>;

const lineItemSelect = {
  id: true,
  name: true,
  unit: true,
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
  assignedTo: { select: assigneeSelect }
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
  if (
    value === 'AUTO_MATCHED' ||
    value === 'MANUAL_MATCHED' ||
    value === 'NEEDS_REVIEW'
  ) {
    return value;
  }
  return 'NEEDS_REVIEW';
}

function triageStatusValue(value: string): StockInvoiceTriageStatus {
  if (value === 'NO_ITEM' || value === 'NEEDS_REVIEW' || value === 'PENDING') {
    return value;
  }
  return 'PENDING';
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

function findItemMatch(
  line: NormalisedLine,
  items: MatchItemRow[]
): { itemId: string | null; status: StockInvoiceMatchingStatus } {
  const code = normaliseKey(line.itemCode ?? '');
  if (code) {
    const skuMatch = items.find((item) => item.sku && normaliseKey(item.sku) === code);
    if (skuMatch) return { itemId: skuMatch.id, status: 'AUTO_MATCHED' };
  }

  const description = normaliseMatchText(line.description);
  const exact = items.find((item) => normaliseMatchText(item.name) === description);
  if (exact) return { itemId: exact.id, status: 'AUTO_MATCHED' };

  const contained = [...items]
    .filter((item) => {
      const name = normaliseMatchText(item.name);
      return name.length >= 4 && description.includes(name);
    })
    .sort((a, b) => b.name.length - a.name.length)[0];

  return contained
    ? { itemId: contained.id, status: 'AUTO_MATCHED' }
    : { itemId: null, status: 'NEEDS_REVIEW' };
}

async function ensureSupplier(
  tx: Prisma.TransactionClient,
  supplierName: string,
  supplierEmail: string | null
) {
  const name = supplierName.trim();
  if (!name || name === 'Unknown supplier') return null;

  const existing = await tx.supplier.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } }
  });

  if (existing) {
    if (supplierEmail && !existing.email) {
      await tx.supplier.update({
        where: { id: existing.id },
        data: { email: supplierEmail }
      });
    }
    return existing.id;
  }

  const created = await tx.supplier.create({
    data: {
      name,
      email: supplierEmail,
      status: 'ACTIVE'
    }
  });
  return created.id;
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
    item: row.item,
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

export const invoicesService = {
  async list(options?: { includeNoItem?: boolean }): Promise<StockInvoicesPayload> {
    const includeNoItem = options?.includeNoItem === true;
    const invoices = await prisma.supplierInvoice.findMany({
      where: includeNoItem ? undefined : { triageStatus: { not: 'NO_ITEM' } },
      include: {
        ...invoiceInclude,
        lines: {
          include: { item: { select: lineItemSelect } },
          orderBy: [{ lineNumber: 'asc' }, { createdAt: 'asc' }]
        }
      },
      orderBy: [{ invoiceDate: 'desc' }, { importedAt: 'desc' }],
      take: 100
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
        appAccess: {
          some: {
            appId: 'STOCK',
            status: 'ENABLED',
            role: { in: ['ADMIN', 'MANAGER'] }
          }
        }
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

  async importInvoices(input: unknown): Promise<StockInvoiceImportResult> {
    const data = stockInvoiceImportInputSchema.parse(normaliseImportBody(input));
    const source = data.source.trim().toUpperCase();
    const sourceFileName = optionalText(data.sourceFileName) ?? 'Manual invoice import';
    const sourceFileType = optionalText(data.sourceFileType);
    const venue = optionalText(data.venue);
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
    const warnings: string[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let lineCount = 0;
    let matchedLineCount = 0;
    let needsReviewLineCount = 0;
    const importedInvoiceIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const invoiceInput of normalisedInvoices) {
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
          const autoMatch = findItemMatch(line, matchItems);
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

    return {
      importedCount: normalisedInvoices.length,
      createdCount,
      updatedCount,
      lineCount,
      matchedLineCount,
      needsReviewLineCount,
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

    return toLinePayload(line);
  },

  async applyLineCost(lineId: string): Promise<StockSupplierInvoiceLine> {
    const existing = await prisma.supplierInvoiceLine.findUnique({
      where: { id: lineId },
      include: { item: { select: lineItemSelect } }
    });
    if (!existing) throw new HttpError(404, 'Invoice line not found');
    if (!existing.itemId) throw new HttpError(400, 'Match this line to a stock item first');
    const matchedItemId = existing.itemId;
    if (existing.unitAmountCents <= 0) {
      throw new HttpError(400, 'This line does not have a unit cost to apply');
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.stockItem.update({
        where: { id: matchedItemId },
        data: { avgCostCents: existing.unitAmountCents }
      });
      return tx.supplierInvoiceLine.update({
        where: { id: lineId },
        data: { costAppliedAt: new Date() },
        include: { item: { select: lineItemSelect } }
      });
    });

    return toLinePayload(updated);
  },

  get: getInvoicePayload
};
