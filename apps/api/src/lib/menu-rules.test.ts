import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canPublishMenus,
  diffMenuDocuments,
  ensureDishKeys,
  formatMenuPrice,
  formatMenuTags,
  menuDiffIsEmpty,
  menuDraftSaveInputSchema,
  menuTagLegend,
  newDishKey,
  overflowIssue,
  parseMenuPriceInput,
  renderMenuHtml,
  renderMenuSheetHtml,
  sortMenuTags,
  summariseMenuDiff,
  validateMenuDocument,
  type MenuDocument,
  type MenuItemDocument,
  type MenuRenderAssets,
  type MenuSectionDocument
} from '@alma/shared';
import { ALMA_AVALON_SEED, MENU_SEEDS, ST_ALMA_FRESHWATER_SEED } from '../data/menu-seed-content.js';

/**
 * The Menu Editor's rules, exercised without a database or a browser: dietary
 * tag validation (the six rules from the brief, overflow aside), the publish
 * diff, dish-key stability, price formatting and the two print templates.
 */

function item(over: Partial<MenuItemDocument> & { name: string }): MenuItemDocument {
  return { dishKey: over.dishKey ?? over.name.toLowerCase(), description: null, priceCents: 1700, priceUnit: null, tags: [], isSeafood: false, visible: true, recipeId: null, ...over };
}

function section(over: Partial<MenuSectionDocument> & { title: string; items: MenuItemDocument[] }): MenuSectionDocument {
  return { headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', visible: true, ...over };
}

function doc(sections: MenuSectionDocument[], footer: Partial<Pick<MenuDocument, 'dietaryNote' | 'surchargeLine'>> = {}): MenuDocument {
  return { dietaryNote: footer.dietaryNote ?? 'Dietaries catered with notice.', surchargeLine: footer.surchargeLine ?? 'Surcharge.', sections };
}

const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code).sort();

describe('dietary tags', () => {
  it('sort into print order, de-duplicate and drop anything unknown', () => {
    assert.deepEqual(sortMenuTags(['N', 'df', 'VG', 'GFA', 'VG', 'X', 'gf']), ['VG', 'GF', 'GFA', 'DF', 'N']);
    assert.equal(formatMenuTags(['A', 'GF']), 'GF · A');
  });

  it('build the legend from the tags on printed items only, in print order', () => {
    const d = doc([
      section({ title: 'To start', items: [item({ name: 'Guac', tags: ['VG', 'GFA'] }), item({ name: 'Hidden', tags: ['I'], visible: false })] }),
      section({ title: 'Gone', visible: false, items: [item({ name: 'x', tags: ['N'] })] })
    ]);
    assert.equal(menuTagLegend(d), 'VG vegan · GFA gluten free available');
  });

  it('the seeded menus use every tag, so their legend is the printed one', () => {
    for (const seed of MENU_SEEDS) {
      assert.equal(
        menuTagLegend(seed.document),
        'V vegetarian · VG vegan · GF gluten free · GFA gluten free available · DF dairy free · N contains nuts · A australian · I imported'
      );
    }
  });
});

