# Stock app review — September 2026

Trigger: staff said it is easier to print a sheet and take notes on stock than
to count into any app. This review took that at face value, built the paper
path properly, and used the walk through the code to fix what was breaking
the count process around it. Everything below is from the code and the
scripts' own headers; nothing is assumed about production data.

## What changed in this pass

### 1. Paper count sheet (new)
- `GET /api/stocktake/:id/count-sheet` and `GET /api/stocktake-templates/:id/count-sheet`
  build a sheet grouped by count area in walking order, prep last, with the
  expected on-hand only when not blind. Open to anyone who can count.
- `/stocktake/:id/print` and `/stocktake-templates/:id/print` render it with a
  **Print sheet** button, options (blind, tally boxes, par, SKU, compact), a
  sign-off block (counted by / checked by / started / finished), instructions
  that match how the app reads a blank line, and print CSS that strips the
  shell and repeats table headers per page.
- **Print sheet** buttons on every stocktake row, in the review queue, inside
  the count form, and **Print blank sheet** on every template.

### 2. Duplicate items (new report, hardened merge)
- Detection moved server-side into `@alma/shared` (`stock-duplicates.ts`,
  unit tested): pack notes, sizes and plurals fold into a core name; wine and
  spirits match on exact name only; different pack sizes or units are shown
  but flagged. `GET /api/items/duplicates` returns groups with the suggested
  keeper (most history, then SKU, then cost).
- Items page: a collapsible "possible duplicates" panel with one-click merge
  per group, keeper pre-selected. The old browser-side exact-tuple check
  (which could not see "Lime" vs "Limes") is gone.
- `POST /api/items/merge` now also: repoints supplier aliases (they were left
  pointing at the archived duplicate, so every future invoice line would have
  auto-matched onto the archived row); moves supplier price-list rows where
  the keeper has none; folds two lines for the same item within one stocktake
  into one (apply and variance both kept only the last line for an item);
  backfills the keeper's blank SKU, category, count unit, count area, measure,
  cost and par from the duplicates; appends a merge note instead of
  overwriting notes; requires admin or group-wide manager access because it
  rewrites both venues' history; reports what moved.
- `DELETE /api/items` now checks all 13 relations, not 4. Transfers, wastage,
  reorder notices and aliases are ON DELETE CASCADE and were being silently
  destroyed by a delete that passed the old check.

### 3. Count process fixes
- **Two people on one count no longer overwrite each other.** A save sends
  the `updatedAt` it loaded; the API refuses with 409 when someone else saved
  since. Web form shows a "Reload this count" button; the iPad shows the
  message. Older clients that do not send the guard behave as before.
- **Saving keeps line ids.** Lines are updated in place (only the changed
  rows are written) instead of delete-and-recreate, so ledger corrections keep
  their `sourceStocktakeLineId` anchor and a 700-line save writes a handful of
  rows.
- **Count area reaches the sheet.** Lines were seeded with the category as
  their location, so "walk by area" walked by category and the data-quality
  card's advice to set count areas changed nothing. Lines now seed from
  `countArea`, category as fallback.
- Hand-picked lines seed the count unit, not the purchase unit (every such
  line tripped the unit-mismatch warning).
- A reopened count can be submitted again; reopening no longer stamps a
  review that never happened; apply reports "already applied" instead of
  "only submitted stocktakes can be applied" on a second press, and accepts
  counts reviewed through the review endpoint.
- Omitted or blank `countedQty` reads as "not counted" (null); it used to
  fail validation as NaN or coerce `''` to zero.
- Status badge shows all five states (LOCKED was invisible, and the variance
  report depends on it). "Lock as baseline" is available on applied counts in
  the history table, not only in the review queue where applied counts never
  appear. Export CSV is on every row.
- Success messages (bulk submit zeroed N blanks) no longer replace the whole
  history table with "Stocktakes unavailable".
- Venue on the count form is a picker, not free text ("Freshie" was the
  placeholder; a typo created an orphan venue).
- Export CSV and Submit selected are gated to managers in the UI, matching
  the API.
- `/stock-api/api/stocktake-templates` and `/stock-api/api/imports` are now
  mounted under the prefix like everything else.

## Process observations (not changed here)

Observations are from the code, the scripts' headers and the guides.
Assumptions are marked.

| # | Observation | Implication |
| --- | --- | --- |
| 1 | CI is `workflow_dispatch` only (Actions minutes exhausted) and frontends deploy manually from a Mac via `firebase deploy`. | Nothing runs between a merge and the venues. Assumption: this is why the DB-bound stocktake tests have never run in CI (they self-skip without `DATABASE_URL`). |
| 2 | `DEPLOYMENT.md` describes a managed-Postgres deploy; production is a VPS Docker Compose stack at `/opt/alma/deploy` (per `docs/backups.md`). The rebuild-before-migrate trap is documented only inside `scripts/prep-count-readiness.sh`. | A new operator following the docs would migrate the wrong way round. |
| 3 | Eighteen scripts target Cloud SQL via `cloud-sql-proxy`, including the old `merge-duplicate-items.sh`; the stocktake scripts target the VPS. | Running a Cloud SQL script writes to a database that may not be the live one. The in-app merge above replaces the script. |
| 4 | Batched cocktails and prep count in millilitres but recipes yield portions; "nothing knows how big a portion is" (`scripts/batch-yield-sheet.sh`). Seven of the bar's thirteen batch lines book nothing. | The sheet now prints prep lines with their yield unit and marks un-bookable ones, but the yields still have to be set per recipe. |
| 5 | Item data quality on the fixture used here graded POOR (no count unit on 22 of 31). The count sheet's unit column and the "1 case = 24 bottles" hint come straight from those fields. | Assumption: the printed sheet will expose missing count units immediately, which is the fastest way to get them fixed. |
| 6 | The variance report needs a previous LOCKED count and in production none had ever been locked. | Locking is now reachable from the history table; it still has to be done after each applied count. |
| 7 | The stocktake guides (`scripts/build-stocktake-guide.py`) describe the iPad and web flows; neither mentions the paper sheet. | Re-run the guide build after adding a "print, count, key in" section. |

## Suggested next missions
1. Paper-first flow on the iPad: open the sheet, key in per area, with the
   sheet's line numbers matching the app's rows (the API now keeps ids).
2. Turn CI back on for `pull_request` with `DATABASE_URL` pointing at a
   service Postgres so the ledger tests run.
3. Rewrite `DEPLOYMENT.md` for the VPS and retire the Cloud SQL scripts.
4. Per-recipe portion size so millilitre counts of batches book portions.
