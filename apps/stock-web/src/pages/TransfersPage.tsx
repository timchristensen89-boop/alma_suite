import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockItem, StockItemsPayload, StockTransfer } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

function itemUnit(item: StockItem | undefined) {
  return item?.countUnit ?? item?.unit ?? '';
}

function qty(value: number, unit: string | null) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`;
}

export function TransfersPage() {
  useDocumentTitle('Transfers');
  const [catalogue, setCatalogue] = useState<StockItemsPayload | null>(null);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [draft, setDraft] = useState({ stockItemId: '', fromVenue: '', toVenue: '', quantity: '', unit: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function loadCatalogue() {
    const payload = await api<StockItemsPayload>('/api/items');
    setCatalogue(payload);
    return payload;
  }

  async function loadTransfers() {
    setTransfers(await api<StockTransfer[]>('/api/stock-transfers'));
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadCatalogue(), loadTransfers()])
      .then(([payload]) => {
        if (!active) return;
        const venues = payload.venues ?? [];
        // Default From = the manager's venue (or first), To = the next venue.
        const from = payload.scope?.venue ?? venues[0] ?? '';
        const to = venues.find((v) => v !== from) ?? '';
        setDraft((current) => ({ ...current, fromVenue: current.fromVenue || from, toVenue: current.toVenue || to }));
        setError(null);
      })
      .catch((err) => { if (active) setError(err instanceof ApiError ? err.message : 'Could not load stock.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const venues = catalogue?.venues ?? [];
  const venueOptions = venues.map((v) => ({ label: v, value: v }));
  const itemOptions = [
    { label: 'Choose item', value: '' },
    ...(catalogue?.items ?? []).map((item) => ({ label: `${item.name}${item.sku ? ` · ${item.sku}` : ''}`, value: item.id }))
  ];
  const selectedItem = catalogue?.items.find((item) => item.id === draft.stockItemId);
  const unit = draft.unit || itemUnit(selectedItem);

  const venueOnHand = useMemo(() => {
    if (!selectedItem) return null;
    const rows = catalogue?.venueStockItems ?? [];
    const map = new Map(rows.filter((r) => r.stockItemId === selectedItem.id).map((r) => [r.venue, r.onHand]));
    return map;
  }, [catalogue, selectedItem]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOk(null);
    if (draft.fromVenue === draft.toVenue) { setError('From and To venues must be different.'); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<StockTransfer>('/api/stock-transfers', {
        method: 'POST',
        body: JSON.stringify({
          stockItemId: draft.stockItemId,
          fromVenue: draft.fromVenue,
          toVenue: draft.toVenue,
          quantity: Number(draft.quantity),
          unit: draft.unit || undefined,
          notes: draft.notes || undefined
        })
      });
      setOk(`Moved ${qty(created.quantity, created.unit)} of ${created.itemName} · ${created.fromVenue} → ${created.toVenue}`);
      setDraft((current) => ({ ...current, stockItemId: '', quantity: '', unit: '', notes: '' }));
      await Promise.all([loadCatalogue(), loadTransfers()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the transfer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card title="Transfers" subtitle="Move stock between venues. The quantity is taken off the From venue's on-hand and added to the To venue's, so each venue's next stocktake variance is correct. Total company stock is unchanged.">
        {loading ? <Spinner label="Loading stock" /> : null}
      </Card>

      <div className="stock-operations-grid">
        <Card title="New transfer" subtitle="Managers and admins only.">
          <form className="stock-operation-form" onSubmit={submit}>
            <div className="stock-filter-toolbar">
              <Select label="From venue" value={draft.fromVenue} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, fromVenue: v })); }} options={venueOptions} />
              <span className="transfer-arrow" aria-hidden="true">→</span>
              <Select label="To venue" value={draft.toVenue} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, toVenue: v })); }} options={venueOptions} />
            </div>

            <Select
              label="Item"
              value={draft.stockItemId}
              onChange={(event) => {
                const id = event.currentTarget.value;
                const item = catalogue?.items.find((candidate) => candidate.id === id);
                setDraft((c) => ({ ...c, stockItemId: id, unit: itemUnit(item) }));
              }}
              options={itemOptions}
            />

            {selectedItem && venueOnHand ? (
              <p className="subtle transfer-onhand">
                On hand — {draft.fromVenue}: <strong>{qty(venueOnHand.get(draft.fromVenue) ?? selectedItem.onHand ?? 0, unit)}</strong>
                {' · '}{draft.toVenue}: <strong>{qty(venueOnHand.get(draft.toVenue) ?? selectedItem.onHand ?? 0, unit)}</strong>
              </p>
            ) : null}

            <div className="stock-filter-toolbar">
              <Input label="Quantity" type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, quantity: v })); }} />
              <Input label="Unit" value={unit} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, unit: v })); }} />
            </div>

            <Textarea label="Note (optional)" rows={2} value={draft.notes} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, notes: v })); }} />

            {error ? <p className="error-text">{error}</p> : null}
            {ok ? <p className="transfer-ok">{ok}</p> : null}
            <Button type="submit" disabled={saving || !draft.stockItemId || !draft.quantity || !draft.fromVenue || !draft.toVenue || draft.fromVenue === draft.toVenue}>
              {saving ? 'Transferring…' : 'Transfer stock'}
            </Button>
          </form>
        </Card>

        <Card title="Recent transfers" subtitle="Latest stock moves between venues." padding="none">
          {loading ? <Spinner label="Loading transfers" /> : null}
          {!loading && transfers.length === 0 ? <EmptyState title="No transfers yet" description="Stock moves between venues will appear here." /> : null}
          {transfers.length ? (
            <div className="stock-mobile-list">
              {transfers.map((t) => (
                <div key={t.id} className="stock-operation-row">
                  <span>
                    <strong>{t.itemName}</strong>
                    <span className="subtle">{qty(t.quantity, t.unit)} · {t.fromVenue} → {t.toVenue} · {new Date(t.createdAt).toLocaleString()}</span>
                    {t.notes ? <span className="subtle">{t.notes}</span> : null}
                    {t.createdByName ? <span className="subtle">by {t.createdByName}</span> : null}
                  </span>
                  <span className="stock-operation-row-actions">
                    <Badge tone="muted">{t.fromVenue}</Badge>
                    <Badge tone="positive">{t.toVenue}</Badge>
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
