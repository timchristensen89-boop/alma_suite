import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import { HttpError } from '../lib/http.js';

// ── SevenRooms inbound-email ingestion ────────────────────────────────────────
// SevenRooms emails a scheduled reservation export (CSV attachment) to a
// dedicated address; the inbound-email provider (Resend Inbound) POSTs the
// parsed email as JSON to /webhooks/sevenrooms/email?token=…. We read the CSV,
// upsert ReserveGuest + ReserveReservation rows (source "sevenrooms",
// externalRef = the SevenRooms confirmation id so re-imports update in place),
// and the Reserve reports light up with real bookings/covers/no-shows.
//
// Every email is persisted to IntegrationWebhookEvent keyed by its Message-ID —
// the unique constraint makes redelivered webhooks a no-op.

const DEFAULT_DURATION_MINUTES = 120;

// SevenRooms venue label → suite venue. Contains-matching, case-insensitive.
const VENUE_MATCHERS: Array<{ pattern: RegExp; venue: string }> = [
  { pattern: /avalon/i, venue: 'Alma Avalon' },
  { pattern: /st\.?\s*alma|freshwater/i, venue: 'St Alma' }
];

// ── CSV parsing (same conventions as the offline SevenRooms importers) ───────
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

// ── field helpers ─────────────────────────────────────────────────────────────
function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return null;
}

function mapVenue(raw: string | null): string | null {
  if (!raw) return null;
  for (const { pattern, venue } of VENUE_MATCHERS) {
    if (pattern.test(raw)) return venue;
  }
  return null;
}

function mapStatus(raw: string | null): 'PENDING' | 'CONFIRMED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' {
  const value = (raw ?? '').toLowerCase();
  if (/no[\s_-]?show/.test(value)) return 'NO_SHOW';
  if (/cancel/.test(value)) return 'CANCELLED';
  if (/complete|finished|paid|left|done/.test(value)) return 'COMPLETED';
  if (/seated|arrived|partial/.test(value)) return 'SEATED';
  if (/pending|request|wait/.test(value)) return 'PENDING';
  return 'CONFIRMED';
}

// Sydney offset for a given date (handles AEST +10 / AEDT +11).
function sydneyOffset(dateIso: string): string {
  const probe = new Date(`${dateIso}T12:00:00Z`);
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Sydney',
    timeZoneName: 'longOffset'
  }).format(probe);
  const match = formatted.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return '+10:00';
  const hours = Number(match[1]);
  const minutes = match[2] ?? '00';
  return `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:${minutes}`;
}

