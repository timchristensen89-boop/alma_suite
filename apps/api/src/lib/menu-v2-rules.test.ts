import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  diffMenuDocuments,
  getMenuTemplate,
  MENU_DOCUMENT_DEFAULTS,
  MENU_FILL_PROBE_SCRIPT,
  menuCreateInputSchema,
  menuDocumentSchema,
  menuDocumentsEqual,
  menuDiffIsEmpty,
  menuSlug,
  menuUpdateInputSchema,
  normaliseMenuDocument,
  overflowIssue,
  renderMenuHtml,
  renderMenuSheetHtml,
  sectionsByPage,
  summariseMenuDiff,
  validateMenuDocument,
  type MenuDocument,
  type MenuItemDocument,
  type MenuRenderAssets,
  type MenuSectionDocument
} from '@alma/shared';

/**
 * Menus V2: kinds, pages, the new section types and the paged families,
 * exercised without a database or a browser. The A4 food rules keep their own
 * file (menu-rules.test.ts); this one covers what V2 added on top.
 */

const assets: MenuRenderAssets = { fontFaceCss: '', logoSrc: (asset) => `/images/${asset}.png` };

function item(over: Partial<MenuItemDocument> & { name: string }): MenuItemDocument {
  return {
    dishKey: over.dishKey ?? over.name.toLowerCase().replace(/\s+/g, '-'),
    description: null,
    priceCents: 1200,
    priceUnit: null,
    prices: [],
    meta: null,
    note: null,
    flags: [],
    tags: [],
    isSeafood: false,
    visible: true,
    recipeId: null,
    ...over
  };
}

function section(over: Partial<MenuSectionDocument> & { title: string }): MenuSectionDocument {
  return { headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items: [], ...over };
}

function doc(sections: MenuSectionDocument[], over: Partial<Omit<MenuDocument, 'sections'>> = {}): MenuDocument {
  return { ...MENU_DOCUMENT_DEFAULTS, ...over, sections };
}

const codes = (issues: Array<{ code: string }>) => issues.map((issue) => issue.code).sort();

