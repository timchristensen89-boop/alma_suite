# Alma printed-menu design system — extraction for the A5 family

Read-only inventory of what exists in `/home/user/alma_suite` (PR #313 head, identical in the `menus-v2` worktree for `menu-render.ts` and `apps/api/assets/menus`) and `/home/user/alma-web-platform`. Every value below is quoted from source with `file:line`. Where something does not exist I say so.

## 0. What exists, where (inventory)

### 0.1 Print sheets in the website repo (`alma-web-platform/apps/web/app/print/`)

| Route | Files | Page size (`@page`) | Pages | Engine / status |
| --- | --- | --- | --- | --- |
| `/print/st-alma-food`, `/print/alma-avalon-food` | `_food/FoodSheet.tsx` (114 lines), `_food/food.css` (110), `_food/menus.ts` (177), `st-alma-food/page.tsx`, `alma-avalon-food/page.tsx` | `210mm 297mm` A4 portrait (`FoodSheet.tsx:63`) | 1 | Ported verbatim into `alma_suite/packages/shared/src/menu-render.ts` (`menu-render.ts:4-8`, `docs/menu-editor.md:25-34`). Content: St Alma = 13 Jul 2026 print state, Avalon = 22 Aug 2026 (`menus.ts:4-6`). |
| `/print/alma-avalon-drinks` | `avalon.css` (566 lines after stripping base64 fonts; 190 KB on disk), `sheets.tsx` (490), `page.tsx` (127) | `148mm 210mm` **A5 portrait** (`page.tsx:71`) | 15 (`sheets.tsx:3`; the screen header text says 17, `page.tsx:84` — stale) | July 2026 edition. Bound on the long edge, 22 mm gutter alternating, drill guides (`page.tsx:9-12`, `avalon.css:426-462`). |
| `/print/st-alma-drinks` | `binder.css` (711 lines stripped; 200 KB), `sheets.tsx` (649), `page.tsx` (111) | `210mm 148mm` **A5 landscape** (`page.tsx:67`) | 23 (`sheets.tsx:3`) | Oct 2026 edition binder cards, 31 mm binding margin alternating (`page.tsx:5-8`, `binder.css:447-453`). |
| `/print/freshy-avalon-panels` | `panels.css` (230), `panels.tsx`, `page.tsx` (293), `caption.md` | `1080px 1350px` (Instagram 4:5) (`page.tsx:130`) | 6 | Social artboards, not a menu. Only place the brand *accent* palette (terracotta/cream/blush) is used in a print route (`panels.css:11-14, 29-37`). |

There is **no A5 food/promo sheet of any kind** in either repo: no happy-hour, bottomless, specials or private-event template exists as code. The only A5 code is the two drinks routes above. `grep -ri "a5\|148mm"` in `alma_suite` hits only `menu-render.ts:45` (a comment: "Page size, so a future A5 card is a template change, not a code change") and `docs/menu-editor.md:233`.

The CSS of both drinks routes was ported from the Claude Design projects "Alma Suite Design System" (`menu-system.css` + `menu-drinks.css`; `avalon.css:3-9`) and "Menu formatting with binder holes" (`menu-binder.css`; `binder.css:3-7`). **The original `menu-system.css` / `menu-drinks.css` / `menu-binder.css` files are not in either repo** — only these ported, route-scoped copies. The system's own header reads "ST ALMA — PRINT MENU SYSTEM. Single forest-green ink on warm cream stock. Exact-size A4 / A5 artboards for InDesign rebuild + PDF" (`avalon.css:61-65`, `binder.css:33-37`), i.e. it was designed with A5 in mind from the start and already carries an `.sheet.a5` token (below).

### 0.2 The Alma Menus renderer (`alma_suite`)

- `packages/shared/src/menu-render.ts` (410 lines): two templates only, `freshwater_alacarte` and `avalon_alacarte` (`:28`, `:49-70`), both `page: { widthMm: 210, heightMm: 297 }` (`:58`, `:68`). `MENU_PRINT_CSS` (`:98-213`) = food.css verbatim plus Tailwind-preflight basics (`:99-102`) and one extra rule `.food-print-page.chef-in-column .foot{margin-top:auto}` (`:199`) replacing food.css's `.venue-avalon .foot` (`food.css:97`). `@page` is emitted per template (`:349`). Renderer is pure string-building (`:307-352`).
- `apps/api/src/lib/menu-assets.ts`: inlines every font and logo as a `data:` URI (`:48-53`, `:58-84`), refuses to render if a file is missing (`:14-18`, `:49-51`). Asset dir candidates `:26-34`; `MENU_ASSETS_DIR` override.
- `apps/api/src/lib/menu-pdf.ts`: puppeteer-core → Chrome; viewport hard-coded to A4 at 96 dpi `794×1123` (`:122-123`); `setContent`, waits `document.fonts.ready`, `emulateMediaType('print')` (`:124-126`); `page.pdf({ width:'…mm', height:'…mm', printBackground:true, preferCSSPageSize:true, margin:0 })` (`:143-150`); page count via pdf-lib (`:152-153`).
- Publish gate: `measureMenuFill` → `overflowIssue` → error; `pageCount !== 1` → error "must fit on one A4 page" (`apps/api/src/services/menu.service.ts:779-781, 818-825`). The probe `MENU_FILL_PROBE_SCRIPT` queries `.food-print-page .sheet` (`packages/shared/src/menus.ts:423-436`).
- Editor preview `apps/menus-web/src/components/MenuPreview.tsx`: same `renderMenuHtml`, same font files served from `/fonts` and `/images` (`:24-39`), iframe sized from `template.page.widthMm/heightMm` × 96/25.4 and CSS-scaled to the host width (`:41, :58-59, :74, :144-151`); strips the grey backdrop by targeting `.food-print-page` (`:64-67`); runs the same fill probe inside the frame (`:101`).
- Docs: `docs/menu-editor.md:23-34` ("Where the templates came from": printed by headless Chrome 141 from the website route; compare script shows only anti-aliasing differences, website PDFs embed Type 3 glyphs, Chrome `page.pdf()` embeds TrueType), `:217-237` ("Adding a template": a genuinely different layout — "a drinks binder, an A5 specials card" — gets its own CSS block + page size + a renderer branch; keep the renderer pure).

### 0.3 Fonts (`alma_suite/apps/api/assets/menus/fonts`, duplicated in `apps/menus-web/public/fonts` and `alma-web-platform/apps/web/public/fonts`)

| File | Bytes | Name table / OS/2 weight | Declared as (`menu-render.ts:378-381, 370-373, 376`) |
| --- | --- | --- | --- |
| `AvenirLTStd-Book.otf` | 27,444 | "Avenir LT Std 45 Book", usWeightClass 350 | `avenir-lt-pro` **400** |
| `AvenirLTStd-Roman.otf` | 27,176 | "Avenir LT Std 55 Roman", 400 | `avenir-lt-pro` **500** |
| `AvenirLTStd-Heavy.otf` | 27,640 | name table oddly reads "Avenir LT Std 55 Roman / Bold", 700 | `avenir-lt-pro` **700** |
| `AvenirLTStd-Black.otf` | 27,912 | name table reads "Avenir LT Std 65 Medium / Bold", 750 | `avenir-lt-pro` **900** |
| `CormorantGaramond-Italic-latin.woff2` | 23,660 | — | `cormorant-garamond` **400 italic**, latin unicode-range |
| `CormorantGaramond-Italic-latin-ext.woff2` | 20,284 | — | `cormorant-garamond` 400 italic, latin-ext range |
| `Manrope.woff2` | 24,576 | variable | `Manrope` 400–800; only the masthead line-box strut depends on it (`menu-render.ts:359`) |

So the API owns **four Avenir faces (Book, Roman, Heavy, Black) and one Cormorant face (Italic 400)**. There is no Avenir Light/Medium/Oblique, and no Cormorant Roman, Medium Italic or Bold. The website's print routes get Cormorant from `next/font/google` with weights 400/500/600/700 normal+italic (`app/layout.tsx:19-25`) and their published PDFs embed `CormorantGaramond-LightItalic` (Avalon/St Alma drinks, food) and `-MediumItalic`, `-Italic`, `-Bold` (functions PDF) per `pdffonts`. The Avenir inlining script is `alma-web-platform/scripts/inline-print-fonts.py` (weights map `:22`). Note `font-weight:600` is used heavily in the St Alma binder (`binder.css:504-508, 529`) — there is no 600 face, so Chrome resolves it to Heavy 700.

### 0.4 Logos

| Asset | Pixels | Ratio | Where |
| --- | --- | --- | --- |
| `avalon-logo.png` (API) ≡ `alma-avalon-logo.png` ≡ `social/freshy-avalon/logo-alma-avalon.png` (md5 `986617a2…`) | 1583×880, 157,893 B | 1.80 | `menu-render.ts:407-410`; web `_food/menus.ts:119`, `alma-avalon-drinks/sheets.tsx:21, 480` |
| `stalma-logo.png` (API) ≡ web `wm-stalma-green.png` (md5 `00562dec…`) | 1290×394, 15,437 B | 3.27 | `menu-render.ts:409`; web `_food/menus.ts:56`, `st-alma-drinks/sheets.tsx:32, 45` |
| `logo-alma-wordmark-green.png` (group "alma" wordmark) | 1523×606 | 2.51 | Avalon drinks cover at 96 mm wide (`sheets.tsx:36`, `avalon.css:349`). Not in API assets. |
| `alma-group-logo.png` | 1088×562, 18,612 B | 1.94 | web + `menus-web/public/images` (not registered in `MENU_LOGO_FILES`) |
| `alma-group-logo-cream.png` | 1046×502 | 2.08 | web only |
| `alma-avalon-logo-light.png` (light/white variant) | 1584×880 | 1.80 | web only |
| `st-alma-logo.png` (small, different art) | 350×108, 22,088 B | 3.24 | web UI only — not the print mark |
| `st-alma-logo-cream.png` | 1290×394 | 3.27 | web only |
| manor-red recolours `logo-alma-avalon-manor.png`, `logo-alma-group-manor.png` | 1583×880 / 1088×562 | — | social only (`panels.tsx:52-67`) |
| `fish.png` ≡ `menus-web/public/brand/alma-fish.png` (31,512 B) | 591×592 | 1.0 | website watermark at 6–9 % opacity (`components/FishWatermark.tsx:54`) — never used in print |
| `card-art/alma-word.png`, `alma-glyph.png` | 1046×401, 486×495 | masks | gift-card art only |

Design-system token boxes: Avalon lockup `--wm-w:42mm; --wm-h:23.3mm` (`avalon.css:45-46`), St Alma wordmark `--wm-w:47mm; --wm-h:14.3mm` (`binder.css:64-65`). Both match the PNG ratios.

### 0.5 Reference PDFs (`alma-web-platform/apps/web/public/menus/`)

| File | Size | Pages / trim | Producer | Fonts |
| --- | --- | --- | --- | --- |
| `alma-avalon-bottomless.pdf` | 1.14 MB | 1 / **148×210 mm** | InDesign 20.5 | MarkPro Book/Bold/Light — **off-system** |
| `st-alma-bottomless.pdf` | 454 KB | 1 / **148×210 mm** | InDesign 21.0 | MarkPro + Avenir Book/Light — off-system |
| `alma-functions-menu.pdf` | 310 KB | 5 / A4 | Chrome 150 (Mac) — **no source route in either repo** | Avenir Heavy/Roman, Cormorant MediumItalic/Italic/Bold |
| `alma-avalon-drinks.pdf` | 1.06 MB | 15 / 148.2×209.9 | Chrome 141 | Avenir Heavy/Roman/Book, Cormorant LightItalic |
| `st-alma-drinks.pdf` | 683 KB | 23 / 209.9×148.2 | Chrome 141 | same |
| `alma-avalon-menu.pdf`, `st-alma-menu.pdf` | 441 / 200 KB | 1 / A4 | Chrome 141 | Avenir Roman/Heavy, Cormorant LightItalic |

Content of the two InDesign A5 bottomless cards (for purpose, not layout): a centred letterspaced title "Bottomless Lunch 99pp"; an inclusions list of dishes with lower-case dietary codes (`√ gfa df`, `v gf n`); a letterspaced "Select From" sub-head; a centred "+" between courses; "Bottomless Drinks" sub-head with a centred names-only list (Classic / Watermelon / Jalapeño Margarita, Corona, House Wines; St Alma adds Spicy Pineapple Margarita, R.Paulazzo Rosé); St Alma has "Add on - Chicken tinga empanadas, martajada sauce 7pp"; conditions footer ("surcharge of 10% … weekends, 15% … public holiday", "Merchant fees apply…", "2 hour sitting times" / "your whole table must participate"). The functions menu (A4, 5 pp) is group-level: eyebrow "ST ALMA, FRESHWATER · ALMA AVALON", title "Functions & groups / PACKAGE MENU", sections with letterspaced caps heads ("WAYS TO GATHER", "SET MENUS", "ON ARRIVAL", "BY THE OCCASION", "BEVERAGE PACKAGES", "WEDDINGS"), rows of *name — description — right-aligned "$125 pp"*, slash-separated hour matrices ("$54 / $69 / $84"), a two-venue minimum-spend table, address/enquiry footer, surcharge line "10% applies on Saturday and Sunday, 15% on public holidays".

## 1. Token sheet

### 1.1 Shared tokens (both venues — the print system is one system)

**Ink and paper**

| Token | Value | Flattened on white | Source |
| --- | --- | --- | --- |
| `--ink` | `#1d2916` (forest) | — | `menu-render.ts:110`, `food.css:9`, `avalon.css:35`, `binder.css:49`, `scripts/prepress.py:29` |
| `--ink-85` (named 85, defined 86 %) | `color-mix(in srgb, #1d2916 86%, transparent)` | ≈ `#3d4737` | `avalon.css:36`, `binder.css:50` |
| `--ink-72` / `--ink-62` (named 62, defined 72 %) | 72 % | ≈ `#5c6557` | `menu-render.ts:111`; `avalon.css:37`; `binder.css:51` |
| 58 % (surcharge), 52 % (notes), 46 % (`--ink-46`), 40 % (tags) | | ≈ `#7c8378`, `#8a9086`, `#979d94`, `#a5a9a2` | `menu-render.ts:212, 207`; `avalon.css:534`; `:38` |
| `--ink-30` | 30 % | ≈ `#bbbfb9` | runhead rule `avalon.css:154`, `binder.css:102` |
| `--ink-24` | 24 % | ≈ `#c9ccc7` | food hairlines `menu-render.ts:113, 137, 147` |
| `--ink-18` | 18 % | ≈ `#d6d8d5` | drinks hairlines `avalon.css:102, 221, 364` |
| `--ink-11` | 11 % | ≈ `#e6e7e5` | row rules, column rule `avalon.css:208, 271`, `binder.css:359` |
| `--stock` white | `#ffffff` (what goes to print) | | `menu-render.ts:114`, `avalon.css:51-53` ("true paper white … changed on Tim's ask, 27 Aug 2026") |
| `--stock` cream (screen proof) | `#efe7d8` | | `menu-render.ts:119`, `avalon.css:42, 50`, `binder.css:58` |
| Screen backdrop (not printed) | `#cdc6b8` (+ radial `#d8d1c2→#c4bcac`) | | `menu-render.ts:117`, `avalon.css:57-58`; also the editor's `--menus-paper` (`apps/menus-web/src/styles.css:15`) |

No accent colour is used anywhere in the printed menus: single ink, tints only. The website brand palette for comparison (`alma-web-platform/apps/web/app/globals.css:9-24, 49-55`): forest `#253326`, forest-deep `#1f3524`, cocoa `#59684c` (italic accent), bone `#efe8dc`, shell/blush `#f5dcce`, paper `#faf8f3`, stone `#e6decf` (hairlines), venue accents avalon `#3d5c3f`/`#d6e0cd`, stalma `#59684c`/`#e4ebdb`. The brand's second ink, terracotta `#684A4A` ("st.alma is #684A4A on #EFE8DC, exactly as the wordmark is drawn", `panels.css:53-56`), appears in social panels and the editor UI (`styles.css:7, 12`) but never on a printed menu. Print ink `#1d2916` is *darker* than the web forest `#253326`.

**Typefaces** (`--sans: "avenir-lt-pro", "Manrope", …` `menu-render.ts:115`; `--serif: "cormorant-garamond", "Cormorant Garamond", "Hoefler Text", Georgia, serif` `:116`). Avenir = names, heads, prices, labels; Cormorant *italic* = descriptions, notes, titles, editorial. Sizes are in CSS px at 96 dpi (pt = px × 0.75).

| Role | Family / weight / style | Size px (pt) | Line-height | Tracking | Case | Colour | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Masthead eyebrow (food) | Avenir 500 | 8.5 (6.4) | inherit 1.5 | `.32em` | UPPER | 46 % | `menu-render.ts:133-136` |
| Eyebrow / venue line (drinks) | Avenir 700 | 9–9.5 (6.75–7.1) | normal | `.42em` | UPPER | 46 % | `avalon.css:155-159, 339-342, 350-353`; `binder.css:96-101` |
| Masthead title (food) | Cormorant italic 400 | 19 (14.25) | 1.5 | 0 | as typed | 72 % | `menu-render.ts:138` |
| Kicker (drinks system equivalent of the food title) | Cormorant italic 500 | 18 (13.5) | | | | 72 % | `binder.css:105-108` |
| Page title (editorial pages) | Cormorant italic 500 | 34 (25.5) A4 → 27–30 on A5 cards | 1 | 0 | | 100 % | `avalon.css:162-165`, `binder.css:429`, inline 30px `sheets.tsx:119` |
| Cover title / sub | Cormorant italic 500 | 52/36 (A5 portrait), 54/38 (A5L) | .92 | 0 | | 100 % / 72 % | `avalon.css:354-358`, `binder.css:391-395` |
| Section head | Avenir 700 | 9.5 (7.1) food; 11 (8.25) drinks | | `.3em` | UPPER, nowrap | 100 % | `menu-render.ts:148-151`; `avalon.css:104-109` |
| Section qualifier (`/ 9 each`, `cont.`) | Avenir 500 | inherits | | `.2em` food / `.18em` drinks | | 46 % | `menu-render.ts:152`; `avalon.css:110-112` |
| Sub-group label (Low / No, wine mood) | Avenir 600→700, 500 | 8.5–9.5 (6.4–7.1) | | `.08–.14em` (polished down from `.3em`) | UPPER | 52–64 % | `avalon.css:192-197, 539, 566`; `binder.css:628, 658, 709`; `.wine-mood` `avalon.css:249-253` |
| Group title (agave house) | Avenir 700 | 9–9.5 (6.75–7.1) | | `.1–.16em` | UPPER | 46 → 86 % (dense pages) | `avalon.css:268-272, 536-537` |
| Dish name (food) | Avenir 500 | 12.5 (9.4) | 1.3 | 0 | as typed | 100 % | `menu-render.ts:158, 203` (`text-wrap:pretty`) |
| Drink name (cocktail) | Avenir 700 | 11.5 (8.6) | 1.2 | `.115em` | UPPER | 100 % | `avalon.css:173-176` |
| Wine / pour / back-bar name | Avenir 500 | 11.5 / 12 / 10.5–12 (floor raised to 12 in binder) | 1.25–1.3 | 0 | as typed | 100 % | `avalon.css:232, 209, 274`; `binder.css:549-553` |
| Price (food, chef, drink) | Avenir 500, `font-variant-numeric: tabular-nums` | 12.5 (9.4) food; 12 drinks | | 0 | digits only, no `$` | 100 % | `menu-render.ts:159, 209`; `avalon.css:532` |
| Price per person | same, `formatMenuPrice` → `"49 pp"` | 12.5 | | | | | `menus.ts:275-280`; `menu-render.ts:175, 209` |
| Description (food) | Cormorant italic 400 | 13 (9.75) | 1.25 | 0 | sentence | 72 % | `menu-render.ts:164, 204` |
| Ingredients line (drinks `.ding`) | Cormorant italic 500 | 13.5 (10.1) | 1.25 | 0 | | 72 % | `avalon.css:182-185, 533` |
| Serving note (`.dnote`) | Avenir 400 | 9 (6.75) | | `.02em` | | 52 % | `avalon.css:534`, `binder.css:665` |
| Callout / section note | Cormorant italic 500 | 12.5–13 (9.4–9.75) | 1.3–1.35 | 0 | | 72 % | `avalon.css:397, 399, 535` |
| Essay body | Cormorant **roman** 500 | 15.5 (11.6) A4; 13 inline on A5 | 1.5–1.55 | | | 86 % | `avalon.css:290-293`, `sheets.tsx:209-212` |
| Drop cap | Cormorant italic | 46 (34.5) | .8 | | | 100 % | `avalon.css:294-297` |
| Signature / role | Cormorant italic 15 / Avenir 700 9 `.14–.18em` UPPER 46 % | | | | | | `avalon.css:298-301`, `binder.css:660` |
| Dietary tags after a dish | Avenir 500 | 7.5 (5.6) | | `.12em` | UPPER codes `V · VG · GF · GFA · DF · N · A · I` joined `" · "` | 40 % | `menu-render.ts:160-163, 207`; `menus.ts:19-28, 51-53` |
| Allergen mark on a drink (`.dmark`) | Avenir 700 | 8.5 (6.4) | | `.14em` | `N`, `DF` | 46 % | `avalon.css:414-415`, `binder.css:520-521` |
| Pairing marks / staff pick | Avenir 500 `○ △ ◇` `.22em`; `•` | 9 | | | | 46–72 % | `avalon.css:398, 321`; `binder.css:486-487, 532` |
| Footer dietary note | Cormorant italic | 12 (9) | | | | 72 % | `menu-render.ts:180` |
| Footer legend (generated) | Avenir 500 | 7.5 (5.6) food; 8.5–10 drinks | 1.5 | `.05–.08em` | | 46 % | `menu-render.ts:181`; `avalon.css:126-130, 308-311`; `binder.css:509` |
| Surcharge / conditions line | Avenir 500 | 8 (6) food; 8–9.5 drinks | | `.04em` | | 58 % food / 100 % `.foot .note` | `menu-render.ts:182, 212`; `avalon.css:131-134` |
| Footnote (`.footnote`) | Avenir 400 | 9–9.5 | | `.04em` | | 52 % | `avalon.css:199-202, 545` |
| Folio | Avenir 700 | 8 (6) | | `.2em` | | 46 % | `avalon.css:412, 563`; `binder.css:371-375` |
| Column labels (wine) | Avenir 700 | 8 (6) | | `.16em` | UPPER, right-aligned | 46 % | `avalon.css:223-227` |
| ABV | Avenir 500 | 9–10.5 | | | | 46 % | `avalon.css:210, 275, 540` |
| Contents nav on cover | Avenir 700 | 8.5–9.5 | | `.2–.34em` + page numbers `.08em` tabular 46 % | UPPER | 62–72 % | `avalon.css:402-408`, `binder.css:564-578` |

**Rules and ornaments**

| Element | Spec | Source |
| --- | --- | --- |
| Masthead short rule | 14 mm × 1 px, 24 % (food) / 30 % (drinks), centred, margins `4mm auto 3.5mm` | `menu-render.ts:137`; `binder.css:102` |
| Runhead short rule | 11 mm × 1 px, 30 %, `margin:4mm auto 0` | `avalon.css:154` |
| Section head hairlines | flex `::before/::after` 1 px, 24 % (food) / 18 % (drinks), gap 4 mm / 5 mm; `.center` variant hides them | `menu-render.ts:145-147`; `avalon.css:97-103, 115-116` |
| Column rule (multicol) | 1 px 8 % (Avalon dense) / 11 % (binder) | `avalon.css:380-381`; `binder.css:359` |
| Chef-item vertical rule | `border-left:1px solid` 24 % between the three centred set-menu columns | `menu-render.ts:173` |
| Boxed panel | `border:1px solid` 24 %, `padding:5mm 6mm 5.5mm` | `menu-render.ts:191` |
| Wine table head rule | `border-bottom:1px` 18 %, `padding-bottom:2mm` | `avalon.css:219-222` |
| Group title underline | `border-bottom:1px` 11 % | `avalon.css:268-272` |
| Pour row separators | 1 px 11 % — later **removed** in the polish pass ("no row rules") | `avalon.css:208, 560`; `binder.css:641` |
| Arch ornament `.t-arch` | 52×21 mm (A5P) / 54×22 mm (A5L) outline, 1 px 18 %, top-rounded `border-radius:26mm 26mm 0 0`, no bottom border | `avalon.css:363-366`; `binder.css:400-403` — the **only** decorative device in the print system |
| Italic as ornament | every description, note, callout and page title is Cormorant italic; the "signature italic-serif punchline" is a brand rule on the web too (`globals.css:216-222`) | |
| Pairing-guide block | `border-top:1px` 11 %, `padding-top:2.5mm`, title 10px 700 `.3em` UPPER 46 %, line 10px 600 `.05em` | `avalon.css:419-421` |
| Drill guides (binders only) | dashed 1 px rings 6 mm, 18–30 % | `avalon.css:437-462` |

**Spacing and margins**

| | A4 food sheet | A5 portrait (drinks system) | A5 landscape binder |
| --- | --- | --- | --- |
| Sheet padding | `16mm 17mm 12mm` (`menu-render.ts:123`) | `.sheet.a5{ padding:12mm 13mm 11mm }` (`avalon.css:89`, `binder.css:85`); bound: `12mm 13mm 11mm 22mm` / mirrored (`avalon.css:432-433`) | `11mm 14mm 9mm` → bound `10mm 18mm 8mm 31mm` / mirrored (`binder.css:355, 448-449`) |
| Masthead bottom | 8 mm (`:130`) | runhead 6 mm (`avalon.css:337`) | 3.6–5 mm (`binder.css:378, 445, 528`) |
| Logo height | 15 mm (St Alma), 19 mm (Avalon) (`:131-132`) | runhead img 6.6 mm (`avalon.css:338`) | 5.8 mm (`binder.css:379`) |
| Column gap | 12 mm (`:141`) | dense 2-col 8 mm (`avalon.css:380`) | 9–11 mm (`binder.css:359, 443`) |
| Section gap | 7 mm (`:142`); wide +1 mm | `.section` 8 mm; inline `marginTop:5–6mm` between heads (`sheets.tsx:76`) | 5 mm |
| Head → items | 3.6 mm (`:145`) | 4 → 5.5 mm (`avalon.css:99, 517`) | 3–4 mm |
| Dish gap | 3.1 mm; name-only 2.6 mm (`:155-156`) | drink 3.4 mm (`avalon.css:344`); wine 2–2.2 mm; bb row `.2–.95mm` padding | cocktail 2.9–3.3 mm (`binder.css:604, 663`) |
| Footer | `margin-top:8mm` or `auto`; items 1.8 / 1.4 mm apart (`:179-182`) | `.a5 .foot{ position:absolute; left:13mm; right:13mm; bottom:9mm }` (`avalon.css:125`) | `left/right 14mm; bottom 6mm` (`binder.css:426`) |
| Folio | — | centred, `bottom:7.5mm` (`avalon.css:563`) | outer corner, `bottom:6mm` (`binder.css:371-375, 450-451`) |

### 1.2 Alma Avalon — venue tokens

- Template `avalon_alacarte`: `venueSlug 'alma-avalon'`, `venueClass 'avalon'`, logo `avalon-logo` alt "alma restaurant & bar", tagline **"Avalon Beach · Est 2017"**, title "À la carte" (`menu-render.ts:60-69`).
- Logo: 1583×880 lockup; A4 mast height **19 mm** (→ 34 mm wide) via `.food-print-page.venue-avalon .mast .logo{height:19mm}` (`menu-render.ts:132`) — the only venue-specific CSS rule in the whole engine. Drinks runhead **6.6 mm** high (≈ 12 mm wide) (`avalon.css:338`); back-page mark `36×20mm` `object-fit:contain` (`avalon.css:418`); cover uses the *group* wordmark `logo-alma-wordmark-green.png` at **96 mm** wide (`avalon.css:349`, `sheets.tsx:36`), not the Avalon lockup.
- Drinks cover copy: t-line "Restaurant & Bar · Avalon Beach" (`sheets.tsx:37`) — differs from the food eyebrow wording; back page "47 Old Barrenjoey Road, Avalon Beach" + italic "Start with snacks. Add tacos. Order another margarita." (`sheets.tsx:481-482`).
- Set-menu placement: "Trust our chef" boxed in the RIGHT column (`_food/menus.ts:173`; seed `menu-seed-content.ts:64-75`), footer pushed to the bottom with `chef-in-column` (`menu-render.ts:199, 313`).
- Dietary footer: "Dietaries catered with notice. Dishes may contain traces of allergens. Please advise your server of any allergies." (`menus.ts:174`; seed `:155`).
- Drinks format: A5 **portrait**, bound long edge, 22 mm gutter, white stock default, cream proof (`page.tsx:4-12`).
- Website accent (not print): `--venue-avalon:#3d5c3f`, soft `#d6e0cd` (`globals.css:50-51`); light logo variant exists for dark surfaces.

### 1.3 St Alma Freshwater — venue tokens

- Template `freshwater_alacarte`: `venueSlug 'st-alma'`, `venueClass 'stalma'`, logo `stalma-logo` alt "st.alma", tagline **"Restaurant & Bar · Freshwater"**, title "À la carte" (`menu-render.ts:50-59`).
- Logo: 1290×394 wordmark; A4 mast height **15 mm** (→ 49 mm wide) (`menu-render.ts:131`); binder runhead **5.8 mm** (≈ 19 mm wide) (`binder.css:379`); cover `60×18.2mm` box (`binder.css:386`, `sheets.tsx:45`). Design token box `47×14.3mm` (`binder.css:64-65`).
- Drinks cover copy: "Restaurant & Bar · Freshwater" (same as food) (`sheets.tsx:46`); conditions on cover "A surcharge of 10% applies on weekends and 15% on public holidays. Wine vintages may be subject to change." + "N contains nuts · DF dairy free" (`sheets.tsx:50`).
- Set-menu placement: full-width band above the footer with three hairline-divided columns (`_food/menus.ts:111` default; `menu-render.ts:287-304` unboxed); "Sweet" as a FULL-width section flowing into two columns (`menus.ts:104-110`; `renderWideSection` `:276-284`).
- Dietary footer: "Dietaries catered with notice. Please advise your server of any allergies." (`menus.ts:112`; seed `:84`).
- Drinks format: A5 **landscape** binder cards, 31 mm binding margin, two text columns per card (`binder.css:354-365`), white sheet (`binder.css:77, 356`).
- Address "20 Albert Street, Freshwater NSW 2096" (`data/venues.ts:177`). Website accent `--venue-stalma:#59684c`, soft `#e4ebdb` (`globals.css:52-53`); the brand's st.alma ink is terracotta `#684A4A` on `#EFE8DC` (`panels.css:53-56`) — again, not used in print.

## 2. Structural grammar

### 2.1 The A4 à la carte sheet (`menu-render.ts:307-337`, CSS `:98-213`)

```
main.food-print-page.stock-{white|cream}.venue-{stalma|avalon}[.chef-in-column]
└ section.sheet.a4                 210×297mm, padding 16/17/12mm, flex column, overflow hidden
   ├ .mast (centred, mb 8mm)       img.logo 15|19mm → .eyebrow (8.5px .32em caps 46%) → .rule 14×1mm → .title (Cormorant it 19px 72%)
   ├ .cols (grid 1fr 1fr, gap 12mm)
   │   ├ .col  ← sections with placement LEFT
   │   └ .col  ← sections with placement RIGHT (+ SET_MENUS here renders .chef.boxed)
   ├ [FULL sections]               .fsec.wide: head spans page, items alternate into .cols › .col
   │                                or .chef band (SET_MENUS, placement FULL): margin-top:auto pushes it to the foot
   └ .foot (centred, mt 8mm|auto)  .dietaries (it 12px) › .legend (7.5px, generated) › .surcharge (8px 58%)
```

- Section = `.fsec` (mb 7 mm) › `.sec-head` (hairline — TITLE[ / qual] — hairline, mb 3.6 mm) › `.dish*`.
- Dish row: `.dish-top` flex `space-between`, `align-items:baseline`, gap 4 mm → `.dname` (12.5px 500, inline `.tags` 7.5px 40 % nowrap after a space) … `.dprice` (12.5px tabular, right). `.ddesc` italic 13px 72 % under it. No leaders, no dotted fill; price is flush right, name wraps `pretty`. `break-inside:avoid` on every dish (`:155`).
- Section types (`menus.ts:80, 92-96`): `STANDARD` (name, tags, price, description), `HEADER_PRICED` (names only, price in heading suffix "/ 9 each", `.dish.taco` tighter 2.6 mm), `SET_MENUS` (name / "49 pp" / italic note; three centred columns with vertical hairlines, or boxed single column with name+price inline).
- Footer legend is **generated** from the tags actually printed, in fixed order V VG GF GFA DF N A I (`menus.ts:59-71`; `docs/menu-editor.md:163-164`). Heading is `doc.heading || template.title` (`menu-render.ts:87-90`). Surcharge default "A surcharge of 10% applies on weekends and 15% on public holidays." (`menu-seed-content.ts:62`).
- Validation that touches layout: overflow past one page = error; `STANDARD` item without price = warning (`docs/menu-editor.md:150-161`).
- Text budget today: St Alma A4 carries 5+4 (left) and 5+4 (right) dishes + 2 wide + 3 set menus + footer; Avalon 6+4+3 (left), 3+2+boxed chef (right). Measured fill is asserted `0.5 < fillRatio ≤ 1.005` (`menu-pdf.test.ts:40`).

### 2.2 Alma Avalon drinks — A5 portrait pages (`alma-avalon-drinks/sheets.tsx`, `avalon.css`)

Page anatomy (every inner page): `.sheet.a5.pg-r|pg-l` › `.drill` (guides) › `.runhead` (logo 6.6 mm → `.page-eyebrow` 9px 700 `.42em` caps 46 %, *or* an 11 mm rule on the wine-note page) › content › `.folio` centred at bottom 7.5 mm. The `.foot` block (surcharge + "N contains nuts · DF dairy free") sits only on the cover and back page (`sheets.tsx:42, 485`); legends sit in-page.

Page-type grammar and the row components:

| Page | Components used |
| --- | --- |
| Cover (P1) | `.title-page` centred flex: `.biglogo` 96 mm group wordmark → `.t-line` → `.t-title` "Drinks" 52px / `.menu` "Menu" 36px 72 % → `.t-nav` contents with page numbers → `.t-arch` (`sheets.tsx:34-41`) |
| Cocktails (P2–3) | `.sec-head` → `.callout` (italic one-liner) → `.drink` × n → `.footnote`. `.drink` = `.drink-top` grid `1fr auto` (`.dname` caps 11.5px 700 `.115em` [+ `.dmark`] / `.dprice` 12px) → `.ding` ingredients italic 13.5px → `.dnote` serving note 9px 52 % (`avalon.css:170-189`) |
| Low & no / beer / soft (P4) | `.subgroup` labels ("Low · lower alcohol", "No · alcohol free") between drinks; `.pour` rows `pname [abv] … pprice` 12px, no rules after polish; `.sodas-line` italic |
| Favourites (P5, `.favpage`) | `.page-title` 30px → `.section-note` → three `.bb-group` (`.bg-title` "Before dinner / With food / After dinner", `.bb` name/price rows, a `.ding` summary) → centred `.sec-head.center` → `.grid3` team picks (`.pick-name` 12px 700, `.pick-tag` "Tim's pick" 7.5–8px caps, `.ding`) → italic closing legend |
| On agave (P6) | `.agave-intro` essay-ish italic → "When to sip" `.ding` lines led by `.sip-when` (Avenir 700 9.5px caps `.05em`) → "Start here" name/note pairs → `.legend.closing` italic 13.5px |
| Flights (P7) | `.page-title` → `.section-note` → `.flight` rows (`.fname` caps 10.5px 700 `.06em` / `.fprice` 12px; `.fpours` italic 13.5px) → `.lead-line.flights-note` (italic) → `.footnote.flights-ref` |
| Wine note (P8) | `.essay` with `.lead` drop cap, `.sign` + `.role`, `.pairing-guide` |
| Wine (P9–10) | `.sec-head` → `.callout` → `.wine-head` (Wine · 150 mL · 250 mL · Bottle; grid `1fr 13mm 13mm 14mm`, gap 3 mm) → `.wine` rows: `.wname` 11.5px 500 + `.wreg.inline` italic region + `.pair ○△◇` / three `.wp` right-aligned 11px tabular, `.wp.empty` prints a 18 % "·" → `.legend` pairing key |
| Tequila / mezcal (P11–14, `.dense[.airy]`) | `column-count:2`, gap 8 mm, 8 % rule; `.callout` + `.agave-intro` span both columns; `.bb-group` (house title + house intro + `.bb` rows `name [abv] [• staff pick] … price` 10px; `.bb.mz` adds italic `.village`) never splits (`break-inside:avoid`); `break-before:column` forces balance (`sheets.tsx:302, 410`) → `.legend` "• Staff pick" |
| Back page (P15) | `.title-page`: `.backmark` 36×20 mm Avalon lockup → address `.t-line` → italic `.section-note` → `.t-arch`; `.foot .note` surcharge |

Marker conventions: `•` staff pick, `†`/`**` limited, `*`/`N`/`DF` allergens, `○ △ ◇` pairing — "one meaning per mark; legend on every page that uses one" (`avalon.css:314-320`). Price columns are always tabular Avenir with no currency symbol; empty cells are quiet dots.

### 2.3 St Alma drinks binder — A5 landscape cards (`st-alma-drinks/sheets.tsx`, `binder.css`)

Same component vocabulary (the CSS is the same design system with the binder add-on), different page physics: `.sheet.a5l` 210×148 mm, `column-count:2; column-gap:9mm; column-rule 11 %` (`binder.css:354-360, 443`); runhead/footnote/legend `column-span:all` (`:362, 365`); `.onecol` for cover, essay, favourites, flights, wine pages (`:368`); `.cocktailpg .cocktail-col{max-width:132mm}` centred single column so ingredients stay on one line (`:601-608`); `.glass` pages use a 3-column wine grid `minmax(0,1fr) 18mm 18mm` (`:485`); by-the-bottle pages use `.wine.one` single-line rows (muted `.vint`, inline `.wreg`, `.pair`, `.dag **`) grouped under `.wine-mood` labels (Crisp & refreshing / Aromatic & textural / Mineral & complex / Light & juicy / Medium-bodied & versatile / Full-bodied & bold / Sommelier pours / Sweet & fortified — `sheets.tsx:254, 316-326, 402-415`); `.wine.one .wnote` optional one-line tasting note spanning the row (`binder.css:517-518`). Folios sit in the outer corner (`binder.css:450-451`). The binder's "type floor" passes are the best evidence of print-tested minimums: labels 9→10px (`:504-509`), back-bar/wine names 11→12px (`:549-553`), serving notes 9–9.5px at ≥ 50–62 % (`:612, 665`), subgroup labels 8.5–9.5px at 52–64 % (`:628, 658`).

Both drinks menus carry 23 vs 15 pages because St Alma's bottle list is far longer (10 bottle pages vs Avalon's 2 wine pages); cocktails, low & no, favourites, on-agave, flights, wine-note and agave pages are structurally identical across venues and were deliberately matched "value-for-value" in September 2026 (`avalon.css:530-531`, `binder.css:698-704`).