// "07/21/2026", "21/07/2026", "2026-07-21", "Jul 21, 2026" → ISO date. US-style
// (mm/dd) is the SevenRooms default; a first segment > 12 means dd/mm.
function parseDateToken(raw: string): string | null {
  const value = raw.trim();
  let match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    let month = Number(match[1]);
    let day = Number(match[2]);
    if (month > 12) [month, day] = [day, month];
    return `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return null;
}

// "6:30 PM", "18:30", "6:30pm" → "18:30". Defaults to 18:00 when absent so a
// date-only export still lands on the right service date.
function parseTimeToken(raw: string | null): string {
  if (!raw) return '18:00';
  const value = raw.trim().toLowerCase();
  const match = value.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/);
  if (!match) return '18:00';
  let hours = Number(match[1]);
  const minutes = match[2] ?? '00';
  if (match[3] === 'pm' && hours < 12) hours += 12;
  if (match[3] === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

function servicePeriodFor(hour: number): 'BREAKFAST' | 'LUNCH' | 'DINNER' {
  if (hour < 11) return 'BREAKFAST';
  if (hour < 16) return 'LUNCH';
  return 'DINNER';
}

function parseName(row: Record<string, string>): { firstName: string; lastName: string } {
  const first = pick(row, ['first_name', 'guest_first_name', 'client_first_name']);
  const last = pick(row, ['last_name', 'guest_last_name', 'client_last_name']);
  if (first || last) return { firstName: first ?? 'Guest', lastName: last ?? '' };
  const full = pick(row, ['guest_name', 'client_name', 'full_name', 'name']) ?? '';
  const parts = full.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Guest', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '' };
}

// ── inbound payload handling ─────────────────────────────────────────────────
type InboundAttachment = { filename?: string; content_type?: string; contentType?: string; content?: unknown; url?: string };

function decodeAttachmentContent(content: unknown): string | null {
  if (typeof content === 'string') {
    // Heuristic: base64 payloads have no commas/newlines; CSV text does.
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

async function extractCsvText(data: Record<string, unknown>): Promise<{ csv: string | null; source: string }> {
  const attachments = (data.attachments as InboundAttachment[] | undefined) ?? [];
  for (const attachment of attachments) {
    const name = (attachment.filename ?? '').toLowerCase();
    const type = (attachment.content_type ?? attachment.contentType ?? '').toLowerCase();
    if (!name.endsWith('.csv') && !type.includes('csv') && !type.includes('text/plain')) continue;
    const inline = decodeAttachmentContent(attachment.content);
    if (inline) return { csv: inline, source: `attachment:${attachment.filename ?? 'unnamed'}` };
    if (attachment.url) {
      try {
        const headers: Record<string, string> = {};
        if (process.env.RESEND_API_KEY) headers.Authorization = `Bearer ${process.env.RESEND_API_KEY}`;
        const response = await fetch(attachment.url, { headers });
        if (response.ok) return { csv: await response.text(), source: `attachment-url:${attachment.filename ?? 'unnamed'}` };
      } catch {
        // fall through to other attachments / body
      }
    }
  }
  // Fallback: a text body that looks like CSV (header row with commas).
  const text = typeof data.text === 'string' ? data.text : null;
  if (text && text.includes(',') && text.includes('\n')) {
    const headerLine = text.split('\n', 1)[0] ?? '';
    if (/date|time|party|covers|guest|status|reservation/i.test(headerLine)) {
      return { csv: text, source: 'text-body' };
    }
  }
  return { csv: null, source: 'none' };
}

function safeTokenEqual(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type SevenroomsIngestResult = {
  received: boolean;
  duplicate?: boolean;
  ignored?: string;
  rowsParsed?: number;
  reservationsCreated?: number;
  reservationsUpdated?: number;
  guestsCreated?: number;
  warnings?: string[];
};

export const sevenroomsService = {
  async handleInboundEmail(req: Request): Promise<SevenroomsIngestResult> {
    const expectedToken = process.env.SEVENROOMS_INBOUND_TOKEN;
    if (!expectedToken) throw new HttpError(503, 'SevenRooms inbound email is not configured.');
    const providedToken = typeof req.query.token === 'string' ? req.query.token : null;
    if (!safeTokenEqual(providedToken, expectedToken)) {
      throw new HttpError(401, 'Invalid SevenRooms inbound token.');
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
      (typeof data.email_id === 'string' && data.email_id) ||
      headers['message-id'] ||
      headers['Message-Id'] ||
      createHash('sha256').update(raw).digest('hex');
    const subject = typeof data.subject === 'string' ? data.subject : null;
    const fromAddress = typeof data.from === 'string' ? data.from : JSON.stringify(data.from ?? null);

    // Persist + dedupe on the email's Message-ID. A redelivered webhook hits
    // the unique constraint and becomes a no-op.
    try {
      await prisma.integrationWebhookEvent.create({
        data: {
          provider: 'SEVENROOMS',
          accountKey: 'inbound-email',
          providerEventId: messageId,
          eventType: 'email.received',
          payload: { subject, from: fromAddress } as Prisma.InputJsonObject,
          status: 'RECEIVED'
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    const { csv, source } = await extractCsvText(data);
    if (!csv) {
      await prisma.integrationWebhookEvent.updateMany({
        where: { provider: 'SEVENROOMS', accountKey: 'inbound-email', providerEventId: messageId },
        data: { status: 'IGNORED', processedAt: new Date(), errorSummary: 'No CSV attachment or CSV-like body found.' }
      });
      return { received: true, ignored: 'No CSV attachment or CSV-like body found in the email.' };
    }

    const rows = csvObjects(csv);
    const warnings: string[] = [];
    let reservationsCreated = 0;
    let reservationsUpdated = 0;
    let guestsCreated = 0;

    for (const [index, row] of rows.entries()) {
      const rowLabel = `row ${index + 2}`;

      const venue = mapVenue(pick(row, ['venue', 'venue_name', 'location', 'restaurant']))
        ?? mapVenue(subject)
        ?? null;
      if (!venue) {
        warnings.push(`${rowLabel}: could not determine venue — skipped.`);
        continue;
      }

      const dateRaw = pick(row, ['date', 'reservation_date', 'res_date', 'service_date', 'day']);
      const dateIso = dateRaw ? parseDateToken(dateRaw) : null;
      if (!dateIso) {
        warnings.push(`${rowLabel}: missing or unreadable date — skipped.`);
        continue;
      }
      const time = parseTimeToken(pick(row, ['time', 'reservation_time', 'arrival_time', 'res_time', 'seating_time']));
      const offset = sydneyOffset(dateIso);
      const startsAt = new Date(`${dateIso}T${time}:00${offset}`);
      if (Number.isNaN(startsAt.getTime())) {
        warnings.push(`${rowLabel}: unreadable date/time — skipped.`);
        continue;
      }
      const durationMinutes = Number(pick(row, ['duration', 'duration_minutes']) ?? '') || DEFAULT_DURATION_MINUTES;
      const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
      const serviceDate = new Date(`${dateIso}T00:00:00${offset}`);

      const covers = Number(pick(row, ['covers', 'party_size', 'guests', 'pax', 'party', 'max_guests']) ?? '') || 1;
      const status = mapStatus(pick(row, ['status', 'reservation_status', 'state']));
      const externalRef = pick(row, ['reservation_id', 'confirmation_number', 'confirmation', 'reference_number', 'reference', 'booking_id', 'id']);
      const sevenRoomsGuestId = pick(row, ['client_id', 'guest_id', 'client_reference']);

      const { firstName, lastName } = parseName(row);
      const email = pick(row, ['email', 'guest_email', 'client_email'])?.toLowerCase() ?? null;
      const phone = pick(row, ['phone', 'phone_number', 'mobile', 'guest_phone']) ?? null;
      const notes = pick(row, ['notes', 'reservation_notes', 'special_requests', 'requests']);

      // Guest: match by SevenRooms client id, then email, then phone; else create.
      let guest = sevenRoomsGuestId
        ? await prisma.reserveGuest.findFirst({
            where: { preferences: { path: ['sevenRoomsGuestId'], equals: sevenRoomsGuestId } }
          })
        : null;
      if (!guest && email) guest = await prisma.reserveGuest.findFirst({ where: { email } });
      if (!guest && phone) guest = await prisma.reserveGuest.findFirst({ where: { phone } });
      if (!guest) {
        guest = await prisma.reserveGuest.create({
          data: {
            venue,
            firstName,
            lastName,
            email,
            phone,
            source: 'sevenrooms',
            preferences: (sevenRoomsGuestId ? { sevenRoomsGuestId } : {}) as Prisma.InputJsonObject
          }
        });
        guestsCreated += 1;
      }

      const reservationData = {
        venue,
        serviceDate,
        servicePeriod: servicePeriodFor(Number(time.slice(0, 2))),
        startsAt,
        endsAt,
        covers,
        status,
        source: 'sevenrooms',
        guestId: guest.id,
        guestName: `${firstName} ${lastName}`.trim(),
        guestEmail: email,
        guestPhone: phone,
        notes,
        ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        ...(status === 'COMPLETED' ? { completedAt: startsAt } : {})
      };

      if (externalRef) {
        const existing = await prisma.reserveReservation.findUnique({ where: { externalRef } });
        if (existing) {
          await prisma.reserveReservation.update({ where: { externalRef }, data: reservationData });
          reservationsUpdated += 1;
        } else {
          await prisma.reserveReservation.create({ data: { ...reservationData, externalRef } });
          reservationsCreated += 1;
        }
      } else {
        // No confirmation id in the export — best-effort match on venue+time+guest.
        const existing = await prisma.reserveReservation.findFirst({
          where: { venue, startsAt, guestId: guest.id, source: 'sevenrooms' }
        });
        if (existing) {
          await prisma.reserveReservation.update({ where: { id: existing.id }, data: reservationData });
          reservationsUpdated += 1;
        } else {
          await prisma.reserveReservation.create({ data: reservationData });
          reservationsCreated += 1;
        }
      }
    }

    await prisma.integrationWebhookEvent.updateMany({
      where: { provider: 'SEVENROOMS', accountKey: 'inbound-email', providerEventId: messageId },
      data: {
        processedAt: new Date(),
        payload: {
          subject,
          from: fromAddress,
          csvSource: source,
          rowsParsed: rows.length,
          reservationsCreated,
          reservationsUpdated,
          guestsCreated,
          warnings: warnings.slice(0, 25)
        } as Prisma.InputJsonObject
      }
    });

    return {
      received: true,
      rowsParsed: rows.length,
      reservationsCreated,
      reservationsUpdated,
      guestsCreated,
      warnings
    };
  }
};
