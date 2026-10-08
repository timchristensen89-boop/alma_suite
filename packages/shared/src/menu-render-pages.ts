/**
 * The paged families: drinks books (A5 portrait and landscape), the functions
 * document (A4) and — from the same grammar — the A5 cards. One fixed-size
 * sheet per declared page; sections name the page they print on, so a staff
 * member controls page breaks explicitly and the preview shows every sheet.
 *
 * Tokens are the ones the website's drinks sheets were designed on
 * (alma-web-platform apps/web/app/print/alma-avalon-drinks/avalon.css and
 * st-alma-drinks/binder.css): single forest ink, Avenir caps labels, Cormorant
 * italic for everything editorial, hairline-flanked section heads, tabular
 * prices with no currency sign, the arch as the only ornament.
 */
import { formatMenuPrice, formatMenuTags, menuTagLegend, sortMenuItemFlags, MENU_ITEM_FLAGS, type MenuDocument, type MenuItemDocument, type MenuSectionDocument } from './menus.js';
import { escapeHtml, escapeParagraphs, menuPrintedHeading, openPrintPage, sectionsByPage, visibleItems, type MenuRenderOptions, type MenuTemplate } from './menu-render-core.js';

export const MENU_PAGES_CSS = `
/* ---- sheet padding per family ---- */
.menu-print-page.family-drinks-a5p .sheet{ padding:12mm 13mm 11mm; }
.menu-print-page.family-drinks-a5l .sheet{ padding:11mm 14mm 9mm; }
.menu-print-page.family-functions-a4 .sheet{ padding:16mm 17mm 14mm; }
.menu-print-page.family-card-a5 .sheet{ padding:12mm 13mm 11mm; }
.menu-print-page .sheet{ display:flex; flex-direction:column; }
.menu-print-page .page-body{ flex:1 1 auto; min-height:0; }

/* ---- running head (inner pages) ---- */
.menu-print-page .runhead{ text-align:center; margin-bottom:6mm; }
.menu-print-page .runhead .logo{ height:6.6mm; width:auto; display:inline-block; }
.menu-print-page.venue-stalma .runhead .logo{ height:5.8mm; }
.menu-print-page.venue-group .runhead .logo{ height:7mm; }
.menu-print-page.family-functions-a4 .runhead .logo{ height:11mm; }
.menu-print-page .runhead .eyebrow{
  font-family:var(--sans); font-weight:700; font-size:9px; letter-spacing:.42em;
  text-transform:uppercase; color:var(--ink-46); margin-top:3mm;
}
.menu-print-page .runhead .rule{ width:11mm; height:1px; background:var(--ink-30); margin:4mm auto 0; }
.menu-print-page .page-title{ font-family:var(--serif); font-style:italic; font-size:30px; line-height:1; margin:0 0 4mm; }
.menu-print-page.family-functions-a4 .page-title{ font-size:34px; }

/* ---- cover ---- */
.menu-print-page .cover{ display:flex; flex-direction:column; align-items:center; text-align:center; flex:1 1 auto; }
.menu-print-page .cover .biglogo{ width:auto; height:auto; max-width:96mm; max-height:28mm; margin-top:18mm; }
.menu-print-page.venue-stalma .cover .biglogo{ max-width:60mm; max-height:18.2mm; }
.menu-print-page.venue-group .cover .biglogo{ max-width:60mm; max-height:31mm; }
.menu-print-page .cover .t-line{
  font-family:var(--sans); font-weight:700; font-size:9.5px; letter-spacing:.42em;
  text-transform:uppercase; color:var(--ink-46); margin-top:9mm;
}
.menu-print-page .cover .t-title{ font-family:var(--serif); font-style:italic; font-size:52px; line-height:.92; margin-top:7mm; }
.menu-print-page.family-drinks-a5l .cover .t-title{ font-size:54px; }
.menu-print-page.family-functions-a4 .cover .t-title{ font-size:60px; }
.menu-print-page .cover .t-sub{ font-family:var(--serif); font-style:italic; font-size:36px; line-height:1; color:var(--ink-72); margin-top:1.5mm; }
.menu-print-page.family-drinks-a5l .cover .t-sub{ font-size:38px; }
.menu-print-page .cover .t-when{ font-family:var(--sans); font-weight:700; font-size:9.5px; letter-spacing:.3em; text-transform:uppercase; color:var(--ink-58); margin-top:7mm; }
.menu-print-page .cover .t-price{ font-family:var(--sans); font-weight:500; font-size:18px; font-variant-numeric:tabular-nums; margin-top:4mm; }
.menu-print-page .cover .t-nav{
  font-family:var(--sans); font-weight:700; font-size:8.5px; letter-spacing:.24em; text-transform:uppercase;
  color:var(--ink-58); margin-top:12mm; line-height:1.9;
}
.menu-print-page .cover .t-nav .num{ letter-spacing:.08em; color:var(--ink-46); font-variant-numeric:tabular-nums; margin:0 .6em 0 .3em; }
.menu-print-page .cover .t-arch{
  width:52mm; height:21mm; margin-top:auto; margin-bottom:12mm;
  border:1px solid var(--ink-18); border-bottom:0; border-radius:26mm 26mm 0 0;
}
.menu-print-page.family-drinks-a5l .cover .t-arch{ width:54mm; height:22mm; }
.menu-print-page.family-functions-a4 .cover .t-arch{ width:64mm; height:26mm; }

/* ---- columns (A5 landscape binder) ---- */
.menu-print-page.family-drinks-a5l .page-body{ column-count:2; column-gap:9mm; column-rule:1px solid var(--ink-11); column-fill:auto; }
.menu-print-page.family-drinks-a5l .runhead{ column-span:all; }
.menu-print-page.family-drinks-a5l .onecol .page-body{ column-count:1; }
.menu-print-page.family-functions-a4 .cols2{ display:grid; grid-template-columns:1fr 1fr; column-gap:12mm; }

/* ---- sections ---- */
.menu-print-page .psec{ margin-bottom:8mm; break-inside:avoid-column; }
.menu-print-page .psec:last-child{ margin-bottom:0; }
.menu-print-page .sec-head{ display:flex; align-items:center; gap:5mm; margin-bottom:4mm; }
.menu-print-page .sec-head::before,
.menu-print-page .sec-head::after{ content:""; flex:1; height:1px; background:var(--ink-18); }
.menu-print-page .sec-title{
  font-family:var(--sans); font-weight:700; font-size:11px; letter-spacing:.3em;
  text-transform:uppercase; white-space:nowrap;
}
.menu-print-page.family-functions-a4 .sec-title{ font-size:10px; }
.menu-print-page .sec-title .qual{ font-weight:500; color:var(--ink-46); letter-spacing:.18em; }
.menu-print-page .callout{ font-family:var(--serif); font-style:italic; font-size:13px; line-height:1.35; color:var(--ink-72); margin:-1.5mm 0 4mm; text-wrap:pretty; }
.menu-print-page .lead{
  font-family:var(--sans); font-weight:700; font-size:9px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-52); margin:-1.5mm 0 3mm;
}

/* ---- rows ---- */
.menu-print-page .drink{ margin-bottom:3.4mm; break-inside:avoid; }
.menu-print-page .drink-top{ display:grid; grid-template-columns:1fr auto; align-items:baseline; column-gap:4mm; }
.menu-print-page .dname{ font-family:var(--sans); font-weight:700; font-size:11.5px; line-height:1.2; letter-spacing:.115em; text-transform:uppercase; text-wrap:pretty; }
.menu-print-page.family-functions-a4 .dname,
.menu-print-page.family-card-a5 .dname{ font-weight:500; font-size:12.5px; letter-spacing:0; text-transform:none; line-height:1.3; }
.menu-print-page .dmeta{ font-family:var(--sans); font-weight:500; font-size:9px; letter-spacing:.02em; text-transform:none; color:var(--ink-46); margin-left:1.5mm; }
.menu-print-page .dmark{ font-family:var(--sans); font-weight:700; font-size:8.5px; letter-spacing:.14em; color:var(--ink-46); margin-left:1.5mm; }
.menu-print-page .tags{ font-family:var(--sans); font-weight:500; font-size:8.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-40); white-space:nowrap; margin-left:1.5mm; }
.menu-print-page .dprice{ font-family:var(--sans); font-weight:500; font-size:12px; font-variant-numeric:tabular-nums; }
.menu-print-page .ding{ font-family:var(--serif); font-style:italic; font-size:13.5px; line-height:1.25; color:var(--ink-72); margin-top:.5mm; text-wrap:pretty; }
.menu-print-page .dnote{ font-family:var(--sans); font-weight:400; font-size:9px; letter-spacing:.02em; color:var(--ink-52); margin-top:.6mm; }

/* names only */
.menu-print-page .pour{ display:grid; grid-template-columns:1fr auto; column-gap:4mm; align-items:baseline; padding:.6mm 0; break-inside:avoid; }
.menu-print-page .pname{ font-family:var(--sans); font-weight:500; font-size:12px; line-height:1.3; }
.menu-print-page .list .pname{ font-size:12px; }

/* price table */
.menu-print-page .wine-head{ display:grid; column-gap:3mm; align-items:end; border-bottom:1px solid var(--ink-18); padding-bottom:2mm; margin-bottom:2.2mm; }
.menu-print-page .wine-head span{ font-family:var(--sans); font-weight:700; font-size:8px; letter-spacing:.16em; text-transform:uppercase; color:var(--ink-46); text-align:right; }
.menu-print-page .wine-head span:first-child{ text-align:left; }
.menu-print-page .wine{ display:grid; column-gap:3mm; align-items:baseline; margin-bottom:2.2mm; break-inside:avoid; }
.menu-print-page .wname{ font-family:var(--sans); font-weight:500; font-size:11.5px; line-height:1.25; text-wrap:pretty; }
.menu-print-page .wreg{ font-family:var(--serif); font-style:italic; font-size:12px; color:var(--ink-72); margin-left:1.5mm; }
.menu-print-page .wp{ font-family:var(--sans); font-weight:500; font-size:11px; font-variant-numeric:tabular-nums; text-align:right; }
.menu-print-page .wp.empty{ color:var(--ink-18); }

/* packages */
.menu-print-page .pkg{ margin-bottom:4mm; break-inside:avoid; }
.menu-print-page .pkg .dname{ font-weight:700; font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
.menu-print-page .pkg .dprice{ font-size:12.5px; }
.menu-print-page .pkg .ding{ font-size:13px; }

/* text */
.menu-print-page .para{ font-family:var(--serif); font-style:italic; font-size:13.5px; line-height:1.35; color:var(--ink-72); text-wrap:pretty; }
.menu-print-page .para + .para{ margin-top:2mm; }

/* legend for marks and tags, generated */
.menu-print-page .marks{ font-family:var(--sans); font-weight:500; font-size:8.5px; letter-spacing:.05em; color:var(--ink-46); margin-top:4mm; }

/* ---- footer ---- */
.menu-print-page .foot{ text-align:center; margin-top:auto; padding-top:5mm; font-family:var(--sans); color:var(--ink-72); }
.menu-print-page .foot .dietaries{ font-family:var(--serif); font-style:italic; font-size:12px; }
.menu-print-page .foot .conditions{ font-family:var(--sans); font-weight:400; font-size:9.5px; line-height:1.45; letter-spacing:.02em; color:var(--ink-58); text-wrap:pretty; }
.menu-print-page .foot .conditions + .conditions{ margin-top:.8mm; }
.menu-print-page .foot .legend{ font-size:8.5px; letter-spacing:.06em; margin-top:1.8mm; color:var(--ink-46); }
.menu-print-page .foot .surcharge{ font-size:9px; margin-top:1.4mm; color:var(--ink-58); }
.menu-print-page .cover .foot{ padding-top:0; }
.menu-print-page.family-drinks-a5l .foot{ column-span:all; }
`;

