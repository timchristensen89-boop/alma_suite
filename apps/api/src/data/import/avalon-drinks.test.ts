import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMenuTemplate, isMenuTemplateKey, menuDocumentSchema, renderMenuSheetHtml, validateMenuDocument, type MenuRenderAssets } from '@alma/shared';
import { AVALON_DRINKS_IMPORT } from './avalon-drinks.js';
import type { MenuImportSpec } from './types.js';

/**
 * The Avalon drinks book as an import spec: a complete, already-normalised
 * document that validates for its kind, prints on its template and declares
 * exactly the pages the book has. No database, no browser.
 */
const SPECS: MenuImportSpec[] = [AVALON_DRINKS_IMPORT];

const assets: MenuRenderAssets = { fontFaceCss: '', logoSrc: (asset) => `/${asset}` };

for (const spec of SPECS) {
  const templateKnown = isMenuTemplateKey(spec.templateKey);
  const template = templateKnown ? getMenuTemplate(spec.templateKey) : null;
  const skipTemplate = templateKnown ? false : `template "${spec.templateKey}" is not registered yet`;

  describe(`${spec.venueSlug} / ${spec.slug} (${spec.templateKey})`, () => {
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
      assert.ok(keys.every((key) => typeof key === 'string' && key.startsWith('avd-') && key.length <= 80));
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

describe('Avalon drinks book — what the book prints', () => {
  const doc = AVALON_DRINKS_IMPORT.document;
  const byPage = (page: number) => doc.sections.filter((section) => section.page === page);

  it('has fifteen pages with a sectionless cover and content on every inner page', () => {
    assert.equal(doc.pageCount, 15);
    assert.equal(byPage(1).length, 0);
    for (let page = 2; page <= 15; page += 1) assert.ok(byPage(page).length > 0, `page ${page} is empty`);
  });

  it('prints the template title on the cover and the cover conditions in the footer', () => {
    assert.equal(doc.heading, '');
    assert.match(doc.surchargeLine, /^A surcharge of 10% applies on weekends and 15% on public holidays\./);
    assert.equal(doc.dietaryNote, '');
  });

  it('carries the dietary marks the cover legend is generated from', () => {
    const tagged = doc.sections.flatMap((section) => section.items).filter((item) => item.tags.length > 0);
    assert.deepStrictEqual(
      tagged.map((item) => [item.name, item.tags.join(',')]),
      [
        ['Beach, Please', 'N'],
        ['Espresso Martini', 'DF']
      ]
    );
  });

  it('prices wines in three columns with dots where not poured', () => {
    const tables = doc.sections.filter((section) => section.sectionType === 'TABLE');
    assert.deepStrictEqual(
      tables.map((section) => section.title),
      ['White', 'Bubbles', 'Rosé', 'Red']
    );
    for (const table of tables) {
      assert.deepStrictEqual(table.priceColumns, ['150 mL', '250 mL', 'Bottle']);
      for (const row of table.items) assert.equal(row.prices.length, 3);
    }
    const frogmore = tables[0]!.items.find((item) => item.name.includes('Frogmore'));
    assert.deepStrictEqual(frogmore?.prices, [null, null, 9300]);
    const taittinger = tables[1]!.items.find((item) => item.name.endsWith('Pinot Meunier'));
    assert.deepStrictEqual(taittinger?.prices, [2800, null, 16100]);
  });

  it('marks the staff picks and keeps mezcal villages under the name', () => {
    const picks = doc.sections.flatMap((section) => section.items).filter((item) => item.flags.includes('STAFF_PICK'));
    assert.equal(picks.length, 29);
    const espadin = doc.sections.find((section) => section.title === 'Espadín');
    assert.equal(espadin?.items.length, 17);
    assert.equal(espadin?.items[0]?.description, 'Santiago Matatlán');
    assert.equal(espadin?.items[0]?.meta, '45%');
    assert.equal(espadin?.items[0]?.priceCents, 1200);
  });

  it('keeps the agave pages where the flights page points to them', () => {
    const tequilaIntro = doc.sections.find((section) => section.title === 'Tequila');
    const mezcalIntro = doc.sections.find((section) => section.title === 'Mezcal');
    assert.equal(tequilaIntro?.page, 11);
    assert.equal(mezcalIntro?.page, 13);
    const flightsNote = byPage(7).find((section) => section.sectionType === 'TEXT' && !section.title);
    assert.match(flightsNote?.body ?? '', /page 11, mezcal page 13/);
  });
});
