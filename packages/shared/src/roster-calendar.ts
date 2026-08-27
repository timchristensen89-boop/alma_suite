/**
 * The staff roster as a calendar feed.
 *
 * A published roster is only useful if it reaches the phone people actually
 * plan their week on. This builds an RFC 5545 calendar they can subscribe to
 * once and forget — amend a shift on Thursday and their phone changes with it.
 *
 * Deliberately pure: no clock, no database, no environment. Calendar bugs are
 * silent — a client that dislikes the output shows nothing at all rather than
 * complaining — so every rule here is testable directly.
 *
 * Times go out in UTC. Shift times are stored as absolute instants, and every
 * calendar client renders UTC in the viewer's own zone, so an emitted `Z`
 * timestamp is correct in Sydney across both sides of a daylight-saving
 * change. Hand-rolling a VTIMEZONE block would add a way to be wrong twice a
 * year for no gain.
 */

export type RosterCalendarShift = {
  id: string;
  startsAt: string | Date;
  endsAt: string | Date;
  venue?: string | null;
  area?: string | null;
  roleTitle?: string | null;
  notes?: string | null;
  breakMinutes?: number | null;
  /**
   * Bumped whenever the shift row changes. Becomes SEQUENCE, which is how a
   * calendar client knows an event it already holds has been amended rather
   * than duplicated.
   */
  updatedAt?: string | Date | null;
  status?: string | null;
};

export type RosterCalendarInput = {
  shifts: readonly RosterCalendarShift[];
  staffName: string;
  /** Stamped on every event so clients can order revisions. Pass the request time. */
  now: Date;
  /** Domain used to build globally-unique UIDs. */
  uidDomain?: string;
  calendarName?: string;
};

const CRLF = '\r\n';
const DEFAULT_UID_DOMAIN = 'almagroup.com.au';

/** RFC 5545 §3.3.5 — basic-format UTC, no punctuation. */
export function icsTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid calendar date: ${String(value)}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * RFC 5545 §3.3.11. Backslash, semicolon and comma are structural; newlines
 * become the literal two characters \n. A venue named "Alma, Avalon" would
 * otherwise silently split one field into two.
 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 — no line over 75 octets, continuations start with one space.
 *
 * Measured in octets, not characters: a café or a naïve em dash is multi-byte
 * in UTF-8, and folding on character count lets a long line through that some
 * clients then reject. Folds are placed so a multi-byte character is never
 * split across the boundary.
 */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  // First line allows 75 octets; continuations lose one to the leading space.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = '';
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out.join(`${CRLF} `);
}

/** A stable, globally unique id for one shift. Same shift, same UID, forever. */
export function shiftUid(shiftId: string, domain = DEFAULT_UID_DOMAIN): string {
  return `shift-${shiftId}@${domain}`;
}

/**
 * What the event is called in their calendar.
 *
 * Read at a glance on a lock screen, so the useful words come first: the role
 * they are doing and where. "Bar · St Alma" beats "St Alma shift".
 */
export function shiftSummary(shift: RosterCalendarShift): string {
  const role = shift.roleTitle?.trim();
  const venue = shift.venue?.trim();
  const area = shift.area?.trim();
  const lead = role || area || 'Shift';
  return venue ? `${lead} · ${venue}` : lead;
}

/** The body of the event: area, break and any note the manager left. */
export function shiftDescription(shift: RosterCalendarShift): string {
  const parts: string[] = [];
  if (shift.area?.trim()) parts.push(`Area: ${shift.area.trim()}`);
  if (shift.roleTitle?.trim()) parts.push(`Role: ${shift.roleTitle.trim()}`);
  if (shift.breakMinutes && shift.breakMinutes > 0) parts.push(`Break: ${shift.breakMinutes} min`);
  if (shift.notes?.trim()) parts.push(shift.notes.trim());
  return parts.join('\n');
}

/**
 * SEQUENCE has to be a non-negative integer that only ever climbs, and it is
 * how an amended shift replaces the one already on the phone instead of
 * appearing beside it. Seconds since the epoch from updatedAt gives that for
 * free, and stays inside the 32-bit range clients assume until 2038.
 */
export function shiftSequence(shift: RosterCalendarShift): number {
  if (!shift.updatedAt) return 0;
  const date = shift.updatedAt instanceof Date ? shift.updatedAt : new Date(shift.updatedAt);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor(date.getTime() / 1000));
}

/**
 * Build the whole calendar.
 *
 * A cancelled shift is emitted as STATUS:CANCELLED rather than dropped. Simply
 * removing it leaves the event sitting on a phone forever — a subscription
 * only learns about a deletion if it is told, and somebody turning up to a
 * shift that was called off is exactly the failure this feature exists to
 * prevent.
 */
