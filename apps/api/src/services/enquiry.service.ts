import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { prisma } from '@alma/db';
import { Prisma } from '@prisma/client';
import { venueDayBounds, venueDayKey, venueInstant, type AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import {
  computeOpenTimes,
  venueDayStart,
  venueWeekday,
  type DayAvailability
} from '../lib/enquiry-availability.js';
import { buildEnquiryDraft, canonicalVenue, type EnquiryDraft } from '../lib/enquiry-draft.js';
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
 *  - `suggestedReplyFor` has the first reply already written when staff open
 *    the thread, so answering is an edit rather than a blank page
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
  // Noon in the VENUE's zone, so the instant stays on the intended date no
  // matter which way it is later formatted. A hardcoded +10:00 is an hour out
  // for the half of the year Sydney is on daylight saving.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? venueInstant(raw, '12:00') : new Date(raw);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/**
 * The half-open UTC window covering the venue day an instant falls in.
 *
 * Both halves of this used to be wrong. The day was stamped at a hardcoded
 * +10:00, an hour out for the half of the year Sydney is on daylight saving;
 * and the end was start + 24h, which is wrong on the two transition days —
 * they run 23 and 25 hours, so the window either overran into the next day or
 * left an hour of it uncovered.
 */
function dayBounds(date: Date) {
  const bounds = Number.isNaN(date.getTime()) ? null : venueDayBounds(venueDayKey(date));
  if (!bounds) return { start: date, end: date };
  return { start: bounds.gte, end: bounds.lt };
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

/**
 * What the venue could still take on the enquiry's date, measured.
 *
 * Reads the same three tables the booking widget reads — availability rules,
 * live reservations, blackouts — and hands them to the pure slot maths. Every
 * unknown comes back as UNKNOWN rather than as a yes: no venue, no date, no
 * party size, or a read that failed all mean "we cannot say", and the draft
 * drops a tier rather than inventing a table.
 *
 * The reservation window runs from an hour before the venue day to two hours
 * past the longest a venue day can be (25 hours, on the April changeover), so
 * a booking that starts before midnight still counts against the slots it
 * overlaps.
 */
async function availabilityFor(enquiry: {
  venue: string;
  eventDate: Date | null;
  partySize: number | null;
}): Promise<DayAvailability> {
  if (!enquiry.venue) return { kind: 'UNKNOWN', reason: 'no venue on the enquiry' };
  if (!enquiry.eventDate) return { kind: 'UNKNOWN', reason: 'no date on the enquiry' };
  if (!enquiry.partySize || enquiry.partySize < 1) {
    return { kind: 'UNKNOWN', reason: 'no party size on the enquiry' };
  }

  const dayStart = venueDayStart(enquiry.eventDate);
  const dayEnd = new Date(dayStart.getTime() + 26 * 3_600_000);
  const window = { gte: new Date(dayStart.getTime() - 3_600_000), lt: dayEnd };

  try {
    const [rules, reservations, blackouts] = await Promise.all([
      prisma.reserveAvailabilityRule.findMany({
        // onlineEnabled on purpose: a time we suggest to a guest has to be one
        // the booking engine itself would sell. Rules held back from the
        // widget were held back for a reason nobody wrote down.
        where: { venue: enquiry.venue, active: true, onlineEnabled: true },
        select: {
          id: true,
          servicePeriod: true,
          daysOfWeek: true,
          startTime: true,
          endTime: true,
          intervalMinutes: true,
          defaultDurationMinutes: true,
          minPartySize: true,
          maxPartySize: true,
          capacity: true
        }
      }),
      prisma.reserveReservation.findMany({
        where: {
          venue: enquiry.venue,
          startsAt: window,
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED'] }
        },
        select: {
          covers: true,
          startsAt: true,
          endsAt: true,
          availabilityRuleId: true,
          servicePeriod: true
        }
      }),
      prisma.reserveBlackout.findMany({
        where: { venue: enquiry.venue, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
        select: { startAt: true, endAt: true }
      })
    ]);

    return computeOpenTimes({
      dayStart,
      weekday: venueWeekday(enquiry.eventDate),
      partySize: enquiry.partySize,
      rules,
      reservations,
      blackouts
    });
  } catch (err) {
    // A failed read must never become an offer, and must not stop the thread
    // opening either.
    console.error('[enquiry] Could not measure availability for a draft', err);
    return { kind: 'UNKNOWN', reason: 'availability could not be read' };
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
    // The ONE public write on this surface — anyone on the internet reaches
    // it, so it validates like one. Lengths are capped (a 2MB "name" is a
    // probe, not a guest), the email has to look like an address (a reply
    // will be sent to it), and the venue must be one of OURS — a free-text
    // venue string became a row a manager then had to route by hand, and let
    // junk fan out into the venue filters.
    const clip = (value: string | null, max: number) => (value ? value.slice(0, max) : null);
    const rawVenue = clip(text(input.venue), 120) ?? '';
    const contactName = clip(text(input.contactName) || text(input.name), 120) ?? '';
    const email = clip(optionalText(input.email), 254);
    if (!rawVenue || !contactName || !email) {
      throw new HttpError(400, 'Venue, contact name, and email are required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'That email address does not look right — check it and try again.');
    }
    const venueRows = await prisma.venue.findMany({ select: { name: true } });
    // With no venues configured yet (a fresh install) the free text passes;
    // once venues exist, an enquiry must name one of them.
    const venue = venueRows.length > 0 ? canonicalVenue(rawVenue, venueRows.map((row) => row.name)) : rawVenue;
    if (!venue) {
      throw new HttpError(400, 'Pick one of our venues for your enquiry.');
    }

    const externalRef = clip(optionalText(input.externalRef), 190);
    const eventDate = eventDateOf(input.eventDate);
    const partySize = partySizeOf(input);
    const notes = clip(optionalText(input.notes) ?? optionalText(input.message), 4000);
    const eventType = clip(optionalText(input.eventType), 80);
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
          phone: clip(optionalText(input.phone), 40),
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
    const [clashes, suggestedReply] = await Promise.all([
      enquiryService.clashesFor(id),
      enquiryService.suggestedReplyFor(enquiry)
    ]);

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
        matchedBy: message.matchedBy,
        createdAt: message.createdAt.toISOString()
      })),
      clashes,
      suggestedReply
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
   * The reply we would write, ready for a human to edit and send.
   *
   * DRAFT ONLY. Nothing in this file sends it. Auto-send is where Tim wants to
   * get to and the shape is deliberately ready for it — a scheduler that woke
   * on NEW enquiries, called this, and handed the body to `reply` behind an
   * env flag would be the whole change — but that flag and that scheduler do
   * not exist, and a draft that can send itself is not a draft.
   *
   * Recomputed on open rather than stored. Availability goes stale in minutes:
   * a draft written at capture and read two days later would be offering times
   * that sold that afternoon, and the one promise this feature has to keep is
   * that a time in a draft is a time we have.
   *
   * Only ever the FIRST reply. Once anyone has answered, the conversation has
   * a shape no template knows about.
   */
  async suggestedReplyFor(enquiry: {
    id: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    venue: string;
    eventDate: Date | null;
    partySize: number | null;
    status: EnquiryStatus;
  }): Promise<EnquiryDraft | null> {
    if (!enquiry.email) return null;
    if (enquiry.status === 'BOOKED' || enquiry.status === 'CLOSED') return null;
    const answered = await prisma.reserveEnquiryMessage.count({
      where: { enquiryId: enquiry.id, direction: 'OUTBOUND' }
    });
    if (answered > 0) return null;

    const [availability, venues] = await Promise.all([
      availabilityFor(enquiry),
      prisma.venue.findMany({ select: { name: true } })
    ]);

    // Note what is not passed: enquiry.notes never leaves this function. The
    // draft is built from validated fields and templates, and the guest's own
    // prose has no route into it.
    return buildEnquiryDraft({
      contactName: enquiry.contactName,
      venue: enquiry.venue,
      knownVenues: venues.map((row) => row.name),
      eventDate: enquiry.eventDate,
      // Always null, and measured rather than assumed: no intake form collects
      // a preferred time, so `eventDate` is the only column there is and it
      // cannot be read as one. `eventDateOf` above stamps a date-only value at
      // noon in the venue's zone purely to hold the date steady; that noon is
      // a placeholder, not something a guest said. So the draft always asks.
      preferredTime: null,
      partySize: enquiry.partySize,
      phone: enquiry.phone,
      availability,
      now: new Date()
    });
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
    // Recorded on the message: 'message-id' is exact (the client quoted our
    // Message-ID back); 'sender-address' is best-effort AND SPOOFABLE — a
    // From header is free to forge, so the inbox shows a caution on those.
    let matchedBy: 'message-id' | 'sender-address' = 'message-id';
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
      matchedBy = 'sender-address';
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
        inReplyTo: quoted[quoted.length - 1] ?? null,
        matchedBy
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
