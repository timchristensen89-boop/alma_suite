# Menu Editor (ALMA Menus)

The printed food menus for St Alma Freshwater and Alma Avalon, as data.
Venue managers and chefs edit content in forms, see the A4 page as they type,
and publish a PDF that matches the current menus. Layout is locked per venue;
only content, order, visibility and section placement change.

A venue has any number of menus — the à la carte, a Tuesday menu, an event
menu — each with its own drafts, history and PDF, all printed on that venue's
template. Publishers add, rename and archive menus from the module home.

| Piece | Where |
| --- | --- |
| Frontend | `apps/menus-web` (Vite + React, port 5181, Firebase site `alma-menus`) |
| API | `apps/api/src/routes/menus.ts`, `apps/api/src/services/menu.service.ts` |
| Rules (tags, validation, diff) | `packages/shared/src/menus.ts` |
| Print templates + renderer | `packages/shared/src/menu-render.ts` |
| PDF (headless Chrome) | `apps/api/src/lib/menu-pdf.ts`, assets in `apps/api/assets/menus` |
| Schema | `Menu`, `MenuVersion`, `MenuSection`, `MenuItem`, `MenuAuditEvent` (migrations `20261007191211_menu_editor`, `20261008093000_menu_heading`) |
| Seed | `pnpm db:seed:menus` (`apps/api/scripts/seed-menus.ts`) |
| Proof against the current PDFs | `apps/api/scripts/menu-pdf-compare.ts` → `docs/menu-editor/compare/` |

## Where the templates came from

