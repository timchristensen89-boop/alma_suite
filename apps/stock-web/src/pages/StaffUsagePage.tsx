import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockItem, StockStaffUsageCategory, StockWastagePayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { StockItemPicker } from '../components/StockItemPicker';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

const CATEGORIES: Array<{ label: string; value: StockStaffUsageCategory }> = [
  { label: 'Staff food', value: 'STAFF_FOOD' },
  { label: 'Staff drinks', value: 'STAFF_DRINK' },
  { label: 'Personal use', value: 'PERSONAL_USE' }
];

function categoryLabel(reason: string) {
  return CATEGORIES.find((c) => c.value === reason)?.label ?? reason.replaceAll('_', ' ').toLowerCase();
}

function cents(value: number | null | undefined) {
  if (!value) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(value / 100);
}

function qty(value: number, unit: string) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)} ${unit}`;
}

function itemUnit(item: StockItem | undefined) {
  return item?.venueStock?.unitOverride ?? item?.countUnit ?? item?.unit ?? '';
}

export function StaffUsagePage() {
  useDocumentTitle('Staff usage');
  const [data, setData] = useState<StockWastagePayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [draft, setDraft] = useState({
    stockItemId: '',
    quantity: '',
    unit: '',
    category: 'STAFF_FOOD' as StockStaffUsageCategory,
    staffName: '',
    note: '',
    usedAt: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(venue = selectedVenue) {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<StockWastagePayload>(`/api/operations/staff-usage${query}`);
      setData(payload);
      if (!venue && payload.scope.venue) setSelectedVenue(payload.scope.venue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load staff usage records.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [selectedVenue]);

  const activeVenue = selectedVenue || data?.scope.venue || '';
  const selectedItem = data?.items.find((item) => item.id === draft.stockItemId);
  const venueOptions = [
    ...(data?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
  ];
  const totals = useMemo(
    () => ({
      count: data?.records.length ?? 0,
      cost: data?.records.reduce((sum, record) => sum + (record.costImpactCents ?? 0), 0) ?? 0
    }),
    [data]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeVenue) {
      setError('Choose a venue before recording staff usage.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/operations/staff-usage', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          venue: activeVenue,
          quantity: Number(draft.quantity),
          unit: draft.unit || itemUnit(selectedItem)
        })
      });
      setDraft({ stockItemId: '', quantity: '', unit: '', category: 'STAFF_FOOD', staffName: '', note: '', usedAt: '' });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record staff usage.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card
        title="Staff usage"
        subtitle="Record staff food, staff drinks, and stock taken for personal use. Each entry comes off venue stock at the item's cost, so it reconciles against the stocktake instead of looking like loss."
      >
        <div className="stock-filter-toolbar">
          <Select label="Venue" value={selectedVenue} onChange={(event) => setSelectedVenue(event.currentTarget.value)} options={venueOptions} />
          <p className="subtle">{activeVenue ? `Recording staff usage for ${activeVenue}.` : 'Choose a venue to start.'}</p>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Recent records" value={String(totals.count)} hint="Latest 100" />
        <StatCard label="Cost off stocktake" value={cents(totals.cost)} hint="Valued at item average cost" tone={totals.cost > 0 ? 'warning' : 'neutral'} />
      </div>

      <div className="stock-operations-grid">
        <Card title="Record staff usage" subtitle="Pick the item, how much, and who it was for.">
          <form className="stock-operation-form" onSubmit={submit}>
            <StockItemPicker
              label="Item"
              items={data?.items ?? []}
              value={draft.stockItemId}
              onChange={(id) => {
                const item = data?.items.find((candidate) => candidate.id === id);
                setDraft((current) => ({ ...current, stockItemId: id, unit: itemUnit(item) }));
              }}
            />
            <div className="stock-filter-toolbar">
              <Input
                label="Quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={draft.quantity}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setDraft((current) => ({ ...current, quantity: el.value }));
                }}
              />
              <Input
                label="Unit"
                value={draft.unit}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setDraft((current) => ({ ...current, unit: el.value }));
                }}
              />
            </div>
            <div className="stock-filter-toolbar">
              <Select
                label="Type"
                value={draft.category}
                onChange={(event) => {
                  const el = event.currentTarget;
                  setDraft((current) => ({ ...current, category: el.value as StockStaffUsageCategory }));
                }}
                options={CATEGORIES}
              />
              <Input
                label="Staff member (optional)"
                value={draft.staffName}
                placeholder="Who was it for?"
                onChange={(event) => {
                  const el = event.currentTarget;
                  setDraft((current) => ({ ...current, staffName: el.value }));
                }}
              />
            </div>
            <Input
              label="Date/time"
              type="datetime-local"
              value={draft.usedAt}
              onChange={(event) => {
                const el = event.currentTarget;
                setDraft((current) => ({ ...current, usedAt: el.value }));
              }}
            />
            <Textarea
              label="Note (optional)"
              rows={2}
              value={draft.note}
              onChange={(event) => {
                const el = event.currentTarget;
                setDraft((current) => ({ ...current, note: el.value }));
              }}
            />
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={saving || !draft.stockItemId || !draft.quantity || !activeVenue}>
              {saving ? 'Saving...' : 'Record staff usage'}
            </Button>
          </form>
        </Card>

        <Card title="Recent staff usage" subtitle="Latest staff/personal consumption for the selected venue." padding="none">
          {loading ? <Spinner label="Loading staff usage" /> : null}
          {!loading && !data?.records.length ? (
            <EmptyState title="No staff usage recorded" description="Staff food, drinks and personal-use records will appear here." />
          ) : null}
          {data?.records.length ? (
            <div className="stock-mobile-list">
              {data.records.map((record) => (
                <div key={record.id} className="stock-operation-row">
                  <span>
                    <strong>{record.stockItem?.name ?? 'Unknown item'}</strong>
                    <span className="subtle">
                      {qty(record.quantity, record.unit)} · {categoryLabel(record.reason)} · {new Date(record.wastedAt).toLocaleString()}
                    </span>
                    {record.note ? <span className="subtle">{record.note}</span> : null}
                  </span>
                  <span className="stock-operation-row-actions">
                    <Badge tone="warning">{cents(record.costImpactCents)}</Badge>
                    <Badge tone="muted">{record.venue}</Badge>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
