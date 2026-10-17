import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockCogsOverviewPayload, StockDashboardPayload } from '@alma/shared';
import { PageHeader } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api, suiteApi } from '../lib/api';
import { ScopeSwitch, type Scope } from './dashboard/format';
import { SalesSection } from './dashboard/SalesSection';
import { CogsSection } from './dashboard/CogsSection';
import { ProductsSection } from './dashboard/ProductsSection';

/**
 * The Stock home page, three sections top to bottom:
 *
 *  1. Sales — Square takings per venue and for the group, with the mapped
 *     menu's sales, recipe cost and actual cost underneath.
 *  2. Cost of goods — the Xero profit and loss per venue and group, each
 *     row expandable into revenue, COGS, gross profit and the accounts.
 *  3. Product performance — top sellers, top earners and slowest sellers,
 *     each opening into a searchable table of every dish.
 *
 * Square is the sales source and Xero the accounting source; the page says
 * which under every section and never adds one to the other.
 */
export function DashboardPage() {
  useDocumentTitle('Stock');
  const [scope, setScope] = useState<Scope>('group');
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
    // Counts waiting for review — the one operational number kept up here.
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

  const venues = useMemo(() => {
    const fromCogs = cogs?.rows.map((row) => row.venue).filter((v): v is string => Boolean(v)) ?? [];
    return fromCogs.length ? fromCogs : dashboard?.venues ?? [];
  }, [cogs, dashboard]);
  const waiting = dashboard?.summary.readyForReviewStocktakes ?? 0;

  return (
    <div className="page-stack stock-home">
      <PageHeader
        eyebrow="Stock"
        title="Overview"
        description="Sales from Square, cost of goods from Xero, and what the menu is doing — Alma Avalon, St Alma and the group."
        actions={
          <div className="stock-dashboard-headeractions">
            {venues.length ? <ScopeSwitch scope={scope} venues={venues} onChange={setScope} /> : null}
            {waiting > 0 ? <Link className="btn btn-sm btn-secondary" to="/stocktake">{waiting} count{waiting === 1 ? '' : 's'} to review</Link> : null}
            <Link className="btn btn-sm" to="/stocktake">Take stock</Link>
          </div>
        }
      />
      <SalesSection scope={scope} venues={venues} />
      <CogsSection cogs={cogs} error={cogsError} />
      {venues.length ? <ProductsSection scope={scope} venues={venues} onScope={setScope} /> : null}
    </div>
  );
}
