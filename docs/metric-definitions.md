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
| **Source** | `Timesheet` rows (hours) costed with `lib/staff-pay-rates.ts: staffCostingRate` (award/agreed rate **incl. super**, overtime split) plus salaried staff's weekly fixed cost. |
| **Formula** | `wageCents = Σ hour-costed timesheets + Σ weeklyFixedCost(salaried) × elapsedPeriodWeeks`. `wagePercent = wageCents / salesCents`. `approvedWageCents` (APPROVED + EXPORTED only) is carried separately and is **not** what labour % uses. |
| **Who is salaried** | Decided by the **resolved** pay rate (`classifyLabourPopulation`: weekly fixed cost > 0), never by whether a pay-profile row exists. Every active worker is in exactly one of salaried / hourly / missing-rate; the forecast payload lists them (`labourPopulation`) and names staff with no rate instead of costing them at zero. |
| **Statuses** | Timesheets `DRAFT, SUBMITTED, APPROVED, EXPORTED` (REJECTED excluded). Roster estimate is used only when a venue has no timesheets (`sources.wages === 'roster_estimate'`). |
| **Venue scope** | `timesheet.venue`, falling back to the staff profile's venue. |
| **Period** | `workDate` in `[start, end)` as day keys. Salaried cost is booked for the **elapsed** weeks of the period (`@alma/shared elapsedPeriodWeeks`), so a half-elapsed month carries half its salaries, as it carries half its sales (decision 1). |
| **Freshness** | Live from timesheets; Deputy imports arrive on their schedule. |

## Food cost

Three figures. They are never substituted for one another silently.

### Theoretical (recipe) food cost

| | |
|---|---|
| **Source** | **One serve's** cost × units sold, per recipe-mapped Square item. `Recipe.estimatedCost` is the **batch** cost; `@alma/shared recipe-cost.ts: recipePortionCostCents` divides it by the batch's portions (yield ÷ serve size, else yield, else 1 — the recipe editor's rule). Reports: `menuProfitability`; Stock: `lib/cost-of-goods.ts: summariseTheoreticalCogs`; forecast, Square-mapping margin, dish-margin page and POS wastage read the same helper. The Recipe payload carries `portionCostCents` beside `estimatedCost`. |
| **Formula** | Σ (serve cost × qty) over rows with a cost, **excluding** rows where `isSuspectRecipeCost` (serve cost ≥ take per serve). After the per-serve fix this is a data-quality signal (a yield recorded in grams with no serve size), counted and shown, no longer the mechanism hiding batch costs. |
| **Percent** | Reports overview: theoretical ÷ **takings** (Sales above). Stock dashboard: theoretical ÷ **mapped item sales**. The two screens therefore show different percentages on purpose; each labels its denominator. |
| **Coverage** | Stock payload `coverage`: mapped / unmapped / zero-cost / suspect recipe counts. A zero-cost recipe keeps its sales in the denominator with no cost — the count is shown so the % can be judged. |

### Actual food cost (COGS)

| | |
|---|---|
| **Source** | `packages/db/src/cogs.ts: computeActualCogs` — the suite-wide canonical figure. |
| **Formula** | `opening stock + purchases − closing stock` when a valid finalised stocktake brackets **each** end (`source: stock_bounded`, `quality: complete`); otherwise `purchases` only (`source: purchases_only`) with `quality` naming the failed bracket — `missing_opening/closing` (no count on or before the boundary), `stale_opening/closing` (the latest count is older than the tolerance), `estimated` (neither), `closing_implausible` — and `reasons[]` spelling it out with the count date and age. Rules and arithmetic: `packages/db/src/cogs-core.ts` (pure, tested against a fake reader). |
| **Bracket rule** | A count brackets a boundary only when taken **on or before** it and no more than `STOCKTAKE_BRACKET_TOLERANCE_DAYS` (14 — the suite's existing "stale stocktake" limit, `@alma/shared stocktake-freshness.ts`) before it. A March count is not June's opening stock. |
| **Purchases** | `SupplierInvoice` subtotal (ex-GST; total when no subtotal parsed), `status ≠ DRAFT`, `triageStatus ≠ NO_ITEM`, `invoiceDate` in window. Venue figures also report `unattributedPurchasesCents` / `unattributedInvoiceCount` — invoices with no venue, in the group figure and in no venue's. **Group = Σ attributed venues + unattributed**; nothing is distributed. |
| **Stock values** | Latest valid `SUBMITTED/REVIEWED/LOCKED` count per venue, summing every session on that **venue day** (Sydney, not UTC). All-venues = Σ venues; when any venue that has ever counted has no valid bracket the group value is **unavailable and names the venue** — never the sum of the others. `openingStockCents` / `closingStockCents` are `null` when unavailable, never 0. |
| **Percent** | Reports: withheld (`null`) when invoices cover < 90 % of the period (`MIN_PURCHASE_COVERAGE`). Stock dashboard: shown as "% of mapped sales" only when `comparable` — which needs stocktake completeness **and** like-for-like scope: same window, same venue set, recipe-mapped items ≈ all item sales in the window, and no suspect/uncosted exclusions (`assessCogsComparability`, reasons listed on the card). Otherwise the whole-venue dollars are shown as such and no actual %, GP or variance is derived. |
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
| **Labour basis** | `labourBasis`: `timesheets`, `roster_estimate` (stands in only when no timesheets exist, and is labelled), or `missing` (no prime). |
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
| **Source** | `StocktakesSummary.latestCount` via the canonical stock-value rule (`@alma/db stockBracket`). |
| **Value** | The latest valid finalised count (per venue; Σ venues for the group). `status: stale` (older than 14 days) or `missing` (a venue short, named) carries **no** value. Never a sum over historical stocktakes — the old `totalValueCents` aggregated every line ever recorded. |

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
11. **COGS bracket tolerance.** Set to the existing 14-day stale-stocktake
    rule. If counts are meant to be monthly with a longer grace, say so
    and the one constant moves.
12. **Recipes with a yield in grams and no serve size.** `recipePortions`
    divides by the yield, which understates the serve cost; the editor
    warns but does not block. Decide whether such recipes should be
    excluded from theoretical COGS until a serve size is entered.

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
