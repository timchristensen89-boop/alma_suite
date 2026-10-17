import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Recipe, RecipesPayload, StockCogsComparison, StockCogsOverviewPayload, StockCogsRow, StockDashboardPayload } from '@alma/shared';
import { Card, EmptyState, PageHeader, Spinner } from '@alma/ui';
import { IconRecipes } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api, suiteApi } from '../lib/api';

/**
 * The Stock home page: cost of goods, nothing else.
 *
 * One row per venue plus the group. Each row shows this month so far, last
 * month and the year to date, every figure beside the same days a year
 * earlier, plus this month beside the same days of last month. The figures
 * come from the Xero profit and loss (accrual, ex-GST) through the suite
 * API, so they agree with the accounts rather than with the stock ledger.
 */

function money(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

function percent(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function change(value: number | null) {
  if (value === null) return null;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function monthName(iso: string) {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** One cell: COGS, its % of sales, and the prior figure with the change. */
function Figure({ c, priorLabel, column }: { c: StockCogsComparison; priorLabel: string; column: string }) {
  const delta = change(c.changePercent);
  // Lower cost of goods is the good direction.
  const tone = c.changePercent === null ? '' : c.changePercent <= 0 ? ' is-down' : ' is-up';
  return (
    <td className="cogs-cell" data-column={column}>
      <span className="cogs-value">{money(c.current.cogsCents)}</span>
      <span className="cogs-sub">{percent(c.current.cogsPercent)} of {money(c.current.salesCents)} sales</span>
      <span className={`cogs-prior${tone}`}>
        {priorLabel}: {money(c.prior.cogsCents)}
        {c.prior.cogsPercent !== null ? ` (${percent(c.prior.cogsPercent)})` : ''}
        {delta ? <b> {delta}</b> : null}
      </span>
    </td>
  );
}

function Row({ row }: { row: StockCogsRow }) {
  return (
    <tr className={row.venue ? '' : 'cogs-group-row'}>
      <th scope="row">{row.label}</th>
      <Figure column="This month so far vs last month" c={row.previousMonth} priorLabel={`${shortDate(row.previousMonth.priorFrom)}–${shortDate(row.previousMonth.priorTo)}`} />
      <Figure column="This month so far vs last year" c={row.monthToDate} priorLabel="Last year" />
      <Figure column={`${monthName(row.lastMonth.from)} vs last year`} c={row.lastMonth} priorLabel="Last year" />
      <Figure column="Year to date vs last year" c={row.yearToDate} priorLabel="Last year" />
    </tr>
  );
}

const GLANCE_DAYS = 30;
const GLANCE_ROWS = 5;

type Glance = {
  title: string;
  sellCents: number | null;
  costCents: number | null;
  units: number;
  netSalesCents: number;
  /** (sell − cost) × units, when both prices are known. */
  profitCents: number | null;
  marginPercent: number | null;
};

/** One dish's sales and margin at a venue, from the recipe list's sales join. */
function toGlance(recipe: Recipe, venue: string): Glance {
  const sellCents = recipe.venuePrices?.find((p) => p.venue === venue)?.salePriceCents ?? recipe.salePriceCents ?? null;
  const costCents = recipe.portionCostCents ?? null;
  const units = recipe.actualSales?.quantitySold ?? 0;
  const netSalesCents = recipe.actualSales?.netSalesCents ?? 0;
  // A zero cost means the recipe has no costed ingredients yet, not a free
  // dish: it is left out of Top earners along with the uncosted ones.
  // A cost under 2% of the price is a recipe with most ingredients uncosted,
  // not a 98% margin: it is left out of Top earners with the uncosted ones.
  const usableCost = sellCents !== null && costCents !== null && sellCents > 0 && costCents >= sellCents * 0.02;
  const margin = usableCost ? sellCents - costCents : null;
  return {
    title: recipe.title,
    sellCents,
    costCents,
    units,
    netSalesCents,
    profitCents: margin !== null ? Math.round(margin * units) : null,
    marginPercent: margin !== null && sellCents ? (margin / sellCents) * 100 : null
  };
}

function GlanceList({ title, hint, rows, render }: { title: string; hint: string; rows: Glance[]; render: (g: Glance) => string }) {
  return (
    <div className="glance-list">
      <h4>{title}<span>{hint}</span></h4>
      {rows.length === 0 ? <p className="subtle">Nothing sold in the window.</p> : (
        <ol>
          {rows.map((g) => (
            <li key={g.title}><span className="glance-name">{g.title}</span><span className="glance-figure">{render(g)}</span></li>
          ))}
        </ol>
      )}
    </div>
  );
}

function VenueGlance({ venue, recipes }: { venue: string; recipes: Recipe[] }) {
  const glances = useMemo(() => {
    // Dishes only (not prep batches), and only those the sales import knows:
    // a missing actualSales means "not mapped to the till yet", not "sold none".
    return recipes.filter((r) => !r.isPrepRecipe && r.actualSales).map((r) => toGlance(r, venue));
  }, [recipes, venue]);
  const sold = glances.filter((g) => g.units > 0);
  const top = [...sold].sort((a, b) => b.units - a.units).slice(0, GLANCE_ROWS);
  const earners = sold.filter((g) => g.profitCents !== null).sort((a, b) => (b.profitCents ?? 0) - (a.profitCents ?? 0)).slice(0, GLANCE_ROWS);
  const slow = [...sold].sort((a, b) => a.units - b.units || a.netSalesCents - b.netSalesCents).slice(0, GLANCE_ROWS);
  const unsold = glances.length - sold.length;
  const uncosted = sold.filter((g) => g.profitCents === null).length;
  return (
    <section className="glance-venue">
      <h3>{venue}<span className="subtle"> · last {GLANCE_DAYS} days · {sold.length} dishes sold{unsold > 0 ? ` · ${unsold} on the till with no sales` : ''}</span></h3>
      <div className="glance-grid">
        <GlanceList title="Top sellers" hint="by plates" rows={top} render={(g) => `${g.units.toLocaleString('en-AU')} · ${money(g.netSalesCents)}`} />
        <GlanceList title="Top earners" hint="gross profit and margin after ingredients" rows={earners} render={(g) => `${money(g.profitCents ?? 0)}${g.marginPercent !== null ? ` · ${g.marginPercent.toFixed(0)}%` : ''}`} />
        <GlanceList title="Slowest sellers" hint="fewest plates" rows={slow} render={(g) => `${g.units.toLocaleString('en-AU')} · ${money(g.netSalesCents)}`} />
      </div>
      {uncosted > 0 ? <p className="subtle">{uncosted} dish{uncosted === 1 ? '' : 'es'} sold without a usable recipe cost, so {uncosted === 1 ? 'it is' : 'they are'} missing from Top earners. <Link to="/recipes">Cost recipes →</Link></p> : null}
    </section>
  );
}

export function DashboardPage() {
  useDocumentTitle('Stock');
  const [cogs, setCogs] = useState<StockCogsOverviewPayload | null>(null);
  const [cogsError, setCogsError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<StockDashboardPayload | null>(null);
  const [glance, setGlance] = useState<Record<string, Recipe[]>>({});
  const [glanceError, setGlanceError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await suiteApi<StockCogsOverviewPayload>('/api/reports/cogs-overview');
        if (!cancelled) {
          setCogs(payload);
          setCogsError(null);
        }
      } catch (err) {
        if (!cancelled) setCogsError(err instanceof ApiError ? err.message : 'Could not load cost of goods.');
      }
    })();
    // The one operational number worth keeping on the home page: counts
    // waiting for review. Everything else lives on its own page.
    void (async () => {
      try {
        const payload = await api<StockDashboardPayload>('/api/items/dashboard');
        if (!cancelled) setDashboard(payload);
      } catch {
        /* the link to counts still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The at-a-glance lists: one recipe list per venue, with the sales join.
  const venues = useMemo(() => {
    const fromCogs = cogs?.rows.map((row) => row.venue).filter((v): v is string => Boolean(v)) ?? [];
    return fromCogs.length ? fromCogs : dashboard?.venues ?? [];
  }, [cogs, dashboard]);
  useEffect(() => {
    if (venues.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const entries = await Promise.all(venues.map(async (venue) => {
          const payload = await api<RecipesPayload>(`/api/recipes?withSales=${GLANCE_DAYS}&venue=${encodeURIComponent(venue)}`);
          return [venue, payload.recipes] as const;
        }));
        if (!cancelled) {
          setGlance(Object.fromEntries(entries));
          setGlanceError(null);
        }
      } catch (err) {
        if (!cancelled) setGlanceError(err instanceof ApiError ? err.message : 'Could not load dish sales.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venues.join('|')]);

  const first = cogs?.rows[0];
  const waiting = dashboard?.summary.readyForReviewStocktakes ?? 0;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Stock"
        title="Cost of goods"
        description={
          first
            ? `${monthName(first.monthToDate.from)} to ${shortDate(first.monthToDate.to)} · from Xero, ex GST · refreshed ${new Date(cogs!.lastRefreshed).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
            : cogsError
              ? 'Cost of goods is unavailable.'
              : 'Loading cost of goods…'
        }
        actions={
          <div className="stock-dashboard-headeractions">
            {waiting > 0 ? <Link className="btn btn-sm btn-secondary" to="/stocktake">{waiting} count{waiting === 1 ? '' : 's'} to review</Link> : null}
            <Link className="btn btn-sm" to="/stocktake">Take stock</Link>
          </div>
        }
      />

      <Card padding="none">
        {cogsError ? (
          <EmptyState icon={<IconRecipes size={24} />} title="Cost of goods unavailable" description={cogsError} />
        ) : !cogs ? (
          <Spinner label="Reading the Xero profit and loss" />
        ) : (
          <div className="stock-dashboard-table-scroll">
            <table className="cogs-table">
              <thead>
                <tr>
                  <th />
                  <th>
                    This month so far
                    <span className="cogs-head-sub">vs the same days last month</span>
                  </th>
                  <th>
                    This month so far
                    <span className="cogs-head-sub">vs the same days last year</span>
                  </th>
                  <th>
                    {monthName(first!.lastMonth.from)}
                    <span className="cogs-head-sub">vs {monthName(first!.lastMonth.priorFrom)}</span>
                  </th>
                  <th>
                    Year to date
                    <span className="cogs-head-sub">1 Jan–{shortDate(first!.yearToDate.to)} vs last year</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cogs.rows.map((row) => <Row key={row.label} row={row} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {cogs?.notes.length ? (
        <ul className="subtle cogs-notes">
          {cogs.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
      <Card title="At a glance" subtitle={`What sold, what earned and what did not move, per venue, over the last ${GLANCE_DAYS} days of till sales.`}>
        {glanceError ? <p className="error-text">{glanceError}</p> : venues.length === 0 ? <Spinner label="Loading dish sales" /> : (
          venues.map((venue) => glance[venue] ? <VenueGlance key={venue} venue={venue} recipes={glance[venue]!} /> : <Spinner key={venue} label={`Loading ${venue}`} />)
        )}
      </Card>

      <p className="subtle">
        Cost of goods is Xero's Cost of Sales for each venue's organisation (accrual basis, ex GST), so it matches the accounts.
        It is only as current as the bills entered in Xero. The stock ledger's own figure is under <Link to="/recipes">Recipes → Cost of goods</Link>.
      </p>
    </div>
  );
}
