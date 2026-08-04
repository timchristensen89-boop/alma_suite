import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aliasKey,
  productDescription,
  isNonStockLine,
  matchInvoiceLine,
  packFormat,
  productTokens,
  sizeSignature,
  describesDifferentProduct,
  suggestItems,
  type MatchCandidate
} from '@alma/shared';

/**
 * Every description in this file is real text from a production invoice. The
 * matcher exists to cope with what suppliers actually send, so inventing
 * tidier examples would test the wrong thing.
 */

/* ---------------------------------------------------------------- */
/* Lines that are not stock                                          */
/* ---------------------------------------------------------------- */

test('charges and fees are recognised as not being stock', () => {
  // These four accounted for 256 of the 995 lines waiting for review.
  assert.equal(isNonStockLine('Square Fees'), true);
  assert.equal(isNonStockLine('Delivery'), true);
  assert.equal(isNonStockLine('Food Supplies'), true);
  assert.equal(isNonStockLine('GST'), true);
});

test('a supplier name repeated as a line is a header, not a product', () => {
  assert.equal(isNonStockLine('Paramount Liquor', 'Paramount Liquor'), true);
  // The same words on somebody else's invoice are not a header.
  assert.equal(isNonStockLine('Paramount Liquor', 'FoodByUs'), false);
});

test('a real product is never mistaken for a charge', () => {
  assert.equal(isNonStockLine('SALMON ROE 100GM TASI (Yarra Valley) EA'), false);
  assert.equal(isNonStockLine('Lettuce Iceberg'), false);
  // Contains the word "delivery" but is plainly a product.
  assert.equal(isNonStockLine('Delivery Boxes Cardboard Large'), false);
});

/* ---------------------------------------------------------------- */
/* Reading the description                                           */
/* ---------------------------------------------------------------- */

test('order commentary the supplier appends is stripped', () => {
  const tokens = productTokens(
    'CHIPS 7MM SHOESTRING FRIES 5X3KG G/FREE (McCain) CTN. Ordered: 1 unit, Supplied Qty: 1 unit'
  );
  assert.ok(tokens.includes('shoestring'), `expected shoestring in ${tokens.join(',')}`);
  assert.ok(tokens.includes('fries'));
  // Brand, pack size, unit and the trailing commentary all carry no identity.
  assert.ok(!tokens.includes('mccain'));
  assert.ok(!tokens.includes('ctn'));
  assert.ok(!tokens.includes('ordered'));
  assert.ok(!tokens.includes('unit'));
});

test('pack sizes and measures are stripped', () => {
  const tokens = productTokens("TOILET PAPER ROLL 2PLY 400SHT IND WRAP 48'S (Pure Washroom)");
  assert.deepEqual(tokens.filter((t) => /\d/.test(t)), [], `numbers survived: ${tokens.join(',')}`);
  assert.ok(tokens.includes('toilet') && tokens.includes('paper'));
});

test('units attached to numbers do not become tokens', () => {
  const tokens = productTokens('COCONUT MILK 400ML (Royal Line) EA (24)');
  assert.deepEqual(tokens.sort(), ['coconut', 'milk']);
});

/* ---------------------------------------------------------------- */
/* Matching                                                          */
/* ---------------------------------------------------------------- */

const items: MatchCandidate[] = [
  { id: 'fries', name: 'Shoestring Fries' },
  { id: 'coconut', name: 'Coconut Milk' },
  { id: 'lettuce', name: 'Lettuce Iceberg' },
  { id: 'cream', name: 'Cream Thickened' },
  { id: 'salmon', name: 'Salmon Fillet Sashimi Skin On' },
  { id: 'ketchup', name: 'Tomato Ketchup 1L', sku: 'KTC-1L' }
];

test('a noisy supplier description reaches the right item', () => {
  const match = matchInvoiceLine(
    { description: 'CHIPS 7MM SHOESTRING FRIES 5X3KG G/FREE (McCain) CTN. Ordered: 1 unit, Supplied Qty: 1 unit' },
    items
  );
  assert.equal(match.itemId, 'fries');
  assert.equal(match.status, 'AUTO_MATCHED');
  assert.equal(match.reason, 'TOKENS');
});

test('the old substring matcher could not do this one', () => {
  // "Coconut Milk" is not a substring of the description because of the
  // interleaved size, which is why this line sat unmatched.
  const match = matchInvoiceLine({ description: 'COCONUT MILK 400ML (Royal Line) EA (24)' }, items);
  assert.equal(match.itemId, 'coconut');
});

