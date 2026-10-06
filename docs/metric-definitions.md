# Metric definitions

_Source of truth for the operational numbers the suite shows. Each entry
names where the figure comes from, the formula, the venue scope, the period
and its timezone, which statuses are in or out, and how fresh it is. When a
screen and this document disagree, one of them is wrong — fix the screen or
this page, never both silently._

Conventions used throughout:

- **Venue day** — the calendar day in `Australia/Sydney` (DST-aware), via
  `packages/shared/src/venue-day.ts`. "Today", "this week" and "this month"
  always mean the venue's, never the browser's or the API container's (UTC).
- **Day keys** — `serviceDate`, `workDate`, `invoiceDate` are stored as UTC
  midnight of the venue day (`YYYY-MM-DDT00:00:00Z`). A window over them is a
  pair of day keys, half-open `[start, end)`.
- **Instants** — `startsAt`, `recordedAt`, `redeemedAt`, `paidAt` are real
  instants; windows over them use `venueDayBounds` / `venueMonthBounds`.
- **Percentages** — one decimal, `null` when the denominator is zero
  (`pct` in `reports.service.ts`; `pct` in `lib/overview-costs.ts`;
  `pct1` in stock-api `lib/cost-of-goods.ts`). A percentage is never shown
  without its numerator and denominator being the ones on screen.
- **Unavailable ≠ zero** — every headline distinguishes loading, failed,
  incomplete (flagged) and genuinely zero.

---

## Sales (takings)

| | |
|---|---|
| **Source** | `SalesActualEntry.salesCents`, one row per venue-day per source (Square sync, Lightspeed/Xero, manual entry). |
| **Formula** | Per venue-day the **largest** entry across sources is taken (`lib/sales-day-totals.ts: bestVenueDaySales`) so a day holding both a POS figure and a manual one is not double counted. Group sales = Σ over venues. |
| **Basis** | **Ex-GST, ex-tips, net of refunds.** Square: `(total − tip − refunded) / 1.1`. Lightspeed via Xero: invoice `SubTotal`. |
| **Venue scope** | Rows carry `venue`; reports include every venue the actor can reach. Legacy `"Both"` rollup rows are dropped from venue tables (`realVenueNames`). |
| **Period** | `serviceDate` in `[start, end)` as day keys. Presets ("this week", "this month", FY) are built from the **venue's today**. |
| **Freshness** | As of the last import. `ReportsPrimeCostPayload.sources.sales === 'missing'` when no rows exist. |
| **Not this** | The Stock dashboard's "Mapped item sales" is a *different* figure (below). |

## Mapped item sales (Stock dashboard only)

| | |
|---|---|
| **Source** | `SalesItemActualEntry.netSalesCents` for Square items mapped to a recipe (`recipeId` set). |
| **Formula** | Σ net sales of recipes that sold in the window, after excluding suspect batch-costed recipes. |
| **Scope** | The venue the items **sold at** (`SalesItemActualEntry.venue`); a shared (venue-null) recipe contributes only what it sold at the venue in view. Total item sales use the same venue filter. **Not** venue takings — unmapped items, bottled wine sold without a recipe etc. are outside it. |
| **Period** | `lookbackDays` venue days ending on the venue's today, inclusive (`salesLookbackWindow`). |
| **Shown as** | "Mapped item sales (30d)" with the mapped-dish count. |

## Labour (wages)

