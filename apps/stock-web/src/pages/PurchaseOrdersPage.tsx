import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  StockFullOrderGuidePayload,
  StockItem,
  StockInvoicesPayload,
  StockOrderGuideLine,
  StockPurchaseOrderSendEmail,
  StockSupplierInvoice
} from '@alma/shared';
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
  sentAt?: string | null;
  sentTo?: string | null;
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

type BatchResult = {
  venue: string;
  results: Array<{
    supplierName: string;
    purchaseOrder: PurchaseOrder | null;
    email: StockPurchaseOrderSendEmail | null;
    error: string | null;
  }>;
  generatedAt: string;
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

/** The price a guide line would go on an order at: agreed first, else last paid. */
function linePriceCents(line: StockOrderGuideLine): number | null {
  return line.agreedCostCents ?? line.lastPaidCents;
}

const STEPS_HIDDEN_KEY = 'alma.stock.orderingStepsHidden';

/**
 * The four steps of the whole purchasing loop, in the order they happen. This
 * strip is the instructions: always on screen until someone who knows the flow
 * hides it, and one tap brings it back.
 */
function OrderingSteps({ onHide }: { onHide: () => void }) {
  return (
    <div className="stock-guide-steps">
      <ol>
        <li>
          <strong>Set quantities.</strong> Everything you order is listed under its supplier — anything running
          short is already filled in.
        </li>
        <li>
          <strong>Review &amp; send.</strong> One email goes to each supplier. No email on file? You get the exact
          text to copy.
        </li>
        <li>
          <strong>Receive the delivery.</strong> Open the order under Orders when the truck arrives — stock levels
          update on their own.
        </li>
        <li>
          <strong>Match the invoice.</strong> Ordered vs received vs billed — price rises get flagged before you
          pay.
        </li>
      </ol>
      <Button type="button" size="sm" variant="ghost" onClick={onHide}>
        Hide
      </Button>
    </div>
  );
}

export function PurchaseOrdersPage() {
  useDocumentTitle('Ordering');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [view, setView] = useState<'order' | 'orders' | 'prices'>('order');
  const [data, setData] = useState<PurchaseOrdersPayload | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [invoices, setInvoices] = useState<StockSupplierInvoice[]>([]);
  const [selectedVenue, setSelectedVenue] = useStickyVenue();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The manual, typed-by-hand order form. Tucked away — the guide is the flow;
  // this is the escape hatch for one-offs and for editing an existing draft.
  const [showManual, setShowManual] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Per-order panels (receive / match)
  const [panel, setPanel] = useState<{ orderId: string; mode: 'receive' | 'match' } | null>(null);
  const [receiveDraft, setReceiveDraft] = useState<Record<string, string>>({});
  const [matchInvoiceId, setMatchInvoiceId] = useState('');
  const [matchResults, setMatchResults] = useState<Record<string, MatchResult['match']>>({});
  // What happened when an order was sent from the Orders list.
  const [sendResult, setSendResult] = useState<{ orderId: string; email: StockPurchaseOrderSendEmail } | null>(null);

  const [stepsHidden, setStepsHidden] = useState(() => {
    try {
      return window.localStorage.getItem(STEPS_HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  function hideSteps(hidden: boolean) {
    setStepsHidden(hidden);
    try {
      window.localStorage.setItem(STEPS_HIDDEN_KEY, hidden ? '1' : '');
    } catch {
      /* private mode */
    }
  }

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

  // Stock items power the pickers; invoices power the match picker. Both non-fatal.
  useEffect(() => {
    let cancelled = false;
    api<{ items: StockItem[] }>('/api/items/picker')
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
  const openOrderCount = (data?.orders ?? []).filter(
    (order) => order.status === 'DRAFT' || order.status === 'SENT' || order.status === 'PARTIALLY_RECEIVED'
  ).length;

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
    setView('order');
    setShowManual(true);
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
      setShowManual(false);
      setView('orders');
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
      const result = await api<{ purchaseOrder: PurchaseOrder; email: StockPurchaseOrderSendEmail }>(
        `/api/purchase-orders/${order.id}/send`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      setSendResult({ orderId: order.id, email: result.email });
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
        title="Ordering"
        subtitle="Everything you order, under the supplier it comes from. Set quantities, review, send — then receive the delivery and the invoice matches against it."
        action={
          stepsHidden ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => hideSteps(false)}>
              How ordering works
            </Button>
          ) : null
        }
      >
        {!stepsHidden ? <OrderingSteps onHide={() => hideSteps(true)} /> : null}
        <div className="stock-filter-toolbar">
          <Select
            label="Venue"
            value={selectedVenue}
            onChange={(event) => setSelectedVenue(event.currentTarget.value)}
            options={venueOptions}
          />
          <div className="po-view-toggle" role="tablist" aria-label="Ordering view">
            <Button
              type="button"
              size="sm"
              variant={view === 'order' ? 'primary' : 'ghost'}
              onClick={() => setView('order')}
            >
              Build order
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === 'orders' ? 'primary' : 'ghost'}
              onClick={() => setView('orders')}
            >
              Orders{openOrderCount > 0 ? ` (${openOrderCount})` : ''}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === 'prices' ? 'primary' : 'ghost'}
              onClick={() => setView('prices')}
            >
              Price list
            </Button>
          </div>
        </div>
        {!canManage ? <p className="subtle">Manager access is required to create or action purchase orders.</p> : null}
      </Card>

      {error ? (
        <Card padding="tight">
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {view === 'order' ? (
        <>
          <OrderBuilder
            venue={activeVenue}
            canManage={canManage}
            suppliers={data?.suppliers ?? []}
            items={items}
            onError={setError}
            onOrdersChanged={() => void load(activeVenue)}
            onViewOrders={() => setView('orders')}
          />

          {!showManual ? (
            <p className="subtle" style={{ textAlign: 'center' }}>
              Something the guide doesn't cover?{' '}
              <button type="button" className="stock-guide-link" onClick={() => setShowManual(true)}>
                Type a one-off order by hand
              </button>
            </p>
          ) : (
            <Card
              title={editingId ? 'Edit purchase order' : 'One-off order'}
              subtitle="Typed by hand — for a new supplier or something not in the guide yet."
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    resetForm();
                    setShowManual(false);
                  }}
                >
                  Close
                </Button>
              }
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
          )}
        </>
      ) : null}

      {view === 'orders' ? (
        <Card
          title="Orders"
          subtitle="Draft, sent, received and matched orders for the selected venue. Receive stock here when the delivery lands."
          padding="none"
        >
          {loading ? <Spinner label="Loading purchase orders" /> : null}
          {!loading && !data?.orders.length ? (
            <EmptyState
              title="No purchase orders yet"
              description="Build the first one on the Build order tab — set quantities and send."
            />
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
                        {order.sentAt && order.sentTo ? (
                          <span className="subtle">Emailed to {order.sentTo} · {new Date(order.sentAt).toLocaleString()}</span>
                        ) : null}
                      </span>
                      <span className="stock-operation-row-actions">
                        <Badge tone={statusTone(order.status)}>{order.status.replaceAll('_', ' ')}</Badge>
                        {canManage && order.status === 'DRAFT' ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              disabled={saving}
                              title={order.supplier?.email ? `Emails the order to ${order.supplier.email}` : 'No supplier email saved — you will get the order text to copy'}
                              onClick={() => void sendOrder(order)}
                            >
                              Send
                            </Button>
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => editOrder(order)}>Edit</Button>
                            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void cancelOrder(order)}>Cancel</Button>
                          </>
                        ) : null}
                        {canManage && (order.status === 'SENT' || order.status === 'PARTIALLY_RECEIVED') ? (
                          <>
                            <Button type="button" size="sm" disabled={saving} onClick={() => (isPanelOpen && panel?.mode === 'receive' ? setPanel(null) : openReceive(order))}>
                              {isPanelOpen && panel?.mode === 'receive' ? 'Close' : 'Receive'}
                            </Button>
                            {order.status === 'SENT' ? (
                              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void sendOrder(order)}>Resend</Button>
                            ) : null}
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

                    {sendResult?.orderId === order.id ? (
                      <div className="po-panel">
                        {sendResult.email.status === 'SENT' ? (
                          <p className="subtle">Order emailed to {sendResult.email.to}.</p>
                        ) : (
                          <>
                            <p className="error-text">{sendResult.email.warning}</p>
                            <Textarea
                              label={`Copy and send yourself — subject: ${sendResult.email.subject}`}
                              rows={8}
                              readOnly
                              value={sendResult.email.body}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void navigator.clipboard
                                  ?.writeText(`${sendResult.email.subject}\n\n${sendResult.email.body}`)
                                  .catch(() => undefined);
                              }}
                            >
                              Copy order text
                            </Button>
                          </>
                        )}
                        <Button type="button" size="sm" variant="ghost" onClick={() => setSendResult(null)}>
                          Dismiss
                        </Button>
                      </div>
                    ) : null}

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
      ) : null}

      {view === 'prices' ? (
        <SupplierPriceListSection
          suppliers={data?.suppliers ?? []}
          items={items}
          canManage={canManage}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

type OrderBuilderProps = {
  venue: string;
  canManage: boolean;
  suppliers: Array<{ id: string; name: string; email: string | null }>;
  items: StockItem[];
  onError: (message: string | null) => void;
  onOrdersChanged: () => void;
  onViewOrders: () => void;
};

const NO_SUPPLIER = '__none__';

/**
 * The whole order on one screen.
 *
 * Everything the venue buys, grouped under the supplier it comes from, with
 * anything running short already quantified. The buyer walks the list top to
 * bottom, adjusts numbers, hits review — and the orders split themselves by
 * supplier and go out in one send. This replaces three separate ways of
 * starting an order (below-par suggestions, a per-supplier guide behind a
 * dropdown, and the manual form) with the one flow people actually follow.
 */
function OrderBuilder({ venue, canManage, suppliers, items, onError, onOrdersChanged, onViewOrders }: OrderBuilderProps) {
  const [guide, setGuide] = useState<StockFullOrderGuidePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [shortsOnly, setShortsOnly] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // Lines added from the catalogue that the guide didn't already carry.
  const [extras, setExtras] = useState<Record<string, StockOrderGuideLine[]>>({});
  const [adderFor, setAdderFor] = useState<string | null>(null);
  const [adderItem, setAdderItem] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [note, setNote] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  // Where the "no supplier on file" lines should go, chosen at review time.
  const [unassignedSupplierId, setUnassignedSupplierId] = useState('');
  const [unassignedSupplierName, setUnassignedSupplierName] = useState('');
  const [result, setResult] = useState<BatchResult | null>(null);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});

  const lineKey = (groupKey: string, line: StockOrderGuideLine) =>
    `${groupKey}|${line.stockItemId ?? `desc:${line.description}`}`;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const query = venue ? `?venue=${encodeURIComponent(venue)}` : '';
      const payload = await api<StockFullOrderGuidePayload>(`/api/purchase-orders/order-guide/all${query}`);
      setGuide(payload);
      // Below-par quantities prefill. A suggestion is a starting point — every
      // number is editable before anything is sent.
      const prefill: Record<string, string> = {};
      for (const group of payload.suppliers) {
        for (const line of group.lines) {
          if (line.suggestedQuantity > 0) prefill[lineKey(group.supplier.id, line)] = String(line.suggestedQuantity);
        }
      }
      for (const line of payload.unassigned) {
        if (line.suggestedQuantity > 0) prefill[lineKey(NO_SUPPLIER, line)] = String(line.suggestedQuantity);
      }
      setQty(prefill);
      setExtras({});
      setOpenGroups({});
      setResult(null);
      setReviewing(false);
      onError(null);
    } catch (err) {
      setGuide(null);
      onError(err instanceof ApiError ? err.message : 'Could not load the order guide.');
    } finally {
      setLoading(false);
    }
  }, [venue]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Guide groups plus any hand-added lines, in render order.
  const groups = useMemo(() => {
    if (!guide) return [];
    const merged = guide.suppliers.map((group) => ({
      key: group.supplier.id,
      supplier: group.supplier,
      lines: [...group.lines, ...(extras[group.supplier.id] ?? [])]
    }));
    const unassignedLines = [...guide.unassigned, ...(extras[NO_SUPPLIER] ?? [])];
    if (unassignedLines.length > 0) {
      merged.push({
        key: NO_SUPPLIER,
        supplier: { id: NO_SUPPLIER, name: 'No supplier on file yet', email: null },
        lines: unassignedLines
      });
    }
    return merged;
  }, [guide, extras]);

  const needle = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    return groups
      .map((group) => {
        let lines = group.lines;
        if (needle) lines = lines.filter((line) => line.description.toLowerCase().includes(needle));
        if (shortsOnly) {
          lines = lines.filter(
            (line) => line.suggestedQuantity > 0 || line.checkPar || Number(qty[lineKey(group.key, line)] ?? 0) > 0
          );
        }
        return { ...group, lines };
      })
      .filter((group) => group.lines.length > 0);
  }, [groups, needle, shortsOnly, qty]);

  // Everything with a quantity, grouped the way the orders will be raised.
  const chosen = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        picked: group.lines
          .map((line) => ({ line, quantity: Number(qty[lineKey(group.key, line)] ?? 0) }))
          .filter((entry) => Number.isFinite(entry.quantity) && entry.quantity > 0)
      }))
      .filter((group) => group.picked.length > 0);
  }, [groups, qty]);

  const chosenLineCount = chosen.reduce((sum, group) => sum + group.picked.length, 0);
  const estimatedCents = chosen.reduce(
    (sum, group) =>
      sum +
      group.picked.reduce((groupSum, { line, quantity }) => {
        const price = linePriceCents(line);
        return price === null ? groupSum : groupSum + Math.round(price * quantity);
      }, 0),
    0
  );

  function groupSubtotal(group: (typeof chosen)[number]) {
    return group.picked.reduce((sum, { line, quantity }) => {
      const price = linePriceCents(line);
      return price === null ? sum : sum + Math.round(price * quantity);
    }, 0);
  }

  function isOpen(group: { key: string; lines: StockOrderGuideLine[] }) {
    if (needle) return true;
    const explicit = openGroups[group.key];
    if (explicit !== undefined) return explicit;
    // Open by default where there is something to act on.
    return group.lines.some(
      (line) => line.suggestedQuantity > 0 || line.checkPar || Number(qty[lineKey(group.key, line)] ?? 0) > 0
    );
  }

  function addExtra(groupKey: string, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const existing = groups
      .find((group) => group.key === groupKey)
      ?.lines.find((line) => line.stockItemId === item.id);
    const key = existing
      ? lineKey(groupKey, existing)
      : lineKey(groupKey, { stockItemId: item.id } as StockOrderGuideLine);
    if (!existing) {
      setExtras((current) => ({
        ...current,
        [groupKey]: [
          ...(current[groupKey] ?? []),
          {
            stockItemId: item.id,
            description: item.name,
            unit: itemUnit(item) || null,
            onHand: item.onHand ?? null,
            parLevel: item.parLevel ?? null,
            agreedCostCents: null,
            agreedEffectiveAt: null,
            lastPaidCents: item.latestCostCents ?? null,
            lastPurchasedAt: null,
            priceMovement: null,
            suggestedQuantity: 0
          }
        ]
      }));
    }
    setQty((current) => ({ ...current, [key]: current[key] && Number(current[key]) > 0 ? current[key] : '1' }));
    setAdderFor(null);
    setAdderItem('');
  }

  async function saveSupplierEmail(supplierId: string) {
    const email = (emailDrafts[supplierId] ?? '').trim();
    if (!email) return;
    try {
      await api(`/api/suppliers/${supplierId}`, { method: 'PATCH', body: JSON.stringify({ email }) });
      setGuide((current) =>
        current
          ? {
              ...current,
              suppliers: current.suppliers.map((group) =>
                group.supplier.id === supplierId ? { ...group, supplier: { ...group.supplier, email } } : group
              )
            }
          : current
      );
      setNotice(`Saved — orders for this supplier now email to ${email}.`);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not save the supplier email.');
    }
  }

  async function submitBatch(send: boolean) {
    if (!canManage || busy) return;
    if (!venue) {
      setNotice('Choose a venue first — orders belong to one.');
      return;
    }
    const unassignedGroup = chosen.find((group) => group.key === NO_SUPPLIER);
    const supplierName =
      unassignedSupplierName.trim() ||
      suppliers.find((supplier) => supplier.id === unassignedSupplierId)?.name ||
      '';
    if (unassignedGroup && !supplierName) {
      setNotice('Say who supplies the "no supplier on file" lines — pick one or type a name.');
      return;
    }
    const orders = chosen.map((group) => ({
      supplierId: group.key === NO_SUPPLIER ? unassignedSupplierId || undefined : group.key,
      supplierName: group.key === NO_SUPPLIER ? supplierName : group.supplier.name,
      lines: group.picked.map(({ line, quantity }) => ({
        stockItemId: line.stockItemId ?? undefined,
        description: line.description,
        unit: line.unit ?? undefined,
        orderedQuantity: quantity,
        unitCostCents: linePriceCents(line) ?? 0
      }))
    }));
    if (orders.length === 0) {
      setNotice('Set a quantity on at least one line.');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const payload = await api<BatchResult>('/api/purchase-orders/batch', {
        method: 'POST',
        body: JSON.stringify({ venue, send, message: note, expectedAt, orders })
      });
      setResult(payload);
      setReviewing(false);
      setQty({});
      setExtras({});
      onOrdersChanged();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not raise the orders.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card padding="none">
        <Spinner label="Building your order guide…" />
      </Card>
    );
  }

  if (result) {
    const sentCount = result.results.filter((row) => row.email?.status === 'SENT').length;
    const copyCount = result.results.filter((row) => row.email && row.email.status !== 'SENT').length;
    const draftCount = result.results.filter((row) => !row.email && !row.error).length;
    return (
      <Card
        title="Orders away"
        subtitle={[
          sentCount ? `${sentCount} emailed to suppliers` : null,
          copyCount ? `${copyCount} need copying below` : null,
          draftCount ? `${draftCount} saved as drafts on the Orders tab` : null
        ]
          .filter(Boolean)
          .join(' · ') || 'Nothing was raised.'}
      >
        <div className="stock-order-sheet">
          {result.results.map((row, index) => (
            <div key={index} className="stock-order-email-result">
              <div className="stock-order-supplier-head">
                <strong>{row.supplierName}</strong>
                {row.error ? (
                  <Badge tone="danger">Failed</Badge>
                ) : row.email?.status === 'SENT' ? (
                  <span>
                    <Badge tone="positive">Emailed</Badge>{' '}
                    <span className="subtle">{row.email.to}</span>
                  </span>
                ) : row.email ? (
                  <Badge tone="warning">Copy &amp; send yourself</Badge>
                ) : (
                  <Badge tone="muted">Draft saved</Badge>
                )}
              </div>
              {row.error ? <p className="error-text">{row.error}</p> : null}
              {row.email && row.email.status !== 'SENT' ? (
                <>
                  <p className="subtle">{row.email.warning}</p>
                  <pre>{row.email.body}</pre>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(`${row.email!.subject}\n\n${row.email!.body}`)
                        .catch(() => undefined);
                    }}
                  >
                    Copy order text
                  </Button>
                </>
              ) : null}
            </div>
          ))}
          <div className="stock-operation-row-actions">
            <Button type="button" onClick={() => void reload()}>
              Back to the guide
            </Button>
            <Button type="button" variant="secondary" onClick={onViewOrders}>
              View orders
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (reviewing) {
    const unassignedGroup = chosen.find((group) => group.key === NO_SUPPLIER);
    return (
      <Card
        title="Review &amp; send"
        subtitle="One order per supplier. Check the numbers, then everything goes out at once."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={() => setReviewing(false)}>
            Back to the guide
          </Button>
        }
      >
        <div className="stock-order-sheet">
          {notice ? <p className="error-text">{notice}</p> : null}
          {chosen.map((group) => (
            <div key={group.key} className="stock-order-supplier-group">
              <div className="stock-order-supplier-head">
                <span>
                  <strong>{group.key === NO_SUPPLIER ? 'No supplier on file yet' : group.supplier.name}</strong>
                  <span className="subtle">
                    {group.picked.length} line{group.picked.length === 1 ? '' : 's'}
                    {groupSubtotal(group) > 0 ? ` · about ${money(groupSubtotal(group))}` : ''}
                  </span>
                </span>
                {group.key === NO_SUPPLIER ? null : group.supplier.email ? (
                  <span className="subtle">emails to {group.supplier.email}</span>
                ) : (
                  <span className="stock-guide-email-fix">
                    <Input
                      placeholder="orders@supplier.com"
                      value={emailDrafts[group.key] ?? ''}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setEmailDrafts((current) => ({ ...current, [group.key]: value }));
                      }}
                    />
                    <Button type="button" size="sm" variant="secondary" onClick={() => void saveSupplierEmail(group.key)}>
                      Save email
                    </Button>
                  </span>
                )}
              </div>
              {group.key === NO_SUPPLIER ? (
                <div className="stock-filter-toolbar">
                  <Select
                    label="Send these to"
                    value={unassignedSupplierId}
                    onChange={(event) => setUnassignedSupplierId(event.currentTarget.value)}
                    options={[{ label: 'Pick a supplier…', value: '' }, ...suppliers.map((supplier) => ({ label: supplier.name, value: supplier.id }))]}
                  />
                  <Input
                    label="Or type a name"
                    value={unassignedSupplierName}
                    onChange={(event) => setUnassignedSupplierName(event.currentTarget.value)}
                  />
                </div>
              ) : null}
              <ul className="stock-guide-review-lines">
                {group.picked.map(({ line, quantity }) => {
                  const price = linePriceCents(line);
                  return (
                    <li key={lineKey(group.key, line)}>
                      <span>
                        {quantity} {line.unit ?? ''} × <strong>{line.description}</strong>
                        {price !== null ? <span className="subtle"> · about {money(Math.round(price * quantity))}</span> : null}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setQty((current) => ({ ...current, [lineKey(group.key, line)]: '' }))
                        }
                      >
                        Remove
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {unassignedGroup ? (
            <p className="subtle">
              Tip: once one of that supplier's invoices is matched, these items file themselves under the right
              supplier automatically.
            </p>
          ) : null}
          <div className="stock-filter-toolbar">
            <Input
              label="Deliver by (all orders)"
              type="date"
              value={expectedAt}
              onChange={(event) => setExpectedAt(event.currentTarget.value)}
            />
          </div>
          <Textarea
            label="Note to suppliers (goes on every order)"
            rows={2}
            placeholder="e.g. Please deliver before 10am"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <div className="stock-operation-row-actions">
            <Button type="button" disabled={busy || !canManage} onClick={() => void submitBatch(true)}>
              {busy ? 'Sending…' : `Send ${chosen.length} order${chosen.length === 1 ? '' : 's'} now`}
            </Button>
            <Button type="button" variant="secondary" disabled={busy || !canManage} onClick={() => void submitBatch(false)}>
              Save as drafts instead
            </Button>
          </div>
          <p className="subtle">
            About {money(estimatedCents)} across {chosen.length} supplier{chosen.length === 1 ? '' : 's'}. Sending
            emails each supplier and records every order under the Orders tab.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Everything you order"
        subtitle="Built from your invoices and price lists — grouped by supplier, priced at what you actually pay. Anything below par is already filled in."
        padding="none"
      >
        <div className="stock-filter-toolbar" style={{ padding: '12px 12px 0' }}>
          <Input
            placeholder="Search items…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant={shortsOnly ? 'primary' : 'ghost'}
            onClick={() => setShortsOnly((current) => !current)}
          >
            Only what's short
          </Button>
        </div>
        {notice ? <p className="subtle" style={{ padding: '6px 12px' }}>{notice}</p> : null}
        {groups.length === 0 ? (
          <EmptyState
            title="Nothing on file yet"
            description="The guide builds itself from supplier invoices and price lists. Import an invoice (Invoices tab) or add prices on the Price list tab, and everything you buy appears here."
          />
        ) : null}
        {groups.length > 0 && visibleGroups.length === 0 ? (
          <EmptyState
            title={needle ? `Nothing matching “${search.trim()}”` : 'Nothing is short'}
            description={
              needle
                ? 'Try a different search, or add it as a one-off order below.'
                : 'Nothing is below par right now. Turn off “Only what\'s short” to see the whole guide.'
            }
          />
        ) : null}

        {visibleGroups.map((group) => {
          const open = isOpen(group);
          const shorts = group.lines.filter((line) => line.suggestedQuantity > 0).length;
          const entered = group.lines.filter((line) => Number(qty[lineKey(group.key, line)] ?? 0) > 0);
          const enteredCents = entered.reduce((sum, line) => {
            const price = linePriceCents(line);
            return price === null ? sum : sum + Math.round(price * Number(qty[lineKey(group.key, line)] ?? 0));
          }, 0);
          return (
            <section key={group.key} className="stock-buying-group">
              <button
                type="button"
                className="stock-buying-group-head"
                onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !open }))}
              >
                <strong>{group.supplier.name}</strong>
                <span className="subtle">
                  {group.lines.length} item{group.lines.length === 1 ? '' : 's'}
                  {entered.length > 0 ? ` · ordering ${entered.length}${enteredCents > 0 ? ` (about ${money(enteredCents)})` : ''}` : ''}
                </span>
                {shorts > 0 ? <Badge tone="warning">{shorts} short</Badge> : null}
                {group.key === NO_SUPPLIER ? (
                  <Badge tone="neutral">Below par — supplier unknown</Badge>
                ) : !group.supplier.email ? (
                  <Badge tone="neutral">No email saved</Badge>
                ) : null}
              </button>

              {open ? (
                <div className="stock-buying-rows">
                  {group.key === NO_SUPPLIER ? (
                    <p className="subtle" style={{ padding: '0 12px' }}>
                      These are running short but no invoice or price list says who supplies them. Order them anyway —
                      you pick the supplier at review — or match one of their invoices and they file themselves.
                    </p>
                  ) : null}
                  {group.lines.map((line) => {
                    const key = lineKey(group.key, line);
                    const price = linePriceCents(line);
                    // Last invoice above the agreed price = a rise nobody signed off.
                    const risen =
                      line.agreedCostCents !== null && line.lastPaidCents !== null && line.lastPaidCents > line.agreedCostCents;
                    return (
                      <div key={key} className="stock-buying-row">
                        <span>
                          <strong>{line.description}</strong>
                          {line.suggestedQuantity > 0 ? <Badge tone="warning">short</Badge> : null}
                          {line.checkPar ? <Badge tone="danger">check par</Badge> : null}
                          <span className="subtle">
                            {line.onHand !== null ? `on hand ${line.onHand}` : ''}
                            {line.parLevel ? ` / par ${line.parLevel}` : ''}
                            {price !== null ? ` · ${money(price)}${line.unit ? `/${line.unit}` : ''}` : ' · no price yet'}
                            {line.priceMovement !== null && line.priceMovement >= 0.15
                              ? ` · up ${Math.round(line.priceMovement * 100)}% on the best price paid`
                              : ''}
                          </span>
                          {risen ? <span className="error-text">Last invoice came in above the agreed price</span> : null}
                          {line.checkPar ? (
                            <span className="error-text">
                              The par behind this can't be right — fix the count unit on the item, then recount.
                            </span>
                          ) : null}
                        </span>
                        <span className="stock-buying-price">
                          <Input
                            label="Qty"
                            type="number"
                            min="0"
                            step="1"
                            value={qty[key] ?? ''}
                            disabled={!canManage}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setQty((current) => ({ ...current, [key]: value }));
                            }}
                          />
                        </span>
                      </div>
                    );
                  })}
                  <div className="stock-buying-row">
                    {adderFor === group.key ? (
                      <span className="stock-guide-adder">
                        <StockItemPicker
                          label="Add from the catalogue"
                          items={items}
                          value={adderItem}
                          onChange={(id) => setAdderItem(id)}
                        />
                        <Button type="button" size="sm" disabled={!adderItem} onClick={() => addExtra(group.key, adderItem)}>
                          Add
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => { setAdderFor(null); setAdderItem(''); }}>
                          Close
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => { setAdderFor(group.key); setAdderItem(''); }}
                      >
                        + Add another item
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </section>
          );
        })}
      </Card>

      {chosenLineCount > 0 ? (
        <div className="stock-guide-bar">
          <span>
            <strong>
              {chosenLineCount} item{chosenLineCount === 1 ? '' : 's'} · {chosen.length} supplier{chosen.length === 1 ? '' : 's'}
            </strong>
            {estimatedCents > 0 ? <span className="subtle"> · about {money(estimatedCents)}</span> : null}
          </span>
          <span className="stock-operation-row-actions">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setQty({})}>
              Clear
            </Button>
            <Button type="button" disabled={busy || !canManage || !venue} onClick={() => { setNotice(null); setReviewing(true); }}>
              Review &amp; send
            </Button>
          </span>
        </div>
      ) : null}
      {chosenLineCount > 0 && !venue ? (
        <p className="subtle" style={{ textAlign: 'center' }}>Choose a venue above before sending — orders belong to one.</p>
      ) : null}
    </>
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

      <Card title="Price list" subtitle="Agreed supplier unit costs. Kept current automatically as invoice costs are applied." padding="none">
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
