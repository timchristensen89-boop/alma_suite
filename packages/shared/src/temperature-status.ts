/**
 * Temperature-asset status, pure so the API summary, the Compliance
 * dashboard narrative, the Temperatures page and the Reports compliance
 * section all count the SAME things — and so a missing log never gets
 * described as a failed reading.
 *
 * Three separate questions, never added together:
 *
 *  - out of range: the asset's LATEST reading recorded a breach. This is a
 *    recorded failure. It says nothing about when that reading was taken.
 *  - missing today: no reading has been recorded during the venue's current
 *    calendar day. This is a gap in the log, not a failure. An asset can be
 *    both (its last reading was yesterday, and it was a breach).
 *  - overdue actions: open issues past their due date. Those come from the
 *    issue board, not from here, and are worded as issues.
 *
 * Background: the Compliance home added "out of range" and "missing today"
 * into one number and wrote it into a sentence that said "temperatures out of
 * range", so five missing logs read as five breaches while the cards beside
 * it correctly said zero out of range and five missing.
 */

import { venueDayStart, venueDayKey, VENUE_TIME_ZONE } from './venue-day.js';

export type TemperatureReadingStatus = 'IN_RANGE' | 'OUT_OF_RANGE';

/** The slice of an asset the status rules need. Dates may arrive as ISO strings. */
export type TemperatureAssetStatusInput = {
  status: 'ACTIVE' | 'INACTIVE';
  lastSyncAt?: Date | string | null;
  /** Newest reading first; only the first entry is read. */
  logs: Array<{ recordedAt: Date | string; status: TemperatureReadingStatus }>;
};

export type TemperatureAssetFlags = {
  /** Latest reading recorded a breach. */
  outOfRange: boolean;
  /** No reading recorded during the venue's current day. */
  missingToday: boolean;
  /** An integration sync touched the asset during the venue's current day. */
  syncedToday: boolean;
};

export type TemperatureSummaryCounts = {
  activeAssets: number;
  outOfRangeNow: number;
  missingToday: number;
  syncedToday: number;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The UTC instant the venue's current day began. */
export function venueTodayStart(now: Date = new Date(), timeZone = VENUE_TIME_ZONE): Date {
  return venueDayStart(venueDayKey(now, timeZone), timeZone) ?? new Date(NaN);
}

/** Classify one asset against the venue's current day. */
export function temperatureAssetFlags(
  asset: TemperatureAssetStatusInput,
  now: Date = new Date(),
  timeZone = VENUE_TIME_ZONE
): TemperatureAssetFlags {
  const todayStart = venueTodayStart(now, timeZone);
  const latest = asset.logs[0] ?? null;
  const latestAt = latest ? asDate(latest.recordedAt) : null;
  const syncedAt = asDate(asset.lastSyncAt);
  return {
    outOfRange: latest?.status === 'OUT_OF_RANGE',
    missingToday: !latestAt || latestAt < todayStart,
    syncedToday: Boolean(syncedAt && syncedAt >= todayStart)
  };
}

/**
 * Counts over ACTIVE assets only. Inactive assets are neither monitored nor
 * expected to log, so they are excluded from every column — including
 * "out of range", which the Temperatures page used to count for them.
 */
export function summariseTemperatureAssets(
  assets: TemperatureAssetStatusInput[],
  now: Date = new Date(),
  timeZone = VENUE_TIME_ZONE
): TemperatureSummaryCounts {
  const counts: TemperatureSummaryCounts = { activeAssets: 0, outOfRangeNow: 0, missingToday: 0, syncedToday: 0 };
  for (const asset of assets) {
    if (asset.status !== 'ACTIVE') continue;
    counts.activeAssets += 1;
    const flags = temperatureAssetFlags(asset, now, timeZone);
    if (flags.outOfRange) counts.outOfRangeNow += 1;
    if (flags.missingToday) counts.missingToday += 1;
    if (flags.syncedToday) counts.syncedToday += 1;
  }
  return counts;
}

export type ComplianceAttentionTone = 'danger' | 'warning' | 'positive';

export type ComplianceAttentionInput = {
  openIssues: number;
  overdueIssues?: number;
  outOfRangeNow: number;
  missingToday: number;
};

const plural = (count: number, noun: string, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;

/**
 * The one-line status under the Compliance home header, with the tone of its
 * dot. Each count gets its own clause with its own wording, and severity
 * follows the worst clause present: a recorded breach or an open issue is
 * red, a gap in the log alone is amber, nothing at all is green.
 */
export function complianceAttentionLine(input: ComplianceAttentionInput): { text: string; tone: ComplianceAttentionTone } {
  const clauses: string[] = [];
  if (input.openIssues > 0) {
    const overdue = input.overdueIssues ?? 0;
    clauses.push(
      overdue > 0
        ? `${plural(input.openIssues, 'open issue')} (${overdue} overdue)`
        : `${plural(input.openIssues, 'open issue')} sitting on the board`
    );
  }
  if (input.outOfRangeNow > 0) clauses.push(`${plural(input.outOfRangeNow, 'temperature')} out of range`);
  if (input.missingToday > 0) clauses.push(`${plural(input.missingToday, 'temperature log')} missing today`);

  if (clauses.length === 0) return { text: 'Issues, checklists and logs are all current.', tone: 'positive' };

  const tone: ComplianceAttentionTone = input.openIssues > 0 || input.outOfRangeNow > 0 ? 'danger' : 'warning';
  const text =
    clauses.length === 1
      ? `${clauses[0]}.`
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}.`;
  return { text: text.charAt(0).toUpperCase() + text.slice(1), tone };
}
