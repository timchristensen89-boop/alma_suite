import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  agingWines,
  bottlePriceCents,
  bucketBy,
  daysBetween,
  isBottle,
  marginPercent,
  poursizeLabel,
  priceBand,
  type PourFact,
  type SaleFact,
  type WineFact
} from './wine-report.js';

const pour = (recipeId: string, ml: number, price: number | null, cost: number | null): PourFact => ({
  recipeId,
  ml,
  salePriceCents: price === null ? null : price * 100,
  costCents: cost === null ? null : cost * 100
});

const wine = (over: Partial<WineFact> & { id: string }): WineFact => ({
  venue: 'St Alma',
  name: 'A wine',
  grape: null,
  region: null,
  origin: null,
  vintage: null,
  section: null,
  limitedStock: false,
  sommelierPour: false,
  pours: [],
  ...over
});

const sale = (recipeId: string, quantity: number, revenue: number, date = '2026-08-01'): SaleFact => ({
  recipeId,
  quantity,
  revenueCents: revenue * 100,
  date,
  source: 'register'
});

describe('isBottle', () => {
  it('calls 700mL and up a bottle', () => {
    assert.equal(isBottle(750), true);
    assert.equal(isBottle(700), true);
    assert.equal(isBottle(375), false);
    assert.equal(isBottle(250), false);
    assert.equal(isBottle(60), false);
  });
});

describe('priceBand', () => {
  it('uses the same cuts the register filters by', () => {
    assert.equal(priceBand(7900)?.id, 'u80');
    assert.equal(priceBand(8000)?.id, '80-120');
    assert.equal(priceBand(11999)?.id, '80-120');
    assert.equal(priceBand(12000)?.id, '120-200');
    assert.equal(priceBand(19999)?.id, '120-200');
    assert.equal(priceBand(20000)?.id, '200+');
    assert.equal(priceBand(66000)?.id, '200+');
  });

  it('refuses to band a wine with no price', () => {
    assert.equal(priceBand(null), null);
    assert.equal(priceBand(0), null);
  });
});

describe('bottlePriceCents', () => {
  it('takes the bottle, not the cheapest glass', () => {
    const w = wine({ id: 'w', pours: [pour('a', 150, 16, null), pour('b', 250, 26, null), pour('c', 750, 76, null)] });
    assert.equal(bottlePriceCents(w), 7600);
  });

  it('falls back to the largest pour when nothing is bottle-sized', () => {
    // All Saints Grand: 60mL and 375mL, no 750.
    const w = wine({ id: 'w', pours: [pour('a', 60, 18, null), pour('b', 375, 79, null)] });
    assert.equal(bottlePriceCents(w), 7900);
  });

  it('is null when no pour carries a price', () => {
    assert.equal(bottlePriceCents(wine({ id: 'w', pours: [pour('a', 750, null, null)] })), null);
    assert.equal(bottlePriceCents(wine({ id: 'w', pours: [] })), null);
  });
});

describe('poursizeLabel', () => {
  it('says what the guest is holding', () => {
    assert.equal(poursizeLabel(150), '150mL glass');
    assert.equal(poursizeLabel(750), 'Bottle (750mL)');
    assert.equal(poursizeLabel(375), '375mL glass');
  });
});

describe('marginPercent', () => {
  it('is the margin over the revenue we can cost', () => {
    assert.equal(marginPercent(10000, 3000), 70);
  });

  it('is NULL, not 100, when nothing has a cost', () => {
    // The whole point: an uncosted wine must not top the margin table.
    assert.equal(marginPercent(0, 0), null);
  });

  it('goes negative rather than hiding a wine sold under cost', () => {
    assert.equal(marginPercent(1000, 1500), -50);
  });
});

