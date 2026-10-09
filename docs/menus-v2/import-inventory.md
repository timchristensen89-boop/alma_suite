# Menus V2 — import inventory

What `pnpm --filter @alma/api menus:import` creates, as reviewable drafts, from the reference menus (the website print sheets, the design folder PDFs) and the website's What's On events. Nothing here is approved content: every menu lands as an unpublished draft and every promotion as an unpublished listing, with the source, the confidence and the review notes on its audit trail. Regenerate with `pnpm --filter @alma/api menus:import-inventory`.

## Menus

| Venue · menu | Kind · template | Pages · sections · items | Confidence | Source |
|---|---|---|---|---|
| st-alma · **Drinks** (`drinks`) | DRINKS · `freshwater_drinks_binder` (A5L) | 23 · 75 · 264 | high | alma-web-platform/apps/web/app/print/st-alma-drinks/sheets.tsx @ 6115001, 2026-09-24 |
| st-alma · **Tuesday** (`tuesday`) | FOOD · `freshwater_alacarte` (A4) | 1 · 6 · 18 | high | /Family Room/Indesign/St Alma - Food Tuesday 13:7.pdf @ id:x4KPThkyLiAAAAAAAAD7ug, 2026-07-13 |
| st-alma · **Bottomless** (`bottomless`) | PROMOTION · `freshwater_card_a5` (A5P) | 1 · 5 · 13 | high | /Family Room/Indesign/St. Alma/ST ALMA_MENU A5 BOTTOMLESS.pdf @ id:x4KPThkyLiAAAAAAAAAzeQ, 2025-11-15 |
| alma-avalon · **Drinks** (`drinks`) | DRINKS · `avalon_drinks_book` (A5P) | 15 · 55 · 165 | high | alma-web-platform/apps/web/app/print/alma-avalon-drinks/sheets.tsx @ 6115001, 2026-09-24 |
| alma-avalon · **Happy hour** (`happy-hour`) | PROMOTION · `avalon_card_a5` (A5P) | 1 · 3 · 11 | medium | /Family Room/Indesign/Alma A5 Menu/ALMA_MENU HAPPY HOUR 16:8.pdf @ id:x4KPThkyLiAAAAAAAAAxyw, 2025-08-16 |
| alma-avalon · **Bottomless** (`bottomless`) | PROMOTION · `avalon_card_a5` (A5P) | 1 · 4 · 15 | high | /Family Room/Indesign/Alma A5 Menu/Bottomless/ALMA_MENU BOTTOMLESS 18.10.25.pdf @ id:x4KPThkyLiAAAAAAAAAzaA, 2025-10-17 |
| alma-avalon · **Lunch special** (`lunch-special`) | PROMOTION · `avalon_card_a5` (A5P) | 1 · 5 · 9 | high | /Family Room/Indesign/Alma A5 Menu/ALMA_MENU A5 LUNCH SPECIAL 16:1.pdf @ id:x4KPThkyLiAAAAAAAAA0aA, 2026-01-16 |
| st-alma · **Functions & groups** (`functions`) | FUNCTIONS · `group_functions_a4` (A4) | 5 · 26 · 31 | high | /Family Room/Indesign/Package menu creation25:7.pdf @ id:x4KPThkyLiAAAAAAAAD72w, 2026-07-25 |
| st-alma · **Set menu packages** (`set-menu-packages`) | FUNCTIONS · `group_functions_a4` (A4) | 4 · 21 · 31 | medium | /Family Room/Indesign/Set Menu Pack review.pdf @ id:x4KPThkyLiAAAAAAAAD78w, 2026-08-05 |

### st-alma · Drinks

