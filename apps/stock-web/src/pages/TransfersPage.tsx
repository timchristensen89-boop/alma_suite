import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockItem, StockItemsPayload, StockTransfer } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { StockItemPicker } from '../components/StockItemPicker';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

type UnitMode = 'count' | 'purchase';

function countUnitOf(item: StockItem | undefined) {
  return item?.countUnit ?? item?.unit ?? '';
}
function purchaseUnitOf(item: StockItem | undefined) {
  return item?.unit ?? '';
}
function conversionOf(item: StockItem | undefined) {
  return item && item.conversionFactor > 0 ? item.conversionFactor : 1;
}
function hasPurchaseUnit(item: StockItem | undefined) {
  if (!item) return false;
  const cu = countUnitOf(item).trim().toLowerCase();
  const pu = purchaseUnitOf(item).trim().toLowerCase();
  return Boolean(pu) && Boolean(cu) && pu !== cu && conversionOf(item) > 1;
}

function qty(value: number, unit: string | null) {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`;
}
function money(cents: number | null | undefined) {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

export function TransfersPage() {
  useDocumentTitle('Transfers');
  const [catalogue, setCatalogue] = useState<StockItemsPayload | null>(null);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [draft, setDraft] = useState({ stockItemId: '', fromVenue: '', toVenue: '', quantity: '', notes: '' });
  const [unitMode, setUnitMode] = useState<UnitMode>('count');
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
  const selectedItem = catalogue?.items.find((item) => item.id === draft.stockItemId);
  const countUnit = countUnitOf(selectedItem);
  const purchaseUnit = purchaseUnitOf(selectedItem);
  const conversion = conversionOf(selectedItem);
  const canPickPurchase = hasPurchaseUnit(selectedItem);
  const effectiveMode: UnitMode = canPickPurchase ? unitMode : 'count';
  const enteredUnit = effectiveMode === 'purchase' ? purchaseUnit : countUnit;

  // Everything on-hand is in count units, so convert a purchase-unit entry.
  const countQuantity = useMemo(() => {
    const n = Number(draft.quantity);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return effectiveMode === 'purchase' ? n * conversion : n;
  }, [draft.quantity, effectiveMode, conversion]);

  const previewValueCents = selectedItem?.avgCostCents != null && countQuantity > 0
    ? Math.round(countQuantity * selectedItem.avgCostCents)
    : null;

  const venueOnHand = useMemo(() => {
    if (!selectedItem) return null;
    const rows = catalogue?.venueStockItems ?? [];
    return new Map(rows.filter((r) => r.stockItemId === selectedItem.id).map((r) => [r.venue, r.onHand]));
  }, [catalogue, selectedItem]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOk(null);
    if (draft.fromVenue === draft.toVenue) { setError('From and To venues must be different.'); return; }
    if (countQuantity <= 0) { setError('Enter a quantity greater than zero.'); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<StockTransfer>('/api/stock-transfers', {
        method: 'POST',
        body: JSON.stringify({
          stockItemId: draft.stockItemId,
          fromVenue: draft.fromVenue,
          toVenue: draft.toVenue,
          quantity: countQuantity,
          unit: countUnit || undefined,
          notes: draft.notes || undefined
        })
      });
      setOk(`Moved ${qty(created.quantity, created.unit)}${created.valueCents != null ? ` (${money(created.valueCents)})` : ''} of ${created.itemName} · ${created.fromVenue} → ${created.toVenue}`);
      setDraft((current) => ({ ...current, stockItemId: '', quantity: '', notes: '' }));
      setUnitMode('count');
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

            <StockItemPicker
              label="Item"
              items={(catalogue?.items ?? []).filter((item) => item.status === 'ACTIVE')}
              value={draft.stockItemId}
              onChange={(id) => { setDraft((c) => ({ ...c, stockItemId: id })); setUnitMode('count'); }}
            />

            {selectedItem && venueOnHand ? (
              <p className="subtle transfer-onhand">
                On hand — {draft.fromVenue}: <strong>{qty(venueOnHand.get(draft.fromVenue) ?? selectedItem.onHand ?? 0, countUnit)}</strong>
                {' · '}{draft.toVenue}: <strong>{qty(venueOnHand.get(draft.toVenue) ?? selectedItem.onHand ?? 0, countUnit)}</strong>
              </p>
            ) : null}

            <div className="stock-filter-toolbar">
              <Input label="Quantity" type="number" min="0.001" step="0.001" value={draft.quantity} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, quantity: v })); }} />
              {canPickPurchase ? (
                <Select
                  label="In unit"
                  value={effectiveMode}
                  onChange={(event) => setUnitMode(event.currentTarget.value as UnitMode)}
                  options={[
                    { label: `${countUnit} (count unit)`, value: 'count' },
                    { label: `${purchaseUnit} (× ${conversion} ${countUnit})`, value: 'purchase' }
                  ]}
                />
              ) : (
                <Input label="Unit" value={enteredUnit} readOnly />
              )}
            </div>

            {selectedItem && countQuantity > 0 ? (
              <p className="subtle transfer-preview">
                Moving <strong>{qty(countQuantity, countUnit)}</strong>
                {effectiveMode === 'purchase' ? ` (${qty(Number(draft.quantity), purchaseUnit)})` : ''}
                {previewValueCents != null ? <> · value <strong>{money(previewValueCents)}</strong></> : ' · no cost on file'}
              </p>
            ) : null}

            <Textarea label="Note (optional)" rows={2} value={draft.notes} onChange={(event) => { const v = event.currentTarget.value; setDraft((c) => ({ ...c, notes: v })); }} />

            {error ? <p className="error-text">{error}</p> : null}
            {ok ? <p className="transfer-ok">{ok}</p> : null}
            <Button type="submit" disabled={saving || !draft.stockItemId || countQuantity <= 0 || !draft.fromVenue || !draft.toVenue || draft.fromVenue === draft.toVenue}>
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
                    {t.valueCents != null ? <Badge tone="muted">{money(t.valueCents)}</Badge> : null}
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
