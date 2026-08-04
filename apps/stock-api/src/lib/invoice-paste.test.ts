import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoicePaste, quantityFromMoney, moneyTokenToCents, reconcilePaste } from '@alma/shared';

/**
 * The real thing: a Paramount Liquor invoice that reached the suite as one
 * $1,035.25 line, copied off the PDF. Copying detached the three right-hand
 * columns into blocks of their own, which is the shape this has to survive.
 */
const PARAMOUNT = `63331 AGUAS MANSAS ESPADIN MEZCAL : 750ml 6/750 ml 0 / 1 $390.00 $65.00
12027 BALTER CERVEZA 24PK BOTTLE : 355 ml 24/355 ml C 1 $56.90 $56.90
9000000 Carton Freight MISC 4 $1.30 $5.20
63337 EL TEQUILEÑO 1959 REPOSADO TEQUILA : 750m 6/750 ml 0 / 2 $312.00 $104.00
10015795 EL TEQUILEÑO BLANCO 750ML 12PK : 750ml 12/750 ml 1 / 0 $588.00 $588.00
90080 SUPASAWA SERIOUSLY SOUR COCKTAIL MIXER 6/700 ml 0 / 3 $150.36 $75.18
9000004 Temporary Fuel Levy Charge MISC 40 $0.01 $0.40
66743 VOK CREME DE CACAO WHITE : 500 ml 6/500 ml 0 / 2 $139.38 $46.46
GST
$6.50
$5.69
$0.52
$10.40
$58.80
$7.52
$0.04
$4.65
LUC Ex GST
$65.00
$56.90
$1.30
$52.00
$49.00
$25.06
$0.01
$23.23
Total Inc GST
$71.50
$62.59
$5.72
$114.40
$646.80
$82.70
$0.44
$51.11`;

test('the Paramount paste yields eight lines and nothing unparsed', () => {
  const result = parseInvoicePaste(PARAMOUNT);
  assert.equal(result.lines.length, 8);
  assert.deepEqual(result.unparsed, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.columnsApplied.sort(), ['GST', 'total inc GST', 'unit price ex GST']);
});

test('item codes and descriptions come off cleanly', () => {
  const result = parseInvoicePaste(PARAMOUNT);
  assert.deepEqual(
    result.lines.map((line) => line.itemCode),
    ['63331', '12027', '9000000', '63337', '10015795', '90080', '9000004', '66743']
  );
  assert.equal(result.lines[0]!.description, 'AGUAS MANSAS ESPADIN MEZCAL : 750ml');
  // "MISC" is a unit-of-measure column, not part of the product name.
  assert.equal(result.lines[2]!.description, 'Carton Freight');
  assert.equal(result.lines[6]!.description, 'Temporary Fuel Levy Charge');
  assert.equal(result.lines[0]!.pack, '6/750 ml');
  assert.equal(result.lines[2]!.pack, null);
});

test('every line reconciles: quantity x unit price = line total', () => {
  const result = parseInvoicePaste(PARAMOUNT);
  for (const line of result.lines) {
    assert.equal(
      line.quantity * line.unitAmountCents,
      line.lineAmountCents,
      `${line.description}: ${line.quantity} x ${line.unitAmountCents} != ${line.lineAmountCents}`
    );
    assert.deepEqual(line.warnings, [], `${line.description} should be clean`);
  }
});

test('a carton line is counted in the units its price is quoted in', () => {
  // "1 / 0" on a 12-bottle pack is one carton — but the unit price is per
  // bottle, so the quantity that makes the money work is 12. Reading the
  // printed "1" would have costed this at $49 instead of $588.
  const result = parseInvoicePaste(PARAMOUNT);
  const blanco = result.lines.find((line) => line.itemCode === '10015795')!;
  assert.equal(blanco.printedQuantity, '1/0');
  assert.equal(blanco.quantity, 12);
  assert.equal(blanco.unitAmountCents, 4900);
  assert.equal(blanco.lineAmountCents, 58800);
});

