import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessStocktakeValuation, type StocktakeScope } from '@alma/shared';
import { composeBoundary, computeActualCogsWith, stockBracket, stockValueAtCentsWith, type CogsReader, type ScopedCount } from './cogs-core.js';

// A fake of the stock and purchase tables, keyed the way the reader reads
// them, so every test states its population explicitly. A count's scope
// defaults to COMBINED here (the tests below about scope say otherwise
// explicitly); `unvaluedLines` adds lines counted above zero with no value.
type Count = {
  id: string;
  venue: string | null;
  countedAt: Date;
  status: string;
  valueCents: number;
  scope?: StocktakeScope;
  unvaluedLines?: number;
  name?: string;
};
type Invoice = { venue: string | null; invoiceDate: Date; cents: number; status?: string };

const FINALISED = new Set(['SUBMITTED', 'REVIEWED', 'LOCKED']);
const utc = (iso: string) => new Date(iso);

const CONFIGURED = ['Alma Avalon', 'St Alma'];

function scoped(c: Count): ScopedCount {
  // Three valued lines carrying the value, plus any unvalued ones.
  const lines = [
    { itemId: 'a', countedQty: 1, stockValueCents: c.valueCents - 2 },
    { itemId: 'b', countedQty: 1, stockValueCents: 1 },
    { itemId: 'c', countedQty: 2, stockValueCents: 1 },
    ...Array.from({ length: c.unvaluedLines ?? 0 }, () => ({ itemId: null, countedQty: 3, stockValueCents: null }))
  ];
  return { id: c.id, name: c.name ?? c.id, countedAt: c.countedAt, scope: c.scope ?? 'COMBINED', valuation: assessStocktakeValuation(lines) };
}

function fakeReader(counts: Count[], invoices: Invoice[] = [], configured: string[] = CONFIGURED): CogsReader {
  const label = (c: Count) => c.venue ?? '';
  const finalised = (labels: string[]) => counts.filter((c) => labels.includes(label(c)) && FINALISED.has(c.status));
  return {
    async configuredVenues() {
      return configured;
    },
    async storedCountVenueLabels(at) {
      return [...new Set(counts.filter((c) => FINALISED.has(c.status) && c.countedAt <= at).map(label))];
    },
    async finalisedCountsNear(labels, window) {
      return finalised(labels)
        .filter((c) => c.countedAt >= window.gte && c.countedAt <= window.lte)
        .map(scoped);
    },
    async countsUnderLabels(labels, at) {
      return finalised(labels)
        .filter((c) => c.countedAt <= at)
        .map((c) => ({ label: label(c), countedAt: c.countedAt, valueCents: c.valueCents }));
    },
    async purchasesExGstCents(venue, start, end) {
      return invoices
        .filter((i) => (i.status ?? 'AUTHORISED') !== 'DRAFT' && i.invoiceDate >= start && i.invoiceDate < end && (venue == null || i.venue === venue))
        .reduce((sum, i) => sum + i.cents, 0);
    },
    async unattributedPurchases(start, end) {
      const rows = invoices.filter((i) => i.venue == null && i.invoiceDate >= start && i.invoiceDate < end);
      return { cents: rows.reduce((sum, i) => sum + i.cents, 0), invoices: rows.length };
    }
  };
}

// June and July 2026 as venue months: Sydney is UTC+10 in winter.
const JUNE = { start: utc('2026-05-31T14:00:00Z'), end: utc('2026-06-30T14:00:00Z') };
const JULY = { start: utc('2026-06-30T14:00:00Z'), end: utc('2026-07-31T14:00:00Z') };
const PURCHASES = [{ venue: 'Alma Avalon', invoiceDate: utc('2026-06-10T00:00:00Z'), cents: 400_000 }];