type FamilyRules = {
  /** Page 1 is a cover: wordmark, title, contents. Sections on page 1 print beneath it. */
  cover: boolean;
  /** The cover's mark: the group wordmark on the Avalon drinks book, the venue mark elsewhere. */
  coverLogo: MenuTemplate['logo']['asset'] | null;
  folio: boolean;
};

function rulesFor(template: MenuTemplate): FamilyRules {
  switch (template.family) {
    case 'drinks-a5p':
      return { cover: true, coverLogo: template.venueClass === 'avalon' ? 'alma-wordmark' : template.logo.asset, folio: true };
    case 'drinks-a5l':
      return { cover: true, coverLogo: template.logo.asset, folio: true };
    case 'functions-a4':
      return { cover: true, coverLogo: 'alma-wordmark', folio: true };
    default:
      return { cover: false, coverLogo: null, folio: false };
  }
}

function marksFor(item: MenuItemDocument): string {
  return sortMenuItemFlags(item.flags ?? [])
    .map((code) => MENU_ITEM_FLAGS.find((flag) => flag.code === code)?.mark ?? '')
    .filter(Boolean)
    .join(' ');
}

/** "• Staff pick · ** Limited stock" — only the marks in use on printed items. */
function marksLegend(doc: MenuDocument): string {
  const used = new Set<string>();
  for (const section of doc.sections) {
    if (!section.visible) continue;
    for (const item of section.items) {
      if (!item.visible) continue;
      for (const code of sortMenuItemFlags(item.flags ?? [])) used.add(code);
    }
  }
  return MENU_ITEM_FLAGS.filter((flag) => used.has(flag.code) && flag.mark)
    .map((flag) => `${flag.mark} ${flag.label}`)
    .join(' · ');
}

