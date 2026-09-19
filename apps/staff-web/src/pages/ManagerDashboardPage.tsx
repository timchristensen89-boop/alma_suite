// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  RosterShift,
  StaffManagerOperationsPayload,
  StaffProfile,
  StaffManagerDashboardPayload,
  Timesheet
} from '@alma/shared';
import { ActionFeedback, Badge, BigStat, Button, Card, EditorialPanel, EmptyState, Input, Select } from '@alma/ui';
import { api } from '../lib/api';
import {
  addDays,
  timeOf,
  toDateInput,
  isExpiringSoon,
  roundHours,
  uniqueValues,
  timesheetHours,
  formatCents
} from '../lib/datetime';
import { COMPLIANCE_WEB_URL, RESERVE_WEB_URL, STOCK_WEB_URL } from '../config/suiteLinks';
import type { ForecastOutlookPayload } from '@alma/shared';
import { isUnallocatedProfile } from './shared';

function staffClockStateTone(state: StaffManagerOperationsPayload['todaysStaff'][number]['state']) {
  switch (state) {
    case 'CLOCKED_IN':
      return 'positive';
    case 'ON_BREAK':
    case 'LATE':
      return 'warning';
    case 'MISSED':
      return 'danger';
    case 'CLOCKED_OUT':
      return 'neutral';
    case 'SCHEDULED':
    default:
      return 'muted';
  }
}

function clockExceptionTone(severity: StaffManagerOperationsPayload['clockExceptions'][number]['severity']) {
  return severity === 'danger' ? 'danger' : 'warning';
}

