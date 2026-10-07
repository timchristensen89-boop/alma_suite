/**
 * The locked print templates: a MenuDocument in, one A4 HTML page out.
 *
 * Ported from the website's print route (alma-web-platform
 * apps/web/app/print/_food/FoodSheet.tsx + food.css), which is what produced
 * the current menus in headless Chrome. Every mm, px and letter-spacing value
 * is kept; the only change is that content, placement and section type come
 * from data instead of from a hand-written TS file.
 *
 * The same function renders the editor's live preview (in an iframe) and the
 * published PDF (in headless Chrome), so what the chef sees is what prints.
 *
 * Adding a template: add a key to MENU_TEMPLATES with its venue class, logo
 * asset, tagline and title. Layout is driven by section placement, so a new
 * venue's à la carte needs no new CSS; a genuinely new layout (a drinks
 * binder, a specials card) gets its own CSS block keyed off `.venue-<class>`
 * or a new `sheetClass`.
 */
import {
  formatMenuPrice,
  formatMenuTags,
  menuTagLegend,
  type MenuDocument,
  type MenuItemDocument,
  type MenuSectionDocument
} from './menus.js';

export const MENU_TEMPLATE_KEYS = ['freshwater_alacarte', 'avalon_alacarte'] as const;
export type MenuTemplateKey = (typeof MENU_TEMPLATE_KEYS)[number];

export type MenuLogoAssetKey = 'stalma-logo' | 'avalon-logo';

export type MenuTemplate = {
  key: MenuTemplateKey;
  label: string;
  /** Scopes per-venue CSS tweaks (`.venue-avalon .mast .logo { height: 19mm }`). */
  venueClass: 'stalma' | 'avalon';
  logo: { asset: MenuLogoAssetKey; alt: string };
  /** Letterspaced grey uppercase line under the logo. */
  tagline: string;
  /** Cormorant italic line under the hairline. */
  title: string;
  /** Page size, so a future A5 card is a template change, not a code change. */
  page: { widthMm: number; heightMm: number };
};

export const MENU_TEMPLATES: Record<MenuTemplateKey, MenuTemplate> = {
  freshwater_alacarte: {
    key: 'freshwater_alacarte',
    label: 'St Alma Freshwater · À la carte (A4)',
    venueClass: 'stalma',
    logo: { asset: 'stalma-logo', alt: 'st.alma' },
    tagline: 'Restaurant & Bar · Freshwater',
    title: 'À la carte',
    page: { widthMm: 210, heightMm: 297 }
  },
  avalon_alacarte: {
    key: 'avalon_alacarte',
    label: 'Alma Avalon · À la carte (A4)',
    venueClass: 'avalon',
    logo: { asset: 'avalon-logo', alt: 'alma restaurant & bar' },
    tagline: 'Avalon Beach · Est 2017',
    title: 'À la carte',
    page: { widthMm: 210, heightMm: 297 }
  }
};

export function isMenuTemplateKey(value: unknown): value is MenuTemplateKey {
  return typeof value === 'string' && value in MENU_TEMPLATES;
}

export function getMenuTemplate(key: string): MenuTemplate {
  if (!isMenuTemplateKey(key)) throw new Error(`Unknown menu template "${key}".`);
  return MENU_TEMPLATES[key];
}

/**
 * The print stylesheet, verbatim from food.css, plus the few base rules the
 * website inherited from Tailwind's preflight that the sheet depends on
 * (border-box sizing, 1.5 root line-height, zeroed margins). Without those the
 * un-styled line-heights (section titles, tags, prices, footer) drift.
 */
