# Menu Editor (ALMA Menus)

The printed food menus for St Alma Freshwater and Alma Avalon, as data.
Venue managers and chefs edit content in forms, see the A4 page as they type,
and publish a PDF that matches the current menus. Layout is locked per venue;
only content, order, visibility and section placement change.

| Piece | Where |
| --- | --- |
| Frontend | `apps/menus-web` (Vite + React, port 5181, Firebase site `alma-menus`) |
| API | `apps/api/src/routes/menus.ts`, `apps/api/src/services/menu.service.ts` |
| Rules (tags, validation, diff) | `packages/shared/src/menus.ts` |
| Print templates + renderer | `packages/shared/src/menu-render.ts` |
| PDF (headless Chrome) | `apps/api/src/lib/menu-pdf.ts`, assets in `apps/api/assets/menus` |
| Schema | `Menu`, `MenuVersion`, `MenuSection`, `MenuItem`, `MenuAuditEvent` (migration `20261007191211_menu_editor`) |
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

- One draft per menu at most. Saving replaces the draft's rows and writes a
  `draft.saved` audit event with the diff summary. Saves carry the draft's
  `updatedAt`; a stale save is refused (409) rather than overwriting someone
  else's work.
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

## Permissions

- Access: `StaffAppAccess` app `MENUS` (or `COMPLIANCE`, the suite default).
  Grant it in Staff → app access; the Manager and Head Chef presets include it.
- Draft, save, discard, restore, copy to the other venue: anyone with access.
- Publish: managers, admins, anyone whose role title contains "head chef", or a
  `MENUS` grant at MANAGER/ADMIN (`canPublishMenus` in shared; the editor hides
  the button from everyone else and the API enforces it).
- Shared venue iPads can read, never write (auth middleware).

## Validation

| Rule | Level |
| --- | --- |
| GF and GFA both set | error |
| A and I both set | error |
| Seafood with neither A nor I | error |
| Set menu without a price · empty name · empty section title · duplicate dish key · nothing visible | error |
| Rendered page runs past one A4 page (measured in Chrome at publish; live meter in the editor) | error |
| VG and V both set | warning |
| Standard-section item with no price (visible items only) | warning |

The footer tag legend is generated from the tags in use on printed items, in
the fixed order `V VG GF GFA DF N A I`.

## Running it

```bash
pnpm db:migrate              # applies 20261007191211_menu_editor
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
ALMA_TEST_DATABASE_URL=postgresql://... node --import tsx --test apps/api/src/services/menu.integration.test.ts
pnpm --filter @alma/api menus:compare -- --reference ../alma-web-platform/apps/web/public/menus
```

## Adding a template

A template is a key in `MENU_TEMPLATES` (`packages/shared/src/menu-render.ts`):
venue class, logo asset, tagline, title and page size. Layout is driven by
section placement (`LEFT`, `RIGHT`, `FULL`) and type (`STANDARD`,
`HEADER_PRICED`, `SET_MENUS`), so another venue's à la carte needs:

1. A `MENU_TEMPLATES` entry, e.g. `manly_alacarte` with `venueClass: 'manly'`.
2. A logo PNG in `apps/api/assets/menus/images` and `apps/menus-web/public/images`,
   registered in `MENU_LOGO_FILES` (and the `MenuLogoAssetKey` union).
3. Any venue-specific tweak as a `.food-print-page.venue-manly …` rule in
   `MENU_PRINT_CSS` (the Avalon logo height is the existing example).
4. A `Menu` row with that `templateKey` (the seed script shows the shape).

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
