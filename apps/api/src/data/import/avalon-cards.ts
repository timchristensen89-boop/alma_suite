/**
 * Alma Avalon — the three A5 table cards (happy hour, bottomless lunch, lunch
 * special), as import specs on the redesigned A5 card template.
 *
 * Sources (Dropbox /Family Room/Indesign/Alma A5 Menu; discovery/05 §2.8–2.10):
 *   happy hour     ALMA_MENU HAPPY HOUR 16:8.pdf (16 Aug 2025) — extracted text
 *   bottomless     ALMA_MENU BOTTOMLESS 18.10.25.pdf (17 Oct 2025) — byte-
 *                  identical to the website's alma-avalon-bottomless.pdf, whose
 *                  local copy was read with pdftotext for this transcription
 *   lunch special  ALMA_MENU A5 LUNCH SPECIAL 16:1.pdf (16 Jan 2026) — extracted text
 *
 * Mapping (plan §3.6): the title block carries heading, hero price and
 * when-line; price groups with one price in the heading are HEADER_PRICED
 * (names only, which the card runs on in one centred line); inclusions and
 * "select from" groups are LIST; the one priced group is STANDARD; the
 * conditions footer carries the sitting time and the surcharge sentence as the
 * cards print them. The legacy cards' lowercase codes are mapped to MENU_TAGS
 * ("√" = vegan); their merchant-fee line, fish illustration and script
 * sign-off are retired by the template (plan §3.6). Nothing here is invented;
 * what the owner must confirm is under `review`.
 */
import { makeReferenceBuilders } from './reference-builders.js';
import type { MenuImportSpec } from './types.js';

const b = makeReferenceBuilders('avc');

const names = (...list: string[]) => list.map((name) => b.item({ name }));

/** The legacy cards' footer sentence, as printed (the merchant-fee sentence that follows it is dropped). */
const LEGACY_SURCHARGE_HOLIDAY = 'Please note, a surcharge of 10% will apply on weekends, and 15% on public holiday.';
const LEGACY_SURCHARGE_HOLIDAYS = 'Please note, a surcharge of 10% will apply on weekends, and 15% on public holidays.';

// ---------------------------------------------------------------------------
// Happy hour
// ---------------------------------------------------------------------------

export const AVALON_HAPPY_HOUR_IMPORT: MenuImportSpec = {
  venueSlug: 'alma-avalon',
  kind: 'PROMOTION',
  templateKey: 'avalon_card_a5',
  name: 'Happy hour',
  slug: 'happy-hour',
  visibility: 'PUBLIC',
  confidence: 'medium',
  source: {
    path: '/Family Room/Indesign/Alma A5 Menu/ALMA_MENU HAPPY HOUR 16:8.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAAxyw',
    modifiedAt: '2025-08-16T01:36:00Z',
    notes:
      'Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.9); the file could not be downloaded or rendered in this sandbox. ' +
      'The only 2025/26 happy-hour PDF; the card prints no venue name but sits in the Alma (Avalon) A5 folder and its .indd is the Alma template. ' +
      'Medium confidence: the hours conflict with two other sources, and ALMA_MENU HAPPY HOUR.indd was edited on 2026-05-22 with no newer PDF exported (discovery/05 §4.8).'
  },
  review: [
    'Hours conflict across sources and need the owner\'s call (plan §5.2): this card and the Jun 2026 Avalon What\'s On sheet say Tue–Thu 5–6pm / Fri–Sun 4–6pm (used here); the Jan 2026 What\'s On page (ALMA_MENU ALLERGENS WHATS ON PAGE 25:1.pdf) says Tue–Fri 5–6pm / Sat & Sun 4–6pm; the website today says Wed–Sun. The 2024 St Alma card said Fri–Sun 3–5pm.',
    'The .indd was edited on 2026-05-22 after this export and the Alma A5 Menu/Happy Hour folder is empty, so a newer card may exist only as an InDesign file.',
    'Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The surcharge sentence is kept as the card words it ("…15% on public holiday."); the house 2026 wording is "A surcharge of 10% applies on weekends and 15% on public holidays."',
    '"Jalapeno" is spelt without the tilde on this card (the bottomless card prints "Jalapeño").',
    'The card prints no venue name; it is imported for Alma Avalon on the strength of its folder and template.'
  ],
  document: b.document({
    heading: 'Happy hour',
    whenLine: 'Tue–Thu · 5–6pm · Fri–Sun · 4–6pm',
    conditions: LEGACY_SURCHARGE_HOLIDAY,
    surchargeLine: '',
    pageCount: 1,
    sections: [
      b.section({ page: 1, title: 'Margaritas', type: 'HEADER_PRICED', headerSuffix: '12', items: names('Classic', 'Jalapeno', "Tommy's", 'Watermelon', 'Sensible') }),
      b.section({ page: 1, title: 'Beer', type: 'HEADER_PRICED', headerSuffix: '8', items: names('Freshwater Brewing Wedge Cerveza', 'Freshwater Brewing Freshie Hazy Pale') }),
      b.section({
        page: 1,
        title: 'Wine',
        type: 'HEADER_PRICED',
        headerSuffix: '8',
        items: names("Atlas 'Eden Valley' Riesling", 'El Desperado Pinot Noir', 'R. Paulazzo Rosé', 'Farina Prosecco')
      })
    ]
  })
};