### 2.4 What the website holds about drinks (for hierarchy only)

`alma-web-platform/apps/web/data/menus.ts`: per venue `drinks: WebsiteMenuSection[]` → `{ title, items: [{ name, price?, tag? }] }` (`:1-27`). Avalon: "Margaritas" (4, no prices), "Fresh pours" (3) (`:159-177`); St Alma: "Mexican classics" (9 priced 23–24, tags Popular/Signature/On tap), "Seasonal cocktails" (9, incl. carafes 72), "Low and no" (6, 18–20), "Beer & cider" (6, 10–15) (`:317-368`). Food items carry `diet: string[]` codes matching the print legend (`:5-10`) and promo `tag`s ("Start here", "Signature", "Popular", "For the table", "Finish here"). Rendered on `/menu/[venue]` by `components/MenuPageClient.tsx` as a dark "The bar" block: section titles Cormorant italic 2xl in shell pink, item names Cormorant 500 xl in paper, tag as a pill (`:447-535`). The website "set menus" strip shows `setMenus` ("Grazing 49 pp", "Feasting 79 pp", "Agave pairing 45 pp"; `:36-40, 185-189`). Website menu updates arrive via `scripts/update-website-menu.mjs` JSON (`:46-53` item shape name/price/tag). There is no per-size (150/250 mL) or wine data on the website.