export const MENU_PRINT_CSS = `
*,::before,::after{box-sizing:border-box;margin:0;padding:0;border:0 solid}
html{line-height:1.5;-webkit-text-size-adjust:100%;tab-size:4;font-family:"Manrope",ui-sans-serif,system-ui,sans-serif}
body{line-height:inherit;background:#ffffff}
img{display:block;max-width:100%;height:auto;vertical-align:middle}

/* =========================================================
   À la carte food menu print sheets. Scoped under .food-print-page.
   Single forest-green ink and type pairing: Avenir (self-hosted) for
   names and heads, Cormorant italic for descriptions.
   ========================================================= */
.food-print-page{
  --ink:#1d2916;
  --ink-72:color-mix(in srgb, var(--ink) 72%, transparent);
  --ink-46:color-mix(in srgb, var(--ink) 46%, transparent);
  --ink-24:color-mix(in srgb, var(--ink) 24%, transparent);
  --stock:#ffffff;
  --sans:"avenir-lt-pro","Manrope",ui-sans-serif,sans-serif;
  --serif:"cormorant-garamond","Cormorant Garamond","Hoefler Text",Georgia,serif;
  background:#cdc6b8; padding:12mm 0; color:var(--ink);
}
.food-print-page.stock-cream{ --stock:#efe7d8; }

.food-print-page .sheet{
  width:210mm; height:297mm; margin:0 auto; background:var(--stock);
  box-sizing:border-box; padding:16mm 17mm 12mm; position:relative; overflow:hidden;
  display:flex; flex-direction:column;
  box-shadow:0 2px 18px rgba(0,0,0,.18);
  -webkit-print-color-adjust:exact; print-color-adjust:exact;
}

/* ---- masthead ---- */
.food-print-page .mast{ text-align:center; margin-bottom:8mm; }
.food-print-page .mast .logo{ height:15mm; width:auto; display:inline-block; }
.food-print-page.venue-avalon .mast .logo{ height:19mm; }
.food-print-page .mast .eyebrow{
  font-family:var(--sans); font-weight:500; font-size:8.5px; letter-spacing:.32em;
  text-transform:uppercase; color:var(--ink-46); margin-top:4.5mm;
}
.food-print-page .mast .rule{ width:14mm; height:1px; background:var(--ink-24); margin:4mm auto 3.5mm; }
.food-print-page .mast .title{ font-family:var(--serif); font-style:italic; font-size:19px; color:var(--ink-72); }

/* ---- columns ---- */
.food-print-page .cols{ display:grid; grid-template-columns:1fr 1fr; column-gap:12mm; }
.food-print-page .fsec{ margin-bottom:7mm; }
.food-print-page .fsec:last-child{ margin-bottom:0; }

.food-print-page .sec-head{ display:flex; align-items:center; gap:4mm; margin-bottom:3.6mm; }
.food-print-page .sec-head::before,
.food-print-page .sec-head::after{ content:""; flex:1; height:1px; background:var(--ink-24); }
.food-print-page .sec-title{
  font-family:var(--sans); font-weight:700; font-size:9.5px; letter-spacing:.3em;
  text-transform:uppercase; white-space:nowrap;
}
.food-print-page .sec-title .qual{ font-weight:500; color:var(--ink-46); letter-spacing:.2em; }

/* ---- dishes ---- */
.food-print-page .dish{ margin-bottom:3.1mm; break-inside:avoid; }
.food-print-page .dish.taco{ margin-bottom:2.6mm; }
.food-print-page .dish-top{ display:flex; justify-content:space-between; align-items:baseline; gap:4mm; }
.food-print-page .dname{ font-family:var(--sans); font-weight:500; font-size:12.5px; line-height:1.3; }
.food-print-page .dprice{ font-family:var(--sans); font-weight:500; font-size:12.5px; font-variant-numeric:tabular-nums; }
.food-print-page .tags{
  font-family:var(--sans); font-weight:500; font-size:7.5px; letter-spacing:.12em;
  color:var(--ink-46); white-space:nowrap; margin-left:1.2mm;
}
.food-print-page .ddesc{ font-family:var(--serif); font-style:italic; font-size:13px; line-height:1.25; color:var(--ink-72); margin-top:.4mm; }

.food-print-page .fsec.wide{ margin-top:1mm; }

/* ---- trust our chef ---- */
.food-print-page .chef{ margin-top:auto; padding-top:2mm; }
.food-print-page .chef-sub{ text-align:center; font-family:var(--serif); font-style:italic; font-size:12.5px; color:var(--ink-72); margin:-1mm 0 4mm; }
.food-print-page .chef-grid{ display:grid; grid-template-columns:repeat(3,1fr); }
.food-print-page .chef-item{ text-align:center; padding:0 5mm; }
.food-print-page .chef-item + .chef-item{ border-left:1px solid var(--ink-24); }
.food-print-page .chef-name{ font-family:var(--serif); font-style:italic; font-size:17px; }
.food-print-page .chef-price{ font-family:var(--sans); font-weight:500; font-size:12px; margin-top:.6mm; }
.food-print-page .chef-note{ font-family:var(--serif); font-style:italic; font-size:12.5px; line-height:1.25; color:var(--ink-72); margin-top:1mm; }

/* ---- footer ---- */
.food-print-page .foot{ text-align:center; margin-top:8mm; font-family:var(--sans); color:var(--ink-72); }
.food-print-page .foot .dietaries{ font-family:var(--serif); font-style:italic; font-size:12px; }
.food-print-page .foot .legend{ font-size:7.5px; letter-spacing:.08em; margin-top:1.8mm; color:var(--ink-46); }
.food-print-page .foot .surcharge{ font-size:8px; margin-top:1.4mm; }

@media print{
  .food-print-page{ background:none; padding:0; }
  .food-print-page .sheet{ box-shadow:none; margin:0; }
  body{ padding:0 !important; background:#ffffff !important; }
}

/* Boxed variant, inside a column (Avalon) */
.food-print-page .chef.boxed{ margin-top:7mm; padding:5mm 6mm 5.5mm; border:1px solid var(--ink-24); }
.food-print-page .chef.boxed .sec-head::before,
.food-print-page .chef.boxed .sec-head::after{ display:none; }
.food-print-page .chef.boxed .sec-head{ justify-content:center; }
.food-print-page .chef.boxed .chef-grid{ grid-template-columns:1fr; row-gap:3.5mm; }
.food-print-page .chef.boxed .chef-item + .chef-item{ border-left:0; }
.food-print-page .chef.boxed .chef-name{ display:inline; }
.food-print-page .chef.boxed .chef-price{ display:inline; margin-left:2mm; }
.food-print-page.chef-in-column .foot{ margin-top:auto; }

/* ===================== FINAL PRE-PRINT POLISH (Sep 2026) ===================== */
/* Balanced wraps: no dietary codes stranded on their own line */
.food-print-page .dname{ text-wrap:pretty; }
.food-print-page .ddesc{ text-wrap:pretty; }
.food-print-page .chef-note, .food-print-page .chef-sub{ text-wrap:balance; }
/* Dietary codes: present, but quieter than the dish */
.food-print-page .tags{ color:color-mix(in srgb, #1d2916 40%, transparent); font-weight:500; }
/* Trust our chef: name + price scan first */
.food-print-page .chef-price{ font-size:12.5px; margin-top:.8mm; }
.food-print-page .chef-item{ padding:0 6mm; }
/* Footer: readable, quiet */
.food-print-page .foot .surcharge{ color:color-mix(in srgb, #1d2916 58%, transparent); }
`;

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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function visibleItems(section: MenuSectionDocument): MenuItemDocument[] {
  return section.items.filter((item) => item.visible);
}