// ---------------------------------------------------------------------------
// Bottomless lunch
// ---------------------------------------------------------------------------

export const AVALON_BOTTOMLESS_IMPORT: MenuImportSpec = {
  venueSlug: 'alma-avalon',
  kind: 'PROMOTION',
  templateKey: 'avalon_card_a5',
  name: 'Bottomless',
  slug: 'bottomless',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: '/Family Room/Indesign/Alma A5 Menu/Bottomless/ALMA_MENU BOTTOMLESS 18.10.25.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAAzaA',
    hash: 'dropbox-content-hash:3bbb24af028302a6300ded0d7f4011ed44ce53300e309dd8001fc426e31a3a90',
    modifiedAt: '2025-10-17T23:23:00Z',
    notes:
      'Byte-identical to the website\'s alma-web-platform apps/web/public/menus/alma-avalon-bottomless.pdf (Dropbox content hash 3bbb24af…, discovery/05 §0) and to two further Dropbox copies ' +
      '(Alma A5 Menu/Bottomless/ALMA_MENU BOTTOMLESS 18:10.pdf, Alma Food Menu/ALMA_MENU BOTTOMLESS 18:10.pdf). The local copy was read with pdftotext for this transcription and checked against ' +
      'discovery/05 §2.10 and the rendered card in §3b. A5 portrait, InDesign 20.5, document title ALMA_MENU BOTTOMLESS 21:3.indd. High confidence for the content; the days and the drink inclusions are for the owner (plan §5.3).'
  },
  review: [
    'Days and times are not on the card. The when-line "Sat & Sun · 12–4pm" is the website\'s What\'s On text; the Jun 2026 Avalon What\'s On sheet and the Jan 2026 page say Sat & Sun 12–3pm. Confirm.',
    'Drink inclusions differ across documents (discovery/05 §4.10): this card lists Classic, Watermelon and Jalapeño margaritas, Corona and house wines; the set-menu pack says Classic and jalapeño margaritas, Prosecco, Corona, house Riesling and Pinot Noir; the functions menu "margaritas, Coronas and house wine"; the St Alma card four margaritas, R.Paulazzo Rosé and Balter Cerveza.',
    'Dietary codes are mapped from the card\'s lowercase legend to the house codes ("√" read as vegan → VG, "gfa" → GFA, "df" → DF, "n" → N, "v" → V); the generated legend replaces the legacy one. Prawn ceviche, the salmon taco and the barramundi taco carry no A/I origin on the card, so isSeafood is left false rather than invent one.',
    'Section heads: the card prints the five included dishes with no heading and joins courses with "+"; here "Included", "Then" and the lead-in "Choose your tacos" are editorial labels for the template\'s section grammar, not the card\'s words. Rename or clear them if the card should stay label-free.',
    'Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). "2 hour sitting times." and the surcharge sentence are kept as the card words them.',
    'The legacy card\'s fish illustration behind the wordmark and the "Alma loves you x" script sign-off are not reproduced by the template (plan §5.4).'
  ],
  document: b.document({
    heading: 'Bottomless lunch',
    heroPriceCents: 9900,
    heroPriceUnit: 'pp',
    whenLine: 'Sat & Sun · 12–4pm',
    conditions: `2 hour sitting times.\n${LEGACY_SURCHARGE_HOLIDAY}`,
    surchargeLine: '',
    pageCount: 1,
    sections: [
      b.section({
        page: 1,
        title: 'Included',
        type: 'LIST',
        items: [
          b.item({ name: 'Guacamole, wakame, tostadas', tags: ['VG', 'GFA', 'DF'] }),
          b.item({ name: 'Prawn ceviche, aguachile, baby cucumber', tags: ['GF', 'DF'] }),
          b.item({ name: 'Salmon sashimi hard shell taco, pico de gallo, guacachile', tags: ['GFA', 'DF', 'N'] }),
          b.item({ name: 'Halloumi, agave glaze, salsa macha', tags: ['V', 'GF', 'N'] }),
          b.item({ name: 'Chicken tinga empanada, salsa roja', tags: ['GFA', 'DF'] })
        ]
      }),
      b.section({
        page: 1,
        title: 'Select from',
        type: 'LIST',
        lead: 'Choose your tacos',
        items: [
          b.item({ name: 'Beef birria taco, red onion, coriander, salsa verde', tags: ['GF', 'DF'] }),
          b.item({ name: 'Barramundi taco, coleslaw, avocado, chipotle aioli', tags: ['GFA', 'DF'] }),
          b.item({ name: 'Pork belly taco, charred pineapple salsa, guacamole', tags: ['GF', 'DF'] }),
          b.item({ name: 'Zucchini taco, salsa macha, pico de gallo verde', tags: ['VG', 'GF', 'DF', 'N'] })
        ]
      }),
      b.section({ page: 1, title: 'Then', type: 'LIST', items: [b.item({ name: 'Shoestring fries, paprika, chipotle', tags: ['V', 'DF'] })] }),
      b.section({
        page: 1,
        title: 'Bottomless drinks',
        type: 'LIST',
        items: names('Classic Margarita', 'Watermelon Margarita', 'Jalapeño Margarita', 'Corona', 'House Wines')
      })
    ]
  })
};