What's On data for promotions (`data/whats-on.ts:76-162`): Avalon happy hour "Wed–Thu · 5–6pm · Fri–Sun · 4–6pm", price label "Walk-in"; Avalon bottomless "Sat & Sun · 12–4pm" "$99pp" ("guacamole and corn chips, a shared starter, then a shared main with a side, alongside bottomless margaritas"); Taco Wednesday Avalon "$5 tacos and $15 margaritas all night"; Taco Tuesday St Alma "from 5pm" "$5 tacos"; St Alma bottomless "Fri–Sun · 12–4pm" "$99pp". Fields: `dayLabel`, `monthLabel`, `time`, `venue`, `title`, `text`, `price`, `image`, `validDays`, `bookingTime`.

## 3. Shared vs distinct between venues

**Shared (one system):** single ink `#1d2916` and its tint ladder; white stock for print, cream `#efe7d8` for proofs; Avenir LT Std (4 faces) + Cormorant Garamond italic; the eyebrow → rule → italic title masthead; hairline-flanked letterspaced caps section heads; name … tabular price rows with italic descriptions beneath; dietary codes and generated legend; surcharge line; the `.t-arch` ornament; folio/runhead system; the drinks component vocabulary (cocktail, pour, wine, flight, back-bar, favourites, essay); the publish/preview pipeline (same HTML in iframe and Chrome). The whole `MENU_PRINT_CSS` is venue-agnostic except one line.

