/**
 * Alma Group — the functions & groups package menu, as an import spec.
 *
 * Transcribed from "Package menu creation25:7.pdf" (Dropbox /Family Room/
 * Indesign, 25 Jul 2026), the live functions menu: byte-identical to the
 * website's alma-functions-menu.pdf, whose local copy was read with pdftotext
 * for this transcription and checked against discovery/05 §2.3 and §3a. A4
 * portrait, five pages, group-branded (both venues' marks and addresses), so
 * the document is owned by one venue and printed on the group template.
 *
 * Mapping (plan §3):
 *   page 1  cover — heading, "Package menu" beneath, the cover line as TEXT
 *   page 2  Ways to gather — the preferred package and the bottomless
 *           alternative as single-item SET_MENUS, the set menus as SET_MENUS,
 *           the arrival add-ons as STANDARD rows priced pp, the footer as TEXT
 *   page 3  By the occasion — one STANDARD section per occasion with the
 *           venue qualifier in the heading suffix; the team-lunch prose as TEXT
 *   page 4  Beverage packages — one TABLE per tier (2 / 3 / 4 hrs) whose one
 *           row is "Per person" with the wine list as its description; the
 *           duration-priced add-ons as a TABLE, the arrival add-ons as STANDARD
 *   page 5  Weddings — per-head packages as SET_MENUS, the minimum-spend table
 *           as a TABLE with a St Alma and an Alma Avalon column, the capacity
 *           notes and contact block as TEXT
 *   footer  the surcharge sentence → conditions (prints on the last page)
 *
 * Page titles ("Ways to gather") have no slot of their own in the paged
 * family; where the PDF prints an italic tagline under one, the title and the
 * tagline open the page as a titled TEXT block, which also feeds the cover's
 * generated contents line. Nothing here is invented; what the template cannot
 * carry is listed under `review`.
 */
import { makeReferenceBuilders } from './reference-builders.js';
import type { MenuImportSpec } from './types.js';

const b = makeReferenceBuilders('fn');

const HOURS = ['2 hrs', '3 hrs', '4 hrs'];