function renderDish(item: MenuItemDocument, section: MenuSectionDocument): string {
  const namesOnly = section.sectionType === 'HEADER_PRICED';
  const description = namesOnly ? null : item.description;
  const tags = formatMenuTags(item.tags);
  const price = namesOnly ? '' : formatMenuPrice(item.priceCents, item.priceUnit);
  return (
    `<div class="${description ? 'dish' : 'dish taco'}" data-dish-key="${escapeHtml(item.dishKey ?? '')}">` +
    `<div class="dish-top">` +
    `<span class="dname">${escapeHtml(item.name)}${tags ? ` <span class="tags">${escapeHtml(tags)}</span>` : ''}</span>` +
    (price ? `<span class="dprice">${escapeHtml(price)}</span>` : '') +
    `</div>` +
    (description ? `<div class="ddesc">${escapeHtml(description)}</div>` : '') +
    `</div>`
  );
}

function renderSectionHead(section: MenuSectionDocument): string {
  const suffix = section.headerSuffix ? `<span class="qual"> / ${escapeHtml(section.headerSuffix)}</span>` : '';
  return `<div class="sec-head"><span class="sec-title">${escapeHtml(section.title)}${suffix}</span></div>`;
}

function renderColumnSection(section: MenuSectionDocument): string {
  if (section.sectionType === 'SET_MENUS') return renderSetMenus(section, true);
  return `<div class="fsec" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}${visibleItems(section)
    .map((item) => renderDish(item, section))
    .join('')}</div>`;
}

