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
| **Scope** | Recipe `venue` (null = every venue). **Not** venue takings — unmapped items, bottled wine sold without a recipe etc. are outside it. |
| **Period** | `lookbackDays` venue days ending on the venue's today, inclusive (`salesLookbackWindow`). |
| **Shown as** | "Mapped item sales (30d)" with the mapped-dish count. |

## Labour (wages)

| | |
|---|---|
| **Source** | `Timesheet` rows (hours) costed with `lib/staff-pay-rates.ts: staffCostingRate` (award/agreed rate **incl. super**, overtime split) plus salaried staff's weekly fixed cost. |
| **Formula** | `wageCents = Σ hour-costed timesheets + Σ weeklyFixedCost(salaried) × weeksInPeriod`. `wagePercent = wageCents / salesCents`. `approvedWageCents` (APPROVED + EXPORTED only) is carried separately and is **not** what labour % uses. |
| **Statuses** | Timesheets `DRAFT, SUBMITTED, APPROVED, EXPORTED` (REJECTED excluded). Roster estimate is used only when a venue has no timesheets (`sources.wages === 'roster_estimate'`). |
| **Venue scope** | `timesheet.venue`, falling back to the staff profile's venue. |
| **Period** | `workDate` in `[start, end)` as day keys. Salaried cost is pro-rated by calendar weeks in the period, **not** by days traded so far (see open questions). |
| **Freshness** | Live from timesheets; Deputy imports arrive on their schedule. |

## Food cost

Three figures. They are never substituted for one another silently.

### Theoretical (recipe) food cost

| | |
|---|---|
| **Source** | `Recipe.estimatedCost` × units sold, per recipe-mapped Square item. Reports: `menuProfitability`; Stock: `lib/cost-of-goods.ts: summariseTheoreticalCogs`. |
| **Formula** | Σ (recipe cost × qty) over rows with a cost, **excluding** rows where `isSuspectRecipeCost` (cost ≥ take per serve — a batch spec costed per serve). Same exclusion in both apps (`@alma/shared cogs-quality`). |
| **Percent** | Reports overview: theoretical ÷ **takings** (Sales above). Stock dashboard: theoretical ÷ **mapped item sales**. The two screens therefore show different percentages on purpose; each labels its denominator. |
| **Coverage** | Stock payload `coverage`: mapped / unmapped / zero-cost / suspect recipe counts. A zero-cost recipe keeps its sales in the denominator with no cost — the count is shown so the % can be judged. |

### Actual food cost (COGS)

| | |
|---|---|
| **Source** | `packages/db/src/cogs.ts: computeActualCogs` — the suite-wide canonical figure. |
| **Formula** | `opening stock + purchases − closing stock` when finalised stocktakes bracket both ends (`source: stock_bounded`, `quality: complete`); otherwise `purchases` only (`source: purchases_only`, quality says which bound is missing or `closing_implausible`). |
| **Purchases** | `SupplierInvoice` subtotal (ex-GST; total when no subtotal parsed), `status ≠ DRAFT`, `triageStatus ≠ NO_ITEM`, `invoiceDate` in window. |
| **Stock values** | Latest `SUBMITTED/REVIEWED/LOCKED` stocktake per venue on or before the boundary; all-venues sums each venue's latest count. |
| **Percent** | Reports: withheld (`null`) when invoices cover < 90 % of the period (`MIN_PURCHASE_COVERAGE`). Stock dashboard: shown as "% of mapped sales" only when `comparable` (quality `complete`); otherwise the card says which method produced the dollars and that it is not a food-cost % yet. |
| **Rule** | **Purchases never silently become COGS.** Gross profit and variance on the actual figure exist only when it is stocktake-bounded. |

### Food cost on the Reports Overview (what feeds prime cost)

`lib/overview-costs.ts: buildOverviewCosts` picks **one** basis for the period
and every surface (hero sentence, tone, prime panel, trend bars, venue
table, donut, Stock section) reads it:

1. theoretical, when recipe-mapped sales exist for the period;
2. else actual, only when the API stands behind its percentage (coverage ≥ 90 %);
3. else **unavailable** — prime cost is `null` and the narrative says "labour only so far". Labour is never presented as the total.

Per-venue theoretical cost applies the same suspect-row exclusion as the
group total, so venues add to the group; a venue with no recipe rows gets a
sales-share estimate. The overview fetches menu profitability **unfiltered**
for the period (`data.overviewMenu`) so a Menu-tab filter cannot move it.

## Prime cost (total operating cost)

