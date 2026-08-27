import { useCallback, useEffect, useState } from 'react';
import type { StockInvoicesPayload, StockPaymentsSummary, StockSupplierInvoice } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Spinner, StatCard } from '@alma/ui';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

// Payments: every supplier bill and whether money has actually gone out
// against it. Recording is one tap for the everyday case (paid in full),
// takes an amount for part-payments, and is reversible — mark unpaid puts a
// mistake back the way it was.

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function when(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function overdue(invoice: StockSupplierInvoice) {
  return Boolean(invoice.dueDate && new Date(invoice.dueDate).getTime() < Date.now());
}

export function PaymentsPage() {
  useDocumentTitle('Payments');
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [summary, setSummary] = useState<StockPaymentsSummary | null>(null);
  const [invoices, setInvoices] = useState<StockSupplierInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-invoice payment form: open one at a time, amount blank = pay in full.
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payDraft, setPayDraft] = useState({ amount: '', paidAt: '', reference: '' });
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryPayload, unpaidPayload] = await Promise.all([
        api<StockPaymentsSummary>('/api/invoices/payments-summary'),
        api<StockInvoicesPayload>('/api/invoices?unpaid=1')
      ]);
      setSummary(summaryPayload);
      setInvoices(unpaidPayload.invoices);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load payments.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function recordPayment(invoice: StockSupplierInvoice) {
    if (!canManage) return;
    setBusyId(invoice.id);
    try {
      const amountDollars = Number(payDraft.amount);
      await api(`/api/invoices/${invoice.id}/record-payment`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: payDraft.amount.trim() && amountDollars > 0 ? Math.round(amountDollars * 100) : undefined,
          paidAt: payDraft.paidAt || undefined,
          reference: payDraft.reference || undefined
        })
      });
      setPayFor(null);
      setPayDraft({ amount: '', paidAt: '', reference: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record the payment.');
    } finally {
      setBusyId(null);
    }
  }

  const shown = supplierFilter
    ? invoices.filter((invoice) => (invoice.supplierId ?? invoice.supplierName) === supplierFilter)
    : invoices;

  return (
    <div className="page-stack">
      <Card
        title="Payments"
        subtitle="Every unpaid supplier bill, matched to the money that goes out against it. Overdue first."
      >
        {summary ? (
          <div className="stats-grid">
            <StatCard label="Owing" value={money(summary.unpaidTotalCents)} hint={`${summary.unpaidCount} unpaid bill${summary.unpaidCount === 1 ? '' : 's'}`} />
            <StatCard
              label="Overdue"
              value={money(summary.overdueTotalCents)}
              hint={summary.overdueCount ? `${summary.overdueCount} past due date` : 'Nothing past due'}
            />
            <StatCard label="Paid last 30 days" value={money(summary.paidLast30DaysCents)} hint="Recorded here" />
          </div>
        ) : null}
        {!canManage ? <p className="subtle">Manager access is required to record payments.</p> : null}
      </Card>

      {error ? (
        <Card padding="tight">
          <p className="error-text">{error}</p>
        </Card>
      ) : null}

      {summary && summary.suppliers.length > 0 ? (
        <Card title="Owed by supplier" subtitle="Tap a supplier to filter the bills below." padding="none">
          <div className="stock-mobile-list">
            {summary.suppliers.map((row) => {
              const key = row.supplierId ?? row.supplierName;
              const active = supplierFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  className="stock-operation-row"
                  style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: 'pointer', opacity: supplierFilter && !active ? 0.55 : 1 }}
                  onClick={() => setSupplierFilter(active ? null : key)}
                >
                  <span>
                    <strong>{row.supplierName}</strong>
                    <span className="subtle">
                      {row.unpaidCount} bill{row.unpaidCount === 1 ? '' : 's'}
                      {row.oldestDueDate ? ` · oldest due ${when(row.oldestDueDate)}` : ''}
                    </span>
                  </span>
                  <span className="stock-operation-row-actions">
                    <strong>{money(row.unpaidTotalCents)}</strong>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Card title="Unpaid bills" subtitle="Amount owing is the total less anything already recorded against it." padding="none">
        {loading ? <Spinner label="Loading payments" /> : null}
        {!loading && shown.length === 0 ? (
          <EmptyState
            title={supplierFilter ? 'Nothing owing to this supplier' : 'Nothing owing'}
            description={supplierFilter ? 'Clear the supplier filter to see the rest.' : 'Every imported bill has a payment recorded against it.'}
          />
        ) : null}
        {shown.length > 0 ? (
          <div className="stock-mobile-list">
            {shown.map((invoice) => {
              const owing = Math.max(0, invoice.totalCents - invoice.amountPaidCents);
              const isOverdue = overdue(invoice);
              const isOpen = payFor === invoice.id;
              return (
                <div key={invoice.id} className="po-block">
                  <div className="stock-operation-row">
                    <span>
                      <strong>{invoice.supplierName}</strong>
                      <span className="subtle">
                        {invoice.invoiceNumber ? `#${invoiceNumberLabel(invoice.invoiceNumber)} · ` : ''}
                        {when(invoice.invoiceDate) ?? 'no date'}
                        {invoice.dueDate ? ` · due ${when(invoice.dueDate)}` : ''}
                        {invoice.paymentStatus === 'PARTIALLY_PAID' ? ` · ${money(invoice.amountPaidCents)} already paid` : ''}
                      </span>
                    </span>
                    <span className="stock-operation-row-actions">
                      {isOverdue ? <Badge tone="danger">Overdue</Badge> : null}
                      {invoice.paymentStatus === 'PARTIALLY_PAID' ? <Badge tone="warning">Part paid</Badge> : null}
                      <strong>{money(owing)}</strong>
                      {canManage ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyId === invoice.id}
                          onClick={() => {
                            setPayFor(isOpen ? null : invoice.id);
                            setPayDraft({ amount: '', paidAt: '', reference: '' });
                          }}
                        >
                          {isOpen ? 'Close' : 'Record payment'}
                        </Button>
                      ) : null}
                    </span>
                  </div>
                  {isOpen ? (
                    <div className="po-panel">
                      <div className="stock-filter-toolbar">
                        <Input
                          label={`Amount ($) — blank pays the ${money(owing)} owing`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={payDraft.amount}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setPayDraft((current) => ({ ...current, amount: value }));
                          }}
                        />
                        <Input
                          label="Paid on"
                          type="date"
                          value={payDraft.paidAt}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setPayDraft((current) => ({ ...current, paidAt: value }));
                          }}
                        />
                        <Input
                          label="Reference"
                          placeholder="Bank ref, batch, cheque…"
                          value={payDraft.reference}
                          onChange={(event) => {
                            const value = event.currentTarget.value;
                            setPayDraft((current) => ({ ...current, reference: value }));
                          }}
                        />
                      </div>
                      <Button type="button" disabled={busyId === invoice.id} onClick={() => void recordPayment(invoice)}>
                        {busyId === invoice.id ? 'Recording…' : 'Record payment'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// Xero invoice numbers sometimes arrive already prefixed ("INV-0231"); avoid
// rendering "##INV-0231".
function invoiceNumberLabel(value: string) {
  return value.replace(/^#+/, '');
}
