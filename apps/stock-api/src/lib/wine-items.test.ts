import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { impliedPrice, itemTitle, outlierPours, sectionCategory, type SiblingPour } from './wine-items.js';

const pour = (ml: number, menu: number, register: number | null): SiblingPour => ({
  ml,
  menuCents: menu * 100,
  registerCents: register === null ? null : register * 100
});

describe('sectionCategory', () => {
  it('files every heading the two printed lists actually use', () => {
    // Straight from docs/wine-list.tsv; a heading falling through to null here
    // means wines silently do not get created.
    const expected: Array<[string, string]> = [
      ['Chardonnay', 'White Wine'],
      ['Other whites', 'White Wine'],
      ['White', 'White Wine'],
      ['Sauvignon Blanc & Semillon', 'White Wine'],
      ['Riesling', 'White Wine'],
      ['Skin contact & orange', 'White Wine'],
      ['Other reds', 'Red Wine'],
      ['Shiraz', 'Red Wine'],
      ['Red', 'Red Wine'],
      ['Pinot Noir', 'Red Wine'],
      ['Cabernet & Bordeaux blends', 'Red Wine'],
      ['Mexican wine', 'Red Wine'],
      ['Rosé', 'Rose'],
      ['Bubbles', 'Sparkling Wine']
    ];
    for (const [section, category] of expected) assert.equal(sectionCategory(section), category, section);
  });

  it('refuses to guess at the fortified, which is none of the four', () => {
    assert.equal(sectionCategory('Sweet & fortified'), null);
  });

  it('is not thrown by case or a stray space', () => {
    assert.equal(sectionCategory('  BUBBLES '), 'Sparkling Wine');
    assert.equal(sectionCategory('rose'), 'Rose');
  });

  it('returns null rather than a wrong home for an unknown heading', () => {
    assert.equal(sectionCategory('Sake'), null);
    assert.equal(sectionCategory(null), null);
    assert.equal(sectionCategory(''), null);
  });
});

describe('itemTitle', () => {
  it('names a wine the way the register already names its neighbours', () => {
    assert.equal(
      itemTitle({ producer: 'Haddow & Dineen', cuvee: 'Private Universe', grape: 'Pinot Noir' }, 750),
      'Haddow & Dineen Private Universe Pinot Noir 750mL'
    );
    assert.equal(itemTitle({ producer: 'Tolpuddle', cuvee: null, grape: 'Chardonnay' }, 750), 'Tolpuddle Chardonnay 750mL');
    assert.equal(itemTitle({ producer: 'BenMarco', cuvee: null, grape: 'Malbec' }, 150), 'BenMarco Malbec 150mL');
  });

  it('does not say the grape twice', () => {
    // The register has "Villa Albergotti Chianti Superiore", not
    // "...Chianti Superiore Sangiovese".
    assert.equal(
      itemTitle({ producer: 'Villa Albergotti', cuvee: 'Chianti Superiore', grape: 'Sangiovese' }, 250),
      'Villa Albergotti Chianti Superiore Sangiovese 250mL'
    );
    assert.equal(
      itemTitle({ producer: 'Domaine Christian Salmon', cuvee: 'Sancerre', grape: 'Sauvignon Blanc' }, 750),
      'Domaine Christian Salmon Sancerre Sauvignon Blanc 750mL'
    );
    // The real repetition case: the grape word is already in the name.
    assert.equal(
      itemTitle({ producer: 'Grosset', cuvee: 'Polish Hill Riesling', grape: 'Riesling' }, 750),
      'Grosset Polish Hill Riesling 750mL'
    );
    assert.equal(
      itemTitle({ producer: 'Shiraz House', cuvee: null, grape: 'Shiraz' }, 750),
      'Shiraz House 750mL'
    );
  });

  it('does not spell a long blend out, the way the register does not', () => {
    // The register's own title for this wine is "Chateau Domecq 750mL".
    assert.equal(
      itemTitle({ producer: 'Château Domecq', cuvee: null, grape: 'Cabernet Sauvignon Merlot Nebbiolo' }, 750),
      'Château Domecq 750mL'
    );
    assert.equal(
      itemTitle({ producer: 'Taittinger', cuvee: 'Brut Réserve', grape: 'Chardonnay Pinot Noir Pinot Meunier' }, 750),
      'Taittinger Brut Réserve 750mL'
    );
    // Two grapes IS the wine's name — "Wendouree Cabernet Malbec 750mL".
    assert.equal(
      itemTitle({ producer: 'Wendouree', cuvee: null, grape: 'Cabernet Malbec' }, 750),
      'Wendouree Cabernet Malbec 750mL'
    );
  });

  it('copes with a wine that has no grape on the list', () => {
    assert.equal(itemTitle({ producer: 'Brave New Wine', cuvee: 'Pystopia', grape: null }, 750), 'Brave New Wine Pystopia 750mL');
  });

  it('carries the pour size the register reads off the title', () => {
    assert.equal(itemTitle({ producer: 'All Saints Estate', cuvee: 'Grand', grape: null }, 60), 'All Saints Estate Grand 60mL');
    assert.equal(itemTitle({ producer: 'Taittinger', cuvee: 'Brut Réserve', grape: null }, 375), 'Taittinger Brut Réserve 375mL');
  });
});

describe('outlierPours', () => {
  it('catches the glass priced above the bottle', () => {
    // The live fault: Avalon's Catalina Sounds 150mL at $105.
    const pours = [pour(150, 17, 105), pour(250, 27, 26), pour(750, 77, 76)];
    assert.deepEqual(outlierPours(pours).map((row) => row.ml), [150]);
  });

  it('leaves a sanely priced wine alone', () => {
    assert.deepEqual(outlierPours([pour(150, 17, 16), pour(250, 27, 26), pour(750, 77, 76)]), []);
  });

  it('says nothing about a wine sold in one size', () => {
    assert.deepEqual(outlierPours([pour(750, 77, 7600)]), []);
  });

  it('ignores pours with no price rather than calling them outliers', () => {
    assert.deepEqual(outlierPours([pour(150, 17, null), pour(750, 77, 76)]), []);
  });
});

describe('impliedPrice', () => {
  it('follows the offset its siblings already carry, not the menu', () => {
    // Both siblings sit a dollar under the new list, so the glass does too:
    // $17 menu becomes $16, not $17. The list's rise is not live yet.
    assert.equal(impliedPrice(1700, [pour(250, 27, 26), pour(750, 77, 76)]), 1600);
  });

  it('uses the menu price when the siblings already match the menu', () => {
    assert.equal(impliedPrice(1700, [pour(250, 27, 27), pour(750, 77, 77)]), 1700);
  });

  it('takes the middle when the siblings disagree', () => {
    assert.equal(impliedPrice(2000, [pour(250, 30, 28), pour(500, 50, 49), pour(750, 80, 80)]), 1900);
  });

  it('averages the two middles on an even number of siblings', () => {
    // Offsets of -$2.00 and -$1.00 average to -$1.50, so $20.00 rings $18.50.
    assert.equal(impliedPrice(2000, [pour(250, 30, 28), pour(750, 80, 79)]), 1850);
  });

  it('falls back to the menu with nothing to learn from', () => {
    assert.equal(impliedPrice(1700, []), 1700);
    assert.equal(impliedPrice(1700, [pour(750, 77, null)]), 1700);
  });

  it('never returns a negative price', () => {
    assert.equal(impliedPrice(100, [pour(750, 8000, 10)]), 0);
  });
});