const sections = [
  // ---- P1 · Cover ------------------------------------------------------------------
  // "ST ALMA, FRESHWATER · ALMA AVALON" is the template's tagline; the wordmark and arch are drawn.
  b.text(1, "Two coastal Mexican venues on Sydney's Northern Beaches. Long tables, shared plates, margaritas."),

  // ---- P2 · Ways to gather ---------------------------------------------------------
  b.section({
    page: 2,
    title: 'The Alma Table',
    type: 'SET_MENUS',
    lead: 'Preferred',
    items: [
      b.item({
        name: 'The Alma Table',
        price: 125,
        unit: 'pp',
        description: 'Six course Trust the Chef, plus a two hour house drinks package. More food, a considered pour, and our favourite way to sit a group down.'
      })
    ]
  }),
  b.section({
    page: 2,
    title: 'Or, keep it bottomless',
    type: 'SET_MENUS',
    headerSuffix: 'Lunch only, 12 to 4pm, up to 19 guests',
    items: [
      b.item({
        name: 'Bottomless',
        price: 99,
        unit: 'pp',
        description: 'Three course shared menu, plus two hours of bottomless margaritas, Coronas and house wine. Available at lunch, 12 to 4pm, for up to 19 guests.'
      })
    ]
  }),
  b.section({
    page: 2,
    title: 'Set menus',
    type: 'SET_MENUS',
    items: [
      b.item({ name: 'Grazing', price: 49, unit: 'pp', description: 'A generous spread of shared plates to graze across the table.' }),
      b.item({ name: 'Six course, Trust the Chef', price: 79, unit: 'pp', description: 'Let the kitchen send its best, course after course.' }),
      // The PDF sets "WITH A SET MENU" as a small caps qualifier after the name — the meta slot.
      b.item({
        name: 'House drinks package',
        meta: 'With a set menu',
        price: 49,
        unit: 'pp',
        description: 'Two hours of house wine, rosé, white and red, plus Corona and Farina prosecco.'
      })
    ]
  }),
  b.section({
    page: 2,
    title: 'On arrival',
    items: [
      b.item({ name: 'Cocktail or margarita on arrival', price: 12, unit: 'pp' }),
      b.item({ name: 'Prosecco on arrival', price: 10, unit: 'pp' }),
      b.item({ name: 'Champagne on arrival', price: 20, unit: 'pp' }),
      b.item({ name: 'Cake, house sourced and decorated to suit', meta: 'on request' })
    ]
  }),
  b.text(2, 'Set menus and packages available across both venues.\nTwo hour sittings run flexibly through the day.'),

  // ---- P3 · By the occasion --------------------------------------------------------
  b.text(3, 'However you like to celebrate.', 'By the occasion'),
  b.section({
    page: 3,
    title: 'Group bookings',
    headerSuffix: 'Both venues',
    items: [
      b.item({
        name: 'The Alma Table, preferred',
        price: 125,
        unit: 'pp',
        description: 'Or go bottomless at $99 pp, two hours, at lunch only, 12 to 4pm, for up to 19 guests. Add a cocktail on arrival, $12 pp.',
        keyText: 'group bookings the alma table'
      })
    ]
  }),
  b.section({
    page: 3,
    title: 'Birthdays',
    headerSuffix: 'Both venues',
    items: [
      b.item({
        name: 'The Alma Table, preferred',
        price: 125,
        unit: 'pp',
        description: 'Or six course $79 pp, grazing $49 pp, or bottomless $99 pp, at lunch only, 12 to 4pm, for up to 19 guests. Cocktail on arrival $12 pp. Add a cake, house sourced.',
        keyText: 'birthdays the alma table'
      })
    ]
  }),
  b.section({
    page: 3,
    title: 'Hens — Alma Avalon',
    items: [
      b.item({
        name: 'Inside, exclusive, up to 25 guests',
        price: 125,
        unit: 'pp',
        description:
          'The Alma Table, or bottomless $99 pp for two hours, at lunch only, 12 to 4pm, for up to 19 guests. Sittings 12 to 2:30pm or 3 to 5:30pm. Decorate your table as you like, speeches welcome.'
      })
    ]
  }),
  b.section({
    page: 3,
    title: 'Hens — St Alma, Freshwater',
    items: [
      b.item({
        name: 'Long table, semi exclusive or the whole venue',
        price: 125,
        unit: 'pp',
        description:
          'The Alma Table, or bottomless $99 pp, at lunch only, 12 to 4pm, for up to 19 guests. Long table up to 18 (12 to 4pm), semi exclusive up to 28 (3 to 5pm), whole venue seated up to 52 (12 to 4pm). Decorate your table as you like.'
      })
    ]
  }),
  // The PDF's row reads "Grazing $49 pp, or six course $79 pp" over four lines of italic prose.
  b.section({
    page: 3,
    title: 'Team & corporate lunches',
    headerSuffix: 'St Alma, Tue to Fri, 12 to 4pm',
    items: [b.item({ name: 'Grazing', price: 49, unit: 'pp', keyText: 'team lunches grazing' }), b.item({ name: 'Six course', price: 79, unit: 'pp', keyText: 'team lunches six course' })]
  }),
  b.text(
    3,
    'Add the house drinks package, $49 pp for two hours, or the Standard beverage package, $54 pp for two hours, extendable to three hours $69 pp or four hours $84 pp.\n' +
      'Cocktail on arrival $12 pp. Extend your sitting to three hours, +$10 pp.\n' +
      'We open the venue for your group.'
  ),

  // ---- P4 · Beverage packages ------------------------------------------------------
  b.text(4, 'Timed drinks, chosen by the table.', 'Beverage packages', 'St Alma, Freshwater'),
  b.section({
    page: 4,
    title: 'Standard',
    type: 'TABLE',
    priceColumns: HOURS,
    items: [
      b.item({
        name: 'Per person',
        prices: [54, 69, 84],
        description: 'Krinklewood rosé, Atlas Eden Valley riesling, The Gaucho Club malbec, Farina prosecco. Corona.',
        keyText: 'standard per person'
      })
    ]
  }),
  b.section({
    page: 4,
    title: 'Premium',
    type: 'TABLE',
    priceColumns: HOURS,
    items: [
      b.item({
        name: 'Per person',
        prices: [69, 89, 109],
        description: "La Belle Colette rosé, Greystone pinot gris, Winmark Rusty's Run chardonnay, M and J Becker Tumbarumba pinot noir, Teusner Wark Family shiraz, Farina prosecco. Corona.",
        keyText: 'premium per person'
      })
    ]
  }),
  b.section({
    page: 4,
    title: 'Ballers',
    type: 'TABLE',
    priceColumns: HOURS,
    items: [
      b.item({
        name: 'Per person',
        prices: [85, 110, 135],
        description: "La Belle Colette rosé, Greywacke sauvignon blanc, Thorin Terres de Craie chardonnay, Neudorf Tom's Block pinot noir, Beloki Rioja crianza, Laurent Perrier La Cuvée. Corona.",
        keyText: 'ballers per person'
      })
    ]
  }),
  b.section({
    page: 4,
    title: 'Add ons',
    type: 'TABLE',
    priceColumns: HOURS,
    items: [
      b.item({ name: 'Unlimited margaritas', prices: [19, 29, 39] }),
      b.item({ name: 'Unlimited spirit & mixer', prices: [15, 25, 35] }),
      b.item({ name: 'Unlimited premium spirit & mixer', prices: [30, 50, 70] })
    ]
  }),
  b.section({
    page: 4,
    title: 'Add ons',
    headerSuffix: 'On arrival',
    items: [
      b.item({ name: 'Prosecco on arrival', price: 10, unit: 'pp', keyText: 'add ons prosecco on arrival' }),
      b.item({ name: 'Champagne on arrival', price: 20, unit: 'pp', keyText: 'add ons champagne on arrival' })
    ]
  }),
  b.text(4, 'Prefer it simpler? The house drinks package is $49 pp for two hours with any set menu.'),

  // ---- P5 · Weddings ---------------------------------------------------------------
  b.text(5, 'Coastal Mexican, good tables, proper nights.', 'Weddings'),
  b.section({
    page: 5,
    title: 'Packages',
    type: 'SET_MENUS',
    headerSuffix: 'Per head, both venues',
    items: [
      b.item({ name: 'Seated feast', price: 185, unit: 'pp', description: 'An elevated shared banquet, four hour premium beverage package, and a cocktail on arrival.' }),
      b.item({ name: 'Canapé', price: 165, unit: 'pp', description: 'A roving canapé menu, four hour premium beverage package, and a cocktail on arrival.' })
    ]
  }),
  b.section({
    page: 5,
    title: 'Minimum spend by session',
    type: 'TABLE',
    headerSuffix: 'Exclusive use, food and beverage',
    priceColumns: ['St Alma', 'Alma Avalon'],
    items: [
      b.item({ name: 'Tue to Thu', prices: [7000, 4500] }),
      b.item({ name: 'Friday lunch', prices: [8000, 5500] }),
      b.item({ name: 'Friday night', prices: [12000, 8000] }),
      b.item({ name: 'Saturday lunch', prices: [10000, 7000] }),
      b.item({ name: 'Saturday night', prices: [14000, 10000] }),
      b.item({ name: 'Sunday', prices: [9000, 6000] })
    ]
  }),
  // The PDF sets each venue's capacity note under its column head.
  b.text(5, '52 seated, 80 canapé. DJ or band, decorations, bump in from 11am, speeches all welcome.', 'St Alma'),
  b.text(5, '25 seated exclusive, 50 canapé, 40 whole venue seated. Speeches welcome.', 'Alma Avalon'),
  b.text(
    5,
    'To lock in your date, speak with our team.\n\n' +
      'St Alma, 20 Albert Street, Freshwater · Alma Avalon, 47 Old Barrenjoey Road, Avalon Beach\n' +
      'Enquiries enquiries@almagroup.com.au'
  )
];

