import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { csvObjects, moneyCents, parseDateToken } from './lightspeed-csv.js';
import {
  findDateColumn,
  findRowIdColumn,
  findTipColumn,
  isDigestFragment,
  isRankingFragment,
  mergeAttachmentTips,
  parseTipsFromCsv
} from './lightspeed-tips.js';
import { totalTipsPerDay } from './tip-rows.js';

const csv = (...lines: string[]) => lines.join('\n');

describe('parseDateToken', () => {
  it('reads the shapes these exports use, Australian day-first', () => {
    assert.equal(parseDateToken('2026-09-20'), '2026-09-20');
    assert.equal(parseDateToken('2026-09-20 18:32:11'), '2026-09-20');
    assert.equal(parseDateToken('2026-09-20T08:32:11Z'), '2026-09-20');
    assert.equal(parseDateToken('20/09/2026'), '2026-09-20');
    assert.equal(parseDateToken('20/09/2026 6:32 pm'), '2026-09-20');
    assert.equal(parseDateToken('20-09-2026'), '2026-09-20');
    assert.equal(parseDateToken('20.09.2026'), '2026-09-20');
    assert.equal(parseDateToken('20/09/26'), '2026-09-20');
    assert.equal(parseDateToken('2026/09/20'), '2026-09-20');
    assert.equal(parseDateToken('20 Sep 2026'), '2026-09-20');
    assert.equal(parseDateToken('Sun 20 Sep 2026'), '2026-09-20');
    assert.equal(parseDateToken('Sunday, 20 September 2026'), '2026-09-20');
    assert.equal(parseDateToken('Sep 20, 2026'), '2026-09-20');
  });

  it('flips an impossible month when the other segment can be the month', () => {
    assert.equal(parseDateToken('09/20/2026'), '2026-09-20');
  });

  it('is null for anything that is not a date', () => {
    assert.equal(parseDateToken(''), null);
    assert.equal(parseDateToken('Bar'), null);
    assert.equal(parseDateToken('Total'), null);
    assert.equal(parseDateToken('32/13/2026'), null);
  });
});

describe('moneyCents', () => {
  it('strips currency dressing and keeps blanks as unknown, not zero', () => {
    assert.equal(moneyCents('$1,234.56'), 123456);
    assert.equal(moneyCents('A$12.50'), 1250);
    assert.equal(moneyCents('12'), 1200);
    assert.equal(moneyCents('(12.50)'), -1250);
    assert.equal(moneyCents('-3.10'), -310);
    assert.equal(moneyCents(''), null);
    assert.equal(moneyCents('-'), null);
    assert.equal(moneyCents(null), null);
    assert.equal(moneyCents('n/a'), null);
  });
});

describe('csvObjects', () => {
  it('steps over a Looker title line above the header', () => {
    const rows = csvObjects(csv('Site Reconciliations Overview', '', 'Sale Closed Date,Tips', '2026-09-20,12.50'));
    assert.deepEqual(rows, [{ sale_closed_date: '2026-09-20', tips: '12.50' }]);
  });

  it('normalises headers the way the column finders expect', () => {
    const rows = csvObjects(csv('﻿Sales Data Sale Closed Date,Payments Tip Amount', '2026-09-20,1.00'));
    assert.deepEqual(Object.keys(rows[0]!), ['sales_data_sale_closed_date', 'payments_tip_amount']);
  });
});

