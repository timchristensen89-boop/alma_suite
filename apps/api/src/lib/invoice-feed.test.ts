import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessInvoiceFeed, type InvoiceFeedInvoice } from '@alma/shared';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// August 2026 as a venue month (UTC+10): 31 Jul 14:00Z → 31 Aug 14:00Z.
const AUGUST = { start: new Date('2026-07-31T14:00:00Z'), end: new Date('2026-08-31T14:00:00Z') };
const AFTER_AUGUST = new Date('2026-09-26T00:00:00Z');

/** Invoices on the given days for one supplier. */
const supplier = (name: string, days: string[]): InvoiceFeedInvoice[] => days.map((day) => ({ supplierName: name, invoiceDate: d(day) }));
/** Weekly invoices from a start day for n weeks. */
const weekly = (name: string, from: string, weeks: number) =>
  supplier(name, Array.from({ length: weeks }, (_, i) => new Date(d(from).getTime() + i * 7 * 86_400_000).toISOString().slice(0, 10)));

describe('general cadence: activity has to continue through the elapsed period', () => {
  it('a period whose invoices run first-to-last across it is complete', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: weekly('Produce to Perfection', '2026-08-01', 5) });
    assert.equal(feed.status, 'complete');
    assert.equal(feed.coverage, 0.99);
    assert.equal(feed.missingInterval, null);
    assert.equal(feed.reason, null);
  });

  it('the symptom: one invoice does not make a month covered', () => {
    // The old rule looked only at the FIRST invoice date and called August
    // 100% covered on $461.61 of purchases.
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: supplier('One-off', ['2026-08-03']) });
    assert.equal(feed.status, 'incomplete');
    assert.equal(feed.coverage, 0.23);
    assert.deepEqual(feed.missingInterval, { from: '2026-08-10', to: '2026-08-31' });
    assert.match(feed.reason ?? '', /cover 23% of the elapsed period/);
  });

  it('a feed that stalls mid-period names the missing stretch', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: weekly('FoodByUs', '2026-08-01', 2) });
    assert.equal(feed.status, 'incomplete');
    assert.equal(feed.lastInvoiceDate, '2026-08-08');
    // One ordinary weekly gap after the last invoice is still covered.
    assert.deepEqual(feed.missingInterval, { from: '2026-08-15', to: '2026-08-31' });
  });

  it('no invoices at all in an elapsed period is incomplete, and says so', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [] });
    assert.equal(feed.status, 'incomplete');
    assert.match(feed.reason ?? '', /No supplier invoices fall in the 31 elapsed days/);
  });

  it('a period only a few days old is not judged on cadence', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: new Date('2026-08-03T00:00:00Z'), invoices: [] });
    assert.equal(feed.status, 'too_early');
    assert.equal(feed.reason, null);
  });

  it('an in-progress period is measured to now, not to its end', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: new Date('2026-08-15T14:00:00Z'), invoices: weekly('Produce', '2026-08-01', 2) });
    assert.equal(feed.elapsedDays, 15);
    assert.equal(feed.status, 'complete');
  });
});

describe('an established supplier that disappears makes the feed incomplete', () => {
  const produce = weekly('Produce to Perfection', '2026-05-02', 18); // continues through August
  const foodByUs = weekly('FoodByUs', '2026-05-01', 11); // last 10 July, then nothing
  const paramount = weekly('Paramount Liquor', '2026-05-06', 11); // last 15 July, then nothing

  it('a supplier with weekly invoices for 90 days and none in the month is named', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...foodByUs, ...paramount] });
    assert.equal(feed.status, 'incomplete');
    assert.deepEqual(feed.establishedSuppliers, ['FoodByUs', 'Paramount Liquor', 'Produce to Perfection']);
    assert.deepEqual(
      feed.absentEstablishedSuppliers.map((s) => [s.supplierName, s.lastInvoiceBefore, s.longestGapDays]),
      [
        ['FoodByUs', '2026-07-10', 7],
        ['Paramount Liquor', '2026-07-15', 7]
      ]
    );
    assert.match(feed.reason ?? '', /2 regular suppliers have no invoice in this period \(FoodByUs: \d+ invoice dates in the 90 days to 2026-07-10, then nothing for 21 days; Paramount Liquor: .* to 2026-07-15, then nothing for 16 days\)/);
    assert.deepEqual(feed.absentEstablishedSuppliers.map((s) => s.carriedForward), [false, false]);
    // Cadence alone was fine: the produce supplier kept the month "covered".
    assert.equal(feed.coverage >= 0.9, true);
  });

  it('an occasional supplier that does not reappear is not a failure', () => {
    const occasional = supplier('A. Plumber', ['2026-06-03', '2026-07-20']);
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...occasional] });
    assert.equal(feed.status, 'complete');
    assert.deepEqual(feed.establishedSuppliers, ['Produce to Perfection']);
    assert.deepEqual(feed.absentEstablishedSuppliers, []);
  });

  it('a supplier that was regular when it stopped stays expected — its absence is carried forward, not aged out', () => {
    const gone = weekly('Old Supplier', '2026-05-01', 5); // last 29 May, 63 days before August: the per-period rule alone would drop it
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...gone] });
    assert.equal(feed.status, 'incomplete');
    assert.deepEqual(feed.establishedSuppliers, ['Old Supplier', 'Produce to Perfection']);
    assert.deepEqual(feed.absentEstablishedSuppliers.map((s) => [s.supplierName, s.carriedForward, s.absentForDays]), [['Old Supplier', true, 63]]);
    assert.match(feed.reason ?? '', /Old Supplier: 5 invoice dates in the 90 days to 2026-05-29, then nothing for 63 days — an unresolved absence carried forward/);
  });

  it('an explicit "no longer expected" decision resolves an absence; silence never does', () => {
    const gone = weekly('Old Supplier', '2026-05-01', 5);
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...gone], notExpectedSuppliers: ['Old Supplier'] });
    assert.equal(feed.status, 'complete');
    assert.deepEqual(feed.notExpectedSuppliers, ['Old Supplier']);
    assert.deepEqual(feed.absentEstablishedSuppliers, []);
  });

  it('a fortnightly supplier is not called absent on day 10 of the period', () => {
    const fortnightly = supplier('Fortnightly', ['2026-06-05', '2026-06-19', '2026-07-03', '2026-07-17', '2026-07-31']);
    const early = assessInvoiceFeed({ ...AUGUST, now: new Date('2026-08-10T14:00:00Z'), invoices: [...produce, ...fortnightly] });
    assert.deepEqual(early.absentEstablishedSuppliers, []);
    const late = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...fortnightly] });
    assert.deepEqual(late.absentEstablishedSuppliers.map((s) => s.supplierName), ['Fortnightly']);
  });

  it('suppliers are never classified food or beverage by name — only established or not', () => {
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...paramount] });
    assert.equal(Object.keys(feed.absentEstablishedSuppliers[0] ?? {}).includes('category'), false);
  });
});