const document = b.document({
  heading: 'Functions & groups',
  subheading: 'Package menu',
  pageCount: 5,
  conditions: 'A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays.',
  surchargeLine: '',
  sections
});

export const GROUP_FUNCTIONS_IMPORT: MenuImportSpec = {
  venueSlug: 'st-alma',
  kind: 'FUNCTIONS',
  templateKey: 'group_functions_a4',
  name: 'Functions & groups',
  slug: 'functions',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: '/Family Room/Indesign/Package menu creation25:7.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAD72w',
    hash: 'dropbox-content-hash:7c1ced1772c99e390a91492cadb3d7134eed4b0e54b2c78798c0c80d49099cc9',
    modifiedAt: '2026-07-25T08:10:00Z',
    notes:
      'Byte-identical to the live website file alma-web-platform apps/web/public/menus/alma-functions-menu.pdf (Dropbox content hash 7c1ced17…, discovery/05 §0), ' +
      'linked from /catering. The local copy was read with pdftotext for this transcription and checked against discovery/05 §2.3 and the rendered pages in §3a. ' +
      'Successor of "Alma Functions Menu 15:7.pdf" (id:x4KPThkyLiAAAAAAAAD7wg), which lacked the lunch-only / 19-guest bottomless clause. High confidence: this is what the website serves today.'
  },
  review: [
    'Cover: the PDF prints "PACKAGE MENU" as letterspaced caps under the title; the template prints the subheading in Cormorant italic. The template also generates a contents line from each page\'s first titled section ("THE ALMA TABLE 2 · BY THE OCCASION 3 · BEVERAGE PACKAGES 4 · WEDDINGS 5"), which the PDF does not have.',
    'Page titles: "WAYS TO GATHER", "BY THE OCCASION", "BEVERAGE PACKAGES" and "WEDDINGS" have no slot in the paged family; on pages 3–5 the title opens the page as a text block carrying the PDF\'s italic tagline, on page 2 (no tagline) it is dropped and the page opens with the preferred package.',
    'The Alma Table: the PDF draws it as a bordered box with a filled "PREFERRED" pill; here it is a set-menu section with "Preferred" as the small-caps lead. "WITH A SET MENU" on the house drinks package is carried as the item\'s meta.',
    'Prices print in the house style, bare numbers with "pp" ("125 pp", "10 pp", "54 · 69 · 84"); the PDF\'s "$" and the "+" on add-ons ("+$12 pp", "+$19 / $29 / $39") are not printed. Minimum spends print without thousands separators ("7000"); the PDF prints "$7,000".',
    'Team & corporate lunches: the PDF\'s one row "Grazing $49 pp, or six course $79 pp" is two priced rows here, with its four lines of prose as a text block beneath.',
    'Cake, house sourced and decorated to suit has no price ("on request" is its meta), so validation warns STANDARD_NO_PRICE for that row; acknowledge at publish.',
    'Beverage packages: the tiers are tables with 2 hrs / 3 hrs / 4 hrs columns (the PDF heads each tier "STANDARD 2 / 3 / 4 HOURS" and prints "$54 / $69 / $84" on one line). The arrival add-ons on this page are a second "Add ons" section with the suffix "On arrival", below the duration-priced table.',
    'Weddings: the PDF sets the minimum spends as two side-by-side columns, each with its capacity note above the rows; here one table with a St Alma and an Alma Avalon column, then the two capacity notes as titled text blocks, then the contact block.',
    'Surcharge: carried as conditions ("A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays."), which the template prints on the last page; the group template\'s default surchargeLine says the same and is left empty here so it does not print twice.',
    'The PDF\'s warm cream page and bordered hero box are the website renderer\'s; the template prints white stock with the shared tokens (plan §3.6).'
  ],
  document
};
