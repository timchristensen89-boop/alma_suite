import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  AppSettingsPayload,
  AlmaAppId,
  OnboardingSettings,
  OnboardingStepSettings,
  RosterShift,
  StaffAppAccessStatus,
  StaffComplianceRecord,
  StaffTipHistory,
  StaffProfile,
  StaffRecordType,
  StaffTipsSummary,
  StaffTrainingRecord,
  Timesheet,
  TrainingOverview
} from '@alma/shared';
import {
  DEFAULT_ONBOARDING_SETTINGS,
  normaliseOnboardingSettings
} from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  CapIcon,
  ChartIcon,
  DocumentIcon,
  EmptyState,
  GearIcon,
  Input,
  PageHeader,
  PeopleIcon,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  Textarea,
  TopBar
} from '@alma/ui';
import { LoginPage } from './LoginPage';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { COMPLIANCE_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import { historicalSalesForDate, normaliseHistoricalVenue } from './data/historicalSales';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

const STAFF_APPS: Array<{ id: AlmaAppId; label: string; role: string }> = [
  { id: 'COMPLIANCE', label: 'Compliance', role: 'MANAGER' },
  { id: 'STOCK', label: 'Stock', role: 'USER' },
  { id: 'STAFF', label: 'Staff', role: 'MANAGER' },
  { id: 'REPORTS', label: 'Reports', role: 'USER' },
  { id: 'SETTINGS', label: 'Admin', role: 'ADMIN' }
];

const NAV_ITEMS = [
  {
    to: '/',
    label: 'People',
    description: 'Shared StaffProfile authority',
    icon: <PeopleIcon />,
    end: true
  },
  {
    to: '/invites',
    label: 'Invites',
    description: 'Staff onboarding links',
    icon: <CapIcon />
  },
  {
    to: '/approvals',
    label: 'Approvals',
    description: 'Review onboarding documents',
    icon: <DocumentIcon />
  },
  {
    to: '/roster',
    label: 'Roster',
    description: 'Roster board foundation',
    icon: <ChartIcon />
  },
  {
    to: '/academy',
    label: 'Academy',
    description: 'Modules, levels and pay rules',
    icon: <CapIcon />
  },
  {
    to: '/timesheets',
    label: 'Timesheets',
    description: 'Submit, approve, export',
    icon: <DocumentIcon />
  },
  {
    to: '/tips',
    label: 'Tips',
    description: 'Cash tips and payout runs',
    icon: <ChartIcon />
  },
  {
    to: '/settings',
    label: 'Settings',
    description: 'Onboarding, organisation, and access',
    icon: <GearIcon />
  }
];

const STAFF_MEMBER_NAV_ITEMS = [
  {
    to: '/',
    label: 'My shifts',
    description: 'Upcoming shifts and timesheets',
    icon: <PeopleIcon />,
    end: true
  },
  {
    to: '/academy',
    label: 'Academy',
    description: 'Assigned training modules',
    icon: <CapIcon />
  },
  {
    to: '/timesheets',
    label: 'Timesheets',
    description: 'Submit worked hours',
    icon: <DocumentIcon />
  },
  {
    to: '/tips',
    label: 'Tips',
    description: 'Paid tip history',
    icon: <ChartIcon />
  }
];

const VENUE_OPTIONS = [
  { label: 'Select venue / group', value: '' },
  { label: 'Alma Avalon', value: 'Alma Avalon' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Both', value: 'Both' }
];

const ROSTER_FORECAST_STORAGE_KEY = 'alma.staff.roster.forecast.v1';
const ROSTER_CLOSED_DAYS_STORAGE_KEY = 'alma.staff.roster.closedDays.v1';

type RosterShiftContextMenu = {
  shift: RosterShift;
  x: number;
  y: number;
};

type RosterForecastDraft = {
  forecastSales: string;
  targetWagePercent: string;
  dailyForecastSales: Record<string, string>;
};

function TopBarWithContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const active = currentPage(location.pathname, user?.role === 'STAFF' ? STAFF_MEMBER_NAV_ITEMS : NAV_ITEMS);
  useDocumentTitle(active.label);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        user ? (
          <>
            <SuiteAppSwitcher currentApp="staff" apps={suiteApps} variant="topbar" />
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </>
        ) : null
      }
    />
  );
}

function currentPage(pathname: string, items = NAV_ITEMS) {
  return (
    [...items]
      .sort((a, b) => b.to.length - a.to.length)
      .find((item) =>
        item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)
      ) ?? {
      to: pathname,
      label: 'Page not found',
      description: "The URL didn't match any section",
      icon: null
    }
  );
}

function SidebarNav({ items = NAV_ITEMS }: { items?: typeof NAV_ITEMS }) {
  const location = useLocation();
  const active = currentPage(location.pathname, items);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <>
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="staff-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul
        id="staff-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        <li className="sidebar-nav-section">Staff</li>
        {items.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </>
  );
}

function useStaffData() {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [roster, setRoster] = useState<RosterShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (rosterStart?: Date, rosterEnd?: Date) => {
    setLoading(true);
    setError(null);
    try {
      const rosterQuery =
        rosterStart && rosterEnd
          ? `?start=${encodeURIComponent(rosterStart.toISOString())}&end=${encodeURIComponent(rosterEnd.toISOString())}`
          : '';
      const [staffData, rosterData] = await Promise.all([
        api<StaffProfile[]>('/api/staff'),
        api<RosterShift[]>(`/api/staff/roster${rosterQuery}`)
      ]);
      setStaff(staffData);
      setRoster(rosterData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const start = startOfWeek(new Date());
    void load(start, addDays(start, 14));
  }, []);

  return { staff, roster, loading, error, reload: load };
}

type StaffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; member: StaffProfile };

