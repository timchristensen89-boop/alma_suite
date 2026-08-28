import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { totalTipsPerDay } from './tip-rows.js';

const row = (dateKey: string, tipCents: number, venue = 'Alma Avalon') => ({ venue, dateKey, tipCents });
// A row the report gave no date for, filed under the email's fallback day.
const undated = (dateKey: string, tipCents: number, venue = 'Alma Avalon') => ({
  venue,
  dateKey,
  tipCents,
  dated: false
});

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

  it('marks a day whose every row carried a date as known, not guessed', () => {
    const [day] = totalTipsPerDay([row('2026-08-19', 5000), row('2026-08-19', 2500)]);
    assert.equal(day?.guessedDate, false);
  });

  it('marks a day as guessed only when NO row carried a date', () => {
    // One dated row is enough to anchor the day: the others belong to it.
    const [day] = totalTipsPerDay([row('2026-08-19', 5000), undated('2026-08-19', 2500)]);
    assert.equal(day?.guessedDate, false);
  });

  it('flags the shape that lost Alma Avalon its Saturday', () => {
    // 23 August 2026: the report stopped carrying a date column, so 14 rows
    // spanning more than one trading day all landed on "yesterday" and were
    // added up to $681.87 — filed as a single Sunday against $2,382 of sales.
    const fourteen = [
      68187 - 13 * 1000,
      ...Array.from({ length: 13 }, () => 1000)
    ].map((cents) => undated('2026-08-23', cents));
    const [day] = totalTipsPerDay(fourteen);
    assert.equal(day?.cents, 68187);
    assert.equal(day?.rows, 14);
    assert.equal(day?.repeated, false);
    assert.equal(day?.guessedDate, true);
  });

  it('does not flag a single undated row — a one-row daily report is fine', () => {
    const [day] = totalTipsPerDay([undated('2026-08-19', 16105)]);
    assert.equal(day?.cents, 16105);
    assert.equal(day?.rows, 1);
    assert.equal(day?.guessedDate, true);
  });

  it('still counts an undated repeated total once', () => {
    // Undated AND repeated: the repeat guard resolves it, so the caller has a
    // trustworthy figure and does not need to refuse it.
    const [day] = totalTipsPerDay([
      undated('2026-08-19', 16105),
      undated('2026-08-19', 16105),
      undated('2026-08-19', 16105)
    ]);
    assert.equal(day?.cents, 16105);
    assert.equal(day?.repeated, true);
    assert.equal(day?.guessedDate, true);
  });
});
