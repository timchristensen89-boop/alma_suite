// Board + nav vocabulary shared by the register (App.tsx) and the board
// editor (BoardEditor.tsx). Both surfaces MUST agree on pin shapes, tab
// tokens and page breaks — a preview that paginates differently from the
// real board is worse than no preview, so the maths lives here once.
import type { CSSProperties } from 'react';

export type MenuItem = {
  recipeId: string;
  title: string;
  /** Venue-twin link — twins point at one canonical recipe of their group. */
  canonicalId?: string | null;
  /** Per-venue price overrides (RecipeVenuePrice), keyed by venue name. */
  venuePrices?: Record<string, number> | null;
  // Kitchen docket/KDS override name (Items → Print name in Stock). Register
  // tile, bill and receipts always show `title` — only the cart line's
  // snapshot for printing reads this.
  printTitle?: string | null;
  priceCents: number;
  venue: string | null;
  variantOf?: string | null;
  variants?: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null; label: string }> | null;
};
export type MenuCategory = { name: string; kind: string; items: MenuItem[] };

// c = colour (hue name, or a legacy hex), label = display-only rename,
// s = tile size, d = label style. Every pin kind carries the same extras.
// look: folder pins only — square tiles (default) or full-menu list rows.
export type PinExtras = { c?: string; label?: string; s?: 'w' | 'b'; d?: 'sh' | 'hs' | 'big'; look?: 'tiles' | 'list' };
// Folders nest: Wine → Red → By the glass. `folders` is optional so every
// board saved before nesting existed still parses; absent means none.
export type FolderPin = { t: 'f'; name: string; items: string[]; folders?: FolderPin[] } & PinExtras;
export type Pin =
  | ({ t: 'i'; id: string } & PinExtras)
  | FolderPin
  // 'm' = a management action (open till, wastage…). Same tile, same board.
  | ({ t: 'm'; key: string } & PinExtras);

// ── Folder paths ────────────────────────────────────────────────────────
// The register's activeCategory token for "inside a folder" encodes the
// route from the home board: `__folder__3` is root pin 3, `__folder__3.0.1`
// is that folder's first subfolder's second subfolder. Old saved tokens
// (single index) are the one-segment case of the same format.
export const MAX_FOLDER_DEPTH = 3;

export function folderPathToken(path: number[]): string {
  return `__folder__${path.join('.')}`;
}

export function parseFolderPath(token: string): number[] | null {
  if (!token.startsWith('__folder__')) return null;
  const path = token.slice('__folder__'.length).split('.').map(Number);
  return path.length > 0 && path.every((n) => Number.isInteger(n) && n >= 0) ? path : null;
}

export function folderAtPath(pins: Pin[], path: number[]): FolderPin | null {
  const [head, ...rest] = path;
  if (head === undefined) return null;
  const root = pins[head];
  if (!root || root.t !== 'f') return null;
  let folder: FolderPin = root;
  for (const index of rest) {
    const child = folder.folders?.[index];
    if (!child) return null;
    folder = child;
  }
  return folder;
}

// Rebuild the pin list with the folder at `path` replaced by update(folder);
// update returning null deletes it from its parent. Everything off the path
// keeps its identity, so this is safe to hand straight to setState.
export function updateFolderAtPath(pins: Pin[], path: number[], update: (folder: FolderPin) => FolderPin | null): Pin[] {
  const [head, ...rest] = path;
  if (head === undefined) return pins;
  const target = pins[head];
  if (!target || target.t !== 'f') return pins;
  const walk = (folder: FolderPin, at: number[]): FolderPin | null => {
    if (at.length === 0) return update(folder);
    const [next, ...tail] = at as [number, ...number[]];
    const child = folder.folders?.[next];
    if (!child) return folder;
    const replaced = walk(child, tail);
    const folders = (folder.folders ?? []).flatMap((entry, i) => (i === next ? (replaced ? [replaced] : []) : [entry]));
    const rebuilt: FolderPin = { ...folder, folders };
    if (!folders.length) delete rebuilt.folders;
    return rebuilt;
  };
  const replaced = walk(target, rest);
  return replaced ? pins.map((pin, i) => (i === head ? replaced : pin)) : pins.filter((_, i) => i !== head);
}

// Everything a folder holds, subfolders included — the count its tile shows.
export function folderItemCount(folder: FolderPin): number {
  return folder.items.length + (folder.folders ?? []).reduce((sum, child) => sum + folderItemCount(child), 0);
}

export function folderDepth(folder: FolderPin): number {
  return 1 + Math.max(0, ...(folder.folders ?? []).map(folderDepth));
}

// icons: per-category mark overrides, name -> IconKey ('' = deliberately
// none). Absent means "use the automatic match".
export type TabsConfig = {
  order: string[];
  hidden: string[];
  // Per-category item rendering, keyed by category name. Absent = tiles —
  // folders and categories share one default look, overridable per entity.
  looks?: Record<string, 'tiles' | 'list'>;
  // look: how the folder's items render on the register — square tiles
  // (the Home-page look) or full-menu list rows. Absent = tiles.
  groups: Array<{ name: string; cats: string[]; c?: string; look?: 'tiles' | 'list' }>;
  icons?: Record<string, string>;
};

export type HomeConfig = {
  buttons: string[];
  pins: Pin[];
  landingCategory?: string | null;
  categories?: TabsConfig | null;
  buttonSizes?: Record<string, 'w' | 'b'>;
};

export const HOME_TAB = '★ Home';

export const MGMT_LABELS: Record<string, string> = {
  'open-till': 'Open till',
  discount: 'Discount',
  comp: 'Comp',
  wastage: 'Wastage',
  price: 'Change price',
  'gift-sell': 'Sell gift card'
};
export const MGMT_KEYS = Object.keys(MGMT_LABELS);

export const BRIGHT_PALETTE = ['', 'terra', 'amber', 'moss', 'slate', 'shell', 'cocoa'];
export const HUE_NAMES = ['terra', 'amber', 'moss', 'slate', 'shell', 'cocoa'];
// Swatch dot colours for the pickers (light-theme tile inks).
export const HUE_DOTS: Record<string, string> = {
  terra: '#9a3a2e',
  amber: '#b5772f',
  moss: '#4f6b47',
  slate: '#4d5e7a',
  shell: '#a8613f',
  cocoa: '#684a4a'
};

export function hueClass(c?: string) {
  return c && HUE_NAMES.includes(c) ? `pos-hue-${c}` : '';
}

export function hueStyle(c?: string): CSSProperties | undefined {
  return c && !HUE_NAMES.includes(c) ? { borderColor: c, background: `${c}26` } : undefined;
}

// How a pinned tile shows its name: default heading+sub, 'sh' abbreviated
// (initials or first four letters), 'hs' larger heading with the sub line,
// 'big' one large title only. Kitchen-facing names never change.
export function pinDisplay(pin: Pin, baseName: string): { main: string; cls: string } {
  const name = (pin.label ?? baseName).trim() || baseName;
  if (pin.d === 'sh') {
    const words = name.split(/\s+/).filter(Boolean);
    const short = words.length >= 2 ? words.map((word) => word[0]).join('').toUpperCase() : name.slice(0, 4).toUpperCase();
    return { main: short, cls: 'pos-label-short' };
  }
  if (pin.d === 'big') return { main: name, cls: 'pos-label-big' };
  if (pin.d === 'hs') return { main: name, cls: 'pos-label-hs' };
  return { main: name, cls: '' };
}

// ── Category icons ──────────────────────────────────────────────────────
// Hand-drawn line marks, not emoji: one ink colour (currentColor), even
// stroke weight, no fills — they sit with the serif wordmark instead of
// shouting over it. Matched on the category (or dish) name.
//
// Order matters: "Espresso Martini" must read as a cocktail, not a coffee,
// so the drinks patterns are tested before the kitchen ones. No match =
// no mark; a wrong one is worse than none.
export type IconKey =
  // Bar
  | 'cocktail' | 'spirit' | 'shot' | 'saltlime' | 'wine' | 'wineLarge' | 'wineSmall'
  | 'beer' | 'soft' | 'coffee'
  | 'flute' | 'rocks' | 'highball' | 'pitcher' | 'tiki' | 'bottle' | 'can'
  | 'teapot' | 'blender' | 'frozen'
  // Kitchen
  | 'taco' | 'burrito' | 'plate' | 'fish' | 'meat' | 'salad' | 'dessert'
  | 'side' | 'setmenu' | 'dip' | 'bread' | 'cheese' | 'pizza' | 'pasta'
  | 'burger' | 'egg' | 'snack'
  | 'soup' | 'noodles' | 'sandwich' | 'skewer' | 'prawn' | 'oyster'
  | 'empanada' | 'nachos' | 'molcajete' | 'churros' | 'icecream' | 'cakeslice'
  | 'pancakes' | 'donut'
  // Fresh
  | 'watermelon' | 'pineapple' | 'coconut' | 'leaf'
  // Mexico
  | 'sombrero' | 'cactus' | 'chilli' | 'agave' | 'lime' | 'avocado' | 'corn'
  | 'skull' | 'maracas' | 'bunting'
  | 'guitar' | 'luchador' | 'pyramid' | 'sun' | 'wave' | 'palm' | 'surfboard'
  // Structure + service
  | 'kids' | 'star' | 'folder' | 'folderOpen'
  | 'gift' | 'takeaway' | 'clock' | 'flame' | 'crown' | 'heart' | 'sparkles' | 'tag';

