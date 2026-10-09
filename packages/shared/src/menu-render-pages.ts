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
.menu-print-page.family-drinks-a5l .cover .t-arch{ width:54mm; height:18mm; margin-bottom:8mm; }
.menu-print-page.family-drinks-a5l .cover .t-nav{ margin-top:8mm; max-width:150mm; }
.menu-print-page.family-drinks-a5l .cover .biglogo{ margin-top:12mm; }
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
.menu-print-page .wreg{ font-family:var(--serif); font-style:italic; font-size:12px; color:var(--ink-72); margin-left:1.5mm; white-space:nowrap; }
.menu-print-page .wp{ font-family:var(--sans); font-weight:500; font-size:11px; font-variant-numeric:tabular-nums; text-align:right; }
.menu-print-page .wp.empty{ color:var(--ink-18); }
.menu-print-page .wine + .ding{ margin:-1mm 0 2.8mm; }

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

/* =========================================================
   The A5 table card family (happy hour, bottomless, specials, private
   events). Same ink, faces, hairline heads and footer as the A4 sheet; the
   masthead mark sits at 12 mm (Avalon lockup) / 9.5 mm (St Alma wordmark) so
   the two venues' cards read as one family; one column; names-only lists and
   private-event courses are centred, priced rows keep the name … price grammar.
   Legibility floors at A5: names 12–12.5 px, italics 13 px, labels ≥ 8.5 px,
   conditions 9 px at ≥ 58 % ink.
   ========================================================= */
.menu-print-page.family-card-a5 .card-mast{ text-align:center; margin-bottom:5mm; }
.menu-print-page.family-card-a5 .card-mast .logo{ height:11mm; width:auto; display:inline-block; }
.menu-print-page.family-card-a5.venue-stalma .card-mast .logo{ height:8.5mm; }
.menu-print-page.family-card-a5 .card-mast .eyebrow{
  font-family:var(--sans); font-weight:500; font-size:8.5px; letter-spacing:.32em; line-height:1.3;
  text-transform:uppercase; color:var(--ink-46); margin-top:3mm;
}
.menu-print-page.family-card-a5 .card-mast .rule{ width:14mm; height:1px; background:var(--ink-24); margin:2.8mm auto 2.6mm; }
.menu-print-page.family-card-a5 .card-title{ font-family:var(--serif); font-style:italic; font-size:28px; line-height:1.05; color:var(--ink); text-wrap:balance; }
.menu-print-page.family-card-a5 .card-sub{ font-family:var(--serif); font-style:italic; font-size:13.5px; line-height:1.3; color:var(--ink-72); margin:1.6mm auto 0; max-width:104mm; text-wrap:balance; }
.menu-print-page.family-card-a5 .card-when{
  font-family:var(--sans); font-weight:700; font-size:8.5px; letter-spacing:.3em; line-height:1.4; text-transform:uppercase;
  color:var(--ink-52); margin-top:2.8mm;
}
.menu-print-page.family-card-a5 .card-price{ font-family:var(--sans); font-weight:500; font-size:21px; line-height:1; font-variant-numeric:tabular-nums; margin-top:2.4mm; }
.menu-print-page.family-card-a5 .card-price .unit{ font-size:9px; font-weight:700; letter-spacing:.2em; text-transform:uppercase; color:var(--ink-46); margin-left:1.5mm; vertical-align:baseline; }
.menu-print-page.family-card-a5 .runhead{ margin-bottom:5mm; }
.menu-print-page.family-card-a5 .psec{ margin-bottom:3.7mm; }
.menu-print-page.family-card-a5 .sec-head{ gap:4mm; margin-bottom:2.8mm; }
.menu-print-page.family-card-a5 .sec-head::before,
.menu-print-page.family-card-a5 .sec-head::after{ background:var(--ink-24); }
.menu-print-page.family-card-a5 .sec-title{ font-size:9.5px; }
.menu-print-page.family-card-a5 .sec-title .qual{ letter-spacing:.2em; }
.menu-print-page.family-card-a5 .lead{ text-align:center; margin:-.8mm 0 2.4mm; font-size:8.5px; line-height:1.4; }
.menu-print-page.family-card-a5 .callout{ text-align:center; font-size:13px; margin:-1.2mm 0 2.8mm; }
.menu-print-page.family-card-a5 .drink{ margin-bottom:2.2mm; }
.menu-print-page.family-card-a5 .ding{ font-size:13px; }
.menu-print-page.family-card-a5 .tags{ font-size:8.5px; }
.menu-print-page.family-card-a5 .dprice{ font-size:12.5px; }
/* names-only groups (inclusions, courses to choose from) are centred stacks … */
.menu-print-page.family-card-a5 .type-list .list{ text-align:center; }
.menu-print-page.family-card-a5 .list .pour{ display:block; padding:.45mm 0; line-height:1.3; }
.menu-print-page.family-card-a5 .list .pname{ font-size:12.5px; font-weight:500; line-height:1.3; }
/* … and a names-only group with no dietaries (happy hour "Margaritas / 12", the
   drinks a bottomless sitting includes) runs on in one centred line */
