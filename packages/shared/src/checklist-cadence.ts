/**
 * How often a checklist template should produce a run.
 *
 * The daily scheduler used to generate a run from every template every day.
 * That is right for an opening checklist and wrong for a weekly compliance
 * walk or a standing-operating-procedure review — and a board carrying four
 * SOP reviews every morning buries the two lists that actually matter, which
 * is how a checklist system stops being used.
 */

export const CHECKLIST_CADENCES = ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'MANUAL'] as const;
export type ChecklistCadence = (typeof CHECKLIST_CADENCES)[number];

export const CHECKLIST_CADENCE_LABELS: Record<ChecklistCadence, string> = {
  DAILY: 'Every day',
  WEEKDAYS: 'Monday to Friday',
  WEEKLY: 'Once a week',
  MONTHLY: 'Once a month',
  MANUAL: 'Only when someone starts it'
};

/** Day names for a WEEKLY cadence, indexed the same way as getDay(). */
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function isChecklistCadence(value: unknown): value is ChecklistCadence {
  return typeof value === 'string' && (CHECKLIST_CADENCES as readonly string[]).includes(value);
}

/**
 * Whether a template is due on the given local date.
 *
 * `cadenceDay` means the day of the week (0 = Sunday) for WEEKLY, and the day
 * of the month for MONTHLY. A MONTHLY template set to a day the month doesn't
 * reach — the 31st in February — falls to the last day of that month rather
 * than being skipped for the month entirely.
 */
export function isChecklistDue(
  date: Date,
  cadence: ChecklistCadence,
  cadenceDay?: number | null
): boolean {
  switch (cadence) {
    case 'DAILY':
      return true;
    case 'WEEKDAYS': {
      const day = date.getDay();
      return day >= 1 && day <= 5;
    }
    case 'WEEKLY':
      // Default to Monday when no day was chosen — a weekly task with no day
      // set should still happen, at the start of the week.
      return date.getDay() === (cadenceDay ?? 1);
    case 'MONTHLY': {
      const wanted = cadenceDay ?? 1;
      const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return date.getDate() === Math.min(wanted, lastOfMonth);
    }
    case 'MANUAL':
      return false;
  }
}

/** Human phrase for a cadence, for a template list that has to be scannable. */
export function describeChecklistCadence(cadence: ChecklistCadence, cadenceDay?: number | null): string {
  if (cadence === 'WEEKLY') return `Every ${WEEKDAY_NAMES[cadenceDay ?? 1] ?? 'Monday'}`;
  if (cadence === 'MONTHLY') {
    const day = cadenceDay ?? 1;
    const suffix = day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th';
    return `${day}${suffix} of the month`;
  }
  return CHECKLIST_CADENCE_LABELS[cadence];
}
