/**
 * The locked print templates: a MenuDocument in, printed sheets out.
 *
 * The A4 à la carte sheet is ported from the website's print route
 * (alma-web-platform apps/web/app/print/_food/FoodSheet.tsx + food.css), which
 * is what produced the current menus in headless Chrome. Every mm, px and
 * letter-spacing value is kept; the only change is that content, placement and
 * section type come from data instead of from a hand-written TS file. The
 * multi-page families (drinks books, the functions document, the A5 cards) are
 * drawn by menu-render-pages.ts on the same tokens.
 *
 * The same function renders the editor's live preview (in an iframe) and the
 * published PDF (in headless Chrome), so what the chef sees is what prints.
 *
 * Adding a template: add a key to MENU_TEMPLATES with its venue, kinds, format
 * and family. Layout is driven by the family and by section placement/type, so
 * a new venue's à la carte or a second A5 card needs no new CSS; a genuinely
 * new layout gets its own family module.
 */
import { formatMenuPrice, formatMenuTags, menuTagLegend, type MenuDocument, type MenuItemDocument, type MenuKind, type MenuSectionDocument } from './menus.js';
import {
  escapeHtml,
  MENU_BASE_CSS,
  MENU_FORMATS,
  menuPrintedHeading,
  visibleItems,
  type MenuFormat,
  type MenuRenderOptions,
  type MenuTemplate
} from './menu-render-core.js';
import { MENU_PAGES_CSS, renderPagedSheets } from './menu-render-pages.js';

export * from './menu-render-core.js';
export * from './menu-render-pages.js';

export const MENU_TEMPLATE_KEYS = [
  'freshwater_alacarte',
  'avalon_alacarte',
  'freshwater_drinks_binder',
  'avalon_drinks_book',
  'group_functions_a4',
  'freshwater_card_a5',
  'avalon_card_a5'
] as const;
export type MenuTemplateKey = (typeof MENU_TEMPLATE_KEYS)[number];

const SURCHARGE_LINE = 'A surcharge of 10% applies on weekends and 15% on public holidays.';

function template(definition: Omit<MenuTemplate, 'page'> & { key: MenuTemplateKey }): MenuTemplate & { key: MenuTemplateKey } {
  const format = MENU_FORMATS[definition.format];
  return { ...definition, page: { widthMm: format.widthMm, heightMm: format.heightMm } };
}