describe('validateMenuDocument — the publish gate', () => {
  it('passes both seeded menus with no errors and no warnings', () => {
    for (const seed of MENU_SEEDS) {
      const result = validateMenuDocument(seed.document);
      assert.deepEqual(result.errors, [], seed.templateKey);
      assert.deepEqual(result.warnings, [], seed.templateKey);
      assert.equal(result.ok, true);
    }
  });

  it('errors on GF and GFA together', () => {
    const result = validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Fries', tags: ['GF', 'GFA'] })] })]));
    assert.deepEqual(codes(result.errors), ['GF_AND_GFA']);
    assert.equal(result.ok, false);
  });

  it('errors on A and I together', () => {
    const result = validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Prawns', tags: ['A', 'I'], isSeafood: true })] })]));
    assert.deepEqual(codes(result.errors), ['A_AND_I']);
  });

  it('errors on seafood with neither origin tag, and is satisfied by either', () => {
    assert.deepEqual(codes(validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Snapper', tags: ['GF'], isSeafood: true })] })])).errors), ['SEAFOOD_NO_ORIGIN']);
    assert.deepEqual(validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Snapper', tags: ['GF', 'A'], isSeafood: true })] })])).errors, []);
    assert.deepEqual(validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Octopus', tags: ['I'], isSeafood: true })] })])).errors, []);
  });

  it('warns, not errors, on VG and V together', () => {
    const result = validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'Nopal', tags: ['VG', 'V'] })] })]));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(codes(result.warnings), ['VG_AND_V']);
    assert.equal(result.ok, true);
  });

  it('warns on a standard item with no price, but not on a hidden one or a header-priced taco', () => {
    const d = doc([
      section({ title: 'Grill', items: [item({ name: 'Snapper', priceCents: null }), item({ name: 'Off', priceCents: null, visible: false })] }),
      section({ title: 'Tacos', headerSuffix: '9 each', sectionType: 'HEADER_PRICED', items: [item({ name: 'Barra', priceCents: null, tags: ['A'], isSeafood: true })] })
    ]);
    const result = validateMenuDocument(d);
    assert.deepEqual(codes(result.warnings), ['STANDARD_NO_PRICE']);
    assert.equal(result.warnings[0]?.dishKey, 'snapper');
    assert.equal(result.warnings[0]?.sectionIndex, 0);
    assert.equal(result.warnings[0]?.itemIndex, 0);
  });

  it('errors on a set menu without a price, an empty name, an empty title and a duplicate dish key', () => {
    const d = doc([
      section({ title: '', items: [item({ name: '', dishKey: 'k1' }), item({ name: 'Twin', dishKey: 'k1' })] }),
      section({ title: 'Trust our chef', sectionType: 'SET_MENUS', placement: 'FULL', items: [item({ name: 'Grazing', priceCents: null, priceUnit: 'pp' })] })
    ]);
    assert.deepEqual(codes(validateMenuDocument(d).errors), ['DUPLICATE_DISH_KEY', 'EMPTY_NAME', 'EMPTY_SECTION_TITLE', 'SET_MENU_NO_PRICE']);
  });

  it("leaves 86'd dishes and hidden sections out of the print rules, so a half-built section cannot block tonight's publish", () => {
    const d = doc([
      section({ title: 'Grill', items: [item({ name: 'Snapper', tags: ['A'], isSeafood: true, priceCents: 4000 }), item({ name: 'Oysters', tags: ['GF', 'GFA'], isSeafood: true, priceCents: null, visible: false })] }),
      // Next week's specials: unnamed placeholder dish, no title yet, hidden.
      section({ title: '', visible: false, items: [item({ name: '', dishKey: 'placeholder', priceCents: null })] })
    ]);
    const result = validateMenuDocument(d);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(codes(result.warnings), ['EMPTY_SECTION_TITLE']);
    // ...but a duplicate dish key is an identity problem whether or not it prints.
    const dupe = doc([section({ title: 'S', items: [item({ name: 'A', dishKey: 'same' }), item({ name: 'B', dishKey: 'same', visible: false })] })]);
    assert.deepEqual(codes(validateMenuDocument(dupe).errors), ['DUPLICATE_DISH_KEY']);
  });

  it('errors when nothing would print', () => {
    assert.deepEqual(codes(validateMenuDocument(doc([section({ title: 'S', items: [item({ name: 'x', visible: false })] })])).errors), ['NOTHING_TO_PRINT']);
    assert.deepEqual(codes(validateMenuDocument(doc([])).errors), ['NOTHING_TO_PRINT']);
  });

  it('turns an overflow measurement into a publish-blocking error, and nothing at or under the page', () => {
    assert.equal(overflowIssue({ fillRatio: 0.998, contentHeightPx: 1121, sheetHeightPx: 1123, overflow: false }), null);
    const issue = overflowIssue({ fillRatio: 1.04, contentHeightPx: 1168, sheetHeightPx: 1123, overflow: true });
    assert.equal(issue?.level, 'error');
    assert.equal(issue?.code, 'OVERFLOW');
    assert.match(issue?.message ?? '', /104%/);
  });
});

