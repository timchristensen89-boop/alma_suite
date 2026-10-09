import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMenuTemplate, isMenuTemplateKey, menuDocumentSchema, renderMenuSheetHtml, validateMenuDocument, type MenuRenderAssets } from '@alma/shared';
import { AVALON_BOTTOMLESS_IMPORT, AVALON_HAPPY_HOUR_IMPORT, AVALON_LUNCH_SPECIAL_IMPORT } from './avalon-cards.js';
import { GROUP_FUNCTIONS_IMPORT } from './group-functions.js';
import { GROUP_SET_MENU_PACK_IMPORT } from './group-set-menu-pack.js';
import { ST_ALMA_BOTTOMLESS_IMPORT } from './st-alma-cards.js';
import { ST_ALMA_TUESDAY_IMPORT } from './st-alma-tuesday.js';
import type { MenuImportSpec } from './types.js';

/**
 * The reference menus as import specs: each a complete, already-normalised
 * document that validates for its kind, prints on its template and declares
 * exactly the pages the source has. No database, no browser. Template and
 * render checks are skipped for a template key the shared package does not
 * register yet, and the test says so.
 */
const SPECS: Array<{ spec: MenuImportSpec; prefix: string }> = [
  { spec: GROUP_FUNCTIONS_IMPORT, prefix: 'fn' },
  { spec: GROUP_SET_MENU_PACK_IMPORT, prefix: 'smp' },
  { spec: ST_ALMA_TUESDAY_IMPORT, prefix: 'fwt' },
  { spec: AVALON_HAPPY_HOUR_IMPORT, prefix: 'avc' },
  { spec: AVALON_BOTTOMLESS_IMPORT, prefix: 'avc' },
  { spec: AVALON_LUNCH_SPECIAL_IMPORT, prefix: 'avc' },
  { spec: ST_ALMA_BOTTOMLESS_IMPORT, prefix: 'fwc' }
];

const assets: MenuRenderAssets = { fontFaceCss: '', logoSrc: (asset) => `/${asset}` };

