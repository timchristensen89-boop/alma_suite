import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  WINE_CATEGORIES,
  contradictsWine,
  dominantShape,
  impliedPrice,
  itemTitle,
  outlierPours,
  sectionCategory,
  type SiblingPour
} from './wine-items.js';

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
      ['Bubbles', 'Sparkling Wine'],
      ['Sweet & fortified', 'Fortified']
    ];
    for (const [section, category] of expected) assert.equal(sectionCategory(section), category, section);
  });

  it('files the fortified under the category Tim named for it', () => {
    // Held back deliberately until there was a home for it: a Rutherglen
    // Muscat is not red, white, rosé or sparkling, and forcing it into one
    // would have buried it. Fortified is now a category of its own.
    assert.equal(sectionCategory('Sweet & fortified'), 'Fortified');
    assert.equal(sectionCategory('Fortified'), 'Fortified');
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

describe('contradictsWine', () => {
  it('catches the real fault: wines filed under Cocktails', () => {
    // Both live: Loic Mahe Sables & Schists Chenin Blanc at St Alma, and
    // Capa Tempranillo 150mL at Avalon.
    assert.equal(contradictsWine('Cocktails'), true);
    assert.equal(contradictsWine('cocktail'), true);
  });

  it('catches the other drink families too', () => {
    for (const value of ['Beer', 'Spirits', 'Whisky', 'Coffee', 'Soft drinks', 'Tea', 'Juice']) {
      assert.equal(contradictsWine(value), true, value);
    }
  });

  it('leaves a subcategory that says wine alone', () => {
    for (const value of ['Wine by the glass', 'Sparkling wine', 'Rosé', 'Fortified', 'Port', 'Muscat']) {
      assert.equal(contradictsWine(value), false, value);
    }
  });

  it('treats an unfamiliar label as unknown, not wrong', () => {
    // Nobody has to justify their filing to this function. It only fires on a
    // label that names something else.
    for (const value of ['Bubbles', 'Cellar door', 'Premium', 'By the bottle', '']) {
      assert.equal(contradictsWine(value), false, value);
    }
    assert.equal(contradictsWine(null), false);
    assert.equal(contradictsWine(undefined), false);
  });

  it('is not fooled by a wine whose name contains a spirit word', () => {
    // "Port" and "Sherry" are wine; "Ginger beer" is not, and neither is a
    // subcategory that merely reads "Gin".
    assert.equal(contradictsWine('Port & sherry'), false);
    assert.equal(contradictsWine('Gin'), true);
    // Substrings must not fire: "Origin" is not gin, "Teapot" is not tea.
    assert.equal(contradictsWine('Origin'), false);
    assert.equal(contradictsWine('Teapot'), false);
  });
});

describe('dominantShape', () => {
  const neighbour = (title: string, kind: string | null, subcategory: string | null) => ({ title, kind, subcategory });

  it('takes a vote instead of whichever row came back first', () => {
    // This is the bug: the mislabelled Chenin Blanc sorted first and decided
    // how every new white at St Alma was filed.
    const shape = dominantShape([
      neighbour('Loic Mahe Sables & Schists Chenin Blanc', 'BEVERAGE', 'Cocktails'),
      neighbour('Tolpuddle Chardonnay 750mL', 'BEVERAGE', 'Wine by the glass'),
      neighbour('Grosset Polish Hill Riesling 750mL', 'BEVERAGE', 'Wine by the glass')
    ]);
    assert.equal(shape?.subcategory, 'Wine by the glass');
    assert.equal(shape?.kind, 'BEVERAGE');
    assert.equal(shape?.from, 'Tolpuddle Chardonnay 750mL');
  });

  it('refuses the mislabel even when the mislabel would win the vote', () => {
    // Blank is a worse label than the right one and a better one than a wrong
    // one, so a pool that is mostly wrong still cannot pass it on.
    const shape = dominantShape([
      neighbour('Capa Tempranillo 150mL', 'BEVERAGE', 'Cocktails'),
      neighbour('Capa Tempranillo 250mL', 'BEVERAGE', 'Cocktails'),
      neighbour('Wendouree Cabernet Malbec 750mL', 'BEVERAGE', 'Wine by the glass')
    ]);
    assert.equal(shape?.subcategory, 'Wine by the glass');
    assert.equal(shape?.kind, 'BEVERAGE');
  });

  it('leaves the subcategory blank when every neighbour is mislabelled', () => {
    const shape = dominantShape([
      neighbour('Capa Tempranillo 150mL', 'BEVERAGE', 'Cocktails'),
      neighbour('Capa Tempranillo 250mL', 'BEVERAGE', 'Cocktails')
    ]);
    assert.equal(shape?.subcategory, null);
    // The kind is still worth copying — it is not the thing that was wrong.
    assert.equal(shape?.kind, 'BEVERAGE');
  });

  it('keeps a blank subcategory when that is what the neighbours have', () => {
    const shape = dominantShape([
      neighbour('BenMarco Malbec 150mL', 'BEVERAGE', null),
      neighbour('BenMarco Malbec 750mL', 'BEVERAGE', null),
      neighbour('Villa Albergotti Chianti Superiore 250mL', 'BEVERAGE', 'Wine by the glass')
    ]);
    assert.equal(shape?.subcategory, null);
  });

  it('has nothing to say about an empty register', () => {
    assert.equal(dominantShape([]), null);
  });

  it('gives the same answer twice on a tie', () => {
    const pool = [
      neighbour('A 750mL', 'BEVERAGE', 'Red'),
      neighbour('B 750mL', 'BEVERAGE', 'White')
    ];
    assert.deepEqual(dominantShape(pool), dominantShape(pool));
    assert.equal(dominantShape(pool)?.subcategory, 'Red');
  });
});

describe('WINE_CATEGORIES', () => {
  it('contains every category sectionCategory can produce', () => {
    // The one query filter and the one mapping have to agree, or a wine gets
    // created under a category nothing afterwards looks in.
    const produced = [
      'Chardonnay', 'Other whites', 'White', 'Sauvignon Blanc & Semillon', 'Riesling',
      'Skin contact & orange', 'Other reds', 'Shiraz', 'Red', 'Pinot Noir',
      'Cabernet & Bordeaux blends', 'Mexican wine', 'Rosé', 'Bubbles', 'Sweet & fortified'
    ].map((section) => sectionCategory(section));
    for (const category of produced) {
      assert.ok(category, 'every heading on the two lists must map somewhere');
      assert.ok(WINE_CATEGORIES.includes(category as (typeof WINE_CATEGORIES)[number]), category ?? '');
    }
  });
});