describe('prices', () => {
  it('print as whole dollars with an optional unit', () => {
    assert.equal(formatMenuPrice(1700), '17');
    assert.equal(formatMenuPrice(4900, 'pp'), '49 pp');
    assert.equal(formatMenuPrice(null), '');
  });

  it('parse the editor field as whole dollars only', () => {
    assert.equal(parseMenuPriceInput('17'), 1700);
    assert.equal(parseMenuPriceInput('$49'), 4900);
    assert.equal(parseMenuPriceInput(''), null);
    assert.equal(parseMenuPriceInput('17.50'), undefined);
    assert.equal(parseMenuPriceInput('abc'), undefined);
  });
});

describe('dish keys', () => {
  it('are minted for new dishes and never changed for existing ones', () => {
    const d = doc([section({ title: 'S', items: [item({ name: 'Churros', dishKey: 'fw-churros' }), { ...item({ name: 'Flan' }), dishKey: undefined }] })]);
    const keyed = ensureDishKeys(d, () => 0.5);
    assert.equal(keyed.sections[0]?.items[0]?.dishKey, 'fw-churros');
    assert.match(keyed.sections[0]?.items[1]?.dishKey ?? '', /^flan-[a-z0-9]{6}$/);
  });

  it('read as the dish name with a short suffix, accents and punctuation folded', () => {
    assert.match(newDishKey('Pico de piña, avocado mousse', () => 0), /^pico-de-pina-avocado-mousse-aaaaaa$/);
  });
});

describe('diffMenuDocuments — the publish summary', () => {
  const before = ST_ALMA_FRESHWATER_SEED.document;

  it('is empty for an unchanged document', () => {
    const diff = diffMenuDocuments(before, before);
    assert.equal(menuDiffIsEmpty(diff), true);
    assert.equal(summariseMenuDiff(diff), 'No content changes');
  });

  it('reports a price change, a tag change, an 86 and an added dish by dish key', () => {
    const after: MenuDocument = JSON.parse(JSON.stringify(before));
    const toStart = after.sections[0]!;
    toStart.items[0]!.priceCents = 1800; // Guacamole 17 → 18
    toStart.items[1]!.tags = ['GF', 'DF', 'I']; // Kingfish A → I
    toStart.items[2]!.visible = false; // Prawn tostada 86'd
    toStart.items.push(item({ name: 'Oysters', dishKey: 'fw-oysters', tags: ['A'], isSeafood: true, priceCents: 2400 }));
    const diff = diffMenuDocuments(before, after);
    assert.deepEqual(diff.priceChanges.map((c) => [c.name, c.from, c.to]), [['Guacamole', '17', '18']]);
    assert.deepEqual(diff.tagChanges.map((c) => [c.name, c.from, c.to]), [['Kingfish ceviche', 'GF · DF · A', 'GF · DF · I']]);
    assert.deepEqual(diff.visibilityChanges.map((c) => [c.name, c.visible]), [['Prawn tostada', false]]);
    assert.deepEqual(diff.added.map((c) => c.name), ['Oysters']);
    assert.deepEqual(diff.removed, []);
    assert.equal(summariseMenuDiff(diff), "1 dish added, 1 price change, 1 tag change, 1 dish 86'd");
  });

  it('reports removals, section moves and footer edits', () => {
    const after: MenuDocument = JSON.parse(JSON.stringify(before));
    after.sections[3]!.items.pop(); // Broccolini removed from Sides
    after.sections[4]!.placement = 'RIGHT'; // Sweet into the right column
    after.surchargeLine = 'No surcharge today.';
    const diff = diffMenuDocuments(before, after);
    assert.deepEqual(diff.removed.map((c) => c.name), ['Broccolini']);
    assert.equal(diff.sectionChanges.length, 1);
    assert.match(diff.sectionChanges[0] ?? '', /Sweet: moved from full width to right column/);
    assert.equal(diff.footerChanges.length, 1);
  });

  it('recognises a renamed section by the dishes it keeps, even against an id-less published snapshot', () => {
    const snapshot: MenuDocument = JSON.parse(JSON.stringify(before));
    const after: MenuDocument = JSON.parse(JSON.stringify(before));
    after.sections[0]!.title = 'Snacks'; // was "To start"
    after.sections[0]!.id = 'fresh-row-id';
    const diff = diffMenuDocuments(snapshot, after);
    assert.deepEqual(diff.sectionChanges, ['Renamed section "To start" to "Snacks".']);
    assert.deepEqual(diff.moved, []);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.removed, []);
  });

  it('treats everything as added when there is no published version yet', () => {
    const diff = diffMenuDocuments(null, ALMA_AVALON_SEED.document);
    assert.equal(diff.added.length, 21);
    assert.deepEqual(diff.sectionChanges, []);
  });
});

