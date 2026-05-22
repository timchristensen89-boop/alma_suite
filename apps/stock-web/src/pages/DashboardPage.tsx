import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StockDashboardPayload } from '@alma/shared';
import { Badge, Card, EmptyState, Select, Spinner, StatCard } from '@alma/ui';
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

export function DashboardPage() {
  useDocumentTitle('Overview');
  const [dashboard, setDashboard] = useState<StockDashboardPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const venueOptions = [
    ...(dashboard?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...((dashboard?.venues ?? []).map((venue) => ({ label: venue, value: venue })))
  ];
  const activeVenue = selectedVenue || dashboard?.scope.venue || '';

  return (
    <div className="page-stack">
      <Card
        title="Stock control"
        subtitle="Operational inventory signals, low-stock items, and stocktakes waiting for review."
        action={
          <div className="stock-dashboard-actions">
            <Link className="btn btn-secondary btn-sm" to="/stocktake">
              Stocktake
            </Link>
            <Link className="btn btn-primary btn-sm" to="/items">
              Items
            </Link>
          </div>
        }
      >
        <p className="subtle">
          Stock item balances are changed only through ledger-backed approval,
          correction, or reversal flows. Submitting a stocktake keeps it ready
          for review.
        </p>
        {venueOptions.length > 0 ? (
          <div className="stock-filter-toolbar stock-dashboard-toolbar">
            <Select
              label="Venue scope"
              value={selectedVenue}
              onChange={(event) => setSelectedVenue(event.currentTarget.value)}
              options={venueOptions}
            />
            <p className="subtle">
              {activeVenue
                ? `Showing venue stock signals for ${activeVenue}.`
                : dashboard?.scope.admin
                  ? 'Showing venue stock signals across all configured venues.'
                  : 'Venue-scoped managers only see their permitted venue.'}
            </p>
          </div>
        ) : null}
      </Card>

      {error ? <EmptyState icon={<IconItems size={24} />} title="Stock dashboard unavailable" description={error} /> : null}
      {loading ? <Spinner label="Loading stock dashboard" /> : null}

      <div className="stat-grid">
        <StatCard
          icon={<IconItems size={18} />}
          label="Catalogue items"
          value={loading ? '—' : String(dashboard?.summary.activeItems ?? 0)}
          hint={`${dashboard?.summary.categories ?? 0} categories`}
        />
        <StatCard
          icon={<IconStocktake size={18} />}
          label="Low stock"
          value={loading ? '—' : String(dashboard?.summary.lowStockItems ?? 0)}
          hint={
            activeVenue
              ? `${dashboard?.summary.outOfStockItems ?? 0} out of stock at ${activeVenue}`
              : `${dashboard?.summary.outOfStockItems ?? 0} out of stock across venue stock`
          }
          tone={(dashboard?.summary.lowStockItems ?? 0) > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          icon={<IconSuppliers size={18} />}
          label="On hand"
          value={loading ? '—' : formatQuantity(dashboard?.summary.totalOnHand)}
          hint={activeVenue ? 'Tracked units at the selected venue' : 'Tracked units across venue stock'}
        />
        <StatCard
          icon={<IconInvoices size={18} />}
          label="Ready for review"
          value={loading ? '—' : String(dashboard?.summary.readyForReviewStocktakes ?? 0)}
          hint={`${dashboard?.summary.openStocktakes ?? 0} draft stocktakes`}
          tone={(dashboard?.summary.readyForReviewStocktakes ?? 0) > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <div className="stock-dashboard-grid">
        <Card
          title="Needs attention"
          subtitle="Low-stock and out-of-stock items, sorted by most recent change."
          action={
            <Link className="btn btn-ghost btn-sm" to="/items">
              View items
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
                      No low-stock items right now.
                    </td>
                  </tr>
                )}
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
                      No submitted stocktakes are waiting for review.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

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