describe('column finders', () => {
  it('finds the Looker-prefixed and -suffixed date column a fixed list missed', () => {
    const rows = [{ sales_data_sale_closed_date_date: '2026-09-20', payments_tip_amount: '1.00' }];
    assert.equal(findDateColumn(Object.keys(rows[0]!), rows), 'sales_data_sale_closed_date_date');
    const feed = [{ saledate: '20/09/2026 18:32', saleid: 'SP-1', tip: '2.00' }];
    assert.equal(findDateColumn(Object.keys(feed[0]!), feed), 'saledate');
    const payments = [{ payments_payment_date: '2026-09-20', site: 'Avalon', tips: '1.00' }];
    assert.equal(findDateColumn(Object.keys(payments[0]!), payments), 'payments_payment_date');
  });

  it('never takes a week, month, day-of-week or days-open column as the date', () => {
    const rows = [{ sale_closed_week: '2026-09-14', sale_closed_day_of_week: 'Sunday', days_open: '7', tips: '1.00' }];
    assert.equal(findDateColumn(Object.keys(rows[0]!), rows), null);
  });

  it('prefers the sale date over an incidental created/updated stamp', () => {
    const rows = [{ created_at: '2026-09-21 06:00', sale_closed_date: '2026-09-20', tips: '1.00' }];
    assert.equal(findDateColumn(Object.keys(rows[0]!), rows), 'sale_closed_date');
  });

  it('rejects a "Date" header whose cells are not dates', () => {
    const rows = [{ date: 'Bar', tips: '1.00' }, { date: 'Restaurant', tips: '1.00' }];
    assert.equal(findDateColumn(Object.keys(rows[0]!), rows), null);
  });

  it('picks one tips column, the most total-looking, and never a rate or a count', () => {
    assert.equal(findTipColumn(['card_tips', 'total_tips', 'tips_rate']), 'total_tips');
    assert.equal(findTipColumn(['payments_tip_amount']), 'payments_tip_amount');
    assert.equal(findTipColumn(['gratuity_inc_gst']), 'gratuity_inc_gst');
    assert.equal(findTipColumn(['tip_percent', 'tips_count', 'number_of_tips']), null);
    assert.equal(findTipColumn(['tipping_point']), null);
    assert.equal(findTipColumn(['net_sales', 'total_inc_tax']), null);
  });

  it('finds the sale id column of a per-sale export and ignores other ids', () => {
    assert.equal(findRowIdColumn(['saleid', 'saledate', 'tip']), 'saleid');
    assert.equal(findRowIdColumn(['sales_data_sale_id', 'tips']), 'sales_data_sale_id');
    assert.equal(findRowIdColumn(['receipt_no', 'tips']), 'receipt_no');
    assert.equal(findRowIdColumn(['transaction_number']), 'transaction_number');
    assert.equal(findRowIdColumn(['product_id', 'site_id', 'employee_id', 'tips']), null);
  });
});

describe('parseTipsFromCsv', () => {
  it('reads the reconciliation shape: the day total repeated per revenue centre, date carried across split rows', () => {
    const parsed = parseTipsFromCsv(csv(
      'Sales Data Sale Closed Date,Revenue Centre,Sales Data Total Tips',
      '2026-09-20,,',
      ',Bar,161.05',
      ',Restaurant,161.05',
      ',Takeaway,161.05'
    ));
    assert.equal(parsed.sawTipsColumn, true);
    assert.equal(parsed.columns.date, 'sales_data_sale_closed_date');
    assert.deepEqual(parsed.rows.map((row) => [row.dateKey, row.tipCents, row.rowId]), [
      ['2026-09-20', 16105, null],
      ['2026-09-20', 16105, null],
      ['2026-09-20', 16105, null]
    ]);
    const [day] = totalTipsPerDay(parsed.rows.map((row) => ({ venue: 'Alma Avalon', dateKey: row.dateKey!, tipCents: row.tipCents, rowId: row.rowId })));
    assert.equal(day?.cents, 16105);
    assert.equal(day?.repeated, true);
  });

  it('reads the sales-feed export: one row per sale, dated by the sale, identified by SaleID', () => {
    const parsed = parseTipsFromCsv(csv(
      'SaleID,SaleDate,SiteName,Total,Tip',
      'SP-Til23 0920184819,20/09/2026 18:48,Alma,84.00,10.00',
      'SP-Til23 0920191203,20/09/2026 19:12,Alma,52.00,10.00',
      'SP-Til23 0920201500,20/09/2026 20:15,Alma,120.00,0.00',
      'SP-Til23 0921120000,21/09/2026 12:00,Alma,40.00,5.00'
    ));
    assert.equal(parsed.columns.id, 'saleid');
    assert.equal(parsed.columns.date, 'saledate');
    const days = totalTipsPerDay(parsed.rows.map((row) => ({ venue: 'Alma Avalon', dateKey: row.dateKey!, tipCents: row.tipCents, rowId: row.rowId })));
    assert.deepEqual(days.map((day) => [day.dateKey, day.cents, day.saleIds]), [
      ['2026-09-20', 2000, 3],
      ['2026-09-21', 500, 1]
    ]);
    // Two $10 sales are $20 — the repeated-total rule must not apply to identified sales.
    assert.equal(days[0]?.repeated, false);
  });

  it('marks rows as undated when the report has no date column at all', () => {
    const parsed = parseTipsFromCsv(csv('Revenue Centre,Tips', 'Bar,10.00', 'Restaurant,10.00'));
    assert.equal(parsed.columns.date, null);
    assert.deepEqual(parsed.rows.map((row) => row.dateKey), [null, null]);
  });

  it('reads the venue from a site column when there is one', () => {
    const parsed = parseTipsFromCsv(csv('Sites Site Name,Sale Closed Date,Tips', 'Alma Avalon,2026-09-20,10.00'));
    assert.equal(parsed.columns.venue, 'sites_site_name');
    assert.equal(parsed.rows[0]?.venueRaw, 'Alma Avalon');
  });

  it('sees no tips column in a plain sales digest', () => {
    const parsed = parseTipsFromCsv(csv('Product,Quantity,Net Sales', 'Barramundi Taco,12,240.00'));
    assert.equal(parsed.sawTipsColumn, false);
    assert.equal(parsed.rows.length, 0);
  });

  it('skips blank tip cells rather than reading them as $0', () => {
    const parsed = parseTipsFromCsv(csv('Sale Closed Date,Tips', '2026-09-20,', '2026-09-20,12.00'));
    assert.deepEqual(parsed.rows.map((row) => row.tipCents), [1200]);
  });
});

