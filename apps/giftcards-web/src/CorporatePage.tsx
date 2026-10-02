import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CORPORATE_MANUAL_TENDERS,
  CORPORATE_ORDER_MAX_QUANTITY,
  GIFT_CARD_MAX_AMOUNT_CENTS,
  GIFT_CARD_MIN_AMOUNT_CENTS,
  type CorporateAccount,
  type CorporateAccountSummary,
  type CorporateCsvImportResult,
  type CorporateOrderCreateResult,
  type CorporateOrderDetail,
  type CorporateOrderQuote,
  type CorporateOrderSummary,
  type CorporatePoolCard
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { ApiError, api, apiBlob, newRequestId } from './lib/api';

/**
 * Corporate gift cards — the staff screens.
 *
 * Three views on one URL: the account list (/corporate), one account
 * (/corporate?account=…) with its orders and a form to place a new one, and
 * one order (/corporate?order=…) with its payment state and its pool of
 * cards: allocate one, upload a recipient file, re-address or resend.
 *
 * Managers do everything a company would do for itself. The owner-only
 * controls (pricing override, minimum, recording an offline payment,
 * cancelling an unpaid order) are hidden from everyone else rather than left
 * to 403.
 */

const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const dollars = (cents: number | null | undefined) => money.format((cents ?? 0) / 100);
const percent = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' }) : '—';
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' }) : '—';

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function navigate(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  url.pathname = '/corporate';
  for (const [key, value] of Object.entries(params)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  url.searchParams.delete('paid');
  window.history.pushState(null, '', url.toString());
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function useQueryParam(name: string) {
  const read = () => new URLSearchParams(window.location.search).get(name);
  const [value, setValue] = useState<string | null>(read);
  useEffect(() => {
    const sync = () => setValue(read());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return value;
}

const ORDER_STATUS_TONE: Record<CorporateOrderSummary['status'], 'positive' | 'warning' | 'muted'> = {
  ISSUED: 'positive',
  AWAITING_PAYMENT: 'warning',
  CANCELLED: 'muted'
};
const ORDER_STATUS_LABEL: Record<CorporateOrderSummary['status'], string> = {
  ISSUED: 'Issued',
  AWAITING_PAYMENT: 'Awaiting payment',
  CANCELLED: 'Cancelled'
};
const PAYMENT_LABEL: Record<CorporateOrderSummary['paymentMethod'], string> = {
  STRIPE: 'Card (Stripe)',
  MANUAL_OFFLINE: 'Offline (bank transfer, EFTPOS, cash)',
  INVOICE: 'Invoice / PO (not yet available)'
};
const TENDER_LABEL: Record<(typeof CORPORATE_MANUAL_TENDERS)[number], string> = {
  BANK_TRANSFER: 'Bank transfer',
  EFTPOS: 'EFTPOS terminal',
  CARD: 'Card at the counter',
  CASH: 'Cash'
};

export function CorporatePage({ isOwner }: { isOwner: boolean }) {
  const accountId = useQueryParam('account');
  const orderId = useQueryParam('order');
  if (orderId) return <OrderView orderId={orderId} isOwner={isOwner} />;
  if (accountId) return <AccountView accountId={accountId} isOwner={isOwner} />;
  return <AccountsView />;
}

/* ------------------------------------------------------------------ */
/* Accounts list                                                      */
/* ------------------------------------------------------------------ */

function AccountsView() {
  const [accounts, setAccounts] = useState<CorporateAccountSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('query', query.trim());
      if (includeInactive) params.set('includeInactive', 'true');
      setAccounts(await api<CorporateAccountSummary[]>(`/api/gift-cards/corporate/accounts?${params.toString()}`));
    } catch (error) {
      setMessage(errorText(error, 'Could not load corporate accounts.'));
    }
  }, [query, includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const rows = accounts ?? [];
    return {
      accounts: rows.length,
      unallocated: rows.reduce((sum, row) => sum + row.stats.unallocated, 0),
      outstanding: rows.reduce((sum, row) => sum + row.stats.outstandingCents, 0),
      purchased: rows.reduce((sum, row) => sum + row.stats.faceValueCents, 0)
    };
  }, [accounts]);

  return (
    <div className="giftcards-corporate-layout">
      <div className="stats-grid">
        <StatCard label="Corporate accounts" value={totals.accounts} />
        <StatCard label="Face value purchased" value={dollars(totals.purchased)} hint="Issued orders, all accounts" />
        <StatCard label="Unallocated cards" value={totals.unallocated} hint="Bought, not yet given to anyone" />
        <StatCard label="Outstanding on corporate cards" value={dollars(totals.outstanding)} hint="Remaining balance, active cards" />
      </div>

      <Card
        title="Corporate accounts"
        subtitle="Companies that buy in bulk. Open one to place an order, allocate cards or export its activity."
        action={<Button type="button" onClick={() => setCreating((current) => !current)}>{creating ? 'Close' : 'New account'}</Button>}
      >
        {creating ? (
          <AccountForm
            onSaved={(account) => {
              setCreating(false);
              navigate({ account: account.id, order: null });
            }}
          />
        ) : null}
        <div className="giftcards-invoice-filters">
          <Input label="Search" placeholder="Company, contact or ABN" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
          <label className="toggle-row">
            <input type="checkbox" checked={includeInactive} onChange={(event) => setIncludeInactive(event.currentTarget.checked)} />
            <span>Show inactive accounts</span>
          </label>
        </div>
        <ActionFeedback message={message} tone="error" />
        {accounts === null ? <Spinner label="Loading accounts" /> : null}
        {accounts && accounts.length === 0 ? (
          <EmptyState title="No corporate accounts yet" description="Create one for the first company that wants to buy in bulk. Pricing comes from the tiers in Admin setup." />
        ) : null}
        {accounts && accounts.length > 0 ? (
          <div className="giftcards-invoice-table-scroll">
            <table className="giftcards-invoice-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Pricing</th>
                  <th>Purchased</th>
                  <th>Allocated</th>
                  <th>Unallocated</th>
                  <th>Outstanding</th>
                  <th>Last order</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id} className="giftcards-corporate-row" onClick={() => navigate({ account: account.id, order: null })}>
                    <td>
                      <strong>{account.companyName}</strong>
                      <span className="subtle giftcards-invoice-block">{account.contactName} · {account.contactEmail}</span>
                    </td>
                    <td><Badge tone={account.active ? 'positive' : 'muted'}>{account.active ? 'Active' : 'Inactive'}</Badge></td>
                    <td>{account.discountOverrideBps !== null ? `${percent(account.discountOverrideBps)} override` : 'Standard tiers'}</td>
                    <td>{account.stats.cardsPurchased} · {dollars(account.stats.faceValueCents)}</td>
                    <td>{account.stats.allocated}{account.stats.emailFailed ? <span className="error-text"> · {account.stats.emailFailed} failed</span> : null}</td>
                    <td>{account.stats.unallocated}</td>
                    <td>{dollars(account.stats.outstandingCents)}</td>
                    <td>{day(account.stats.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Account form                                                       */
/* ------------------------------------------------------------------ */

function AccountForm({ existing, onSaved }: { existing?: CorporateAccount; onSaved: (account: CorporateAccount) => void }) {
  const [draft, setDraft] = useState({
    companyName: existing?.companyName ?? '',
    tradingName: existing?.tradingName ?? '',
    abn: existing?.abn ?? '',
    contactName: existing?.contactName ?? '',
    contactEmail: existing?.contactEmail ?? '',
    contactPhone: existing?.contactPhone ?? '',
    accountsEmail: existing?.accountsEmail ?? '',
    billingAddress: existing?.billingAddress ?? '',
    notes: existing?.notes ?? '',
    active: existing?.active ?? true
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.currentTarget.value;
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const saved = existing
        ? await api<CorporateAccount>(`/api/gift-cards/corporate/accounts/${encodeURIComponent(existing.id)}`, { method: 'PATCH', body: JSON.stringify(draft) })
        : await api<CorporateAccount>('/api/gift-cards/corporate/accounts', { method: 'POST', body: JSON.stringify(draft) });
      onSaved(saved);
    } catch (error) {
      setMessage(errorText(error, 'Could not save the account.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="giftcards-form giftcards-invoice-subform" onSubmit={(event) => void submit(event)}>
      <div className="form-grid two">
        <Input label="Company name" required value={draft.companyName} onChange={set('companyName')} />
        <Input label="Trading name" value={draft.tradingName} onChange={set('tradingName')} />
        <Input label="ABN" value={draft.abn} onChange={set('abn')} hint="Optional. Used on documents later." />
        <Input label="Contact name" required value={draft.contactName} onChange={set('contactName')} />
        <Input label="Contact email" type="email" required value={draft.contactEmail} onChange={set('contactEmail')} hint="Never sent the vouchers — recipients get those." />
        <Input label="Contact phone" value={draft.contactPhone} onChange={set('contactPhone')} />
        <Input label="Accounts email" type="email" value={draft.accountsEmail} onChange={set('accountsEmail')} />
      </div>
      <Textarea label="Billing address" rows={2} value={draft.billingAddress} onChange={set('billingAddress')} />
      <Textarea label="Internal notes" rows={2} value={draft.notes} onChange={set('notes')} />
      {existing ? (
        <label className="toggle-row">
          <input type="checkbox" checked={draft.active} onChange={(event) => { const checked = event.currentTarget.checked; setDraft((current) => ({ ...current, active: checked })); }} />
          <span>Active — new orders can be placed</span>
        </label>
      ) : null}
      <div className="toolbar-right">
        <ActionFeedback message={message} tone="error" />
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : existing ? 'Save account' : 'Create account'}</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Account view                                                       */
/* ------------------------------------------------------------------ */

function AccountView({ accountId, isOwner }: { accountId: string; isOwner: boolean }) {
  const [data, setData] = useState<{ account: CorporateAccountSummary; orders: CorporateOrderSummary[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [ordering, setOrdering] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api(`/api/gift-cards/corporate/accounts/${encodeURIComponent(accountId)}`));
    } catch (error) {
      setMessage(errorText(error, 'Could not load the account.'));
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function exportCsv() {
    try {
      const blob = await apiBlob(`/api/gift-cards/corporate/accounts/${encodeURIComponent(accountId)}/export.csv`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `alma-corporate-${(data?.account.companyName ?? 'account').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      setMessage(errorText(error, 'Could not export.'));
    }
  }

  if (!data) {
    return (
      <Card title="Corporate account">
        <ActionFeedback message={message} tone="error" />
        {!message ? <Spinner label="Loading account" /> : null}
        <Button type="button" variant="ghost" onClick={() => navigate({ account: null, order: null })}>Back to accounts</Button>
      </Card>
    );
  }
  const { account, orders } = data;
  const stats = account.stats;

  return (
    <div className="giftcards-corporate-layout">
      <div className="toolbar-right" style={{ justifyContent: 'flex-start' }}>
        <Button type="button" variant="ghost" onClick={() => navigate({ account: null, order: null })}>← All accounts</Button>
      </div>
      <div className="stats-grid">
        <StatCard label="Cards purchased" value={stats.cardsPurchased} hint={`${stats.orderCount} order${stats.orderCount === 1 ? '' : 's'}`} />
        <StatCard label="Face value" value={dollars(stats.faceValueCents)} hint={`Discount given ${dollars(stats.discountCents)} · paid ${dollars(stats.amountPaidCents)}`} />
        <StatCard label="Allocated / unallocated" value={`${stats.allocated} / ${stats.unallocated}`} hint={`${stats.emailed} emailed${stats.emailFailed ? ` · ${stats.emailFailed} failed` : ''}`} tone={stats.emailFailed ? 'warning' : undefined} />
        <StatCard label="Outstanding" value={dollars(stats.outstandingCents)} hint={`Redeemed ${dollars(stats.redeemedCents)} · ${stats.redeemedCards} fully used`} />
      </div>

      <Card
        title={account.companyName}
        subtitle={[account.tradingName ? `Trading as ${account.tradingName}` : null, account.abn ? `ABN ${account.abn}` : null, `${account.contactName} · ${account.contactEmail}`].filter(Boolean).join(' · ')}
        action={
          <>
            <Button type="button" variant="secondary" onClick={() => void exportCsv()}>Export cards (CSV)</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing((current) => !current)}>{editing ? 'Close' : 'Edit details'}</Button>
            <Button type="button" onClick={() => setOrdering((current) => !current)} disabled={!account.active}>{ordering ? 'Close' : 'New bulk order'}</Button>
          </>
        }
      >
        <ActionFeedback message={message} tone="error" />
        {!account.active ? <p className="error-text">This account is inactive. Reactivate it under Edit details before placing an order.</p> : null}
        {editing ? (
          <AccountForm
            existing={account}
            onSaved={() => {
              setEditing(false);
              void load();
            }}
          />
        ) : null}
        <TermsPanel account={account} isOwner={isOwner} onSaved={() => void load()} />
        {ordering ? <NewOrderForm account={account} onCreated={(result) => navigate({ order: result.order.id, account: null })} /> : null}
      </Card>

      <Card title="Orders" subtitle="Every bulk order on this account, newest first. Open one to allocate cards or take payment.">
        {orders.length === 0 ? <EmptyState title="No orders yet" description="Place the first bulk order with the button above." /> : null}
        {orders.length > 0 ? <OrdersTable orders={orders} /> : null}
      </Card>
    </div>
  );
}

function TermsPanel({ account, isOwner, onSaved }: { account: CorporateAccount; isOwner: boolean; onSaved: () => void }) {
  const [discount, setDiscount] = useState(account.discountOverrideBps === null ? '' : String(account.discountOverrideBps / 100));
  const [minimum, setMinimum] = useState(account.minimumQuantityOverride === null ? '' : String(account.minimumQuantityOverride));
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDiscount(account.discountOverrideBps === null ? '' : String(account.discountOverrideBps / 100));
    setMinimum(account.minimumQuantityOverride === null ? '' : String(account.minimumQuantityOverride));
  }, [account.discountOverrideBps, account.minimumQuantityOverride]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/gift-cards/corporate/accounts/${encodeURIComponent(account.id)}/terms`, {
        method: 'PATCH',
        body: JSON.stringify({
          discountOverrideBps: discount.trim() === '' ? null : Math.round(Number(discount) * 100),
          minimumQuantityOverride: minimum.trim() === '' ? null : Number(minimum)
        })
      });
      setMessage('Commercial terms saved.');
      onSaved();
    } catch (error) {
      setMessage(errorText(error, 'Could not save terms.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="giftcards-form giftcards-invoice-subform" onSubmit={(event) => void save(event)}>
      <p className="giftcards-invoice-subhead">Commercial terms</p>
      <p className="subtle">
        {account.discountOverrideBps === null
          ? 'Orders are priced from the global quantity tiers in Admin setup.'
          : `A flat ${percent(account.discountOverrideBps)} replaces the global tiers for this company.`}
        {account.minimumQuantityOverride !== null ? ` Minimum ${account.minimumQuantityOverride} cards per order (overrides the global minimum).` : ''}
        {!isOwner ? ' Only Tim can change these.' : ''}
      </p>
      <div className="form-grid two">
        <Input label="Discount override (%)" type="number" min={0} max={50} step={0.5} value={discount} onChange={(event) => setDiscount(event.currentTarget.value)} placeholder="Leave blank to use tiers" disabled={!isOwner} />
        <Input label="Minimum cards per order" type="number" min={1} max={CORPORATE_ORDER_MAX_QUANTITY} value={minimum} onChange={(event) => setMinimum(event.currentTarget.value)} placeholder="Leave blank for global" disabled={!isOwner} />
      </div>
      {isOwner ? (
        <div className="toolbar-right">
          <ActionFeedback message={message} tone={message?.startsWith('Could') ? 'error' : 'success'} />
          <Button type="submit" variant="secondary" disabled={saving}>{saving ? 'Saving…' : 'Save terms'}</Button>
        </div>
      ) : null}
    </form>
  );
}

function OrdersTable({ orders }: { orders: CorporateOrderSummary[] }) {
  return (
    <div className="giftcards-invoice-table-scroll">
      <table className="giftcards-invoice-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Cards</th>
            <th>Face value</th>
            <th>Amount due</th>
            <th>Payment</th>
            <th>Status</th>
            <th>Pool</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="giftcards-corporate-row" onClick={() => navigate({ order: order.id, account: null })}>
              <td className="giftcards-invoice-mono">{order.reference}{order.testMode ? <Badge tone="warning">Test</Badge> : null}</td>
              <td>{order.quantity} × {dollars(order.faceValueCents)}</td>
              <td>{dollars(order.faceValueTotalCents)}</td>
              <td>{dollars(order.amountDueCents)}{order.discountCents ? <span className="subtle giftcards-invoice-block">{percent(order.discountBps)} off</span> : null}</td>
              <td>{PAYMENT_LABEL[order.paymentMethod]}</td>
              <td><Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge></td>
              <td>{order.status === 'ISSUED' ? `${order.pool.unallocated} unallocated · ${order.pool.allocated} sent/scheduled` : '—'}</td>
              <td>{day(order.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* New order                                                          */
/* ------------------------------------------------------------------ */

function NewOrderForm({ account, onCreated }: { account: CorporateAccount; onCreated: (result: CorporateOrderCreateResult) => void }) {
  const [quantity, setQuantity] = useState('50');
  const [valueDollars, setValueDollars] = useState('100');
  const [paymentMethod, setPaymentMethod] = useState<'STRIPE' | 'MANUAL_OFFLINE'>('STRIPE');
  const [poNumber, setPoNumber] = useState('');
  const [customerReference, setCustomerReference] = useState('');
  const [defaultMessage, setDefaultMessage] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [quote, setQuote] = useState<(CorporateOrderQuote & { serviceFeeCents: number; totalPayableCents: number; belowMinimum: boolean }) | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [requestId] = useState(() => newRequestId());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const quantityNumber = Number(quantity);
  const faceValueCents = Math.round(Number(valueDollars) * 100);

  useEffect(() => {
    if (!Number.isFinite(quantityNumber) || quantityNumber < 1 || !Number.isFinite(faceValueCents) || faceValueCents < 100) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<typeof quote>('/api/gift-cards/corporate/quote', {
        method: 'POST',
        body: JSON.stringify({ corporateAccountId: account.id, quantity: quantityNumber, faceValueCents, paymentMethod })
      })
        .then((result) => {
          if (!cancelled) {
            setQuote(result);
            setQuoteError(null);
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setQuote(null);
            setQuoteError(errorText(error, 'Could not price the order.'));
          }
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [account.id, quantityNumber, faceValueCents, paymentMethod]);

  const valueProblem =
    faceValueCents < GIFT_CARD_MIN_AMOUNT_CENTS || faceValueCents > GIFT_CARD_MAX_AMOUNT_CENTS
      ? `Card value must be between ${dollars(GIFT_CARD_MIN_AMOUNT_CENTS)} and ${dollars(GIFT_CARD_MAX_AMOUNT_CENTS)}.`
      : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await api<CorporateOrderCreateResult>('/api/gift-cards/corporate/orders', {
        method: 'POST',
        body: JSON.stringify({
          corporateAccountId: account.id,
          quantity: quantityNumber,
          faceValueCents,
          paymentMethod,
          poNumber,
          customerReference,
          defaultMessage,
          internalNote,
          clientRequestId: requestId
        })
      });
      onCreated(result);
    } catch (error) {
      setMessage(errorText(error, 'Could not create the order.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="giftcards-form giftcards-invoice-subform" onSubmit={(event) => void submit(event)}>
      <p className="giftcards-invoice-subhead">New bulk order</p>
      <div className="form-grid two">
        <Input label="Number of cards" type="number" min={1} max={CORPORATE_ORDER_MAX_QUANTITY} required value={quantity} onChange={(event) => setQuantity(event.currentTarget.value)} />
        <Input label="Value per card ($)" type="number" min={GIFT_CARD_MIN_AMOUNT_CENTS / 100} max={GIFT_CARD_MAX_AMOUNT_CENTS / 100} step={5} required value={valueDollars} onChange={(event) => setValueDollars(event.currentTarget.value)} hint="Every card in the order has this value. Cards stay redeemable at any Alma venue." />
        <Select
          label="Payment"
          value={paymentMethod}
          onChange={(event) => setPaymentMethod(event.currentTarget.value as 'STRIPE' | 'MANUAL_OFFLINE')}
          options={[
            { value: 'STRIPE', label: 'Card now (Stripe checkout link for the buyer)' },
            { value: 'MANUAL_OFFLINE', label: 'Offline — cards are issued once Tim records the money as received' }
          ]}
          hint="Invoice / purchase-order terms are not available yet."
        />
        <Input label="Customer reference / PO" value={poNumber} onChange={(event) => setPoNumber(event.currentTarget.value)} placeholder="Optional" />
        <Input label="Internal reference" value={customerReference} onChange={(event) => setCustomerReference(event.currentTarget.value)} placeholder="Optional" />
      </div>
      <Textarea label="Default message on each card" rows={2} value={defaultMessage} onChange={(event) => setDefaultMessage(event.currentTarget.value)} placeholder="Congratulations on your new home. Enjoy dinner on us." hint="A recipient row or allocation form can override it per card." />
      <Textarea label="Internal note" rows={2} value={internalNote} onChange={(event) => setInternalNote(event.currentTarget.value)} />

      {valueProblem ? <p className="error-text">{valueProblem}</p> : null}
      {quoteError ? <p className="error-text">{quoteError}</p> : null}
      {quote ? (
        <div className="giftcards-corporate-quote" aria-live="polite">
          <div className="line"><span>{quote.quantity} × {dollars(quote.faceValueCents)} gift cards</span><span>{dollars(quote.faceValueTotalCents)}</span></div>
          <div className="line">
            <span>
              Corporate discount{' '}
              {quote.discountSource === 'ACCOUNT_OVERRIDE' ? `(${percent(quote.discountBps)} account rate)` : quote.discountSource === 'GLOBAL_TIER' ? `(${percent(quote.discountBps)} tier)` : '(none at this quantity)'}
            </span>
            <span>−{dollars(quote.discountCents)}</span>
          </div>
          <div className="line"><span>Amount due for the cards</span><span>{dollars(quote.amountDueCents)}</span></div>
          {quote.serviceFeeCents > 0 ? <div className="line"><span>Card processing fee (Stripe, same rate as the shop)</span><span>{dollars(quote.serviceFeeCents)}</span></div> : null}
          <div className="line total"><span>Total payable</span><span>{dollars(quote.totalPayableCents)}</span></div>
          {quote.belowMinimum ? <p className="error-text">This account needs at least {quote.minimumQuantity} cards per order.</p> : null}
          <p className="subtle">Face value is never changed by the discount: each card is worth {dollars(quote.faceValueCents)} at the till.</p>
        </div>
      ) : null}

      <div className="toolbar-right">
        <ActionFeedback message={message} tone="error" />
        <Button type="submit" disabled={submitting || !quote || quote.belowMinimum || Boolean(valueProblem)}>
          {submitting ? 'Creating…' : paymentMethod === 'STRIPE' ? 'Create order and get payment link' : 'Create order (awaiting payment)'}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Order view                                                         */
/* ------------------------------------------------------------------ */

function OrderView({ orderId, isOwner }: { orderId: string; isOwner: boolean }) {
  const [order, setOrder] = useState<CorporateOrderDetail | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'allocate' | 'csv' | 'cards'>('cards');

  const load = useCallback(async () => {
    try {
      setOrder(await api<CorporateOrderDetail>(`/api/gift-cards/corporate/orders/${encodeURIComponent(orderId)}`));
    } catch (error) {
      setMessage(errorText(error, 'Could not load the order.'));
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a Stripe payment is outstanding, poll: the webhook normally lands
  // first, and this catches the buyer paying while the screen is open.
  useEffect(() => {
    if (!order || order.status !== 'AWAITING_PAYMENT' || order.paymentMethod !== 'STRIPE') return;
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, [order, load]);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) setMessage(success);
      await load();
    } catch (error) {
      setMessage(errorText(error, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <Card title="Corporate order">
        <ActionFeedback message={message} tone="error" />
        {!message ? <Spinner label="Loading order" /> : null}
        <Button type="button" variant="ghost" onClick={() => navigate({ order: null, account: null })}>Back to accounts</Button>
      </Card>
    );
  }

  const pool = order.pool;
  const awaitingStripe = order.status === 'AWAITING_PAYMENT' && order.paymentMethod === 'STRIPE';
  const awaitingOffline = order.status === 'AWAITING_PAYMENT' && order.paymentMethod === 'MANUAL_OFFLINE';

  return (
    <div className="giftcards-corporate-layout">
      <div className="toolbar-right" style={{ justifyContent: 'flex-start' }}>
        <Button type="button" variant="ghost" onClick={() => navigate({ account: order.corporateAccountId, order: null })}>← {order.companyName}</Button>
      </div>

      <Card
        title={<>{order.reference} · {order.companyName} {order.testMode ? <Badge tone="warning">Test order</Badge> : null}</>}
        subtitle={`${order.quantity} × ${dollars(order.faceValueCents)} · face value ${dollars(order.faceValueTotalCents)} · discount ${dollars(order.discountCents)}${order.discountBps ? ` (${percent(order.discountBps)})` : ''} · due ${dollars(order.amountDueCents)}${order.serviceFeeCents ? ` + ${dollars(order.serviceFeeCents)} card fee` : ''}`}
        action={<Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>}
      >
        <ActionFeedback message={message} tone={message && /could|not|fail|no /i.test(message) ? 'error' : 'success'} />
        <div className="giftcards-corporate-pool">
          <span><strong>{PAYMENT_LABEL[order.paymentMethod]}</strong><br /><span className="subtle">{order.paymentStatus === 'PAID' ? `Paid ${when(order.paidAt)}${order.tender ? ` · ${order.tender}` : ''}${order.paymentReference ? ` · ${order.paymentReference}` : ''}` : order.paymentStatus === 'CANCELLED' ? `Cancelled ${when(order.cancelledAt)}` : 'Awaiting payment'}</span></span>
          {order.poNumber ? <span><strong>{order.poNumber}</strong><br /><span className="subtle">Customer reference / PO</span></span> : null}
          {order.customerReference ? <span><strong>{order.customerReference}</strong><br /><span className="subtle">Internal reference</span></span> : null}
          {order.issuedAt ? <span><strong>{when(order.issuedAt)}</strong><br /><span className="subtle">Cards issued</span></span> : null}
        </div>
        {order.defaultMessage ? <p className="subtle">Default message: “{order.defaultMessage}”</p> : null}
        {order.cancelReason ? <p className="error-text">Cancelled: {order.cancelReason}</p> : null}

        {awaitingStripe ? (
          <div className="giftcards-form giftcards-invoice-subform">
            <p className="giftcards-invoice-subhead">Take payment by card</p>
            {order.checkoutUrl ? (
              <>
                <p className="subtle">Send the buyer this Stripe link, or open it on their behalf. Cards are issued the moment Stripe confirms; this page checks every few seconds.</p>
                <Input readOnly value={order.checkoutUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Stripe checkout link" />
                <div className="toolbar-right">
                  <Button type="button" variant="secondary" onClick={() => void navigator.clipboard?.writeText(order.checkoutUrl ?? '')}>Copy link</Button>
                  <Button type="button" onClick={() => window.open(order.checkoutUrl ?? '', '_blank', 'noopener')}>Open checkout</Button>
                </div>
              </>
            ) : (
              <>
                <p className="subtle">The previous checkout link expired or was never created. Make a new one.</p>
                <div className="toolbar-right">
                  <Button type="button" disabled={busy} onClick={() => void run(() => api(`/api/gift-cards/corporate/orders/${encodeURIComponent(order.id)}/stripe-checkout`, { method: 'POST' }))}>New payment link</Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {awaitingOffline ? (isOwner ? <ManualPaymentForm order={order} busy={busy} onSubmit={(body) => run(() => api(`/api/gift-cards/corporate/orders/${encodeURIComponent(order.id)}/manual-payment`, { method: 'POST', body: JSON.stringify(body) }), 'Payment recorded and cards issued.')} /> : (
          <p className="subtle">Cards are issued once Tim records the payment as received. Nothing to do here until then.</p>
        )) : null}

        {order.status === 'AWAITING_PAYMENT' && isOwner ? (
          <div className="toolbar-right">
            <Button type="button" variant="danger" disabled={busy} onClick={() => {
              const reason = window.prompt('Why is this order being cancelled?');
              if (!reason || reason.trim().length < 3) return;
              void run(() => api(`/api/gift-cards/corporate/orders/${encodeURIComponent(order.id)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Order cancelled.');
            }}>Cancel order</Button>
          </div>
        ) : null}
      </Card>

      {order.status === 'ISSUED' ? (
        <Card
          title="Card pool"
          subtitle="Every card below already exists and already counts as outstanding gift-card value. Allocating one fills in who it is for and sends it; it never creates a card or takes a payment."
          action={
            <>
              <Button type="button" variant={tab === 'cards' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('cards')}>Cards</Button>
              <Button type="button" variant={tab === 'allocate' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('allocate')} disabled={pool.unallocated === 0}>Send one card</Button>
              <Button type="button" variant={tab === 'csv' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('csv')} disabled={pool.unallocated === 0}>Upload recipients</Button>
            </>
          }
        >
          <div className="giftcards-corporate-pool">
            <span><strong>{pool.total}</strong><br /><span className="subtle">purchased</span></span>
            <span><strong>{pool.allocated}</strong><br /><span className="subtle">allocated</span></span>
            <span><strong>{pool.unallocated}</strong><br /><span className="subtle">available</span></span>
            <span><strong>{pool.emailed}</strong><br /><span className="subtle">emailed</span></span>
            <span><strong>{pool.scheduled}</strong><br /><span className="subtle">scheduled</span></span>
            <span className={pool.emailFailed ? 'error-text' : undefined}><strong>{pool.emailFailed}</strong><br /><span className="subtle">failed</span></span>
            <span><strong>{pool.redeemedCards}</strong><br /><span className="subtle">fully redeemed</span></span>
            <span><strong>{dollars(pool.outstandingCents)}</strong><br /><span className="subtle">outstanding</span></span>
          </div>

          {tab === 'allocate' ? (
            <AllocateForm
              busy={busy}
              defaultMessage={order.defaultMessage}
              onSubmit={(body) => run(() => api(`/api/gift-cards/corporate/orders/${encodeURIComponent(order.id)}/allocate`, { method: 'POST', body: JSON.stringify(body) }), 'Card allocated.')}
            />
          ) : null}
          {tab === 'csv' ? <CsvImport orderId={order.id} busy={busy} onDone={() => void load()} /> : null}
          {tab === 'cards' ? (
            <PoolTable
              cards={order.cards}
              busy={busy}
              onResend={(card) => run(() => api(`/api/gift-cards/corporate/cards/${encodeURIComponent(card.id)}/resend`, { method: 'POST' }), 'Voucher sent again.')}
              onReassign={(card, body) => run(() => api(`/api/gift-cards/corporate/cards/${encodeURIComponent(card.id)}/reassign`, { method: 'POST', body: JSON.stringify(body) }), 'Card re-addressed.')}
            />
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function ManualPaymentForm({ order, busy, onSubmit }: { order: CorporateOrderDetail; busy: boolean; onSubmit: (body: { tender: string; paymentReference: string; paidAt: string }) => void }) {
  const [tender, setTender] = useState<(typeof CORPORATE_MANUAL_TENDERS)[number]>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [paidAt, setPaidAt] = useState('');
  return (
    <form
      className="giftcards-form giftcards-invoice-subform"
      onSubmit={(event) => {
        event.preventDefault();
        if (!window.confirm(`Record ${dollars(order.amountDueCents)} as received for ${order.reference} and issue ${order.quantity} cards now?`)) return;
        onSubmit({ tender, paymentReference: reference, paidAt });
      }}
    >
      <p className="giftcards-invoice-subhead">Record the payment as received</p>
      <p className="subtle">Only once the money has actually arrived. Recording it issues {order.quantity} live gift cards worth {dollars(order.faceValueTotalCents)}. No invoice is produced here.</p>
      <div className="form-grid two">
        <Select label="How it was paid" value={tender} onChange={(event) => setTender(event.currentTarget.value as typeof tender)} options={CORPORATE_MANUAL_TENDERS.map((value) => ({ value, label: TENDER_LABEL[value] }))} />
        <Input label="Reference" value={reference} onChange={(event) => setReference(event.currentTarget.value)} placeholder="Bank reference, receipt number" />
        <Input label="Date received" type="datetime-local" value={paidAt} onChange={(event) => setPaidAt(event.currentTarget.value)} hint="Leave blank for now" />
      </div>
      <div className="toolbar-right">
        <Button type="submit" disabled={busy}>{busy ? 'Working…' : `Record ${dollars(order.amountDueCents)} received and issue cards`}</Button>
      </div>
    </form>
  );
}

function AllocateForm({ busy, defaultMessage, onSubmit }: { busy: boolean; defaultMessage: string | null; onSubmit: (body: Record<string, string>) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [reference, setReference] = useState('');
  const [scheduled, setScheduled] = useState('');
  return (
    <form
      className="giftcards-form giftcards-invoice-subform"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ recipientName: name, recipientEmail: email, message, reference, scheduledDeliveryAt: scheduled ? new Date(scheduled).toISOString() : '' });
        setName('');
        setEmail('');
        setReference('');
        setScheduled('');
      }}
    >
      <p className="giftcards-invoice-subhead">Send one card</p>
      <div className="form-grid two">
        <Input label="Recipient name" required value={name} onChange={(event) => setName(event.currentTarget.value)} />
        <Input label="Recipient email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
        <Input label="Reference" value={reference} onChange={(event) => setReference(event.currentTarget.value)} placeholder="12 Ocean St settlement" />
        <Input label="Send on" type="datetime-local" value={scheduled} onChange={(event) => setScheduled(event.currentTarget.value)} hint="Leave blank to send now" />
      </div>
      <Textarea label="Message" rows={2} value={message} onChange={(event) => setMessage(event.currentTarget.value)} placeholder={defaultMessage ?? 'Optional'} hint={defaultMessage ? 'Blank uses the order’s default message.' : undefined} />
      <div className="toolbar-right">
        <Button type="submit" disabled={busy}>{busy ? 'Working…' : scheduled ? 'Allocate and schedule' : 'Allocate and send now'}</Button>
      </div>
    </form>
  );
}

function CsvImport({ orderId, busy, onDone }: { orderId: string; busy: boolean; onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<CorporateCsvImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(dryRun: boolean) {
    setWorking(true);
    setError(null);
    try {
      const response = await api<CorporateCsvImportResult>(`/api/gift-cards/corporate/orders/${encodeURIComponent(orderId)}/recipients`, { method: 'POST', body: JSON.stringify({ csv, dryRun }) });
      setResult(response);
      if (!dryRun && response.valid) onDone();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : errorText(caught, 'Upload failed.'));
    } finally {
      setWorking(false);
    }
  }

  async function downloadTemplate() {
    const blob = await apiBlob('/api/gift-cards/corporate/recipients-template.csv');
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alma-corporate-recipients-template.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="giftcards-form giftcards-invoice-subform giftcards-corporate-csv">
      <p className="giftcards-invoice-subhead">Upload recipients</p>
      <p className="subtle">
        Columns: firstName, lastName, email, message, scheduledDeliveryAt, reference. There is no value column — every card in this order has the order’s value.
        The whole file is checked first; nothing is allocated unless every row is valid and the pool can cover it. Uploading the same file again allocates nothing new.
      </p>
      <div className="toolbar-right" style={{ justifyContent: 'flex-start' }}>
        <Button type="button" variant="ghost" size="sm" onClick={() => void downloadTemplate()}>Download template</Button>
        <label>
          <span className="subtle">Choose a CSV file</span>{' '}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                setCsv(text);
                setResult(null);
              });
            }}
          />
        </label>
      </div>
      <Textarea label="Or paste the CSV" rows={6} value={csv} onChange={(event) => { setCsv(event.currentTarget.value); setResult(null); }} />
      <div className="toolbar-right">
        <ActionFeedback message={error} tone="error" />
        <Button type="button" variant="secondary" disabled={working || busy || !csv.trim()} onClick={() => void send(true)}>Check file</Button>
        <Button type="button" disabled={working || busy || !result?.valid || result.dryRun === false} onClick={() => void send(false)}>
          {working ? 'Working…' : `Allocate ${result?.summary.toAllocate ?? ''} card${result?.summary.toAllocate === 1 ? '' : 's'}`}
        </Button>
      </div>
      {result ? (
        <div className="giftcards-corporate-quote">
          <div className="line"><span>Valid rows in file</span><span>{result.summary.rowCount}</span></div>
          {result.errors.length > 0 ? <div className="line error-text"><span>Problems to fix before anything is allocated</span><span>{result.errors.length}</span></div> : null}
          <div className="line"><span>New cards to allocate</span><span>{result.summary.toAllocate}</span></div>
          <div className="line"><span>Already allocated from an earlier upload</span><span>{result.summary.alreadyAllocated}</span></div>
          <div className="line"><span>Unallocated cards available</span><span>{result.summary.available}</span></div>
          {result.summary.shortfall > 0 ? <div className="line error-text"><span>Short by</span><span>{result.summary.shortfall}</span></div> : null}
          {result.errors.length > 0 ? (
            <ul className="giftcards-corporate-errors error-text">
              {result.errors.map((problem, index) => (
                <li key={index}>{problem.row > 0 ? `Row ${problem.row}${problem.field ? ` (${problem.field})` : ''}: ` : ''}{problem.message}</li>
              ))}
            </ul>
          ) : null}
          {result.valid && result.dryRun ? <p className="subtle">File is valid. Press “Allocate” to send.</p> : null}
          {result.allocated ? (
            <p>
              Allocated {result.allocated.length} row{result.allocated.length === 1 ? '' : 's'}: {result.allocated.filter((row) => row.emailed).length} emailed,{' '}
              {result.allocated.filter((row) => !row.emailed && !row.emailError).length} scheduled,{' '}
              <span className={result.allocated.some((row) => row.emailError) ? 'error-text' : undefined}>{result.allocated.filter((row) => row.emailError).length} failed</span>.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PoolTable({ cards, busy, onResend, onReassign }: {
  cards: CorporatePoolCard[];
  busy: boolean;
  onResend: (card: CorporatePoolCard) => void;
  onReassign: (card: CorporatePoolCard, body: Record<string, string>) => void;
}) {
  const [filter, setFilter] = useState<'all' | 'allocated' | 'unallocated' | 'failed'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const visible = cards.filter((card) => {
    if (filter === 'allocated') return card.allocationStatus === 'ALLOCATED';
    if (filter === 'unallocated') return card.allocationStatus === 'UNALLOCATED' && card.status === 'ACTIVE';
    if (filter === 'failed') return Boolean(card.emailError) && !card.emailedAt;
    return true;
  });

  return (
    <>
      <div className="giftcards-invoice-filters">
        <Select
          label="Show"
          value={filter}
          onChange={(event) => setFilter(event.currentTarget.value as typeof filter)}
          options={[
            { value: 'all', label: 'All cards' },
            { value: 'allocated', label: 'Allocated' },
            { value: 'unallocated', label: 'Unallocated' },
            { value: 'failed', label: 'Email failed' }
          ]}
        />
      </div>
      <div className="giftcards-invoice-table-scroll">
        <table className="giftcards-invoice-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Recipient</th>
              <th>Reference</th>
              <th>Delivery</th>
              <th>Balance</th>
              <th>Status</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visible.map((card) => {
              const delivery = card.emailedAt
                ? `Emailed ${when(card.emailedAt)}`
                : card.emailError
                  ? `Failed: ${card.emailError}`
                  : card.scheduledDeliveryAt
                    ? `Scheduled ${when(card.scheduledDeliveryAt)}`
                    : card.allocationStatus === 'ALLOCATED'
                      ? 'Sending…'
                      : 'In pool';
              const canReassign = card.allocationStatus === 'ALLOCATED' && card.status === 'ACTIVE' && !card.emailedAt;
              const canResend = card.allocationStatus === 'ALLOCATED' && card.status === 'ACTIVE';
              return (
                <tr key={card.id} className={`giftcards-corporate-row${open === card.id ? ' is-open' : ''}`} onClick={() => setOpen((current) => (current === card.id ? null : card.id))}>
                  <td className="giftcards-invoice-mono">{card.allocationStatus === 'UNALLOCATED' ? `···${card.code.slice(-4)}` : card.code}</td>
                  <td>{card.recipientName ? <>{card.recipientName}<span className="subtle giftcards-invoice-block">{card.recipientEmail}</span></> : <span className="subtle">Not yet allocated</span>}</td>
                  <td>{card.reference ?? '—'}</td>
                  <td className={card.emailError && !card.emailedAt ? 'error-text' : undefined}>{delivery}</td>
                  <td>{dollars(card.balanceCents)} <span className="subtle">of {dollars(card.initialValueCents)}</span></td>
                  <td><Badge tone={card.status === 'ACTIVE' ? (card.allocationStatus === 'ALLOCATED' ? 'positive' : 'info') : card.status === 'REDEEMED' ? 'neutral' : 'muted'}>{card.status === 'ACTIVE' ? (card.allocationStatus === 'ALLOCATED' ? 'Allocated' : 'Unallocated') : card.status}</Badge></td>
                  <td onClick={(event) => event.stopPropagation()}>
                    {canResend ? <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => onResend(card)}>Resend</Button> : null}
                    {canReassign && open === card.id ? (
                      <ReassignForm
                        card={card}
                        busy={busy}
                        onSubmit={(body) => {
                          onReassign(card, body);
                          setOpen(null);
                        }}
                      />
                    ) : canReassign ? <span className="subtle giftcards-invoice-block">Click row to re-address</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="subtle">Unallocated codes are shown masked; a pool card cannot be printed, emailed or redeemed until it is allocated. To take a card off the books, cancel it from Orders like any other gift card.</p>
    </>
  );
}

function ReassignForm({ card, busy, onSubmit }: { card: CorporatePoolCard; busy: boolean; onSubmit: (body: Record<string, string>) => void }) {
  const [name, setName] = useState(card.recipientName ?? '');
  const [email, setEmail] = useState(card.recipientEmail ?? '');
  const [scheduled, setScheduled] = useState('');
  return (
    <form
      className="giftcards-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ recipientName: name, recipientEmail: email, scheduledDeliveryAt: scheduled ? new Date(scheduled).toISOString() : '' });
      }}
    >
      <Input label="New recipient name" required value={name} onChange={(event) => setName(event.currentTarget.value)} />
      <Input label="New recipient email" type="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      <Input label="Send on" type="datetime-local" value={scheduled} onChange={(event) => setScheduled(event.currentTarget.value)} hint="Blank sends now" />
      <Button type="submit" size="sm" disabled={busy}>Re-address</Button>
    </form>
  );
}

/** Shown to staff and venue iPads who type the URL: the API refuses them, so say so plainly. */
export function CorporateManagersOnly() {
  return (
    <Card title="Corporate gift cards" subtitle="Bulk orders for companies.">
      <p className="subtle">
        Corporate accounts, bulk orders and recipient pools are looked after by the managers. If a company asks the venue
        about buying in bulk, pass it to a manager rather than quoting a price.
      </p>
    </Card>
  );
}
