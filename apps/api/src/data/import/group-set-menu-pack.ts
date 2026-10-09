/**
 * Alma Group — the set-menu pack (Grazing 49 / Feasting 79 / Bottomless 99),
 * as an import spec.
 *
 * Transcribed from the extracted text of "Set Menu Pack review.pdf" (Dropbox
 * /Family Room/Indesign, 5 Aug 2026; discovery/05 §2.1), the newest of three
 * drafts made within 21 hours and the only one with dietary markers and the
 * whole-table line. Its filename says "review": nothing here is approved, and
 * none of the three drafts is on the website (plan §5.1). Three A4 pages, one
 * per tier, each headed "ALMA AVALON · ST ALMA".
 *
 * Mapping (plan §3):
 *   page 1          cover — no sections; the heading prints as the title
 *   per tier page   SET_MENUS first: item = the tier, price pp, description =
 *                   the positioning blurb (the hero price is per page, not per
 *                   document, so it lives here rather than on the title block)
 *   courses         LIST sections (names only), lead "Two per person" where
 *                   printed, N tags where marked; the garnish after the dash is
 *                   kept as the description
 *   on arrival      STANDARD rows priced pp
 *   bottomless      the inclusions, duration and lunch-only lines as TEXT
 *   footer          the shared lines → conditions; the legend is generated
 *
 * Nothing here is invented: every string is the source's, lower-case garnish
 * and all. Where the template cannot carry something, `review` says so.
 */
import type { MenuTagCode } from '@alma/shared';
import { makeReferenceBuilders } from './reference-builders.js';
import type { MenuImportSpec } from './types.js';

const b = makeReferenceBuilders('smp');

/** A course line of one tier: the same dish prints on up to three pages, so the key is scoped to the tier. */
function course(tier: string) {
  return (name: string, description?: string, tags?: MenuTagCode[]) =>
    b.item({ name, ...(description ? { description } : {}), ...(tags ? { tags } : {}), keyText: `${tier} ${name}` });
}

function onArrival(page: number, tier: string, lead?: string) {
  const dish = course(tier);
  return b.section({
    page,
    title: 'On arrival',
    ...(lead ? { lead } : {}),
    items: [
      { ...dish('Cocktail or margarita'), priceCents: 1200, priceUnit: 'pp' },
      { ...dish('Prosecco'), priceCents: 1000, priceUnit: 'pp' },
      { ...dish('Champagne'), priceCents: 2000, priceUnit: 'pp' }
    ]
  });
}

const grazing = course('grazing');
const feasting = course('feasting');
const bottomless = course('bottomless');

const sections = [
  // ---- P1 · Cover: no sections. The heading and the template's group mark print. ----

  // ---- P2 · Grazing, $49 per person ------------------------------------------------
  b.section({
    page: 2,
    title: 'Grazing',
    type: 'SET_MENUS',
    items: [b.item({ name: 'Grazing', price: 49, unit: 'pp', description: 'The relaxed one, for a table that wants to eat well without sitting through a full service.' })]
  }),
  b.section({
    page: 2,
    title: 'To start',
    type: 'LIST',
    items: [grazing('Guacamole', 'corn chips, salsa macha, tostadas', ['N']), grazing('Chicken tinga empanadas', 'morita salsa, pickled onions')]
  }),
  b.section({ page: 2, title: 'Ceviche', type: 'LIST', items: [grazing('Kingfish ceviche', 'apple, cucumber, strawberry and basil aguachile')] }),
  b.section({
    page: 2,
    title: 'Tacos',
    type: 'LIST',
    lead: 'Two per person',
    items: [grazing('Barramundi', 'pickled cabbage, chipotle aioli'), grazing('Beef birria', 'morita salsa, crispy chickpeas'), grazing('Zucchini', 'salsa macha, avocado', ['N'])]
  }),
  b.section({ page: 2, title: 'On the side', type: 'LIST', items: [grazing('Shoestring fries, chipotle aioli'), grazing('Green leaf salad, citrus vinaigrette')] }),
  // "Start the table with a cocktail or margarita +$12 pp. Prosecco +$10 pp, or Champagne +$20 pp."
  onArrival(2, 'grazing', 'Start the table with'),

  // ---- P3 · Feasting, $79 per person -----------------------------------------------
  b.section({
    page: 3,
    title: 'Feasting',
    type: 'SET_MENUS',
    items: [
      b.item({
        name: 'Feasting',
        price: 79,
        unit: 'pp',
        description: 'Six courses, chosen by us and sent one after another. For a table that came for the occasion, not a quick lunch.'
      })
    ]
  }),
  b.section({ page: 3, title: 'Snacks', type: 'LIST', items: [feasting('Guacamole', 'corn chips, salsa macha, tostadas', ['N'])] }),
  b.section({ page: 3, title: 'Ceviche', type: 'LIST', items: [feasting('Kingfish ceviche', 'apple, cucumber, strawberry and basil aguachile')] }),
  b.section({
    page: 3,
    title: 'Tacos',
    type: 'LIST',
    lead: 'Two per person',
    items: [feasting('Barramundi', 'pickled cabbage, chipotle aioli'), feasting('Beef birria', 'morita salsa, crispy chickpeas')]
  }),
  b.section({ page: 3, title: 'From the grill', type: 'LIST', items: [feasting('Grilled snapper', 'chipotle and cauliflower purée, fennel and green apple pico')] }),
  b.section({ page: 3, title: 'For the table', type: 'LIST', items: [feasting('Agave beef short rib', 'grilled cos, pickled carrots, tortillas')] }),
  b.section({
    page: 3,
    title: 'Sides',
    type: 'LIST',
    items: [feasting('Broccolini, almond mole', undefined, ['N']), feasting('Green leaf salad'), feasting('Shoestring fries, chipotle aioli')]
  }),
  // "Cocktail or margarita +$12 pp, Prosecco +$10 pp, or Champagne +$20 pp."
  onArrival(3, 'feasting'),

  // ---- P4 · Bottomless, $99 per person ---------------------------------------------
  b.section({
    page: 4,
    title: 'Bottomless',
    type: 'SET_MENUS',
    items: [b.item({ name: 'Bottomless', price: 99, unit: 'pp', description: 'Lunch that runs long. Three courses shared across the table, and the margaritas keep coming.' })]
  }),
  b.section({ page: 4, title: 'To start', type: 'LIST', items: [bottomless('Guacamole', 'corn chips, salsa macha, tostadas', ['N'])] }),
  b.section({ page: 4, title: 'Ceviche', type: 'LIST', items: [bottomless('Kingfish ceviche', 'apple, cucumber, strawberry and basil aguachile')] }),
  b.section({
    page: 4,
    title: 'Tacos',
    type: 'LIST',
    lead: 'Two per person',
    items: [bottomless('Barramundi', 'pickled cabbage, chipotle aioli'), bottomless('Beef birria', 'morita salsa, crispy chickpeas')]
  }),
  b.section({ page: 4, title: 'Something sweet', type: 'LIST', items: [bottomless('Churros', 'dulce de leche, chocolate ice cream', ['N'])] }),
  b.text(
    4,
    'Classic and jalapeño margaritas, Prosecco, Corona, house Riesling and Pinot Noir. Soft drinks and non-alcoholic options throughout.\n\n' +
      'Two hours from your sitting time, one drink at a time, served at our discretion.',
    'Bottomless, for two hours'
  ),
  b.text(4, 'Lunch only, 12pm to 4pm · up to 19 guests')
];

