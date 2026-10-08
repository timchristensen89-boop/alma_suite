/**
 * Alma Avalon — the drinks book, as an import spec.
 *
 * Transcribed from the website's hand-written print sheet
 * (alma-web-platform apps/web/app/print/alma-avalon-drinks/sheets.tsx), which
 * is what rendered the live PDF (apps/web/public/menus/alma-avalon-drinks.pdf,
 * byte-identical to the Dropbox "Alma Avalon Drinks SCREEN.pdf", Sep 2026).
 * Fifteen A5-portrait pages: cover, cocktails ×2, low & no / beer, favourites,
 * on agave, flights, wine note, wine ×2, tequila ×2, mezcal ×2, back page.
 *
 * Mapping (see docs/menus-v2/plan.md §3):
 *   page 1          cover — no sections; heading '' prints the template title "Drinks"
 *   cocktails       STANDARD: name · price · description = ingredients · note = serving note
 *   callouts        section.subheading; page intros and footnotes → TEXT
 *   subgroups       their own STANDARD sections ("Low · lower alcohol")
 *   beer & cider    STANDARD with meta = ABV
 *   favourites      STANDARD groups (prices as printed); team picks carry meta "Tim's pick"
 *   flights         STANDARD: name · price · description = the pours
 *   wine            TABLE with columns 150 mL · 250 mL · Bottle; null = not poured ("·");
 *                   meta = region + the pairing marks ○ △ ◇ the book prints beside it
 *   tequila/mezcal  one STANDARD per producer group: title = house, subheading = house
 *                   intro; items meta = ABV, flags STAFF_PICK for "•"; mezcal description = village
 *
 * Nothing here is invented: every string is the source's, apostrophes and all.
 * What could not be carried (page eyebrows, the cover's hand-set contents
 * line, the back-page lockup) is listed under `review`.
 */
import {
  dishKeySlug,
  MENU_DOCUMENT_DEFAULTS,
  type MenuDocument,
  type MenuItemDocument,
  type MenuItemFlag,
  type MenuSectionDocument,
  type MenuSectionType,
  type MenuTagCode
} from '@alma/shared';
import type { MenuImportSpec } from './types.js';

// ---------------------------------------------------------------------------
// Builders — every field present, already in the shape the zod schema emits
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'avd';

