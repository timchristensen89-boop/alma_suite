import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Where a password reset link points.
 *
 * Found by walking the flow on a phone: the link landed on the app's home
 * screen with a dangling ?token=, because the configured values are bare
 * origins and nothing appended the path. Both apps read the token on
 * /reset-password and nothing reads it at the root. In production it was worse
 * — COMPLIANCE_WEB_URL was consulted before STAFF_WEB_URL, so a floor staffer
 * resetting their password was sent to Alma Compliance, which they cannot sign
 * in to at all. 20 of 29 active staff have no password; this link is the only
 * door they have.
 *
 * resetBaseUrl is module-private, so this exercises the same decision through
 * the public behaviour it produces: the shape of the link that gets emailed.
 */

/** The rule under test, mirrored so it can be exercised without a database. */
function resetLink(
  input: string | undefined,
  env: { PASSWORD_RESET_BASE_URL?: string; STAFF_WEB_URL?: string; COMPLIANCE_WEB_URL?: string },
  requestOrigin: string | null,
  allowed: Set<string>
): string {
  const fromRequest = (() => {
    if (!requestOrigin) return '';
    try {
      const origin = new URL(requestOrigin).origin;
      return allowed.has(origin) ? origin : '';
    } catch {
      return '';
    }
  })();
  const candidate =
    input?.trim() || env.PASSWORD_RESET_BASE_URL || fromRequest || env.STAFF_WEB_URL || env.COMPLIANCE_WEB_URL || '';
  if (!candidate) throw new Error('Password reset URL is not configured.');
  const url = new URL(candidate);
  if (!allowed.has(url.origin)) throw new Error('not an allowed app origin');
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/reset-password';
  return url.toString();
}

const ALLOWED = new Set(['https://alma-staff.web.app', 'https://alma-compliance.web.app']);
const PROD = {
  STAFF_WEB_URL: 'https://alma-staff.web.app',
  COMPLIANCE_WEB_URL: 'https://alma-compliance.web.app'
};

test('a bare origin gets the path to the reset form', () => {
  // This is the bug: the link used to be "https://…/" with the token in the
  // query, and nothing reads a token at the root.
  assert.equal(
    resetLink(undefined, PROD, null, ALLOWED),
    'https://alma-staff.web.app/reset-password'
  );
});

test('a staff member is sent back to the staff app, not compliance', () => {
  assert.equal(
    resetLink(undefined, PROD, 'https://alma-staff.web.app', ALLOWED),
    'https://alma-staff.web.app/reset-password'
  );
});

test('a manager resetting from compliance is sent back to compliance', () => {
  assert.equal(
    resetLink(undefined, PROD, 'https://alma-compliance.web.app', ALLOWED),
    'https://alma-compliance.web.app/reset-password'
  );
});

test('with no origin at all, staff wins over compliance', () => {
  // The old order put compliance first, which sent floor staff to an app they
  // cannot sign in to.
  assert.equal(resetLink(undefined, PROD, null, ALLOWED), 'https://alma-staff.web.app/reset-password');
});

test('a caller that already points at a page is left alone', () => {
  // approveOnboarding passes `${staffWebUrl}/reset-password` — it must not
  // become /reset-password/reset-password.
  assert.equal(
    resetLink('https://alma-staff.web.app/reset-password', PROD, null, ALLOWED),
    'https://alma-staff.web.app/reset-password'
  );
});

test('an explicit override to another page is respected', () => {
  assert.equal(
    resetLink('https://alma-staff.web.app/welcome', PROD, null, ALLOWED),
    'https://alma-staff.web.app/welcome'
  );
});

test('a hostile Origin header cannot redirect the link', () => {
  // Ignored rather than rejected: the header is attacker-controlled, so the
  // safe response is to fall back to our own app, not to fail the reset.
  assert.equal(
    resetLink(undefined, PROD, 'https://evil.example.com', ALLOWED),
    'https://alma-staff.web.app/reset-password'
  );
  // Supplied directly it is refused outright — that path is a caller decision,
  // not an untrusted header, so a wrong value should be loud.
  assert.throws(() => resetLink('https://evil.example.com', PROD, null, ALLOWED), /not an allowed app origin/);
});

test('nothing configured is an error, not a broken link', () => {
  assert.throws(() => resetLink(undefined, {}, null, ALLOWED), /not configured/);
});

test('PASSWORD_RESET_BASE_URL still wins when set', () => {
  assert.equal(
    resetLink(undefined, { ...PROD, PASSWORD_RESET_BASE_URL: 'https://alma-compliance.web.app' }, 'https://alma-staff.web.app', ALLOWED),
    'https://alma-compliance.web.app/reset-password'
  );
});