.menu-print-page.family-card-a5 .run-in{
  font-family:var(--sans); font-weight:500; font-size:12.5px; line-height:1.55; text-align:center; text-wrap:balance;
}
.menu-print-page.family-card-a5 .run-in .pour{ display:inline; padding:0; white-space:nowrap; }
.menu-print-page.family-card-a5 .run-in .pname{ font-size:12.5px; }
.menu-print-page.family-card-a5 .run-in .sep{ color:var(--ink-40); margin-left:.6em; }
.menu-print-page.family-card-a5 .type-course .drink{ text-align:center; margin-bottom:2.8mm; }
.menu-print-page.family-card-a5 .type-course .drink-top{ display:block; }
.menu-print-page.family-card-a5 .type-course .dname{ display:block; }
.menu-print-page.family-card-a5 .type-course .dprice{ display:inline-block; margin-left:2mm; }
.menu-print-page.family-card-a5 .type-text .para{ text-align:center; font-size:13px; }
.menu-print-page.family-card-a5 .foot{ padding-top:2.6mm; }
.menu-print-page.family-card-a5 .foot .conditions{ font-size:9px; line-height:1.4; }
.menu-print-page.family-card-a5 .foot .legend{ font-size:8px; }
.menu-print-page.family-card-a5 .foot .surcharge{ font-size:8.5px; }

/* =========================================================
   The drinks books, at the density of the hand-set sheets they replace
   (binder.css / avalon.css): a 23-page binder and a 15-page book carry
   250-odd priced rows, so rows sit closer, names drop the letterspaced
   caps when a row is a pour (name · ABV · village … price), and the
   binder's two columns flow a long section across both rather than
   jumping it whole to the next column.
   ========================================================= */
