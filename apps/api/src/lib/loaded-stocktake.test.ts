import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoadedStocktake, moneyToCents, valuationOutliers, catalogueKey, type PdfRow } from '@alma/shared';

/**
 * Reading a count out of a Loaded PDF export.
 *
 * Every case below came out of the three real exports Tim pulled on 1–2 August;
 * none of them are invented. The stakes are that a mis-parse writes wrong
 * quantities straight into stock on hand, so the sheet's own printed totals are
 * treated as the check rather than as decoration.
 */

const HEADER: PdfRow[] = [
  ['St Alma'],
  ['View Stocktake'],
  ['Date', 'Sat 1st Aug, 10:00 AM'],
  ['Created By', 'Dirk Wright'],
  ['Entered By', 'Dirk']
];

test('a straightforward sheet parses and reconciles to its printed totals', () => {
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Balter Cerveza', 'Each', '65.00', '$154.10'],
    ['Corona', 'Each', '78.00', '$203.30'],
    ['Total for Bottled', '$357.40'],
    ['Total for Stocktake', '$357.40']
  ]);

  assert.equal(result.venue, 'St Alma');
  assert.equal(result.countedBy, 'Dirk Wright');
  assert.equal(result.countedAtText, 'Sat 1st Aug, 10:00 AM');
  assert.equal(result.lines.length, 2);
  assert.deepEqual(result.discrepancies, []);
  assert.equal(result.summedTotalCents, 35740);
  assert.equal(result.lines[0]?.category, 'Bottled');
});

test('a name split by a ligature is rejoined, not truncated', () => {
  // Real rows: "Cauliflower" arrives as ["Cauli","fl","ower"] and
  // "Glenfiddich 12YO" as ["Glen","fi","ddich 12YO"]. Taking cell[0] as the
  // name would import "Cauli" and never match anything.
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Vegetables'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Cauli', 'fl', 'ower', 'Each', '0.00', '$0.00'],
    ['Glen', 'fi', 'ddich 12YO', '700 mL', '0.70', '$56.27']
  ]);

  assert.equal(result.lines[0]?.name, 'Cauliflower');
  assert.equal(result.lines[1]?.name, 'Glenfiddich 12YO');
  assert.equal(result.lines[1]?.unit, '700 mL');
  assert.equal(result.lines[1]?.quantity, 0.7);
});

test('a unit containing a space is kept whole', () => {
  // Splitting on whitespace would read the unit as "750" and the name as
  // "Serenello Prosecco mL".
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Champagne & Sparkling'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Serenello Prosecco', '750 mL', '12.90', '$189.39'],
    ['Tomato Juice 12 Pack', '12 Pack', '0.75', '$19.13']
  ]);

  assert.equal(result.lines[0]?.unit, '750 mL');
  assert.equal(result.lines[0]?.quantity, 12.9);
  assert.equal(result.lines[1]?.name, 'Tomato Juice 12 Pack');
  assert.equal(result.lines[1]?.unit, '12 Pack');
});

test('a blank count sheet is recognised rather than imported as zeroes', () => {
  // The St Alma food sheet dated 2/08 has 81 items and not one counted. It is
  // a sheet printed to write on. Importing it would zero the whole venue.
  const result = parseLoadedStocktake([
    ['St Alma'],
    ['Stocktake'],
    ['Title', 'Date'],
    ['2/08/2026 - All Food', '04 Aug 2026, 12:52am'],
    ['Breads'],
    ['Item', 'Unit', 'Quantity', 'Qty From Recipes', 'Total Qty'],
    ['Tortillas Flour 12inch', '12X91GM', '0.000', '0.00', '0.00'],
    ['Yellow Corn Tortilla', 'Each', '0.000', '0.00', '0.00']
  ]);

  assert.equal(result.isBlank, true);
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0]?.name, 'Tortillas Flour 12inch');
  assert.equal(result.lines[0]?.unit, '12X91GM');
});

test('a sheet with real counts is not called blank', () => {
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Corona', 'Each', '78.00', '$203.30']
  ]);
  assert.equal(result.isBlank, false);
});

test('a count of zero on a real sheet still imports', () => {
  // Zero is a genuine count — the venue holds none. It must reach stock on
  // hand, or an item that ran out silently keeps its old quantity forever.
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Keg'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Freshwater Brewing Hazy Pale Keg', '50 L', '0.00', '$0.00'],
    ['Modus Operandi Cerveza', 'Each', '0.00', '$0.00'],
    ['Corona', 'Each', '78.00', '$203.30']
  ]);
  assert.equal(result.lines.length, 3);
  assert.equal(result.lines[0]?.quantity, 0);
  assert.equal(result.isBlank, false);
});

test('a cent of rounding drift is tolerated, because Loaded rounds differently', () => {
  // Loaded totals from unrounded values and prints rounded lines, so summing
  // the printed figures lands a cent or two out. Four of the nine categories on
  // the real St Alma drinks sheet do exactly this.
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Balter Cerveza', 'Each', '65.00', '$154.10'],
    ['Corona', 'Each', '78.00', '$203.30'],
    ['Total for Bottled', '$357.41']
  ]);
  assert.deepEqual(result.discrepancies, []);
});

test('a dropped row is still caught, well outside the rounding tolerance', () => {
  // The tolerance must not swallow real loss. The smallest line on these sheets
  // is $5.79; the tolerance for two lines is two cents.
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Balter Cerveza', 'Each', '65.00', '$154.10'],
    ['Corona', 'Each', '78.00', '$203.30'],
    ['Total for Bottled', '$363.20'] // a $5.79 line went missing
  ]);
  assert.equal(result.discrepancies.length, 1);
});

