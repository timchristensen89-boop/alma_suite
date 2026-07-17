// Shared staff cost-per-hour resolution for reports (Staff costing + Prime cost).
// Rates come from each profile's payroll section (StaffPayProfile): full-timers
// are costed on salary spread over a 45h ordinary week with overtime (1.5x) past
// 45h/week; casuals use the loaded rate; everyone else the award ordinary rate.
// Super is baked into every costed hour so the figure is the true employer cost.

import { defaultCasualRateCents } from '@alma/shared';

// Superannuation guarantee — 12% from 1 July 2025.
export const SUPER_GUARANTEE_RATE = 0.12;
// Salaried full-timers' ordinary weekly hours; hours past this in a week are OT.
export const FULL_TIME_ORDINARY_WEEKLY_HOURS = 45;
// A "rate" at or above this ($1,500/hr) is never a real hourly rate — it's an
// annual salary mistakenly entered in the hourly field, so cost it as a salary.
const SALARY_IN_HOURLY_FIELD_THRESHOLD_CENTS = 150_000;

// Prisma select fragment for the fields the resolver needs.
export const staffPayRateSelect = {
  employmentType: true,
  payRateCents: true,
  trainingPayRateCents: true,
  payProfile: {
    select: {
      employmentType: true,
      payMode: true,
      ordinaryHourlyRateCents: true,
      casualLoadedHourlyRateCents: true,
      manualFullTimePayAmountCents: true,
      manualFullTimePayFrequency: true,
      cashHourlyRateCents: true
    }
  }
} as const;

export type StaffCostProfile = {
  employmentType?: string | null;
  payRateCents: number | null;
  trainingPayRateCents: number | null;
  payProfile: {
    employmentType: string;
    payMode: string;
    ordinaryHourlyRateCents: number;
    casualLoadedHourlyRateCents: number | null;
    manualFullTimePayAmountCents: number | null;
    manualFullTimePayFrequency: string | null;
    cashHourlyRateCents: number | null;
  } | null;
};

export type StaffCostingRate = {
  ordinaryRateCents: number | null;
  overtimeRateCents: number | null;
  appliesOvertime: boolean;
  rateCents: number | null;
  source: string;
};