function sectionHead(section: MenuSectionDocument): string {
  if (!section.title.trim()) return '';
  const suffix = section.headerSuffix ? `<span class="qual"> / ${escapeHtml(section.headerSuffix)}</span>` : '';
  return `<div class="sec-head"><span class="sec-title">${escapeHtml(section.title)}${suffix}</span></div>`;
}

function nameLine(item: MenuItemDocument): string {
  const marks = marksFor(item);
  const meta = item.meta ? `<span class="dmeta">${escapeHtml(item.meta)}</span>` : '';
  const tags = formatMenuTags(item.tags);
  return (
    `<span class="dname">${escapeHtml(item.name)}${meta}${marks ? `<span class="dmark">${escapeHtml(marks)}</span>` : ''}${
      tags ? `<span class="tags">${escapeHtml(tags)}</span>` : ''
    }</span>`
  );
}

function renderRow(item: MenuItemDocument, section: MenuSectionDocument, showPrices: boolean): string {
  const price = showPrices ? formatMenuPrice(item.priceCents, item.priceUnit) : '';
  const cls = section.sectionType === 'SET_MENUS' ? 'drink pkg' : 'drink';
  return (
    `<div class="${cls}" data-dish-key="${escapeHtml(item.dishKey ?? '')}"><div class="drink-top">${nameLine(item)}${
      price ? `<span class="dprice">${escapeHtml(price)}</span>` : ''
    }</div>` +
    (item.description ? `<div class="ding">${escapeHtml(item.description)}</div>` : '') +
    (item.note ? `<div class="dnote">${escapeHtml(item.note)}</div>` : '') +
    `</div>`
  );
}

