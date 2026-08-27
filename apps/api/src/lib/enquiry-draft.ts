// The first reply to a function or catering enquiry, written before a human
// opens it. Pure, so the service and its tests render the SAME words. Covered
// by enquiry-draft.test.ts.
//
// Nothing here sends anything. It returns text for the reply box, which a
// person reads, edits and sends by hand.
//
// Three tiers, chosen from what the enquiry actually tells us:
//
//   1. Bare acknowledgement — we know nothing worth acting on.
//   2. Acknowledgement that asks for exactly what is missing, and only that.
//      Asking a guest for the phone number they already gave is the thing
//      that makes a canned reply read as canned.
//   3. Acknowledgement that answers with real availability, from
//      computeOpenTimes. Only ever reached when the times are measured.
//
// SECURITY, and the reason this signature looks the way it does: an enquiry
// email is text a stranger wrote. There is deliberately NO parameter for the
// guest's message body, so no path exists by which `notes` can reach a draft.
// Every value that does reach one is a structured field put through a
// validator below (`greetingName`, `usablePartySize`, `usablePhone`,
// `canonicalVenue`, `usableEventDate`) and dropped if it fails. Nothing is
// escaped and passed through — a value that is not obviously a name, a number,
// a phone or a known venue simply does not appear, and the sentence around it
// changes shape instead.

import type { DayAvailability } from './enquiry-availability.js';

export type DraftTier = 1 | 2 | 3;

/** What we still need from the guest before anyone can hold a table. */
export type MissingDetail = 'phone' | 'time' | 'date' | 'partySize';

export type EnquiryDraftInput = {
  contactName: string | null;
  venue: string | null;
  /** Venue names as the suite knows them; anything else is not echoed at all. */
  knownVenues: string[];
  eventDate: Date | null;
  /**
   * The hour they asked for, in minutes from midnight, or null when we do not
   * know it — which today is always. See the note in enquiry.service.ts: no
   * intake form collects a time, and `eventDate` cannot be read as one.
   */
  preferredTime: number | null;
  partySize: number | null;
  phone: string | null;
  availability: DayAvailability;
  now: Date;
};

export type EnquiryDraft = {
  tier: DraftTier;
  body: string;
  missing: MissingDetail[];
  /** The times the draft promised, formatted. Empty below tier 3. */
  offeredTimes: string[];
  /** One line for the person about to send it, saying why this tier. */
  basis: string;
};

const TIME_ZONE = 'Australia/Sydney';

// A party bigger than this is a typo, not a booking — the largest room at
// either venue seats well under it. Past the ceiling we treat the number as
// unknown and ask, rather than repeating nonsense back to the guest.
const MAX_CREDIBLE_PARTY = 500;