**Distinct per venue:**

| | Alma Avalon | St Alma Freshwater |
| --- | --- | --- |
| Mark | tall lockup 1.8:1, 19 mm on A4 (`menu-render.ts:132`) | long wordmark 3.27:1, 15 mm on A4 (`:131`) |
| Eyebrow | "Avalon Beach · Est 2017" (food) / "Restaurant & Bar · Avalon Beach" (drinks cover) | "Restaurant & Bar · Freshwater" (both) |
| Set-menu treatment | boxed panel inside the right column, footer at the bottom (`:191-199`) | full-width three-column band above the footer (`:169-176`) |
| Dietary footer wording | adds "Dishes may contain traces of allergens." | shorter line |
| Drinks physical format | A5 portrait, long-edge bound, 22 mm gutter, 15 pp | A5 landscape binder cards, 31 mm margin, 2-col multicol, 23 pp |
| Drinks cover mark | group "alma" wordmark 96 mm | st.alma wordmark 60×18.2 mm |
| Website accent | `#3d5c3f` | `#59684c`; brand terracotta `#684A4A` on `#EFE8DC` |
| Address | 47 Old Barrenjoey Road, Avalon Beach | 20 Albert Street, Freshwater NSW 2096 |
| Trading pattern (for promos) | happy hour Wed–Sun; bottomless Sat–Sun; Taco Wednesday | bottomless Fri–Sun; Taco Tuesday; no happy hour listed |