- Source: alma-web-platform/apps/web/app/print/st-alma-drinks/sheets.tsx (ref 6115001), hash `sha256:86a1ed581…`, modified 2026-09-24.
- Checked against: Transcribed from the hand-written JSX that renders the live website PDF (apps/web/public/menus/st-alma-drinks.pdf), which is byte-identical to the Dropbox reference "St Alma Drinks SCREEN.pdf" (Sep 2026; discovery/05 §3c). All 23 cards were checked against the inventory in discovery/05 §3c and 04 §2.3. The sheet was last changed in alma-web-platform commit 9dfef4f ("St Alma drinks: note 15 mL pours on the tequila and mezcal pages").
- Heading "Drinks".
- Sections by type: 35 × Standard (name, tags, price, description), 14 × Text (intro, callout, conditions), 26 × Price table (several price columns).
- Validation: 0 error(s), 11 warning(s) — Our favourites › Arette Blanco: no price. It will print without one.; Our favourites › Fortaleza Reposado: no price. It will print without one.; Our favourites › Fortaleza Blanco: no price. It will print without one.; ….
- Review before publishing:
  - Cover contents line: the template generates it from the first titled section of each page, so it reads "Margaritas 2 · Palomas 3 · …" rather than the binder's hand-set "Cocktails 2 · Agave & flights 7 · Wine 9 · Tequila 20 · Mezcal 22" until the renderer offers a curated line. The cover footer also gains "** Limited stock" from the generated marks legend; the binder prints its ** note on page 9 only.
  - Page eyebrows ("Cocktails", "Our favourites", "Low & no · Beer, Cider & Soft Drinks", "On agave", "Tasting flights", "Wine by the glass · White", "By the bottle · …", "Tequila", "Mezcal") have no slot: the template's running head prints the venue tagline. "Tequila" and "Mezcal" survive as the titles of the pour-size text blocks that open pages 20–23; the rest are dropped.
  - Page 2: the binder's "On tap" serving note on the Rhubarb Grapefruit Paloma is kept as the item note and also recorded as the ON_TAP flag (the flag has no printed mark).
  - Page 4 "To share": the binder prints "Our rhubarb and grapefruit paloma, on tap, serves three." and "On tap, serves three." as the italic line; here "on tap, serves three" is the item meta (small grey detail after the name) with the paloma's description cut to "Our rhubarb and grapefruit paloma", per the import mapping. Restore the full sentence as the description if the meta reads wrong on the proof.
  - Page 5: each favourites group's closing italic line ("Bright and citrus-led, made to open the palate." etc.) sits in the section subheading, so it prints above the three names rather than below them as in the binder. The "Can't decide?" page title and its note are a text block; the binder's three-column grid prints as three stacked groups.
  - Page 6: the "Low & no" subgroups are two sections titled "Low & no" with the subgroup label as the headerSuffix ("LOW & NO / Low · lower alcohol", "LOW & NO / No · alcohol free"), so the label prints in the head rather than as the binder's small label between rows. Beer & cider rows print in the drink style (caps name, ABV as meta) rather than the binder's plain pour rows.
  - Section budget: the binder transcribes to 75 sections under this mapping (one per producer group, one per wine style or mood), within MENU_LIMITS.sectionsMax (160, raised from the first Menu Editor's one-sheet 60 for the multi-page templates); st-alma-drinks.test.ts asserts it stays within the limit.
  - Page 7: the picks' labels ("TIM'S PICK") are item meta ("Tim's pick"); the picks, "When to sip" and "Start here" carry no prices (none are printed), so validation warns STANDARD_NO_PRICE for those 11 items — acknowledge at publish. "When to sip" entries are items whose name is the bold lead ("To begin") and whose description is the rest of the line.
  - Page 9: the pairing key's three entries are separated with " · " where the binder uses wide spaces, and the binder's "** Subject to availability. Vintages may change." line is kept in that text block as printed, so it will print alongside the generated "** Limited stock" legend on the last page.
  - Pages 10–19: every wine's vintage moved from the start of the name into the detail ("2024 · Eden Valley, SA ○") so names stay stable across vintages; the pairing marks ○ △ ◇ follow the region there because the template generates legends only for dietary tags and the •/** flags. The binder prints the vintage as a muted prefix.
  - Page 10: "Bubbles" is its own one-column table ("150 mL", suffix "150 mL pour") because the binder prices bubbles by the 150 mL pour only; the template prints a column header per table, so this page carries three header rows where the binder has one.
  - Page 11: "Sweet & fortified" is a table with columns "60 mL" and "375 mL btl" (the binder spells the sizes in the region tail of its single row); its callout is the section subheading.
  - Pages 13 and 17: the mood labels (Crisp & refreshing, Aromatic & textural, Mineral & complex; Light & juicy, Medium-bodied & versatile, Full-bodied & bold) are the headerSuffix of one table each under the same style title, so they print as "OTHER WHITES / Crisp & refreshing" heads rather than the binder's small labels between rows. "cont." heads on pages 15, 18 and 19 keep their suffix as printed.
  - Pages 20–23: the binder sets tequila and mezcal in two dense columns with the pour-size callouts spanning both and a "• Staff pick" legend on each page; here the callouts are a text block titled "Tequila" / "Mezcal" at the top of each page, the groups print in the template's two-column A5-landscape flow, and the marks legend prints on the cover and last page — check the fill probe for overflow before publishing.
  - Page 5 "Fortaleza Blanco" prints an empty ABV span in the binder (nothing visible); no meta is set here.

### st-alma · Tuesday

- Source: /Family Room/Indesign/St Alma - Food Tuesday 13:7.pdf (ref id:x4KPThkyLiAAAAAAAAD7ug), modified 2026-07-13.
- Checked against: Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.7); the file could not be downloaded or rendered in this sandbox. It is the newest of three Tuesday cards (30:6:26 → 30:6 → 13:7) and the only St Alma one; Avalon's equivalent promotion is Taco & Margarita Wednesdays. High confidence as the Tuesday card itself; its prices are the July 2026 level, one bump behind the Sep 2026 à la carte (St Alma Food SCREEN.pdf, +$1 on most dishes).
- Heading "Taco Tuesday".
- Sections by type: 1 × Priced in heading (names only), 4 × Standard (name, tags, price, description), 1 × Set menus / packages (name, price pp, note).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - Prices are the July 2026 level. The Sep 2026 à la carte is +$1 on every priced dish here (Guacamole 17, Kingfish ceviche 33, Chicken tinga empanadas 22, Grilled snapper 40, Agave beef short rib 49, Roasted cabbage 33, Polenta and Parmesan fries 19, Green leaf salad 17, Broccolini 20, Churros 19); the Trust our chef tiers (49 / 79 / 45) are unchanged. Decide whether the Tuesday card follows.
  - Tacos: the card lists each taco with its codes and garnish ("Chorizo & potato (GF · DF) — Refried beans, tomatillo salsa"); on the A4 sheet a priced-heading section prints names only, so the garnish is joined into the name exactly as the live à la carte prints its tacos. The card says "fried potato" (the Sep sheet: "fried potatoes") and "Chorizo & potato" (Sep: "Chorizo and potato").
  - Trust our chef: four tiers in a band drawn for three — "Try them all" (20, a flat price for the board) wraps to a second row on the current template. Check the preview; the bundle may belong in its own section or on a wider band.
  - Dishes the Tuesday card leaves off the regular sheet: Prawn tostada, Mushroom carnita empanadas, Grilled octopus, Roast chicken, Roasted baby beetroot, Dairy free pavlova. If Tuesday should instead be a derived variant of the à la carte (plan §5.8), these are the items to hide.
  - The surcharge line is carried as extracted, without a full stop; the Sep 2026 sheet prints "A surcharge of 10% applies on weekends and 15% on public holidays."
  - Earlier drafts differ: 30:6 had Cochinita pork / Barramundi / Beef birria / Smoked confit eggplant tacos and a pistachio salad garnish; 30:6:26 a single "Trust our chef 79 pp". The 13:7 card dropped the merchant-fee sentence.

