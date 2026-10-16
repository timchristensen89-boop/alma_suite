# The phantom venue "Avalon" — root cause, blast radius, cleanup plan

Investigated 2026-10-16 against the read-only production clone `alma_stock_orig` and the
`alma-stock-simplify` repo (branch `feat/stock-count-simplify`, HEAD 29a7eb07). Nothing was written
to any database and no repo file was edited. All timestamps below are as stored (`timestamp without
time zone`, written by the API in UTC): 2026-09-01 01:39 UTC is 11:39 AEST on Tuesday 1 September.

## 1. Verdict in one paragraph

"Avalon" is not a venue anyone configured, seeded, imported or carried on a staff profile. It is a
string a stock manager typed into a **free-text Venue box** on the old "New stocktake" form at
01:39:31 UTC on 1 Sep 2026, on a form whose placeholder literally read `Freshie, Avalon…`, with the
form's defaults left in place (template "Full count" = every active item, name
`Stocktake ${new Date().toLocaleDateString()}` = "Stocktake 9/1/2026" on an en-US-locale device).
The API accepted the string unvalidated (`targetVenueForActor` passes any venue through for an
admin or a "Both" actor) and `ensureVenueStockRowsForLines` dutifully upserted one `VenueStockItem`
row per line for the new venue name: 830 rows, one per ACTIVE item. The same device created the real
"Alma Avalon — Bar & FOH 9/1/2026" count 30 minutes later with the same `countedAt` (01:39:00), which
is the restart-after-a-mistake pattern. The phantom was never counted, never submitted, never
applied, and nothing references it; it is safe to delete after snapshotting. The free-text box was
replaced by a select 36 hours later (commit 7bc7cfd8, 2 Sep 13:50 UTC) but the API still accepts an
arbitrary venue string, and every stock picker still *offers* "Avalon" because the pickers are built
from distinct stored values.

## 2. Database evidence

### 2.1 The phantom stocktake `cmti01rjj00qgoa01uhp30tw9`

| field | value |
|---|---|
| name | `Stocktake 9/1/2026` (US date order: `new Date().toLocaleDateString()` on an en-US browser) |
| venue | `Avalon` |
| template | `Full count` |
| status | `IN_PROGRESS` |
| countedAt | 2026-09-01 01:39:00 (`countedAtText`/`countedAtSource` null) |
| createdAt = updatedAt | 2026-09-01 01:39:31.368 — never touched after creation |
| submittedAt / submittedByUserId / reviewedAt / appliedAt / lockedAt | all null (no actor is recorded for an IN_PROGRESS create) |
| scope / scopeEvidence / notes / importSource | `UNKNOWN` / null / null / null |
| lines | **830** rows, all createdAt 01:39:31.368, positions 1–830, **0 countedQty, 0 stockValueCents, 0 location, 0 notes, 0 recipe lines**; 830 distinct itemIds; units: bottle 474, each 260, kg 58, bunch 12, L 8, punnet 5, keg 5, can 3, gram 1, box 1 |
| line order | alphabetical by label ("12cm Yellow Corn Tortilla 4.5", "2019 Cà di Bruno Barbaresco…") — the "Full count" path sorts every active item by name |
| references | `InventoryMovement.sourceStocktakeId` = 0 rows; `ShiftTaskAssignment.stocktakeId` = 0 rows; no `fc_stocktakes` link (that table carries no stocktake id) |

830 lines = exactly the 830 `StockItem` rows with `status = 'ACTIVE'` (851 total, 21 ARCHIVED). The
line itemId set is identical to the Avalon `VenueStockItem` set (set difference 0 both ways).

### 2.2 The 830 `VenueStockItem` rows with `venue = 'Avalon'`

- createdAt 01:39:31.656 → 01:39:32.805 (the upsert loop runs *after* the lines are created inside
  the same transaction — matches `createStocktake` → `ensureVenueStockRowsForLines`).
- `onHand` NULL on all 830; `parLevel` 0 on all 830; `reorderPoint` NULL on 829; `unitOverride` NULL
  on all; `active` true on all. Zero stock value, zero par, nothing ever edited (updatedAt = createdAt).
- Item-id waves: cmoqfb… 384, cmptov… 211, cmsdf1… 131, cmptow… 97, other 7 — i.e. one row for every
  active item regardless of wave, so **every one of the 232 duplicate clusters has a phantom holding**.
