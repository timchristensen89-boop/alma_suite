import { useEffect, useMemo, useState } from 'react';
import type { StockReorderNoticesPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Select, Spinner, StatCard } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

function qty(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ''}`;
}

function tone(status: string): 'danger' | 'warning' | 'positive' {
  if (status === 'OUT_OF_STOCK') return 'danger';
  if (status === 'LOW_STOCK') return 'warning';
  return 'positive';
}

export function ReorderNoticesPage() {
  useDocumentTitle('Reorder notices');
  const [data, setData] = useState<StockReorderNoticesPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
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

  const venueOptions = [
    ...(data?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
  ];
  const stats = useMemo(() => ({
    notices: data?.notices.length ?? 0,
    out: data?.lowStockItems.filter((item) => item.stockStatus === 'OUT_OF_STOCK').length ?? 0,
    low: data?.lowStockItems.length ?? 0
  }), [data]);

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
      </div>

      {error ? <EmptyState title="Reorder notices unavailable" description={error} /> : null}
      {loading ? <Spinner label="Loading reorder notices" /> : null}

      <Card title="Current reorder list" subtitle="Resolve only when stock has been replenished; dismiss for one-off exceptions." padding="none">
        {!loading && !data?.notices.length ? <EmptyState title="No reorder notices" description="Items above par will keep this list clear." /> : null}
        {data?.notices.length ? (
          <div className="stock-mobile-list">
            {data.notices.map((notice) => {
              const low = data.lowStockItems.find((item) => item.id === notice.stockItemId && item.venue === notice.venue);
              return (
                <div key={notice.id} className="stock-operation-row">
                  <span>
                    <strong>{notice.stockItem?.name ?? 'Unknown item'}</strong>
                    <span className="subtle">{notice.venue} · {notice.message}</span>
                    <span className="subtle">On hand {qty(notice.currentOnHand, notice.unit)} · Par {qty(notice.parLevel, notice.unit)} · Reorder {qty(notice.reorderPoint, notice.unit)}</span>
                    {notice.reorderQuantity ? <span className="subtle">Suggested order: {qty(notice.reorderQuantity, notice.unit)}</span> : null}
                  </span>
                  <span className="stock-operation-row-actions">
                    <Badge tone={low ? tone(low.stockStatus) : 'warning'}>{low?.suggestedAction ?? 'Below par'}</Badge>
                    <Button type="button" size="sm" variant="secondary" disabled={savingId === notice.id} onClick={() => void updateNotice(notice.id, 'RESOLVED')}>Resolve</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={savingId === notice.id} onClick={() => void updateNotice(notice.id, 'DISMISSED')}>Dismiss</Button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
