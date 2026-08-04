import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';

// ── Lightspeed inbound-email item sales ──────────────────────────────────────
// The Lightspeed (Kounta) API is a paid add-on, so item-level sales arrive the
// free way: a scheduled Insights report emailed as CSV to a dedicated mailbox.
// The VPS IMAP poller forwards each email here as JSON (same transport as the
// SevenRooms feed); we parse the product-mix CSV and upsert SalesItemActualEntry
// rows (source "lightspeed-item:email") so menu engineering keeps seeing what
// sold. Day TOTALS deliberately do NOT come from this feed — they come from the
// Lightspeed→Xero daily sales invoices read by the scheduled Xero import —
// so the two feeds can never double-count a day.
//
// Every email is persisted to IntegrationWebhookEvent keyed by Message-ID; the
// unique constraint makes redelivery a no-op.

const VENUE_MATCHERS: Array<{ pattern: RegExp; venue: string }> = [
  { pattern: /avalon/i, venue: 'Alma Avalon' },
  { pattern: /st\.?\s*alma|freshwater/i, venue: 'St Alma' }
];

// ── CSV parsing (same conventions as the SevenRooms inbound parser) ──────────
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') index += 1;
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function csvObjects(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  const headers = rows[0]?.map(normaliseHeader) ?? [];
  if (headers.length === 0) return [];
  return rows.slice(1).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      object[header] = row[index]?.trim() ?? '';
    });
    return object;
  });
}

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return null;
}