function isFullTimeType(employmentType: string | null | undefined): boolean {
  const value = (employmentType ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return value === 'FULL_TIME' || value === 'FULLTIME' || value === 'PERMANENT_FULL_TIME';
}

// `superRate` is a fraction (0.12 = 12%). Defaults to the legacy constant so any
// caller that hasn't loaded the admin-configured rate keeps the prior behaviour.
export function staffCostingRate(
  profile: StaffCostProfile,
  superRate: number = SUPER_GUARANTEE_RATE
): StaffCostingRate {
  const withSuper = (cents: number): number => Math.round(cents * (1 + superRate));
  const flat = (cents: number, source: string): StaffCostingRate => {
    const rate = withSuper(cents);
    return { ordinaryRateCents: rate, overtimeRateCents: null, appliesOvertime: false, rateCents: rate, source };
  };
  const missing: StaffCostingRate = {
    ordinaryRateCents: null, overtimeRateCents: null, appliesOvertime: false, rateCents: null, source: 'Missing rate'
  };

  const payProfile = profile.payProfile;

  // Cash wages — a flat hourly rate paid in cash, the same every day, with no
  // overtime split and no super on top (the rate is the actual cost). Takes
  // precedence over employment type.
  if (payProfile && payProfile.payMode === 'CASH') {
    const base = payProfile.cashHourlyRateCents;
    if (!base) return missing;
    return { ordinaryRateCents: base, overtimeRateCents: null, appliesOvertime: false, rateCents: base, source: 'Cash (flat, no super)' };
  }

  const fullTime = payProfile
    ? payProfile.payMode === 'MANUAL_FULL_TIME' || isFullTimeType(payProfile.employmentType)
    : false;

  // Full-time / salaried — salary spread over a 45h week, overtime beyond 45h/wk.
  if (payProfile && fullTime) {
    let ordinaryBaseCents: number | null = null;
    let label = '';
    const amount = payProfile.manualFullTimePayAmountCents;
    const freq = (payProfile.manualFullTimePayFrequency ?? '').toUpperCase();
    if (amount && freq === 'HOURLY_FULL_TIME') {
      ordinaryBaseCents = amount;
      label = 'Full-time hourly';
    } else if (amount) {
      const annualCents =
        freq === 'WEEKLY' ? amount * 52
        : freq === 'FORTNIGHTLY' ? amount * 26
        : freq === 'MONTHLY' ? amount * 12
        : amount; // ANNUAL (default)
      ordinaryBaseCents = Math.round(annualCents / 52 / FULL_TIME_ORDINARY_WEEKLY_HOURS);
      label = 'Salary ÷ 45h/wk';
    } else if (payProfile.ordinaryHourlyRateCents) {
      ordinaryBaseCents = payProfile.ordinaryHourlyRateCents;
      label = 'Award ordinary';
    } else if (profile.payRateCents) {
      ordinaryBaseCents = profile.payRateCents;
      label = 'Staff hourly rate';
    }
    if (!ordinaryBaseCents) return missing;
    return {
      ordinaryRateCents: withSuper(ordinaryBaseCents),
      overtimeRateCents: withSuper(Math.round(ordinaryBaseCents * 1.5)),
      appliesOvertime: true,
      rateCents: withSuper(ordinaryBaseCents),
      source: `${label} + super · OT>45h`
    };
  }

  // Guard: a "rate" this high is almost certainly an annual salary typed into the
  // hourly field (e.g. $90,000). Cost it as a salaried full-timer (weekly salary
  // ÷ 45h + super, OT past 45h) instead of multiplying it by hours.
  const hourlyCandidateCents = profile.trainingPayRateCents ?? profile.payRateCents ?? 0;
  if (hourlyCandidateCents >= SALARY_IN_HOURLY_FIELD_THRESHOLD_CENTS) {
    const ordinaryBaseCents = Math.round(hourlyCandidateCents / 52 / FULL_TIME_ORDINARY_WEEKLY_HOURS);
    return {
      ordinaryRateCents: withSuper(ordinaryBaseCents),
      overtimeRateCents: withSuper(Math.round(ordinaryBaseCents * 1.5)),
      appliesOvertime: true,
      rateCents: withSuper(ordinaryBaseCents),
      source: 'Salary in rate field ÷ 45h/wk + super · OT>45h'
    };
  }

  // Casual / part-time / hourly — flat rate, super included, no overtime split.
  if (profile.trainingPayRateCents) return flat(profile.trainingPayRateCents, 'Training rate + super');
  if (profile.payRateCents) return flat(profile.payRateCents, 'Staff hourly rate + super');
  // A casual with no explicit rate defaults to the Restaurant Award Level 2 casual
  // loaded rate, so they're never costed at $0. Detected via the pay-profile enum
  // or the free-text employment type. An explicit casual/award rate still wins.
  const isCasual = payProfile?.employmentType === 'CASUAL' || /casual/i.test(profile.employmentType ?? '');
  if (isCasual) {
    const explicitBase = payProfile?.casualLoadedHourlyRateCents ?? payProfile?.ordinaryHourlyRateCents ?? null;
    if (explicitBase) {
      return flat(explicitBase, payProfile?.casualLoadedHourlyRateCents ? 'Casual loaded + super' : 'Award ordinary + super');
    }
    return flat(defaultCasualRateCents(), 'Restaurant Award L2 casual (default) + super');
  }
  if (!payProfile) return missing;
  if (!payProfile.ordinaryHourlyRateCents) return missing;
  return flat(payProfile.ordinaryHourlyRateCents, 'Award ordinary + super');
}

// Local-time Monday of the date's week (matches the reports' week boundaries).
function mondayKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

// Splits an entry's hours into ordinary vs overtime, tracking cumulative weekly
// hours per staff. Only overtime-eligible staff (salaried full-timers) split.
export function splitOvertimeHours(
  tracker: Map<string, number>,
  staffId: string,
  date: Date,
  hours: number,
  appliesOvertime: boolean
): { ordinary: number; overtime: number } {
  if (!appliesOvertime || hours <= 0) return { ordinary: Math.max(0, hours), overtime: 0 };
  const key = `${staffId}|${mondayKey(date)}`;
  const prior = tracker.get(key) ?? 0;
  const ordinaryRemaining = Math.max(0, FULL_TIME_ORDINARY_WEEKLY_HOURS - prior);
  const ordinary = Math.min(hours, ordinaryRemaining);
  tracker.set(key, prior + hours);
  return { ordinary, overtime: hours - ordinary };
}

export function costForRate(rate: StaffCostingRate, split: { ordinary: number; overtime: number }): number {
  const ordinary = rate.ordinaryRateCents ? split.ordinary * rate.ordinaryRateCents : 0;
  const overtime = rate.overtimeRateCents ? split.overtime * rate.overtimeRateCents : 0;
  return Math.round(ordinary + overtime);
}

// Salaried full-timers are paid a fixed weekly salary (incl. super) every week
// regardless of hours worked. `ordinaryRateCents` already bakes in super and is
// salary ÷ 45h, so the weekly cost is that rate across the 45h ordinary week.
// Returns 0 for anyone who isn't salaried (they're costed on hours instead).
export function weeklyFixedCostCents(rate: StaffCostingRate): number {
  if (!rate.appliesOvertime || !rate.ordinaryRateCents) return 0;
  return Math.round(rate.ordinaryRateCents * FULL_TIME_ORDINARY_WEEKLY_HOURS);
}

// How a salaried staffer's fixed weekly salary splits across venues. Salaried
// managers rarely clock in (timesheets are unreliable for them), so we attribute
// their cost by where they're ROSTERED. Pass the staffer's rostered hours per
// venue over the period; the salary is split in proportion to those hours. When
// they have no roster shifts at all, the whole cost falls to their home venue.
export function salariedVenueAllocations(
  rosterHoursByVenue: Map<string, number>,
  homeVenue: string
): Array<{ venue: string; fraction: number }> {
  let total = 0;
  for (const h of rosterHoursByVenue.values()) total += h > 0 ? h : 0;
  if (total > 0) {
    const out: Array<{ venue: string; fraction: number }> = [];
    for (const [venue, h] of rosterHoursByVenue) {
      if (h > 0) out.push({ venue, fraction: h / total });
    }
    return out;
  }
  return [{ venue: homeVenue, fraction: 1 }];
}
