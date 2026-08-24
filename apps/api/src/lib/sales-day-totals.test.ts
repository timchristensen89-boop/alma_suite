import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bestVenueDaySales, dedupedSalesCents, dedupedSalesByVenue } from './sales-day-totals.js';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('sales-day-totals — one figure per venue-day', () => {
  it('two feeds reporting the same day are the same money, not double', () => {
    const rows = [
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 812_000 }, // POS close
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 809_500 } // Square import
    ];
    assert.equal(dedupedSalesCents(rows), 812_000);
  });

  it('different venues on the same day both count', () => {
    const rows = [
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 812_000 },
      { venue: 'Alma Avalon', serviceDate: day('2026-08-22'), salesCents: 640_000 }
    ];
    assert.equal(dedupedSalesCents(rows), 1_452_000);
  });

  it('different days at one venue both count', () => {
    const rows = [
      { venue: 'St Alma', serviceDate: day('2026-08-21'), salesCents: 500_000 },
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 812_000 }
    ];
    assert.equal(dedupedSalesCents(rows), 1_312_000);
  });

  it('per-venue rollup counts distinct trading days, not rows', () => {
    const rows = [
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 812_000 },
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 800_000 },
      { venue: 'St Alma', serviceDate: day('2026-08-23'), salesCents: 400_000 }
    ];
    const byVenue = dedupedSalesByVenue(rows);
    assert.deepEqual(byVenue.get('St Alma'), { salesCents: 1_212_000, days: 2 });
  });

  it('a venue name containing | cannot collide across days', () => {
    // The key joins on | — the venue half is everything before the LAST one.
    const rows = [{ venue: 'Pop|Up', serviceDate: day('2026-08-22'), salesCents: 100 }];
    assert.deepEqual(dedupedSalesByVenue(rows).get('Pop|Up'), { salesCents: 100, days: 1 });
  });

  it('best-per-day map keeps the max of each feed', () => {
    const rows = [
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 700 },
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 900 },
      { venue: 'St Alma', serviceDate: day('2026-08-22'), salesCents: 800 }
    ];
    assert.equal(bestVenueDaySales(rows).get('St Alma|2026-08-22'), 900);
  });
});
