import test from 'node:test';
import assert from 'node:assert/strict';
import { donationVoucherSvg, fitOrganisation, wrapWords } from './donation-voucher-art.js';

test('a short name prints at the largest size on one line', () => {
  const fit = fitOrganisation('RSL');
  assert.equal(fit.fontSize, 148);
  assert.deepEqual(fit.lines, ['RSL']);
});

test('a two-word name shrinks to one line rather than stacking at display size', () => {
  const fit = fitOrganisation('Manly Nippers');
  assert.deepEqual(fit.lines, ['Manly Nippers']);
  assert.ok(fit.fontSize >= 100 && fit.fontSize < 148);
});

test('a long club name comes down the ladder and wraps to two lines, no word split', () => {
  const name = 'Manly Warringah Sea Eagles Junior Rugby League Club';
  const fit = fitOrganisation(name);
  assert.ok(fit.fontSize < 148);
  assert.ok(fit.lines.length <= 2);
  assert.equal(fit.lines.join(' '), name);
});

test('wrapWords never splits a word and respects the line cap', () => {
  assert.deepEqual(wrapWords('one two three four', 100, 400, 2).length <= 2, true);
  assert.deepEqual(wrapWords('single', 100, 50, 2), ['single']);
});

test('the organisation name is escaped and the amount, code and venue all appear', () => {
  const svg = donationVoucherSvg({
    organisation: 'Nippers & Co <Manly>',
    cause: 'Spring raffle',
    venue: 'St Alma',
    code: 'ALMA-1234',
    amountLabel: '$200',
    expiryLabel: '3 Sep 2027',
    conditions: 'Dine-in only.'
  });
  assert.ok(svg.includes('Nippers &amp; Co'));
  assert.ok(svg.includes('&lt;Manly&gt;'));
  assert.ok(!svg.includes('<Manly>'));
  assert.ok(svg.includes('ALMA-1234'));
  assert.ok(svg.includes('$200'));
  assert.ok(svg.includes('St Alma'));
  assert.ok(svg.includes('Spring raffle'));
  assert.ok(svg.startsWith('<svg'));
});
