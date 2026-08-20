import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { explains, poursizeOf, scoreCandidate, tokens, vintageOf, vintageVerdict } from './wine-match.js';

const CONFIDENT = 0.62;

/** The shape the seeder builds per row, so the tests read like real rows. */
function row(input: { producer: string; cuvee?: string; grape?: string; section?: string; vintage?: number | null }) {
  return {
    maker: tokens(`${input.producer} ${input.cuvee ?? ''}`),
    wanted: tokens(`${input.producer} ${input.cuvee ?? ''} ${input.grape ?? ''} ${input.section ?? ''}`),
    rowVintage: input.vintage ?? null
  };
}

function score(r: ReturnType<typeof row>, title: string): number {
  return scoreCandidate({ ...r, title, recipeTokens: tokens(title) });
}

describe('tokens', () => {
  it('folds accents, so the printed list matches the register', () => {
    assert.deepEqual([...tokens('Château Domecq')], [...tokens('Chateau Domecq')]);
    assert.ok(tokens('Taittinger Brut Réserve').has('reserve'));
  });

  it('drops pour sizes and vintages, which say nothing about which wine it is', () => {
    assert.deepEqual([...tokens('BenMarco Malbec 150mL')].sort(), ['benmarco', 'malbec']);
    assert.equal(tokens('Rockford Basket Press Shiraz 2017 750mL').has('2017'), false);
  });

  it('keeps the words that tell two producers apart', () => {
    // An earlier version binned "domaine" and "chateau" as boilerplate, which
    // is exactly what distinguishes these two.
    assert.ok(tokens('Domaines Schlumberger').has('domaines'));
    assert.ok(tokens('Domaine Bouchard').has('domaine'));
  });
});

describe('poursizeOf', () => {
  it('reads the pour out of the title, and calls a bare bottle 750', () => {
    assert.equal(poursizeOf('BenMarco Malbec 150mL'), 150);
    assert.equal(poursizeOf('Loic Mahe Sables & Schists Chenin Blanc'), 750);
  });
});

describe('vintageOf', () => {
  it('reads a year that stands on its own', () => {
    assert.equal(vintageOf('Rockford Basket Press Shiraz 2017 750mL'), 2017);
  });

  it('is not fooled by numbers that are not vintages', () => {
    // "1941" is a planting date in the vineyard's name, not the year in the
    // bottle, and "2.7" is part of the wine's name.
    assert.equal(vintageOf('Eperosa Magnolia 1941 750mL'), null);
    assert.equal(vintageOf('Surco 2.7 750mL'), null);
  });

  it('says nothing when a title carries two years', () => {
    assert.equal(vintageOf('Rockford 2017 2018 750mL'), null);
  });

  it('says nothing when the title has no year at all', () => {
    assert.equal(vintageOf('Capa Tempranillo 750mL'), null);
  });
});

describe('vintageVerdict', () => {
  it('agrees, disagrees, or stays silent', () => {
    assert.equal(vintageVerdict(2017, 'Rockford Basket Press Shiraz 2017 750mL'), 'agree');
    assert.equal(vintageVerdict(2017, 'Rockford Basket Press Shiraz 2018 750mL'), 'disagree');
    assert.equal(vintageVerdict(2017, 'Rockford Basket Press Shiraz 750mL'), 'silent');
    assert.equal(vintageVerdict(null, 'Rockford Basket Press Shiraz 2017 750mL'), 'silent');
  });
});

describe('scoreCandidate', () => {
  it('separates the two Rockfords, which every other word makes identical', () => {
    // The bug this was written for: both scored 1.00 against both bottles, so
    // the pair was dropped as ambiguous and neither vintage got its notes.
    const r2017 = row({ producer: 'Rockford', cuvee: 'Basket Press', grape: 'Shiraz', vintage: 2017 });
    assert.ok(score(r2017, 'Rockford Basket Press Shiraz 2017 750mL') >= CONFIDENT);
    assert.equal(score(r2017, 'Rockford Basket Press Shiraz 2018 750mL'), 0);

    const r2018 = row({ producer: 'Rockford', cuvee: 'Basket Press', grape: 'Shiraz', vintage: 2018 });
    assert.equal(score(r2018, 'Rockford Basket Press Shiraz 2017 750mL'), 0);
    assert.ok(score(r2018, 'Rockford Basket Press Shiraz 2018 750mL') >= CONFIDENT);
  });

  it('takes the style word the register appends and the list keeps in a column', () => {
    // "R. Paulazzo" vs "R. Paulazzo Rose 150mL" scored 0.50 and was reported
    // missing, purely for the word "Rose".
    const paulazzo = row({ producer: 'R. Paulazzo', grape: 'Nebbiolo', section: 'Rosé', vintage: 2024 });
    assert.ok(score(paulazzo, 'R. Paulazzo Rose 150mL') >= CONFIDENT);
  });

  it('still refuses a wine that only shares its grape', () => {
    // Two Pinot Noirs from different makers must never match on the grape.
    const paulazzo = row({ producer: 'R. Paulazzo', grape: 'Pinot Noir' });
    assert.equal(score(paulazzo, 'Nielson Pinot Noir 750mL'), 0);
  });

  it('does not let a vintage rescue a name that does not match', () => {
    const other = row({ producer: 'Geoff Merrill', cuvee: 'Reserve', vintage: 2016 });
    assert.ok(score(other, 'Yalumba The Reserve Cabernet Sauvignon 2016 750mL') < CONFIDENT);
  });

  it('scores a long blend against a short register title as the match it is', () => {
    // Dice gives this 0.5 purely for the words the register leaves out.
    const domecq = row({
      producer: 'Château Domecq',
      grape: 'Cabernet Sauvignon Merlot Nebbiolo',
      vintage: 2019
    });
    assert.ok(score(domecq, 'Chateau Domecq 750mL') >= CONFIDENT);
  });

  it('holds a wine to the venue-agnostic parts only — no accidental credit', () => {
    const empty = row({ producer: '' });
    assert.equal(score(empty, 'Capa Tempranillo 750mL'), 0);
  });
});

describe('explains', () => {
  it('rewards accounting for every word the register wrote', () => {
    const wanted = tokens('Capa Tempranillo');
    const maker = tokens('Capa');
    assert.equal(explains(wanted, maker, tokens('Capa Tempranillo 750mL')), 1);
  });

  it('marks down a register title carrying words the wine cannot explain', () => {
    const wanted = tokens('AIX');
    const maker = tokens('AIX');
    assert.ok(explains(wanted, maker, tokens('Maison Saint AIX Rose 750mL')) < CONFIDENT);
  });
});