describe('menuDraftSaveInputSchema', () => {
  it('trims text, normalises tags and blanks to null, and refuses fractional cents', () => {
    const parsed = menuDraftSaveInputSchema.parse({
      dietaryNote: '  note ',
      sections: [{ title: ' Sides ', items: [{ name: ' Fries ', description: '  ', priceCents: 1100, tags: ['df', 'V', 'nope'] }] }]
    });
    assert.equal(parsed.dietaryNote, 'note');
    assert.equal(parsed.sections[0]?.title, 'Sides');
    assert.equal(parsed.sections[0]?.items[0]?.description, null);
    assert.deepEqual(parsed.sections[0]?.items[0]?.tags, ['V', 'DF']);
    assert.equal(parsed.sections[0]?.items[0]?.priceUnit, null);
    assert.throws(() => menuDraftSaveInputSchema.parse({ sections: [{ title: 'S', items: [{ name: 'x', priceCents: 10.5 }] }] }));
  });
});

describe('canPublishMenus', () => {
  const base = { role: 'STAFF', isAdmin: false, roleTitle: 'Chef de partie', accountType: 'HUMAN', appAccess: [] as Array<{ appId: string; status: string; role: string; permissions?: unknown }> };
  it('lets managers, admins and the head chef publish', () => {
    assert.equal(canPublishMenus({ ...base, role: 'MANAGER' }), true);
    assert.equal(canPublishMenus({ ...base, role: 'ADMIN' }), true);
    assert.equal(canPublishMenus({ ...base, isAdmin: true }), true);
    assert.equal(canPublishMenus({ ...base, roleTitle: 'Head Chef (Kitchen)' }), true);
    assert.equal(canPublishMenus({ ...base, appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'MANAGER' }] }), true);
    assert.equal(canPublishMenus({ ...base, appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER', permissions: { menusPublish: true } }] }), true);
  });
  it('refuses other staff, a MENUS user grant, shared iPads and nobody', () => {
    assert.equal(canPublishMenus(base), false);
    assert.equal(canPublishMenus({ ...base, appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER' }] }), false);
    assert.equal(canPublishMenus({ ...base, appAccess: [{ appId: 'MENUS', status: 'ENABLED', role: 'USER', permissions: { menusPublish: 'yes' } }] }), false);
    assert.equal(canPublishMenus({ ...base, appAccess: [{ appId: 'MENUS', status: 'DISABLED', role: 'USER', permissions: { menusPublish: true } }] }), false);
    assert.equal(canPublishMenus({ ...base, role: 'MANAGER', accountType: 'VENUE_DEVICE' }), false);
    assert.equal(canPublishMenus(null), false);
  });
});

describe('print templates', () => {
  const assets: MenuRenderAssets = { fontFaceCss: '/*fonts*/', logoSrc: (asset) => `/images/${asset}.png` };

  it('Freshwater: two columns, Sweet full width across two columns, Trust our chef as a three-column band', () => {
    const html = renderMenuSheetHtml(ST_ALMA_FRESHWATER_SEED.document, 'freshwater_alacarte', { assets });
    assert.match(html, /class="food-print-page stock-white venue-stalma"/);
    assert.match(html, /<img class="logo" src="\/images\/stalma-logo.png" alt="st.alma">/);
    assert.match(html, /<div class="eyebrow">Restaurant &amp; Bar · Freshwater<\/div>/);
    assert.match(html, /TACOS|Tacos<span class="qual"> \/ 9 each<\/span>/);
    assert.match(html, /<div class="fsec wide"[^>]*><div class="sec-head"><span class="sec-title">Sweet<\/span><\/div><div class="cols"><div class="col">/);
    assert.match(html, /<div class="chef" /);
    assert.doesNotMatch(html, /chef boxed/);
    assert.match(html, /<div class="chef-price">49 pp<\/div>/);
    assert.match(html, /<div class="dietaries">Dietaries catered with notice. Please advise your server of any allergies.<\/div>/);
    assert.match(html, /<div class="legend">V vegetarian · VG vegan/);
  });

  it('Avalon: Trust our chef boxed inside the right column, footer pinned to the bottom', () => {
    const html = renderMenuSheetHtml(ALMA_AVALON_SEED.document, 'avalon_alacarte', { assets });
    assert.match(html, /class="food-print-page stock-white venue-avalon chef-in-column"/);
    assert.match(html, /<div class="chef boxed"/);
    assert.match(html, /<div class="eyebrow">Avalon Beach · Est 2017<\/div>/);
    assert.doesNotMatch(html, /fsec wide/);
  });

  it('header-priced items print names and tags only; hidden items and sections do not print', () => {
    const d = doc([
      section({ title: 'Tacos', headerSuffix: '9 each', sectionType: 'HEADER_PRICED', items: [item({ name: 'Barra', tags: ['A'], priceCents: 900, description: 'should not print', isSeafood: true })] }),
      section({ title: 'Grill', placement: 'RIGHT', items: [item({ name: 'Visible', priceCents: 4000, description: 'Yes' }), item({ name: 'Eighty-sixed', visible: false })] }),
      section({ title: 'Secret', visible: false, items: [item({ name: 'Nope' })] })
    ]);
    const html = renderMenuSheetHtml(d, 'freshwater_alacarte', { assets });
    assert.match(html, /<span class="dname">Barra <span class="tags">A<\/span><\/span><\/div><\/div>/);
    assert.doesNotMatch(html, /should not print/);
    assert.doesNotMatch(html, /dprice">9</);
    assert.match(html, /<span class="dprice">40<\/span>/);
    assert.doesNotMatch(html, /Eighty-sixed/);
    assert.doesNotMatch(html, /Secret|Nope/);
  });

  it('escapes content and emits a self-contained document with the A4 @page rule', () => {
    const d = doc([section({ title: 'S <b>', items: [item({ name: 'Fish & "chips"', description: `Goat's cheese` })] })]);
    const html = renderMenuHtml(d, 'freshwater_alacarte', { assets, title: 'T' });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /@page \{ size: 210mm 297mm; margin: 0; \}/);
    assert.match(html, /S &lt;b&gt;/);
    assert.match(html, /Fish &amp; &quot;chips&quot;/);
    assert.match(html, /Goat&#39;s cheese/);
    assert.doesNotMatch(html, /<b>/);
  });

  it('refuses an unknown template key', () => {
    assert.throws(() => renderMenuSheetHtml(doc([]), 'drinks_binder', { assets }), /Unknown menu template/);
  });
});
