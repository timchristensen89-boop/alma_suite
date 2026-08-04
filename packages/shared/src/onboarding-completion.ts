/**
 * Whether a new starter is actually onboarded.
 *
 * Measured against production: of 30 active staff, 6 completed onboarding, 17
 * were sent an invite and made active without finishing it, and 11 never had
 * an invite at all. 20 of 33 invites expired unused and nobody was told. The
 * result is 13 active people with no tax file number and 12 with no bank
 * account on file — payroll data that has to be chased by hand every week.
 *
 * The old approval check only looked for required *uploaded documents*, both
 * of which ship optional, so in practice it checked nothing. This is the
 * check that should have been there.
 */

/** The parts of a staff profile that say whether onboarding actually happened. */
export type OnboardingProfileFacts = {
  passwordHash?: string | null;
  dateOfBirth?: Date | string | null;
  phone?: string | null;
  addressLine1?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  taxFileNumber?: string | null;
  superFundName?: string | null;
  bankAccountName?: string | null;
  bankBsb?: string | null;
  bankAccountNumber?: string | null;
  visaStatus?: string | null;
};

export type OnboardingGap = {
  key: string;
  label: string;
  /**
   * Blocking gaps stop a payslip or a legal obligation. Advisory ones make
   * the venue's life harder but should not stand between somebody and their
   * first shift.
   */
  blocking: boolean;
};

const GAP_CHECKS: Array<{ key: keyof OnboardingProfileFacts; label: string; blocking: boolean }> = [
  // Payroll cannot run without these. Paying somebody with no TFN means
  // withholding at the top rate; paying with no bank details means not paying.
  { key: 'taxFileNumber', label: 'Tax file number', blocking: true },
  { key: 'bankAccountNumber', label: 'Bank account number', blocking: true },
  { key: 'bankBsb', label: 'Bank BSB', blocking: true },
  { key: 'bankAccountName', label: 'Bank account name', blocking: true },
  { key: 'superFundName', label: 'Super fund', blocking: true },
  { key: 'visaStatus', label: 'Work rights', blocking: true },
  { key: 'dateOfBirth', label: 'Date of birth', blocking: true },

  // Wanted, but not worth blocking a first shift over.
  { key: 'phone', label: 'Phone', blocking: false },
  { key: 'addressLine1', label: 'Address', blocking: false },
  { key: 'emergencyContactName', label: 'Emergency contact', blocking: false },
  { key: 'emergencyContactPhone', label: 'Emergency contact phone', blocking: false }
];

function missing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return typeof value === 'string' ? value.trim().length === 0 : false;
}

/**
 * What onboarding is still missing for this person.
 *
 * A missing password is reported separately: it does not stop payroll, but it
 * does mean they cannot open the app, which is how they clock on. 21 of the 30
 * active staff in production are in exactly that state.
 */
export function onboardingGaps(profile: OnboardingProfileFacts): {
  gaps: OnboardingGap[];
  blocking: OnboardingGap[];
  canSignIn: boolean;
} {
  const gaps = GAP_CHECKS.filter((check) => missing(profile[check.key])).map(({ key, label, blocking }) => ({
    key,
    label,
    blocking
  }));
  return {
    gaps,
    blocking: gaps.filter((gap) => gap.blocking),
    canSignIn: !missing(profile.passwordHash)
  };
}

/**
 * How an unfinished invite should be chased.
 *
 * A 30-day expiry with no reminder is the same as no expiry: whoever was going
 * to fill the form in did it in the first two days, and the rest went quiet
 * until the link died. So: nudge the starter twice, then tell the manager it
 * is not going to happen rather than letting it expire in silence.
 */
export const INVITE_REMINDER_DAYS = [2, 7] as const;

/** Days before expiry at which the manager is told the invite is about to die. */
export const INVITE_EXPIRY_WARNING_DAYS = 3;

export type InviteChaseDecision =
  | { action: 'none'; reason: string }
  | { action: 'remind-starter'; dayNumber: number }
  | { action: 'warn-manager'; daysLeft: number }
  | { action: 'report-expired'; daysAgo: number };

const DAY_MS = 86_400_000;

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Decide what to do about one outstanding invite.
 *
 * `alreadySent` is the reminder day numbers already sent for this invite, so a
 * job that runs daily does not send the day-2 nudge every day from day 2 to
 * day 30.
 */
export function decideInviteChase(
  invite: { createdAt: Date; expiresAt: Date; completedAt?: Date | null },
  now: Date,
  alreadySent: number[] = []
): InviteChaseDecision {
  if (invite.completedAt) return { action: 'none', reason: 'completed' };

  const age = wholeDaysBetween(invite.createdAt, now);
  const daysLeft = wholeDaysBetween(now, invite.expiresAt);

  if (daysLeft < 0) {
    return { action: 'report-expired', daysAgo: -daysLeft };
  }

  // Reminders first, newest threshold that has been reached and not yet sent.
  const due = [...INVITE_REMINDER_DAYS].reverse().find((day) => age >= day && !alreadySent.includes(day));
  if (due !== undefined) return { action: 'remind-starter', dayNumber: due };

  if (daysLeft <= INVITE_EXPIRY_WARNING_DAYS) {
    return { action: 'warn-manager', daysLeft };
  }

  return { action: 'none', reason: age < INVITE_REMINDER_DAYS[0] ? 'too-new' : 'waiting' };
}
