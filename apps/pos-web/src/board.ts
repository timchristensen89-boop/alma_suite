// Board + nav vocabulary shared by the register (App.tsx) and the board
// editor (BoardEditor.tsx). Both surfaces MUST agree on pin shapes, tab
// tokens and page breaks — a preview that paginates differently from the
// real board is worse than no preview, so the maths lives here once.
import type { CSSProperties } from 'react';

export type MenuItem = {
  recipeId: string;
  title: string;
  priceCents: number;
  venue: string | null;
  variantOf?: string | null;
  variants?: Array<{ recipeId: string; title: string; priceCents: number; venue: string | null; label: string }> | null;
};
export type MenuCategory = { name: string; kind: string; items: MenuItem[] };

// c = colour (hue name, or a legacy hex), label = display-only rename,
// s = tile size, d = label style. Every pin kind carries the same extras.
export type PinExtras = { c?: string; label?: string; s?: 'w' | 'b'; d?: 'sh' | 'hs' | 'big' };
export type Pin =
  | ({ t: 'i'; id: string } & PinExtras)
  | ({ t: 'f'; name: string; items: string[] } & PinExtras)
  // 'm' = a management action (open till, wastage…). Same tile, same board.
  | ({ t: 'm'; key: string } & PinExtras);

export type TabsConfig = { order: string[]; hidden: string[]; groups: Array<{ name: string; cats: string[]; c?: string }> };

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
  price: 'Change price'
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
  | 'cocktail' | 'spirit' | 'wine' | 'beer' | 'soft' | 'coffee'
  | 'taco' | 'fish' | 'meat' | 'salad' | 'dessert' | 'kids'
  | 'side' | 'setmenu' | 'dip' | 'bread' | 'cheese' | 'pizza'
  | 'pasta' | 'burger' | 'egg' | 'snack' | 'star';

const ICON_RULES: Array<[RegExp, IconKey]> = [
  [/margarita|cocktail|martini|negroni|spritz|aperol|daiquiri|mojito|paloma/i, 'cocktail'],
  [/whisk|gin\b|vodka|rum\b|tequila|mezcal|spirit|liqueur|amaro|brandy/i, 'spirit'],
  [/wine|rosé|rose\b|chardonnay|pinot|riesling|sauv|shiraz|merlot|prosecco|champagne|sparkling|by the glass/i, 'wine'],
  [/beer|lager|ale\b|xpa|ipa\b|pilsner|cider|tinnie|schooner/i, 'beer'],
  [/non.?alcohol|soft drink|juice|soda|mocktail|lemonade|water/i, 'soft'],
  [/coffee|espresso|latte|cappucc|flat white|tea\b/i, 'coffee'],
  [/taco|tostada|quesadilla|burrito|nacho|tortilla/i, 'taco'],
  [/oyster|fish|seafood|prawn|kingfish|ceviche|squid|octopus|scallop/i, 'fish'],
  [/steak|beef|lamb|pork|chicken|carnitas|meat|brisket|rib\b/i, 'meat'],
  [/salad|veg|greens|slaw|cauliflower/i, 'salad'],
  [/dessert|churro|flan|ice cream|gelato|sweet|cake|pudding/i, 'dessert'],
  [/kids?\b|child/i, 'kids'],
  [/side|fries|chips|elote|beans|rice/i, 'side'],
  [/set menu|banquet|feed me|share|degustation/i, 'setmenu'],
  [/dip|guac|hummus|salsa/i, 'dip'],
  [/bread|bakery|sourdough|bun\b/i, 'bread'],
  [/cheese|burrata|halloumi/i, 'cheese'],
  [/pizza/i, 'pizza'],
  [/pasta|gnocchi|risotto/i, 'pasta'],
  [/burger/i, 'burger'],
  [/breakfast|brunch|egg/i, 'egg'],
  [/snack|nuts|olives|bar snack/i, 'snack'],
  [/special/i, 'star']
];

const iconCache = new Map<string, IconKey | ''>();
export function iconKeyFor(name: string): IconKey | '' {
  if (!name) return '';
  const hit = iconCache.get(name);
  if (hit !== undefined) return hit;
  const found = ICON_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? '';
  iconCache.set(name, found);
  return found;
}