.menu-print-page.family-drinks-a5l .runhead,
.menu-print-page.family-drinks-a5p .runhead{ margin-bottom:4.5mm; }
.menu-print-page.family-drinks-a5l .psec,
.menu-print-page.family-drinks-a5p .psec{ margin-bottom:5mm; }
.menu-print-page.family-drinks-a5l .sec-head,
.menu-print-page.family-drinks-a5p .sec-head{ margin-bottom:2.8mm; }
.menu-print-page.family-drinks-a5l .sec-title,
.menu-print-page.family-drinks-a5p .sec-title{ font-size:10px; }
.menu-print-page.family-drinks-a5l .callout,
.menu-print-page.family-drinks-a5p .callout{ font-size:12px; margin:-1mm 0 2.8mm; }
.menu-print-page.family-drinks-a5l .lead,
.menu-print-page.family-drinks-a5p .lead{ margin:-1mm 0 2.2mm; }
.menu-print-page.family-drinks-a5l .drink,
.menu-print-page.family-drinks-a5p .drink{ margin-bottom:2.3mm; }
.menu-print-page.family-drinks-a5l .dname,
.menu-print-page.family-drinks-a5p .dname{ font-size:10.5px; letter-spacing:.1em; }
.menu-print-page.family-drinks-a5l .ding,
.menu-print-page.family-drinks-a5p .ding{ font-size:12px; line-height:1.2; margin-top:.3mm; }
.menu-print-page.family-drinks-a5l .dnote,
.menu-print-page.family-drinks-a5p .dnote{ font-size:8.5px; margin-top:.4mm; }
.menu-print-page.family-drinks-a5l .dprice,
.menu-print-page.family-drinks-a5p .dprice{ font-size:11px; }
.menu-print-page.family-drinks-a5l .pour,
.menu-print-page.family-drinks-a5p .pour{ padding:.8mm 0; }
.menu-print-page.family-drinks-a5l .pname,
.menu-print-page.family-drinks-a5p .pname{ font-size:11.5px; }
.menu-print-page.family-drinks-a5l .wine,
.menu-print-page.family-drinks-a5p .wine{ margin-bottom:1.5mm; }
.menu-print-page.family-drinks-a5l .wine-head,
.menu-print-page.family-drinks-a5p .wine-head{ padding-bottom:1.4mm; margin-bottom:1.6mm; }
.menu-print-page.family-drinks-a5l .wine-head span,
.menu-print-page.family-drinks-a5p .wine-head span{ font-size:7.5px; }
.menu-print-page.family-drinks-a5l .wname,
.menu-print-page.family-drinks-a5p .wname{ font-size:10.5px; line-height:1.2; }
.menu-print-page.family-drinks-a5l .wreg,
.menu-print-page.family-drinks-a5p .wreg{ font-size:11px; }
.menu-print-page.family-drinks-a5l .wp,
.menu-print-page.family-drinks-a5p .wp{ font-size:10.5px; }
.menu-print-page.family-drinks-a5l .wine + .ding,
.menu-print-page.family-drinks-a5p .wine + .ding{ margin:-.6mm 0 2mm; font-size:11.5px; }
.menu-print-page.family-drinks-a5l .para,
.menu-print-page.family-drinks-a5p .para{ font-size:12.5px; line-height:1.3; }
.menu-print-page.family-drinks-a5l .pkg,
.menu-print-page.family-drinks-a5p .pkg{ margin-bottom:3mm; }
/* a pour: name · ABV · village … price, one line, as the back-bar pages set it */
.menu-print-page .drink.pour-row{ margin-bottom:1.1mm; }
.menu-print-page .drink.pour-row .dname{ font-weight:500; font-size:11px; letter-spacing:0; text-transform:none; line-height:1.25; }
.menu-print-page .drink.pour-row .dmeta{ font-size:8.5px; }
.menu-print-page .drink.pour-row .dvil{ font-family:var(--serif); font-style:italic; font-size:10.5px; color:var(--ink-58); margin-left:1.5mm; text-transform:none; letter-spacing:0; }
.menu-print-page .drink.pour-row .dprice{ font-size:10.5px; }
/* a group of pours (one producer, one style) carries a small left-set title, not the hairline head */
.menu-print-page .psec.pour-group{ margin-bottom:3mm; }
.menu-print-page .psec.pour-group .sec-head{ justify-content:flex-start; margin-bottom:1.3mm; }
.menu-print-page .psec.pour-group .sec-head::before,
.menu-print-page .psec.pour-group .sec-head::after{ display:none; }
.menu-print-page .psec.pour-group .sec-title{ font-size:8.5px; letter-spacing:.2em; color:var(--ink-58); white-space:normal; }
.menu-print-page .psec.pour-group .callout{ font-size:11px; line-height:1.3; margin:-.4mm 0 1.4mm; }
.menu-print-page .psec.pour-group .lead{ margin:-.4mm 0 1.2mm; }
/* a page that is nothing but pours (the book's tequila and mezcal pages) flows in two columns */
.menu-print-page.family-drinks-a5p .page-body.cols{ column-count:2; column-gap:8mm; column-fill:auto; }
.menu-print-page.family-drinks-a5p .page-body.cols .type-text{ column-span:all; }
.menu-print-page.family-drinks-a5p .page-body.cols .psec{ break-inside:auto; }
.menu-print-page.family-drinks-a5p .page-body.cols .sec-head{ break-after:avoid; break-inside:avoid; }
.menu-print-page.family-drinks-a5p .page-body.cols .lead,
.menu-print-page.family-drinks-a5p .page-body.cols .callout{ break-after:avoid; break-inside:avoid; }
.menu-print-page.family-drinks-a5p .page-body.cols .drink{ break-inside:avoid; }
.menu-print-page.family-drinks-a5p .psec{ margin-bottom:4.2mm; }
.menu-print-page.family-drinks-a5p .para{ font-size:12px; }
/* the binder's two columns: a long section flows across both, rows and heads stay whole */
.menu-print-page.family-drinks-a5l .psec{ break-inside:auto; }
.menu-print-page.family-drinks-a5l .sec-head{ break-after:avoid; break-inside:avoid; }
.menu-print-page.family-drinks-a5l .lead,
.menu-print-page.family-drinks-a5l .callout{ break-after:avoid; break-inside:avoid; }
.menu-print-page.family-drinks-a5l .drink,
.menu-print-page.family-drinks-a5l .wine,
.menu-print-page.family-drinks-a5l .pour,
.menu-print-page.family-drinks-a5l .wine-head{ break-inside:avoid; }

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
    case 'card-a5':
    default:
      // A table card has no cover and no page numbers: the front carries the
      // masthead, the back (when there is one) a running head.
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

