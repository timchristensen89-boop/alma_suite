// Projected supplier spend — built for the administrator view (Cameron).
// Weekly projected spend per supplier: Xero P&L COGS-vs-sales trend applied to
// the sales forecast, split food/beverage, then split across suppliers by
// their trailing share of invoiced spend. The basis panel shows every input so
// the numbers can be audited rather than trusted blind.

import { useEffect, useMemo, useState } from 'react';
import type { SupplierSpendBucket, SupplierSpendPayload } from '@alma/shared';
import { Badge, Button, Card, Spinner } from '@alma/ui';
import { staffApi } from '../lib/api';

function money(cents: number | null | undefined, decimals = 0) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: decimals
  }).format(cents / 100);
}

function pct(value: number | null | undefined, decimals = 1) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(decimals)}%`;
}

function weekLabel(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  });
}

function monthLabel(key: string) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-AU', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC'
  });
}

const BUCKET_LABELS: Record<SupplierSpendBucket, string> = {
  food: 'Food',
  beverage: 'Beverage',
  other: 'Other COGS'
};

const BUCKET_ORDER: SupplierSpendBucket[] = ['food', 'beverage', 'other'];

export function SupplierSpendPage() {
  const [payload, setPayload] = useState<SupplierSpendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [venue, setVenue] = useState<string>('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ weeks: '8' });
    if (venue !== 'all') params.set('venue', venue);
    staffApi<SupplierSpendPayload>(`/api/reports/projected-supplier-spend?${params.toString()}`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the projection.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [venue]);

  const grouped = useMemo(() => {
    if (!payload) return [];
    return BUCKET_ORDER.map((bucket) => ({
      bucket,
      rows: payload.suppliers.filter((supplier) => supplier.bucket === bucket)
    })).filter((group) => group.rows.length > 0);
  }, [payload]);

  function exportCsv() {
    if (!payload) return;
    const esc = (value: string | number) => {
      const s = String(value);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dollars = (cents: number) => (cents / 100).toFixed(2);
    const rows: Array<Array<string | number>> = [];
    rows.push([`Projected supplier spend — ${payload.venue ?? 'all venues'}`]);
    rows.push([`Generated ${new Date(payload.generatedAt).toLocaleString('en-AU')}`]);
    rows.push([
      `Basis: Xero P&L (${payload.basis.plSource}), projected COGS ${pct(payload.basis.projectedCogsPct)}, food ${pct(payload.basis.split.food)} / bev ${pct(payload.basis.split.beverage)} / other ${pct(payload.basis.split.other)}, supplier shares from trailing ${payload.basis.supplierWindowDays} days of invoices`
    ]);
    rows.push([]);
    rows.push(['Supplier', 'Category', 'Share of category', ...payload.weeks.map((week) => `Wk ${week.weekStart}`), 'Total']);
    for (const group of grouped) {
      for (const supplier of group.rows) {
        rows.push([
          supplier.name,
          BUCKET_LABELS[supplier.bucket],
          (supplier.share * 100).toFixed(1) + '%',
          ...supplier.weekly.map(dollars),
          dollars(supplier.totalCents)
        ]);
      }
    }
    rows.push([]);
    rows.push(['Week totals', '', '', ...payload.weeks.map((week) => dollars(week.cogsCents)), dollars(payload.weeks.reduce((sum, week) => sum + week.cogsCents, 0))]);
    const csv = rows.map((row) => row.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `supplier-spend-${payload.venue ?? 'all-venues'}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (loading) {
    return (
      <Card>
        <div className="forecast-loading">
          <Spinner /> Building the projection…
        </div>
      </Card>
    );
  }

  if (error || !payload) {
    return (
      <Card title="Projected supplier spend">
        <p className="subtle">{error ?? 'Could not load the projection.'}</p>
        <p className="subtle">
          This report needs Xero connected (Admin → Integrations) and at least two months of P&L history.
        </p>
      </Card>
    );
  }

  const totalProjected = payload.weeks.reduce((sum, week) => sum + week.cogsCents, 0);
  const venueOptions = ['all', ...payload.venues];
  const trendPerMonth = payload.basis.cogsPctTrendPerMonth;

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <div className="stat-card tone-info">
          <div className="stat-card-top">
            <span className="stat-card-label">Projected COGS</span>
          </div>
          <div className="stat-card-value">{pct(payload.basis.projectedCogsPct)}</div>
          <div className="stat-card-hint">
            of forecast sales · trend {trendPerMonth >= 0 ? '+' : ''}
            {(trendPerMonth * 100).toFixed(2)} pts/month{payload.basis.clamped ? ' (clamped)' : ''}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Food / Beverage split</span>
          </div>
          <div className="stat-card-value">
            {pct(payload.basis.split.food, 0)} / {pct(payload.basis.split.beverage, 0)}
          </div>
          <div className="stat-card-hint">from the trailing three months of P&L COGS accounts</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-top">
            <span className="stat-card-label">Next {payload.weeks.length} weeks</span>
          </div>
          <div className="stat-card-value">{money(totalProjected)}</div>
          <div className="stat-card-hint">projected supplier spend across the horizon</div>
        </div>
      </div>

      <Card
        title="Projected spend per supplier per week"
        subtitle={`COGS trend from Xero P&L totals (${payload.basis.plSource === 'venue' ? 'this venue’s organisation' : 'group'}), applied to the sales forecast, split by trailing supplier shares.`}
        action={
          <div className="forecast-venue-tabs">
            {venueOptions.map((option) => (
              <button
                key={option}
                type="button"
                className={venue === option ? 'is-active' : undefined}
                onClick={() => setVenue(option)}
              >
                {option === 'all' ? 'All venues' : option}
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Share</th>
                {payload.weeks.map((week) => (
                  <th key={week.weekStart} className="num">
                    {weekLabel(week.weekStart)}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => {
                const bucketWeekly = payload.weeks.map((week) =>
                  group.bucket === 'food' ? week.foodCents : group.bucket === 'beverage' ? week.bevCents : week.otherCents
                );
                return [
                  <tr key={`${group.bucket}-head`} className="supplier-spend-bucket-row">
                    <td>
                      <Badge tone={group.bucket === 'food' ? 'positive' : group.bucket === 'beverage' ? 'info' : 'neutral'}>
                        {BUCKET_LABELS[group.bucket]}
                      </Badge>
                    </td>
                    <td />
                    {bucketWeekly.map((cents, index) => (
                      <td key={index} className="num">
                        <strong>{money(cents)}</strong>
                      </td>
                    ))}
                    <td className="num">
                      <strong>{money(bucketWeekly.reduce((sum, cents) => sum + cents, 0))}</strong>
                    </td>
                  </tr>,
                  ...group.rows.map((supplier) => (
                    <tr key={`${group.bucket}-${supplier.name}`}>
                      <td>{supplier.name}</td>
                      <td className="subtle">{pct(supplier.share, 0)}</td>
                      {supplier.weekly.map((cents, index) => (
                        <td key={index} className="num">
                          {money(cents)}
                        </td>
                      ))}
                      <td className="num">{money(supplier.totalCents)}</td>
                    </tr>
                  ))
                ];
              })}
              <tr className="supplier-spend-total-row">
                <td>
                  <strong>All projected COGS</strong>
                </td>
                <td />
                {payload.weeks.map((week) => (
                  <td key={week.weekStart} className="num">
                    <strong>{money(week.cogsCents)}</strong>
                  </td>
                ))}
                <td className="num">
                  <strong>{money(totalProjected)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {payload.basis.notes.length > 0 ? (
          <ul className="supplier-spend-notes subtle">
            {payload.basis.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card
        title="How this is worked out"
        subtitle="Every input, so the projection can be audited: monthly P&L totals, the trend, and where each supplier share comes from."
      >
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="num">Sales (P&L)</th>
                <th className="num">COGS (P&L)</th>
                <th className="num">COGS %</th>
                <th className="num">Food share</th>
                <th className="num">Bev share</th>
              </tr>
            </thead>
            <tbody>
              {payload.basis.plMonths.map((month) => (
                <tr key={month.month}>
                  <td>{monthLabel(month.month)}</td>
                  <td className="num">{money(month.salesCents)}</td>
                  <td className="num">{money(month.cogsCents)}</td>
                  <td className="num">{pct(month.cogsPct)}</td>
                  <td className="num">{pct(month.foodShare, 0)}</td>
                  <td className="num">{pct(month.bevShare, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="subtle supplier-spend-method">
          Supplier shares come from the trailing {payload.basis.supplierWindowDays} days of finalised supplier
          invoices — shares hold up even while some invoices are missing, because every supplier is affected
          alike. Totals come from Xero P&L, never from summing invoices. Suppliers under 2% of their category
          are grouped into “Other suppliers”.
        </p>
      </Card>
    </div>
  );
}