### st-alma · Bottomless

- Source: /Family Room/Indesign/St. Alma/ST ALMA_MENU A5 BOTTOMLESS.pdf (ref id:x4KPThkyLiAAAAAAAAAzeQ), modified 2025-11-15.
- Checked against: Text fetched from Dropbox in this session (the inventory in discovery/05 §1b only summarises the card). The newest St Alma bottomless card; a near-identical copy sits in ST ALMA_MENU TEMPLATE Folder/ST ALMA_MENU A5 BOTTOMLESS 15:11.pdf (id:x4KPThkyLiAAAAAAAAAzeA). The website serves the 8 Nov 2025 card instead (St Alma A5 Menus/Bottomless/ST ALMA_MENU A5 BOTTOMLESS 8:11.pdf, id:x4KPThkyLiAAAAAAAAAzUQ, Dropbox content hash 067e93b1…, == alma-web-platform apps/web/public/menus/st-alma-bottomless.pdf), whose text was read from that local copy for comparison. High confidence for the content; which of the two cards is current is for the owner (discovery/05 §4.6).
- Heading "Bottomless lunch", when "Fri–Sun · 12–4pm", hero price 99 pp.
- Sections by type: 4 × List (names only, no prices), 1 × Standard (name, tags, price, description).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - Version: the website serves the 8 Nov 2025 card. This 15 Nov card differs in two lines — "Roast chicken, esquites, salsa macha" (8 Nov: "Roast chicken in adobo, sweet potato, coriander cashew salsa") and "Balter Cerveza" (8 Nov: "Corona") — and words the sitting line "your booking is for a 2 hour sitting" (8 Nov: "you are booked in for a 2 hour sitting"). Confirm which is current before publishing.
  - Days and times are not on the card. The when-line "Fri–Sun · 12–4pm" is the website's What's On text (also the Jun 2026 St Alma What's On sheet and the Sep 2025 one); confirm.
  - The card prints no dietary codes (the Avalon card does), so no tags are set and the salmon and snapper carry no origin; add tags in the editor if the card should show them.
  - The card prints no surcharge sentence; surchargeLine is left empty rather than invented. The template's default ("A surcharge of 10% applies on weekends and 15% on public holidays.") is one click away if it should.
  - Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The allergens sentence is kept as the dietary note with its punctuation normalised ("Dishes may contain traces of allergens. Please advise your server of any allergies.").
  - Drink inclusions differ across documents (discovery/05 §4.10): this card lists four margaritas, R.Paulazzo Rosé and Balter Cerveza; the Avalon card three margaritas, Corona and house wines; the set-menu pack and functions menu say otherwise again.
  - "pureé" is spelt as the card spells it.
  - The legacy St Alma card is set in burgundy with a script sign-off; the redesigned template prints forest ink and no sign-off (plan §5.4).

### alma-avalon · Drinks

- Source: alma-web-platform/apps/web/app/print/alma-avalon-drinks/sheets.tsx (ref 6115001), hash `sha256:ac56be95b…`, modified 2026-09-24.
- Checked against: Transcribed from the hand-written JSX that renders the live website PDF (apps/web/public/menus/alma-avalon-drinks.pdf), which is byte-identical to the Dropbox reference "Alma Avalon Drinks SCREEN.pdf" (Sep 2026; discovery/05 §3c). Every page of the 15-page book was checked against the inventory in discovery/05 §3c and 04 §2.2. The sheet was last changed in alma-web-platform commit ea1e2a8 ("final pre-print polish", no content changes).
- Heading "Drinks".
- Sections by type: 36 × Standard (name, tags, price, description), 15 × Text (intro, callout, conditions), 4 × Price table (several price columns).
- Validation: 0 error(s), 11 warning(s) — The team’s agave picks › Arette Blanco: no price. It will print without one.; The team’s agave picks › Código 1530 Rosa: no price. It will print without one.; The team’s agave picks › Fortaleza Blanco: no price. It will print without one.; ….
- Review before publishing:
  - Cover: the book prints "Drinks" with "Menu" beneath it (36 px, 72 % ink). The subheading is left empty per the import defaults; set document.subheading to "Menu" to reproduce the lockup — the template's t-sub slot has those metrics.
  - Cover contents line: the template generates it from the first titled section of each page, so it will not read like the book's hand-set "Cocktails 2 · Agave & flights 6 · Wine 8 · Tequila 11 · Mezcal 13" until the renderer offers a curated line.
  - Page eyebrows ("Cocktails", "Low & No · Beer & Cider", "Our favourites", "On agave", "Tasting flights", "Wine · White", "Wine · Rosé & Red", "Tequila · The highlands", "Tequila · The lowlands, estates & houses", "Mezcal · Espadín & ensemble", "Mezcal · Wild agave") have no slot: the template's running head prints the venue tagline. On pages 11 and 13 the eyebrow became the title and suffix of the page-intro text block ("Tequila / The highlands", "Mezcal / Espadín & ensemble"); elsewhere it is dropped.
  - Page 4: the "Low & no" head and its callout are kept as a section with no items above the two subgroup sections ("Low · lower alcohol", "No · alcohol free"), which print as full section heads rather than the book's small subgroup labels.
  - Page 5: each favourites group's closing italic line ("Bright and citrus-led, made to open the palate." etc.) sits in the section subheading, so it prints above the three names rather than below them as in the book. The "Can't decide?" page title and its note are a text block.
  - Pages 5–6: "When to sip", "Start here" and "The team's agave picks" carry no prices (none are printed), so validation warns STANDARD_NO_PRICE for those 11 items; acknowledge at publish.
  - Pages 8–10: the pairing marks ○ △ ◇ are appended to each wine's region (meta) and the pairing key is typed as a text block on pages 8, 9 and 10, because the template generates legends only for dietary tags and the •/** flags. The book separates the key's three entries with wide spaces; here " · ".
  - Page 9: the book prints one column header over White and Bubbles; here Bubbles prints its own.
  - Page 13: the book splits Espadín across two columns ("Espadín cont."); here it is one 17-row section.
  - Pages 11–14: the book sets tequila and mezcal in two dense columns (10 px rows) with a "• Staff pick" legend on each page; the template prints one column and the marks legend on the cover and back page only — check the fill probe for overflow before publishing.
  - Page 15: the back page's Avalon lockup and arch are not typed; the address and "Start with snacks…" line are a text block, and the surcharge prints from the generated footer.

### alma-avalon · Happy hour

- Source: /Family Room/Indesign/Alma A5 Menu/ALMA_MENU HAPPY HOUR 16:8.pdf (ref id:x4KPThkyLiAAAAAAAAAxyw), modified 2025-08-16.
- Checked against: Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.9); the file could not be downloaded or rendered in this sandbox. The only 2025/26 happy-hour PDF; the card prints no venue name but sits in the Alma (Avalon) A5 folder and its .indd is the Alma template. Medium confidence: the hours conflict with two other sources, and ALMA_MENU HAPPY HOUR.indd was edited on 2026-05-22 with no newer PDF exported (discovery/05 §4.8).
- Heading "Happy hour", when "Tue–Thu · 5–6pm · Fri–Sun · 4–6pm".
- Sections by type: 3 × Priced in heading (names only).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - Hours conflict across sources and need the owner's call (plan §5.2): this card and the Jun 2026 Avalon What's On sheet say Tue–Thu 5–6pm / Fri–Sun 4–6pm (used here); the Jan 2026 What's On page (ALMA_MENU ALLERGENS WHATS ON PAGE 25:1.pdf) says Tue–Fri 5–6pm / Sat & Sun 4–6pm; the website today says Wed–Sun. The 2024 St Alma card said Fri–Sun 3–5pm.
  - The .indd was edited on 2026-05-22 after this export and the Alma A5 Menu/Happy Hour folder is empty, so a newer card may exist only as an InDesign file.
  - Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The surcharge sentence is kept as the card words it ("…15% on public holiday."); the house 2026 wording is "A surcharge of 10% applies on weekends and 15% on public holidays."
  - "Jalapeno" is spelt without the tilde on this card (the bottomless card prints "Jalapeño").
  - The card prints no venue name; it is imported for Alma Avalon on the strength of its folder and template.

