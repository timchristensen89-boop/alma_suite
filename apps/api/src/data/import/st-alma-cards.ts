/**
 * St Alma — the A5 bottomless card, as an import spec.
 *
 * Transcribed from the text of "ST ALMA_MENU A5 BOTTOMLESS.pdf" (Dropbox
 * /Family Room/Indesign/St. Alma, 15 Nov 2025), fetched through the Dropbox
 * connector in this session because discovery/05 §1b only summarises it. It
 * is the newest St Alma bottomless card; the website still serves the 8 Nov
 * 2025 card (ST ALMA_MENU A5 BOTTOMLESS 8:11.pdf == st-alma-bottomless.pdf),
 * which differs in two lines — see `review`.
 *
 * Mapping (plan §3.6, the redesigned A5 family):
 *   title block    heading "Bottomless lunch", hero price 99 pp, when-line
 *                  from the website's What's On (the card prints no days)
 *   Included       LIST — the two courses the card joins with "+"
 *   Select from    LIST — the two mains to choose between
 *   Then           LIST — the sides after the second "+"
 *   Add on         STANDARD — the one priced add-on, 7 pp
 *   Bottomless drinks  LIST — names only
 *   footer         sitting/whole-table line → conditions; allergens → dietaryNote
 *
 * The card prints no dietary codes and no surcharge sentence; neither is
 * invented here. The legacy burgundy ink, script sign-off and merchant-fee
 * line are retired by the template (plan §3.6).
 */
import { makeReferenceBuilders } from './reference-builders.js';
import type { MenuImportSpec } from './types.js';

const b = makeReferenceBuilders('fwc');

const bottomlessSections = [
  b.section({
    page: 1,
    title: 'Included',
    type: 'LIST',
    items: [b.item({ name: 'Guacamole, salsa macha, tostadas' }), b.item({ name: 'Salmon ceviche, citrus aguachile, avocado, pickled cucumbers' })]
  }),
  b.section({
    page: 1,
    title: 'Select from',
    type: 'LIST',
    items: [
      b.item({ name: 'Roast chicken, esquites, salsa macha' }),
      // "pureé" as printed on the card.
      b.item({ name: 'Grilled snapper, chipotle & cauliflower pureé, fennel & green apple pico' })
    ]
  }),
  b.section({
    page: 1,
    title: 'Then',
    type: 'LIST',
    items: [b.item({ name: 'Polenta Parmesan fries, chipotle aioli' }), b.item({ name: 'Broccolini, almond mole' })]
  }),
  b.section({
    page: 1,
    title: 'Add on',
    items: [b.item({ name: 'Chicken tinga empanadas, martajada sauce', price: 7, unit: 'pp' })]
  }),
  b.section({
    page: 1,
    title: 'Bottomless drinks',
    type: 'LIST',
    items: [
      b.item({ name: 'Classic Margarita' }),
      b.item({ name: 'Watermelon Margarita' }),
      b.item({ name: 'Jalapeño Margarita' }),
      b.item({ name: 'Spicy Pineapple Margarita' }),
      b.item({ name: 'R.Paulazzo Rosé' }),
      b.item({ name: 'Balter Cerveza' })
    ]
  })
];

export const ST_ALMA_BOTTOMLESS_IMPORT: MenuImportSpec = {
  venueSlug: 'st-alma',
  kind: 'PROMOTION',
  templateKey: 'freshwater_card_a5',
  name: 'Bottomless',
  slug: 'bottomless',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: '/Family Room/Indesign/St. Alma/ST ALMA_MENU A5 BOTTOMLESS.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAAzeQ',
    // Dropbox client_modified (discovery/05 §1b); server_modified is 2026-08-08T21:05:54Z.
    modifiedAt: '2025-11-15T00:29:00Z',
    notes:
      'Text fetched from Dropbox in this session (the inventory in discovery/05 §1b only summarises the card). The newest St Alma bottomless card; a near-identical copy sits in ' +
      'ST ALMA_MENU TEMPLATE Folder/ST ALMA_MENU A5 BOTTOMLESS 15:11.pdf (id:x4KPThkyLiAAAAAAAAAzeA). The website serves the 8 Nov 2025 card instead ' +
      '(St Alma A5 Menus/Bottomless/ST ALMA_MENU A5 BOTTOMLESS 8:11.pdf, id:x4KPThkyLiAAAAAAAAAzUQ, Dropbox content hash 067e93b1…, == alma-web-platform apps/web/public/menus/st-alma-bottomless.pdf), ' +
      'whose text was read from that local copy for comparison. High confidence for the content; which of the two cards is current is for the owner (discovery/05 §4.6).'
  },
  review: [
    'Version: the website serves the 8 Nov 2025 card. This 15 Nov card differs in two lines — "Roast chicken, esquites, salsa macha" (8 Nov: "Roast chicken in adobo, sweet potato, coriander cashew salsa") and "Balter Cerveza" (8 Nov: "Corona") — and words the sitting line "your booking is for a 2 hour sitting" (8 Nov: "you are booked in for a 2 hour sitting"). Confirm which is current before publishing.',
    'Days and times are not on the card. The when-line "Fri–Sun · 12–4pm" is the website\'s What\'s On text (also the Jun 2026 St Alma What\'s On sheet and the Sep 2025 one); confirm.',
    'The card prints no dietary codes (the Avalon card does), so no tags are set and the salmon and snapper carry no origin; add tags in the editor if the card should show them.',
    'The card prints no surcharge sentence; surchargeLine is left empty rather than invented. The template\'s default ("A surcharge of 10% applies on weekends and 15% on public holidays.") is one click away if it should.',
    'Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The allergens sentence is kept as the dietary note with its punctuation normalised ("Dishes may contain traces of allergens. Please advise your server of any allergies.").',
    'Drink inclusions differ across documents (discovery/05 §4.10): this card lists four margaritas, R.Paulazzo Rosé and Balter Cerveza; the Avalon card three margaritas, Corona and house wines; the set-menu pack and functions menu say otherwise again.',
    '"pureé" is spelt as the card spells it.',
    'The legacy St Alma card is set in burgundy with a script sign-off; the redesigned template prints forest ink and no sign-off (plan §5.4).'
  ],
  document: b.document({
    heading: 'Bottomless lunch',
    heroPriceCents: 9900,
    heroPriceUnit: 'pp',
    whenLine: 'Fri–Sun · 12–4pm',
    conditions: 'Please note, your booking is for a 2 hour sitting and your whole table must participate.',
    dietaryNote: 'Dishes may contain traces of allergens. Please advise your server of any allergies.',
    surchargeLine: '',
    pageCount: 1,
    sections: bottomlessSections
  })
};
