/**
 * Splitting a week's tips.
 *
 * The one rule this file exists to enforce: **a venue's tips are only ever
 * split between the people who worked that venue.** St Alma's card tips are
 * St Alma's; Alma Avalon's are Avalon's. Nothing here can pool across venues,
 * whatever the caller passes in — the grouping happens before the division, so
 * a caller that forgets a venue filter gets two separate splits and a sum, not
 * one merged pool.
 *
 * Pure on purpose. The allocation is the part that decides what lands in
 * someone's bank account, so it is testable without a database in front of it.
 */

export type TipEntryInput = {
  serviceDate: Date;
  venue: string;
  amountCents: number;
};

export type TipHoursInput = {
  staffProfileId: string;
  name: string;
  roleTitle: string | null;
  venue: string | null;
  approvedHours: number;
};

export type TipVenuePool = {
  venue: string;
  cashTipsCents: number;
  squareTipsCents: number;
  tipPoolCents: number;
  tradingDays: number;
  approvedHours: number;
  staffCount: number;
  /** Sum of this venue's entitlements. Short of the pool when nobody has hours. */
  allocatedCents: number;
};

export type TipEntitlement = TipHoursInput & {
  venue: string;
  amountCents: number;
  paymentMethod: 'CASH';
};

export type TipAllocation = {
  venues: TipVenuePool[];
  entitlements: TipEntitlement[];
  /**
   * People with hours in the week but no venue on either the timesheet or
   * their profile. They are in nobody's pool, so they are named rather than
   * quietly dropped — under-paying someone is the failure mode here.
   */
  unassigned: Array<{ staffProfileId: string; name: string; approvedHours: number }>;
  cashTipsCents: number;
  squareTipsCents: number;
  tipPoolCents: number;
  /** Distinct dates that saw tips anywhere, so two venues trading Friday is one day. */
  tradingDays: number;
  approvedHours: number;
};

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

type Bucket = {
  venue: string;
  cash: number;
  square: number;
  days: Set<string>;
  rows: TipHoursInput[];
};

function bucketFor(buckets: Map<string, Bucket>, venue: string): Bucket {
  const existing = buckets.get(venue);
  if (existing) return existing;
  const fresh: Bucket = { venue, cash: 0, square: 0, days: new Set(), rows: [] };
  buckets.set(venue, fresh);
  return fresh;
}

/**
 * Divide one venue's pool across its people, by approved hours.
 *
 * The last person absorbs the rounding remainder so the lines add up to the
 * pool exactly — a payout run that is three cents short of the money in the
 * tin is a reconciliation problem every single week.
 */
export function splitByHours(poolCents: number, rows: TipHoursInput[]): TipEntitlement[] {
  const ordered = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const totalHours = ordered.reduce((sum, row) => sum + row.approvedHours, 0);
  let allocated = 0;
  return ordered.map((row, index) => {
    const isLast = index === ordered.length - 1;
    const amountCents =
      totalHours > 0
        ? isLast
          ? poolCents - allocated
          : Math.round((row.approvedHours / totalHours) * poolCents)
        : 0;
    allocated += amountCents;
    return {
      ...row,
      venue: row.venue ?? '',
      approvedHours: Math.round(row.approvedHours * 100) / 100,
      amountCents,
      paymentMethod: 'CASH' as const
    };
  });
}

export function allocateTipsByVenue(input: {
  cashEntries: TipEntryInput[];
  cardEntries: TipEntryInput[];
  hours: TipHoursInput[];
}): TipAllocation {
  const buckets = new Map<string, Bucket>();

  for (const entry of input.cashEntries) {
    const bucket = bucketFor(buckets, entry.venue);
    bucket.cash += entry.amountCents;
    bucket.days.add(dayKey(entry.serviceDate));
  }
  for (const entry of input.cardEntries) {
    const bucket = bucketFor(buckets, entry.venue);
    bucket.square += entry.amountCents;
    bucket.days.add(dayKey(entry.serviceDate));
  }

  const unassigned: TipAllocation['unassigned'] = [];
  for (const row of input.hours) {
    if (row.approvedHours <= 0) continue;
    const venue = row.venue?.trim();
    if (!venue) {
      unassigned.push({
        staffProfileId: row.staffProfileId,
        name: row.name,
        approvedHours: Math.round(row.approvedHours * 100) / 100
      });
      continue;
    }
    bucketFor(buckets, venue).rows.push({ ...row, venue });
  }

  const venues: TipVenuePool[] = [];
  const entitlements: TipEntitlement[] = [];

  for (const bucket of Array.from(buckets.values()).sort((a, b) => a.venue.localeCompare(b.venue))) {
    const tipPoolCents = bucket.cash + bucket.square;
    const lines = splitByHours(tipPoolCents, bucket.rows);
    entitlements.push(...lines);
    venues.push({
      venue: bucket.venue,
      cashTipsCents: bucket.cash,
      squareTipsCents: bucket.square,
      tipPoolCents,
      tradingDays: bucket.days.size,
      approvedHours: Math.round(bucket.rows.reduce((sum, row) => sum + row.approvedHours, 0) * 100) / 100,
      staffCount: lines.length,
      allocatedCents: lines.reduce((sum, line) => sum + line.amountCents, 0)
    });
  }

  const allDays = new Set<string>();
  for (const bucket of buckets.values()) for (const day of bucket.days) allDays.add(day);

  return {
    venues,
    entitlements,
    unassigned: unassigned.sort((a, b) => a.name.localeCompare(b.name)),
    cashTipsCents: venues.reduce((sum, v) => sum + v.cashTipsCents, 0),
    squareTipsCents: venues.reduce((sum, v) => sum + v.squareTipsCents, 0),
    tipPoolCents: venues.reduce((sum, v) => sum + v.tipPoolCents, 0),
    tradingDays: allDays.size,
    approvedHours: Math.round(venues.reduce((sum, v) => sum + v.approvedHours, 0) * 100) / 100
  };
}

/**
 * POS-first de-duplication of card-tip rows.
 *
 * Card tips reach the pool from up to three feeds - the register itself
 * ('alma-pos'), the Square import ('square') and the Lightspeed import
 * ('lightspeed') - and they all live in one table, summed. When a venue takes
 * card on the register AND an import runs for the same day, the same tips are
 * counted twice and staff are paid twice.
 *
 * The rule, decided with the venues: the POS output is the source of truth. For
 * any venue+day the register recorded a card tip on, the import rows for that
 * venue+day are dropped. Manual ('control') entries are always kept, and an
 * import feed is used only where the register has nothing (e.g. a venue that
 * takes payment entirely through Lightspeed).
 */
const IMPORT_TIP_SOURCES = new Set(['square', 'lightspeed']);

export function posFirstCardEntries<T extends { venue: string; serviceDate: Date; source: string }>(
  entries: T[]
): T[] {
  const key = (venue: string, date: Date) => `${venue} ${date.toISOString().slice(0, 10)}`;
  const posCovered = new Set<string>();
  for (const entry of entries) {
    if (entry.source === 'alma-pos') posCovered.add(key(entry.venue, entry.serviceDate));
  }
  return entries.filter(
    (entry) => !(IMPORT_TIP_SOURCES.has(entry.source) && posCovered.has(key(entry.venue, entry.serviceDate)))
  );
}
