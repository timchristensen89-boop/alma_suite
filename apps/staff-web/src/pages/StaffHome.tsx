// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { StaffProfile } from '@alma/shared';
import { ActionPanel, Badge, Button, Card, EmptyState, PageHeader, StatCard } from '@alma/ui';
import { api } from '../lib/api';
import { isExpiringSoon } from '../lib/datetime';
import { COMPLIANCE_WEB_URL } from '../config/suiteLinks';
import {
  type LabourWeekPayload,
  labourMondayOf,
  labourMoney,
  type StaffFormState,
  isTerminatedStaffProfile,
  type CreatedStaffInvite,
  isDeputyImportedProfile,
  isUnallocatedProfile
} from './shared';

export function StaffHome({
  staff,
  loading,
  onSelect,
  reload
}: {
  staff: StaffProfile[];
  loading: boolean;
  onSelect: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  // Readiness/active set excludes ALL terminated staff (archived, terminated,
  // inactive…), not just ARCHIVED — so warnings only ever flag current staff.
  const activeStaff = staff.filter((member) => !isTerminatedStaffProfile(member));
  const pending = staff.filter((member) => member.employmentStatus === 'PENDING');
  const withStaffAccess = staff.filter((member) =>
    member.appAccess.some((access) => access.appId === 'STAFF' && access.status === 'ENABLED')
  );
  const lightweightDeputyProfiles = staff.filter(isDeputyImportedProfile);
  const staffForReadiness = activeStaff.filter((member) => !isUnallocatedProfile(member));
  const missingPayRate = staffForReadiness.filter((member) => {
    if (member.payRateCents || member.trainingPayRateCents) return false;
    // An award pay profile that's been explicitly configured counts as having a rate,
    // even when the legacy payRateCents column is null. A system-defaulted profile
    // (e.g. casual with no rate → Award Level 2 fallback) still gets flagged so the
    // manager confirms the real rate.
    const profile = member.payProfile;
    if (profile && !profile.isDefaulted && (
      (profile.ordinaryHourlyRateCents ?? 0) > 0 ||
      (profile.casualLoadedHourlyRateCents ?? 0) > 0 ||
      (profile.manualFullTimePayAmountCents ?? 0) > 0
    )) return false;
    return true;
  });
  const missingPayType = staffForReadiness.filter((member) => !member.payType);
  const pendingRecords = staff.flatMap((member) => member.records.filter((record) => record.status === 'PENDING'));
  const duplicateProfileGroups = duplicateStaffProfileGroups(staffForReadiness);
  const duplicateAdminGroups = duplicateStaffProfileGroups(staffForReadiness.filter((member) => member.isAdmin));
  const readinessWarnings = [
    {
      label: 'Deputy roster profiles',
      value: lightweightDeputyProfiles.length,
      detail: 'Need re-onboarding before payroll use.',
      tone: lightweightDeputyProfiles.length ? 'warning' : 'positive'
    },
    {
      label: 'Missing pay rate',
      value: missingPayRate.length,
      detail: 'Active staff without a base or Academy rate.',
      tone: missingPayRate.length ? 'warning' : 'positive'
    },
    {
      label: 'Missing pay type',
      value: missingPayType.length,
      detail: 'Active staff without payroll type.',
      tone: missingPayType.length ? 'warning' : 'positive'
    },
    {
      label: 'Pending onboarding',
      value: pending.length,
      detail: 'Profiles still waiting for completion or approval.',
      tone: pending.length ? 'warning' : 'positive'
    },
    {
      label: 'Pending documents',
      value: pendingRecords.length,
      detail: 'Uploaded or required records awaiting review.',
      tone: pendingRecords.length ? 'warning' : 'positive'
    },
    {
      label: 'Duplicate profiles',
      value: duplicateProfileGroups.length,
      detail: 'Same email or same name appears more than once.',
      tone: duplicateProfileGroups.length ? 'warning' : 'positive'
    },
    {
      label: 'Duplicate admin profiles',
      value: duplicateAdminGroups.length,
      detail: 'Admin records with matching identity need review.',
      tone: duplicateAdminGroups.length ? 'warning' : 'positive'
    }
  ];
  const readinessActionCount =
    lightweightDeputyProfiles.length +
    missingPayRate.length +
    missingPayType.length +
    pending.length +
    pendingRecords.length +
    duplicateProfileGroups.length +
    duplicateAdminGroups.length;
  const expiringSoon = staff.flatMap((member) =>
    member.records
      .filter((record) => record.expiryDate && isExpiringSoon(record.expiryDate))
      .map((record) => ({ member, record }))
  );
  const [form, setForm] = useState<StaffFormState>({ mode: 'closed' });
  const [reonboardingId, setReonboardingId] = useState<string | null>(null);
  const [reonboardMessage, setReonboardMessage] = useState<string | null>(null);
  const [reonboardError, setReonboardError] = useState<string | null>(null);

  // The numbers a manager opens this page FOR, loaded up front: this week's
  // labour against takings (the labour-week feed the Labour page uses) and
  // how many timesheets are sitting in the approval queue. Quiet failure —
  // a broken feed shows an em dash, never blocks the register of people.
  const [labour, setLabour] = useState<LabourWeekPayload | null>(null);
  const [approvalQueue, setApprovalQueue] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api<LabourWeekPayload>(`/api/staff/labour-week?weekStart=${labourMondayOf()}`)
      .then((data) => {
        if (!cancelled) setLabour(data);
      })
      .catch(() => undefined);
    const start = new Date();
    start.setDate(start.getDate() - 30);
    void api<Array<{ id: string }>>(
      `/api/staff/timesheets?status=SUBMITTED&start=${start.toISOString().slice(0, 10)}`
    )
      .then((rows) => {
        if (!cancelled) setApprovalQueue(rows.length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const todayKey = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  })();
  const today = labour?.days.find((day) => day.date === todayKey) ?? null;
  const todayHours = today ? today.byVenue.reduce((sum, venue) => sum + venue.rosteredHours + venue.openHours, 0) : null;
  const todayCostCents = today ? today.byVenue.reduce((sum, venue) => sum + venue.estCostCents, 0) : null;
  const weekLabourPct =
    labour && labour.totals.salesCents > 0
      ? Math.round((labour.totals.estCostCents / labour.totals.salesCents) * 1000) / 10
      : null;

  function openProfile(id: string, section = 'personal') {
    onSelect(id);
    navigate(`/staff/${id}/${section}`);
  }

  async function reonboardLightweightProfile(member: StaffProfile) {
    setReonboardMessage(null);
    setReonboardError(null);
    if (!member.email) {
      setReonboardError(`Add an email to ${member.firstName} ${member.lastName} before sending an onboarding link.`);
      openProfile(member.id, 'personal');
      return;
    }

    setReonboardingId(member.id);
    try {
      const created = await api<CreatedStaffInvite>(`/api/staff/profiles/${member.id}/reonboard`, {
        method: 'POST',
        body: JSON.stringify({
          onboardingBaseUrl: window.location.origin,
          expiresInDays: 30,
          note: 'Please complete your ALMA Staff onboarding details.'
        })
      });
      setReonboardMessage(
        created.emailDelivery?.status === 'sent'
          ? `Re-onboarding link sent to ${created.email ?? member.email}.`
          : `Re-onboarding link is ready to copy. ${created.emailDelivery?.reason ?? 'Email was not sent.'}`
      );
      await reload();
    } catch (err) {
      setReonboardError(err instanceof Error ? err.message : 'Could not send re-onboarding link.');
    } finally {
      setReonboardingId(null);
    }
  }

  return (
    <div className="page-stack staff-settings-page">
      <PageHeader
        eyebrow="Staff"
        title="People command"
        description={
          loading
            ? 'Loading the staff register…'
            : readinessActionCount === 0
              ? `${activeStaff.length} active staff. Register is ready for daily use.`
              : `${readinessActionCount} readiness item${readinessActionCount === 1 ? '' : 's'} need review below.`
        }
        actions={
          <>
            <NavLink to="/brief" className="btn btn-sm">Daily brief</NavLink>
            <NavLink to="/roster" className="btn btn-ghost btn-sm">Roster</NavLink>
            <NavLink to="/timesheets" className="btn btn-ghost btn-sm">Timesheets</NavLink>
          </>
        }
      />

      {/* The numbers first: what today costs, how the week is tracking
          against takings, and what is waiting on a manager. */}
      <div className="stats-grid staff-settings-stats">
        <NavLink to="/roster" className="stat-card-link" aria-label="Open the roster">
          <StatCard
            label="Rostered today"
            value={todayHours == null ? '—' : `${Math.round(todayHours * 10) / 10}h`}
            hint={todayCostCents == null ? 'Roster feed unavailable' : `≈ ${labourMoney(todayCostCents)} labour today`}
            loading={labour === null && todayHours === null}
          />
        </NavLink>
        <NavLink to="/labour" className="stat-card-link" aria-label="Open labour vs takings">
          <StatCard
            label="Labour this week"
            value={labour ? labourMoney(labour.totals.estCostCents) : '—'}
            hint={
              labour && labour.totals.overtimeCostCents > 0
                ? `incl. ${labourMoney(labour.totals.overtimeCostCents)} overtime`
                : 'Rostered cost, Mon–Sun'
            }
          />
        </NavLink>
        <NavLink to="/labour" className="stat-card-link" aria-label="Open labour vs takings">
          <StatCard
            label="Takings this week"
            value={labour ? labourMoney(labour.totals.salesCents) : '—'}
            hint={weekLabourPct != null ? `Labour is ${weekLabourPct}% of takings` : 'No takings recorded yet this week'}
            tone={weekLabourPct != null && weekLabourPct > 35 ? 'warning' : undefined}
          />
        </NavLink>
        <NavLink to="/timesheets" className="stat-card-link" aria-label="Open timesheets awaiting approval">
          <StatCard
            label="Awaiting approval"
            value={approvalQueue == null ? '—' : approvalQueue}
            hint="Submitted timesheets, last 30 days"
            tone={(approvalQueue ?? 0) > 0 ? 'warning' : 'positive'}
          />
        </NavLink>
      </div>

      <div className="stats-grid staff-settings-stats">
        <NavLink to="/profiles" className="stat-card-link" aria-label="Open active staff profiles">
          <StatCard label="Active staff" value={activeStaff.length} hint={`${staff.length} profiles on record`} loading={loading} />
        </NavLink>
        <NavLink to="/approvals" className="stat-card-link" aria-label="Open pending onboarding approvals">
          <StatCard
            label="Pending onboarding"
            value={pending.length}
            hint="Invite created, not finished"
            loading={loading}
            tone={pending.length > 0 ? 'warning' : 'positive'}
          />
        </NavLink>
        <NavLink to="/hr" className="stat-card-link" aria-label="Open expiring staff records">
          <StatCard
            label="Expiring records"
            value={expiringSoon.length}
            hint="Visas, certificates — next 30 days"
            loading={loading}
            tone={expiringSoon.length > 0 ? 'warning' : 'positive'}
          />
        </NavLink>
        <NavLink to="/roster" className="stat-card-link" aria-label="Open the roster">
          <StatCard
            label="On the roster this week"
            value={labour ? labour.people.length : '—'}
            hint={
              labour && labour.people.some((person) => !person.rateKnown)
                ? `${labour.people.filter((person) => !person.rateKnown).length} without a known pay rate`
                : 'Everyone rostered has a pay rate'
            }
            tone={labour && labour.people.some((person) => !person.rateKnown) ? 'warning' : undefined}
          />
        </NavLink>
      </div>

      <Card title="Staff readiness" subtitle="Read-only checks for the live Staff register. Nothing here changes payroll, roster or profile data.">
        <div className="staff-readiness-grid">
          {readinessWarnings.map((item) => (
            <div key={item.label} className={`staff-readiness-item is-${item.tone}`}>
              <span>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </span>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
        <ActionPanel
          title="Resolve staff readiness items"
          description="Expand to see affected staff and open the right workflow."
          count={readinessActionCount}
          tone={readinessActionCount ? 'warning' : 'positive'}
          empty={<p className="subtle">No staff readiness items need action.</p>}
          className="staff-readiness-actions"
        >
          {lightweightDeputyProfiles.slice(0, 8).map((member) => (
            <div key={`deputy:${member.id}`} className="action-panel-row">
              <span>
                <strong>{member.firstName} {member.lastName}</strong>
                <small>{member.venue || 'No venue'} · Deputy roster profile needs onboarding.</small>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => void reonboardLightweightProfile(member)}>
                Send onboarding
              </Button>
            </div>
          ))}
          {missingPayRate.slice(0, 8).map((member) => (
            <div key={`rate:${member.id}`} className="action-panel-row">
              <span>
                <strong>{member.firstName} {member.lastName}</strong>
                <small>{member.venue || 'No venue'} · pay rate missing.</small>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => openProfile(member.id, 'payroll')}>
                Open payroll
              </Button>
            </div>
          ))}
          {missingPayType.slice(0, 8).map((member) => (
            <div key={`paytype:${member.id}`} className="action-panel-row">
              <span>
                <strong>{member.firstName} {member.lastName}</strong>
                <small>{member.venue || 'No venue'} · pay type missing.</small>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => openProfile(member.id, 'payroll')}>
                Open payroll
              </Button>
            </div>
          ))}
          {pending.slice(0, 8).map((member) => (
            <div key={`pending:${member.id}`} className="action-panel-row">
              <span>
                <strong>{member.firstName} {member.lastName}</strong>
                <small>{member.email || 'No email'} · pending onboarding.</small>
              </span>
              <NavLink to="/approvals"><Button type="button" size="sm" variant="secondary">Review approval</Button></NavLink>
            </div>
          ))}
          {pendingRecords.slice(0, 8).map((record) => (
            <div key={`record:${record.id}`} className="action-panel-row">
              <span>
                <strong>{record.title}</strong>
                <small>{record.recordType.replace('_', ' ')} · pending document review.</small>
              </span>
              <NavLink to="/approvals"><Button type="button" size="sm" variant="secondary">Open approvals</Button></NavLink>
            </div>
          ))}
          {duplicateProfileGroups.slice(0, 4).map((group, index) => (
            <div key={`duplicate:${index}`} className="action-panel-row">
              <span>
                <strong>Possible duplicate profile</strong>
                <small>{group.map((member) => `${member.firstName} ${member.lastName}`).join(', ')}</small>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => openProfile(group[0]!.id)}>
                View profile
              </Button>
            </div>
          ))}
          {readinessActionCount > 44 ? <p className="subtle">More staff readiness items are available in Profiles and Approvals.</p> : null}
        </ActionPanel>
      </Card>

      {lightweightDeputyProfiles.length ? (
        <Card title="Deputy roster profiles" subtitle="These were created from Deputy so the roster has names. Re-onboard them before payroll use.">
          <div className="staff-action-strip lightweight-profile-summary">
            <span>
              <strong>{lightweightDeputyProfiles.length} lightweight profiles need onboarding</strong>
              <span className="subtle">Send each person a fresh onboarding link from here. Existing roster details stay on the profile.</span>
            </span>
            <NavLink to="/invites">
              <Button type="button" variant="secondary">
                View invites
              </Button>
            </NavLink>
          </div>
          {reonboardMessage ? <p className="subtle">{reonboardMessage}</p> : null}
          {reonboardError ? <p className="error-text">{reonboardError}</p> : null}
          <div className="lightweight-profile-list">
            {lightweightDeputyProfiles.slice(0, 8).map((member) => (
              <div key={member.id} className="lightweight-profile-row">
                <span>
                  <strong>{member.firstName} {member.lastName}</strong>
                  <span className="subtle">{member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'Add email first'}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant={member.email ? 'secondary' : 'ghost'}
                  disabled={reonboardingId === member.id}
                  onClick={() => void reonboardLightweightProfile(member)}
                >
                  {reonboardingId === member.id ? 'Sending…' : member.email ? 'Re-onboard' : 'Add email'}
                </Button>
              </div>
            ))}
            {lightweightDeputyProfiles.length > 8 ? (
              <p className="subtle">Showing 8 of {lightweightDeputyProfiles.length}. The rest are on the Profiles page.</p>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card title="Today’s checklists" subtitle="Open the iPad checklist runner for staff venue checks.">
        <div className="staff-action-strip">
          <span>
            <strong>Run venue checks from the floor</strong>
            <span className="subtle">Opening, closing, bar, kitchen and weekly compliance checks live in Compliance.</span>
          </span>
          <a href={`${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/checklists/ipad`}>
            <Button type="button" variant="secondary">
              Open iPad checklists
            </Button>
          </a>
        </div>
      </Card>

      {/* Record expiry + training chase — two sides of the same follow-up
          job, so they sit side by side in the suite's ov-two pair grid. */}
      <div className="ov-two">
      {/* HR + compliance record expiry — bucketed callouts at 7/30/60/90 days */}
      {(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const all = staff.flatMap((member) =>
          member.records
            .filter((record) => record.expiryDate)
            .map((record) => ({ member, record }))
        );
        type Bucket = typeof all;
        const buckets = { d7: [] as Bucket, d30: [] as Bucket, d60: [] as Bucket, d90: [] as Bucket, expired: [] as Bucket };
        for (const item of all) {
          const expiry = new Date(item.record.expiryDate!);
          expiry.setHours(0, 0, 0, 0);
          const days = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (days < 0) buckets.expired.push(item);
          else if (days <= 7) buckets.d7.push(item);
          else if (days <= 30) buckets.d30.push(item);
          else if (days <= 60) buckets.d60.push(item);
          else if (days <= 90) buckets.d90.push(item);
        }
        const total = buckets.expired.length + buckets.d7.length + buckets.d30.length + buckets.d60.length + buckets.d90.length;
        return (
          <Card
            title="Compliance & HR record expiry"
            subtitle={total === 0 ? 'All staff records are clear for the next 90 days.' : `${total} record${total === 1 ? '' : 's'} expiring within 90 days — RSA, RCG, first aid, right-to-work, visa.`}
          >
            {total === 0 ? (
              <EmptyState title="Nothing expiring soon" description="Records are clear for the next 90 days." />
            ) : (
              <div className="hr-expiry-stack">
                {([
                  ['expired', buckets.expired, 'danger', 'Expired now'],
                  ['d7', buckets.d7, 'danger', 'Within 7 days'],
                  ['d30', buckets.d30, 'warning', 'Within 30 days'],
                  ['d60', buckets.d60, 'info', 'Within 60 days'],
                  ['d90', buckets.d90, 'muted', 'Within 90 days']
                ] as const).map(([key, items, tone, label]) =>
                  items.length > 0 ? items.map(({ member, record }) => (
                    <div key={`${key}-${record.id}`} className={`hr-expiry-row is-${tone}`}>
                      <span className="hr-expiry-name">{member.firstName} {member.lastName}</span>
                      <span className="hr-expiry-meta">{record.title} · {record.recordType}</span>
                      <span className="hr-expiry-when">
                        {record.expiryDate ? new Date(record.expiryDate).toLocaleDateString() : '—'} · {label}
                      </span>
                    </div>
                  )) : null
                )}
              </div>
            )}
          </Card>
        );
      })()}

      {/* Training completion chase — surface staff with incomplete training */}
      {(() => {
        const incomplete = staff
          .flatMap((member) =>
            (member.trainingRecords ?? [])
              .filter((r) => r.status !== 'COMPLETED')
              .map((record) => ({ member, record }))
          )
          .sort((a, b) => {
            const aDate = a.record.assignedAt ? new Date(a.record.assignedAt).getTime() : 0;
            const bDate = b.record.assignedAt ? new Date(b.record.assignedAt).getTime() : 0;
            return aDate - bDate;
          });
        if (incomplete.length === 0) return null;
        const oldest = incomplete.slice(0, 10);
        return (
          <Card
            title="Training chase"
            subtitle={`${incomplete.length} training assignment${incomplete.length === 1 ? '' : 's'} not yet completed — most onboarding drop-off is a follow-up failure, not a willingness failure.`}
          >
            <div className="training-chase-stack">
              {oldest.map(({ member, record }) => {
                const daysSinceAssigned = record.assignedAt
                  ? Math.floor((Date.now() - new Date(record.assignedAt).getTime()) / (1000 * 60 * 60 * 24))
                  : null;
                const tone = daysSinceAssigned !== null && daysSinceAssigned > 14 ? 'danger' : daysSinceAssigned !== null && daysSinceAssigned > 7 ? 'warning' : 'info';
                return (
                  <div key={record.id} className={`training-chase-row is-${tone}`}>
                    <span className="training-chase-name">{member.firstName} {member.lastName}</span>
                    <span className="training-chase-meta">
                      {record.module?.title ?? 'Training module'}
                      {daysSinceAssigned !== null ? ` · assigned ${daysSinceAssigned}d ago` : ''}
                    </span>
                    <Badge tone={record.status === 'IN_PROGRESS' ? 'info' : record.status === 'EXPIRED' ? 'danger' : 'warning'}>
                      {record.status.replace('_', ' ').toLowerCase()}
                    </Badge>
                  </div>
                );
              })}
              {incomplete.length > oldest.length ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {incomplete.length - oldest.length} more incomplete training assignments. Open Academy to chase the full list.
                </p>
              ) : null}
            </div>
          </Card>
        );
      })()}
      </div>
    </div>
  );
}

function duplicateStaffProfileGroups(staff: StaffProfile[]) {
  const groups = new Map<string, StaffProfile[]>();
  for (const member of staff) {
    const keys = new Set<string>();
    const email = member.email?.trim().toLowerCase();
    if (email) keys.add(`email:${email}`);
    const name = `${member.firstName} ${member.lastName}`.trim().toLowerCase().replace(/\s+/g, ' ');
    if (name) keys.add(`name:${name}`);
    for (const key of keys) {
      const current = groups.get(key) ?? [];
      current.push(member);
      groups.set(key, current);
    }
  }
  return [...groups.values()].filter((group) => group.length > 1);
}