The current PDFs were printed from the website repo (`alma-web-platform`,
`apps/web/app/print/_food/FoodSheet.tsx` + `food.css`) by headless Chrome 141.
That sheet and stylesheet are ported verbatim into `menu-render.ts`; the only
change is that content, section type and column placement come from the
database. Avenir LT Std (the brand's licensed faces) and Cormorant Garamond
Italic are self-hosted in `apps/api/assets/menus/fonts` and inlined into the
HTML as data URIs, because Chrome drops linked fonts when printing. The compare
script renders both seeded menus and rasterises them beside the current PDFs;
the residual pixel difference is anti-aliasing only (the website embedded Type3
glyphs, Chrome's `page.pdf()` embeds TrueType).

## How a menu moves

```
draft ──save──► draft ──publish──► PUBLISHED (snapshot + PDF frozen)
  ▲                                   │
  └──────── restore (new draft) ◄─────┘ (previous PUBLISHED → ARCHIVED)
```

- One draft per menu at most, enforced inside the transaction that creates
  one (the `Menu` row is locked by the version counter update first). Saving
  replaces the draft's rows and writes a `draft.saved` audit event with the
  diff summary; a save that changes nothing writes nothing. Saves carry the
  draft's `updatedAt`, and the write itself is conditional on that value, so
  a stale or racing save is refused (409) rather than overwriting someone
  else's work. Publishing flips the draft under the same guard.
- Publishing validates (block on errors, warnings must be acknowledged),
  renders the PDF in Chrome, measures the page, and in one transaction
  archives the live version, marks the draft PUBLISHED and stores
  `snapshotJson` + `pdfData`. A published version is never written again.
- Restoring any past version creates a new draft from its snapshot. History
  is never rewritten; version numbers come from `Menu.versionCounter` and are
  never reused.
- `MenuItem.dishKey` is stable across saves, clones and restores. Menu Costing
  links a dish to a recipe through the already-present nullable
  `MenuItem.recipeId` (soft reference, no migration needed).

## Menus per venue

- `Menu` rows are unique on `(venueId, name)`; the service also refuses a name
  that differs only in case, and an archived menu keeps its name taken
  (unarchive it instead of creating a lookalike).
- **New menu** (`POST /api/menus`): venue, name, the venue's print template
  (chosen only when the venue has more than one — `menuTemplatesForVenue` maps
  templates to venue slugs), an optional printed heading, and optionally a menu
  to copy. The first draft is created in the same transaction: empty, or the
  source's live version (its draft when nothing is live yet) with dish keys
  kept, so a dish shared between the à la carte and the Tuesday menu is the
  same dish to Menu Costing. Recipe links are dropped when the source belongs
  to another venue. Audit: `menu.created`, then `draft.created`.
- **Rename** (`PATCH /api/menus/:menuId`): changes the home card, the editor
  title and every PDF download filename (past versions included, since the
  filename is built from the current name). Nothing printed on the page
  changes; published snapshots keep the name they were published under.
  Audit: `menu.renamed`.
- **Archive / unarchive** (`POST /api/menus/:menuId/archive`, `…/unarchive`):
  `Menu.status` flips between `ACTIVE` and `ARCHIVED`. An archived menu is off
  the home grid (listed under "Archived menus"), read-only — drafting, saving,
  discarding, publishing, restoring, renaming and copy-to answer 409 — and keeps
  every version, PDF, draft and audit entry. Nothing is ever deleted. Writes
  answer 409 with `{ code: MENU_ARCHIVED, menuId }`. Audit: `menu.archived`,
  `menu.unarchived`.
- **Archive versus writes in flight.** Every write (save, discard, rename,
  start a draft, restore, copy, publish) locks its `Menu` row with
  `SELECT … FOR UPDATE` and checks `status` again inside its own transaction
  (`lockActiveMenu`); archive and unarchive take the same lock. An archive
  therefore cannot commit between a write's check and its write: the write
  lands before the archive, or is refused after it. Publish renders the PDF
  outside any transaction, then locks and re-checks before it commits. A copy
  locks both menus in id order (`lockMenus`), so copies in opposite directions
  queue instead of deadlocking, and names whichever menu was archived.
- **A stale editor.** When the API answers `MENU_ARCHIVED` for the open menu
  (autosave, publish, discard, copy out of it, start a draft), the editor
  cancels the pending autosave, sends nothing more and switches to the
  read-only view. Anything typed since the last successful save is kept in
  that browser (`localStorage`, `lib/recovery.ts`) and shown as a diff, with
  Download and Forget; once the menu is unarchived, opening it offers Apply to
  this draft. An archived copy target only takes that menu off the picker:
  the source stays editable. History and the home handle the same answer.
- **Printed heading** (`MenuVersion.heading`, part of `MenuDocument`): the
  italic line under the logo. Empty prints the template's own title
  ("À la carte"), which is what both seeded menus do; a Tuesday menu types
  "Taco Tuesday". It is per version like the footer lines, so it diffs
  (`MenuDiff.headingChange`) and travels through snapshot and restore.
- `GET /api/menus` returns `{ menus, archived, venues, renderer }`; `venues`
  carries each venue's templates so the New menu form knows what it may offer,
  and each menu carries `printedHeading` (what its live page is headed) for the
  home card.
- Names are unique per venue regardless of case in the service. The database
  index on `(venueId, name)` is case-sensitive, so it backs up exact-duplicate
  races only; two publishers racing "Tuesday" against "tuesday" in the same
  instant could both succeed, and a rename fixes it.
- The seed (`pnpm db:seed:menus`) is for a venue with no menu on its template.
  It skips a venue that already has one, whatever it is now called and whether
  or not it is archived, so renaming "Food" never makes a re-run publish a
  second copy of the seed content.

## Permissions

- Access: `StaffAppAccess` app `MENUS` (or `COMPLIANCE`, the suite default).
  Grant it in Staff → app access; the Manager and Head Chef presets include it.
- Draft, save, discard, restore a version, copy a dish to another menu: anyone with access.
- Publish, and add / rename / archive / unarchive a menu: managers, admins,
  anyone whose role title contains "head chef", a `MENUS` grant at
  MANAGER/ADMIN, or a `MENUS` grant with the "Publish menus" toggle
  (`permissions.menusPublish`) ticked in Staff → app access (`canPublishMenus`
  in shared; the home and editor hide those buttons from everyone else and the
  API enforces it with `requireMenuPublisher`; the auth middleware's staff
  write allow-list lets those requests reach that gate).
- Shared venue iPads can read, never write (auth middleware).

## Validation

| Rule | Level |
| --- | --- |
| GF and GFA both set | error |
| A and I both set | error |
| Seafood with neither A nor I | error |
| Set menu without a price · empty name · empty section title · duplicate dish key · nothing visible | error |
| (Tag, name and price rules apply to printed items only: an 86'd dish or a hidden section never blocks publish. Duplicate dish keys always do; an untitled hidden section warns.) | |
| Rendered page runs past one A4 page (measured in Chrome at publish; live meter in the editor) | error |
| VG and V both set | warning |
| Standard-section item with no price (visible items only) | warning |

The footer tag legend is generated from the tags in use on printed items, in
the fixed order `V VG GF GFA DF N A I`.

## Running it

```bash
pnpm db:migrate              # applies 20261007191211_menu_editor and 20261008093000_menu_heading
pnpm db:seed:prod            # venues (st-alma, alma-avalon)
pnpm db:seed:menus           # both menus, validated and published as v1 with PDFs
pnpm dev:menus               # api (3018) + menus-web (5181)
```

The API needs a Chrome/Chromium binary. The Docker image installs Debian's
`chromium`; locally it also finds `google-chrome` or a Playwright browser
directory (`PLAYWRIGHT_BROWSERS_PATH`). `MENU_CHROME_PATH` overrides. Without it
drafts still work; publishing answers 503 with the reason, and the module home
shows it.

Tests:

```bash
pnpm --filter @alma/api test                      # rules, templates, route guard; renderer test runs when Chrome is present
# Postgres + Chrome: drafts, publish, restore, several menus per venue, and
# archiving racing every write. ALMA_TEST_REQUIRE_CHROME=1 fails instead of
# skipping the publish cases when Chrome is missing. Manual CI runs the same.
cd apps/api && ALMA_TEST_DATABASE_URL=postgresql://... ALMA_TEST_REQUIRE_CHROME=1 \
  node --import tsx --test --test-concurrency=1 \
  src/services/menu.integration.test.ts src/services/menu-archive-race.integration.test.ts
pnpm --filter @alma/api menus:compare -- --reference ../alma-web-platform/apps/web/public/menus
```

The race suite reproduces each window for real: an archive transaction locks
the menu row and flips it to `ARCHIVED` without committing, the real service
call runs (its pre-check still reads `ACTIVE`), and the archive commits once
that call is waiting on the lock. Every case asserts the write waited, was
refused with `MENU_ARCHIVED`, and left the draft, name, version counter and
published version exactly as they were.

## Adding a template

A template is a key in `MENU_TEMPLATES` (`packages/shared/src/menu-render.ts`):
venue slug, venue class, logo asset, tagline, title and page size. Layout is driven by
section placement (`LEFT`, `RIGHT`, `FULL`) and type (`STANDARD`,
`HEADER_PRICED`, `SET_MENUS`), so another venue's à la carte needs:

1. A `MENU_TEMPLATES` entry, e.g. `manly_alacarte` with `venueClass: 'manly'`.
2. A logo PNG in `apps/api/assets/menus/images` and `apps/menus-web/public/images`,
   registered in `MENU_LOGO_FILES` (and the `MenuLogoAssetKey` union).
3. Any venue-specific tweak as a `.food-print-page.venue-manly …` rule in
   `MENU_PRINT_CSS` (the Avalon logo height is the existing example).
4. A `Menu` row with that `templateKey` — **New menu** on the module home
   offers the template once `venueSlug` on the template matches the venue
   (the seed script shows the same shape in code).

A genuinely different layout (a drinks binder, an A5 specials card) gets its
own CSS block and page size in the same file, and a renderer branch keyed off
the template if the DOM must differ. Keep the renderer pure: no React, no DOM,
no fetches — the same function runs in the editor's preview iframe and in
headless Chrome on the server.

## Out of scope for v1, designed for

- Drinks menus: same engine, new templates (above).
- Live screen URL per venue: serve `renderMenuHtml` of the published snapshot.
- Menu Costing: `MenuItem.recipeId`, stable `dishKey`.
- Pushing the published PDF to the website: `website-menu.service.ts` already
  commits to `alma-web-platform`; add the PDF bytes to that commit on publish.
