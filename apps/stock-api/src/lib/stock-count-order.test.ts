import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareCountCategories,
  countRowsInWalkOrder,
  countSearchMatcher,
  organiseCountRows,
  PREP_COUNT_CATEGORY,
  splitWineName,
  wineGroupKey,
  withVintage
} from '@alma/shared';

type Row = { name: string; category: string | null; prep?: boolean };
const accessors = { name: (row: Row) => row.name, category: (row: Row) => row.category, isPrep: (row: Row) => Boolean(row.prep) };

test('vintage is read from either end of the name, never the middle', () => {
  assert.deepEqual(splitWineName("2022 Teusner 'Wark Family' Shiraz (Case of 12)"), {
    wineName: "Teusner 'Wark Family' Shiraz",
    vintage: 2022,
    nonVintage: false,
    packSuffix: true
  });
  assert.equal(splitWineName('Rockford Basket Press Shiraz 2017').vintage, 2017);
  assert.equal(splitWineName('A Rodda Tempranillo 2023 (Case of 12)').vintage, 2023);
  // A vineyard named after a year is not a vintage.
  const magnolia = splitWineName("2022 Eperosa 'Magnolia 1941' Semillon (Case of 6)");
  assert.equal(magnolia.vintage, 2022);
  assert.equal(magnolia.wineName, "Eperosa 'Magnolia 1941' Semillon");
  assert.equal(splitWineName("Eperosa 'Magnolia 1941' Semillon").vintage, null);
  assert.equal(splitWineName('NV Laurent Perrier Brut Rose (Case of 6)').nonVintage, true);
  assert.equal(splitWineName('Surco 2.7 Cabernet Sauvignon').vintage, null);
});

test('vintages of one wine share a key; similar wines do not', () => {
  assert.equal(wineGroupKey("2022 Teusner 'Wark Family' Shiraz (Case of 12)"), wineGroupKey('Teusner Wark Family Shiraz'));
  assert.equal(wineGroupKey("Rockford 'Basket Press' Shiraz 2004"), wineGroupKey('Rockford Basket Press Shiraz 2018'));
  assert.equal(wineGroupKey('2023 Maison Saint Aix Dry Rose 750ml (Case of 12)'), wineGroupKey('Maison Saint Aix Dry Rose'));
  assert.equal(wineGroupKey('Shaw + Smith Sauvignon Blanc'), wineGroupKey('Shaw & Smith Sauvignon Blanc 2022'));
  // The half bottle is its own item.
  assert.notEqual(wineGroupKey('Greywacke Sauvignon Blanc (375mL)'), wineGroupKey('Greywacke Sauvignon Blanc'));
  // Near-misses stay apart — exact after folding, never fuzzy.
  assert.notEqual(wineGroupKey('Bruxo No. 2'), wineGroupKey('Bruxo No. 4'));
  assert.notEqual(wineGroupKey('Cheateau La Grave Figeac St Emilion Grand Cru'), wineGroupKey('Chateau La Grave Figeac'));
});

test('wines group by name then vintage, each vintage still its own row', () => {
  const rows: Row[] = [
    { name: '2023 Shaw + Smith Sauvignon Blanc', category: 'Wine — White' },
    { name: '2021 Penfolds Bin 28 Shiraz', category: 'Wine — Red' },
    { name: '2022 Shaw + Smith Sauvignon Blanc', category: 'Wine — White' },
    { name: '2022 Penfolds Bin 28 Shiraz', category: 'Wine — Red' },
    { name: 'Penfolds Bin 28 Shiraz 2019', category: 'Wine — Red' }
  ];
  const sections = organiseCountRows(rows, accessors);
  assert.deepEqual(sections.map((s) => s.category), ['Wine — White', 'Wine — Red']);
  const white = sections[0]!.groups;
  assert.equal(white.length, 1);
  assert.equal(white[0]!.name, 'Shaw + Smith Sauvignon Blanc');
  assert.deepEqual(white[0]!.entries.map((e) => e.vintageLabel), ['2022', '2023']);
  const red = sections[1]!.groups;
  assert.equal(red.length, 1);
  assert.deepEqual(red[0]!.entries.map((e) => e.vintageLabel), ['2019', '2021', '2022']);
  assert.equal(countRowsInWalkOrder(sections).length, rows.length);
});

