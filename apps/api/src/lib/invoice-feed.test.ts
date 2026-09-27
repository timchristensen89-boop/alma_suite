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
    assert.match(feed.reason ?? '', /2 established suppliers .* have none in this period \(FoodByUs, last 2026-07-10; Paramount Liquor, last 2026-07-15\)/);
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

  it('a supplier that already stopped well before the period is not expected in it', () => {
    const gone = weekly('Old Supplier', '2026-05-01', 5); // last 29 May, 63 days before August
    const feed = assessInvoiceFeed({ ...AUGUST, now: AFTER_AUGUST, invoices: [...produce, ...gone] });
    assert.equal(feed.status, 'complete');
    assert.deepEqual(feed.establishedSuppliers, ['Produce to Perfection']);
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