const ICON_RULES: Array<[RegExp, IconKey]> = [
  // The specific mark always outranks the family that would swallow it:
  // "Frozen Margarita" is a frozen thing first and a margarita second,
  // "Sparkling Rosé" pours into a flute, not a wine glass. Order is the
  // whole game.
  [/frozen|slush|blended/i, 'frozen'],
  [/smoothie|milkshake|thickshake/i, 'blender'],
  [/tiki|colada|mai tai|zombie|painkiller/i, 'tiki'],
  [/spritz|highball|collins|\bmule\b|\bfizz\b/i, 'highball'],
  [/old fashioned|on the rocks|\bneat\b/i, 'rocks'],
  [/sangria|pitcher|\bjug\b|carafe/i, 'pitcher'],
  [/margarita|cocktail|martini|negroni|aperol|daiquiri|mojito|paloma/i, 'cocktail'],
  [/\bshot\b|shooter|slammer/i, 'shot'],
  [/salt.*lime|lime.*salt|tequila set/i, 'saltlime'],
  [/whisk|gin\b|vodka|rum\b|tequila|mezcal|spirit|liqueur|amaro|brandy/i, 'spirit'],
  [/sparkling|prosecco|champagne|bubbles|cava|p[eé]t.?nat/i, 'flute'],
  [/bottle ?shop|full bottles|\bbottles?\b/i, 'bottle'],
  [/wine|rosé|rose\b|chardonnay|pinot|riesling|sauv|shiraz|merlot|by the glass/i, 'wine'],
  [/seltzer|\brtd\b|tinnies?|\bcans?\b/i, 'can'],
  [/beer|lager|ale\b|xpa|ipa\b|pilsner|cider|schooner/i, 'beer'],
  [/coconut/i, 'coconut'],
  [/watermelon|sand[ií]a/i, 'watermelon'],
  [/pineapple|pi[nñ]a\b/i, 'pineapple'],
  [/non.?alcohol|soft drink|juice|soda|mocktail|lemonade|water/i, 'soft'],
  [/\btea\b|chai|matcha/i, 'teapot'],
  [/coffee|espresso|latte|cappucc|flat white/i, 'coffee'],
  [/burrito|chimichanga/i, 'burrito'],
  [/empanada|pastie|pasty/i, 'empanada'],
  [/nachos?|totopos|corn chips/i, 'nachos'],
  [/taco|tostada|quesadilla|tortilla/i, 'taco'],
  [/oysters?\b/i, 'oyster'],
  [/prawns?|shrimp/i, 'prawn'],
  [/fish|seafood|kingfish|ceviche|squid|octopus|scallop/i, 'fish'],
  [/skewer|kebab|satay|anticucho|espetada/i, 'skewer'],
  [/steak|beef|lamb|pork|chicken|carnitas|birria|barbacoa|meat|brisket|rib\b/i, 'meat'],
  [/guac|avocado/i, 'avocado'],
  [/elote|corn|esquites/i, 'corn'],
  [/spicy|picante|diablo|fuego|inferno/i, 'flame'],
  [/chilli|chili|jalapeno|jalapeño|habanero|chipotle|hot sauce/i, 'chilli'],
  [/lime|citrus|lemon/i, 'lime'],
  [/agave/i, 'agave'],
  [/cactus|nopal/i, 'cactus'],
  [/vegan|vegetarian|plant.?based|veggie/i, 'leaf'],
  [/salad|veg|greens|slaw|cauliflower/i, 'salad'],
  [/soup|broth|pozole|caldo|laksa/i, 'soup'],
  [/noodle|ramen|udon|soba|chow mein/i, 'noodles'],
  [/ice ?cream|gelato|soft serve|sundae/i, 'icecream'],
  [/churros?/i, 'churros'],
  [/pancake|hotcake|waffle|french toast/i, 'pancakes'],
  [/donut|doughnut|bu[nñ]uelo/i, 'donut'],
  [/cakes?\b|cheesecake|tres leches/i, 'cakeslice'],
  [/dessert|flan|sweet|pudding/i, 'dessert'],
  [/kids?\b|child/i, 'kids'],
  [/side|fries|chips|beans|rice/i, 'side'],
  [/set menu|banquet|feed me|share|degustation/i, 'setmenu'],
  [/molcajete/i, 'molcajete'],
  [/dip|hummus|salsa/i, 'dip'],
  [/sandwich|toastie|panini|baguette|sanga/i, 'sandwich'],
  [/bread|bakery|sourdough|bun\b/i, 'bread'],
  [/cheese|burrata|halloumi|queso/i, 'cheese'],
  [/pizza/i, 'pizza'],
  [/pasta|gnocchi|risotto/i, 'pasta'],
  [/burger/i, 'burger'],
  [/breakfast|brunch|egg/i, 'egg'],
  [/snack|nuts|olives|bar snack/i, 'snack'],
  [/plate|main|dish|banquet plate/i, 'plate'],
  [/pi[nñ]ata|fiesta|party|celebration/i, 'bunting'],
  [/day of the dead|calavera|muerto/i, 'skull'],
  [/mariachi|guitar|live music|\bband\b/i, 'guitar'],
  [/lucha|wrestl/i, 'luchador'],
  [/pyramid|aztec|mayan?\b/i, 'pyramid'],
  [/\bsun\b|sunshine|sunset/i, 'sun'],
  [/surfboards?\b/i, 'surfboard'],
  [/waves?\b|swell\b/i, 'wave'],
  [/palm|tropical|beach|island/i, 'palm'],
  [/gift|voucher/i, 'gift'],
  [/take.?away|to.?go\b/i, 'takeaway'],
  [/happy hour|aperitivo/i, 'clock'],
  [/premium|top shelf|reserva|reserve/i, 'crown'],
  [/favourite|favorite|popular|best.?seller/i, 'heart'],
  [/\bnew\b|just in|limited/i, 'sparkles'],
  [/deals?\b|promos?\b|discounts?\b|offers?\b/i, 'tag'],
  [/special/i, 'star']
];

const iconCache = new Map<string, IconKey | ''>();
export const ICON_KEYS: IconKey[] = [
  'cocktail', 'spirit', 'shot', 'saltlime', 'wine', 'wineLarge', 'wineSmall', 'beer', 'soft', 'coffee',
  'flute', 'rocks', 'highball', 'pitcher', 'tiki', 'bottle', 'can', 'teapot', 'blender', 'frozen',
  'taco', 'burrito', 'plate', 'fish', 'meat', 'salad', 'dessert', 'side', 'setmenu', 'dip',
  'bread', 'cheese', 'pizza', 'pasta', 'burger', 'egg', 'snack',
  'soup', 'noodles', 'sandwich', 'skewer', 'prawn', 'oyster', 'empanada', 'nachos',
  'molcajete', 'churros', 'icecream', 'cakeslice', 'pancakes', 'donut',
  'watermelon', 'pineapple', 'coconut', 'leaf',
  'sombrero', 'cactus', 'chilli', 'agave', 'lime', 'avocado', 'corn', 'skull', 'maracas', 'bunting',
  'guitar', 'luchador', 'pyramid', 'sun', 'wave', 'palm', 'surfboard',
  'kids', 'star', 'folder', 'folderOpen',
  'gift', 'takeaway', 'clock', 'flame', 'crown', 'heart', 'sparkles', 'tag'
];
export function isIconKey(value: unknown): value is IconKey {
  return typeof value === 'string' && (ICON_KEYS as string[]).includes(value);
}

// A hand-picked mark always beats the guess; '' means "no mark here".
export function iconKeyFor(name: string, overrides?: Record<string, string>): IconKey | '' {
  if (overrides && name in overrides) {
    const chosen = overrides[name];
    return isIconKey(chosen) ? chosen : '';
  }
  if (!name) return '';
  const hit = iconCache.get(name);
  if (hit !== undefined) return hit;
  const found = ICON_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? '';
  iconCache.set(name, found);
  return found;
}

// Four ways to wear the same drawings. 'line' and 'bold' are the silhouette
// alone; 'premium' adds the detail layer at a finer weight; 'colour' fills
// it. All inherit the surrounding ink except where a fill is given.
export type IconStyle = 'line' | 'solid' | 'premium' | 'colour' | 'off';
export const ICON_STYLES: Array<{ key: IconStyle; label: string; hint: string }> = [
  { key: 'line', label: 'Sketch', hint: 'fine hand-drawn line' },
  { key: 'solid', label: 'Bold', hint: 'heavier stroke' },
  { key: 'premium', label: 'Premium', hint: 'fine line with inner detail' },
  { key: 'colour', label: 'Colour', hint: 'filled, warm palette' },
  { key: 'off', label: 'None', hint: 'text only' }
];

// d      = the silhouette, always stroked
// detail = inner lines, only on premium + colour (seeds, segments, texture)
// fill   = the shape to flood on the colour set (defaults to d)
// c      = that flood colour
type IconArt = { d: string; detail?: string; fill?: string; c?: string };