test('lines that do not add up to the printed total are reported', () => {
  // The whole point of the check: a dropped row is invisible in the output but
  // obvious against the sheet's own total.
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Corona', 'Each', '78.00', '$203.30'],
    ['Total for Bottled', '$811.65']
  ]);

  assert.equal(result.discrepancies.length, 1);
  assert.match(result.discrepancies[0] ?? '', /Bottled: lines add to 203\.30 but the sheet prints 811\.65/);
});

test('category headings carry down to the rows beneath them', () => {
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Bottled'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Corona', 'Each', '78.00', '$203.30'],
    ['Total for Bottled', '$203.30'],
    ['Keg'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Wedge Cerveza Keg', '50 L', '1.00', '$270.00'],
    ['Total for Keg', '$270.00']
  ]);

  assert.equal(result.lines[0]?.category, 'Bottled');
  assert.equal(result.lines[1]?.category, 'Keg');
  assert.deepEqual(result.discrepancies, []);
});

test('thousands separators survive the trip', () => {
  const result = parseLoadedStocktake([
    ...HEADER,
    ['Red'],
    ['Item', 'Unit', 'Quantity', '$ On Hand'],
    ['Some Very Good Red', '750 mL', '1,250.00', '$20,479.95']
  ]);
  assert.equal(result.lines[0]?.quantity, 1250);
  assert.equal(result.lines[0]?.valueCents, 2047995);
});

test('money parsing', () => {
  assert.equal(moneyToCents('$154.10'), 15410);
  assert.equal(moneyToCents('$2,340.79'), 234079);
  assert.equal(moneyToCents('$0.00'), 0);
  assert.equal(moneyToCents('(12.50)'), -1250);
  assert.equal(moneyToCents('Each'), null);
  assert.equal(moneyToCents('78.00'), 7800);
});

test('a millilitre count read as bottles is caught by the two valuations disagreeing', () => {
  // Before the unit fix: Loaded valued the gin at $1,235.00 and Alma, reading
  // 20,583.36 as bottles, at $1,126,115.63.
  const [outlier] = valuationOutliers([
    { name: 'Manly Spirits Dry Gin', loadedCents: 123500, almaCents: 112611563 }
  ]);
  assert.ok(outlier);
  assert.match(outlier.message, /912x more/);
});

test('the real spread between the two systems is left alone', () => {
  // Every one of the 131 comparable lines on the real sheet fell between 0.77x
  // and 1.43x once units were reconciled. None of that is a count problem.
  const outliers = valuationOutliers([
    { name: 'Jameson Irish Whiskey', loadedCents: 5428, almaCents: 7760 }, // 1.43x, the worst seen
    { name: 'Manly Spirits Vodka', loadedCents: 113112, almaCents: 150910 }, // 1.33x, after conversion
    { name: 'El Jolgorio Cuishe', loadedCents: 17095, almaCents: 13091 }, // 0.77x, the other extreme
    { name: 'Rockford Basket Press Shiraz', loadedCents: 231000, almaCents: 231000 } // dear, but agreed
  ]);
  assert.deepEqual(outliers, []);
});

test('a line valued at zero on either side is not a disagreement', () => {
  // Counting none of something is an answer, not an error.
  assert.deepEqual(
    valuationOutliers([
      { name: 'Modus Operandi Cerveza', loadedCents: 0, almaCents: 0 },
      { name: 'Oasis Pale Ale', loadedCents: 0, almaCents: 4500 }
    ]),
    []
  );
});

test('disagreement is caught in both directions', () => {
  const [worst] = valuationOutliers([
    { name: 'Understated', loadedCents: 100000, almaCents: 100 },
    { name: 'Overstated', loadedCents: 1000, almaCents: 10000 }
  ]);
  assert.equal(worst?.name, 'Understated');
  assert.match(worst?.message ?? '', /1000x less/);
});

test('a Loaded name and its invoice-created Alma twin share a key', () => {
  // The real pairs that this recovered on the 1 August sheet.
  assert.equal(catalogueKey('Greystone Pinot Gris'), catalogueKey('2023 Greystone Pinot Gris (Case of 12)'));
  assert.equal(
    catalogueKey("Kendall Jackson Vintner's Reserve Chardonnay"),
    catalogueKey("2022 Kendall Jackson 'Vintners Reserve' Chardonnay (Case of 12)")
  );
  assert.equal(
    catalogueKey('Helens Hill The Smuggler Pinot Noir'),
    catalogueKey("2022 Helen's Hill 'The Smuggler' Pinot Noir (Case of 6)")
  );
});

test('different wines do not collapse onto one key', () => {
  // Vintage is dropped, so two vintages of the same wine collide — which is
  // exactly why the importer treats more than one candidate as no match rather
  // than picking. These must at least stay distinct from other wines.
  assert.notEqual(catalogueKey('Greystone Pinot Gris'), catalogueKey('Greystone Pinot Noir'));
  assert.notEqual(catalogueKey('Utopos Shiraz'), catalogueKey('Utopos Cabernet Sauvignon'));
});

test('an export that is not a stocktake says so instead of returning nothing', () => {
  const result = parseLoadedStocktake([['St Alma'], ['Some Other Report']]);
  assert.equal(result.lines.length, 0);
  assert.match(result.discrepancies[0] ?? '', /is this a stocktake export/);
});