test('an exact name still matches, and reports why', () => {
  const match = matchInvoiceLine({ description: 'Lettuce Iceberg' }, items);
  assert.equal(match.itemId, 'lettuce');
  assert.equal(match.reason, 'EXACT_NAME');
});

test('a SKU beats everything', () => {
  const match = matchInvoiceLine({ description: 'something else entirely', itemCode: 'ktc 1l' }, items);
  assert.equal(match.itemId, 'ketchup');
  assert.equal(match.reason, 'SKU');
});

test('a charge is classified, not left in the queue', () => {
  const match = matchInvoiceLine({ description: 'Square Fees' }, items);
  assert.equal(match.status, 'NON_STOCK');
  assert.equal(match.itemId, null);
});

test('a weak partial overlap is left for a human', () => {
  // Shares only "milk" with Coconut Milk — half the item's name. Guessing here
  // would write a dairy price onto a tinned good.
  const match = matchInvoiceLine({ description: 'MILK FULL CREAM 2LT (Dairy Farmers)' }, items);
  assert.equal(match.status, 'NEEDS_REVIEW');
  assert.equal(match.itemId, null);
});

test('two items fitting equally well is a question, not a match', () => {
  const ambiguous: MatchCandidate[] = [
    { id: 'a', name: 'Tomato Sauce' },
    { id: 'b', name: 'Tomato Paste' }
  ];
  // "tomato" hits both at exactly 0.5; neither is decisive.
  const match = matchInvoiceLine({ description: 'TOMATO PRODUCT 1KG' }, ambiguous);
  assert.equal(match.status, 'NEEDS_REVIEW');
});

test('an unknown product is left for a human rather than forced', () => {
  const match = matchInvoiceLine({ description: 'DISPOSABLE FACE MASK 3PLY 50PIECES' }, items);
  assert.equal(match.status, 'NEEDS_REVIEW');
  assert.equal(match.itemId, null);
});

/* ---------------------------------------------------------------- */
/* Learned aliases                                                   */
/* ---------------------------------------------------------------- */

test('a match a human made once is never asked for again', () => {
  // This exact description appeared 12 times in production, each time asking
  // the same person the same question.
  const description = 'BARRAMUNDI FILLETS IMP 200/300 S/OFF 5KG (Trading) CTN. Ordered: 1 unit, Supplied Qty: 1 unit';
  const withoutAlias = matchInvoiceLine({ description }, items);
  assert.equal(withoutAlias.status, 'NEEDS_REVIEW');

  const aliases = new Map([[aliasKey(description), 'salmon']]);
  const withAlias = matchInvoiceLine({ description }, items, { aliases });
  assert.equal(withAlias.itemId, 'salmon');
  assert.equal(withAlias.reason, 'ALIAS');
});

test('an alias pointing at a deleted item is ignored rather than trusted', () => {
  const aliases = new Map([[aliasKey('Some Product'), 'no-longer-exists']]);
  const match = matchInvoiceLine({ description: 'Some Product' }, items, { aliases });
  assert.equal(match.itemId, null);
});

test('alias keys ignore case and punctuation drift', () => {
  assert.equal(aliasKey('SALMON ROE 100GM (Yarra)'), aliasKey('salmon roe 100gm  (yarra)'));
});

/* ---------------------------------------------------------------- */
/* Suggestions                                                       */
/* ---------------------------------------------------------------- */

test('a line needing review comes with ranked suggestions', () => {
  const suggestions = suggestItems('MILK FULL CREAM 2LT (Dairy Farmers)', items);
  assert.ok(suggestions.length > 0);
  // Both plausible candidates surface, best first, so it is one tap not a search.
  assert.ok(suggestions.some((s) => s.item.id === 'coconut' || s.item.id === 'cream'));
  for (let i = 1; i < suggestions.length; i += 1) {
    assert.ok(suggestions[i - 1]!.confidence >= suggestions[i]!.confidence);
  }
});

test('a description with nothing to go on suggests nothing', () => {
  assert.deepEqual(suggestItems('12345 500ml', items), []);
});

/* ---------------------------------------------------------------- */
/* Words that mean two products are not the same thing               */
/* ---------------------------------------------------------------- */