export function buildRosterCalendar(input: RosterCalendarInput): string {
  const domain = input.uidDomain || DEFAULT_UID_DOMAIN;
  const stamp = icsTimestamp(input.now);
  const name = input.calendarName || `${input.staffName} · ALMA shifts`;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//ALMA Group//Roster//EN`,
    'CALSCALE:GREGORIAN',
    // Not a to-and-fro invitation: nobody replies to a roster.
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    'X-WR-TIMEZONE:Australia/Sydney',
    // How often a client should come back. Advisory, and clients treat it as
    // a floor rather than a promise, but without it some poll once a day.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];

  for (const shift of input.shifts) {
    const cancelled = (shift.status || '').toUpperCase() === 'CANCELLED';
    const description = shiftDescription(shift);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${shiftUid(shift.id, domain)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTimestamp(shift.startsAt)}`,
      `DTEND:${icsTimestamp(shift.endsAt)}`,
      `SEQUENCE:${shiftSequence(shift)}`,
      `SUMMARY:${escapeIcsText(cancelled ? `CANCELLED — ${shiftSummary(shift)}` : shiftSummary(shift))}`
    );
    if (shift.venue?.trim()) lines.push(`LOCATION:${escapeIcsText(shift.venue.trim())}`);
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push(`STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`);
    // A roster is not a meeting request; showing free/busy is the useful part.
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/**
 * webcal:// asks the phone to *subscribe* rather than import a snapshot, which
 * is the whole point — the roster changes and their calendar follows. iOS and
 * macOS hand it straight to Calendar; Android and Google want the https URL.
 */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//i, 'webcal://');
}

/* ------------------------------------------------------------------ */
/* How a shift reads to the person working it                          */
/* ------------------------------------------------------------------ */

/** Both venues are in Sydney; the roster is only ever read in venue time. */
export const ROSTER_TIMEZONE = 'Australia/Sydney';

export type RosterShiftLine = {
  day: string;
  hours: string;
  where: string;
  area: string | null;
};

/**
 * Turn one shift into the line a staff member reads in the email.
 *
 * Rendered in venue time, explicitly, every time. The instants are absolute and
 * the server runs in UTC, so anything that leans on the host's locale or zone
 * shows a Sydney evening shift as the wrong day for half the year — and a
 * roster that is off by a day is worse than no roster.
 */
export function rosterShiftLine(shift: {
  startsAt: string | Date;
  endsAt: string | Date;
  venue?: string | null;
  area?: string | null;
  roleTitle?: string | null;
}): RosterShiftLine {
  const day = new Intl.DateTimeFormat('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: ROSTER_TIMEZONE
  }).format(new Date(shift.startsAt));

  const at = (value: string | Date) =>
    new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: ROSTER_TIMEZONE
    })
      .format(new Date(value))
      // "5:00 pm" → "5:00pm". Narrow no-break space included, which is what
      // Intl actually emits and what a plain \s in a regex would miss.
      .replace(/[\s  ]/g, '')
      .toLowerCase();

  const where = [shift.roleTitle?.trim(), shift.venue?.trim()].filter(Boolean).join(' · ');

  return {
    day,
    hours: `${at(shift.startsAt)} – ${at(shift.endsAt)}`,
    where: where || 'Shift',
    area: shift.area?.trim() || null
  };
}

export type RosterPushNotification = {
  title: string;
  body: string;
};

/**
 * The one or two lines a phone shows on the lock screen when a roster drops.
 *
 * A lock screen gives you roughly a title and two lines before it truncates,
 * and the person reading it is usually mid-something-else. So the body leads
 * with the count and then spells out the first shift in full — that is the one
 * they actually need to plan around, and if the notification is all they ever
 * read, knowing when they are next on is the useful half.
 *
 * Shifts are sorted here rather than trusted in order: they arrive grouped by
 * person out of a database query, and "your next shift" being whichever row
 * came back first would be wrong about half the time.
 */
export function rosterPushNotification(
  shifts: ReadonlyArray<{
    startsAt: string | Date;
    endsAt: string | Date;
    venue?: string | null;
    area?: string | null;
    roleTitle?: string | null;
  }>
): RosterPushNotification {
  if (shifts.length === 0) {
    // Not expected — nothing calls this with an empty roster — but a push that
    // says nothing is worse than one that says the honest thing.
    return { title: 'Your roster is up', body: 'Open ALMA Staff to see it.' };
  }

  const sorted = [...shifts].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
  const first = rosterShiftLine(sorted[0]!);
  const firstLine = `${first.day}, ${first.hours} · ${first.where}`;

  if (sorted.length === 1) {
    return { title: 'Your roster is up', body: firstLine };
  }

  return {
    title: `Your roster is up — ${sorted.length} shifts`,
    body: `First up: ${firstLine}`
  };
}