### alma-avalon · Bottomless

- Source: /Family Room/Indesign/Alma A5 Menu/Bottomless/ALMA_MENU BOTTOMLESS 18.10.25.pdf (ref id:x4KPThkyLiAAAAAAAAAzaA), hash `dropbox-content-…`, modified 2025-10-17.
- Checked against: Byte-identical to the website's alma-web-platform apps/web/public/menus/alma-avalon-bottomless.pdf (Dropbox content hash 3bbb24af…, discovery/05 §0) and to two further Dropbox copies (Alma A5 Menu/Bottomless/ALMA_MENU BOTTOMLESS 18:10.pdf, Alma Food Menu/ALMA_MENU BOTTOMLESS 18:10.pdf). The local copy was read with pdftotext for this transcription and checked against discovery/05 §2.10 and the rendered card in §3b. A5 portrait, InDesign 20.5, document title ALMA_MENU BOTTOMLESS 21:3.indd. High confidence for the content; the days and the drink inclusions are for the owner (plan §5.3).
- Heading "Bottomless lunch", when "Sat & Sun · 12–4pm", hero price 99 pp.
- Sections by type: 4 × List (names only, no prices).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - Days and times are not on the card. The when-line "Sat & Sun · 12–4pm" is the website's What's On text; the Jun 2026 Avalon What's On sheet and the Jan 2026 page say Sat & Sun 12–3pm. Confirm.
  - Drink inclusions differ across documents (discovery/05 §4.10): this card lists Classic, Watermelon and Jalapeño margaritas, Corona and house wines; the set-menu pack says Classic and jalapeño margaritas, Prosecco, Corona, house Riesling and Pinot Noir; the functions menu "margaritas, Coronas and house wine"; the St Alma card four margaritas, R.Paulazzo Rosé and Balter Cerveza.
  - Dietary codes are mapped from the card's lowercase legend to the house codes ("√" read as vegan → VG, "gfa" → GFA, "df" → DF, "n" → N, "v" → V); the generated legend replaces the legacy one. Prawn ceviche, the salmon taco and the barramundi taco carry no A/I origin on the card, so isSeafood is left false rather than invent one.
  - Section heads: the card prints the five included dishes with no heading and joins courses with "+"; here "Included", "Then" and the lead-in "Choose your tacos" are editorial labels for the template's section grammar, not the card's words. Rename or clear them if the card should stay label-free.
  - Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). "2 hour sitting times." and the surcharge sentence are kept as the card words them.
  - The legacy card's fish illustration behind the wordmark and the "Alma loves you x" script sign-off are not reproduced by the template (plan §5.4).

