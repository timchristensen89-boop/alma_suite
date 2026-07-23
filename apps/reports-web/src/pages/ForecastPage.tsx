import { useEffect, useMemo, useState } from 'react';
import type {
  ForecastAccuracyPayload,
  ForecastBacktestPayload,
  ForecastCashflowPayload,
  ForecastConfigPayload,
  ForecastDay,
  ForecastFixedCost,
  ForecastOutlookPayload,
  ForecastVenueOutlook
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, Input, Select, Spinner } from '@alma/ui';
import { staffApi } from '../lib/api';
import { TrendLine } from '../components/Charts';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function money(cents: number | null | undefined, decimals = 0) {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: decimals
  }).format(cents / 100);
}

function moneyK(cents: number) {
  return cents >= 100_000_00 ? `$${Math.round(cents / 100_000) / 10}k` : money(cents);
}

function fmtDate(key: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString('en-AU', { ...opts, timeZone: 'UTC' });
}

function pctLabel(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function salesMethodBadge(day: ForecastDay) {
  if (day.closed) return <Badge tone="neutral">closed</Badge>;
  switch (day.method.sales) {
    case 'history+bookings':
      return <Badge tone="info">bookings raised</Badge>;
    case 'actual+pace':
      return <Badge tone="positive">actual</Badge>;
    default:
      return <Badge tone="neutral">history</Badge>;
  }
}

function HeroMetric({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint: string; tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'info' }) {
  return (
    <Card className="forecast-hero-metric" padding="tight">
      <div className="forecast-hero-inner">
        <span className="forecast-hero-label">{label}</span>
        <strong className="forecast-hero-value">{value}</strong>
        <small className="subtle">{hint}</small>
        {tone !== 'neutral' ? (
          <span className="forecast-hero-badge">
            <Badge tone={tone}>{tone === 'positive' ? 'on track' : tone === 'info' ? 'note' : 'watch'}</Badge>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ── Cash-flow assumptions editor ─────────────────────────────────────────────

function CashflowConfigEditor({ config, onSaved }: { config: ForecastConfigPayload; onSaved: () => void }) {
  const [openingBalance, setOpeningBalance] = useState(String(Math.round(config.openingBalanceCents / 100)));
  const [supplierLag, setSupplierLag] = useState(String(config.supplierPaymentLagDays));
  const [settleLag, setSettleLag] = useState(String(config.cardSettlementLagDays));
  const [payWeekday, setPayWeekday] = useState(String(config.payrollPayWeekday));
  const [fixedCosts, setFixedCosts] = useState<ForecastFixedCost[]>(config.fixedCosts);
  const [newCost, setNewCost] = useState({ name: '', amount: '', cadence: 'MONTHLY' as ForecastFixedCost['cadence'], dayOfMonth: '1' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  function addFixedCost() {
    const amount = Number(newCost.amount.replace(/[^\d.]/g, ''));
    if (!newCost.name.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setFixedCosts((current) => [
      ...current,
      {
        id: `fc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: newCost.name.trim(),
        amountCents: Math.round(amount * 100),
        cadence: newCost.cadence,
        ...(newCost.cadence !== 'WEEKLY' ? { dayOfMonth: Math.min(28, Math.max(1, Number(newCost.dayOfMonth) || 1)) } : {})
      }
    ]);
    setNewCost({ name: '', amount: '', cadence: newCost.cadence, dayOfMonth: newCost.dayOfMonth });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const balance = Number(openingBalance.replace(/[^\d.-]/g, ''));
      await staffApi<ForecastConfigPayload>('/api/forecast/config', {
        method: 'PATCH',
        body: JSON.stringify({
          ...(Number.isFinite(balance) ? { openingBalanceCents: Math.round(balance * 100), openingBalanceDate: new Date().toISOString() } : {}),
          supplierPaymentLagDays: Math.min(90, Math.max(0, Number(supplierLag) || 0)),
          cardSettlementLagDays: Math.min(14, Math.max(0, Number(settleLag) || 0)),
          payrollPayWeekday: Math.min(6, Math.max(0, Number(payWeekday) || 0)),
          fixedCosts
        })
      });
      setMessage('Assumptions saved — the projection below refreshes now.');
      setTone('success');
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save assumptions');
      setTone('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="forecast-config">
      <div className="form-grid two">
        <div>
          <Input
            label="Bank balance today ($)"
            value={openingBalance}
            onChange={(event) => setOpeningBalance(event.currentTarget.value)}
            placeholder="e.g. 85000"
            inputMode="decimal"
          />
          <span className="subtle">
            {config.openingBalanceDate
              ? `Last set ${fmtDate(config.openingBalanceDate.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}. Saving stamps it as of today.`
              : 'Not set yet — the runway needs a real starting balance.'}
          </span>
        </div>
        <div className="form-grid two">
          <Input label="Supplier payment lag (days)" value={supplierLag} onChange={(e) => setSupplierLag(e.currentTarget.value)} inputMode="numeric" />
          <Input label="Card settlement lag (days)" value={settleLag} onChange={(e) => setSettleLag(e.currentTarget.value)} inputMode="numeric" />
        </div>
      </div>
      <div className="form-grid two">
        <Select
          label="Payday"
          hint="Wages for a week land on this day of the following week."
          value={payWeekday}
          onChange={(e) => setPayWeekday(e.currentTarget.value)}
          options={WEEKDAY_LABELS.map((label, index) => ({ label, value: String(index) }))}
        />
        <div />
      </div>

      <h4 style={{ marginBottom: 4 }}>Fixed outgoings</h4>
      <p className="subtle" style={{ marginTop: 0 }}>Rent, subscriptions, insurance — anything that leaves the account on a schedule regardless of trade.</p>
      {fixedCosts.length > 0 ? (
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr><th>Name</th><th className="num">Amount</th><th>Cadence</th><th /></tr>
            </thead>
            <tbody>
              {fixedCosts.map((cost) => (
                <tr key={cost.id}>
                  <td>{cost.name}</td>
                  <td className="num">{money(cost.amountCents)}</td>
                  <td>{cost.cadence.toLowerCase()}{cost.cadence !== 'WEEKLY' && cost.dayOfMonth ? ` (day ${cost.dayOfMonth})` : ''}</td>
                  <td>
                    <Button variant="ghost" type="button" onClick={() => setFixedCosts((current) => current.filter((c) => c.id !== cost.id))}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="subtle">No fixed outgoings configured yet.</p>
      )}
      <div className="forecast-fixed-cost-row">
        <Input label="Name" value={newCost.name} onChange={(e) => setNewCost({ ...newCost, name: e.currentTarget.value })} placeholder="e.g. Rent — St Alma" />
        <Input label="Amount ($)" value={newCost.amount} onChange={(e) => setNewCost({ ...newCost, amount: e.currentTarget.value })} inputMode="decimal" placeholder="e.g. 9500" />
        <Select
          label="Cadence"
          value={newCost.cadence}
          onChange={(e) => setNewCost({ ...newCost, cadence: e.currentTarget.value as ForecastFixedCost['cadence'] })}
          options={[
            { label: 'Weekly', value: 'WEEKLY' },
            { label: 'Monthly', value: 'MONTHLY' },
            { label: 'Quarterly', value: 'QUARTERLY' },
            { label: 'Annual', value: 'ANNUAL' }
          ]}
        />
        {newCost.cadence !== 'WEEKLY' ? (
          <Input label="Day of month" value={newCost.dayOfMonth} onChange={(e) => setNewCost({ ...newCost, dayOfMonth: e.currentTarget.value })} inputMode="numeric" />
        ) : (
          <div />
        )}
        <Button type="button" variant="secondary" onClick={addFixedCost}>Add</Button>
      </div>

      <div className="forecast-config-actions">
        <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save assumptions'}</Button>
      </div>
      <ActionFeedback message={message} tone={tone} />
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function ForecastPage() {
  const [outlook, setOutlook] = useState<ForecastOutlookPayload | null>(null);
  const [cashflow, setCashflow] = useState<ForecastCashflowPayload | null>(null);
  const [accuracy, setAccuracy] = useState<ForecastAccuracyPayload | null>(null);
  const [backtest, setBacktest] = useState<ForecastBacktestPayload | null>(null);
  const [config, setConfig] = useState<ForecastConfigPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeVenue, setActiveVenue] = useState<string | 'all'>('all');
  const [scenarioPct, setScenarioPct] = useState(0);
  const [cashReload, setCashReload] = useState(0);

  // Each panel loads independently: a failure in accuracy or config must
  // never blank the main outlook, and vice versa.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const outlookNext = await staffApi<ForecastOutlookPayload>('/api/forecast/outlook?weeks=13');
        if (!cancelled) setOutlook(outlookNext);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the forecast');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    void staffApi<ForecastAccuracyPayload>('/api/forecast/accuracy')
      .then((next) => {
        if (!cancelled) setAccuracy(next);
      })
      .catch(() => undefined);
    void staffApi<ForecastBacktestPayload>('/api/forecast/backtest')
      .then((next) => {
        if (!cancelled) setBacktest(next);
      })
      .catch(() => undefined);
    void staffApi<ForecastConfigPayload>('/api/forecast/config')
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await staffApi<ForecastCashflowPayload>('/api/forecast/cashflow?weeks=13');
        if (!cancelled) setCashflow(next);
      } catch {
        // The outlook still renders without the cash-flow leg.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cashReload]);

  const venues = outlook?.venues ?? [];
  const visibleVenues: ForecastVenueOutlook[] = activeVenue === 'all' ? venues : venues.filter((v) => v.venue === activeVenue);
  const scenarioFactor = 1 + scenarioPct / 100;

  // Next-14-days rows for the daily grid (per selected venue, or summed).
  const next14 = useMemo(() => {
    if (venues.length === 0) return [] as ForecastDay[];
    const source = visibleVenues;
    const todayIndex = source[0]?.days.findIndex((d) => d.isToday) ?? -1;
    if (todayIndex < 0) return [];
    const slices = source.map((v) => v.days.slice(todayIndex, todayIndex + 14));
    const first = slices[0] ?? [];
    if (source.length === 1) return first;
    // Sum venues day-by-day for the "all venues" view.
    return first.map((day, i) => {
      const combined = { ...day };
      let booked = 0;
      let expected = 0;
      let sales = 0;
      let baseline = 0;
      let wages = 0;
      let cogs = 0;
      let actual: number | null = null;
      for (const slice of slices) {
        const d = slice[i];
        if (!d) continue;
        booked += d.bookedCovers;
        expected += d.expectedCovers;
        sales += d.salesForecastCents;
        baseline += d.baselineSalesCents;
        wages += d.wagesForecastCents;
        cogs += d.cogsForecastCents;
        if (d.actualSalesCents != null) actual = (actual ?? 0) + d.actualSalesCents;
      }
      return {
        ...combined,
        closed: slices.every((slice) => slice[i]?.closed),
        bookedCovers: booked,
        expectedCovers: expected,
        salesForecastCents: sales,
        baselineSalesCents: baseline,
        wagesForecastCents: wages,
        cogsForecastCents: cogs,
        actualSalesCents: actual
      };
    });
  }, [venues.length, visibleVenues]);

  const weeklyRows = useMemo(() => {
    const base = activeVenue === 'all' ? outlook?.totals.weeks ?? [] : visibleVenues[0]?.weeks ?? [];
    if (scenarioPct === 0) return base;
    return base.map((week) => {
      const sales = Math.round(week.salesForecastCents * scenarioFactor);
      // Wages scale only partially with sales (rosters are committed): scale the
      // ratio half-way; COGS is variable, so it scales fully.
      const wages = Math.round(week.wagesForecastCents * (1 + (scenarioFactor - 1) * 0.5));
      const cogs = Math.round(week.cogsForecastCents * scenarioFactor);
      return {
        ...week,
        salesForecastCents: sales,
        wagesForecastCents: wages,
        cogsForecastCents: cogs,
        wagePct: sales > 0 ? Math.round((wages / sales) * 1000) / 10 : null,
        cogsPct: sales > 0 ? Math.round((cogs / sales) * 1000) / 10 : null,
        primePct: sales > 0 ? Math.round(((wages + cogs) / sales) * 1000) / 10 : null
      };
    });
  }, [outlook, visibleVenues, activeVenue, scenarioPct, scenarioFactor]);

  if (loading) {
    return (
      <Card title="Forecast" subtitle="Covers, sales, wages, COGS and cash flow — projected from your own trading history.">
        <Spinner label="Crunching your trading history…" />
      </Card>
    );
  }

  if (error || !outlook) {
    return (
      <Card title="Forecast">
        <p className="subtle">{error ?? 'Could not load the forecast.'}</p>
      </Card>
    );
  }

  // Hero numbers.
  const next7Sales = next14.slice(0, 7).reduce((sum, d) => sum + d.salesForecastCents, 0);
  const next7Covers = next14.slice(0, 7).reduce((sum, d) => sum + d.expectedCovers, 0);
  const next7Booked = next14.slice(0, 7).reduce((sum, d) => sum + d.bookedCovers, 0);
  const next7Wages = next14.slice(0, 7).reduce((sum, d) => sum + d.wagesForecastCents, 0);
  const next7Cogs = next14.slice(0, 7).reduce((sum, d) => sum + d.cogsForecastCents, 0);
  const next7WagePct = next7Sales > 0 ? (next7Wages / next7Sales) * 100 : null;
  const next7CogsPct = next7Sales > 0 ? (next7Cogs / next7Sales) * 100 : null;
  const primePct = next7WagePct != null && next7CogsPct != null ? next7WagePct + next7CogsPct : null;
  const primeTarget = venues.reduce<number | null>((acc, v) => acc ?? v.assumptions.targetPrimeCostPercent, null) ?? 60;

  // Honest confidence band: forecasts are point estimates, so pair each with a
  // likely range built from the model's OWN measured accuracy (backtest MAPE),
  // widened with horizon (next week is tighter than week 13). Falls back to a
  // conservative 12% when the backtest hasn't enough history yet.
  const baseErrorFraction = (backtest?.salesMapePct ?? 12) / 100;
  const bandFraction = (weeksAhead: number) => Math.min(0.4, baseErrorFraction * (1 + 0.15 * Math.max(0, weeksAhead)));
  const rangeLabel = (cents: number, weeksAhead: number) => {
    if (cents <= 0) return null;
    const f = bandFraction(weeksAhead);
    return `${money(Math.round(cents * (1 - f)))}–${money(Math.round(cents * (1 + f)))}`;
  };

  // Export the forecast for spreadsheet work (the accountant/administrator
  // view). One CSV, dollars not cents, with the weekly outlook, its
  // confidence band, and the cash-flow projection as labelled sections.
  function exportForecastCsv() {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dollars = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));
    const rows: Array<Array<string | number>> = [];
    rows.push([`Alma forecast — ${activeVenue === 'all' ? 'all venues' : activeVenue}`]);
    rows.push([`Generated ${new Date(outlook!.generatedAt).toLocaleString('en-AU')}`]);
    rows.push([]);
    rows.push(['13-week outlook']);
    rows.push(['Week starting', 'Sales forecast', 'Likely low', 'Likely high', 'Last year', 'Expected covers', 'Wages', 'Wage %', 'COGS', 'COGS %', 'Prime %']);
    weeklyRows.forEach((week, index) => {
      const f = bandFraction(index);
      rows.push([
        week.weekStart,
        dollars(week.salesForecastCents),
        dollars(Math.round(week.salesForecastCents * (1 - f))),
        dollars(Math.round(week.salesForecastCents * (1 + f))),
        dollars(week.lastYearSalesCents),
        week.expectedCovers,
        dollars(week.wagesForecastCents),
        week.wagePct ?? '',
        dollars(week.cogsForecastCents),
        week.cogsPct ?? '',
        week.primePct ?? ''
      ]);
    });
    if (cashflow) {
      rows.push([]);
      rows.push([`Cash flow — opening balance ${dollars(cashflow.openingBalanceCents)}${cashflow.config.openingBalanceDate ? '' : ' (opening balance not set)'}`]);
      rows.push(['Week starting', 'In', 'Out', 'Net', 'Closing balance']);
      cashflow.weeks.forEach((week) => {
        rows.push([week.weekStart, dollars(week.inflowCents), dollars(week.outflowCents), dollars(week.netCents), dollars(week.closingBalanceCents)]);
      });
    }
    const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alma-forecast-${activeVenue === 'all' ? 'all' : activeVenue.toLowerCase().replace(/\s+/g, '-')}-${outlook!.generatedAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-stack forecast-page">
      {outlook.warnings.length > 0 ? (
        <div className="forecast-warnings" role="alert">
          <strong>Data quality</strong>
          <ul>
            {outlook.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="forecast-hero-grid">
        <HeroMetric
          label="Next 7 days — sales"
          value={money(next7Sales)}
          hint={rangeLabel(next7Sales, 0) ? `Likely ${rangeLabel(next7Sales, 0)}` : 'Forecast takings across the week ahead'}
        />
        <HeroMetric
          label="Next 7 days — covers"
          value={String(next7Covers)}
          hint={`${next7Booked} already on the books`}
          tone={next7Booked > 0 ? 'info' : 'neutral'}
        />
        <HeroMetric
          label="Forecast prime cost"
          value={pctLabel(primePct)}
          hint={`Wages ${pctLabel(next7WagePct)} + COGS ${pctLabel(next7CogsPct)} of forecast sales`}
          tone={primePct == null ? 'neutral' : primePct <= primeTarget ? 'positive' : 'warning'}
        />
        <HeroMetric
          label="Cash — lowest point"
          value={cashflow?.lowestBalance && cashflow.config.openingBalanceDate ? money(cashflow.lowestBalance.balanceCents) : '—'}
          hint={
            cashflow && !cashflow.config.openingBalanceDate
              ? 'Set the opening bank balance below — the runway is relative movement until then'
              : cashflow?.lowestBalance
                ? `Week of ${fmtDate(cashflow.lowestBalance.weekStart, { day: 'numeric', month: 'short' })}`
                : 'Loading cash projection…'
          }
          tone={
            cashflow && !cashflow.config.openingBalanceDate
              ? 'info'
              : cashflow?.lowestBalance
                ? cashflow.lowestBalance.balanceCents < 0
                  ? 'danger'
                  : 'positive'
                : 'neutral'
          }
        />
      </div>

      <Card
        title="The next 14 days"
        subtitle="Day by day: expected covers, forecast sales, wages and food cost. Bookings can raise a day's forecast, never lower it."
        action={
          <div className="forecast-venue-tabs">
            <button type="button" className={activeVenue === 'all' ? 'is-active' : ''} onClick={() => setActiveVenue('all')}>All venues</button>
            {venues.map((v) => (
              <button key={v.venue} type="button" className={activeVenue === v.venue ? 'is-active' : ''} onClick={() => setActiveVenue(v.venue)}>
                {v.venue}
              </button>
            ))}
          </div>
        }
      >
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Covers (booked → expected)</th>
                <th className="num">Sales forecast</th>
                <th>Source</th>
                <th>Wages</th>
                <th className="num">COGS</th>
                <th className="num">Prime %</th>
              </tr>
            </thead>
            <tbody>
              {next14.map((day) => {
                const prime = day.salesForecastCents > 0 ? ((day.wagesForecastCents + day.cogsForecastCents) / day.salesForecastCents) * 100 : null;
                return (
                  <tr key={day.date} className={day.isToday ? 'forecast-row-today' : day.closed ? 'forecast-row-closed' : undefined}>
                    <td>
                      {day.isToday ? <strong>Today</strong> : fmtDate(day.date)}
                      {day.holiday ? <> <Badge tone="warning">{day.holiday}</Badge></> : null}
                    </td>
                    <td>{day.closed ? '—' : `${day.bookedCovers} → ${day.expectedCovers}`}</td>
                    <td className="num"><strong>{money(day.salesForecastCents)}</strong>{day.isToday && day.actualSalesCents != null ? <span className="subtle"> ({money(day.actualSalesCents)} so far)</span> : null}</td>
                    <td>{salesMethodBadge(day)}</td>
                    <td>
                      {money(day.wagesForecastCents)}{' '}
                      <Badge tone={day.method.wages === 'roster' ? 'positive' : 'neutral'}>{day.method.wages === 'roster' ? 'rostered' : 'ratio'}</Badge>
                    </td>
                    <td className="num">{money(day.cogsForecastCents)}</td>
                    <td className="num">{pctLabel(prime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="13-week outlook"
        subtitle="Weekly forecast vs the same week last year, with the wage and food-cost line each week."
        action={
          <div className="forecast-outlook-actions">
            <div className="forecast-scenario">
              <span className="subtle">What if sales move…</span>
              {[-10, 0, 10].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={scenarioPct === pct ? 'is-active' : ''}
                  onClick={() => setScenarioPct(pct)}
                >
                  {pct === 0 ? 'Base' : `${pct > 0 ? '+' : ''}${pct}%`}
                </button>
              ))}
            </div>
            <Button type="button" variant="secondary" onClick={exportForecastCsv}>Export CSV</Button>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="forecast-table">
            <thead>
              <tr>
                <th>Week</th>
                <th className="num">Sales forecast</th>
                <th className="num">Last year</th>
                <th className="num">Covers</th>
                <th className="num">Wages</th>
                <th className="num">COGS</th>
                <th className="num">Prime %</th>
              </tr>
            </thead>
            <tbody>
              {weeklyRows.map((week, index) => {
                const yoyPct =
                  week.lastYearSalesCents && week.lastYearSalesCents > 0
                    ? ((week.salesForecastCents - week.lastYearSalesCents) / week.lastYearSalesCents) * 100
                    : null;
                return (
                  <tr key={week.weekStart} className={index === 0 ? 'forecast-row-today' : undefined}>
                    <td>{index === 0 ? <strong>This week</strong> : fmtDate(week.weekStart, { day: 'numeric', month: 'short' })}</td>
                    <td className="num">
                      <strong>{money(week.salesForecastCents)}</strong>
                      {rangeLabel(week.salesForecastCents, index) ? (
                        <div className="subtle forecast-range">{rangeLabel(week.salesForecastCents, index)}</div>
                      ) : null}
                    </td>
                    <td className="num">
                      {money(week.lastYearSalesCents)}
                      {yoyPct != null ? (
                        <span className={yoyPct >= 0 ? 'forecast-up' : 'forecast-down'}> {yoyPct >= 0 ? '▲' : '▼'} {Math.abs(yoyPct).toFixed(0)}%</span>
                      ) : null}
                    </td>
                    <td className="num">{week.expectedCovers}</td>
                    <td className="num">{money(week.wagesForecastCents)} <span className="subtle">{pctLabel(week.wagePct)}</span></td>
                    <td className="num">{money(week.cogsForecastCents)} <span className="subtle">{pctLabel(week.cogsPct)}</span></td>
                    <td className="num">{pctLabel(week.primePct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="subtle" style={{ marginTop: 8 }}>
          The range under each forecast is the likely band — {backtest && backtest.sampleWeeks > 0
            ? `built from this model's own measured accuracy (±${backtest.salesMapePct}% on the last ${backtest.sampleWeeks} venue-weeks)`
            : 'a conservative ±12% until enough history accumulates to measure it'}, widening the further out you look.
          {scenarioPct !== 0
            ? ` Scenario view: sales ${scenarioPct > 0 ? 'up' : 'down'} ${Math.abs(scenarioPct)}% — rostered wages move half as far (the roster is a commitment); COGS moves with sales.`
            : ''}
        </p>
      </Card>

      <Card
        title="Cash flow — 13-week runway"
        subtitle="Forecast takings in, supplier bills and projected spend out, payroll on payday, super and GST set aside for their due dates."
      >
        {cashflow ? (
          <>
            <TrendLine
              points={cashflow.weeks.map((week) => ({ label: fmtDate(week.weekStart, { day: 'numeric', month: 'short' }), value: week.closingBalanceCents / 100 }))}
              height={180}
              format={(v) => moneyK(Math.round(v * 100))}
            />
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table className="forecast-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="num">In</th>
                    <th className="num">Out</th>
                    <th className="num">Net</th>
                    <th className="num">Balance</th>
                    <th>Biggest movements</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflow.weeks.map((week, index) => (
                    <tr key={week.weekStart} className={index === 0 ? 'forecast-row-today' : undefined}>
                      <td>{index === 0 ? <strong>This week</strong> : fmtDate(week.weekStart, { day: 'numeric', month: 'short' })}</td>
                      <td className="num forecast-up">{money(week.inflowCents)}</td>
                      <td className="num forecast-down">{money(week.outflowCents)}</td>
                      <td className={`num ${week.netCents >= 0 ? 'forecast-up' : 'forecast-down'}`}>{money(week.netCents)}</td>
                      <td className="num"><strong className={week.closingBalanceCents < 0 ? 'forecast-down' : undefined}>{money(week.closingBalanceCents)}</strong></td>
                      <td className="forecast-components">
                        {week.components.slice(0, 3).map((component) => (
                          <span key={component.key} className="subtle">
                            {component.direction === 'in' ? '+' : '−'}{moneyK(component.amountCents)} {component.label}{component.estimated ? ' (est)' : ''}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {cashflow.notes.length > 0 ? (
              <ul className="forecast-notes">
                {cashflow.notes.map((note) => (
                  <li key={note} className="subtle">{note}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <Spinner label="Building the cash-flow projection…" />
        )}
      </Card>

      {config ? (
        <Card title="Cash-flow assumptions" subtitle="The projection is only as honest as these inputs. Update the bank balance weekly.">
          <CashflowConfigEditor
            config={config}
            onSaved={() => {
              setCashReload((n) => n + 1);
              void staffApi<ForecastConfigPayload>('/api/forecast/config').then(setConfig).catch(() => undefined);
            }}
          />
        </Card>
      ) : null}

      <div className="report-detail-grid">
        <div className="report-panel">
          <h4>How each venue is being predicted</h4>
          {venues.map((v) => (
            <div key={v.venue} className="forecast-assumption-row">
              <strong>{v.venue}</strong>
              <span className="subtle">
                {v.assumptions.avgSpendPerCoverCents != null ? `${money(v.assumptions.avgSpendPerCoverCents)} per cover · ` : ''}
                {v.assumptions.noShowRate > 0 ? `${(v.assumptions.noShowRate * 100).toFixed(1)}% no-show rate · ` : ''}
                trend ×{v.assumptions.trendFactor.toFixed(2)} ·{' '}
                {v.assumptions.trailingWagePct != null ? `wages run at ${v.assumptions.trailingWagePct}%` : `wage target ${v.assumptions.targetWagePercent ?? 32}%`} ·{' '}
                COGS {v.assumptions.trailingCogsPct}%{' '}
                {v.assumptions.cogsBasis === 'stock_bounded'
                  ? '(true stocktake-bounded actual)'
                  : v.assumptions.cogsBasis === 'purchases'
                    ? '(from recorded purchases)'
                    : v.assumptions.cogsBasis === 'theoretical'
                      ? '(estimate: recipe costs for mapped items + standard beverage margins for the rest — lock stocktakes for the true figure)'
                      : v.assumptions.cogsBasis === 'target'
                        ? '(from your venue target — not enough data yet)'
                        : '(default — not enough data yet)'}
                {' · '}closed {v.assumptions.closedWeekdays.map((d) => WEEKDAY_LABELS[d]).join(', ') || 'never'}
              </span>
            </div>
          ))}
          <p className="subtle" style={{ marginBottom: 0 }}>
            Baselines come from your last 8 weeks of Square takings per weekday, blended 70/30 with the same week last year, adjusted by the
            recent trend. Booked covers from Reserve act as a floor. Weeks with a roster are costed shift by shift.
          </p>
        </div>

        <div className="report-panel">
          <h4>How accurate has the forecast been?</h4>
          {accuracy && accuracy.buckets.some((b) => b.sampleDays > 0) ? (
            <>
              <div className="forecast-accuracy-grid">
                {accuracy.buckets.map((bucket) => (
                  <div key={bucket.leadLabel} className="forecast-accuracy-cell">
                    <span className="forecast-hero-label">{bucket.leadLabel}</span>
                    <strong>{bucket.salesMapePct != null ? `±${bucket.salesMapePct}%` : '—'}</strong>
                    <small className="subtle">
                      {bucket.sampleDays} days scored
                      {bucket.salesBiasPct != null ? ` · bias ${bucket.salesBiasPct > 0 ? '+' : ''}${bucket.salesBiasPct}%` : ''}
                    </small>
                  </div>
                ))}
              </div>
              {accuracy.recentWeeks.length > 0 ? (
                <div className="table-scroll" style={{ marginTop: 12 }}>
                  <table className="forecast-table">
                    <thead>
                      <tr><th>Week</th><th>Venue</th><th className="num">Forecast</th><th className="num">Actual</th><th className="num">Variance</th></tr>
                    </thead>
                    <tbody>
                      {accuracy.recentWeeks.slice(-10).map((row) => (
                        <tr key={`${row.weekStart}-${row.venue}`}>
                          <td>{fmtDate(row.weekStart, { day: 'numeric', month: 'short' })}</td>
                          <td>{row.venue}</td>
                          <td className="num">{money(row.forecastSalesCents)}</td>
                          <td className="num">{money(row.actualSalesCents)}</td>
                          <td className={`num ${row.variancePct != null && row.variancePct >= 0 ? 'forecast-up' : 'forecast-down'}`}>
                            {row.variancePct != null ? `${row.variancePct > 0 ? '+' : ''}${row.variancePct}%` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : backtest && backtest.sampleWeeks > 0 ? (
            <>
              <p className="subtle" style={{ marginTop: 0 }}>
                Live self-grading starts as daily snapshots accumulate. Meanwhile, here is the model <strong>backtested</strong> against the
                last {backtest.sampleWeeks} venue-weeks — the same maths re-run as-of each past Monday, scored against what actually happened
                (baseline only; live forecasts also get bookings and same-day actuals, so expect them to do at least this well).
              </p>
              <div className="forecast-accuracy-grid">
                <div className="forecast-accuracy-cell">
                  <span className="forecast-hero-label">Typical weekly error</span>
                  <strong>{backtest.salesMapePct != null ? `±${backtest.salesMapePct}%` : '—'}</strong>
                  <small className="subtle">
                    {backtest.salesBiasPct != null
                      ? `bias ${backtest.salesBiasPct > 0 ? '+' : ''}${backtest.salesBiasPct}% (${backtest.salesBiasPct > 0 ? 'runs hot' : 'runs shy'})`
                      : ''}
                  </small>
                </div>
              </div>
              <div className="table-scroll" style={{ marginTop: 12 }}>
                <table className="forecast-table">
                  <thead>
                    <tr><th>Week</th><th>Venue</th><th className="num">Model would have said</th><th className="num">Actual</th><th className="num">Variance</th></tr>
                  </thead>
                  <tbody>
                    {backtest.weeks.slice(-10).map((row) => (
                      <tr key={`${row.weekStart}-${row.venue}`}>
                        <td>{fmtDate(row.weekStart, { day: 'numeric', month: 'short' })}</td>
                        <td>{row.venue}</td>
                        <td className="num">{money(row.forecastSalesCents)}</td>
                        <td className="num">{money(row.actualSalesCents)}</td>
                        <td className={`num ${row.variancePct != null && row.variancePct >= 0 ? 'forecast-up' : 'forecast-down'}`}>
                          {row.variancePct != null ? `${row.variancePct > 0 ? '+' : ''}${row.variancePct}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="subtle">
              Accuracy scoring starts now: every day the engine stores what it predicted, then grades itself once the day trades. Check back
              after a week of snapshots.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
