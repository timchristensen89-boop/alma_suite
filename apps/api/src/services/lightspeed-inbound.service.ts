import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type { LightspeedInboundReport } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { csvObjects, moneyCents, normaliseHeader, parseCsv, parseDateToken, pick } from '../lib/lightspeed-csv.js';
import {
  isDigestFragment,
  isRankingFragment,
  mergeAttachmentTips,
  parseTipsFromCsv,
  type AttachmentTipDays
} from '../lib/lightspeed-tips.js';
import { totalTipsPerDay, type ParsedTipRow } from '../lib/tip-rows.js';

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

// ── Venue + day helpers ──────────────────────────────────────────────────────
function mapVenue(raw: string | null): string | null {
  if (!raw) return null;
  for (const { pattern, venue } of VENUE_MATCHERS) {
    if (pattern.test(raw)) return venue;
  }
  return null;
}

function todaySydneyKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date());
}

// ── Looker day-summary export ────────────────────────────────────────────────
// Lightspeed Insights "Sales Detail/Summary" dashboards export a per-day
// summary (Sale Closed Date, Total Ex Tax, Total Inc Tax, guest counts) rather
// than an item mix. Looker's CSV quirk: the date and the money often land on
// SEPARATE rows (date-only row, then a values row with a blank date), so the
// last seen date carries forward.
type DaySummaryRow = { dateKey: string; exTaxCents: number | null; incTaxCents: number | null; guests: number | null };

function isDaySummaryCsv(csv: string): boolean {
  const headers = parseCsv(csv)[0]?.map(normaliseHeader) ?? [];
  const hasDate = headers.some((header) => /sale_closed_date|business_date/.test(header));
  const hasMoney = headers.some((header) => /total_ex_tax|total_inc_tax|net_sales/.test(header));
  return hasDate && hasMoney;
}

function parseDaySummaries(csv: string): DaySummaryRow[] {
  const out = new Map<string, DaySummaryRow>();
  let carriedDate: string | null = null;
  for (const row of csvObjects(csv)) {
    const dateRaw = pick(row, [
      'sales_data_sale_closed_date',
      'sale_closed_date',
      'business_date',
      'date',
      'day'
    ]);
    const dateKey = dateRaw ? parseDateToken(dateRaw) : null;
    if (dateKey) carriedDate = dateKey;
    const exTaxCents = moneyCents(
      pick(row, ['sales_data_total_ex_tax', 'total_ex_tax', 'total_ex_gst', 'net_sales'])
    );
    const incTaxCents = moneyCents(
      pick(row, ['sales_data_total_inc_tax', 'total_inc_tax', 'total_inc_gst', 'gross_sales'])
    );
    const guestsRaw = pick(row, ['guests_total_guest_count', 'total_guest_count', 'guest_count', 'guests']);
    const guests = guestsRaw !== null && Number.isFinite(Number(guestsRaw.replace(/[,\s]/g, '')))
      ? Number(guestsRaw.replace(/[,\s]/g, ''))
      : null;
    if (exTaxCents === null && incTaxCents === null && guests === null) continue;
    const target = dateKey ?? carriedDate;
    if (!target) continue;
    const existing = out.get(target) ?? { dateKey: target, exTaxCents: null, incTaxCents: null, guests: null };
    if (exTaxCents !== null) existing.exTaxCents = (existing.exTaxCents ?? 0) + exTaxCents;
    if (incTaxCents !== null) existing.incTaxCents = (existing.incTaxCents ?? 0) + incTaxCents;
    if (guests !== null && guests > 0) existing.guests = (existing.guests ?? 0) + guests;
    out.set(target, existing);
  }
  return Array.from(out.values());
}