/** A full-width standard section: heading spans the page, items flow into two columns. */
function renderWideSection(section: MenuSectionDocument): string {
  return (
    `<div class="fsec wide" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}<div class="cols">` +
    visibleItems(section)
      .map((item) => `<div class="col">${renderDish(item, section)}</div>`)
      .join('') +
    `</div></div>`
  );
}

/** Trust our chef — a band (three columns with hairlines) or a boxed panel inside a column. */
function renderSetMenus(section: MenuSectionDocument, boxed: boolean): string {
  return (
    `<div class="${boxed ? 'chef boxed' : 'chef'}" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}` +
    (section.subheading ? `<div class="chef-sub">${escapeHtml(section.subheading)}</div>` : '') +
    `<div class="chef-grid">` +
    visibleItems(section)
      .map(
        (item) =>
          `<div class="chef-item" data-dish-key="${escapeHtml(item.dishKey ?? '')}">` +
          `<div class="chef-name">${escapeHtml(item.name)}</div>` +
          `<div class="chef-price">${escapeHtml(formatMenuPrice(item.priceCents, item.priceUnit))}</div>` +
          (item.description ? `<div class="chef-note">${escapeHtml(item.description)}</div>` : '') +
          `</div>`
      )
      .join('') +
    `</div></div>`
  );
}

/** The sheet's <main>, without the document wrapper — what the preview and the PDF share. */
export function renderMenuSheetHtml(doc: MenuDocument, templateKey: string, options: MenuRenderOptions): string {
  const template = getMenuTemplate(templateKey);
  const sections = doc.sections.filter((section) => section.visible);
  const left = sections.filter((section) => section.placement === 'LEFT');
  const right = sections.filter((section) => section.placement === 'RIGHT');
  const full = sections.filter((section) => section.placement === 'FULL');
  const chefInColumn = [...left, ...right].some((section) => section.sectionType === 'SET_MENUS');
  const stock = options.stock ?? 'white';
  const legend = menuTagLegend(doc);

  const column = (list: MenuSectionDocument[]) => `<div class="col">${list.map(renderColumnSection).join('')}</div>`;

  return (
    `<main class="food-print-page stock-${stock} venue-${template.venueClass}${chefInColumn ? ' chef-in-column' : ''}">` +
    `<section class="sheet a4">` +
    `<div class="mast">` +
    `<img class="logo" src="${escapeHtml(options.assets.logoSrc(template.logo.asset))}" alt="${escapeHtml(template.logo.alt)}">` +
    `<div class="eyebrow">${escapeHtml(template.tagline)}</div>` +
    `<div class="rule"></div>` +
    `<div class="title">${escapeHtml(template.title)}</div>` +
    `</div>` +
    `<div class="cols">${column(left)}${column(right)}</div>` +
    full.map((section) => (section.sectionType === 'SET_MENUS' ? renderSetMenus(section, false) : renderWideSection(section))).join('') +
    `<div class="foot">` +
    `<div class="dietaries">${escapeHtml(doc.dietaryNote)}</div>` +
    `<div class="legend">${escapeHtml(legend)}</div>` +
    `<div class="surcharge">${escapeHtml(doc.surchargeLine)}</div>` +
    `</div>` +
    `</section></main>`
  );
}

/** A complete, self-contained HTML document: fonts, print CSS, @page, the sheet. */
export function renderMenuHtml(doc: MenuDocument, templateKey: string, options: MenuRenderOptions): string {
  const template = getMenuTemplate(templateKey);
  const title = options.title ?? `${template.label}`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${options.assets.fontFaceCss}</style>` +
    `<style>${MENU_PRINT_CSS}</style>` +
    `<style>@page { size: ${template.page.widthMm}mm ${template.page.heightMm}mm; margin: 0; }</style>` +
    `</head><body>${renderMenuSheetHtml(doc, templateKey, options)}</body></html>`
  );
}

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
  'avalon-logo': 'avalon-logo.png'
};