### alma-avalon · Lunch special

- Source: /Family Room/Indesign/Alma A5 Menu/ALMA_MENU A5 LUNCH SPECIAL 16:1.pdf (ref id:x4KPThkyLiAAAAAAAAA0aA), modified 2026-01-16.
- Checked against: Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.8); the file could not be downloaded or rendered in this sandbox. The newest lunch-special PDF (InDesign template ALMA_MENU A5 LUNCH SPECIAL.indd). High confidence for the content as of 16 Jan 2026; the .indd was edited on 2026-02-06 after this export with no newer PDF found (discovery/05 §4.9).
- Heading "Lunch special", hero price 49 pp.
- Sections by type: 4 × List (names only, no prices), 1 × Standard (name, tags, price, description).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - The .indd was edited on 2026-02-06 after this PDF; a newer card may exist only as an InDesign file. Check before publishing.
  - Days and times are not on the card and are left empty. The Jan 2026 Avalon What's On page says Saturday & Sunday 12–3pm ("Lunch Special · 49pp"); the 2025 St Alma sheet ran its shared lunch special on Fridays 12–4pm. Confirm whether the special is Avalon-only and when it runs (plan §5 open questions).
  - The card prints "Classic margarita" and "Sensible margarita" on two lines with no label; the What's On pages describe a complimentary margarita or a choice between the two. "To drink" and the lead-in "Choose one" are editorial labels for the template's section grammar, not the card's words. The card's course heads are "Starter", "Shared Main", "Shared Side" and "Add On".
  - No dietary markers are printed on the card, so no tags are set and the prawn ceviche and fish of the day carry no origin.
  - Add on: "Chicken tinga empanadas, martajada sauce 7pp" prints as 7 pp; "Guacamole, salsa macha, tostadas 16" is a flat 16.
  - Dropped from the footer: "Merchant fees apply to all card transcations" (sic), retired with the legacy A5 flourishes (plan §3.6). The surcharge sentence is kept as the card words it.

