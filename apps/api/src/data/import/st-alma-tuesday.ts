/**
 * St Alma — the Taco Tuesday card, as an import spec.
 *
 * Transcribed from the extracted text of "St Alma - Food Tuesday 13:7.pdf"
 * (Dropbox /Family Room/Indesign, 13 Jul 2026; discovery/05 §2.7): the
 * venue's à la carte with the tacos at 5 each "every Tuesday", six dishes left
 * off, and a "Try them all 20" taco board added to the Trust our chef band.
 * One A4 page on the existing St Alma food template, so the sheet grammar is
 * the live à la carte's (apps/api/src/data/menu-seed-content.ts).
 *
 * Mapping:
 *   Tacos          HEADER_PRICED, suffix "5 each · every Tuesday", left column;
 *                  names carry the garnish as the live sheet prints them
 *                  (the renderer prints names only in a priced-heading section)
 *   To start       left · From the grill, Sides right · Sweet full width
 *   Trust our chef SET_MENUS full width, three tiers plus "Try them all" 20
 *   footer         dietary note and surcharge as printed; the legend is generated
 *
 * Prices are the July 2026 level (the Sep 2026 sheet is +$1 on most dishes);
 * see `review`.
 */
import { makeReferenceBuilders } from './reference-builders.js';
import type { MenuImportSpec } from './types.js';

const b = makeReferenceBuilders('fwt');

const sections = [
  b.section({
    page: 1,
    title: 'Tacos',
    type: 'HEADER_PRICED',
    headerSuffix: '5 each · every Tuesday',
    placement: 'LEFT',
    items: [
      b.item({ name: 'Chorizo & potato, refried beans, tomatillo salsa', tags: ['GF', 'DF'] }),
      b.item({ name: 'Barramundi, guacamole, pickled cabbage, chipotle aioli', tags: ['GFA', 'DF', 'A'], seafood: true }),
      b.item({ name: 'Beef birria, morita salsa, crispy chickpeas', tags: ['GF', 'DF'] }),
      b.item({ name: 'Nopal, avocado salsa, fried potato', tags: ['VG', 'GF', 'DF', 'N'] })
    ]
  }),
  b.section({
    page: 1,
    title: 'To start',
    placement: 'LEFT',
    items: [
      b.item({ name: 'Guacamole', tags: ['VG', 'GFA', 'DF', 'N'], price: 16, description: 'Salsa macha, tostadas' }),
      b.item({ name: 'Kingfish ceviche', tags: ['GF', 'DF', 'A'], seafood: true, price: 32, description: 'Apple, cucumber, strawberry & basil aguachile, roe' }),
      b.item({ name: 'Chicken tinga empanadas', tags: ['GFA', 'DF'], price: 21, description: 'Morita salsa, pickled onions, three pieces' })
    ]
  }),
  b.section({
    page: 1,
    title: 'From the grill',
    placement: 'RIGHT',
    items: [
      b.item({ name: 'Grilled snapper', tags: ['GF', 'A'], seafood: true, price: 39, description: 'Chipotle and cauliflower purée, fennel and green apple pico' }),
      b.item({ name: 'Agave beef short rib', tags: ['GF', 'DF'], price: 48, description: 'Grilled cos, pickled carrots, tortillas' }),
      // The live sheet prints the kitchen note on the description line; the seed keeps it there too.
      b.item({ name: 'Roasted cabbage', tags: ['VG', 'GF', 'N'], price: 32, description: 'Pepita mole, shishito peppers · allow 30 minutes' })
    ]
  }),
  b.section({
    page: 1,
    title: 'Sides',
    placement: 'RIGHT',
    items: [
      b.item({ name: 'Polenta and Parmesan fries', tags: ['V', 'GFA'], price: 18, description: 'Chipotle aioli' }),
      b.item({ name: 'Green leaf salad', tags: ['V', 'GF', 'DF', 'N'], price: 16, description: 'Roasted hazelnut, orange segments, citrus vinaigrette' }),
      b.item({ name: 'Broccolini', tags: ['VG', 'GF', 'DF', 'N'], price: 19, description: 'Almond mole' })
    ]
  }),
  b.section({
    page: 1,
    title: 'Sweet',
    placement: 'FULL',
    items: [b.item({ name: 'Churros', tags: ['V', 'N'], price: 18, description: 'Almond and white chocolate ganache, ice cream' })]
  }),
  b.section({
    page: 1,
    title: 'Trust our chef',
    type: 'SET_MENUS',
    placement: 'FULL',
    subheading: 'For the whole table.',
    items: [
      b.item({ name: 'Grazing', price: 49, unit: 'pp', description: 'A lighter spread to start and share.' }),
      b.item({ name: 'Feasting', price: 79, unit: 'pp', description: 'The full table feast, chosen by the kitchen.' }),
      b.item({ name: 'Agave pairing', price: 45, unit: 'pp', description: 'A flight or matched pours.' }),
      // A flat 20 for the board, not per person.
      b.item({ name: 'Try them all', price: 20, description: "One of each, the whole taco board. Swap any for the day's special." })
    ]
  })
];

