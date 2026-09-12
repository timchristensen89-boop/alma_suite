import test from 'node:test';
import assert from 'node:assert/strict';
import { donationVoucherSvg, fitOrganisation, voucherLayout, wrapWords } from './donation-voucher-art.js';

test('a short name prints at the largest size on one line', () => {
  const fit = fitOrganisation('RSL');
  assert.equal(fit.fontSize, 124);
  assert.deepEqual(fit.lines, ['RSL']);
});

test('a two-word name shrinks to one line rather than stacking at display size', () => {
  const fit = fitOrganisation('Manly Nippers');
  assert.deepEqual(fit.lines, ['Manly Nippers']);
  assert.ok(fit.fontSize >= 100 && fit.fontSize < 124);
});

test('a long club name steps down and stacks, no word split, nothing dropped', () => {
  const name = 'Manly Warringah Sea Eagles Junior Rugby League Club';
  const fit = fitOrganisation(name);
  assert.ok(fit.fontSize < 124);
  // Up to four lines. The fit takes the largest type that fits, so a name that
  // can be set bigger over three lines than over two is set over three.
  assert.ok(fit.lines.length <= 4);
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

/**
 * The name is the only thing on the card that changes size, so it is the only
 * thing that can push the conditions line off the bottom. These are the names
 * that would do it if the fit were not bounded.
 */
const STRESS = [
  'A',
  'RSL',
  'Manly Nippers',
  'Freshwater SLSC',
  'Avalon Beach SLSC',
  'North Curl Curl Surf Life Saving Club',
  'Manly Warringah Sea Eagles Junior Rugby League Club',
  'Barrenjoey High School Parents and Citizens Association',
  'Warriewood Narrabeen Collaroy Combined Junior Surf Life Saving and Nippers Association',
  'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch'
];

test('every name lands inside the card, with or without a cause line', () => {
  for (const organisation of STRESS) {
    for (const hasCause of [false, true]) {
      const layout = voucherLayout(organisation, hasCause);
      const where = `${organisation} (cause: ${hasCause})`;

      // The conditions line is the last thing down the card; the content box
      // ends at 670, inside the 60px safe margin.
      assert.ok(layout.conditionsY <= 670, `${where} pushes the conditions to ${layout.conditionsY}`);

      // Blocks run in order and never close past the 36px floor between them.
      assert.ok(layout.valueTop >= layout.causeY, `${where} runs the value row into the cause line`);
      assert.ok(layout.footTop >= layout.valueTop + 89, `${where} runs the footer into the value row`);
      assert.ok(layout.fontSize >= 44, `${where} sets the name below the floor`);
    }
  }
});

test('a cause line costs the name room rather than overflowing the card', () => {
  const name = 'North Curl Curl Surf Life Saving Club';
  assert.ok(voucherLayout(name, true).fontSize <= voucherLayout(name, false).fontSize);
});

test('the artwork carries the new composition', () => {
  const svg = donationVoucherSvg({
    organisation: 'Manly Nippers',
    venue: 'St Alma',
    code: 'ALMA-1234',
    amountLabel: '$200',
    expiryLabel: '3 Sep 2027',
    conditions: 'Dine-in only.'
  });
  assert.ok(svg.includes('DINNER ON US'));
  assert.ok(svg.includes('Presented with our support to'));
  assert.ok(svg.includes('VALID UNTIL'));
  assert.ok(svg.includes('DINE AT'));
  // The double gold rule sits on the 60px safe margin, not outside it.
  assert.ok(svg.includes('x="60" y="60"'));
  assert.ok(svg.includes('x="67" y="67"'));
});