// ---------------------------------------------------------------------------
// Lunch special
// ---------------------------------------------------------------------------

export const AVALON_LUNCH_SPECIAL_IMPORT: MenuImportSpec = {
  venueSlug: 'alma-avalon',
  kind: 'PROMOTION',
  templateKey: 'avalon_card_a5',
  name: 'Lunch special',
  slug: 'lunch-special',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: '/Family Room/Indesign/Alma A5 Menu/ALMA_MENU A5 LUNCH SPECIAL 16:1.pdf',
    ref: 'id:x4KPThkyLiAAAAAAAAA0aA',
    modifiedAt: '2026-01-16T02:56:00Z',
    notes:
      'Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.8); the file could not be downloaded or rendered in this sandbox. ' +
      'The newest lunch-special PDF (InDesign template ALMA_MENU A5 LUNCH SPECIAL.indd). High confidence for the content as of 16 Jan 2026; the .indd was edited on 2026-02-06 after this export with no newer PDF found (discovery/05 §4.9).'
  },
  review: [
    'The .indd was edited on 2026-02-06 after this PDF; a newer card may exist only as an InDesign file. Check before publishing.',
    'Days and times are not on the card and are left empty. The Jan 2026 Avalon What\'s On page says Saturday & Sunday 12–3pm ("Lunch Special · 49pp"); the 2025 St Alma sheet ran its shared lunch special on Fridays 12–4pm. Confirm whether the special is Avalon-only and when it runs (plan §5 open questions).',
    'The card prints "Classic margarita" and "Sensible margarita" on two lines with no label; the What\'s On pages describe a complimentary margarita or a choice between the two. "To drink" and the lead-in "Choose one" are editorial labels for the template\'s section grammar, not the card\'s words. The card\'s course heads are "Starter", "Shared Main", "Shared Side" and "Add On".',
    'No dietary markers are printed on the card, so no tags are set and the prawn ceviche and fish of the day carry no origin.',
    'Add on: "Chicken tinga empanadas, martajada sauce 7pp" prints as 7 pp; "Guacamole, salsa macha, tostadas 16" is a flat 16.',
    'Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The surcharge sentence is kept as the card words it.'
  ],
  document: b.document({
    heading: 'Lunch special',
    heroPriceCents: 4900,
    heroPriceUnit: 'pp',
    conditions: LEGACY_SURCHARGE_HOLIDAYS,
    surchargeLine: '',
    pageCount: 1,
    sections: [
      b.section({ page: 1, title: 'To drink', type: 'LIST', lead: 'Choose one', items: names('Classic margarita', 'Sensible margarita') }),
      b.section({ page: 1, title: 'Starter', type: 'LIST', items: names('Prawn ceviche, aguachile, baby cucumbers') }),
      b.section({
        page: 1,
        title: 'Shared main',
        type: 'LIST',
        items: names('Fish of the day al pastor, pico de piña, avocado mousse', 'Agave beef short ribs, grilled cos, baby carrots, tortillas')
      }),
      b.section({ page: 1, title: 'Shared side', type: 'LIST', items: names('Shoestring fries, paprika, chipotle aioli', 'Broccolini, pipian molé, pepitas') }),
      b.section({
        page: 1,
        title: 'Add on',
        items: [b.item({ name: 'Guacamole, salsa macha, tostadas', price: 16 }), b.item({ name: 'Chicken tinga empanadas, martajada sauce', price: 7, unit: 'pp' })]
      })
    ]
  })
};