const document = b.document({
  heading: 'Taco Tuesday',
  pageCount: 1,
  dietaryNote: 'Dietaries catered with notice. Please advise your server of any allergies.',
  // As extracted: the card's line has no full stop (the Sep 2026 sheet's does).
  surchargeLine: 'A surcharge of 10% applies on weekends and 15% on public holidays',
  sections
});

export const ST_ALMA_TUESDAY_IMPORT: MenuImportSpec = {
  venueSlug: 'st-alma',
  kind: 'FOOD',
  templateKey: 'freshwater_alacarte',
  name: 'Tuesday',
  slug: 'tuesday',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: '/Family Room/Indesign/St Alma - Food Tuesday 13:7.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAD7ug',
    modifiedAt: '2026-07-13T13:42:00Z',
    notes:
      'Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.7); the file could not be downloaded or rendered in this sandbox. ' +
      'It is the newest of three Tuesday cards (30:6:26 → 30:6 → 13:7) and the only St Alma one; Avalon\'s equivalent promotion is Taco & Margarita Wednesdays. ' +
      'High confidence as the Tuesday card itself; its prices are the July 2026 level, one bump behind the Sep 2026 à la carte (St Alma Food SCREEN.pdf, +$1 on most dishes).'
  },
  review: [
    'Prices are the July 2026 level. The Sep 2026 à la carte is +$1 on every priced dish here (Guacamole 17, Kingfish ceviche 33, Chicken tinga empanadas 22, Grilled snapper 40, Agave beef short rib 49, Roasted cabbage 33, Polenta and Parmesan fries 19, Green leaf salad 17, Broccolini 20, Churros 19); the Trust our chef tiers (49 / 79 / 45) are unchanged. Decide whether the Tuesday card follows.',
    'Tacos: the card lists each taco with its codes and garnish ("Chorizo & potato (GF · DF) — Refried beans, tomatillo salsa"); on the A4 sheet a priced-heading section prints names only, so the garnish is joined into the name exactly as the live à la carte prints its tacos. The card says "fried potato" (the Sep sheet: "fried potatoes") and "Chorizo & potato" (Sep: "Chorizo and potato").',
    'Trust our chef: four tiers in a band drawn for three — "Try them all" (20, a flat price for the board) wraps to a second row on the current template. Check the preview; the bundle may belong in its own section or on a wider band.',
    'Dishes the Tuesday card leaves off the regular sheet: Prawn tostada, Mushroom carnita empanadas, Grilled octopus, Roast chicken, Roasted baby beetroot, Dairy free pavlova. If Tuesday should instead be a derived variant of the à la carte (plan §5.8), these are the items to hide.',
    'The surcharge line is carried as extracted, without a full stop; the Sep 2026 sheet prints "A surcharge of 10% applies on weekends and 15% on public holidays."',
    'Earlier drafts differ: 30:6 had Cochinita pork / Barramundi / Beef birria / Smoked confit eggplant tacos and a pistachio salad garnish; 30:6:26 a single "Trust our chef 79 pp". The 13:7 card dropped the merchant-fee sentence.'
  ],
  document
};
