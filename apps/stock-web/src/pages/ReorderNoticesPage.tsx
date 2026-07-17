import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  StockMenuParRecommendation,
  StockMenuParRecommendationsPayload,
  StockReorderNoticesPayload,
  StockSupplierOrderEmailResult
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useStickyVenue } from '../hooks/useStickyVenue';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

function qty(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ''}`;
}

function tone(status: string): 'danger' | 'warning' | 'positive' {
  if (status === 'OUT_OF_STOCK') return 'danger';
  if (status === 'LOW_STOCK') return 'warning';
  return 'positive';
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function qualityTone(quality: StockMenuParRecommendation['dataQuality']): 'positive' | 'warning' | 'danger' | 'muted' {
  if (quality === 'READY') return 'positive';
  if (quality === 'NO_SUPPLIER' || quality === 'NO_PAR') return 'warning';
  if (quality === 'NO_SALES') return 'danger';
  return 'muted';
}

type OrderLine = {
  stockItemId: string;
  name: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  venue: string;
  quantity: string;
  unit: string;
  note: string;
};

export function ReorderNoticesPage() {
  useDocumentTitle('Below par');
  const [data, setData] = useState<StockReorderNoticesPayload | null>(null);
  const [recommendations, setRecommendations] = useState<StockMenuParRecommendationsPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useStickyVenue();
  const [loading, setLoading] = useState(true);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
  const [parDraft, setParDraft] = useState({ parLevel: '', reorderPoint: '' });
  const [savingPar, setSavingPar] = useState(false);
  const { user } = useAuth();
  const canManage = canManageStock(user);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [emailingSupplier, setEmailingSupplier] = useState<string | null>(null);
  const [emailResult, setEmailResult] = useState<StockSupplierOrderEmailResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(venue = selectedVenue) {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<StockReorderNoticesPayload>(`/api/operations/reorder-notices${query}`);
      setData(payload);
      if (!venue && payload.scope.venue) setSelectedVenue(payload.scope.venue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reorder notices.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [selectedVenue]);

  useEffect(() => {
    setRecommendations(null);
    setOrderLines([]);
    setEmailResult(null);
  }, [selectedVenue]);

  const venueOptions = [
    ...(data?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
  ];
  const stats = useMemo(() => ({
    notices: data?.notices.length ?? 0,
    out: data?.lowStockItems.filter((item) => item.stockStatus === 'OUT_OF_STOCK').length ?? 0,
    low: data?.lowStockItems.length ?? 0,
    menuReady: recommendations?.summary.readyToOrder ?? 0
  }), [data, recommendations]);

  const groupedOrderLines = useMemo(() => {
    const groups = new Map<string, OrderLine[]>();
    for (const line of orderLines) {
      const key = `${line.supplierId || line.supplierName}:${line.supplierEmail}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return Array.from(groups.entries()).map(([key, lines]) => ({ key, lines }));
  }, [orderLines]);

  async function updateNotice(id: string, status: 'RESOLVED' | 'DISMISSED') {
    setSavingId(id);
    try {
      await api(`/api/operations/reorder-notices/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update reorder notice.');
    } finally {
      setSavingId(null);
    }
  }

  function startEditPar(notice: { id: string; parLevel: number | null; reorderPoint: number | null }) {
    setEditingNoticeId(notice.id);
    setParDraft({
      parLevel: notice.parLevel == null ? '' : String(notice.parLevel),
      reorderPoint: notice.reorderPoint == null ? '' : String(notice.reorderPoint)
    });
  }

  // Edit the item's per-venue par + reorder point inline, then refresh — the
  // notice clears itself if the new threshold puts the item back in range.
  async function saveParEdit(notice: { stockItemId: string; venue: string }) {
    setSavingPar(true);
    try {
      await api(`/api/items/${notice.stockItemId}/venue-stock`, {
        method: 'PATCH',
        body: JSON.stringify({
          venue: notice.venue,
          parLevel: parDraft.parLevel === '' ? 0 : Number(parDraft.parLevel),
          reorderPoint: parDraft.reorderPoint === '' ? undefined : Number(parDraft.reorderPoint),
          active: true
        })
      });
      setEditingNoticeId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update par level.');
    } finally {
      setSavingPar(false);
    }
  }

  async function loadRecommendations() {
    setRecommendationsLoading(true);
    setEmailResult(null);
    try {
      const query = selectedVenue ? `?venue=${encodeURIComponent(selectedVenue)}` : '';
      const payload = await api<StockMenuParRecommendationsPayload>(`/api/operations/menu-par-recommendations${query}`);
      setRecommendations(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load menu par recommendations.');
    } finally {
      setRecommendationsLoading(false);
    }
  }

  function transferToOrderSheet() {
    if (!recommendations) return;
    const lines = recommendations.recommendations
      .filter((item) => item.suggestedOrderQuantity > 0 && item.supplier?.email)
      .map((item) => ({
        stockItemId: item.stockItemId,
        name: item.name,
        supplierId: item.supplier?.id ?? '',
        supplierName: item.supplier?.name ?? 'Supplier',
        supplierEmail: item.supplier?.email ?? '',
        venue: item.venue,
        quantity: String(item.suggestedOrderQuantity),
        unit: item.unit,
        note: `Menu-linked par review for ${item.venue}`
      }));
    setOrderLines(lines);
    setEmailResult(null);
  }

  function updateOrderLine(index: number, field: 'quantity' | 'note', value: string) {
    setOrderLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  function removeOrderLine(index: number) {
    setOrderLines((current) => current.filter((_, lineIndex) => lineIndex !== index));
  }

  async function emailSupplier(group: { key: string; lines: OrderLine[] }) {
    const first = group.lines[0];
    if (!first) return;
    setEmailingSupplier(group.key);
    setEmailResult(null);
    try {
      const result = await api<StockSupplierOrderEmailResult>('/api/operations/supplier-order-email', {
        method: 'POST',
        body: JSON.stringify({
          venue: selectedVenue || data?.scope.venue || first.venue || 'Alma',
          supplierId: first.supplierId,
          supplierName: first.supplierName,
          supplierEmail: first.supplierEmail,
          lines: group.lines.map((line) => ({
            stockItemId: line.stockItemId,
            name: line.name,
            quantity: Number(line.quantity),
            unit: line.unit,
            note: line.note
          }))
        })
      });
      setEmailResult(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send supplier order email.');
    } finally {
      setEmailingSupplier(null);
    }
  }

  return (
    <div className="page-stack">
      <Card title="Reorder notices" subtitle="Items below par or reorder point are listed here. Notices are deduped per venue and item.">
        <div className="stock-filter-toolbar">
          <Select label="Venue" value={selectedVenue} onChange={(event) => setSelectedVenue(event.currentTarget.value)} options={venueOptions} />
          <p className="subtle">{selectedVenue || data?.scope.venue ? `Watching ${selectedVenue || data?.scope.venue}.` : 'Watching all venue stock rows.'}</p>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Open notices" value={String(stats.notices)} hint="Deduped item/venue alerts" tone={stats.notices ? 'warning' : 'positive'} />
        <StatCard label="Out of stock" value={String(stats.out)} hint="Needs immediate action" tone={stats.out ? 'danger' : 'positive'} />
        <StatCard label="Below threshold" value={String(stats.low)} hint="Par or reorder point" tone={stats.low ? 'warning' : 'positive'} />
        <StatCard label="Menu order lines" value={String(stats.menuReady)} hint="From menu-linked stock" tone={stats.menuReady ? 'warning' : 'positive'} />
      </div>

      {error ? <EmptyState title="Reorder notices unavailable" description={error} /> : null}
      {loading ? <Spinner label="Loading reorder notices" /> : null}

      <Card title="Below par" subtitle="Mark replenished only when stock has been restocked; ignore for one-off exceptions." padding="none">
        {!loading && !data?.notices.length ? <EmptyState title="No reorder notices" description="Items above par will keep this list clear." /> : null}
        {data?.notices.length ? (
          <div className="stock-mobile-list">
            {data.notices.map((notice) => {
              const low = data.lowStockItems.find((item) => item.id === notice.stockItemId && item.venue === notice.venue);
              return (
                <Fragment key={notice.id}>
                <div className="stock-operation-row">
                  <span>
                    <strong>{notice.stockItem?.name ?? 'Unknown item'}</strong>
                    <span className="subtle">{notice.venue} · {notice.message}</span>
                    <span className="subtle">On hand {qty(notice.currentOnHand, notice.unit)} · Par {qty(notice.parLevel, notice.unit)} · Reorder {qty(notice.reorderPoint, notice.unit)}</span>
                    {notice.reorderQuantity ? <span className="subtle">Suggested order: {qty(notice.reorderQuantity, notice.unit)}</span> : null}
                  </span>
                  <span className="stock-operation-row-actions">
                    <Badge tone={low ? tone(low.stockStatus) : 'warning'}>{low?.suggestedAction ?? 'Below par'}</Badge>
                    {canManage ? (
                      <Button type="button" size="sm" variant="ghost" disabled={savingId === notice.id} onClick={() => startEditPar(notice)}>Edit par</Button>
                    ) : null}
                    <Button type="button" size="sm" variant="secondary" disabled={savingId === notice.id} onClick={() => void updateNotice(notice.id, 'RESOLVED')}>Mark replenished</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={savingId === notice.id} onClick={() => void updateNotice(notice.id, 'DISMISSED')}>Ignore</Button>
                  </span>
                </div>
                {editingNoticeId === notice.id ? (
                  <div className="stock-operation-row" style={{ gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <Input label={`Par level · ${notice.venue}`} type="number" min="0" step="0.01" value={parDraft.parLevel} onChange={(event) => { const v = event.currentTarget.value; setParDraft((d) => ({ ...d, parLevel: v })); }} />
                    <Input label="Reorder point" type="number" min="0" step="0.01" value={parDraft.reorderPoint} onChange={(event) => { const v = event.currentTarget.value; setParDraft((d) => ({ ...d, reorderPoint: v })); }} placeholder="Optional" />
                    <Button type="button" size="sm" disabled={savingPar} onClick={() => void saveParEdit(notice)}>{savingPar ? 'Saving…' : 'Save par'}</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={savingPar} onClick={() => setEditingNoticeId(null)}>Cancel</Button>
                  </div>
                ) : null}
                </Fragment>
              );
            })}
          </div>
        ) : null}
      </Card>

      <Card
        title="Menu par recommendations"
        subtitle="Reviews the last six months of sales actuals and only considers stock used by item recipes. Exact item-level POS sales are required before Alma can safely auto-increase par levels."
      >
        <div className="stock-order-action-row">
          <Button type="button" onClick={() => void loadRecommendations()} disabled={recommendationsLoading}>
            {recommendationsLoading ? 'Reviewing...' : 'Review six-month sales'}
          </Button>
          {recommendations ? (
            <Button type="button" variant="secondary" onClick={transferToOrderSheet} disabled={!recommendations.summary.readyToOrder}>
              Transfer to order sheet
            </Button>
          ) : null}
        </div>
        {recommendationsLoading ? <Spinner label="Reviewing menu par recommendations" /> : null}
        {recommendations ? (
          <div className="stock-recommendation-stack">
            <div className="stock-recommendation-summary">
              <Badge tone={recommendations.sales.source === 'missing' ? 'danger' : 'positive'}>
                {recommendations.sales.daysWithSales} sales days
              </Badge>
              <Badge tone="muted">Total sales {formatMoney(recommendations.sales.totalSalesCents)}</Badge>
              <Badge tone={recommendations.summary.missingItemSales ? 'warning' : 'positive'}>
                {recommendations.summary.missingItemSales ? 'Item-level sales missing' : 'Item-level sales connected'}
              </Badge>
              <Badge tone={recommendations.summary.missingSupplierCount ? 'warning' : 'positive'}>
                {recommendations.summary.missingSupplierCount} without supplier
              </Badge>
            </div>
            {recommendations.warnings.map((warning) => (
              <p key={warning} className="subtle">{warning}</p>
            ))}
            {recommendations.recommendations.length ? (
              <div className="table-scroll stock-recommendation-table">
                <table>
                  <thead>
                    <tr>
                      <th>Menu-linked item</th>
                      <th>Venue</th>
                      <th>Current</th>
                      <th>Recommended par</th>
                      <th>Order</th>
                      <th>Supplier</th>
                      <th>Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.recommendations.map((item) => (
                      <tr key={`${item.venue}:${item.stockItemId}`}>
                        <td>
                          <strong>{item.name}</strong>
                          <span className="subtle">{item.menuRecipeCount} menu recipe{item.menuRecipeCount === 1 ? '' : 's'} · {item.menuRecipes.slice(0, 2).map((recipe) => recipe.title).join(', ')}</span>
                        </td>
                        <td>{item.venue}</td>
                        <td>{qty(item.currentOnHand, item.unit)} on hand</td>
                        <td>{qty(item.recommendedParLevel, item.unit)}</td>
                        <td>
                          <strong>{qty(item.suggestedOrderQuantity, item.unit)}</strong>
                          <span className="subtle">{formatMoney(item.estimatedOrderCostCents)}</span>
                        </td>
                        <td>{item.supplier ? `${item.supplier.name}${item.supplier.email ? ` · ${item.supplier.email}` : ''}` : 'No supplier match'}</td>
                        <td><Badge tone={qualityTone(item.dataQuality)}>{item.dataQuality.replaceAll('_', ' ')}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No menu-linked stock items" description="Create item recipes with matched stock ingredients before running menu par recommendations." />
            )}
          </div>
        ) : null}
      </Card>

      <Card title="Supplier order sheet" subtitle="Transfer suggested quantities into supplier groups, then send an email where supplier email and Stock email configuration are available.">
        {emailResult ? (
          <div className="stock-order-email-result">
            <Badge tone={emailResult.status === 'SENT' ? 'positive' : 'warning'}>{emailResult.status === 'SENT' ? 'Sent' : 'Email setup needed'}</Badge>
            <p>{emailResult.status === 'SENT' ? `Sent to ${emailResult.supplierEmail}.` : emailResult.warning}</p>
            <pre>{emailResult.body}</pre>
          </div>
        ) : null}
        {!orderLines.length ? (
          <EmptyState title="No order sheet yet" description="Run menu par recommendations, then transfer suggested supplier-matched lines here." />
        ) : (
          <div className="stock-order-sheet">
            {groupedOrderLines.map((group) => {
              const first = group.lines[0];
              if (!first) return null;
              return (
                <section key={group.key} className="stock-order-supplier-group">
                  <div className="stock-order-supplier-head">
                    <span>
                      <strong>{first.supplierName}</strong>
                      <span className="subtle">{first.supplierEmail}</span>
                    </span>
                    <Button type="button" size="sm" onClick={() => void emailSupplier(group)} disabled={emailingSupplier === group.key}>
                      {emailingSupplier === group.key ? 'Sending...' : 'Email supplier'}
                    </Button>
                  </div>
                  <div className="stock-mobile-list">
                    {group.lines.map((line) => {
                      const lineIndex = orderLines.findIndex((candidate) => candidate.stockItemId === line.stockItemId && candidate.supplierEmail === line.supplierEmail);
                      return (
                        <div key={`${line.supplierEmail}:${line.stockItemId}`} className="stock-operation-row stock-order-line">
                          <span>
                            <strong>{line.name}</strong>
                            <span className="subtle">{line.unit}</span>
                          </span>
                          <span className="stock-order-line-controls">
                            <Input label="Qty" type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => updateOrderLine(lineIndex, 'quantity', event.currentTarget.value)} />
                            <Input label="Note" value={line.note} onChange={(event) => updateOrderLine(lineIndex, 'note', event.currentTarget.value)} />
                            <Button type="button" size="sm" variant="ghost" onClick={() => removeOrderLine(lineIndex)}>Remove</Button>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
