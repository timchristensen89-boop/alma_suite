/**
 * What every print family shares: the template definition, page formats, the
 * brand tokens, fonts and logos, and the small HTML helpers. The families
 * themselves (the A4 food sheet, the drinks books, the functions document, the
 * A5 cards) each live in their own module and are dispatched from
 * menu-render.ts. Keep this file pure: no React, no DOM, no fetches — it runs
 * in the editor's preview iframe and in headless Chrome on the server.
 */
import type { MenuDocument, MenuItemDocument, MenuKind, MenuSectionDocument } from './menus.js';

// ---------------------------------------------------------------------------
// Page formats
// ---------------------------------------------------------------------------

export const MENU_FORMATS = {
  A4: { label: 'A4 portrait', widthMm: 210, heightMm: 297 },
  A5P: { label: 'A5 portrait', widthMm: 148, heightMm: 210 },
  A5L: { label: 'A5 landscape', widthMm: 210, heightMm: 148 }
} as const;
export type MenuFormat = keyof typeof MENU_FORMATS;

/** CSS px at 96 dpi for a length in mm — what Chrome and the preview iframe both use. */
export const PX_PER_MM = 96 / 25.4;
export function mmToPx(mm: number): number {
  return Math.round(mm * PX_PER_MM);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export type MenuLogoAssetKey = 'stalma-logo' | 'avalon-logo' | 'group-logo' | 'alma-wordmark';

/** Which family draws the sheet. Each has its own CSS block and renderer module. */
export type MenuSheetFamily = 'food-a4' | 'drinks-a5p' | 'drinks-a5l' | 'functions-a4' | 'card-a5';

export type MenuTemplate = {
  key: string;
  label: string;
  /** The venue (by slug, as `pnpm db:seed:prod` creates it) whose logo and tagline this sheet carries; null = any venue (group-branded documents). */
  venueSlug: string | null;
  /** Scopes per-venue CSS tweaks (`.venue-avalon .mast .logo { height: 19mm }`). */
  venueClass: 'stalma' | 'avalon' | 'group';
  logo: { asset: MenuLogoAssetKey; alt: string };
  /** Letterspaced grey uppercase line under the logo. */
  tagline: string;
  /** Cormorant italic line under the hairline, when the document has no heading of its own. */
  title: string;
  /** The kinds of menu this template may print. */
  kinds: MenuKind[];
  format: MenuFormat;
  page: { widthMm: number; heightMm: number };
  family: MenuSheetFamily;
  /** Whether the document may declare more than one page. */
  multiPage: boolean;
  /** The most pages a multi-page template prints (a card is front and back at most); default MENU_LIMITS.pagesMax. */
  maxPages?: number;
  /** Footer lines a new menu on this template starts with. */
  defaults?: { dietaryNote?: string; surchargeLine?: string };
};

/** The italic title line as printed: the document's own heading, else the template's. */
export function menuPrintedHeading(doc: Pick<MenuDocument, 'heading'>, template: Pick<MenuTemplate, 'title'>): string {
  const heading = (doc.heading ?? '').trim();
  return heading || template.title;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Where the fonts and logos come from. The API inlines everything as data
 * URIs (headless Chrome drops linked fonts when printing — see the website's
 * scripts/inline-print-fonts.py); the editor points at files on its own origin.
 */
export type MenuRenderAssets = {
  /** `@font-face` rules declaring "avenir-lt-pro" (400/500/700/900) and "cormorant-garamond" italic 400. */
  fontFaceCss: string;
  logoSrc: (asset: MenuLogoAssetKey) => string;
};

export type MenuRenderOptions = {
  assets: MenuRenderAssets;
  /** Cream tints the sheet for screen proofs; the print is white. */
  stock?: 'white' | 'cream';
  /** <title> of the HTML document. */
  title?: string;
};

/**
 * The @font-face block for a set of font URLs (data URIs or http paths). One
 * place so the API and the editor declare the same families and weights.
 */
export function menuFontFaceCss(urls: {
  /** The website's body face. Only the masthead's line box depends on it (the logo sits on a Manrope strut); everything else names its own family. */
  manrope?: string;
  avenirBook: string;
  avenirRoman: string;
  avenirHeavy: string;
  avenirBlack: string;
  cormorantItalic: string;
  cormorantItalicLatinExt?: string;
}): string {
  const avenir = (url: string, weight: number) =>
    `@font-face{font-family:"avenir-lt-pro";src:url(${url}) format("opentype");font-weight:${weight};font-style:normal;font-display:block;}`;
  const cormorant = (url: string, unicodeRange?: string) =>
    `@font-face{font-family:"cormorant-garamond";src:url(${url}) format("woff2");font-weight:400;font-style:italic;font-display:block;${
      unicodeRange ? `unicode-range:${unicodeRange};` : ''
    }}`;
  return [
    urls.manrope
      ? `@font-face{font-family:"Manrope";src:url(${urls.manrope}) format("woff2");font-weight:400 800;font-style:normal;font-display:block;}`
      : '',
    avenir(urls.avenirBook, 400),
    avenir(urls.avenirRoman, 500),
    avenir(urls.avenirHeavy, 700),
    avenir(urls.avenirBlack, 900),
    urls.cormorantItalicLatinExt
      ? cormorant(
          urls.cormorantItalicLatinExt,
          'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF'
        )
      : '',
    cormorant(
      urls.cormorantItalic,
      urls.cormorantItalicLatinExt
        ? 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'
        : undefined
    )
  ].join('\n');
}

export const MENU_FONT_FILES = {
  manrope: 'Manrope.woff2',
  avenirBook: 'AvenirLTStd-Book.otf',
  avenirRoman: 'AvenirLTStd-Roman.otf',
  avenirHeavy: 'AvenirLTStd-Heavy.otf',
  avenirBlack: 'AvenirLTStd-Black.otf',
  cormorantItalic: 'CormorantGaramond-Italic-latin.woff2',
  cormorantItalicLatinExt: 'CormorantGaramond-Italic-latin-ext.woff2'
} as const;

export const MENU_LOGO_FILES: Record<MenuLogoAssetKey, string> = {
  'stalma-logo': 'stalma-logo.png',
  'avalon-logo': 'avalon-logo.png',
  'group-logo': 'group-logo.png',
  'alma-wordmark': 'alma-wordmark.png'
};

// ---------------------------------------------------------------------------
// Shared CSS — the tokens every family uses, and the multi-sheet frame
// ---------------------------------------------------------------------------

/**
 * Tailwind-preflight basics the website's sheets were designed on (border-box,
 * 1.5 root line-height, zeroed margins), the single forest ink and its tints,
 * the two typefaces, and the `.menu-print-page` frame: a grey screen backdrop
 * holding one or more fixed-size sheets, each its own printed page.
 */
export const MENU_BASE_CSS = `
*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4;font-family:"Manrope",ui-sans-serif,system-ui,sans-serif}
body{line-height:inherit;background:#ffffff}
img{display:block;max-width:100%;height:auto;vertical-align:middle}

.menu-print-page{
  --ink:#1d2916;
  --ink-86:color-mix(in srgb, var(--ink) 86%, transparent);
  --ink-72:color-mix(in srgb, var(--ink) 72%, transparent);
  --ink-58:color-mix(in srgb, var(--ink) 58%, transparent);
  --ink-52:color-mix(in srgb, var(--ink) 52%, transparent);
  --ink-46:color-mix(in srgb, var(--ink) 46%, transparent);
  --ink-40:color-mix(in srgb, var(--ink) 40%, transparent);
  --ink-30:color-mix(in srgb, var(--ink) 30%, transparent);
  --ink-24:color-mix(in srgb, var(--ink) 24%, transparent);
  --ink-18:color-mix(in srgb, var(--ink) 18%, transparent);
  --ink-11:color-mix(in srgb, var(--ink) 11%, transparent);
  --stock:#ffffff;
  --sans:"avenir-lt-pro","Manrope",ui-sans-serif,sans-serif;
  --serif:"cormorant-garamond","Cormorant Garamond","Hoefler Text",Georgia,serif;
  background:#cdc6b8; padding:12mm 0; color:var(--ink);
}
.menu-print-page.stock-cream{ --stock:#efe7d8; }
.menu-print-page .sheet{
  width:var(--page-w); height:var(--page-h); margin:0 auto; background:var(--stock);
  box-sizing:border-box; position:relative; overflow:hidden;
  box-shadow:0 2px 18px rgba(0,0,0,.18);
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}
.menu-print-page .sheet + .sheet{ margin-top:12mm; }
.menu-print-page .folio{
  position:absolute; left:0; right:0; bottom:7.5mm; text-align:center;
  font-family:var(--sans); font-weight:700; font-size:8px; letter-spacing:.2em; color:var(--ink-46);
}
@media print{
  .menu-print-page{ background:none; padding:0; }
  .menu-print-page .sheet{ box-shadow:none; margin:0; break-after:page; }
  .menu-print-page .sheet + .sheet{ margin-top:0; }
  .menu-print-page .sheet:last-child{ break-after:auto; }
  body{ padding:0 !important; background:#ffffff !important; }
}
`;

// ---------------------------------------------------------------------------
// HTML helpers
// ---------------------------------------------------------------------------

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Paragraphs from a prose field: blank lines separate them; single newlines break lines. */
export function escapeParagraphs(text: string, className = 'para'): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p class="${className}">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function visibleItems(section: MenuSectionDocument): MenuItemDocument[] {
  return section.items.filter((item) => item.visible);
}

/** The visible sections of each page, in page order; every declared page is present even when empty. */
export function sectionsByPage(doc: MenuDocument): MenuSectionDocument[][] {
  const count = Math.max(1, doc.pageCount ?? 1);
  const pages: MenuSectionDocument[][] = Array.from({ length: count }, () => []);
  for (const section of doc.sections) {
    if (!section.visible) continue;
    const index = Math.min(Math.max(1, section.page ?? 1), count) - 1;
    pages[index]!.push(section);
  }
  return pages;
}

/** `<main class="menu-print-page …" style="--page-w:…">` — the frame a family's sheets sit in. */
export function openPrintPage(template: MenuTemplate, options: MenuRenderOptions, extraClasses = ''): string {
  const stock = options.stock ?? 'white';
  return (
    `<main class="menu-print-page family-${template.family} stock-${stock} venue-${template.venueClass}${extraClasses ? ` ${extraClasses}` : ''}" ` +
    `style="--page-w:${template.page.widthMm}mm;--page-h:${template.page.heightMm}mm">`
  );
}