function renderNameRow(item: MenuItemDocument): string {
  return `<div class="pour" data-dish-key="${escapeHtml(item.dishKey ?? '')}">${nameLine(item).replace('class="dname"', 'class="pname"')}</div>`;
}

function renderTable(section: MenuSectionDocument, showPrices: boolean): string {
  const columns = section.priceColumns;
  const grid = `grid-template-columns:minmax(0,1fr) repeat(${columns.length},14mm)`;
  const head =
    columns.length > 0
      ? `<div class="wine-head" style="${grid}"><span></span>${columns.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</div>`
      : '';
  const rows = visibleItems(section)
    .map((item) => {
      const cells = columns
        .map((_label, index) => {
          const price = item.prices[index] ?? null;
          return price === null || !showPrices ? `<span class="wp empty">·</span>` : `<span class="wp">${escapeHtml(formatMenuPrice(price))}</span>`;
        })
        .join('');
      const marks = marksFor(item);
      return (
        `<div class="wine" style="${grid}" data-dish-key="${escapeHtml(item.dishKey ?? '')}">` +
        `<span class="wname">${escapeHtml(item.name)}${item.meta ? `<span class="wreg">${escapeHtml(item.meta)}</span>` : ''}${
          marks ? `<span class="dmark">${escapeHtml(marks)}</span>` : ''
        }</span>${cells}</div>` +
        (item.description ? `<div class="ding">${escapeHtml(item.description)}</div>` : '')
      );
    })
    .join('');
  return head + rows;
}

