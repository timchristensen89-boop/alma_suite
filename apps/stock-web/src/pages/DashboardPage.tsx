import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockCostOfGoodsPayload, StockDashboardPayload } from '@alma/shared';
import { Badge, Card, EmptyState, PageHeader, Select, Spinner, StatCard } from '@alma/ui';
import { IconInvoices, IconItems, IconRecipes, IconStocktake, IconSuppliers } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

function formatQuantity(value: number | null | undefined, unit?: string | null) {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2
  }).format(value ?? 0);
  return unit ? `${formatted} ${unit}` : formatted;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function statusTone(status: string): 'danger' | 'warning' | 'positive' {
  if (status === 'OUT_OF_STOCK') return 'danger';
  if (status === 'LOW_STOCK') return 'warning';
  return 'positive';
}

function formatMoney(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toLocaleString(undefined, { style: 'currency', currency: 'AUD' });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const [dashboard, setDashboard] = useState<StockDashboardPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cogs, setCogs] = useState<StockCostOfGoodsPayload | null>(null);
  const [cogsError, setCogsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const query = selectedVenue ? `?venue=${encodeURIComponent(selectedVenue)}` : '';
        const payload = await api<StockDashboardPayload>(`/api/items/dashboard${query}`);
        if (!cancelled) {
          setDashboard(payload);
          if (!selectedVenue && payload.scope.venue) {
            setSelectedVenue(payload.scope.venue);
          }
          setError(null);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Could not load stock dashboard';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();

    return () => {
      cancelled = true;
    };
  }, [selectedVenue]);

  useEffect(() => {
    let cancelled = false;
    async function loadCogs() {
      try {
        const params = new URLSearchParams({ days: '30' });
        if (selectedVenue) params.set('venue', selectedVenue);
        const payload = await api<StockCostOfGoodsPayload>(`/api/recipes/cost-of-goods?${params.toString()}`);
        if (!cancelled) {
          setCogs(payload);
          setCogsError(null);
        }
      } catch (err) {
        // Unavailable is not "loading": the card used to spin forever here.
        if (!cancelled) {
          setCogs(null);
          setCogsError(err instanceof ApiError ? err.message : 'Could not load cost of goods');
        }
      }
    }
    loadCogs();
    return () => {
      cancelled = true;
    };
  }, [selectedVenue]);

  const venueOptions = [
    ...(dashboard?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...((dashboard?.venues ?? []).map((venue) => ({ label: venue, value: venue })))
  ];
  const activeVenue = selectedVenue || dashboard?.scope.venue || '';

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Stock"
        title="Stock dashboard"
        description={(() => {
          if (loading) return 'Loading stock signals…';
          if (error) return 'Could not refresh the stock dashboard.';
          const low = dashboard?.summary.lowStockItems ?? 0;
          const out = dashboard?.summary.outOfStockItems ?? 0;
          const draft = dashboard?.summary.readyForReviewStocktakes ?? 0;
          const parts: string[] = [];
          if (out > 0) parts.push(`${out} out of stock`);
          if (low > 0) parts.push(`${low} running low`);
          if (draft > 0) parts.push(`${draft} stocktake${draft === 1 ? '' : 's'} awaiting review`);
          if (parts.length === 0) return 'Everything is on the shelf and stocktakes are clear.';
          return `${parts.join(' · ')}.`;
        })()}
        actions={
          <div className="stock-dashboard-headeractions">
            {venueOptions.length > 0 ? (
              <Select
                label="Venue"
                value={selectedVenue}
                onChange={(event) => setSelectedVenue(event.currentTarget.value)}
                options={venueOptions}
              />
            ) : null}
            <Link className="btn btn-sm" to="/stocktake">Take stock</Link>
          </div>
        }
      />

      {/* The money first: what the mapped menu sold, what it cost on paper,
          what the bills say it cost, and what is left — over the last 30
          days. Each percentage sits under the dollar figure it was computed
          from, and the actual figure says which method produced it. */}
      <div className="stat-grid">
        <StatCard
          label="Mapped item sales (30d)"
          value={cogs ? formatMoney(cogs.mappedSalesCents) : '—'}
          hint={
            cogs
              ? `Square items mapped to recipes · ${cogs.coverage.mappedRecipes} dishes${activeVenue ? ` · ${activeVenue}` : ' · all venues'}`
              : 'Not venue takings — only items mapped to recipes'
          }
        />
        <StatCard
          label="Theoretical food & drink cost (30d)"
          value={cogs ? formatMoney(cogs.theoretical.cogsCents) : '—'}
          hint={
            cogs?.theoretical.percentOfMappedSales != null
              ? `${formatPercent(cogs.theoretical.percentOfMappedSales)} of mapped sales · recipe cost × units sold${cogs.coverage.zeroCostRecipes > 0 ? ` · ${cogs.coverage.zeroCostRecipes} uncosted` : ''}`
              : 'Recipe cost × units sold'
          }
          tone={cogs && cogs.coverage.zeroCostRecipes > 0 ? 'warning' : undefined}
        />
        <StatCard
          label={cogs && cogs.actual.source !== 'stock_bounded' ? 'Supplier purchases (30d)' : 'Actual food & drink cost (30d)'}
          value={cogs ? formatMoney(cogs.actual.cogsCents) : '—'}
          hint={
            cogs
              ? cogs.actual.comparable
                ? `${formatPercent(cogs.actual.percentOfMappedSales)} of mapped sales · ${cogs.actual.label}`
                : `${cogs.actual.label} — whole-venue figure, not a % of mapped sales`
              : 'Opening + purchases − closing, or bills only'
          }
          tone={cogs && !cogs.actual.comparable ? 'warning' : undefined}
        />
        <StatCard
          label="Gross profit (30d)"
          value={cogs && cogs.mappedSalesCents > 0 ? formatMoney(cogs.theoretical.grossProfitCents) : '—'}
          hint={
            cogs && cogs.mappedSalesCents > 0
              ? cogs.actual.comparable && cogs.actual.grossProfitPercent != null
                ? `${formatPercent(cogs.theoretical.grossProfitPercent)} on recipe cost · ${formatPercent(cogs.actual.grossProfitPercent)} on actual`
                : `${formatPercent(cogs.theoretical.grossProfitPercent)} on recipe cost · actual GP needs like-for-like scope (${cogs.actual.comparability.reasons[0] ?? 'see Cost of Goods'})`
              : 'Needs mapped sales in the window'
          }
          tone={cogs?.theoretical.grossProfitPercent != null && cogs.theoretical.grossProfitPercent < 60 ? 'warning' : undefined}
        />
      </div>

      {error ? <EmptyState icon={<IconItems size={24} />} title="Stock dashboard unavailable" description={error} /> : null}
      {loading ? <Spinner label="Loading stock dashboard" /> : null}

      <div className="stat-grid">
        <Link to="/items" className="stat-card-link" aria-label="Open catalogue items">
          <StatCard
            icon={<IconItems size={18} />}
            label="Items"
            value={loading ? '—' : String(dashboard?.summary.activeItems ?? 0)}
            hint={`${dashboard?.summary.categories ?? 0} categories`}
          />
        </Link>
        <Link to="/reorder" className="stat-card-link" aria-label="Open below-par list">
          <StatCard
            icon={<IconStocktake size={18} />}
            label="Low stock"
            value={loading ? '—' : String(dashboard?.summary.lowStockItems ?? 0)}
            hint={
              activeVenue
                ? `${dashboard?.summary.outOfStockItems ?? 0} out of stock at ${activeVenue}`
                : `${dashboard?.summary.outOfStockItems ?? 0} out of stock across venue stock`
            }
            tone={loading || !dashboard ? undefined : (dashboard.summary.lowStockItems ?? 0) > 0 ? 'warning' : 'positive'}
          />
        </Link>
        <Link to="/items" className="stat-card-link" aria-label="Open on hand stock">
          <StatCard
            icon={<IconSuppliers size={18} />}
            label="On hand"
            value={loading ? '—' : formatQuantity(dashboard?.summary.totalOnHand)}
            hint={activeVenue ? 'Tracked units at the selected venue' : 'Tracked units across venue stock'}
            tone={(dashboard?.summary.totalOnHand ?? 0) < 0 ? 'danger' : undefined}
          />
        </Link>
        <Link to="/stocktake" className="stat-card-link" aria-label="Open stocktakes ready for review">
          <StatCard
            icon={<IconInvoices size={18} />}
            label="Ready for review"
            value={loading ? '—' : String(dashboard?.summary.readyForReviewStocktakes ?? 0)}
            hint={`${dashboard?.summary.openStocktakes ?? 0} draft stocktakes`}
            tone={(dashboard?.summary.readyForReviewStocktakes ?? 0) > 0 ? 'warning' : 'neutral'}
          />
        </Link>
      </div>

      {/* Needs attention + stocktakes awaiting review are two halves of the
          same "what's off the shelf" question — paired via the suite's
          ov-two grid instead of stacking. */}
      <div className="ov-two st-dashboard-pair">
        <Card
          title="Needs attention"
          subtitle="Low-stock and out-of-stock items, most urgent first — the same rows the Low stock count above is made of."
          action={
            <Link className="btn btn-ghost btn-sm" to="/reorder">
              View below par
            </Link>
          }
          padding="none"
        >
          <div className="stock-dashboard-table-scroll">
            <table>
              <thead>
                  <tr>
                    <th>Item</th>
                    <th>Venue</th>
                    <th>Category</th>
                    <th>On hand</th>
                    <th>Par</th>
                    <th>Reorder</th>
                    <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {dashboard?.lowStockItems.length ? (
                  dashboard.lowStockItems.map((item) => (
                    <tr key={item.venueStockItemId ?? `${item.id}:${item.venue ?? 'global'}`}>
                      <td>
                        <span className="cell-stack">
                          <strong>{item.name}</strong>
                          <span className="subtle">{item.sku ?? 'No SKU'} · {formatDateTime(item.updatedAt)}</span>
                        </span>
                      </td>
                      <td>{(item.venue ?? activeVenue) || 'Unassigned'}</td>
                      <td>{item.category?.name ?? 'Uncategorised'}</td>
                      <td>{formatQuantity(item.onHand, item.unit)}</td>
                      <td>{formatQuantity(item.parLevel, item.unit)}</td>
                      <td>{item.reorderPoint === null ? '—' : formatQuantity(item.reorderPoint, item.unit)}</td>
                      <td>
                        <Badge tone={statusTone(item.stockStatus)} dot>
                          {item.suggestedAction}
                        </Badge>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="table-empty-cell">
                      {loading
                        ? 'Loading low-stock items…'
                        : error || !dashboard
                          ? 'Low-stock items are unavailable right now.'
                          : `No low-stock or out-of-stock items${activeVenue ? ` at ${activeVenue}` : ''} right now.`}
                    </td>
                  </tr>
                )}
                {dashboard && (dashboard.lowStockItemsTotal ?? dashboard.lowStockItems.length) > dashboard.lowStockItems.length ? (
                  <tr>
                    <td colSpan={7} className="table-empty-cell">
                      Showing the {dashboard.lowStockItems.length} most urgent of {dashboard.lowStockItemsTotal} items.{' '}
                      <Link to="/reorder">View all below par →</Link>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Stocktakes ready for review"
          subtitle="Submitted counts that have not yet been approved into the inventory ledger."
          action={
            <Link className="btn btn-ghost btn-sm" to="/stocktake">
              Review
            </Link>
          }
          padding="none"
        >
          <div className="stock-dashboard-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Stocktake</th>
                  <th>Venue</th>
                  <th>Lines</th>
                  <th>Variance lines</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {dashboard?.readyForReviewStocktakes.length ? (
                  dashboard.readyForReviewStocktakes.map((stocktake) => (
                    <tr key={stocktake.id}>
                      <td>{stocktake.name}</td>
                      <td>{stocktake.venue ?? 'Unassigned'}</td>
                      <td>{stocktake.lineCount}</td>
                      <td>{stocktake.varianceLineCount}</td>
                      <td>{formatDateTime(stocktake.submittedAt ?? stocktake.updatedAt)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty-cell">
                      {loading ? 'Loading stocktakes…' : error || !dashboard ? 'Stocktakes are unavailable right now.' : 'No submitted stocktakes are waiting for review.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card
        title="Cost of Goods"
        subtitle={`${cogs ? `${cogs.window.from} to ${cogs.window.to}` : 'Last 30 days'}. Theoretical (sold × recipe cost) vs actual (opening + purchases − closing when stocktakes bracket the window; otherwise supplier bills only, which is not comparable).`}
      >
        {cogsError ? (
          <EmptyState icon={<IconRecipes size={24} />} title="Cost of goods unavailable" description={cogsError} />
        ) : !cogs ? (
          <Spinner label="Loading cost of goods" />
        ) : cogs.dishMargin.mappedRecipes === 0 ? (
          <EmptyState
            icon={<IconRecipes size={24} />}
            title="No Square sales mapped to recipes yet"
            description="Theoretical COGS needs dishes mapped to Square items. Map recipes to Square sales under Recipes → Margins to see theoretical cost and variance. Actual purchases are still shown below."
          />
        ) : (
          <>
            {/* Sales, actual COGS, GP and variance lead the page now — this
                card keeps the recipe-side detail behind them. */}
            <div className="stat-grid">
              <StatCard
                icon={<IconRecipes size={18} />}
                label="Actual vs theoretical"
                value={cogs.varianceCents == null ? '—' : formatMoney(cogs.varianceCents)}
                hint={
                  cogs.variancePercent != null
                    ? `${formatPercent(cogs.variancePercent)} vs recipe cost of what sold`
                    : `Not comparable: ${cogs.actual.comparability.reasons.join('; ')}`
                }
                tone={cogs.variancePercent != null && Math.abs(cogs.variancePercent) > 15 ? 'warning' : undefined}
              />
              <StatCard
                icon={<IconRecipes size={18} />}
                label="Costing coverage"
                value={`${cogs.coverage.mappedRecipes} dishes`}
                hint={`${cogs.coverage.zeroCostRecipes} uncosted · ${cogs.coverage.suspectRecipes} batch-costed (excluded) · ${cogs.coverage.serveSizeRequiredRecipes} serve size required (excluded${cogs.coverage.serveSizeRequiredSalesCents > 0 ? `, ${formatMoney(cogs.coverage.serveSizeRequiredSalesCents)} of sales` : ''}) · ${cogs.coverage.unmappedRecipes} with no sales`}
                tone={cogs.coverage.zeroCostRecipes + cogs.coverage.suspectRecipes + cogs.coverage.serveSizeRequiredRecipes > 0 ? 'warning' : undefined}
              />
              <StatCard
                icon={<IconItems size={18} />}
                label="Avg dish margin"
                value={cogs.dishMargin.avgMarginPercent != null ? formatPercent(cogs.dishMargin.avgMarginPercent) : '—'}
                hint="Unweighted mean across dishes that sold"
              />
            </div>
            <p className="subtle" style={{ marginTop: 12 }}>
              Supplier price changes (30d): {cogs.priceMovement.increasedItems} item
              {cogs.priceMovement.increasedItems === 1 ? '' : 's'} up,{' '}
              {cogs.priceMovement.decreasedItems} down.{' '}
              <Link to="/price-movement">View price changes →</Link>
            </p>
          </>
        )}
      </Card>

      <Card title="Fast paths" subtitle="Jump into the stock tools without hunting through the menu.">
        <div className="stock-dashboard-links">
          <Link to="/stocktake">
            <IconStocktake size={18} />
            <span>Start or review a stocktake</span>
          </Link>
          <Link to="/items">
            <IconItems size={18} />
            <span>Manage items and categories</span>
          </Link>
          <Link to="/recipes">
            <IconRecipes size={18} />
            <span>Review recipe costing</span>
          </Link>
          <Link to="/invoices">
            <IconInvoices size={18} />
            <span>Match supplier invoice lines</span>
          </Link>
          <Link to="/deliveries">
            <IconInvoices size={18} />
            <span>Check a delivery invoice</span>
          </Link>
          <Link to="/wastage">
            <IconStocktake size={18} />
            <span>Record wastage</span>
          </Link>
          <Link to="/reorder">
            <IconItems size={18} />
            <span>Review reorder notices</span>
          </Link>
        </div>
      </Card>
    </div>
  );
}
