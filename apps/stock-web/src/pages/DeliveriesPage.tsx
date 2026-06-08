import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import type { StockDeliveryCheck, StockDeliveryCheckItem, StockDeliveryChecksPayload, StockInvoicesPayload, StockSupplierInvoice } from '@alma/shared';
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

type DeliveryLineRowProps = {
  line: StockDeliveryCheckItem;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onView: (path: string) => Promise<void>;
  cachedPhotoUrl: string | undefined;
  resolvePhotoUrl: (path: string) => Promise<string | null>;
};

function DeliveryLineRow({ line, uploading, onUpload, onRemove, onView, cachedPhotoUrl, resolvePhotoUrl }: DeliveryLineRowProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(cachedPhotoUrl);

  // Lazy-resolve the thumbnail URL the first time the row is rendered
  useEffect(() => {
    let cancelled = false;
    if (line.photoUrl && !thumbUrl) {
      void resolvePhotoUrl(line.photoUrl).then((url) => {
        if (!cancelled && url) setThumbUrl(url);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [line.photoUrl, thumbUrl, resolvePhotoUrl]);

  // Sync external cache changes (e.g. after upload)
  useEffect(() => {
    if (cachedPhotoUrl && cachedPhotoUrl !== thumbUrl) setThumbUrl(cachedPhotoUrl);
  }, [cachedPhotoUrl, thumbUrl]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) onUpload(file);
    if (inputRef.current) inputRef.current.value = '';
  }

  const variance = (() => {
    const expected = line.expectedQuantity ?? null;
    const received = line.receivedQuantity ?? null;
    if (expected === null || received === null) return null;
    const diff = received - expected;
    if (Math.abs(diff) < 0.001) return null;
    return diff;
  })();

  return (
    <div className={`delivery-line-detail${line.discrepancy ? ' delivery-line-detail--flagged' : ''}`}>
      <div className="delivery-line-detail-main">
        <div className="delivery-line-detail-summary">
          <strong>{line.description}</strong>
          <span className="subtle">
            Expected {line.expectedQuantity ?? '—'} · Received {line.receivedQuantity ?? '—'}
            {line.unit ? ` ${line.unit}` : ''}
            {variance !== null ? ` · Variance ${variance > 0 ? '+' : ''}${variance}` : ''}
          </span>
          {line.discrepancyReason ? <span className="subtle">Note: {line.discrepancyReason}</span> : null}
          {line.notes ? <span className="subtle">{line.notes}</span> : null}
        </div>
        <div className="delivery-line-detail-photo">
          {line.photoUrl ? (
            <button
              type="button"
              className="delivery-photo-thumb"
              onClick={() => void onView(line.photoUrl as string)}
              aria-label="View delivery photo"
            >
              {thumbUrl ? <img src={thumbUrl} alt="Delivery line evidence" /> : <span className="subtle">Loading…</span>}
            </button>
          ) : (
            <div className="delivery-photo-placeholder">No photo</div>
          )}
          <div className="delivery-photo-actions">
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/heic,image/heif,image/webp"
              hidden
              onChange={handleFileChange}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? 'Uploading…' : line.photoUrl ? 'Replace photo' : 'Add photo'}
            </Button>
            {line.photoUrl ? (
              <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function DeliveriesPage() {
  useDocumentTitle('Delivery checks');
  const [data, setData] = useState<StockDeliveryChecksPayload | null>(null);
  const [selectedVenue, setSelectedVenue] = useState('');
  const [draft, setDraft] = useState({ supplierId: '', supplierName: '', invoiceNumber: '', deliveryDate: '', invoiceReference: '', notes: '', items: [emptyLine()] });
  const [invoices, setInvoices] = useState<StockSupplierInvoice[]>([]);
  const [prefillInvoiceId, setPrefillInvoiceId] = useState('');
  const [prefilling, setPrefilling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedCheckId, setExpandedCheckId] = useState<string | null>(null);
  const [uploadingLineId, setUploadingLineId] = useState<string | null>(null);
  const [photoUrlCache, setPhotoUrlCache] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Resolve gs:// paths to viewable signed URLs (1h validity) on demand.
  // Cached in-memory so re-renders don't re-fetch.
  async function resolvePhotoUrl(path: string): Promise<string | null> {
    if (photoUrlCache[path]) return photoUrlCache[path] ?? null;
    try {
      const result = await api<{ url: string }>('/api/uploads/view', {
        method: 'POST',
        body: JSON.stringify({ path })
      });
      setPhotoUrlCache((current) => ({ ...current, [path]: result.url }));
      return result.url;
    } catch {
      return null;
    }
  }

  async function uploadLinePhoto(lineId: string, file: File) {
    setUploadingLineId(lineId);
    setError(null);
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File too large — max 5MB.');
      }
      // 1. Ask the API for a signed PUT URL
      const signed = await api<{ uploadUrl: string; publicPath: string; maxBytes: number }>(
        '/api/uploads/sign',
        {
          method: 'POST',
          body: JSON.stringify({
            folder: 'deliveries',
            mimeType: file.type || 'image/jpeg',
            filename: file.name
          })
        }
      );

      // 2. PUT the file directly to Cloud Storage (bypasses our API server)
      const putResponse = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'image/jpeg',
          'x-goog-content-length-range': `0,${signed.maxBytes}`
        },
        body: file
      });
      if (!putResponse.ok) {
        throw new Error('Upload failed — try again or pick a smaller file.');
      }

      // 3. Persist the gs:// path on the line record
      await api(`/api/operations/deliveries/lines/${lineId}/photo`, {
        method: 'PATCH',
        body: JSON.stringify({ photoUrl: signed.publicPath })
      });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo.');
    } finally {
      setUploadingLineId(null);
    }
  }

  async function removeLinePhoto(lineId: string) {
    try {
      await api(`/api/operations/deliveries/lines/${lineId}/photo`, {
        method: 'PATCH',
        body: JSON.stringify({ photoUrl: null })
      });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove photo.');
    }
  }

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

  // Recent supplier invoices to prefill a goods-in checklist from. Non-fatal.
  useEffect(() => {
    let cancelled = false;
    api<StockInvoicesPayload>('/api/invoices')
      .then((payload) => { if (!cancelled) setInvoices(payload.invoices); })
      .catch(() => { if (!cancelled) setInvoices([]); });
    return () => { cancelled = true; };
  }, []);

  const activeVenue = selectedVenue || data?.scope.venue || '';

  // Prefill the create form from a matched supplier invoice: header + every
  // line (linked stock item, description, expected qty, unit) so a goods-in
  // check no longer re-keys what the invoice already imported.
  async function prefillFromInvoice(invoiceId: string) {
    setPrefillInvoiceId(invoiceId);
    if (!invoiceId) return;
    setPrefilling(true);
    try {
      const invoice = await api<StockSupplierInvoice>(`/api/invoices/${invoiceId}`);
      const lines = (invoice.lines ?? []).filter((line) => line.description.trim() || line.itemId);
      setDraft({
        supplierId: invoice.supplierId ?? '',
        supplierName: invoice.supplierName ?? '',
        invoiceNumber: invoice.invoiceNumber ?? '',
        deliveryDate: invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : '',
        invoiceReference: '',
        notes: '',
        items: lines.length
          ? lines.map((line) => ({
              ...emptyLine(),
              stockItemId: line.itemId ?? '',
              description: line.description,
              expectedQuantity: line.quantity ? String(line.quantity) : '',
              unit: line.item?.countUnit ?? line.item?.unit ?? line.unit ?? ''
            }))
          : [emptyLine()]
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load that invoice.');
    } finally {
      setPrefilling(false);
    }
  }
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
      setPrefillInvoiceId('');
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
                label="Prefill from invoice"
                value={prefillInvoiceId}
                onChange={(event) => void prefillFromInvoice(event.currentTarget.value)}
                options={[
                  { label: prefilling ? 'Loading…' : 'Prefill from invoice…', value: '' },
                  ...invoices.map((inv) => ({
                    label: `${inv.supplierName} · ${inv.invoiceNumber ?? 'No #'}${inv.invoiceDate ? ` · ${inv.invoiceDate.slice(0, 10)}` : ''}`,
                    value: inv.id
                  }))
                ]}
                hint="Pulls the supplier and every line from a matched supplier invoice."
              />
            </div>
            <div className="stock-filter-toolbar">
              <Select
                label="Supplier"
                value={draft.supplierId}
                onChange={(event) => {
                  const el = event.currentTarget;
                  const supplier = data?.suppliers.find((candidate) => candidate.id === el.value);
                  setDraft((current) => ({ ...current, supplierId: el.value, supplierName: supplier?.name ?? current.supplierName }));
                }}
                options={supplierOptions}
              />
              <Input label="Supplier name" value={draft.supplierName} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, supplierName: el.value })); }} />
            </div>
            <div className="stock-filter-toolbar">
              <Input label="Invoice number" value={draft.invoiceNumber} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, invoiceNumber: el.value })); }} />
              <Input label="Delivery date" type="date" value={draft.deliveryDate} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, deliveryDate: el.value })); }} />
            </div>
            <Input label="Invoice reference" value={draft.invoiceReference} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, invoiceReference: el.value })); }} placeholder="Upload/reference URL if already stored elsewhere" />
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
            <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, notes: el.value })); }} />
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={saving || !activeVenue}>{saving ? 'Saving...' : 'Create delivery check'}</Button>
          </form>
        </Card>

        <Card title="Recent delivery checks" subtitle="Complete a check once received quantities and discrepancies are confirmed." padding="none">
          {loading ? <Spinner label="Loading delivery checks" /> : null}
          {!loading && !data?.checks.length ? <EmptyState title="No delivery checks" description="Create the first invoice checklist when a delivery arrives." /> : null}
          {data?.checks.length ? (
            <div className="stock-mobile-list">
              {data.checks.map((check) => {
                const isExpanded = expandedCheckId === check.id;
                const photoCount = check.items.filter((item) => item.photoUrl).length;
                return (
                  <div key={check.id} className="delivery-check-block">
                    <div className="stock-operation-row">
                      <span>
                        <strong>{check.supplierName}</strong>
                        <span className="subtle">{check.invoiceNumber || 'No invoice'} · {new Date(check.deliveryDate).toLocaleDateString()} · {check.items.length} lines{photoCount > 0 ? ` · 📷 ${photoCount}` : ''}</span>
                        {check.items.some((item) => item.discrepancy) ? <span className="subtle">Discrepancy: {check.items.filter((item) => item.discrepancy).map((item) => item.description).join(', ')}</span> : null}
                      </span>
                      <span className="stock-operation-row-actions">
                        <Badge tone={statusTone(check.status)}>{check.status.replaceAll('_', ' ')}</Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setExpandedCheckId(isExpanded ? null : check.id)}
                        >
                          {isExpanded ? 'Hide lines' : 'Show lines'}
                        </Button>
                        {check.status !== 'COMPLETED' && check.status !== 'DISCREPANCY' ? <Button type="button" size="sm" disabled={saving} onClick={() => void complete(check)}>Complete</Button> : null}
                      </span>
                    </div>
                    {isExpanded ? (
                      <div className="delivery-line-detail-list">
                        {check.items.map((item) => (
                          <DeliveryLineRow
                            key={item.id}
                            line={item}
                            uploading={uploadingLineId === item.id}
                            onUpload={(file) => void uploadLinePhoto(item.id, file)}
                            onRemove={() => void removeLinePhoto(item.id)}
                            onView={async (path) => {
                              const url = await resolvePhotoUrl(path);
                              if (url) setLightboxUrl(url);
                            }}
                            cachedPhotoUrl={item.photoUrl ? photoUrlCache[item.photoUrl] : undefined}
                            resolvePhotoUrl={resolvePhotoUrl}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {lightboxUrl ? (
            <button
              type="button"
              className="delivery-photo-lightbox"
              onClick={() => setLightboxUrl(null)}
              aria-label="Close photo"
            >
              <img src={lightboxUrl} alt="Delivery photo" />
              <span className="delivery-photo-lightbox-hint">Tap to close</span>
            </button>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