// What the imported row says about where its figure came from. Worth spelling
// out: "3 rows" on a row that was summed and on a row that was a repeated total
// mean very different things, and the difference is 3× someone's tips.
function tipNote(day: { rows: number; repeated: boolean; saleIds: number; files: string[] }): string {
  const from = day.files.length ? ` — ${day.files.join(', ')}` : '';
  if (day.saleIds > 0) {
    return `Card tips from emailed Lightspeed report (${day.saleIds} tipped sale${day.saleIds === 1 ? '' : 's'} on ${day.rows} rows${from}).`;
  }
  return day.repeated
    ? `Card tips from emailed Lightspeed report (day total repeated on ${day.rows} rows, counted once${from}).`
    : `Card tips from emailed Lightspeed report (${day.rows} rows${from}).`;
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
  digestFragmentsSkipped?: number;
  rowsParsed?: number;
  itemRowsUpserted?: number;
  dayTotalsUpserted?: number;
  dayTotalsSkipped?: number;
  tipDaysUpserted?: number;
  /** Days deliberately not written: a guessed-date sum, or attachments that disagree. */
  tipDaysRefused?: number;
  /** Days left alone because card tips were already recorded by hand or by the API sync. */
  tipDaysSkipped?: number;
  tipCents?: number;
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
    // Looker "overview" dashboards attach each tile as its own CSV. Rankings
    // and movers (top 10, highest, drop-off, discounts) are partial by
    // construction and feed nothing. Summary tiles ("Untitled", "Summary of
    // …", "Total …") are too coarse for the item mix, but a tips column on one
    // of them IS the day's tips — skipping those tiles by name is how a tips
    // report that parsed cleanly recorded nothing. See lib/lightspeed-tips.ts.
    const attachments = (data.attachments as InboundAttachment[] | undefined) ?? [];
    type CsvFile = { name: string; text: string };
    const csvFiles: CsvFile[] = [];
    const itemFiles: CsvFile[] = [];
    const tipFiles: CsvFile[] = [];
    let digestFragmentsSkipped = 0;
    for (const attachment of attachments) {
      const name = (attachment.filename ?? '').toLowerCase();
      const type = (attachment.content_type ?? attachment.contentType ?? '').toLowerCase();
      if (!name.endsWith('.csv') && !type.includes('csv')) continue;
      const text = decodeAttachmentContent(attachment.content);
      if (!text) continue;
      const file = { name: attachment.filename ?? 'attachment.csv', text };
      csvFiles.push(file);
      if (isDigestFragment(name)) digestFragmentsSkipped += 1;
      else itemFiles.push(file);
      if (!isRankingFragment(name)) tipFiles.push(file);
    }
    if (csvFiles.length === 0 || (itemFiles.length === 0 && tipFiles.length === 0)) {
      const reason = digestFragmentsSkipped > 0
        ? `Only top-10/digest fragments (${digestFragmentsSkipped}) — schedule a full product-mix report instead.`
        : 'No CSV attachment found.';
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', providerEventId: messageId },
        data: { status: 'IGNORED', processedAt: new Date(), errorSummary: reason }
      });
      return { received: true, ignored: reason, digestFragmentsSkipped };
    }

    // Recipes for import-time attribution: exact title match (venue-scoped
    // first, then any venue) — the same last-resort fallback the Square item
    // import uses. Full mapping lives in the menu-mapping UI later.
    const recipes = await prisma.recipe.findMany({ select: { id: true, title: true, venue: true } });
    const normalise = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    // Word order differs between POS and recipe names ("Grilled Barramundi
    // Taco" vs "Barramundi Taco Grilled"), so a sorted-token key is the
    // last-resort match after the exact one.
    const tokenSort = (value: string) => normalise(value).split(' ').sort().join(' ');
    const recipeByVenueAndName = new Map<string, string>();
    const recipeByName = new Map<string, string>();
    const recipeByTokens = new Map<string, string>();
    for (const recipe of recipes) {
      const key = normalise(recipe.title);
      if (!key) continue;
      if (recipe.venue) recipeByVenueAndName.set(`${recipe.venue}|${key}`, recipe.id);
      if (!recipeByName.has(key)) recipeByName.set(key, recipe.id);
      const tokenKey = tokenSort(recipe.title);
      if (!recipeByTokens.has(tokenKey)) recipeByTokens.set(tokenKey, recipe.id);
    }

    const warnings: string[] = [];
    if (itemFiles.length === 0) {
      warnings.push(
        `Only summary/digest tiles attached (${digestFragmentsSkipped}) — no item sales were read; their tips columns were still checked.`
      );
    }
    const fallbackVenue =
      mapVenue(subject) ?? process.env.LIGHTSPEED_EMAIL_DEFAULT_VENUE ?? 'Alma Avalon';
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

    for (const { text: csv } of itemFiles) {
      for (const row of csvObjects(csv)) {
        const itemName = pick(row, ['product', 'product_name', 'products_product_name', 'item', 'item_name', 'name', 'description']);
        if (!itemName) continue;
        const quantity = Number((pick(row, ['quantity', 'quantity_sold', 'product_quantity', 'products_sold', 'qty', 'units', 'units_sold', 'sold', 'count', 'number_sold']) ?? '').replace(/[,\s]/g, ''));
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

        const grossCents = moneyCents(pick(row, ['gross_sales', 'total_sales', 'sales_inc_gst', 'total_revenue', 'total_inc_tax', 'gross', 'total', 'amount', 'sales']));
        let netCents = moneyCents(pick(row, ['net_sales', 'sales_ex_gst', 'exclusive_of_tax', 'total_ex_tax', 'net', 'net_amount', 'ex_gst']));
        // Lightspeed AU reports are GST-inclusive unless the column says net.
        if (netCents === null && grossCents !== null) netCents = Math.round(grossCents / 1.1);

        const categoryName = pick(row, ['category', 'category_name', 'product_category', 'pos_category', 'reporting_group_name', 'group']);
        const nameKey = normalise(itemName);
        const recipeId =
          recipeByVenueAndName.get(`${venue}|${nameKey}`) ??
          recipeByName.get(nameKey) ??
          recipeByTokens.get(tokenSort(itemName)) ??
          null;

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

    // ── Day-summary CSVs → SalesActualEntry directly ───────────────────────
    // Real ex-GST figures straight from the report (no ÷1.1 estimate). Guards:
    // never write TODAY (the 6am schedule sees an incomplete, often $0 day),
    // never write a $0 row, and never touch a day the Xero feed already owns.
    let summaryDaysUpserted = 0;
    const todayKey = todaySydneyKey();
    for (const { text: csv } of itemFiles) {
      if (!isDaySummaryCsv(csv)) continue;
      for (const day of parseDaySummaries(csv)) {
        rowsParsed += 1;
        const netCents = day.exTaxCents ?? (day.incTaxCents !== null ? Math.round(day.incTaxCents / 1.1) : null);
        if (netCents === null) continue;
        if (day.dateKey >= todayKey) {
          warnings.push(`Summary row for ${day.dateKey} skipped — the day isn't over yet. Set the report's date filter to "Yesterday".`);
          continue;
        }
        if (netCents <= 0) {
          warnings.push(`Summary row for ${day.dateKey} skipped — $0 total (report likely ran before trading).`);
          continue;
        }
        const venue = fallbackVenue;
        const serviceDate = new Date(`${day.dateKey}T00:00:00Z`);
        const xeroRow = await prisma.salesActualEntry.findFirst({
          where: { venue, serviceDate, source: 'lightspeed-xero' },
          select: { id: true }
        });
        if (xeroRow) continue;
        const summarySource = 'lightspeed-email';
        const externalId = `${summarySource}:${venue}:${day.dateKey}`;
        await prisma.salesActualEntry.upsert({
          where: {
            venue_serviceDate_source_externalId: { venue, serviceDate, source: summarySource, externalId }
          },
          create: {
            venue,
            serviceDate,
            salesCents: netCents,
            coversCount: day.guests,
            source: summarySource,
            externalId,
            notes: 'Lightspeed daily total from emailed Insights summary (ex GST).'
          },
          update: {
            salesCents: netCents,
            ...(day.guests !== null ? { coversCount: day.guests } : {}),
            notes: 'Lightspeed daily total from emailed Insights summary (ex GST).'
          }
        });
        summaryDaysUpserted += 1;
      }
    }

    // ── Tips → StaffTipCardEntry ───────────────────────────────────────────
    // Each attachment is totalled per venue per day on its own (lib/tip-rows:
    // a repeated day total counts once, distinct sales add up), then the
    // attachments are merged (lib/lightspeed-tips: agreeing tiles are one
    // figure, disagreeing tiles are refused). Today is skipped (the day isn't
    // over), $0 days are skipped, a day the API sync (source 'lightspeed')
    // already wrote is left alone, and so is a day someone has already entered
    // by hand — no path may pay a day twice.
    let tipDaysUpserted = 0;
    let tipDaysRefused = 0;
    let tipDaysSkipped = 0;
    let tipCentsImported = 0;
    let sawTipsColumn = false;
    const perAttachment: AttachmentTipDays[] = [];
    for (const file of tipFiles) {
      const parsedTips = parseTipsFromCsv(file.text);
      if (!parsedTips.sawTipsColumn) continue;
      sawTipsColumn = true;
      const tipRows: ParsedTipRow[] = [];
      for (const tipRow of parsedTips.rows) {
        const venue = mapVenue(tipRow.venueRaw) ?? fallbackVenue;
        const dateKey = tipRow.dateKey ?? fallbackDateKey;
        if (dateKey >= todayKey) {
          warnings.push(`Tips row for ${dateKey} (${file.name}) skipped — the day isn't over yet. Set the report's date filter to "Yesterday".`);
          continue;
        }
        tipRows.push({ venue, dateKey, tipCents: tipRow.tipCents, dated: tipRow.dateKey !== null, rowId: tipRow.rowId });
      }
      if (!parsedTips.columns.date && tipRows.length > 0) {
        warnings.push(
          `${file.name}: tips column "${parsedTips.columns.tip}" found but no date column, so its rows were filed under ${fallbackDateKey}. ` +
            'Add the business date (e.g. "Sale Closed Date") to the report.'
        );
      }
      perAttachment.push({ filename: file.name, days: totalTipsPerDay(tipRows) });
    }
    const merged = mergeAttachmentTips(perAttachment);
    for (const dispute of merged.disputed) {
      const figures = dispute.figures
        .map((figure) => `${figure.filename} $${(figure.cents / 100).toFixed(2)} (${figure.rows} rows)`)
        .join('; ');
      warnings.push(
        `${dispute.venue} ${dispute.dateKey}: the attachments disagree on the day's tips — ${figures}. Nothing was recorded; ` +
          'keep the tips column on one tile of the report.'
      );
      tipDaysRefused += 1;
    }
    for (const tipDay of merged.days) {
      if (tipDay.cents <= 0) continue;
      // Several undated rows added together is not a day's takings — it is a
      // guess. Alma Avalon's Saturday 22 Aug 2026 went missing this way: the
      // report stopped carrying a date column, 14 rows spanning more than one
      // trading day all landed on "yesterday", and $681.87 was filed as a
      // single Sunday against $2,382 of sales. A visible gap and a warning are
      // recoverable; a plausible wrong number gets paid out.
      if (tipDay.guessedDate && tipDay.rows > 1 && !tipDay.repeated) {
        warnings.push(
          `${tipDay.venue}: ${tipDay.rows} tip rows (${tipDay.files.join(', ')}) carried no date of their own and would have been ` +
            `added up to $${(tipDay.cents / 100).toFixed(2)} on ${tipDay.dateKey}. Nothing was recorded — ` +
            'undated rows cannot be told apart from several days\' takings run together. Set the ' +
            'report\'s date filter to "Yesterday" and include the business date column.'
        );
        tipDaysRefused += 1;
        continue;
      }
      const serviceDate = new Date(`${tipDay.dateKey}T00:00:00Z`);
      const otherRows = await prisma.staffTipCardEntry.findMany({
        where: { venue: tipDay.venue, serviceDate, source: { not: 'lightspeed-email' } },
        select: { source: true, amountCents: true }
      });
      // The API sync owns any day it wrote; nothing to say.
      if (otherRows.some((row) => row.source === 'lightspeed')) {
        tipDaysSkipped += 1;
        continue;
      }
      // A day already entered by hand (the pasted sales-feed export, a Control
      // figure) is the manager's decision. Writing the emailed figure on top
      // would sum with it in the pool.
      if (otherRows.length > 0) {
        const byHand = otherRows.reduce((sum, row) => sum + row.amountCents, 0);
        const sources = Array.from(new Set(otherRows.map((row) => row.source))).join(', ');
        warnings.push(
          `${tipDay.venue} ${tipDay.dateKey}: card tips already recorded from ${sources} ($${(byHand / 100).toFixed(2)}), so the emailed ` +
            `$${(tipDay.cents / 100).toFixed(2)} was not written on top of them. Delete those rows on the Tips page first if the report should own this day.`
        );
        tipDaysSkipped += 1;
        continue;
      }
      const importKey = `lightspeed-email:${tipDay.venue}:${tipDay.dateKey}`;
      await prisma.staffTipCardEntry.upsert({
        where: { importKey },
        create: {
          venue: tipDay.venue,
          serviceDate,
          amountCents: tipDay.cents,
          source: 'lightspeed-email',
          externalId: importKey,
          importKey,
          notes: tipNote(tipDay)
        },
        update: {
          amountCents: tipDay.cents,
          notes: tipNote(tipDay)
        }
      });
      tipDaysUpserted += 1;
      tipCentsImported += tipDay.cents;
    }
    for (const tipDay of merged.days) {
      if (!tipDay.repeated) continue;
      warnings.push(
        `${tipDay.venue} ${tipDay.dateKey}: the tips column carried the same figure on all ${tipDay.rows} rows (${tipDay.files.join(', ')}), ` +
          'so it was read as the day total once rather than added up.'
      );
    }
    if (sawTipsColumn && merged.days.length > 0 && tipCentsImported === 0 && tipDaysUpserted === 0 && tipDaysRefused === 0 && tipDaysSkipped === 0) {
      warnings.push('A tips column was found but every usable day summed to zero.');
    }
    // The other half of the Avalon Saturday: the email arrived on time, parsed
    // cleanly, wrote that day's sales — and recorded no tips at all, because the
    // tips column simply was not in the CSV. Saying nothing made a report that
    // lost its tips column look exactly like a night that genuinely took none.
    // Only reports that announce themselves as tips are checked, so the four
    // daily sales digests stay quiet.
    if (/tips?|gratuit/i.test(subject) && !sawTipsColumn) {
      warnings.push(
        `"${subject}" reads as a tips report but no tips column was found in any of its ` +
          `${tipFiles.length} attachment(s) (${tipFiles.map((file) => file.name).join(', ') || 'none'}), so no tips were recorded for this day.`
      );
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

    // ── Day totals fallback ─────────────────────────────────────────────────
    // The authoritative daily total is the Lightspeed→Xero invoice read by the
    // scheduled Xero import (source "lightspeed-xero"). Until that connection
    // works, derive the day total here as the sum of item net sales — and skip
    // any venue+day the Xero feed already covers, so the two sources can never
    // both count the same day. (The Xero writer deletes these fallback rows
    // when it lands, superseding them.)
    const dayTotals = new Map<string, { venue: string; serviceDateKey: string; netCents: number; itemRows: number }>();
    for (const row of rows) {
      if (row.netSalesCents === null) continue;
      const key = `${row.venue}|${row.serviceDateKey}`;
      const existing = dayTotals.get(key) ?? { venue: row.venue, serviceDateKey: row.serviceDateKey, netCents: 0, itemRows: 0 };
      existing.netCents += row.netSalesCents;
      existing.itemRows += 1;
      dayTotals.set(key, existing);
    }
    let dayTotalsUpserted = summaryDaysUpserted;
    let dayTotalsSkipped = 0;
    for (const total of dayTotals.values()) {
      const serviceDate = new Date(`${total.serviceDateKey}T00:00:00Z`);
      // Create-only: an existing total (Xero feed, summary email, or a manual
      // reconciliation entry) is reconciled money — an item-sum estimate must
      // never overwrite it, only fill days that have nothing.
      const existingTotal = await prisma.salesActualEntry.findFirst({
        where: {
          venue: total.venue,
          serviceDate,
          source: { in: ['lightspeed-xero', 'lightspeed-email'] }
        },
        select: { id: true }
      });
      if (existingTotal) {
        dayTotalsSkipped += 1;
        continue;
      }
      const source = 'lightspeed-email';
      const externalId = `${source}:${total.venue}:${total.serviceDateKey}`;
      await prisma.salesActualEntry.create({
        data: {
          venue: total.venue,
          serviceDate,
          salesCents: total.netCents,
          source,
          externalId,
          notes: `Lightspeed daily total from emailed item CSV (ex GST, sum of ${total.itemRows} item rows).`
        }
      });
      dayTotalsUpserted += 1;
    }

    await prisma.integrationWebhookEvent.updateMany({
      where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', providerEventId: messageId },
      data: {
        processedAt: new Date(),
        payload: {
          subject,
          attachmentsParsed: itemFiles.length,
          tipAttachmentsParsed: tipFiles.length,
          digestFragmentsSkipped,
          rowsParsed,
          itemRowsUpserted: rows.length,
          dayTotalsUpserted,
          dayTotalsSkipped,
          tipDaysUpserted,
          tipDaysRefused,
          tipDaysSkipped,
          tipCents: tipCentsImported,
          warnings: warnings.slice(0, 25)
        } as Prisma.InputJsonObject
      }
    });

    return {
      received: true,
      attachmentsParsed: itemFiles.length,
      digestFragmentsSkipped,
      rowsParsed,
      itemRowsUpserted: rows.length,
      dayTotalsUpserted,
      dayTotalsSkipped,
      tipDaysUpserted,
      tipDaysRefused,
      tipDaysSkipped,
      tipCents: tipCentsImported,
      warnings
    };
  },

  /**
   * The recent emailed reports and what each one did, newest first. This is
   * the same record scripts/tips-diagnose.sh prints on the VPS; surfacing it
   * on the Tips page is what stops "no tips this week" from needing a shell.
   */
  async recentInboundReports(input: { days?: number } = {}): Promise<LightspeedInboundReport[]> {
    const requested = Number(input.days);
    const days = Number.isFinite(requested) ? Math.min(60, Math.max(1, Math.floor(requested))) : 14;
    const since = new Date(Date.now() - days * 86_400_000);
    const events = await prisma.integrationWebhookEvent.findMany({
      where: { provider: 'LIGHTSPEED', accountKey: 'inbound-email', receivedAt: { gte: since } },
      orderBy: { receivedAt: 'desc' },
      take: 60,
      select: { receivedAt: true, processedAt: true, status: true, errorSummary: true, payload: true }
    });
    const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
    return events.map((event) => {
      const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
      return {
        receivedAt: event.receivedAt.toISOString(),
        processedAt: event.processedAt?.toISOString() ?? null,
        status: String(event.status),
        subject: typeof payload.subject === 'string' ? payload.subject : '(no subject)',
        errorSummary: event.errorSummary ?? null,
        attachmentsParsed: count(payload.attachmentsParsed),
        tipDaysUpserted: count(payload.tipDaysUpserted),
        tipDaysRefused: count(payload.tipDaysRefused),
        tipDaysSkipped: count(payload.tipDaysSkipped),
        tipCents: count(payload.tipCents),
        dayTotalsUpserted: count(payload.dayTotalsUpserted),
        warnings: Array.isArray(payload.warnings) ? payload.warnings.filter((w): w is string => typeof w === 'string') : []
      };
    });
  }
};
