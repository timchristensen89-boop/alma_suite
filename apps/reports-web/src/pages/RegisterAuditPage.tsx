import { useEffect, useMemo, useState } from 'react';
import { staffApi } from '../lib/api';

// ── Register audit ──────────────────────────────────────────────────────────
// Every discount, comp, price change, wastage entry, void and refund the
// registers recorded in the selected week — who did it, to what, and why.

type Adjustment = {
  id: string;
  venue: string;
  kind: string;
  reason: string;
  staffName: string;
  itemName: string | null;
  amountCents: number | null;
  createdAt: string;
};

type VoidRow = {
  orderNumber: number;
  venue: string;
  tableLabel: string | null;
  totalCents: number;
  voidReason: string | null;
  voidedAt: string;
  openedByName: string | null;
  lines: Array<{ name: string; quantity: number }>;
};

type RefundRow = {
  amountCents: number;
  method: string;
  createdAt: string;
  order: { orderNumber: number; venue: string; tableLabel: string | null };
};

type Audit = {
  totals: {
    discountCents: number;
    compCents: number;
    wastageCount: number;
    priceChangeCount: number;
    voidCount: number;
    voidCents: number;
    refundCents: number;
  };
  adjustments: Adjustment[];
  voids: VoidRow[];
  refunds: RefundRow[];
};

const VENUE_OPTIONS = ['All venues', 'Alma Avalon', 'St Alma'];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function startOfWeek(date: Date): Date {
  const next = new Date(date);
  const day = (next.getDay() + 6) % 7; // Monday = 0
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function formatRange(from: Date, to: Date) {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${from.toLocaleDateString('en-AU', opts)} – ${to.toLocaleDateString('en-AU', opts)}`;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const KIND_LABELS: Record<string, string> = {
  DISCOUNT: 'Discount',
  COMP: 'Comp',
  PRICE_CHANGE: 'Price change',
  WASTAGE: 'Wastage'
};

export function RegisterAuditPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [venue, setVenue] = useState('All venues');
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    const params = new URLSearchParams({ from: dayKey(weekStart), to: dayKey(weekEnd) });
    if (venue !== 'All venues') params.set('venue', venue);
    setAudit(null);
    staffApi<Audit>(`/api/pos/audit?${params.toString()}`)
      .then((next) => {
        setAudit(next);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the audit.'));
  }, [weekStart, weekEnd, venue]);

  const totals = audit?.totals;

  return (
    <section className="reports-section report-active-section">
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Register audit</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, addDays(weekEnd, -1))}</span>
            <div className="alma-roster-weeknav">
              <button type="button" className="alma-roster-weeknav-btn" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 6 9 12 15 18" /></svg>
              </button>
              <button type="button" className="alma-roster-weeknav-btn" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18" /></svg>
              </button>
              <button type="button" className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text" onClick={() => setWeekStart(startOfWeek(new Date()))}>
                This week
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="audit-venues">
        {VENUE_OPTIONS.map((name) => (
          <button key={name} type="button" className={venue === name ? 'is-on' : ''} onClick={() => setVenue(name)}>
            {name}
          </button>
        ))}
      </div>

      {error ? <p className="report-lead">{error}</p> : null}
      {!audit && !error ? <p className="report-lead">Loading…</p> : null}

      {totals ? (
        <div className="audit-tiles">
          <div className="audit-tile">
            <small>Discounts</small>
            <strong>{money(totals.discountCents)}</strong>
          </div>
          <div className="audit-tile">
            <small>Comps</small>
            <strong>{money(totals.compCents)}</strong>
          </div>
          <div className="audit-tile">
            <small>Voids</small>
            <strong>
              {totals.voidCount} · {money(totals.voidCents)}
            </strong>
          </div>
          <div className="audit-tile">
            <small>Refunds</small>
            <strong>{money(totals.refundCents)}</strong>
          </div>
          <div className="audit-tile">
            <small>Wastage entries</small>
            <strong>{totals.wastageCount}</strong>
          </div>
          <div className="audit-tile">
            <small>Price changes</small>
            <strong>{totals.priceChangeCount}</strong>
          </div>
        </div>
      ) : null}

      {audit && audit.adjustments.length > 0 ? (
        <div className="report-panel">
          <h3>Adjustments</h3>
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Venue</th>
                <th>Type</th>
                <th>Item</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Staff</th>
              </tr>
            </thead>
            <tbody>
              {audit.adjustments.map((adjustment) => (
                <tr key={adjustment.id}>
                  <td>{formatWhen(adjustment.createdAt)}</td>
                  <td>{adjustment.venue}</td>
                  <td>{KIND_LABELS[adjustment.kind] ?? adjustment.kind}</td>
                  <td>{adjustment.itemName ?? '—'}</td>
                  <td>{adjustment.amountCents ? money(adjustment.amountCents) : '—'}</td>
                  <td>{adjustment.reason}</td>
                  <td>{adjustment.staffName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {audit && audit.voids.length > 0 ? (
        <div className="report-panel">
          <h3>Voided orders</h3>
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Venue</th>
                <th>Order</th>
                <th>Items</th>
                <th>Value</th>
                <th>Reason</th>
                <th>Opened by</th>
              </tr>
            </thead>
            <tbody>
              {audit.voids.map((row) => (
                <tr key={`${row.venue}-${row.orderNumber}`}>
                  <td>{formatWhen(row.voidedAt)}</td>
                  <td>{row.venue}</td>
                  <td>{row.tableLabel ? `Table ${row.tableLabel}` : `#${row.orderNumber}`}</td>
                  <td>{row.lines.map((line) => `${line.quantity}× ${line.name}`).join(', ') || '—'}</td>
                  <td>{money(row.totalCents)}</td>
                  <td>{row.voidReason ?? '—'}</td>
                  <td>{row.openedByName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {audit && audit.refunds.length > 0 ? (
        <div className="report-panel">
          <h3>Refunds</h3>
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Venue</th>
                <th>Order</th>
                <th>Method</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {audit.refunds.map((row, index) => (
                <tr key={index}>
                  <td>{formatWhen(row.createdAt)}</td>
                  <td>{row.order.venue}</td>
                  <td>{row.order.tableLabel ? `Table ${row.order.tableLabel}` : `#${row.order.orderNumber}`}</td>
                  <td>{row.method}</td>
                  <td>{money(-row.amountCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {audit && audit.adjustments.length === 0 && audit.voids.length === 0 && audit.refunds.length === 0 ? (
        <p className="report-lead">A clean week — no discounts, comps, voids or refunds recorded on the registers.</p>
      ) : null}
    </section>
  );
}