export const MENU_TEMPLATES: Record<MenuTemplateKey, MenuTemplate & { key: MenuTemplateKey }> = {
  freshwater_alacarte: template({
    key: 'freshwater_alacarte',
    label: 'St Alma Freshwater · À la carte (A4)',
    venueSlug: 'st-alma',
    venueClass: 'stalma',
    logo: { asset: 'stalma-logo', alt: 'st.alma' },
    tagline: 'Restaurant & Bar · Freshwater',
    title: 'À la carte',
    kinds: ['FOOD'],
    format: 'A4',
    family: 'food-a4',
    multiPage: false,
    defaults: { dietaryNote: 'Dietaries catered with notice. Please advise your server of any allergies.', surchargeLine: SURCHARGE_LINE }
  }),
  avalon_alacarte: template({
    key: 'avalon_alacarte',
    label: 'Alma Avalon · À la carte (A4)',
    venueSlug: 'alma-avalon',
    venueClass: 'avalon',
    logo: { asset: 'avalon-logo', alt: 'alma restaurant & bar' },
    tagline: 'Avalon Beach · Est 2017',
    title: 'À la carte',
    kinds: ['FOOD'],
    format: 'A4',
    family: 'food-a4',
    multiPage: false,
    defaults: {
      dietaryNote: 'Dietaries catered with notice. Dishes may contain traces of allergens. Please advise your server of any allergies.',
      surchargeLine: SURCHARGE_LINE
    }
  }),
  freshwater_drinks_binder: template({
    key: 'freshwater_drinks_binder',
    label: 'St Alma Freshwater · Drinks binder (A5 landscape, pages)',
    venueSlug: 'st-alma',
    venueClass: 'stalma',
    logo: { asset: 'stalma-logo', alt: 'st.alma' },
    tagline: 'Restaurant & Bar · Freshwater',
    title: 'Drinks',
    kinds: ['DRINKS'],
    format: 'A5L',
    family: 'drinks-a5l',
    multiPage: true,
    defaults: { surchargeLine: `${SURCHARGE_LINE} Wine vintages may be subject to change.` }
  }),
  avalon_drinks_book: template({
    key: 'avalon_drinks_book',
    label: 'Alma Avalon · Drinks book (A5 portrait, pages)',
    venueSlug: 'alma-avalon',
    venueClass: 'avalon',
    logo: { asset: 'avalon-logo', alt: 'alma restaurant & bar' },
    tagline: 'Restaurant & Bar · Avalon Beach',
    title: 'Drinks',
    kinds: ['DRINKS'],
    format: 'A5P',
    family: 'drinks-a5p',
    multiPage: true,
    defaults: { surchargeLine: SURCHARGE_LINE }
  }),
  group_functions_a4: template({
    key: 'group_functions_a4',
    label: 'Alma Group · Functions & groups (A4, pages)',
    venueSlug: null,
    venueClass: 'group',
    logo: { asset: 'group-logo', alt: 'alma group' },
    tagline: 'St Alma, Freshwater · Alma Avalon',
    title: 'Functions & groups',
    kinds: ['FUNCTIONS'],
    format: 'A4',
    family: 'functions-a4',
    multiPage: true,
    defaults: { surchargeLine: 'A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays.' }
  }),
  // The A5 table cards: happy hour, bottomless, specials and private-event set
  // menus. One family, one card, front and back at most; the document's
  // section types make the variants, the venue mark makes the venue.
  freshwater_card_a5: template({
    key: 'freshwater_card_a5',
    label: 'St Alma Freshwater · Table card (A5)',
    venueSlug: 'st-alma',
    venueClass: 'stalma',
    logo: { asset: 'stalma-logo', alt: 'st.alma' },
    tagline: 'Restaurant & Bar · Freshwater',
    title: 'Specials',
    kinds: ['PROMOTION', 'PRIVATE_EVENT'],
    format: 'A5P',
    family: 'card-a5',
    multiPage: true,
    maxPages: 2,
    defaults: { surchargeLine: SURCHARGE_LINE }
  }),
  avalon_card_a5: template({
    key: 'avalon_card_a5',
    label: 'Alma Avalon · Table card (A5)',
    venueSlug: 'alma-avalon',
    venueClass: 'avalon',
    logo: { asset: 'avalon-logo', alt: 'alma restaurant & bar' },
    tagline: 'Avalon Beach · Est 2017',
    title: 'Specials',
    kinds: ['PROMOTION', 'PRIVATE_EVENT'],
    format: 'A5P',
    family: 'card-a5',
    multiPage: true,
    maxPages: 2,
    defaults: { surchargeLine: SURCHARGE_LINE }
  })
};

export function isMenuTemplateKey(value: unknown): value is MenuTemplateKey {
  return typeof value === 'string' && value in MENU_TEMPLATES;
}

export function getMenuTemplate(key: string): MenuTemplate {
  if (!isMenuTemplateKey(key)) throw new Error(`Unknown menu template "${key}".`);
  return MENU_TEMPLATES[key];
}

/**
 * The print templates a venue's menus may use — its own logo and tagline, or a
 * group-branded document any venue may own. Narrowed to a kind when given.
 */
export function menuTemplatesForVenue(venueSlug: string, kind?: MenuKind): MenuTemplate[] {
  return Object.values(MENU_TEMPLATES).filter(
    (template) => (template.venueSlug === null || template.venueSlug === venueSlug) && (kind === undefined || template.kinds.includes(kind))
  );
}