// Two drawn sets to choose from, plus off. 'line' is the house style: a
// single continuous stroke. 'solid' is heavier for tired eyes and bright
// rooms. Both are one colour and inherit it from the text around them.
export type IconStyle = 'line' | 'solid' | 'off';
export const ICON_STYLES: Array<{ key: IconStyle; label: string; hint: string }> = [
  { key: 'line', label: 'Sketch', hint: 'fine hand-drawn line' },
  { key: 'solid', label: 'Bold', hint: 'heavier stroke' },
  { key: 'off', label: 'None', hint: 'text only' }
];

// 24×24 paths, drawn on one baseline so they optically match at small sizes.
const ICON_PATHS: Record<IconKey, string> = {
  cocktail: 'M4 5h16l-8 8v6M9 19h6M7.5 8.5h9',
  spirit: 'M7 3h10v5l-2 3v10H9V11L7 8V3M7 6h10',
  wine: 'M8 3h8v4a4 4 0 0 1-8 0V3M12 11v8M9 19h6',
  beer: 'M6 7h10v13H6V7M16 10h3v6h-3M8 4c1-1.2 3-1.2 4 0s3 1.2 4 0',
  soft: 'M7 5h10l-1.4 15H8.4L7 5M9 9h6M12 5V2',
  coffee: 'M5 8h12v7a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8M17 10h3v4h-3M8 4c0-1 1-1 1-2M12 4c0-1 1-1 1-2',
  taco: 'M3 16a9 9 0 0 1 18 0M3 16h18M7 13c1.5-1.5 3-1.5 4.5 0M13 12.5c1.2-1 2.4-1 3.5 0',
  fish: 'M3 12c4-5 11-5 15 0-4 5-11 5-15 0M18 12l3-3v6l-3-3M8 11.5h.01',
  meat: 'M6 15a5 5 0 0 1 7-7l6 6a5 5 0 0 1-7 7l-6-6M6 15l-3 3M9 18l-3 3',
  salad: 'M3 11h18a9 9 0 0 1-18 0M8 11c0-3 2-5 4-5s4 2 4 5M12 6V3',
  dessert: 'M6 10h12l-1.5 10h-9L6 10M8 10c0-3 8-3 8 0M12 4v3M10 6.5l2-2 2 2',
  kids: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8M5 21c0-4 3-6 7-6s7 2 7 6M9.5 8h.01M14.5 8h.01',
  side: 'M8 8h8l-1 12H9L8 8M8 8l1-4h6l1 4M11 11v6M13 11v6',
  setmenu: 'M4 4v7a2 2 0 0 0 2 2h1v8M6 4v6M8 4v6M20 4c-2 2-2 6-2 8h-2c0-4 1-7 3-8v16',
  dip: 'M4 13h16a8 8 0 0 1-16 0M9 9c1-1.5 2.5-2 4-1M8 6c1.5-1 3-1 4.5 0',
  bread: 'M4 9c0-3 4-4 8-4s8 1 8 4v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9M8 9v10M12 9v10M16 9v10',
  cheese: 'M3 16l9-8h9v8H3M3 16v3h18v-3M8 13h.01M13 12h.01',
  pizza: 'M12 3l9 16H3L12 3M10 12h.01M14 13h.01M12 16h.01',
  pasta: 'M5 6h14v3a7 7 0 0 1-14 0V6M8 6c0-2 8-2 8 0M7 18h10M9 15c1 2 5 2 6 0',
  burger: 'M4 9c0-3 3.6-5 8-5s8 2 8 5H4M4 12h16M4 15h16c0 3-3.6 4-8 4s-8-1-8-4',
  egg: 'M12 4c3.5 0 6 4.5 6 8a6 6 0 0 1-12 0c0-3.5 2.5-8 6-8M12 12h.01',
  snack: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16M9 10h.01M14 9h.01M11 14h.01M15 13h.01',
  star: 'M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7L12 3'
};

// The mark itself. Inherits colour and sits on the text baseline; the
// stroke thickens for the 'solid' set. Decorative, so hidden from readers.
export function iconSvg(key: IconKey, style: IconStyle = 'line'): string {
  const path = ICON_PATHS[key];
  if (!path || style === 'off') return '';
  const width = style === 'solid' ? 2.1 : 1.45;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
}

// Icons are a per-device preference (registers are shared, staff are not).
export const ICONS_KEY = 'alma.pos.iconStyle';
export function loadIconStyle(): IconStyle {
  const saved = localStorage.getItem(ICONS_KEY);
  if (saved === 'line' || saved === 'solid' || saved === 'off') return saved;
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