test('skin on is not auto-matched to skin off', () => {
  // Found in the production dry run: four of five words identical, and the one
  // that differed was the one that mattered. It scored 0.8 and would have
  // written one product's price onto another.
  const chicken: MatchCandidate[] = [{ id: 'off', name: 'CHICKEN THIGH FILLETS SKIN OFF' }];
  const match = matchInvoiceLine(
    { description: 'CHICKEN THIGH FILLETS SKIN ON. Ordered: 8 KG, Supplied Qty: 8 KG' },
    chicken
  );
  assert.equal(match.status, 'NEEDS_REVIEW');
  assert.equal(match.itemId, null);
});

test('the right one still matches when both are present', () => {
  const chicken: MatchCandidate[] = [
    { id: 'off', name: 'CHICKEN THIGH FILLETS SKIN OFF' },
    { id: 'on', name: 'CHICKEN THIGH FILLETS SKIN ON' }
  ];
  const match = matchInvoiceLine({ description: 'CHICKEN THIGH FILLETS SKIN ON. Ordered: 8 KG' }, chicken);
  assert.equal(match.itemId, 'on');
});

test('silence is not disagreement', () => {
  // An item that says nothing about size must not be blocked by a description
  // that does, or the guard would refuse most honest matches.
  const generic: MatchCandidate[] = [{ id: 'eggs', name: 'Eggs Free Range' }];
  const match = matchInvoiceLine({ description: 'EGGS FREE RANGE LARGE 700GM' }, generic);
  assert.equal(match.itemId, 'eggs');
});

test('colour and preparation words discriminate too', () => {
  const onions: MatchCandidate[] = [{ id: 'red', name: 'Onions Red' }];
  assert.equal(matchInvoiceLine({ description: 'ONIONS BROWN 10KG BAG' }, onions).itemId, null);
  assert.equal(matchInvoiceLine({ description: 'ONIONS RED 10KG BAG' }, onions).itemId, 'red');

  const cheese: MatchCandidate[] = [{ id: 'shredded', name: 'Cheese Mozzarella Shredded' }];
  assert.equal(matchInvoiceLine({ description: 'CHEESE MOZZARELLA WHOLE 2KG' }, cheese).itemId, null);
});

test('a contradicting item is still suggested, but never ranked as a fit', () => {
  const chicken: MatchCandidate[] = [{ id: 'off', name: 'CHICKEN THIGH FILLETS SKIN OFF' }];
  const [top] = suggestItems('CHICKEN THIGH FILLETS SKIN ON', chicken);
  assert.ok(top, 'the near neighbour should still be offered');
  assert.ok(top.confidence < 0.7, `should not read as a fit, got ${top.confidence}`);
});

/* ---------------------------------------------------------------- */
/* Pack size and pack format discriminate                            */
/* ---------------------------------------------------------------- */

test('a pack size stated on both sides must agree', () => {
  // Found in production: stripping sizes made 1kg and 2kg butter the same
  // item, so a $27 line and a $12 line both wrote onto one product.
  const butter: MatchCandidate[] = [{ id: '1kg', name: 'BUTTER UNSALTED 1KG (Devondale)' }];
  assert.equal(matchInvoiceLine({ description: 'BUTTER UNSALTED COOKING 2KG (Pepe Saya) EA (2)' }, butter).itemId, null);
  assert.equal(matchInvoiceLine({ description: 'BUTTER UNSALTED 1KG (Devondale)' }, butter).itemId, '1kg');
});

test('sizes compare across units, so 1kg and 1000gm agree', () => {
  assert.equal(sizeSignature('BUTTER 1KG'), sizeSignature('BUTTER 1000GM'));
  assert.equal(sizeSignature('JUICE 1LT'), sizeSignature('JUICE 1000ML'));
  assert.equal(sizeSignature('CHOCOLATE WHITE 2.5KG'), '2500g');
  assert.equal(sizeSignature('Lettuce Iceberg'), null);
});

test('a size on only one side is not a disagreement', () => {
  // Most item names carry no size at all; requiring one would refuse
  // nearly every honest match.
  const generic: MatchCandidate[] = [{ id: 'coconut', name: 'Coconut Milk' }];
  assert.equal(matchInvoiceLine({ description: 'COCONUT MILK 400ML (Royal Line) EA (24)' }, generic).itemId, 'coconut');
});

test('a box is not a bunch', () => {
  // The $55 box of carrots matched to a $4.28 bunch, because "box" was
  // discarded as packaging noise.
  const carrots: MatchCandidate[] = [{ id: 'box', name: 'Carrots Dutch Box' }];
  assert.equal(matchInvoiceLine({ description: 'Carrots Dutch Rainbow Bunch' }, carrots).itemId, null);
});