### st-alma · Functions & groups

- Source: /Family Room/Indesign/Package menu creation25:7.pdf (ref id:x4KPThkyLiAAAAAAAAD72w), hash `dropbox-content-…`, modified 2026-07-25.
- Checked against: Byte-identical to the live website file alma-web-platform apps/web/public/menus/alma-functions-menu.pdf (Dropbox content hash 7c1ced17…, discovery/05 §0), linked from /catering. The local copy was read with pdftotext for this transcription and checked against discovery/05 §2.3 and the rendered pages in §3a. Successor of "Alma Functions Menu 15:7.pdf" (id:x4KPThkyLiAAAAAAAAD7wg), which lacked the lunch-only / 19-guest bottomless clause. High confidence: this is what the website serves today.
- Heading "Functions & groups", subheading "Package menu".
- Sections by type: 10 × Text (intro, callout, conditions), 4 × Set menus / packages (name, price pp, note), 7 × Standard (name, tags, price, description), 5 × Price table (several price columns).
- Validation: 0 error(s), 1 warning(s) — On arrival › Cake, house sourced and decorated to suit: no price. It will print without one..
- Review before publishing:
  - Cover: the PDF prints "PACKAGE MENU" as letterspaced caps under the title; the template prints the subheading in Cormorant italic. The template also generates a contents line from each page's first titled section ("THE ALMA TABLE 2 · BY THE OCCASION 3 · BEVERAGE PACKAGES 4 · WEDDINGS 5"), which the PDF does not have.
  - Page titles: "WAYS TO GATHER", "BY THE OCCASION", "BEVERAGE PACKAGES" and "WEDDINGS" have no slot in the paged family; on pages 3–5 the title opens the page as a text block carrying the PDF's italic tagline, on page 2 (no tagline) it is dropped and the page opens with the preferred package.
  - The Alma Table: the PDF draws it as a bordered box with a filled "PREFERRED" pill; here it is a set-menu section with "Preferred" as the small-caps lead. "WITH A SET MENU" on the house drinks package is carried as the item's meta.
  - Prices print in the house style, bare numbers with "pp" ("125 pp", "10 pp", "54 · 69 · 84"); the PDF's "$" and the "+" on add-ons ("+$12 pp", "+$19 / $29 / $39") are not printed. Minimum spends print without thousands separators ("7000"); the PDF prints "$7,000".
  - Team & corporate lunches: the PDF's one row "Grazing $49 pp, or six course $79 pp" is two priced rows here, with its four lines of prose as a text block beneath.
  - Cake, house sourced and decorated to suit has no price ("on request" is its meta), so validation warns STANDARD_NO_PRICE for that row; acknowledge at publish.
  - Beverage packages: the tiers are tables with 2 hrs / 3 hrs / 4 hrs columns (the PDF heads each tier "STANDARD 2 / 3 / 4 HOURS" and prints "$54 / $69 / $84" on one line). The arrival add-ons on this page are a second "Add ons" section with the suffix "On arrival", below the duration-priced table.
  - Weddings: the PDF sets the minimum spends as two side-by-side columns, each with its capacity note above the rows; here one table with a St Alma and an Alma Avalon column, then the two capacity notes as titled text blocks, then the contact block.
  - Surcharge: carried as conditions ("A surcharge of 10% applies on Saturday and Sunday, 15% on public holidays."), which the template prints on the last page; the group template's default surchargeLine says the same and is left empty here so it does not print twice.
  - The PDF's warm cream page and bordered hero box are the website renderer's; the template prints white stock with the shared tokens (plan §3.6).