test('the floor spelling heads the group and clashing labels say why', () => {
  const sections = organiseCountRows<Row>(
    [
      { name: "2022 Teusner 'Wark Family' Shiraz (Case of 12)", category: 'Wine — Red' },
      { name: 'Teusner Wark Family Shiraz', category: 'Wine — Red' },
      { name: "2023 Teusner 'Wark Family' Shiraz (Case of 12)", category: 'Wine — Red' },
      { name: 'NV Serenello Prosecco (Case of 6)', category: 'Wine — Sparkling' },
      { name: 'Serenello Prosecco', category: 'Wine — Sparkling' }
    ],
    accessors
  );
  const teusner = sections.find((s) => s.category === 'Wine — Red')!.groups[0]!;
  assert.equal(teusner.name, 'Teusner Wark Family Shiraz');
  assert.deepEqual(teusner.entries.map((e) => e.vintageLabel), ['No year', '2022', '2023']);
  assert.ok(teusner.entries.every((e) => e.detail === null));
  const prosecco = sections.find((s) => s.category === 'Wine — Sparkling')!.groups[0]!;
  assert.deepEqual(prosecco.entries.map((e) => e.vintageLabel), ['No year', 'NV']);
});

test('non-wine items stay one row each, sorted by name; leading years do not sort first', () => {
  const sections = organiseCountRows<Row>(
    [
      { name: 'Tequila Blanco', category: 'Spirits — Tequila & Mezcal' },
      { name: 'agave syrup', category: 'Non-Alcoholic & Mixers' },
      { name: 'Ancho Reyes', category: 'Liqueurs & Aperitifs' },
      { name: 'Ancho Reyes', category: 'Liqueurs & Aperitifs' },
      { name: 'Chipotle mayo', category: null, prep: true },
      { name: 'Mystery', category: null },
      { name: 'Limes', category: 'Produce' }
    ],
    accessors
  );
  assert.deepEqual(sections.map((s) => s.category), [
    'Spirits — Tequila & Mezcal',
    'Liqueurs & Aperitifs',
    'Non-Alcoholic & Mixers',
    'Produce',
    'Uncategorised',
    PREP_COUNT_CATEGORY
  ]);
  // Two items with the same name are two rows, never merged.
  assert.equal(sections[1]!.groups.length, 2);
});

test('unknown categories sort alphabetically after the known walk', () => {
  assert.ok(compareCountCategories('Wine — Red', 'Beer & Cider') < 0);
  assert.ok(compareCountCategories('Zebra', 'Other') > 0);
  assert.ok(compareCountCategories('Alpha', 'Zebra') < 0);
});

test('search matches partial words in any order, ignoring punctuation and accents', () => {
  const name = "2024 Shaw & Smith 'M3' Chardonnay (Case of 6)";
  assert.ok(countSearchMatcher('shaw 2024')(name));
  assert.ok(countSearchMatcher('smith m3')(name));
  assert.ok(countSearchMatcher('Shaw + Smith')(name));
  assert.ok(countSearchMatcher('chard')(name));
  assert.ok(countSearchMatcher('')(name));
  assert.ok(!countSearchMatcher('shaw 2023')(name));
  assert.ok(countSearchMatcher('loic')("2022 Loïc Mahe 'Sables & Schists' Chenin Blanc"));
});

test('withVintage keeps the vintage where the name already put it', () => {
  assert.equal(withVintage("2022 Teusner 'Wark Family' Shiraz (Case of 12)", 2023), "2023 Teusner 'Wark Family' Shiraz (Case of 12)");
  assert.equal(withVintage('Rockford Basket Press Shiraz 2017', 2018), 'Rockford Basket Press Shiraz 2018');
  assert.equal(withVintage('Teusner Wark Family Shiraz', 2021), 'Teusner Wark Family Shiraz 2021');
  assert.equal(withVintage('Rockford Basket Press Shiraz 2017', null), 'Rockford Basket Press Shiraz');
});

test('abbreviation dots do not split a group; decimals still count', () => {
  assert.equal(wineGroupKey('Bruxo No. 2'), wineGroupKey('Bruxo No 2'));
  assert.notEqual(wineGroupKey('Bruxo No. 2'), wineGroupKey('Bruxo No. 4'));
  assert.equal(wineGroupKey('Mt. Difficulty Pinot Noir 2021'), wineGroupKey('Mt Difficulty Pinot Noir 2022'));
  assert.notEqual(wineGroupKey('Surco 2.7 Cabernet Sauvignon'), wineGroupKey('Surco 27 Cabernet Sauvignon'));
  assert.ok(countSearchMatcher('no. 2')('Bruxo No 2'));
});

test('withVintage writes and clears the NV marker, and replaces it with a year', () => {
  assert.equal(withVintage('NV Laurent Perrier Brut Rose (Case of 6)', 2015), '2015 Laurent Perrier Brut Rose (Case of 6)');
  assert.equal(withVintage('Serenello Prosecco', 'NV'), 'NV Serenello Prosecco');
  assert.equal(withVintage('Serenello Prosecco 2022', 'NV'), 'NV Serenello Prosecco');
  assert.equal(withVintage('NV Serenello Prosecco (Case of 6)', null), 'Serenello Prosecco (Case of 6)');
  assert.equal(wineGroupKey(withVintage('Serenello Prosecco', 'NV')), wineGroupKey('Serenello Prosecco'));
});
