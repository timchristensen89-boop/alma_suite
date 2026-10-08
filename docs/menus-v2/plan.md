# Alma Menus V2 — inventory, data model and build sequence

Status: working plan, written 8 Oct 2026 against PR #313 head `6721375` (branch `claude/new-session-zqxw48`). V2 is built on that branch in `claude/menus-v2-zqxw48`. Nothing here is deployed; nothing imported is published.

The five discovery reports this plan is drawn from are in `docs/menus-v2/discovery/` (suite code map, suite website/asset/permission map, website menus and What's On, print design system, reference-PDF inventory). Every claim below has a file:line reference there.

## 1. What exists and works today

**Merged on `main` (`75aecfb`), live in production at `9e6cf15`:** the Menu Editor — one printed A4 à la carte per venue as data (`Menu → MenuVersion → MenuSection → MenuItem`), the editor with live A4 preview, publish to a Chrome-rendered PDF stored in Postgres, history, restore, audit, dietary-tag rules, Menu Costing hooks.

**On PR #313 (`6721375`, draft, CI green, not merged):** several menus per venue, printed heading, rename, archive/unarchive, per-menu row locks so archive cannot race a write, stale editors go read-only, unsaved-edit recovery kept until the server confirms the save, change detection on every stored field. V2 depends on all of it and is stacked on that branch.

**Not in the suite today (gaps V2 fills):**
- no menu kind, page size other than A4, or multi-page documents; the publish gate rejects `pageCount !== 1`; the sheet is hard-coded to 210×297 mm;
- no drinks, functions, happy-hour, bottomless, specials or private-event template; no cents in prices; dietary rules assume food;
- no public (unauthenticated) endpoint for a published menu or its PDF; the website links hand-copied PDFs under `apps/web/public/menus/` and renders in-page menus from a hand-edited `apps/web/data/menus.ts`;
- no promotion / What's On model anywhere — the website's `apps/web/data/whats-on.ts` is a static TypeScript file with non-unique ids, free-text prices and no menu link;
- no image storage fit for promotion photos (the house pattern is bytes-in-Postgres: `HandbookDocument`, `GiftCardArtwork`, `MenuVersion.pdfData`);
- no event metadata, hidden prices or private/public visibility on a menu.

**Website (`alma-web-platform`, Next.js on Vercel, manual CLI deploys):** `/menu/[venue]` renders food + drinks from `data/menus.ts` and links `/menus/<venue>-menu.pdf` and `-drinks.pdf`; `/catering` links `/menus/alma-functions-menu.pdf`; `/whats-on` renders `data/whats-on.ts` (5 events: Avalon happy hour, Avalon bottomless, Taco Wednesday, Taco Tuesday, St Alma bottomless) with OpenTable deep links. Two bottomless A5 PDFs sit unlinked in `public/menus/`. The suite's older `website-menu.service.ts` (commits `menus.ts` to GitHub) has no caller and would delete the website's dietary codes if run; it is left alone and superseded.

## 2. Reference inventory (Dropbox `/Family Room/Indesign`)

Full table with file ids, dates, duplicates and extracted content: `discovery/05-reference-pdf-inventory.md`. Summary of the ten named references and what V2 does with each:

| # | File | What it is | Confidence | V2 use |
|---|---|---|---|---|
| 1 | Set Menu Pack review.pdf (5 Aug) | Group set menus Grazing 49 / Feasting 79 / Bottomless 99 with courses, add-ons, terms | medium — newest of three drafts in 21 h, named "review" | import as **draft** FUNCTIONS content (packages), source + confidence recorded |
| 2 | Alma Group Set Menu Packages.pdf (4 Aug) | earlier draft of #1 | low | not imported; listed as superseded |
| 3 | Package menu creation25:7.pdf | the live functions menu, byte-identical to the website's `alma-functions-menu.pdf`; A4, 5 pp | high | import as **draft** FUNCTIONS menu (group-branded, multi-page A4) |
| 4 | Alma Functions Menu 15:7.pdf | predecessor of #3 | low | not imported |
| 5, 6 | St Alma / Alma — On Agave.pdf | drinks insert; text not extractable, download blocked by network policy | medium | content taken from the current drinks binders' ON AGAVE pages instead; flagged for owner check |
| 7 | St Alma — Food Tuesday 13:7.pdf | Taco Tuesday variant of the St Alma à la carte (tacos 5 each, items hidden, "Try them all 20") | high as the Tuesday card; prices one bump behind the Sep menu | import as **draft** FOOD menu "Tuesday" on the existing A4 template |
| 8 | ALMA_MENU A5 LUNCH SPECIAL 16:1.pdf | Avalon lunch special 49 pp (margarita choice, starter, shared mains/sides, add-ons) | high for content; the .indd changed after this export | import as **draft** PROMOTION menu "Lunch special" (A5) |
| 9 | ALMA_MENU HAPPY HOUR 16:8.pdf | Avalon happy hour: Tue–Thu 5–6, Fri–Sun 4–6; margaritas 12, beer 8, wine 8 | medium — hours conflict with two other sources | import as **draft** PROMOTION menu "Happy hour" (A5); hours left for the owner to confirm |
| 10 | ALMA_MENU BOTTOMLESS 18.10.25.pdf | Avalon bottomless 99 pp A5, byte-identical to the website copy | high | import as **draft** PROMOTION menu "Bottomless" (A5); St Alma's from the 15 Nov 2025 card, flagged (website serves 8 Nov) |

Also used: the current Sep-2026 food and drinks SCREEN PDFs (byte-identical to the website's live PDFs) as the drinks import source and the design reference. Nothing from the references is published by the import; every imported menu is a draft with an audit row naming the source file, its Dropbox id and content hash, and the confidence.

## 3. Data model

Principle: one document model for every kind of menu (sections of items), extended additively; **templates** (code) own layout per kind and page size; **promotions** are a separate record that links to a menu. Existing rows, snapshots and tests keep working because every new field defaults.

### 3.1 `Menu` (additive columns, one migration)

| field | type | notes |
|---|---|---|
| `kind` | String, default `FOOD` | `FOOD` · `DRINKS` · `FUNCTIONS` · `PROMOTION` · `PRIVATE_EVENT`. Plain string like `status`, so no enum migration later. |
| `slug` | String | **immutable public identifier**, unique per venue (`@@unique([venueId, slug])`). Minted from the name at creation (`food`, `drinks`, `functions`, `happy-hour`, `bottomless`, `smith-wedding-14-nov`); rename never changes it. Backfilled for the two existing menus as `food`. |
| `visibility` | String, default `PUBLIC` | `PUBLIC` menus can be served by the public endpoints; `PRIVATE` never. Private-event menus default to `PRIVATE`; publishing them publicly is an explicit toggle. |
| `eventName` `eventDate` `organiserRef` `guestCount` | String? / DateTime? / String? / Int? | private-event metadata, internal only, never printed or served publicly. |
| `promotionId` | String? | back-reference convenience; the authoritative link lives on `Promotion.menuId`. |

### 3.2 `MenuVersion` (additive)

| field | notes |
|---|---|
| `subheading String ""` | italic line under the title ("Lunch that runs long.") |
| `whenLine String ""` | schedule line on cards ("Wed–Thu · 5–6pm · Fri–Sun · 4–6pm") |
| `heroPriceCents Int?`, `heroPriceUnit String?` | the headline price ("99 pp") |
| `conditions String ""` | multi-line conditions block (sitting time, whole table, surcharge) — replaces nothing; `surchargeLine` stays for the A4 sheet |
| `showPrices Boolean true` | hides every item price (guest-facing private-event menus) |
| `pageCount Int 1` | pages the document declares; the publish gate compares the rendered PDF to it |

`snapshotJson.schemaVersion` becomes 2; `snapshotDocument` backfills every new field so v1 snapshots restore cleanly.

### 3.3 `MenuSection` (additive)

| field | notes |
|---|---|
| `page Int 1` | which sheet the section prints on (explicit page breaks the staff control; the preview shows each page) |
| `sectionType` new values | existing `STANDARD`, `HEADER_PRICED`, `SET_MENUS` plus `TEXT` (prose block: intro, callout, conditions, essay), `LIST` (names only, no prices — inclusions, "Select from"), `TABLE` (items with several price columns — wine 150 mL / 250 mL / bottle), `COURSE` (private-event course: label, optional "choose one", items) |
| `priceColumns String[]` | column labels for `TABLE` sections |
| `lead String?` | small caps lead-in above the items ("Two per person", "Select from") |

### 3.4 `MenuItem` (additive)

| field | notes |
|---|---|
| `priceCents` | unchanged, but cents are now allowed to print (`12.50`); whole dollars stay the default |
| `prices Int[]` | per-column prices for `TABLE` sections, aligned with `priceColumns`; `-1`/null = not poured ("·") |
| `meta String?` | small grey detail after the name: ABV, region, vintage, village, "serves three" |
| `note String?` | serving note under the description (9 px line on drinks) |
| `flags String[]` | non-dietary marks: `STAFF_PICK`, `LIMITED`, `ON_TAP`, `NEW` — one meaning per mark, legend generated |

Dietary `tags`/`isSeafood` stay; the validator applies the seafood and GF rules only to food-type kinds.

### 3.5 `Promotion` (new) and `PromotionPublication` (new)

`Promotion`: `id`, `venueId`, `slug` (immutable; seeded with the website's event ids `happy-hour-avalon`, `bottomless-lunch-avalon`, `taco-wednesday`, `taco-tuesday`, `bottomless-lunch-st-alma`), `name` (internal), `publicTitle`, `summary`, `description`, `imageId → PromotionImage`, `dayLabel`, `timeLabel`, `validDays Int[]`, `startTime`, `startsOn DateTime?`, `endsOn DateTime?`, `recurring Boolean`, `priceLabel`, `priceCents?`, `priceUnit?`, `inclusions`, `conditions`, `bookLabel`, `bookDestination` (`OPENTABLE` | `URL` | `NONE`), `bookUrl?`, `menuId? → Menu`, `status` (`DRAFT` · `PUBLISHED` · `ENDED` · `HIDDEN`), `sortOrder`, `updatedAt` (optimistic lock), audit via `MenuAuditEvent` (`promotionId` column added).

`PromotionImage`: bytes-in-Postgres like `HandbookDocument` (`mimeType`, `sizeBytes`, `data`, `width`, `height`, `fingerprint`), ≤ 4 MB via data-URL JSON (the 6 MB body limit), served publicly at an immutable fingerprinted URL.

`PromotionPublication`: one row per publish — `promotionId`, `snapshotJson` (the public What's On item exactly as served), `menuVersionId?` (the PDF that was live at that publish), `publishedAt`, `publishedBy`. The public endpoint serves the **latest publication**, never the draft. "Publish promotion" runs the linked menu's publish first (PDF rendered outside the transaction, then locked and committed) and writes the publication row in the same transaction; if any step fails the previous publication and PDF remain exactly as they were, and the editor reports the failure. One authoritative record: price, dates, description and inclusions live only on `Promotion`; the A5 card reads its `heroPrice`, `whenLine` and `conditions` from the promotion when linked (editable in one place, previewed on both the card and the listing).

### 3.6 Templates (code, `packages/shared/src/menu-render.ts`)

`MenuTemplate` gains `kind`, `format` (`A4` 210×297 · `A5P` 148×210 · `A5L` 210×148), `sheetClass`, `multiPage`, `cover`, `anyVenue` (group-branded documents usable by either venue), `features` (what the editor exposes: columns, pages, tables, hero price, conditions). Families:

| key | kind | format | venue | notes |
|---|---|---|---|---|
| `freshwater_alacarte`, `avalon_alacarte` | FOOD | A4 | each | unchanged output |
| `freshwater_drinks_binder` | DRINKS | A5L, multi-page, cover with contents | st-alma | ported from `st-alma-drinks/binder.css` |
| `avalon_drinks_book` | DRINKS | A5P, multi-page, cover | alma-avalon | ported from `alma-avalon-drinks/avalon.css` |
| `group_functions_a4` | FUNCTIONS | A4, multi-page, cover | any (group marks, both addresses) | ported from the live functions PDF's structure |
| `freshwater_card_a5`, `avalon_card_a5` | PROMOTION, PRIVATE_EVENT | A5P (1–2 pages) | each | **the redesigned A5 family** — one CSS block, venue mark + eyebrow, title/subtitle/hero-price lockup, when-line, section grammar, conditions footer; variants by section types, not by template |

A5 redesign rules (from `discovery/04-print-design-system.md` §4–5): single forest ink `#1d2916` on white, Avenir names/heads + Cormorant italic descriptions; margins 12/13/11 mm; one column by default; item names ≥ 12 px, descriptions ≥ 13 px italic, conditions 9–9.5 px at ≥ 52 % ink, nothing under 8 px; masthead logo 12 mm (Avalon) / 9.5 mm (St Alma); hairline-flanked caps section heads at `.3em`; the arch ornament as the only decoration; hero price lockup and a conditions block are new tokens. The legacy A5 flourishes (lowercase codes, "√", fish, script sign-off, merchant-fee line) are retired unless the owner says otherwise.

### 3.7 Public read API (new, unauthenticated, rate-limited, published snapshots only)

- `GET /api/public/menus/:venueSlug` → published PUBLIC menus (kind, slug, name, heading, pdf url, publishedAt)
- `GET /api/public/menus/:venueSlug/:menuSlug.json` → the published snapshot (sections/items/tags) for in-page rendering
- `GET /api/public/menus/:venueSlug/:menuSlug.pdf` → the live PDF (`Cache-Control: public, max-age=300`, ETag = version id); `GET /api/public/menu-pdf/:versionId/:fingerprint.pdf` immutable
- `GET /api/public/whats-on` and `/api/public/whats-on/:venueSlug` → latest publications, ordered; `GET /api/public/promotion-images/:fingerprint`

The website (separate draft PR in `alma-web-platform`) reads these with ISR + an on-publish revalidate call, keeps today's committed data as the fallback when the API is unreachable, and keeps the old PDF filenames as redirects. After that one website change, staff publish menus and promotions without touching website code.

### 3.8 Organisation (phase 4)

Home: venue → kind groups, filters (kind, status, active/past promotions, upcoming/past events), search by name/heading/event, duplicate (`copyFromMenuId` exists), archive. Names stay unique per venue (case-insensitive); the card shows kind, format, printed heading, event date, promotion status, so two "Food" cards cannot be mistaken.

## 4. Implementation sequence

1. **Regular website menus** — migration (kinds, slugs, visibility, version/section/item fields), snapshot v2, template `kind/format/multiPage`, A5/A4 geometry from the template, per-page fill probe and publish gate, section types `TEXT`/`LIST`/`TABLE`, cents, kind-scoped validation, drinks and functions templates, editor support (pages, tables, meta/note/flags), public endpoints, website PR. Tests: rules, integration, e2e for publish → public URL.
2. **A5 family + promotions + What's On** — redesigned `*_card_a5` templates and previews (happy hour, bottomless, special, private-event set menu), `Promotion`/`PromotionImage`/`PromotionPublication`, promotion editor in Menus (card preview + listing preview side by side), publish-together semantics, public What's On endpoint, website What's On reads it.
3. **Private events** — kind `PRIVATE_EVENT`, event fields, `COURSE` sections with choices, `showPrices`, event wording, start from template / duplicate / blank, revisions, archive after event, privacy by default.
4. **Organisation, import, verification** — home filters/search, importer (`apps/api/scripts/import-menus-v2.ts`, idempotent on `(venueSlug, slug)`, drafts only, audit with source/hash/confidence), e2e scenarios from the brief, PDF visual pass (A4 + A5, long content, page breaks), desktop/phone check, rollout/rollback runbook, PR body with previews.

Safeguards carried to every new flow: per-menu row locks and archived checks (all writes go through `lockActiveMenu`), `updatedAt` conditional writes, edit-sequence autosave and recovery store (the editor's document grows fields; the store is schema-agnostic), one draft per menu, versions never rewritten.

## 5. Open business decisions (defaults applied until answered)

1. **Set-menu content**: is `Set Menu Pack review.pdf` (5 Aug: Grazing 49 / Feasting 79 / Bottomless 99) approved? Default: imported as a draft, not published.
2. **Happy hour hours** per venue: sources say Tue–Thu 5–6 / Fri–Sun 4–6 (A5 card, Jun What's On), Tue–Fri 5–6 / Sat–Sun 4–6 (Jan 2026 page), Wed–Sun (website today). Default: the website's current text, marked "confirm" in the draft.
3. **Bottomless** availability and drink inclusions differ across the A5 cards, the set-menu pack and the functions menu. Default: the website's What's On text for days/times; the A5 cards' inclusions per venue, as drafts.
4. **A5 look**: single forest ink on white (default) or the brand terracotta accent; St Alma cards portrait (default) or landscape to match its binder; group wordmark on functions and private-event menus (default: group mark on functions, venue mark on private events).
5. **Price notation** on cards: "99 pp" like the A4 sheets (default) or "$99 pp" like the functions PDF.
6. **Website integration**: website reads the suite's public API with ISR and static fallback (default). Needs one website deploy. Alternative is committing files to GitHub, which still needs a manual deploy and has already drifted.
7. **Who publishes**: today's publisher set (managers, head chef, `menusPublish` grant) for every kind including promotions (default).
8. **Taco Tuesday**: separate menu (default, simplest for staff) or a derived variant of the à la carte.