### st-alma · Set menu packages

- Source: /Family Room/Indesign/Set Menu Pack review.pdf (ref id:x4KPThkyLiAAAAAAAAD78w), modified 2026-08-05.
- Checked against: Transcribed from the text extracted by the Dropbox connector (discovery/05 §2.1); the file could not be downloaded or rendered in this sandbox, so the layout is inferred from text order. It is the newest of three drafts made within 21 hours — "Alma Group Set Menu Packages.pdf" (4 Aug 10:28, id:x4KPThkyLiAAAAAAAAD78Q) → "Set Menu Pack 5:8.pdf" (4 Aug 16:50, id:x4KPThkyLiAAAAAAAAD78g) → this one (5 Aug 07:20) — and the only one with N markers, the whole-table line and the "one drink at a time" clause (discovery/05 §4.3). The filename says "review"; none of the three is on the website, whose functions PDF carries only the summary tiers. Medium confidence: approval status is unknown (plan §5.1).
- Heading "Set menu packages".
- Sections by type: 3 × Set menus / packages (name, price pp, note), 14 × List (names only, no prices), 2 × Standard (name, tags, price, description), 2 × Text (intro, callout, conditions).
- Validation: 0 error(s), 0 warning(s).
- Review before publishing:
  - Approval: the source is a draft named "review"; confirm the tiers (Grazing 49 / Feasting 79 / Bottomless 99) and their courses before publishing. The 4 Aug draft called the 79 tier "Trust the chef" and gave Bottomless a short-rib-and-sides menu.
  - Cover: the source has no cover or document title (each page is headed "ALMA AVALON · ST ALMA" and a tier name). The menu name "Set menu packages" is used as the printed heading; the template adds the group mark, its tagline and a generated contents line ("GRAZING 2 · FEASTING 3 · BOTTOMLESS 4").
  - Course sections are LIST type (names only), so the garnish lines stored in each item's description ("corn chips, salsa macha, tostadas") do not print on the functions template today; switch a section to STANDARD to print them (prices are blank, so each row then warns STANDARD_NO_PRICE).
  - Dietary codes: only N is printed on the source; the footer's legend lists N · DF · GF · V · VG but the generated legend shows the codes in use (N). Kingfish ceviche, barramundi and snapper carry no A/I origin on the source, so isSeafood is left false rather than invent an origin tag.
  - On arrival: the source prints a sentence ("Start the table with a cocktail or margarita +$12 pp. Prosecco +$10 pp, or Champagne +$20 pp."); it is carried as three priced rows, the "+" is not printed by the template, and the Grazing page keeps "Start the table with" as the lead-in.
  - Bottomless page: "LUNCH ONLY, 12PM TO 4PM · UP TO 19 GUESTS" prints as an italic text line rather than a caps label; the two-hour clause and the drinks inclusions print as a text block under "Bottomless, for two hours".
  - Bottomless drinks differ by document (A5 cards vs this pack vs the functions menu — discovery/05 §4.10); this pack says Classic and jalapeño margaritas, Prosecco, Corona, house Riesling and Pinot Noir.
  - The footer's group terms (groups of 8 or more, no split bills) are in conditions; the surcharge sentence is inside the same line, so surchargeLine is empty.

