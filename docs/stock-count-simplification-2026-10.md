# Alma Stock — stock count audit, simplification and rebuild (October 2026)

Branch `feat/stock-count-simplify`. Not merged, not deployed: the production
database is untouched and the data script below has only been run against a
local clone. Nothing here changes a completed stocktake.

## 1. The Stock module as found

Alma Stock (`apps/stock-web` + `apps/stock-api`) holds one catalogue of
`StockItem`s (851 rows, 830 active) in 21 `StockCategory`s, with per-venue
holdings in `VenueStockItem` (Alma Avalon / St Alma). A `Stocktake` is a
dated, venue-scoped list of `StocktakeLine`s (item or prepped-recipe, counted
quantity, unit, server-computed value), moved through
IN_PROGRESS → SUBMITTED → REVIEWED → LOCKED, and separately *applied* to stock
(ledger movements + on-hand). Four `StocktakeTemplate`s (bar / kitchen per
venue) pick items by category. Every active item carries the count area
`Default`, so "walk by area" never had anything to walk.

Counting happened inside a form on the stocktake history page: one row per
line with **five inputs** (item picker, label, qty, unit, location) and a
Remove button, categories collapsed, no search, and a single **Save draft**
button that posted the whole sheet (519–830 lines), closed the form and
returned to the list. Two people on one sheet got a 409 and lost their work.
The printed sheet sectioned by count area, so a bar sheet printed as one
section called "Default", 20 A4 pages at ~30 rows a page. There was no Excel
export. Wine names carried the vintage inconsistently ("2022 Teusner 'Wark
Family' Shiraz (Case of 12)" from invoices, "Rockford Basket Press Shiraz
2017" from the floor), so vintages of one wine were scattered across the list
and every invoice-created wine sorted under "2".

## 2. Problems identified

| # | Problem | Where |
|---|---|---|
| 1 | Counting form: 5 inputs + button per line, manual save that leaves the page, whole-sheet PATCH with last-writer-refused | `StocktakePage.tsx` (old `StocktakeForm`) |
| 2 | No search inside a count; 184-line tequila section had to be scrolled | same |
| 3 | No way to fix an item from the count — `/items?edit=` in another page | same |
| 4 | Print sheet: one giant "Default" section, 20 pages for a bar sheet, decorative header/sign-off/footer, oversized rows | `CountSheetPage.tsx`, `count-sheet.ts` |
| 5 | No Excel template | — |
| 6 | Wines unsorted by wine/vintage; vintage buried in free text | `organise` — none existed |
| 7 | Categories sorted alphabetically (Beer before Spirits before Wine), not as a bar is walked | same |
| 8 | "Catalogue data quality" card (with "Sprint 1 / Loaded replacement" copy) sat above the count list; "Walk by area" and "Blind count" toggles that did nothing useful | `StocktakePage.tsx` |
| 9 | Catalogue: 45 clear mis-categorisations, 188 near-certain duplicate clusters, 233 ALL-CAPS invoice names, phantom venue "Avalon" | data, see §4 |

## 3. Improvements implemented

**One layout rule for every surface** — `packages/shared/src/stock-count-order.ts`:
categories in walking order (spirits → liqueurs → wine → beer → soft → kitchen),
wines grouped by name with vintages underneath, exact-match grouping only
("Bruxo No. 2" and "No. 4" stay apart), a forgiving search matcher. The
counting screen, the printed sheet and the Excel template all call it, so they
cannot disagree. 8 unit tests, plus 4 on the sheet builder.

**Counting screen** `/stocktake/:id/count` (`StocktakeCountPage.tsx`):
- One quantity box per line; name, unit and vintage are text. Enter or Tab
  moves to the next line and opens the next category when one runs out;
  Shift+Tab goes back. On a phone the keyboard's Next key does the same.
- **Autosave** per line (`PATCH /api/stocktake/:id/lines`), 600 ms after the
  last keystroke, with retry/backoff, a flush on page-hide, and a header
  indicator: *Saving… / ✓ Saved 12:09 pm / Not saved yet — Retry / Offline*.
  Pending rows show an amber border, failed rows red. Per-line writes mean
  two people can count different shelves of one sheet without a 409.
- **Search** box in the sticky header: partial words, any order, vintage
  ("shaw 2024", "teusner 2022"). Clearing it restores the open categories and
  never touches entered counts. No match → "Add an item to this count".
- **Edit item** (pencil, managers only) opens the Items page's own form in a
  drawer: name, vintage, category, units, pack size, cost, par, status. Saving
  updates the catalogue, re-files the line under its new category/wine group
  on the spot, keeps the count, and leaves completed stocktakes alone (their
  lines keep their own label/unit/value). "Remove from this count" lives there too.
- **Vintage field** on `ItemForm` for wine categories: a structured input that
  keeps the vintage in the name (`withVintage`), so no migration and every
  vintage stays its own item. Also on the Items page.
- Details (name, venue, date, scope, notes) collapsed behind one button;
  "Show expected on hand" is a hint under the line, never prefilled.
- Submit for review (managers) confirms how many blanks become zero.
- Start a count: template + venue + date → the count is created with blank
  lines and opens straight on the counting screen.

**Print sheet**: category sections with the heading repeated on page breaks,
wine group rows with vintages indented, two columns on A4, 9.5 pt, ~5.6 mm
rows, no row splits. Bar & FOH (519 lines): **20 → 8 pages** (12 single-column
with a notes column). Options: two columns, expected qty, tally box, notes.

**Excel**: `GET /api/stocktake-templates/:id/export.xlsx` (blank, from the
templates page — "Blank Excel") and `GET /api/stocktake/:id/export.xlsx`
(from the count — carries counts so far). Columns Item · Vintage · Unit ·
Count · Notes, grey category bands, bold wine group rows, frozen header row
repeated on print, A4 fit-to-width, hidden `Ref` column with line/item ids
for a future import. No separate item list is maintained.

**Removed**: the inline count form (≈1,000 lines), the data-quality card
(linked to Items → Costing health instead), Walk by area, Blind-count prefill,
per-line label/unit/location inputs, 5 KB of dead CSS.

## 4. Inventory naming and category issues

Full audit (read-only, against a clone of production):
`docs/stock-catalogue-audit-2026-10.md`. Headlines:

- **45 unambiguous category moves** — 19 tequilas/mezcals in "Spirits — Other",
  a gin cube and a Paloma batch in "Beer & Cider", syrups and Lyre's under
  "Liqueurs", dried chillies/tins/spices under "Produce"/"Other"/"Bakery", the
  one item in the legacy "Spirits" category, Billecart-Salmon Rosé as still rosé.
- **188 near-certain duplicate clusters (390 items)** from three import waves:
  the May invoice-named items (`cmoqfb…`, "PATRON SILVER 700 ML BOTTLE") hold
  the recipe and invoice links; the floor-named May/Aug items hold the counts.
  ≈ $16.3k (Avalon) + $21.5k (St Alma) of stale on-hand sits on uncounted twins.
  44 further "possible" clusters.
- **Naming**: 233 ALL-CAPS supplier names, 64 "(Case of N)" names, 42 wines
  vintage-first vs 7 vintage-last, typos (Cheateau, Reisling, Gewurtztraminer,
  Thomson/Thompson). ~150 renames proposed, none applied.
- **Categories**: "Spirits" (1 item) and 5 empty legacy categories (Dairy,
  Dry Goods, Meat, Review, Wine) can be retired; no new categories needed.
  No stock category for fortified — All Saints Muscat flagged, left in Wine — Red.
- **Phantom venue "Avalon"**: 830 empty `VenueStockItem` rows + an empty
  stocktake `cmti01rjj00qgoa01uhp30tw9` created 1 Sep 2026 01:39, beside
  "Alma Avalon". A venue-less stocktake `cmq49xa2i0001s601z7kg0l2q` (603
  counted lines, $31.1k) needs a decision.
- 56 active items with no average cost, ~20 costs clearly per-case not per-bottle,
  101 items on a "100 g" placeholder measure, Avalon on-hand inflated to ~$3.0M by
  mL-as-bottles entries (known pattern).

## 5. Data corrections applied

**None to production.** `apps/stock-api/scripts/apply-category-audit-2026-10.ts`
applies the 45 category moves; it is a dry run by default, checks each item is
still where the audit found it, and writes only with `--apply`. Verified on the
clone: "Would move 45 items; skipped 0". To run against production after approval:

```
DATABASE_URL=… ./apps/stock-api/node_modules/.bin/tsx apps/stock-api/scripts/apply-category-audit-2026-10.ts --apply
```

## 6. Changes requiring manual review

1. Duplicate merges (188 clusters) — use Items → Merge (`MERGE ITEMS`), keeping
   the item on the 1 Oct sheet; the audit lists per-twin recipe/invoice/alias
   counts and on-hand so each merge can be judged.
2. Renames to a standard (Title Case, vintage last, no case/carton suffixes).
3. Phantom "Avalon" rows and stocktake — safe to delete; the venue-less $31k count.
4. 22 uncertain category calls (§2 of the audit).
5. Retiring "Spirits" and the 5 empty categories; a Fortified category if wanted.
6. Longer term: a real `vintage` column on `StockItem` (the name-based field is a
   bridge, not the end state).

## 7–9. Before / after

Screenshots in `docs/screenshots/stock-count-2026-10/` (same count, same
519-line Alma Avalon Bar & FOH sheet, local clone of production):

| | Before | After |
|---|---|---|
| Counting, desktop | `before-count-desktop.jpg` | `after-count-desktop.jpg` |
| Counting, phone | `before-count-mobile.jpg` | `after-count-mobile.jpg` |
| Print, page 1 | `before-print-page1.jpg` (20 pages) | `print-page1.jpg` (8 pages); wine page `print-page7-wine.jpg` |
| Search / edit drawer / re-grouped vintage | — | `after-count-search.jpg`, `after-edit-drawer.jpg`, `after-edit-regrouped.jpg` |
| Start a count / Details | — | `after-start-count.jpg`, `after-details-panel.jpg` |
| Blank Excel | — | `sample-blank-avalon-bar.xlsx` |

## 10. Test results

- `apps/stock-api`: **315 / 315** pass (`DATABASE_URL` set, against the clone),
  including new `stock-count-order.test.ts` (8), rewritten `count-sheet.test.ts`
  (4) and `tests/stocktake-lines.test.ts` (3: server-side valuation, untouched
  lines, blank = not counted, cross-venue 404, add/duplicate/remove, counter 403
  after submit, manager correction, applied 409 and values preserved).
- `apps/stock-web`: `tsc --noEmit` clean; `vite build` clean. The repo has no
  ESLint configuration (`pnpm lint` is a no-op).
- Manual, both venues' accounts on the local stack: start a count from a
  template, Enter/Tab entry, autosave (PATCH 200, DB values recomputed), search
  by name and vintage, edit vintage from the drawer (line re-grouped, label
  patched), Details panel save, blank Excel from template, Excel from a count,
  two-column print to PDF (8 pages), non-manager venue isolation (cross-venue
  404, 403 on submitted count / item PATCH, 200 on own-venue Excel).

## 11. Limitations and recommendations

- Vintage is parsed from the name; a wine named with the year in the middle
  ("Eperosa 'Magnolia 1941' Semillon") is handled, but a real column is better.
- Excel import of a filled sheet is not built (the hidden Ref column is there
  for it).
- Autosave is per line; the Details form still uses the whole-record PATCH.
- The count page lists items from the picker payload; an item created
  elsewhere mid-count appears after a reload.
- Clean the duplicates before the next month-end: they are what makes counts
  slow and values wrong, far more than the screen did.