const TERRA = '#c96a4f';
const AMBER = '#d79a45';
const MOSS = '#6f8f5c';
const DEEP = '#4f6b47';
const SLATE = '#7c8ea8';
const SHELL = '#e2c9a8';
const COCOA = '#9a7458';
const CREAM = '#f3e8d6';
const LIMEC = '#9fc05a';
const CLAY = '#b8543c';

// 24x24 on one optical baseline (cap ~4, foot ~20) so a row sits level.
const ICON_ART: Record<IconKey, IconArt> = {
  // ── Bar ────────────────────────────────────────────────────────────────
  cocktail: {
    d: 'M5.2 6.4h13.6c0 3.9-3 6.6-6.8 6.6S5.2 10.3 5.2 6.4ZM12 13v6.1M8.6 19.4c1.4-.7 5.4-.7 6.8 0',
    detail: 'M8.2 8.4c1.4 1.6 6.2 1.6 7.6 0M15.6 5.2a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0',
    fill: 'M5.2 6.4h13.6c0 3.9-3 6.6-6.8 6.6S5.2 10.3 5.2 6.4Z', c: AMBER
  },
  spirit: {
    d: 'M7.4 6.6h9.2l-1 12.2a1.5 1.5 0 0 1-1.5 1.3h-4.2a1.5 1.5 0 0 1-1.5-1.3ZM8.1 13.4h7.8',
    detail: 'M9.4 15.8h5.2M7.9 9.6h8.2',
    fill: 'M8.1 13.4h7.8l-.5 5.4a1.5 1.5 0 0 1-1.5 1.3h-4.2a1.5 1.5 0 0 1-1.5-1.3Z', c: COCOA
  },
  // Short, heavy-based glass — the tequila shot.
  shot: {
    d: 'M8.2 6.8h7.6l-.7 10.4a1.5 1.5 0 0 1-1.5 1.4h-3.2a1.5 1.5 0 0 1-1.5-1.4ZM8.6 18.6h6.8',
    detail: 'M8.7 11.4h6.6',
    fill: 'M8.7 11.4h6.6l-.5 5.8a1.5 1.5 0 0 1-1.5 1.4h-3.2a1.5 1.5 0 0 1-1.5-1.4Z', c: AMBER
  },
  // Lime wedge with a little heap of salt beside it.
  saltlime: {
    d: 'M4.2 16.4a6.4 6.4 0 0 1 11.2 0ZM4.2 16.4h11.2M17 19.4c.5-2.6 1.4-4 2.6-4.2M16.4 19.4h5',
    detail: 'M9.8 12.4v4M6.9 14.1l1.4 2.3M12.7 14.1l-1.4 2.3M18.4 16.6h.01M20 17.8h.01M17.6 18.4h.01',
    fill: 'M4.2 16.4a6.4 6.4 0 0 1 11.2 0Z', c: LIMEC
  },
  wine: {
    d: 'M7.6 3.6h8.8v4.1a4.4 4.4 0 0 1-8.8 0ZM7.7 7.7h8.6M12 12.2v7.2M9 19.7c1.2-.6 4.8-.6 6 0',
    detail: 'M9.4 5.6h5.2',
    fill: 'M7.7 7.7h8.6a4.4 4.4 0 0 1-8.6 0Z', c: CLAY
  },
  // A big bowl, filled — the "large glass" pour.
  wineLarge: {
    d: 'M6.2 3.4h11.6v5.2a5.8 5.8 0 0 1-11.6 0ZM12 14.4v5M8.6 19.6c1.6-.7 5.2-.7 6.8 0',
    detail: 'M6.6 7.2c2.6 1.8 8.2 1.8 10.8 0',
    fill: 'M6.6 7.2c2.6 1.8 8.2 1.8 10.8 0a5.8 5.8 0 0 1-10.8 0Z', c: CLAY
  },
  // The 150ml pour: same shape, smaller bowl, less in it.
  wineSmall: {
    d: 'M8.4 5.4h7.2v3.4a3.6 3.6 0 0 1-7.2 0ZM12 12.6v6.6M9.2 19.5c1.2-.6 4.4-.6 5.6 0',
    detail: 'M8.7 8.1c1.9 1.2 4.7 1.2 6.6 0',
    fill: 'M8.7 8.1c1.9 1.2 4.7 1.2 6.6 0a3.6 3.6 0 0 1-6.6 0Z', c: CLAY
  },
  beer: {
    d: 'M6.4 8.3h9.4v10.4a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6ZM15.8 10.6h2.3a1.5 1.5 0 0 1 1.5 1.5v2.6a1.5 1.5 0 0 1-1.5 1.5h-2.3M6.6 8.3c.8-1.6 2.4-2.2 3.6-1.3 1-1.4 3.4-1.4 4.4 0',
    detail: 'M9 11.4v6M12.6 11.4v6',
    fill: 'M6.4 11h9.4v7.7a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6Z', c: AMBER
  },
  soft: {
    d: 'M7.6 7.4h8.8l-1.1 11.4a1.5 1.5 0 0 1-1.5 1.3h-3.6a1.5 1.5 0 0 1-1.5-1.3ZM13.4 7.2 15.6 3M8.2 11.4h7.6',
    detail: 'M10.4 13.8v3.6M13 13.8v3.6',
    fill: 'M8.2 11.4h7.6l-.7 7.4a1.5 1.5 0 0 1-1.5 1.3h-3.6a1.5 1.5 0 0 1-1.5-1.3Z', c: TERRA
  },
  coffee: {
    d: 'M5.6 9.2h10.6v5.4a4.6 4.6 0 0 1-4.6 4.6H10.2a4.6 4.6 0 0 1-4.6-4.6ZM16.2 10.8h1.9a2 2 0 0 1 0 4h-1.9M4.4 20.4h13M9.6 6.4c1-.9-.6-1.8.4-2.8M13 6.4c1-.9-.6-1.8.4-2.8',
    detail: 'M6.9 11.4h8',
    fill: 'M5.6 11.4h10.6v3.2a4.6 4.6 0 0 1-4.6 4.6H10.2a4.6 4.6 0 0 1-4.6-4.6Z', c: COCOA
  },

  // ── Kitchen ────────────────────────────────────────────────────────────
  // Folded shell, filling spilling, a wedge of lime on the side.
  taco: {
    d: 'M3.2 16.8a8.8 8.8 0 0 1 17.6 0ZM3.2 16.8c1.8 1.6 16 1.6 17.6 0',
    detail: 'M6.6 13.6c1.2-1.4 2.8-1.6 4-.4M11.4 12.2c1.2-1.1 2.7-1 3.8.2M8.4 15.6c.9-.9 2-.9 2.9 0M13 15.4c.9-.8 1.9-.8 2.7.1',
    fill: 'M3.2 16.8a8.8 8.8 0 0 1 17.6 0Z', c: SHELL
  },
  burrito: {
    d: 'M5.4 17.8 15.2 5.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 9.2a3 3 0 0 1-4.4 0Z',
    detail: 'M9.6 12.4c1.6 1.4 3.2 2.8 4.8 4M12.4 9.2c1.6 1.4 3.2 2.8 4.8 4',
    fill: 'M5.4 17.8 15.2 5.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 9.2a3 3 0 0 1-4.4 0Z', c: SHELL
  },
  // A plated main, seen from the side: dome of food on a wide rim.
  plate: {
    d: 'M2.6 15.6h18.8a4.6 4.6 0 0 1-4.6 3.6H7.2a4.6 4.6 0 0 1-4.6-3.6ZM7 15.6a5 5 0 0 1 10 0',
    detail: 'M9.2 13.4c1.2-1.2 3-1.4 4.4-.4M10.6 15.4c.7-.8 1.6-1 2.5-.6',
    fill: 'M7 15.6a5 5 0 0 1 10 0Z', c: TERRA
  },
  fish: {
    d: 'M3.6 12.3c3.6-4.6 10.4-4.6 14 0-3.6 4.6-10.4 4.6-14 0ZM17.6 12.3c1.1-1.4 2.1-2.3 2.8-2.6.3 1.7.3 3.5 0 5.2-.7-.3-1.7-1.2-2.8-2.6M8.4 11.6h.01',
    detail: 'M6.5 12.3c.9.7 1.8 1.3 2.7 1.7M11.4 9.6c.6 1.8.6 3.6 0 5.4',
    fill: 'M3.6 12.3c3.6-4.6 10.4-4.6 14 0-3.6 4.6-10.4 4.6-14 0Z', c: SLATE
  },
  meat: {
    d: 'M6.6 12.2a5.6 5.6 0 0 1 11 1.4c0 2.6-2.2 4.6-5.2 4.6s-5.8-1.6-5.8-4.2ZM8.6 18.6c-1.2 1-2.8.8-3.4-.4-.9.3-1.8-.4-1.7-1.4',
    detail: 'M9.6 13.2a2.6 2.6 0 0 1 4.6 1',
    fill: 'M6.6 12.2a5.6 5.6 0 0 1 11 1.4c0 2.6-2.2 4.6-5.2 4.6s-5.8-1.6-5.8-4.2Z', c: CLAY
  },
  salad: {
    d: 'M3.6 12.4h16.8a8.4 8.4 0 0 1-16.8 0ZM12 12.4c-2.4-2-2-5.4.6-6.6 1.3 2.5.9 5-.6 6.6Z',
    detail: 'M12 12.4c-.6-1.7-2.4-2.6-4-2M7.6 15.4c1.4 1 3 1.4 4.4 1.2',
    fill: 'M3.6 12.4h16.8a8.4 8.4 0 0 1-16.8 0Z', c: MOSS
  },
  dessert: {
    d: 'M8.2 9.6a3.8 3.8 0 0 1 7.6 0ZM7.6 9.6h8.8L12 20.4Z',
    detail: 'M9.8 13.2l3.4 3.6M13.6 12.6l-2.6 2.8',
    fill: 'M8.2 9.6a3.8 3.8 0 0 1 7.6 0Z', c: CREAM
  },
  side: {
    d: 'M8 10.6h8l-.9 8.2a1.6 1.6 0 0 1-1.6 1.4h-3a1.6 1.6 0 0 1-1.6-1.4ZM9 10.6 9.7 5M12 10.6V4.2M15 10.6 14.3 5.4',
    detail: 'M10.4 13.2v4M13.6 13.2v4',
    fill: 'M8 10.6h8l-.9 8.2a1.6 1.6 0 0 1-1.6 1.4h-3a1.6 1.6 0 0 1-1.6-1.4Z', c: AMBER
  },
  setmenu: {
    d: 'M7.6 3.8v5.4a2 2 0 0 0 2 2h.2v9M7.6 3.8v4.4M9.8 3.8v4.4M16.6 3.8c-1.6 1.6-2 4.4-1.6 6.6h3.2c.4-2.2 0-5-1.6-6.6Zm0 6.6v9.8',
    detail: 'M8.7 3.8v4.4',
    fill: '', c: SLATE
  },
  dip: {
    d: 'M4.4 13.4h15.2a7.6 7.6 0 0 1-15.2 0ZM9.4 9.6c.8-1.4 2.4-1.8 3.6-.8M8.4 6.6c1.4-1 3-.8 4.2.4',
    detail: 'M7.4 15.6c2.6 1.4 6.6 1.4 9.2 0',
    fill: 'M4.4 13.4h15.2a7.6 7.6 0 0 1-15.2 0Z', c: MOSS
  },
  bread: {
    d: 'M4.4 10.4c0-3 3.4-4.8 7.6-4.8s7.6 1.8 7.6 4.8v7.4a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2Z',
    detail: 'M8.2 9.4c.6 1.2.6 2.6 0 3.8M12 9.2c.6 1.3.6 2.8 0 4.1M15.8 9.4c.6 1.2.6 2.6 0 3.8',
    fill: 'M4.4 10.4c0-3 3.4-4.8 7.6-4.8s7.6 1.8 7.6 4.8v7.4a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2Z', c: COCOA
  },
  cheese: {
    d: 'M3.6 15.4 12.4 8h7.2a.8.8 0 0 1 .8.8v6.6ZM3.6 15.4v2.8a.8.8 0 0 0 .8.8h15.2a.8.8 0 0 0 .8-.8v-2.8',
    detail: 'M8.4 13.6h.01M13.6 12.4h.01M16.4 15.8h.01',
    fill: 'M3.6 15.4 12.4 8h7.2a.8.8 0 0 1 .8.8v6.6Z', c: AMBER
  },
  pizza: {
    d: 'M12 3.6c3.6 2.4 6.4 6.6 8 12.4-5.2 2.2-10.8 2.2-16 0 1.6-5.8 4.4-10 8-12.4Z',
    detail: 'M5.4 15.2c4.4 1.8 8.8 1.8 13.2 0M10.2 10.4h.01M13.8 11.6h.01M11.8 14.6h.01',
    fill: 'M12 3.6c3.6 2.4 6.4 6.6 8 12.4-5.2 2.2-10.8 2.2-16 0 1.6-5.8 4.4-10 8-12.4Z', c: SHELL
  },
  pasta: {
    d: 'M4.4 11.6h15.2a7.6 7.6 0 0 1-15.2 0ZM4.4 11.6c0-3 3.4-5 7.6-5s7.6 2 7.6 5M6.6 20.4h10.8',
    detail: 'M8.4 9.4c1.4-1.2 3-1.6 4.6-1.2',
    fill: 'M4.4 11.6h15.2a7.6 7.6 0 0 1-15.2 0Z', c: AMBER
  },
  burger: {
    d: 'M4.4 10.4c0-3.2 3.4-5.4 7.6-5.4s7.6 2.2 7.6 5.4ZM4.4 12.9h15.2M4.6 15.4h14.8c0 2.8-3.2 4.6-7.4 4.6s-7.4-1.8-7.4-4.6Z',
    detail: 'M9 8.2h.01M13.4 7.6h.01',
    fill: 'M4.4 10.4c0-3.2 3.4-5.4 7.6-5.4s7.6 2.2 7.6 5.4Z', c: COCOA
  },
  egg: {
    d: 'M11.4 4.6c3.4 0 6 3.8 6 7.4a6 6 0 0 1-12 0c0-3.6 2.6-7.4 6-7.4ZM11.4 13.4a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8',
    detail: 'M17.4 12h3.2',
    fill: 'M11.4 13.4a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8Z', c: AMBER
  },
  snack: {
    d: 'M4 13.6h16a8 8 0 0 1-16 0ZM9 11a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4M14.6 12.6a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8',
    detail: 'M9 8.8h.01',
    fill: 'M4 13.6h16a8 8 0 0 1-16 0Z', c: DEEP
  },

  // ── Mexico ─────────────────────────────────────────────────────────────
  // Wide brim, tall crown, banded.
  sombrero: {
    d: 'M2.4 16.6c0-1.4 2.6-2.4 5.2-2.8.6-4 2-6.4 4.4-6.4s3.8 2.4 4.4 6.4c2.6.4 5.2 1.4 5.2 2.8 0 1.8-4.3 2.8-9.6 2.8S2.4 18.4 2.4 16.6Z',
    detail: 'M7.6 13.8c2.9-.7 5.9-.7 8.8 0M8.4 16.2c2.4.5 4.8.5 7.2 0',
    fill: 'M2.4 16.6c0-1.4 2.6-2.4 5.2-2.8.6-4 2-6.4 4.4-6.4s3.8 2.4 4.4 6.4c2.6.4 5.2 1.4 5.2 2.8 0 1.8-4.3 2.8-9.6 2.8S2.4 18.4 2.4 16.6Z', c: AMBER
  },
  // Saguaro with two arms.
  cactus: {
    d: 'M9.6 20.4V8.6a2.4 2.4 0 0 1 4.8 0v11.8ZM9.6 13.8H7.8a2 2 0 0 1-2-2v-1.6M14.4 12.2h1.9a2 2 0 0 0 2-2V8.4M7.4 20.4h9.2',
    detail: 'M12 10.6v6.4M10.8 9.4v1M13.2 11v1',
    fill: 'M9.6 20.4V8.6a2.4 2.4 0 0 1 4.8 0v11.8Z', c: DEEP
  },
  chilli: {
    d: 'M7 12.4c3.4-1.2 7.4.6 8.6 4 .5 1.4-.4 2.8-1.9 3-3.9.5-7.3-2.2-7.6-6-.1-1 .4-1.4.9-1ZM15.2 8.2c1.2-1.6 3-2 4.4-1.2',
    detail: 'M15.6 8.4c-.9 1.2-1.6 2.6-2 4M9.4 14c1.4.2 2.7 1 3.5 2.2',
    fill: 'M7 12.4c3.4-1.2 7.4.6 8.6 4 .5 1.4-.4 2.8-1.9 3-3.9.5-7.3-2.2-7.6-6-.1-1 .4-1.4.9-1Z', c: CLAY
  },
  agave: {
    d: 'M12 20.2 12 9M12 20.2c-3-1.6-5.4-4.6-6-8.4 3 .6 5.2 3 6 5.6M12 20.2c3-1.6 5.4-4.6 6-8.4-3 .6-5.2 3-6 5.6M12 14.6c-.6-3 .4-6 2.6-8-2.6-.2-4.6 1.4-5.4 3.6',
    detail: 'M8.4 13.8c1.3.7 2.4 1.7 3.2 3M15.6 13.8c-1.3.7-2.4 1.7-3.2 3',
    fill: '', c: DEEP
  },
  lime: {
    d: 'M12 4.6a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 0 1 0-14.8Z',
    detail: 'M12 6.6v10.8M6.8 12h10.4M8.4 8.4l7.2 7.2M15.6 8.4l-7.2 7.2',
    fill: 'M12 4.6a7.4 7.4 0 1 1 0 14.8 7.4 7.4 0 0 1 0-14.8Z', c: LIMEC
  },
  avocado: {
    d: 'M12 3.8c3.6 0 6.4 4.2 6.4 8.4a6.4 6.4 0 0 1-12.8 0c0-4.2 2.8-8.4 6.4-8.4Z',
    detail: 'M12 15.6a2.8 2.8 0 1 1 0-5.6 2.8 2.8 0 0 1 0 5.6',
    fill: 'M12 3.8c3.6 0 6.4 4.2 6.4 8.4a6.4 6.4 0 0 1-12.8 0c0-4.2 2.8-8.4 6.4-8.4Z', c: MOSS
  },
  corn: {
    d: 'M12 3.8c2.8 0 4.8 3.4 4.8 7.6s-2 7.4-4.8 7.4-4.8-3.2-4.8-7.4S9.2 3.8 12 3.8ZM12 18.8v1.8',
    detail: 'M9.6 7.4c1.6.8 3.2.8 4.8 0M9.2 10.6c1.8.9 3.8.9 5.6 0M9.4 13.8c1.7.8 3.5.8 5.2 0M12 5.6v13',
    fill: 'M12 3.8c2.8 0 4.8 3.4 4.8 7.6s-2 7.4-4.8 7.4-4.8-3.2-4.8-7.4S9.2 3.8 12 3.8Z', c: AMBER
  },
  // Calavera — a sugar skull, not a warning sign.
  skull: {
    d: 'M12 3.8c4 0 7 3 7 7 0 2.4-1 4-2.4 5v2.2a1.6 1.6 0 0 1-1.6 1.6H9a1.6 1.6 0 0 1-1.6-1.6V15.8C6 14.8 5 13.2 5 10.8c0-4 3-7 7-7Z',
    detail: 'M9.4 10.6a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6M14.6 10.6a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6M12 12.4v1.6M10 16.6v2.4M14 16.6v2.4M12 16.6v2.4',
    fill: 'M12 3.8c4 0 7 3 7 7 0 2.4-1 4-2.4 5v2.2a1.6 1.6 0 0 1-1.6 1.6H9a1.6 1.6 0 0 1-1.6-1.6V15.8C6 14.8 5 13.2 5 10.8c0-4 3-7 7-7Z', c: CREAM
  },
  maracas: {
    d: 'M7.6 4.6a3.4 3.4 0 0 1 3.4 3.4c0 2-1.5 3.4-3.4 3.4A3.4 3.4 0 0 1 4.2 8a3.4 3.4 0 0 1 3.4-3.4ZM7.6 11.4 6 19.8M16.4 8.2a3.4 3.4 0 0 1 3.4 3.4c0 2-1.5 3.4-3.4 3.4a3.4 3.4 0 0 1-3.4-3.4 3.4 3.4 0 0 1 3.4-3.4ZM16.4 15 15 20.4',
    detail: 'M5.8 7.4h3.6M14.6 11h3.6',
    fill: '', c: TERRA
  },
  // Papel picado.
  bunting: {
    d: 'M2.6 6c4.6 2.4 14.2 2.4 18.8 0M5.4 7.4l1.8 4.4 2.4-3.6M10.6 8.6l1.4 4.6 2.6-3.4M15.6 8.2l1.2 4.6 2.6-3.6',
    detail: 'M6.6 9.2h.01M12 10.4h.01M17 10h.01',
    fill: '', c: TERRA
  },

  // ── Structure ──────────────────────────────────────────────────────────
  kids: {
    d: 'M12 3.8a4.1 4.1 0 1 1 0 8.2 4.1 4.1 0 0 1 0-8.2ZM4.8 20.6c.4-3.6 3.4-5.6 7.2-5.6s6.8 2 7.2 5.6',
    detail: 'M10.3 7.6h.01M13.7 7.6h.01M10.6 9.9c.9.6 1.9.6 2.8 0',
    fill: 'M12 3.8a4.1 4.1 0 1 1 0 8.2 4.1 4.1 0 0 1 0-8.2Z', c: SHELL
  },
  star: {
    d: 'M12 3.4 14.6 9l6.1.8-4.5 4.2 1.2 6-5.4-2.9-5.4 2.9 1.2-6L3.3 9.8 9.4 9Z',
    fill: 'M12 3.4 14.6 9l6.1.8-4.5 4.2 1.2 6-5.4-2.9-5.4 2.9 1.2-6L3.3 9.8 9.4 9Z', c: AMBER
  },
  // A closed folder with a tab.
  folder: {
    d: 'M3.4 7.2a1.6 1.6 0 0 1 1.6-1.6h4.2l2 2.4h7.4a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z',
    detail: 'M3.4 11.2h17.2',
    fill: 'M3.4 7.2a1.6 1.6 0 0 1 1.6-1.6h4.2l2 2.4h7.4a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6Z', c: SHELL
  },
  // The same folder, open — for the one you're inside.
  folderOpen: {
    d: 'M3.4 18.4V7.2a1.6 1.6 0 0 1 1.6-1.6h4.2l2 2.4h7.4a1.6 1.6 0 0 1 1.6 1.6v1.2M3.4 18.4l2.6-6.4h15.4l-2.6 6.4a1.6 1.6 0 0 1-1.5 1H5a1.6 1.6 0 0 1-1.6-1Z',
    fill: 'M3.4 18.4l2.6-6.4h15.4l-2.6 6.4a1.6 1.6 0 0 1-1.5 1H5a1.6 1.6 0 0 1-1.6-1Z', c: SHELL
  },

  // ── Bar II ─────────────────────────────────────────────────────────────
  // Tall narrow bowl on a stem — sparkling, prosecco, bubbles.
  flute: {
    d: 'M10 3.8h4v5.4a2 2 0 0 1-4 0ZM12 11.2v6.9M9.3 19.6c1.2-.6 4.2-.6 5.4 0',
    detail: 'M11 5.6h.01M13 6.4h.01M12 7.8h.01',
    fill: 'M10 3.8h4v5.4a2 2 0 0 1-4 0Z', c: AMBER
  },
  // Short tumbler, heavy base line, one big cube — the old fashioned pour.
  rocks: {
    d: 'M6.8 7h10.4l-.7 11.2a1.6 1.6 0 0 1-1.6 1.5H9.1a1.6 1.6 0 0 1-1.6-1.5ZM7.2 15h9.6',
    detail: 'M9.9 11.2l2.1-1.8 2.1 1.8-2.1 1.8Z',
    fill: 'M7.2 15h9.6l-.2 3.2a1.6 1.6 0 0 1-1.6 1.5H9.1a1.6 1.6 0 0 1-1.6-1.5Z', c: AMBER
  },
  // Tall slim glass with a straw — spritzes, mules, anything long.
  highball: {
    d: 'M8.6 5h6.8l-.5 13.6a1.5 1.5 0 0 1-1.5 1.4h-2.8a1.5 1.5 0 0 1-1.5-1.4ZM13.6 5.4 15.8 2.8',
    detail: 'M9.1 8.6h5.8M10.8 11.6h.01M12.6 13.8h.01M11.4 16h.01',
    fill: 'M9.1 8.6h5.8l-.4 10a1.5 1.5 0 0 1-1.5 1.4h-2.8a1.5 1.5 0 0 1-1.5-1.4Z', c: AMBER
  },
  // A carafe with a handle — sangria by the jug.
  pitcher: {
    d: 'M9.4 3.8h4.6v3.5a5.5 5.5 0 1 1-4.6.1ZM14 5.7h1.3a1.7 1.7 0 0 1 1.2 2.9',
    detail: 'M7.4 13.3c2.8 1.4 6.4 1.4 9.2 0',
    fill: 'M7.4 13.3c2.8 1.4 6.4 1.4 9.2 0a5.5 5.5 0 0 1-9.2 0Z', c: TERRA
  },
  // Carved mug with a face — coladas and the tropical list.
  tiki: {
    d: 'M8 4.6h8c.7 4.9.7 9.9 0 14.8H8c-.7-4.9-.7-9.9 0-14.8ZM9.6 10.6c.6-.8 1.6-.8 2.2 0M13 10.6c.6-.8 1.6-.8 2.2 0M9.4 14l1.3 1.1 1.3-1.1 1.3 1.1 1.3-1.1',
    detail: 'M8.4 7.2h7.2M8.6 17.4h6.8',
    fill: 'M8 4.6h8c.7 4.9.7 9.9 0 14.8H8c-.7-4.9-.7-9.9 0-14.8Z', c: COCOA
  },
  // Shouldered bottle with a label band — full bottles, the bottle shop.
  bottle: {
    d: 'M10.6 3.6h2.8v3.3c1.7.9 2.8 2.7 2.8 4.6v6.7a1.6 1.6 0 0 1-1.6 1.6H9.4a1.6 1.6 0 0 1-1.6-1.6v-6.7c0-1.9 1.1-3.7 2.8-4.6Z',
    detail: 'M8.6 12.6h6.8M8.6 15.4h6.8',
    fill: 'M8.6 12.6h6.8v2.8H8.6Z', c: DEEP
  },
  // The tinnie.
  can: {
    d: 'M8.2 6.6c2.5-.9 5.1-.9 7.6 0v11.6c-2.5.9-5.1.9-7.6 0ZM8.2 6.6c2.5.9 5.1.9 7.6 0',
    detail: 'M10.5 4.8l3-.8M10.4 10.2v5.2M13.6 10.2v5.2',
    fill: 'M8.2 6.6c2.5.9 5.1.9 7.6 0v11.6c-2.5.9-5.1.9-7.6 0Z', c: SLATE
  },
  // Pot, spout, lid knob — tea and chai.
  teapot: {
    d: 'M7 13a5 5 0 0 1 10 0v1.6A4.4 4.4 0 0 1 12.6 19h-1.2A4.4 4.4 0 0 1 7 14.6ZM7 13.8 4.4 11.4M17 13.2h.9a1.9 1.9 0 0 1 0 3.8h-1M12 8V6.2M10.4 6.2h3.2',
    detail: 'M9.3 11.6c.6-1.3 2-2 3.4-1.7',
    fill: 'M7 13a5 5 0 0 1 10 0v1.6A4.4 4.4 0 0 1 12.6 19h-1.2A4.4 4.4 0 0 1 7 14.6Z', c: MOSS
  },
  // Jar with a handle on a motor base — smoothies and shakes.
  blender: {
    d: 'M8.6 4.2h6l-.8 8.4H9.4ZM14.4 5.6h1.2a1.5 1.5 0 0 1 1.4 2l-.8 2.2M9.9 12.6h3.4l.3 2.5H9.6ZM7.7 15.1h7.8a1.3 1.3 0 0 1 1.3 1.3v1.7a1.3 1.3 0 0 1-1.3 1.3H7.7a1.3 1.3 0 0 1-1.3-1.3v-1.7a1.3 1.3 0 0 1 1.3-1.3Z',
    detail: 'M9.1 7.2h5M9.5 17.5h.01M11.6 17.5h.01M13.7 17.5h.01',
    fill: 'M9.1 7.2h5l-.5 5.4H9.6Z', c: TERRA
  },
  // Snowflake — the frozen margarita machine.
  frozen: {
    d: 'M12 4.2v15.6M5.3 8.1l13.4 7.8M18.7 8.1 5.3 15.9',
    detail: 'M9.9 5.7 12 7.1l2.1-1.4M9.9 18.3 12 16.9l2.1 1.4M4.9 11l2.4.3.3-2.4M19.1 13l-2.4-.3-.3 2.4',
    fill: '', c: SLATE
  },

  // ── Kitchen II ─────────────────────────────────────────────────────────
  // Bowl with steam — the coffee curls, reused where they belong.
  soup: {
    d: 'M4.6 12.8h14.8a7.4 7.4 0 0 1-14.8 0ZM9.6 9.8c1-.9-.6-1.8.4-2.8M13.2 9.8c1-.9-.6-1.8.4-2.8',
    detail: 'M7.5 15.2c2.7 1.3 6.3 1.3 9 0',
    fill: 'M4.6 12.8h14.8a7.4 7.4 0 0 1-14.8 0Z', c: AMBER
  },
  // Bowl, chopsticks, strands mid-lift.
  noodles: {
    d: 'M4.6 13.2h14.8a7.4 7.4 0 0 1-14.8 0ZM9 10.6l7.4-7M11.3 11l6.5-7.6',
    detail: 'M9.6 8.9v4.3M12 7.7v5.5M14.3 9.3v3.9',
    fill: 'M4.6 13.2h14.8a7.4 7.4 0 0 1-14.8 0Z', c: AMBER
  },
  // Side view: bread slab, lettuce frill, bread slab.
  sandwich: {
    d: 'M4.6 10.6V9.2a1.5 1.5 0 0 1 1.5-1.5h11.8a1.5 1.5 0 0 1 1.5 1.5v1.4ZM4.4 12.9c1.3-1.2 2.5-1.2 3.8 0s2.5 1.2 3.8 0 2.5-1.2 3.8 0 2.5 1.2 3.8 0M4.6 15h14.8v1.2a1.5 1.5 0 0 1-1.5 1.5H6.1a1.5 1.5 0 0 1-1.5-1.5Z',
    detail: 'M7.4 9.2h.01M10.6 9.2h.01M13.8 9.2h.01',
    fill: 'M4.6 10.6V9.2a1.5 1.5 0 0 1 1.5-1.5h11.8a1.5 1.5 0 0 1 1.5 1.5v1.4ZM4.6 15h14.8v1.2a1.5 1.5 0 0 1-1.5 1.5H6.1a1.5 1.5 0 0 1-1.5-1.5Z', c: SHELL
  },
  // Two cubes on a stick.
  skewer: {
    d: 'M4.6 19.4 19.4 4.6M9.5 11.7l2.9 2.9-2.9 2.9-2.9-2.9ZM14.2 7l2.9 2.9-2.9 2.9-2.9-2.9Z',
    detail: 'M8.4 14.6h2.2M13.1 9.9h2.2',
    fill: 'M9.5 11.7l2.9 2.9-2.9 2.9-2.9-2.9ZM14.2 7l2.9 2.9-2.9 2.9-2.9-2.9Z', c: CLAY
  },
  // Curled body with its back segments, fan tail, antenna, eye.
  prawn: {
    d: 'M8 5.6A7.6 7.6 0 1 1 9.4 19 6.9 6.9 0 0 0 8 5.6ZM9.4 19l-3.4 1.3M9.4 19l-.9-3.4M8 5.6C6.5 4.9 5 4.8 3.6 5.2M14.6 6.7l.6 2.5M17.5 9.6l-1.7 1.9M18.3 13.4l-2.5-.1M10.6 7.6h.01',
    detail: 'M16.6 16.4l1.9 1.1',
    fill: 'M8 5.6A7.6 7.6 0 1 1 9.4 19 6.9 6.9 0 0 0 8 5.6Z', c: TERRA
  },
  // Fan shell, ridges to the hinge.
  oyster: {
    d: 'M12 19.6 4.9 12.5a8.3 8.3 0 0 1 14.2 0Z',
    detail: 'M12 19.4 8.2 9.6M12 19.4V8.1M12 19.4l3.8-9.8',
    fill: 'M12 19.6 4.9 12.5a8.3 8.3 0 0 1 14.2 0Z', c: SHELL
  },
  // Half-moon pastry, crimped edge.
  empanada: {
    d: 'M4.6 15.6a7.4 7.4 0 0 1 14.8 0ZM4.6 15.6h14.8M7.2 10.7l1.3 1.4M9.8 8.9l.9 1.7M12.8 8.3l.3 1.9M15.7 9.5l-.7 1.8M17.7 11.8l-1.5 1.2',
    detail: 'M9.7 13.9h.01M12.3 12.9h.01M14.6 14.1h.01',
    fill: 'M4.6 15.6a7.4 7.4 0 0 1 14.8 0Z', c: SHELL
  },
  // Chips poking out of the basket.
  nachos: {
    d: 'M5 13.6h14l-1 4.9a1.6 1.6 0 0 1-1.6 1.3H7.6A1.6 1.6 0 0 1 6 18.5ZM8 13.4l2.5-4.9 2 4.7M12.1 13.4l2.7-5.1 2.5 5',
    detail: 'M6.3 15.9h11.4M10.4 10.9h.01M14.7 10.7h.01',
    fill: 'M5 13.6h14l-1 4.9a1.6 1.6 0 0 1-1.6 1.3H7.6A1.6 1.6 0 0 1 6 18.5Z', c: AMBER
  },
  // Stone bowl on stub legs, pestle resting in — salsa central.
  molcajete: {
    d: 'M5.4 11.4h13.2a6.6 6.6 0 0 1-13.2 0ZM8.8 17.5l-.7 2.1M15.2 17.5l.7 2.1M13.8 10.9l2.7-4.8a1.35 1.35 0 0 1 2.35 1.35L16.6 11',
    detail: 'M9.2 13.4h.01M11.8 14.4h.01M14.2 13.2h.01',
    fill: 'M5.4 11.4h13.2a6.6 6.6 0 0 1-13.2 0Z', c: DEEP
  },
  // Three sticks standing in the cup, sugar ticks.
  churros: {
    d: 'M7 13.8h10l-.8 4.8a1.5 1.5 0 0 1-1.5 1.2H9.3a1.5 1.5 0 0 1-1.5-1.2ZM9.4 13.4 7.8 5.6M12 13.4V4.8M14.6 13.4l1.6-7.4',
    detail: 'M7.3 8.4h2M11 7.2h2M14.6 8.8h2M7.5 16.2h9',
    fill: 'M7 13.8h10l-.8 4.8a1.5 1.5 0 0 1-1.5 1.2H9.3a1.5 1.5 0 0 1-1.5-1.2Z', c: COCOA
  },
  // Scoop on a crosshatched cone.
  icecream: {
    d: 'M7.5 11.4a4.5 4.5 0 1 1 9 0ZM7.5 11.4h9L12 20.2Z',
    detail: 'M9.6 13.6h4.8M10.8 16.2h2.4M10.2 6.9c.5-.5 1.2-.8 1.8-.8',
    fill: 'M7.5 11.4a4.5 4.5 0 1 1 9 0Z', c: CREAM
  },
  // Wedge on its side, layers showing, cherry up top.
  cakeslice: {
    d: 'M4.8 17.4 18.6 6.9v9.1a1.4 1.4 0 0 1-1.4 1.4H4.8ZM15 4.6a1.1 1.1 0 1 1 2.2 0 1.1 1.1 0 0 1-2.2 0Z',
    detail: 'M9.5 13.8h9.1M12.6 11.4h6',
    fill: 'M4.8 17.4 18.6 6.9v9.1a1.4 1.4 0 0 1-1.4 1.4H4.8Z', c: SHELL
  },
  // The stack, butter on top.
  pancakes: {
    d: 'M5.6 8.8c0-1.5 2.9-2.7 6.4-2.7s6.4 1.2 6.4 2.7-2.9 2.7-6.4 2.7-6.4-1.2-6.4-2.7ZM5.6 8.8v3.4c0 1.5 2.9 2.7 6.4 2.7s6.4-1.2 6.4-2.7V8.8M5.6 12.2v3.4c0 1.5 2.9 2.7 6.4 2.7s6.4-1.2 6.4-2.7v-3.4',
    detail: 'M10.6 7.7h2.8v1.5h-2.8Z',
    fill: 'M5.6 8.8c0-1.5 2.9-2.7 6.4-2.7s6.4 1.2 6.4 2.7-2.9 2.7-6.4 2.7-6.4-1.2-6.4-2.7Z', c: AMBER
  },
  // Ring with sprinkles.
  donut: {
    d: 'M12 4.9a7.1 7.1 0 1 1 0 14.2 7.1 7.1 0 0 1 0-14.2ZM12 9.7a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6Z',
    detail: 'M8.3 8l1 1M15.7 8l-1 1M16.9 12h-1.5M8.6 12H7.1M9.3 15.6l1-1M14.7 15.6l-1-1',
    fill: 'M12 4.9a7.1 7.1 0 1 1 0 14.2 7.1 7.1 0 0 1 0-14.2Z', c: SHELL
  },

  // ── Fresh ──────────────────────────────────────────────────────────────
  // A slice, seeds in the flesh.
  watermelon: {
    d: 'M4.6 10.2h14.8a7.4 7.4 0 0 1-14.8 0ZM10.1 13h.01M13.9 13h.01',
    detail: 'M6.5 10.2a5.5 5.5 0 0 0 11 0M12 14.9h.01',
    fill: 'M6.5 10.2a5.5 5.5 0 0 0 11 0Z', c: TERRA
  },
  pineapple: {
    d: 'M12 8.4c2.8 0 4.7 2.5 4.7 5.7S14.8 20 12 20s-4.7-2.7-4.7-5.9 1.9-5.7 4.7-5.7ZM12 8.2 9.8 4.4M12 8.2l.3-4.2M12 8.2l2.4-3.4',
    detail: 'M8.5 10.8l6.6 6.6M15.5 10.8l-6.6 6.6M7.6 13.9l5 5M16.4 13.9l-5 5',
    fill: 'M12 8.4c2.8 0 4.7 2.5 4.7 5.7S14.8 20 12 20s-4.7-2.7-4.7-5.9 1.9-5.7 4.7-5.7Z', c: AMBER
  },
  // The drinking kind: straw in, pores showing.
  coconut: {
    d: 'M12 5.4a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4ZM13.8 7 15.9 3.2M15.9 3.2h1.9',
    detail: 'M10 11h.01M14 11h.01M12 13.4h.01',
    fill: 'M12 5.4a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4Z', c: COCOA
  },
  // One leaf, midrib swept — vegan and vegetarian.
  leaf: {
    d: 'M6 18c0-7.4 4.6-12 12-12 0 7.4-4.6 12-12 12ZM6 18c2.2-4.8 5.4-8 9.6-9.6',
    detail: 'M8.1 14.5c1.3.2 2.6.1 3.8-.4M10.7 11c1.1.3 2.2.3 3.3-.1',
    fill: 'M6 18c0-7.4 4.6-12 12-12 0 7.4-4.6 12-12 12Z', c: MOSS
  },

  // ── Coast + fiesta II ──────────────────────────────────────────────────
  // Two-lobe body, neck up to the right, sound hole.
  guitar: {
    d: 'M13.2 10.8 17.8 6.2M17 4.6l2.4 2.4M13.2 10.8a2.7 2.7 0 0 0-3.8.2c-.5.5-.8 1.2-.8 1.9-1.5.1-2.9.7-3.9 1.8a4.3 4.3 0 0 0 6.1 6.1c1.1-1 1.7-2.4 1.8-3.9.7 0 1.4-.3 1.9-.8a2.7 2.7 0 0 0 .2-3.8Z',
    detail: 'M9.2 14.7a1.5 1.5 0 1 0 2.2 2.2 1.5 1.5 0 0 0-2.2-2.2Z',
    fill: 'M13.2 10.8a2.7 2.7 0 0 0-3.8.2c-.5.5-.8 1.2-.8 1.9-1.5.1-2.9.7-3.9 1.8a4.3 4.3 0 0 0 6.1 6.1c1.1-1 1.7-2.4 1.8-3.9.7 0 1.4-.3 1.9-.8a2.7 2.7 0 0 0 .2-3.8Z', c: COCOA
  },
  // The mask: lens eyes, open mouth, a bolt down the forehead.
  luchador: {
    d: 'M12 4.4c3.5 0 5.9 2.7 5.9 6.2 0 3.7-2.3 8.6-5.9 8.6s-5.9-4.9-5.9-8.6c0-3.5 2.4-6.2 5.9-6.2ZM8.6 10.6c.7-.9 2.1-.9 2.8 0-.7.9-2.1.9-2.8 0ZM12.6 10.6c.7-.9 2.1-.9 2.8 0-.7.9-2.1.9-2.8 0ZM10.5 14.6h3v.6a1.5 1.5 0 0 1-3 0Z',
    detail: 'M12.4 5l-1.1 2.2h1.6L11.6 9.6',
    fill: 'M12 4.4c3.5 0 5.9 2.7 5.9 6.2 0 3.7-2.3 8.6-5.9 8.6s-5.9-4.9-5.9-8.6c0-3.5 2.4-6.2 5.9-6.2Z', c: CLAY
  },
  // Stepped temple, Chichén Itzá in six lines.
  pyramid: {
    d: 'M4.4 19.4h15.2M6.6 19.4 10.1 8.6h3.8l3.5 10.8M10.1 8.6V6.2h3.8v2.4',
    detail: 'M8.1 15h7.8M9.1 11.9h5.8',
    fill: 'M6.6 19.4 10.1 8.6h3.8l3.5 10.8Z', c: COCOA
  },
  sun: {
    d: 'M12 8.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4ZM12 3.8v1.9M12 18.3v1.9M3.8 12h1.9M18.3 12h1.9M6.2 6.2l1.3 1.3M16.5 16.5l1.3 1.3M17.8 6.2l-1.3 1.3M7.5 16.5l-1.3 1.3',
    fill: 'M12 8.3a3.7 3.7 0 1 1 0 7.4 3.7 3.7 0 0 1 0-7.4Z', c: AMBER
  },
  wave: {
    d: 'M4.2 8.4c2.6-1.8 5.2-1.8 7.8 0s5.2 1.8 7.8 0M4.2 12.9c2.6-1.8 5.2-1.8 7.8 0s5.2 1.8 7.8 0M4.2 17.4c2.6-1.8 5.2-1.8 7.8 0s5.2 1.8 7.8 0',
    fill: '', c: SLATE
  },
  // Trunk off a little island, fronds drooping from the crown.
  palm: {
    d: 'M4.2 20.1c1.5-1.4 3.8-1.4 5.3 0M8.7 19.7c.9-4 2.5-7.2 4.6-10.3M13.3 9.4c-2.7-.9-5.6-.4-8 1.4M13.3 9.4c-2.6.4-4.8 1.8-6.3 4M13.3 9.4c-.2-2.8.9-5.2 3.1-6.9M13.3 9.4c2.8-.6 5.5 0 7.8 1.8M13.3 9.4c2.2.7 4 2.2 5.2 4.4',
    detail: 'M12.1 11.2h.01M14.3 11.7h.01',
    fill: '', c: MOSS
  },
  // Board on its tail, stringer down the middle — Avalon, after all.
  surfboard: {
    d: 'M12 3.6c2.9 2.4 4.5 5.9 4.5 9.4 0 2.9-1.6 5.6-4.5 7.4-2.9-1.8-4.5-4.5-4.5-7.4 0-3.5 1.6-7 4.5-9.4ZM12 7v10',
    fill: 'M12 3.6c2.9 2.4 4.5 5.9 4.5 9.4 0 2.9-1.6 5.6-4.5 7.4-2.9-1.8-4.5-4.5-4.5-7.4 0-3.5 1.6-7 4.5-9.4Z', c: TERRA
  },

  // ── Service ────────────────────────────────────────────────────────────
  // Box, lid, bow — the gift card tile.
  gift: {
    d: 'M5.4 11.2h13.2v7.2a1.7 1.7 0 0 1-1.7 1.7H7.1a1.7 1.7 0 0 1-1.7-1.7ZM4.6 7.9h14.8v3.3H4.6ZM12 7.9V20M12 7.9C10.4 6.7 8.7 5 9.5 3.9s2.5.1 2.5 4c0-3.9 1.7-5.1 2.5-4S13.6 6.7 12 7.9',
    fill: 'M4.6 7.9h14.8v3.3H4.6ZM5.4 11.2h13.2v7.2a1.7 1.7 0 0 1-1.7 1.7H7.1a1.7 1.7 0 0 1-1.7-1.7Z', c: TERRA
  },
  // Paper bag, rope handle.
  takeaway: {
    d: 'M6.6 8.6h10.8l-.9 10a1.7 1.7 0 0 1-1.7 1.6H9.2a1.7 1.7 0 0 1-1.7-1.6ZM9.4 8.4V6.8a2.6 2.6 0 0 1 5.2 0v1.6',
    detail: 'M7.1 11.4h9.8',
    fill: 'M6.6 8.6h10.8l-.9 10a1.7 1.7 0 0 1-1.7 1.6H9.2a1.7 1.7 0 0 1-1.7-1.6Z', c: COCOA
  },
  // Five past five — happy hour.
  clock: {
    d: 'M12 4.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4ZM12 8.2v4.2l2.9 1.7',
    fill: 'M12 4.8a7.2 7.2 0 1 1 0 14.4 7.2 7.2 0 0 1 0-14.4Z', c: SLATE
  },
  // Fire, inner tongue on the fancier styles — the spicy list.
  flame: {
    d: 'M12 3.8c.4 2.3 1.5 4 3.2 5.7a7.5 7.5 0 0 1 2 5.1c0 3.2-2.3 5.6-5.2 5.6s-5.2-2.4-5.2-5.6c0-1.5.5-2.9 1.4-4 .5.9 1.1 1.5 1.9 1.9-.5-2.9.3-6 1.9-8.7Z',
    detail: 'M12 12.2c1.2 1 1.8 2.1 1.8 3.3 0 1.3-.8 2.3-1.8 2.3s-1.8-1-1.8-2.3c0-1.2.6-2.3 1.8-3.3Z',
    fill: 'M12 3.8c.4 2.3 1.5 4 3.2 5.7a7.5 7.5 0 0 1 2 5.1c0 3.2-2.3 5.6-5.2 5.6s-5.2-2.4-5.2-5.6c0-1.5.5-2.9 1.4-4 .5.9 1.1 1.5 1.9 1.9-.5-2.9.3-6 1.9-8.7Z', c: CLAY
  },
  // Top shelf.
  crown: {
    d: 'M5 8.2l3.3 3L12 6.4l3.7 4.8 3.3-3-1.3 8.3H6.3ZM6.3 16.5h11.4v2.1H6.3Z',
    detail: 'M12 13.2h.01M8.9 13.9h.01M15.1 13.9h.01',
    fill: 'M5 8.2l3.3 3L12 6.4l3.7 4.8 3.3-3-1.3 8.3H6.3Z', c: AMBER
  },
  // Favourites.
  heart: {
    d: 'M12 19.2c-5-3.6-7.8-6.6-7.8-9.8a4.2 4.2 0 0 1 7.8-2.1 4.2 4.2 0 0 1 7.8 2.1c0 3.2-2.8 6.2-7.8 9.8Z',
    fill: 'M12 19.2c-5-3.6-7.8-6.6-7.8-9.8a4.2 4.2 0 0 1 7.8-2.1 4.2 4.2 0 0 1 7.8 2.1c0 3.2-2.8 6.2-7.8 9.8Z', c: TERRA
  },
  // New on the list.
  sparkles: {
    d: 'M10.4 4.6l1.5 4.1 4.1 1.5-4.1 1.5-1.5 4.1-1.5-4.1-4.1-1.5 4.1-1.5ZM17.2 13.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z',
    fill: 'M10.4 4.6l1.5 4.1 4.1 1.5-4.1 1.5-1.5 4.1-1.5-4.1-4.1-1.5 4.1-1.5ZM17.2 13.6l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9Z', c: AMBER
  },
  // Deals and happy-hour prices.
  tag: {
    d: 'M4.8 6.5a1.7 1.7 0 0 1 1.7-1.7h5.2a1.9 1.9 0 0 1 1.3.6l6.4 6.4a1.9 1.9 0 0 1 0 2.7l-5.2 5.2a1.9 1.9 0 0 1-2.7 0L5.4 13.3a1.9 1.9 0 0 1-.6-1.3ZM7.8 8.6a1.2 1.2 0 1 1 2.4 0 1.2 1.2 0 0 1-2.4 0Z',
    fill: 'M4.8 6.5a1.7 1.7 0 0 1 1.7-1.7h5.2a1.9 1.9 0 0 1 1.3.6l6.4 6.4a1.9 1.9 0 0 1 0 2.7l-5.2 5.2a1.9 1.9 0 0 1-2.7 0L5.4 13.3a1.9 1.9 0 0 1-.6-1.3Z', c: MOSS
  }
};

