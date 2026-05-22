import { FormEvent, useEffect, useState } from 'react';
import type { StockDeliveryCheck, StockDeliveryChecksPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

type DraftLine = {
  stockItemId: string;
  description: string;
  expectedQuantity: string;
  receivedQuantity: string;
  unit: string;
  checked: boolean;
  discrepancy: boolean;
  discrepancyReason: string;
  notes: string;
};

function emptyLine(): DraftLine {
  return { stockItemId: '', description: '', expectedQuantity: '', receivedQuantity: '', unit: '', checked: false, discrepancy: false, discrepancyReason: '', notes: '' };
}

function statusTone(status: string): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'COMPLETED') return 'positive';
  if (status === 'DISCREPANCY') return 'danger';
  if (status === 'IN_REVIEW') return 'warning';
  return 'muted';
}

export function DeliveriesPage() {
  useDocumentTitle('Delivery checks');
  const [data, setData] = useState<StockDeliveryChecksPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [draft, setDraft] = useState({ supplierId: '', supplierName: '', invoiceNumber: '', deliveryDate: '', invoiceReference: '', notes: '', items: [emptyLine()] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(venue = selectedVenue) {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<StockDeliveryChecksPayload>(`/api/operations/deliveries${query}`);
      setData(payload);
      if (!venue && payload.scope.venue) setSelectedVenue(payload.scope.venue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load delivery checks.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [selectedVenue]);

  const activeVenue = selectedVenue || data?.scope.venue || '';
  const venueOptions = [
    ...(data?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
  ];
  const itemOptions = [
    { label: 'Manual line', value: '' },
    ...(data?.items ?? []).map((item) => ({ label: `${item.name}${item.sku ? ` · ${item.sku}` : ''}`, value: item.id }))
  ];
  const supplierOptions = [
    { label: 'Manual supplier', value: '' },
    ...(data?.suppliers ?? []).map((supplier) => ({ label: supplier.name, value: supplier.id }))
  ];

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line)
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeVenue) {
      setError('Choose a venue before creating a delivery check.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/operations/deliveries', {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          venue: activeVenue,
          supplierName: draft.supplierName || data?.suppliers.find((supplier) => supplier.id === draft.supplierId)?.name || 'Unknown supplier',
          items: draft.items.filter((line) => line.description.trim() || line.stockItemId).map((line) => ({
            ...line,
            description: line.description || data?.items.find((item) => item.id === line.stockItemId)?.name || 'Invoice line'
          }))
        })
      });
      setDraft({ supplierId: '', supplierName: '', invoiceNumber: '', deliveryDate: '', invoiceReference: '', notes: '', items: [emptyLine()] });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create delivery check.');
    } finally {
      setSaving(false);
    }
  }

  async function complete(check: StockDeliveryCheck) {
    setSaving(true);
    try {
      await api(`/api/operations/deliveries/${check.id}/complete`, { method: 'POST' });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete delivery check.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card title="Delivery invoice checks" subtitle="Manually check supplier deliveries against the invoice before received quantities hit venue stock.">
        <div className="stock-filter-toolbar">
          <Select label="Venue" value={selectedVenue} onChange={(event) => setSelectedVenue(event.currentTarget.value)} options={venueOptions} />
          <p className="subtle">{activeVenue ? `Delivery checks for ${activeVenue}.` : 'Choose a venue.'}</p>
        </div>
      </Card>

      <div className="stock-operations-grid">
        <Card title="Create checklist" subtitle="Add expected and received quantities. Discrepancies stay visible after completion.">
          <form className="stock-operation-form" onSubmit={submit}>
            <div className="stock-filter-toolbar">
              <Select
                label="Supplier"
                value={draft.supplierId}
                onChange={(event) => {
                  const supplier = data?.suppliers.find((candidate) => candidate.id === event.currentTarget.value);
                  setDraft((current) => ({ ...current, supplierId: event.currentTarget.value, supplierName: supplier?.name ?? current.supplierName }));
                }}
                options={supplierOptions}
              />
              <Input label="Supplier name" value={draft.supplierName} onChange={(event) => setDraft((current) => ({ ...current, supplierName: event.currentTarget.value }))} />
            </div>
            <div className="stock-filter-toolbar">
              <Input label="Invoice number" value={draft.invoiceNumber} onChange={(event) => setDraft((current) => ({ ...current, invoiceNumber: event.currentTarget.value }))} />
              <Input label="Delivery date" type="date" value={draft.deliveryDate} onChange={(event) => setDraft((current) => ({ ...current, deliveryDate: event.currentTarget.value }))} />
            </div>
            <Input label="Invoice reference" value={draft.invoiceReference} onChange={(event) => setDraft((current) => ({ ...current, invoiceReference: event.currentTarget.value }))} placeholder="Upload/reference URL if already stored elsewhere" />
            <div className="stock-delivery-lines">
              {draft.items.map((line, index) => (
                <div key={index} className="stock-delivery-line">
                  <Select
                    label="Stock item"
                    value={line.stockItemId}
                    onChange={(event) => {
                      const item = data?.items.find((candidate) => candidate.id === event.currentTarget.value);
                      updateLine(index, { stockItemId: event.currentTarget.value, description: item?.name ?? line.description, unit: item?.venueStock?.unitOverride ?? item?.unit ?? line.unit });
                    }}
                    options={itemOptions}
                  />
                  <Input label="Description" value={line.description} onChange={(event) => updateLine(index, { description: event.currentTarget.value })} />
                  <Input label="Expected" type="number" min="0" step="0.01" value={line.expectedQuantity} onChange={(event) => updateLine(index, { expectedQuantity: event.currentTarget.value })} />
                  <Input label="Received" type="number" min="0" step="0.01" value={line.receivedQuantity} onChange={(event) => updateLine(index, { receivedQuantity: event.currentTarget.value })} />
                  <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
                  <label className="check-row"><input type="checkbox" checked={line.checked} onChange={(event) => updateLine(index, { checked: event.currentTarget.checked })} /> Checked</label>
                  <label className="check-row"><input type="checkbox" checked={line.discrepancy} onChange={(event) => updateLine(index, { discrepancy: event.currentTarget.checked })} /> Discrepancy</label>
                  {line.discrepancy ? <Input label="Discrepancy note" value={line.discrepancyReason} onChange={(event) => updateLine(index, { discrepancyReason: event.currentTarget.value })} /> : null}
                </div>
              ))}
            </div>
            <Button type="button" variant="secondary" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, emptyLine()] }))}>Add line</Button>
            <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.currentTarget.value }))} />
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={saving || !activeVenue}>{saving ? 'Saving...' : 'Create delivery check'}</Button>
          </form>
        </Card>

        <Card title="Recent delivery checks" subtitle="Complete a check once received quantities and discrepancies are confirmed." padding="none">
          {loading ? <Spinner label="Loading delivery checks" /> : null}
          {!loading && !data?.checks.length ? <EmptyState title="No delivery checks" description="Create the first invoice checklist when a delivery arrives." /> : null}
          {data?.checks.length ? (
            <div className="stock-mobile-list">
              {data.checks.map((check) => (
                <div key={check.id} className="stock-operation-row">
                  <span>
                    <strong>{check.supplierName}</strong>
                    <span className="subtle">{check.invoiceNumber || 'No invoice'} · {new Date(check.deliveryDate).toLocaleDateString()} · {check.items.length} lines</span>
                    {check.items.some((item) => item.discrepancy) ? <span className="subtle">Discrepancy: {check.items.filter((item) => item.discrepancy).map((item) => item.description).join(', ')}</span> : null}
                  </span>
                  <span className="stock-operation-row-actions">
                    <Badge tone={statusTone(check.status)}>{check.status.replaceAll('_', ' ')}</Badge>
                    {check.status !== 'COMPLETED' && check.status !== 'DISCREPANCY' ? <Button type="button" size="sm" disabled={saving} onClick={() => void complete(check)}>Complete</Button> : null}
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