describe('V2 document model', () => {
  it('normalises a v1 snapshot and an old editor payload to the full document', () => {
    const legacy = { heading: 'Tuesday', dietaryNote: 'd', surchargeLine: 's', sections: [{ title: 'S', sectionType: 'STANDARD', placement: 'LEFT', visible: true, items: [{ name: 'A', tags: ['GF'] }] }] };
    const full = normaliseMenuDocument(legacy as never);
    assert.equal(full.pageCount, 1);
    assert.equal(full.showPrices, true);
    assert.equal(full.conditions, '');
    assert.deepEqual(full.sections[0]!.priceColumns, []);
    assert.equal(full.sections[0]!.page, 1);
    assert.deepEqual(full.sections[0]!.items[0]!.prices, []);
    assert.deepEqual(full.sections[0]!.items[0]!.flags, []);
    assert.deepEqual(full.sections[0]!.items[0]!.tags, ['GF']);
    // The zod schema gives the same defaults, so an editor that predates V2 still saves.
    const parsed = menuDocumentSchema.parse(legacy);
    assert.equal(parsed.pageCount, 1);
    assert.equal(parsed.sections[0]!.page, 1);
    assert.deepEqual(parsed.sections[0]!.items[0]!.prices, []);
    assert.equal(menuDocumentsEqual(full, parsed as MenuDocument), true);
  });

  it('equality and the diff see the card fields, pages, columns and item details', () => {
    const base = doc([section({ title: 'Wine', sectionType: 'TABLE', priceColumns: ['150 mL', 'Bottle'], items: [item({ name: 'Riesling', priceCents: null, prices: [1400, 6800], meta: 'Eden Valley' })] })]);
    assert.equal(menuDocumentsEqual(base, { ...base }), true);
    const moved = { ...base, sections: base.sections.map((s) => ({ ...s, page: 2 })) };
    assert.equal(menuDocumentsEqual(base, moved), false);
    const priced = { ...base, sections: base.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, prices: [1500, 6800] })) })) };
    const diff = diffMenuDocuments(base, priced);
    assert.equal(diff.priceChanges.length, 1);
    assert.equal(diff.priceChanges[0]!.from, '14 · 68');
    assert.equal(diff.priceChanges[0]!.to, '15 · 68');
    const detailed = { ...base, sections: base.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, meta: 'Clare Valley', flags: ['STAFF_PICK' as const] })) })) };
    assert.equal(diffMenuDocuments(base, detailed).detailChanges.length, 1);
    const header = { ...base, subheading: 'Lunch that runs long.', whenLine: 'Sat & Sun · 12–4pm', heroPriceCents: 9900, heroPriceUnit: 'pp', showPrices: false, pageCount: 2 };
    const headerDiff = diffMenuDocuments(base, header);
    assert.equal(headerDiff.headerChanges.length, 5);
    assert.match(summariseMenuDiff(headerDiff), /5 title block changes/);
    assert.equal(menuDiffIsEmpty(headerDiff), false);
    const conditions = { ...base, conditions: 'Two hour sitting.' };
    assert.deepEqual(diffMenuDocuments(base, conditions).footerChanges, ['Conditions changed.']);
    assert.equal(menuDiffIsEmpty(diffMenuDocuments(base, { ...base, sections: base.sections.map((s) => ({ ...s, items: [...s.items] })) })), true);
  });

  it('a menu slug comes from the name and survives punctuation', () => {
    assert.equal(menuSlug('Happy hour'), 'happy-hour');
    assert.equal(menuSlug('Smith wedding — 14 Nov'), 'smith-wedding-14-nov');
    assert.equal(menuSlug('!!!'), 'menu');
  });

  it('create and update inputs carry kind, visibility and event details', () => {
    const created = menuCreateInputSchema.parse({ venueId: 'v1', name: 'Smith wedding', kind: 'PRIVATE_EVENT', eventDate: '2026-11-14', guestCount: 40 });
    assert.equal(created.kind, 'PRIVATE_EVENT');
    assert.equal(created.eventDate, '2026-11-14T00:00:00.000Z');
    assert.equal(created.guestCount, 40);
    assert.equal(menuCreateInputSchema.parse({ venueId: 'v1', name: 'Food' }).kind, 'FOOD');
    assert.throws(() => menuCreateInputSchema.parse({ venueId: 'v1', name: 'x', kind: 'COCKTAILS' }));
    assert.throws(() => menuCreateInputSchema.parse({ venueId: 'v1', name: 'x', eventDate: 'not a date' }));
    assert.equal(menuUpdateInputSchema.parse({ visibility: 'PUBLIC' }).visibility, 'PUBLIC');
    assert.equal(menuUpdateInputSchema.parse({ eventName: '  Smith  ' }).eventName, 'Smith');
    assert.throws(() => menuUpdateInputSchema.parse({}));
    assert.throws(() => menuUpdateInputSchema.parse({ name: '' }));
  });
});