| | |
|---|---|
| **Source** | `reports.service.ts: labourPopulationFor` — **the one labour population**, never venue-filtered, for the Monthly Recap, the Prime Cost report (rows and total) and the forecast's trailing wage %: `Timesheet` rows (hours) costed with `lib/staff-pay-rates.ts: staffCostingRate` (award/agreed rate **incl. super**, overtime split in a fixed order) plus salaried staff's weekly fixed cost; a roster estimate per row kept separate. A venue report is **that venue's row of the same allocation** (`labourRowsFor(venue)` = `venueRow`), so it cannot differ from the group's row for that venue. Totals are `lib/labour-rows.ts: labourTotal` — Σ **actual** labour only; a row with no timesheets shows its roster estimate on that basis and the total reports `rosterOnlyWageCents` / `rosterOnlyVenues` for what it left out. (August 2026: the Prime Cost report's per-row `wageCents \|\| rosterWageEstimateCents` fallback put $193.22 of a roster-only "Both" row into a total labelled timesheets; the Recap had $85,607.23. Same rows now, same sum.) |
| **Allocation** | `lib/labour-allocation.ts: resolveLabourVenue` — every dollar is one of: **explicit** (the timesheet/shift names a configured venue, exact or evidenced alias), **profile** (it names none; the worker's profile venue is a configured venue — the domain's existing fallback, used by clock-out, the Deputy import and admin labour, now used by every report alike and reported as `profileFallbackWageCents`), **invalid** (the label written is not a venue — "Both", a person's name; kept under that label, `venueStatus: invalid`, in the group and in no venue, never guessed into a restaurant), **unassigned** (no label anywhere). Salaried shares are split by rostered hours across keys resolved the same way. Before this, the venue-scoped query filtered on `timesheet.venue` alone and the group attributed by profile: July 2026 Avalon read $41,151.54 in the venue report and $41,865.44 in the group's row ($713.90); August St Alma $856.80 the same way. Totals report `unallocatedWageCents` / `unallocatedVenues` and `profileFallbackWageCents`; the Recap period carries `wageAllocation`. |
| **Formula** | `wageCents = Σ hour-costed timesheets + Σ weeklyFixedCost(salaried) × elapsedPeriodWeeks`. `wagePercent = wageCents / salesCents`. `approvedWageCents` (APPROVED + EXPORTED only) is carried separately and is **not** what labour % uses. |
| **Who is salaried** | Decided by the **resolved** pay rate (`classifyLabourPopulation`: weekly fixed cost > 0), never by whether a pay-profile row exists. Every active worker is in exactly one of salaried / hourly / missing-rate; the forecast payload lists them (`labourPopulation`) and names staff with no rate instead of costing them at zero. |
| **Statuses** | Timesheets `DRAFT, SUBMITTED, APPROVED, EXPORTED` (REJECTED excluded). Roster estimate is used only when a venue has no timesheets (`sources.wages === 'roster_estimate'`). |
| **Venue scope** | The allocation above: explicit venue, else profile venue, else kept as invalid/unassigned. **Invariant**: Σ configured-venue rows + unallocated = group, to the cent, and each venue report equals its row. |
| **Period** | `workDate` in `[start, end)` as day keys. Salaried cost is booked for the **elapsed** weeks of the period, counted in **whole venue days** (`@alma/shared elapsedPeriodWeeks` takes `now` as the start of its Sydney day), so a half-elapsed month carries half its salaries, as it carries half its sales (decision 1). The cents come from one function, `salariedPeriodCents`, which every report consumes; before that, the Recap and the Prime Cost report each rounded `weekly × (continuous elapsed weeks)` at their own `new Date()` seconds apart, and September 2026 Alma Avalon read $29,626.63 on one and $29,626.64 on the other. |
| **Freshness** | Live from timesheets; Deputy imports arrive on their schedule. |

## Labour vs takings (Staff › Labour, `GET /api/staff/labour-week`)

The ROSTERED week priced against ACTUAL takings, per venue and for the
group, split kitchen / FOH / management. Engine: `apps/api/src/lib/labour-week.ts`
(pure, `labour-week.test.ts`); payload types in `@alma/shared labour-week.ts`;
audit script `apps/api/scripts/labour-week-reconcile.ts` prints the raw
takings rows, the per-shift table and the totals from the same engine.

| | |
|---|---|
| **Sales** | The Sales definition above (ex GST, net of refunds, ex tips, one figure per venue-day = the largest across feeds), on Sydney service dates, Monday to Sunday. Sales venue labels go through `resolveVenueLabel` so "Avalon" meets Alma Avalon's shifts. Never forecast. `salesDays` says how many of the 7 days have a figure; a day with none is `null`, not zero. |
| **Hours** | `RosterShift` PUBLISHED + COMPLETED, each on the Sydney day of its start. **Span** = start to end (what the roster board shows). **Paid** = span − `breakMinutes` (every break on a shift is treated as unpaid; the roster has no paid-break flag). Open shifts are `openHours`, not labour. Both figures are always shown; cost is on paid hours. |
| **Venue** | `resolveLabourVenue(shift.venue, profile.venue)`: the shift's own label first (explicit), the person's profile venue only when the shift has none (reported as `profile`), an unrecognised label kept under itself and flagged (`invalid`, in the group, in no venue — the week is `incomplete`). A cross-venue shift is counted once, at the venue it was worked. |
| **Department** | `classifyRosterDepartment`: the shift's `area`, then the shift's `roleTitle`, then the profile `roleTitle`; kitchen words beat management words ("Kitchen Manager" is kitchen), floor words beat management words. Nothing matching → `UNCLASSIFIED`, counted in the total, shown as such, never dumped into FOH. |
| **Cost** | `staffCostingRate(profile, configuredSuperRate)` — the one rate resolver (award / agreed rate **incl. super at the configured rate**; cash flat). Hourly: paid hours × rate. Salaried (resolved weekly fixed cost > 0): the fixed weekly salary ÷ 45h incl. super **whatever the hours**, plus 1.5× past 45 paid hours; the week's cost is spread over the person's shifts by paid hours so Σ days = Σ venues = week to the cent. A missing rate costs **nothing and flags the week** (`incomplete.uncostedHours`, `uncostedPeople`); it is never $0 under a reassuring %. Salaried staff with no shift this week are listed (`unrosteredSalaried`) and excluded. |
| **Not costed** | Saturday / Sunday / public-holiday penalties and casual loading as a multiplier are not in the suite's costing engine and are not applied here; the day carries `publicHoliday` so a flat figure is not read as holiday-aware. Timesheets (actual hours) are the Prime Cost report, not this. |
| **Percentages** | Every % is that bucket's cost over the SAME sales shown beside it. Group % = group cents / group sales — never the mean of venue percentages. Target: `resolveCostTargets` (Settings › Venues); variance shown only when a target is configured. |
| **Time** | Sydney days (`venueDayKey`); the client sends the Monday as YYYY-MM-DD and the server keys everything from it, so a device in Perth or Lisbon sees the same week. |

## Food cost

Three figures. They are never substituted for one another silently.

### Theoretical (recipe) food cost

| | |
|---|---|
| **Source** | **One serve's** cost × units sold, per recipe-mapped Square item. `Recipe.estimatedCost` is the **batch** cost; `@alma/shared recipe-cost.ts: recipePortionCostCents` divides it by the batch's portions (yield ÷ serve size, else yield, else 1 — the recipe editor's rule). Reports: `menuProfitability`; Stock: `lib/cost-of-goods.ts: summariseTheoreticalCogs`; forecast, Square-mapping margin, dish-margin page and POS wastage read the same helper. The Recipe payload carries `portionCostCents` beside `estimatedCost`. |
| **Formula** | Σ (serve cost × qty) over rows with a valid serve cost, **excluding** (a) recipes whose yield is by weight/volume (g, kg, mL, L) with no serve size — reason **`Serve size required`**, no per-serve cost is calculated for them (decision, Sept 2026) — and (b) rows where `isSuspectRecipeCost` (serve cost ≥ take per serve). Excluded rows leave numerator **and** the mapped-sales denominator; their sales are reported (`coverage.serveSizeRequiredRecipes`, `serveSizeRequiredSalesCents`, `excludedSalesCents`) and reduce coverage against all item sales, so the partial figure never reads as covering all food sales. The Recipe payload carries `portionCostReason`; menu-profitability rows carry `serve_size_required`. |
| **Percent** | Reports overview: theoretical ÷ **takings** (Sales above). Stock dashboard: theoretical ÷ **mapped item sales**. The two screens therefore show different percentages on purpose; each labels its denominator. |
| **Coverage** | Stock payload `coverage`: mapped / unmapped / zero-cost / suspect recipe counts. A zero-cost recipe keeps its sales in the denominator with no cost — the count is shown so the % can be judged. |

### Actual food cost (COGS)

| | |
|---|---|
| **Source** | `packages/db/src/cogs.ts: computeActualCogs` — the suite-wide canonical figure. |
| **Formula** | `opening stock + purchases − closing stock` when a **complete** count bounds **each** end (`source: stock_bounded`, `quality: complete`); otherwise `purchases` only (`source: purchases_only`) with `quality` naming the failed boundary — `missing_opening/closing` (no finalised count within the window), `incomplete_opening/closing` (counts exist in the window but do not make a complete, valued count of known scope), `estimated` (neither), `closing_implausible` — and `reasons[]` naming every count considered and why it was used or refused. Rules and arithmetic: `packages/db/src/cogs-core.ts: composeBoundary` (pure, tested against a fake reader). |
| **Scope** | `Stocktake.scope` ∈ FOOD, BEVERAGE, COMBINED, UNKNOWN (`@alma/shared stocktake-scope.ts`). Set from evidence only — a template's categories (all food → FOOD, all beverage → BEVERAGE), else its name ("Kitchen" / "Bar & FOH"), a Loaded sheet's headings, or a reviewed choice recorded in `scopeEvidence`. **Never inferred from the dollar value.** Every historical record is UNKNOWN (`docs/stocktake-scope-remediation.md` proposes reviewed values, record by record, no bulk backfill). A name never supports COMBINED. |
| **Valuation completeness** | `assessStocktakeValuation`: a count bounds COGS only when **no line counted above zero is unvalued** (linked or not; an unlinked line with Loaded's own value counts as valued; a counted zero is legitimate). No percentage threshold — the share of lines says nothing about the share of dollars, so a cut-off would pass a materially incomplete count on a plausible total. The refusal names how many lines. |
| **Boundary rule** | Candidates: finalised, known scope, sufficiently valued, within `STOCKTAKE_BOUNDARY_WINDOW_DAYS` (**±7**, symmetric) of the boundary. Complete = one COMBINED count, or one FOOD **and** one BEVERAGE count (purchases are food + beverage, so a food-only count against combined purchases is a population mismatch, however near the boundary: **completeness first, distance second**). Sessions of one scope on one venue day are one count. Per scope the nearest wins; ties go to the count on/before the boundary; a COMBINED count and a FOOD+BEVERAGE pair at equal distance → the single count. A composed boundary sums its components, keeps each one's ids/date/value/side (`components[]`), and its distance is the furthest component's; components more than 3 days apart still compose with an explicit `warnings[]` entry and no invented movement. The same instant is one month's close and the next month's open, and the rule is a pure function of the candidates around it — nothing drifts forward. Candidates not used are listed in `rejected[]` with `unknown_scope` / `unvalued` / `duplicate` / `no_counterpart`. |
| **Purchases** | `SupplierInvoice` subtotal (ex-GST; total when no subtotal parsed), `status ≠ DRAFT`, `triageStatus ≠ NO_ITEM`, `invoiceDate` in window. Venue figures also report `unattributedPurchasesCents` / `unattributedInvoiceCount` — invoices with no venue, in the group figure and in no venue's. **Group = Σ attributed venues + unattributed**; nothing is distributed. |
| **Stock values** | The composed boundary's value (`SUBMITTED/REVIEWED/LOCKED` only; sessions on one **venue day** — Sydney, not UTC — summed per scope). `openingStockCents` / `closingStockCents` are `null` when unavailable, never 0. |
| **Group population** | The **configured venues** (the `Venue` table) plus explicitly reported unattributed data — never every distinct string ever written into a stocktake's venue field. A stored label counts for a venue only through `@alma/shared venue-resolution.ts: resolveVenueLabel` (exact after normalisation, or an explicit evidenced alias). `Both`, `Unspecified`, blank and unknown Loaded location names (`St View`, `Alma`) are **off-venue counts**: listed on the bracket (`offVenueCounts`: label, date, value, why) and in the validation script, never required to bracket the group, never summed, never rewritten. A configured venue with no valid bracket makes the group **unavailable and is named**. |
| **Imports** | Both Loaded CSV importers and the Loaded PDF script resolve the location label through the same rule (configured venues = Settings › Venues) and store the configured venue or `null`, keeping the label in the notes; the Xero tenant resolver consults the rule first. An unknown venue is unattributed data, not a new restaurant. CSV imports are `scope: UNKNOWN` ("scope not reviewed"). The PDF script parses the **printed** count date (`parseLoadedCountedAt`: year from the printed weekday; refuses when it cannot place the date — the import time is never substituted; `--year` / `--counted-at` are explicit operator overrides recorded in `countedAtSource`), sets the scope from the sheet's headings (or `--scope`), and keeps unmatched sheet lines as unlinked lines at Loaded's valuation rather than dropping them. |
| **Purchases feed** | `@alma/shared invoice-feed.ts: assessInvoiceFeed` over the **whole** finalised invoice history before the period end: **cadence** (invoice activity spans ≥ 90 % of the elapsed period, first invoice to last plus one ordinary 7-day gap; periods under 7 days are `too_early`) and **regular-supplier absence**. A supplier is *expected* in a period when it was regular as of the period start (≥ 3 distinct invoice dates in the previous 90 days, last within 45 days) **or** was regular as of its own last invoice and has been silent since — an unresolved absence that is **carried forward** period after period until the supplier invoices again or is explicitly marked no longer expected (`Supplier.status = ARCHIVED`). Continued silence never reads as cessation. Absence is flagged once ≥ 14 days and ≥ 2× the supplier's longest gap have elapsed. Occasional suppliers (1–2 invoices) are never mandatory; no supplier is classified food/beverage by name; no dollar value decides whether a supplier matters. Output: status, coverage, elapsed days, first/last invoice, missing interval, expected / absent (with `carriedForward`, `absentForDays`) / not-expected suppliers, reason. `incomplete` withholds food % and prime; purchases stay visible as purchases. Meaning: "the expected feed appears complete enough for reporting" — never "every purchase verified". (Real data: FoodByUs and Paramount Liquor stopped mid-July; August flagged them, and September had read *complete* because the per-period rule alone had aged them out.) |
| **Percent** | Reports: withheld (`null`) when the invoice feed is `incomplete` or coverage < 90 % (`MIN_PURCHASE_COVERAGE`). Stock dashboard: shown as "% of mapped sales" only when `comparable` — which needs stocktake completeness **and** like-for-like scope: same window, same venue set, recipe-mapped items ≈ all item sales in the window, and no suspect/uncosted exclusions (`assessCogsComparability`, reasons listed on the card). Otherwise the whole-venue dollars are shown as such and no actual %, GP or variance is derived. |
| **Rule** | **Purchases never silently become COGS.** Gross profit and variance on the actual figure exist only when it is stocktake-bounded. |

### Food cost on the Reports Overview (what feeds prime cost)

`lib/overview-costs.ts: buildOverviewCosts` picks **one** basis for the period
and every surface (hero sentence, tone, prime panel, trend bars, venue
table, donut, Stock section) reads it:

1. theoretical (estimated consumption), when recipe-mapped sales exist for the period;
2. else stocktake-supported actual COGS (`cogsSource = stock_bounded`) with a percentage the API stands behind (coverage ≥ 90 %);
3. else **unavailable** — prime cost is `null` and the narrative says "labour only so far". Labour is never presented as the total, and **supplier purchases are never folded into prime**: a purchases-only figure is exposed as `purchasesCents` and labelled as purchases.

Per-venue cost applies the same suspect-row exclusion as the group total. A
venue with no attributable figure shows a dash — nothing is estimated for
it — and the object reports `venueCoverage` (complete / partial / none),
`venuesWithoutFoodCost` and `unattributedCogsCents`, with the invariant
Σ venue cogs + unattributed = group. The overview fetches menu profitability
**unfiltered** for the period (`data.overviewMenu`) so a Menu-tab filter
cannot move it.

**Import evidence vs performance.** `salesImport.incomplete` is true only on
evidence — the API's `salesDays` (most days any venue has a sales figure)
is fewer than the days the period has traded so far. A prime cost above
100 % is `lossMaking`: a severe result, shown red, never neutralised or
described as an import problem.

## Prime cost (labour + food — not "total operating cost")

| | |
|---|---|
| **Formula** | Overview: `(wageCents + food cost cents) / salesCents`, with the food-cost basis above; `null` when food cost is unavailable or sales are zero. Recap and Prime Cost report: `@alma/shared prime-cost.ts: resolvePrimeCost` — **prime = labour + actual food COGS only when the food figure is stocktake-bounded and supplier invoices cover ≥ 90 % of the period**; otherwise `primeCostCents` is `null`, `foodBasis = 'unavailable'`, purchases are shown as purchases, and `reasons[]` says why. Labour + purchases and labour + theoretical cost are never called prime. Components are rounded separately, so labour % + food % may differ from prime % by ≤ 0.1. |
| **Labour basis** | `labourBasis`: `timesheets`, `roster_estimate` (stands in only when no timesheets exist, and is labelled), or `missing` (no prime). A total is never a mix: it is Σ actual, with roster-only rows reported beside it. |
| **Purchases feed** | `purchaseFeed` on every period/row (see Actual food cost): `incomplete` → `foodBasis: unavailable`, `primeCostCents: null`, reason states the stalled interval or the absent established suppliers. |
| **Targets** | One source: `@alma/shared cost-targets.ts: resolveCostTargets` over Settings › Venues (`targetWagePercent`, `targetPrimeCostPercent`; food = prime − labour). Group = mean of configured venues; defaults 30/30/60 only when nothing is configured; `source` says which. Recap, Overview and forecast read the same resolver (decision 2). |
| **Tone** | `costTone`: ≤ target positive, ≤ target + 5 warning, above danger (however severe), `null` neutral. When the import is incomplete the tone is neutral and the caveat is shown alongside the reading. One rule for every pill and bar. |
| **Narrative** | `overviewNarrative` writes "Prime cost (labour + food) is …" from the same object and names the period ("for 1 Sep to 30 Sep"), never "this week" by default. |
| **Elsewhere** | Monthly Recap months are venue-local (`venueMonthBounds`). The week-ahead forecast's prime is a **projection** (forecast wages + forecast COGS at the trailing basis the payload labels: stock_bounded / purchases / theoretical / target / default) and is shown as a forecast, not as actual prime. |

## Low stock

| | |
|---|---|
| **Source** | `VenueStockItem` rows, `active`, item `ACTIVE`, via `@alma/shared low-stock.ts`. |
| **Threshold** | venue reorder point → venue par → item reorder point → item par. No positive threshold ⇒ never low. |
| **Low** | counted (`onHand` not null) and `onHand ≤ threshold`. |
| **Out of stock** | counted and `onHand ≤ 0`, threshold or not. |
| **Needs attention** | low **or** out — what the dashboard table shows, ranked empties first then by shortfall; capped at 10 with the total stated. |
| **Uncounted** | `onHand === null` is neither low nor out. |
| **Same rule in** | Stock dashboard headline and table, `/api/items/low-stock`, reorder page, Stock reports summary, Reports stock summary, manager daily brief (via the reports summary). |

## Stock on hand (Stocktake page, Reports overview "Latest stocktake value")

| | |
|---|---|
| **Source** | `StocktakesSummary.latestCount` via the canonical stock-value rule (`@alma/db stockBracket`) with the **operational freshness window** (`STOCKTAKE_STALE_DAYS`, 14 — a different question from the ±7-day period-boundary window). |
| **Value** | The latest **complete** count inside the window (per venue; Σ venues for the group): one COMBINED count or a FOOD + BEVERAGE pair, of known scope, sufficiently valued. `status: missing` (no finalised count in the window) or `incomplete` (counts exist but do not make a complete count; a venue short is named) carries **no** value and `reasons[]` says why. Never a sum over historical stocktakes — the old `totalValueCents` aggregated every line ever recorded. |

## Temperature status (Compliance)

| | |
|---|---|
| **Source** | `TemperatureAsset` (ACTIVE only) with its latest `TemperatureLog`, via `@alma/shared temperature-status.ts`. |
| **Out of range** | latest reading `status === 'OUT_OF_RANGE'` — a recorded failure, whenever it was taken. |
| **Missing today** | no reading with `recordedAt ≥` the venue's day start. A gap, not a failure. An asset can be both. |
| **Synced today** | `lastSyncAt ≥` venue day start. |
| **Overdue actions** | open issues past `dueDate` (`issues.overdue`) — from the issue board, worded as issues. |
| **Narrative** | `complianceAttentionLine`: one clause per count; severity from the worst clause (breach or open issue = red, gap alone = amber). |
| **Not yet** | There is no expected log cadence per asset; "missing" is strictly "none today". |

## Gift-card liability and redemptions

All from `lib/gift-card-ledger.ts: buildGiftCardLedger`, over **every** card
and every redemption, on the **venue month**. The card list on the Orders
page is the newest 100 matching the search and is never summed.

Two ledgers, kept apart: the **current position** (redeemable now) and the
**historical account** over every activated non-test card (ACTIVE, REDEEMED,
EXPIRED, CANCELLED), explained card by card. They reconcile by identity:

    issued = active balance + expired retained + redemptions recorded
           + unrecorded drawdown − over-recorded + cancelled written off

| Figure | Definition |
|---|---|
| Outstanding liability | Σ `balanceCents` of `ACTIVE`, `testMode = false` cards (current position). |
| Active cards | count of the same cards. |
| Expired retained | Σ balance on `EXPIRED` cards — reported, **not** in the liability. |
| Issued (lifetime) | Σ `initialValueCents` of every activated real card, whatever its status now (GiftUp imports, donations, campaign rewards, later-cancelled cards included). |
| Redemptions recorded | Σ `COMPLETED` redemptions on the same cards (VOIDED and test-card redemptions excluded). |
| Unrecorded drawdown | Σ per card of (face − balance − recorded on that card) where positive — drawdown with no row behind it (GiftUp pre-import history). Never netted against another card. |
| Over-recorded | Σ per card where recorded exceeds the card's own drawdown — a data problem, stated, never clamped. |
| Cancelled written off | `CANCELLED` cards: face − recorded (the cancel zeroed the balance). Recorded redemptions on cancelled cards stay in "recorded". |
| Drawn down | face − balance over non-cancelled activated cards = recorded (non-cancelled) + unrecorded − over-recorded. |
| Issued this / last month | `paidAt` in the venue month, activated statuses (a card cancelled later was still issued). Donations and COMP cards have no `paidAt`. |
| Redeemed this / last month | `redeemedAt` in the venue month. **Equals Σ `redeemedByVenue[].monthCents` by construction.** |
| By venue | `redemption.venue`; null → "Unallocated". Cards have no venue of their own. |
| By origin | `promoCodeSnapshot` / `saleChannel` markers: GIFTUP_IMPORT, PHYSICAL_COUNTER, DONATION, CAMPAIGN_REWARD:*, ONLINE, COUNTER. Active balance per origin sums to the liability; issued per origin sums to issued. |

The Reporting page (`/api/gift-cards/report`) keeps its own range-filtered
redemption figures; its liability is the same ACTIVE-balance definition. The
Reports app's gift-card count is live real cards, all time.

## Timesheet approval counts

| Surface | Definition |
|---|---|
| Staff home "Awaiting approval" | `status = SUBMITTED`, `workDate` in the last **30 venue days through today**, all venues the actor reaches (`resolveTimesheetWindow`). Labelled with that scope. |
| Timesheets page "Submitted" | `status = SUBMITTED` within the **navigated venue week** (or the chosen 30/90-day lookback) and venue filter. Labelled with the range. |
| Timesheets page "needs a look" / hub badge | `SUBMITTED` **or** `REJECTED` in the same range — a different, wider set on purpose (rejected sheets need the staff member's attention). |
| Manager dashboard "pending" | `SUBMITTED`, **no date window**, exact `venue` match only. Not changed; see open questions. |

Window rule (`lib/timesheet-window.ts`): a bare `YYYY-MM-DD` is that venue
day; an instant is read in the venue zone; a missing `end` runs through the
venue's today; a missing `start` is seven days before the end.

## Marketing send mode

| Channel | Mode | Rule (`lib/marketing-send-mode.ts`) |
|---|---|---|
| Email | LIVE / SIMULATION / SETUP_REQUIRED | LIVE only when **both** a provider (`RESEND_API_KEY` + a from address, or `SMTP_HOST/USER/PASS`) **and** `MARKETING_EMAIL_LIVE_SEND_ENABLED=true` are set (decision 5). Provider without the switch = SIMULATION (test sends to an operator still go through); switch without a provider = SETUP_REQUIRED. `liveCampaignSend` and automations refuse when the switch is off. |
| SMS | SIMULATION | No provider exists in the suite. |
| Social | LIVE / SIMULATION | `MARKETING_SOCIAL_LIVE_PUBLISH_ENABLED=true`. |

The marketing app's banner, Campaigns card and send controls are derived
from `overview.sendModes`; "Simulate send" never leaves the building in any
mode.

---

## Review checklist (changed screens)

Tick each against a browser set to a European timezone as well as Sydney.

**Reports › This Week / Overview**
- [ ] Hero sentence's prime % equals the big number in the prime panel and the Group total pill.
- [ ] Labour % + food % ≈ prime % (within 0.1). Hero tone matches the panel tone.
- [ ] Food column hint names the basis (recipes / actual / not available). When food cost is unavailable the hero says "Labour only so far" and prime shows "—".
- [ ] Changing a filter on the Menu Engineering tab does not change the overview food cost.
- [ ] Sentence names the period; switching to "This month" changes it.
- [ ] Trend bars use the same rule (each bar's tone follows the target).
- [ ] Stock section food % and "Prime cost" match the overview.
- [ ] Venue table: with a venue that has no recipe rows, that row shows a dash and the note names it; venue food-cost figures never sum to more than the group.
- [ ] With no stocktake bracketing the period and only supplier bills, prime shows "—" and the bills are listed as purchases, not food cost.
- [ ] A period whose costs exceed sales reads "Costs exceeded sales." in red; the import caveat appears only when sales days are short.

**Stock › Stocktakes**
- [ ] Every count in the lists shows its scope ("Food", "Beverage", "Combined", "Scope unknown") beside its template; a count started from a Kitchen template reads Food, from a Bar & FOH template Beverage, from "Full count" Scope unknown.
- [ ] The "Stock on hand" card shows a value only when the latest counts make a complete count (kitchen + bar, or a combined count) within 14 days, and otherwise says which side is missing or which count has no scope / unvalued lines.
- [ ] The create form's "What this count covers" defaults to "From the template"; choosing a value is recorded as a reviewed decision (`scopeEvidence`).

**Reports › Monthly Recap / Prime Cost**
- [ ] Recap and Prime Cost labour agree to the cent for the same period and venue; a Prime row with no timesheets shows "roster estimate" and the totals' warning names it.
- [ ] A venue's labour in its own report equals the group report's row for that venue; a row whose key is not a configured venue ("Both", a name) shows "(not a venue)" and the note under the table names the unallocated amount.
- [ ] A month whose regular supplier stopped invoicing the month before still shows food % and prime "—" with the supplier named as an unresolved, carried-forward absence.
- [ ] A period with a stalled invoice feed (or an established supplier absent) shows purchases as purchases, food % and prime "—", and the reason names the missing interval or the suppliers.
- [ ] A month whose only counts near a boundary are kitchen-only or bar-only shows COGS unavailable with the reason naming the count and the missing counterpart; Alma Avalon June 2026 must not read complete.

**Stock › Dashboard**
- [ ] "Low stock" count and the "Needs attention" table agree (table non-empty whenever the count > 0; "Showing 10 of N" when more).
- [ ] Cost cards: theoretical % sits under theoretical $, the actual card names its method, and actual %, GP and variance appear only when the card says the scope is like-for-like (expect them absent while any Square item is unmapped).
- [ ] "Mapped item sales" is labelled as such and is not venue takings.
- [ ] Venue picker offers only real venues (no "Both").

**Gift cards › Orders**
- [ ] Header liability and count equal the Revenue tile's liability and count.
- [ ] "Redeemed this month" equals the sum of the venue split beside it.
- [ ] Tiles read "—" while loading; no "$0 / No redemptions yet" flash.
- [ ] Liability note lists origins (GiftUp, online, …) and states expired retained balance separately; the Redeemed (lifetime) hint separates Alma-recorded, unrecorded (GiftUp history), over-recorded and cancelled write-offs.

**Compliance › Home and Temperatures**
- [ ] With N missing logs and 0 breaches the hint says "N temperature logs missing today" (amber), never "out of range".
- [ ] Temperatures page counts match `/api/summary` for the same venue filter; inactive assets excluded.
- [ ] Before data loads the dot is grey and rows show "…", not green zeros.
- [ ] Reports › Compliance "Out-of-range temperature assets" is no longer always 0.

**Staff › Home and Timesheets**
- [ ] Home "Awaiting approval" hint reads "worked in the last 30 days · all venues"; the Timesheets page "Submitted" card names its range; the numbers differ only by scope.
- [ ] From a European browser on a Sunday evening (Monday in Sydney) the Timesheets page opens on the Sydney week.

**Reserve**
- [ ] "Today" button and the "Tonight" header agree on the venue date from abroad; diary and dashboard show the same bookings for that day.

**Marketing**
- [ ] Banner tag/sentence and the Campaigns card subtitle agree; with no provider configured no "Send live"/"Test send" buttons render and the copy says simulation only; SMS campaigns never show live controls.

---

## Open business-definition questions

1. ~~Salaried cost mid-period~~ — **decided**: elapsed-period share (`elapsedPeriodWeeks`), implemented.
2. ~~Monthly Recap targets~~ — **decided**: one canonical, venue-capable source (`resolveCostTargets` over venue settings), implemented. Target storage stays in Settings › Venues; no new schema.
3. **Manager dashboard "pending timesheets".** (HOLD — Tim to confirm the operational meaning of pending.) No date window and exact
   venue match (no staff-profile fallback) — a third definition. Align to
   the home card's 30-day window, or keep as an all-time backlog?
4. **Timesheet REJECTED.** Decided in principle: a rejected timesheet is
   *unresolved*, not evidence of zero labour. HOLD on the temporary cost
   treatment (roster estimate or not) — until then REJECTED rows are still
   excluded from wage cost, and this is a known understatement.
5. ~~Simulate vs live~~ — **decided**: provider capability AND
   `MARKETING_EMAIL_LIVE_SEND_ENABLED` are both required, implemented.
   The `simulatedAt`-as-test-send question (a `testSentAt` column) remains
   open.
6. **Gift-card expiry.** EXPIRED cards keep their balance and are outside
   the liability; the purchase report still counts them as outstanding.
   Should expired balances be written off (adjustment rows) or shown as a
   separate liability line?
7. **Gift-card refunds / voids.** No void-redemption or adjustment endpoint
   exists; `VOIDED` is never written. POS refunds of gift-card tenders
   cannot be reversed in the register.
8. **Temperature cadence.** "Missing" means none today. If some assets are
   checked twice daily or hourly (Govee), define an expected cadence per
   asset before "overdue" can mean anything finer.
9. **Stock COGS venue scope.** `/api/recipes/cost-of-goods` is not scoped
   to the actor's venue (a pinned staff user can request another venue).
   Should it apply the same `actorVenueScope` as the items dashboard?
   (The figures themselves are now venue-scoped on both sides.)
10. **Roster instants vs UTC-midnight bounds / overnight shifts.** HOLD until
    the payroll source's treatment is traced; reporting must reconcile to
    it rather than invent an allocation.
11. ~~COGS bracket tolerance~~ — **decided**: period boundaries use a
    symmetric ±7-day window (`STOCKTAKE_BOUNDARY_WINDOW_DAYS`); operational
    freshness stays at 14 days (`STOCKTAKE_STALE_DAYS`) and is a separate
    question. Implemented.
13. ~~Stocktake scope~~ — **decided**: FOOD / BEVERAGE / COMBINED / UNKNOWN
    on every count, set from evidence, never from the value; a boundary is
    one COMBINED count or a FOOD + BEVERAGE pair; unvalued counted lines
    refuse the count. Implemented. **Open**: the reviewed scopes for the
    historical records (`docs/stocktake-scope-remediation.md`), and whether
    the Alma Avalon 30 June CSV export was a full count.
14. ~~Invoice-feed completeness~~ — **decided**: cadence + regular-supplier
    absence carried forward until resolved (`assessInvoiceFeed`).
    Implemented. **Open**: whether a `too_early` period (under 7 days) should
    show food % at all; and which of the currently absent suppliers, if any,
    should be marked ARCHIVED (the explicit "no longer expected" decision).
16. **Invalid venue labels in labour data.** "Both" is offered by the staff
    profile form (`StaffProfileForm.tsx`, `staff-web/pages/shared.tsx`) and
    reaches labour as a salaried home venue ($7,880.14 in June 2026) and as a
    roster-shift venue ($193.22 in August); September carries a timesheet
    whose venue field holds a person's name. Reported as `venueStatus:
    invalid`, kept in the group, in no venue. Decide whether "Both" remains a
    profile option and how those rows should be attributed; no record is
    changed until then.
15. **Component date gap.** FOOD and BEVERAGE components more than 3 days
    apart compose with a warning. If accounting requires _unavailable_
    instead, the constant is `STOCKTAKE_COMPONENT_GAP_WARNING_DAYS` and the
    test "components more than 3 days apart still compose" flips.
12. ~~Recipes with a yield in grams and no serve size~~ — **decided**:
    excluded with the reason `Serve size required`, implemented.

    **Roster instants vs UTC-midnight bounds.** Prime-cost roster hours are
    compared against UTC-midnight day keys (a 10-11 h shifted window). The
    wage figure comes from timesheets so it is unaffected, but roster
    hours/estimates for a period are. Worth a follow-up.

## Findings reported, not changed

- **Stale / test POS bills.** `PosOrder.status = 'OPEN'` has no date bound;
  `listOpenOrders` takes the newest 60, `closeDayStatus` counts every open
  bill (training bills included) and blocks close-of-day, `liveBoard`
  includes old bills, and QR ordering attaches to any open bill on a table.
  There is no stale-bill report. Decide a rule (e.g. open > 24 h, or from
  a previous `serviceDate`) before any bill is touched.
- **Public menu vs POS price.** Three hand-maintained price sources in
  `alma-web-platform` (`apps/web/data/menus.ts`, print food sheets, print
  drinks sheets) and POS prices in `Recipe.salePriceCents` +
  `RecipeVenuePrice` (fed by Square). The only comparison script
  (`apps/stock-api/scripts/seed-dish-menu.ts`) compares base recipe price
  against a 2026-08-22 transcription, not the live web data, and the web
  publisher would drop the `diet` field. Needs an agreed source of truth.
- **Venue names.** "St. Alma" (giftcards-web copy), "St.Alma", "stAlma",
  "Alma Freshwater" (company, not venue), and a bare "Alma" fallback in
  purchase orders; `Functions / Pop-up`, `Either venue`, `Both venues` as
  pseudo-venues; hardcoded venue lists in ~20 files. No records merged.
- **Stale unit costs.** `refreshRecipeEstimatedCost` keeps the previous
  cost when any line is uncosted; `configHealth` flags `stale-cost`
  (180 d) but nothing feeds it into margin confidence. The new `coverage`
  block shows uncosted / batch-costed counts; a staleness count would be
  the next step.
- **Notifications "out of range".** Both notification services list any
  `OUT_OF_RANGE` log ever recorded (top 5, UTC time label), so a recovered
  fridge stays an alert. Suggest latest-reading-only and venue time.
