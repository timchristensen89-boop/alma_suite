/**
 * When a fridge going out of range stops being a warning and becomes a job.
 *
 * A fridge reads warm for all sorts of innocent reasons — a door held open
 * during stocking, a defrost cycle, a delivery being put away. Raising a task
 * every time teaches people to close tasks without looking, which is worse
 * than not raising them.
 *
 * So: every out-of-range reading tells the venue's head chef, and nothing more.
 * Three of them close together means it is not the door, and that is when
 * somebody has to physically check what is in the fridge.
 */

/**
 * How long three readings can possibly span.
 *
 * The sensors report hourly — measured at 64.9 minutes average, 59.9 minimum
 * across a week of real readings. Three readings therefore cover about two
 * hours at the absolute tightest, and three hours gives one late reading room
 * without letting an unrelated breach tomorrow morning count towards tonight's.
 */
export const TEMPERATURE_ESCALATION_WINDOW_MINUTES = 180;

/** Warnings inside the window before it becomes a job. */
export const TEMPERATURE_ESCALATION_THRESHOLD = 3;

export type TemperatureReading = {
  recordedAt: Date;
  status: string;
};

export type EscalationDecision = {
  /** Tell the head chef. Every out-of-range reading does this. */
  warn: boolean;
  /** Raise a job to check the contents. Only the third strike does this. */
  escalate: boolean;
  /** Out-of-range readings counted inside the window, including this one. */
  breachesInWindow: number;
  /** Minutes from the first counted breach to this one. */
  spanMinutes: number;
};

/**
 * Decide what a new reading means.
 *
 * `recent` is the asset's readings inside the window, in any order; the caller
 * fetches them and this counts them. The reading being judged is passed
 * separately so a caller can decide before writing it.
 */
export function decideTemperatureEscalation(
  reading: TemperatureReading,
  recent: TemperatureReading[],
  options: {
    windowMinutes?: number;
    threshold?: number;
    /** Set when a job already exists, so a fridge left warm overnight raises one job, not twelve. */
    alreadyEscalated?: boolean;
  } = {}
): EscalationDecision {
  const windowMinutes = options.windowMinutes ?? TEMPERATURE_ESCALATION_WINDOW_MINUTES;
  const threshold = options.threshold ?? TEMPERATURE_ESCALATION_THRESHOLD;

  if (reading.status !== 'OUT_OF_RANGE') {
    return { warn: false, escalate: false, breachesInWindow: 0, spanMinutes: 0 };
  }

  const windowStart = new Date(reading.recordedAt.getTime() - windowMinutes * 60_000);
  const breaches = recent
    .filter(
      (entry) =>
        entry.status === 'OUT_OF_RANGE' &&
        entry.recordedAt > windowStart &&
        entry.recordedAt <= reading.recordedAt
    )
    .map((entry) => entry.recordedAt.getTime());

  // The reading being judged counts, whether or not the caller has stored it.
  const times = [...new Set([...breaches, reading.recordedAt.getTime()])].sort((a, b) => a - b);
  const breachesInWindow = times.length;
  const spanMinutes = times.length > 1 ? Math.round((times[times.length - 1]! - times[0]!) / 60_000) : 0;

  return {
    warn: true,
    escalate: breachesInWindow >= threshold && !options.alreadyEscalated,
    breachesInWindow,
    spanMinutes
  };
}