describe('the real September sequence: an absence detected in August must still fail September', () => {
  // FoodByUs on the dump: 45 distinct invoice dates in the 90 days to its
  // last invoice on 11 July, longest gap 4 days, then nothing. The produce
  // supplier keeps invoicing weekly throughout, so cadence alone reads fine.
  const foodByUs = supplier('FoodByUs', Array.from({ length: 45 }, (_, i) => new Date(d('2026-07-11').getTime() - i * 2 * 86_400_000).toISOString().slice(0, 10)));
  // Produce every three days from April into November, so cadence alone is clean in every month.
  const produce = supplier('Produce to Perfection', Array.from({ length: 75 }, (_, i) => new Date(d('2026-04-01').getTime() + i * 3 * 86_400_000).toISOString().slice(0, 10)));
  const AUG = AUGUST;
  const SEP = { start: new Date('2026-08-31T14:00:00Z'), end: new Date('2026-09-30T14:00:00Z') };
  const OCT = { start: new Date('2026-09-30T14:00:00Z'), end: new Date('2026-10-31T14:00:00Z') };
  const NOV = { start: new Date('2026-10-31T14:00:00Z'), end: new Date('2026-11-30T14:00:00Z') };
  const late = new Date('2026-12-15T00:00:00Z');

  it('August: absent, detected by the per-period rule (not carried forward)', () => {
    const feed = assessInvoiceFeed({ ...AUG, now: late, invoices: [...foodByUs, ...produce] });
    assert.equal(feed.status, 'incomplete');
    assert.deepEqual(feed.absentEstablishedSuppliers.map((s) => [s.supplierName, s.carriedForward, s.lastInvoiceBefore, s.longestGapDays]), [['FoodByUs', false, '2026-07-11', 2]]);
  });

  it('September: still absent — the 45-day recency rule alone would have dropped it; the carried-forward absence keeps the month incomplete', () => {
    const feed = assessInvoiceFeed({ ...SEP, now: late, invoices: [...foodByUs, ...produce] });
    // Its last invoice is 51 days before 1 Sep: not "recent", so (a) fails…
    assert.equal(feed.absentEstablishedSuppliers[0]?.absentForDays, 51);
    assert.equal(feed.absentEstablishedSuppliers[0]?.absentForDays! > 45, true);
    // …and (b) carries the absence forward.
    assert.equal(feed.status, 'incomplete');
    assert.deepEqual(feed.absentEstablishedSuppliers.map((s) => [s.supplierName, s.carriedForward]), [['FoodByUs', true]]);
    assert.match(feed.reason ?? '', /FoodByUs: 45 invoice dates in the 90 days to 2026-07-11, then nothing for 51 days — an unresolved absence carried forward/);
    assert.equal(feed.coverage >= 0.9, true, 'cadence alone passes; the supplier rule is what fails the month');
  });

  it('October: the supplier resumes and the absence clears', () => {
    const resumed = [...foodByUs, ...weekly('FoodByUs', '2026-10-05', 4)];
    const oct = assessInvoiceFeed({ ...OCT, now: late, invoices: [...resumed, ...produce] });
    assert.equal(oct.status, 'complete');
    assert.deepEqual(oct.absentEstablishedSuppliers, []);
    assert.equal(oct.establishedSuppliers.includes('FoodByUs'), true);
    // November: judged on the resumed history, no carry-forward in play.
    const nov = assessInvoiceFeed({ ...NOV, now: late, invoices: [...resumed, ...weekly('FoodByUs', '2026-11-02', 4), ...produce] });
    assert.equal(nov.status, 'complete');
  });

  it('an occasional supplier that stopped is never carried forward: two invoices are not a pattern', () => {
    const occasional = supplier('A. Plumber', ['2026-05-03', '2026-05-20']);
    for (const period of [AUG, SEP, OCT]) {
      const feed = assessInvoiceFeed({ ...period, now: late, invoices: [...occasional, ...produce] });
      assert.equal(feed.establishedSuppliers.includes('A. Plumber'), false);
      assert.deepEqual(feed.absentEstablishedSuppliers, []);
    }
  });
});