function StaffHome({
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
  const activeStaff = staff.filter((member) => member.employmentStatus !== 'ARCHIVED');
  const pending = staff.filter((member) => member.employmentStatus === 'PENDING');
  const withStaffAccess = staff.filter((member) =>
    member.appAccess.some((access) => access.appId === 'STAFF' && access.status === 'ENABLED')
  );
  const lightweightDeputyProfiles = staff.filter(isDeputyImportedProfile);
  const expiringSoon = staff.flatMap((member) =>
    member.records
      .filter((record) => record.expiryDate && isExpiringSoon(record.expiryDate))
      .map((record) => ({ member, record }))
  );
  const [form, setForm] = useState<StaffFormState>({ mode: 'closed' });
  const [reonboardingId, setReonboardingId] = useState<string | null>(null);
  const [reonboardMessage, setReonboardMessage] = useState<string | null>(null);
  const [reonboardError, setReonboardError] = useState<string | null>(null);

  async function handleSaved(member: StaffProfile) {
    await reload();
    onSelect(member.id);
    setForm({ mode: 'closed' });
  }

  async function reonboardLightweightProfile(member: StaffProfile) {
    setReonboardMessage(null);
    setReonboardError(null);
    if (!member.email) {
      setReonboardError(`Add an email to ${member.firstName} ${member.lastName} before sending an onboarding link.`);
      setForm({ mode: 'edit', member });
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
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Staff"
        title="One staff authority for every ALMA app"
        description="This app reads and manages the shared StaffProfile register used by Compliance, Stock, Training, Reports, and future modules."
      />

      <div className="stats-grid">
        <StatCard label="Staff profiles" value={staff.length} hint="Shared records" loading={loading} />
        <StatCard label="Active" value={activeStaff.length} hint="Not archived" loading={loading} />
        <StatCard label="Pending onboarding" value={pending.length} hint="Invite created" loading={loading} />
        <StatCard label="Expiring records" value={expiringSoon.length} hint="Next 30 days" loading={loading} />
      </div>

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
              <p className="subtle">Showing 8 of {lightweightDeputyProfiles.length}. The rest are in the staff register below.</p>
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

      <Card
        title={form.mode === 'closed' ? 'Staff register' : form.mode === 'edit' ? `Editing ${form.member.firstName}` : 'New staff profile'}
        subtitle={form.mode === 'closed' ? 'Shared StaffProfile records for Staff, Compliance, Stock and Training.' : 'Create or update the shared staff authority.'}
        padding={form.mode === 'closed' ? 'none' : 'default'}
        action={
          form.mode === 'closed' ? (
            <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
              New staff
            </Button>
          ) : null
        }
      >
        {form.mode !== 'closed' ? (
          <StaffProfileForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.member : undefined}
            onSaved={(member) => void handleSaved(member)}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : null}
        {loading ? <Spinner label="Loading staff…" /> : null}
        {!loading && staff.length === 0 && form.mode === 'closed' ? (
          <EmptyState
            title="No staff profiles yet"
            description="Create staff here, then manage roster and app access."
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>Create first staff profile</Button>}
          />
        ) : null}
        {form.mode === 'closed' ? (
          <div className="staff-list" style={{ padding: 12 }}>
            {staff.map((member) => {
              const soon = member.records.filter((record) => record.expiryDate && isExpiringSoon(record.expiryDate)).length;
              return (
                <div key={member.id} className="staff-list-button">
                  <button type="button" className="staff-list-main" onClick={() => onSelect(member.id)}>
                    <span>
                      <strong>
                        {member.firstName} {member.lastName}
                      </strong>
                      <span className="subtle" style={{ display: 'block' }}>
                        {member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'No email'}
                      </span>
                      {soon ? <span className="subtle" style={{ display: 'block' }}>{soon} record{soon === 1 ? '' : 's'} expiring soon</span> : null}
                    </span>
                  </button>
                  <span className="staff-row-actions">
                    {isDeputyImportedProfile(member) ? <Badge tone="info">Roster import</Badge> : null}
                    {isUnallocatedProfile(member) ? <Badge tone="warning">Unallocated</Badge> : null}
                    <Badge tone={member.employmentStatus === 'ACTIVE' ? 'positive' : 'warning'}>{member.employmentStatus}</Badge>
                    {isDeputyImportedProfile(member) ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={reonboardingId === member.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void reonboardLightweightProfile(member);
                        }}
                      >
                        {reonboardingId === member.id ? 'Sending…' : 'Re-onboard'}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={(event) => {
                        event.stopPropagation();
                        setForm({ mode: 'edit', member });
                      }}
                    >
                      Edit
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>

      <Card title="Compliance watch" subtitle="Staff certificates and records needing attention">
        {expiringSoon.length === 0 ? (
          <EmptyState title="No records expiring soon" description="RSA, first aid and training records are clear for the next 30 days." />
        ) : (
          <div className="staff-expiry-list">
            {expiringSoon.map(({ member, record }) => (
              <div key={record.id} className="staff-expiry-row">
                <span>
                  <strong>
                    {member.firstName} {member.lastName}
                  </strong>
                  <span className="subtle">
                    {record.title} · {record.recordType}
                  </span>
                </span>
                <Badge tone={record.expiryDate && new Date(record.expiryDate) < new Date() ? 'danger' : 'warning'}>
                  {record.expiryDate ? new Date(record.expiryDate).toLocaleDateString() : 'No expiry'}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StaffMemberHome({
  staff,
  roster,
  loading,
  reload
}: {
  staff: StaffProfile[];
  roster: RosterShift[];
  loading: boolean;
  reload: (rosterStart?: Date, rosterEnd?: Date) => Promise<void>;
}) {
  const { user } = useAuth();
  const member = staff.find((item) => item.id === user?.id) ?? staff[0] ?? null;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [policyAcknowledged, setPolicyAcknowledged] = useState(() => {
    return window.localStorage.getItem('alma-staff-policy-ack') === 'yes';
  });
  const today = new Date();
  const upcomingShifts = roster
    .filter((shift) => !member || shift.staffProfileId === member.id)
    .filter((shift) => new Date(shift.endsAt) >= today && shift.status !== 'CANCELLED')
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const nextShift = upcomingShifts[0] ?? null;

  useEffect(() => {
    const start = startOfWeek(new Date());
    void reload(start, addDays(start, 14));
  }, [reload]);

  function acknowledgePolicy() {
    window.localStorage.setItem('alma-staff-policy-ack', 'yes');
    setPolicyAcknowledged(true);
    setMessage('Policy acknowledgement saved on this device.');
  }

  async function submitFromShift(shift: RosterShift) {
    if (!member) {
      setMessage('Could not find your staff profile.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/timesheets', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: member.id,
          rosterShiftId: shift.id,
          venue: shift.venue ?? member.venue ?? '',
          area: shift.area ?? '',
          roleTitle: shift.roleTitle ?? member.roleTitle ?? '',
          workDate: toDateInput(new Date(shift.startsAt)),
          clockInAt: shift.startsAt,
          clockOutAt: shift.endsAt,
          breakMinutes: shift.breakMinutes,
          notes: `Submitted from rostered shift ${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)}.`,
          status: 'SUBMITTED',
          xeroEmployeeId: member.xeroEmployeeId ?? '',
          xeroEarningsRateId: member.xeroEarningsRateId ?? ''
        })
      });
      setMessage('Timesheet submitted. A manager can now approve it.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not submit timesheet.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !member) {
    return (
      <Card>
        <Spinner label="Loading your staff home…" />
      </Card>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="My staff home"
        title={member ? `Hi ${member.firstName}` : 'My shifts'}
        description="Your rostered shifts, announcements, policies and timesheet shortcuts."
      />

      <div className="stats-grid">
        <StatCard label="Upcoming shifts" value={upcomingShifts.length} hint="Next two weeks" loading={loading} />
        <StatCard label="Next shift" value={nextShift ? new Date(nextShift.startsAt).toLocaleDateString(undefined, { weekday: 'short' }) : 'None'} hint={nextShift ? `${timeOf(nextShift.startsAt)}-${timeOf(nextShift.endsAt)}` : 'No rostered shift'} loading={loading} />
        <StatCard label="Policy" value={policyAcknowledged ? 'Done' : 'Needed'} hint="Device acknowledgement" loading={loading} />
      </div>

      {message ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Upcoming shifts" subtitle="Tap submit after the shift, then adjust in Timesheets if actual hours changed." padding="none">
        {upcomingShifts.length === 0 ? (
          <EmptyState title="No upcoming shifts" description="Published roster shifts will appear here once your manager assigns them." />
        ) : (
          <div className="invite-list">
            {upcomingShifts.map((shift) => (
              <div key={shift.id} className="invite-row">
                <span>
                  <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                  <span className="subtle">
                    {timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'} · {shift.venue || member?.venue || 'No venue'}
                  </span>
                  <span className="subtle">{shift.breakMinutes ? `${shift.breakMinutes}m break` : 'No break recorded'} · {roundHours(shiftHours(shift))}</span>
                </span>
                <span className="invite-row-actions">
                  <Badge tone={statusTone(shift.status)}>{shift.status}</Badge>
                  <Button type="button" size="sm" disabled={saving || isUnallocatedProfile(shift.staffProfile)} onClick={() => void submitFromShift(shift)}>
                    Submit timesheet
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Announcements" subtitle="Staff beta notes">
        <div className="staff-member-grid">
          <div>
            <strong>Roster imported from Deputy</strong>
            <span className="subtle">Managers are checking unallocated and draft shifts before final payroll use.</span>
          </div>
          <div>
            <strong>Timesheets are approval-first</strong>
            <span className="subtle">Submitted hours go to managers before Xero export.</span>
          </div>
        </div>
      </Card>

      <Card title="Policies" subtitle="Quick acknowledgement for beta testing">
        <div className="staff-action-strip">
          <span>
            <strong>Venue handbook and compliance policies</strong>
            <span className="subtle">Follow RSA, food safety, WHS, harassment, privacy, cash handling, and venue procedures for every shift.</span>
          </span>
          <Button type="button" variant={policyAcknowledged ? 'secondary' : 'primary'} onClick={acknowledgePolicy}>
            {policyAcknowledged ? 'Acknowledged' : 'Acknowledge'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StaffMemberAcademyPage({ staff, loading }: { staff: StaffProfile[]; loading: boolean }) {
  const { user } = useAuth();
  const member = staff.find((item) => item.id === user?.id) ?? staff[0] ?? null;
  const records = [...(member?.trainingRecords ?? [])].sort((a, b) => {
    const statusRank = { ASSIGNED: 0, IN_PROGRESS: 1, EXPIRED: 2, COMPLETED: 3 } as const;
    const left = statusRank[a.status] ?? 9;
    const right = statusRank[b.status] ?? 9;
    if (left !== right) return left - right;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  const openRecords = records.filter((record) => record.status !== 'COMPLETED');
  const completedRecords = records.filter((record) => record.status === 'COMPLETED');

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="My Academy"
        title="Training assigned to you"
        description="Academy now lives inside Staff. Your manager assigns modules and records completion against your staff profile."
      />

      <div className="stats-grid">
        <StatCard label="Open modules" value={openRecords.length} hint="Assigned or in progress" loading={loading} />
        <StatCard label="Completed" value={completedRecords.length} hint="Finished modules" loading={loading} />
        <StatCard label="Level" value={member?.trainingLevel ?? 0} hint="Current Academy level" loading={loading} />
        <StatCard label="Training rate" value={formatCents(member?.trainingPayRateCents ?? null)} hint="Pay rule rate" loading={loading} />
      </div>

      <Card title="Assigned modules" subtitle="Ask your manager to mark completion once practical training is signed off." padding="none">
        {loading ? <Spinner label="Loading Academy…" /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState title="No Academy modules assigned" description="Your assigned training modules will appear here." />
        ) : null}
        <div className="invite-list">
          {records.map((record) => (
            <div key={record.id} className="invite-row">
              <span>
                <strong>{record.module?.title ?? 'Academy module'}</strong>
                <span className="subtle">
                  Level {record.module?.level ?? '-'} · {record.module?.category || 'Training'}
                  {record.module?.estimatedMinutes ? ` · ${record.module.estimatedMinutes}m` : ''}
                </span>
                {record.module?.description ? <span className="subtle">{record.module.description}</span> : null}
                {record.completedAt ? <span className="subtle">Completed {new Date(record.completedAt).toLocaleDateString()}</span> : null}
                {record.notes ? <span className="subtle">{record.notes}</span> : null}
              </span>
              <span className="invite-row-actions">
                <Badge tone={record.status === 'COMPLETED' ? 'positive' : record.status === 'EXPIRED' ? 'danger' : record.status === 'IN_PROGRESS' ? 'warning' : 'muted'}>
                  {record.status.replace('_', ' ')}
                </Badge>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

type StaffDraft = {
  firstName: string;
  lastName: string;
  roleTitle: string;
  email: string;
  phone: string;
  venue: string;
  employmentStatus: string;
  startDate: string;
  notes: string;
};

function emptyStaffDraft(): StaffDraft {
  return {
    firstName: '',
    lastName: '',
    roleTitle: '',
    email: '',
    phone: '',
    venue: '',
    employmentStatus: 'ACTIVE',
    startDate: '',
    notes: ''
  };
}

function draftFromStaff(member: StaffProfile): StaffDraft {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    roleTitle: member.roleTitle,
    email: member.email ?? '',
    phone: member.phone ?? '',
    venue: member.venue ?? '',
    employmentStatus: member.employmentStatus,
    startDate: member.startDate ? toDateInput(new Date(member.startDate)) : '',
    notes: member.notes ?? ''
  };
}

function StaffProfileForm({
  mode,
  initial,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: StaffProfile;
  onSaved: (member: StaffProfile) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<StaffDraft>(() => (initial ? draftFromStaff(initial) : emptyStaffDraft()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setError(null);
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.roleTitle.trim()) {
      setError('First name, last name and role are required');
      return;
    }
    const payload = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      roleTitle: draft.roleTitle.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      venue: draft.venue.trim(),
      employmentStatus: draft.employmentStatus,
      startDate: draft.startDate,
      notes: draft.notes.trim()
    };

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        onSaved(
          await api<StaffProfile>(`/api/staff/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          })
        );
      } else {
        onSaved(
          await api<StaffProfile>('/api/staff', {
            method: 'POST',
            body: JSON.stringify(payload)
          })
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save staff profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="staff-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="form-grid two">
        <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
        <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
      </div>
      <div className="form-grid two">
        <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
        <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
      </div>
      <div className="form-grid three">
        <Input label="Email" type="email" value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
        <Input label="Phone" value={draft.phone} onChange={(event) => update('phone', event.currentTarget.value)} />
        <Select
          label="Status"
          value={draft.employmentStatus}
          onChange={(event) => update('employmentStatus', event.currentTarget.value)}
          options={['ACTIVE', 'PENDING', 'ARCHIVED'].map((status) => ({ label: status, value: status }))}
        />
      </div>
      <Input label="Start date" type="date" value={draft.startDate} onChange={(event) => update('startDate', event.currentTarget.value)} />
      <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />
      {error ? <p className="error-text">{error}</p> : null}
      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create staff'}</Button>
      </div>
    </form>
  );
}

type StaffInvite = {
  id: string;
  token: string;
  email: string | null;
  note: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  staffProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CreatedStaffInvite = StaffInvite & {
  inviteLink?: string | null;
  emailDelivery?: { status: string; reason?: string };
};

type InviteDraft = {
  firstName: string;
  lastName: string;
  roleTitle: string;
  email: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

type ReonboardDraft = {
  email: string;
  firstName: string;
  lastName: string;
  roleTitle: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

function emptyInviteDraft(): InviteDraft {
  return {
    firstName: '',
    lastName: '',
    roleTitle: '',
    email: '',
    venue: '',
    note: '',
    expiresInDays: '30'
  };
}

function emptyReonboardDraft(): ReonboardDraft {
  return {
    email: '',
    firstName: '',
    lastName: '',
    roleTitle: '',
    venue: '',
    note: '',
    expiresInDays: '30'
  };
}

function InvitesPage({ staff, reloadStaff }: { staff: StaffProfile[]; reloadStaff: () => Promise<void> }) {
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<InviteDraft>(() => emptyInviteDraft());
  const [reonboardDraft, setReonboardDraft] = useState<ReonboardDraft>(() => emptyReonboardDraft());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingInvites = invites.filter((invite) => inviteStatus(invite) === 'Pending');
  const completedInvites = invites.filter((invite) => invite.completedAt);
  const expiredInvites = invites.filter((invite) => inviteStatus(invite) === 'Expired');

  async function loadInvites() {
    setLoading(true);
    setError(null);
    try {
      setInvites(await api<StaffInvite[]>('/api/staff/invites'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invites');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadInvites();
  }, []);

  function update<K extends keyof InviteDraft>(key: K, value: InviteDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateReonboard<K extends keyof ReonboardDraft>(key: K, value: ReonboardDraft[K]) {
    setReonboardDraft((current) => ({ ...current, [key]: value }));
  }

  async function createInvite() {
    setError(null);
    setMessage(null);
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.roleTitle.trim()) {
      setError('First name, last name and role are required');
      return;
    }

    setSaving(true);
    try {
      const created = await api<CreatedStaffInvite>('/api/staff/invites', {
        method: 'POST',
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          roleTitle: draft.roleTitle.trim(),
          email: draft.email.trim(),
          venue: draft.venue.trim(),
          note: draft.note.trim(),
          expiresInDays: Number(draft.expiresInDays) || 30,
          onboardingBaseUrl: window.location.origin
        })
      });
      setDraft(emptyInviteDraft());
      setMessage(
        created.emailDelivery?.status === 'sent'
          ? 'Invite created and email sent.'
          : 'Invite created. Copy the onboarding link below.'
      );
      await Promise.all([loadInvites(), reloadStaff()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setSaving(false);
    }
  }

  async function copyInviteLink(invite: StaffInvite) {
    const link = inviteLink(invite.token);
    await navigator.clipboard?.writeText(link);
    setMessage('Onboarding link copied.');
  }

  async function reonboardStaff() {
    setError(null);
    setMessage(null);
    if (!reonboardDraft.email.trim()) {
      setError('Email is required to reset onboarding.');
      return;
    }

    setSaving(true);
    try {
      const created = await api<CreatedStaffInvite>('/api/staff/invites/reonboard', {
        method: 'POST',
        body: JSON.stringify({
          email: reonboardDraft.email.trim(),
          firstName: reonboardDraft.firstName.trim(),
          lastName: reonboardDraft.lastName.trim(),
          roleTitle: reonboardDraft.roleTitle.trim(),
          venue: reonboardDraft.venue.trim(),
          note: reonboardDraft.note.trim(),
          expiresInDays: Number(reonboardDraft.expiresInDays) || 30,
          onboardingBaseUrl: window.location.origin
        })
      });
      setReonboardDraft(emptyReonboardDraft());
      setMessage(
        created.emailDelivery?.status === 'sent'
          ? `Re-onboarding reset and invite sent to ${created.email}.`
          : 'Re-onboarding reset. Copy the fresh onboarding link below.'
      );
      await Promise.all([loadInvites(), reloadStaff()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset onboarding.');
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite(invite: StaffInvite) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const resent = await api<CreatedStaffInvite>(`/api/staff/invites/${invite.id}/resend`, {
        method: 'POST',
        body: JSON.stringify({ onboardingBaseUrl: window.location.origin })
      });
      setMessage(
        resent.emailDelivery?.status === 'sent'
          ? `Invite resent to ${resent.email ?? invite.email}.`
          : `Invite link is ready to copy. ${resent.emailDelivery?.reason ?? 'Email was not sent.'}`
      );
      await loadInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend invite');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Staff onboarding"
        title="Invite new staff"
        description="Create pending staff profiles, send onboarding links, and track who has completed their setup."
      />

      <div className="stats-grid">
        <StatCard label="Invites" value={invites.length} hint="All onboarding links" loading={loading} />
        <StatCard label="Pending" value={pendingInvites.length} hint="Waiting for completion" loading={loading} />
        <StatCard label="Completed" value={completedInvites.length} hint="Staff finished setup" loading={loading} />
        <StatCard label="Expired" value={expiredInvites.length} hint="Needs a fresh invite" loading={loading} />
      </div>

      <div className="invites-layout">
        <Card title="Create invite" subtitle="This also creates a pending staff profile">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createInvite();
            }}
          >
            <div className="form-grid two">
              <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
              <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
            </div>
            <div className="form-grid two">
              <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
              <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            <div className="form-grid two">
              <Input label="Email" type="email" value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
              <Input label="Expires in days" type="number" min="1" value={draft.expiresInDays} onChange={(event) => update('expiresInDays', event.currentTarget.value)} />
            </div>
            <Textarea label="Note" rows={2} value={draft.note} onChange={(event) => update('note', event.currentTarget.value)} placeholder="Optional message for the invite email" />
            {error ? <p className="error-text">{error}</p> : null}
            <div className="toolbar-right">
              {message ? <span className="subtle">{message}</span> : null}
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invite'}</Button>
            </div>
          </form>
        </Card>

        <Card title="Re-onboard staff" subtitle="Reset an archived or completed staff profile and issue a fresh onboarding link">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void reonboardStaff();
            }}
          >
            <Input
              label="Employee email"
              type="email"
              required
              value={reonboardDraft.email}
              onChange={(event) => updateReonboard('email', event.currentTarget.value)}
              placeholder="bonnie@almagroup.com.au"
            />
            <div className="form-grid two">
              <Input label="First name override" value={reonboardDraft.firstName} onChange={(event) => updateReonboard('firstName', event.currentTarget.value)} />
              <Input label="Last name override" value={reonboardDraft.lastName} onChange={(event) => updateReonboard('lastName', event.currentTarget.value)} />
            </div>
            <div className="form-grid two">
              <Input label="Role override" value={reonboardDraft.roleTitle} onChange={(event) => updateReonboard('roleTitle', event.currentTarget.value)} />
              <Select label="Venue override" value={reonboardDraft.venue} onChange={(event) => updateReonboard('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            <div className="form-grid two">
              <Input label="Expires in days" type="number" min="1" value={reonboardDraft.expiresInDays} onChange={(event) => updateReonboard('expiresInDays', event.currentTarget.value)} />
            </div>
            <Textarea label="Reset note" rows={2} value={reonboardDraft.note} onChange={(event) => updateReonboard('note', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Resetting…' : 'Reset onboarding'}</Button>
            </div>
          </form>
        </Card>

        <Card title="Pending profiles" subtitle="Created by invites and waiting for onboarding" padding="none">
          <div className="staff-list" style={{ padding: 12 }}>
            {staff.filter((member) => member.employmentStatus === 'PENDING').length === 0 ? (
              <EmptyState title="No pending profiles" description="New invite profiles will appear here." />
            ) : (
              staff
                .filter((member) => member.employmentStatus === 'PENDING')
                .map((member) => (
                  <div key={member.id} className="staff-expiry-row">
                    <span>
                      <strong>{member.firstName} {member.lastName}</strong>
                      <span className="subtle">{member.roleTitle} · {member.venue || 'No venue'}</span>
                    </span>
                    <Badge tone="warning">Pending</Badge>
                  </div>
                ))
            )}
          </div>
        </Card>
      </div>

      <Card title="Invite history" subtitle="Copy links, check expiry, and see completed onboarding" padding="none">
        {loading ? <Spinner label="Loading invites…" /> : null}
        {!loading && invites.length === 0 ? (
          <EmptyState title="No invites yet" description="Create the first onboarding invite above." />
        ) : null}
        {!loading && invites.length > 0 ? (
          <div className="invite-list">
            {invites.map((invite) => {
              const status = inviteStatus(invite);
              return (
                <div key={invite.id} className="invite-row">
                  <span>
                    <strong>{invite.email || 'No email recorded'}</strong>
                    <span className="subtle">
                      Created {formatDateTime(invite.createdAt)} · Expires {invite.expiresAt ? formatDateTime(invite.expiresAt) : 'never'}
                    </span>
                    <span className="invite-link">{inviteLink(invite.token)}</span>
                  </span>
                  <span className="invite-row-actions">
                    <Badge tone={status === 'Completed' ? 'positive' : status === 'Expired' ? 'danger' : 'warning'}>{status}</Badge>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void copyInviteLink(invite)}>
                      Copy link
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={saving || status === 'Completed'} onClick={() => void resendInvite(invite)}>
                      Resend
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function AccessPage({
  staff,
  selectedId,
  setSelectedId,
  reload
}: {
  staff: StaffProfile[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const selected = staff.find((member) => member.id === selectedId) ?? staff[0] ?? null;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const accessByApp = new Map(selected?.appAccess.map((access) => [access.appId, access]));

  async function setAccess(appId: AlmaAppId, status: StaffAppAccessStatus) {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${selected.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: STAFF_APPS.map((app) => {
            const current = accessByApp.get(app.id);
            return {
              appId: app.id,
              status: app.id === appId ? status : current?.status ?? 'DISABLED',
              role: current?.role ?? app.role,
              notes: current?.notes ?? ''
            };
          })
        })
      });
      await reload();
      setMessage('App access updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update app access.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="staff-board">
      <Card title="People" subtitle="Select who you want to configure" padding="none">
        <div className="staff-list" style={{ padding: 12 }}>
          {staff.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`staff-list-button ${selected?.id === member.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(member.id)}
            >
              <span>
                <strong>
                  {member.firstName} {member.lastName}
                </strong>
                <span className="subtle" style={{ display: 'block' }}>{member.roleTitle}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={selected ? `${selected.firstName} ${selected.lastName}` : 'App access'}
        subtitle="Enable or disable access across the ALMA Suite from the shared staff profile"
      >
        {!selected ? <EmptyState title="No staff selected" description="Add or import staff first." /> : null}
        {selected ? (
          <>
            <div className="app-access-grid">
              {STAFF_APPS.map((app) => {
                const current = accessByApp.get(app.id);
                const enabled = current?.status === 'ENABLED';
                return (
                  <div key={app.id} className="app-access-tile">
                    <strong>{app.label}</strong>
                    <span className="subtle">Role: {current?.role ?? app.role}</span>
                    <Badge tone={enabled ? 'positive' : 'muted'} dot>
                      {current?.status ?? 'DISABLED'}
                    </Badge>
                    <Button
                      size="sm"
                      variant={enabled ? 'secondary' : 'primary'}
                      disabled={saving}
                      onClick={() => void setAccess(app.id, enabled ? 'DISABLED' : 'ENABLED')}
                    >
                      {enabled ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                );
              })}
            </div>
            {message ? <p className={message.includes('updated') ? 'subtle' : 'error-text'}>{message}</p> : null}
          </>
        ) : null}
      </Card>
    </div>
  );
}

type AdminSettingsDraft = {
  orgName: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  notifyEmail: string;
  onboardingSettings: OnboardingSettings;
};

function draftFromSettings(settings: AppSettingsPayload): AdminSettingsDraft {
  return {
    orgName: settings.orgName,
    primaryContactName: settings.primaryContactName ?? '',
    primaryContactEmail: settings.primaryContactEmail ?? '',
    primaryContactPhone: settings.primaryContactPhone ?? '',
    notifyEmail: settings.notifyEmail ?? '',
    onboardingSettings: normaliseOnboardingSettings(settings.onboardingSettings)
  };
}

const ONBOARDING_SETTING_ROWS: Array<{
  key: keyof OnboardingSettings;
  title: string;
  kind: 'Web form' | 'Upload';
  help: string;
}> = [
  {
    key: 'taxDeclaration',
    title: 'Tax declaration',
    kind: 'Web form',
    help: 'Staff complete the tax fields directly in onboarding.'
  },
  {
    key: 'superannuationChoice',
    title: 'Superannuation choice',
    kind: 'Web form',
    help: 'Staff provide their chosen super fund details directly in onboarding.'
  },
  {
    key: 'rightToWorkDocuments',
    title: 'Right-to-work documents',
    kind: 'Upload',
    help: 'Optional support upload for visa, passport, citizenship, or work-rights evidence.'
  },
  {
    key: 'bankAccountConfirmation',
    title: 'Bank account confirmation',
    kind: 'Upload',
    help: 'Optional support upload for payroll bank-details confirmation.'
  }
];

function AdminPage({
  staff,
  selectedId,
  setSelectedId,
  reload
}: {
  staff: StaffProfile[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [settings, setSettings] = useState<AppSettingsPayload | null>(null);
  const [draft, setDraft] = useState<AdminSettingsDraft>({
    orgName: '',
    primaryContactName: '',
    primaryContactEmail: '',
    primaryContactPhone: '',
    notifyEmail: '',
    onboardingSettings: DEFAULT_ONBOARDING_SETTINGS
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const enabledAccessCount = staff.flatMap((member) => member.appAccess).filter((access) => access.status === 'ENABLED').length;
  const adminCount = staff.filter((member) => member.isAdmin).length;
  const venueCount = new Set(staff.map((member) => member.venue).filter(Boolean)).size;
  const venueNames = settings?.venues.length
    ? settings.venues.map((venue) => venue.name)
    : VENUE_OPTIONS.filter((item) => item.value && item.value !== 'Both').map((item) => item.value);

  const appRows = STAFF_APPS.map((app) => {
    const access = staff.flatMap((member) => member.appAccess.filter((item) => item.appId === app.id));
    return {
      app,
      enabled: access.filter((item) => item.status === 'ENABLED').length,
      pending: access.filter((item) => item.status === 'PENDING').length,
      disabled: access.filter((item) => item.status === 'DISABLED').length
    };
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setLoading(true);
      setMessage(null);
      try {
        const next = await api<AppSettingsPayload>('/api/settings');
        if (!cancelled) {
          setSettings(next);
          setDraft(draftFromSettings(next));
        }
      } catch (err) {
        if (!cancelled) setMessage(err instanceof Error ? err.message : 'Could not load admin settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof AdminSettingsDraft>(key: K, value: AdminSettingsDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateOnboardingStep<K extends keyof OnboardingSettings>(
    key: K,
    updates: Partial<OnboardingStepSettings>
  ) {
    setDraft((current) => ({
      ...current,
      onboardingSettings: {
        ...current.onboardingSettings,
        [key]: {
          ...current.onboardingSettings[key],
          ...updates
        }
      }
    }));
  }

  async function saveSettings() {
    if (!user?.isAdmin) {
      setMessage('Only admin users can save organisation settings.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const updated = await api<AppSettingsPayload>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          orgName: draft.orgName.trim(),
          primaryContactName: draft.primaryContactName.trim(),
          primaryContactEmail: draft.primaryContactEmail.trim(),
          primaryContactPhone: draft.primaryContactPhone.trim(),
          notifyEmail: draft.notifyEmail.trim(),
          venues: settings?.venues ?? [],
          onboardingSettings: draft.onboardingSettings
        })
      });
      setSettings(updated);
      setDraft(draftFromSettings(updated));
      setMessage('Admin settings saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save admin settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Settings"
        title="Onboarding, controls and access"
        description="Settings is the control surface for staff onboarding, organisation details, venue readiness, and who can access each ALMA app."
      />

      <div className="stats-grid">
        <StatCard label="Admin users" value={adminCount} hint="Full suite admins" loading={loading} />
        <StatCard label="App access rows" value={enabledAccessCount} hint="Enabled access" loading={loading} />
        <StatCard label="Venues" value={settings?.venues.length ?? venueCount} hint="Configured or detected" loading={loading} />
        <StatCard label="Staff profiles" value={staff.length} hint="Shared authority" loading={loading} />
      </div>

      <div className="tips-entry-grid">
        <Card title="Organisation settings" subtitle="Production-safe basics shared across the suite">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
          >
            <Input label="Organisation name" value={draft.orgName} onChange={(event) => update('orgName', event.currentTarget.value)} />
            <div className="form-grid two">
              <Input label="Primary contact" value={draft.primaryContactName} onChange={(event) => update('primaryContactName', event.currentTarget.value)} />
              <Input label="Contact phone" value={draft.primaryContactPhone} onChange={(event) => update('primaryContactPhone', event.currentTarget.value)} />
              <Input label="Contact email" type="email" value={draft.primaryContactEmail} onChange={(event) => update('primaryContactEmail', event.currentTarget.value)} />
              <Input label="Notification email" type="email" value={draft.notifyEmail} onChange={(event) => update('notifyEmail', event.currentTarget.value)} />
            </div>
            {message ? <p className={message.includes('saved') ? 'subtle' : 'error-text'}>{message}</p> : null}
            <div className="toolbar-right">
              <Button type="submit" disabled={saving || !user?.isAdmin}>{saving ? 'Saving…' : 'Save settings'}</Button>
            </div>
          </form>
        </Card>

        <Card title="Venues" subtitle="Read from settings and staff records">
          <div className="staff-list">
            {venueNames.map((name) => {
              const members = staff.filter((member) => member.venue === name).length;
              return (
                <div key={name} className="staff-expiry-row">
                  <span>
                    <strong>{name}</strong>
                    <span className="subtle">{members} staff profiles linked</span>
                  </span>
                  <Badge tone="muted">Venue</Badge>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="Onboarding process" subtitle="Control what new staff complete before managers approve them.">
        <form
          className="staff-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings();
          }}
        >
          <div className="onboarding-settings-grid">
            {ONBOARDING_SETTING_ROWS.map((row) => {
              const step = draft.onboardingSettings[row.key];
              return (
                <div key={row.key} className="onboarding-setting-card">
                  <div className="onboarding-setting-header">
                    <span>
                      <strong>{row.title}</strong>
                      <span className="subtle">{row.help}</span>
                    </span>
                    <Badge tone={row.kind === 'Web form' ? 'positive' : 'muted'}>{row.kind}</Badge>
                  </div>
                  <div className="onboarding-toggle-row">
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={(event) => updateOnboardingStep(row.key, { enabled: event.currentTarget.checked })}
                      />
                      Enabled
                    </label>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={step.required}
                        disabled={!step.enabled}
                        onChange={(event) => updateOnboardingStep(row.key, { required: event.currentTarget.checked })}
                      />
                      Required
                    </label>
                  </div>
                  <Input
                    label="Display label"
                    value={step.label}
                    onChange={(event) => updateOnboardingStep(row.key, { label: event.currentTarget.value })}
                  />
                  <Textarea
                    label="Instructions"
                    rows={2}
                    value={step.description}
                    onChange={(event) => updateOnboardingStep(row.key, { description: event.currentTarget.value })}
                  />
                </div>
              );
            })}
          </div>
          <p className="subtle">
            Tax declaration and superannuation choice are web forms. Right-to-work documents and bank confirmation are upload options.
          </p>
          <div className="toolbar-right">
            <Button type="submit" disabled={saving || !user?.isAdmin}>{saving ? 'Saving…' : 'Save onboarding'}</Button>
          </div>
        </form>
      </Card>

      <Card title="App access matrix" subtitle="Manage access here or jump into the detailed access workflow." padding="none">
        <div className="staff-list" style={{ padding: 12 }}>
          {appRows.map(({ app, enabled, pending, disabled }) => (
            <div key={app.id} className="staff-expiry-row">
              <span>
                <strong>{app.label}</strong>
                <span className="subtle">{enabled} enabled · {pending} pending · {disabled} disabled</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (staff[0]) setSelectedId(selectedId || staff[0].id);
                  navigate('/access');
                }}
              >
                Manage
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

type TrainingModuleDraft = {
  title: string;
  category: string;
  level: string;
  estimatedMinutes: string;
  description: string;
};

type TrainingPayRuleDraft = {
  level: string;
  label: string;
  payRate: string;
  notes: string;
};

function TrainingPage({ staff, reloadStaff }: { staff: StaffProfile[]; reloadStaff: () => Promise<void> }) {
  const [overview, setOverview] = useState<TrainingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [moduleDraft, setModuleDraft] = useState<TrainingModuleDraft>({
    title: '',
    category: 'Venue standards',
    level: '1',
    estimatedMinutes: '30',
    description: ''
  });
  const [ruleDraft, setRuleDraft] = useState<TrainingPayRuleDraft>({
    level: '1',
    label: 'Level 1 trained',
    payRate: '',
    notes: ''
  });
  const [selectedStaffId, setSelectedStaffId] = useState(staff[0]?.id ?? '');
  const [selectedModuleId, setSelectedModuleId] = useState('');

  const modules = overview?.modules ?? [];
  const records = overview?.records ?? [];
  const payRules = overview?.payRules ?? [];
  const completedRecords = records.filter((record) => record.status === 'COMPLETED');
  const assignedRecords = records.filter((record) => record.status !== 'COMPLETED');
  const highestLevel = Math.max(0, ...staff.map((member) => member.trainingLevel ?? 0));

  const staffOptions = [
    { label: 'Select staff', value: '' },
    ...staff.map((member) => ({
      label: `${member.firstName} ${member.lastName}`,
      value: member.id
    }))
  ];
  const moduleOptions = [
    { label: 'Select module', value: '' },
    ...modules
      .filter((module) => module.status === 'ACTIVE')
      .map((module) => ({
        label: `L${module.level} · ${module.title}`,
        value: module.id
      }))
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setOverview(await api<TrainingOverview>('/api/training/overview'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load training');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedStaffId && staff[0]) setSelectedStaffId(staff[0].id);
  }, [selectedStaffId, staff]);

  useEffect(() => {
    if (!selectedModuleId && modules[0]) setSelectedModuleId(modules[0].id);
  }, [modules, selectedModuleId]);

  function updateModuleDraft<K extends keyof TrainingModuleDraft>(key: K, value: TrainingModuleDraft[K]) {
    setModuleDraft((current) => ({ ...current, [key]: value }));
  }

  function updateRuleDraft<K extends keyof TrainingPayRuleDraft>(key: K, value: TrainingPayRuleDraft[K]) {
    setRuleDraft((current) => ({ ...current, [key]: value }));
  }

  async function createModule() {
    if (!moduleDraft.title.trim()) {
      setMessage('Module title is required.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/modules', {
        method: 'POST',
        body: JSON.stringify({
          title: moduleDraft.title.trim(),
          category: moduleDraft.category.trim(),
          level: Number(moduleDraft.level) || 1,
          estimatedMinutes: Number(moduleDraft.estimatedMinutes) || undefined,
          description: moduleDraft.description.trim(),
          status: 'ACTIVE'
        })
      });
      setModuleDraft({ title: '', category: moduleDraft.category, level: moduleDraft.level, estimatedMinutes: '30', description: '' });
      setMessage('Training module created.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create module.');
    } finally {
      setSaving(false);
    }
  }

  async function savePayRule() {
    const payRate = Number(ruleDraft.payRate.replace(/[^0-9.]/g, ''));
    if (!ruleDraft.label.trim() || !Number.isFinite(payRate)) {
      setMessage('Pay rule needs a label and pay rate.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/pay-rules', {
        method: 'POST',
        body: JSON.stringify({
          level: Number(ruleDraft.level) || 1,
          label: ruleDraft.label.trim(),
          payRateCents: Math.round(payRate * 100),
          notes: ruleDraft.notes.trim()
        })
      });
      setMessage('Academy pay rule saved.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save pay rule.');
    } finally {
      setSaving(false);
    }
  }

  async function assignTraining() {
    if (!selectedStaffId || !selectedModuleId) {
      setMessage('Choose staff and a module before assigning Academy training.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/assignments', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: selectedStaffId,
          moduleId: selectedModuleId,
          notes: 'Assigned from Alma Academy board.'
        })
      });
      setMessage('Academy module assigned.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not assign training.');
    } finally {
      setSaving(false);
    }
  }

  async function updateTrainingRecord(record: StaffTrainingRecord, status: StaffTrainingRecord['status']) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/training/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString() : '',
          notes: record.notes ?? ''
        })
      });
      setMessage(status === 'COMPLETED' ? 'Academy module completed and pay level recalculated.' : 'Academy record updated.');
      await Promise.all([load(), reloadStaff()]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update training.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Academy"
        title="Academy levels tied to staff pay"
        description="Assign modules to staff profiles, complete Academy training, and automatically lift pay rates when a completed level has a pay rule."
      />

      <div className="stats-grid">
        <StatCard label="Modules" value={modules.length} hint="Academy catalogue" loading={loading} />
        <StatCard label="Assigned" value={assignedRecords.length} hint="Open Academy" loading={loading} />
        <StatCard label="Completed" value={completedRecords.length} hint="Finished modules" loading={loading} />
        <StatCard label="Top level" value={highestLevel} hint="Highest staff level" loading={loading} />
      </div>

      <div className="staff-board">
        <Card title="Create Academy module" subtitle="Keep these short and practical. Levels drive pay uplift rules.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createModule();
            }}
          >
            <Input label="Module title" required value={moduleDraft.title} onChange={(event) => updateModuleDraft('title', event.currentTarget.value)} />
            <div className="form-grid three">
              <Input label="Category" value={moduleDraft.category} onChange={(event) => updateModuleDraft('category', event.currentTarget.value)} />
              <Input label="Level" type="number" min="1" value={moduleDraft.level} onChange={(event) => updateModuleDraft('level', event.currentTarget.value)} />
              <Input label="Minutes" type="number" min="1" value={moduleDraft.estimatedMinutes} onChange={(event) => updateModuleDraft('estimatedMinutes', event.currentTarget.value)} />
            </div>
            <Textarea label="Description" rows={2} value={moduleDraft.description} onChange={(event) => updateModuleDraft('description', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create Academy module'}</Button>
            </div>
          </form>
        </Card>

        <Card title="Pay rules" subtitle="When a staff member completes this level, their pay rate lifts to this amount if it is higher.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void savePayRule();
            }}
          >
            <div className="form-grid three">
              <Input label="Level" type="number" min="1" value={ruleDraft.level} onChange={(event) => updateRuleDraft('level', event.currentTarget.value)} />
              <Input label="Label" value={ruleDraft.label} onChange={(event) => updateRuleDraft('label', event.currentTarget.value)} />
              <Input label="Pay rate" value={ruleDraft.payRate} onChange={(event) => updateRuleDraft('payRate', event.currentTarget.value)} placeholder="Example: 32.50" />
            </div>
            <Textarea label="Notes" rows={2} value={ruleDraft.notes} onChange={(event) => updateRuleDraft('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save pay rule'}</Button>
            </div>
          </form>
          <div className="app-access-grid">
            {payRules.map((rule) => (
              <div key={rule.id} className="app-access-tile">
                <strong>Level {rule.level}</strong>
                <span className="subtle">{rule.label}</span>
                <Badge tone="positive">{formatCents(rule.payRateCents)}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Assign Academy module" subtitle="Link a module directly to a staff profile.">
        <div className="form-grid three">
          <Select label="Staff" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.currentTarget.value)} options={staffOptions} />
          <Select label="Module" value={selectedModuleId} onChange={(event) => setSelectedModuleId(event.currentTarget.value)} options={moduleOptions} />
          <div className="field-action">
            <Button type="button" disabled={saving || modules.length === 0} onClick={() => void assignTraining()}>
              Assign module
            </Button>
          </div>
        </div>
        {message ? <p className={message.includes('Could') || message.includes('required') ? 'error-text' : 'subtle'}>{message}</p> : null}
      </Card>

      <Card title="Academy board" subtitle="Complete modules here. Completed levels update StaffProfile training level and pay.">
        {loading ? <Spinner label="Loading Academy…" /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState title="No Academy modules assigned" description="Create a module, add a pay rule, then assign Academy modules to staff." />
        ) : null}
        <div className="staff-list">
          {records.map((record) => (
            <div key={record.id} className="staff-expiry-row">
              <span>
                <strong>
                  {record.staffProfile?.firstName} {record.staffProfile?.lastName}
                </strong>
                <span className="subtle">
                  L{record.module?.level} · {record.module?.title} · {record.staffProfile?.venue || 'No venue'}
                </span>
                <span className="subtle">
                  Staff pay {formatCents(record.staffProfile?.payRateCents ?? null)} · Academy level {record.staffProfile?.trainingLevel ?? 0}
                </span>
              </span>
              <span className="invite-row-actions">
                <Badge tone={record.status === 'COMPLETED' ? 'positive' : record.status === 'EXPIRED' ? 'danger' : 'warning'}>{record.status}</Badge>
                {record.status !== 'COMPLETED' ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void updateTrainingRecord(record, 'IN_PROGRESS')}>
                      Start
                    </Button>
                    <Button type="button" size="sm" disabled={saving} onClick={() => void updateTrainingRecord(record, 'COMPLETED')}>
                      Complete
                    </Button>
                  </>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function RosterPage({
  staff,
  roster,
  reload
}: {
  staff: StaffProfile[];
  roster: RosterShift[];
  reload: (rosterStart?: Date, rosterEnd?: Date) => Promise<void>;
}) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [boardDays, setBoardDays] = useState<7 | 14>(7);
  const [viewMode, setViewMode] = useState<'team' | 'area'>('area');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RosterShift['status']>('all');
  const [staffProfileId, setStaffProfileId] = useState(staff[0]?.id ?? '');
  const [date, setDate] = useState(() => toDateInput(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('16:00');
  const [area, setArea] = useState('Floor');
  const [shiftVenue, setShiftVenue] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [venueFilter, setVenueFilter] = useState('all');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [shiftStatus, setShiftStatus] = useState<RosterShift['status']>('DRAFT');
  const [shiftNotes, setShiftNotes] = useState('');
  const [editingShift, setEditingShift] = useState<RosterShift | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null);
  const [shiftContextMenu, setShiftContextMenu] = useState<RosterShiftContextMenu | null>(null);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  const [forecastDraft] = useState(loadRosterForecastDraft);
  const [forecastSales, setForecastSales] = useState(forecastDraft.forecastSales);
  const [dailyForecastSales, setDailyForecastSales] = useState<Record<string, string>>(forecastDraft.dailyForecastSales);
  const [targetWagePercent, setTargetWagePercent] = useState(forecastDraft.targetWagePercent);
  const [closedDaysByScope, setClosedDaysByScope] = useState(loadRosterClosedDays);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const days = useMemo(() => weekDays(weekStart, boardDays), [boardDays, weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, boardDays), [boardDays, weekStart]);
  const closedScopeKey = `${toDateInput(weekStart)}:${boardDays}:${venueFilter}`;
  const closedDayKeys = useMemo(() => new Set(closedDaysByScope[closedScopeKey] ?? []), [closedDaysByScope, closedScopeKey]);
  const closedDayCount = closedDayKeys.size;
  const venues = useMemo(() => uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]), [staff]);
  const activeStaff = staff.filter((member) => member.employmentStatus !== 'ARCHIVED');
  const venueRoster = roster
    .filter((shift) => venueFilter === 'all' || shift.venue === venueFilter || shift.staffProfile?.venue === venueFilter)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const visibleRoster = venueRoster
    .filter((shift) => statusFilter === 'all' || shift.status === statusFilter)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const publishableDrafts = venueRoster.filter((shift) => shift.status === 'DRAFT');
  const draftCount = publishableDrafts.length;
  const rosteredStaffIds = new Set(visibleRoster.map((shift) => shift.staffProfileId));
  const totalHours = visibleRoster.reduce((sum, shift) => sum + shiftHours(shift), 0);
  const averageRateCents = useMemo(() => {
    const rates = activeStaff
      .map((member) => member.trainingPayRateCents ?? member.payRateCents ?? 0)
      .filter((rate) => rate > 0);
    return rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : 3200;
  }, [activeStaff]);
  const rosterCostCents = visibleRoster.reduce((sum, shift) => {
    const member = staff.find((item) => item.id === shift.staffProfileId);
    const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
    return sum + Math.round(shiftHours(shift) * rateCents);
  }, 0);
  const operationalVenues = venues.some((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    ? venues.filter((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    : venues;
  const forecastVenues = venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both');
  const historicalDailyForecast = days.reduce((map, day) => {
    const cents = Math.round(
      forecastVenues.reduce((sum, venue) => sum + historicalSalesForDate(venue, day), 0) * 100
    );
    map[toDateInput(day)] = cents;
    return map;
  }, {} as Record<string, number>);
  const historicalForecastSalesCents = Object.values(historicalDailyForecast).reduce((sum, cents) => sum + cents, 0);
  const forecastHasManualDailyInputs = days.some((day) => parseMoneyCents(dailyForecastSales[toDateInput(day)] ?? '') > 0);
  const dailyForecastTotalCents = days.reduce((sum, day) => {
    const key = toDateInput(day);
    const manualCents = parseMoneyCents(dailyForecastSales[key] ?? '');
    return sum + (manualCents || (!forecastHasManualDailyInputs ? historicalDailyForecast[key] ?? 0 : 0));
  }, 0);
  const forecastSalesCents = dailyForecastTotalCents || parseMoneyCents(forecastSales) || historicalForecastSalesCents;
  const wageBudgetCents = Math.round(forecastSalesCents * (parsePercent(targetWagePercent) / 100));
  const recommendedHours = averageRateCents > 0 ? wageBudgetCents / averageRateCents : 0;
  const forecastCostGapCents = wageBudgetCents - rosterCostCents;
  const forecastHoursGap = recommendedHours - totalHours;
  const missingRateStaff = activeStaff.filter((member) =>
    visibleRoster.some((shift) => shift.staffProfileId === member.id) &&
    !member.payRateCents &&
    !member.trainingPayRateCents
  );
  const publishedCount = visibleRoster.filter((shift) => shift.status === 'PUBLISHED').length;
  const dailySummaries = days.map((day) => {
    const shifts = visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), day));
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = staff.find((item) => item.id === shift.staffProfileId);
      const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
      return sum + Math.round(shiftHours(shift) * rateCents);
    }, 0);
    const dayKey = toDateInput(day);
    const manualCents = parseMoneyCents(dailyForecastSales[dayKey] ?? '');
    const forecastCents = manualCents || (!forecastHasManualDailyInputs ? historicalDailyForecast[dayKey] ?? 0 : 0);
    const budgetCents = Math.round(forecastCents * (parsePercent(targetWagePercent) / 100));
    return {
      day,
      shifts: shifts.length,
      hours: shifts.reduce((sum, shift) => sum + shiftHours(shift), 0),
      people: new Set(shifts.map((shift) => shift.staffProfileId)).size,
      forecastCents,
      plannedCostCents,
      budgetCents,
      wagePercent: forecastCents > 0 ? (plannedCostCents / forecastCents) * 100 : 0
    };
  });
  const activeAreas = uniqueValues([
    'Floor',
    'Bar',
    'Kitchen',
    'Management',
    'Events',
    'Training',
    ...visibleRoster.map((shift) => shift.area || 'Shift')
  ]);
  const areaVenues = uniqueValues([
    ...(venueFilter === 'all' ? operationalVenues : [venueFilter]),
    ...visibleRoster.map((shift) => shift.venue || shift.staffProfile?.venue || '').filter(Boolean)
  ]).filter((venue) => venue && venue !== 'all' && venue !== 'Both');
  const splitAreaRows = areaVenues.flatMap((venue) =>
    activeAreas.map((areaName) => {
      const shifts = visibleRoster.filter((shift) =>
        (shift.area || 'Shift') === areaName &&
        (shift.venue === venue || shift.staffProfile?.venue === venue)
      );
      return {
        id: `${venue}:${areaName}`,
        label: areaName,
        sublabel: `${venue} · ${shifts.length} shifts`,
        initials: areaName.slice(0, 2).toUpperCase(),
        shifts,
        member: null,
        venue,
        area: areaName
      };
    })
  );
  const venueForecastRows = forecastVenues.map((venue) => {
    const shifts = visibleRoster.filter((shift) => shift.venue === venue || shift.staffProfile?.venue === venue);
    const plannedHours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = staff.find((item) => item.id === shift.staffProfileId);
      const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
      return sum + Math.round(shiftHours(shift) * rateCents);
    }, 0);
    const historicalSalesCents = Math.round(days.reduce((sum, day) => sum + historicalSalesForDate(venue, day), 0) * 100);
    const dayKeys = days.map((day) => toDateInput(day));
    const manualDailyCents = dayKeys.reduce((sum, key) => sum + parseMoneyCents(dailyForecastSales[key] ?? ''), 0);
    const selectedSalesCents =
      venueFilter === 'all'
        ? historicalSalesCents
        : manualDailyCents || parseMoneyCents(forecastSales) || historicalSalesCents;
    const budgetCents = Math.round(selectedSalesCents * (parsePercent(targetWagePercent) / 100));
    const recommended = averageRateCents > 0 ? budgetCents / averageRateCents : 0;
    return {
      venue,
      source: normaliseHistoricalVenue(venue),
      salesCents: selectedSalesCents,
      historicalSalesCents,
      budgetCents,
      plannedCostCents,
      plannedHours,
      recommendedHours: recommended,
      costGapCents: budgetCents - plannedCostCents,
      hoursGap: recommended - plannedHours
    };
  });
  const publishWarnings = [
    ...(forecastSalesCents > 0 && forecastCostGapCents < 0
      ? [`Roster is ${formatCents(Math.abs(forecastCostGapCents))} over the forecast wage budget.`]
      : []),
    ...(missingRateStaff.length
      ? [`${missingRateStaff.length} rostered staff member${missingRateStaff.length === 1 ? '' : 's'} missing pay rates.`]
      : []),
    ...(visibleRoster.some((shift) => isUnallocatedProfile(shift.staffProfile))
      ? [`${visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length} unallocated shift${visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length === 1 ? '' : 's'} still need a real staff member.`]
      : []),
    ...(visibleRoster.some((shift) => !shift.venue && !shift.staffProfile?.venue)
      ? [`${visibleRoster.filter((shift) => !shift.venue && !shift.staffProfile?.venue).length} shift${visibleRoster.filter((shift) => !shift.venue && !shift.staffProfile?.venue).length === 1 ? '' : 's'} missing a venue.`]
      : []),
    ...(countRosterOverlaps(visibleRoster) > 0
      ? [`${countRosterOverlaps(visibleRoster)} overlapping shift conflict${countRosterOverlaps(visibleRoster) === 1 ? '' : 's'} found.`]
      : [])
  ];
  const areaGuidanceRows = areaVenues.flatMap((venue) => activeAreas.map((areaName) => {
    const shifts = visibleRoster.filter((shift) =>
      (shift.area || 'Shift') === areaName &&
      (shift.venue === venue || shift.staffProfile?.venue === venue)
    );
    const hours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const venueForecast = venueForecastRows.find((row) => row.venue === venue);
    const venueHours = visibleRoster
      .filter((shift) => shift.venue === venue || shift.staffProfile?.venue === venue)
      .reduce((sum, shift) => sum + shiftHours(shift), 0);
    const recommended = venueForecast && venueHours > 0 ? venueForecast.recommendedHours * (hours / venueHours) : 0;
    const bestDay = dailySummaries
      .map((summary) => {
        const areaHours = visibleRoster
          .filter((shift) =>
            (shift.area || 'Shift') === areaName &&
            (shift.venue === venue || shift.staffProfile?.venue === venue) &&
            sameDay(new Date(shift.startsAt), summary.day)
          )
          .reduce((sum, shift) => sum + shiftHours(shift), 0);
        const dayRecommended =
          summary.forecastCents > 0 && averageRateCents > 0
            ? summary.budgetCents / averageRateCents
            : summary.hours;
        const dayAreaRecommended = summary.hours > 0 ? dayRecommended * (areaHours / summary.hours) : 0;
        return {
          day: summary.day,
          gap: dayAreaRecommended - areaHours
        };
      })
      .sort((a, b) => b.gap - a.gap)[0];
    return {
      area: areaName,
      venue,
      plannedHours: hours,
      recommendedHours: recommended,
      gap: recommended - hours,
      day: bestDay?.day ?? days[0] ?? weekStart,
      dayGap: bestDay?.gap ?? 0
    };
  })).filter((row) => row.plannedHours > 0 || row.recommendedHours > 0);
  const selectedMember = staff.find((item) => item.id === staffProfileId);
  const selectedShiftHours = shiftTimeRange(date, startTime, endTime);
  const shiftConflicts = useMemo(() => {
    if (!selectedShiftHours || !staffProfileId) return [];
    return roster.filter((shift) => {
      if (shift.id === editingShift?.id) return false;
      if (shift.staffProfileId !== staffProfileId) return false;
      if (shift.status === 'CANCELLED') return false;
      return rangesOverlap(
        selectedShiftHours.startsAt,
        selectedShiftHours.endsAt,
        new Date(shift.startsAt),
        new Date(shift.endsAt)
      );
    });
  }, [editingShift?.id, roster, selectedShiftHours, staffProfileId]);
  const canSaveShift = Boolean(staffProfileId && date && startTime && endTime && selectedShiftHours);
  const rowSearch = search.trim().toLowerCase();
  const scheduleRows =
    viewMode === 'team'
      ? activeStaff
          .filter((member) =>
            `${member.firstName} ${member.lastName} ${member.roleTitle} ${member.venue ?? ''}`
              .toLowerCase()
              .includes(rowSearch)
          )
          .map((member) => ({
            id: member.id,
            label: `${member.firstName} ${member.lastName}`,
            sublabel: `${member.roleTitle || 'Team member'} · ${member.venue || 'No venue'}`,
            initials: initials(member),
            shifts: visibleRoster.filter((shift) => shift.staffProfileId === member.id),
            member,
            venue: member.venue ?? '',
            area: ''
          }))
      : splitAreaRows.filter((row) =>
          `${row.venue} ${row.label} ${row.sublabel}`.toLowerCase().includes(rowSearch)
        );
  const scheduleGridStyle = useMemo<CSSProperties>(() => {
    const labelColumn = editorOpen ? 'minmax(136px, 0.78fr)' : 'minmax(150px, 0.72fr)';
    const openColumn =
      boardDays === 14
        ? editorOpen
          ? 'minmax(82px, 1fr)'
          : 'minmax(96px, 1fr)'
        : editorOpen
          ? 'minmax(112px, 1fr)'
          : 'minmax(132px, 1fr)';
    const closedColumn = boardDays === 14 ? 'minmax(38px, 0.18fr)' : 'minmax(46px, 0.22fr)';
    return {
      gridTemplateColumns: [
        labelColumn,
        ...days.map((day) => (closedDayKeys.has(toDateInput(day)) ? closedColumn : openColumn))
      ].join(' ')
    };
  }, [boardDays, closedDayKeys, days, editorOpen]);

  useEffect(() => {
    if (!staffProfileId && activeStaff[0]) setStaffProfileId(activeStaff[0].id);
  }, [activeStaff, staffProfileId]);

  useEffect(() => {
    void reload(weekStart, weekEnd);
  }, [reload, weekEnd, weekStart]);

  useEffect(() => {
    window.localStorage.setItem(
      ROSTER_FORECAST_STORAGE_KEY,
      JSON.stringify({ forecastSales, targetWagePercent, dailyForecastSales })
    );
  }, [dailyForecastSales, forecastSales, targetWagePercent]);

  useEffect(() => {
    window.localStorage.setItem(ROSTER_CLOSED_DAYS_STORAGE_KEY, JSON.stringify(closedDaysByScope));
  }, [closedDaysByScope]);

  useEffect(() => {
    if (!shiftContextMenu) return undefined;
    const close = () => setShiftContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [shiftContextMenu]);

  function setRosterWeek(nextWeekStart: Date) {
    setWeekStart(nextWeekStart);
    const selectedDate = new Date(`${date}T00:00:00`);
    if (!isDateInRange(selectedDate, nextWeekStart, addDays(nextWeekStart, boardDays))) {
      setDate(toDateInput(nextWeekStart));
    }
  }

  function newShift() {
    setEditingShift(null);
    setEditorOpen(true);
    setDate((current) => {
      const selectedDate = new Date(`${current}T00:00:00`);
      return isDateInRange(selectedDate, weekStart, weekEnd) ? current : toDateInput(weekStart);
    });
    setStaffProfileId((current) => current || activeStaff[0]?.id || '');
    setArea(area || 'Floor');
    setShiftVenue(venueFilter === 'all' ? selectedMember?.venue ?? activeStaff[0]?.venue ?? '' : venueFilter);
    setRoleTitle(selectedMember?.roleTitle ?? activeStaff[0]?.roleTitle ?? '');
    setShiftStatus('DRAFT');
    setShiftNotes('');
    setMessage(null);
  }

  function updateDailyForecast(day: Date, value: string) {
    const key = toDateInput(day);
    setDailyForecastSales((current) => ({ ...current, [key]: value }));
  }

  function applyHistoricalForecast() {
    const nextDailyForecast = days.reduce((draft, day) => {
      const cents = Math.round(
        forecastVenues.reduce((sum, venue) => sum + historicalSalesForDate(venue, day), 0) * 100
      );
      draft[toDateInput(day)] = cents > 0 ? String(Math.round(cents / 100)) : '';
      return draft;
    }, {} as Record<string, string>);
    const totalCents = Object.values(nextDailyForecast).reduce((sum, value) => sum + parseMoneyCents(value), 0);
    setDailyForecastSales(nextDailyForecast);
    setForecastSales(totalCents > 0 ? String(Math.round(totalCents / 100)) : '');
    setMessage('Historical sales forecast applied to this roster view.');
  }

  function toggleClosedDay(day: Date) {
    const key = toDateInput(day);
    setClosedDaysByScope((current) => {
      const existing = new Set(current[closedScopeKey] ?? []);
      if (existing.has(key)) {
        existing.delete(key);
      } else {
        existing.add(key);
      }
      return {
        ...current,
        [closedScopeKey]: Array.from(existing).sort()
      };
    });
  }

  useEffect(() => {
    if (!editingShift) {
      const member = staff.find((item) => item.id === staffProfileId);
      if (member?.roleTitle && !roleTitle) setRoleTitle(member.roleTitle);
      if (member?.venue && !shiftVenue) setShiftVenue(member.venue);
    }
  }, [editingShift, roleTitle, shiftVenue, staff, staffProfileId]);

  async function saveShift() {
    const effectiveStaffProfileId = staffProfileId || activeStaff[0]?.id || '';
    if (!effectiveStaffProfileId) {
      setMessage('Choose a team member before adding the shift.');
      return;
    }
    const range = shiftTimeRange(date, startTime, endTime);
    if (!range) {
      setMessage('Check the shift date and times.');
      return;
    }
    if (
      shiftConflicts.length > 0 &&
      !window.confirm(
        `${selectedMember?.firstName ?? 'This team member'} already has ${shiftConflicts.length} overlapping shift${shiftConflicts.length === 1 ? '' : 's'}. Save anyway?`
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const member = staff.find((item) => item.id === effectiveStaffProfileId);
      await api(editingShift ? `/api/staff/roster/${editingShift.id}` : '/api/staff/roster', {
        method: editingShift ? 'PATCH' : 'POST',
        body: JSON.stringify({
          staffProfileId: effectiveStaffProfileId,
          venue: shiftVenue || member?.venue || '',
          area: area || 'Floor',
          roleTitle: roleTitle || member?.roleTitle || '',
          startsAt: range.startsAt.toISOString(),
          endsAt: range.endsAt.toISOString(),
          breakMinutes: Number(breakMinutes) || 0,
          status: shiftStatus,
          notes: shiftNotes.trim()
        })
      });
      await reload(weekStart, weekEnd);
      setMessage(editingShift ? 'Shift updated.' : 'Shift added to the draft roster.');
      setEditingShift(null);
      setEditorOpen(false);
      setRoleTitle('');
      setShiftNotes('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save shift.');
    } finally {
      setSaving(false);
    }
  }

  function startEditShift(shift: RosterShift) {
    setShiftContextMenu(null);
    setEditingShift(shift);
    setEditorOpen(true);
    setStaffProfileId(shift.staffProfileId);
    setShiftVenue(shift.venue ?? shift.staffProfile?.venue ?? '');
    setDate(toDateInput(new Date(shift.startsAt)));
    setStartTime(toTimeInput(new Date(shift.startsAt)));
    setEndTime(toTimeInput(new Date(shift.endsAt)));
    setArea(shift.area ?? 'Floor');
    setRoleTitle(shift.roleTitle ?? shift.staffProfile?.roleTitle ?? '');
    setBreakMinutes(String(shift.breakMinutes));
    setShiftStatus(shift.status);
    setShiftNotes(shift.notes ?? '');
    setMessage(null);
  }

  async function deleteShift(shift: RosterShift) {
    setShiftContextMenu(null);
    if (!window.confirm('Delete this roster shift? This cannot be undone.')) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/roster/${shift.id}`, { method: 'DELETE' });
      await reload(weekStart, weekEnd);
      if (editingShift?.id === shift.id) {
        setEditingShift(null);
        setEditorOpen(false);
      }
      setMessage('Shift deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete shift.');
    } finally {
      setSaving(false);
    }
  }

  async function publishWeek() {
    if (
      publishWarnings.length > 0 &&
      !window.confirm(`Publish roster with these warnings?\n\n${publishWarnings.map((warning) => `- ${warning}`).join('\n')}`)
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/roster/publish', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue: venueFilter === 'all' ? '' : venueFilter,
          forecast: {
            source: forecastHasManualDailyInputs || forecastSales ? 'manager_override' : 'historical_sales',
            targetWagePercent: parsePercent(targetWagePercent),
            forecastSalesCents,
            wageBudgetCents,
            rosterCostCents,
            plannedHours: totalHours,
            recommendedHours,
            dailySalesCents: days.reduce((draft, day) => {
              const key = toDateInput(day);
              draft[key] = dailySummaries.find((summary) => sameDay(summary.day, day))?.forecastCents ?? 0;
              return draft;
            }, {} as Record<string, number>),
            venueBreakdown: venueForecastRows,
            areaBreakdown: areaGuidanceRows.map((row) => ({
              venue: row.venue,
              area: row.area,
              plannedHours: row.plannedHours,
              recommendedHours: row.recommendedHours,
              gap: row.gap,
              day: row.day.toISOString(),
              dayGap: row.dayGap
            }))
          }
        })
      });
      await reload(weekStart, weekEnd);
      setPublishPreviewOpen(false);
      setMessage('Draft roster published.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not publish roster.');
    } finally {
      setSaving(false);
    }
  }

  async function duplicateShiftFromShift(shift: RosterShift) {
    setShiftContextMenu(null);
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/roster', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: shift.staffProfileId,
          venue: shift.venue ?? shift.staffProfile?.venue ?? '',
          area: shift.area ?? '',
          roleTitle: shift.roleTitle ?? '',
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          breakMinutes: shift.breakMinutes,
          status: 'DRAFT',
          notes: shift.notes ?? ''
        })
      });
      await reload(weekStart, weekEnd);
      setMessage('Shift copied as a draft.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not copy shift.');
    } finally {
      setSaving(false);
    }
  }

  async function duplicateShift() {
    if (!editingShift) return;
    await duplicateShiftFromShift(editingShift);
  }

  function openShiftContextMenu(event: MouseEvent<HTMLElement>, shift: RosterShift) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 188;
    const menuHeight = 116;
    setShiftContextMenu({
      shift,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 12)
    });
  }

  async function copyPreviousWeek() {
    setSaving(true);
    setMessage(null);
    try {
      const previousStart = addDays(weekStart, -7);
      const previousEnd = addDays(previousStart, boardDays);
      const payload = await api<RosterShift[]>(
        `/api/staff/roster?start=${encodeURIComponent(previousStart.toISOString())}&end=${encodeURIComponent(previousEnd.toISOString())}`
      );
      const existingKeys = new Set(
        roster.map((shift) => `${shift.staffProfileId}:${toDateInput(new Date(shift.startsAt))}:${toTimeInput(new Date(shift.startsAt))}`)
      );
      const shiftsToCopy = payload
        .filter((shift) => activeStaff.some((member) => member.id === shift.staffProfileId))
        .filter((shift) => {
          const startsAt = addDays(new Date(shift.startsAt), 7);
          const key = `${shift.staffProfileId}:${toDateInput(startsAt)}:${toTimeInput(startsAt)}`;
          return !existingKeys.has(key);
        });
      await Promise.all(
        shiftsToCopy.map((shift) => {
          const startsAt = addDays(new Date(shift.startsAt), 7);
          const endsAt = addDays(new Date(shift.endsAt), 7);
          return api('/api/staff/roster', {
            method: 'POST',
            body: JSON.stringify({
              staffProfileId: shift.staffProfileId,
              venue: shift.venue ?? shift.staffProfile?.venue ?? '',
              area: shift.area ?? '',
              roleTitle: shift.roleTitle ?? '',
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              breakMinutes: shift.breakMinutes,
              status: 'DRAFT',
              notes: shift.notes ?? ''
            })
          });
        })
      );
      await reload(weekStart, weekEnd);
      setMessage(shiftsToCopy.length ? `Copied ${shiftsToCopy.length} shifts from last week.` : 'No uncopied shifts found last week.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not copy last week.');
    } finally {
      setSaving(false);
    }
  }

  function prefillCell(row: (typeof scheduleRows)[number], day: Date) {
    if (closedDayKeys.has(toDateInput(day))) {
      setMessage('This day is marked closed. Re-open the day before adding shifts.');
      return;
    }
    setEditingShift(null);
    setEditorOpen(true);
    setDate(toDateInput(day));
    if (viewMode === 'team' && row.member) {
      setStaffProfileId(row.member.id);
      setShiftVenue(row.member.venue ?? '');
      setArea(area || 'Floor');
      setRoleTitle(row.member.roleTitle || '');
    } else {
      const memberForVenue =
        activeStaff.find((member) => member.id === staffProfileId && (!row.venue || member.venue === row.venue)) ??
        activeStaff.find((member) => member.venue === row.venue) ??
        activeStaff[0];
      setArea(row.area || row.label);
      setShiftVenue(row.venue || memberForVenue?.venue || '');
      setStaffProfileId(memberForVenue?.id ?? '');
      setRoleTitle(memberForVenue?.roleTitle ?? '');
    }
    setMessage('Shift details ready. Set the time and add shift.');
    setShiftStatus('DRAFT');
    setShiftNotes('');
  }

  function applyRosterRecommendation(row: { area: string; venue: string; gap: number; day?: Date; dayGap?: number }) {
    const dayGap = dailySummaries
      .map((summary) => ({
        day: summary.day,
        gap:
          summary.forecastCents > 0 && averageRateCents > 0
            ? summary.budgetCents / averageRateCents - summary.hours
            : 0
      }))
      .sort((a, b) => b.gap - a.gap)[0];
    const targetDay = row.day ?? (dayGap && dayGap.gap > 0 ? dayGap.day : days[0] ?? weekStart);
    const targetVenue = row.venue || (venueFilter === 'all' ? operationalVenues[0] ?? '' : venueFilter);
    const member =
      activeStaff.find((item) => item.venue === targetVenue && !isUnallocatedProfile(item)) ??
      activeStaff.find((item) => !isUnallocatedProfile(item)) ??
      activeStaff[0];
    const recommendedLength = Math.max(2, Math.min(5, Math.round(Math.abs(row.gap) * 2) / 2 || 4));
    const start = row.area.toLowerCase().includes('kitchen') ? '10:00' : '16:00';
    const endHour = Number(start.slice(0, 2)) + recommendedLength;

    setEditingShift(null);
    setEditorOpen(true);
    setDate(toDateInput(targetDay));
    setStartTime(start);
    setEndTime(`${String(Math.floor(endHour) % 24).padStart(2, '0')}:${endHour % 1 ? '30' : '00'}`);
    setArea(row.area);
    setShiftVenue(targetVenue);
    setStaffProfileId(member?.id ?? '');
    setRoleTitle(member?.roleTitle ?? row.area);
    setShiftStatus('DRAFT');
    setShiftNotes(`Recommended from forecast: ${row.gap > 0 ? 'add' : 'review'} ${Math.abs(row.gap).toFixed(1)}h for ${row.area}.`);
    setMessage('Recommendation loaded in the shift editor. Review and save it as a draft shift.');
  }

  async function moveShiftToCell(shift: RosterShift, row: (typeof scheduleRows)[number], day: Date) {
    if (closedDayKeys.has(toDateInput(day))) {
      setMessage('This day is marked closed. Re-open the day before moving shifts here.');
      setDraggingShiftId(null);
      return;
    }
    const startsAt = moveDateKeepingTime(shift.startsAt, day);
    const endsAt = moveDateKeepingTime(shift.endsAt, day);
    const targetMember =
      viewMode === 'team' && row.member
        ? row.member
        : staff.find((member) => member.id === shift.staffProfileId);
    const targetArea = viewMode === 'area' ? row.area || row.label : shift.area ?? area;
    const targetVenue = viewMode === 'area' ? row.venue : targetMember?.venue ?? shift.venue ?? '';
    const movedEndsAt =
      endsAt <= startsAt ? addDays(endsAt, 1) : endsAt;

    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/roster/${shift.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          staffProfileId: targetMember?.id ?? shift.staffProfileId,
          venue: targetVenue,
          area: targetArea,
          roleTitle: shift.roleTitle ?? targetMember?.roleTitle ?? '',
          startsAt: startsAt.toISOString(),
          endsAt: movedEndsAt.toISOString(),
          breakMinutes: shift.breakMinutes,
          status: shift.status,
          notes: shift.notes ?? ''
        })
      });
      await reload(weekStart, weekEnd);
      setMessage(`Moved shift to ${row.label} on ${day.toLocaleDateString(undefined, { weekday: 'short' })}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not move shift.');
    } finally {
      setSaving(false);
      setDraggingShiftId(null);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, shift: RosterShift) {
    event.dataTransfer.setData('text/plain', shift.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingShiftId(shift.id);
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>, row: (typeof scheduleRows)[number], day: Date) {
    event.preventDefault();
    const shiftId = event.dataTransfer.getData('text/plain');
    const shift = roster.find((item) => item.id === shiftId);
    if (!shift) return;
    await moveShiftToCell(shift, row, day);
  }

  return (
    <div className="page-stack">
      <div className="deputy-roster-header">
        <div>
          <p className="eyebrow">Schedule</p>
          <h1>Weekly roster</h1>
          <p className="subtle">Build, copy, edit and publish the week from one grid.</p>
        </div>
        <div className="deputy-roster-actions">
          <Button type="button" variant="secondary" size="sm" onClick={newShift}>
            Add shift
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void copyPreviousWeek()}>
            Copy last week
          </Button>
          <Button type="button" variant="secondary" size="sm" disabled={draftCount === 0} onClick={() => setPublishPreviewOpen((open) => !open)}>
            Review drafts
          </Button>
          <Button type="button" size="sm" disabled={saving || draftCount === 0} onClick={() => setPublishPreviewOpen(true)}>
            Publish preview
          </Button>
        </div>
      </div>

      <div className="deputy-roster-commandbar">
        <div className="roster-week-controls" aria-label="Roster week controls">
          <Button type="button" variant="secondary" size="sm" onClick={() => setRosterWeek(addDays(weekStart, -7))}>
            Prev
          </Button>
          <div className="roster-week-label">
            <strong>{formatRange(weekStart, addDays(weekStart, 13))}</strong>
            <span>{draftCount} draft · {roundHours(totalHours)}</span>
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setRosterWeek(addDays(weekStart, 7))}>
            Next
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const today = new Date();
              setWeekStart(startOfWeek(today));
              setDate(toDateInput(today));
            }}
          >
            Today
          </Button>
        </div>

        <div className="deputy-view-toggle" aria-label="Schedule view">
          <button type="button" className={viewMode === 'team' ? 'is-active' : ''} onClick={() => setViewMode('team')}>
            Team member
          </button>
          <button type="button" className={viewMode === 'area' ? 'is-active' : ''} onClick={() => setViewMode('area')}>
            Area
          </button>
        </div>

        <div className="deputy-view-toggle" aria-label="Roster range">
          <button type="button" className={boardDays === 7 ? 'is-active' : ''} onClick={() => setBoardDays(7)}>
            Week
          </button>
          <button type="button" className={boardDays === 14 ? 'is-active' : ''} onClick={() => setBoardDays(14)}>
            2 weeks
          </button>
        </div>

        <Input label="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search team or area" />
        <Select
          label="Venue"
          value={venueFilter}
          onChange={(event) => setVenueFilter(event.currentTarget.value)}
          options={[{ label: 'All venues', value: 'all' }, ...venues.map((venue) => ({ label: venue, value: venue }))]}
        />
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
          options={[
            { label: 'All statuses', value: 'all' },
            { label: 'Draft', value: 'DRAFT' },
            { label: 'Published', value: 'PUBLISHED' },
            { label: 'Completed', value: 'COMPLETED' },
            { label: 'Cancelled', value: 'CANCELLED' }
          ]}
        />
      </div>

      <div className="deputy-roster-summary">
        <span><strong>{rosteredStaffIds.size}</strong> rostered</span>
        <span><strong>{draftCount}</strong> draft</span>
        <span><strong>{publishedCount}</strong> published</span>
        <span><strong>{roundHours(totalHours)}</strong> roster hours</span>
        <span><strong>{closedDayCount}</strong> closed</span>
        <span><strong>{visibleRoster.filter(isDeputyImportedShift).length}</strong> Deputy import</span>
        <span><strong>{visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length}</strong> unallocated</span>
        {message ? <span className="deputy-roster-message">{message}</span> : null}
      </div>

      <div className="roster-closed-days" aria-label="Weekly closed days">
        <strong>Closed days</strong>
        {days.map((day) => {
          const key = toDateInput(day);
          const isClosed = closedDayKeys.has(key);
          return (
            <button
              key={key}
              type="button"
              className={isClosed ? 'is-closed' : ''}
              onClick={() => toggleClosedDay(day)}
              aria-pressed={isClosed}
            >
              <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <small>{isClosed ? 'Closed' : 'Open'}</small>
            </button>
          );
        })}
      </div>

      {publishPreviewOpen ? (
        <div className="roster-publish-grid">
          <Card
            title="Publish preview"
            subtitle="Draft shifts that will be published for this week and venue filter"
            action={
              <Button type="button" size="sm" disabled={saving || draftCount === 0} onClick={() => void publishWeek()}>
                Publish {draftCount} shifts
              </Button>
            }
          >
            {publishableDrafts.length === 0 ? (
              <EmptyState title="No draft shifts" description="There are no draft shifts ready to publish for the current week." />
            ) : (
              <div className="publish-preview-list">
                {publishableDrafts.map((shift) => (
                  <button key={shift.id} type="button" className="publish-preview-row" onClick={() => startEditShift(shift)}>
                    <span>
                      <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                      <small>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || 'Shift'}</small>
                    </span>
                    <span>
                      <strong>{shift.staffProfile?.firstName} {shift.staffProfile?.lastName}</strong>
                      <small>{shift.venue || shift.staffProfile?.venue || 'No venue'}</small>
                    </span>
                    <Badge tone="warning">Draft</Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <Card
            title="Forecast guidance"
            subtitle={`${venueFilter === 'all' ? 'All venues' : venueFilter} · ${formatRange(weekStart, addDays(weekEnd, -1))}`}
            action={
              <Button type="button" size="sm" variant="secondary" disabled={historicalForecastSalesCents <= 0} onClick={applyHistoricalForecast}>
                Use historical
              </Button>
            }
          >
            <div className="form-grid two">
              <Input label="Weekly sales override" value={forecastSales} onChange={(event) => setForecastSales(event.currentTarget.value)} placeholder={historicalForecastSalesCents > 0 ? String(Math.round(historicalForecastSalesCents / 100)) : '32000'} />
              <Input label="Target wage %" value={targetWagePercent} onChange={(event) => setTargetWagePercent(event.currentTarget.value)} placeholder="32" />
            </div>
            <p className="subtle roster-forecast-source">
              Baseline: {historicalForecastSalesCents > 0 ? `${formatCents(historicalForecastSalesCents)} from previous-year sales` : 'No historical match for this venue'}.
              {forecastHasManualDailyInputs ? ' Daily overrides are active.' : ' Daily sales are currently using the historical baseline.'}
            </p>
            <div className="roster-daily-forecast">
              {days.map((day) => {
                const summary = dailySummaries.find((item) => sameDay(item.day, day));
                const dayKey = toDateInput(day);
                return (
                  <label key={dayKey} className={summary?.forecastCents ? summary.wagePercent > parsePercent(targetWagePercent) ? 'is-over' : 'is-under' : ''}>
                    <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                    <input
                      value={dailyForecastSales[dayKey] ?? ''}
                      onChange={(event) => updateDailyForecast(day, event.currentTarget.value)}
                      placeholder={historicalDailyForecast[dayKey] ? String(Math.round(historicalDailyForecast[dayKey] / 100)) : '$ sales'}
                    />
                    <small>{summary?.forecastCents ? `${summary.wagePercent.toFixed(1)}% wages` : `${roundHours(summary?.hours ?? 0)} planned`}</small>
                  </label>
                );
              })}
            </div>
            <div className="roster-venue-forecast">
              {venueForecastRows.map((row) => (
                <div key={row.venue}>
                  <span>
                    <strong>{row.venue}</strong>
                    <small>{row.source ? `${row.source} historical baseline` : 'No historical source'}</small>
                  </span>
                  <span>
                    <small>Sales</small>
                    <strong>{formatCents(row.salesCents)}</strong>
                  </span>
                  <span>
                    <small>Wage budget</small>
                    <strong>{formatCents(row.budgetCents)}</strong>
                  </span>
                  <Badge tone={row.costGapCents >= 0 ? 'positive' : 'warning'}>
                    {row.costGapCents >= 0 ? `${formatCents(row.costGapCents)} under` : `${formatCents(Math.abs(row.costGapCents))} over`}
                  </Badge>
                </div>
              ))}
            </div>
            <div className="roster-forecast-metrics">
              <div>
                <span>Wage budget</span>
                <strong>{formatCents(wageBudgetCents)}</strong>
              </div>
              <div>
                <span>Roster cost</span>
                <strong>{formatCents(rosterCostCents)}</strong>
              </div>
              <div>
                <span>Recommended</span>
                <strong>{roundHours(recommendedHours)}</strong>
              </div>
              <div>
                <span>Planned</span>
                <strong>{roundHours(totalHours)}</strong>
              </div>
            </div>
            <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : 'is-over'}`}>
              <strong>{forecastCostGapCents >= 0 ? 'Under forecast' : 'Over forecast'}</strong>
              <span>
                {formatCents(Math.abs(forecastCostGapCents))} {forecastCostGapCents >= 0 ? 'under budget' : 'over budget'} · {Math.abs(forecastHoursGap).toFixed(1)}h {forecastHoursGap >= 0 ? 'available' : 'over recommended'}
              </span>
            </div>
            {missingRateStaff.length ? (
              <div className="roster-forecast-callout is-over">
                <strong>{missingRateStaff.length} rostered staff missing pay rates</strong>
                <span>{missingRateStaff.slice(0, 4).map((member) => `${member.firstName} ${member.lastName}`).join(', ')}{missingRateStaff.length > 4 ? '...' : ''}</span>
              </div>
            ) : null}
            {publishWarnings.length ? (
              <div className="roster-publish-guardrails">
                <strong>Publish guardrails</strong>
                {publishWarnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : (
              <div className="roster-publish-guardrails is-clear">
                <strong>Publish guardrails</strong>
                <span>No forecast, rate, venue or overlap warnings for this view.</span>
              </div>
            )}
            <div className="roster-area-guidance">
              <strong>Area guidance</strong>
              {areaGuidanceRows.map((row) => (
                <div key={`${row.venue}:${row.area}`}>
                  <span>{row.area}</span>
                  <small>
                    {row.day.toLocaleDateString(undefined, { weekday: 'short' })} · {row.venue || 'Any venue'} · {roundHours(row.plannedHours)} planned · {roundHours(row.recommendedHours)} rec
                  </small>
                  <span className="roster-area-actions">
                    <Badge tone={row.dayGap >= 0 ? 'positive' : 'warning'}>{row.dayGap >= 0 ? '+' : ''}{row.dayGap.toFixed(1)}h</Badge>
                    <Button type="button" size="sm" variant="secondary" onClick={() => applyRosterRecommendation(row)}>
                      Apply
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      <div className="deputy-day-summary-strip">
        {dailySummaries.map((summary) => (
          <div key={summary.day.toISOString()} className={sameDay(summary.day, new Date()) ? 'is-today' : ''}>
            <strong>{summary.day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
            <span>{summary.shifts} shifts</span>
            <span>{summary.people} people</span>
            <small>{roundHours(summary.hours)}</small>
          </div>
        ))}
      </div>

      <div className="deputy-area-legend" aria-label="Roster section colours">
        {activeAreas.map((item) => (
          <span key={item} style={areaStyle(item)}>
            <i aria-hidden="true" />
            {item}
          </span>
        ))}
      </div>

      <div className={`deputy-roster-layout ${editorOpen ? 'is-editor-open' : 'is-editor-closed'}`}>
        <section className="deputy-schedule-panel" aria-label="Weekly roster grid">
          <div className={`deputy-schedule-grid roster-days-${boardDays}`} style={scheduleGridStyle}>
            <div className="deputy-schedule-corner">
              <span>{viewMode === 'team' ? 'Team member' : 'Area'}</span>
            </div>
            {days.map((day) => {
              const shifts = visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), day));
              const hours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
              const isClosed = closedDayKeys.has(toDateInput(day));
              return (
                <div key={day.toISOString()} className={`deputy-day-head ${sameDay(day, new Date()) ? 'is-today' : ''} ${isClosed ? 'is-closed' : ''}`}>
                  <strong>{day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
                  <span>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  <small>{isClosed ? 'Closed' : roundHours(hours)}</small>
                  <button type="button" className="deputy-close-day-button" onClick={() => toggleClosedDay(day)}>
                    {isClosed ? 'Open' : 'Close'}
                  </button>
                </div>
              );
            })}

            {scheduleRows.length === 0 ? (
              <div className="deputy-schedule-empty">No rows match the current filters.</div>
            ) : (
              scheduleRows.map((row) => {
                const rowHours = row.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                return (
                  <div className="deputy-schedule-row" key={row.id}>
                    <div className="deputy-row-label">
                      <span className="roster-avatar">{row.initials}</span>
                      <span>
                        <strong>{row.label}</strong>
                        <small>{row.sublabel}</small>
                      </span>
                      <Badge tone={row.shifts.length ? 'info' : 'muted'}>{roundHours(rowHours)}</Badge>
                    </div>
                    {days.map((day) => {
                      const cellShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                      const isClosed = closedDayKeys.has(toDateInput(day));
                      return (
                        <button
                          key={`${row.id}-${day.toISOString()}`}
                          type="button"
                          className={`deputy-schedule-cell ${cellShifts.length ? 'has-shifts' : ''} ${isClosed ? 'is-closed' : ''}`}
                          aria-disabled={isClosed}
                          onClick={() => prefillCell(row, day)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                          }}
                          onDrop={(event) => void handleDrop(event, row, day)}
                        >
                          {isClosed ? (
                            <span className="deputy-closed-cell">
                              Closed
                              {cellShifts.length ? <small>{cellShifts.length}</small> : null}
                            </span>
                          ) : null}
                          {!isClosed && cellShifts.length === 0 ? <span className="deputy-add-shift">+ Shift</span> : null}
                          {!isClosed ? cellShifts.map((shift) => (
                            <span
                              key={shift.id}
                              draggable
                              className={`deputy-shift-card deputy-shift-${shift.status.toLowerCase()} ${isDeputyImportedShift(shift) ? 'is-deputy-import' : ''} ${isUnallocatedProfile(shift.staffProfile) ? 'is-unallocated' : ''} ${draggingShiftId === shift.id ? 'is-dragging' : ''}`}
                              style={areaStyle(shift.area || row.label)}
                              onDragStart={(event) => handleDragStart(event, shift)}
                              onDragEnd={() => setDraggingShiftId(null)}
                              onClick={(event) => {
                                event.stopPropagation();
                                startEditShift(shift);
                              }}
                              onContextMenu={(event) => openShiftContextMenu(event, shift)}
                            >
                              <strong>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)}</strong>
                              <span>{viewMode === 'team' ? shift.area || shift.roleTitle || 'Shift' : `${shift.staffProfile?.firstName ?? ''} ${shift.staffProfile?.lastName ?? ''}`.trim()}</span>
                              <small>
                                {isUnallocatedProfile(shift.staffProfile)
                                  ? 'Unallocated'
                                  : shift.breakMinutes
                                    ? `${shift.breakMinutes}m break`
                                    : shift.status}
                              </small>
                            </span>
                          )) : null}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {editorOpen ? (
        <aside className="deputy-shift-editor">
          <Card
            title={editingShift ? 'Edit shift' : 'Add shift'}
            subtitle={editingShift ? 'Selected shift details' : 'Click a grid cell to prefill the day and row'}
            action={
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingShift(null);
                  setEditorOpen(false);
                }}
              >
                Close
              </Button>
            }
          >
            <div className="staff-profile-form">
              <Select
                label="Team member"
                value={staffProfileId}
                onChange={(event) => setStaffProfileId(event.currentTarget.value)}
                options={activeStaff.map((member) => ({
                  label: `${member.firstName} ${member.lastName}`,
                  value: member.id
                }))}
              />
              <Select
                label="Venue"
                value={shiftVenue}
                onChange={(event) => setShiftVenue(event.currentTarget.value)}
                options={venues.map((venue) => ({ label: venue, value: venue }))}
              />
              <div className="form-grid two">
                <Select
                  label="Area"
                  value={area}
                  onChange={(event) => setArea(event.currentTarget.value)}
                  options={activeAreas.map((item) => ({ label: item, value: item }))}
                />
                <Input label="Role" value={roleTitle} onChange={(event) => setRoleTitle(event.currentTarget.value)} placeholder="Use profile role" />
              </div>
              <Select
                label="Status"
                value={shiftStatus}
                onChange={(event) => setShiftStatus(event.currentTarget.value as RosterShift['status'])}
                options={[
                  { label: 'Draft', value: 'DRAFT' },
                  { label: 'Published', value: 'PUBLISHED' },
                  { label: 'Completed', value: 'COMPLETED' },
                  { label: 'Cancelled', value: 'CANCELLED' }
                ]}
              />
              <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
              <div className="form-grid two">
                <Input label="Start" type="time" value={startTime} onChange={(event) => setStartTime(event.currentTarget.value)} />
                <Input label="End" type="time" value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} />
              </div>
              {selectedShiftHours ? (
                <p className="subtle roster-duration-hint">
                  {roundHours((selectedShiftHours.endsAt.getTime() - selectedShiftHours.startsAt.getTime()) / 36e5)} shift
                  {selectedShiftHours.endsAt.getDate() !== selectedShiftHours.startsAt.getDate() ? ' · overnight' : ''}
                </p>
              ) : null}
              {shiftConflicts.length > 0 ? (
                <div className="roster-conflict-warning">
                  <strong>{shiftConflicts.length} overlap warning</strong>
                  <span>
                    {shiftConflicts
                      .slice(0, 2)
                      .map((shift) => `${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} ${shift.area || 'Shift'}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              <Input label="Meal break" type="number" min="0" step="5" value={breakMinutes} onChange={(event) => setBreakMinutes(event.currentTarget.value)} />
              <Textarea label="Notes" rows={2} value={shiftNotes} onChange={(event) => setShiftNotes(event.currentTarget.value)} />
              <div className="deputy-editor-actions">
                {editingShift ? (
                  <>
                    <Button type="button" variant="secondary" disabled={saving} onClick={() => void duplicateShift()}>
                      Duplicate
                    </Button>
                    <Button type="button" variant="ghost" disabled={saving} onClick={() => void deleteShift(editingShift)}>
                      Delete
                    </Button>
                  </>
                ) : null}
                <Button type="button" disabled={saving || !canSaveShift} onClick={() => void saveShift()}>
                  {saving ? 'Saving…' : editingShift ? 'Save shift' : 'Add shift'}
                </Button>
              </div>
            </div>
          </Card>
        </aside>
        ) : null}
      </div>
      {shiftContextMenu ? (
        <div
          className="roster-shift-context-menu"
          style={{ left: shiftContextMenu.x, top: shiftContextMenu.y }}
          role="menu"
          aria-label="Shift actions"
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => startEditShift(shiftContextMenu.shift)}>
            Edit shift
          </button>
          <button type="button" role="menuitem" disabled={saving} onClick={() => void duplicateShiftFromShift(shiftContextMenu.shift)}>
            Copy shift
          </button>
          <button type="button" role="menuitem" className="is-danger" disabled={saving} onClick={() => void deleteShift(shiftContextMenu.shift)}>
            Delete shift
          </button>
        </div>
      ) : null}
    </div>
  );
}

function weekDays(reference: Date, length = 7) {
  return Array.from({ length }, (_, index) => {
    return addDays(reference, index);
  });
}

function startOfWeek(reference: Date) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function addDays(reference: Date, days: number) {
  const date = new Date(reference);
  date.setDate(reference.getDate() + days);
  return date;
}

function shiftTimeRange(date: string, startTime: string, endTime: string) {
  if (!date || !startTime || !endTime) return null;
  const startsAt = new Date(`${date}T${startTime}:00`);
  const endsAt = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt <= startsAt) endsAt.setDate(endsAt.getDate() + 1);
  return { startsAt, endsAt };
}

function moveDateKeepingTime(value: string, targetDay: Date) {
  const source = new Date(value);
  const next = new Date(targetDay);
  next.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return next;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isDateInRange(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return !Number.isNaN(time) && time >= start.getTime() && time < end.getTime();
}

function rangesOverlap(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && startB < endA;
}

function timeOf(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function toDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toTimeInput(value: Date) {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
}

function isExpiringSoon(iso: string) {
  const expiry = new Date(iso);
  if (Number.isNaN(expiry.getTime())) return false;
  const now = new Date();
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return expiry <= soon && expiry >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
}

function formatRange(start: Date, end: Date) {
  return `${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} - ${end.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })}`;
}

function shiftHours(shift: RosterShift) {
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) return 0;
  return (endsAt - startsAt) / 36e5;
}

function countRosterOverlaps(shifts: RosterShift[]) {
  let conflicts = 0;
  const byStaff = shifts
    .filter((shift) => shift.status !== 'CANCELLED')
    .reduce((groups, shift) => {
      const group = groups.get(shift.staffProfileId) ?? [];
      group.push(shift);
      groups.set(shift.staffProfileId, group);
      return groups;
    }, new Map<string, RosterShift[]>());

  for (const staffShifts of byStaff.values()) {
    const sorted = staffShifts
      .map((shift) => ({
        startsAt: new Date(shift.startsAt),
        endsAt: new Date(shift.endsAt)
      }))
      .filter((shift) => !Number.isNaN(shift.startsAt.getTime()) && !Number.isNaN(shift.endsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    for (let index = 0; index < sorted.length - 1; index += 1) {
      if (rangesOverlap(sorted[index].startsAt, sorted[index].endsAt, sorted[index + 1].startsAt, sorted[index + 1].endsAt)) {
        conflicts += 1;
      }
    }
  }

  return conflicts;
}

function roundHours(hours: number) {
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function loadRosterForecastDraft(): RosterForecastDraft {
  const fallback: RosterForecastDraft = {
    forecastSales: '',
    targetWagePercent: '32',
    dailyForecastSales: {}
  };

  try {
    const raw = window.localStorage.getItem(ROSTER_FORECAST_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RosterForecastDraft>;
    return {
      forecastSales: typeof parsed.forecastSales === 'string' ? parsed.forecastSales : fallback.forecastSales,
      targetWagePercent: typeof parsed.targetWagePercent === 'string' ? parsed.targetWagePercent : fallback.targetWagePercent,
      dailyForecastSales:
        parsed.dailyForecastSales && typeof parsed.dailyForecastSales === 'object'
          ? Object.fromEntries(
              Object.entries(parsed.dailyForecastSales).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            )
          : fallback.dailyForecastSales
    };
  } catch {
    return fallback;
  }
}

function loadRosterClosedDays(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(ROSTER_CLOSED_DAYS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((draft, [scope, value]) => {
      if (Array.isArray(value)) {
        draft[scope] = value.filter((item): item is string => typeof item === 'string');
      }
      return draft;
    }, {} as Record<string, string[]>);
  } catch {
    return {};
  }
}

const AREA_THEMES: Record<string, { bg: string; border: string; text: string }> = {
  bar: { bg: '#eef2ff', border: '#4f46e5', text: '#312e81' },
  'floor day': { bg: '#e0f2fe', border: '#0284c7', text: '#075985' },
  'floor night': { bg: '#ecfdf5', border: '#059669', text: '#064e3b' },
  floor: { bg: '#ecfdf5', border: '#059669', text: '#064e3b' },
  kitchen: { bg: '#fff7ed', border: '#ea580c', text: '#7c2d12' },
  management: { bg: '#f5f3ff', border: '#7c3aed', text: '#4c1d95' },
  'host / floor manager': { bg: '#fefce8', border: '#ca8a04', text: '#713f12' },
  'avalon manager': { bg: '#f5f3ff', border: '#7c3aed', text: '#4c1d95' },
  events: { bg: '#fdf2f8', border: '#db2777', text: '#831843' },
  training: { bg: '#eff6ff', border: '#2563eb', text: '#1e3a8a' }
};

function areaStyle(area: string): CSSProperties {
  const theme = AREA_THEMES[area.trim().toLowerCase()] ?? {
    bg: '#f8fafc',
    border: '#64748b',
    text: '#334155'
  };
  return {
    '--shift-bg': theme.bg,
    '--shift-border': theme.border,
    '--shift-text': theme.text
  } as CSSProperties;
}

function initials(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.toUpperCase() || 'A';
}

function statusTone(status: RosterShift['status']) {
  switch (status) {
    case 'PUBLISHED':
      return 'positive';
    case 'COMPLETED':
      return 'neutral';
    case 'CANCELLED':
      return 'danger';
    case 'DRAFT':
    default:
      return 'warning';
  }
}

function isDeputyImportedShift(shift: Pick<RosterShift, 'notes'>) {
  return (shift.notes ?? '').includes('Deputy import:');
}

function isDeputyImportedProfile(member: { notes?: string | null; email?: string | null } | null | undefined) {
  return Boolean(member?.notes?.includes('Created from Deputy roster import') || member?.notes?.includes('Deputy unallocated placeholder'));
}

function isUnallocatedProfile(member: { firstName?: string | null; notes?: string | null } | null | undefined) {
  return Boolean(member?.firstName === 'Unallocated' || member?.notes?.includes('Deputy unallocated placeholder'));
}

function ApprovalRecordRow({
  member,
  record,
  saving,
  onApprove
}: {
  member: StaffProfile;
  record: StaffComplianceRecord;
  saving: boolean;
  onApprove: (memberId: string, recordId: string) => void;
}) {
  return (
    <div className="invite-row">
      <span>
        <strong>{record.title}</strong>
        <span className="subtle">
          {member.firstName} {member.lastName} · {member.venue || 'No venue'} · {record.documentName || 'Uploaded document'}
        </span>
        {record.documentUrl ? (
          <a href={record.documentUrl} target="_blank" rel="noreferrer" className="invite-link">
            Open uploaded document
          </a>
        ) : (
          <span className="subtle">No document uploaded yet</span>
        )}
      </span>
      <span className="invite-row-actions">
        <Badge tone={record.status === 'APPROVED' ? 'positive' : 'warning'}>{record.status}</Badge>
        <Button
          type="button"
          size="sm"
          disabled={saving || record.status === 'APPROVED' || !record.documentUrl}
          onClick={() => onApprove(member.id, record.id)}
        >
          Approve document
        </Button>
      </span>
    </div>
  );
}

function ApprovalsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingProfiles = staff.filter((member) => member.employmentStatus === 'PENDING');
  const pendingRecords = staff.flatMap((member) =>
    member.records
      .filter((record) => record.status === 'PENDING')
      .map((record) => ({ member, record }))
  );

  async function approveRecord(memberId: string, recordId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${memberId}/records/${recordId}/approve`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await reload();
      setMessage('Document approved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document.');
    } finally {
      setSaving(false);
    }
  }

  async function approveProfile(memberId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffProfile>(`/api/staff/${memberId}/onboarding/approve`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await reload();
      setMessage('Onboarding approved and profile activated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve onboarding.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Staff approvals"
        title="Approve onboarding details and uploaded documents"
        description="New staff submit payroll, tax, bank, super, visa and document details here before their profile is activated."
      />

      <div className="stats-grid">
        <StatCard label="Pending profiles" value={pendingProfiles.length} hint="Awaiting manager approval" />
        <StatCard label="Pending documents" value={pendingRecords.length} hint="Uploaded or waiting" />
      </div>

      {message ? <p className={message.includes('Could not') || message.includes('Missing') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Pending onboarding profiles" subtitle="Approve once details and required uploads have been checked." padding="none">
        {pendingProfiles.length === 0 ? (
          <EmptyState title="No staff waiting for approval" description="Completed onboarding submissions will appear here." />
        ) : (
          <div className="invite-list">
            {pendingProfiles.map((member) => {
              const pending = member.records.filter((record) => record.status === 'PENDING').length;
              const uploaded = member.records.filter((record) => Boolean(record.documentUrl)).length;
              const readyToApprove = pending === 0;
              return (
                <div key={member.id} className="invite-row">
                  <span>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <span className="subtle">
                      {member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'No email'}
                    </span>
                    <span className="subtle">{uploaded} uploaded documents · {pending} documents pending approval</span>
                  </span>
                  <span className="invite-row-actions">
                    <Badge tone="warning">Pending onboarding</Badge>
                    <Button type="button" size="sm" disabled={saving || !readyToApprove} onClick={() => void approveProfile(member.id)}>
                      {readyToApprove ? 'Approve onboarding' : 'Approve documents first'}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Document approval queue" subtitle="Open each uploaded document, then approve it." padding="none">
        {pendingRecords.length === 0 ? (
          <EmptyState title="No documents waiting" description="Pending uploaded documents will appear here." />
        ) : (
          <div className="invite-list">
            {pendingRecords.map(({ member, record }) => (
              <ApprovalRecordRow
                key={record.id}
                member={member}
                record={record}
                saving={saving}
                onApprove={(memberId, recordId) => void approveRecord(memberId, recordId)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function TipsPage({ staff }: { staff: StaffProfile[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [venue, setVenue] = useState(staff.find((member) => member.venue)?.venue ?? 'Alma Avalon');
  const [serviceDate, setServiceDate] = useState(() => toDateInput(new Date()));
  const [cashAmount, setCashAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [cardImportSource, setCardImportSource] = useState('control');
  const [cardImportText, setCardImportText] = useState('');
  const [adjustments, setAdjustments] = useState<Record<string, { adjustment: string; excluded: boolean; notes: string }>>({});
  const [summary, setSummary] = useState<StaffTipsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const venueOptions = useMemo(
    () => uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((value) => ({ label: value, value })),
    [staff]
  );

  const loadTips = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        venue
      });
      setSummary(await api<StaffTipsSummary>(`/api/staff/tips?${query.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load tips.');
    } finally {
      setLoading(false);
    }
  }, [venue, weekEnd, weekStart]);

  useEffect(() => {
    if (!venue && venueOptions[0]) setVenue(venueOptions[0].value);
  }, [venue, venueOptions]);

  useEffect(() => {
    if (venue) void loadTips();
  }, [loadTips, venue]);

  useEffect(() => {
    setAdjustments({});
  }, [venue, weekStart]);

  const adjustmentPayload = useMemo(() => Object.entries(adjustments)
    .map(([staffProfileId, adjustment]) => ({
      staffProfileId,
      adjustmentCents: Math.round((Number(adjustment.adjustment) || 0) * 100),
      excluded: adjustment.excluded,
      notes: adjustment.notes
    }))
    .filter((adjustment) => adjustment.adjustmentCents !== 0 || adjustment.excluded || adjustment.notes.trim().length > 0), [adjustments]);

  const reviewedRows = useMemo(() => (summary?.entitlements ?? []).map((row) => {
    const adjustment = adjustments[row.staffProfileId];
    const excluded = adjustment?.excluded ?? false;
    const adjustmentCents = excluded ? -row.amountCents : Math.round((Number(adjustment?.adjustment) || 0) * 100);
    return {
      ...row,
      adjustmentCents,
      finalAmountCents: Math.max(0, row.amountCents + adjustmentCents),
      excluded,
      reviewNotes: adjustment?.notes ?? ''
    };
  }), [adjustments, summary?.entitlements]);

  const totalPayoutCents = reviewedRows.reduce((sum, row) => sum + row.finalAmountCents, 0);
  const payoutVarianceCents = totalPayoutCents - (summary?.tipPoolCents ?? 0);
  const lockedRows = summary?.paidEntitlements ?? [];
  const hasPaidRun = lockedRows.length > 0;

  function updateTipAdjustment(staffProfileId: string, patch: Partial<{ adjustment: string; excluded: boolean; notes: string }>) {
    setAdjustments((current) => ({
      ...current,
      [staffProfileId]: {
        adjustment: current[staffProfileId]?.adjustment ?? '',
        excluded: current[staffProfileId]?.excluded ?? false,
        notes: current[staffProfileId]?.notes ?? '',
        ...patch
      }
    }));
  }

  async function saveCashTips() {
    if (!venue) {
      setMessage('Choose a venue before adding cash tips.');
      return;
    }
    const amountCents = Math.round((Number(cashAmount) || 0) * 100);
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/cash-entry', {
        method: 'POST',
        body: JSON.stringify({ venue, serviceDate: `${serviceDate}T00:00:00`, amountCents, notes })
      });
      setMessage(amountCents > 0 ? `Saved ${formatCents(amountCents)} cash tips.` : 'Cleared cash tips for that date.');
      setCashAmount('');
      setNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save cash tips.');
    } finally {
      setSaving(false);
    }
  }

  async function importCardTips() {
    if (!venue) {
      setMessage('Choose a venue before importing card tips.');
      return;
    }
    const parsedRows = parseTipsImportRows(cardImportText, venue, cardImportSource);
    if (!parsedRows.length) {
      setMessage('Paste card tips rows with at least a date and amount column.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ imported: number; updated: number; count: number }>('/api/staff/tips/card-import', {
        method: 'POST',
        body: JSON.stringify({ rows: parsedRows })
      });
      setMessage(`Imported ${result.imported} card tip row${result.imported === 1 ? '' : 's'} and updated ${result.updated}.`);
      setCardImportText('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import card tips.');
    } finally {
      setSaving(false);
    }
  }

  async function exportTips() {
    if (!venue) {
      setMessage('Choose a venue before exporting tips.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ csv: string }>('/api/staff/tips/export/csv', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, adjustments: adjustmentPayload })
      });
      downloadTextFile(`alma-tips-${venue}-${toDateInput(weekStart)}.csv`, result.csv);
      setMessage('Tips CSV exported.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export tips.');
    } finally {
      setSaving(false);
    }
  }

  async function markPaid() {
    if (!venue) {
      setMessage('Choose a venue before marking tips paid.');
      return;
    }
    if (payoutVarianceCents !== 0) {
      setMessage(`Final payout must balance to the tip pool before marking paid. Current variance is ${formatCents(payoutVarianceCents)}.`);
      return;
    }
    if (!window.confirm(`Mark ${formatCents(totalPayoutCents)} tips paid for ${venue}? This creates the approved tip run used by Reports payroll export.`)) {
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/mark-paid', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, notes: payoutNotes, adjustments: adjustmentPayload })
      });
      setMessage('Tips marked paid. Reports payroll export will now use this approved tip run.');
      setPayoutNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not mark tips paid.');
    } finally {
      setSaving(false);
    }
  }

  function downloadTipsTemplate() {
    downloadTextFile(
      `alma-card-tips-template-${venue || 'venue'}-${toDateInput(weekStart)}.csv`,
      [
        'date,venue,tips,externalId,notes',
        `${toDateInput(weekStart)},${venue || 'Alma Avalon'},0,example-1,Square or Control import`
      ].join('\n')
    );
  }

  return (
    <div className="page-stack tips-page">
      <PageHeader
        eyebrow="Payroll"
        title="Tips"
        description="Record cash tips, allocate them across approved hours, and export a simple payout run for staff."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void loadTips()} disabled={loading}>Refresh</Button>
            <Button type="button" variant="secondary" onClick={() => void exportTips()} disabled={saving || !summary?.entitlements.length}>Export CSV</Button>
            <Button type="button" onClick={() => void markPaid()} disabled={saving || !summary?.entitlements.length || payoutVarianceCents !== 0}>Mark paid</Button>
          </>
        }
      />

      <div className="stats-grid">
        <StatCard label="Cash tips" value={formatCents(summary?.cashTipsCents ?? 0)} hint={formatRange(weekStart, addDays(weekEnd, -1))} loading={loading} />
        <StatCard label="Card tips" value={formatCents(summary?.squareTipsCents ?? 0)} hint={`${summary?.cardEntries.length ?? 0} imported rows`} loading={loading} />
        <StatCard label="Tip pool" value={formatCents(summary?.tipPoolCents ?? 0)} hint="Cash plus imported card tips" loading={loading} />
        <StatCard label="Final payout" value={formatCents(totalPayoutCents)} hint={payoutVarianceCents === 0 ? 'Balances to pool' : `${formatCents(Math.abs(payoutVarianceCents))} ${payoutVarianceCents > 0 ? 'over' : 'under'} pool`} loading={loading} />
        <StatCard label="Approved hours" value={roundHours(summary?.approvedHours ?? 0)} hint="Used for allocation" loading={loading} />
        <StatCard label="Paid run" value={hasPaidRun ? 'Locked' : 'Open'} hint={hasPaidRun ? 'Reports uses paid run' : 'Mark paid to lock payroll tips'} loading={loading} />
      </div>

      <div className="staff-board">
        <Card title="Add cash tips" subtitle="Enter the cash tip pool for a single service date. Enter $0 to clear that date.">
          <div className="tips-day-picker" aria-label="Cash tip service dates">
            {weekDays(weekStart).map((day) => (
              <button
                key={day.toISOString()}
                type="button"
                className={serviceDate === toDateInput(day) ? 'active' : undefined}
                onClick={() => setServiceDate(toDateInput(day))}
              >
                <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                <strong>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</strong>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
            <Input label="Service date" type="date" value={serviceDate} onChange={(event) => setServiceDate(event.currentTarget.value)} />
            <Input label="Cash tips" type="number" min="0" step="0.01" value={cashAmount} onChange={(event) => setCashAmount(event.currentTarget.value)} placeholder="0.00" />
          </div>
          <Textarea label="Notes" rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
          <div className="toolbar-right">
            <Button type="button" disabled={saving || !venue} onClick={() => void saveCashTips()}>
              {saving ? 'Saving...' : 'Save cash tips'}
            </Button>
          </div>
        </Card>

        <Card title="Import card tips" subtitle="Paste a Control or Square CSV with date and tip amount columns. Venue defaults to the selected venue if the file has no venue column.">
          <div className="form-grid two">
            <Select
              label="Source"
              value={cardImportSource}
              onChange={(event) => setCardImportSource(event.currentTarget.value)}
              options={[
                { label: 'Alma Control', value: 'control' },
                { label: 'Square', value: 'square' },
                { label: 'Other card tips', value: 'card' }
              ]}
            />
            <Input
              label="Default venue"
              value={venue}
              onChange={(event) => setVenue(event.currentTarget.value)}
              placeholder="Alma Avalon"
            />
          </div>
          <Textarea
            label="CSV rows"
            rows={7}
            value={cardImportText}
            onChange={(event) => setCardImportText(event.currentTarget.value)}
            placeholder="date,venue,tips&#10;2026-05-04,Alma Avalon,125.50"
          />
          <div className="toolbar-right">
            <Button type="button" variant="secondary" onClick={downloadTipsTemplate}>
              Download template
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCardImportText('')} disabled={saving || !cardImportText.trim()}>
              Clear
            </Button>
            <Button type="button" disabled={saving || !cardImportText.trim()} onClick={() => void importCardTips()}>
              {saving ? 'Importing...' : 'Import card tips'}
            </Button>
          </div>
        </Card>

        <Card title="Tips week" subtitle="Cash entries and paid runs for the selected week.">
          <div className="roster-week-controls" aria-label="Tips week controls">
            <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</Button>
            <strong>{formatRange(weekStart, addDays(weekEnd, -1))}</strong>
            <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</Button>
          </div>
          {message ? <p className={message.includes('Could') || message.includes('Choose') ? 'error-text' : 'subtle'}>{message}</p> : null}
          {loading ? <Spinner label="Loading tips..." /> : null}
          <div className={`tips-status-panel ${hasPaidRun ? 'is-locked' : ''}`}>
            <span>
              <strong>{hasPaidRun ? 'Approved tip run locked' : 'Tip run open'}</strong>
              <span className="subtle">
                {hasPaidRun
                  ? 'Reports payroll export will use the latest paid run for this week and venue.'
                  : 'Review staff entitlements, then mark paid to lock the run for payroll.'}
              </span>
            </span>
            <Badge tone={hasPaidRun ? 'positive' : 'warning'}>{hasPaidRun ? 'Payroll ready' : 'Needs approval'}</Badge>
          </div>
          <Textarea label="Paid run notes" rows={2} value={payoutNotes} onChange={(event) => setPayoutNotes(event.currentTarget.value)} />
          <div className="tips-section-stack">
            <div>
              <strong>Cash entries</strong>
              <div className="staff-list">
                {(summary?.cashEntries ?? []).map((entry) => (
                  <article key={entry.id} className="staff-list-button tips-row">
                    <span>
                      <strong>{new Date(entry.serviceDate).toLocaleDateString()}</strong>
                      <span className="subtle">{entry.venue}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                    </span>
                    <Badge tone="warning">{formatCents(entry.amountCents)}</Badge>
                  </article>
                ))}
              </div>
              {!loading && summary?.cashEntries.length === 0 ? <p className="subtle">No cash tips entered this week.</p> : null}
            </div>
            <div>
              <strong>Card entries</strong>
              <div className="staff-list">
                {(summary?.cardEntries ?? []).map((entry) => (
                  <article key={entry.id} className="staff-list-button tips-row">
                    <span>
                      <strong>{new Date(entry.serviceDate).toLocaleDateString()}</strong>
                      <span className="subtle">{entry.venue} · {entry.source}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                    </span>
                    <Badge tone="info">{formatCents(entry.amountCents)}</Badge>
                  </article>
                ))}
              </div>
              {!loading && summary?.cardEntries.length === 0 ? <p className="subtle">No card tips imported this week.</p> : null}
            </div>
            <div>
              <strong>Paid runs</strong>
              <div className="staff-list">
                {(summary?.paidRuns ?? []).map((run) => (
                  <article key={run.id} className="staff-list-button tips-row">
                    <span>
                      <strong>{formatCents(run.tipPoolCents)}</strong>
                      <span className="subtle">{new Date(run.paidAt).toLocaleString()} · {run.lineCount} staff</span>
                    </span>
                    <Badge tone="positive">Paid</Badge>
                  </article>
                ))}
              </div>
              {!loading && summary?.paidRuns.length === 0 ? <p className="subtle">No paid run recorded for this week yet.</p> : null}
            </div>
          </div>
        </Card>
      </div>

        <Card title="Staff entitlements" subtitle="Review the calculated split, exclude a staff member, or add a once-off adjustment before locking a paid run." padding="none" className="tips-entitlements-card">
        {!loading && !reviewedRows.length ? (
          <EmptyState title="No tip entitlements yet" description="Approve timesheets and add cash tips to calculate staff payouts." />
        ) : null}
        {reviewedRows.length ? (
          <div className="table-card tips-table">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Hours</th>
                  <th>Base tips</th>
                  <th>Adjust</th>
                  <th>Final</th>
                  <th>Pay</th>
                </tr>
              </thead>
              <tbody>
                {reviewedRows.map((row) => (
                  <tr key={row.staffProfileId}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.roleTitle ?? 'Team member'}</td>
                    <td>{row.approvedHours.toFixed(2)}</td>
                    <td>{formatCents(row.amountCents)}</td>
                    <td>
                      <Input
                        aria-label={`Tip adjustment for ${row.name}`}
                        type="number"
                        step="0.01"
                        value={adjustments[row.staffProfileId]?.adjustment ?? ''}
                        onChange={(event) => updateTipAdjustment(row.staffProfileId, { adjustment: event.currentTarget.value })}
                        disabled={row.excluded}
                        placeholder="0.00"
                      />
                    </td>
                    <td>
                      <strong>{formatCents(row.finalAmountCents)}</strong>
                      {row.adjustmentCents !== 0 ? <span className="subtle"> {row.adjustmentCents > 0 ? '+' : ''}{formatCents(row.adjustmentCents)}</span> : null}
                    </td>
                    <td>
                      <div className="tips-review-actions">
                        <Badge tone={row.excluded ? 'muted' : 'warning'}>{row.excluded ? 'Excluded' : row.paymentMethod}</Badge>
                        <label className="inline-checkbox">
                          <input
                            type="checkbox"
                            checked={row.excluded}
                            onChange={(event) => updateTipAdjustment(row.staffProfileId, { excluded: event.currentTarget.checked })}
                          />
                          Exclude
                        </label>
                        <Input
                          aria-label={`Tip note for ${row.name}`}
                          value={adjustments[row.staffProfileId]?.notes ?? ''}
                          onChange={(event) => updateTipAdjustment(row.staffProfileId, { notes: event.currentTarget.value })}
                          placeholder="Note"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {lockedRows.length ? (
        <Card title="Approved tip run" subtitle="This locked run is the source Reports uses for payroll tips." padding="none">
          <div className="table-card tips-table">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Role</th>
                  <th>Hours</th>
                  <th>Paid tips</th>
                </tr>
              </thead>
              <tbody>
                {lockedRows.map((row) => (
                  <tr key={row.staffProfileId}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.roleTitle ?? 'Team member'}</td>
                    <td>{row.approvedHours.toFixed(2)}</td>
                    <td>{formatCents(row.amountCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function StaffMemberTipsPage() {
  const [history, setHistory] = useState<StaffTipHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setHistory(await api<StaffTipHistory[]>('/api/staff/tips/me'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load tips.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const totalPaid = history.reduce((sum, entry) => sum + entry.amountCents, 0);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="My pay"
        title="Tips"
        description="Your paid tips history from approved weekly runs."
        actions={<Button type="button" variant="secondary" onClick={() => void loadHistory()} disabled={loading}>Refresh</Button>}
      />

      <div className="stats-grid">
        <StatCard label="Paid tips" value={formatCents(totalPaid)} hint="Recent recorded runs" loading={loading} />
        <StatCard label="Paid runs" value={String(history.length)} hint="Visible history" loading={loading} />
      </div>

      {message ? <p className="error-text">{message}</p> : null}
      {loading ? <Spinner label="Loading tips..." /> : null}

      <Card title="Tip history" subtitle="These are locked manager-approved tip payments.">
        {!loading && history.length === 0 ? (
          <EmptyState title="No paid tips yet" description="Paid tip runs will appear here after your manager marks them paid." />
        ) : null}
        <div className="staff-list">
          {history.map((entry) => (
            <article key={entry.id} className="staff-list-button tips-row">
              <span>
                <strong>{formatCents(entry.amountCents)}</strong>
                <span className="subtle">
                  {entry.venue} · {formatRange(new Date(entry.weekStart), addDays(new Date(entry.weekEnd), -1))} · {entry.hours.toFixed(2)}h
                </span>
                {entry.adjustmentCents !== 0 ? (
                  <span className="subtle">Adjustment {entry.adjustmentCents > 0 ? '+' : ''}{formatCents(entry.adjustmentCents)}</span>
                ) : null}
                {entry.notes ? <span className="subtle">{entry.notes}</span> : null}
              </span>
              <Badge tone="positive">Paid {new Date(entry.paidAt).toLocaleDateString()}</Badge>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TimesheetsPage({ staff, roster = [] }: { staff: StaffProfile[]; roster?: RosterShift[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [statusFilter, setStatusFilter] = useState<'all' | Timesheet['status']>('all');
  const [venueFilter, setVenueFilter] = useState('all');
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [staffProfileId, setStaffProfileId] = useState(staff[0]?.id ?? '');
  const [workDate, setWorkDate] = useState(() => toDateInput(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('16:00');
  const [breakMinutes, setBreakMinutes] = useState('30');
  const [area, setArea] = useState('Floor');
  const [paymentMethod, setPaymentMethod] = useState<'XERO' | 'CASH'>('XERO');
  const [xeroEmployeeId, setXeroEmployeeId] = useState('');
  const [xeroEarningsRateId, setXeroEarningsRateId] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedRosterShiftId, setSelectedRosterShiftId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const selectedMember = staff.find((member) => member.id === staffProfileId);
  const venueOptions = useMemo(
    () => [
      { label: 'All venues', value: 'all' },
      ...uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]).map((venue) => ({
        label: venue,
        value: venue
      }))
    ],
    [staff]
  );
  const submittedCount = timesheets.filter((entry) => entry.status === 'SUBMITTED').length;
  const approvedCount = timesheets.filter((entry) => entry.status === 'APPROVED').length;
  const approvedHours = timesheets
    .filter((entry) => entry.status === 'APPROVED')
    .reduce((sum, entry) => sum + timesheetHours(entry), 0);
  const rosterShiftsForSelected = useMemo(
    () =>
      roster
        .filter((shift) => shift.staffProfileId === staffProfileId && shift.status !== 'CANCELLED')
        .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [roster, staffProfileId]
  );

  const loadTimesheets = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        status: statusFilter,
        venue: venueFilter
      });
      setTimesheets(await api<Timesheet[]>(`/api/staff/timesheets?${query.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load timesheets.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, venueFilter, weekEnd, weekStart]);

  useEffect(() => {
    if (!staffProfileId && staff[0]) setStaffProfileId(staff[0].id);
  }, [staff, staffProfileId]);

  useEffect(() => {
    setXeroEmployeeId(selectedMember?.xeroEmployeeId ?? '');
    setXeroEarningsRateId(selectedMember?.xeroEarningsRateId ?? '');
  }, [selectedMember?.id, selectedMember?.xeroEarningsRateId, selectedMember?.xeroEmployeeId]);

  useEffect(() => {
    void loadTimesheets();
  }, [loadTimesheets]);

  async function submitTimesheet() {
    const range = shiftTimeRange(workDate, startTime, endTime);
    if (!selectedMember || !range) {
      setMessage('Choose a staff member and valid times.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/timesheets', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId,
          rosterShiftId: selectedRosterShiftId,
          venue: selectedMember.venue ?? '',
          area,
          roleTitle: selectedMember.roleTitle,
          workDate: `${workDate}T00:00:00`,
          clockInAt: range.startsAt.toISOString(),
          clockOutAt: range.endsAt.toISOString(),
          breakMinutes: Number(breakMinutes) || 0,
          notes,
          status: 'SUBMITTED',
          xeroEmployeeId,
          xeroEarningsRateId,
          paymentMethod
        })
      });
      setMessage('Timesheet submitted.');
      setNotes('');
      setSelectedRosterShiftId('');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not submit timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function markCashPaid(id: string) {
    const notes = window.prompt('Cash payment notes (optional)') ?? '';
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/timesheets/${id}/cash-paid`, {
        method: 'POST',
        body: JSON.stringify({ notes })
      });
      setMessage('Cash payment recorded.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record cash payment.');
    } finally {
      setSaving(false);
    }
  }

  function prefillFromShift(shift: RosterShift) {
    setSelectedRosterShiftId(shift.id);
    setStaffProfileId(shift.staffProfileId);
    setWorkDate(toDateInput(new Date(shift.startsAt)));
    setStartTime(toTimeInput(new Date(shift.startsAt)));
    setEndTime(toTimeInput(new Date(shift.endsAt)));
    setBreakMinutes(String(shift.breakMinutes));
    setArea(shift.area || 'Floor');
    setNotes(`From roster: ${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} ${shift.area || 'Shift'}`);
    setMessage('Roster shift loaded. Adjust actual times before submitting.');
  }

  async function approve(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setMessage('Timesheet approved.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: string) {
    const reason = window.prompt('Reason for rejection?') ?? '';
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/timesheets/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      setMessage('Timesheet rejected.');
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function exportXero(markExported: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ exportBatchId: string; count: number; csv: string; markedExported: boolean }>(
        '/api/staff/timesheets/export/xero',
        {
          method: 'POST',
          body: JSON.stringify({
            start: weekStart.toISOString(),
            end: weekEnd.toISOString(),
            venue: venueFilter,
            markExported
          })
        }
      );
      downloadTextFile(`alma-xero-timesheets-${toDateInput(weekStart)}.csv`, result.csv);
      setMessage(`${result.count} approved timesheets exported${result.markedExported ? ' and marked exported' : ''}.`);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export Xero timesheets.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll"
        title="Timesheets"
        description="Staff submit worked hours, managers approve them, then approved hours export into a Xero-ready CSV."
      />

      <div className="stats-grid">
        <StatCard label="Submitted" value={submittedCount} hint="Awaiting approval" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Ready for Xero" loading={loading} />
        <StatCard label="Approved hours" value={roundHours(approvedHours)} hint={formatRange(weekStart, addDays(weekEnd, -1))} loading={loading} />
      </div>

      <div className="staff-board">
        <Card title="Submit timesheet" subtitle="Enter actual worked hours from the shift">
          {rosterShiftsForSelected.length ? (
            <div className="timesheet-shift-picklist">
              {rosterShiftsForSelected.slice(0, 8).map((shift) => (
                <button
                  key={shift.id}
                  type="button"
                  className={selectedRosterShiftId === shift.id ? 'is-selected' : ''}
                  onClick={() => prefillFromShift(shift)}
                >
                  <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                  <span>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || 'Shift'}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="form-grid">
            <Select
              label="Staff member"
              value={staffProfileId}
              onChange={(event) => setStaffProfileId(event.currentTarget.value)}
              options={staff.map((member) => ({ label: `${member.firstName} ${member.lastName}`, value: member.id }))}
            />
            <Input label="Date" type="date" value={workDate} onChange={(event) => setWorkDate(event.currentTarget.value)} />
            <Input label="Clock in" type="time" value={startTime} onChange={(event) => setStartTime(event.currentTarget.value)} />
            <Input label="Clock out" type="time" value={endTime} onChange={(event) => setEndTime(event.currentTarget.value)} />
            <Input label="Break minutes" type="number" value={breakMinutes} onChange={(event) => setBreakMinutes(event.currentTarget.value)} />
            <Select
              label="Area"
              value={area}
              onChange={(event) => setArea(event.currentTarget.value)}
              options={['Floor', 'Bar', 'Kitchen', 'Management', 'Events'].map((value) => ({ label: value, value }))}
            />
            <Select
              label="Pay method"
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.currentTarget.value as 'XERO' | 'CASH')}
              options={[
                { label: 'Xero payroll', value: 'XERO' },
                { label: 'Cash pay', value: 'CASH' }
              ]}
            />
            <Input label="Xero employee ID" value={xeroEmployeeId} onChange={(event) => setXeroEmployeeId(event.currentTarget.value)} />
            <Input label="Xero earnings rate ID" value={xeroEarningsRateId} onChange={(event) => setXeroEarningsRateId(event.currentTarget.value)} />
          </div>
          {paymentMethod === 'CASH' ? (
            <p className="subtle">Cash-pay timesheets can be approved and marked cash paid, but they are excluded from the Xero CSV export.</p>
          ) : null}
          <Textarea label="Notes" rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
          <div className="toolbar-right">
            <Button type="button" disabled={saving} onClick={() => void submitTimesheet()}>
              {saving ? 'Saving…' : 'Submit timesheet'}
            </Button>
          </div>
        </Card>

        <Card
          title="Approval queue"
          subtitle="Review submitted hours before exporting"
          action={
            <div className="toolbar-right">
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void exportXero(false)}>
                Preview CSV
              </Button>
              <Button type="button" size="sm" disabled={saving} onClick={() => void exportXero(true)}>
                Export to Xero
              </Button>
            </div>
          }
        >
          <div className="roster-week-controls" aria-label="Timesheet week controls">
              <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</Button>
              <strong>{formatRange(weekStart, addDays(weekEnd, -1))}</strong>
              <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</Button>
            <Select
              label="Venue"
              value={venueFilter}
              onChange={(event) => setVenueFilter(event.currentTarget.value)}
              options={venueOptions}
            />
            <Select
              label="Status"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as typeof statusFilter)}
              options={['all', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED'].map((value) => ({ label: value, value }))}
            />
          </div>
          {message ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}
          {loading ? <Spinner label="Loading timesheets…" /> : null}
          {!loading && timesheets.length === 0 ? (
            <EmptyState title="No timesheets yet" description="Submitted timesheets for this week will appear here." />
          ) : null}
          <div className="staff-list">
            {timesheets.map((entry) => (
              <article key={entry.id} className="staff-list-button" style={{ display: 'grid', gap: 8 }}>
                <span>
                  <strong>{entry.staffProfile ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}` : 'Staff member'}</strong>
                  <span className="subtle" style={{ display: 'block' }}>
                    {new Date(entry.workDate).toLocaleDateString()} · {timeOf(entry.clockInAt)}-{timeOf(entry.clockOutAt)} · {roundHours(timesheetHours(entry))}
                  </span>
                </span>
                <span className="toolbar-right">
                  <Badge tone={timesheetTone(entry.status)} dot>{entry.status}</Badge>
                  <Badge tone={entry.paymentMethod === 'CASH' ? 'warning' : 'muted'}>{entry.paymentMethod === 'CASH' ? (entry.cashPaidAt ? 'Cash paid' : 'Cash pay') : 'Xero'}</Badge>
                  {entry.status === 'SUBMITTED' || entry.status === 'REJECTED' ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void approve(entry.id)}>Approve</Button>
                  ) : null}
                  {entry.status === 'APPROVED' && entry.paymentMethod === 'CASH' && !entry.cashPaidAt ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void markCashPaid(entry.id)}>Mark cash paid</Button>
                  ) : null}
                  {entry.status !== 'EXPORTED' ? (
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void reject(entry.id)}>Reject</Button>
                  ) : null}
                </span>
              </article>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function timesheetTone(status: Timesheet['status']) {
  switch (status) {
    case 'APPROVED':
    case 'EXPORTED':
      return 'positive';
    case 'REJECTED':
      return 'danger';
    case 'SUBMITTED':
      return 'warning';
    case 'DRAFT':
    default:
      return 'muted';
  }
}

function timesheetHours(entry: Timesheet) {
  const startsAt = new Date(entry.clockInAt).getTime();
  const endsAt = new Date(entry.clockOutAt).getTime();
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) return 0;
  return Math.max(0, (endsAt - startsAt) / 36e5 - entry.breakMinutes / 60);
}

function downloadTextFile(filename: string, contents: string, type = 'text/csv') {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseMoneyCents(value: string | undefined) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function parsePercent(value: string | undefined, fallback = 32) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normaliseImportedDate(value: string | undefined) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}T00:00:00`;
  const local = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (local) {
    const year = local[3].length === 2 ? `20${local[3]}` : local[3];
    return `${year}-${local[2].padStart(2, '0')}-${local[1].padStart(2, '0')}T00:00:00`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : `${toDateInput(parsed)}T00:00:00`;
}

function parseTipsImportRows(text: string, defaultVenue: string, source: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findColumn = (names: string[]) => headers.findIndex((header) => names.includes(header));
  const dateIndex = findColumn(['date', 'servicedate', 'businessdate', 'day']);
  const venueIndex = findColumn(['venue', 'location', 'site']);
  const amountIndex = findColumn(['tips', 'tip', 'cardtips', 'squaretips', 'amount', 'tipamount', 'totaltips', 'totalgratuity', 'gratuity', 'nettips']);
  const idIndex = findColumn(['id', 'externalid', 'paymentid', 'transactionid', 'orderid', 'receiptid', 'checkid']);
  const notesIndex = findColumn(['notes', 'note', 'source']);
  if (dateIndex < 0 || amountIndex < 0) return [];

  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    const serviceDate = normaliseImportedDate(cells[dateIndex]);
    const amountCents = parseMoneyCents(cells[amountIndex]);
    const venue = cells[venueIndex]?.trim() || defaultVenue;
    if (!serviceDate || !venue || amountCents <= 0) return null;
    const externalId = cells[idIndex]?.trim() || `${serviceDate}-${venue}-${amountCents}-${index}`;
    return {
      venue,
      serviceDate,
      amountCents,
      source,
      externalId,
      importKey: `${source}:${venue}:${externalId}`,
      notes: cells[notesIndex]?.trim() || ''
    };
  }).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

function inviteLink(token: string) {
  return `${window.location.origin}/onboarding/${token}`;
}

function inviteStatus(invite: StaffInvite) {
  if (invite.completedAt) return 'Completed';
  if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) return 'Expired';
  return 'Pending';
}

type OnboardingDocumentKey = 'rightToWorkDocuments' | 'bankAccountConfirmation';

const ONBOARDING_DOCUMENT_FALLBACKS: Record<OnboardingDocumentKey, { recordType: StaffRecordType; hint: string }> = {
  rightToWorkDocuments: {
    recordType: 'OTHER',
    hint: 'Passport, driver licence, citizenship evidence, or visa work-rights evidence.'
  },
  bankAccountConfirmation: {
    recordType: 'OTHER',
    hint: 'Bank account proof or payroll bank details confirmation.'
  }
};

type OnboardingDocumentDraft = {
  key: OnboardingDocumentKey;
  title: string;
  recordType: StaffRecordType;
  required: boolean;
  hint: string;
  documentName: string;
  documentUrl: string;
};

function onboardingDocumentsFromSettings(
  settings: OnboardingSettings,
  existing: OnboardingDocumentDraft[] = []
): OnboardingDocumentDraft[] {
  const existingByKey = new Map(existing.map((document) => [document.key, document]));
  return (Object.keys(ONBOARDING_DOCUMENT_FALLBACKS) as OnboardingDocumentKey[])
    .map((key) => {
      const step = settings[key];
      const fallback = ONBOARDING_DOCUMENT_FALLBACKS[key];
      const current = existingByKey.get(key);
      return {
        key,
        title: step.label,
        recordType: fallback.recordType,
        required: step.required,
        hint: step.description || fallback.hint,
        documentName: current?.documentName ?? '',
        documentUrl: current?.documentUrl ?? ''
      };
    })
    .filter((document) => settings[document.key].enabled);
}

function readUploadAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function readOnboardingUpload(file: File) {
  const maxBytes = 4 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('Please upload a file smaller than 4MB.');
  }

  return {
    name: file.name,
    url: await readUploadAsDataUrl(file)
  };
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCents(value: number | null | undefined) {
  if (value === null || value === undefined) return 'No rate';
  return (value / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD'
  });
}

type OnboardingContext = {
  token: string;
  email: string | null;
  note: string | null;
  firstName: string;
  lastName: string;
  roleTitle: string;
  venue: string;
  expiresAt: string | null;
  createdAt: string;
  onboardingSettings: OnboardingSettings;
};

function PublicOnboardingPage() {
  const { token } = useParams();
  const [context, setContext] = useState<OnboardingContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [draft, setDraft] = useState({
    firstName: '',
    lastName: '',
    roleTitle: '',
    email: '',
    phone: '',
    venue: '',
    startDate: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    suburb: '',
    state: 'NSW',
    postcode: '',
    emergencyContactName: '',
    emergencyContactRelationship: '',
    emergencyContactPhone: '',
    employmentType: '',
    payType: '',
    payRate: '',
    payAward: '',
    taxFileNumber: '',
    taxResidencyStatus: '',
    taxFreeThreshold: true,
    hasStudyTrainingLoan: false,
    superFundName: '',
    superFundAbn: '',
    superFundUsi: '',
    superMemberNumber: '',
    bankAccountName: '',
    bankBsb: '',
    bankAccountNumber: '',
    visaStatus: '',
    visaSubclass: '',
    visaExpiryDate: '',
    workRightsNotes: '',
    password: '',
    notes: '',
    documents: onboardingDocumentsFromSettings(DEFAULT_ONBOARDING_SETTINGS)
  });

  useEffect(() => {
    async function load() {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const next = await api<OnboardingContext>(`/api/staff/invites/by-token/${token}`);
        const onboardingSettings = normaliseOnboardingSettings(next.onboardingSettings);
        setContext({ ...next, onboardingSettings });
        setDraft((current) => ({
          ...current,
          firstName: next.firstName,
          lastName: next.lastName,
          roleTitle: next.roleTitle,
          email: next.email ?? '',
          venue: next.venue,
          documents: onboardingDocumentsFromSettings(onboardingSettings, current.documents)
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load invite');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDocument(index: number, updates: Partial<OnboardingDocumentDraft>) {
    setDraft((current) => ({
      ...current,
      documents: current.documents.map((document, currentIndex) =>
        currentIndex === index ? { ...document, ...updates } : document
      )
    }));
  }

  async function complete() {
    if (!token) return;
    setError(null);
    const onboardingSettings = context?.onboardingSettings ?? DEFAULT_ONBOARDING_SETTINGS;
    const requiredFields: Array<[string, string | boolean]> = [
      ['first name', draft.firstName],
      ['last name', draft.lastName],
      ['role', draft.roleTitle],
      ['email', draft.email],
      ['phone', draft.phone],
      ['venue', draft.venue],
      ['start date', draft.startDate],
      ['date of birth', draft.dateOfBirth],
      ['address', draft.addressLine1],
      ['suburb', draft.suburb],
      ['state', draft.state],
      ['postcode', draft.postcode],
      ['emergency contact name', draft.emergencyContactName],
      ['emergency contact relationship', draft.emergencyContactRelationship],
      ['emergency contact phone', draft.emergencyContactPhone],
      ['employment type', draft.employmentType],
      ['pay type', draft.payType],
      ['bank account name', draft.bankAccountName],
      ['bank BSB', draft.bankBsb],
      ['bank account number', draft.bankAccountNumber],
      ['visa / work rights status', draft.visaStatus]
    ];

    if (onboardingSettings.taxDeclaration.enabled && onboardingSettings.taxDeclaration.required) {
      requiredFields.push(
        ['tax file number', draft.taxFileNumber],
        ['tax residency status', draft.taxResidencyStatus]
      );
    }

    if (onboardingSettings.superannuationChoice.enabled && onboardingSettings.superannuationChoice.required) {
      requiredFields.push(
        ['super fund name', draft.superFundName],
        ['super fund ABN', draft.superFundAbn],
        ['super fund USI', draft.superFundUsi],
        ['super member number', draft.superMemberNumber]
      );
    }

    const missingFields = requiredFields.filter(([, value]) => !String(value ?? '').trim());

    if (missingFields.length) {
      setError(`Please complete: ${missingFields.map(([label]) => label).join(', ')}.`);
      return;
    }
    if (!['Australian citizen', 'Australian permanent resident', 'New Zealand citizen'].includes(draft.visaStatus)) {
      if (!draft.visaSubclass.trim() || !draft.visaExpiryDate.trim()) {
        setError('Please enter visa subclass and visa expiry date for visa work-rights checks.');
        return;
      }
    }
    const missingDocuments = draft.documents.filter((document) => document.required && !document.documentUrl);
    if (missingDocuments.length) {
      setError(`Please upload: ${missingDocuments.map((document) => document.title).join(', ')}.`);
      return;
    }
    if (draft.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const payRate = Number(draft.payRate.replace(/[^0-9.]/g, ''));
    try {
      await api<StaffProfile>(`/api/staff/invites/by-token/${token}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          firstName: draft.firstName.trim(),
          lastName: draft.lastName.trim(),
          roleTitle: draft.roleTitle.trim(),
          email: draft.email.trim(),
          phone: draft.phone.trim(),
          venue: draft.venue.trim(),
          startDate: draft.startDate,
          dateOfBirth: draft.dateOfBirth,
          addressLine1: draft.addressLine1.trim(),
          addressLine2: draft.addressLine2.trim(),
          suburb: draft.suburb.trim(),
          state: draft.state.trim(),
          postcode: draft.postcode.trim(),
          emergencyContactName: draft.emergencyContactName.trim(),
          emergencyContactRelationship: draft.emergencyContactRelationship.trim(),
          emergencyContactPhone: draft.emergencyContactPhone.trim(),
          employmentType: draft.employmentType.trim(),
          payType: draft.payType.trim(),
          payRateCents: Number.isFinite(payRate) && draft.payRate.trim() ? Math.round(payRate * 100) : undefined,
          payAward: draft.payAward.trim(),
          taxFileNumber: draft.taxFileNumber.trim(),
          taxResidencyStatus: draft.taxResidencyStatus.trim(),
          taxFreeThreshold: draft.taxFreeThreshold,
          hasStudyTrainingLoan: draft.hasStudyTrainingLoan,
          superFundName: draft.superFundName.trim(),
          superFundAbn: draft.superFundAbn.trim(),
          superFundUsi: draft.superFundUsi.trim(),
          superMemberNumber: draft.superMemberNumber.trim(),
          bankAccountName: draft.bankAccountName.trim(),
          bankBsb: draft.bankBsb.trim(),
          bankAccountNumber: draft.bankAccountNumber.trim(),
          visaStatus: draft.visaStatus.trim(),
          visaSubclass: draft.visaSubclass.trim(),
          visaExpiryDate: draft.visaExpiryDate,
          workRightsNotes: draft.workRightsNotes.trim(),
          notes: draft.notes.trim(),
          password: draft.password,
          records: draft.documents
            .filter((document) => document.documentUrl)
            .map((document) => ({
              recordType: document.recordType,
              title: document.title,
              status: 'PENDING',
              documentName: document.documentName,
              documentUrl: document.documentUrl,
              notes: 'Uploaded during staff onboarding'
            }))
        })
      });
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete onboarding');
    }
  }

  const onboardingSettings = context?.onboardingSettings ?? DEFAULT_ONBOARDING_SETTINGS;

  return (
    <main className="public-onboarding">
      <Card
        title={completed ? 'Onboarding complete' : 'Complete your ALMA Staff onboarding'}
        subtitle={context?.expiresAt ? `Invite expires ${formatDateTime(context.expiresAt)}` : 'Staff invite'}
      >
        {loading ? <Spinner label="Loading invite…" /> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {completed ? (
          <EmptyState title="Onboarding submitted" description="Your details and documents are waiting for manager approval. You can sign in once the staff team activates your profile." />
        ) : null}
        {!loading && context && !completed ? (
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void complete();
            }}
          >
            {context.note ? <p className="subtle">{context.note}</p> : null}
            <div className="form-grid two">
              <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
              <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
              <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
              <Select label="Venue" required value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            <div className="form-grid two">
              <Input label="Email" type="email" required value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
              <Input label="Phone" required value={draft.phone} onChange={(event) => update('phone', event.currentTarget.value)} />
              <Input label="Start date" required type="date" value={draft.startDate} onChange={(event) => update('startDate', event.currentTarget.value)} />
              <Input label="Date of birth" required type="date" value={draft.dateOfBirth} onChange={(event) => update('dateOfBirth', event.currentTarget.value)} />
              <Input label="Password" type="password" required value={draft.password} onChange={(event) => update('password', event.currentTarget.value)} />
            </div>

            <Card title="Address and emergency contact">
              <div className="form-grid two">
                <Input label="Address line 1" required value={draft.addressLine1} onChange={(event) => update('addressLine1', event.currentTarget.value)} />
                <Input label="Address line 2" value={draft.addressLine2} onChange={(event) => update('addressLine2', event.currentTarget.value)} />
                <Input label="Suburb" required value={draft.suburb} onChange={(event) => update('suburb', event.currentTarget.value)} />
                <Input label="State" required value={draft.state} onChange={(event) => update('state', event.currentTarget.value)} />
                <Input label="Postcode" required value={draft.postcode} onChange={(event) => update('postcode', event.currentTarget.value)} />
                <Input label="Emergency contact name" required value={draft.emergencyContactName} onChange={(event) => update('emergencyContactName', event.currentTarget.value)} />
                <Input label="Emergency contact relationship" required value={draft.emergencyContactRelationship} onChange={(event) => update('emergencyContactRelationship', event.currentTarget.value)} />
                <Input label="Emergency contact phone" required value={draft.emergencyContactPhone} onChange={(event) => update('emergencyContactPhone', event.currentTarget.value)} />
              </div>
            </Card>

            <Card title="Employment and bank details">
              <div className="form-grid two">
                <Select label="Employment type" required value={draft.employmentType} onChange={(event) => update('employmentType', event.currentTarget.value)} options={[
                  { label: 'Select employment type', value: '' },
                  { label: 'Full-time', value: 'Full-time' },
                  { label: 'Part-time', value: 'Part-time' },
                  { label: 'Casual', value: 'Casual' },
                  { label: 'Fixed term', value: 'Fixed term' },
                  { label: 'Contractor', value: 'Contractor' }
                ]} />
                <Select label="Pay type" required value={draft.payType} onChange={(event) => update('payType', event.currentTarget.value)} options={[
                  { label: 'Select pay type', value: '' },
                  { label: 'Hourly', value: 'Hourly' },
                  { label: 'Salary', value: 'Salary' },
                  { label: 'Contractor invoice', value: 'Contractor invoice' }
                ]} />
                <Input label="Pay rate" value={draft.payRate} onChange={(event) => update('payRate', event.currentTarget.value)} placeholder="Example: 32.50" />
                <Input label="Award / classification" value={draft.payAward} onChange={(event) => update('payAward', event.currentTarget.value)} />
                <Input label="Bank account name" required value={draft.bankAccountName} onChange={(event) => update('bankAccountName', event.currentTarget.value)} />
                <Input label="BSB" required value={draft.bankBsb} onChange={(event) => update('bankBsb', event.currentTarget.value)} placeholder="000-000" />
                <Input label="Account number" required value={draft.bankAccountNumber} onChange={(event) => update('bankAccountNumber', event.currentTarget.value)} />
              </div>
            </Card>

            {onboardingSettings.taxDeclaration.enabled ? (
              <Card title={onboardingSettings.taxDeclaration.label} subtitle={onboardingSettings.taxDeclaration.description}>
                <div className="form-grid two">
                  <Input
                    label="Tax file number"
                    required={onboardingSettings.taxDeclaration.required}
                    value={draft.taxFileNumber}
                    onChange={(event) => update('taxFileNumber', event.currentTarget.value)}
                  />
                  <Select
                    label="Tax residency status"
                    required={onboardingSettings.taxDeclaration.required}
                    value={draft.taxResidencyStatus}
                    onChange={(event) => update('taxResidencyStatus', event.currentTarget.value)}
                    options={[
                      { label: 'Select tax residency', value: '' },
                      { label: 'Australian resident for tax purposes', value: 'Australian resident for tax purposes' },
                      { label: 'Foreign resident for tax purposes', value: 'Foreign resident for tax purposes' },
                      { label: 'Working holiday maker', value: 'Working holiday maker' }
                    ]}
                  />
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={draft.taxFreeThreshold} onChange={(event) => update('taxFreeThreshold', event.currentTarget.checked)} />
                  Claim the tax-free threshold
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={draft.hasStudyTrainingLoan} onChange={(event) => update('hasStudyTrainingLoan', event.currentTarget.checked)} />
                  Has HELP, VSL, FS, SSL or TSL debt
                </label>
              </Card>
            ) : null}

            {onboardingSettings.superannuationChoice.enabled ? (
              <Card title={onboardingSettings.superannuationChoice.label} subtitle={onboardingSettings.superannuationChoice.description}>
                <div className="form-grid two">
                  <Input
                    label="Super fund name"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundName}
                    onChange={(event) => update('superFundName', event.currentTarget.value)}
                  />
                  <Input
                    label="Super fund ABN"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundAbn}
                    onChange={(event) => update('superFundAbn', event.currentTarget.value)}
                  />
                  <Input
                    label="Super fund USI"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundUsi}
                    onChange={(event) => update('superFundUsi', event.currentTarget.value)}
                  />
                  <Input
                    label="Super member number"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superMemberNumber}
                    onChange={(event) => update('superMemberNumber', event.currentTarget.value)}
                  />
                </div>
              </Card>
            ) : null}

            <Card title="Visa and work rights">
              <div className="form-grid two">
                <Select label="Visa / work rights status" required value={draft.visaStatus} onChange={(event) => update('visaStatus', event.currentTarget.value)} options={[
                  { label: 'Select work rights', value: '' },
                  { label: 'Australian citizen', value: 'Australian citizen' },
                  { label: 'Australian permanent resident', value: 'Australian permanent resident' },
                  { label: 'New Zealand citizen', value: 'New Zealand citizen' },
                  { label: 'Visa holder', value: 'Visa holder' },
                  { label: 'Working holiday visa', value: 'Working holiday visa' },
                  { label: 'Student visa', value: 'Student visa' },
                  { label: 'Other / needs review', value: 'Other / needs review' }
                ]} />
                <Input label="Visa subclass" value={draft.visaSubclass} onChange={(event) => update('visaSubclass', event.currentTarget.value)} />
                <Input label="Visa expiry date" type="date" value={draft.visaExpiryDate} onChange={(event) => update('visaExpiryDate', event.currentTarget.value)} />
              </div>
              <Textarea label="Work rights notes" rows={2} value={draft.workRightsNotes} onChange={(event) => update('workRightsNotes', event.currentTarget.value)} />
            </Card>

            {draft.documents.length ? (
              <Card title="Onboarding documents" subtitle="Upload any required documents and optional confirmations you want managers to review.">
                <div className="page-stack compact">
                  {draft.documents.map((document, index) => (
                    <div key={document.key} className="invite-row">
                      <span>
                        <strong>{document.title}</strong>
                        <span className="subtle">{document.hint}</span>
                        {document.documentName ? <span className="subtle">{document.documentName}</span> : null}
                      </span>
                      <span className="invite-row-actions">
                        <input
                          aria-label={`Upload ${document.title}`}
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (!file) return;
                            void readOnboardingUpload(file)
                              .then((upload) => updateDocument(index, { documentName: upload.name, documentUrl: upload.url }))
                              .catch((uploadError) => setError(uploadError instanceof Error ? uploadError.message : 'Could not upload file'));
                          }}
                        />
                        <Badge tone={document.documentUrl ? 'positive' : document.required ? 'warning' : 'muted'}>
                          {document.documentUrl ? 'Uploaded' : document.required ? 'Required' : 'Optional'}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
            <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit">Submit for approval</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </main>
  );
}

function StaffShell() {
  const { user } = useAuth();
  const { staff, roster, loading, error, reload } = useStaffData();
  const [selectedId, setSelectedId] = useState('');
  const isStaffUser = user?.role === 'STAFF';

  useEffect(() => {
    if (!selectedId && staff[0]) setSelectedId(staff[0].id);
  }, [selectedId, staff]);

  return (
    <AppShell
      brand={<ProductLogo appId="staff" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav items={isStaffUser ? STAFF_MEMBER_NAV_ITEMS : NAV_ITEMS} />}
      topBar={<TopBarWithContext />}
    >
      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}
      {isStaffUser ? (
        <Routes>
          <Route path="/" element={<StaffMemberHome staff={staff} roster={roster} loading={loading} reload={reload} />} />
          <Route path="/academy" element={<StaffMemberAcademyPage staff={staff} loading={loading} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<StaffMemberTipsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<StaffHome staff={staff} loading={loading} onSelect={setSelectedId} reload={reload} />} />
          <Route path="/invites" element={<InvitesPage staff={staff} reloadStaff={reload} />} />
          <Route path="/approvals" element={<ApprovalsPage staff={staff} reload={reload} />} />
          <Route path="/settings" element={<AdminPage staff={staff} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} />} />
          <Route path="/admin" element={<Navigate to="/settings" replace />} />
          <Route path="/access" element={<AccessPage staff={staff} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} />} />
          <Route path="/roster" element={<RosterPage staff={staff} roster={roster} reload={reload} />} />
          <Route path="/academy" element={<TrainingPage staff={staff} reloadStaff={reload} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<TipsPage staff={staff} />} />
        </Routes>
      )}
    </AppShell>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="full-page-loader">
        <Spinner label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding/:token" element={<PublicOnboardingPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <StaffShell />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