describe('actual COGS = opening + purchases − closing, only with two complete boundaries', () => {
  it('two combined counts within the window of each boundary give a complete, stock-bounded figure', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'complete');
    assert.equal(cogs.source, 'stock_bounded');
    assert.equal(cogs.cogsCents, 1_000_000 + 400_000 - 800_000);
    assert.equal(cogs.openingStockCents, 1_000_000);
    assert.equal(cogs.closingStockCents, 800_000);
    assert.equal(cogs.opening.composition, 'combined');
    assert.deepEqual(cogs.opening.components.map((c) => c.stocktakeIds), [['o']]);
    assert.deepEqual(cogs.reasons, []);
  });

  it('the symptom: one old count near neither boundary must NOT read as complete', async () => {
    // A single March count used to become opening AND closing, so COGS =
    // purchases, labelled complete.
    const reader = fakeReader([{ id: 'm', venue: 'Alma Avalon', countedAt: utc('2026-03-15T03:00:00Z'), status: 'LOCKED', valueCents: 900_000 }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'estimated');
    assert.equal(cogs.source, 'purchases_only');
    assert.equal(cogs.cogsCents, 400_000);
    assert.equal(cogs.openingStockCents, null);
    assert.equal(cogs.closingStockCents, null);
    assert.equal(cogs.opening.status, 'missing');
    assert.equal(cogs.closing.status, 'missing');
    assert.match(cogs.reasons.join(' '), /no finalised stocktake within 7 days of 2026-06-01/);
  });

  it('a valid opening with a closing outside the window names the closing boundary as missing', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-10T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 } // 20 days before 30 Jun
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'missing_closing');
    assert.equal(cogs.openingStockCents, 1_000_000);
    assert.equal(cogs.closingStockCents, null);
    assert.match(cogs.reasons[0] ?? '', /Closing stock is unavailable.*within 7 days of 2026-07-01/);
  });

  it('draft and in-progress counts are never boundaries', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'IN_PROGRESS', valueCents: 1_000_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'missing_opening');
  });

  it('closing above opening + purchases is reported as implausible, with both values kept', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 100_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 9_000_000 }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'closing_implausible');
    assert.equal(cogs.cogsCents, 400_000);
    assert.equal(cogs.closingStockCents, 9_000_000);
  });
});

