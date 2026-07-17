import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockItem, StockInvoicesPayload, StockSupplierInvoice } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { StockItemPicker } from '../components/StockItemPicker';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useStickyVenue } from '../hooks/useStickyVenue';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

// The purchase-order API isn't in @alma/shared yet, so mirror its response
// shapes locally. Kept narrow to exactly what this page renders.
type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'MATCHED'
  | 'CANCELLED';

type PurchaseOrderLine = {
  id: string;
  stockItemId?: string | null;
  stockItem?: { id: string; name: string; unit: string; countUnit: string | null } | null;
  description: string;
  orderedQuantity: number;
  receivedQuantity?: number | null;
  unit?: string | null;
  unitCostCents: number;
  lineTotalCents: number;
};

type PurchaseOrder = {
  id: string;
  supplierName: string;
  supplier?: { id: string; name: string; email: string | null } | null;
  venue: string;
  reference: string | null;
  status: PurchaseOrderStatus;
  orderedAt: string | null;
  expectedAt: string | null;
  receivedAt: string | null;
  subtotalCents: number;
  matchedInvoice?: { id: string; invoiceNumber?: string | null } | null;
  createdAt: string;
  lines: PurchaseOrderLine[];
};

type PurchaseOrdersPayload = {
  orders: PurchaseOrder[];
  venues: string[];
  suppliers: Array<{ id: string; name: string; email: string | null }>;
  scope: { venue: string; admin: boolean };
};

type MatchResult = {
  purchaseOrder: PurchaseOrder;
  match: {
    orderedTotalCents: number;
    receivedTotalCents: number;
    billedTotalCents: number;
    totalVarianceCents: number;
    discrepancies: Array<{ description: string; issue: string }>;
    clean: boolean;
  };
};

type SupplierPriceListItem = {
  id: string;
  supplierId: string;
  stockItemId?: string | null;
  stockItem?: { id: string; name: string } | null;
  description: string;
  unit?: string | null;
  unitCostCents: number;
};

type DraftLine = {
  stockItemId: string;
  description: string;
  orderedQuantity: string;
  unit: string;
  unitCost: string;
};

function emptyLine(): DraftLine {
  return { stockItemId: '', description: '', orderedQuantity: '', unit: '', unitCost: '' };
}

function emptyDraft() {
  return { supplierId: '', supplierName: '', reference: '', expectedAt: '', notes: '', lines: [emptyLine()] };
}

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function itemUnit(item: StockItem | undefined) {
  return item?.venueStock?.unitOverride ?? item?.countUnit ?? item?.unit ?? '';
}

function statusTone(status: PurchaseOrderStatus): 'positive' | 'warning' | 'danger' | 'info' | 'muted' {
  switch (status) {
    case 'RECEIVED':
    case 'MATCHED':
      return 'positive';
    case 'PARTIALLY_RECEIVED':
      return 'warning';
    case 'CANCELLED':
      return 'danger';
    case 'SENT':
      return 'info';
    default:
      return 'muted';
  }
}

