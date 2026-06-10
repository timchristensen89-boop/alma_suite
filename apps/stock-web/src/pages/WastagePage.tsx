import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockItem, StockWastagePayload, StockWastageReason } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { StockItemPicker } from '../components/StockItemPicker';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useStickyVenue } from '../hooks/useStickyVenue';
import { ApiError, api } from '../lib/api';

const REASONS: Array<{ label: string; value: StockWastageReason }> = [
  { label: 'Spoiled', value: 'SPOILED' },
  { label: 'Broken', value: 'BROKEN' },
  { label: 'Over poured', value: 'OVER_POURED' },
  { label: 'Kitchen error', value: 'KITCHEN_ERROR' },
  { label: 'Returned', value: 'RETURNED' },
  { label: 'Expired', value: 'EXPIRED' },
  { label: 'Staff meal', value: 'STAFF_MEAL' },
  { label: 'Other', value: 'OTHER' }
];

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

export function WastagePage() {
  useDocumentTitle('Wastage');
  const [data, setData] = useState<StockWastagePayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useStickyVenue();
  const [draft, setDraft] = useState({ stockItemId: '', quantity: '', unit: '', reason: 'SPOILED' as StockWastageReason, note: '', wastedAt: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(venue = selectedVenue) {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<StockWastagePayload>(`/api/operations/wastage${query}`);
      setData(payload);
      if (!venue && payload.scope.venue) setSelectedVenue(payload.scope.venue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load wastage records.');
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
  const totals = useMemo(() => ({
    count: data?.records.length ?? 0,
    cost: data?.records.reduce((sum, record) => sum + (record.costImpactCents ?? 0), 0) ?? 0,
    quantity: data?.records.reduce((sum, record) => sum + record.quantity, 0) ?? 0
  }), [data]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeVenue) {
      setError('Choose a venue before recording wastage.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/operations/wastage', {
        method: 'POST',
        body: JSON.stringify({ ...draft, venue: activeVenue, quantity: Number(draft.quantity), unit: draft.unit || itemUnit(selectedItem) })
      });
      setDraft({ stockItemId: '', quantity: '', unit: '', reason: 'SPOILED', note: '', wastedAt: '' });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record wastage.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card title="Wastage" subtitle="Record spoiled, broken, over-poured, expired, or staff-meal stock. Wastage posts a ledger movement against venue stock.">
        <div className="stock-filter-toolbar">
          <Select label="Venue" value={selectedVenue} onChange={(event) => setSelectedVenue(event.currentTarget.value)} options={venueOptions} />
          <p className="subtle">{activeVenue ? `Recording wastage for ${activeVenue}.` : 'Choose a venue to start.'}</p>
        </div>
      </Card>

      <div className="stat-grid">
        <StatCard label="Recent records" value={String(totals.count)} hint="Latest 100" />
        <StatCard label="Quantity wasted" value={new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(totals.quantity)} hint="Across current filter" />
        <StatCard label="Estimated cost" value={cents(totals.cost)} hint="Uses item average cost where available" tone={totals.cost > 0 ? 'warning' : 'neutral'} />
      </div>

      {/* Wastage by shift breakdown — buckets records by service period
          using the wastedAt timestamp. Not finger-pointing — surfaces
          whether wastage clusters at certain service periods. */}
      {data?.records.length ? (() => {
        const shifts = {
          breakfast: { label: 'Breakfast (6am–11am)', cost: 0, count: 0 },
          lunch: { label: 'Lunch (11am–3pm)', cost: 0, count: 0 },
          afternoon: { label: 'Afternoon (3pm–5pm)', cost: 0, count: 0 },
          dinner: { label: 'Dinner (5pm–10pm)', cost: 0, count: 0 },
          late: { label: 'Late / overnight (10pm–6am)', cost: 0, count: 0 }
        };
        for (const record of data.records) {
          if (!record.wastedAt) continue;
          const hour = new Date(record.wastedAt).getHours();
          const cost = record.costImpactCents ?? 0;
          let bucket: keyof typeof shifts;
          if (hour >= 6 && hour < 11) bucket = 'breakfast';
          else if (hour >= 11 && hour < 15) bucket = 'lunch';
          else if (hour >= 15 && hour < 17) bucket = 'afternoon';
          else if (hour >= 17 && hour < 22) bucket = 'dinner';
          else bucket = 'late';
          shifts[bucket].cost += cost;
          shifts[bucket].count += 1;
        }
        const maxCost = Math.max(...Object.values(shifts).map((s) => s.cost), 1);
        const totalCost = Object.values(shifts).reduce((sum, s) => sum + s.cost, 0);
        return (
          <Card
            title="Wastage by shift"
            subtitle={`${cents(totalCost)} across all service periods — surface where wastage clusters, not who caused it.`}
          >
            <div className="wastage-shift-list">
              {Object.entries(shifts).map(([key, shift]) => {
                const pct = totalCost > 0 ? (shift.cost / totalCost) * 100 : 0;
                const width = (shift.cost / maxCost) * 100;
                return (
                  <div key={key} className="wastage-shift-row">
                    <div className="wastage-shift-label">
                      <strong>{shift.label}</strong>
                      <small>{shift.count} record{shift.count === 1 ? '' : 's'} · {pct.toFixed(0)}% of total</small>
                    </div>
                    <div className="wastage-shift-track">
                      <div className="wastage-shift-bar" style={{ width: `${Math.max(2, width)}%` }} />
                    </div>
                    <strong className="wastage-shift-cost">{cents(shift.cost)}</strong>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })() : null}

      <div className="stock-operations-grid">
        <Card title="Record wastage" subtitle="Use clear reasons so managers can spot repeat issues.">
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
              <Input label="Quantity" type="number" min="0.01" step="0.01" value={draft.quantity} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, quantity: el.value })); }} />
              <Input label="Unit" value={draft.unit} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, unit: el.value })); }} />
            </div>
            <div className="stock-filter-toolbar">
              <Select label="Reason" value={draft.reason} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, reason: el.value as StockWastageReason })); }} options={REASONS} />
              <Input label="Date/time" type="datetime-local" value={draft.wastedAt} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, wastedAt: el.value })); }} />
            </div>
            <Textarea label="Note" rows={3} value={draft.note} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, note: el.value })); }} />
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={saving || !draft.stockItemId || !draft.quantity || !activeVenue}>{saving ? 'Saving...' : 'Record wastage'}</Button>
          </form>
        </Card>

        <Card title="Recent wastage" subtitle="Latest wastage records for the selected venue." padding="none">
          {loading ? <Spinner label="Loading wastage" /> : null}
          {!loading && !data?.records.length ? <EmptyState title="No wastage recorded" description="Wastage records will appear here." /> : null}
          {data?.records.length ? (
            <div className="stock-mobile-list">
              {data.records.map((record) => (
                <div key={record.id} className="stock-operation-row">
                  <span>
                    <strong>{record.stockItem?.name ?? 'Unknown item'}</strong>
                    <span className="subtle">{qty(record.quantity, record.unit)} · {record.reason.replaceAll('_', ' ').toLowerCase()} · {new Date(record.wastedAt).toLocaleString()}</span>
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