describe('bucketBy', () => {
  const shiraz = wine({ id: 'w1', name: 'Utopos', grape: 'Shiraz', pours: [pour('r1', 750, 150, 50)] });
  const pinot = wine({ id: 'w2', name: 'Nielson', grape: 'Pinot Noir', pours: [pour('r2', 750, 115, null)] });
  const glassy = wine({ id: 'w3', name: 'Capa', grape: 'Shiraz', pours: [pour('r3', 150, 15, 5)] });

  const lines = [
    { wine: shiraz, pour: shiraz.pours[0]!, sale: sale('r1', 2, 300) },
    { wine: pinot, pour: pinot.pours[0]!, sale: sale('r2', 1, 115) },
    { wine: glassy, pour: glassy.pours[0]!, sale: sale('r3', 4, 60) }
  ];
  const byGrape = new Map([
    ['Shiraz', new Set(['w1', 'w3'])],
    ['Pinot Noir', new Set(['w2'])]
  ]);
  const total = 47500;

  it('rolls quantity, revenue and share up by the key', () => {
    const rows = bucketBy(lines, byGrape, (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null), total);
    const shirazRow = rows.find((row) => row.key === 'Shiraz');
    assert.equal(shirazRow?.quantity, 6);
    assert.equal(shirazRow?.revenueCents, 36000);
    assert.equal(shirazRow?.wines, 2);
    assert.equal(Math.round(shirazRow?.sharePercent ?? 0), 76);
  });

  it('counts bottles and glasses apart', () => {
    const rows = bucketBy(lines, byGrape, (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null), total);
    const shirazRow = rows.find((row) => row.key === 'Shiraz');
    assert.equal(shirazRow?.bottles, 2);
    assert.equal(shirazRow?.glasses, 4);
  });

  it('keeps uncosted revenue out of the margin', () => {
    // Pinot has no cost, so its $115 must not appear as $115 of pure margin.
    const rows = bucketBy(lines, byGrape, (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null), total);
    const pinotRow = rows.find((row) => row.key === 'Pinot Noir');
    assert.equal(pinotRow?.revenueCents, 11500);
    assert.equal(pinotRow?.costedRevenueCents, 0);
    assert.equal(pinotRow?.marginPercent, null);
    assert.equal(pinotRow?.marginCents, 0);
  });

  it('costs a multi-serve line by the quantity, not once', () => {
    // Two bottles at $50 cost each is $100 of cost, not $50.
    const rows = bucketBy(lines, byGrape, (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null), total);
    const shirazRow = rows.find((row) => row.key === 'Shiraz');
    // 2 x $50 bottle + 4 x $5 glass = $120.
    assert.equal(shirazRow?.costCents, 12000);
    assert.equal(shirazRow?.marginCents, 36000 - 12000);
  });

  it('gives a grape on the list but never sold its own row', () => {
    const rows = bucketBy(
      [],
      new Map([['Riesling', new Set(['w9'])]]),
      (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null),
      0
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.wines, 1);
    assert.equal(rows[0]?.quantity, 0);
    assert.equal(rows[0]?.marginPercent, null);
  });

  it('skips a line the key cannot name rather than inventing a bucket', () => {
    const noGrape = wine({ id: 'w4', pours: [pour('r4', 750, 90, 30)] });
    const rows = bucketBy(
      [{ wine: noGrape, pour: noGrape.pours[0]!, sale: sale('r4', 1, 90) }],
      new Map(),
      (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null),
      9000
    );
    assert.deepEqual(rows, []);
  });

  it('orders by revenue so the top of the table is where the money is', () => {
    const rows = bucketBy(lines, byGrape, (line) => (line.wine.grape ? { key: line.wine.grape, label: line.wine.grape } : null), total);
    assert.deepEqual(rows.map((row) => row.key), ['Shiraz', 'Pinot Noir']);
  });
});

describe('daysBetween', () => {
  it('counts whole days', () => {
    assert.equal(daysBetween('2026-08-01', '2026-08-20'), 19);
    assert.equal(daysBetween('2026-08-20', '2026-08-20'), 0);
  });

  it('is not thrown by a month or year boundary', () => {
    assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
    assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  });
});

describe('agingWines', () => {
  const barolo = wine({ id: 'w1', name: 'Sandrone Barolo', vintage: 2006, pours: [pour('r1', 750, 660, null)] });
  const glass = wine({ id: 'w2', name: 'Capa Tempranillo', vintage: 2022, pours: [pour('r2', 150, 16, null)] });
  const seller = wine({ id: 'w3', name: 'Utopos', vintage: 2022, pours: [pour('r3', 750, 150, null)] });
  const quiet = wine({ id: 'w4', name: 'Edmeades', vintage: 2023, pours: [pour('r4', 750, 120, null)] });

  const rows = agingWines(
    [barolo, glass, seller, quiet],
    new Map([['w3', 4]]),
    new Map([
      ['w2', '2026-06-01'],
      ['w3', '2026-08-19'],
      ['w4', '2026-02-01']
    ]),
    '2026-08-20'
  );

  it('leaves out anything that sold in the window', () => {
    assert.equal(rows.find((row) => row.wineId === 'w3'), undefined);
  });

  it('puts never-sold before long-ago-sold', () => {
    assert.equal(rows[0]?.wineId, 'w1');
    assert.equal(rows[0]?.daysSinceSold, null);
  });

  it('then orders the quiet ones by how long they have been quiet', () => {
    assert.deepEqual(rows.slice(1).map((row) => row.wineId), ['w4', 'w2']);
    assert.equal(rows[1]?.daysSinceSold, 200);
    assert.equal(rows[2]?.daysSinceSold, 80);
  });

  it('ages the vintage against the report date, not today', () => {
    assert.equal(rows[0]?.vintageAge, 20);
  });

  it('has no vintage age for a non-vintage wine', () => {
    const nv = wine({ id: 'w5', name: 'Serenello Prosecco', vintage: null, pours: [pour('r5', 750, 75, null)] });
    const only = agingWines([nv], new Map(), new Map(), '2026-08-20');
    assert.equal(only[0]?.vintageAge, null);
  });

  it('carries the bottle price, so the cost of the silence is visible', () => {
    assert.equal(rows[0]?.bottlePriceCents, 66000);
  });
});