export function PurchaseOrdersPage() {
  useDocumentTitle('Purchase orders');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [view, setView] = useState<'orders' | 'price-list'>('orders');
  const [data, setData] = useState<PurchaseOrdersPayload | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [invoices, setInvoices] = useState<StockSupplierInvoice[]>([]);
  const [selectedVenue, setSelectedVenue] = useStickyVenue();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create / edit form
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Per-order panels (receive / match)
  const [panel, setPanel] = useState<{ orderId: string; mode: 'receive' | 'match' } | null>(null);
  const [receiveDraft, setReceiveDraft] = useState<Record<string, string>>({});
  const [matchInvoiceId, setMatchInvoiceId] = useState('');
  const [matchResults, setMatchResults] = useState<Record<string, MatchResult['match']>>({});

  async function load(venue = selectedVenue) {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<PurchaseOrdersPayload>(`/api/purchase-orders${query}`);
      setData(payload);
      if (!venue && payload.scope.venue) setSelectedVenue(payload.scope.venue);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load purchase orders.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [selectedVenue]);

  // Stock items power the line picker; invoices power the match picker. Both non-fatal.
  useEffect(() => {
    let cancelled = false;
    api<{ items: StockItem[] }>('/api/items')
      .then((payload) => { if (!cancelled) setItems(payload.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); });
    api<StockInvoicesPayload>('/api/invoices')
      .then((payload) => { if (!cancelled) setInvoices(payload.invoices ?? []); })
      .catch(() => { if (!cancelled) setInvoices([]); });
    return () => { cancelled = true; };
  }, []);

  const activeVenue = selectedVenue || data?.scope.venue || '';
  const venueOptions = [
    ...(data?.scope.admin ? [{ label: 'All venues', value: '' }] : []),
    ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
  ];
  const supplierOptions = [
    { label: 'Manual supplier', value: '' },
    ...(data?.suppliers ?? []).map((supplier) => ({ label: supplier.name, value: supplier.id }))
  ];

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    }));
  }

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
  }

  function editOrder(order: PurchaseOrder) {
    setEditingId(order.id);
    setPanel(null);
    setDraft({
      supplierId: order.supplier?.id ?? '',
      supplierName: order.supplierName,
      reference: order.reference ?? '',
      expectedAt: order.expectedAt ? order.expectedAt.slice(0, 10) : '',
      notes: '',
      lines: order.lines.length
        ? order.lines.map((line) => ({
            stockItemId: line.stockItemId ?? '',
            description: line.description,
            orderedQuantity: String(line.orderedQuantity),
            unit: line.unit ?? line.stockItem?.countUnit ?? line.stockItem?.unit ?? '',
            unitCost: (line.unitCostCents / 100).toString()
          }))
        : [emptyLine()]
    });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      setError('Manager access is required to create purchase orders.');
      return;
    }
    if (!activeVenue) {
      setError('Choose a venue before creating a purchase order.');
      return;
    }
    const lines = draft.lines
      .filter((line) => line.description.trim() || line.stockItemId)
      .map((line) => ({
        stockItemId: line.stockItemId || undefined,
        description: line.description || items.find((item) => item.id === line.stockItemId)?.name || 'Order line',
        orderedQuantity: Number(line.orderedQuantity) || 0,
        unit: line.unit || undefined,
        unitCost: Number(line.unitCost) || 0
      }));
    if (!lines.length) {
      setError('Add at least one line to the order.');
      return;
    }
    const supplierName =
      draft.supplierName || data?.suppliers.find((supplier) => supplier.id === draft.supplierId)?.name || '';
    if (!supplierName) {
      setError('Choose a supplier or enter a supplier name.');
      return;
    }
    const body = {
      supplierId: draft.supplierId || undefined,
      supplierName,
      venue: activeVenue,
      reference: draft.reference || undefined,
      expectedAt: draft.expectedAt || undefined,
      notes: draft.notes || undefined,
      lines
    };
    setSaving(true);
    try {
      if (editingId) {
        await api(`/api/purchase-orders/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await api('/api/purchase-orders', { method: 'POST', body: JSON.stringify(body) });
      }
      resetForm();
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save purchase order.');
    } finally {
      setSaving(false);
    }
  }

  async function sendOrder(order: PurchaseOrder) {
    if (!canManage) return;
    setSaving(true);
    try {
      await api(`/api/purchase-orders/${order.id}/send`, { method: 'POST' });
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send purchase order.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelOrder(order: PurchaseOrder) {
    if (!canManage) return;
    if (typeof window !== 'undefined' && !window.confirm(`Cancel purchase order for ${order.supplierName}?`)) return;
    setSaving(true);
    try {
      await api(`/api/purchase-orders/${order.id}/cancel`, { method: 'POST' });
      if (editingId === order.id) resetForm();
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel purchase order.');
    } finally {
      setSaving(false);
    }
  }

  function openReceive(order: PurchaseOrder) {
    const prefill: Record<string, string> = {};
    for (const line of order.lines) {
      // Default each line to the full ordered quantity (or what's still outstanding).
      const received = line.receivedQuantity ?? 0;
      const remaining = line.orderedQuantity - received;
      prefill[line.id] = String(remaining > 0 ? remaining : line.orderedQuantity);
    }
    setReceiveDraft(prefill);
    setPanel({ orderId: order.id, mode: 'receive' });
  }

  async function submitReceive(order: PurchaseOrder) {
    if (!canManage) return;
    setSaving(true);
    try {
      const lines = order.lines.map((line) => ({
        id: line.id,
        receivedQuantity: Number(receiveDraft[line.id] ?? line.orderedQuantity) || 0
      }));
      await api(`/api/purchase-orders/${order.id}/receive`, {
        method: 'POST',
        body: JSON.stringify({ lines })
      });
      setPanel(null);
      setReceiveDraft({});
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not receive purchase order.');
    } finally {
      setSaving(false);
    }
  }

  function openMatch(order: PurchaseOrder) {
    setMatchInvoiceId('');
    setPanel({ orderId: order.id, mode: 'match' });
  }

  async function submitMatch(order: PurchaseOrder) {
    if (!canManage) return;
    if (!matchInvoiceId) {
      setError('Pick an invoice to match against.');
      return;
    }
    setSaving(true);
    try {
      const result = await api<MatchResult>(`/api/purchase-orders/${order.id}/match`, {
        method: 'POST',
        body: JSON.stringify({ invoiceId: matchInvoiceId })
      });
      setMatchResults((current) => ({ ...current, [order.id]: result.match }));
      await load(activeVenue);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not match purchase order.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <Card
        title="Purchase orders"
        subtitle="Raise orders to suppliers, receive stock against them, and match to the supplier invoice."
      >
        <div className="stock-filter-toolbar">
          <Select
            label="Venue"
            value={selectedVenue}
            onChange={(event) => setSelectedVenue(event.currentTarget.value)}
            options={venueOptions}
          />
          <div className="po-view-toggle" role="tablist" aria-label="Purchase orders view">
            <Button
              type="button"
              size="sm"
              variant={view === 'orders' ? 'primary' : 'ghost'}
              onClick={() => setView('orders')}
            >
              Orders
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === 'price-list' ? 'primary' : 'ghost'}
              onClick={() => setView('price-list')}
            >
              Price list
            </Button>
          </div>
          <p className="subtle">{activeVenue ? `Purchase orders for ${activeVenue}.` : 'Choose a venue.'}</p>
        </div>
        {!canManage ? <p className="subtle">Manager access is required to create or action purchase orders.</p> : null}
      </Card>

      {error ? (
        <Card padding="tight">
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {view === 'orders' ? (
        <div className="stock-operations-grid">
          <Card
            title={editingId ? 'Edit purchase order' : 'New purchase order'}
            subtitle="Choose a supplier, add lines with quantity and unit cost, then send to the supplier."
          >
            <form className="stock-operation-form" onSubmit={submit}>
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
                <Input
                  label="Supplier name"
                  value={draft.supplierName}
                  onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, supplierName: el.value })); }}
                />
              </div>
              <div className="stock-filter-toolbar">
                <Input
                  label="Reference"
                  value={draft.reference}
                  onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, reference: el.value })); }}
                  placeholder="PO number or note"
                />
                <Input
                  label="Expected"
                  type="date"
                  value={draft.expectedAt}
                  onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, expectedAt: el.value })); }}
                />
              </div>

              <div className="po-line-list">
                {draft.lines.map((line, index) => (
                  <div key={index} className="po-line-row">
                    <StockItemPicker
                      label="Stock item"
                      items={items}
                      value={line.stockItemId}
                      onChange={(id) => {
                        const item = items.find((candidate) => candidate.id === id);
                        updateLine(index, {
                          stockItemId: id,
                          description: item?.name ?? line.description,
                          unit: itemUnit(item) || line.unit
                        });
                      }}
                    />
                    <Input label="Description" value={line.description} onChange={(event) => updateLine(index, { description: event.currentTarget.value })} />
                    <Input label="Qty" type="number" min="0" step="0.01" value={line.orderedQuantity} onChange={(event) => updateLine(index, { orderedQuantity: event.currentTarget.value })} />
                    <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
                    <Input label="Unit cost ($)" type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => updateLine(index, { unitCost: event.currentTarget.value })} />
                    {draft.lines.length > 1 ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }))}>
                        Remove
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
              <Button type="button" variant="secondary" onClick={() => setDraft((current) => ({ ...current, lines: [...current.lines, emptyLine()] }))}>
                Add line
              </Button>
              <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, notes: el.value })); }} />
              <div className="stock-operation-row-actions">
                <Button type="submit" disabled={saving || !activeVenue || !canManage}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create draft order'}
                </Button>
                {editingId ? (
                  <Button type="button" variant="ghost" disabled={saving} onClick={resetForm}>
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </form>
          </Card>

          <Card title="Purchase orders" subtitle="Draft, sent, received and matched orders for the selected venue." padding="none">
            {loading ? <Spinner label="Loading purchase orders" /> : null}
            {!loading && !data?.orders.length ? (
              <EmptyState title="No purchase orders" description="Raise the first order to a supplier from the form." />
            ) : null}
            {data?.orders.length ? (
              <div className="stock-mobile-list">
                {data.orders.map((order) => {
                  const isPanelOpen = panel?.orderId === order.id;
                  const matchResult = matchResults[order.id];
                  return (
                    <div key={order.id} className="po-block">
                      <div className="stock-operation-row">
                        <span>
                          <strong>{order.supplierName}</strong>
                          <span className="subtle">
                            {order.reference ? `${order.reference} · ` : ''}
                            {order.venue} · {order.lines.length} line{order.lines.length === 1 ? '' : 's'} · {money(order.subtotalCents)}
                            {order.expectedAt ? ` · expected ${new Date(order.expectedAt).toLocaleDateString()}` : ''}
                          </span>
                          {order.matchedInvoice ? (
                            <span className="subtle">Matched invoice {order.matchedInvoice.invoiceNumber ?? order.matchedInvoice.id}</span>
                          ) : null}
                        </span>
                        <span className="stock-operation-row-actions">
                          <Badge tone={statusTone(order.status)}>{order.status.replaceAll('_', ' ')}</Badge>
                          {canManage && order.status === 'DRAFT' ? (
                            <>
                              <Button type="button" size="sm" disabled={saving} onClick={() => void sendOrder(order)}>Send</Button>
                              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => editOrder(order)}>Edit</Button>
                              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void cancelOrder(order)}>Cancel</Button>
                            </>
                          ) : null}
                          {canManage && (order.status === 'SENT' || order.status === 'PARTIALLY_RECEIVED') ? (
                            <>
                              <Button type="button" size="sm" disabled={saving} onClick={() => (isPanelOpen && panel?.mode === 'receive' ? setPanel(null) : openReceive(order))}>
                                {isPanelOpen && panel?.mode === 'receive' ? 'Close' : 'Receive'}
                              </Button>
                              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void cancelOrder(order)}>Cancel</Button>
                            </>
                          ) : null}
                          {canManage && order.status === 'RECEIVED' ? (
                            <Button type="button" size="sm" disabled={saving} onClick={() => (isPanelOpen && panel?.mode === 'match' ? setPanel(null) : openMatch(order))}>
                              {isPanelOpen && panel?.mode === 'match' ? 'Close' : 'Match'}
                            </Button>
                          ) : null}
                        </span>
                      </div>

                      {isPanelOpen && panel?.mode === 'receive' ? (
                        <div className="po-panel">
                          <p className="subtle">Enter received quantities. Blank lines default to the ordered quantity.</p>
                          <div className="po-receive-lines">
                            {order.lines.map((line) => (
                              <div key={line.id} className="po-receive-row">
                                <span className="po-receive-label">
                                  <strong>{line.description}</strong>
                                  <span className="subtle">Ordered {line.orderedQuantity}{line.unit ? ` ${line.unit}` : ''} · {money(line.unitCostCents)}/unit</span>
                                </span>
                                <Input
                                  label="Received"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={receiveDraft[line.id] ?? ''}
                                  onChange={(event) => {
                                    const value = event.currentTarget.value;
                                    setReceiveDraft((current) => ({ ...current, [line.id]: value }));
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                          <Button type="button" disabled={saving} onClick={() => void submitReceive(order)}>
                            {saving ? 'Receiving…' : 'Confirm received'}
                          </Button>
                        </div>
                      ) : null}

                      {isPanelOpen && panel?.mode === 'match' ? (
                        <div className="po-panel">
                          <Select
                            label="Match to invoice"
                            value={matchInvoiceId}
                            onChange={(event) => setMatchInvoiceId(event.currentTarget.value)}
                            options={[
                              { label: 'Select an invoice…', value: '' },
                              ...invoices.map((invoice) => ({
                                label: `${invoice.supplierName} · ${invoice.invoiceNumber ?? 'No #'} · ${money(invoice.totalCents)}`,
                                value: invoice.id
                              }))
                            ]}
                          />
                          <Button type="button" disabled={saving || !matchInvoiceId} onClick={() => void submitMatch(order)}>
                            {saving ? 'Matching…' : 'Run match'}
                          </Button>

                          {matchResult ? (
                            <div className={`po-match-result${matchResult.clean ? ' po-match-result--clean' : ' po-match-result--flagged'}`}>
                              <div className="po-match-banner">
                                <Badge tone={matchResult.clean ? 'positive' : 'danger'}>
                                  {matchResult.clean ? 'Clean match' : 'Discrepancies found'}
                                </Badge>
                                <span className="subtle">
                                  Ordered {money(matchResult.orderedTotalCents)} · Received {money(matchResult.receivedTotalCents)} · Billed {money(matchResult.billedTotalCents)} · Variance {money(matchResult.totalVarianceCents)}
                                </span>
                              </div>
                              {matchResult.discrepancies.length ? (
                                <ul className="po-discrepancy-list">
                                  {matchResult.discrepancies.map((discrepancy, index) => (
                                    <li key={index}>
                                      <strong>{discrepancy.description}</strong>
                                      <span className="subtle">{discrepancy.issue}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>
        </div>
      ) : (
        <SupplierPriceListSection
          suppliers={data?.suppliers ?? []}
          items={items}
          canManage={canManage}
          onError={setError}
        />
      )}
    </div>
  );
}

type PriceListProps = {
  suppliers: Array<{ id: string; name: string; email: string | null }>;
  items: StockItem[];
  canManage: boolean;
  onError: (message: string | null) => void;
};

function SupplierPriceListSection({ suppliers, items, canManage, onError }: PriceListProps) {
  const [supplierId, setSupplierId] = useState('');
  const [entries, setEntries] = useState<SupplierPriceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ stockItemId: '', description: '', unit: '', unitCost: '' });

  const supplierOptions = [
    { label: 'All suppliers', value: '' },
    ...suppliers.map((supplier) => ({ label: supplier.name, value: supplier.id }))
  ];

  async function loadEntries() {
    setLoading(true);
    try {
      const query = supplierId ? `?supplierId=${encodeURIComponent(supplierId)}` : '';
      const rows = await api<SupplierPriceListItem[]>(`/api/purchase-orders/price-list${query}`);
      setEntries(rows ?? []);
      onError(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not load the price list.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEntries();
  }, [supplierId]);

  const addSupplierId = supplierId || suppliers[0]?.id || '';

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManage) {
      onError('Manager access is required to edit the price list.');
      return;
    }
    if (!addSupplierId) {
      onError('Choose a supplier before adding a price.');
      return;
    }
    const description = draft.description || items.find((item) => item.id === draft.stockItemId)?.name || '';
    if (!description) {
      onError('Enter an item or a description.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/purchase-orders/price-list', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: addSupplierId,
          stockItemId: draft.stockItemId || undefined,
          description,
          unit: draft.unit || undefined,
          unitCost: Number(draft.unitCost) || 0
        })
      });
      setDraft({ stockItemId: '', description: '', unit: '', unitCost: '' });
      await loadEntries();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not add price.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!canManage) return;
    setSaving(true);
    try {
      await api(`/api/purchase-orders/price-list/${id}`, { method: 'DELETE' });
      setEntries((current) => current.filter((entry) => entry.id !== id));
      onError(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not delete price.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stock-operations-grid">
      <Card title="Add price" subtitle="Record a supplier's agreed unit cost for an item so orders prefill accurately.">
        <form className="stock-operation-form" onSubmit={add}>
          <Select label="Supplier" value={supplierId} onChange={(event) => setSupplierId(event.currentTarget.value)} options={supplierOptions} />
          <StockItemPicker
            label="Stock item"
            items={items}
            value={draft.stockItemId}
            onChange={(id) => {
              const item = items.find((candidate) => candidate.id === id);
              setDraft((current) => ({ ...current, stockItemId: id, description: item?.name ?? current.description, unit: itemUnit(item) || current.unit }));
            }}
          />
          <Input label="Description" value={draft.description} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, description: el.value })); }} />
          <div className="stock-filter-toolbar">
            <Input label="Unit" value={draft.unit} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, unit: el.value })); }} />
            <Input label="Unit cost ($)" type="number" min="0" step="0.01" value={draft.unitCost} onChange={(event) => { const el = event.currentTarget; setDraft((current) => ({ ...current, unitCost: el.value })); }} />
          </div>
          <Button type="submit" disabled={saving || !canManage || !addSupplierId}>{saving ? 'Saving…' : 'Add to price list'}</Button>
        </form>
      </Card>

      <Card title="Price list" subtitle="Agreed supplier unit costs." padding="none">
        {loading ? <Spinner label="Loading price list" /> : null}
        {!loading && !entries.length ? (
          <EmptyState title="No prices yet" description="Add supplier prices to build a catalogue." />
        ) : null}
        {entries.length ? (
          <div className="stock-mobile-list">
            {entries.map((entry) => (
              <div key={entry.id} className="stock-operation-row">
                <span>
                  <strong>{entry.stockItem?.name ?? entry.description}</strong>
                  <span className="subtle">
                    {entry.stockItem && entry.stockItem.name !== entry.description ? `${entry.description} · ` : ''}
                    {money(entry.unitCostCents)}{entry.unit ? ` / ${entry.unit}` : ''}
                  </span>
                </span>
                <span className="stock-operation-row-actions">
                  {canManage ? (
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void remove(entry.id)}>Remove</Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
