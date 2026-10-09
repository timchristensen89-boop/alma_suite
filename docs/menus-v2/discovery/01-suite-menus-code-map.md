# Alma Menus — technical map of the existing system (foundation for Menus V2)

Repository: `/home/user/alma_suite`, branch `claude/new-session-zqxw48`, head `6721375` (PR #313). Website: `/home/user/alma-web-platform` (Next.js, `apps/web`). Everything below was read from those checkouts; nothing was modified.

Module shape in one paragraph: a `Menu` is one printed sheet for one venue, locked to a `templateKey` resolved in `packages/shared/src/menu-render.ts`. Its content lives in `MenuVersion` rows (one DRAFT, one PUBLISHED, rest ARCHIVED). Drafts are live `MenuSection`/`MenuItem` rows; publishing freezes the document into `MenuVersion.snapshotJson` and stores a Chrome-rendered A4 PDF in `MenuVersion.pdfData`. The same pure renderer (`renderMenuHtml`) draws the editor's iframe preview and the server PDF. The API is `apps/api/src/routes/menus.ts` + `apps/api/src/services/menu.service.ts`; the frontend is `apps/menus-web` (Vite + React, port 5181, Firebase site `alma-menus`).

---

## 1) Data model — every field

Source: `packages/db/prisma/schema.prisma`. Module header comment at lines 6262–6278 ("Menu Editor — the printed food menus as data"). Migrations: `packages/db/prisma/migrations/20261007191211_menu_editor/migration.sql` (162 lines: 3 enums, `ALTER TYPE "AlmaAppId" ADD VALUE 'MENUS'` at line 23, 5 tables, 9 indexes, 5 FKs) and `20261008093000_menu_heading/migration.sql` (3 lines: `ALTER TABLE "MenuVersion" ADD COLUMN "heading" TEXT NOT NULL DEFAULT ''`). These are the two newest migrations in the directory.

### Enums
- `MenuVersionState` (6280–6284): `DRAFT | PUBLISHED | ARCHIVED`.
- `MenuSectionType` (6291–6295, doc 6286–6290): `STANDARD` (name · tags · price, description beneath), `HEADER_PRICED` (price in the heading "TACOS / 9 EACH"; items are names and tags only), `SET_MENUS` ("Trust our chef" packages — name, price with unit "pp", description; band or boxed panel by placement).
- `MenuPlacement` (6298–6302): `LEFT | RIGHT | FULL` (which column of the sheet; FULL spans the page).
- `AlmaAppId` (172–183) includes `MENUS` (182) — app-access grant id.

### `model Venue` (4265–4274, `@domain: shared`)
| field | type | default/notes |
|---|---|---|
| id | String @id | cuid() |
| name | String @unique | |
| slug | String @unique | `st-alma`, `alma-avalon` (created by `pnpm db:seed:prod`) |
| address | String? | |
| lga | String? | |
| createdAt | DateTime | now() |
| updatedAt | DateTime | @updatedAt |
| menus | Menu[] | relation |

### `model Menu` (6305–6326)
| field | type | default/notes |
|---|---|---|
| id | String @id | cuid() |
| venueId | String | FK → Venue, `onDelete: Restrict` |
| name | String | "Food", "Tuesday"; unique with venueId |
| templateKey | String | plain string, not an enum; resolved by shared `MENU_TEMPLATES` |
| status | String | `"ACTIVE"`; service writes `"ARCHIVED"`; not a Postgres enum |
| versionCounter | Int | 0; bumped inside the version-creating transaction, never reused |
| createdAt / updatedAt | DateTime | now() / @updatedAt |
| versions | MenuVersion[] | |
| auditEvents | MenuAuditEvent[] | |
Constraints: `@@unique([venueId, name])` (case-sensitive at DB level), `@@index([venueId])`.

### `model MenuVersion` (6328–6366)
| field | type | default/notes |
|---|---|---|
| id | String @id | cuid() |
| menuId | String | FK → Menu, `onDelete: Cascade` |
| versionNumber | Int | unique with menuId |
| state | MenuVersionState | DRAFT |
| heading | String | `""` (added by 20261008093000); empty = template's own title |
| dietaryNote | String | `""` footer line |
| surchargeLine | String | `""` footer line |
| snapshotJson | Json? | `MenuSnapshot` frozen at publish; NULL while draft |
| pdfData | Bytes? | the rendered PDF (bytes-in-Postgres house pattern) |
| pdfByteSize | Int? | |
| pdfGeneratedAt | DateTime? | |
| publishedAt | DateTime? | |
| publishedById / publishedByName | String? | |
| restoredFromVersionId | String? | set when draft came from restore |
| createdById / createdByName | String? | |
| updatedById / updatedByName | String? | "last edited by" |
| createdAt / updatedAt | DateTime | now() / @updatedAt — `updatedAt` is the optimistic-lock token |
| sections | MenuSection[] | |
Constraints: `@@unique([menuId, versionNumber])`, `@@index([menuId, state])`.

### `model MenuSection` (6368–6388)
| field | type | default/notes |
|---|---|---|
| id | String @id | cuid() |
| menuVersionId | String | FK → MenuVersion, Cascade |
| title | String | |
| headerSuffix | String? | rendered " / 9 EACH" |
| subheading | String? | italic line under heading (set menus) |
| sectionType | MenuSectionType | STANDARD |
| placement | MenuPlacement | LEFT |
| sortOrder | Int | 0 |
| visible | Boolean | true (hidden stays in data, drops off print) |
| createdAt / updatedAt | DateTime | |
| items | MenuItem[] | |
Index: `@@index([menuVersionId, sortOrder])`.

### `model MenuItem` (6390–6429)
| field | type | default/notes |
|---|---|---|
| id | String @id | cuid() |
| sectionId | String | FK → MenuSection, Cascade |
| dishKey | String | stable identity across versions; unique within a version only (validator), not DB-enforced |
| name | String | |
| description | String? | |
| priceCents | Int? | whole dollars on print; NULL allowed (header-priced) |
| priceUnit | String? | "pp" on set menus |
| tags | String[] | `[]`; codes from `MENU_TAGS` |
| isSeafood | Boolean | false; validator demands A or I |
| sortOrder | Int | 0 |
| visible | Boolean | true (false = 86'd) |
| recipeId | String? | soft reference to Recipe (stock domain), no FK, for Menu Costing |
| createdAt / updatedAt | DateTime | |
Indexes: `[sectionId, sortOrder]`, `[dishKey]`, `[recipeId]`.

### `model MenuAuditEvent` (6431–6447)
| field | type | notes |
|---|---|---|
| id | String @id | cuid() |
| menuId | String? | FK → Menu, `onDelete: SetNull` |
| menuVersionId | String? | no FK |
| action | String | `menu.created`, `draft.created`, `menu.renamed`, `menu.archived`, `menu.unarchived`, `draft.saved`, `draft.discarded`, `published`, `restored`, `item.copied` (service) |
| summary | String | human line |
| before / after | Json? | diff summary, not whole documents |
| actorId / actorName / actorEmail | String? | |
| createdAt | DateTime | now() |
Indexes: `[menuId, createdAt]`, `[menuVersionId, createdAt]`.

### Shared document shape (`packages/shared/src/menus.ts`)
- `MENU_TAGS` (19–28): fixed print-ordered list `V, VG, GF, GFA, DF, N, A (australian), I (imported)`; `sortMenuTags` (41) de-dupes/uppercases/drops unknown; `formatMenuTags` (51) joins with " · "; `menuTagLegend` (59) builds the footer legend from visible items only.
- `MenuItemDocument` (98–113): `id?`, `dishKey?`, `name`, `description|null`, `priceCents|null`, `priceUnit|null`, `tags: MenuTagCode[]`, `isSeafood`, `visible`, `recipeId|null`.
- `MenuSectionDocument` (115–126): `id?`, `title`, `headerSuffix|null`, `subheading|null`, `sectionType`, `placement`, `visible`, `items[]`.
- `MenuDocument` (128–139): `heading`, `dietaryNote`, `surchargeLine`, `sections[]`.
- `MenuSnapshot` (141–151) = `MenuDocument & { schemaVersion: 1; menuId; menuName; templateKey; venue{id,name,slug}; versionNumber; publishedAt|null }`.
- `MENU_LIMITS` (155–172): nameMax 160, descriptionMax 400, titleMax 80, headerSuffixMax 40, subheadingMax 120, footerLineMax 240, headingMax 60, menuNameMax 60, priceUnitMax 8, priceCentsMax 99_999_900, sectionsMax 40, itemsPerSectionMax 60.
- Zod input schemas: `menuItemDocumentSchema` (186), `menuSectionDocumentSchema` (199), `menuDocumentSchema` (210; all fields default so an old editor's payload still parses), `menuDraftSaveInputSchema` (218; adds `expectedUpdatedAt?`), `menuPublishInputSchema` (229; `expectedUpdatedAt?`, `acknowledgeWarnings` default false), `menuRestoreInputSchema` (237; `replaceDraft` default false), `menuCopyItemInputSchema` (244; `dishKey`, `targetMenuId`, `targetSectionId?`), `menuCreateInputSchema` (253; `venueId`, `name` 1–60, `templateKey?`, `copyFromMenuId?`, `heading` default ""), `menuUpdateInputSchema` (266; `name`).
- Prices: `formatMenuPrice` (276) rounds cents to whole dollars and appends unit ("49 pp"); `parseMenuPriceInput` (283) accepts `^\d{1,6}$` only — decimals are rejected (returns `undefined`).
- Validation (`validateMenuDocument`, 325–397): codes `GF_AND_GFA`, `A_AND_I`, `SEAFOOD_NO_ORIGIN`, `SET_MENU_NO_PRICE`, `EMPTY_NAME`, `EMPTY_SECTION_TITLE` (error if visible, warning if hidden), `DUPLICATE_DISH_KEY` (always), `NOTHING_TO_PRINT` (errors); `VG_AND_V`, `STANDARD_NO_PRICE` (warnings). Rules other than duplicate keys only apply to printed (visible) items. `OVERFLOW` comes from `overflowIssue` (438–446), message hard-codes "one A4 page".
- Fill probe `MENU_FILL_PROBE_SCRIPT` (423–436): selects `.food-print-page .sheet`, sets height auto, measures natural vs fixed height; `overflow = natural > fixed + 0.5`.
- Diff (`diffMenuDocuments`, 493–607): by dishKey; sections matched by id, then title, then shared dishes; outputs added/removed/priceChanges/tagChanges/renamed/descriptionChanges/visibilityChanges/moved/sectionChanges[]/footerChanges[]/headingChange. `menuDocumentsEqual` (609–636) is the "did anything stored change" comparison (ignores row ids, includes isSeafood/recipeId/priceUnit). `menuDiffIsEmpty` (638), `summariseMenuDiff` (655).
- Dish keys: `dishKeySlug` (685), `newDishKey` (695; slug + 6-char suffix), `ensureDishKeys` (704).
- Payload types (718–803): `MenuActor`, `MenuVersionSummary`, `MENU_STATUSES` `['ACTIVE','ARCHIVED']`, `MenuSummary` (id, name, templateKey, status, printedHeading, venue, published, draft, lastEdited), `MenuVenueSummary` (id, name, slug, templates[{key,label,title}]), `MenuListPayload` ({menus, archived, venues, renderer}), `MenuDraftPayload` ({menu, version, document, publishedDocument, publishedVersion}), `MenuVersionPayload` ({menu, version, snapshot}), `MenuPublishPreview` ({validation, fill|null, renderer, diff, summary, canPublish}), `MenuAuditEntry`.
- `canPublishMenus` (805–824): true for isAdmin / role ADMIN or MANAGER / roleTitle containing "head chef" / MENUS grant at MANAGER|ADMIN / MENUS USER grant with `permissions.menusPublish === true`; false for `VENUE_DEVICE`.
- Exported from `packages/shared/src/index.ts` lines 46–47 (`export * from './menus.js'` and `'./menu-render.js'`).

Seed content (`apps/api/src/data/menu-seed-content.ts`): `MenuSeed { venueSlug, venueName, menuName: 'Food', templateKey, document }`; helpers `dish(prefix, spec)` (dishKey = `${prefix}-${slug}`, e.g. `fw-…`, `av-…`) and `section(...)`; `trustOurChef(prefix, 'FULL'|'RIGHT')`; `ST_ALMA_FRESHWATER_SEED` (5 sections: To start L, Tacos L HEADER_PRICED "9 each", From the grill R, Sides R, Sweet FULL, + Trust our chef FULL), `ALMA_AVALON_SEED` (To start L, Tacos L, To share L, Sides R, Sweet R, Trust our chef RIGHT boxed), `MENU_SEEDS` (line 217). Avalon has 21 items (asserted in tests).

---

## 2) Service methods and guards (`apps/api/src/services/menu.service.ts`, 1064 lines)

Invariants (header 44–63): one DRAFT and one PUBLISHED per menu at most; published/archived versions never rewritten; restore creates a new draft; every change writes an audit row; dishKey stable; archived menu never written — every write locks the Menu row and re-checks status in its own transaction; two menus always locked in id order.

Helpers:
- `VERSION_SUMMARY_SELECT` (68–83), `MENU_SELECT` (85–91; id, name, templateKey, status, venue{id,name,slug}).
- `menuActor` (97), `versionSummary` (111; `hasPdf = pdfByteSize > 0`), `documentFromRows` (132; sorts by sortOrder, `sortMenuTags`), `stripIds` (166), `snapshotDocument` (178; tolerant: `heading ?? ''`), `documentFor` (185; DRAFT → rows, else snapshot ?? rows).
- `loadMenu` (190; 404 "That menu does not exist."), `archivedError` (200; **409 `{code:'MENU_ARCHIVED', menuId}`**, message "`<venue> · <name> is archived. Unarchive it from the Menus home before changing it.`"), `requireActive` (212; fast pre-check, not the guarantee).
- `lockMenus` (225–235): `SELECT "id","name","status","venueId" FROM "Menu" WHERE "id"=$1 FOR UPDATE`, one at a time in sorted id order. `lockActiveMenu` (237–241): lock + throw `archivedError` if ARCHIVED.
- `requireNameFree` (255–268): case-insensitive name clash per venue incl. archived → 409 `{code:'NAME_TAKEN', menuId, status}`; `isUniqueViolation` (270; Prisma P2002 backstop).
- `nextVersionNumber` (295–308): `versionCounter` increment inside tx; self-heals if a row is ahead of the counter.
- `writeDocumentRows` (310–340): **deleteMany sections then recreate** every section and item (new row ids each save; mints dishKey if absent).
- `audit` (342–359), `requireDraft` (361; 404), `checkUpdatedAt` (366–375; 409 `{code:'STALE_DRAFT', updatedAt, updatedBy}`), `buildSnapshot` (377–388; `schemaVersion: 1`), `renderAssetsOrThrow` (390; MenuAssetError → 503), `draftPayload` (399), `summaries` (410–439; orders venue name asc, createdAt asc, name asc; `printedHeading` from (published ?? draft).heading via `menuPrintedHeading`, tolerant of unknown templateKey; `lastEdited` = newest of draft.updatedAt / published.publishedAt).

Public `menuService` methods:
| method (line) | guards | effect |
|---|---|---|
| `list()` 444 | — | ACTIVE summaries |
| `listArchived()` 449 | — | ARCHIVED summaries |
| `venues()` 454 | — | every Venue + `menuTemplatesForVenue(slug)` → `{key,label,title}` |
| `home()` 463 | — | `{menus, archived, venues, renderer: rendererStatus()}` |
| `get(menuId)` 468 | 404 | summary (archived included) |
| `createMenu(input, user)` 482–562 | zod; venue 404; venue has no template → 409; templateKey required when venue has >1 → 400; template not venue's → 400; `requireNameFree`; copy source must have published or draft → 409 | tx: create Menu, audit `menu.created`, `nextVersionNumber`, create DRAFT with heading from input, `writeDocumentRows(ensureDishKeys(doc))` (recipeId dropped when source is another venue), audit `draft.created`; P2002 → 409 NAME_TAKEN |
| `updateMenu(menuId, input, user)` 564–592 | `requireActive`; zod; name free; tx `lockActiveMenu` + re-check | rename, audit `menu.renamed` |
| `archiveMenu` 594–618 | already archived → 409; tx `lockMenus` re-check | status ARCHIVED, audit notes kept draft |
| `unarchiveMenu` 620–641 | not archived → 409; tx lock | status ACTIVE |
| `getDraft` 643 | 404 if none | `MenuDraftPayload` |
| `createDraft` 650–687 | `requireActive`; tx `lockActiveMenu`; existing draft → 409 (checked after lock) | clone published snapshot (stripIds) or empty; audit `draft.created` |
| `saveDraft` 689–746 | `requireActive`; zod; `checkUpdatedAt`; **no-op if `!menuDocumentsEqual(before,next)` and no keys minted** (returns without write); tx `lockActiveMenu`; **conditional `updateMany` where `{id, state:'DRAFT', updatedAt: draft.updatedAt}` when `expectedUpdatedAt` sent → count≠1 → 409 STALE_DRAFT** | writes header fields, `writeDocumentRows`, audit `draft.saved` with diff as `after` |
| `discardDraft` 748–767 | `requireActive`; tx lock; `deleteMany` count≠1 → 409 | audit `draft.discarded` |
| `publishPreview` 769–792 | `requireActive`; requireDraft | `validateMenuDocument` + (if Chrome ok) `measureMenuFill(renderMenuHtml(...))` → `overflowIssue` pushed to errors; diff vs published; `canPublish = renderer.ok && no errors` |
| `publish` 794–878 | `requireActive`; zod; `checkUpdatedAt`; validation errors → 422 `{code:'VALIDATION', validation}`; warnings unacknowledged → 409 `{code:'WARNINGS'}`; render PDF **outside tx** via `renderMenuPdf(html, template.page)`; overflow or `pageCount !== 1` → 422 ("It must fit on one A4 page." line 826); tx: `lockActiveMenu`, live version must still be the one diffed → else 409 STALE_DRAFT; archive previous PUBLISHED; conditional `updateMany` flip DRAFT→PUBLISHED with snapshot/pdf (count≠1 → 409) | audit `published` with diff, fillRatio, renderMs, warnings; returns `getVersion(draft.id)` |
| `listVersions` 880 | 404 | summaries desc |
| `getVersion(versionId)` 886–894 | 404 | snapshot (backfills `heading ?? ''` for pre-heading snapshots; builds one on the fly for drafts) |
| `getVersionPdf` 896–906 | 404; draft → 404 "A draft has no PDF yet" | filename `${venue.slug}-${menu.name}-v${n}.pdf` slugified from the **current** name |
| `diffVersion(versionId, against)` 908–919 | 404 | against = `'draft'` \| `'published'` \| versionId |
| `restore(versionId, input, user)` 921–976 | 404; `requireActive(source.menu)`; source is DRAFT → 400; existing draft and !replaceDraft → 409 `{code:'DRAFT_EXISTS', draft}` (re-checked in tx) | tx lock; delete current draft (audit `draft.discarded`); create DRAFT with `restoredFromVersionId`; audit `restored` |
| `copyItemTo(menuId, input, user)` 978–1036 | source & target `requireActive`; same menu → 400; dish not in draft → 404; target draft auto-created via `createDraft`; target section by id → same title → first; none → 409; tx `lockMenus([source,target])` each refused separately; section still in DRAFT else 409 STALE_DRAFT | creates `MenuItem` with a **new** dishKey, `recipeId: null`; audit `item.copied` on target |
| `listAudit(menuId, limit=100)` 1038 | clamp 1..500 | |
| `rendererStatus()` 1054 | — | `chromeStatus()` then `loadMenuRenderAssets()` |

---

## 3) Routes and permissions

Mounted in `apps/api/src/server.ts`: `app.use(authMiddleware)` (135) runs first; `app.use('/api/menus', menusRouter)` (202); `app.use('/api/menu-mappings', menuMappingsRouter)` (201 — this is the **Square catalog → recipe mapping** router in `apps/api/src/routes/menu-mappings.ts`, unrelated to the printed menus; `requireManager`/`requireAdmin`); `app.use('/api/website', websiteRouter)` (218). Modules list at 155–156.

Auth middleware (`apps/api/src/lib/auth-middleware.ts`):
- `/api/menus` requires an ENABLED `MENUS` or `COMPLIANCE` grant (242–245; isAdmin bypasses, 17–21).
- `VENUE_DEVICE` accounts: any write outside `/api/device` → 403 (193–195). Read-only accounts (`permissions.readOnly` on every grant) cannot write (199–202).
- Non-managers may only write what `isStaffWriteAllowed` allows (≈73–130). Menu entries: `^/api/menus/[^/]+/draft(/preview|/publish|/items/copy-to)?$` (any method), `POST /api/menus/versions/:id/restore`, `POST /api/menus`, `PATCH /api/menus/:id`, `POST /api/menus/:id/(archive|unarchive)` — so a STAFF-role head chef reaches the route's own gate.
- Final manager gate at 263–265.

`apps/api/src/routes/menus.ts` (191 lines). `requireMenuPublisher` (25–31): 401 if no user, 403 unless `canPublishMenus(req.user)`.
| route | gate | response |
|---|---|---|
| `GET /` (33) | access only | `MenuListPayload` |
| `POST /` (41) | publisher | 201 `MenuSummary` |
| `GET /versions/:versionId` (50) | access | `MenuVersionPayload` |
| `GET /versions/:versionId/pdf` (58) | access | `application/pdf`, `Content-Disposition` inline or `attachment` when `?download=1`, `Cache-Control: private, max-age=0, must-revalidate` |
| `GET /versions/:versionId/diff?against=` (71) | access | `{from,to,diff,summary}`; default `draft` |
| `POST /versions/:versionId/restore` (80) | access | 201 `MenuDraftPayload` |
| `GET /:menuId` (88) | access | `MenuSummary` |
| `PATCH /:menuId` (96) | publisher | `MenuSummary` |
| `POST /:menuId/archive` (104), `/unarchive` (112) | publisher | `MenuSummary` |
| `GET /:menuId/draft` (120) | access | `MenuDraftPayload` |
| `POST /:menuId/draft` (128) | access | 201 draft |
| `PUT /:menuId/draft` (136) | access | draft |
| `DELETE /:menuId/draft` (144) | access | `{ok:true}` |
| `POST /:menuId/draft/preview` (152) | access | `MenuPublishPreview` |
| `POST /:menuId/draft/publish` (160) | publisher | 201 `MenuVersionPayload` |
| `POST /:menuId/draft/items/copy-to` (168) | access | 201 `{target, dishKey}` |
| `GET /:menuId/versions` (176) | access | `MenuVersionSummary[]` |
| `GET /:menuId/audit?limit=` (184) | access | `MenuAuditEntry[]` |

Error detail codes the frontend keys on: `MENU_ARCHIVED` (409), `STALE_DRAFT` (409), `NAME_TAKEN` (409), `WARNINGS` (409), `DRAFT_EXISTS` (409), `VALIDATION` (422), 503 when Chrome/assets missing.

No public (unauthenticated) menu route exists. `apps/api/src/lib/public-paths.ts` (`isPublic`) and `app.use('/api/public', publicSnapshotRouter)` exist for other modules — nothing for menus.

Permission presets: `apps/staff-web/src/App.tsx` 238 and 252 give Venue Manager and Head Chef `MENUS: {ENABLED, MANAGER, {menusPublish:true}}`; toggle label "Publish menus" at 338. `apps/api/src/services/admin.service.ts` 38 labels `MENUS: 'Menus'`.

Website publish (separate, older path): `apps/api/src/routes/website.ts` `POST /api/website/menu/validate` and `/menu/publish` (`requireManager`) → `apps/api/src/services/website-menu.service.ts` commits a regenerated `apps/web/data/menus.ts` to `alma-web-platform` via the GitHub Contents API (env `WEBSITE_MENU_*`, `apps/api/src/env.ts` 166–174). Input schema `websiteMenuUpdateInputSchema` (`packages/shared/src/index.ts` 2033–2063): venues[] with `sections[]`/`drinks[]` of `{name, price?: string, tag?: string}` and `setMenus[{title,price}]`. Note the generated TS type (service 85–105) has no `diet` field, while the website's live `apps/web/data/menus.ts` (lines 1–11) declares `diet?: string[]` — a publish from this path would overwrite that field and type.

---

## 4) Renderer (`packages/shared/src/menu-render.ts`, 410 lines) and PDF pipeline

### Template definition
`MenuTemplate` (33–47): `key`, `label`, `venueSlug`, `venueClass: 'stalma'|'avalon'`, `logo{asset: MenuLogoAssetKey, alt}`, `tagline`, `title`, `page{widthMm,heightMm}`. `MENU_TEMPLATE_KEYS` (28) = `['freshwater_alacarte','avalon_alacarte']`; `MenuLogoAssetKey` (31) = `'stalma-logo'|'avalon-logo'`. `MENU_TEMPLATES` (49–70): Freshwater → slug `st-alma`, class `stalma`, tagline "Restaurant & Bar · Freshwater", title "À la carte", 210×297; Avalon → slug `alma-avalon`, class `avalon`, tagline "Avalon Beach · Est 2017", title "À la carte", 210×297. Helpers: `isMenuTemplateKey` (72), `getMenuTemplate` (76, throws `Unknown menu template`), `menuTemplatesForVenue(slug)` (82), `menuPrintedHeading(doc, template)` (87). There is **no `kind`** on a template; the only discriminator is the key string.

### Page geometry (mm / px)
- `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0 }` emitted from the template (349).
- But the sheet itself is hard-coded in CSS: `.food-print-page .sheet{ width:210mm; height:297mm; padding:16mm 17mm 12mm; overflow:hidden; display:flex; flex-direction:column }` (121–127). `template.page` is read only by `@page`, Puppeteer (`menu-pdf.ts` 143–145) and the preview iframe size (`MenuPreview.tsx` 58–59). So the comment at line 45 ("a future A5 card is a template change, not a code change") does not hold today: an A5 template would print a 210×297 sheet into a 148×210 page.
- Markup emits `<section class="sheet a4">` (321) and root `<main class="food-print-page stock-{white|cream} venue-{class}[ chef-in-column]">` (320).
- Backdrop `#cdc6b8`, 12mm padding, drop shadow for screen; stripped under `@media print` (184–188).
- Masthead (130–138): logo 15mm (Avalon 19mm via `.venue-avalon .mast .logo`), eyebrow 8.5px / .32em letterspacing uppercase, 14mm hairline, title Cormorant italic 19px.
- Columns (141): `grid-template-columns:1fr 1fr; column-gap:12mm`. Section gap 7mm; `.sec-head` with hairlines each side, title 9.5px/.3em uppercase 700; `.qual` suffix lighter.
- Dish (155–164): 3.1mm gap (2.6mm for `.taco`), name/price 12.5px Avenir 500, tags 7.5px/.12em at 40–46% ink, description Cormorant italic 13px/1.25 at 72% ink.
- Trust our chef band (169–176): `margin-top:auto` (pushes to bottom of the flex sheet), 3-column grid with hairline dividers, name 17px italic, price 12.5px, note 12.5px italic. Boxed variant (191–199) 1px border, single column, name+price inline; `.chef-in-column .foot{margin-top:auto}`.
- Footer (179–182): dietaries 12px italic, legend 7.5px/.08em, surcharge 8px.
- Palette: single ink `--ink:#1d2916` with 72/46/24% mixes; `--stock` white or cream `#efe7d8`; fonts `--sans:"avenir-lt-pro","Manrope"…`, `--serif:"cormorant-garamond"…`. Tailwind-preflight base rules (99–102) are included because line-heights depend on them.
- Fonts: `menuFontFaceCss` (358–395) declares `avenir-lt-pro` 400/500/700/900 (OTF) and `cormorant-garamond` italic 400 (woff2, latin + latin-ext unicode ranges), optional Manrope. `MENU_FONT_FILES` (397–405), `MENU_LOGO_FILES` (407–410: `stalma-logo.png`, `avalon-logo.png`). Files exist twice: `apps/api/assets/menus/{fonts,images}` (server, inlined as data URIs) and `apps/menus-web/public/{fonts,images}` (preview, same-origin URLs).

### Rendering functions
- `renderDish` (247–261): `HEADER_PRICED` drops description and price; emits `data-dish-key`.
- `renderSectionHead` (263), `renderColumnSection` (268; SET_MENUS in a column → boxed), `renderWideSection` (276; FULL STANDARD/HEADER_PRICED: heading spans, items flow into a nested two-column grid, one item per `.col`), `renderSetMenus(section, boxed)` (287–304).
- `renderMenuSheetHtml` (307–337): filters visible sections; LEFT → left `.col`, RIGHT → right `.col`, FULL rendered after the columns in document order (SET_MENUS as band, else wide section); `chef-in-column` class when any column has a SET_MENUS section; footer = dietaryNote, generated legend, surchargeLine. Sections keep their order within a column; cross-column order is not expressible beyond LEFT/RIGHT/FULL.
- `renderMenuHtml` (340–352): full document with font CSS, `MENU_PRINT_CSS`, `@page`.

### PDF (`apps/api/src/lib/menu-pdf.ts`)
Chrome discovery (21–59; `MENU_CHROME_PATH`, system paths, Playwright dir), `chromeStatus` (61), single shared browser (75–98) with `--no-sandbox …`, `closeMenuBrowser` (100). `withPage` (117–131): viewport **794×1123 (A4 @96dpi)**, `setContent`, waits `document.fonts.ready`, `emulateMediaType('print')`, 20s timeout. `measureMenuFill` (134) evaluates the probe. `renderMenuPdf(html, page)` (139–155): probe, `tab.pdf({ width:'…mm', height:'…mm', printBackground:true, preferCSSPageSize:true, margin 0 })`, page count via `pdf-lib`, `renderMs`. Assets: `apps/api/src/lib/menu-assets.ts` — `menuAssetsDir` (38; candidates incl. `MENU_ASSETS_DIR`), `dataUri` (48; throws `MenuAssetError` rather than fall back fonts), `loadMenuRenderAssets` (58; cached per process), `menuAssetsStatus` (87). Docker image installs Debian `chromium` (`Dockerfile` 9).

### What is hard-coded to A4 / to food
- A4: `.sheet` 210×297 + 16/17/12mm padding (CSS 122–123), class `a4` (321), viewport 794×1123 (`menu-pdf.ts` 123), copy "one A4 page" in `overflowIssue` (menus.ts 444), publish message (service 826), `OverflowMeter` text (`ValidationPanel.tsx` 26), preview note/labels, `menu-pdf.test.ts` hard-codes `{210,297}` (37), rules test asserts `@page { size: 210mm 297mm }` (322). `pageCount !== 1` gate (service 821–831).
- Food: `MENU_TAGS` dietary set with seafood origin and `isSeafood` rule; "Trust our chef"/`SET_MENUS` naming and labels (`MENU_SECTION_TYPE_LABELS` 92–96, HomePage/App copy "Printed food menus", `packages/ui/src/brand/SuiteApps.tsx` 268 "Edit the printed food menus…"); `.dish/.taco` class names; whole-dollar prices only; two fixed columns; templates named `*_alacarte` with title "À la carte"; `.food-print-page` root selector baked into the fill probe (menus.ts 424) and the preview's backdrop-stripping override (`MenuPreview.tsx` 66).

---

## 5) Frontend architecture (`apps/menus-web`)

Files (all under `apps/menus-web`): `index.html` (PWA metas, theme bootstrap), `vite.config.ts` (react plugin, `react-vendor` chunk), `package.json` (dev port 5181, `test` = node:test on `src/**/*.test.ts`, `test:e2e` = `e2e/*.e2e.mjs`, deps `@alma/shared`, `@alma/ui`, react-router 6; dev dep `puppeteer-core`), `.env.production` (`VITE_API_URL=https://api.almagroup.com.au`, suite URLs), `public/brand/*`, `public/fonts/*` (7 files), `public/images/{avalon-logo,stalma-logo,alma-group-logo}.png`, `src/main.tsx`, `src/App.tsx`, `src/styles.css` (823 lines), `src/config/suiteLinks.ts`, `src/lib/{api,format,menuApi,recovery,recovery.test,reorder}.ts`, `src/components/{DiffView,MenuManageDialogs,MenuPreview,PublishDialog,ValidationPanel}.tsx`, `src/pages/{HomePage,EditorPage,HistoryPage}.tsx`, `src/vite-env.d.ts`, `tsconfig*.json`, `e2e/{helpers,smoke.e2e,archive-two-tab.e2e,recovery-apply.e2e}.mjs`. Icons are imported from `../../web/src/lib/icons` (the compliance app) in App/Editor/Home/History.

- **App.tsx**: `useMenusAuth` (46–93) — suite handoff token (`consumeSuiteHandoffToken`), `/api/auth/me`, login/logout, `installSuiteAppAccess`. Routes (250–255): `/`, `/menus/:menuId/edit`, `/menus/:menuId/history`, `*` → `/`. Wrapped in `@alma/ui` `AppAccessGate appId="MENUS"` (222) and `AppShell` with `SidebarNav`, `TopBar` (title "ALMA Menus", subtitle "Printed food menus — edit, preview, publish"), `SuiteAppSwitcher`, `SuiteInboxWidget`, `ThemeToggle`, `SuiteClock`, `SuiteSignOutButton`, `TaskBar`.
- **lib/api.ts**: `API_BASE_URL` from `VITE_API_URL`/`VITE_API_BASE_URL` (15; localhost:3018 fallback), bearer token in localStorage key `alma.menus.session` (16), `ApiError{status, details}` (36–45), `api()` (54–88) clears token on 401, `apiBlob()` (100–124) for PDFs, suite handoff helpers (133–163).
- **lib/menuApi.ts**: typed wrappers for every route (16–44); `isMenuArchivedError`/`archivedMenuIdOf` (47–61); `openVersionPdf(versionId, 'view'|'download'|'print', filename)` (68–108) fetches with auth header and hands the browser an object URL (hidden iframe for print).
- **lib/format.ts**: `formatWhen` Sydney time "today 14:05", `pdfFilename` (mirrors server), `formatBytes`.
- **lib/recovery.ts**: `UnsavedMenuChanges {id, menuId, menuLabel, draftVersionNumber, keptAt, document}` in localStorage key `alma.menus.unsaved.${menuId}` (28); `keepUnsavedChanges` (returns false on quota), `readUnsavedChanges` (legacy copies get `id = keptAt`), `forgetUnsavedChanges(menuId, onlyId?)`, `saveConfirmsApply(pending, sentEditSeq)` (77: `sentEditSeq >= pending.editSeq`), `downloadUnsavedChanges` (JSON file).
- **lib/reorder.ts**: `moveItem`, `useDragReorder` (pointer events + Alt+arrow keyboard).
- **components/MenuPreview.tsx**: builds the same `renderMenuHtml` with same-origin asset URLs (`previewAssets`, 24–39), injects `<style>` to strip backdrop/shadow by replacing `</head>` (64–67), renders a `srcDoc` iframe sized `template.page` in px (`PX_PER_MM = 96/25.4`, 41) inside `.menu-preview-sheet`, CSS-`scale()`d to the host width via `ResizeObserver` (71–79); `sandbox="allow-same-origin"` (151). After `load` and `document.fonts.ready` it runs `MENU_FILL_PROBE_SCRIPT` through `contentWindow.eval` (101) and reports `onFill`; re-measures on host resize (phone tab shows). `focusDishKey` scrolls/outlines `[data-dish-key]` (124–140). Faithfulness to the PDF relies on identical HTML/CSS and the same font files; differences are only asset transport (data URI vs URL) and the server's print-media emulation.
- **components/ValidationPanel.tsx**: `OverflowMeter` (12–30; amber > 92%, red when overflow; copy "Fits on one A4 page.") and issue list with Jump buttons.
- **components/PublishDialog.tsx**: native `<dialog>`; shows errors/warnings badges, "Page N% full" (or renderer message), `DiffView`, buttons "Back to editing" / "Publish" / "Publish anyway".
- **components/DiffView.tsx**: grouped diff (Heading, Added, Removed, Price changes, Tag changes, 86'd / back on, Renamed, Description changes, Moved, Sections, Footer); `templateTitle` substitutes a blank heading.
- **components/MenuManageDialogs.tsx**: `NewMenuDialog` (46–167; venue select `#new-menu-venue` when >1 addable venue, template select only when venue has >1, `#new-menu-name` autofocus, `#new-menu-heading`, `#new-menu-source` defaulting to the venue's live menu), `RenameMenuDialog` (179–219; `#rename-menu-name`), `ArchiveMenuDialog` (231–267). All native `<dialog>` via `useModal` (16–27).
- **pages/HomePage.tsx**: loads `GET /api/menus`; groups by venue (58–69; venues with templates or menus), `AlmaHomeBubble` (198–207; status "N unpublished drafts"/"Everything published", renderer hint), "Publishing is paused" card when renderer not ok (211–215), per-menu `Card` (126–194: Live/Draft/Last edited facts, buttons Start/Continue draft, History, Open PDF; Rename/Archive for publishers), per-venue "New menu" (240–244), archived list with Unarchive (255–281), dialogs (287–320). `startDraft` treats a 409 on an ACTIVE menu as "draft exists → open editor" (85–88).
- **pages/EditorPage.tsx** (1154 lines): `EditorPage` (139). State: summary, draft payload, `doc`, `saveState` (`idle|dirty|saving|saved|error|conflict|archived`, 63–72), fill, mobileTab, publish dialog state, copyTarget, `unsaved` recovery. Refs: `expectedUpdatedAt` (server `version.updatedAt`), `archivedRef`, `savedDocRef`, **edit-sequence numbers** `editSeqRef` (next edit number), `latestSeqRef` (number of the doc in `latestDoc`), `savedSeqRef` (number server last confirmed), `pendingApplyRef`, `saveTimer`, `inFlight`, `queuedRef`. `load` (≈185–230) fetches summary + list + draft; `saveNow` (≈239–320) PUTs with `expectedUpdatedAt`, adopts server ids/dishKeys via `adoptSaved` (96–121, matches sections by client key and items by dishKey/identity), sets `saved` only if `latestSeqRef === sentSeq` else stays `dirty` and re-arms; on `MENU_ARCHIVED` → `enterArchived`; 409 → `conflict`; queues a follow-up save if edits arrived mid-flight. `update(mutate)` (≈322–340) increments the sequence and debounces autosave `AUTOSAVE_MS = 1500` (61). `enterArchived` (≈350–383) stops saving, closes dialogs, keeps unsaved edits via recovery store when `!menuDocumentsEqual(saved, latest)`. `beforeunload` guard and unmount flush (≈388–406), `visibilitychange` flush (≈401–409), `flushSave` (≈411–430) used before publish preview and copy. Client-side validation = `validateMenuDocument(doc)` + `overflowIssue(fill)` (≈432–436). Sections carry a browser-only `clientKey` (79–94) because every save recreates row ids. Sub-components: `SectionsEditor` (842), `SectionCard` (888; title input `data-field="name"`, visible toggle, Type/Placement selects, Heading suffix, Subheading for SET_MENUS, drag handle, collapse), `ItemRow` (1015; name, `$` whole-dollar input with `inputMode=numeric`, unit input for set menus, description textarea, tag chips + Seafood checkbox, 86 toggle, Duplicate, Copy to another menu, Delete, "prints N" hint), `HeadingEditor` (1120; first `input.field-control` in `.editor-form` — e2e depends on this), `FooterEditor` (1141; Dietary note, Surcharge line). Views: loading, load error, "Published vN" card (Print/Download/Open PDF/Start another draft), archived read-only `EmptyState` + unsaved card, "No draft in progress", and the split editor (`.editor-split.is-edit|is-preview`, tabs under 900px per `styles.css` 790–823; preview sticky at 72px). Copy-to picker is a `.menu-sheet` bottom sheet listing `otherMenus`.
- **pages/HistoryPage.tsx**: versions list (Live/Draft/Archived badges, restored-from note, View/Download/Print PDF, "Diff against draft|live", "Restore as new draft" with 409 → confirm replace), audit log list, archived read-only messaging.
- **styles.css**: module tokens (`--menus-paper`, `--menus-ink`), `.menu-preview*` (272–299: absolute iframe, `transform-origin: top left`, `pointer-events:none`), `.overflow-meter` (366–391), dialogs `.menu-dialog*`, cards, version/audit lists, mobile breakpoint `@media (max-width: 900px)`.
- `@alma/ui` usage: `AppShell, TopBar, TaskBar, AppAccessGate, SuiteAppSwitcher, SuiteInboxWidget, SuiteClock, SuiteSignOutButton, ThemeToggle, ProductLogo, AlmaHomeBubble, Badge, Button, Card, EmptyState, Input, Select, Skeleton, Spinner, MenuIcon, useDismissibleLayer, installSuiteAppAccess, SUITE_APPS`. The module's identity lives in `packages/ui/src/brand/SuiteApps.tsx` (id `menus`, stage `pilot` 98, URL `https://alma-menus.web.app` 160, group `operations` 212, label "Printed menus" 242, description 268) and `AlmaAppIcon.tsx` 313–338; `appAccess.ts` 14 maps `menus → 'MENUS'`.

Hosting: `firebase.json` site `alma-menus` → `apps/menus-web/dist` (452–453). Root scripts: `dev:menus`, `dev:menus-web`, `db:seed:menus` (`package.json` 24–36).

---

## 6) Tests and e2e coverage

Unit (node:test, `pnpm --filter @alma/api test`, CI `ci.yml` line 85):
- `apps/api/src/lib/menu-rules.test.ts` (400 lines): dietary tag sort/legend (52–74, incl. "seeded menus use every tag" exact legend string 66–73); validation rules each (76–156) incl. hidden-item exemptions and `overflowIssue`; prices (158–172; whole dollars only); dish keys (174–185); diff by dishKey, moves, renamed-section detection against id-less snapshot, "everything added" = 21 for Avalon (187–241); `menuDraftSaveInputSchema` normalisation (243–256); `canPublishMenus` (258–276); print templates HTML assertions (278–332: exact class strings `food-print-page stock-white venue-stalma`, logo `<img class="logo" src="/images/stalma-logo.png" alt="st.alma">`, `fsec wide`, `chef`/`chef boxed`, `chef-in-column`, header-priced output, escaping, `@page { size: 210mm 297mm; margin: 0; }`, unknown key `drinks_binder` throws); menus per venue (334–400: `menuTemplatesForVenue`, heading fallback, `headingChange` diff, create/update schemas, `menuDocumentsEqual` field coverage, heading default).
- `apps/api/src/lib/menu-pdf.test.ts` (self-skips without Chrome/assets): each seed renders to exactly 1 page, fill 0.5–1.005, < 15 s, `%PDF-` header; a stuffed menu measures overflow > 1.05. Hard-codes `{widthMm:210,heightMm:297}`.
- `apps/api/src/routes/menus.test.ts`: `requireMenuPublisher` ok/403/401 matrix.
- `apps/api/src/lib/set-menu-plan.test.ts` + `set-menu-plan.ts`: POS banquet course/component rule — unrelated to printed menus despite the name.
- `apps/menus-web/src/lib/recovery.test.ts`: kept-copy store (keep/read/forget by id, legacy copies, quota failure, `saveConfirmsApply`).
- `packages/db/prisma/migration-order.test.ts`: no migration may ALTER a table before one CREATEs it (name order) — applies to any V2 migration.

Postgres integration (CI job `db-integration`, `ci.yml` 94–154, runs full migration history then the two suites one at a time with `ALMA_TEST_REQUIRE_CHROME=1`):
- `apps/api/src/services/menu.integration.test.ts` (cases at 102, 148, 174, 191, 254, 335): empty draft → save → stable dish keys → audit; second draft refused, stale save refused, no-op save does not move `updatedAt`; validation blocks publish; publish with PDF then restore; second menu as a copy with own heading; empty menu + heading through publish/restore. Uses venues `itest-*`.
- `apps/api/src/services/menu-archive-race.integration.test.ts` (cases 190–300): save/discard/rename/start-draft/copy-in/copy-out/restore/publish each losing the race to an archive are refused with `MENU_ARCHIVED` and leave data unchanged; opposite-direction copies never deadlock; archive waits for a held lock. Venues `race-itest-*`.

Browser e2e (`apps/menus-web/e2e`, puppeteer-core, **not run by CI**; needs `MENUS_E2E_BASE_URL`, API URL, admin + draft-only chef accounts, seeded `st-alma`/`alma-avalon` with published menus):
- `helpers.mjs`: `session()` logs in and waits for `.menus-venue`; `api()` calls the API with the page's bearer token; selectors `cardNames` (`.menu-card .card-title`), `headingInput` (first `.editor-form input.field-control`), `fieldByLabel`, `keptCopy` (localStorage `alma.menus.unsaved.${id}`), `newMenu` (POST `/api/menus` copying the st-alma live menu).
- `smoke.e2e.mjs`: home grouping, "Headed “À la carte”" text, New menu dialog defaults, heading edit autosave + iframe `.title` follows, first publish ("first published version", "No errors", "Published v1"), heading-only diff row text, home card count, case-insensitive name clash message, rename via Enter, archive → archived list "last live v1"/"draft v2 kept", archived editor/history read-only, unarchive, phone width (390px) no horizontal scroll, draft-only chef sees no manage buttons and gets 403 on POST.
- `archive-two-tab.e2e.mjs`: refused autosave turns the tab read-only (exactly one PUT after archive), kept copy diff row text, apply after unarchive, copy into an archived target refused for target only, publish refused when archived mid-dialog.
- `recovery-apply.e2e.mjs`: apply + rejected save + reload, apply + network failure + reload, older in-flight save cannot clear the copy, newer copy from another tab survives, legacy (no-id) copy, publish right after apply.

Proof artefacts: `docs/menu-editor/compare/*` (side-by-side and diff PNGs vs the website PDFs) from `apps/api/scripts/menu-pdf-compare.ts`; `docs/menu-editor/screens/*`. Runbook/spec: `docs/menu-editor.md` (245 lines; "Adding a template" 217–237, "Out of scope for v1, designed for" 239–245 lists drinks menus, live screen URL, Menu Costing, pushing PDFs to the website).

---

## 7) Extension points for V2 (least-disruption attachment)

**Menu kind (food / drinks / functions / promotion / private-event).** No field exists. Two layers: (a) add `kind` to `MenuTemplate` in `menu-render.ts` 33–47 (pure code, no migration) so templates can be filtered per kind and the renderer can branch; (b) add `Menu.kind` (String or new enum, default `'FOOD'`) via a new migration so the home can group/filter and the website sync can pick "the venue's live FOOD menu". `menuTemplatesForVenue` (82) becomes `(venueSlug, kind?)`; `menuCreateInputSchema` (menus.ts 253) gains `kind`; `MenuVenueSummary.templates` (753) already carries `{key,label,title}` for the New-menu picker; `summaries()` ordering (service 419) would want kind before createdAt. Copy across kinds should probably be refused in `createMenu`/`copyItemTo`.

**A5 page size.** `template.page` is already plumbed to `@page`, Puppeteer and the preview iframe. Missing: make `.sheet` dimensions/padding come from the template (emit an inline rule from `renderMenuHtml` or a `sheetClass`/`--page-w/--page-h` custom properties), replace `class="sheet a4"` (321) and the fixed `794×1123` viewport (`menu-pdf.ts` 123) with values derived from `template.page`, and parameterise the "A4" copy (menus.ts 444, service 826, ValidationPanel 26). The website already has A5 geometry to port: `alma-web-platform/apps/web/app/print/alma-avalon-drinks/avalon.css` 88–89 (`.sheet.a5{width:148mm;height:210mm;padding:12mm 13mm 11mm}`, runhead logo 7.4mm / 6.6mm on a5, 11mm rule) and `st-alma-drinks/binder.css` 84–85, with `@page { size: 148mm 210mm; margin: 0 }` in `alma-avalon-drinks/page.tsx` 71 and 210×148 landscape in `st-alma-drinks/page.tsx` 67. The existing `menuPdfCompare`/`menu-pdf.test.ts` pattern can be reused for the A5 family (`renderMenuPdf(html, template.page)` already takes the page).

**Multi-page documents.** `MenuDocument` has no page concept; placement is column-within-one-sheet. Least disruptive: add an optional `page: number` (default 1) to `MenuSectionDocument`/`MenuSection` (nullable column, default 1 — existing rows and snapshots read as page 1), have `renderMenuSheetHtml` emit one `.sheet` per distinct page (the website's `sheets.tsx` files are the precedent, one `.sheet.a5` per page with `pg-l/pg-r`), run the fill probe per sheet (probe currently measures only the first `.food-print-page .sheet`, menus.ts 424), and change the publish gate from `pageCount !== 1` to `pageCount !== expectedPages` (service 821–831). `MenuSnapshot.schemaVersion` (141) should bump to 2 with `snapshotDocument` (service 178) backfilling defaults, as it already does for `heading`.

**Per-person prices.** Already supported at item level by `priceUnit` (String, max 8; "pp") on `MenuItem`/`MenuItemDocument` and `formatMenuPrice`. A package/promotion price "per person" is therefore an item with `priceUnit:'pp'`; a menu-level headline price would be a new optional document field (e.g. `priceCents`/`priceUnit` on `MenuVersion` + `MenuDocument`), diffed in `diffMenuDocuments` like `headingChange` and compared in `menuDocumentsEqual`.

**Package inclusions / minimums / conditions.** No fields. Today the only prose slots are item `description` (400), section `subheading` (120, rendered only for SET_MENUS), and footer `dietaryNote`/`surchargeLine` (240 each, always rendered). Attach as: a new section type (e.g. `CONDITIONS`/`TEXT` rendering a prose block, or `INCLUSIONS` rendering an unpriced list) — adding a `MenuSectionType` enum value needs `ALTER TYPE … ADD VALUE` and new cases in `renderColumnSection`/`renderWideSection`, `MENU_SECTION_TYPE_LABELS`, the editor's `SectionCard`, and the validator (which currently warns `STANDARD_NO_PRICE` and errors `SET_MENU_NO_PRICE`); plus optional per-version fields for availability (days/times) and minimum guests if they must be structured rather than typed. Footer lines are the natural home for the surcharge/RSA conditions line already seeded (`SURCHARGE` in seed content 62).

**Hidden prices.** `priceCents: null` already prints nothing but raises `STANDARD_NO_PRICE` warnings and `SET_MENU_NO_PRICE` errors; `HEADER_PRICED` hides item prices by design. A clean switch is a per-version `showPrices: boolean` (default true) on `MenuDocument`/`MenuVersion`, honoured in `renderDish`/`renderSetMenus` and short-circuiting the price warnings in `validateMenuDocument` when false; it must enter `menuDocumentsEqual` and the diff.

**Public stable identifier.** None exists: `Menu.id` is a cuid, PDFs are served only authenticated at `/api/menus/versions/:versionId/pdf`, and the version id changes per publish. Attach a `Menu.slug` (unique per venue; or a global `publicKey`) via migration, resolve "the PUBLISHED version of venue X / slug Y" in the service (`loadPublished` 281), and expose an unauthenticated route under the existing `/api/public` mount (`server.ts`) / `isPublic` allow-list (`apps/api/src/lib/public-paths.ts`) with long-lived caching keyed by `pdfGeneratedAt`. The website currently links static files in `alma-web-platform/apps/web/public/menus/` (`alma-avalon-menu.pdf`, `st-alma-menu.pdf`, `*-drinks.pdf`, `*-bottomless.pdf`, `alma-functions-menu.pdf`) from `apps/web/data/menus.ts` (`foodHref`/`drinksHref`) and `apps/web/app/catering/page.tsx` 209; `website-menu.service.ts` shows the GitHub-commit alternative (docs 244–245 propose adding PDF bytes to that commit).

**Promotions linked to What's On.** The website's `apps/web/data/whats-on.ts` has `Event.id` strings (`happy-hour-avalon`, `bottomless-lunch-avalon`, `taco-wednesday`, `taco-tuesday`, `bottomless-lunch-st-alma`, plus other arrays reusing `happy-hour`, `avalon-bottomless`, `st-alma-bottomless`, `*-rec` variants — ids are not unique across the file), `venue: "avalon"|"freshwater"` (not the suite slugs), free-text `price` ("$99pp", "$5 tacos", "Walk-in"). A link would be an optional `Menu.promotionKey` (or on the version) holding the website event id, with the suite as the price source if desired; there is no existing contract or API for it in either repo.

**Private-event set menus.** The existing `SET_MENUS` section type, `priceUnit 'pp'`, per-version `heading`, `copyFromMenuId` on create, archive, and the audit trail cover most of it; what is missing is kind, A5 geometry, a client/event label beyond `Menu.name` (60 chars, unique per venue), event date, and hidden prices (above).

Smaller hooks already present: `MenuItem.recipeId` (costing), `restoredFromVersionId`, `MenuListPayload.renderer`, `printedHeading` on summaries, the `clientKey` pattern for new editor row types, `MENU_LIMITS` for any new text fields, `diffMenuDocuments` section matching (id → title → shared dishes) for new section types, `menuAssetsStatus` for new logo files (register in `MENU_LOGO_FILES` + `MenuLogoAssetKey`, copy to both asset folders).

---

## 8) Constraints and risks

- **Existing published snapshots are frozen JSON with `schemaVersion: 1`** and no `heading` key on the earliest ones; `snapshotDocument`/`getVersion` already backfill `heading`. Any new document field must default when absent on read (sections `page`, `showPrices`, new section types) or `documentFor`/diff/render will throw or misreport. Restoring an old snapshot must yield a valid V2 document.
- **`writeDocumentRows` deletes and recreates all sections/items on every save** (service 310–340). New child tables hanging off `MenuSection`/`MenuItem` would be wiped unless they cascade from `MenuVersion` instead or the rewrite is extended; row ids change every autosave (the editor already copes via `clientKey`/dishKey adoption).
- **Hard-coded A4 in CSS and copy** (section 4). Adding an A5 template without changing `.sheet` would silently print a 210×297 sheet clipped into a 148×210 page; `pageCount !== 1` would also reject any two-sided A5.
- **Postgres enums**: `MenuSectionType`/`MenuPlacement` are DB enums; new values need `ALTER TYPE … ADD VALUE` migrations (and `migration-order.test.ts` enforces create-before-alter ordering by timestamp). `Menu.status` and `Menu.templateKey` are plain strings — easier to extend.
- **`@@unique([venueId, name])`** + case-insensitive service check: a weekly "Specials" per venue must be one menu with versions, or names must carry dates. Functions menus are group-level today (`alma-functions-menu.pdf` is shared by both venues) but `Menu.venueId` is required with `onDelete: Restrict`.
- **Templates are code**: a venue with no `MENU_TEMPLATES` entry cannot have menus (`createMenu` 409). `MenuPreview` calls `getMenuTemplate` (line 57) and throws on an unknown key — an editor opened on a menu whose template was removed/renamed crashes; `summaries()` tolerates it but `publish`/`publishPreview` throw.
- **Whole-dollar prices only** (`parseMenuPriceInput`, `formatMenuPrice`, `menu-rules.test.ts` 158–172): drinks or happy-hour prices with cents are impossible without changing both and the `item-price` input.
- **Dietary rules are food rules** (`isSeafood` requires A/I, GF/GFA, legend). Applying `validateMenuDocument` unchanged to drinks/promotions will warn/err inappropriately (`STANDARD_NO_PRICE` for unpriced inclusions, `SET_MENU_NO_PRICE`), and the generated legend appears in the footer whenever any tag is used.
- **Tests that pin current output**: `menu-rules.test.ts` asserts exact class strings, logo markup, `@page 210mm 297mm`, the full legend text, Avalon item count 21, and that `drinks_binder` is unknown; `menu-pdf.test.ts` hard-codes A4; integration tests build full `MenuDocument` literals (new required TS fields break compilation — keep additions optional with defaults); e2e selectors depend on `.menus-venue`, `.menu-card .card-title`, the heading being the first `.editor-form input.field-control`, dialog ids `#new-menu-*`/`#rename-menu-name`, texts "Headed “À la carte”", "first published version", "Saved today", "Publish…", "Start another draft", "This menu is archived", "Kept with the archived menu", "Apply to this draft", "Unsaved changes from", "Not saved yet", "Apply again", "recovered changes are saved", "Reload their changes", `.diff-view .diff-group li`, `.menu-sheet button`, and the `GET /api/menus` shape (`venues[].slug`, `menus[].venue.id`, `published`).
- **Renderer purity contract**: the same function runs in the iframe (same-origin URLs) and in Chrome (data URIs); no React/DOM/fetch allowed (docs 235–237). The preview strips the backdrop by string-replacing `</head>` and the fill probe selects `.food-print-page .sheet` — new templates must keep those selectors or update both.
- **Fonts/logos are duplicated** in `apps/api/assets/menus` and `apps/menus-web/public`; `loadMenuRenderAssets` refuses to render if any registered file is missing (503 on publish), so a new logo must land in both before a template referencing it ships. Avenir LT Std is licensed.
- **PDF bytes live in Postgres** (`pdfData`); multi-page A5 at print quality grows rows; `getVersionPdf` loads the whole row.
- **Publish is one Chrome render with a 20 s page timeout and a 15 s budget** asserted in tests; multi-page renders and more templates increase time, and the first publish after boot pays Chrome launch.
- **Permission gate is module-wide**: `requireMenuPublisher` applies to every menu; there is no per-kind publisher rule, and the staff write allow-list (`auth-middleware.ts` ≈95–101) is a regex over current paths — new routes must be added there or STAFF-role chefs get 403 before the route gate.
- **Website coupling is one-directional and lossy**: `website-menu.service.ts` regenerates `apps/web/data/menus.ts` without the `diet` field the website now declares, PDFs under `apps/web/public/menus` are static files with no print source for bottomless/happy-hour/functions (only food and drinks have print routes), and What's On ids are not unique or slug-aligned.
- **Archive semantics**: an archived menu is read-only but its draft is kept; e2e runs leave `E2E …` menus archived — any home filtering by kind must still list archived menus of every kind.
- **Optimistic locking depends on `updatedAt` equality**: any new write path on a version must go through the same conditional `updateMany` or it reintroduces the race PR #313 closed; copy-to currently bumps the target draft's `updatedById` without touching its `updatedAt` guard beyond Prisma's `@updatedAt`.


## Open questions (agent)
- Multi-page A5: is a promotion/private-event menu one single-sided A5 sheet (keep the one-page publish gate) or a front-and-back pair (two pages per PDF)? Should the editor expose pages explicitly or should content flow automatically?
- Pricing format: drinks/happy-hour pricing often needs cents ($12.50). Is whole-dollar printing a brand rule for every menu kind, or should V2 allow cents for drinks/promotions while keeping whole dollars on food?
- Dietary rules per kind: should the seafood-origin (A/I), GF/GFA and 'standard item without price' rules apply to drinks, promotions and private-event menus, or be scoped to food kinds only?
- Public PDF identity: should the suite serve published PDFs at a stable unauthenticated URL per venue+kind (and the website link to it), or keep committing static PDFs/data into alma-web-platform via GitHub? Who owns the website's menus.ts text data (its 'diet' field is not produced by the current publisher)?
- What's On linkage: the website's whats-on.ts event ids are not unique and venues are 'avalon'/'freshwater'. Should the suite define the promotion identifiers and push prices/labels to the website, or reference the website's ids read-only?
- Private-event menus: are they persistent menus with versions and history, or per-booking one-offs that should auto-archive after the event date? Should the client/event name print on the sheet, and should prices be hidden by default for host-paid events?
- Functions menu scope: the current functions PDF is a single Alma Group document shared by both venues, but Menu requires a venue. Should functions menus be group-level (no venue), duplicated per venue, or carry both logos?
- Publisher rights per kind: should chefs be allowed to publish daily specials (A5) without a manager, while website food/drinks menus keep the manager/head-chef gate?
- Conditions wording: who approves the legal/RSA conditions on bottomless and happy-hour menus (time limits, 'responsible service' lines, surcharge text), and should that text be locked per template rather than editable per version?
- Naming: with (venueId, name) unique, should weekly specials be one 'Specials' menu republished each week (history as the record) or a new menu per week?