test('singles, cartons and misc charges all land right', () => {
  const result = parseInvoicePaste(PARAMOUNT);
  const byCode = new Map(result.lines.map((line) => [line.itemCode, line]));
  // 1 bottle at $65
  assert.equal(byCode.get('63331')!.quantity, 1);
  assert.equal(byCode.get('63331')!.lineAmountCents, 6500);
  // "C 1" — one carton, priced per carton
  assert.equal(byCode.get('12027')!.printedQuantity, 'C 1');
  assert.equal(byCode.get('12027')!.quantity, 1);
  assert.equal(byCode.get('12027')!.lineAmountCents, 5690);
  // 4 x $1.30 freight
  assert.equal(byCode.get('9000000')!.quantity, 4);
  assert.equal(byCode.get('9000000')!.lineAmountCents, 520);
  // 40 x 1c fuel levy — the sub-dollar case that rounding would eat
  assert.equal(byCode.get('9000004')!.quantity, 40);
  assert.equal(byCode.get('9000004')!.unitAmountCents, 1);
  assert.equal(byCode.get('9000004')!.lineAmountCents, 40);
});

test('the totals add up to the invoice they came from', () => {
  const result = parseInvoicePaste(PARAMOUNT);
  assert.equal(result.subtotalCents, 94114);
  assert.equal(result.taxCents, 9412);
  assert.equal(result.totalCents, 103526);

  // The invoice header says $1,035.25 — one cent of supplier rounding.
  const check = reconcilePaste(result, { subtotalCents: 94114, taxCents: 9411, totalCents: 103525 });
  assert.equal(check.totalVarianceCents, 1);
  assert.equal(check.matches, true);
});

test('a missing line shows up as a real variance, not a rounding one', () => {
  const short = PARAMOUNT.split('\n').filter((line) => !line.startsWith('10015795')).join('\n');
  const result = parseInvoicePaste(short);
  // Dropping a row makes every column the wrong length, which must be reported
  // rather than lined up one row out.
  assert.equal(result.lines.length, 7);
  assert.ok(result.warnings.some((w) => w.includes('left out rather than lined up wrongly')));
});

test('a column with the wrong number of values is never zipped on', () => {
  const text = `63331 WIDGET 6/750 ml 0 / 1 $390.00 $65.00
66743 GADGET 6/500 ml 0 / 2 $139.38 $46.46
GST
$6.50
$4.65
$9.99
Total Inc GST
$71.50
$51.11`;
  const result = parseInvoicePaste(text);
  assert.equal(result.lines.length, 2);
  // Three GST values against two rows: left out and said so.
  assert.ok(result.warnings.some((w) => w.includes('GST column has 3 values but 2 item rows were read')));
  assert.equal(result.lines[0]!.taxAmountCents, 0);
  assert.ok(result.columnsApplied.includes('total inc GST'));
});

test('an unrecognised column is reported instead of guessed at', () => {
  const text = `63331 WIDGET 6/750 ml 0 / 1 $390.00 $65.00
66743 GADGET 6/500 ml 0 / 2 $139.38 $46.46
Rebate Pool
$1.00
$2.00`;
  const result = parseInvoicePaste(text);
  assert.ok(result.warnings.some((w) => w.includes('Rebate Pool')));
  assert.equal(result.lines[0]!.taxAmountCents, 0);
});

test('rows with everything inline need no columns at all', () => {
  const text = `12345 HOUSE RED WINE 6/750 ml 0 / 6 $120.00 $120.00
23456 HOUSE WHITE WINE 6/750 ml 0 / 3 $90.00 $45.00`;
  const result = parseInvoicePaste(text);
  assert.equal(result.lines.length, 2);
  // With no unit column, the unit price is the line total over the printed
  // quantity. Reading the second-to-last figure as a unit price would be
  // wrong here — on this layout it is the carton price.
  assert.equal(result.lines[0]!.quantity, 6);
  assert.equal(result.lines[0]!.lineAmountCents, 12000);
  assert.equal(result.lines[0]!.unitAmountCents, 2000);
  assert.deepEqual(result.lines[0]!.warnings, []);
  assert.equal(result.lines[1]!.quantity, 3);
  assert.equal(result.lines[1]!.unitAmountCents, 1500);
});

