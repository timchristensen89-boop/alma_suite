import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { AdminStaffCostingPayload } from '@alma/shared';
import { Badge, Button, Card, Input, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay();
  next.setDate(next.getDate() + (day === 0 ? -6 : 1 - day));
  return next;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function money(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return '-';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function hours(value: number | null | undefined) {
  return `${(value ?? 0).toFixed(1)}h`;
}

function percent(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `${(value * 100).toFixed(1)}%`;
}

function varianceTone(value: number) {
  if (value > 0) return 'warning' as const;
  if (value < 0) return 'positive' as const;
  return 'neutral' as const;
}

function CostMetric({ label, value, hint, tone = 'neutral' }: { label: string; value: string; hint: string; tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'info' }) {
  return (
    <Card className="staff-cost-metric" padding="tight">
      <span className="staff-cost-metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <Badge tone={tone}>{tone === 'neutral' ? 'current' : tone}</Badge>
    </Card>
  );
}

function DailyCostChart({ rows }: { rows: AdminStaffCostingPayload['daily'] }) {
  const max = Math.max(1, ...rows.flatMap((row) => [row.actualCostCents, row.scheduledCostCents]));
  if (!rows.length) {
    return <div className="staff-cost-empty">No daily costing data for this period.</div>;
  }
  return (
    <div className="staff-cost-chart" aria-label="Daily actual and scheduled wage cost chart">
      {rows.map((row) => (
        <div key={row.date} className="staff-cost-day">
          <div className="staff-cost-bars">
            <span
              className="staff-cost-bar staff-cost-bar-actual"
              style={{ height: `${Math.max(4, (row.actualCostCents / max) * 100)}%` }}
              title={`Actual ${money(row.actualCostCents)}`}
            />
            <span
              className="staff-cost-bar staff-cost-bar-scheduled"
              style={{ height: `${Math.max(4, (row.scheduledCostCents / max) * 100)}%` }}
              title={`Scheduled ${money(row.scheduledCostCents)}`}
            />
          </div>
          <span>{row.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function AreaCostBars({ rows }: { rows: AdminStaffCostingPayload['byArea'] }) {
  const visibleRows = rows.slice(0, 8);
  const max = Math.max(1, ...visibleRows.map((row) => row.actualCostCents));
  if (!visibleRows.length) {
    return <div className="staff-cost-empty">No section cost data for this period.</div>;
  }
  return (
    <div className="staff-cost-section-bars">
      {visibleRows.map((row) => (
        <div key={`${row.venue}-${row.area}`} className="staff-cost-section-row">
          <div>
            <strong>{row.area}</strong>
            <small>{row.venue} · {hours(row.actualHours)} · {percent(row.shareOfActualCost)} of actual wage cost</small>
          </div>
          <div className="staff-cost-horizontal-bar" aria-hidden="true">
            <span style={{ width: `${Math.max(3, (row.actualCostCents / max) * 100)}%` }} />
          </div>
          <strong>{money(row.actualCostCents)}</strong>
        </div>
      ))}
    </div>
  );
}

export function StaffCostingReportPage() {
  const defaultStart = useMemo(() => isoDate(startOfWeek()), []);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(() => isoDate(addDays(new Date(`${defaultStart}T00:00:00`), 7)));
  const [venue, setVenue] = useState('');
  const [report, setReport] = useState<AdminStaffCostingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadReport(next?: { start?: string; end?: string; venue?: string }) {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        start: next?.start ?? start,
        end: next?.end ?? end,
        source: 'combined'
      });
      const selectedVenue = next?.venue ?? venue;
      if (selectedVenue) params.set('venue', selectedVenue);
      setReport(await api<AdminStaffCostingPayload>(`/api/admin/staff/costing-report?${params.toString()}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff costing report.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    void loadReport();
  }

  const venueOptions = report?.byVenue.map((row) => row.venue).filter((value) => value !== 'Unassigned') ?? [];

  return (
    <div className="page-stack staff-costing-page">
      <Card
        title="Staff Costing"
        subtitle="Actual labour cost, scheduled wage forecast, cost per hour, section mix, and variance for hospitality operations."
        action={<Badge tone={report?.sourceQuality.missingRates ? 'warning' : 'positive'}>{report?.sourceQuality.missingRates ? 'Rate review needed' : 'Rates available'}</Badge>}
      >
        <form className="staff-cost-filters" onSubmit={submit}>
          <Input label="Start" type="date" value={start} onChange={(event) => setStart(event.currentTarget.value)} />
          <Input label="End" type="date" value={end} onChange={(event) => setEnd(event.currentTarget.value)} />
          <label className="field">
            <span>Venue</span>
            <input list="staff-cost-venues" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} placeholder="All venues" />
            <datalist id="staff-cost-venues">
              {venueOptions.map((option) => <option key={option} value={option} />)}
            </datalist>
          </label>
          <Button type="submit" disabled={loading}>{loading ? 'Loading...' : 'Refresh report'}</Button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
        {report?.warnings.length ? (
          <div className="staff-cost-warnings">
            {report.warnings.map((warning) => <Badge key={warning} tone="warning">{warning}</Badge>)}
          </div>
        ) : null}
      </Card>

      {loading && !report ? <Spinner label="Loading staff costing..." /> : null}

      {report ? (
        <>
          <div className="staff-cost-metrics">
            <CostMetric label="Actual wage cost" value={money(report.totals.actualCostCents)} hint={`${hours(report.totals.actualHours)} from ${report.totals.timesheetCount} timesheets`} tone="info" />
            <CostMetric label="Approved wage cost" value={money(report.totals.approvedCostCents)} hint={`${hours(report.totals.approvedHours)} approved/exported`} tone="positive" />
            <CostMetric label="Scheduled forecast" value={money(report.totals.scheduledCostCents)} hint={`${hours(report.totals.scheduledHours)} rostered`} />
            <CostMetric label="Variance" value={money(report.totals.varianceCostCents)} hint={`${hours(report.totals.varianceHours)} vs roster`} tone={varianceTone(report.totals.varianceCostCents)} />
            <CostMetric label="Cost per hour" value={money(report.totals.averageHourlyCostCents)} hint={`${report.totals.staffCount} staff in period`} />
            <CostMetric label="Missing rate hours" value={hours(report.totals.missingRateHours)} hint={`${report.totals.missingRateCount} staff need rates`} tone={report.totals.missingRateCount ? 'warning' : 'positive'} />
          </div>

          <div className="split-grid staff-cost-report-grid">
            <Card title="Daily labour cost" subtitle="Actual cost against scheduled roster forecast.">
              <DailyCostChart rows={report.daily} />
              <div className="staff-cost-legend">
                <span><i className="staff-cost-dot actual" /> Actual</span>
                <span><i className="staff-cost-dot scheduled" /> Scheduled</span>
              </div>
            </Card>
            <Card title="Cost by section" subtitle="Highest cost areas first, based on timesheets.">
              <AreaCostBars rows={report.byArea} />
            </Card>
          </div>

          <Card title="Venue breakdown" subtitle="Actual hours, scheduled hours, cost per hour, and variance.">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>Actual hours</th>
                    <th>Actual cost</th>
                    <th>Scheduled cost</th>
                    <th>Variance</th>
                    <th>Cost/hour</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byVenue.map((row) => (
                    <tr key={row.venue}>
                      <td>{row.venue}</td>
                      <td>{hours(row.actualHours)}</td>
                      <td>{money(row.actualCostCents)}</td>
                      <td>{money(row.scheduledCostCents)}</td>
                      <td><Badge tone={varianceTone(row.varianceCostCents)}>{money(row.varianceCostCents)}</Badge></td>
                      <td>{money(row.averageHourlyCostCents)}</td>
                      <td>{row.staffCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Role and section mix" subtitle="Use this to compare FOH, bar, kitchen, management, and support labour shape.">
            <div className="staff-cost-two-tables">
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Role</th>
                      <th>Actual</th>
                      <th>Cost</th>
                      <th>Scheduled</th>
                      <th>Cost/hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byRole.slice(0, 12).map((row) => (
                      <tr key={row.roleTitle}>
                        <td>{row.roleTitle}</td>
                        <td>{hours(row.actualHours)}</td>
                        <td>{money(row.actualCostCents)}</td>
                        <td>{hours(row.scheduledHours)}</td>
                        <td>{money(row.averageHourlyCostCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Section</th>
                      <th>Venue</th>
                      <th>Actual</th>
                      <th>Cost</th>
                      <th>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byArea.slice(0, 12).map((row) => (
                      <tr key={`${row.venue}-${row.area}`}>
                        <td>{row.area}</td>
                        <td>{row.venue}</td>
                        <td>{hours(row.actualHours)}</td>
                        <td>{money(row.actualCostCents)}</td>
                        <td>{percent(row.shareOfActualCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>

          <Card title="Staff cost detail" subtitle="Sensitive admin-only view. Annual salary profiles are flagged if no hourly equivalent is stored.">
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Venue</th>
                    <th>Role</th>
                    <th>Actual hours</th>
                    <th>Actual cost</th>
                    <th>Scheduled cost</th>
                    <th>Rate</th>
                    <th>Rate source</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byStaff.slice(0, 80).map((row) => (
                    <tr key={row.staffProfileId}>
                      <td>{row.staffName}</td>
                      <td>{row.venue}</td>
                      <td>{row.roleTitle}</td>
                      <td>{hours(row.actualHours)}</td>
                      <td>{money(row.actualCostCents)}</td>
                      <td>{money(row.scheduledCostCents)}</td>
                      <td>{money(row.rateCents)}</td>
                      <td><Badge tone={row.missingRate ? 'warning' : 'muted'}>{row.rateSource}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