## Promotions (What's On)

| Venue · promotion | Listing | Card | Photo | Confidence |
|---|---|---|---|---|
| alma-avalon · **Happy hour** (`happy-hour`) | Wed–Sun · Wed–Thu · 5–6pm · Fri–Sun · 4–6pm · Walk-in | `happy-hour` | images/alma-avalon-margarita-pour.jpeg | medium |
| alma-avalon · **Bottomless lunch** (`bottomless-lunch`) | Sat–Sun · Sat & Sun · 12–4pm | `bottomless` | images/alma-avalon-table-drinks.jpeg | high |
| alma-avalon · **Taco Wednesday** (`taco-wednesday`) | Wed · Every Wednesday · all night · $5 tacos | — | images/most-ordered-sashimi-taco.jpg | medium |
| st-alma · **Taco Tuesday** (`taco-tuesday`) | Tue · Every Tuesday · from 5pm · $5 tacos | — | images/taco-tuesday.jpg | medium |
| st-alma · **Bottomless lunch** (`bottomless-lunch`) | Fri–Sun · Fri–Sun · 12–4pm | `bottomless` | images/st-alma-cocktails-bar.jpeg | high |

### alma-avalon · Happy hour

- Listing copy: "Early drinks, snacks and Avalon afternoons that roll into dinner."
- Weekdays 0, 3, 4, 5, 6 (0 = Sunday), start 17:00; booking button: Reserve (OpenTable).
- Price and conditions come from the card "happy-hour" when linked.
- Review before publishing:
  - The website says Wed–Sun; the A5 card says Tue–Thu / Fri–Sun; the recurring strip says Wed–Thu 5–6 and Fri–Sun 4–6. Confirm the hours before publishing.

### alma-avalon · Bottomless lunch

- Listing copy: "A shared feast for the table, guacamole and corn chips, a shared starter, then a shared main with a side, alongside bottomless margaritas. Dishes move with the season."
- Weekdays 0, 6 (0 = Sunday), start 12:00; booking button: Reserve (OpenTable).
- Price and conditions come from the card "bottomless" when linked.
- Review before publishing:
  - The website copy ends "$99 pp"; the price now comes from the promotion, so the sentence was dropped from the summary.

### alma-avalon · Taco Wednesday

- Listing copy: "$5 tacos and $15 margaritas all night long, every Wednesday at Alma Avalon."
- Weekdays 3 (0 = Sunday), start 17:00; booking button: Reserve (OpenTable).
- Price and conditions come from the card "—" when linked.
- Review before publishing:
  - No printed card exists for Taco Wednesday in the design folder; the listing has no PDF until one is made.

### st-alma · Taco Tuesday

- Listing copy: "$5 tacos and midweek margaritas every Tuesday night at St Alma."
- Weekdays 2 (0 = Sunday), start 17:00; booking button: Reserve (OpenTable).
- Price and conditions come from the card "—" when linked.
- Review before publishing:
  - The Tuesday menu is imported as a FOOD menu (the A4 sheet "Tuesday"), not as a card, so this listing links no PDF. Decide whether Tuesday should print as the A4 sheet or an A5 card.

### st-alma · Bottomless lunch

- Listing copy: "A shared feast for the table, guacamole and corn chips, a shared starter, then a shared main with a side, alongside bottomless margaritas. Dishes move with the season."
- Weekdays 0, 5, 6 (0 = Sunday), start 12:00; booking button: Reserve (OpenTable).
- Price and conditions come from the card "bottomless" when linked.
- Review before publishing:
  - The website serves the 8 Nov 2025 card; the imported card is the 15 Nov 2025 one from the design folder (two lines differ).