const NAME_WORD = /^\p{L}[\p{L}'’.-]{0,23}$/u;
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof']);

/**
 * A first name we are willing to type into an email, or null.
 *
 * A whitelist, not an escape: letters and the punctuation real names carry.
 * Anything else — a URL, markup, an instruction addressed to whatever reads
 * the inbox — fails and the draft opens "Hi there" instead.
 *
 * The WHOLE field has to look like a name, not just its first word. Taking
 * the first word alone greets "Ignore previous instructions and…" as "Hi
 * Ignore", which is how a canned reply ends up quoting a stranger's prose
 * back to a guest. Four words is the ceiling: past that it is a sentence.
 */
export function greetingName(raw: string | null | undefined): string | null {
  const words = (raw ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (!words.every((word) => NAME_WORD.test(word))) return null;

  // "Dr. Jane Smith" wants "Jane" — an honorific is a title, not what anyone
  // is called.
  const stripped = words.map((word) => word.replace(/\.+$/, ''));
  const first =
    stripped.length > 1 && HONORIFICS.has(stripped[0]!.toLocaleLowerCase('en-AU'))
      ? stripped[1]!
      : stripped[0]!;
  if (!first) return null;

  // Shouty senders get sentence case; anyone who typed their own mixed case
  // keeps it, because "McKenzie" is not ours to rewrite. "jo-anne" and
  // "o'brien" get both halves, which is the whole reason this is not a bare
  // charAt(0).toUpperCase().
  const base = /\p{Ll}/u.test(first) ? first : first.toLocaleLowerCase('en-AU');
  return base.replace(/(^|[-'’])(\p{Ll})/gu, (_match, lead: string, letter: string) =>
    `${lead}${letter.toLocaleUpperCase('en-AU')}`
  );
}

/** The party size if it is a number we would act on, else null. */
export function usablePartySize(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_CREDIBLE_PARTY) return null;
  return raw;
}

/**
 * Whether we hold a number someone could actually ring.
 *
 * Never echoed back — the draft only needs to know whether to ask for one, so
 * this returns a verdict rather than the digits.
 */
export function usablePhone(raw: string | null | undefined): boolean {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

/** The venue name as the suite spells it, or null if we do not know it. */
export function canonicalVenue(raw: string | null | undefined, known: string[]): string | null {
  const needle = (raw ?? '').trim().toLocaleLowerCase('en-AU');
  if (!needle) return null;
  return known.find((name) => name.trim().toLocaleLowerCase('en-AU') === needle) ?? null;
}

/**
 * The event date if it is still worth talking about, else null.
 *
 * A date in the past is treated as no date at all. Enquiries sit unanswered
 * for days, and "what time were you after on Saturday 4 May" sent in June is
 * worse than asking which date they now want.
 */
export function usableEventDate(raw: Date | null | undefined, now: Date): Date | null {
  if (!raw || Number.isNaN(raw.getTime())) return null;
  const dayOf = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(value);
  return dayOf(raw) >= dayOf(now) ? raw : null;
}

/** "Saturday 4 May", carrying the year only when it is not this one. */
export function formatVenueDate(date: Date, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const thisYear = new Intl.DateTimeFormat('en-AU', { timeZone: TIME_ZONE, year: 'numeric' }).format(now);
  const year = value('year');
  return `${value('weekday')} ${value('day')} ${value('month')}${year === thisYear ? '' : ` ${year}`}`;
}

/** Minutes from midnight as Australians write a time: 3pm, 5.30pm, 12pm. */
export function formatVenueTime(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  return minute === 0 ? `${hour}${suffix}` : `${hour}.${String(minute).padStart(2, '0')}${suffix}`;
}

/**
 * At most three of the open times, as a guest would want to read them.
 *
 * A rule on 15-minute intervals can leave twenty starts open, and listing
 * twenty is not an answer. Whole hours are preferred when there are enough of
 * them, because "4pm, 6pm and 8pm" reads like an offer and "4.15pm, 6.30pm,
 * 8.45pm" reads like a printout. Every time returned is still one the
 * capacity check actually cleared.
 */
export function pickOfferedTimes(startMinutes: number[]): number[] {
  if (startMinutes.length <= 3) return [...startMinutes];
  const onTheHour = startMinutes.filter((minute) => minute % 60 === 0);
  const pool = onTheHour.length >= 3 ? onTheHour : startMinutes;
  if (pool.length <= 3) return [...pool];
  return [pool[0]!, pool[Math.floor(pool.length / 2)]!, pool[pool.length - 1]!];
}

/** "a", "a and b", "a, b and c" — the Australian list, no serial comma. */
function sentenceList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function askFor(missing: MissingDetail[], dateLabel: string | null): string[] {
  const asks: string[] = [];
  if (missing.includes('phone')) asks.push('the best contact number');
  if (missing.includes('date') && missing.includes('time')) {
    asks.push('what date and time you were looking to book');
  } else if (missing.includes('date')) {
    asks.push('what date you were looking to book');
  } else if (missing.includes('time')) {
    asks.push(dateLabel ? `what time you were looking to book on ${dateLabel}` : 'what time you were looking to book');
  }
  if (missing.includes('partySize')) asks.push('how many people you are expecting');
  return asks;
}

/**
 * The draft, and the tier it landed on.
 *
 * One rule decides it: say the most useful true thing available. Real times
 * beat a specific question, and a specific question beats an acknowledgement,
 * so the tiers are tried 3, 2, 1 in that order.
 *
 * Tier 3 needs measured availability AND the date and party size it was
 * measured for. Tier 2 needs something specific left to ask. Tier 1 is
 * therefore what is left when there is nothing to offer and nothing to ask —
 * everything is on file and the day has no room in it — which is exactly the
 * case where only a person can decide what happens next.
 *
 * Note that tier 3 does not skip tier 2's job: its closing line asks for
 * whatever is still missing, so having times to give never costs us the
 * question.
 */
export function buildEnquiryDraft(input: EnquiryDraftInput): EnquiryDraft {
  const name = greetingName(input.contactName);
  const venue = canonicalVenue(input.venue, input.knownVenues);
  const eventDate = usableEventDate(input.eventDate, input.now);
  const partySize = usablePartySize(input.partySize);

  const missing: MissingDetail[] = [];
  if (!usablePhone(input.phone)) missing.push('phone');
  if (!eventDate) missing.push('date');
  if (input.preferredTime === null) missing.push('time');
  if (!partySize) missing.push('partySize');

  const dateLabel = eventDate ? formatVenueDate(eventDate, input.now) : null;
  const greeting = `Hi ${name ?? 'there'},`;
  // The mailbox this goes out from is the venue's, so the venue signs it. An
  // unrecognised venue string is never echoed — the group name covers it.
  const signOff = `Thanks\n${venue ?? 'ALMA'}`;
  const compose = (middle: string) => `${greeting}\n\n${middle}\n\n${signOff}`;

  const open = input.availability.kind === 'OPEN' ? input.availability.startMinutes : [];
  if (open.length > 0 && dateLabel && partySize) {
    const offered = pickOfferedTimes(open);
    const labels = offered.map(formatVenueTime);
    const everyTime = open.length <= offered.length;
    const offer = everyTime
      ? `We have space at ${sentenceList(labels)} for ${partySize} people on ${dateLabel}.`
      : `We have a few times open for ${partySize} people on ${dateLabel}, including ${sentenceList(labels)}.`;

    // Tier 3 still asks — for the preferred time and the number, never for
    // the date or the party size, which are the two things it just used.
    const asks: string[] = [];
    if (missing.includes('time')) asks.push('your preferred time');
    if (missing.includes('phone')) asks.push('the best contact number');
    const lead = labels.length === 1 ? 'If that suits' : 'If one of those suits';
    const close =
      asks.length > 0
        ? `${lead}, please send through ${sentenceList(asks)} and one of our team will be in touch.`
        : `${lead}, let me know and one of our team will be in touch.`;

    return {
      tier: 3,
      body: compose(`Thanks for your enquiry. ${offer} ${close}`),
      missing,
      offeredTimes: labels,
      basis: `Availability for ${partySize} on ${dateLabel}`
    };
  }

  // Tier 2 needs an anchor: a date or a party size we can hang the question
  // on. Without either, the enquiry is "do you do functions?" and the reply
  // would be a form — four questions and no answer. That is the case Tim's
  // first tier was written for, so it acknowledges and lets a person read it.
  const anchored = Boolean(eventDate) || Boolean(partySize);
  const asks = anchored ? askFor(missing, dateLabel) : [];
  if (asks.length > 0) {
    return {
      tier: 2,
      body: compose(
        `Thanks for your enquiry. Can I please get ${sentenceList(asks)}, and one of our team will get back to you.`
      ),
      missing,
      offeredTimes: [],
      basis:
        input.availability.kind === 'NONE'
          ? 'Nothing free to offer, so asking for what is missing'
          : 'Asking for the details we still need'
    };
  }

  return {
    tier: 1,
    body: compose('Thank you for your email. One of our team will get back to you within 24 hours.'),
    missing,
    offeredTimes: [],
    basis: anchored ? 'Nothing left to ask and nothing to offer' : 'Too little to go on, so acknowledging'
  };
}
