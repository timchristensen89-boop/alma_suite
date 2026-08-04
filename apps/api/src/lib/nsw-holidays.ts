// NSW public holidays, keyed by Sydney date (YYYY-MM-DD). Static table —
// gazetted dates, no runtime dependency. Extend annually (add the next year
// each December; the forecast engine warns when a horizon runs past the
// table's coverage).
//
// Used by the forecast engine to (a) keep holiday trading from polluting
// ordinary same-weekday baselines and (b) flag holiday days in the outlook
// so nobody mistakes a baseline figure for a holiday-aware prediction.

const NSW_HOLIDAYS: Record<string, string> = {
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-26': 'Australia Day',
  '2026-04-03': 'Good Friday',
  '2026-04-04': 'Easter Saturday',
  '2026-04-05': 'Easter Sunday',
  '2026-04-06': 'Easter Monday',
  '2026-04-25': 'Anzac Day',
  '2026-06-08': "King's Birthday",
  '2026-10-05': 'Labour Day',
  '2026-12-25': 'Christmas Day',
  '2026-12-26': 'Boxing Day',
  '2026-12-28': 'Boxing Day (additional)',
  // 2027
  '2027-01-01': "New Year's Day",
  '2027-01-26': 'Australia Day',
  '2027-03-26': 'Good Friday',
  '2027-03-27': 'Easter Saturday',
  '2027-03-28': 'Easter Sunday',
  '2027-03-29': 'Easter Monday',
  '2027-04-25': 'Anzac Day',
  '2027-06-14': "King's Birthday",
  '2027-10-04': 'Labour Day',
  '2027-12-25': 'Christmas Day',
  '2027-12-26': 'Boxing Day',
  '2027-12-27': 'Christmas Day (additional)',
  '2027-12-28': 'Boxing Day (additional)',
  // 2028
  '2028-01-01': "New Year's Day",
  '2028-01-03': "New Year's Day (additional)",
  '2028-01-26': 'Australia Day',
  '2028-04-14': 'Good Friday',
  '2028-04-15': 'Easter Saturday',
  '2028-04-16': 'Easter Sunday',
  '2028-04-17': 'Easter Monday',
  '2028-04-25': 'Anzac Day',
  '2028-06-12': "King's Birthday",
  '2028-10-02': 'Labour Day',
  '2028-12-25': 'Christmas Day',
  '2028-12-26': 'Boxing Day'
};

export function nswHolidayName(dateKey: string): string | null {
  return NSW_HOLIDAYS[dateKey] ?? null;
}

// The last date the table knows about — the engine warns when a forecast
// horizon extends beyond this.
export const NSW_HOLIDAYS_COVERED_UNTIL = '2028-12-31';
