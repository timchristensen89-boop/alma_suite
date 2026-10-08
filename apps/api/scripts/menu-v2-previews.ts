/**
 * Representative previews of the Menus V2 print families, rendered the way
 * publish renders them (headless Chrome, the real fonts and marks) and
 * rasterised beside the PDFs for visual review in the PR.
 *
 *   pnpm --filter @alma/api menus:previews            # writes docs/menus-v2/previews/
 *
 * The documents here are samples for layout review. Their content is taken
 * from the reference cards and books so the proportions are honest, but
 * nothing in them is approved copy or current pricing.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MENU_DOCUMENT_DEFAULTS, getMenuTemplate, renderMenuHtml, type MenuDocument, type MenuItemDocument, type MenuSectionDocument, type MenuTemplateKey } from '@alma/shared';
import { loadMenuRenderAssets } from '../src/lib/menu-assets.js';
import { closeMenuBrowser, renderMenuPdf } from '../src/lib/menu-pdf.js';

const OUT = resolve(process.argv[2] ?? join(import.meta.dirname, '../../../docs/menus-v2/previews'));

function item(name: string, over: Partial<MenuItemDocument> = {}): MenuItemDocument {
  return {
    dishKey: `pv-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    description: null,
    priceCents: null,
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

function section(title: string, over: Partial<MenuSectionDocument> = {}): MenuSectionDocument {
  return { title, headerSuffix: null, subheading: null, sectionType: 'STANDARD', placement: 'LEFT', page: 1, lead: null, body: null, priceColumns: [], visible: true, items: [], ...over };
}

function document(over: Partial<MenuDocument>): MenuDocument {
  return { ...MENU_DOCUMENT_DEFAULTS, sections: [], ...over };
}

const SURCHARGE = 'A surcharge of 10% applies on weekends and 15% on public holidays.';

const SAMPLES: Array<{ name: string; templateKey: MenuTemplateKey; title: string; document: MenuDocument }> = [
  {
    name: 'card-happy-hour-avalon',
    templateKey: 'avalon_card_a5',
    title: 'Alma Avalon happy hour | sample',
    document: document({
      heading: 'Happy hour',
      subheading: 'Early drinks and snacks before service.',
      whenLine: 'Wed–Thu · 5–6pm · Fri–Sun · 4–6pm',
      surchargeLine: SURCHARGE,
      sections: [
        section('Margaritas', { sectionType: 'HEADER_PRICED', headerSuffix: '12', items: ['Classic', 'Jalapeño', 'Tommy’s', 'Watermelon', 'Sensible'].map((name) => item(name)) }),
        section('Beer', { sectionType: 'HEADER_PRICED', headerSuffix: '8', items: ['Freshwater Brewing Wedge Cerveza', 'Freshwater Brewing Freshie Hazy Pale'].map((name) => item(name)) }),
        section('Wine', { sectionType: 'HEADER_PRICED', headerSuffix: '8', items: ['Atlas ‘Eden Valley’ Riesling', 'El Desperado Pinot Noir', 'R. Paulazzo Rosé', 'Farina Prosecco'].map((name) => item(name)) }),
        section('Spritz', { sectionType: 'HEADER_PRICED', headerSuffix: '12', items: ['Aperol', 'Limoncello', 'Hugo'].map((name) => item(name)) }),
        section('Snacks', {
          items: [
            item('Guacamole, corn chips, wakame', { priceCents: 1200, tags: ['VG', 'GFA', 'DF'] }),
            item('Sweet corn, panko crumb, cotija cheese, chipotle', { priceCents: 1200, tags: ['V', 'GFA'] }),
            item('Chicken tinga empanadas, martajada sauce', { priceCents: 1400, tags: ['GFA', 'DF'] }),
            item('Oysters, finger lime mignonette', { priceCents: 500, priceUnit: 'each', tags: ['GF', 'DF'], isSeafood: true })
          ]
        })
      ]
    })
  },
  {
    name: 'card-bottomless-st-alma',
    templateKey: 'freshwater_card_a5',
    title: 'St Alma bottomless lunch | sample',
    document: document({
      heading: 'Bottomless lunch',
      subheading: 'Lunch that runs long. Three courses shared across the table, and the margaritas keep coming.',
      whenLine: 'Fri–Sun · 12–4pm',
      heroPriceCents: 9900,
      heroPriceUnit: 'pp',
      conditions: 'Two hours from your sitting time, one drink at a time, served at our discretion.\nThe whole table takes part. Lunch only, 12pm to 4pm, for up to 19 guests.',
      surchargeLine: SURCHARGE,
      sections: [
        section('To start', {
          sectionType: 'LIST',
          items: [item('Guacamole, salsa macha, tostadas', { tags: ['VG', 'GFA', 'DF', 'N'] }), item('Kingfish ceviche, apple, cucumber, strawberry and basil aguachile', { tags: ['GF', 'DF', 'A'], isSeafood: true })]
        }),
        section('Tacos', {
          sectionType: 'LIST',
          lead: 'Two per person · choose from',
          items: [
            item('Barramundi, pickled cabbage, chipotle aioli', { tags: ['GFA', 'DF', 'A'], isSeafood: true }),
            item('Beef birria, morita salsa, crispy chickpeas', { tags: ['GF', 'DF'] }),
            item('Nopal, avocado salsa, fried potato', { tags: ['VG', 'GF', 'DF', 'N'] })
          ]
        }),
        section('Something sweet', { sectionType: 'LIST', items: [item('Churros, almond and white chocolate ganache, ice cream', { tags: ['V', 'N'] })] }),
        section('Bottomless, for two hours', {
          sectionType: 'LIST',
          items: [item('Classic and jalapeño margaritas'), item('Farina prosecco'), item('Corona'), item('House riesling and pinot noir'), item('Soft drinks and non-alcoholic options throughout')]
        })
      ]
    })
  },
  {
    name: 'card-lunch-special-avalon',
    templateKey: 'avalon_card_a5',
    title: 'Alma Avalon lunch special | sample',
    document: document({
      heading: 'Lunch special',
      subheading: 'Three courses to share, with a margarita to start.',
      whenLine: 'Sat & Sun · 12–3pm',
      heroPriceCents: 4900,
      heroPriceUnit: 'pp',
      surchargeLine: SURCHARGE,
      sections: [
        section('To drink', { sectionType: 'LIST', lead: 'Choose one', items: [item('Classic margarita'), item('Sensible margarita')] }),
        section('Starter', { sectionType: 'LIST', items: [item('Prawn ceviche, aguachile, baby cucumbers', { tags: ['GF', 'DF', 'I'], isSeafood: true })] }),
        section('Shared main', {
          sectionType: 'LIST',
          items: [item('Fish of the day al pastor, pico de piña, avocado mousse', { tags: ['GF', 'DF', 'A'], isSeafood: true }), item('Agave beef short rib, grilled cos, baby carrots, tortillas', { tags: ['GF', 'DF'] })]
        }),
        section('Shared side', { sectionType: 'LIST', items: [item('Shoestring fries, paprika, chipotle aioli', { tags: ['V', 'GF', 'DF'] }), item('Broccolini, pipián mole, pepitas', { tags: ['VG', 'GF', 'DF', 'N'] })] }),
        section('Add on', {
          items: [item('Guacamole, salsa macha, tostadas', { priceCents: 1600, tags: ['VG', 'GFA', 'DF', 'N'] }), item('Chicken tinga empanadas, martajada sauce', { priceCents: 700, priceUnit: 'pp', tags: ['GFA', 'DF'] })]
        })
      ]
    })
  },
  {
    name: 'card-private-event-st-alma',
    templateKey: 'freshwater_card_a5',
    title: 'St Alma private event set menu | sample',
    document: document({
      heading: 'Harriet & Tom',
      subheading: 'Saturday 14 November 2026',
      showPrices: false,
      pageCount: 2,
      dietaryNote: 'Dietaries catered with notice. Please let your server know of any allergies.',
      sections: [
        section('', { sectionType: 'TEXT', body: 'Welcome to St Alma. Tonight the kitchen cooks for the whole table: everything arrives to share, course after course, with the margaritas close behind.' }),
        section('To start', {
          sectionType: 'COURSE',
          items: [item('Guacamole, salsa macha, tostadas', { description: 'For the table', tags: ['VG', 'GFA', 'DF', 'N'] }), item('Kingfish ceviche', { description: 'Apple, cucumber, strawberry and basil aguachile, roe', tags: ['GF', 'DF', 'A'], isSeafood: true })]
        }),
        section('Tacos', {
          sectionType: 'COURSE',
          lead: 'Two per person',
          items: [item('Barramundi', { description: 'Pickled cabbage, chipotle aioli', tags: ['GFA', 'DF', 'A'], isSeafood: true }), item('Beef birria', { description: 'Morita salsa, crispy chickpeas', tags: ['GF', 'DF'] }), item('Nopal', { description: 'Avocado salsa, fried potato', tags: ['VG', 'GF', 'DF', 'N'] })]
        }),
        section('From the grill', {
          sectionType: 'COURSE',
          page: 2,
          lead: 'Choose one',
          items: [item('Grilled snapper', { description: 'Chipotle and cauliflower purée, fennel and green apple pico', tags: ['GF', 'A'], isSeafood: true }), item('Agave beef short rib', { description: 'Grilled cos, pickled carrots, tortillas', tags: ['GF', 'DF'] }), item('Roasted cabbage', { description: 'Pepita mole, shishito peppers', tags: ['VG', 'GF', 'N'] })]
        }),
        section('Sides', { sectionType: 'COURSE', page: 2, items: [item('Broccolini, almond mole', { tags: ['VG', 'GF', 'DF', 'N'] }), item('Green leaf salad, citrus vinaigrette', { tags: ['V', 'GF', 'DF', 'N'] })] }),
        section('Something sweet', { sectionType: 'COURSE', page: 2, items: [item('Churros', { description: 'Almond and white chocolate ganache, ice cream', tags: ['V', 'N'] })] }),
        section('', { sectionType: 'TEXT', page: 2, body: 'With love from Harriet, Tom and both families. Thank you for being here.' })
      ]
    })
  },
  {
    name: 'drinks-book-avalon',
    templateKey: 'avalon_drinks_book',
    title: 'Alma Avalon drinks | sample pages',
    document: document({
      pageCount: 3,
      surchargeLine: SURCHARGE,
      sections: [
        section('Cocktails', {
          page: 2,
          subheading: 'All margaritas available spicy on request.',
          items: [
            item('Classic margarita', { priceCents: 2300, description: 'Tequila blanco, lime, agave', note: 'Served up, salt rim' }),
            item('Tommy’s margarita', { priceCents: 2300, description: 'Tequila reposado, lime, agave', flags: ['STAFF_PICK'] }),
            item('Coconut margarita', { priceCents: 2300, description: 'Tequila blanco, coconut, lime', meta: 'Signature' }),
            item('Paloma', { priceCents: 2300, description: 'Tequila, pink grapefruit soda, lime' })
          ]
        }),
        section('Wine · white', {
          page: 3,
          sectionType: 'TABLE',
          priceColumns: ['150 mL', '250 mL', 'Bottle'],
          items: [
            item('Atlas ‘Eden Valley’ Riesling', { meta: 'Eden Valley, SA · 2024', prices: [1400, 2200, 6800] }),
            item('Greystone Pinot Gris', { meta: 'Waipara, NZ · 2023', prices: [1500, 2400, 7200] }),
            item('Thorin Terres de Craie Chardonnay', { meta: 'Burgundy, FR · 2022', prices: [null, null, 9800], flags: ['LIMITED'] })
          ]
        }),
        section('Beer & cider', { page: 3, items: [item('Corona', { meta: '4.5%', priceCents: 1300 }), item('Balter Cerveza', { meta: '4.0%', priceCents: 1300 }), item('Heaps Normal Quiet XPA', { meta: 'non-alc', priceCents: 1000 })] })
      ]
    })
  },
  {
    name: 'functions-group',
    templateKey: 'group_functions_a4',
    title: 'Alma Group functions | sample pages',
    document: document({
      heading: 'Functions & groups',
      subheading: 'Package menu',
      pageCount: 2,
      conditions: 'Set menus and packages available across both venues. Two hour sittings run flexibly through the day.',
      surchargeLine: 'A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays.',
      sections: [
        section('Ways to gather', {
          page: 2,
          sectionType: 'SET_MENUS',
          lead: 'Preferred',
          items: [item('The Alma Table', { priceCents: 12500, priceUnit: 'pp', description: 'Six course Trust the Chef, plus a two hour house drinks package. More food, a considered pour, and our favourite way to sit a group down.' })]
        }),
        section('Set menus', {
          page: 2,
          sectionType: 'SET_MENUS',
          items: [
            item('Grazing', { priceCents: 4900, priceUnit: 'pp', description: 'A generous spread of shared plates to graze across the table.' }),
            item('Six course, Trust the Chef', { priceCents: 7900, priceUnit: 'pp', description: 'Let the kitchen send its best, course after course.' }),
            item('House drinks package', { priceCents: 4900, priceUnit: 'pp', meta: 'with a set menu', description: 'Two hours of house wine, rosé, white and red, plus Corona and Farina prosecco.' })
          ]
        }),
        section('On arrival', {
          page: 2,
          items: [item('Cocktail or margarita on arrival', { priceCents: 1200, priceUnit: 'pp' }), item('Prosecco on arrival', { priceCents: 1000, priceUnit: 'pp' }), item('Champagne on arrival', { priceCents: 2000, priceUnit: 'pp' }), item('Cake, house sourced and decorated to suit', { description: 'On request' })]
        }),
        section('Beverage packages', {
          page: 2,
          sectionType: 'TABLE',
          subheading: 'Timed drinks, chosen by the table. St Alma, Freshwater.',
          priceColumns: ['2 hrs', '3 hrs', '4 hrs'],
          items: [
            item('Standard', { prices: [5400, 6900, 8400], description: 'Krinklewood rosé, Atlas Eden Valley riesling, The Gaucho Club malbec, Farina prosecco. Corona.' }),
            item('Premium', { prices: [6900, 8900, 10900], description: 'La Belle Colette rosé, Greystone pinot gris, Winmark Rusty’s Run chardonnay, M and J Becker pinot noir, Teusner Wark Family shiraz, Farina prosecco. Corona.' })
          ]
        })
      ]
    })
  }
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const assets = loadMenuRenderAssets();
  const index: string[] = ['# Menus V2 — rendered previews', '', 'Rendered by `pnpm --filter @alma/api menus:previews` with the publish pipeline (headless Chrome, the real fonts and marks). Sample content for layout review only — not approved copy or pricing.', ''];
  for (const sample of SAMPLES) {
    const template = getMenuTemplate(sample.templateKey);
    const html = renderMenuHtml(sample.document, sample.templateKey, { assets, title: sample.title });
    const rendered = await renderMenuPdf(html, template.page);
    const pdfPath = join(OUT, `${sample.name}.pdf`);
    writeFileSync(pdfPath, rendered.pdf);
    execFileSync('pdftoppm', ['-r', '110', '-png', pdfPath, join(OUT, sample.name)]);
    const fill = rendered.fill.pages?.map((page) => `p${page.page} ${Math.round(page.fillRatio * 100)}%${page.overflow ? ' OVERFLOW' : ''}`).join(', ') ?? `${Math.round(rendered.fill.fillRatio * 100)}%`;
    console.log(`${sample.name}: ${rendered.pageCount} page(s), fill ${fill}, ${rendered.renderMs} ms`);
    index.push(`## ${sample.title}`, '', `Template \`${sample.templateKey}\` (${template.format}), ${rendered.pageCount} page(s); fill ${fill}. PDF: \`${sample.name}.pdf\`.`, '');
    for (let page = 1; page <= rendered.pageCount; page += 1) {
      const suffix = rendered.pageCount > 1 ? `-${String(page).padStart(String(rendered.pageCount).length, '0')}` : '-1';
      index.push(`![${sample.name} page ${page}](./${sample.name}${suffix}.png)`, '');
    }
  }
  writeFileSync(join(OUT, 'README.md'), `${index.join('\n')}\n`);
  await closeMenuBrowser();
}

main().catch(async (error) => {
  console.error(error);
  await closeMenuBrowser();
  process.exit(1);
});