describe('V2 validation', () => {
  it('drinks skip the seafood and gluten rules; food keeps them', () => {
    const d = doc([section({ title: 'Cocktails', items: [item({ name: 'Margarita', isSeafood: true, tags: ['GF', 'GFA'] })] })]);
    assert.deepEqual(codes(validateMenuDocument(d, { kind: 'DRINKS' }).errors), []);
    assert.deepEqual(codes(validateMenuDocument(d, { kind: 'FOOD' }).errors), ['GF_AND_GFA', 'SEAFOOD_NO_ORIGIN']);
    assert.deepEqual(codes(validateMenuDocument(d).errors), ['GF_AND_GFA', 'SEAFOOD_NO_ORIGIN'], 'defaults to the food rules');
  });

  it('hidden prices silence the price rules; lists and text never want one', () => {
    const d = doc(
      [
        section({ title: 'Packages', sectionType: 'SET_MENUS', items: [item({ name: 'Grazing', priceCents: null })] }),
        section({ title: 'Mains', items: [item({ name: 'Snapper', priceCents: null })] }),
        section({ title: 'Included', sectionType: 'LIST', items: [item({ name: 'Corona', priceCents: null })] }),
        section({ title: '', sectionType: 'TEXT', body: 'Two hour sitting.' })
      ],
      { showPrices: true }
    );
    assert.deepEqual(codes(validateMenuDocument(d).errors), ['SET_MENU_NO_PRICE']);
    assert.deepEqual(codes(validateMenuDocument(d).warnings), ['STANDARD_NO_PRICE']);
    const hidden = { ...d, showPrices: false };
    assert.deepEqual(codes(validateMenuDocument(hidden).errors), []);
    assert.deepEqual(codes(validateMenuDocument(hidden).warnings), []);
  });

  it('text blocks, pages and tables have their own rules', () => {
    const emptyText = doc([section({ title: '', sectionType: 'TEXT', body: null })]);
    assert.deepEqual(codes(validateMenuDocument(emptyText).errors), ['EMPTY_SECTION_TITLE', 'NOTHING_TO_PRINT']);
    assert.deepEqual(codes(validateMenuDocument(emptyText).warnings), ['EMPTY_TEXT']);
    const textOnly = doc([section({ title: '', sectionType: 'TEXT', body: 'Welcome.' })]);
    assert.equal(validateMenuDocument(textOnly).ok, true, 'a text block alone is something to print');
    const stray = doc([section({ title: 'Wine', page: 3, items: [item({ name: 'A' })] })], { pageCount: 2 });
    assert.deepEqual(codes(validateMenuDocument(stray).errors), ['PAGE_OUT_OF_RANGE']);
    assert.equal(validateMenuDocument(stray).errors[0]!.page, 3);
    const tooMany = doc([section({ title: 'Wine', items: [item({ name: 'A' })] })], { pageCount: 2 });
    assert.deepEqual(codes(validateMenuDocument(tooMany, { maxPages: 1 }).errors), ['PAGE_OUT_OF_RANGE']);
    assert.equal(validateMenuDocument(tooMany).ok, true);
    const table = doc([section({ title: 'Wine', sectionType: 'TABLE', priceColumns: [], items: [item({ name: 'Riesling', priceCents: null, prices: [] })] })]);
    assert.deepEqual(codes(validateMenuDocument(table).errors), ['TABLE_NO_COLUMNS']);
    assert.deepEqual(codes(validateMenuDocument(table).warnings), ['STANDARD_NO_PRICE']);
  });

  it('overflow names the page when there is more than one', () => {
    const one = overflowIssue({ fillRatio: 1.1, contentHeightPx: 1100, sheetHeightPx: 1000, overflow: true }, 'one A5 portrait page');
    assert.match(one!.message, /one A5 portrait page/);
    const pages = overflowIssue({
      fillRatio: 1.2,
      contentHeightPx: 1200,
      sheetHeightPx: 1000,
      overflow: true,
      pages: [
        { page: 1, fillRatio: 0.8, contentHeightPx: 800, sheetHeightPx: 1000, overflow: false },
        { page: 2, fillRatio: 1.2, contentHeightPx: 1200, sheetHeightPx: 1000, overflow: true }
      ]
    });
    assert.equal(pages!.page, 2);
    assert.match(pages!.message, /Page 2 runs past the sheet/);
    assert.equal(overflowIssue({ fillRatio: 0.9, contentHeightPx: 900, sheetHeightPx: 1000, overflow: false }), null);
    assert.match(MENU_FILL_PROBE_SCRIPT, /\.menu-print-page \.sheet, \.food-print-page \.sheet/);
  });
});

