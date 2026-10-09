import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMenuTemplate, isMenuTemplateKey, MENU_LIMITS, menuDocumentSchema, renderMenuSheetHtml, validateMenuDocument, type MenuRenderAssets } from '@alma/shared';
import { ST_ALMA_DRINKS_IMPORT } from './st-alma-drinks.js';
import type { MenuImportSpec } from './types.js';

/**
 * The St Alma drinks binder as an import spec: a complete, already-normalised
 * document that validates for its kind, prints on its template and declares
 * exactly the 23 cards the binder has. No database, no browser.
 */
const SPECS: MenuImportSpec[] = [ST_ALMA_DRINKS_IMPORT];

const assets: MenuRenderAssets = { fontFaceCss: '', logoSrc: (asset) => `/${asset}` };

for (const spec of SPECS) {
  const templateKnown = isMenuTemplateKey(spec.templateKey);
  const template = templateKnown ? getMenuTemplate(spec.templateKey) : null;
  const skipTemplate = templateKnown ? false : `template "${spec.templateKey}" is not registered yet`;

  describe(`${spec.venueSlug} / ${spec.slug} (${spec.templateKey})`, () => {
    it('fits the shared section budget', () => {
      // The binder transcribes to one section per producer group and per wine
      // style; the A4-era cap of 60 is too small for a 23-card document.
      assert.ok(
        spec.document.sections.length <= MENU_LIMITS.sectionsMax,
        `${spec.document.sections.length} sections > MENU_LIMITS.sectionsMax (${MENU_LIMITS.sectionsMax}) — raise the limit for multi-page templates in packages/shared/src/menus.ts`
      );
    });

    it('is a complete MenuDocument that the schema accepts unchanged', () => {
      const parsed = menuDocumentSchema.parse(spec.document);
      assert.deepStrictEqual(parsed, spec.document);
    });

    it('validates without errors for its kind and page budget', () => {
      const maxPages = template ? (template.multiPage ? 24 : 1) : 24;
      const result = validateMenuDocument(spec.document, { kind: spec.kind, maxPages });
      assert.deepStrictEqual(result.errors, []);
    });

    it('places every section on a declared page', () => {
      for (const section of spec.document.sections) {
        assert.ok(section.page >= 1 && section.page <= spec.document.pageCount, `${section.title || section.sectionType} is on page ${section.page} of ${spec.document.pageCount}`);
      }
    });

    it('gives every item a unique, prefixed dish key', () => {
      const keys = spec.document.sections.flatMap((section) => section.items.map((item) => item.dishKey));
      assert.ok(keys.every((key) => typeof key === 'string' && key.startsWith('fwd-') && key.length <= 80));
      assert.equal(new Set(keys).size, keys.length, 'dish keys repeat');
    });

    it('uses a template that prints this kind', { skip: skipTemplate }, () => {
      assert.ok(template!.kinds.includes(spec.kind));
      assert.equal(template!.venueSlug, spec.venueSlug);
      assert.ok(template!.multiPage || spec.document.pageCount === 1);
    });

    it('renders one sheet per declared page', { skip: skipTemplate }, () => {
      const html = renderMenuSheetHtml(spec.document, spec.templateKey, { assets });
      const sheets = html.match(/<section class="sheet/g) ?? [];
      assert.equal(sheets.length, spec.document.pageCount);
    });
  });
}

describe('St Alma drinks binder — what the binder prints', () => {
  const doc = ST_ALMA_DRINKS_IMPORT.document;
  const byPage = (page: number) => doc.sections.filter((section) => section.page === page);
  const items = doc.sections.flatMap((section) => section.items);

  it('has twenty-three cards with a sectionless cover and content on every inner card', () => {
    assert.equal(doc.pageCount, 23);
    assert.equal(byPage(1).length, 0);
    for (let page = 2; page <= 23; page += 1) assert.ok(byPage(page).length > 0, `page ${page} is empty`);
  });

  it('prints the template title on the cover and the cover conditions in the footer', () => {
    assert.equal(doc.heading, '');
    assert.equal(doc.surchargeLine, 'A surcharge of 10% applies on weekends and 15% on public holidays. Wine vintages may be subject to change.');
    assert.equal(doc.dietaryNote, '');
  });

  it('carries the dietary marks the cover legend is generated from', () => {
    const tagged = items.filter((item) => item.tags.length > 0);
    assert.deepStrictEqual(
      tagged.map((item) => [item.name, item.tags.join(',')]),
      [
        ['Beach, Please', 'N'],
        ['Oaxacan Negroni', 'N'],
        ['Don Elote', 'DF'],
        ['Espresso Martini', 'DF']
      ]
    );
  });

  it('keeps the cocktails page by page in binder order', () => {
    assert.deepStrictEqual(
      byPage(2).map((section) => section.title),
      ['Margaritas', '']
    );
    assert.deepStrictEqual(
      byPage(3).map((section) => section.title),
      ['Palomas', 'Seasonal cocktails']
    );
    assert.deepStrictEqual(
      byPage(4).map((section) => section.title),
      ['Stirred & after dinner', 'To share']
    );
    const tommys = items.find((item) => item.name === 'Tommy’s Margarita');
    assert.equal(tommys?.priceCents, 2300);
    assert.equal(tommys?.note, 'Served on the rocks, made famous at Tommy’s Mexican Restaurant, San Francisco');
    const onTap = items.filter((item) => item.flags.includes('ON_TAP')).map((item) => item.name);
    assert.deepStrictEqual(onTap, ['Rhubarb Grapefruit Paloma', 'Paloma Carafe', 'Manly Spirits Spritz']);
    const carafe = items.find((item) => item.name === 'Paloma Carafe');
    assert.equal(carafe?.priceCents, 7200);
    assert.equal(carafe?.meta, 'on tap, serves three');
  });

  it('prices wine by the glass in 150 and 250 mL columns, bubbles by the 150 mL pour, muscat by 60 mL and the half bottle', () => {
    const glass = [...byPage(10), ...byPage(11)];
    assert.ok(glass.every((section) => section.sectionType === 'TABLE'));
    assert.deepStrictEqual(
      glass.map((section) => [section.title, section.priceColumns.join('|')]),
      [
        ['White', '150 mL|250 mL'],
        ['Sommelier pours', '150 mL|250 mL'],
        ['Bubbles', '150 mL'],
        ['Rosé', '150 mL|250 mL'],
        ['Red', '150 mL|250 mL'],
        ['Sommelier pours', '150 mL|250 mL'],
        ['Sweet & fortified', '60 mL|375 mL btl']
      ]
    );
    const bubbles = glass[2]!;
    assert.equal(bubbles.headerSuffix, '150 mL pour');
    assert.deepStrictEqual(bubbles.items.map((item) => item.prices), [[1700], [3400]]);
    const muscat = glass[6]!.items[0]!;
    assert.equal(muscat.name, 'All Saints Estate ‘Grand’, Rutherglen Muscat');
    assert.deepStrictEqual(muscat.prices, [1800, 7900]);
    const albarino = glass[0]!.items.find((item) => item.name === 'Gotas de Mar, Albariño');
    assert.equal(albarino?.meta, '2024 · Rías Baixas, ESP ○');
    assert.deepStrictEqual(albarino?.prices, [1900, 3100]);
  });

  it('lists bottles one style heading per table with a single Bottle column and the ** marks as LIMITED', () => {
    const bottles = doc.sections.filter((section) => section.page >= 12 && section.page <= 19);
    assert.ok(bottles.every((section) => section.sectionType === 'TABLE' && section.priceColumns.join() === 'Bottle'));
    assert.deepStrictEqual(
      bottles.map((section) => (section.headerSuffix ? `${section.title} / ${section.headerSuffix}` : section.title)),
      [
        'Mexican wine',
        'Bubbles',
        'Riesling',
        'Other whites / Crisp & refreshing',
        'Other whites / Aromatic & textural',
        'Other whites / Mineral & complex',
        'Sauvignon Blanc & Semillon',
        'Chardonnay',
        'Chardonnay / cont.',
        'Skin contact & orange',
        'Rosé',
        'Pinot Noir',
        'Other reds / Light & juicy',
        'Other reds / Medium-bodied & versatile',
        'Other reds / Full-bodied & bold',
        'Other reds / cont.',
        'Shiraz',
        'Shiraz / cont.',
        'Cabernet & Bordeaux blends'
      ]
    );
    // 100 `.wine.one` rows in the source sheet.
    assert.equal(bottles.reduce((count, section) => count + section.items.length, 0), 100);
    const limited = items.filter((item) => item.flags.includes('LIMITED'));
    assert.deepStrictEqual(
      limited.map((item) => item.name),
      [
        'Billecart-Salmon Brut Rosé',
        'Pol Roger Brut Rosé',
        'Giaconda ‘Nantua Les Deux’',
        'Tolpuddle',
        'Domaine Bouchard Corton Grand Cru',
        'Sandrone le Vigne Barolo, Nebbiolo',
        'Wendouree, Cabernet Sauvignon Malbec',
        'Paxton ‘Elizabeth Jean’',
        'Teusner ‘Righteous FG’',
        'Yalumba ‘The Reserve’'
      ]
    );
    const surco = bottles[0]!.items[0]!;
    assert.equal(surco.name, 'Surco 2.7, Cabernet Sauvignon');
    assert.equal(surco.meta, '2018 · Baja California, MEX △ ◇');
    assert.deepStrictEqual(surco.prices, [10100]);
    const rockford = items.filter((item) => item.name === 'Rockford Basket Press');
    assert.deepStrictEqual(rockford.map((item) => [item.meta, item.prices[0], item.dishKey]), [
      ['2017 · Barossa Valley, SA △', 39500, 'fwd-bottle-rockford-basket-press-2017'],
      ['2018 · Barossa Valley, SA △', 47500, 'fwd-bottle-rockford-basket-press-2018']
    ]);
  });

  it('marks the staff picks and keeps mezcal villages under the name', () => {
    const picks = items.filter((item) => item.flags.includes('STAFF_PICK'));
    assert.equal(picks.length, 28);
    const espadin = doc.sections.find((section) => section.title === 'Espadín');
    assert.equal(espadin?.page, 22);
    assert.equal(espadin?.items.length, 17);
    assert.equal(espadin?.items[0]?.name, 'Aguas Mansas');
    assert.equal(espadin?.items[0]?.description, 'Santiago Matatlán');
    assert.equal(espadin?.items[0]?.meta, '45%');
    assert.equal(espadin?.items[0]?.priceCents, 1300);
    const soledad = espadin!.items.filter((item) => item.name === 'Nuestra Soledad');
    assert.equal(soledad.length, 5);
    assert.equal(new Set(soledad.map((item) => item.dishKey)).size, 5);
  });

  it('opens each agave page with the pour-size lines and sets the producer groups as the binder does', () => {
    for (const [page, title] of [
      [20, 'Tequila'],
      [21, 'Tequila'],
      [22, 'Mezcal'],
      [23, 'Mezcal']
    ] as const) {
      const first = byPage(page)[0]!;
      assert.equal(first.sectionType, 'TEXT');
      assert.equal(first.title, title);
      assert.match(first.body ?? '', /15 mL pours available on all agave spirits\./);
    }
    assert.deepStrictEqual(
      byPage(20)
        .slice(1)
        .map((section) => section.title),
      ['Grupo Tequilero', 'Arette de Jalisco', 'El Pandillo', 'Hacienda Capellanía', 'Tequila Cascahuín', 'Varo Destilería', 'Diageo México', 'Los Alambiques']
    );
    assert.deepStrictEqual(
      byPage(21)
        .slice(1)
        .map((section) => section.title),
      ['Hacienda Herradura', 'Tequila Tapatío', 'Tequila Los Abuelos', 'Jorge Salles Cuervo y Sucesores', 'Patrón Spirits México', 'Other houses']
    );
    const arette = items.find((item) => item.name === 'Arette Blanco' && item.priceCents !== null);
    assert.equal(arette?.priceCents, 1400);
    assert.equal(arette?.meta, '40%');
    assert.deepStrictEqual(arette?.flags, ['STAFF_PICK']);
  });

  it('keeps the flights page pointing at the agave pages and the picks labelled by name', () => {
    const flights = doc.sections.find((section) => section.title === 'Tasting flights');
    assert.equal(flights?.page, 8);
    assert.equal(flights?.items.length, 6);
    assert.equal(flights?.items[5]?.name, 'St Alma Selects');
    assert.equal(flights?.items[5]?.priceCents, 4200);
    const flightsNote = byPage(8).find((section) => section.sectionType === 'TEXT' && !section.title);
    assert.match(flightsNote?.body ?? '', /tequila page 20, mezcal page 22\./);
    const picks = doc.sections.find((section) => section.page === 7 && section.title === 'Our favourites');
    assert.deepStrictEqual(
      picks?.items.map((item) => [item.name, item.meta]),
      [
        ['Arette Blanco', 'Tim’s pick'],
        ['Fortaleza Reposado', 'Dirk’s pick'],
        ['Fortaleza Blanco', 'Caio’s pick']
      ]
    );
  });

  it('signs the wine note and keeps the pairing guide as printed', () => {
    const note = doc.sections.find((section) => section.title === 'A note on our wine');
    assert.equal(note?.page, 9);
    assert.match(note?.body ?? '', /Welcome to St Alma, and salud\.\n\nTim Christensen\nFounding Director Alma Group$/);
    const guide = doc.sections.find((section) => section.title === 'Pairing guide');
    assert.equal(guide?.body, '○ Seafood and ceviche · △ Rich and grilled · ◇ Vegetables and cheese\n\n** Subject to availability. Vintages may change.');
  });

  it('only warns where the binder itself prints no price', () => {
    const result = validateMenuDocument(doc, { kind: 'DRINKS', maxPages: 24 });
    const unpriced = result.warnings.filter((issue) => issue.code === 'STANDARD_NO_PRICE');
    assert.equal(unpriced.length, 11, 'the agave picks, When to sip and Start here');
    assert.ok(unpriced.every((issue) => issue.sectionIndex !== undefined && doc.sections[issue.sectionIndex]!.page === 7));
    assert.equal(result.warnings.length, unpriced.length);
  });
});
