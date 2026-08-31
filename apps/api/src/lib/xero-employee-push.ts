// ── What a push to Xero Payroll did NOT carry ──────────────────────────────
//
// Every payroll block on the employee body is conditional on the profile
// holding the data, so a profile with no bank, no TFN and no super pushes
// cleanly and silently sends none of them. Xero then taxes them at the no-TFN
// rate — roughly half their pay — and the push reports "created". That is how
// a push can succeed and still leave someone to be typed in by hand.
//
// Pure so the wording is testable without a Xero connection.
export type PayrollPushSubject = {
  firstName: string;
  taxFileNumber: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  superFundName: string | null;
  superFundAbn: string | null;
  superFundUsi: string | null;
};

const hasDigits = (value: string | null) => Boolean(value && /\d/.test(value));

/** Human-readable warnings for every payroll block the push will omit. */
export function payrollDetailsNotSent(staff: PayrollPushSubject, tenantLabel: string): string[] {
  const out: string[] = [];
  const who = staff.firstName;
  if (!hasDigits(staff.taxFileNumber)) {
    out.push(
      `No tax file number on ${who}'s profile, so no tax declaration went to ${tenantLabel} — Xero will tax them at the no-TFN rate until one is added.`
    );
  }
  if (!hasDigits(staff.bankBsb) || !hasDigits(staff.bankAccountNumber)) {
    out.push(`No BSB and account number on ${who}'s profile, so no bank account went to ${tenantLabel}.`);
  }
  if (!staff.superFundAbn && !staff.superFundUsi && !staff.superFundName) {
    out.push(`No super fund on ${who}'s profile, so no super membership went to ${tenantLabel}.`);
  }
  return out;
}

/** Xero Payroll answers 200 and puts per-employee rejections in the body. */
export function xeroElementWarnings(
  element: { ValidationErrors?: Array<{ Message?: string }> } | undefined,
  tenantLabel: string
): string[] {
  const messages = (element?.ValidationErrors ?? [])
    .map((error) => (error.Message ?? '').trim())
    .filter(Boolean);
  return messages.map((message) => `Xero rejected part of the record in ${tenantLabel}: ${message}`);
}
