import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideInviteChase,
  onboardingGaps,
  INVITE_REMINDER_DAYS,
  INVITE_EXPIRY_WARNING_DAYS
} from '@alma/shared';

const COMPLETE = {
  passwordHash: '$2b$10$abc',
  dateOfBirth: new Date('2001-04-02'),
  phone: '0412345678',
  addressLine1: '12 Barrenjoey Rd',
  emergencyContactName: 'Kim Nguyen',
  emergencyContactPhone: '0498765432',
  taxFileNumber: '123456782',
  superFundName: 'AustralianSuper',
  bankAccountName: 'Jordan Nguyen',
  bankBsb: '062000',
  bankAccountNumber: '12345678',
  visaStatus: 'Australian citizen'
};

test('a fully onboarded profile has no gaps', () => {
  const result = onboardingGaps(COMPLETE);
  assert.equal(result.gaps.length, 0);
  assert.equal(result.blocking.length, 0);
  assert.equal(result.canSignIn, true);
});

test('an untouched invite profile is missing everything that matters', () => {
  // This is the exact shape a manager could approve before this check existed:
  // the pending profile created by the invite, never opened by the starter.
  const result = onboardingGaps({ passwordHash: null });
  assert.equal(result.canSignIn, false);
  const blockingLabels = result.blocking.map((gap) => gap.label);
  assert.ok(blockingLabels.includes('Tax file number'));
  assert.ok(blockingLabels.includes('Bank account number'));
  assert.ok(blockingLabels.includes('Work rights'));
});

test('empty strings count as missing, not as answers', () => {
  // The onboarding form posts '' for a field left blank, and '' is not null.
  const result = onboardingGaps({ ...COMPLETE, taxFileNumber: '   ', bankBsb: '' });
  assert.deepEqual(
    result.blocking.map((gap) => gap.key).sort(),
    ['bankBsb', 'taxFileNumber']
  );
});

test('a missing phone does not block a first shift', () => {
  const result = onboardingGaps({ ...COMPLETE, phone: null });
  assert.equal(result.blocking.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0]?.blocking, false);
});

test('someone can be payroll-ready and still unable to open the app', () => {
  // 21 of 30 active staff in production are in this state.
  const result = onboardingGaps({ ...COMPLETE, passwordHash: null });
  assert.equal(result.blocking.length, 0);
  assert.equal(result.canSignIn, false);
});

const CREATED = new Date('2026-05-01T00:00:00Z');
const EXPIRES = new Date('2026-05-31T00:00:00Z');

function at(day: number) {
  return new Date(CREATED.getTime() + day * 86_400_000);
}

test('a fresh invite is left alone', () => {
  assert.deepEqual(decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(1)), {
    action: 'none',
    reason: 'too-new'
  });
});

test('the starter is nudged on day two and again on day seven', () => {
  assert.deepEqual(decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(2)), {
    action: 'remind-starter',
    dayNumber: 2
  });
  assert.deepEqual(decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(7), [2]), {
    action: 'remind-starter',
    dayNumber: 7
  });
});

test('a daily job does not resend the same nudge every day', () => {
  // Without this the day-2 reminder would go out on days 2 through 30.
  for (const day of [3, 4, 5, 6]) {
    assert.deepEqual(decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(day), [2]), {
      action: 'none',
      reason: 'waiting'
    });
  }
});

test('the manager is warned before the link dies', () => {
  const decision = decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(28), [2, 7]);
  assert.equal(decision.action, 'warn-manager');
  assert.equal(decision.action === 'warn-manager' && decision.daysLeft <= INVITE_EXPIRY_WARNING_DAYS, true);
});

test('an expired invite is reported rather than forgotten', () => {
  // 20 invites reached this state in production and nobody heard about it.
  const decision = decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES }, at(33), [2, 7]);
  assert.deepEqual(decision, { action: 'report-expired', daysAgo: 3 });
});

test('a completed invite is never chased', () => {
  assert.deepEqual(
    decideInviteChase({ createdAt: CREATED, expiresAt: EXPIRES, completedAt: at(1) }, at(40)),
    { action: 'none', reason: 'completed' }
  );
});

test('an invite that expires sooner than the reminders still gets one', () => {
  // A manager can set expiresInDays: 3. The day-2 nudge must still fire, and
  // must not be crowded out by the expiry warning.
  const shortExpiry = new Date(CREATED.getTime() + 3 * 86_400_000);
  assert.deepEqual(decideInviteChase({ createdAt: CREATED, expiresAt: shortExpiry }, at(2)), {
    action: 'remind-starter',
    dayNumber: INVITE_REMINDER_DAYS[0]
  });
});