const STRENGTH = /^\d+(?:\.\d+)?\s*%$/;

/**
 * In the drinks books a row whose qualifier is a strength (40%) and that
 * carries at most a short description (a village) is a pour — one line, as
 * the back-bar pages set it — not a cocktail with its ingredients beneath.
 * A cocktail tagged "Signature" or "on tap" keeps the cocktail layout.
 */
function isPourRow(item: MenuItemDocument, section: MenuSectionDocument, family: MenuTemplate['family']): boolean {
  if (family !== 'drinks-a5l' && family !== 'drinks-a5p') return false;
  if (section.sectionType !== 'STANDARD') return false;
  if (!item.meta || !STRENGTH.test(item.meta.trim()) || item.note) return false;
  return !item.description || item.description.length <= 48;
}

function renderRow(item: MenuItemDocument, section: MenuSectionDocument, showPrices: boolean, family: MenuTemplate['family']): string {
  const price = showPrices ? formatMenuPrice(item.priceCents, item.priceUnit) : '';
  if (isPourRow(item, section, family)) {
    const village = item.description ? `<span class="dvil">${escapeHtml(item.description)}</span>` : '';
    return (
      `<div class="drink pour-row" data-dish-key="${escapeHtml(item.dishKey ?? '')}"><div class="drink-top">${nameLine(item).replace(/<\/span>$/, `${village}</span>`)}${
        price ? `<span class="dprice">${escapeHtml(price)}</span>` : ''
      }</div></div>`
    );
  }
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

/** One name of a run-on line; the separator rides with the name before it so a wrapped line ends on "·" rather than opening with one. */
function renderRunInName(item: MenuItemDocument, separated: boolean): string {
  return `<span class="pour" data-dish-key="${escapeHtml(item.dishKey ?? '')}">${nameLine(item).replace('class="dname"', 'class="pname"')}${
    separated ? '<span class="sep">·</span>' : ''
  }</span>`;
}

function renderNameRow(item: MenuItemDocument): string {
  return `<div class="pour" data-dish-key="${escapeHtml(item.dishKey ?? '')}">${nameLine(item).replace('class="dname"', 'class="pname"')}</div>`;
}

function renderTable(section: MenuSectionDocument, showPrices: boolean): string {
  const columns = section.priceColumns;
  const grid = `grid-template-columns:minmax(0,1fr) repeat(${columns.length},13mm)`;
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

function renderSection(section: MenuSectionDocument, showPrices: boolean, family: MenuTemplate['family']): string {
  const items = visibleItems(section);
  const pourGroup = items.length > 0 && items.every((item) => isPourRow(item, section, family));
  const open = `<div class="psec type-${section.sectionType.toLowerCase()}${pourGroup ? ' pour-group' : ''}" data-section-id="${escapeHtml(section.id ?? '')}">${sectionHead(section)}`;
  const sub = section.subheading ? `<div class="callout">${escapeHtml(section.subheading)}</div>` : '';
  const lead = section.lead ? `<div class="lead">${escapeHtml(section.lead)}</div>` : '';
  switch (section.sectionType) {
    case 'TEXT':
      return `${open}${lead}${escapeParagraphs(section.body ?? '')}</div>`;
    case 'HEADER_PRICED':
    case 'LIST': {
      // On a table card a names-only group with nothing else to say per name
      // (no dietaries, pours or marks) runs on in one centred line —
      // "Classic · Jalapeño · Tommy's" — so a happy hour fits the front of
      // one card; names that carry dietaries stack so the codes stay legible.
      // The books always stack.
      const items = visibleItems(section);
      const runsOn = family === 'card-a5' && items.length > 0 && items.every((item) => item.tags.length === 0 && !item.meta && !item.description && !marksFor(item));
      if (runsOn) return `${open}${sub}${lead}<div class="run-in">${items.map((item, index) => renderRunInName(item, index < items.length - 1)).join(' ')}</div></div>`;
      return `${open}${sub}${lead}<div class="list">${items.map(renderNameRow).join('')}</div></div>`;
    }
    case 'TABLE':
      return `${open}${sub}${lead}${renderTable(section, showPrices)}</div>`;
    case 'SET_MENUS':
    case 'COURSE':
    case 'STANDARD':
    default:
      return `${open}${sub}${lead}${visibleItems(section)
        .map((item) => renderRow(item, section, showPrices, family))
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
/**
 * The cover's contents line: the first titled section of each page, each
 * title once, capped so a long book's cover stays a cover (the binder's 23
 * pages would otherwise print three lines of contents into the ornament).
 */
function contentsLine(pages: MenuSectionDocument[][], max: number): string {
  const entries: string[] = [];
  pages.forEach((sections, index) => {
    if (index === 0 || entries.length >= max) return;
    const first = sections.find((section) => section.title.trim());
    if (!first) return;
    const title = first.title.trim().toUpperCase();
    if (entries.some((entry) => entry.startsWith(`${escapeHtml(title)}<`))) return;
    entries.push(`${escapeHtml(title)}<span class="num">${index + 1}</span>`);
  });
  return entries.join(' · ');
}

function renderCover(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions, rules: FamilyRules, pages: MenuSectionDocument[][]): string {
  const logoAsset = rules.coverLogo ?? template.logo.asset;
  const price = formatMenuPrice(doc.heroPriceCents, doc.heroPriceUnit);
  const nav = pages.length > 1 ? contentsLine(pages, template.family === 'drinks-a5l' ? 9 : 12) : '';
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

/**
 * The card's masthead: the venue mark, its eyebrow and the short rule exactly
 * as the A4 sheet carries them (so a card on the table reads as the same
 * family as the menu), then the title block — the heading in Cormorant
 * italic, an italic subheading, the when-line in letterspaced caps and the
 * hero price with its unit set small.
 */
function renderCardMast(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions): string {
  const amount = doc.heroPriceCents === null ? '' : formatMenuPrice(doc.heroPriceCents);
  const unit = (doc.heroPriceUnit ?? '').trim();
  return (
    `<div class="card-mast">` +
    `<img class="logo" src="${escapeHtml(options.assets.logoSrc(template.logo.asset))}" alt="${escapeHtml(template.logo.alt)}">` +
    `<div class="eyebrow">${escapeHtml(template.tagline)}</div>` +
    `<div class="rule"></div>` +
    `<div class="card-title">${escapeHtml(menuPrintedHeading(doc, template))}</div>` +
    (doc.subheading ? `<div class="card-sub">${escapeHtml(doc.subheading)}</div>` : '') +
    (doc.whenLine ? `<div class="card-when">${escapeHtml(doc.whenLine)}</div>` : '') +
    (amount ? `<div class="card-price">${escapeHtml(amount)}${unit ? `<span class="unit">${escapeHtml(unit)}</span>` : ''}</div>` : '') +
    `</div>`
  );
}

function renderRunhead(doc: MenuDocument, template: MenuTemplate, options: MenuRenderOptions, pageNumber: number, rules: FamilyRules): string {
  // Without a cover the first page carries the full title block instead of a running head.
  if (!rules.cover && pageNumber === 1) return renderCardMast(doc, template, options);
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
      const pourPage =
        template.family === 'drinks-a5p' &&
        sections.some((section) => section.sectionType !== 'TEXT') &&
        sections.every((section) => section.sectionType === 'TEXT' || (visibleItems(section).length > 0 && visibleItems(section).every((item) => isPourRow(item, section, template.family))));
      const body = sections.map((section) => renderSection(section, showPrices, template.family)).join('');
      return (
        `<section class="sheet page-${pageNumber}${isCover ? ' is-cover' : ''}${onecol}" data-page="${pageNumber}">` +
        (isCover ? renderCover(doc, template, options, rules, pages) : renderRunhead(doc, template, options, pageNumber, rules)) +
        (body ? `<div class="page-body${pourPage ? ' cols' : ''}">${body}</div>` : '') +
        (last && !isCover ? renderFoot(doc, { withDietaries: true, withConditions: true }) : '') +
        (last && isCover && pages.length === 1 ? renderFoot(doc, { withDietaries: true, withConditions: true }) : '') +
        (rules.folio && !isCover ? `<div class="folio">${pageNumber}</div>` : '') +
        `</section>`
      );
    })
    .join('');
  return `${openPrintPage(template, options)}${sheets}</main>`;
}