Nothing in the print system changes colour, type or rules per venue; branding is carried entirely by the mark, the eyebrow text, placement conventions and physical format.

## 4. Constraints for A5 (148 × 210 mm)

**Margins.** Reuse the system's A5 token: `padding:12mm 13mm 11mm` (`avalon.css:89`), footer band `left/right:13mm; bottom:9mm` (`:125`), folio `bottom:7.5mm` (`:563`). Live measure on an unbound card = **122 × 187 mm**; if the card is drilled/bound like the drinks, one side becomes 22 mm (measure **113 × 187 mm**, `:432-433`). Keep nothing within ~6 mm of the trim and no edge-to-edge art: `scripts/prepress.py` wraps the trim PDF with 3 mm bleed + 7.4 mm marks and extends only the flat stock colour into the bleed (`:3-13, 44-46`).

**Type: scale spacing, not glyphs.** Evidence from the shipped A5 drinks: body names stayed 11.5–12.5px (8.6–9.4 pt), ingredients 13.5px italic, notes 9–9.5px, labels raised to 10px, back-bar floor 12px (`binder.css:504-509, 549-553`). Recommended floors for the A5 family: item names ≥ 12px Avenir (A4's 12.5px is fine), descriptions ≥ 13px Cormorant italic (small x-height; 13px Cormorant reads like 11px Avenir), prices 12–12.5px tabular, tags/allergen marks ≥ 8.5px (A4's 7.5px tags are already 5.6 pt and should not go lower), legend/conditions 9–9.5px at ≥ 52 % ink, nothing under 8px (6 pt), nothing under 46 % ink below 9px, hairlines ≥ 18 % (11 % rules were dropped in polish; 24 % is the food sheet's). Letterspacing is em-based so it tracks size; keep heads at `.3em` but anything that must read as words ≤ `.14em` (the polish passes reduced `.3em` subgroups to `.08em`, `avalon.css:566`).

**Rhythm that must shrink (not type):** masthead 8 → 5–6 mm; mast rule 14 → 11 mm; logo 19/15 mm → **11–13 mm (Avalon) / 9–10 mm (St Alma)** on a card masthead (equal optical weight; the drinks runhead uses 6.6 / 5.8 mm, which is a running head, too small for a card's only mark); section gap 7 → 5–6 mm; head→items 3.6 → 4–5.5 mm (the drinks *increased* this on A5 for air, `avalon.css:517`); dish gap 3.1 → 3–3.4 mm.

**Columns.** A4 columns are 82 mm wide; an A5 two-column grid with the 12 mm gap gives 55 mm — too narrow for 12.5px names + tabular prices + wrapping descriptions. Default A5 cards to **one column**; use two columns only for dense name-price lists at ≤ 10.5px with `break-inside:avoid` groups and an 8–9 mm gap (the tequila/mezcal pattern, `avalon.css:380-391`).

**How much fits (one unbound A5, white).** Approximate heights at system metrics: described dish ≈ 12.1 mm (name 4.3 + desc 4.3 + 0.4 + 3.1); name-only row ≈ 6.9 mm; cocktail with ingredients ≈ 12.2 mm, with a serving note ≈ 15.8 mm; section head ≈ 9.5 mm; callout ≈ 8 mm. Reserving a card masthead with a promo title (~43 mm: logo 12 + 4.5 + eyebrow 3 + rule 8.5 + 30px title 8 + 6) and a conditions footer (~20 mm: two or three 9.5px lines + legend, absolute at bottom 9 mm) leaves **~124 mm**: ≈ 10 described dishes, or ≈ 18 name-only lines, or ≈ 8 cocktails with notes, less ≈ 9.5 mm per extra section head. Calibration: the real Avalon cocktails page holds 8 noted drinks + runhead + head + callout + footnote (`sheets.tsx:48-63`). Lines per column of italic description at 122 mm: ~60–65 characters.

**Page breaks and fidelity (pipeline facts).** Each `.sheet` has a fixed mm height with `overflow:hidden` (`menu-render.ts:122-123`), so content never bleeds onto a second page silently — the fill probe measures natural vs fixed height and publish blocks on overflow (`menus.ts:423-446`, `menu.service.ts:818-825`). Multi-sheet A5 sets must follow the drinks pattern `.sheet{break-after:page}` with `.sheet:last-child{break-after:auto}` (`avalon.css:470-471`) and `break-inside:avoid` on every row/group (`binder.css:364`), and the probe/gate must become per-sheet (today both assume exactly one page, `menu.service.ts:821`). Chrome receives the page size twice — `@page { size: Wmm Hmm }` from the template (`menu-render.ts:349`) and `page.pdf({width,height,preferCSSPageSize:true})` (`menu-pdf.ts:143-150`); the measurement viewport is fixed at A4 (`:123`) and should be derived from the template for A5. The editor preview already scales by `template.page` (`MenuPreview.tsx:58-59, 144-151`) so A5 works there as long as the root class stays `.food-print-page` (or `MenuPreview.tsx:66` and `MENU_FILL_PROBE_SCRIPT` `menus.ts:424` are generalised). Fonts must stay inlined/self-hosted (`menu-assets.ts:9-18`); `line-height` is Tailwind's 1.5 on `html` (`menu-render.ts:100`) whereas the drinks system assumes `line-height:normal` (`avalon.css:476-478`) — porting drinks components verbatim will need that reset or explicit line-heights.

## 5. Gaps — what the A5 family needs that the token sheet does not define

1. **Promo/offer title.** The food title is 19px italic (`menu-render.ts:138`); the drinks `.page-title` 30–34px and cover `.t-title` 52/36px exist only in website CSS (`avalon.css:162-165, 354-358`). No token for a headline-with-price lockup ("Bottomless Lunch 99 pp").
2. **Price-per-person / hero price.** `formatMenuPrice` gives "49 pp" with no `$` (`menus.ts:275-280`); the functions PDF prints "$125 pp"; the InDesign cards "99pp". No large-price style, no "+$12 pp" add-on style, no "2 / 3 / 4 hours → $54 / $69 / $84" matrix style (closest: `.wine-head/.wine` grid `avalon.css:219-238`).
3. **Conditions / footnote block.** Only `.foot .surcharge` 8px 58 % single line (`menu-render.ts:182, 212`) and `.footnote` 9–9.5px (`avalon.css:545`). Bottomless needs a multi-line conditions block (2-hour sitting, whole table participates, lunch 12–4, up to 19 guests); happy hour needs a times line; note the merchant-fee line was deliberately removed Sep 2026 (`_food/menus.ts:8`).
4. **When/where line (day · time · venue).** No token; candidates are `.t-line`/`.page-eyebrow` (9–9.5px 700 `.42em` caps 46 %) and `.lead-line` (`avalon.css:325-329`). What's On strings ("Wed–Thu · 5–6pm · Fri–Sun · 4–6pm") need a home.
5. **Course divider / "Select from" / "+".** Nothing exists beyond the hairline `.sec-head`, `.subgroup` and `.wine-mood` labels, and the vertical `chef-item` rule. Set menus need a course label, an "or" choice marker and an inclusions "+" separator.
6. **Centred inclusions list (names only, no prices).** `HEADER_PRICED` is left-aligned with tags; the only centred stack is `.title-page` (`avalon.css:348`).
7. **Add-on line** ("Add on — Chicken tinga empanadas 7 pp") and **upgrade rows** ("Cocktail on arrival +$12 pp"): no style.
8. **Both-venue / group branding.** Private-event and functions material is group-level (functions PDF eyebrow lists both venues); `alma-group-logo.png` and `logo-alma-wordmark-green.png` are not registered in `MENU_LOGO_FILES` (`menu-render.ts:407-410`) and `MenuTemplate.venueSlug` is single-valued (`:37`). Two-venue comparison table (minimum spend) has no style; `.cols-2`/`.grid3` are the only grids (`avalon.css:304, 409`).
9. **Cormorant faces.** Only Italic 400 is self-hosted (`menu-render.ts:221`). Drinks-style titles use italic **500**, essays use Cormorant **roman** 500, the functions PDF used Medium Italic and Bold — the API would synthesise or fall back to Georgia. Add Regular/Medium/Medium-Italic (OFL) to `apps/api/assets/menus/fonts` and `menuFontFaceCss` before using them. Also avoid `font-weight:600` (no face; resolves to Heavy).
10. **Ornament vocabulary.** `.t-arch` is the only decorative device; the fish motif (`fish.png`, `FishWatermark.tsx` at 6–9 %) and the sunburst SVG (`panels.tsx:120-151`) exist only on web/social. No rule for a watermark on print, and 6 % ink would be unreliable in print.
11. **Accent colour policy.** Print is single-ink; terracotta/blush exist in brand but have never been printed on a menu. The drinks `.favpage` experiments show the system prefers Avenir names and italic notes over display serif (`avalon.css:550-554`).
12. **Dietary legend on drinks-led cards.** Drinks use a hand-typed two-code legend "N contains nuts · DF dairy free" (`sheets.tsx:42, 80`) while food generates the 8-code legend; `.dmark` is the drinks tag style. A happy-hour card mixing snacks and drinks needs one rule.
13. **Cream vs white.** `--stock` tokens exist (`menu-render.ts:114, 119`) but the engine's `MenuRenderOptions.stock` is screen-only; A5 cards may be printed on cream card — no decision recorded.
14. **Data model.** `MenuDocument` is `heading / dietaryNote / surchargeLine / sections` (`menus.ts:128-138`); `MENU_LIMITS.headingMax 60, priceUnitMax 8` (`:155-170`). No fields for subtitle, when-line, conditions list, hero price, inclusions, add-ons, cover/back, page count; `MENU_TEMPLATE_KEYS` has two entries (`menu-render.ts:28`); the gate hard-codes one A4 page (`menu.service.ts:825`).
15. **Glyph coverage.** `○ △ ◇ • † √` are set in Avenir in the drinks sheets; the published PDFs embed only Avenir/Cormorant subsets, so coverage appears to work for `○△◇•`, but verify in the API's inlined `.otf` build before relying on them in A5 templates.
16. **Logo sizing rule at A5.** The system has runhead sizes (6.6 / 5.8 mm) and A4 masthead sizes (19 / 15 mm) but no "single-card masthead" size; propose and lock one pair so Avalon and St Alma cards read as a family (see §4).


## Open questions (agent)
- Ink policy for A5 table cards: stay strictly single-ink forest #1d2916 on white like every printed menu to date, or allow the brand's terracotta #684A4A / blush #F5DCCE accent (used only on web and social so far) for promotions?
- Canonical Avalon eyebrow wording: the food sheet prints "Avalon Beach · Est 2017" (menu-render.ts:66) while the drinks cover prints "Restaurant & Bar · Avalon Beach" (sheets.tsx:37) — which does the A5 family carry?
- Price notation: the engine prints "99 pp" with no dollar sign (menus.ts:276-280); the functions PDF prints "$125 pp" and "+$12 pp"; the old InDesign cards "99pp". One convention for promo and set-menu cards?
- Conditions copy for bottomless/happy hour: confirm the merchant-fee line stays removed (dropped Sep 2026), and the exact sitting-time / whole-table / guest-limit / lunch-hours wording per venue.
- Private-event and set-menu cards: group-level branding with the alma wordmark (as the functions PDF and the Avalon drinks cover do) or per-venue marks only? If group-level, which logo file is the canonical print mark (logo-alma-wordmark-green.png vs alma-group-logo.png)?
- Physical format: are A5 cards loose/laminated (symmetric 12/13/11 mm margins) or drilled into the drinks binders (22 mm gutter, alternating sides, drill guides)? Portrait for both venues, or does St Alma keep landscape to match its binder?
- Stock: printed on white (current rule) or on the venues' cream card? This decides whether the editor shows the cream proof by default.
- Fonts: approve adding Cormorant Garamond Regular / Medium / Medium Italic (OFL) to the API assets for promo titles and essay-style copy; is any additional licensed Avenir face (Light 35, Medium 65) available, or do we stay with Book/Roman/Heavy/Black?
- Dietary marks on mixed drinks+snacks cards (happy hour): the generated 8-code food legend, the drinks two-code convention (N · DF), or both?
- Logo size on a single A5 card: lock a pair (e.g. Avalon lockup 12 mm high, St Alma wordmark 9.5 mm high) so the two venues read as one family — needs sign-off since nothing in the system defines it.