test('format synonyms still agree — a carton is a box', () => {
  assert.equal(packFormat('TOMATO box LRG'), packFormat('TOMATOES CTN'));
  assert.equal(packFormat('OIL 4LT CARTON'), 'box');
  assert.equal(packFormat('Lettuce Iceberg'), null);
});

test('a one-word item name does not swallow longer descriptions', () => {
  // "Cabbage Each" reduces to the single word "cabbage", which appears in
  // every cabbage product the supplier sells.
  const cabbage: MatchCandidate[] = [{ id: 'each', name: 'Cabbage Each' }];
  assert.equal(matchInvoiceLine({ description: 'Cabbage Sugar Loaf Tray' }, cabbage).itemId, null);
  assert.equal(matchInvoiceLine({ description: 'Cabbage Shredded 1kg' }, cabbage).itemId, null);
  // The plain thing still matches.
  assert.equal(matchInvoiceLine({ description: 'Cabbage' }, cabbage).itemId, 'each');
});

test('describesDifferentProduct is the single place all three checks live', () => {
  assert.equal(describesDifferentProduct('BUTTER 1KG', 'BUTTER 2KG'), true);
  assert.equal(describesDifferentProduct('Carrots Box', 'Carrots Bunch'), true);
  assert.equal(describesDifferentProduct('CHICKEN SKIN ON', 'CHICKEN SKIN OFF'), true);
  assert.equal(describesDifferentProduct('Coconut Milk', 'COCONUT MILK 400ML (Royal Line) EA'), false);
});

/**
 * Per-delivery commentary. FoodByUs appends the weight actually delivered to
 * every line, which made each of twelve deliveries of the same beef rib a
 * separate wording — and taught an alias that recorded the weight, so it could
 * never fire again. 231 of 470 unmatched production lines carried it.
 */
const RIB = 'BEEF SHORT RIBS GRAINFED 3 RIB';
const DELIVERIES = [
  `${RIB}. Ordered: 26 KG, Supplied Qty: 26.3 KG, Reason for adjustment: Random Weight`,
  `${RIB}. Ordered: 40 KG, Supplied Qty: 41.1 KG, Reason for adjustment: Random Weight`,
  `${RIB}. Ordered: 14 KG, Supplied Qty: 17.1 KG, Reason for adjustment: Delivered Less/More`
];

test('delivery commentary is not part of the product name', () => {
  for (const line of DELIVERIES) {
    assert.equal(productDescription(line), RIB);
  }
});

test('every delivery of the same product shares one alias key', () => {
  const keys = new Set(DELIVERIES.map(aliasKey));
  assert.equal(keys.size, 1, 'twelve deliveries should teach one alias, not twelve');
  assert.equal([...keys][0], aliasKey(RIB));
});

test('an alias learned on one delivery matches the next one', () => {
  const items: MatchCandidate[] = [{ id: 'beef-rib', name: 'Beef Short Rib Grainfed', sku: null }];
  const aliases = new Map([[aliasKey(DELIVERIES[0]!), 'beef-rib']]);
  const match = matchInvoiceLine({ description: DELIVERIES[2]! }, items, { aliases });
  assert.equal(match.itemId, 'beef-rib');
});

test('a description with no commentary is untouched', () => {
  assert.equal(productDescription('OIL COTTONSEED 20LT (Trading) EA'), 'OIL COTTONSEED 20LT (Trading) EA');
  assert.equal(productDescription('Chives Bunch'), 'Chives Bunch');
});

test('a full stop that is not commentary survives', () => {
  // "1.5-2KG" and "No. 7" must not be treated as the start of a delivery note.
  assert.equal(
    productDescription('SALMON FILLET S/ON TASI SASHIMI 1.5-2KG (Huon)'),
    'SALMON FILLET S/ON TASI SASHIMI 1.5-2KG (Huon)'
  );
  assert.equal(productDescription('GLOVES RUBBER PINK NO 7 Bastion'), 'GLOVES RUBBER PINK NO 7 Bastion');
});

test('a line that is only commentary keeps its own text', () => {
  // Stripping to nothing would collapse every such line into one review row.
  const odd = '. Ordered: 4 KG, Supplied Qty: 4.2 KG';
  assert.equal(productDescription(odd), odd);
});

test('different products still do not share an alias', () => {
  assert.notEqual(
    aliasKey('BEEF SHORT RIBS GRAINFED 3 RIB. Ordered: 26 KG'),
    aliasKey('BEEF FLANKS / THIN SKIRTS. Ordered: 26 KG')
  );
});