describe('V2 paged families', () => {
  const drinks = doc(
    [
      section({ title: 'Cocktails', page: 2, subheading: 'All margaritas available spicy on request.', items: [item({ name: 'Classic margarita', priceCents: 2300, description: 'Tequila, lime, agave', note: 'Served up or on the rocks', flags: ['STAFF_PICK'] })] }),
      section({ title: 'Wine', page: 3, sectionType: 'TABLE', priceColumns: ['150 mL', '250 mL', 'Bottle'], items: [item({ name: 'Riesling', meta: 'Eden Valley', priceCents: null, prices: [1400, null, 6800] })] }),
      section({ title: 'Beer', page: 3, sectionType: 'LIST', items: [item({ name: 'Corona', priceCents: null })] }),
      section({ title: 'On agave', page: 4, sectionType: 'TEXT', body: 'Tequila is a mezcal.\n\nMezcal is not always tequila.' })
    ],
    { pageCount: 4, surchargeLine: 'Surcharge.', dietaryNote: 'Dietaries.' }
  );

  it('groups sections by page and renders one sheet per declared page', () => {
    const pages = sectionsByPage(drinks);
    assert.equal(pages.length, 4);
    assert.deepEqual(pages.map((page) => page.length), [0, 1, 2, 1]);
    const html = renderMenuSheetHtml(drinks, 'avalon_drinks_book', { assets });
    assert.equal((html.match(/<section class="sheet /g) ?? []).length, 4);
    assert.match(html, /class="menu-print-page family-drinks-a5p stock-white venue-avalon" style="--page-w:148mm;--page-h:210mm"/);
    // Cover: the group wordmark, the title and a contents line pointing at the pages.
    assert.match(html, /is-cover/);
    assert.match(html, /\/images\/alma-wordmark\.png/);
    assert.match(html, /<div class="t-title">Drinks<\/div>/);
    assert.match(html, /COCKTAILS<span class="num">2<\/span> · WINE<span class="num">3<\/span> · ON AGAVE<span class="num">4<\/span>/);
    // Rows: caps name, note, staff-pick mark, a wine table with a quiet dot for the missing pour, names-only list, text paragraphs.
    assert.match(html, /<span class="dname">Classic margarita<span class="dmark">•<\/span><\/span><span class="dprice">23<\/span>/);
    assert.match(html, /<div class="dnote">Served up or on the rocks<\/div>/);
    assert.match(html, /<span class="wname">Riesling<span class="wreg">Eden Valley<\/span><\/span><span class="wp">14<\/span><span class="wp empty">·<\/span><span class="wp">68<\/span>/);
    assert.match(html, /<div class="list"><div class="pour" data-dish-key="corona"><span class="pname">Corona<\/span><\/div><\/div>/);
    assert.match(html, /<p class="para">Tequila is a mezcal\.<\/p><p class="para">Mezcal is not always tequila\.<\/p>/);
    // Folios on inner pages only; the footer on the last page; the marks legend generated.
    assert.equal((html.match(/<div class="folio">/g) ?? []).length, 3);
    assert.match(html, /<div class="legend">• Staff pick<\/div>/);
    assert.match(html, /<div class="surcharge">Surcharge\.<\/div>/);
    assert.match(renderMenuHtml(drinks, 'avalon_drinks_book', { assets }), /@page \{ size: 148mm 210mm; margin: 0; \}/);
    assert.match(renderMenuHtml(drinks, 'freshwater_drinks_binder', { assets }), /@page \{ size: 210mm 148mm; margin: 0; \}/);
  });

  it('hidden prices drop every price, including table cells and the hero price', () => {
    const quiet = { ...drinks, showPrices: false, heroPriceCents: 9900, heroPriceUnit: 'pp' };
    const html = renderMenuSheetHtml(quiet, 'avalon_drinks_book', { assets });
    assert.doesNotMatch(html, /<span class="dprice">/);
    assert.doesNotMatch(html, /<span class="wp">/);
  });

  it('a drinks row whose qualifier is a strength is a one-line pour; a tagged cocktail keeps its layout', () => {
    const agave = doc(
      [
        section({ title: 'El Pandillo', page: 2, lead: 'Hand built tahona.', items: [item({ name: 'G4 Blanco', meta: '40%', priceCents: 1800, description: 'Jesús María' }), item({ name: 'G4 Añejo', meta: '40%', priceCents: 3300 })] }),
        section({ title: 'Cocktails', page: 3, items: [item({ name: 'Coconut margarita', meta: 'Signature', priceCents: 2300, description: 'Tequila blanco, coconut, lime' })] })
      ],
      { pageCount: 3 }
    );
    const book = renderMenuSheetHtml(agave, 'avalon_drinks_book', { assets });
    // A pour: the village rides the name line, the group carries the quiet head, and a page of pours flows in two columns.
    assert.match(book, /<div class="psec type-standard pour-group" data-section-id="">/);
    assert.match(book, /<div class="drink pour-row" data-dish-key="g4-blanco"><div class="drink-top"><span class="dname">G4 Blanco<span class="dmeta">40%<\/span><span class="dvil">Jesús María<\/span><\/span><span class="dprice">18<\/span><\/div><\/div>/);
    assert.match(book, /<div class="drink pour-row" data-dish-key="g4-añejo"><div class="drink-top"><span class="dname">G4 Añejo<span class="dmeta">40%<\/span><\/span><span class="dprice">33<\/span><\/div><\/div>/);
    assert.equal((book.match(/<div class="page-body cols">/g) ?? []).length, 1);
    // The cocktail keeps its name line and ingredients beneath; its page is single-column.
    assert.match(book, /<div class="drink" data-dish-key="coconut-margarita"><div class="drink-top"><span class="dname">Coconut margarita<span class="dmeta">Signature<\/span><\/span><span class="dprice">23<\/span><\/div><div class="ding">Tequila blanco, coconut, lime<\/div><\/div>/);
    // The binder sets the same pours; the A4 food sheet never does.
    assert.match(renderMenuSheetHtml(agave, 'freshwater_drinks_binder', { assets }), /<div class="drink pour-row" data-dish-key="g4-blanco">/);
    const sheet = renderMenuSheetHtml({ ...agave, pageCount: 1, sections: agave.sections.map((s) => ({ ...s, page: 1 })) }, 'freshwater_alacarte', { assets });
    assert.doesNotMatch(sheet, /pour-row/);
  });

  it('the functions document is group-branded and usable by either venue', () => {
    const template = getMenuTemplate('group_functions_a4');
    assert.equal(template.venueSlug, null);
    assert.equal(template.multiPage, true);
    const functions = doc(
      [
        section({ title: 'Ways to gather', page: 2, sectionType: 'SET_MENUS', items: [item({ name: 'The Alma Table', priceCents: 12500, priceUnit: 'pp', description: 'Six course Trust the Chef, plus a two hour house drinks package.' })] }),
        section({ title: 'On arrival', page: 2, items: [item({ name: 'Cocktail or margarita on arrival', priceCents: 1200, priceUnit: 'pp' })] })
      ],
      { pageCount: 2, heading: 'Functions & groups', subheading: 'Package menu' }
    );
    const html = renderMenuSheetHtml(functions, 'group_functions_a4', { assets });
    assert.match(html, /venue-group/);
    assert.match(html, /<div class="t-line">St Alma, Freshwater · Alma Avalon<\/div>/);
    assert.match(html, /<div class="t-sub">Package menu<\/div>/);
    assert.match(html, /class="drink pkg"/);
    assert.match(html, /<span class="dprice">125 pp<\/span>/);
    assert.equal(validateMenuDocument(functions, { kind: 'FUNCTIONS' }).ok, true);
  });

  it('the A4 food sheet still renders exactly as before for a v1-shaped document', () => {
    const food = doc([section({ title: 'To start', items: [item({ name: 'Guacamole', priceCents: 1700, tags: ['VG'] })] })]);
    const html = renderMenuSheetHtml(food, 'freshwater_alacarte', { assets });
    assert.match(html, /^<main class="food-print-page stock-white venue-stalma"><section class="sheet a4">/);
    assert.match(html, /<span class="dname">Guacamole <span class="tags">VG<\/span><\/span><span class="dprice">17<\/span>/);
    assert.doesNotMatch(html, /menu-print-page/);
  });
});