- Set comparison with the real venues: Avalon ⊇ Alma Avalon (829) and Avalon = St Alma (830). The one
  item Alma Avalon lacks is `cmoqfble0003s9ky2wvf7mtfg` "AGUAS MANSAS 700ML - (CASE OF 6)".
- Nothing references a `VenueStockItem` row by id (no inbound FKs); the only identity is
  `(venue, stockItemId)` (unique index `VenueStockItem_venue_stockItemId_key`).

Venue distribution today: Alma Avalon 829 rows (564 with onHand), **Avalon 830 (0 with onHand)**,
St Alma 830 (816 with onHand). Total 2,489.

### 2.3 The real Alma Avalon count the task thought was "the same minute"

`cmti14e7m02nooa01uz4i5l9a` "Alma Avalon — Bar & FOH 9/1/2026" was **created 02:09:33.678, thirty
minutes after the phantom**, not the same minute — but its `countedAt` is the identical
2026-09-01 01:39:00, and its name uses the same en-US `9/1/2026` format. Template
"Alma Avalon — Bar & FOH" (`tpl_avalon_bar`, venue stamped from the template), 436 lines (241
counted), submitted 03:31:41 by **Bianca Shepherd** (`cmoritcs8000z9k2kzt4zqa1i`, StaffProfile.venue
= `Both`, not admin), reviewed 2026-10-02 by Tim (`cmod6lvp600009kjyy6wc9yk0`). Reading: the form was
opened at 01:39 (that is where `countedAt` was captured), "Avalon" was typed and the default Full
count saved; the user then picked the venue template in the same page session and saved the proper
count at 02:09. Attribution is circumstantial — an IN_PROGRESS create stores no user id — but the
creator had to be a stock manager (`requireStockManager`: isAdmin / ADMIN / MANAGER) **and**
venue-unscoped (admin or venue "Both"), because a venue-pinned manager would have got
403 "Stocktake actions are limited to your venue". Bianca fits; Tim (admin) would also pass.

### 2.4 Where else "Avalon" lives — and does not

Scan of every `text` column named like `%venue%` (99 columns) for the exact value `Avalon`:

| table.column | rows | relevance |
|---|---|---|
| VenueStockItem.venue | 830 | the phantom |
| Stocktake.venue | 1 | the phantom |
| ReserveGuest.venue | 715 | reservations module (guest import) — a different domain, never read by Stock; shows the short label is in everyday use, which is why someone types it |
| everything else (StockTransfer from/to, StockWastageRecord, SupplierInvoice, SquareMenuRecipeMapping, Recipe, PurchaseOrder, StockDeliveryCheck, StockReorderNotice, StockSupplierOrder, StaffProfile, StocktakeTemplate, Timesheet, RosterShift, …) | 0 | — |

- `StaffProfile.venue` values: `''` 225, `St Alma` 144, `Alma Avalon` 30, `Both` 12, NULL 7,
  `Tim Christensen` 2 (two "Unallocated Bar/Floor Day" placeholder profiles created 2026-09-24 — a
  separate oddity, not stock-related), `Both venues` 1 (the TEST profile). **No profile has or (as
  far as any stored history shows) had `Avalon`.** There is no StaffProfile history table;
  `StaffManagementEvent` has 0 rows in the 01:30–02:15 window.
- `AppSettings.venues`: `Alma Avalon` (47 Old Barrenjoey Rd) and `St Alma` (20 Albert St) only.
- `Venue` table (created 2026-10-08, after the incident): `St Alma` / `st-alma`, `Alma Avalon` /
  `alma-avalon`.
- `StocktakeTemplate`: four rows created 2026-08-30 20:43 (`tpl_stalma_bar`, `tpl_stalma_kitchen`,
  `tpl_avalon_bar`, `tpl_avalon_kitchen`), venues `St Alma` / `Alma Avalon` only. A template could
  not have supplied "Avalon".
- `fc_venues`: codes `AVALON`/`FRESHWATER` with `legacyVenueName` = `Alma Avalon`/`St Alma` — the
  forecasting engine already treats "Avalon" as a code for Alma Avalon, never as a venue name.
- `IntegrationEvent` in the window: 20 routine Square/Xero scheduled syncs (St Alma + Alma Avalon
  sales/location imports every 15 min). No Loaded import, no stock import. Not a cause.
- A precedent with the same shape: `cmq49xa2i0001s601z7kg0l2q` "VOID — stray count (likely 2025) —
  08/06/2026", venue **blank**, template "Full count", 778 lines, IN_PROGRESS, created 2026-06-07 —
  the same free-text form saved with the venue left empty, later renamed VOID but never deleted.
  It is outside this task's scope but is the same defect.