const document = b.document({
  // The source has no cover of its own; the menu's name is the only title it can print.
  heading: 'Set menu packages',
  pageCount: 4,
  // The footer, identical on all three source pages. The legend line between
  // them ("N contains nuts · DF dairy free · …") is generated from the tags in use.
  conditions:
    'Set menus are taken by the whole table so everything reaches it together. Menus change seasonally, so the exact dishes on the day may differ.\n' +
    'Gluten free, vegan and vegetarian catered for with notice — please send numbers ahead of the day.\n' +
    'Groups of 8 or more, at either venue · 10% surcharge Saturday and Sunday, 15% public holidays · We are unable to split bills for groups of 8 or more',
  surchargeLine: '',
  sections
});

export const GROUP_SET_MENU_PACK_IMPORT: MenuImportSpec = {
  venueSlug: 'st-alma',
  kind: 'FUNCTIONS',
  templateKey: 'group_functions_a4',
  name: 'Set menu packages',
  slug: 'set-menu-packages',
  visibility: 'PUBLIC',
  confidence: 'medium',
  source: {
    path: '/Family Room/Indesign/Set Menu Pack review.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAD78w',
    modifiedAt: '2026-08-05T07:20:00Z',
    notes:
      'Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.1); the file could not be downloaded or rendered in this sandbox, so the layout is inferred from text order. ' +
      'It is the newest of three drafts made within 21 hours — "Alma Group Set Menu Packages.pdf" (4 Aug 10:28, id:x4KPThkyLiAAAAAAAAD78Q) → "Set Menu Pack 5:8.pdf" (4 Aug 16:50, id:x4KPThkyLiAAAAAAAAD78g) → this one (5 Aug 07:20) — ' +
      'and the only one with N markers, the whole-table line and the "one drink at a time" clause (discovery/05 §4.3). The filename says "review"; none of the three is on the website, ' +
      'whose functions PDF carries only the summary tiers. Medium confidence: approval status is unknown (plan §5.1).'
  },
  review: [
    'Approval: the source is a draft named "review"; confirm the tiers (Grazing 49 / Feasting 79 / Bottomless 99) and their courses before publishing. The 4 Aug draft called the 79 tier "Trust the chef" and gave Bottomless a short-rib-and-sides menu.',
    'Cover: the source has no cover or document title (each page is headed "ALMA AVALON · ST ALMA" and a tier name). The menu name "Set menu packages" is used as the printed heading; the template adds the group mark, its tagline and a generated contents line ("GRAZING 2 · FEASTING 3 · BOTTOMLESS 4").',
    'Course sections are LIST type (names only), so the garnish lines stored in each item\'s description ("corn chips, salsa macha, tostadas") do not print on the functions template today; switch a section to STANDARD to print them (prices are blank, so each row then warns STANDARD_NO_PRICE).',
    'Dietary codes: only N is printed on the source; the footer\'s legend lists N · DF · GF · V · VG but the generated legend shows the codes in use (N). Kingfish ceviche, barramundi and snapper carry no A/I origin on the source, so isSeafood is left false rather than invent an origin tag.',
    'On arrival: the source prints a sentence ("Start the table with a cocktail or margarita +$12 pp. Prosecco +$10 pp, or Champagne +$20 pp."); it is carried as three priced rows, the "+" is not printed by the template, and the Grazing page keeps "Start the table with" as the lead-in.',
    'Bottomless page: "LUNCH ONLY, 12PM TO 4PM · UP TO 19 GUESTS" prints as an italic text line rather than a caps label; the two-hour clause and the drinks inclusions print as a text block under "Bottomless, for two hours".',
    'Bottomless drinks differ by document (A5 cards vs this pack vs the functions menu — discovery/05 §4.10); this pack says Classic and jalapeño margaritas, Prosecco, Corona, house Riesling and Pinot Noir.',
    'The footer\'s group terms (groups of 8 or more, no split bills) are in conditions; the surcharge sentence is inside the same line, so surchargeLine is empty.'
  ],
  document
};
