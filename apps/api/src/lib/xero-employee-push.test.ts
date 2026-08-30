import test from 'node:test';
import assert from 'node:assert/strict';
import { payrollDetailsNotSent, xeroElementWarnings } from './xero-employee-push.js';

const complete = {
  firstName: 'Isla',
  taxFileNumber: '123 456 782',
  bankBsb: '062-000',
  bankAccountNumber: '12345678',
  superFundName: 'HOSTPLUS',
  superFundAbn: '68 657 495 890',
  superFundUsi: 'HOS0100AU'
};

test('a complete profile warns about nothing', () => {
  assert.deepEqual(payrollDetailsNotSent(complete, 'Alma Freshwater Pty Ltd'), []);
});

test('an empty profile names all three blocks it could not send', () => {
  const warnings = payrollDetailsNotSent(
    {
      firstName: 'Isla',
      taxFileNumber: null,
      bankBsb: null,
      bankAccountNumber: null,
      superFundName: null,
      superFundAbn: null,
      superFundUsi: null
    },
    'Alma Avalon'
  );
  assert.equal(warnings.length, 3);
  // The TFN one has to say what it costs: Xero taxes at roughly half without it.
  assert.match(warnings[0], /no-TFN rate/);
  assert.ok(warnings.every((w) => w.includes('Alma Avalon')), 'each warning names the company');
  assert.ok(warnings.every((w) => w.includes('Isla')), 'each warning names the person');
});

test('half a bank account is no bank account', () => {
  // Xero needs both. A BSB on its own silently sends nothing, which is the
  // shape of the original bug.
  const bsbOnly = payrollDetailsNotSent({ ...complete, bankAccountNumber: null }, 'Alma Avalon');
  assert.equal(bsbOnly.length, 1);
  assert.match(bsbOnly[0], /BSB and account number/);

  const accountOnly = payrollDetailsNotSent({ ...complete, bankBsb: null }, 'Alma Avalon');
  assert.equal(accountOnly.length, 1);
});

test('a field of punctuation is not a number', () => {
  // "-" and "n/a" arrive from imported records and are not a TFN.
  const warnings = payrollDetailsNotSent({ ...complete, taxFileNumber: 'n/a' }, 'Alma Avalon');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tax file number/);
});

test('any one super identifier is enough to attempt the fund', () => {
  // The fund is matched on ABN, then USI, then name — so any one of them
  // means the push has something to try, and this warning stays quiet.
  for (const only of ['superFundAbn', 'superFundUsi', 'superFundName'] as const) {
    const stripped = { ...complete, superFundAbn: null, superFundUsi: null, superFundName: null, [only]: 'x' };
    assert.deepEqual(payrollDetailsNotSent(stripped, 'Alma Avalon'), [], `${only} alone should be enough`);
  }
});

test('a 200 carrying rejections is surfaced, not swallowed', () => {
  const warnings = xeroElementWarnings(
    { ValidationErrors: [{ Message: 'Bank account number is invalid' }, { Message: '' }, {}] },
    'Alma Freshwater Pty Ltd'
  );
  assert.equal(warnings.length, 1, 'blank messages are dropped');
  assert.match(warnings[0], /Alma Freshwater Pty Ltd/);
  assert.match(warnings[0], /Bank account number is invalid/);
});

test('no rejections and no element are both silence', () => {
  assert.deepEqual(xeroElementWarnings({}, 'Alma Avalon'), []);
  assert.deepEqual(xeroElementWarnings(undefined, 'Alma Avalon'), []);
});