/** "A4", "A5 portrait · 3 pages" — the format line on a home card. */
export function describeMenuFormat(format: MenuFormat, pageCount = 1): string {
  const label = MENU_FORMATS[format].label;
  return pageCount > 1 ? `${label} · ${pageCount} pages` : label;
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

/* ---- V2 section types on the A4 food sheet (text, list) ---- */
.food-print-page .fsec .lead{ font-family:var(--sans); font-weight:700; font-size:8px; letter-spacing:.14em; text-transform:uppercase; color:var(--ink-46); margin:-1.5mm 0 2.5mm; text-align:center; }
.food-print-page .fsec .para{ font-family:var(--serif); font-style:italic; font-size:13px; line-height:1.3; color:var(--ink-72); }
.food-print-page .fsec .para + .para{ margin-top:1.5mm; }
.food-print-page .dmeta{ font-family:var(--sans); font-weight:500; font-size:8.5px; letter-spacing:.02em; color:var(--ink-46); margin-left:1.2mm; }
.food-print-page .dnote{ font-family:var(--sans); font-weight:400; font-size:9px; letter-spacing:.02em; color:color-mix(in srgb, #1d2916 52%, transparent); margin-top:.3mm; }
`;

// ---------------------------------------------------------------------------
// The A4 food sheet
// ---------------------------------------------------------------------------

function renderDish(item: MenuItemDocument, section: MenuSectionDocument, showPrices: boolean): string {
  const namesOnly = section.sectionType === 'HEADER_PRICED' || section.sectionType === 'LIST';
  const description = namesOnly ? null : item.description;
  const tags = formatMenuTags(item.tags);
  const price = namesOnly || !showPrices ? '' : formatMenuPrice(item.priceCents, item.priceUnit);
  const meta = item.meta ? ` <span class="dmeta">${escapeHtml(item.meta)}</span>` : '';
  const note = !namesOnly && item.note ? `<div class="dnote">${escapeHtml(item.note)}</div>` : '';
  return (
    `<div class="${description ? 'dish' : 'dish taco'}" data-dish-key="${escapeHtml(item.dishKey ?? '')}">` +
    `<div class="dish-top">` +
    `<span class="dname">${escapeHtml(item.name)}${meta}${tags ? ` <span class="tags">${escapeHtml(tags)}</span>` : ''}</span>` +
    (price ? `<span class="dprice">${escapeHtml(price)}</span>` : '') +
    `</div>` +
    (description ? `<div class="ddesc">${escapeHtml(description)}</div>` : '') +
    note +
    `</div>`
  );
}

function renderSectionHead(section: MenuSectionDocument): string {
  const suffix = section.headerSuffix ? `<span class="qual"> / ${escapeHtml(section.headerSuffix)}</span>` : '';
  return `<div class="sec-head"><span class="sec-title">${escapeHtml(section.title)}${suffix}</span></div>`;
}

function renderLead(section: MenuSectionDocument): string {
  return section.lead ? `<div class="lead">${escapeHtml(section.lead)}</div>` : '';
}

function renderTextBlock(section: MenuSectionDocument): string {
  const paragraphs = (section.body ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p class="para">${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<div class="fsec text" data-section-id="${escapeHtml(section.id ?? '')}">${section.title.trim() ? renderSectionHead(section) : ''}${renderLead(section)}${paragraphs}</div>`;
}

function renderColumnSection(section: MenuSectionDocument, showPrices: boolean): string {
  if (section.sectionType === 'SET_MENUS') return renderSetMenus(section, true, showPrices);
  if (section.sectionType === 'TEXT') return renderTextBlock(section);
  return `<div class="fsec" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}${renderLead(section)}${visibleItems(section)
    .map((item) => renderDish(item, section, showPrices))
    .join('')}</div>`;
}

/** A full-width standard section: heading spans the page, items flow into two columns. */
function renderWideSection(section: MenuSectionDocument, showPrices: boolean): string {
  if (section.sectionType === 'TEXT') return renderTextBlock(section);
  return (
    `<div class="fsec wide" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}${renderLead(section)}<div class="cols">` +
    visibleItems(section)
      .map((item) => `<div class="col">${renderDish(item, section, showPrices)}</div>`)
      .join('') +
    `</div></div>`
  );
}

/** Trust our chef — a band (three columns with hairlines) or a boxed panel inside a column. */
function renderSetMenus(section: MenuSectionDocument, boxed: boolean, showPrices: boolean): string {
  return (
    `<div class="${boxed ? 'chef boxed' : 'chef'}" data-section-id="${escapeHtml(section.id ?? '')}">${renderSectionHead(section)}` +
    (section.subheading ? `<div class="chef-sub">${escapeHtml(section.subheading)}</div>` : '') +
    `<div class="chef-grid">` +
    visibleItems(section)
      .map(
        (item) =>
          `<div class="chef-item" data-dish-key="${escapeHtml(item.dishKey ?? '')}">` +
          `<div class="chef-name">${escapeHtml(item.name)}</div>` +
          (showPrices ? `<div class="chef-price">${escapeHtml(formatMenuPrice(item.priceCents, item.priceUnit))}</div>` : '') +
          (item.description ? `<div class="chef-note">${escapeHtml(item.description)}</div>` : '') +
          `</div>`
      )
      .join('') +
    `</div></div>`
  );
}

/** The A4 à la carte sheet: masthead, two columns, full-width sections, footer. */
function renderFoodSheetHtml(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions): string {
  const sections = doc.sections.filter((section) => section.visible);
  const left = sections.filter((section) => section.placement === 'LEFT');
  const right = sections.filter((section) => section.placement === 'RIGHT');
  const full = sections.filter((section) => section.placement === 'FULL');
  const chefInColumn = [...left, ...right].some((section) => section.sectionType === 'SET_MENUS');
  const stock = options.stock ?? 'white';
  const legend = menuTagLegend(doc);
  const showPrices = doc.showPrices ?? true;

  const column = (list: MenuSectionDocument[]) => `<div class="col">${list.map((section) => renderColumnSection(section, showPrices)).join('')}</div>`;

  return (
    `<main class="food-print-page stock-${stock} venue-${template.venueClass}${chefInColumn ? ' chef-in-column' : ''}">` +
    `<section class="sheet a4">` +
    `<div class="mast">` +
    `<img class="logo" src="${escapeHtml(options.assets.logoSrc(template.logo.asset))}" alt="${escapeHtml(template.logo.alt)}">` +
    `<div class="eyebrow">${escapeHtml(template.tagline)}</div>` +
    `<div class="rule"></div>` +
    `<div class="title">${escapeHtml(menuPrintedHeading(doc, template))}</div>` +
    `</div>` +
    `<div class="cols">${column(left)}${column(right)}</div>` +
    full.map((section) => (section.sectionType === 'SET_MENUS' ? renderSetMenus(section, false, showPrices) : renderWideSection(section, showPrices))).join('') +
    `<div class="foot">` +
    `<div class="dietaries">${escapeHtml(doc.dietaryNote)}</div>` +
    `<div class="legend">${escapeHtml(legend)}</div>` +
    `<div class="surcharge">${escapeHtml(doc.surchargeLine)}</div>` +
    `</div>` +
    `</section></main>`
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/** The sheets' <main>, without the document wrapper — what the preview and the PDF share. */
export function renderMenuSheetHtml(doc: MenuDocument, templateKey: string, options: MenuRenderOptions): string {
  const template = getMenuTemplate(templateKey);
  switch (template.family) {
    case 'food-a4':
      return renderFoodSheetHtml(doc, template, options);
    case 'drinks-a5p':
    case 'drinks-a5l':
    case 'functions-a4':
    case 'card-a5':
      return renderPagedSheets(doc, template, options);
    default: {
      const never: never = template.family;
      throw new Error(`No renderer for family ${String(never)}.`);
    }
  }
}

/** A complete, self-contained HTML document: fonts, print CSS, @page, the sheets. */
export function renderMenuHtml(doc: MenuDocument, templateKey: string, options: MenuRenderOptions): string {
  const template = getMenuTemplate(templateKey);
  const title = options.title ?? `${template.label}`;
  const css = template.family === 'food-a4' ? MENU_PRINT_CSS : `${MENU_BASE_CSS}\n${MENU_PAGES_CSS}`;
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(title)}</title>` +
    `<style>${options.assets.fontFaceCss}</style>` +
    `<style>${css}</style>` +
    `<style>@page { size: ${template.page.widthMm}mm ${template.page.heightMm}mm; margin: 0; }</style>` +
    `</head><body>${renderMenuSheetHtml(doc, templateKey, options)}</body></html>`
  );
}