export function ManagerDashboardPage({ staff, roster }: { staff: StaffProfile[]; roster: RosterShift[] }) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<StaffManagerDashboardPayload | null>(null);
  const [operations, setOperations] = useState<StaffManagerOperationsPayload | null>(null);
  const [forecast, setForecast] = useState<ForecastOutlookPayload | null>(null);
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [venue, setVenue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const venueOptions = useMemo(
    () => [
      { label: 'All venues', value: '' },
      ...uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((item) => ({
        label: item,
        value: item
      }))
    ],
    [staff]
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({ date });
      if (venue) query.set('venue', venue);
      const [dashboardData, operationsData] = await Promise.all([
        api<StaffManagerDashboardPayload>(`/api/staff/manager-dashboard?${query.toString()}`),
        api<StaffManagerOperationsPayload>(`/api/staff/manager-operations?${query.toString()}`)
      ]);
      setDashboard(dashboardData);
      setOperations(operationsData);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load manager dashboard.');
    } finally {
      setLoading(false);
    }
  }, [date, venue]);

  // Forecast outlook (same engine as Reports/roster) — powers the "Forecast
  // today" pace metric and the week-ahead line. Non-blocking: a failure just
  // hides those, the rest of the dashboard is unaffected.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ weeks: '13' });
    if (venue) params.set('venue', venue);
    void api<ForecastOutlookPayload>(`/api/forecast/outlook?${params.toString()}`)
      .then((next) => {
        if (!cancelled) setForecast(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [venue]);

  // Engine forecast for the selected day and the 7 days ahead of it.
  const forecastToday = useMemo(() => {
    let today = 0;
    let weekAhead = 0;
    for (const v of forecast?.venues ?? []) {
      const idx = v.days.findIndex((d) => d.date === date);
      if (idx >= 0) today += v.days[idx]!.salesForecastCents;
      const startAhead = v.days.findIndex((d) => d.date > date);
      if (startAhead >= 0) {
        weekAhead += v.days.slice(startAhead, startAhead + 7).reduce((sum, d) => sum + d.salesForecastCents, 0);
      }
    }
    return { todayCents: today, weekAheadCents: weekAhead };
  }, [forecast, date]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const id = setInterval(() => { void loadDashboard(); }, 60_000);
    return () => clearInterval(id);
  }, [loadDashboard]);

  async function approveTimesheet(id: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`approve:${id}`);
    try {
      await api(`/api/staff/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('Timesheet approved.');
      await loadDashboard();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectTimesheet(id: string) {
    const reason = window.prompt('Reason for rejection?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`reject:${id}`);
    try {
      await api(`/api/staff/timesheets/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      setMessage('Timesheet rejected.');
      await loadDashboard();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject timesheet.');
    } finally {
      setSaving(false);
    }
  }

  const wagePercent = dashboard?.totals.wagePercent;
  const updatedAtSource = operations?.generatedAt ?? dashboard?.generatedAt ?? '';
  const updatedAt = updatedAtSource
    ? timeOf(updatedAtSource)
    : '';
  const activeLaunchStaff = staff.filter((member) => member.employmentStatus !== 'ARCHIVED' && !isUnallocatedProfile(member));
  const missingLoginEmail = activeLaunchStaff.filter((member) => !member.email?.trim()).length;
  const missingVenueOrRole = activeLaunchStaff.filter((member) => !member.venue?.trim() || !member.roleTitle?.trim()).length;
  const staffAccessEnabled = activeLaunchStaff.filter((member) =>
    member.appAccess.some((access) => access.appId === 'STAFF' && access.status === 'ENABLED')
  ).length;
  const launchMonday = new Date();
  launchMonday.setHours(0, 0, 0, 0);
  const dayOfWeek = launchMonday.getDay();
  launchMonday.setDate(launchMonday.getDate() + (dayOfWeek === 1 ? 0 : dayOfWeek === 0 ? 1 : 8 - dayOfWeek));
  const launchMondayEnd = addDays(launchMonday, 1);
  const activeLaunchStaffIds = new Set(activeLaunchStaff.map((member) => member.id));
  const mondayShiftCount = roster
    .filter((shift) => shift.staffProfileId !== null && activeLaunchStaffIds.has(shift.staffProfileId))
    .filter((shift) => {
      const startsAt = new Date(shift.startsAt);
      return startsAt >= launchMonday && startsAt < launchMondayEnd && shift.status !== 'CANCELLED';
    }).length;
  const complianceFollowUpCount = activeLaunchStaff.reduce((count, member) => {
    return count + member.records.filter((record) =>
      record.status === 'PENDING' || record.status === 'EXPIRED' || Boolean(record.expiryDate && isExpiringSoon(record.expiryDate))
    ).length;
  }, 0);
  const launchReadinessItems = [
    {
      label: 'Active staff accounts',
      value: activeLaunchStaff.length,
      detail: 'Profiles available for Staff launch.',
      tone: activeLaunchStaff.length ? 'positive' : 'warning'
    },
    {
      label: 'Missing login email',
      value: missingLoginEmail,
      detail: 'Add emails before sending reset links.',
      tone: missingLoginEmail ? 'warning' : 'positive'
    },
    {
      label: 'Missing venue or role',
      value: missingVenueOrRole,
      detail: 'Venue and role should be obvious before launch.',
      tone: missingVenueOrRole ? 'warning' : 'positive'
    },
    {
      label: 'Staff app access',
      value: `${staffAccessEnabled}/${activeLaunchStaff.length}`,
      detail: 'Enabled Staff app access rows.',
      tone: activeLaunchStaff.length && staffAccessEnabled === activeLaunchStaff.length ? 'positive' : 'warning'
    },
    {
      label: 'Monday shifts loaded',
      value: mondayShiftCount,
      detail: `${launchMonday.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })} roster rows.`,
      tone: mondayShiftCount ? 'positive' : 'warning'
    },
    {
      label: 'Open clock sessions',
      value: operations?.metrics.clockedIn ?? 0,
      detail: 'Clear test sessions before inviting staff.',
      tone: (operations?.metrics.clockedIn ?? 0) ? 'warning' : 'positive'
    },
    {
      label: 'Compliance follow-up',
      value: complianceFollowUpCount,
      detail: 'Pending, expired, or expiring records.',
      tone: complianceFollowUpCount ? 'warning' : 'positive'
    }
  ];
  const launchActionItems = launchReadinessItems.filter((item) => item.tone === 'warning');

  const wageTone = wagePercent == null ? '' : wagePercent > 38 ? 'is-danger' : wagePercent > 32 ? 'is-warning' : wagePercent > 25 ? '' : 'is-positive';
  const maxVenueSales = Math.max(...(dashboard?.salesByVenue.map((v) => v.salesCents) ?? [0]), 1);

  return (
    <div className="live-dashboard">

      {/* ── Header ── */}
      <div className="live-header">
        <div className="live-header-left">
          <div className="live-badge"><span className="live-dot" />LIVE</div>
          <h1 className="live-title">Today at a glance</h1>
          {updatedAt ? <p className="live-updated">Updated {updatedAt}</p> : null}
        </div>
        <div className="live-header-right">
          <Input label="" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
          <Select label="" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
          <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => void loadDashboard()}>Refresh</Button>
        </div>
      </div>

      {/* ── Hero metrics ── */}
      <div className="live-hero">
        <div className="live-hero-metric">
          <span className="live-hero-label">Sales today</span>
          <span className="live-hero-value">{loading && !dashboard ? '—' : formatCents(dashboard?.totals.salesCents ?? 0)}</span>
          <span className="live-hero-hint">
            {(() => {
              const fc = forecastToday.todayCents;
              const actual = dashboard?.totals.salesCents ?? 0;
              if (fc <= 0) return dashboard?.salesByVenue.length ? `${dashboard.salesByVenue.length} venue${dashboard.salesByVenue.length === 1 ? '' : 's'}` : 'No sales yet';
              // Only score actual-vs-forecast for a COMPLETED day — comparing a
              // part-day's takings to the full-day forecast reads as "behind"
              // all afternoon even when the day is on track.
              const dayComplete = date < toDateInput(new Date());
              if (dayComplete && actual > 0) {
                const pct = Math.round(((actual - fc) / fc) * 100);
                return `${formatCents(fc)} forecast · ${pct >= 0 ? '+' : ''}${pct}% actual`;
              }
              return `${formatCents(fc)} forecast today`;
            })()}
          </span>
        </div>
        <div className={`live-hero-metric ${wageTone}`}>
          <span className="live-hero-label">Wage cost</span>
          <span className="live-hero-value">{wagePercent == null ? '—' : `${wagePercent.toFixed(1)}%`}</span>
          <span className="live-hero-hint">{formatCents(dashboard?.totals.actualWageCents ?? 0)} · {roundHours(dashboard?.totals.actualHours ?? 0)} actual</span>
        </div>
        <div className="live-hero-metric">
          <span className="live-hero-label">Covers today</span>
          <span className="live-hero-value">{operations ? (operations.metrics.coversToday ?? 0) : '—'}</span>
          <span className="live-hero-hint">{operations?.bookingsSummary?.upcomingBookings ?? 0} still ahead</span>
        </div>
        <div className="live-hero-metric">
          <span className="live-hero-label">Clocked in</span>
          <span className="live-hero-value">
            {operations?.metrics.clockedIn ?? '—'}
            <span className="live-hero-of"> / {operations?.metrics.scheduledStaff ?? 0}</span>
          </span>
          <span className="live-hero-hint">{operations?.metrics.onBreak ?? 0} on break · {operations?.metrics.lateClockIns ?? 0} late</span>
        </div>
      </div>

      {/* ── Pulse strip ── */}
      <div className="live-pulse-strip">
        <button type="button" className={dashboard?.totals.pendingTimesheets ? 'is-active' : ''} onClick={() => navigate('/timesheets')}>
          <strong>{dashboard?.totals.pendingTimesheets ?? 0}</strong><span>Timesheets</span>
        </button>
        <button type="button" className={operations?.metrics.clockExceptions ? 'is-warning' : ''} onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.clockExceptions ?? 0}</strong><span>Exceptions</span>
        </button>
        <button type="button" className={operations?.metrics.pendingConfirmations ? 'is-muted' : ''} onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.pendingConfirmations ?? 0}</strong><span>Unconfirmed</span>
        </button>
        <button type="button" className={dashboard?.totals.lowStockItems ? 'is-warning' : ''} onClick={() => window.location.assign(STOCK_WEB_URL || '/')}>
          <strong>{dashboard?.totals.lowStockItems ?? 0}</strong><span>Low stock</span>
        </button>
        <button type="button" className={dashboard?.totals.criticalIssues ? 'is-danger' : dashboard?.totals.openIssues ? 'is-warning' : ''} onClick={() => window.location.assign(COMPLIANCE_WEB_URL || '/')}>
          <strong>{(dashboard?.totals.criticalIssues ?? 0) + (dashboard?.totals.openIssues ?? 0)}</strong><span>Compliance</span>
        </button>
        <button type="button" onClick={() => window.location.assign(RESERVE_WEB_URL || '/')}>
          <strong>{operations?.metrics.bookingsToday ?? 0}</strong><span>Bookings</span>
        </button>
      </div>

      {/* ── Forecast glance — the forward-looking block, so it wears the
          suite's sage band with elevated white tiles. Same engine outlook
          the hero pace note reads from. ── */}
      <div className="sd-forecast-band">
        <EditorialPanel
          className="alma-band-sage"
          eyebrow="Forecast glance · next 7 days"
          title="The week ahead"
        >
          <div className="alma-page-grid-kpis">
            <BigStat
              eyebrow="Today's target"
              value={forecastToday.todayCents > 0 ? formatCents(forecastToday.todayCents) : '—'}
              sub={forecastToday.todayCents > 0 ? 'Forecast sales today' : 'Forecast warming up'}
            />
            <BigStat
              eyebrow="Week ahead"
              value={forecastToday.weekAheadCents > 0 ? formatCents(forecastToday.weekAheadCents) : '—'}
              sub={forecastToday.weekAheadCents > 0 ? 'Forecast sales, next 7 days' : 'Forecast warming up'}
            />
          </div>
        </EditorialPanel>
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'} style={{ padding: '0 24px' }}>{message}</p> : null}

      {/* ── Main grid ── */}
      <div className="live-main-grid">

        {/* Sales by venue */}
        <Card title="Sales by venue" subtitle="Today's imported sales">
          {!dashboard?.salesByVenue.length ? (
            <EmptyState title="No sales data yet" description="Sales will appear here once imported." />
          ) : (
            <div className="live-venue-bars">
              {dashboard.salesByVenue.map((row) => {
                const wages = dashboard.wagesByVenue.find((w) => w.venue === row.venue);
                const pct = row.salesCents > 0 && wages ? ((wages.actualWageCents / row.salesCents) * 100).toFixed(1) : null;
                return (
                  <div key={row.venue} className="live-venue-bar-row">
                    <span className="live-venue-bar-name">{row.venue}</span>
                    <div className="live-venue-bar-track">
                      <div className="live-venue-bar-fill" style={{ width: `${(row.salesCents / maxVenueSales) * 100}%` }} />
                    </div>
                    <span className="live-venue-bar-value">{formatCents(row.salesCents)}</span>
                    {pct ? <span className="live-venue-bar-pct">{pct}%</span> : null}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Staff on shift now */}
        <Card title="Staff on shift" subtitle="Live clock state for today's roster" action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/roster')}>Roster</Button>}>
          {operations && operations.todaysStaff.length === 0 ? (
            <EmptyState title="Nothing scheduled today" description="Published shifts will appear here." />
          ) : null}
          <div className="live-staff-now">
            {operations?.todaysStaff.map((row) => (
              <div key={row.shift.id} className={`live-staff-row is-${row.state.toLowerCase().replace(/_/g, '-')}`}>
                <div className="live-staff-dot" />
                <span className="live-staff-name">{row.staffProfile ? `${row.staffProfile.firstName} ${row.staffProfile.lastName}` : 'Staff'}</span>
                <span className="live-staff-detail">{row.shift.area || row.shift.roleTitle || row.staffProfile?.roleTitle || 'Shift'}</span>
                <span className="live-staff-time">{timeOf(row.shift.startsAt)}–{timeOf(row.shift.endsAt)}</span>
                <Badge tone={staffClockStateTone(row.state)}>{row.state.replace(/_/g, ' ')}</Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Upcoming reservations */}
        <Card title="Upcoming reservations" subtitle="Next bookings for service planning" action={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(RESERVE_WEB_URL || '/')}>Reserve</Button>}>
          {operations && (!operations.bookingsSummary || operations.bookingsSummary.nextReservations.length === 0) ? (
            <EmptyState title="No upcoming bookings" description="Confirmed reservations will appear here." />
          ) : null}
          {operations?.bookingsSummary ? (
            <div className="live-booking-summary">
              <div><strong>{operations.bookingsSummary.bookingsToday}</strong><span>bookings</span></div>
              <div><strong>{operations.bookingsSummary.coversToday}</strong><span>covers</span></div>
              <div><strong>{operations.bookingsSummary.noShowsToday}</strong><span>no-shows</span></div>
              <div><strong>{operations.bookingsSummary.cancellationsToday}</strong><span>cancelled</span></div>
            </div>
          ) : null}
          <div className="manager-mobile-list">
            {operations?.bookingsSummary?.nextReservations.map((r) => (
              <article key={r.id} className="manager-mobile-row">
                <span>
                  <strong>{r.guestName || 'Guest'}</strong>
                  <span className="subtle">{timeOf(r.startsAt)} · {r.covers} cover{r.covers === 1 ? '' : 's'} · {r.venue}</span>
                </span>
                <Badge tone={r.status === 'CONFIRMED' || r.status === 'SEATED' ? 'positive' : r.status === 'PENDING' ? 'warning' : 'info'}>{r.status.replaceAll('_', ' ')}</Badge>
              </article>
            ))}
          </div>
        </Card>

        {/* Clock exceptions */}
        <Card title="Clock exceptions" subtitle="Late, missed, overdue breaks, open sessions" action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/timesheets')}>Timesheets</Button>}>
          {operations && operations.clockExceptions.length === 0 ? (
            <EmptyState title="No exceptions" description="Clock issues will appear here." />
          ) : null}
          <div className="manager-mobile-list">
            {operations?.clockExceptions.map((exc) => (
              <article key={exc.id} className="manager-mobile-row">
                <span>
                  <strong>{exc.summary}</strong>
                  <span className="subtle">{exc.detail}</span>
                  <span className="subtle">{exc.staffProfile ? `${exc.staffProfile.firstName} ${exc.staffProfile.lastName}` : 'Staff'}{exc.venue ? ` · ${exc.venue}` : ''}</span>
                </span>
                <Badge tone={clockExceptionTone(exc.severity)}>{exc.kind.replaceAll('_', ' ')}</Badge>
              </article>
            ))}
          </div>
        </Card>

        {/* Pending timesheets */}
        <Card title="Pending timesheets" subtitle="Approve submitted hours" action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/timesheets')}>All</Button>}>
          {dashboard && dashboard.pendingTimesheets.length === 0 ? (
            <EmptyState title="No timesheets waiting" description="Submitted hours will appear here." />
          ) : null}
          <div className="manager-mobile-list">
            {dashboard?.pendingTimesheets.map((entry) => (
              <article key={entry.id} className="manager-mobile-row">
                <span>
                  <strong>{entry.staffProfile ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}` : 'Staff'}</strong>
                  <span className="subtle">{new Date(entry.workDate).toLocaleDateString()} · {timeOf(entry.clockInAt)}–{timeOf(entry.clockOutAt)} · {roundHours(timesheetHours(entry))}</span>
                  <span className="subtle">{entry.venue ?? ''}{entry.area ?? entry.roleTitle ? ` · ${entry.area ?? entry.roleTitle}` : ''}</span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Button type="button" size="sm" disabled={saving} onClick={() => void approveTimesheet(entry.id)}>Approve</Button>
                  <ActionFeedback message={messageTarget === `approve:${entry.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void rejectTimesheet(entry.id)}>Reject</Button>
                  <ActionFeedback message={messageTarget === `reject:${entry.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                </span>
              </article>
            ))}
          </div>
        </Card>

        {/* Low stock */}
        <Card title="Low stock warnings" subtitle="Items at or below reorder level" action={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(STOCK_WEB_URL || '/')}>Stock</Button>}>
          {dashboard && dashboard.lowStock.length === 0 ? (
            <EmptyState title="No low stock warnings" description="Items needing attention will appear here." />
          ) : null}
          <div className="manager-mobile-list">
            {dashboard?.lowStock.map((item) => (
              <article key={item.id} className="manager-mobile-row">
                <span>
                  <strong>{item.name}</strong>
                  <span className="subtle">{item.categoryName ?? 'Uncategorised'} · {item.unit}</span>
                </span>
                <Badge tone="warning">{item.onHand} / {item.reorderPoint ?? item.parLevel}</Badge>
              </article>
            ))}
          </div>
        </Card>

      </div>
    </div>
  );
}