function renderSection(section: MenuSectionDocument, showPrices: boolean): string {
  const open = `<div class="psec type-${section.sectionType.toLowerCase()}" data-section-id="${escapeHtml(section.id ?? '')}">${sectionHead(section)}`;
  const sub = section.subheading ? `<div class="callout">${escapeHtml(section.subheading)}</div>` : '';
  const lead = section.lead ? `<div class="lead">${escapeHtml(section.lead)}</div>` : '';
  switch (section.sectionType) {
    case 'TEXT':
      return `${open}${lead}${escapeParagraphs(section.body ?? '')}</div>`;
    case 'LIST':
    case 'HEADER_PRICED':
      return `${open}${sub}${lead}<div class="list">${visibleItems(section).map(renderNameRow).join('')}</div></div>`;
    case 'TABLE':
      return `${open}${sub}${lead}${renderTable(section, showPrices)}</div>`;
    case 'SET_MENUS':
    case 'COURSE':
    case 'STANDARD':
    default:
      return `${open}${sub}${lead}${visibleItems(section)
        .map((item) => renderRow(item, section, showPrices))
        .join('')}</div>`;
  }
}

function renderFoot(doc: MenuDocument, options: { withDietaries: boolean; withConditions: boolean }): string {
  const legend = menuTagLegend(doc);
  const marks = marksLegend(doc);
  const conditions = options.withConditions
    ? (doc.conditions ?? '')
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => `<div class="conditions">${escapeHtml(line)}</div>`)
        .join('')
    : '';
  const parts = [
    options.withDietaries && doc.dietaryNote ? `<div class="dietaries">${escapeHtml(doc.dietaryNote)}</div>` : '',
    conditions,
    legend || marks ? `<div class="legend">${escapeHtml([legend, marks].filter(Boolean).join(' · '))}</div>` : '',
    doc.surchargeLine ? `<div class="surcharge">${escapeHtml(doc.surchargeLine)}</div>` : ''
  ].filter(Boolean);
  return parts.length ? `<div class="foot">${parts.join('')}</div>` : '';
}

/** "COCKTAILS 2 · WINE 9 · TEQUILA 11" — the first titled section of each inner page, whatever its type (an essay page is listed by its title). */
function contentsLine(pages: MenuSectionDocument[][]): string {
  const entries: string[] = [];
  pages.forEach((sections, index) => {
    if (index === 0) return;
    const first = sections.find((section) => section.title.trim());
    if (!first) return;
    const title = first.title.trim().toUpperCase();
    if (entries.some((entry) => entry.startsWith(`${title}<`))) return;
    entries.push(`${escapeHtml(title)}<span class="num">${index + 1}</span>`);
  });
  return entries.join(' · ');
}

