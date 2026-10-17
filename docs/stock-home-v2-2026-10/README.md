# Stock home page v2 (October 2026)

A refinement of the home page PR #332 shipped on 18 Oct: the Square figures
come back, the Xero cost-of-goods table opens up, the product lists become a
real table, and the cards stop blending into the page.

## What the page shows, top to bottom

**1. Sales — Square.** Three takings cards for the chosen scope (Group, St
Alma, Alma Avalon — the switch in the page header): this month so far, the
last 7 days and the last 30 days, each beside the same days last month (or the
7/30 days before) and the same days last year. Figures are the suite's Square
import (`SalesActualEntry`, one row per venue-day, ex GST, as Square reports
it) read through `GET /api/reports/sales/range` — one read for the last ~60
days and one for the same span a year earlier, then every window is summed in
the browser. Underneath, the four cards the old home page carried, restored
from git (`5b0046d4^`): mapped item sales, theoretical food & drink cost,
actual cost or supplier purchases, and gross profit on mapped sales — from
`GET /api/recipes/cost-of-goods?days=30&venue=`, one read per scope, kept.
They are Square item sales mapped to recipes, not venue takings, and say so.

**2. Cost of goods — Xero.** The #332 table (Group / St Alma / Alma Avalon ×
this month vs last month, this month vs last year, last full month, year to
date). Each row expands into revenue, cost of goods, COGS % of revenue, gross
profit and gross margin for all four periods, each with the prior figure and
the change, plus what the cost of goods is made of: Xero's food, beverage and
other Direct Costs, and the account lines behind them. The only derived
figures are gross profit (= revenue − cost of goods) and gross margin.
`StockCogsFigure` gained an optional `detail` (food/bev/other cents and the
account lines) that `cogs-overview.service.ts` now passes through from the
P&L read it already made — no new Xero calls.

**3. Product performance — Square item sales × Stock recipes.** Top sellers
(units), top earners (net sales less recipe cost), slowest sellers (fewest
units of those that sold; a checkbox adds dishes with no sales in the window).
Eight rows each, "View all" opens the full list in place with search, sortable
columns, a category filter, the venue switch and a 7/30/90-day period, paged
30 rows at a time. Data is the recipe list with its sales join
(`GET /api/recipes?withSales=N&venue=`), one read per venue and period, cached
for the page; the group view adds the same dish across venues.

Gross profit per dish is now **net sales − recipe cost × units**, not list
price × units: a dish sold mostly on a set menu used to show a 700% margin.
Margin is that profit over net sales, so it cannot exceed 100%. A recipe whose
cost is under 2% of what a unit fetched is treated as uncosted.

## Reading the changes

Every change badge is coloured by what it means: revenue and gross profit up
= green; cost of goods **as a share of sales** up = red; cost of goods in
dollars = grey (it should move with revenue). Percentage-point changes are
written "pp"; relative changes "%". A legend sits under the COGS table.

## Design

The home page sits on a deeper warm neutral (`#efe9dd`) with white cards,
`rgba(37,51,38,0.14)` borders and a soft shadow, so the cards read as cards.
The brand green `#253326` carries headings, the big figures, the segmented
switches and the expand controls. Section headers name the source. Styles are
scoped under `.stock-home`; nothing outside the home page changes.

## Not changed

No stock quantities, stocktakes, product costs or historical figures. No new
server endpoints. Permissions are the existing ones: the Stock API scopes
`cost-of-goods` and the recipe list as before, and the suite API's
`requireManager` + `salesVenueScope` guard the Square read.

## Tests

- `apps/api`: `cogs-overview.service.test.ts` (5) — windows, prior spans,
  Sydney date, rows, notes, and the new `detail` pass-through.
- `apps/stock-web`: `productMath.test.ts` (5) — profit from net sales, the 2%
  rule, group merge, sort order; `salesWindows.test.ts` (3) — the three
  windows, month/year clamping, scoped sums.
- Typecheck: api, stock-api, stock-web clean. `@alma/stock-web` builds.
- Browser (local Stock API on a production copy with Square item sales +
  mock suite API): search filters 142 → 8 on "taco", sort by net sales, venue
  and period switches re-fetch once per venue (no duplicate in-flight
  requests), COGS rows expand/collapse, mobile/iPad layouts.

## Screenshots

`screenshots/` — `before-*` is the page as deployed from #332, `after-*` this
branch: desktop (default, COGS expanded, all top sellers, all slow sellers),
iPad landscape and portrait, mobile. The suite-API figures (Square takings,
Xero COGS) in the "after" shots are the local mock's made-up numbers; the
product lists are real.