describe('scope: a boundary is one COMBINED count, or one FOOD count plus one BEVERAGE count', () => {
  const at = utc('2026-08-31T14:00:00Z'); // 1 Sep 00:00 Sydney = the Aug/Sep boundary
  const count = (id: string, scope: StocktakeScope, iso: string, valueCents: number, extra: Partial<Count> = {}): ScopedCount =>
    scoped({ id, venue: 'St Alma', countedAt: utc(iso), status: 'SUBMITTED', valueCents, scope, ...extra });

  it('a valid COMBINED count satisfies the boundary', () => {
    const b = composeBoundary([count('full', 'COMBINED', '2026-08-31T07:00:00Z', 5_000_000)], at);
    assert.equal(b.status, 'ok');
    assert.equal(b.composition, 'combined');
    assert.equal(b.valueCents, 5_000_000);
    assert.equal(b.distanceDays, 0);
  });

  it('a FOOD count alone refuses — it is not the venue\'s stock, however near the boundary', () => {
    const b = composeBoundary([count('kitchen', 'FOOD', '2026-08-31T07:00:00Z', 440_127)], at);
    assert.equal(b.status, 'incomplete');
    assert.equal(b.valueCents, null);
    assert.deepEqual(b.rejected.map((r) => [r.stocktakeId, r.reason]), [['kitchen', 'no_counterpart']]);
    assert.match(b.rejected[0]!.detail, /no BEVERAGE count within 7 days/);
  });

  it('a BEVERAGE count alone refuses the same way', () => {
    const b = composeBoundary([count('bar', 'BEVERAGE', '2026-09-01T05:00:00Z', 2_087_049)], at);
    assert.equal(b.status, 'incomplete');
    assert.deepEqual(b.rejected.map((r) => r.reason), ['no_counterpart']);
  });

  it('a FOOD count and a BEVERAGE count compose: the values sum, both components are kept, distance is the furthest', () => {
    // The real 31 Aug St Alma pair: kitchen 30 Aug 15:50Z, bar 30 Aug 17:00Z.
    const b = composeBoundary(
      [count('kitchen', 'FOOD', '2026-08-30T15:50:00Z', 440_127), count('bar', 'BEVERAGE', '2026-08-30T17:00:00Z', 5_013_609)],
      at
    );
    assert.equal(b.status, 'ok');
    assert.equal(b.composition, 'food_and_beverage');
    assert.equal(b.valueCents, 440_127 + 5_013_609);
    assert.deepEqual(
      b.components.map((c) => [c.scope, c.countedOn, c.valueCents, c.stocktakeIds, c.side]),
      [
        ['FOOD', '2026-08-31', 440_127, ['kitchen'], 'before'],
        ['BEVERAGE', '2026-08-31', 5_013_609, ['bar'], 'before']
      ]
    );
    assert.equal(b.distanceDays, 0);
    assert.deepEqual(b.warnings, []);
  });

  it('an UNKNOWN-scope count refuses and says why, even when it is the only count and sits on the boundary', () => {
    const b = composeBoundary([count('legacy', 'UNKNOWN', '2026-08-31T07:00:00Z', 4_833_95)], at);
    assert.equal(b.status, 'incomplete');
    assert.deepEqual(b.rejected.map((r) => r.reason), ['unknown_scope']);
    assert.match(b.rejected[0]!.detail, /never inferred from its value/);
  });

  it('a count with unvalued counted lines refuses however plausible its total', () => {
    // 151 of 311 lines unlinked and unvalued: the St Alma 2 June bar count.
    const b = composeBoundary([count('bar', 'COMBINED', '2026-08-31T07:00:00Z', 2_181_124, { unvaluedLines: 151 })], at);
    assert.equal(b.status, 'incomplete');
    assert.deepEqual(b.rejected.map((r) => r.reason), ['unvalued']);
    assert.match(b.rejected[0]!.detail, /151 of 154 counted lines carry no value/);
  });

  it('a FOOD + BEVERAGE pair with one unvalued component is not complete', () => {
    const b = composeBoundary(
      [count('kitchen', 'FOOD', '2026-08-30T15:50:00Z', 440_127, { unvaluedLines: 2 }), count('bar', 'BEVERAGE', '2026-08-30T17:00:00Z', 5_013_609)],
      at
    );
    assert.equal(b.status, 'incomplete');
    assert.deepEqual(b.rejected.map((r) => [r.stocktakeId, r.reason]).sort(), [['bar', 'no_counterpart'], ['kitchen', 'unvalued']]);
  });

  it('components more than 3 days apart still compose, with an explicit warning and no invented movement', () => {
    const b = composeBoundary(
      [count('kitchen', 'FOOD', '2026-08-26T07:00:00Z', 400_000), count('bar', 'BEVERAGE', '2026-09-01T07:00:00Z', 5_000_000)],
      at
    );
    assert.equal(b.status, 'ok');
    assert.equal(b.valueCents, 5_400_000);
    assert.equal(b.distanceDays, 5);
    assert.match(b.warnings[0] ?? '', /FOOD \(2026-08-26\) and BEVERAGE \(2026-09-01\) counts are 6 days apart/);
  });

  it('components 3 days apart or less carry no warning', () => {
    const b = composeBoundary(
      [count('kitchen', 'FOOD', '2026-08-29T07:00:00Z', 400_000), count('bar', 'BEVERAGE', '2026-09-01T07:00:00Z', 5_000_000)],
      at
    );
    assert.equal(b.status, 'ok');
    assert.deepEqual(b.warnings, []);
  });

  it('the window is ±7 days: day 7 either side qualifies, day 8 does not', () => {
    const inside = composeBoundary([count('c', 'COMBINED', '2026-08-24T14:00:00Z', 1)], at); // exactly 7 days before
    assert.equal(inside.status, 'ok');
    const after = composeBoundary([count('c', 'COMBINED', '2026-09-07T13:59:00Z', 1)], at); // 6.99 days after
    assert.equal(after.status, 'ok');
    const outside = composeBoundary([count('c', 'COMBINED', '2026-08-23T13:00:00Z', 1)], at); // 8 days before
    assert.equal(outside.status, 'missing');
    assert.deepEqual(outside.rejected, []);
  });

  it('duplicates of one scope: the nearest wins and the other is listed as a duplicate', () => {
    const b = composeBoundary(
      [count('near', 'COMBINED', '2026-08-30T07:00:00Z', 100), count('far', 'COMBINED', '2026-08-27T07:00:00Z', 200)],
      at
    );
    assert.equal(b.valueCents, 100);
    assert.deepEqual(b.rejected.map((r) => [r.stocktakeId, r.reason]), [['far', 'duplicate']]);
  });

  it('a distance tie is deterministic: the count on or before the boundary wins', () => {
    const before = count('before', 'COMBINED', '2026-08-31T07:00:00Z', 100); // 7 hours before
    const after = count('after', 'COMBINED', '2026-08-31T21:00:00Z', 200); // 7 hours after
    assert.equal(composeBoundary([before, after], at).components[0]!.stocktakeIds[0], 'before');
    assert.equal(composeBoundary([after, before], at).components[0]!.stocktakeIds[0], 'before');
  });

  it('a COMBINED count and a FOOD + BEVERAGE pair at equal distance: the single count wins; a nearer pair wins', () => {
    const full = count('full', 'COMBINED', '2026-08-31T07:00:00Z', 5_000_000);
    const kitchen = count('kitchen', 'FOOD', '2026-08-31T08:00:00Z', 400_000);
    const bar = count('bar', 'BEVERAGE', '2026-08-31T09:00:00Z', 4_500_000);
    assert.equal(composeBoundary([full, kitchen, bar], at).composition, 'combined');
    const farFull = count('full', 'COMBINED', '2026-08-27T07:00:00Z', 5_000_000);
    const nearer = composeBoundary([farFull, kitchen, bar], at);
    assert.equal(nearer.composition, 'food_and_beverage');
    assert.equal(nearer.valueCents, 4_900_000);
  });

  it('sessions of one scope on one venue day are one count, either side of UTC midnight', () => {
    // 09:30 and 10:30 Sydney on 31 Aug = 23:30 UTC 30 Aug and 00:30 UTC 31 Aug.
    const b = composeBoundary(
      [count('bar1', 'BEVERAGE', '2026-08-30T23:30:00Z', 704_872), count('bar2', 'BEVERAGE', '2026-08-31T00:30:00Z', 6_297_678), count('kitchen', 'FOOD', '2026-08-31T05:00:00Z', 10)],
      at
    );
    assert.equal(b.status, 'ok');
    assert.equal(b.valueCents, 704_872 + 6_297_678 + 10);
    assert.deepEqual(b.components.find((c) => c.scope === 'BEVERAGE')!.stocktakeIds, ['bar1', 'bar2']);
  });
});

