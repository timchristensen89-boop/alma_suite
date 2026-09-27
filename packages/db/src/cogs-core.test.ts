import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeActualCogsWith, stockBracket, stockValueAtCentsWith, type CogsReader } from './cogs-core.js';

// A fake of the stock and purchase tables, keyed the way the reader reads
// them, so every test states its population explicitly.
type Count = { id: string; venue: string | null; countedAt: Date; status: string; valueCents: number };
type Invoice = { venue: string | null; invoiceDate: Date; cents: number; status?: string };

const FINALISED = new Set(['SUBMITTED', 'REVIEWED', 'LOCKED']);
const utc = (iso: string) => new Date(iso);

function fakeReader(counts: Count[], invoices: Invoice[] = []): CogsReader {
  const finalised = (venue: string, at: Date) => counts.filter((c) => c.venue === venue && FINALISED.has(c.status) && c.countedAt <= at);
  return {
    async latestFinalisedCount(venue, at) {
      const rows = finalised(venue, at).sort((a, b) => b.countedAt.getTime() - a.countedAt.getTime());
      return rows[0] ? { countedAt: rows[0].countedAt } : null;
    },
    async finalisedCountIdsBetween(venue, window, at) {
      return finalised(venue, at)
        .filter((c) => c.countedAt >= window.gte && c.countedAt < window.lt)
        .map((c) => c.id);
    },
    async lineValueCents(ids) {
      return counts.filter((c) => ids.includes(c.id)).reduce((sum, c) => sum + c.valueCents, 0);
    },
    async venuesWithFinalisedCounts(at) {
      return [...new Set(counts.filter((c) => c.venue != null && FINALISED.has(c.status) && c.countedAt <= at).map((c) => c.venue as string))];
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

// June 2026 as a venue month: Sydney is UTC+10 in June.
const JUNE = { start: utc('2026-05-31T14:00:00Z'), end: utc('2026-06-30T14:00:00Z') };
const PURCHASES = [{ venue: 'Alma Avalon', invoiceDate: utc('2026-06-10T00:00:00Z'), cents: 400_000 }];

describe('actual COGS = opening + purchases − closing, only with two valid brackets', () => {
  it('two counts within tolerance of each boundary give a complete, stock-bounded figure', async () => {
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
    assert.deepEqual(cogs.reasons, []);
  });

  it('the symptom: one stale count bracketing both ends must NOT read as complete', async () => {
    // A single March count is the latest count before both 1 June and 30
    // June. It used to become opening AND closing, so COGS = purchases,
    // labelled complete.
    const reader = fakeReader([{ id: 'm', venue: 'Alma Avalon', countedAt: utc('2026-03-15T03:00:00Z'), status: 'LOCKED', valueCents: 900_000 }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'estimated');
    assert.equal(cogs.source, 'purchases_only');
    assert.equal(cogs.cogsCents, 400_000);
    assert.equal(cogs.openingStockCents, null);
    assert.equal(cogs.closingStockCents, null);
    assert.equal(cogs.opening.status, 'stale');
    assert.equal(cogs.opening.countedOn, '2026-03-15');
    assert.equal(cogs.closing.status, 'stale');
    assert.match(cogs.reasons.join(' '), /past the 14-day limit/);
  });

  it('a valid opening with a stale closing names the closing bracket', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-10T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 } // 20 days before 30 Jun
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'stale_closing');
    assert.equal(cogs.openingStockCents, 1_000_000);
    assert.equal(cogs.closingStockCents, null);
    assert.equal(cogs.closing.ageDays, 20);
    assert.match(cogs.reasons[0] ?? '', /Closing stock is unavailable.*2026-06-10.*20 days/);
  });

  it('no count at all names the missing bracket, distinct from stale', async () => {
    const reader = fakeReader([{ id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.quality, 'missing_opening');
    assert.equal(cogs.opening.status, 'missing');
    assert.match(cogs.reasons[0] ?? '', /no finalised stocktake on or before 2026-06-01/);
  });

  it('a count exactly at the boundary brackets it (age 0); one the day after does not', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'Alma Avalon', countedAt: JUNE.start, status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'c', venue: 'Alma Avalon', countedAt: utc('2026-07-01T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'Alma Avalon', ...JUNE });
    assert.equal(cogs.opening.status, 'ok');
    assert.equal(cogs.opening.ageDays, 0);
    // The 1 July count is after the boundary; the latest count before it is
    // the 1 June one, 30 days old, so the closing bracket is stale, not zero.
    assert.equal(cogs.closing.status, 'stale');
    assert.equal(cogs.closing.ageDays, 30);
  });

  it('draft and in-progress counts are never brackets', async () => {
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

describe('sessions on the same venue day are one count', () => {
  it('sums the bar and kitchen sessions either side of UTC midnight on one Sydney day', async () => {
    // 09:30 and 10:30 Sydney on 30 June = 23:30 UTC 29 June and 00:30 UTC 30 June.
    const reader = fakeReader(
      [
        { id: 'o', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'bar', venue: 'St Alma', countedAt: utc('2026-06-29T23:30:00Z'), status: 'LOCKED', valueCents: 704_872 },
        { id: 'kitchen', venue: 'St Alma', countedAt: utc('2026-06-30T00:30:00Z'), status: 'LOCKED', valueCents: 6_297_678 }
      ],
      []
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'St Alma', ...JUNE });
    assert.equal(cogs.closing.countedOn, '2026-06-30');
    assert.equal(cogs.closingStockCents, 704_872 + 6_297_678);
  });

  it('a session from an earlier day is not folded into the latest count', async () => {
    const reader = fakeReader(
      [
        { id: 'o', venue: 'St Alma', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
        { id: 'old', venue: 'St Alma', countedAt: utc('2026-06-20T03:00:00Z'), status: 'LOCKED', valueCents: 5_000_000 },
        { id: 'c', venue: 'St Alma', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
      ],
      []
    );
    const cogs = await computeActualCogsWith(reader, { venue: 'St Alma', ...JUNE });
    assert.equal(cogs.closingStockCents, 800_000);
  });
});

describe('stock on hand is the latest valid count, not the sum of every count ever taken', () => {
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

  it('and once that count is older than the tolerance, the value is unavailable — not the stale figure', async () => {
    const reader = fakeReader([{ id: 'jun', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }]);
    assert.equal(await stockValueAtCentsWith(reader, 'Alma Avalon', utc('2026-08-01T00:00:00Z')), null);
  });
});

describe('the all-venues figure is Σ venues, never the sum of whichever venues happened to count', () => {
  const avalonJune = [
    { id: 'ao', venue: 'Alma Avalon', countedAt: utc('2026-05-30T03:00:00Z'), status: 'LOCKED', valueCents: 1_000_000 },
    { id: 'ac', venue: 'Alma Avalon', countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 800_000 }
  ];

  it('sums every venue when each has a valid bracket', async () => {
    const reader = fakeReader(
      [
        ...avalonJune,
        { id: 'so', venue: 'St Alma', countedAt: utc('2026-05-29T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 },
        { id: 'sc', venue: 'St Alma', countedAt: utc('2026-06-29T03:00:00Z'), status: 'LOCKED', valueCents: 1_500_000 }
      ],
      PURCHASES
    );
    const cogs = await computeActualCogsWith(reader, { venue: null, ...JUNE });
    assert.equal(cogs.quality, 'complete');
    assert.equal(cogs.openingStockCents, 3_000_000);
    assert.equal(cogs.closingStockCents, 2_300_000);
    assert.equal(cogs.cogsCents, 3_000_000 + 400_000 - 2_300_000);
  });

  it('a venue with no valid count makes the group bracket unavailable and is named', async () => {
    // St Alma has counted before (March), so it is part of the group; it has
    // no count within tolerance of either June boundary. The group figure used
    // to be Avalon alone, presented as the group.
    const reader = fakeReader([...avalonJune, { id: 's', venue: 'St Alma', countedAt: utc('2026-03-01T03:00:00Z'), status: 'LOCKED', valueCents: 2_000_000 }], PURCHASES);
    const cogs = await computeActualCogsWith(reader, { venue: null, ...JUNE });
    assert.equal(cogs.source, 'purchases_only');
    assert.equal(cogs.quality, 'estimated');
    assert.equal(cogs.openingStockCents, null);
    assert.deepEqual(
      cogs.opening.venuesWithoutCount.map((v) => [v.venue, v.status]),
      [['St Alma', 'stale']]
    );
    assert.match(cogs.reasons[0] ?? '', /St Alma's latest count \(2026-03-01\)/);
    assert.equal(await stockValueAtCentsWith(reader, null, JUNE.end), null);
  });

  it('untagged (venue-null) counts do not create a phantom venue', async () => {
    const reader = fakeReader([...avalonJune, { id: 'both', venue: null, countedAt: utc('2026-06-30T03:00:00Z'), status: 'LOCKED', valueCents: 5_000_000 }], []);
    const bracket = await stockBracket(reader, null, JUNE.end);
    assert.equal(bracket.status, 'ok');
    assert.equal(bracket.valueCents, 800_000);
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
    // Group = Σ attributed venues + unattributed; never forced onto a venue.
    assert.equal(group.purchasesCents, 550_000);
    assert.equal(avalon.purchasesCents + stAlma.purchasesCents + avalon.unattributedPurchasesCents, group.purchasesCents);
    assert.equal(avalon.unattributedInvoiceCount, 1);
    assert.equal(group.unattributedPurchasesCents, 0);
    assert.match(avalon.reasons.join(' '), /1 supplier invoice in this window carr(y|ies) no venue/);
  });
});
