import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from '@alma/db';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { mailService } from './mail.service.js';

/**
 * Function and catering enquiries: capture, conversation, reply.
 *
 * Before this, an enquiry was an email to the venue and nothing else. Staff
 * answered from a mail client, so there was no record of what had been
 * promised, no status, and nothing to warn that two groups had been offered
 * the same Saturday. Everything here exists to close that gap:
 *
 *  - `capture` persists the enquiry and keeps the notification email
 *  - `reply` sends from the enquiries mailbox with proper threading headers,
 *    so the guest's answer comes back to an address we actually read
 *  - `recordInboundReply` matches that answer to its enquiry and appends it
 *  - `clashesFor` answers "what else is on this date at this venue"
 */

// Where staff replies come from, and where guest answers must land. Both
// default to the enquiries mailbox the inbound poller watches — a reply that
// goes out from a no-reply address strands the conversation.
const enquiryFrom = process.env.ENQUIRY_MAIL_FROM ?? 'ALMA <enquiries@almagroup.com.au>';
const enquiryReplyTo = process.env.ENQUIRY_MAIL_REPLY_TO ?? 'enquiries@almagroup.com.au';

const ENQUIRY_STATUSES = ['NEW', 'REPLIED', 'GUEST_REPLIED', 'BOOKED', 'CLOSED'] as const;
type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed === '' ? null : trimmed;
}

/**
 * The party size, however the sender spelled it — the booking widget posts
 * `partySize`, the website's catering form posts `guestCount`, and either can
 * arrive as a string from a form field.
 */
