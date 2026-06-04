// Shared staff cost-per-hour resolution for reports (Staff costing + Prime cost).
// Rates come from each profile's payroll section (StaffPayProfile): full-timers
// are costed on salary spread over a 45h ordinary week with overtime (1.5x) past
// 45h/week; casuals use the loaded rate; everyone else the award ordinary rate.
// Super is baked into every costed hour so the figure is the true employer cost.

// Superannuation guarantee — 12% from 1 July 2025.
export const SUPER_GUARANTEE_RATE = 0.12;
// Salaried full-timers' ordinary weekly hours; hours past this in a week are OT.
export const FULL_TIME_ORDINARY_WEEKLY_HOURS = 45;

// Prisma select fragment for the fields the resolver needs.
export const staffPayRateSelect = {
  payRateCents: true,
  trainingPayRateCents: true,
  payProfile: {
    select: {
      employmentType: true,
      payMode: true,
      ordinaryHourlyRateCents: true,
      casualLoadedHourlyRateCents: true,
      manualFullTimePayAmountCents: true,
      manualFullTimePayFrequency: true
    }
  }
} as const;

export type StaffCostProfile = {
  payRateCents: number | null;
  trainingPayRateCents: number | null;
  payProfile: {
    employmentType: string;
    payMode: string;
    ordinaryHourlyRateCents: number;
    casualLoadedHourlyRateCents: number | null;
    manualFullTimePayAmountCents: number | null;
    manualFullTimePayFrequency: string | null;
  } | null;
};

export type StaffCostingRate = {
  ordinaryRateCents: number | null;
  overtimeRateCents: number | null;
  appliesOvertime: boolean;
  rateCents: number | null;
  source: string;
};

function withSuper(cents: number): number {
  return Math.round(cents * (1 + SUPER_GUARANTEE_RATE));
}

function isFullTimeType(employmentType: string | null | undefined): boolean {
  const value = (employmentType ?? '').toUpperCase().replace(/[\s-]/g, '_');
  return value === 'FULL_TIME' || value === 'FULLTIME' || value === 'PERMANENT_FULL_TIME';
}

export function staffCostingRate(profile: StaffCostProfile): StaffCostingRate {
  const flat = (cents: number, source: string): StaffCostingRate => {
    const rate = withSuper(cents);
    return { ordinaryRateCents: rate, overtimeRateCents: null, appliesOvertime: false, rateCents: rate, source };
  };
  const missing: StaffCostingRate = {
    ordinaryRateCents: null, overtimeRateCents: null, appliesOvertime: false, rateCents: null, source: 'Missing rate'
  };

  const payProfile = profile.payProfile;
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

  // Casual / part-time / hourly — flat rate, super included, no overtime split.
  if (profile.trainingPayRateCents) return flat(profile.trainingPayRateCents, 'Training rate + super');
  if (profile.payRateCents) return flat(profile.payRateCents, 'Staff hourly rate + super');
  if (!payProfile) return missing;
  if (payProfile.employmentType === 'CASUAL') {
    const base = payProfile.casualLoadedHourlyRateCents ?? payProfile.ordinaryHourlyRateCents;
    if (!base) return missing;
    return flat(base, payProfile.casualLoadedHourlyRateCents ? 'Casual loaded + super' : 'Award ordinary + super');
  }
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