test('an inline line total that will not divide says so', () => {
  const result = parseInvoicePaste('12345 ODD WINE 6/750 ml 0 / 7 $120.00 $20.00');
  assert.equal(result.lines[0]!.quantity, 7);
  assert.equal(result.lines[0]!.unitAmountCents, 286);
  assert.ok(result.lines[0]!.warnings.some((w) => w.includes('does not divide evenly')));
});

test('a quantity that cannot be made to work is flagged, not rounded away', () => {
  const text = `12345 ODD ITEM 3 $7.00 $22.00
GST
$2.20
$1.00
LUC Ex GST
$7.00
$4.00
23456 OTHER ITEM 2 $4.00 $8.00`;
  const result = parseInvoicePaste(text);
  const odd = result.lines.find((line) => line.itemCode === '12345')!;
  // 3 x $7.00 is $21.00, not $22.00.
  assert.equal(odd.quantity, 3);
  assert.ok(odd.warnings.some((w) => w.includes('does not make')));
});

test('table headers and stray text are surfaced, never silently dropped', () => {
  const text = `Code Description Pack Qty Price Amount
63331 WIDGET 6/750 ml 0 / 1 $390.00 $65.00
Thank you for your business`;
  const result = parseInvoicePaste(text);
  assert.equal(result.lines.length, 1);
  assert.deepEqual(result.unparsed, ['Code Description Pack Qty Price Amount', 'Thank you for your business']);
});

test('empty text says so rather than producing an empty invoice', () => {
  const result = parseInvoicePaste('   \n\n  ');
  assert.equal(result.lines.length, 0);
  assert.ok(result.warnings.some((w) => w.includes('No item lines')));
});

test('credits and negative amounts survive', () => {
  assert.equal(moneyTokenToCents('$1,035.25'), 103525);
  assert.equal(moneyTokenToCents('-$4.00'), -400);
  assert.equal(moneyTokenToCents('(4.00)'), -400);
  assert.equal(moneyTokenToCents('65'), 6500);
});

test('a bare quantity is never mistaken for money', () => {
  const result = parseInvoicePaste('9000000 Carton Freight MISC 24 $1.30 $31.20');
  assert.equal(result.lines[0]!.quantity, 24);
  assert.equal(result.lines[0]!.unitAmountCents, 130);
  assert.equal(result.lines[0]!.lineAmountCents, 3120);
});

test('quantityFromMoney refuses to invent a quantity', () => {
  assert.equal(quantityFromMoney(58800, 4900), 12);
  assert.equal(quantityFromMoney(40, 1), 40);
  // Half a unit is not a quantity this can resolve.
  assert.equal(quantityFromMoney(2200, 700), null);
  assert.equal(quantityFromMoney(6500, 0), null);
  // A cent of per-unit rounding is tolerated; suppliers do this constantly.
  assert.equal(quantityFromMoney(7518, 2506), 3);
});

test('a line with no money at all is reported, not costed at zero', () => {
  const text = `63331 WIDGET 6/750 ml 0 / 1 $390.00 $65.00
99999 MYSTERY ITEM
GST
$6.50
$0.00
LUC Ex GST
$65.00
$0.00`;
  const result = parseInvoicePaste(text);
  const mystery = result.lines.find((line) => line.itemCode === '99999');
  if (mystery) {
    assert.ok(mystery.warnings.some((w) => w.includes('No line amount')));
  } else {
    assert.ok(result.unparsed.some((line) => line.includes('MYSTERY')));
  }
});
