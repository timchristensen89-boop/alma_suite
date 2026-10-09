/**
 * St Alma Freshwater — the drinks binder, as an import spec.
 *
 * Transcribed from the website's hand-written print sheet
 * (alma-web-platform apps/web/app/print/st-alma-drinks/sheets.tsx), which is
 * what rendered the live PDF (apps/web/public/menus/st-alma-drinks.pdf,
 * byte-identical to the Dropbox "St Alma Drinks SCREEN.pdf", Sep 2026).
 * Twenty-three A5-landscape cards: cover, cocktails ×3, favourites, low & no,
 * on agave, flights, wine note, wine by the glass ×2, wine by the bottle ×8,
 * tequila ×2, mezcal ×2.
 *
 * Mapping (see docs/menus-v2/plan.md §3 and the lead's brief):
 *   page 1          cover — no sections; heading '' prints the template title "Drinks";
 *                   surchargeLine = the cover's conditions line (surcharge + vintages)
 *   cocktails       STANDARD: name · price · description = ingredients · note = serving
 *                   note · tags N/DF; callouts → section.subheading; footnotes → TEXT
 *   to share        STANDARD, meta "on tap, serves three" as the binder prints it
 *   favourites      STANDARD groups (prices as printed); the page title and its note → TEXT
 *   low & no        one STANDARD per subgroup, titled "Low & no" with the subgroup as headerSuffix
 *   beer & cider    STANDARD with meta = ABV; soft drinks → TEXT
 *   on agave        TEXT essay; the picks → STANDARD with meta "Tim’s pick"; When to sip /
 *                   Start here → STANDARD without prices
 *   flights         STANDARD: name · price · description = the pours
 *   wine note       TEXT (essay + sign-off) and TEXT (pairing guide + the ** line)
 *   by the glass    TABLE with columns 150 mL · 250 mL; sommelier pours and bubbles as
 *                   their own TABLE sections; sweet & fortified with its own columns
 *   by the bottle   one TABLE per style heading, columns ['Bottle']; a page's mood
 *                   labels (Crisp & refreshing …) become the headerSuffix of one
 *                   TABLE each; "cont." heads keep their suffix
 *   wine rows       name without the vintage; meta = vintage · region + the pairing
 *                   marks ○ △ ◇ the binder prints beside it; flags LIMITED for "**"
 *   tequila/mezcal  pour-size lines → TEXT titled "Tequila" / "Mezcal" at the top of
 *                   each page; one STANDARD per producer group (subheading = house
 *                   intro); items meta = ABV, flags STAFF_PICK for "•"; mezcal
 *                   description = village
 *
 * Nothing here is invented: every string is the source's, apostrophes and all.
 * What could not be carried one-to-one (page eyebrows, the cover's hand-set
 * contents line, two-column dense pages) is listed under `review`.
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

const KEY_PREFIX = 'fwd';

/** "fwd-tommy-s-margarita" — minted from the printed name, or from longer text when the name alone repeats. */
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
  /** What the dish key is minted from when the printed name repeats elsewhere in the binder. */
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

/** A prose block; paragraphs separated by blank lines. Untitled when the binder prints no head over it. */
function text(page: number, body: string, title = ''): MenuSectionDocument {
  return section({ page, title, type: 'TEXT', body });
}

const ON_TAP: MenuItemFlag[] = ['ON_TAP'];
const PICK: MenuItemFlag[] = ['STAFF_PICK'];
const LIMITED: MenuItemFlag[] = ['LIMITED'];

function cocktail(name: string, price: number, ingredients: string, extra: { note?: string; tags?: MenuTagCode[]; flags?: MenuItemFlag[] } = {}): MenuItemDocument {
  return item({ name, price, description: ingredients, ...extra });
}

function beer(name: string, abv: string, price: number): MenuItemDocument {
  return item({ name, meta: abv, price });
}

/** A favourites-page row: the same drink as elsewhere in the binder, so the key is scoped to the page. */
function favourite(name: string, price: number): MenuItemDocument {
  return item({ name, price, keyText: `favourite ${name}` });
}

/** A name-and-note row the binder prints without a price (the agave guide, the team's picks); the key is scoped to its list. */
function unpriced(scope: string, name: string, description: string, meta?: string): MenuItemDocument {
  return item({ name, description, ...(meta ? { meta } : {}), keyText: `${scope} ${name}` });
}

function flight(name: string, price: number, pours: string): MenuItemDocument {
  return item({ name, price, description: pours });
}

const GLASS_COLUMNS = ['150 mL', '250 mL'];
const BOTTLE_COLUMNS = ['Bottle'];

type WineOptions = { limited?: boolean; keySuffix?: string };

/**
 * A wine row. The binder sets the vintage as a muted prefix and the region as
 * an italic tail; here the name stands alone (stable across vintages) and the
 * vintage, region and the pairing marks ○ △ ◇ form the detail. Glass and
 * bottle rows of the same wine are scoped apart in the key.
 */
function wine(scope: 'glass' | 'bottle', vintage: string, name: string, region: string, marks: string, prices: Array<number | null>, options: WineOptions = {}): MenuItemDocument {
  return item({
    name,
    meta: `${vintage} · ${region}${marks ? ` ${marks}` : ''}`,
    prices,
    keyText: `${scope} ${name}${options.keySuffix ? ` ${options.keySuffix}` : ''}`,
    ...(options.limited ? { flags: LIMITED } : {})
  });
}

const glass = (vintage: string, name: string, region: string, marks: string, ml150: number | null, ml250: number | null) => wine('glass', vintage, name, region, marks, [ml150, ml250]);
const bottle = (vintage: string, name: string, region: string, marks: string, price: number, options: WineOptions = {}) => wine('bottle', vintage, name, region, marks, [price], options);

function tequila(name: string, abv: string, price: number, pick = false): MenuItemDocument {
  return item({ name, meta: abv, price, ...(pick ? { flags: PICK } : {}) });
}

/**
 * A mezcal row: the village prints under the name. Brands repeat across agave
 * groups and villages, so the key carries the group and village (and the ABV
 * where even that repeats).
 */
function mezcal(group: string, name: string, abv: string, village: string, price: number, pick = false, keySuffix?: string): MenuItemDocument {
  const keyText = [name, group === 'Other mezcal' ? '' : group, village, keySuffix ?? ''].filter(Boolean).join(' ');
  return item({ name, meta: abv, description: village, price, keyText, ...(pick ? { flags: PICK } : {}) });
}