/** "avd-tommy-s-margarita" — minted from the printed name, or from longer text when the name alone repeats. */
function dishKey(text: string): string {
  return `${KEY_PREFIX}-${dishKeySlug(text, 60)}`;
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

type ItemInput = {
  name: string;
  /** Dollars as printed; omitted = no price printed. */
  price?: number;
  description?: string;
  note?: string;
  meta?: string;
  tags?: MenuTagCode[];
  flags?: MenuItemFlag[];
  /** TABLE rows: dollars per column, null = not poured. */
  prices?: Array<number | null>;
  /** What the dish key is minted from when the printed name repeats elsewhere in the book (favourites, mezcal villages). */
  keyText?: string;
};

function item(input: ItemInput): MenuItemDocument {
  return {
    dishKey: dishKey(input.keyText ?? input.name),
    name: input.name,
    description: input.description ?? null,
    priceCents: input.price === undefined ? null : cents(input.price),
    priceUnit: null,
    prices: (input.prices ?? []).map((price) => (price === null ? null : cents(price))),
    meta: input.meta ?? null,
    note: input.note ?? null,
    flags: input.flags ?? [],
    tags: input.tags ?? [],
    isSeafood: false,
    visible: true,
    recipeId: null
  };
}

type SectionInput = {
  page: number;
  title: string;
  type?: MenuSectionType;
  headerSuffix?: string;
  subheading?: string;
  lead?: string;
  body?: string;
  priceColumns?: string[];
  items?: MenuItemDocument[];
};

function section(input: SectionInput): MenuSectionDocument {
  return {
    title: input.title,
    headerSuffix: input.headerSuffix ?? null,
    subheading: input.subheading ?? null,
    sectionType: input.type ?? 'STANDARD',
    placement: 'FULL',
    page: input.page,
    lead: input.lead ?? null,
    body: input.body ?? null,
    priceColumns: input.priceColumns ?? [],
    visible: true,
    items: input.items ?? []
  };
}

/** A prose block; paragraphs separated by blank lines. Untitled when the book prints no head over it. */
function text(page: number, body: string, title = '', headerSuffix?: string): MenuSectionDocument {
  return section({ page, title, type: 'TEXT', body, ...(headerSuffix ? { headerSuffix } : {}) });
}

function cocktail(name: string, price: number, ingredients: string, note?: string, tags?: MenuTagCode[]): MenuItemDocument {
  return item({ name, price, description: ingredients, ...(note ? { note } : {}), ...(tags ? { tags } : {}) });
}

function beer(name: string, abv: string, price: number): MenuItemDocument {
  return item({ name, meta: abv, price });
}

/** A favourites-page row: the same drink as elsewhere in the book, so the key is scoped to the page. */
function favourite(name: string, price: number): MenuItemDocument {
  return item({ name, price, keyText: `favourite ${name}` });
}

/** A name-and-note row the book prints without a price (the agave guide, the team's picks); the key is scoped to its list. */
function unpriced(scope: string, name: string, description: string, meta?: string): MenuItemDocument {
  return item({ name, description, ...(meta ? { meta } : {}), keyText: `${scope} ${name}` });
}

function flight(name: string, price: number, pours: string): MenuItemDocument {
  return item({ name, price, description: pours });
}

const WINE_COLUMNS = ['150 mL', '250 mL', 'Bottle'];

/** A wine row: vintage and name as printed, region plus the book's pairing marks as the detail, three price columns. */
function wine(name: string, region: string, marks: string, glass150: number | null, glass250: number | null, bottle: number | null): MenuItemDocument {
  return item({ name, meta: `${region} ${marks}`, prices: [glass150, glass250, bottle] });
}

const PICK: MenuItemFlag[] = ['STAFF_PICK'];

function tequila(name: string, abv: string, price: number, pick = false): MenuItemDocument {
  return item({ name, meta: abv, price, ...(pick ? { flags: PICK } : {}) });
}

/**
 * A mezcal row: the village prints under the name. Brands repeat across agave
 * groups and villages, so the key carries the group and village (and the ABV
 * where even that repeats).
 */
function mezcal(group: string, name: string, abv: string, village: string, price: number, pick = false, keySuffix?: string): MenuItemDocument {
  // "Other mezcal" villages already begin with the agave ("Cuishe, Santa María Zoquitlán").
  const keyText = [name, group === 'Other mezcal' ? '' : group, village, keySuffix ?? ''].filter(Boolean).join(' ');
  return item({ name, meta: abv, description: village, price, keyText, ...(pick ? { flags: PICK } : {}) });
}

const PAIRING_KEY = '○ Seafood and ceviche · △ Rich and grilled · ◇ Vegetables and cheese';

// ---------------------------------------------------------------------------
// The book, page by page
// ---------------------------------------------------------------------------

const sections: MenuSectionDocument[] = [
  // ---- P2 · Cocktails · Mexican classics ----------------------------------
  section({
    page: 2,
    title: 'Mexican classics',
    subheading: 'The ones we make most, and the ones we would order first.',
    items: [
      cocktail('Classic Margarita', 23, 'El Tequileño Tequila, Alma’s Triple Sec, Lime', 'Sharp, cold and salted. The house standard everything else is measured against'),
      cocktail('Tommy’s Margarita', 23, 'El Tequileño Tequila, Agave, Lime', 'No liqueur, just agave. On the rocks, made famous at Tommy’s in San Francisco'),
      cocktail('Jalapeño Margarita', 23, 'Jalapeño-infused El Tequileño Tequila, Alma’s Triple Sec, Lime', 'Green heat that builds slowly, never scorches'),
      cocktail('Watermelon Margarita', 23, 'El Tequileño Tequila, Watermelon, Agave, Lime', 'The long lunch order, all summer'),
      cocktail('Coconut Margarita', 23, 'Coconut-washed El Tequileño Tequila, Cacao Blanco, Citrus', 'Rounder and softer, under a cloud of coconut foam'),
      cocktail('Paloma', 23, 'El Tequileño Tequila, Grapefruit, Fresh Lime, Soda', 'Long, bitter and easy. What Mexico actually drinks'),
      cocktail('Mezcal Tommy’s', 24, 'Aguas Mansas Mezcal, Agave, Lime', 'The Oaxacan cousin, smoke where the sweetness was'),
      cocktail('Mezcalita', 24, 'Aguas Mansas Mezcal, Alma’s Triple Sec, Lime', 'A margarita with the lights turned down')
    ]
  }),
  text(2, 'All margaritas available spicy on request.'),

  // ---- P3 · Cocktails · Seasonal + Classic --------------------------------
  section({
    page: 3,
    title: 'Seasonal cocktails',
    subheading: 'What the bar is playing with right now. These change with the produce.',
    items: [
      cocktail('Beach, Please', 23, 'Manly Spirits Vodka, Licor 43, Falernum, Rosé, Watermelon', 'Pale pink, barely sweet, made for a warm afternoon', ['N']),
      cocktail('Zest I Ever Had', 23, 'Ron Santiago de Cuba Rum, Mandarin, Licor 43, Green Apple', 'Citrus forward and lifted, finishes crisp'),
      cocktail('Ginger Spice', 23, 'Aguas Mansas Mezcal, Ginger, Chilli, Citrus', 'Smoke and heat together, the most savoury drink we make')
    ]
  }),
  section({
    page: 3,
    title: 'Classic cocktails',
    items: [
      cocktail('Classic Daiquiri', 23, 'Ron Santiago de Cuba Rum, Lime, Sugar', 'Three ingredients, nowhere to hide'),
      cocktail('Espresso Martini', 23, 'Manly Spirits Vodka, Coffee Liqueur, Cold Drip Coffee', 'Cold drip, so it stays bitter rather than sweet', ['DF']),
      cocktail('Negroni', 25, 'Manly Spirits Dry Gin, Campari, Sweet Vermouth', 'Stirred down, served over one big rock')
    ]
  }),
  // The book's "N contains nuts · DF dairy free" footnote is the generated tag legend — not typed.

  // ---- P4 · Low & no · Beer & cider · Soft drinks -------------------------
  section({ page: 4, title: 'Low & no', subheading: 'All of the ritual, less of the morning after.' }),
  section({
    page: 4,
    title: 'Low · lower alcohol',
    items: [cocktail('Aperol(ish) Spritz', 21, 'Non-alcoholic orange aperitif, Prosecco, Soda'), cocktail('Mirasol', 21, 'Amaro Montenegro, Prosecco, Soda')]
  }),
  section({
    page: 4,
    title: 'No · alcohol free',
    items: [cocktail('Sensible Margarita', 19, 'Lyre’s Non-Alcoholic Spirits, Citrus'), cocktail('Watermelon Spritz', 19, 'Watermelon, Citrus, Mint, Soda')]
  }),
  section({
    page: 4,
    title: 'Beer & cider',
    subheading: 'Cold, Mexican and local. Perfect alongside tacos.',
    items: [
      beer('Corona', '4.5%', 12),
      beer('Modelo Especial', '4.4%', 15),
      beer('Balter Cerveza', '4.0%', 12),
      beer('Balter XPA', '5.0%', 12),
      beer('Stone & Wood Pacific Ale', '4.4%', 13),
      beer('Batlow Cloudy Apple Cider', '4.2%', 12),
      beer('Heaps Normal Quiet XPA', '<0.5%', 10),
      beer('Heaps Normal Another Lager', '<0.5%', 10)
    ]
  }),
  text(4, 'Soft drinks available, just ask the team.', 'Soft drinks'),

  // ---- P5 · Our favourites · Can't decide? --------------------------------
  text(5, 'Start here. Three pours we would order ourselves, at each part of the night.', 'Can’t decide?'),
  section({
    page: 5,
    title: 'Before dinner',
    subheading: 'Bright and citrus-led, made to open the palate.',
    items: [favourite('Classic Margarita', 23), favourite('Beach, Please', 23), favourite('Paloma', 23)]
  }),
  section({
    page: 5,
    title: 'With food',
    subheading: 'Enough structure to hold their own against the kitchen.',
    items: [favourite('Tommy’s Margarita', 23), favourite('Gotas de Mar, Albariño', 19), favourite('Fortaleza Blanco', 21)]
  }),
  section({
    page: 5,
    title: 'After dinner',
    subheading: 'A slower, richer after-dinner sipper.',
    items: [favourite('Espresso Martini', 23), favourite('Negroni', 25), favourite('El Tequileño 1959 Añejo', 25)]
  }),
  section({
    page: 5,
    title: 'The team’s agave picks',
    items: [
      unpriced('team pick', 'Arette Blanco', 'Clean, peppery and easygoing, the workhorse blanco that lifts any margarita.', 'Tim’s pick'),
      unpriced('team pick', 'Código 1530 Rosa', 'Delicate floral notes, faint hints of vanilla and red fruit.', 'Dirk’s pick'),
      unpriced('team pick', 'Fortaleza Blanco', 'Stone oven and tahona made, rich and savoury, a cult sipper.', 'Caio’s pick')
    ]
  }),
  text(5, 'Not sure? Tell us what you like and we will point you somewhere good.'),

  // ---- P6 · On agave --------------------------------------------------------
  text(
    6,
    'This is the heart of what we do. Tequila and mezcal, more than eighty of them, chosen one bottle at a time. You do not need to know any of it to enjoy it. Tell us what you like and we will point you somewhere good. If you want to find your own way, we have marked our favourites, mine included, though it is hard to go wrong.',
    'On agave'
  ),
  section({
    page: 6,
    title: 'When to sip',
    items: [
      unpriced('when to sip', 'To begin', 'a crisp blanco or a paloma, something bright to open the palate before you eat.'),
      unpriced('when to sip', 'Through the meal', 'a classic margarita or a reposado on the rocks, fruit and gentle spice that hold their own against the kitchen.'),
      unpriced('when to sip', 'To finish', 'an añejo or an extra añejo, neat and unhurried, the way you would treat a good whisky.'),
      unpriced('when to sip', 'When you want smoke', 'mezcal at room temperature, small pours, sipped not shot.'),
      unpriced('when to sip', 'Any time', 'a well-made blanco never puts a foot wrong.')
    ]
  }),
  section({
    page: 6,
    title: 'Start here',
    items: [
      unpriced('start here', 'El Tequileño 1959 Platinum', 'The house pour behind our margaritas, bright and friendly.'),
      unpriced('start here', 'G4 Reposado', 'Oak and warmth without the heat, the one that makes sense of reposado.'),
      unpriced('start here', 'Aguas Mansas', 'A soft espadín mezcal, just enough smoke to find out if you like it.')
    ]
  }),
  text(6, 'Take your time. Ask questions. Salud.'),

  // ---- P7 · Tasting flights · Explore Mexico ------------------------------
  text(
    7,
    'Not sure where to begin? Our tasting flights take you through the styles of tequila and mezcal, from bright, citrus-driven blancos to rich extra añejos and smoky mezcals.',
    'Explore Mexico'
  ),
  section({
    page: 7,
    title: 'Tasting flights',
    items: [
      flight('Discover El Tequileño 1959', 46, 'El Tequileño Platinum, Gran Reserva, Reposado Rare, Añejo'),
      flight('Blanco, the essence of agave', 39, 'Fortaleza Blanco, G4 Blanco, Cascahuín Blanco, Tres Agaves Blanco'),
      flight('Añejo, the art of ageing', 47, 'G4 Añejo, Don Julio Añejo, Herradura Añejo, Patrón Añejo'),
      flight('Espadín agave, the mezcalero’s choice', 41, 'Nuestra Soledad San Baltazar Guelavila & San Luis del Río, Koch Ancestral Espadín, Ilegal Mezcal Reposado'),
      flight('Mezcal agave complexity', 45, 'Koch Ancestral Espadín, Origen Raíz Cenizo, Machetazo Cupreata, Koch Tepextate'),
      flight('Rare finds', 86, 'Herradura Suprema Extra Añejo, El Jolgorio Mexicano & Espadín, El Tequileño 1959 Reposado Rare')
    ]
  }),
  text(7, 'Four 15 mL pours, chosen by our team. Ask us which flight best suits your meal.\n\nFull tequila list page 11, mezcal page 13.'),

  // ---- P8 · A note on our wine ----------------------------------------------
  text(
    8,
    [
      'Wine should feel generous, relaxed and made to share. A good glass can capture the character of the land, elevate the meal in front of you, and lift the mood of the table it lands on.',
      'Our list has been shaped by people who genuinely love wine, with Austin bringing a real point of view, and Cal from Clarity Cru and Greg from Joval guiding us toward bottles we would never have found on our own. It is designed to sit beside the coastal Mexican food we serve. Bright whites, textural styles, crisp rosé and juicy reds, each picked to match everything from fresh ceviche and tacos to grilled meats and smoky spice.',
      'A considered list with something for every mood and table. Ask the team if you’d like a recommendation. We are always happy to help you find the right glass or bottle.',
      'Welcome to Alma Avalon, and salud.',
      'Tim Christensen\nFounding Director Alma Group'
    ].join('\n\n'),
    'A note on our wine'
  ),
  text(8, PAIRING_KEY, 'Pairing guide'),

  // ---- P9 · Wine · White & Bubbles -----------------------------------------
  section({
    page: 9,
    title: 'White',
    type: 'TABLE',
    subheading: 'Poured to 150 or 250 mL, or by the bottle. Everything open is worth a taste first, just ask.',
    priceColumns: WINE_COLUMNS,
    items: [
      wine('2024 Moments of Clarity, Riesling', 'Eden Valley, SA', '○', 16, 26, 73),
      wine('2024 Frogmore Creek, Riesling', 'Coal River, TAS', '○', null, null, 93),
      wine('2024 Gotas de Mar, Albariño', 'Rías Baixas, ESP', '○', 19, 31, 86),
      wine('2024 Catalina Sounds ‘Sound of White’, Sauvignon Blanc', 'Marlborough, NZ', '○ ◇', 17, 27, 77),
      wine('2024 i Lauri ‘AVALOS’, Pecorino', 'Abruzzo, ITA', '○', null, null, 81),
      wine('2023 Shut The Gate ‘For Freedom’, Gewürztraminer', 'Clare Valley, SA', '◇', null, null, 76),
      wine('2023 Greystone, Pinot Gris', 'Waipara, NZ', '◇', 18, 29, 83),
      wine('2022 Stéphane Brocard Mâcon-Villages, Chardonnay', 'Burgundy, FRA', '○ ◇', 26, 41, 111),
      wine('2024 Ingram Road, Chardonnay', 'Yarra Valley, VIC', '◇', 16, 26, 73),
      wine('2023 Kendall Jackson ‘Vintner’s Reserve’, Chardonnay', 'Napa Valley, USA', '△', null, null, 106)
    ]
  }),
  section({
    page: 9,
    title: 'Bubbles',
    type: 'TABLE',
    priceColumns: WINE_COLUMNS,
    items: [
      wine('NV Serenello Prosecco, Glera', 'Veneto, ITA', '○', 16, null, 76),
      wine('NV Taittinger Brut Réserve, Chardonnay Pinot Noir Pinot Meunier', 'Champagne, FRA', '○', 28, null, 161),
      wine('NV Taittinger Brut Réserve 375 mL', 'Champagne, FRA', '○', null, null, 95)
    ]
  }),
  text(9, PAIRING_KEY),

  // ---- P10 · Wine · Rosé & Red ---------------------------------------------
  section({
    page: 10,
    title: 'Rosé',
    type: 'TABLE',
    priceColumns: WINE_COLUMNS,
    items: [
      wine('2024 R. Paulazzo Rosé, Pinot Noir', 'Riverina, NSW', '○', 16, 26, 73),
      wine('2024 La Belle ‘Colette’ Rosé, Shiraz Grenache Mourvèdre Cinsault', 'Provence, FRA', '○ ◇', 18, 29, 83)
    ]
  }),
  section({
    page: 10,
    title: 'Red',
    type: 'TABLE',
    subheading: 'Nothing here is heavy for the sake of it. Ask for the Pinot lightly chilled.',
    priceColumns: WINE_COLUMNS,
    items: [
      wine('2025 El Desperado, Pinot Noir', 'Adelaide Hills, SA', '△', 16, 26, 73),
      wine('2024 Domaine Thomson ‘Explorer’, Pinot Noir', 'Central Otago, NZ', '△', null, null, 89),
      wine('2023 Helen’s Hill ‘The Smuggler’, Pinot Noir', 'Yarra Valley, VIC', '△', null, null, 126),
      wine('2022 Capa Single Vineyard, Tempranillo', 'Castilla La Mancha, ESP', '△', 16, 26, 73),
      wine('2022 Villa Albergotti Chianti Superiore, Sangiovese', 'Tuscany, ITA', '△', 18, 29, 83),
      wine('2023 Teusner ‘Avatar’, Grenache Shiraz Mataro', 'Barossa Valley, SA', '△', null, null, 96),
      wine('2022 BenMarco ‘Valle de Uco’, Malbec', 'Mendoza, ARG', '△', 21, 33, 93),
      wine('2017 Geoff Merrill ‘Jacko’s’, Shiraz', 'McLaren Vale, SA', '△', null, null, 89),
      wine('2023 Teusner ‘Wark Family’, Shiraz', 'Barossa Valley, SA', '△', 17, 27, 77),
      wine('2021 Cannonball, Cabernet Sauvignon', 'Sonoma Valley, USA', '△', null, null, 106)
    ]
  }),
  text(10, PAIRING_KEY),

  // ---- P11 · Tequila · The highlands ----------------------------------------
  text(
    11,
    'Prices shown are for 30 mL. Every agave is also available as a 15 mL half pour.\n\nBlanco is unaged and bright with green agave. Reposado rests in oak for a softer, spiced edge. Añejo ages longer again for caramel and vanilla. Start light and work up.',
    'Tequila',
    'The highlands'
  ),
  section({
    page: 11,
    title: 'El Pandillo',
    subheading: 'Felipe Camarena’s highland distillery in Arandas. Hand built tahona, bright mineral agave.',
    items: [
      tequila('ArteNOM 1579', '40.7%', 20),
      tequila('G4 Blanco', '40%', 18, true),
      tequila('G4 Reposado', '40%', 21, true),
      tequila('G4 Añejo', '40%', 33, true),
      tequila('Terralta Blanco', '40%', 19),
      tequila('Pasote Blanco', '40%', 24)
    ]
  }),
  section({
    page: 11,
    title: 'Arette de Jalisco',
    subheading: 'Made at El Llano in Tequila town. Peppery, clean, the workhorse blanco.',
    items: [tequila('Arette Blanco', '40%', 13, true), tequila('Arette Reposado', '40%', 15, true), tequila('Arette Suave Artesanal Blanco', '38%', 23, true)]
  }),
  section({
    page: 11,
    title: 'Grupo Tequilero',
    subheading: 'A small Jalisco house working with organic agave. Unusually delicate.',
    items: [tequila('Alquimia Blanco', '40%', 22)]
  }),
  section({
    page: 11,
    title: 'Jorge Salles Cuervo y Sucesores',
    subheading: 'El Tequileño, the house pour behind our margaritas.',
    items: [
      tequila('El Tequileño 1959 Platinum', '40%', 16),
      tequila('El Tequileño 1959 Gran Reserva Reposado', '40%', 17, true),
      tequila('El Tequileño 1959 Añejo', '40%', 25),
      tequila('El Tequileño 1959 Reposado Rare', '40%', 49)
    ]
  }),
  section({
    page: 11,
    title: 'Hacienda Capellanía',
    subheading: 'Calle 23, made by a French biochemist. Precise and very clean.',
    items: [tequila('Calle 23 Blanco', '40%', 13), tequila('Calle 23 Reposado', '40%', 15)]
  }),
  section({
    page: 11,
    title: 'Varo Destilería',
    subheading: 'Código, rested briefly in Napa cabernet barrels for its blush.',
    items: [tequila('Código 1530 Rosa Blanco', '35%', 23, true)]
  }),

  // ---- P12 · Tequila · The lowlands, estates & houses ----------------------
  section({
    page: 12,
    title: 'Tequila Cascahuín',
    subheading: 'Third generation lowland house in El Arenal. Cooked agave and soft spice.',
    items: [
      tequila('Cascahuín Blanco', '38%', 15, true),
      tequila('Cascahuín Plata', '48%', 25),
      tequila('Cascahuín Tahona Blanco', '42%', 25),
      tequila('Cascahuín Extra Añejo', '43%', 50)
    ]
  }),
  section({
    page: 12,
    title: 'Hacienda Herradura',
    subheading: 'Made at San José del Refugio since 1870. The lowland classic, rich, baked and earthy.',
    items: [
      tequila('Herradura Plata', '40%', 15),
      tequila('Herradura Reposado', '40%', 17),
      tequila('Herradura Añejo', '40%', 19),
      tequila('Herradura Ultra', '40%', 25),
      tequila('Herradura Suprema Extra Añejo', '40%', 80)
    ]
  }),
  section({
    page: 12,
    title: 'Tequila Tapatío',
    subheading: 'El Tesoro and Tapatío, both tahona crushed, both benchmarks.',
    items: [
      tequila('El Tesoro Blanco', '40%', 22),
      tequila('El Tesoro Reposado', '40%', 23),
      tequila('El Tesoro Añejo', '40%', 25, true),
      tequila('Tapatío Blanco', '40%', 20),
      tequila('Tapatío Reposado', '40%', 22, true)
    ]
  }),
  section({
    page: 12,
    title: 'Tequila Los Abuelos',
    subheading: 'Fortaleza, the Sauza family’s return to old methods. Stone oven and tahona, a cult sipper.',
    items: [tequila('Fortaleza Blanco', '40%', 21, true), tequila('Fortaleza Reposado', '40%', 24, true), tequila('Fortaleza Añejo', '40%', 29, true)]
  }),
  section({
    page: 12,
    title: 'Los Alambiques',
    subheading: 'Ocho, single estate, a different field every year.',
    items: [tequila('Ocho Plata', '40%', 21), tequila('Ocho Reposado', '40%', 22), tequila('Ocho Añejo', '40%', 23), tequila('Ocho Extra Añejo', '40%', 32)]
  }),
  section({
    page: 12,
    title: 'Patrón Spirits México',
    subheading: 'Familiar and consistent, always a safe answer.',
    items: [tequila('Patrón Silver', '40%', 13), tequila('Patrón Reposado', '40%', 15), tequila('Patrón Añejo', '40%', 17), tequila('Patrón El Cielo', '40%', 28, true)]
  }),
  section({
    page: 12,
    title: 'Diageo México',
    subheading: 'Don Julio, the bottle that made sipping tequila normal.',
    items: [tequila('Don Julio Blanco', '38%', 20), tequila('Don Julio Reposado', '38%', 22), tequila('Don Julio Añejo', '38%', 25), tequila('Don Julio 1942', '38%', 38, true)]
  }),
  section({
    page: 12,
    title: 'Other houses',
    subheading: 'Good bottles that do not sit neatly under a family above.',
    items: [
      tequila('Siete Leguas Blanco', '40%', 21),
      tequila('Tromba Blanco', '40%', 15, true),
      tequila('Leyenda del Milagro Blanco', '40%', 15),
      tequila('Tres Agaves', '40%', 14),
      tequila('Batanga Reposado', '40%', 12)
    ]
  }),

  // ---- P13 · Mezcal · Espadín & ensemble ------------------------------------
  text(
    13,
    'Prices shown are for 30 mL, served at room temperature and sipped not shot. Every agave is also available as a 15 mL half pour.\n\nThe village under each name is where it was made, and it matters more than the brand.',
    'Mezcal',
    'Espadín & ensemble'
  ),
  section({
    page: 13,
    title: 'Espadín',
    subheading: 'The workhorse of mezcal and close cousin of the Blue Weber. Roasted agave on the nose, a bright herbaceous palate.',
    items: [
      mezcal('Espadín', 'Aguas Mansas', '45%', 'Santiago Matatlán', 12),
      mezcal('Espadín', 'El Jolgorio', '47.8%', 'San Luis del Río', 31),
      mezcal('Espadín', 'Mezcal Verde', '42%', 'Tlacolula', 14),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'San Luis del Río', 17, true),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'Santiago Matatlán', 16),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'La Compañía, Ejutla', 17),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'San Baltazar Guelavila', 17),
      mezcal('Espadín', 'Siete Misterios Doba Yej', '44%', 'San Dionisio Ocotepec', 15),
      mezcal('Espadín', 'Koch El Mezcal Ancestral', '47.12%', 'Sola de Vega', 19),
      mezcal('Espadín', 'San Cosme Mezcal', '40%', 'Santiago Matatlán', 14),
      // The book continues Espadín in a second column ("Espadín cont."); one section here.
      mezcal('Espadín', 'Origen Raíz Chacaleño', '48%', 'Durango', 23),
      mezcal('Espadín', 'Alipus Mezcal', '42%', 'San Juan del Río', 16, true),
      mezcal('Espadín', 'Alipus Mezcal', '48%', 'San Baltazar Guelavila', 14),
      mezcal('Espadín', 'Ilegal Mezcal Reposado', '40%', 'Tlacolula', 20),
      mezcal('Espadín', 'Quiquiriqui', '45%', 'Santiago Matatlán', 15, true),
      mezcal('Espadín', 'Del Maguey VIDA', '42%', 'San Luis del Río', 17, true),
      mezcal('Espadín', 'Del Maguey Minero', '46%', 'Santa Catarina Minas', 27)
    ]
  }),
  section({
    page: 13,
    title: 'Ensemble',
    subheading: 'Several agave species in one batch, the way mezcal used to be. No two taste the same.',
    items: [
      mezcal('Ensemble', 'Aprendiz', '45%', 'Espadín & Tepextate, San Juan del Río', 25),
      mezcal('Ensemble', 'Bruxo No.4', '46%', 'Espadín, Cuishe & Barril, San Juan del Río', 18, true)
    ]
  }),
  section({
    page: 13,
    title: 'Cenizo',
    subheading: 'High elevation agave from Durango, dominated by tropical fruit.',
    items: [mezcal('Cenizo', 'Lágrimas de Dolores', '47%', 'Durango', 21), mezcal('Cenizo', 'Origen Raíz', '48%', 'Durango', 20, true)]
  }),

  // ---- P14 · Mezcal · Wild agave ---------------------------------------------
  section({
    page: 14,
    title: 'Madrecuishe',
    subheading: 'Tall, cylindrical and floral with a mineral edge. Mother of the cuishe agave.',
    items: [mezcal('Madrecuishe', 'El Jolgorio', '48%', 'Santiago Matatlán', 34, true), mezcal('Madrecuishe', 'Origen Raíz', '48%', 'Santiago Matatlán', 28)]
  }),
  section({
    page: 14,
    title: 'Mexicano',
    subheading: 'Up to 25 years to mature. Green and grassy, through to orange zest and terracotta.',
    items: [mezcal('Mexicano', 'El Jolgorio', '47%', 'La Compañía, Ejutla', 39, true), mezcal('Mexicano', 'Koch El Mezcal', '46.98%', 'Río de Ejutla', 19)]
  }),
  section({
    page: 14,
    title: 'Tepextate',
    subheading: 'Overarching minerality, reflecting the volcanic earth it grows on.',
    items: [mezcal('Tepextate', 'El Jolgorio', '48%', 'San Luis del Río', 52), mezcal('Tepextate', 'Koch El Mezcal', '46.3%', 'Santa María Zoquitlán', 19)]
  }),
  section({
    page: 14,
    title: 'Arroqueño',
    subheading: 'The genetic mother of espadín. Fruity, herbaceous and smoky.',
    items: [
      mezcal('Arroqueño', 'El Jolgorio', '55%', 'Miahuatlán', 36, true, '55'),
      mezcal('Arroqueño', 'El Jolgorio', '52%', 'Miahuatlán', 55, false, '52'),
      mezcal('Arroqueño', 'Koch El Mezcal', '47.13%', 'Río de Ejutla', 19)
    ]
  }),
  section({
    page: 14,
    title: 'Other mezcal',
    subheading: 'Assorted and singular. Try a few together, and ask to see the bottle.',
    items: [
      mezcal('Other mezcal', 'El Jolgorio', '47%', 'Cuishe, Santa María Zoquitlán', 33, true),
      mezcal('Other mezcal', 'El Jolgorio', '52%', 'Tobasiche, La Compañía, Ejutla', 50, true),
      mezcal('Other mezcal', 'El Jolgorio', '50.2%', 'Tobasiche, El Palmar', 48),
      mezcal('Other mezcal', 'El Jolgorio', '50.3%', 'Jabalí, Santa María Zoquitlán', 59),
      mezcal('Other mezcal', 'El Jolgorio', '50.3%', 'Sierrudo, Santiago Matatlán', 44),
      mezcal('Other mezcal', 'El Jolgorio', '48%', 'Espadín Pechuga, Santiago Matatlán', 54, true),
      mezcal('Other mezcal', 'Mezcal Machetazo', '45%', 'Cupreata, Guerrero', 15)
    ]
  }),

  // ---- P15 · Back page --------------------------------------------------------
  // The Avalon lockup and the arch are drawn by the template family, not typed.
  text(15, '47 Old Barrenjoey Road, Avalon Beach\n\nStart with snacks. Add tacos. Order another margarita.')
];