// The mark itself. Inherits colour and sits on the text baseline; premium
// adds the detail layer at a finer weight, colour floods the silhouette.
export function iconSvg(key: IconKey, style: IconStyle = 'line'): string {
  const art = ICON_ART[key];
  if (!art || style === 'off') return '';
  const open = (w: number) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`;
  if (style === 'solid') return `${open(2.1)}<path d="${art.d}"/></svg>`;
  if (style === 'line') return `${open(1.45)}<path d="${art.d}"/></svg>`;
  if (style === 'premium') {
    const detail = art.detail ? `<path d="${art.detail}" opacity="0.55"/>` : '';
    return `${open(1.15)}<path d="${art.d}"/>${detail}</svg>`;
  }
  // colour
  const flood = art.fill ?? art.d;
  const fill = flood ? `<path d="${flood}" fill="${art.c ?? CREAM}" stroke="none" opacity="0.9"/>` : '';
  const detail = art.detail ? `<path d="${art.detail}" opacity="0.65"/>` : '';
  return `${open(1.2)}${fill}<path d="${art.d}"/>${detail}</svg>`;
}

// Icons are a per-device preference (registers are shared, staff are not).
export const ICONS_KEY = 'alma.pos.iconStyle';
export function loadIconStyle(): IconStyle {
  const saved = localStorage.getItem(ICONS_KEY);
  if (ICON_STYLES.some((style) => style.key === saved)) return saved as IconStyle;
  // Legacy on/off flag from the emoji version.
  return localStorage.getItem('alma.pos.icons') === '0' ? 'off' : 'line';
}

// A big tile eats four standard slots, a wide one two.
export function pinWeight(pin: Pin) {
  return pin.s === 'b' ? 4 : pin.s === 'w' ? 2 : 1;
}

// Break the pin list into pages exactly the way the register's pager does.
export function paginatePins(pins: Pin[], capacity: number): Array<Array<{ pin: Pin; index: number }>> {
  const pages: Array<Array<{ pin: Pin; index: number }>> = [];
  let current: Array<{ pin: Pin; index: number }> = [];
  let used = 0;
  pins.forEach((pin, index) => {
    const weight = pinWeight(pin);
    if (used + weight > capacity && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push({ pin, index });
    used += weight;
  });
  if (current.length > 0 || pages.length === 0) pages.push(current);
  return pages;
}

// The left-nav token list: the user's saved order first, then any group and
// any category the saved order hasn't heard of yet. One config, every view.
export function visibleTabTokens(catNames: string[], config: TabsConfig): string[] {
  const grouped = new Set(config.groups.flatMap((group) => group.cats));
  const hidden = new Set(config.hidden);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const token of config.order) {
    if (token.startsWith('g:')) {
      if (config.groups.some((group) => group.name === token.slice(2)) && !seen.has(token)) {
        tokens.push(token);
        seen.add(token);
      }
    } else if (catNames.includes(token) && !grouped.has(token) && !hidden.has(token) && !seen.has(token)) {
      tokens.push(token);
      seen.add(token);
    }
  }
  for (const group of config.groups) {
    const token = `g:${group.name}`;
    if (!seen.has(token)) {
      tokens.push(token);
      seen.add(token);
    }
  }
  for (const name of catNames) {
    if (!grouped.has(name) && !hidden.has(name) && !seen.has(name)) {
      tokens.push(name);
      seen.add(name);
    }
  }
  return tokens;
}

// Reordering by index is safe here (unlike a drag, nothing is moving under
// us mid-gesture — the list is rebuilt from state after every press).
export function moveInArray<T>(list: T[], from: number, delta: number): T[] {
  const to = from + delta;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
}

// "Move to page N": drop the pin at the head of that page, measured on the
// list WITHOUT it (otherwise the pin's own weight shifts the boundary it is
// aiming for).
export function movePinToPage(pins: Pin[], index: number, page: number, capacity: number): Pin[] {
  const pin = pins[index];
  if (!pin) return pins;
  const rest = pins.filter((_, i) => i !== index);
  const pages = paginatePins(rest, capacity);
  if (page >= pages.length) return [...rest, pin];
  const head = pages[page]?.[0]?.index ?? rest.length;
  return [...rest.slice(0, head), pin, ...rest.slice(head)];
}

// ── Text size ───────────────────────────────────────────────────────────────
// Some staff can't comfortably read 11px uppercase across a bar at arm's
// length. This scales the board labels and the nav, and — because a bigger
// label needs a bigger tile — the tiles with them, which is why the register
// feeds the same number into its "how many tiles fit a page" measurement.
//
// Per-device, like the theme: it's about whoever is standing at THIS till,
// not whose layout is loaded.
export const TEXT_SCALE_KEY = 'alma.pos.textScale';

export const TEXT_SCALES = [
  { key: 'S', scale: 1, label: 'Standard' },
  { key: 'M', scale: 1.18, label: 'Large' },
  { key: 'L', scale: 1.36, label: 'Largest' }
] as const;

export type TextScale = (typeof TEXT_SCALES)[number]['key'];

export function loadTextScale(): TextScale {
  const saved = localStorage.getItem(TEXT_SCALE_KEY);
  return TEXT_SCALES.some((option) => option.key === saved) ? (saved as TextScale) : 'S';
}

export function textScaleValue(key: TextScale): number {
  return TEXT_SCALES.find((option) => option.key === key)?.scale ?? 1;
}
