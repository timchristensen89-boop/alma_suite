import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aliasKey,
  isNonStockLine,
  matchInvoiceLine,
  productTokens,
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