const TEQUILA_POURS = 'All tequila pours are 30 mL\n\n15 mL pours available on all agave spirits.';
const MEZCAL_POURS = 'All mezcal pours are 30 mL and served at room temperature.\n\n15 mL pours available on all agave spirits.';

// ---------------------------------------------------------------------------
// The binder, card by card
// ---------------------------------------------------------------------------

const sections: MenuSectionDocument[] = [
  // ---- 02 · Cocktails · Margaritas -----------------------------------------
  section({
    page: 2,
    title: 'Margaritas',
    items: [
      cocktail('Classic Margarita', 23, 'El Tequileño Tequila, Alma’s Triple Sec, Lime'),
      cocktail('Jalapeño Margarita', 23, 'Jalapeño-infused El Tequileño Tequila, Alma’s Triple Sec, Lime'),
      cocktail('Tommy’s Margarita', 23, 'El Tequileño Tequila, Agave, Lime', { note: 'Served on the rocks, made famous at Tommy’s Mexican Restaurant, San Francisco' }),
      cocktail('Pornstar Margarita', 23, 'El Tequileño Tequila, Passionfruit, Vanilla, Lime', { note: 'Refreshing take on a classic' }),
      cocktail('Coconut Margarita', 23, 'Coconut-washed El Tequileño Tequila, Cacao Blanco, Citrus', { note: 'Our signature pour, under a cloud of coconut foam' }),
      cocktail('Mezcal Tommy’s', 24, 'Aguas Mansas Mezcal, Agave, Lime', { note: 'The Oaxacan cousin' }),
      cocktail('Mezcalita', 24, 'Aguas Mansas Mezcal, Alma’s Triple Sec, Lime')
    ]
  }),
  text(2, 'All margaritas available spicy on request.'),

  // ---- 03 · Cocktails · Palomas + Seasonal ---------------------------------
  section({
    page: 3,
    title: 'Palomas',
    items: [
      cocktail('Classic Paloma', 23, 'El Tequileño Tequila, Lime, Grapefruit Soda'),
      cocktail('Rhubarb Grapefruit Paloma', 23, 'Tequila, Rhubarb, Grapefruit, Lime', { note: 'On tap', flags: ON_TAP })
    ]
  }),
  section({
    page: 3,
    title: 'Seasonal cocktails',
    subheading: 'What the bar is playing with right now.',
    items: [
      cocktail('Beach, Please', 23, 'Manly Spirits Vodka, Licor 43, Falernum, Rosé, Watermelon', { tags: ['N'] }),
      cocktail('Pink Skies', 23, 'Manly Spirits Gin, Blueberry, Violette, Lemon, Prosecco'),
      cocktail('Strawberry Habanero Sour', 23, 'Strawberry and habanero-infused Tequila, Bitter Orange, Lime'),
      cocktail('Ginger Spice', 23, 'Aguas Mansas Mezcal, Ginger, Chilli, Citrus')
    ]
  }),
  // The binder's "N contains nuts · DF dairy free" footnote is the generated tag legend — not typed.

  // ---- 04 · Cocktails · Stirred & after dinner + To share ------------------
  section({
    page: 4,
    title: 'Stirred & after dinner',
    items: [
      cocktail('Oaxacan Negroni', 25, 'Almond butter-infused mezcal, Campari, vermouth', { tags: ['N'] }),
      cocktail('Don Elote', 25, 'Aguas Mansas Mezcal, Bourbon, Agave, Bitters', { tags: ['DF'] }),
      cocktail('Espresso Martini', 23, 'Manly Spirits Vodka, Coffee Liqueur, Cold Drip Coffee', { tags: ['DF'] })
    ]
  }),
  section({
    page: 4,
    title: 'To share',
    subheading: 'On tap, poured into a carafe for the table.',
    items: [
      item({ name: 'Paloma Carafe', price: 72, description: 'Our rhubarb and grapefruit paloma', meta: 'on tap, serves three', flags: ON_TAP }),
      item({ name: 'Manly Spirits Spritz', price: 72, meta: 'on tap, serves three', flags: ON_TAP })
    ]
  }),

  // ---- 05 · Our favourites · Can't decide? ---------------------------------
  text(5, 'Start here. A few of our favourites, wherever you’re at in the night.', 'Can’t decide?'),
  section({
    page: 5,
    title: 'Before dinner',
    subheading: 'Bright and citrus-led, made to open the palate.',
    items: [favourite('Classic Margarita', 23), favourite('Beach, Please', 23), favourite('Classic Paloma', 23)]
  }),
  section({
    page: 5,
    title: 'With food',
    subheading: 'Enough body to pair well with anything.',
    items: [favourite('Tommy’s Margarita', 23), favourite('Gotas de Mar, Albariño', 19), favourite('Fortaleza Blanco', 22)]
  }),
  section({
    page: 5,
    title: 'After dinner',
    subheading: 'A slower, richer after-dinner sipper.',
    items: [favourite('Espresso Martini', 23), favourite('Don Elote', 25), favourite('El Tequileño 1959 Añejo', 26)]
  }),
  text(5, 'Not sure? Tell us what you like and we will point you somewhere good.'),

  // ---- 06 · Low & no · Beer & cider · Soft drinks --------------------------
  section({
    page: 6,
    title: 'Low & no',
    headerSuffix: 'Low · lower alcohol',
    items: [cocktail('Mirasol', 20, 'Amaro Montenegro, Prosecco, Soda'), cocktail('Aperol(ish) Spritz', 20, 'Non-alcoholic orange aperitif, Prosecco, Soda')]
  }),
  section({
    page: 6,
    title: 'Low & no',
    headerSuffix: 'No · alcohol free',
    items: [
      cocktail('Sensible Margarita', 18, 'Lyre’s Non-Alcoholic Spirits, Citrus'),
      cocktail('Mango and Grapefruit Fresca', 18, 'Mango, Lime, Grapefruit, Soda'),
      cocktail('Watermelon Spritz', 18, 'Watermelon, Citrus, Mint, Soda'),
      cocktail('Apple & Jalapeño Fresca', 18, 'Apple, Jalapeño, Lime, Soda')
    ]
  }),
  section({
    page: 6,
    title: 'Beer & cider',
    items: [
      beer('Corona', '4.5%', 13),
      beer('Modelo Especial', '4.4%', 15),
      beer('Balter Cerveza', '4.0%', 13),
      beer('Balter XPA', '5.0%', 13),
      beer('Batlow Cloudy Apple Cider', '4.2%', 13),
      beer('Heaps Normal Quiet XPA', '<0.5%', 10),
      beer('Heaps Normal Another Lager', '<0.5%', 10)
    ]
  }),
  text(6, 'Soft drinks available, just ask the team.', 'Soft drinks'),

  // ---- 07 · On agave --------------------------------------------------------
  text(
    7,
    'This is the heart of what we do. Tequila and mezcal, more than eighty of them, chosen one bottle at a time. You do not need to know any of it to enjoy it. Tell us what you like and we will point you somewhere good. If you want to find your own way, we have marked our favourites, mine included, though it is hard to go wrong.',
    'On agave'
  ),
  section({
    page: 7,
    title: 'Our favourites',
    items: [
      unpriced('pick', 'Arette Blanco', 'Clean, peppery and easygoing, the workhorse blanco that lifts any margarita.', 'Tim’s pick'),
      unpriced('pick', 'Fortaleza Reposado', 'Oak and warmth layered over cooked agave, the reposado we reach for first.', 'Dirk’s pick'),
      unpriced('pick', 'Fortaleza Blanco', 'Stone oven and tahona made, rich and savoury, a cult sipper.', 'Caio’s pick')
    ]
  }),
  section({
    page: 7,
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
    page: 7,
    title: 'Start here',
    items: [
      unpriced('start here', 'El Tequileño 1959 Platinum', 'The house pour behind our margaritas, bright and friendly.'),
      unpriced('start here', 'G4 Reposado', 'Oak and warmth without the heat, the one that makes sense of reposado.'),
      unpriced('start here', 'Aguas Mansas', 'A soft espadín mezcal, just enough smoke to find out if you like it.')
    ]
  }),
  text(7, 'Take your time. Ask questions. Salud.'),

  // ---- 08 · Tasting flights · Explore Mexico --------------------------------
  text(
    8,
    'Not sure where to begin? Our tasting flights take you through the styles of tequila and mezcal, from bright, citrus-driven blancos to rich extra añejos and smoky mezcals.',
    'Explore Mexico'
  ),
  section({
    page: 8,
    title: 'Tasting flights',
    items: [
      flight('Discover El Tequileño 1959', 46, 'El Tequileño Platinum, Gran Reserva, Reposado Rare, Añejo'),
      flight('The Founding Fathers of Tequila', 39, 'Herradura Plata, Arette Reposado, Fortaleza Blanco, G4 Añejo'),
      flight('Añejo, the Art of Ageing', 47, 'G4 Añejo, Don Julio Añejo, Herradura Añejo, Patrón Añejo'),
      flight('Espadín Mezcal', 33, 'Madre Mezcal, Koch Ancestral Espadín, Ilegal Joven, Siete Misterios Doba Yej'),
      flight('El Pandillo, Don Felipe Camarena', 49, 'G4 Reposado, Pasote Blanco, Terralta Blanco, Volans Extra Añejo'),
      flight('St Alma Selects', 42, 'Arette Suave Blanco, Código 1530 Rosa Blanco, Ilegal Reposado, El Tequileño Gran Reserva Reposado')
    ]
  }),
  text(8, 'Four 15 mL pours, chosen by our team. Ask us which flight best suits your meal.\n\nFull tequila and mezcal list, tequila page 20, mezcal page 22.'),

  // ---- 09 · A note on our wine ----------------------------------------------
  text(
    9,
    [
      'Wine should feel generous, relaxed and made to share. A good glass can capture the character of the land, elevate the meal in front of you and lift the mood of the table it lands on.',
      'Our list has been shaped by people who genuinely love wine. Austin brings a real point of view, while Cal from Clarity Cru and Greg from Joval have introduced us to bottles we may never have found on our own.',
      'It is designed to sit beside the coastal Mexican food we serve. Bright whites, textural styles, crisp rosé and juicy reds, each picked to match everything from fresh ceviche and tacos to grilled meats and smoky spice.',
      'A considered list with something for every mood and occasion. Ask the team if you’d like a recommendation. We are always happy to help you find the right glass or bottle.',
      'Welcome to St Alma, and salud.',
      'Tim Christensen\nFounding Director Alma Group'
    ].join('\n\n'),
    'A note on our wine'
  ),
  text(9, '○ Seafood and ceviche · △ Rich and grilled · ◇ Vegetables and cheese\n\n** Subject to availability. Vintages may change.', 'Pairing guide'),

  // ---- 10 · Wine by the glass · White ----------------------------------------
  section({
    page: 10,
    title: 'White',
    type: 'TABLE',
    priceColumns: GLASS_COLUMNS,
    items: [
      glass('2024', 'Moments of Clarity, Riesling', 'Eden Valley, SA', '', 16, 26),
      glass('2024', 'Gotas de Mar, Albariño', 'Rías Baixas, ESP', '○', 19, 31),
      glass('2023', 'Gilbert Family Wines, Sauvignon Blanc', 'Orange, NSW', '○ ◇', 18, 29),
      glass('2023', 'Shut The Gate ‘For Freedom’, Gewürztraminer', 'Clare Valley, SA', '◇', 17, 27),
      glass('2024', 'Ingram Road, Chardonnay', 'Yarra Valley, VIC', '◇', 16, 26)
    ]
  }),
  section({
    page: 10,
    title: 'Sommelier pours',
    type: 'TABLE',
    priceColumns: GLASS_COLUMNS,
    items: [
      glass('2023', 'Domaine Oudin Chablis, Chardonnay', 'Burgundy, FRA', '○', 35, 57),
      glass('2024', 'Château Grand Village, Sauvignon Blanc Semillon', 'Bordeaux, FRA', '○ ◇', 37, 59),
      glass('2022', 'La Petite Mort ‘Qvevri’ Viognier Marsanne Roussanne, skin contact', 'Granite Belt, QLD', '◇', 20, 33)
    ]
  }),
  section({
    page: 10,
    title: 'Bubbles',
    headerSuffix: '150 mL pour',
    type: 'TABLE',
    priceColumns: ['150 mL'],
    items: [
      wine('glass', 'NV', 'Serenello Prosecco, Glera', 'Veneto, ITA', '○', [17]),
      wine('glass', 'NV', 'Taittinger Brut Réserve, Chardonnay Pinot Noir Pinot Meunier', 'Champagne, FRA', '○', [34])
    ]
  }),

  // ---- 11 · Wine by the glass · Rosé & Red -----------------------------------
  section({
    page: 11,
    title: 'Rosé',
    type: 'TABLE',
    priceColumns: GLASS_COLUMNS,
    items: [glass('2024', 'R. Paulazzo, Pinot Noir', 'Riverina, NSW', '○', 16, 26), glass('NV', 'Domaine Gavoty Rosé ‘Cigale’', 'Vin de France, FRA', '○', 18, 29)]
  }),
  section({
    page: 11,
    title: 'Red',
    type: 'TABLE',
    priceColumns: GLASS_COLUMNS,
    items: [
      glass('2024', 'Red Claw, Pinot Noir', 'Mornington Peninsula, VIC', '△ ◇', 19, 31),
      glass('2022', 'Capa Single Vineyard, Tempranillo', 'Castilla La Mancha, ESP', '△', 16, 26),
      glass('2022', 'Villa Albergotti Chianti Superiore, Sangiovese', 'Tuscany, ITA', '◇', 18, 29),
      glass('2024', 'Yangarra ‘Circle’, Shiraz', 'McLaren Vale, SA', '△ ◇', 17, 27),
      glass('2022', 'BenMarco ‘Valle de Uco’, Malbec', 'Mendoza, ARG', '△', 21, 33)
    ]
  }),
  section({
    page: 11,
    title: 'Sommelier pours',
    type: 'TABLE',
    priceColumns: GLASS_COLUMNS,
    items: [
      glass('2023', 'Bonnet & Cotton Beaujolais, Gamay', 'Beaujolais, FRA · served chilled', '△ ◇', 29, 41),
      glass('2024', 'Vanguardist ‘Field’, Grenache Shiraz Mourvèdre', 'Barossa Valley, SA', '◇', 25, 37),
      glass('2022', 'Louis Jadot Bourgogne, Pinot Noir', 'Burgundy, FRA', '△ ◇', 36, 58),
      glass('2022', 'Utopos, Shiraz', 'Barossa Valley, SA', '△', 39, 61)
    ]
  }),
  section({
    page: 11,
    title: 'Sweet & fortified',
    type: 'TABLE',
    subheading: 'Served after the meal, or with the churros.',
    priceColumns: ['60 mL', '375 mL btl'],
    items: [wine('glass', 'NV', 'All Saints Estate ‘Grand’, Rutherglen Muscat', 'Rutherglen, VIC', '', [18, 79])]
  }),

  // ---- 12 · By the bottle · Mexican wine, Bubbles & Riesling -----------------
  section({
    page: 12,
    title: 'Mexican wine',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2018', 'Surco 2.7, Cabernet Sauvignon', 'Baja California, MEX', '△ ◇', 101),
      bottle('2019', 'Château Domecq, Cabernet Sauvignon Merlot Nebbiolo', 'Valle de Guadalupe, MEX', '△', 71)
    ]
  }),
  section({
    page: 12,
    title: 'Bubbles',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('NV', 'Serenello Prosecco, Glera', 'Veneto, ITA', '○', 76),
      bottle('NV', 'Taittinger Brut Réserve', 'Champagne, FRA', '○', 162),
      bottle('NV', 'Taittinger Brut Réserve 375 mL', 'Champagne, FRA', '○', 96),
      bottle('NV', 'Laurent-Perrier Cuvée Rosé', 'Champagne, FRA', '○', 325),
      bottle('NV', 'Billecart-Salmon Brut Rosé', 'Champagne, FRA', '○', 290, { limited: true }),
      bottle('NV', 'Pol Roger Brut Rosé', 'Champagne, FRA', '○', 315, { limited: true })
    ]
  }),
  section({
    page: 12,
    title: 'Riesling',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'Moments of Clarity', 'Eden Valley, SA', '', 73),
      bottle('2025', 'Grosset ‘Polish Hill’', 'Clare Valley, SA', '○', 167),
      bottle('2024', 'Frogmore Creek', 'Coal River, TAS', '○', 93),
      bottle('2024', 'Domaine Sparr ‘Sentiment’', 'Alsace, FRA', '○ △ ◇', 130),
      bottle('2021', 'Domaines Schlumberger ‘Saering’ Grand Cru', 'Alsace, FRA', '○ ◇', 147),
      bottle('2023', 'Weingut Hüls', 'Mosel, GER', '○', 89),
      bottle('2024', 'Loimer ‘Lenz’', 'Kamptal, AUT', '○ ◇', 97)
    ]
  }),

  // ---- 13 · By the bottle · Other whites -------------------------------------
  section({
    page: 13,
    title: 'Other whites',
    headerSuffix: 'Crisp & refreshing',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2023', 'Nick Spencer ‘Tumbarumba’, Grüner Veltliner', 'Tumbarumba, NSW', '○ ◇', 89),
      bottle('2024', 'Poggio Anima ‘Uriel’, Grillo', 'Sicily, ITA', '○', 73),
      bottle('2024', 'Gotas de Mar, Albariño', 'Rías Baixas, ESP', '○', 86),
      bottle('2024', 'i Lauri ‘AVALOS’, Pecorino', 'Abruzzo, ITA', '○ ◇', 81)
    ]
  }),
  section({
    page: 13,
    title: 'Other whites',
    headerSuffix: 'Aromatic & textural',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'i Lauri ‘TAVO’, Pinot Grigio', 'Veneto, ITA', '○ ◇', 75),
      bottle('2024', 'Greystone, Pinot Gris', 'Waipara, NZ', '◇', 83),
      bottle('2024', 'Inama Soave Classico, Garganega', 'Veneto, ITA', '○', 91),
      bottle('2023', 'Shut The Gate ‘For Freedom’, Gewürztraminer', 'Clare Valley, SA', '◇', 76)
    ]
  }),
  section({
    page: 13,
    title: 'Other whites',
    headerSuffix: 'Mineral & complex',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2025', 'Grosset ‘Apiana’, Fiano', 'Clare Valley, SA', '○ ◇', 106),
      bottle('2022', 'Loïc Mahé Savennières, Chenin Blanc', 'Loire Valley, FRA', '○ △ ◇', 167),
      bottle('2024', 'Badenhorst ‘Secateurs’, Chenin Blanc', 'Swartland, ZAF', '◇', 95),
      bottle('2020', 'Vandal ‘Gonzo Militia’, White Blend', 'Marlborough, NZ', '◇', 71)
    ]
  }),

  // ---- 14 · By the bottle · Sauvignon Blanc, Semillon & Chardonnay ------------
  section({
    page: 14,
    title: 'Sauvignon Blanc & Semillon',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'Domaine Christian Salmon Sancerre', 'Loire Valley, FRA', '○', 137),
      bottle('2022', 'Domaine du Bouchot Pouilly Fumé', 'Loire Valley, FRA', '○ ◇', 192),
      bottle('2024', 'Catalina Sounds ‘Sound of White’', 'Marlborough, NZ', '○ ◇', 77),
      bottle('2023', 'Gilbert Family Wines', 'Orange, NSW', '○ ◇', 84),
      bottle('2024', 'Château Grand Village White, Sauvignon Blanc Semillon', 'Bordeaux, FRA', '○ ◇', 152),
      bottle('2024', 'Vinden ‘Headcase’, Semillon', 'Hunter Valley, NSW', '○ ◇', 83),
      bottle('2022', 'Eperosa ‘Magnolia 1941’, Semillon', 'Barossa Valley, SA', '○ ◇', 109),
      bottle('2023', 'Sabi Wabi ‘Sugi’, Semillon', 'Hunter Valley, NSW', '◇', 77)
    ]
  }),
  section({
    page: 14,
    title: 'Chardonnay',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2023', 'Domaine Oudin Chablis', 'Burgundy, FRA', '○', 144),
      bottle('2022', 'Stéphane Brocard Chablis 1er Cru', 'Burgundy, FRA', '○', 197),
      bottle('2022', 'Domaine Rougeot Meursault', 'Burgundy, FRA', '◇', 440),
      bottle('2023', 'Louis Jadot Pouilly Fuissé', 'Burgundy, FRA', '◇', 230)
    ]
  }),

  // ---- 15 · By the bottle · Chardonnay cont. & Skin contact ------------------
  section({
    page: 15,
    title: 'Chardonnay',
    headerSuffix: 'cont.',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'Thorin ‘Terres de Craie’ Mâcon-Villages', 'Burgundy, FRA', '○ ◇', 91),
      bottle('2024', 'Briar Ridge ‘The Squire’', 'Hunter Valley, NSW', '△ ◇', 79),
      bottle('2024', 'Giant Steps ‘Sexton Vineyard’', 'Yarra Valley, VIC', '△ ◇', 182),
      bottle('2024', 'Shaw & Smith ‘M3’', 'Adelaide Hills, SA', '△ ◇', 132),
      bottle('2024', 'Ingram Road', 'Yarra Valley, VIC', '◇', 73),
      bottle('2017', 'Giaconda ‘Nantua Les Deux’', 'Beechworth, VIC', '△ ◇', 215, { limited: true }),
      bottle('2021', 'Tolpuddle', 'Coal River, TAS', '△ ◇', 395, { limited: true }),
      bottle('2024', 'Mon Tout ‘Heydays’', 'Margaret River, WA', '◇', 71),
      bottle('2023', 'Domaine Thomson ‘Left Bank’', 'Central Otago, NZ', '◇', 150),
      bottle('2024', 'Te Mata ‘Elston’', 'Hawke’s Bay, NZ', '○ △ ◇', 132)
    ]
  }),
  section({
    page: 15,
    title: 'Skin contact & orange',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2022', 'La Petite Mort ‘Qvevri’ Viognier Marsanne Roussanne', 'Granite Belt, QLD', '◇', 93),
      bottle('2023', 'Brave New Wine ‘Pystopia’', 'Great Southern, WA', '◇', 77),
      bottle('2025', 'Trutta, Pinot Gris', 'Faraday, VIC', '◇', 83)
    ]
  }),

  // ---- 16 · By the bottle · Rosé & Pinot Noir --------------------------------
  section({
    page: 16,
    title: 'Rosé',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'R. Paulazzo, Pinot Noir', 'Riverina, NSW', '○', 73),
      bottle('2025', 'Giant Steps, Pinot Noir', 'Yarra Valley, VIC', '○', 81),
      bottle('NV', 'Domaine Gavoty Rosé ‘Cigale’', 'Vin de France, FRA', '○', 83),
      bottle('2024', 'AIX Rosé, Grenache Syrah Cinsault', 'Coteaux d’Aix-en-Provence, FRA', '○', 91)
    ]
  }),
  section({
    page: 16,
    title: 'Pinot Noir',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2022', 'Louis Jadot Bourgogne', 'Burgundy, FRA', '△ ◇', 142),
      bottle('2021', 'Stéphane Brocard Gevrey-Chambertin', 'Burgundy, FRA', '△', 325),
      bottle('2019', 'Domaine Bouchard Corton Grand Cru', 'Burgundy, FRA', '△', 555, { limited: true }),
      bottle('2023', 'Haddow & Dineen ‘Private Universe’', 'Tamar Valley, TAS', '△', 137),
      bottle('2023', 'Shaw & Smith', 'Adelaide Hills, SA', '△ ◇', 132),
      bottle('2024', 'Red Claw', 'Mornington Peninsula, VIC', '△ ◇', 86),
      bottle('2023', 'Helen’s Hill ‘The Smuggler’', 'Yarra Valley, VIC', '△ ◇', 126),
      bottle('2022', 'Novum', 'Marlborough, NZ', '◇', 121),
      bottle('2024', 'Domaine Thomson ‘Explorer’', 'Central Otago, NZ', '◇', 89),
      bottle('2020', 'Nielson', 'Santa Barbara, USA', '△', 116)
    ]
  }),

  // ---- 17 · By the bottle · Other reds ---------------------------------------
  section({
    page: 17,
    title: 'Other reds',
    headerSuffix: 'Light & juicy',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2023', 'Bonnet & Cotton Beaujolais, Gamay', 'Beaujolais, FRA · served chilled', '△ ◇', 130),
      bottle('2023', 'Domaine du Trapadis ‘Esprit’, Grenache', 'Southern Rhône, FRA', '◇', 86),
      bottle('2022', 'Capa Single Vineyard, Tempranillo', 'Castilla La Mancha, ESP', '△', 73),
      bottle('2021', 'Vandal Gonzo Combat Rouge', 'Marlborough, NZ', '◇', 71)
    ]
  }),
  section({
    page: 17,
    title: 'Other reds',
    headerSuffix: 'Medium-bodied & versatile',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2024', 'A. Rodda, Tempranillo', 'Beechworth, VIC', '△', 106),
      bottle('2022', 'Mallaluka, Nero d’Avola', 'Gundagai, NSW', '△ ◇', 76),
      bottle('2022', 'Villa Albergotti Chianti Superiore, Sangiovese', 'Tuscany, ITA', '◇', 83),
      bottle('2023', 'Domaine du Trapadis ‘Garrigues’ Cairanne', 'Southern Rhône, FRA', '△ ◇', 109),
      bottle('2023', 'Alain Jaume Châteauneuf du Pape, Grenache Shiraz Mourvèdre', 'Southern Rhône, FRA', '△', 265),
      bottle('2024', 'Vanguardist ‘Field’, Grenache Shiraz Mourvèdre', 'Barossa Valley, SA', '◇', 100),
      bottle('2022', 'Ramos Pinto Duas Quintas Tinto', 'Douro, POR', '△ ◇', 96)
    ]
  }),
  section({
    page: 17,
    title: 'Other reds',
    headerSuffix: 'Full-bodied & bold',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2019', 'Ca di Bruno Barbaresco, Nebbiolo', 'Piedmont, ITA', '△', 152),
      bottle('2006', 'Sandrone le Vigne Barolo, Nebbiolo', 'Piedmont, ITA', '△', 660, { limited: true }),
      bottle('2023', 'Edmeades, Zinfandel', 'Mendocino, USA', '△', 121)
    ]
  }),

  // ---- 18 · By the bottle · Other reds cont. & Shiraz ------------------------
  section({
    page: 18,
    title: 'Other reds',
    headerSuffix: 'cont.',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2022', 'BenMarco Valle de Uco, Malbec', 'Mendoza, ARG', '△', 93),
      bottle('2002', 'Wendouree, Cabernet Sauvignon Malbec', 'Clare Valley, SA', '△', 790, { limited: true })
    ]
  }),
  section({
    page: 18,
    title: 'Shiraz',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2022', 'Jean-Luc Jamet Syrah ‘Valine’', 'Rhône Valley, FRA', '△', 190),
      bottle('2024', 'Yangarra ‘Circle’', 'McLaren Vale, SA', '△ ◇', 76),
      bottle('2017', 'Geoff Merrill ‘Jacko’s’', 'McLaren Vale, SA', '△', 89),
      bottle('2010', 'Paxton ‘Elizabeth Jean’', 'McLaren Vale, SA', '△', 225, { limited: true }),
      bottle('2021', 'Smallfry ‘Vinevale Estate’', 'Barossa Valley, SA', '△', 97),
      bottle('2022', 'Teusner ‘Big Jim’', 'Barossa Valley, SA', '△', 125),
      bottle('2022', 'Utopos', 'Barossa Valley, SA', '△', 152, { keySuffix: 'shiraz' }),
      bottle('2017', 'Teusner ‘Righteous FG’', 'Barossa Valley, SA', '△', 400, { limited: true })
    ]
  }),

  // ---- 19 · By the bottle · Shiraz cont., Cabernet & Bordeaux ----------------
  section({
    page: 19,
    title: 'Shiraz',
    headerSuffix: 'cont.',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2017', 'Rockford Basket Press', 'Barossa Valley, SA', '△', 395, { keySuffix: '2017' }),
      bottle('2018', 'Rockford Basket Press', 'Barossa Valley, SA', '△', 475, { keySuffix: '2018' }),
      bottle('2022', 'La Violetta ‘Up!’', 'Great Southern, WA', '△', 91)
    ]
  }),
  section({
    page: 19,
    title: 'Cabernet & Bordeaux blends',
    type: 'TABLE',
    priceColumns: BOTTLE_COLUMNS,
    items: [
      bottle('2016', 'Geoff Merrill Reserve', 'McLaren Vale, SA', '△', 116),
      bottle('2023', 'Utopos', 'Barossa Valley, SA', '△', 152, { keySuffix: 'cabernet' }),
      bottle('2021', 'Cannonball', 'Sonoma Valley, USA', '△', 106),
      bottle('2022', 'Briar Ridge ‘BDX’', 'Hunter Valley, NSW', '△', 83),
      bottle('1998', 'Yalumba ‘The Reserve’', 'Barossa Valley, SA', '△', 400, { limited: true }),
      bottle('2022', 'Château Cru Godard', 'Bordeaux, FRA', '△', 99),
      bottle('2020', 'Château La Grave Figeac, Saint-Émilion Grand Cru', 'Bordeaux, FRA', '△', 215)
    ]
  }),

  // ---- 20 · Tequila ------------------------------------------------------------
  text(20, TEQUILA_POURS, 'Tequila'),
  section({ page: 20, title: 'Grupo Tequilero', items: [tequila('Alquimia Blanco', '40%', 23)] }),
  section({
    page: 20,
    title: 'Arette de Jalisco',
    items: [tequila('Arette Blanco', '40%', 14, true), tequila('Arette Reposado', '40%', 16), tequila('Arette Suave Artesanal Blanco', '38%', 24, true)]
  }),
  section({
    page: 20,
    title: 'El Pandillo',
    subheading: 'Felipe Camarena’s highland distillery in Arandas, known for his hand-built tahona and bright, mineral agave.',
    items: [
      tequila('ArteNOM 1579', '40.7%', 21),
      tequila('G4 Blanco', '40%', 19, true),
      tequila('G4 Reposado', '40%', 22, true),
      tequila('G4 Añejo', '40%', 34, true),
      tequila('Terralta Blanco', '40%', 20),
      tequila('Pasote Blanco', '40%', 25),
      tequila('Volans Blanco', '40%', 20),
      tequila('Volans Extra Añejo', '40%', 37)
    ]
  }),
  section({ page: 20, title: 'Hacienda Capellanía', items: [tequila('Calle 23 Blanco', '40%', 14), tequila('Calle 23 Reposado', '40%', 16)] }),
  section({
    page: 20,
    title: 'Tequila Cascahuín',
    items: [tequila('Cascahuín Blanco', '38%', 16, true), tequila('Cascahuín Reposado', '38%', 19, true), tequila('Cascahuín Añejo', '38%', 21, true)]
  }),
  section({ page: 20, title: 'Varo Destilería', items: [tequila('Código 1530 Rosa Blanco', '35%', 24, true)] }),
  section({
    page: 20,
    title: 'Diageo México',
    items: [tequila('Don Julio Blanco', '38%', 21), tequila('Don Julio Reposado', '38%', 23), tequila('Don Julio Añejo', '38%', 26), tequila('Don Julio 1942', '38%', 39)]
  }),
  section({ page: 20, title: 'Los Alambiques', items: [tequila('Ocho Plata', '40%', 22), tequila('Ocho Reposado', '40%', 23), tequila('Ocho Añejo', '40%', 24)] }),

  // ---- 21 · Tequila ------------------------------------------------------------
  text(21, TEQUILA_POURS, 'Tequila'),
  section({
    page: 21,
    title: 'Hacienda Herradura',
    subheading: 'Made at Hacienda San José del Refugio since 1870, the lowland classic, rich, baked and earthy.',
    items: [
      tequila('Herradura Plata', '40%', 16),
      tequila('Herradura Reposado', '40%', 18),
      tequila('Herradura Añejo', '40%', 20),
      tequila('Herradura Ultra', '40%', 26),
      tequila('Herradura Suprema Extra Añejo', '40%', 81)
    ]
  }),
  section({
    page: 21,
    title: 'Tequila Tapatío',
    items: [tequila('El Tesoro Blanco', '40%', 23), tequila('El Tesoro Reposado', '40%', 24), tequila('Tapatío Blanco', '40%', 21), tequila('Tapatío Reposado', '40%', 23)]
  }),
  section({
    page: 21,
    title: 'Tequila Los Abuelos',
    subheading: 'Fortaleza, the Sauza family’s return to old methods, stone oven and tahona.',
    items: [tequila('Fortaleza Blanco', '40%', 22, true), tequila('Fortaleza Reposado', '40%', 25, true)]
  }),
  section({
    page: 21,
    title: 'Jorge Salles Cuervo y Sucesores',
    items: [
      tequila('El Tequileño 1959 Platinum', '40%', 17),
      tequila('El Tequileño 1959 Gran Reserva Reposado', '40%', 18),
      tequila('El Tequileño 1959 Añejo', '40%', 26, true),
      tequila('El Tequileño 1959 Reposado Rare', '40%', 50, true)
    ]
  }),
  section({
    page: 21,
    title: 'Patrón Spirits México',
    items: [
      tequila('Patrón Silver', '40%', 14),
      tequila('Patrón Reposado', '40%', 16),
      tequila('Patrón Añejo', '40%', 18),
      tequila('Patrón El Cielo', '40%', 29),
      tequila('Patrón XO Café', '40%', 19)
    ]
  }),
  section({
    page: 21,
    title: 'Other houses',
    items: [tequila('Siete Leguas Blanco', '40%', 22), tequila('Tromba Reposado', '40%', 18, true), tequila('Tromba Añejo', '40%', 21, true), tequila('Tres Agaves', '40%', 15)]
  }),

  // ---- 22 · Mezcal -------------------------------------------------------------
  text(22, MEZCAL_POURS, 'Mezcal'),
  section({
    page: 22,
    title: 'Espadín',
    subheading: 'The workhorse of mezcal. Roasted agave on the nose, bright and herbaceous.',
    items: [
      mezcal('Espadín', 'Aguas Mansas', '45%', 'Santiago Matatlán', 13),
      mezcal('Espadín', 'Mezcal Verde', '42%', 'Tlacolula', 15, true),
      mezcal('Espadín', 'El Jolgorio', '47.8%', 'San Luis del Río', 32),
      mezcal('Espadín', 'El Jolgorio Pechuga', '48%', 'Santiago Matatlán', 55, true),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'San Luis del Río', 18, true),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'Santiago Matatlán', 17, true),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'La Compañía, Ejutla', 18),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'San Baltazar Guelavila', 18),
      mezcal('Espadín', 'Nuestra Soledad', '47%', 'Lachigui Mihuatlán', 19),
      mezcal('Espadín', 'Siete Misterios Doba Yej', '44%', 'San Dionisio Ocotepec', 16, true),
      mezcal('Espadín', 'Koch El Mezcal Ancestral', '47.12%', 'Sola de Vega', 20),
      mezcal('Espadín', 'San Cosme Mezcal', '40%', 'Santiago Matatlán', 15),
      mezcal('Espadín', 'Madre Mezcal', '40%', 'Santiago Matatlán', 16),
      mezcal('Espadín', 'Ilegal Joven', '40%', 'Santiago Matatlán', 19),
      mezcal('Espadín', 'Ilegal Reposado', '40%', 'Santiago Matatlán', 21),
      mezcal('Espadín', 'Ilegal Añejo', '40%', 'Santiago Matatlán', 29),
      mezcal('Espadín', 'Gracias a Dios', '45%', 'Santiago Matatlán', 19, true)
    ]
  }),
  section({
    page: 22,
    title: 'Ensemble',
    subheading: 'Several agave species in one batch. Never the same twice.',
    items: [
      mezcal('Ensemble', 'Aprendiz', '45%', 'Espadín & Tepextate, San Juan del Río', 26),
      mezcal('Ensemble', 'Madre Mezcal', '45%', 'Espadín & Cuishe, Santiago Matatlán', 18),
      mezcal('Ensemble', 'Bruxo No. 2', '46%', 'Espadín & Barril, Agua del Espino', 19, true),
      mezcal('Ensemble', 'Bruxo No. 4', '46%', 'Espadín, Barril & Cuishe, Las Salinas', 19, true),
      mezcal('Ensemble', 'Bruxo X', '40%', 'Espadín & Barril, San Dionisio Ocotepec', 16)
    ]
  }),
  section({
    page: 22,
    title: 'Mexicano',
    subheading: 'Up to 25 years to mature. Green and grassy, with orange zest and terracotta.',
    items: [mezcal('Mexicano', 'El Jolgorio', '47%', 'La Compañía, Ejutla', 40, true), mezcal('Mexicano', 'Koch El Mezcal', '46.98%', 'Río de Ejutla', 20)]
  }),
  section({
    page: 22,
    title: 'Tepextate',
    subheading: 'Piñas the size of a baby elephant. Mineral, with volcanic earth underneath.',
    items: [mezcal('Tepextate', 'El Jolgorio', '48%', 'San Luis del Río', 53), mezcal('Tepextate', 'Koch El Mezcal', '46.3%', 'Santa María Zoquitlán', 20, true)]
  }),

  // ---- 23 · Mezcal -------------------------------------------------------------
  text(23, MEZCAL_POURS, 'Mezcal'),
  section({
    page: 23,
    title: 'Arroqueño',
    subheading: 'The genetic mother of espadín. Fruity, herbaceous and smoky.',
    items: [
      mezcal('Arroqueño', 'El Jolgorio', '55%', 'Miahuatlán', 37, false, '55'),
      mezcal('Arroqueño', 'El Jolgorio', '52%', 'Miahuatlán', 56, false, '52'),
      mezcal('Arroqueño', 'Koch El Mezcal', '47.13%', 'Río de Ejutla', 20, true)
    ]
  }),
  section({
    page: 23,
    title: 'Other mezcal',
    subheading: 'Assorted and singular. Try a few together, and ask to see the bottle.',
    items: [
      mezcal('Other mezcal', 'El Jolgorio Cuishe', '47%', 'Santa María Zoquitlán', 34, true),
      mezcal('Other mezcal', 'El Jolgorio Madrecuishe', '48%', 'Santiago Matatlán', 35),
      mezcal('Other mezcal', 'El Jolgorio Tobasiche', '52%', 'La Compañía, Ejutla', 51),
      mezcal('Other mezcal', 'El Jolgorio Sierrudo', '50.5%', 'Santiago Matatlán', 45),
      mezcal('Other mezcal', 'Lágrimas de Dolores', '47%', 'Cenizo, Durango', 22),
      mezcal('Other mezcal', 'Mezcal Machetazo', '45%', 'Cupreata, Guerrero', 16),
      mezcal('Other mezcal', 'Bozal Jamón Ibérico', '47%', 'Espadín, Mexicano & Tobasiche, Río de Ejutla', 49, true)
    ]
  })
];