describe('boundaries between adjacent periods are shared, and never drift', () => {
  // The real September opening: St Alma kitchen + bar on 30/31 Aug.
  const counts: Count[] = [
    { id: 'jun-k', venue: 'St Alma', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 300_000, scope: 'FOOD' },
    { id: 'jun-b', venue: 'St Alma', countedAt: utc('2026-06-30T04:00:00Z'), status: 'LOCKED', valueCents: 5_000_000, scope: 'BEVERAGE' },
    { id: 'jul-k', venue: 'St Alma', countedAt: utc('2026-07-31T03:00:00Z'), status: 'LOCKED', valueCents: 250_000, scope: 'FOOD' },
    { id: 'jul-b', venue: 'St Alma', countedAt: utc('2026-08-01T00:00:00Z'), status: 'LOCKED', valueCents: 4_800_000, scope: 'BEVERAGE' },
    { id: 'aug-k', venue: 'St Alma', countedAt: utc('2026-08-30T15:50:00Z'), status: 'SUBMITTED', valueCents: 440_127, scope: 'FOOD' },
    { id: 'aug-b', venue: 'St Alma', countedAt: utc('2026-08-30T17:00:00Z'), status: 'SUBMITTED', valueCents: 5_013_609, scope: 'BEVERAGE' }
  ];

  it('June\'s closing and July\'s opening are the same composition of the same records', async () => {
    const reader = fakeReader(counts);
    const june = await computeActualCogsWith(reader, { venue: 'St Alma', ...JUNE });
    const july = await computeActualCogsWith(reader, { venue: 'St Alma', ...JULY });
    assert.equal(june.closing.status, 'ok');
    assert.equal(july.quality, 'complete');
    assert.deepEqual(june.closing.components, july.opening.components);
    assert.equal(june.closingStockCents, july.openingStockCents);
  });

  it('a period does not drift forward onto the next period\'s counts when nearer ones exist at its own boundary', async () => {
    const reader = fakeReader(counts);
    const july = await computeActualCogsWith(reader, { venue: 'St Alma', ...JULY });
    assert.deepEqual(july.closing.components.map((c) => c.stocktakeIds).flat().sort(), ['jul-b', 'jul-k']);
    const august = await computeActualCogsWith(reader, { venue: 'St Alma', start: JULY.end, end: utc('2026-08-31T14:00:00Z') });
    assert.deepEqual(august.opening.components.map((c) => c.stocktakeIds).flat().sort(), ['jul-b', 'jul-k']);
    assert.deepEqual(august.closing.components.map((c) => c.stocktakeIds).flat().sort(), ['aug-b', 'aug-k']);
  });

  it('a food-only boundary makes the period unavailable — never food-only stock against combined purchases', async () => {
    // Alma Avalon June as it stands: 31 May food-only opening, 30 June ambiguous (UNKNOWN) closing.
    const reader = fakeReader(
      [
        { id: 'may-food', venue: 'Alma Avalon', countedAt: utc('2026-05-30T16:00:00Z'), status: 'REVIEWED', valueCents: 408_811, scope: 'FOOD' },
        { id: 'jun-unknown', venue: 'Alma Avalon', countedAt: utc('2026-06-29T16:00:00Z'), status: 'LOCKED', valueCents: 483_395, scope: 'UNKNOWN' }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'estimated');
    assert.equal(cogs.opening.status, 'incomplete');
    assert.equal(cogs.closing.status, 'incomplete');
    assert.match(cogs.reasons[0] ?? '', /a FOOD count \(2026-05-31, \$4,088\.11\) has no BEVERAGE counterpart/);
    assert.match(cogs.reasons[1] ?? '', /1 count of unknown scope \(2026-06-30, \$4,833\.95\)/);
    assert.equal(cogs.cogsCents, 400_000);
  });
});

describe('stock on hand is the latest complete count inside the window, not the sum of every count ever taken', () => {
  it('three historical counts contribute nothing to the current value', async () => {
    const reader = fakeReader([
      { id: 'jan', venue: 'Alma Avalon', countedAt: utc('2026-01-31T03:00:00Z'), status: 'LOCKED', valueCents: 4_000_000 },
      { id: 'mar', venue: 'Alma Avalon', countedAt: utc('2026-03-31T03:00:00Z'), status: 'LOCKED', valueCents: 4_500_000 },
      { id: 'may', venue: 'Alma Avalon', countedAt: utc('2026-05-31T03:00:00Z'), status: 'LOCKED', valueCents: 4_200_000 },
      { id: 'jun', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
    ]);
    // The old summary aggregate would have said $135,000.
    assert.equal(await stockValueAtCentsWith(reader, 'Alma Avalon', utc('2026-07-05T00:00:00Z')), 800_000);
    const bracket = await stockBracket(reader, 'Alma Avalon', utc('2026-07-05T00:00:00Z'));
    assert.equal(bracket.countedOn, '2026-06-30');
  });

  it('and once that count is outside the window, the value is unavailable — not the old figure', async () => {
    const reader = fakeReader([{ id: 'jun', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }]);
    assert.equal(await stockValueAtCentsWith(reader, 'Alma Avalon', utc('2026-08-01T00:00:00Z')), null);
    // An operational tile may pass its own (freshness) window.
    assert.equal(await stockValueAtCentsWith(reader, 'Alma Avalon', utc('2026-07-10T00:00:00Z'), 14), 800_000);
  });
});

describe('the all-venues figure is Σ venues, never the sum of whichever venues happened to count', () => {
  const avalonJune: Count[] = [
    { id: 'ao', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
    { id: 'ac', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
  ];
  const stAlmaJune: Count[] = [
    { id: 'so', venue: 'St Alma', countedAt: utc('2026-05-29T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 },
    { id: 'sc', venue: 'St Alma', countedAt: utc('2026-06-29T03:00:00Z'), status: 'LOCKED', valueCents: 1_500_000 }
  ];

  it('sums every venue when each has a complete boundary', async () => {
    const reader = fakeReader([...avalonJune, ...stAlmaJune], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: null, ...JUNE });
    assert.equal(cogs.quality, 'complete');
    assert.equal(cogs.openingStockCents, 3_000_000);
    assert.equal(cogs.closingStockCents, 2_300_000);
    assert.equal(cogs.cogsCents, 3_000_000 + 400_000 - 2_300_000);
    assert.equal(cogs.opening.components.length, 2);
  });

  it('a venue with no valid count makes the group boundary unavailable and is named', async () => {
    const reader = fakeReader([...avalonJune, { id: 's', venue: 'St Alma', countedAt: utc('2026-03-01T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: null, ...JUNE });
    assert.equal(cogs.source, 'purchases_only');
    assert.equal(cogs.quality, 'estimated');
    assert.equal(cogs.openingStockCents, null);
    assert.deepEqual(cogs.opening.venuesWithoutCount.map((v) => [v.venue, v.status]), [['St Alma', 'missing']]);
    assert.match(cogs.reasons[0] ?? '', /St Alma: no finalised stocktake within 7 days/);
    assert.equal(await stockValueAtCentsWith(reader, null, JUNE.end), null);
  });

  it('a venue whose only count near the boundary is food-only makes the group incomplete and says so', async () => {
    const reader = fakeReader([...avalonJune, { id: 'sk', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 200_000, scope: 'FOOD' }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: null, ...JUNE });
    assert.equal(cogs.opening.status, 'incomplete');
    assert.deepEqual(cogs.opening.venuesWithoutCount.map((v) => [v.venue, v.status]), [['St Alma', 'incomplete']]);
    assert.match(cogs.reasons[0] ?? '', /St Alma: a FOOD count \(2026-05-30, \$2,000\.00\) has no BEVERAGE counterpart/);
  });

  it('untagged (venue-null) counts do not create a phantom venue', async () => {
    const reader = fakeReader([...avalonJune, ...stAlmaJune, { id: 'both', venue: null, countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 5_000_000 }], []);
    const bracket = await stockBracket(reader, null, JUNE.end);
    assert.equal(bracket.status, 'ok');
    assert.equal(bracket.valueCents, 800_000 + 1_500_000);
    assert.deepEqual(bracket.offVenueCounts.map((c) => [c.sourceLabel, c.resolution, c.valueCents]), [['', 'blank', 5_000_000]]);
  });
});

describe('configured venues define the group population; every other label is unattributed data', () => {
  const fixture: Count[] = [
    { id: 'ao', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
    { id: 'ac', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 },
    { id: 'so', venue: 'St Alma', countedAt: utc('2026-05-29T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 },
    { id: 'sc', venue: 'St Alma', countedAt: utc('2026-06-29T03:00:00Z'), status: 'LOCKED', valueCents: 1_500_000 },
    { id: 'both', venue: 'Both', countedAt: utc('2026-02-01T03:00:00Z'), status: 'LOCKED', valueCents: 3_000_000 },
    { id: 'unsp', venue: 'Unspecified', countedAt: utc('2026-06-15T03:00:00Z'), status: 'LOCKED', valueCents: 400_000 },
    { id: 'view', venue: 'St View', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 5_401_803 }
  ];

  it('the group brackets on the two configured venues only, whatever else was ever written in the venue field', async () => {
    const cogs = await computeActualCogsWith(fakeReader(fixture, PURCHASES), { venue: null, ...JUNE });
    assert.equal(cogs.quality, 'complete');
    assert.equal(cogs.openingStockCents, 3_000_000);
    assert.equal(cogs.closingStockCents, 2_300_000);
    assert.deepEqual(cogs.opening.venuesWithoutCount, []);
  });

  it('the off-venue counts stay visible, with their label, date, value and why they did not resolve', async () => {
    const cogs = await computeActualCogsWith(fakeReader(fixture, PURCHASES), { venue: null, ...JUNE });
    assert.deepEqual(
      cogs.closing.offVenueCounts.map((c) => [c.sourceLabel, c.resolution, c.countedOn, c.valueCents]).sort(),
      [
        ['Both', 'pseudo', '2026-02-01', 3_000_000],
        ['St View', 'unknown', '2026-06-30', 5_401_803],
        ['Unspecified', 'unknown', '2026-06-15', 400_000]
      ].sort()
    );
    assert.match(cogs.reasons.join(' '), /not a configured venue/);
    assert.equal(cogs.closingStockCents, 2_300_000);
  });

  it('"St View" is not St Alma: a venue with only a look-alike label has no boundary', async () => {
    const only = fixture.filter((c) => c.venue !== 'St Alma');
    const cogs = await computeActualCogsWith(fakeReader(only, PURCHASES), { venue: null, ...JUNE });
    assert.equal(cogs.quality, 'estimated');
    assert.deepEqual(cogs.opening.venuesWithoutCount.map((v) => [v.venue, v.status]), [['St Alma', 'missing']]);
    const stAlma = await computeActualCogsWith(fakeReader(only, PURCHASES), { venue: 'St Alma', ...JUNE });
    assert.equal(stAlma.opening.status, 'missing');
  });

  it('a historical alias label resolves without rewriting the record', async () => {
    const aliased = fixture.map((c) => (c.venue === 'St Alma' ? { ...c, venue: 'Alma Freshwater Pty Ltd' } : c));
    const stAlma = await computeActualCogsWith(fakeReader(aliased, PURCHASES), { venue: 'St Alma', ...JUNE });
    assert.equal(stAlma.quality, 'complete');
    assert.equal(stAlma.openingStockCents, 2_000_000);
  });

  it('a configured venue that has never counted keeps the group unavailable and is named — it is not dropped', async () => {
    const cogs = await computeActualCogsWith(fakeReader(fixture, PURCHASES, ['Alma Avalon', 'St Alma', 'Alma Manly']), { venue: null, ...JUNE });
    assert.equal(cogs.quality, 'estimated');
    assert.deepEqual(cogs.opening.venuesWithoutCount.map((v) => v.venue), ['Alma Manly']);
  });

  it('venue isolation: one venue\'s counts never serve another venue\'s boundary', async () => {
    const reader = fakeReader([
      { id: 'ao', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
      { id: 'ac', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
    ]);
    const stAlma = await computeActualCogsWith(reader, { venue: 'St Alma', ...JUNE });
    assert.equal(stAlma.opening.status, 'missing');
    assert.equal(stAlma.closing.status, 'missing');
    assert.deepEqual(stAlma.opening.rejected, []);
  });
});

describe('venue figures say what purchases they cannot see', () => {
  it('invoices with no venue are in the group purchases and in no venue, and the venue figure says so', async () => {
    const invoices = [
      { venue: 'Alma Avalon', invoiceDate: utc('2026-06-10T00:00:00Z'), cents: 300_000 },
      { venue: 'St Alma', invoiceDate: utc('2026-06-11T00:00:00Z'), cents: 200_000 },
      { venue: null, invoiceDate: utc('2026-06-12T00:00:00Z'), cents: 50_000 }
    ];
    const reader = fakeReader([], invoices);
    const [group, avalon, stAlma] = await Promise.all([
      computeActualCogsWith(reader, { venue: null, ...JUNE }),
      computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE }),
      computeActualCogsWith(reader, { venue: 'St Alma', ...JUNE })
    ]);
    assert.equal(group.purchasesCents, 550_000);
    assert.equal(avalon.purchasesCents + stAlma.purchasesCents + avalon.unattributedPurchasesCents, group.purchasesCents);
    assert.equal(avalon.unattributedInvoiceCount, 1);
    assert.equal(group.unattributedPurchasesCents, 0);
    assert.match(avalon.reasons.join(' '), /1 supplier invoice in this window carr(y|ies) no venue/);
  });
});

describe('group fail-closed invariant: a plausible combined number never hides an invalid venue', () => {
  const avalonComplete: Count[] = [
    { id: 'ao', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
    { id: 'ac', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
  ];
  const purchases = [
    { venue: 'Alma Avalon', invoiceDate: utc('2026-06-10T00:00:00Z'), cents: 400_000 },
    { venue: 'St Alma', invoiceDate: utc('2026-06-11T00:00:00Z'), cents: 900_000 }
  ];

  for (const [label, stAlma] of [
    ['no count near either boundary', [{ id: 'old', venue: 'St Alma', countedAt: utc('2026-03-01T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 }]],
    ['a food-only count at each boundary', [
      { id: 'sk1', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 200_000, scope: 'FOOD' },
      { id: 'sk2', venue: 'St Alma', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 150_000, scope: 'FOOD' }
    ]],
    ['counts of unknown scope at each boundary', [
      { id: 'su1', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000, scope: 'UNKNOWN' },
      { id: 'su2', venue: 'St Alma', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_500_000, scope: 'UNKNOWN' }
    ]],
    ['combined counts with unvalued lines at each boundary', [
      { id: 'sv1', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000, unvaluedLines: 4 },
      { id: 'sv2', venue: 'St Alma', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_500_000, unvaluedLines: 11 }
    ]]
  ] as Array<[string, Count[]]>) {
    it(`Alma Avalon complete, St Alma with ${label}: the group is unavailable and names St Alma; the group figure is purchases only`, async () => {
      const reader = fakeReader([...avalonComplete, ...stAlma], purchases);
      const [group, avalon] = await Promise.all([
        computeActualCogsWith(reader, { venue: null, ...JUNE }),
        computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE })
      ]);
      assert.equal(avalon.quality, 'complete');
      assert.equal(group.quality, 'estimated');
      assert.equal(group.source, 'purchases_only');
      assert.equal(group.openingStockCents, null);
      assert.equal(group.closingStockCents, null);
      assert.equal(group.cogsCents, 1_300_000);
      assert.deepEqual(group.opening.venuesWithoutCount.map((v) => v.venue), ['St Alma']);
      assert.match(group.reasons.join(' '), /St Alma/);
    });
  }
});