function partySizeOf(data: Record<string, unknown>): number | null {
  const raw = data.partySize ?? data.guestCount;
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

/** A date-only value (`2026-09-05`) read as that day, not as UTC midnight. */
function eventDateOf(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00+10:00`) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dayBounds(date: Date) {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(date);
  const start = new Date(`${key}T00:00:00+10:00`);
  return { start, end: new Date(start.getTime() + 24 * 3_600_000) };
}

function formatEventDate(date: Date | null) {
  if (!date) return 'No date given';
  return new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Australia/Sydney'
  }).format(date);
}

/**
 * Message-IDs quoted out of a `References`/`In-Reply-To` header, newest last.
 * Mail clients pass these through untouched, which is what lets an inbound
 * reply find the message it answered.
 */
function messageIdsFrom(value: unknown): string[] {
  const raw = text(value);
  if (!raw) return [];
  const matches = raw.match(/<[^>\s]+>/g);
  if (matches) return matches;
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Strip the quoted history off an inbound reply, so the thread shows what the
 * person actually wrote rather than a growing copy of the whole conversation.
 * Deliberately conservative: if nothing matches, the body is kept intact.
 */
export function stripQuotedReply(body: string): string {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const cutAt = lines.findIndex((line) =>
    /^\s*(On .+ wrote:|-{2,}\s*Original Message|_{5,}|From:\s)/i.test(line)
  );
  const kept = (cutAt === -1 ? lines : lines.slice(0, cutAt))
    .filter((line) => !/^\s*>/.test(line))
    .join('\n')
    .trim();
  return kept || body.trim();
}

function safeTokenEqual(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Shared shape for the token-guarded inbound endpoints. */
function assertInboundToken(req: Request, envVar: 'ENQUIRY_FORWARD_TOKEN' | 'ENQUIRY_INBOUND_TOKEN') {
  const expected = process.env[envVar];
  if (!expected) throw new HttpError(503, 'Enquiry intake is not configured.');
  const provided =
    (typeof req.query.token === 'string' ? req.query.token : null) ??
    (req.header('authorization')?.replace(/^Bearer\s+/i, '') || null);
  if (!safeTokenEqual(provided, expected)) throw new HttpError(401, 'Invalid enquiry token.');
}

function parseRawJson(req: Request): Record<string, unknown> {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body ?? {});
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Payload is not valid JSON.');
  }
}

type EnquiryInput = Record<string, unknown>;

export const enquiryService = {
  /**
   * Record an enquiry and tell the venue about it.
   *
   * Persisting comes first and the email is best-effort: a mail outage used to
   * lose the enquiry outright, and that is the failure this whole feature
   * exists to stop.
   */
  async capture(input: EnquiryInput, options: { source?: string; enquiryType?: string } = {}) {
    const venue = text(input.venue);
    const contactName = text(input.contactName) || text(input.name);
    const email = optionalText(input.email);
    if (!venue || !contactName || !email) {
      throw new HttpError(400, 'Venue, contact name, and email are required');
    }

    const externalRef = optionalText(input.externalRef);
    const eventDate = eventDateOf(input.eventDate);
    const partySize = partySizeOf(input);
    const notes = optionalText(input.notes) ?? optionalText(input.message);
    const eventType = optionalText(input.eventType);
    const source = text(options.source) || text(input.source) || 'public-widget';
    const enquiryType = text(options.enquiryType) || text(input.enquiryType) || 'function';
    const subject = `${venue} enquiry — ${contactName}`;

    // A retried forward carries the same externalRef; return the row it
    // already made rather than a second copy of the same enquiry.
    if (externalRef) {
      const existing = await prisma.reserveEnquiry.findUnique({ where: { externalRef } });
      if (existing) return { enquiry: existing, duplicate: true };
    }

    let enquiry;
    try {
      enquiry = await prisma.reserveEnquiry.create({
        data: {
          source,
          enquiryType,
          externalRef,
          contactName,
          email,
          phone: optionalText(input.phone),
          venue,
          eventType,
          eventDate,
          partySize,
          notes,
          emailSubject: subject,
          messages: {
            create: {
              direction: 'INBOUND',
              body: notes ?? '(no message)',
              authorName: contactName,
              messageId: optionalText(input.messageId)
            }
          }
        }
      });
    } catch (err) {
      // Two forwards racing on the same externalRef: the loser reads the row
      // the winner just wrote.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && externalRef) {
        const existing = await prisma.reserveEnquiry.findUnique({ where: { externalRef } });
        if (existing) return { enquiry: existing, duplicate: true };
      }
      throw err;
    }

    if (mailService.isConfigured()) {
      try {
        const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
        const recipient = settings?.notifyEmail?.trim();
        if (recipient) {
          const clashes = await enquiryService.clashesFor(enquiry.id);
          await mailService.sendAlert({
            to: recipient,
            subject: `[Enquiry] ${venue} — ${eventType || 'enquiry'} for ${partySize ?? '?'} guests`,
            title: `New enquiry: ${eventType || 'event'} at ${venue}`,
            body: [
              `${contactName} (${email}${enquiry.phone ? ` · ${enquiry.phone}` : ''}) is asking about ${venue}.`,
              '',
              `Preferred date: ${formatEventDate(eventDate)}`,
              `Party size: ${partySize ?? 'not specified'}`,
              eventType ? `Event type: ${eventType}` : '',
              '',
              notes ? `Message:\n${notes}` : 'No additional notes.',
              clashes.length > 0
                ? `\nHeads up: ${clashes.length} other enquiry${clashes.length === 1 ? '' : 's'} already on this date at ${venue}.`
                : ''
            ]
              .filter(Boolean)
              .join('\n'),
            venue,
            severity: clashes.length > 0 ? 'warning' : 'info',
            ctaUrl: `${process.env.RESERVE_WEB_URL ?? 'https://alma-reserve.web.app'}/#enquiries`,
            ctaLabel: 'Open the enquiry'
          });
        }
      } catch (err) {
        console.error('[enquiry] Failed to send enquiry notification', err);
      }
    }

    return { enquiry, duplicate: false };
  },

  /**
   * An enquiry forwarded by the website's own form handler.
   *
   * The website keeps its record and sends its own email; this is the copy the
   * suite works from, so the two stay independent — a suite outage doesn't
   * lose a lead, and a website retry doesn't create a second one.
   */
  async handleWebsiteForward(req: Request) {
    assertInboundToken(req, 'ENQUIRY_FORWARD_TOKEN');
    const payload = parseRawJson(req);
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const { enquiry, duplicate } = await enquiryService.capture(data, {
      source: text(data.source) || 'website',
      enquiryType: text(data.enquiryType) || 'catering'
    });
    return { received: true, duplicate, enquiryId: enquiry.id };
  },

  /**
   * A guest's emailed reply, forwarded by the mailbox poller in the same
   * JSON shape as the other inbound feeds.
   */
  async handleInboundEmail(req: Request) {
    assertInboundToken(req, 'ENQUIRY_INBOUND_TOKEN');
    const payload = parseRawJson(req);
    const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
    const result = await enquiryService.recordInboundReply(data);
    return { received: true, ...result };
  },

  async list(input: { status?: string; venue?: string; query?: string }) {
    const status = text(input.status).toUpperCase();
    const venue = text(input.venue);
    const query = text(input.query);
    const where: Prisma.ReserveEnquiryWhereInput = {
      ...(ENQUIRY_STATUSES.includes(status as EnquiryStatus) ? { status: status as EnquiryStatus } : {}),
      ...(venue ? { venue } : {}),
      ...(query
        ? {
            OR: [
              { contactName: { contains: query, mode: 'insensitive' as const } },
              { email: { contains: query, mode: 'insensitive' as const } },
              { notes: { contains: query, mode: 'insensitive' as const } }
            ]
          }
        : {})
    };

    const [rows, counts] = await Promise.all([
      prisma.reserveEnquiry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: 200,
        include: { _count: { select: { messages: true } } }
      }),
      prisma.reserveEnquiry.groupBy({ by: ['status'], _count: { _all: true } })
    ]);

    return {
      enquiries: rows.map((row) => ({
        id: row.id,
        source: row.source,
        enquiryType: row.enquiryType,
        contactName: row.contactName,
        email: row.email,
        phone: row.phone,
        venue: row.venue,
        eventType: row.eventType,
        eventDate: row.eventDate?.toISOString() ?? null,
        partySize: row.partySize,
        notes: row.notes,
        status: row.status,
        messageCount: row._count.messages,
        lastGuestReplyAt: row.lastGuestReplyAt?.toISOString() ?? null,
        lastStaffReplyAt: row.lastStaffReplyAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString()
      })),
      counts: Object.fromEntries(counts.map((row) => [row.status, row._count._all])) as Record<string, number>,
      venues: [...new Set(rows.map((row) => row.venue))].sort()
    };
  },

  async get(id: string) {
    const enquiry = await prisma.reserveEnquiry.findUnique({
      where: { id },
      include: { messages: { orderBy: [{ createdAt: 'asc' }] } }
    });
    if (!enquiry) throw new HttpError(404, 'Enquiry not found.');
    const clashes = await enquiryService.clashesFor(id);

    return {
      id: enquiry.id,
      source: enquiry.source,
      enquiryType: enquiry.enquiryType,
      contactName: enquiry.contactName,
      email: enquiry.email,
      phone: enquiry.phone,
      venue: enquiry.venue,
      eventType: enquiry.eventType,
      eventDate: enquiry.eventDate?.toISOString() ?? null,
      eventDateLabel: formatEventDate(enquiry.eventDate),
      partySize: enquiry.partySize,
      notes: enquiry.notes,
      status: enquiry.status,
      emailSubject: enquiry.emailSubject,
      createdAt: enquiry.createdAt.toISOString(),
      messages: enquiry.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        authorName: message.authorName,
        deliveryStatus: message.deliveryStatus,
        deliveryError: message.deliveryError,
        createdAt: message.createdAt.toISOString()
      })),
      clashes
    };
  },

  /**
   * Other enquiries wanting the same venue on the same day.
   *
   * This is the whole reason the eventDate column is indexed: an 18-person
   * birthday and a 25-person lunch can both be said yes to by different
   * people on different days, and nothing would notice until both turned up.
   */
  async clashesFor(id: string) {
    const enquiry = await prisma.reserveEnquiry.findUnique({
      where: { id },
      select: { id: true, venue: true, eventDate: true }
    });
    if (!enquiry?.eventDate) return [];
    const { start, end } = dayBounds(enquiry.eventDate);

    const rows = await prisma.reserveEnquiry.findMany({
      where: {
        id: { not: enquiry.id },
        venue: enquiry.venue,
        eventDate: { gte: start, lt: end },
        status: { notIn: ['CLOSED'] }
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true, contactName: true, partySize: true, status: true, eventType: true }
    });

    return rows.map((row) => ({
      id: row.id,
      contactName: row.contactName,
      partySize: row.partySize,
      status: row.status,
      eventType: row.eventType
    }));
  },

  /**
   * Send a staff reply to the guest and keep it on the thread.
   *
   * The message is stored whatever the provider does — a failed send that
   * left no trace would be worse than the mail client this replaces.
   */
  async reply(id: string, input: unknown, actor: AuthUser) {
    const body = text((input as Record<string, unknown> | null)?.body);
    if (!body) throw new HttpError(400, 'Write a reply first.');

    const enquiry = await prisma.reserveEnquiry.findUnique({
      where: { id },
      include: { messages: { orderBy: [{ createdAt: 'asc' }] } }
    });
    if (!enquiry) throw new HttpError(404, 'Enquiry not found.');
    if (!enquiry.email) throw new HttpError(400, 'This enquiry has no email address to reply to.');
    if (!mailService.isConfigured()) {
      throw new HttpError(503, 'Email is not configured, so replies cannot be sent yet.');
    }

    // Thread against everything the guest has sent, newest last — that is what
    // mail clients use to nest the reply under the original.
    const references = enquiry.messages
      .filter((message) => message.messageId)
      .map((message) => message.messageId as string);
    const lastInbound = [...enquiry.messages].reverse().find((message) => message.direction === 'INBOUND');
    const authorName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || 'ALMA';
    const subject = enquiry.emailSubject ?? `${enquiry.venue} enquiry — ${enquiry.contactName}`;

    const delivery = await mailService.sendEnquiryReply({
      to: enquiry.email,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      body,
      from: enquiryFrom,
      replyTo: enquiryReplyTo,
      inReplyTo: lastInbound?.messageId ?? null,
      references
    });

    const message = await prisma.reserveEnquiryMessage.create({
      data: {
        enquiryId: enquiry.id,
        direction: 'OUTBOUND',
        body,
        authorName,
        authorStaffId: actor.id,
        messageId: delivery.status === 'sent' ? (delivery.providerMessageId ?? null) : null,
        inReplyTo: lastInbound?.messageId ?? null,
        deliveryStatus: delivery.status,
        deliveryError: delivery.status === 'sent' ? null : delivery.reason
      }
    });

    if (delivery.status === 'sent') {
      await prisma.reserveEnquiry.update({
        where: { id: enquiry.id },
        data: {
          lastStaffReplyAt: new Date(),
          // Answering clears it off the needs-a-human list. BOOKED and CLOSED
          // were chosen by a person, so they stay.
          ...(enquiry.status === 'NEW' || enquiry.status === 'GUEST_REPLIED'
            ? { status: 'REPLIED' as const }
            : {})
        }
      });
    }

    return { delivery, messageId: message.id };
  },

  async setStatus(id: string, input: unknown) {
    const requested = text((input as Record<string, unknown> | null)?.status).toUpperCase();
    if (!ENQUIRY_STATUSES.includes(requested as EnquiryStatus)) {
      throw new HttpError(400, 'Unknown enquiry status.');
    }
    const status = requested as EnquiryStatus;
    const enquiry = await prisma.reserveEnquiry.update({
      where: { id },
      data: { status, closedAt: status === 'CLOSED' ? new Date() : null }
    });
    return { id: enquiry.id, status: enquiry.status };
  },

  /**
   * A guest's emailed reply, handed over by the inbound poller.
   *
   * Matched first by the Message-IDs the client quoted back (exact), then by
   * sender address against their most recent open enquiry (best effort). An
   * unmatched email is reported rather than silently dropped.
   */
  async recordInboundReply(payload: Record<string, unknown>) {
    const from = text(payload.from);
    const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
    const bodyRaw = text(payload.text) || text(payload.body);
    if (!email || !bodyRaw) return { matched: false, reason: 'No sender or body' };

    const headers = (payload.headers ?? {}) as Record<string, unknown>;
    const messageId = text(payload.message_id) || text(headers['message-id']) || null;
    const quoted = [...messageIdsFrom(headers['in-reply-to']), ...messageIdsFrom(headers.references)];

    let enquiryId: string | null = null;
    if (quoted.length > 0) {
      const prior = await prisma.reserveEnquiryMessage.findFirst({
        where: { messageId: { in: quoted } },
        orderBy: [{ createdAt: 'desc' }],
        select: { enquiryId: true }
      });
      enquiryId = prior?.enquiryId ?? null;
    }
    if (!enquiryId) {
      const open = await prisma.reserveEnquiry.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, status: { notIn: ['CLOSED'] } },
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true }
      });
      enquiryId = open?.id ?? null;
    }
    if (!enquiryId) return { matched: false, reason: `No open enquiry for ${email}` };

    // The same email delivered twice must not double-post to the thread.
    if (messageId) {
      const seen = await prisma.reserveEnquiryMessage.findUnique({ where: { messageId } });
      if (seen) return { matched: true, duplicate: true, enquiryId };
    }

    await prisma.reserveEnquiryMessage.create({
      data: {
        enquiryId,
        direction: 'INBOUND',
        body: stripQuotedReply(bodyRaw),
        authorName: from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || email,
        messageId,
        inReplyTo: quoted[quoted.length - 1] ?? null
      }
    });
    // The guest is now waiting on us, so it goes back on the needs-a-human
    // list — unless someone has already marked it booked or closed.
    const current = await prisma.reserveEnquiry.findUnique({
      where: { id: enquiryId },
      select: { status: true }
    });
    await prisma.reserveEnquiry.update({
      where: { id: enquiryId },
      data: {
        lastGuestReplyAt: new Date(),
        ...(current?.status === 'BOOKED' || current?.status === 'CLOSED'
          ? {}
          : { status: 'GUEST_REPLIED' as const })
      }
    });

    return { matched: true, duplicate: false, enquiryId };
  }
};