const document: MenuDocument = {
  ...MENU_DOCUMENT_DEFAULTS,
  // '' prints the template's own title, "Drinks", on the cover.
  heading: '',
  pageCount: 23,
  dietaryNote: '',
  // The cover's conditions line, as printed.
  surchargeLine: 'A surcharge of 10% applies on weekends and 15% on public holidays. Wine vintages may be subject to change.',
  sections
};

export const ST_ALMA_DRINKS_IMPORT: MenuImportSpec = {
  venueSlug: 'st-alma',
  kind: 'DRINKS',
  templateKey: 'freshwater_drinks_binder',
  name: 'Drinks',
  slug: 'drinks',
  visibility: 'PUBLIC',
  confidence: 'high',
  source: {
    path: 'alma-web-platform/apps/web/app/print/st-alma-drinks/sheets.tsx',
    ref: '6115001',
    hash: 'sha256:86a1ed581281f72c50c132324b6d6f90148018243af71f5052c30b905c2c3dbe',
    modifiedAt: '2026-09-24T16:05:54+00:00',
    notes:
      'Transcribed from the hand-written JSX that renders the live website PDF (apps/web/public/menus/st-alma-drinks.pdf), ' +
      'which is byte-identical to the Dropbox reference "St Alma Drinks SCREEN.pdf" (Sep 2026; discovery/05 §3c). ' +
      'All 23 cards were checked against the inventory in discovery/05 §3c and 04 §2.3. ' +
      'The sheet was last changed in alma-web-platform commit 9dfef4f ("St Alma drinks: note 15 mL pours on the tequila and mezcal pages").'
  },
  review: [
    'Cover contents line: the template generates it from the first titled section of each page, so it reads "Margaritas 2 · Palomas 3 · …" rather than the binder\'s hand-set "Cocktails 2 · Agave & flights 7 · Wine 9 · Tequila 20 · Mezcal 22" until the renderer offers a curated line. The cover footer also gains "** Limited stock" from the generated marks legend; the binder prints its ** note on page 9 only.',
    'Page eyebrows ("Cocktails", "Our favourites", "Low & no · Beer, Cider & Soft Drinks", "On agave", "Tasting flights", "Wine by the glass · White", "By the bottle · …", "Tequila", "Mezcal") have no slot: the template\'s running head prints the venue tagline. "Tequila" and "Mezcal" survive as the titles of the pour-size text blocks that open pages 20–23; the rest are dropped.',
    'Page 2: the binder\'s "On tap" serving note on the Rhubarb Grapefruit Paloma is kept as the item note and also recorded as the ON_TAP flag (the flag has no printed mark).',
    'Page 4 "To share": the binder prints "Our rhubarb and grapefruit paloma, on tap, serves three." and "On tap, serves three." as the italic line; here "on tap, serves three" is the item meta (small grey detail after the name) with the paloma\'s description cut to "Our rhubarb and grapefruit paloma", per the import mapping. Restore the full sentence as the description if the meta reads wrong on the proof.',
    'Page 5: each favourites group\'s closing italic line ("Bright and citrus-led, made to open the palate." etc.) sits in the section subheading, so it prints above the three names rather than below them as in the binder. The "Can\'t decide?" page title and its note are a text block; the binder\'s three-column grid prints as three stacked groups.',
    'Page 6: the "Low & no" subgroups are two sections titled "Low & no" with the subgroup label as the headerSuffix ("LOW & NO / Low · lower alcohol", "LOW & NO / No · alcohol free"), so the label prints in the head rather than as the binder\'s small label between rows. Beer & cider rows print in the drink style (caps name, ABV as meta) rather than the binder\'s plain pour rows.',
    'Section budget: the binder transcribes to 75 sections under this mapping (one per producer group, one per wine style or mood), within MENU_LIMITS.sectionsMax (160, raised from the first Menu Editor's one-sheet 60 for the multi-page templates); st-alma-drinks.test.ts asserts it stays within the limit.',
    'Page 7: the picks\' labels ("TIM\'S PICK") are item meta ("Tim\'s pick"); the picks, "When to sip" and "Start here" carry no prices (none are printed), so validation warns STANDARD_NO_PRICE for those 11 items — acknowledge at publish. "When to sip" entries are items whose name is the bold lead ("To begin") and whose description is the rest of the line.',
    'Page 9: the pairing key\'s three entries are separated with " · " where the binder uses wide spaces, and the binder\'s "** Subject to availability. Vintages may change." line is kept in that text block as printed, so it will print alongside the generated "** Limited stock" legend on the last page.',
    'Pages 10–19: every wine\'s vintage moved from the start of the name into the detail ("2024 · Eden Valley, SA ○") so names stay stable across vintages; the pairing marks ○ △ ◇ follow the region there because the template generates legends only for dietary tags and the •/** flags. The binder prints the vintage as a muted prefix.',
    'Page 10: "Bubbles" is its own one-column table ("150 mL", suffix "150 mL pour") because the binder prices bubbles by the 150 mL pour only; the template prints a column header per table, so this page carries three header rows where the binder has one.',
    'Page 11: "Sweet & fortified" is a table with columns "60 mL" and "375 mL btl" (the binder spells the sizes in the region tail of its single row); its callout is the section subheading.',
    'Pages 13 and 17: the mood labels (Crisp & refreshing, Aromatic & textural, Mineral & complex; Light & juicy, Medium-bodied & versatile, Full-bodied & bold) are the headerSuffix of one table each under the same style title, so they print as "OTHER WHITES / Crisp & refreshing" heads rather than the binder\'s small labels between rows. "cont." heads on pages 15, 18 and 19 keep their suffix as printed.',
    'Pages 20–23: the binder sets tequila and mezcal in two dense columns with the pour-size callouts spanning both and a "• Staff pick" legend on each page; here the callouts are a text block titled "Tequila" / "Mezcal" at the top of each page, the groups print in the template\'s two-column A5-landscape flow, and the marks legend prints on the cover and last page — check the fill probe for overflow before publishing.',
    'Page 5 "Fortaleza Blanco" prints an empty ABV span in the binder (nothing visible); no meta is set here.'
  ],
  document
};