function moneyCents(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function mapVenue(raw: string | null): string | null {
  if (!raw) return null;
  for (const { pattern, venue } of VENUE_MATCHERS) {
    if (pattern.test(raw)) return venue;
  }
  return null;
}

// "2026-07-21", "21/07/2026", "07/21/2026" → ISO date (AU dd/mm preferred —
// Lightspeed AU exports use it; an unambiguous first-segment > 12 flips).
function parseDateToken(raw: string): string | null {
  const value = raw.trim();
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    let day = Number(match[1]);
    let month = Number(match[2]);
    if (month > 12) [day, month] = [month, day];
    return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Yesterday's date key in Sydney — a scheduled daily report covers the prior
// trading day, so rows without their own date column land there.
function yesterdaySydneyKey(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' });
  const now = new Date();
  const todayKey = formatter.format(now);
  const yesterday = new Date(`${todayKey}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

type InboundAttachment = { filename?: string; content_type?: string; contentType?: string; content?: unknown };

function decodeAttachmentContent(content: unknown): string | null {
  if (typeof content === 'string') {
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(content) && !content.includes(',')) {
      try {
        return Buffer.from(content, 'base64').toString('utf8');
      } catch {
        return content;
      }
    }
    return content;
  }
  if (content && typeof content === 'object' && 'data' in (content as Record<string, unknown>)) {
    const data = (content as { data: unknown }).data;
    if (Array.isArray(data)) return Buffer.from(data as number[]).toString('utf8');
    if (typeof data === 'string') return Buffer.from(data, 'base64').toString('utf8');
  }
  return null;
}

function safeTokenEqual(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type LightspeedInboundResult = {
  received: boolean;
  duplicate?: boolean;
  ignored?: string;
  attachmentsParsed?: number;
  rowsParsed?: number;
  itemRowsUpserted?: number;
  warnings?: string[];
};

export const lightspeedInboundService = {
  async handleInboundEmail(req: Request): Promise<LightspeedInboundResult> {
    const expectedToken = process.env.LIGHTSPEED_INBOUND_TOKEN;
    if (!expectedToken) throw new HttpError(503, 'Lightspeed inbound email is not configured.');
    const providedToken = typeof req.query.token === 'string' ? req.query.token : null;
    if (!safeTokenEqual(providedToken, expectedToken)) {
      throw new HttpError(401, 'Invalid Lightspeed inbound token.');
    }

    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {});
    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Inbound email payload is not valid JSON.');
    }
    const data = (envelope.data as Record<string, unknown> | undefined) ?? envelope;
    const headers = (data.headers as Record<string, string> | undefined) ?? {};
    const messageId =
      (typeof data.message_id === 'string' && data.message_id) ||
      headers['message-id'] ||
      createHash('sha256').update(raw).digest('hex');
    const subject = typeof data.subject === 'string' ? data.subject : '';

    try {
      await prisma.integrationWebhookEvent.create({
        data: {
          provider: 'LIGHTSPEED',
          accountKey: 'inbound-email',
          providerEventId: messageId,
          eventType: 'email.received',
          payload: { subject, from: typeof data.from === 'string' ? data.from : null } as Prisma.InputJsonObject,
          status: 'RECEIVED'
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    // Every CSV attachment is a candidate (the poller unzips ZIPs for us).
    const attachments = (data.attachments as InboundAttachment[] | undefined) ?? [];
    const csvTexts: string[] = [];
    for (const attachment of attachments) {
      const name = (attachment.filename ?? '').toLowerCase();
      const type = (attachment.content_type ?? attachment.contentType ?? '').toLowerCase();
      if (!name.endsWith('.csv') && !type.includes('csv')) continue;
      const text = decodeAttachmentContent(attachment.content);
      if (text) csvTexts.push(text);
    }
    if (csvTexts.length === 0) {
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', providerEventId: messageId },
        data: { status: 'IGNORED', processedAt: new Date(), errorSummary: 'No CSV attachment found.' }
      });
      return { received: true, ignored: 'No CSV attachment found in the email.' };
    }

    // Recipes for import-time attribution: exact title match (venue-scoped
    // first, then any venue) — the same last-resort fallback the Square item
    // import uses. Full mapping lives in the menu-mapping UI later.
    const recipes = await prisma.recipe.findMany({ select: { id: true, title: true, venue: true } });
    const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const recipeByVenueAndName = new Map<string, string>();
    const recipeByName = new Map<string, string>();
    for (const recipe of recipes) {
      const key = normalise(recipe.title);
      if (!key) continue;
      if (recipe.venue) recipeByVenueAndName.set(`${recipe.venue}|${key}`, recipe.id);
      if (!recipeByName.has(key)) recipeByName.set(key, recipe.id);
    }

    const warnings: string[] = [];
    const fallbackVenue = mapVenue(subject);
    const fallbackDateKey = parseDateToken(subject) ?? yesterdaySydneyKey();
    type ItemRow = {
      venue: string;
      serviceDateKey: string;
      itemName: string;
      categoryName: string | null;
      quantity: number;
      grossSalesCents: number | null;
      netSalesCents: number | null;
      recipeId: string | null;
    };
    const grouped = new Map<string, ItemRow>();
    let rowsParsed = 0;

    for (const csv of csvTexts) {
      for (const row of csvObjects(csv)) {
        const itemName = pick(row, ['product', 'product_name', 'item', 'item_name', 'name', 'description']);
        if (!itemName) continue;
        const quantity = Number((pick(row, ['quantity', 'qty', 'units', 'units_sold', 'sold', 'count', 'number_sold']) ?? '').replace(/[,\s]/g, ''));
        if (!Number.isFinite(quantity) || quantity === 0) continue;
        rowsParsed += 1;

        const venue =
          mapVenue(pick(row, ['site', 'site_name', 'venue', 'venue_name', 'location', 'location_name'])) ?? fallbackVenue;
        if (!venue) {
          warnings.push(`"${itemName}": could not determine venue — skipped.`);
          continue;
        }
        const dateRaw = pick(row, ['date', 'business_date', 'trading_date', 'service_date', 'day']);
        const serviceDateKey = (dateRaw ? parseDateToken(dateRaw) : null) ?? fallbackDateKey;

        const grossCents = moneyCents(pick(row, ['gross_sales', 'total_sales', 'sales_inc_gst', 'gross', 'total', 'amount']));
        let netCents = moneyCents(pick(row, ['net_sales', 'sales_ex_gst', 'net', 'net_amount', 'ex_gst']));
        // Lightspeed AU reports are GST-inclusive unless the column says net.
        if (netCents === null && grossCents !== null) netCents = Math.round(grossCents / 1.1);

        const categoryName = pick(row, ['category', 'category_name', 'product_category', 'group']);
        const nameKey = normalise(itemName);
        const recipeId = recipeByVenueAndName.get(`${venue}|${nameKey}`) ?? recipeByName.get(nameKey) ?? null;

        const key = `${venue}|${serviceDateKey}|${nameKey}`;
        const existing = grouped.get(key) ?? {
          venue,
          serviceDateKey,
          itemName,
          categoryName,
          quantity: 0,
          grossSalesCents: null,
          netSalesCents: null,
          recipeId
        };
        existing.quantity += quantity;
        if (grossCents !== null) existing.grossSalesCents = (existing.grossSalesCents ?? 0) + grossCents;
        if (netCents !== null) existing.netSalesCents = (existing.netSalesCents ?? 0) + netCents;
        grouped.set(key, existing);
      }
    }

    const source = 'lightspeed-item:email';
    const rows = Array.from(grouped.values());
    const UPSERT_BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < rows.length; batchStart += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + UPSERT_BATCH_SIZE);
      await prisma.$transaction(
        batch.map((row) => {
          const externalId = `${source}:${row.venue}:${row.serviceDateKey}:${normalise(row.itemName).replace(/\s+/g, '-')}`;
          const serviceDate = new Date(`${row.serviceDateKey}T00:00:00Z`);
          const shared = {
            itemName: row.itemName,
            categoryName: row.categoryName,
            quantity: row.quantity,
            grossSalesCents: row.grossSalesCents ?? 0,
            netSalesCents: row.netSalesCents ?? 0,
            recipeId: row.recipeId,
            notes: 'Lightspeed item sales via emailed Insights CSV.'
          };
          return prisma.salesItemActualEntry.upsert({
            where: {
              venue_serviceDate_source_externalId: { venue: row.venue, serviceDate, source, externalId }
            },
            create: { venue: row.venue, serviceDate, source, externalId, ...shared },
            update: shared
          });
        })
      );
    }

    await prisma.integrationWebhookEvent.updateMany({
      where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', providerEventId: messageId },
      data: {
        processedAt: new Date(),
        payload: {
          subject,
          attachmentsParsed: csvTexts.length,
          rowsParsed,
          itemRowsUpserted: rows.length,
          warnings: warnings.slice(0, 25)
        } as Prisma.InputJsonObject
      }
    });

    return {
      received: true,
      attachmentsParsed: csvTexts.length,
      rowsParsed,
      itemRowsUpserted: rows.length,
      warnings
    };
  }
};
