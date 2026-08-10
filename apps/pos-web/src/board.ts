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

// icons: per-category mark overrides, name -> IconKey ('' = deliberately
// none). Absent means "use the automatic match".
export type TabsConfig = {
  order: string[];
  hidden: string[];
  groups: Array<{ name: string; cats: string[]; c?: string }>;
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
export const ICON_KEYS: IconKey[] = [
  'cocktail', 'spirit', 'wine', 'beer', 'soft', 'coffee',
  'taco', 'fish', 'meat', 'salad', 'dessert', 'kids',
  'side', 'setmenu', 'dip', 'bread', 'cheese', 'pizza',
  'pasta', 'burger', 'egg', 'snack', 'star'
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

// Two drawn sets to choose from, plus off. 'line' is the house style: a
// single continuous stroke. 'solid' is heavier for tired eyes and bright
// rooms. Both are one colour and inherit it from the text around them.
export type IconStyle = 'line' | 'solid' | 'off';
export const ICON_STYLES: Array<{ key: IconStyle; label: string; hint: string }> = [
  { key: 'line', label: 'Sketch', hint: 'fine hand-drawn line' },
  { key: 'solid', label: 'Bold', hint: 'heavier stroke' },
  { key: 'off', label: 'None', hint: 'text only' }
];

// 24x24, drawn on one optical baseline (cap ~4, foot ~20) so a row of them
// sits level. Curves over corners, a little asymmetry where a real pen
// would wander, and no detail that dies below 16px.
const ICON_PATHS: Record<IconKey, string> = {
  // Coupe: a shallow bowl on a slim stem, not a triangle.
  cocktail: 'M5.2 6.4h13.6c0 3.9-3 6.6-6.8 6.6S5.2 10.3 5.2 6.4ZM12 13v6.1M8.6 19.4c1.4-.7 5.4-.7 6.8 0',
  // Rocks glass with a tapered base and a measure line.
  spirit: 'M7.4 6.6h9.2l-1 12.2a1.5 1.5 0 0 1-1.5 1.3h-4.2a1.5 1.5 0 0 1-1.5-1.3ZM8.1 13.4h7.8',
  // Bowl on a stem, with the wine sitting low.
  wine: 'M7.6 3.6h8.8v4.1a4.4 4.4 0 0 1-8.8 0ZM7.7 7.7h8.6M12 12.2v7.2M9 19.7c1.2-.6 4.8-.6 6 0',
  // Tankard with a handle and a drawn-on head.
  beer: 'M6.4 8.3h9.4v10.4a1.6 1.6 0 0 1-1.6 1.6H8a1.6 1.6 0 0 1-1.6-1.6ZM15.8 10.6h2.3a1.5 1.5 0 0 1 1.5 1.5v2.6a1.5 1.5 0 0 1-1.5 1.5h-2.3M6.6 8.3c.8-1.6 2.4-2.2 3.6-1.3 1-1.4 3.4-1.4 4.4 0',
  // Tumbler, straw, a slice of citrus on the rim.
  soft: 'M7.6 7.4h8.8l-1.1 11.4a1.5 1.5 0 0 1-1.5 1.3h-3.6a1.5 1.5 0 0 1-1.5-1.3ZM13.4 7.2 15.6 3M8.2 11.4h7.6',
  // Cup and saucer with a rising curl of steam.
  coffee: 'M5.6 9.2h10.6v5.4a4.6 4.6 0 0 1-4.6 4.6H10.2a4.6 4.6 0 0 1-4.6-4.6ZM16.2 10.8h1.9a2 2 0 0 1 0 4h-1.9M4.4 20.4h13M9.6 6.4c1-.9-.6-1.8.4-2.8M13 6.4c1-.9-.6-1.8.4-2.8',
  // Folded shell with a filling that spills a little.
  taco: 'M3.4 16.6a8.6 8.6 0 0 1 17.2 0ZM3.4 16.6c1.6 1.5 15.6 1.5 17.2 0M7.4 13.4c1.1-1.3 2.6-1.5 3.8-.4M13 12.6c1-1 2.3-1 3.3.1',
  // A fish with a fanned tail and one gill line.
  fish: 'M3.6 12.3c3.6-4.6 10.4-4.6 14 0-3.6 4.6-10.4 4.6-14 0ZM17.6 12.3c1.1-1.4 2.1-2.3 2.8-2.6.3 1.7.3 3.5 0 5.2-.7-.3-1.7-1.2-2.8-2.6M8.4 11.6h.01M6.5 12.3c.9.7 1.8 1.3 2.7 1.7',
  // A chop: the eye of the meat and the bone below.
  meat: 'M6.6 12.2a5.6 5.6 0 0 1 11 1.4c0 2.6-2.2 4.6-5.2 4.6s-5.8-1.6-5.8-4.2ZM9.6 13.2a2.6 2.6 0 0 1 4.6 1M8.6 18.6c-1.2 1-2.8.8-3.4-.4-.9.3-1.8-.4-1.7-1.4',
  // A leaf over a shallow bowl.
  salad: 'M3.6 12.4h16.8a8.4 8.4 0 0 1-16.8 0ZM12 12.4c-2.4-2-2-5.4.6-6.6 1.3 2.5.9 5-.6 6.6ZM12 12.4c-.6-1.7-2.4-2.6-4-2',
  // A scoop in a waffle cone.
  dessert: 'M8.2 9.6a3.8 3.8 0 0 1 7.6 0ZM7.6 9.6h8.8L12 20.4Zm2.2 3.6 3.4 3.6M13.6 12.6l-2.6 2.8',
  // A small face — kids' menu.
  kids: 'M12 3.8a4.1 4.1 0 1 1 0 8.2 4.1 4.1 0 0 1 0-8.2ZM4.8 20.6c.4-3.6 3.4-5.6 7.2-5.6s6.8 2 7.2 5.6M10.3 7.6h.01M13.7 7.6h.01M10.6 9.9c.9.6 1.9.6 2.8 0',
  // A small bowl of fries.
  side: 'M8 10.6h8l-.9 8.2a1.6 1.6 0 0 1-1.6 1.4h-3a1.6 1.6 0 0 1-1.6-1.4ZM9 10.6 9.7 5M12 10.6V4.2M15 10.6 14.3 5.4',
  // Fork and knife: a set menu.
  setmenu: 'M7.6 3.8v5.4a2 2 0 0 0 2 2h.2v9M7.6 3.8v4.4M9.8 3.8v4.4M16.6 3.8c-1.6 1.6-2 4.4-1.6 6.6h3.2c.4-2.2 0-5-1.6-6.6Zm0 6.6v9.8',
  // A rounded bowl with two scoops served over it.
  dip: 'M4.4 13.4h15.2a7.6 7.6 0 0 1-15.2 0ZM9.4 9.6c.8-1.4 2.4-1.8 3.6-.8M8.4 6.6c1.4-1 3-.8 4.2.4',
  // A round loaf with a scored crust.
  bread: 'M4.4 10.4c0-3 3.4-4.8 7.6-4.8s7.6 1.8 7.6 4.8v7.4a2 2 0 0 1-2 2H6.4a2 2 0 0 1-2-2ZM8.2 9.4c.6 1.2.6 2.6 0 3.8M12 9.2c.6 1.3.6 2.8 0 4.1M15.8 9.4c.6 1.2.6 2.6 0 3.8',
  // A wedge with two eyes.
  cheese: 'M3.6 15.4 12.4 8h7.2a.8.8 0 0 1 .8.8v6.6ZM3.6 15.4v2.8a.8.8 0 0 0 .8.8h15.2a.8.8 0 0 0 .8-.8v-2.8M8.4 13.6h.01M13.6 12.4h.01M16.4 15.8h.01',
  // A slice with the crust curved.
  pizza: 'M12 3.6c3.6 2.4 6.4 6.6 8 12.4-5.2 2.2-10.8 2.2-16 0 1.6-5.8 4.4-10 8-12.4ZM5.4 15.2c4.4 1.8 8.8 1.8 13.2 0M10.2 10.4h.01M13.8 11.6h.01M11.8 14.6h.01',
  // A bowl of pasta with a twirl.
  pasta: 'M4.4 11.6h15.2a7.6 7.6 0 0 1-15.2 0ZM4.4 11.6c0-3 3.4-5 7.6-5s7.6 2 7.6 5M8.4 9.4c1.4-1.2 3-1.6 4.6-1.2M6.6 20.4h10.8',
  // Bun, filling, bun.
  burger: 'M4.4 10.4c0-3.2 3.4-5.4 7.6-5.4s7.6 2.2 7.6 5.4ZM4.4 12.9h15.2M4.6 15.4h14.8c0 2.8-3.2 4.6-7.4 4.6s-7.4-1.8-7.4-4.6ZM9 8.2h.01M13.4 7.6h.01',
  // An egg in a pan, from above.
  egg: 'M11.4 4.6c3.4 0 6 3.8 6 7.4a6 6 0 0 1-12 0c0-3.6 2.6-7.4 6-7.4ZM11.4 13.4a2.4 2.4 0 1 1 0-4.8 2.4 2.4 0 0 1 0 4.8M17.4 12h3.2',
  // Olives in a dish.
  snack: 'M4 13.6h16a8 8 0 0 1-16 0ZM9 11a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4M14.6 12.6a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8M9 8.8h.01',
  // A five-point star drawn in one stroke.
  star: 'M12 3.4 14.6 9l6.1.8-4.5 4.2 1.2 6-5.4-2.9-5.4 2.9 1.2-6L3.3 9.8 9.4 9Z'
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