for (const { spec, prefix } of SPECS) {
  const templateKnown = isMenuTemplateKey(spec.templateKey);
  const template = templateKnown ? getMenuTemplate(spec.templateKey) : null;
  const skipTemplate = templateKnown ? false : `template "${spec.templateKey}" is not registered yet — document-only checks`;

  describe(`${spec.venueSlug} / ${spec.slug} (${spec.templateKey})`, () => {
    it('is a complete MenuDocument that the schema accepts unchanged', () => {
      const parsed = menuDocumentSchema.parse(spec.document);
      assert.deepStrictEqual(parsed, spec.document);
    });

    it('validates without errors for its kind and page budget', () => {
      const maxPages = template ? (template.maxPages ?? (template.multiPage ? 24 : 1)) : 24;
      const result = validateMenuDocument(spec.document, { kind: spec.kind, maxPages });
      assert.deepStrictEqual(result.errors, []);
    });

    it('places every section on a declared page', () => {
      assert.ok(spec.document.pageCount >= 1);
      for (const section of spec.document.sections) {
        assert.ok(
          section.page >= 1 && section.page <= spec.document.pageCount,
          `${section.title || section.sectionType} is on page ${section.page} of ${spec.document.pageCount}`
        );
      }
    });

    it('gives every item a unique, prefixed dish key', () => {
      const keys = spec.document.sections.flatMap((section) => section.items.map((item) => item.dishKey));
      assert.ok(keys.length > 0);
      assert.ok(keys.every((key) => typeof key === 'string' && key.startsWith(`${prefix}-`) && key.length <= 80), `keys: ${keys.join(', ')}`);
      assert.equal(new Set(keys).size, keys.length, 'dish keys repeat');
    });

    it('records where the content came from and what to check', () => {
      assert.match(spec.source.path, /^\/Family Room\/Indesign\//);
      assert.match(spec.source.ref ?? '', /^id:[A-Za-z0-9_-]+$/);
      assert.ok(spec.source.notes.length > 40);
      assert.ok(spec.review.length > 0);
      assert.equal(spec.document.showPrices, true);
    });

    it('uses a template that prints this kind for this venue', { skip: skipTemplate }, () => {
      assert.ok(template!.kinds.includes(spec.kind), `${spec.templateKey} prints ${template!.kinds.join('/')}, not ${spec.kind}`);
      assert.ok(template!.venueSlug === null || template!.venueSlug === spec.venueSlug);
      assert.ok(template!.multiPage || spec.document.pageCount === 1);
    });

    it('renders one sheet per declared page', { skip: skipTemplate }, () => {
      const html = renderMenuSheetHtml(spec.document, spec.templateKey, { assets });
      const sheets = html.match(/<section class="sheet/g) ?? [];
      assert.equal(sheets.length, spec.document.pageCount);
    });
  });
}

// ---------------------------------------------------------------------------
// What each source prints — pins the transcription
// ---------------------------------------------------------------------------

const byPage = (spec: MenuImportSpec, page: number) => spec.document.sections.filter((section) => section.page === page);
const allItems = (spec: MenuImportSpec) => spec.document.sections.flatMap((section) => section.items);

describe('Functions & groups — the live five-page package menu', () => {
  const doc = GROUP_FUNCTIONS_IMPORT.document;

  it('has a cover line, four inner pages and the surcharge as conditions', () => {
    assert.equal(doc.pageCount, 5);
    assert.equal(doc.heading, 'Functions & groups');
    assert.equal(doc.subheading, 'Package menu');
    assert.deepStrictEqual(
      byPage(GROUP_FUNCTIONS_IMPORT, 1).map((section) => section.sectionType),
      ['TEXT']
    );
    for (let page = 2; page <= 5; page += 1) assert.ok(byPage(GROUP_FUNCTIONS_IMPORT, page).length > 0, `page ${page} is empty`);
    assert.equal(doc.conditions, 'A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays.');
    assert.equal(doc.surchargeLine, '');
  });

  it('prices the packages per person as the PDF does', () => {
    const packages = doc.sections.filter((section) => section.sectionType === 'SET_MENUS').flatMap((section) => section.items);
    assert.deepStrictEqual(
      packages.map((item) => [item.name, item.priceCents, item.priceUnit]),
      [
        ['The Alma Table', 12500, 'pp'],
        ['Bottomless', 9900, 'pp'],
        ['Grazing', 4900, 'pp'],
        ['Six course, Trust the Chef', 7900, 'pp'],
        ['House drinks package', 4900, 'pp'],
        ['Seated feast', 18500, 'pp'],
        ['Canapé', 16500, 'pp']
      ]
    );
    const alma = doc.sections.find((section) => section.title === 'The Alma Table');
    assert.equal(alma?.lead, 'Preferred');
    assert.equal(packages.find((item) => item.name === 'House drinks package')?.meta, 'With a set menu');
  });

  it('tables the beverage tiers over 2 / 3 / 4 hours and the minimum spends by venue', () => {
    const tiers = byPage(GROUP_FUNCTIONS_IMPORT, 4).filter((section) => section.sectionType === 'TABLE');
    assert.deepStrictEqual(
      tiers.map((section) => section.title),
      ['Standard', 'Premium', 'Ballers', 'Add ons']
    );
    for (const tier of tiers) assert.deepStrictEqual(tier.priceColumns, ['2 hrs', '3 hrs', '4 hrs']);
    assert.deepStrictEqual(
      tiers.slice(0, 3).map((tier) => tier.items[0]!.prices),
      [
        [5400, 6900, 8400],
        [6900, 8900, 10900],
        [8500, 11000, 13500]
      ]
    );
    assert.deepStrictEqual(tiers[3]!.items.map((item) => item.prices), [
      [1900, 2900, 3900],
      [1500, 2500, 3500],
      [3000, 5000, 7000]
    ]);
    const spends = doc.sections.find((section) => section.title === 'Minimum spend by session');
    assert.deepStrictEqual(spends?.priceColumns, ['St Alma', 'Alma Avalon']);
    assert.deepStrictEqual(
      spends?.items.map((item) => [item.name, ...item.prices]),
      [
        ['Tue to Thu', 700000, 450000],
        ['Friday lunch', 800000, 550000],
        ['Friday night', 1200000, 800000],
        ['Saturday lunch', 1000000, 700000],
        ['Saturday night', 1400000, 1000000],
        ['Sunday', 900000, 600000]
      ]
    );
  });

  it('keeps the occasions with their venue qualifiers and the one unpriced add-on', () => {
    const occasions = byPage(GROUP_FUNCTIONS_IMPORT, 3).filter((section) => section.sectionType === 'STANDARD');
    assert.deepStrictEqual(
      occasions.map((section) => [section.title, section.headerSuffix]),
      [
        ['Group bookings', 'Both venues'],
        ['Birthdays', 'Both venues'],
        ['Hens — Alma Avalon', null],
        ['Hens — St Alma, Freshwater', null],
        ['Team & corporate lunches', 'St Alma, Tue to Fri, 12 to 4pm']
      ]
    );
    const unpriced = allItems(GROUP_FUNCTIONS_IMPORT).filter((item) => item.priceCents === null && item.prices.length === 0);
    assert.deepStrictEqual(
      unpriced.map((item) => [item.name, item.meta]),
      [['Cake, house sourced and decorated to suit', 'on request']]
    );
    const warnings = validateMenuDocument(doc, { kind: 'FUNCTIONS', maxPages: 24 }).warnings;
    assert.deepStrictEqual(
      warnings.map((issue) => issue.code),
      ['STANDARD_NO_PRICE']
    );
  });
});

describe('Set menu packages — the 5 Aug review draft', () => {
  const doc = GROUP_SET_MENU_PACK_IMPORT.document;

  it('has a sectionless cover and one tier per inner page, priced on the page', () => {
    assert.equal(doc.pageCount, 4);
    assert.equal(byPage(GROUP_SET_MENU_PACK_IMPORT, 1).length, 0);
    assert.deepStrictEqual(
      [2, 3, 4].map((page) => {
        const first = byPage(GROUP_SET_MENU_PACK_IMPORT, page)[0]!;
        return [first.sectionType, first.title, first.items[0]!.priceCents, first.items[0]!.priceUnit];
      }),
      [
        ['SET_MENUS', 'Grazing', 4900, 'pp'],
        ['SET_MENUS', 'Feasting', 7900, 'pp'],
        ['SET_MENUS', 'Bottomless', 9900, 'pp']
      ]
    );
    assert.equal(doc.heroPriceCents, null);
  });

  it('marks nuts where the draft does and nothing else', () => {
    const tagged = allItems(GROUP_SET_MENU_PACK_IMPORT).filter((item) => item.tags.length > 0);
    assert.deepStrictEqual(
      tagged.map((item) => [item.dishKey, item.tags.join(',')]),
      [
        ['smp-grazing-guacamole', 'N'],
        ['smp-grazing-zucchini', 'N'],
        ['smp-feasting-guacamole', 'N'],
        ['smp-feasting-broccolini-almond-mole', 'N'],
        ['smp-bottomless-guacamole', 'N'],
        ['smp-bottomless-churros', 'N']
      ]
    );
    assert.ok(allItems(GROUP_SET_MENU_PACK_IMPORT).every((item) => !item.isSeafood));
  });

  it('says two tacos per person and keeps the bottomless terms as text', () => {
    const tacos = doc.sections.filter((section) => section.title === 'Tacos');
    assert.equal(tacos.length, 3);
    for (const section of tacos) {
      assert.equal(section.sectionType, 'LIST');
      assert.equal(section.lead, 'Two per person');
    }
    const terms = byPage(GROUP_SET_MENU_PACK_IMPORT, 4).filter((section) => section.sectionType === 'TEXT');
    assert.equal(terms[0]?.title, 'Bottomless, for two hours');
    assert.match(terms[0]?.body ?? '', /one drink at a time, served at our discretion/);
    assert.match(terms[1]?.body ?? '', /^Lunch only, 12pm to 4pm/);
    assert.match(doc.conditions, /Groups of 8 or more/);
    assert.equal(validateMenuDocument(doc, { kind: 'FUNCTIONS', maxPages: 24 }).warnings.length, 0);
  });
});

describe('Taco Tuesday — the St Alma card on the A4 food sheet', () => {
  const doc = ST_ALMA_TUESDAY_IMPORT.document;

  it('prices the tacos in the heading and lays the sheet out like the à la carte', () => {
    assert.equal(doc.pageCount, 1);
    assert.equal(doc.heading, 'Taco Tuesday');
    assert.deepStrictEqual(
      doc.sections.map((section) => [section.title, section.sectionType, section.placement]),
      [
        ['Tacos', 'HEADER_PRICED', 'LEFT'],
        ['To start', 'STANDARD', 'LEFT'],
        ['From the grill', 'STANDARD', 'RIGHT'],
        ['Sides', 'STANDARD', 'RIGHT'],
        ['Sweet', 'STANDARD', 'FULL'],
        ['Trust our chef', 'SET_MENUS', 'FULL']
      ]
    );
    assert.equal(doc.sections[0]!.headerSuffix, '5 each · every Tuesday');
    assert.equal(doc.sections[0]!.items.length, 4);
    assert.ok(doc.sections[0]!.items.every((item) => item.priceCents === null));
  });

  it('flags the seafood with an Australian origin and nothing else as seafood', () => {
    const seafood = allItems(ST_ALMA_TUESDAY_IMPORT).filter((item) => item.isSeafood);
    assert.deepStrictEqual(
      seafood.map((item) => item.name.split(',')[0]),
      ['Barramundi', 'Kingfish ceviche', 'Grilled snapper']
    );
    for (const item of seafood) assert.ok(item.tags.includes('A'));
  });

  it('adds the taco board to the three chef tiers at a flat 20', () => {
    const chef = doc.sections.find((section) => section.title === 'Trust our chef')!;
    assert.equal(chef.subheading, 'For the whole table.');
    assert.deepStrictEqual(
      chef.items.map((item) => [item.name, item.priceCents, item.priceUnit]),
      [
        ['Grazing', 4900, 'pp'],
        ['Feasting', 7900, 'pp'],
        ['Agave pairing', 4500, 'pp'],
        ['Try them all', 2000, null]
      ]
    );
    assert.equal(validateMenuDocument(doc, { kind: 'FOOD', maxPages: 1 }).warnings.length, 0);
  });
});

describe('The A5 cards — title block, grammar and conditions', () => {
  it('happy hour prices each group in its heading with names only', () => {
    const doc = AVALON_HAPPY_HOUR_IMPORT.document;
    assert.equal(doc.whenLine, 'Tue–Thu · 5–6pm · Fri–Sun · 4–6pm');
    assert.equal(doc.heroPriceCents, null);
    assert.deepStrictEqual(
      doc.sections.map((section) => [section.title, section.sectionType, section.headerSuffix, section.items.length]),
      [
        ['Margaritas', 'HEADER_PRICED', '12', 5],
        ['Beer', 'HEADER_PRICED', '8', 2],
        ['Wine', 'HEADER_PRICED', '8', 4]
      ]
    );
    assert.ok(allItems(AVALON_HAPPY_HOUR_IMPORT).every((item) => item.priceCents === null && item.tags.length === 0));
    assert.doesNotMatch(doc.conditions, /Merchant fees/);
  });

  it('bottomless cards carry 99 pp, the inclusions and the sitting line', () => {
    for (const spec of [AVALON_BOTTOMLESS_IMPORT, ST_ALMA_BOTTOMLESS_IMPORT]) {
      const doc = spec.document;
      assert.equal(doc.heading, 'Bottomless lunch');
      assert.equal(doc.heroPriceCents, 9900);
      assert.equal(doc.heroPriceUnit, 'pp');
      assert.deepStrictEqual(
        doc.sections.filter((section) => section.sectionType === 'LIST').map((section) => section.title).slice(0, 3),
        ['Included', 'Select from', 'Then']
      );
      assert.equal(doc.sections.at(-1)?.title, 'Bottomless drinks');
      assert.match(doc.conditions, /2 hour sitting/);
      assert.doesNotMatch(doc.conditions, /Merchant fees/);
    }
    assert.equal(AVALON_BOTTOMLESS_IMPORT.document.whenLine, 'Sat & Sun · 12–4pm');
    assert.equal(ST_ALMA_BOTTOMLESS_IMPORT.document.whenLine, 'Fri–Sun · 12–4pm');
  });

  it('maps the Avalon card\'s lowercase codes to house tags', () => {
    const included = AVALON_BOTTOMLESS_IMPORT.document.sections[0]!;
    assert.deepStrictEqual(
      included.items.map((item) => item.tags.join(' ')),
      ['VG GFA DF', 'GF DF', 'GFA DF N', 'V GF N', 'GFA DF']
    );
    const zucchini = allItems(AVALON_BOTTOMLESS_IMPORT).find((item) => item.name.startsWith('Zucchini'));
    assert.deepStrictEqual(zucchini?.tags, ['VG', 'GF', 'DF', 'N']);
    assert.ok(allItems(AVALON_BOTTOMLESS_IMPORT).every((item) => !item.isSeafood));
  });

  it('the St Alma card is the 15 Nov 2025 version', () => {
    const items = allItems(ST_ALMA_BOTTOMLESS_IMPORT).map((item) => item.name);
    assert.ok(items.includes('Roast chicken, esquites, salsa macha'));
    assert.ok(items.includes('Balter Cerveza'));
    assert.ok(items.includes('Spicy Pineapple Margarita'));
    assert.ok(!items.includes('Corona'));
    const addOn = ST_ALMA_BOTTOMLESS_IMPORT.document.sections.find((section) => section.title === 'Add on');
    assert.deepStrictEqual(
      addOn?.items.map((item) => [item.name, item.priceCents, item.priceUnit]),
      [['Chicken tinga empanadas, martajada sauce', 700, 'pp']]
    );
    assert.equal(ST_ALMA_BOTTOMLESS_IMPORT.document.surchargeLine, '');
  });

  it('lunch special is 49 pp with a margarita choice and two priced add-ons', () => {
    const doc = AVALON_LUNCH_SPECIAL_IMPORT.document;
    assert.equal(doc.heroPriceCents, 4900);
    assert.equal(doc.whenLine, '');
    assert.deepStrictEqual(
      doc.sections.map((section) => [section.title, section.sectionType]),
      [
        ['To drink', 'LIST'],
        ['Starter', 'LIST'],
        ['Shared main', 'LIST'],
        ['Shared side', 'LIST'],
        ['Add on', 'STANDARD']
      ]
    );
    assert.equal(doc.sections[0]!.lead, 'Choose one');
    assert.deepStrictEqual(
      doc.sections[4]!.items.map((item) => [item.priceCents, item.priceUnit]),
      [
        [1600, null],
        [700, 'pp']
      ]
    );
  });
});
