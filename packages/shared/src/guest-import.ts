/**
 * Importing a guest list out of a booking system.
 *
 * The venue's real customer database has always lived in SevenRooms, not here:
 * 33,000 client records against 2,370 in this system. With OpenTable next, the
 * list has to be got out and kept somewhere that survives the switch — which
 * means an importer that understands an export shaped by somebody else.
 *
 * All of this is parsing and arithmetic, so it lives here and is tested
 * without a database. Consent especially: sending marketing to somebody who
 * did not agree is not a bug you fix in the next release.
 */

/** One person, after a row has been read and normalised. */
export type ImportedGuest = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  visits: number;
  noShows: number;
  cancels: number;
  spendCents: number;
  lastVisitAt: Date | null;
  birthday: Date | null;
  tags: string[];
  /** Venue name → whether they agreed to marketing from that venue. */
  consent: Record<string, boolean>;
  venue: string | null;
};

/** Lower-cased and trimmed, or null. Never an empty string masquerading as one. */
export function normaliseEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase();
  // Deliberately loose: this is a dedupe key, not a validity check. Rejecting
  // odd-but-real addresses would silently drop guests.
  return email.includes('@') ? email : null;
}

/**
 * An Australian mobile or landline reduced to a comparable form.
 *
 * The same person appears as +61412345678, 0412 345 678 and 412345678. Keeping
 * the last nine digits makes those one key without needing to know which
 * format a given export chose.
 */
export function normalisePhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-9);
}

/** A count from a column that may be blank, quoted, or comma-grouped. */
export function parseCount(value: string | null | undefined): number {
  const cleaned = (value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/** Money to whole cents. Handles "$1,234.50", "1234.5", "" and rubbish. */
export function parseMoneyCents(value: string | null | undefined): number {
  const cleaned = (value ?? '').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

/**
 * A date from an export, or null.
 *
 * Accepts "2026-03-28" and "2023-09-13 06:18:32.728474". Anything else is null
 * rather than an Invalid Date, which would poison every comparison downstream.
 */
export function parseExportDate(value: string | null | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const iso = text.includes(' ') ? text.replace(' ', 'T') : text;
  const parsed = new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Tags from a comma-separated "Category:Value" column.
 *
 * The export repeats tags within a row and mixes group and venue variants, so
 * this dedupes case-insensitively while keeping the first spelling seen. The
 * category prefix is kept: "Diner Type:Dine-In Only Guest" says more than
 * "Dine-In Only Guest", and dropping it collides with other categories.
 */
export function parseTags(value: string | null | undefined): string[] {
  const seen = new Map<string, string>();
  for (const raw of (value ?? '').split(',')) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (!seen.has(key)) seen.set(key, tag);
  }
  return [...seen.values()];
}

/** "Yes" means yes. Everything else — "No", blank, missing — means no. */
export function parseConsent(value: string | null | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'yes';
}

/**
 * The key two rows are the same person by.
 *
 * Email first because it is the thing people give consistently. Phone next.
 * Name alone is never a key — this export has hundreds of guests called
 * "Sarah" with no surname, and merging those would fuse strangers together
 * and pool their consent, which is the one mistake worth designing against.
 */
export function guestIdentityKey(guest: ImportedGuest): string | null {
  if (guest.email) return `email:${guest.email}`;
  if (guest.phone) return `phone:${guest.phone}`;
  return null;
}

/**
 * Merge the rows that turned out to be one person.
 *
 * The export carries one record per venue, so the same guest appears twice
 * with the visits split between them — 25 at one venue, 4 at the other. Counts
 * therefore add up; dates take the later; consent is true if they agreed
 * anywhere, which matches how the venues actually asked.
 */
export function mergeGuests(rows: ImportedGuest[]): ImportedGuest {
  const merged: ImportedGuest = {
    firstName: '',
    lastName: '',
    email: null,
    phone: null,
    visits: 0,
    noShows: 0,
    cancels: 0,
    spendCents: 0,
    lastVisitAt: null,
    birthday: null,
    tags: [],
    consent: {},
    venue: null
  };
  const tags = new Map<string, string>();

  for (const row of rows) {
    merged.visits += row.visits;
    merged.noShows += row.noShows;
    merged.cancels += row.cancels;
    merged.spendCents += row.spendCents;
    merged.email ??= row.email;
    merged.phone ??= row.phone;
    // Prefer the fullest name: the duplicate rows include stubs with a first
    // name and nothing else.
    if (`${row.firstName} ${row.lastName}`.trim().length > `${merged.firstName} ${merged.lastName}`.trim().length) {
      merged.firstName = row.firstName;
      merged.lastName = row.lastName;
    }
    if (row.lastVisitAt && (!merged.lastVisitAt || row.lastVisitAt > merged.lastVisitAt)) {
      merged.lastVisitAt = row.lastVisitAt;
    }
    merged.birthday ??= row.birthday;
    // The venue of the most recent visit is the one worth keeping.
    if (row.venue && (!merged.venue || row.lastVisitAt?.getTime() === merged.lastVisitAt?.getTime())) {
      merged.venue = row.venue;
    }
    for (const tag of row.tags) {
      const key = tag.toLowerCase();
      if (!tags.has(key)) tags.set(key, tag);
    }
    for (const [venue, agreed] of Object.entries(row.consent)) {
      merged.consent[venue] = merged.consent[venue] || agreed;
    }
  }

  merged.tags = [...tags.values()];
  return merged;
}

/**
 * Collapse a parsed file to one entry per person.
 *
 * Rows with neither an email nor a phone cannot be matched to anything and are
 * returned separately rather than dropped silently — a hundred unmatchable
 * guests is a fact about the export worth reporting.
 */
export function dedupeGuests(rows: ImportedGuest[]): { guests: ImportedGuest[]; unidentifiable: ImportedGuest[] } {
  const byKey = new Map<string, ImportedGuest[]>();
  const unidentifiable: ImportedGuest[] = [];

  for (const row of rows) {
    const key = guestIdentityKey(row);
    if (!key) {
      unidentifiable.push(row);
      continue;
    }
    const group = byKey.get(key) ?? [];
    group.push(row);
    byKey.set(key, group);
  }

  return {
    guests: [...byKey.values()].map((group) => (group.length === 1 ? group[0]! : mergeGuests(group))),
    unidentifiable
  };
}

/** Whether this guest may lawfully be emailed on behalf of a venue. */
export function mayEmailForVenue(guest: ImportedGuest, venue: string): boolean {
  return Boolean(guest.email) && guest.consent[venue] === true;
}

/** Whether they agreed for any venue at all. */
export function hasAnyConsent(guest: ImportedGuest): boolean {
  return Object.values(guest.consent).some(Boolean);
}