function renderCover(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions, rules: FamilyRules, pages: MenuSectionDocument[][]): string {
  const logoAsset = rules.coverLogo ?? template.logo.asset;
  const price = formatMenuPrice(doc.heroPriceCents, doc.heroPriceUnit);
  const nav = pages.length > 1 ? contentsLine(pages) : '';
  return (
    `<div class="cover">` +
    `<img class="biglogo" src="${escapeHtml(options.assets.logoSrc(logoAsset))}" alt="${escapeHtml(template.logo.alt)}">` +
    `<div class="t-line">${escapeHtml(template.tagline)}</div>` +
    `<div class="t-title">${escapeHtml(menuPrintedHeading(doc, template))}</div>` +
    (doc.subheading ? `<div class="t-sub">${escapeHtml(doc.subheading)}</div>` : '') +
    (doc.whenLine ? `<div class="t-when">${escapeHtml(doc.whenLine)}</div>` : '') +
    (price ? `<div class="t-price">${escapeHtml(price)}</div>` : '') +
    (nav ? `<div class="t-nav">${nav}</div>` : '') +
    `<div class="t-arch"></div>` +
    (pages.length > 1 ? renderFoot(doc, { withDietaries: false, withConditions: false }) : '') +
    `</div>`
  );
}

function renderRunhead(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions, pageNumber: number, rules: FamilyRules): string {
  // Without a cover the first page carries the full title block instead of a running head.
  if (!rules.cover && pageNumber === 1) {
    const price = formatMenuPrice(doc.heroPriceCents, doc.heroPriceUnit);
    return (
      `<div class="runhead mast">` +
      `<img class="logo" src="${escapeHtml(options.assets.logoSrc(template.logo.asset))}" alt="${escapeHtml(template.logo.alt)}">` +
      `<div class="eyebrow">${escapeHtml(template.tagline)}</div>` +
      `<div class="rule"></div>` +
      `<div class="page-title">${escapeHtml(menuPrintedHeading(doc, template))}</div>` +
      (doc.subheading ? `<div class="callout">${escapeHtml(doc.subheading)}</div>` : '') +
      (doc.whenLine ? `<div class="lead">${escapeHtml(doc.whenLine)}</div>` : '') +
      (price ? `<div class="dprice t-price">${escapeHtml(price)}</div>` : '') +
      `</div>`
    );
  }
  return (
    `<div class="runhead">` +
    `<img class="logo" src="${escapeHtml(options.assets.logoSrc(template.logo.asset))}" alt="${escapeHtml(template.logo.alt)}">` +
    `<div class="eyebrow">${escapeHtml(template.tagline)}</div>` +
    `</div>`
  );
}

/** Every declared page as its own fixed-size sheet, in order. */
export function renderPagedSheets(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions): string {
  const rules = rulesFor(template);
  const pages = sectionsByPage(doc);
  const showPrices = doc.showPrices ?? true;
  const sheets = pages
    .map((sections, index) => {
      const pageNumber = index + 1;
      const isCover = rules.cover && pageNumber === 1;
      const last = pageNumber === pages.length;
      const onecol = isCover || sections.length <= 1 ? ' onecol' : '';
      const body = sections.map((section) => renderSection(section, showPrices)).join('');
      return (
        `<section class="sheet page-${pageNumber}${isCover ? ' is-cover' : ''}${onecol}" data-page="${pageNumber}">` +
        (isCover ? renderCover(doc, template, options, rules, pages) : renderRunhead(doc, template, options, pageNumber, rules)) +
        (body ? `<div class="page-body">${body}</div>` : '') +
        (last && !isCover ? renderFoot(doc, { withDietaries: true, withConditions: true }) : '') +
        (last && isCover && pages.length === 1 ? renderFoot(doc, { withDietaries: true, withConditions: true }) : '') +
        (rules.folio && !isCover ? `<div class="folio">${pageNumber}</div>` : '') +
        `</section>`
      );
    })
    .join('');
  return `${openPrintPage(template, options)}${sheets}</main>`;
}
