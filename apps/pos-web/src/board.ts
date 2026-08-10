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