describe('attachment names', () => {
  it('rankings feed nothing; summary tiles feed tips but not item sales', () => {
    assert.equal(isRankingFragment('top_10_products.csv'), true);
    assert.equal(isDigestFragment('top_10_products.csv'), true);
    assert.equal(isRankingFragment('untitled.csv'), false);
    assert.equal(isDigestFragment('untitled.csv'), true);
    assert.equal(isRankingFragment('summary_of_payments.csv'), false);
    assert.equal(isDigestFragment('summary_of_payments.csv'), true);
    assert.equal(isRankingFragment('site_reconciliation.csv'), false);
    assert.equal(isDigestFragment('site_reconciliation.csv'), false);
  });
});

describe('mergeAttachmentTips', () => {
  const day = (filename: string, dateKey: string, cents: number, rows = 1, guessedDate = false) => ({
    filename,
    days: [{ venue: 'Alma Avalon', dateKey, cents, rows, repeated: rows > 1, guessedDate, saleIds: 0 }]
  });

  it('keeps one attachment as it is', () => {
    const { days, disputed } = mergeAttachmentTips([day('a.csv', '2026-09-20', 16105, 3)]);
    assert.equal(disputed.length, 0);
    assert.deepEqual(days.map((d) => [d.dateKey, d.cents, d.files]), [['2026-09-20', 16105, ['a.csv']]]);
  });

  it('two tiles carrying the same day total are one figure, not double', () => {
    const { days, disputed } = mergeAttachmentTips([day('summary.csv', '2026-09-20', 16105, 3), day('payments.csv', '2026-09-20', 16105, 1)]);
    assert.equal(disputed.length, 0);
    assert.equal(days.length, 1);
    assert.equal(days[0]?.cents, 16105);
    assert.deepEqual(days[0]?.files, ['summary.csv', 'payments.csv']);
  });

  it('two tiles that disagree record nothing and name both figures', () => {
    const { days, disputed } = mergeAttachmentTips([day('a.csv', '2026-09-20', 16105), day('b.csv', '2026-09-20', 20000)]);
    assert.equal(days.length, 0);
    assert.deepEqual(disputed, [{
      venue: 'Alma Avalon',
      dateKey: '2026-09-20',
      figures: [{ filename: 'a.csv', cents: 16105, rows: 1 }, { filename: 'b.csv', cents: 20000, rows: 1 }]
    }]);
  });

  it('describes an agreed day by its dated tile rather than a guessed one', () => {
    const { days } = mergeAttachmentTips([day('guessed.csv', '2026-09-20', 16105, 1, true), day('dated.csv', '2026-09-20', 16105, 3, false)]);
    assert.equal(days[0]?.guessedDate, false);
    assert.equal(days[0]?.rows, 3);
  });

  it('keeps different days and venues apart', () => {
    const { days } = mergeAttachmentTips([day('a.csv', '2026-09-20', 100), day('a.csv', '2026-09-21', 200)]);
    assert.deepEqual(days.map((d) => d.dateKey).sort(), ['2026-09-20', '2026-09-21']);
  });
});