const document: MenuDocument = {
  ...MENU_DOCUMENT_DEFAULTS,
  // '' prints the template's own title, "Drinks", on the cover.
  heading: '',
  pageCount: 15,
  dietaryNote: '',
  // The cover's conditions line (also printed on the back page).
  surchargeLine: 'A surcharge of 10% applies on weekends and 15% on public holidays. Wine vintages may be subject to change.',
  sections
};

export const AVALON_DRINKS_IMPORT: MenuImportSpec = {
  venueSlug: 'alma-avalon',
  kind: 'DRINKS',
  templateKey: 'avalon_drinks_book',
  name: 'Drinks',
  slug: 'drinks',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: 'alma-web-platform/apps/web/app/print/alma-avalon-drinks/sheets.tsx',
    ref: '6115001',
    hash: 'sha256:ac56be95bd07ce232d822620c7bae75b0ee5b952f13528e20505de9e19071c6e',
    modifiedAt: '2026-09-24T15:36:16+00:00',
    notes:
      'Transcribed from the hand-written JSX that renders the live website PDF (apps/web/public/menus/alma-avalon-drinks.pdf), ' +
      'which is byte-identical to the Dropbox reference "Alma Avalon Drinks SCREEN.pdf" (Sep 2026; discovery/05 §3c). ' +
      'Every page of the 15-page book was checked against the inventory in discovery/05 §3c and 04 §2.2. ' +
      'The sheet was last changed in alma-web-platform commit ea1e2a8 ("final pre-print polish", no content changes).'
  },
  review: [
    'Cover: the book prints "Drinks" with "Menu" beneath it (36 px, 72 % ink). The subheading is left empty per the import defaults; set document.subheading to "Menu" to reproduce the lockup — the template\'s t-sub slot has those metrics.',
    'Cover contents line: the template generates it from the first titled section of each page, so it will not read like the book\'s hand-set "Cocktails 2 · Agave & flights 6 · Wine 8 · Tequila 11 · Mezcal 13" until the renderer offers a curated line.',
    'Page eyebrows ("Cocktails", "Low & No · Beer & Cider", "Our favourites", "On agave", "Tasting flights", "Wine · White", "Wine · Rosé & Red", "Tequila · The highlands", "Tequila · The lowlands, estates & houses", "Mezcal · Espadín & ensemble", "Mezcal · Wild agave") have no slot: the template\'s running head prints the venue tagline. On pages 11 and 13 the eyebrow became the title and suffix of the page-intro text block ("Tequila / The highlands", "Mezcal / Espadín & ensemble"); elsewhere it is dropped.',
    'Page 4: the "Low & no" head and its callout are kept as a section with no items above the two subgroup sections ("Low · lower alcohol", "No · alcohol free"), which print as full section heads rather than the book\'s small subgroup labels.',
    'Page 5: each favourites group\'s closing italic line ("Bright and citrus-led, made to open the palate." etc.) sits in the section subheading, so it prints above the three names rather than below them as in the book. The "Can\'t decide?" page title and its note are a text block.',
    'Pages 5–6: "When to sip", "Start here" and "The team\'s agave picks" carry no prices (none are printed), so validation warns STANDARD_NO_PRICE for those 11 items; acknowledge at publish.',
    'Pages 8–10: the pairing marks ○ △ ◇ are appended to each wine\'s region (meta) and the pairing key is typed as a text block on pages 8, 9 and 10, because the template generates legends only for dietary tags and the •/** flags. The book separates the key\'s three entries with wide spaces; here " · ".',
    'Page 9: the book prints one column header over White and Bubbles; here Bubbles prints its own.',
    'Page 13: the book splits Espadín across two columns ("Espadín cont."); here it is one 17-row section.',
    'Pages 11–14: the book sets tequila and mezcal in two dense columns (10 px rows) with a "• Staff pick" legend on each page; the template prints one column and the marks legend on the cover and back page only — check the fill probe for overflow before publishing.',
    'Page 15: the back page\'s Avalon lockup and arch are not typed; the address and "Start with snacks…" line are a text block, and the surcharge prints from the generated footer.'
  ],
  document
};