| | |
|---|---|
| **Formula** | `(wageCents + food cost cents) / salesCents`, with the food-cost basis above; `null` when food cost is unavailable or sales are zero. Components are rounded separately, so labour % + food % may differ from prime % by ≤ 0.1. |
| **Targets** | Labour 30 %, food 30 %, prime 60 % (`COST_TARGETS`); prime is overridden by the mean of admin per-venue `targetPrimeCostPercent`. |
| **Tone** | `costTone`: ≤ target positive, ≤ target + 5 warning, above danger, `null` or > 120 % neutral (> 120 % = "sales look short"). One rule for every pill and bar. |
| **Narrative** | `overviewNarrative` writes the sentence from the same object and names the period ("for 1 Sep to 30 Sep"), never "this week" by default. |
| **Elsewhere** | Monthly Recap (`recapRecommendations`) uses actual COGS and fixed 30/30/60 targets — a different, documented basis (see open questions). Week-ahead forecast uses the forecast engine's own COGS. |

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

| Figure | Definition |
|---|---|
| Outstanding liability | Σ `balanceCents` of `ACTIVE`, `testMode = false` cards. |
| Active cards | count of the same cards. |
| Expired retained | Σ balance on `EXPIRED` cards — reported, **not** in the liability. |
| Issued (lifetime) | Σ `initialValueCents` of `ACTIVE + REDEEMED` real cards, whenever issued (GiftUp imports, donations, campaign rewards included). |
| Drawn down | issued − live balance. Includes drawdown from before the GiftUp import and cancelled cards (balance zeroed by cancel). |
| Redemptions recorded | Σ `COMPLETED` redemptions on real cards (VOIDED and test-card redemptions excluded). |
| Unrecorded drawdown | drawn down − recorded: the part with no redemption row. |
| Issued this / last month | `paidAt` in the venue month, live statuses. Donations and COMP cards have no `paidAt` and are not "issued this month". |
| Redeemed this / last month | `redeemedAt` in the venue month. **Equals Σ `redeemedByVenue[].monthCents` by construction.** |
| By venue | `redemption.venue`; null → "Unallocated". Cards have no venue of their own. |
| By origin | `promoCodeSnapshot` / `saleChannel` markers: GIFTUP_IMPORT, PHYSICAL_COUNTER, DONATION, CAMPAIGN_REWARD:*, ONLINE, COUNTER. |

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
| Email | LIVE / SETUP_REQUIRED | LIVE when `RESEND_API_KEY` + a from address, or `SMTP_HOST/USER/PASS`, are set — the same variables the transport uses. |
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
- [ ] Stock section food % and "Total operating cost" match the overview.

**Stock › Dashboard**
- [ ] "Low stock" count and the "Needs attention" table agree (table non-empty whenever the count > 0; "Showing 10 of N" when more).
- [ ] Cost cards: theoretical % sits under theoretical $, actual % under actual $, and the actual card names its method. Actual GP and variance appear only when stocktakes bracket the window.
- [ ] "Mapped item sales" is labelled as such and is not venue takings.
- [ ] Venue picker offers only real venues (no "Both").

**Gift cards › Orders**
- [ ] Header liability and count equal the Revenue tile's liability and count.
- [ ] "Redeemed this month" equals the sum of the venue split beside it.
- [ ] Tiles read "—" while loading; no "$0 / No redemptions yet" flash.
- [ ] Liability note lists origins (GiftUp, online, …) and states expired retained balance separately.

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

1. **Salaried cost mid-period.** Prime cost charges salaried staff for the
   whole period (`primePeriodWeeks`) even when sales cover only the days
   traded so far, inflating labour % on an in-progress week. Pro-rate by
   days traded, or keep whole-week? (Unchanged.)
2. **Monthly Recap targets.** `recapRecommendations` uses fixed 30/30/60
   while the overview uses admin per-venue prime targets. Should the recap
   read the admin targets? (Unchanged.)
3. **Manager dashboard "pending timesheets".** No date window and exact
   venue match (no staff-profile fallback) — a third definition. Align to
   the home card's 30-day window, or keep as an all-time backlog?
4. **Timesheet REJECTED.** Counts as "needs a look" on the Timesheets page
   and hub badge but not as "awaiting approval" anywhere. Confirm.
5. **Marketing test gate.** "Simulate send" sets `simulatedAt`, which the
   live-send gate reads as "a test was sent within 24 h". Separating them
   needs a `testSentAt` column and a migration — do you want that?
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
10. **Roster instants vs UTC-midnight bounds.** Prime-cost roster hours are
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
