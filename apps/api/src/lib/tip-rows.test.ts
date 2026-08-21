import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { totalTipsPerDay } from './tip-rows.js';

const row = (dateKey: string, tipCents: number, venue = 'Alma Avalon') => ({ venue, dateKey, tipCents });

describe('totalTipsPerDay', () => {
  it('counts a repeated day total once', () => {
    // Alma Avalon, 19 August 2026: three revenue-centre rows, each carrying the
    // day's $161.05 rather than its own share. Summed, the night paid out $483.15.
    const [day] = totalTipsPerDay([row('2026-08-19', 16105), row('2026-08-19', 16105), row('2026-08-19', 16105)]);
    assert.equal(day?.cents, 16105);
    assert.equal(day?.rows, 3);
    assert.equal(day?.repeated, true);
  });

  it('still adds up rows that carry different amounts', () => {
    const [day] = totalTipsPerDay([row('2026-08-19', 5000), row('2026-08-19', 2500), row('2026-08-19', 1000)]);
    assert.equal(day?.cents, 8500);
    assert.equal(day?.repeated, false);
  });

  it('adds up when only some rows repeat', () => {
    // Two lanes tipped $50 and one tipped $25 — parts, not a repeated total.
    const [day] = totalTipsPerDay([row('2026-08-19', 5000), row('2026-08-19', 5000), row('2026-08-19', 2500)]);
    assert.equal(day?.cents, 12500);
    assert.equal(day?.repeated, false);
  });

  it('leaves a single row exactly as it found it', () => {
    const [day] = totalTipsPerDay([row('2026-08-19', 16105)]);
    assert.equal(day?.cents, 16105);
    assert.equal(day?.repeated, false);
  });

  it('does not call a day of zeroes a repeated total', () => {
    const [day] = totalTipsPerDay([row('2026-08-22', 0), row('2026-08-22', 0)]);
    assert.equal(day?.cents, 0);
    assert.equal(day?.repeated, false);
  });

  it('keeps venues and days apart', () => {
    const days = totalTipsPerDay([
      row('2026-08-19', 16105),
      row('2026-08-19', 16105),
      row('2026-08-20', 6635),
      row('2026-08-19', 40000, 'St Alma'),
      row('2026-08-19', 20000, 'St Alma')
    ]);
    assert.deepEqual(
      days.map((d) => [d.venue, d.dateKey, d.cents]),
      [
        ['Alma Avalon', '2026-08-19', 16105],
        ['Alma Avalon', '2026-08-20', 6635],
        ['St Alma', '2026-08-19', 60000]
      ]
    );
  });

  it('reproduces the week that was paid at three times the takings', () => {
    // The four Avalon rows as they were imported, each day's total on 3 rows.
    const emailed = ['2026-08-19', '2026-08-20', '2026-08-21'].flatMap((dateKey, index) =>
      Array.from({ length: 3 }, () => row(dateKey, [16105, 6635, 10885][index]!))
    );
    const total = totalTipsPerDay(emailed).reduce((sum, day) => sum + day.cents, 0);
    assert.equal(total, 33625);
  });
});