## 3. Code: how the string got in, and why nothing stopped it

### 3.1 The form that was live on 1 Sep (commit 0fc7a66b, 31 Aug 18:19 UTC; lineage 86c1c2cf → f529254a)

`apps/stock-web/src/pages/StocktakePage.tsx` at that commit:

```ts
function emptyDraft(items, blind = true) {
  return {
    name: `Stocktake ${new Date().toLocaleDateString()}`,   // → "Stocktake 9/1/2026" on en-US
    venue: '',
    template: 'Full count',
    countedAt: formatDateTimeInput(new Date().toISOString()),
    status: 'IN_PROGRESS',
    lines: items.filter((item) => item.status === 'ACTIVE').map((item) => emptyLine(item, blind))
  };
}
…
<Input label="Venue" value={draft.venue} onChange={…update('venue', …)} placeholder="Freshie, Avalon…" />
<Input label="Template" … placeholder="Full count, Bar, Kitchen…" />
```

`git log -S'Freshie, Avalon'` shows the placeholder entered with the initial workspace (f529254a,
May 2026), survived 86c1c2cf (30 Aug, "let staff enter counts without handing them the whole stock
module") and was removed by **7bc7cfd8 "Stock: printable count sheet, duplicate item review and
merge, count process fixes" on 2 Sep 13:50 UTC** — which turned the box into a `<Select>` whose
options are the API's venue list, with a fallback of `['Alma Avalon', 'St Alma']`. The phantom was
created in the 36-hour gap before that fix shipped. (`git log -S"'Avalon'"` only turns up labour/tips
alias tests; no stock code ever literally used the string.)

`useStickyVenue` (`localStorage['alma-stock-venue']`) is used by Items, Reorder, Wastage, Staff usage
and Purchase orders pages, never by StocktakePage at any commit — ruled out as the source. Its stored
value is only ever one of the picker's options, so it could only *re-select* "Avalon", not invent it.

### 3.2 The API path (`apps/stock-api/src/services/stocktakes.service.ts`, unchanged on the PR branch)

```ts
function targetVenueForActor(requestedVenue, actor) {
  if (!actor || isVenueUnscopedActor(actor)) return requestedVenue ?? null;   // ← any string, verbatim
  if (!actor.venue) throw new HttpError(403, 'Stocktake actions require a venue-scoped manager.');
  if (requestedVenue && requestedVenue !== actor.venue) throw new HttpError(403, 'Stocktake actions are limited to your venue.');
  return actor.venue;
}
```

- `stocktakeCreateInputSchema.venue` is `z.string().optional().or(z.literal(''))` — no enum, no
  lookup. `assertKnownVenue` exists in items.service but `createStocktake`/`updateStocktake` never
  call it.
- `createStocktake` creates the row + lines, then `ensureVenueStockRowsForLines(tx, venue, itemIds)`
  upserts `{venue, stockItemId}` with `onHand: null, parLevel: item.parLevel, active: status==='ACTIVE'`
  for every line — so any new venue string instantly becomes a venue with a full catalogue of
  holdings. The 830 rows are that loop (createdAt 01:39:31.656–32.805, right after the lines).
- Route guard: `POST /api/stocktake` → `requireStockManager` (isAdmin / ADMIN / MANAGER).

### 3.3 Other candidate paths, all excluded

| path | why not |
|---|---|
| Staff profile venue | no profile carries "Avalon"; a pinned venue is stamped only for venue-scoped actors, and the only values are the two real ones |
| Sticky localStorage | not used by StocktakePage; values come from the picker |
| Template venue | all four templates carry real names; the phantom's template is the free-text "Full count" default |
| Loaded import | Loaded stocktakes are named "Loaded import · …" / "… (from Loaded)" with blank template; venue comes from the import's venue argument |
| `apps/stock-api/scripts/seed-count-sheets.ts` | `const VENUES = ['St Alma', 'Alma Avalon'] as const` (line 21); the other scripts mentioning Avalon use "Alma Avalon" |
| Square / Xero / Lightspeed sync | they never write Stocktake or VenueStockItem; the "Avalon" labels there (Lightspeed site, Xero tracking category) are resolved through `VENUE_ALIASES` in `packages/shared/src/venue-resolution.ts` (`avalon → Alma Avalon`) |

## 4. What the phantom does today (blast radius)

- **Every stock venue picker offers "Avalon".** `itemsService.venueOptions()` unions the `Venue`
  table, `VenueStockItem` distinct venues, `Stocktake` distinct venues and `StaffProfile` distinct
  venues, filtering only the pseudo-markers ("Both", …). `stock-operations.service.venuesForActor`,
  `stocktake-templates.service` and `purchase-orders.service` each take `VenueStockItem` distinct
  venues directly. So Items, Reorder notices, Wastage, Staff usage, Purchase orders, Templates and
  the PR's new Start-count card all list Avalon as a third venue, and a sticky
  `alma-stock-venue = 'Avalon'` in someone's browser keeps re-selecting it.
- **`stocktakesService.venueStatus()`** enumerates `Stocktake` distinct venues, so Avalon is
  reported as a venue with no finalised count ("poor").
- **Stock valuation is unaffected.** All 830 holdings are `onHand NULL` (→ $0), and the COGS bracket
  (`packages/db/src/cogs-core.ts`) only ever sums *configured* venues, mapping stored labels through
  `resolveVenueLabel` (where "avalon" is an explicit alias of Alma Avalon); an IN_PROGRESS count is
  never a candidate, so the phantom neither adds value nor blocks a bracket. `StockItem.onHand`
  recomputation sums venue rows with `?? 0`, so the NULLs contribute nothing.
- **Duplicate-resolution facts are polluted.** All 232 `scratchpad/facts/*.json` files carry
  "Stocktake 9/1/2026 / Avalon / IN_PROGRESS / countedQty null" lines and an Avalon holding per
  member (`valuation.json` is clean — it is real venues only). Reviewers must ignore venue
  "Avalon" entirely: it is not last-count evidence for anything.
- **If merges ran before cleanup**, `mergeItems` would (a) find a parent line *and* a duplicate line
  in the phantom stocktake for every cluster, fold null+null → null and delete the duplicate's line,
  and (b) sum/move the Avalon `VenueStockItem` rows onto each canonical item — harmless to values but
  it would carry the phantom into the cleaned catalogue and inflate the merge's "moved" counters.
  **Delete the phantom first, then merge.**

## 5. The PR branch (`feat/stock-count-simplify`) — does it close the hole?

Partly. `StartCountCard` (StocktakePage.tsx ~970–1100):

- Venue is a `<Select>`: options `['Not set', ...venues]` where `venues` is the `/api/items` payload's
  `venues` filtered by `isPseudoVenue`, falling back to `['Alma Avalon', 'St Alma']`; default is the
  signed-in user's venue when it is not a pseudo-marker, and choosing a template overwrites it with
  the template's venue. **No free text any more — good.**
- But (1) the option list is still the *stored-values* union, so it offers "Avalon" for as long as
  the phantom rows exist, and would offer any future typo the same way; (2) "Not set" (`''`) is still
  allowed and still creates a venue-less count (the June VOID precedent); (3) the **API is unchanged**
  — `stocktakeCreateInputSchema.venue` is any string and `targetVenueForActor` passes it through for
  admins and "Both" actors, so curl, an old tab, or the next form rewrite can recreate the phantom.

Proposed guard (for the PR or a follow-up, not applied here):

1. API, `createStocktake` and `updateStocktake`: after `targetVenueForActor`, when the venue is
   non-blank, resolve it with `resolveVenueLabel(venue, configuredVenues)` (configured = `Venue`
   table names, falling back to `AppSettings.venues`). Status `canonical` or `alias` → store the
   canonical name (so a stray "Avalon" becomes "Alma Avalon" instead of a new venue); `unknown` →
   `400 "Venue must be one of: Alma Avalon, St Alma"`. Also refuse blank venue on a template-less
   "Full count" unless the actor is admin (or at least warn in the UI) — the June stray count was
   this.
2. `ensureVenueStockRowsForLines`: refuse (throw) when `venue` is not a configured venue. This is
   the write that manufactures a venue; it should never create one.
3. `itemsService.venueOptions()` and the three direct `venueStockItem.findMany({distinct:['venue']})`
   callers: build from the `Venue` table (it exists since 2026-10-08) — stored distinct values should
   be a fallback only when the table is empty, and should pass through `realVenueNames` + a
   configured-venue filter.
4. Web `StartCountCard`: take options from a `/api/venues` (or settings) call, not from stored
   holdings; keep "Not set" only for admins, labelled "Unassigned (not recommended)".
5. Add a test to `apps/stock-api/tests/stock-hygiene.test.ts`: `POST /api/stocktake` with
   `venue: 'Avalon'` as an admin must 400 (or be stored as "Alma Avalon"), and must create zero
   `VenueStockItem` rows for a venue outside the configured list.

## 6. Cleanup plan (NOT executed — needs approval; run against production, not the clone)

Pre-conditions, all confirmed on the clone of 2026-10-16: no counted quantities, no values, no
notes, no movements, no task assignments, no transfers, no other table carries "Avalon". The
`Stocktake → StocktakeLine` FK is `ON DELETE CASCADE`; the explicit line delete is kept so the row
counts are asserted. Backup-table naming follows the existing convention
(`_stalma_manly_onhand_backup_20260719`, `_tips_import_backup_20260805`).

### 6.1 Snapshot, assert, delete — one transaction

```sql
BEGIN;

-- 1. Snapshot every row we are about to remove (full rows, types preserved).
CREATE TABLE _avalon_phantom_vsi_backup_20261016 AS
  SELECT * FROM "VenueStockItem" WHERE venue = 'Avalon';
CREATE TABLE _avalon_phantom_stocktake_backup_20261016 AS
  SELECT * FROM "Stocktake" WHERE id = 'cmti01rjj00qgoa01uhp30tw9';
CREATE TABLE _avalon_phantom_stocktake_line_backup_20261016 AS
  SELECT * FROM "StocktakeLine" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';

-- 2. Refuse to continue if production no longer matches what was reviewed.
DO $$
DECLARE n_vsi int; n_st int; n_ln int; n_counted int; n_mv int; n_task int; n_other_st int;
BEGIN
  SELECT count(*) INTO n_vsi FROM _avalon_phantom_vsi_backup_20261016;
  SELECT count(*) INTO n_st  FROM _avalon_phantom_stocktake_backup_20261016
    WHERE venue = 'Avalon' AND status = 'IN_PROGRESS' AND "submittedAt" IS NULL AND "appliedAt" IS NULL AND "lockedAt" IS NULL;
  SELECT count(*) INTO n_ln  FROM _avalon_phantom_stocktake_line_backup_20261016;
  SELECT count(*) INTO n_counted FROM _avalon_phantom_stocktake_line_backup_20261016
    WHERE "countedQty" IS NOT NULL OR "stockValueCents" IS NOT NULL OR notes IS NOT NULL;
  SELECT count(*) INTO n_mv   FROM "InventoryMovement"
    WHERE "sourceStocktakeId" = 'cmti01rjj00qgoa01uhp30tw9'
       OR "sourceStocktakeLineId" IN (SELECT id FROM _avalon_phantom_stocktake_line_backup_20261016);
  SELECT count(*) INTO n_task FROM "ShiftTaskAssignment" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';
  SELECT count(*) INTO n_other_st FROM "Stocktake" WHERE venue = 'Avalon' AND id <> 'cmti01rjj00qgoa01uhp30tw9';
  IF n_vsi <> 830 THEN RAISE EXCEPTION 'expected 830 Avalon VenueStockItem rows, found %', n_vsi; END IF;
  IF (SELECT count(*) FROM _avalon_phantom_vsi_backup_20261016 WHERE "onHand" IS NOT NULL) <> 0
     THEN RAISE EXCEPTION 'an Avalon holding has an onHand value — stop and look'; END IF;
  IF n_st <> 1 THEN RAISE EXCEPTION 'phantom stocktake is not the untouched IN_PROGRESS row reviewed'; END IF;
  IF n_ln <> 830 THEN RAISE EXCEPTION 'expected 830 phantom lines, found %', n_ln; END IF;
  IF n_counted <> 0 THEN RAISE EXCEPTION '% phantom lines carry a count/value/note', n_counted; END IF;
  IF n_mv <> 0 THEN RAISE EXCEPTION '% inventory movements reference the phantom', n_mv; END IF;
  IF n_task <> 0 THEN RAISE EXCEPTION '% shift tasks reference the phantom', n_task; END IF;
  IF n_other_st <> 0 THEN RAISE EXCEPTION '% other Avalon stocktakes exist', n_other_st; END IF;
END $$;

-- 3. Delete, children first.
DELETE FROM "StocktakeLine"  WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';           -- 830
DELETE FROM "Stocktake"      WHERE id = 'cmti01rjj00qgoa01uhp30tw9' AND venue = 'Avalon';   -- 1
DELETE FROM "VenueStockItem" WHERE venue = 'Avalon';                                        -- 830

-- 4. Prove it before committing.
DO $$
BEGIN
  IF (SELECT count(*) FROM "VenueStockItem" WHERE venue = 'Avalon') <> 0 THEN RAISE EXCEPTION 'Avalon holdings remain'; END IF;
  IF (SELECT count(*) FROM "Stocktake" WHERE venue = 'Avalon') <> 0 THEN RAISE EXCEPTION 'Avalon stocktake remains'; END IF;
  IF (SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9') <> 0 THEN RAISE EXCEPTION 'phantom lines remain'; END IF;
END $$;

COMMIT;
```

Expected row-count deltas (clone figures): `VenueStockItem` 2,489 → 1,659; `Stocktake` 35 → 34;
`StocktakeLine` 9,456 → 8,626. `StockItem` rows, `onHand`, costs and every real-venue holding are
untouched. Run it with `psql -v ON_ERROR_STOP=1 -1` (single transaction) so any RAISE aborts cleanly.

### 6.2 Rollback (restores byte-for-byte from the snapshots; safe to run even if partially applied)

```sql
BEGIN;
INSERT INTO "Stocktake"      SELECT * FROM _avalon_phantom_stocktake_backup_20261016      ON CONFLICT (id) DO NOTHING;
INSERT INTO "StocktakeLine"  SELECT * FROM _avalon_phantom_stocktake_line_backup_20261016 ON CONFLICT (id) DO NOTHING;
INSERT INTO "VenueStockItem" SELECT * FROM _avalon_phantom_vsi_backup_20261016            ON CONFLICT (venue, "stockItemId") DO NOTHING;
-- expect 1 / 830 / 830
COMMIT;
```

Keep the three backup tables for at least one month-end cycle; drop them only after the October
counts are reviewed (`DROP TABLE _avalon_phantom_*_backup_20261016;`).

### 6.3 What to verify afterwards

1. `GET /api/items` → `venues` is exactly `["Alma Avalon","St Alma"]`; `GET /api/stocktake-templates`
   → `venues` likewise; `GET /api/stocktake/venue-status` lists two venues.
2. In the web app: Items, Reorder, Wastage, Staff usage, Purchase orders venue pickers and the
   Start-count card show two venues. On any device that was scoped to "Avalon", the sticky
   `localStorage['alma-stock-venue']` will still hold the string — check that each page falls back
   to the server default rather than filtering to an empty venue; if not, clear the key
   (`localStorage.removeItem('alma-stock-venue')`) or ship the guard in §5 which filters it out.
3. Stock dashboard: the "No complete count for …" banner no longer names Avalon; stock value for
   Alma Avalon and St Alma is unchanged to the cent (it was $0 for Avalon).
4. The stocktake list no longer shows "Stocktake 9/1/2026 · Avalon"; the real
   "Alma Avalon — Bar & FOH 9/1/2026" (REVIEWED, 436 lines) is intact.
5. Re-run the cluster facts export so the 232 fact files stop carrying Avalon lines/holdings, then
   proceed with the duplicate-resolution merges.
6. Optional, same defect: decide on the June stray count `cmq49xa2i0001s601z7kg0l2q` (venue blank,
   778 empty lines, already renamed VOID) — same snapshot-then-delete recipe applies.

## 7. Key numbers

- 830 phantom `VenueStockItem` rows (= all 830 ACTIVE items; 0 with onHand, $0 value), created
  2026-09-01 01:39:31.656–32.805 UTC.
- 1 phantom `Stocktake` + 830 lines, 0 counted, 0 valued, 0 references; created 01:39:31.368 UTC.
- Real Alma Avalon count created 30 min later (02:09:33), same countedAt 01:39:00, submitted by
  Bianca Shepherd (venue "Both") at 03:31:41.
- "Avalon" elsewhere: only `ReserveGuest.venue` (715 rows, reservations domain). 0 staff profiles,
  0 templates, 0 settings, 0 stock movements/transfers/invoices/recipes.
- Defect window: free-text Venue input live from f529254a (May 2026) until 7bc7cfd8 (2 Sep 2026
  13:50 UTC); API venue validation still absent on `main` and on `feat/stock-count-simplify`.
- Facts pollution: 232 of 232 cluster files carry phantom lines; `valuation.json` is clean.
- Cleanup deltas: VenueStockItem 2,489 → 1,659; Stocktake 35 → 34; StocktakeLine 9,456 → 8,626.
