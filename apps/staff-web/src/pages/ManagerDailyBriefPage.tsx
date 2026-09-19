// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StaffProfile, StaffManagerDashboardPayload } from '@alma/shared';
import { Badge, Button, Card, Input, PageHeader, Select } from '@alma/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { toDateInput, uniqueValues, formatCents } from '../lib/datetime';
import { staffLabel, type ReadinessPayload, readinessLabel } from './shared';

// Manager Daily Brief (#29) — the 10-second morning glance.
// Reads the same /manager-dashboard payload, but renders a focused,
// scannable summary with deep-link buttons into the work surfaces.
// Auto-refreshes once a minute so the page stays fresh through the day.
export function ManagerDailyBriefPage({ staff }: { staff: StaffProfile[] }) {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<StaffManagerDashboardPayload | null>(null);
  // Surface venue readiness right inside the brief — managers shouldn't
  // have to bounce between pages to see if today's checklists are on track.
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [venue, setVenue] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const venueOptions = useMemo(
    () => [
      { label: 'All venues', value: '' },
      ...uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((item) => ({ label: item, value: item }))
    ],
    [staff]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      if (venue) params.set('venue', venue);
      // Fire both in parallel — they're independent and the brief should
      // show both numbers and readiness in the same "as of" moment.
      const [dashboardPayload, readinessPayload] = await Promise.all([
        api<StaffManagerDashboardPayload>(`/api/staff/manager-dashboard?${params.toString()}`),
        api<ReadinessPayload>(`/api/checklists/today-readiness?${params.toString()}`).catch(() => null)
      ]);
      setDashboard(dashboardPayload);
      setReadiness(readinessPayload);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load daily brief.');
    } finally {
      setLoading(false);
    }
  }, [date, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Auto-refresh once a minute so the brief stays current through the day.
    const id = setInterval(() => { void load(); }, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const totals = dashboard?.totals;
  const wagePct = totals && totals.wagePercent !== null ? totals.wagePercent : null;
  const rosterWageCents = totals?.rosterWageCents ?? 0;
  const actualWageCents = totals?.actualWageCents ?? 0;
  const salesCents = totals?.salesCents ?? 0;
  const pendingTimesheets = totals?.pendingTimesheets ?? 0;
  const lowStockCount = totals?.lowStockItems ?? 0;
  const openIssues = totals?.openIssues ?? 0;
  const criticalIssues = totals?.criticalIssues ?? 0;
  const generatedAt = dashboard?.generatedAt ? new Date(dashboard.generatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '';

  // Heads-up lines — only show the ones that are actually true so the user
  // doesn't have to scan a fixed grid every morning.
  const headsUps: Array<{ tone: 'danger' | 'warning' | 'info'; text: string }> = [];
  if (criticalIssues > 0) {
    headsUps.push({ tone: 'danger', text: `${criticalIssues} critical compliance issue${criticalIssues === 1 ? '' : 's'} open.` });
  }
  if (pendingTimesheets > 0) {
    headsUps.push({ tone: 'warning', text: `${pendingTimesheets} timesheet${pendingTimesheets === 1 ? '' : 's'} waiting on your approval.` });
  }
  if (lowStockCount > 0) {
    headsUps.push({ tone: 'warning', text: `${lowStockCount} item${lowStockCount === 1 ? '' : 's'} below par — check stock before ordering.` });
  }
  if (wagePct !== null && wagePct > 35) {
    headsUps.push({ tone: 'warning', text: `Wage % at ${wagePct.toFixed(1)}% — over the 35% guardrail.` });
  }
  if (openIssues > 0 && criticalIssues === 0) {
    headsUps.push({ tone: 'info', text: `${openIssues} open compliance item${openIssues === 1 ? '' : 's'} (no critical).` });
  }
  // Pull in readiness signals — if a failed item or missing checklist is
  // sitting there, the manager should see it before they walk on the floor.
  if (readiness) {
    const openingFailed = readiness.rows.filter((r) => r.kind === 'opening' && r.status === 'RED').length;
    const openingMissing = readiness.rows.filter((r) => r.kind === 'opening' && r.status === 'MISSING').length;
    const closingFailed = readiness.rows.filter((r) => r.kind === 'closing' && r.status === 'RED').length;
    if (openingFailed > 0) {
      headsUps.push({ tone: 'danger', text: `${openingFailed} opening checklist${openingFailed === 1 ? ' has' : 's have'} a failed item — fix before service.` });
    } else if (openingMissing > 0 && new Date().getHours() < 18) {
      headsUps.push({ tone: 'warning', text: `${openingMissing} opening checklist${openingMissing === 1 ? '' : 's'} not started yet.` });
    }
    if (closingFailed > 0) {
      headsUps.push({ tone: 'warning', text: `${closingFailed} closing checklist${closingFailed === 1 ? '' : 's'} flagged a failed item from last shift.` });
    }
  }

  // Show only the top 5 of each list so the brief stays scannable.
  const topPendingTimesheets = (dashboard?.pendingTimesheets ?? []).slice(0, 5);
  const topLowStock = (dashboard?.lowStock ?? []).slice(0, 5);
  const topComplianceIssues = (dashboard?.complianceIssues ?? []).slice(0, 5);

  const firstName = user?.firstName?.trim() || 'manager';
  const greeting = (() => {
    const hr = new Date().getHours();
    if (hr < 11) return 'Good morning';
    if (hr < 17) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <div className="page-stack daily-brief-page">
      <PageHeader
        eyebrow="Daily brief"
        title={`${greeting}, ${firstName}`}
        description={generatedAt ? `Pulled ${generatedAt}. Auto-refreshes every minute. The brief is a summary — open a card to act.` : 'Pulling today’s numbers…'}
      />

      <Card>
        <div className="daily-brief-controls">
          <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
          <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
          <Button type="button" variant="secondary" onClick={() => { void load(); }} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </Card>

      {error ? <Card><p className="comms-error">{error}</p></Card> : null}

      <div className="daily-brief-hero">
        <div className="daily-brief-hero-card">
          <span className="daily-brief-hero-label">Sales today</span>
          <span className="daily-brief-hero-value">{formatCents(salesCents)}</span>
          <span className="daily-brief-hero-sub">{venue || 'All venues'} · so far today</span>
        </div>
        <div className="daily-brief-hero-card">
          <span className="daily-brief-hero-label">Wage % today</span>
          <span className="daily-brief-hero-value">{wagePct === null ? '—' : `${wagePct.toFixed(1)}%`}</span>
          <span className="daily-brief-hero-sub">{formatCents(actualWageCents)} actual · {formatCents(rosterWageCents)} rostered</span>
        </div>
        <div className="daily-brief-hero-card">
          <span className="daily-brief-hero-label">Approvals waiting</span>
          <span className="daily-brief-hero-value">{pendingTimesheets}</span>
          <span className="daily-brief-hero-sub">{pendingTimesheets ? 'Open Timesheets to action' : 'All clear'}</span>
        </div>
        <div className="daily-brief-hero-card">
          <span className="daily-brief-hero-label">Heads-ups</span>
          <span className="daily-brief-hero-value">{headsUps.length}</span>
          <span className="daily-brief-hero-sub">{headsUps.length ? 'Items below need attention' : 'Quiet day so far'}</span>
        </div>
      </div>

      {readiness ? (
        <Card title="Venue readiness" subtitle="Today's opening, service, and closing checklists in a glance." action={
          <Button type="button" size="sm" variant="secondary" onClick={() => { window.location.href = '/readiness'; }}>
            Open readiness
          </Button>
        }>
          <div className="readiness-banners">
            <div className={`readiness-banner is-${readiness.overall.opening.toLowerCase()}`}>
              <span className="readiness-banner-tag">Opening</span>
              <span className="readiness-banner-label">{readinessLabel(readiness.overall.opening)}</span>
            </div>
            <div className={`readiness-banner is-${readiness.overall.closing.toLowerCase()}`}>
              <span className="readiness-banner-tag">Closing</span>
              <span className="readiness-banner-label">{readinessLabel(readiness.overall.closing)}</span>
            </div>
            <div className={`readiness-banner is-${readiness.overall.overall.toLowerCase()}`}>
              <span className="readiness-banner-tag">Overall</span>
              <span className="readiness-banner-label">{readinessLabel(readiness.overall.overall)}</span>
            </div>
          </div>
        </Card>
      ) : null}
      {headsUps.length ? (
        <Card title="Heads-up" subtitle="The things worth knowing before you walk on the floor.">
          <ul className="daily-brief-headsups">
            {headsUps.map((item, index) => (
              <li key={index} className={`daily-brief-headsup is-${item.tone}`}>
                <span className="daily-brief-headsup-dot" aria-hidden="true" />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="daily-brief-grid">
        <Card title={`Timesheets to approve (${pendingTimesheets})`} subtitle="The oldest ones first.">
          {topPendingTimesheets.length ? (
            <ul className="daily-brief-list">
              {topPendingTimesheets.map((entry) => {
                // Compute the worked hours from clock in/out minus breaks.
                const hours = entry.clockInAt && entry.clockOutAt
                  ? Math.max(0, ((new Date(entry.clockOutAt).getTime() - new Date(entry.clockInAt).getTime()) / 3_600_000) - (entry.breakMinutes ?? 0) / 60)
                  : null;
                return (
                  <li key={entry.id} className="daily-brief-list-row">
                    <span>
                      <strong>{staffLabel(entry.staffProfile)}</strong>
                      <span className="subtle">{entry.workDate ? new Date(entry.workDate).toLocaleDateString() : '—'} · {hours !== null ? `${hours.toFixed(1)}h` : '—'}</span>
                    </span>
                    <Badge tone="warning">Pending</Badge>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="subtle">No timesheets awaiting your sign-off.</p>
          )}
          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={() => { window.location.href = '/timesheets'; }}>
              Open Timesheets
            </Button>
          </div>
        </Card>

        <Card title={`Low stock (${lowStockCount})`} subtitle="Items below par.">
          {topLowStock.length ? (
            <ul className="daily-brief-list">
              {topLowStock.map((item) => (
                <li key={item.id} className="daily-brief-list-row">
                  <span>
                    <strong>{item.name}</strong>
                    <span className="subtle">{item.onHand} {item.unit} · par {item.parLevel}{item.categoryName ? ` · ${item.categoryName}` : ''}</span>
                  </span>
                  <Badge tone={item.onHand === 0 ? 'danger' : 'warning'}>{item.onHand === 0 ? 'Out' : 'Low'}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">Stock looks healthy — nothing below par.</p>
          )}
          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={() => { window.location.href = 'https://alma-stock-v18.web.app/orders'; }}>
              Open Stock
            </Button>
          </div>
        </Card>

        <Card title={`Compliance items (${openIssues})`} subtitle={criticalIssues ? `${criticalIssues} critical — action today.` : 'Nothing critical right now.'}>
          {topComplianceIssues.length ? (
            <ul className="daily-brief-list">
              {topComplianceIssues.map((item) => (
                <li key={item.id} className="daily-brief-list-row">
                  <span>
                    <strong>{item.title}</strong>
                    <span className="subtle">{item.category} · {item.assignee ?? 'Unassigned'}{item.dueDate ? ` · due ${new Date(item.dueDate).toLocaleDateString()}` : ''}</span>
                  </span>
                  <Badge tone={item.severity === 'CRITICAL' ? 'danger' : item.severity === 'HIGH' ? 'warning' : 'muted'}>{item.severity}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">No open compliance items.</p>
          )}
          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={() => { window.location.href = 'https://alma-compliance.web.app'; }}>
              Open Compliance
            </Button>
          </div>
        </Card>
      </div>

      <Card title="What's left after this" subtitle="Where to spend your next 15 minutes.">
        <ul className="daily-brief-next-steps">
          <li>
            <strong>Walk the floor.</strong> Check fridges, glassware, candles, music. The brief shows numbers; the floor shows reality.
          </li>
          <li>
            <strong>Sit with the team for 5 minutes.</strong> Three things: who's on, what we're pushing, what to watch.
          </li>
          <li>
            <strong>Reply to last shift's handover.</strong> If anything's outstanding, acknowledge it on the <a href="/noticeboard">noticeboard</a>.
          </li>
          <li>
            <strong>Pre-walkthrough bookings.</strong> Open <a href="https://alma-reserve.web.app">Reserve</a> and read the night's notes.
          </li>
        </ul>
      </Card>
    </div>
  );
}
