import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockCogsComparison, StockCogsOverviewPayload, StockCogsRow, StockDashboardPayload } from '@alma/shared';
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

export function DashboardPage() {
  useDocumentTitle('Stock');
  const [cogs, setCogs] = useState<StockCogsOverviewPayload | null>(null);
  const [cogsError, setCogsError] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<StockDashboardPayload | null>(null);

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
      <p className="subtle">
        Cost of goods is Xero's Cost of Sales for each venue's organisation (accrual basis, ex GST), so it matches the accounts.
        It is only as current as the bills entered in Xero. The stock ledger's own figure is under <Link to="/recipes">Recipes → Cost of goods</Link>.
      </p>
    </div>
  );
}
