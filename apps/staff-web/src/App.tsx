import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { HubLayout, type HubTab } from './components/HubTabs';
import type {
  AppSettingsPayload,
  AlmaAppId,
  DeviceStaffListResponse,
  DeviceStaffOption,
  MarketingContentDashboardSummary,
  MarketingSocialAccount,
  OnboardingSettings,
  OnboardingStepSettings,
  RosterShift,
  ShiftTaskAssignment,
  ShiftTaskListResponse,
  StaffAppAccessStatus,
  StaffComplianceRecord,
  StaffClockStatusPayload,
  StaffDailyHomePayload,
  StaffTipHistory,
  StaffProfile,
  StaffRoleTemplate,
  StaffRecordType,
  StaffDefaults,
  StaffHrRecord,
  StaffLeaveRequest,
  StaffLeaveType,
  StaffManagementEvent,
  StaffMyRosterPayload,
  StaffOpenShift,
  StaffAwardEmploymentType,
  ManualFullTimePayFrequency,
  StaffPayProfileInput,
  StaffTrainingStatus,
  SuiteAnnouncement,
  StaffTrainingRecord,
  StartAssignedChecklistResult,
  SocialPlatform,
  TrainingOverview
} from '@alma/shared';
import {
  AWARD_RATE_SETS,
  DEFAULT_STAFF_AWARD_CODE,
  DEFAULT_STAFF_AWARD_CLASSIFICATION,
  DEFAULT_STAFF_DEFAULTS,
  DEFAULT_ONBOARDING_SETTINGS,
  normaliseOnboardingSettings,
  normaliseStaffDefaults
} from '@alma/shared';
import {
  ActionFeedback,
  AppShell,
  Badge,
  Button,
  Card,
  CapIcon,
  DocumentIcon,
  EmptyState,
  GearIcon,
  Input,
  PageHeader,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  accessibleSuiteApps,
  SuiteClock,
  SuiteInboxWidget,
  Textarea,
  ThemeToggle,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { SuiteSignOutButton, TaskBar, type TaskBarItem } from '@alma/ui';
import { LoginPage } from './LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './PasswordRecoveryPages';
import { api, apiBlob, apiQueued, createSuiteHandoffUrl, flushQueue, queuedRequestCount } from './lib/api';
import { currentEndpoint, disablePush, enablePush, pushReadiness, type PushReadiness } from './lib/push.js';
import { AuthProvider, useAuth } from './lib/auth';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import {
  startOfWeek,
  addDays,
  timeOf,
  toDateInput,
  formatRange,
  shiftHours,
  roundHours,
  uniqueValues,
  formatCents
} from './lib/datetime';
import { COMPLIANCE_WEB_URL, STOCK_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import {
  IconBriefcase,
  IconCalendarCheck,
  IconCalendarClock,
  IconChecklist,
  IconClock,
  IconDashboard,
  IconFileLock,
  IconFileText,
  IconIssues,
  IconMail,
  IconPackageCheck,
  IconTemperature,
  IconUsers,
  IconWallet
} from '../../web/src/lib/icons';
import {
  STAFF_APPS,
  VENUE_OPTIONS,
  ROSTER_CLOSED_DAYS_STORAGE_KEY,
  ROSTER_AREA_SETTINGS_STORAGE_KEY,
  LEAVE_TYPE_OPTIONS,
  type RosterAreaSettings,
  staffPermissions,
  canAccessSettings,
  canManageCommunications,
  type StaffDraft,
  emptyStaffDraft,
  draftFromStaff,
  staffPayloadFromDraft,
  StaffModal,
  roleTemplateAccessSummary,
  StaffProfileForm,
  staffInitials,
  type StaffDocumentPromptAction,
  hrTypeLabel,
  hrStatusTone,
  leaveStatusTone,
  leaveTypeLabel,
  leaveStatusLabel,
  weekDays,
  rosterClosedDaysScopeKey,
  loadRosterClosedDays,
  normaliseRosterAreaName,
  normaliseRosterAreaKey,
  loadRosterAreaSettings,
  uniqueRosterAreaNames,
  mergeRosterAreas,
  areaStyle,
  StaffDocumentActionPrompt,
  STAFF_DOCUMENT_ACCEPT,
  readOnboardingUpload,
  StaffDocumentViewLink,
  staffComplianceDocumentRecord,
  recordDocumentRequested,
  staffRecordStatusTone,
  staffRecordStatusLabel,
  formatDateTime
} from './pages/shared';

// Pages a floor staff member never opens load on demand. Every page used
// to ship in one chunk, so opening the app on a phone downloaded the roster
// builder, tips, timesheets and the HR workspace before the home screen
// could paint. The staff-member pages stay in this chunk: they are the app.
const RosterPage = lazy(() => import('./pages/RosterPage').then((m) => ({ default: m.RosterPage })));
const TimesheetsPage = lazy(() => import('./pages/TimesheetsPage').then((m) => ({ default: m.TimesheetsPage })));
const TipsPage = lazy(() => import('./pages/TipsPage').then((m) => ({ default: m.TipsPage })));
const CommunicationsPage = lazy(() => import('./pages/CommunicationsPage').then((m) => ({ default: m.CommunicationsPage })));
const ApprovalsPage = lazy(() => import('./pages/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })));
const LeaveCalendarPage = lazy(() => import('./pages/LeaveCalendarPage').then((m) => ({ default: m.LeaveCalendarPage })));
const TrainingPage = lazy(() => import('./pages/TrainingPage').then((m) => ({ default: m.TrainingPage })));
const HrSectionPage = lazy(() => import('./pages/HrSectionPage').then((m) => ({ default: m.HrSectionPage })));
const HrOverviewPage = lazy(() => import('./pages/HrOverviewPage').then((m) => ({ default: m.HrOverviewPage })));
const InvitesPage = lazy(() => import('./pages/InvitesPage').then((m) => ({ default: m.InvitesPage })));
const ManagerDashboardPage = lazy(() => import('./pages/ManagerDashboardPage').then((m) => ({ default: m.ManagerDashboardPage })));
const ManagerDailyBriefPage = lazy(() => import('./pages/ManagerDailyBriefPage').then((m) => ({ default: m.ManagerDailyBriefPage })));
const VenueReadinessPage = lazy(() => import('./pages/VenueReadinessPage').then((m) => ({ default: m.VenueReadinessPage })));
const LabourPage = lazy(() => import('./pages/LabourPage').then((m) => ({ default: m.LabourPage })));
const PublicOnboardingPage = lazy(() => import('./pages/PublicOnboardingPage').then((m) => ({ default: m.PublicOnboardingPage })));
const StaffHome = lazy(() => import('./pages/StaffHome').then((m) => ({ default: m.StaffHome })));
const StaffProfilesPage = lazy(() => import('./pages/StaffProfilesPage').then((m) => ({ default: m.StaffProfilesPage })));

const suiteApps = withSuiteAppLinks(SUITE_APPS);

const SUITE_APP_ACCESS_MAP: Partial<Record<(typeof suiteApps)[number]['id'], AlmaAppId>> = {
  compliance: 'COMPLIANCE',
  stock: 'STOCK',
  staff: 'STAFF',
  reports: 'REPORTS',
  reserve: 'RESERVE',
  marketing: 'MARKETING',
  giftcards: 'GIFTCARDS',
  training: 'TRAINING',
  academy: 'TRAINING',
  settings: 'SETTINGS'
};

const STAFF_PROFILE_PRESETS: Array<{
  id: string;
  label: string;
  roleTitle: string;
  employmentType: string;
  appAccess: Partial<Record<AlmaAppId, { status: StaffAppAccessStatus; role: string; permissions?: Record<string, boolean> }>>;
}> = [
  {
    id: 'staff',
    label: 'Staff',
    roleTitle: 'Staff',
    employmentType: 'Casual',
    appAccess: {
      STAFF: { status: 'ENABLED', role: 'USER', permissions: { staffSelfView: true, timesheetsSubmit: true, tipsViewOwn: true, chatTeam: true } },
      TRAINING: { status: 'ENABLED', role: 'USER', permissions: { academyViewOwn: true } },
      SETTINGS: { status: 'DISABLED', role: 'USER' }
    }
  },
  {
    id: 'manager',
    label: 'Manager',
    roleTitle: 'Manager',
    employmentType: 'Salaried',
    appAccess: {
      COMPLIANCE: { status: 'ENABLED', role: 'MANAGER', permissions: { issuesManage: true, checklistsManage: true, documentsView: true } },
      STOCK: { status: 'ENABLED', role: 'MANAGER', permissions: { stockCount: true, stockItemsManage: true, suppliersManage: true } },
      STAFF: { status: 'ENABLED', role: 'MANAGER', permissions: { staffView: true, rosterManage: true, timesheetsApprove: true, tipsManage: true, chatTeam: true, chatDirect: true, announcementsManage: true } },
      REPORTS: { status: 'ENABLED', role: 'USER', permissions: { reportsView: true } },
      SETTINGS: { status: 'DISABLED', role: 'USER' }
    }
  },
  {
    id: 'venue-manager',
    label: 'Venue Manager',
    roleTitle: 'Venue Manager',
    employmentType: 'Salaried',
    appAccess: {
      COMPLIANCE: { status: 'ENABLED', role: 'MANAGER', permissions: { issuesManage: true, checklistsManage: true, auditsManage: true, licencesManage: true, temperaturesManage: true, documentsView: true } },
      STOCK: { status: 'ENABLED', role: 'MANAGER', permissions: { stockCount: true, stockItemsManage: true, suppliersManage: true, recipesManage: true, stockSettings: true } },
      STAFF: { status: 'ENABLED', role: 'MANAGER', permissions: { staffView: true, staffEdit: true, rosterManage: true, rosterPublish: true, timesheetsApprove: true, tipsManage: true, chatTeam: true, chatDirect: true, chatModerate: true, announcementsManage: true, communicationsManage: true } },
      REPORTS: { status: 'ENABLED', role: 'MANAGER', permissions: { reportsView: true, forecastManage: true, payrollExport: true } },
      RESERVE: { status: 'ENABLED', role: 'MANAGER', permissions: { reserveDiary: true, reserveManage: true, reserveSettings: true } },
      MARKETING: { status: 'ENABLED', role: 'USER', permissions: { marketingView: true, campaignsDraft: true } },
      GIFTCARDS: { status: 'ENABLED', role: 'MANAGER', permissions: { giftcardsSell: true, giftcardsRedeem: true, giftcardsVoid: true } },
      SETTINGS: { status: 'DISABLED', role: 'USER' }
    }
  },
  {
    id: 'head-chef',
    label: 'Head Chef',
    roleTitle: 'Head Chef',
    employmentType: 'Salaried',
    appAccess: {
      COMPLIANCE: { status: 'ENABLED', role: 'MANAGER', permissions: { checklistsManage: true, auditsManage: true, temperaturesManage: true, documentsView: true } },
      STOCK: { status: 'ENABLED', role: 'MANAGER', permissions: { stockCount: true, stockItemsManage: true, suppliersManage: true, recipesManage: true, cogsView: true } },
      STAFF: { status: 'ENABLED', role: 'MANAGER', permissions: { rosterView: true, rosterAreaManage: true, academyAssign: true, chatTeam: true, chatDirect: true } },
      REPORTS: { status: 'ENABLED', role: 'USER', permissions: { reportsView: true, cogsView: true } },
      SETTINGS: { status: 'DISABLED', role: 'USER' }
    }
  },
  {
    id: 'admin',
    label: 'Admin',
    roleTitle: 'Administrator',
    employmentType: 'Salaried',
    appAccess: {
      COMPLIANCE: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      STOCK: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      STAFF: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      REPORTS: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      RESERVE: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      MARKETING: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      GIFTCARDS: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      TRAINING: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } },
      SETTINGS: { status: 'ENABLED', role: 'ADMIN', permissions: { admin: true } }
    }
  }
];

const ACCESS_PERMISSION_GROUPS: Partial<Record<AlmaAppId, Array<{ key: string; label: string }>>> = {
  COMPLIANCE: [
    { key: 'issuesManage', label: 'Manage issues' },
    { key: 'checklistsManage', label: 'Manage checklists' },
    { key: 'auditsManage', label: 'Manage audits' },
    { key: 'licencesManage', label: 'Manage licences' },
    { key: 'temperaturesManage', label: 'Manage temperatures' },
    { key: 'documentsView', label: 'View document register' }
  ],
  STOCK: [
    { key: 'stockCount', label: 'Perform stocktakes' },
    { key: 'stockItemsManage', label: 'Manage items' },
    { key: 'suppliersManage', label: 'Manage suppliers' },
    { key: 'recipesManage', label: 'Manage recipes' },
    { key: 'cogsView', label: 'View COGS' },
    { key: 'stockSettings', label: 'Stock settings' }
  ],
  STAFF: [
    { key: 'staffView', label: 'View staff' },
    { key: 'staffEdit', label: 'Edit staff profiles' },
    { key: 'staffHrView', label: 'View HR records' },
    { key: 'staffHrManage', label: 'Manage HR records' },
    { key: 'staffHrRightToWork', label: 'Right-to-work HR records' },
    { key: 'staffHrPayChanges', label: 'Pay-change HR records' },
    { key: 'rosterView', label: 'View roster' },
    { key: 'rosterManage', label: 'Manage roster' },
    { key: 'rosterPublish', label: 'Publish roster' },
    { key: 'timesheetsSubmit', label: 'Submit timesheets' },
    { key: 'timesheetsApprove', label: 'Approve timesheets' },
    { key: 'tipsViewOwn', label: 'View own tips' },
    { key: 'tipsManage', label: 'Manage tips' },
    { key: 'academyAssign', label: 'Assign Academy' },
    { key: 'chatTeam', label: 'Use team chat' },
    { key: 'chatDirect', label: 'Direct message staff' },
    { key: 'chatModerate', label: 'Moderate chats' },
    { key: 'announcementsManage', label: 'Manage announcements' },
    { key: 'communicationsManage', label: 'Manage all communications' }
  ],
  REPORTS: [
    { key: 'reportsView', label: 'View reports' },
    { key: 'forecastManage', label: 'Manage forecast' },
    { key: 'payrollExport', label: 'Payroll export' },
    { key: 'cogsView', label: 'View COGS' }
  ],
  RESERVE: [
    { key: 'reserveDiary', label: 'View diary' },
    { key: 'reserveManage', label: 'Manage bookings' },
    { key: 'reserveSettings', label: 'Reserve settings' }
  ],
  MARKETING: [
    { key: 'marketingView', label: 'View marketing' },
    { key: 'campaignsDraft', label: 'Draft campaigns' },
    { key: 'campaignsSend', label: 'Send campaigns' }
  ],
  GIFTCARDS: [
    { key: 'giftcardsSell', label: 'Sell gift cards' },
    { key: 'giftcardsRedeem', label: 'Redeem gift cards' },
    { key: 'giftcardsVoid', label: 'Void/refund note' }
  ],
  TRAINING: [
    { key: 'academyViewOwn', label: 'View own Academy' },
    { key: 'academyAssign', label: 'Assign Academy' },
    { key: 'academyManage', label: 'Manage modules' }
  ],
  SETTINGS: [
    { key: 'admin', label: 'Full admin' }
  ]
};

/**
 * What a person can actually do in an app, answered the way the server answers it.
 *
 * The stored `permissions` map holds overrides only. The API grants everything
 * on top of that when the app role is ADMIN — `access.role === 'ADMIN' ||
 * permissions.admin`, in staff.service.ts — and it consults permissions at all
 * only while the app is ENABLED. A screen that ticks the overrides alone
 * therefore shows someone with full admin as having no permissions whatsoever,
 * which is the exact opposite of the truth and the reason nobody could tell who
 * had what.
 */
function effectiveAccessFor(
  access: { status?: string; role?: string; permissions?: Record<string, boolean> } | undefined,
  fallbackRole: string
) {
  const role = String(access?.role ?? fallbackRole ?? '').trim();
  const permissions = access?.permissions ?? {};
  // Which blanket grant is in play, if either — they read differently to a
  // manager: one is changed by moving the level, the other by unticking a box.
  // Compared exactly, not case-insensitively, because the gates that matter do
  // the same (`access.role === 'ADMIN'`, staff.service.ts:191 and :588). Being
  // more generous here would tick boxes the server then refuses, which is the
  // same lie as the one this is fixing, pointing the other way.
  const blanket: 'role' | 'permission' | null =
    role === 'ADMIN' ? 'role' : permissions.admin ? 'permission' : null;
  return {
    role: role || '—',
    enabled: access?.status === 'ENABLED',
    blanket,
    /** On, whether that came from the level or from a tick. */
    has: (key: string) => Boolean(blanket) || Boolean(permissions[key]),
    /** On because someone ticked this one, rather than inherited. */
    isExplicit: (key: string) => Boolean(permissions[key])
  };
}

/**
 * One app's permissions, with the level that produced them stated above.
 * Shared because there are two of these screens and they had already drifted
 * into two copies of the same misleading tick logic.
 */
function AppPermissionTile({
  app,
  access,
  permissions,
  canEdit,
  saving,
  feedback,
  onToggle
}: {
  app: { id: AlmaAppId; label: string; role: string };
  access: { status?: string; role?: string; permissions?: Record<string, boolean> } | undefined;
  permissions: Array<{ key: string; label: string }>;
  canEdit: boolean;
  saving: boolean;
  feedback: ReactNode;
  onToggle: (key: string, next: boolean) => void;
}) {
  const effective = effectiveAccessFor(access, app.role);
  const granted = permissions.filter((permission) => effective.has(permission.key)).length;
  return (
    <div className="app-access-tile">
      <strong>{app.label}</strong>
      <div className="perm-level">
        <Badge tone={effective.enabled ? 'positive' : 'muted'} dot>
          {effective.enabled ? 'Enabled' : 'Disabled'}
        </Badge>
        <Badge tone={effective.blanket ? 'warning' : 'neutral'}>Level: {effective.role}</Badge>
        <Badge tone={granted ? 'info' : 'muted'}>
          {granted} of {permissions.length}
        </Badge>
      </div>
      {effective.blanket === 'role' ? (
        <span className="subtle">
          The {effective.role} level grants everything below. Change the level to take any of it away.
        </span>
      ) : effective.blanket === 'permission' ? (
        <span className="subtle">The admin permission grants everything below.</span>
      ) : null}
      {!effective.enabled ? (
        <span className="subtle">This app is off, so none of it applies until it is enabled.</span>
      ) : null}
      <div className="onboarding-toggle-row">
        {permissions.map((permission) => {
          const inherited = effective.has(permission.key) && !effective.isExplicit(permission.key);
          return (
            <label
              key={permission.key}
              className={`check-row${inherited ? ' is-inherited' : ''}`}
              title={inherited ? `Granted by the ${effective.role} level` : undefined}
            >
              <input
                type="checkbox"
                checked={effective.has(permission.key)}
                disabled={!canEdit || saving || Boolean(effective.blanket && permission.key !== 'admin')}
                onChange={(event) => onToggle(permission.key, event.currentTarget.checked)}
              />
              {permission.label}
              {inherited ? <em>via level</em> : null}
            </label>
          );
        })}
      </div>
      {feedback}
    </div>
  );
}

// Consolidated manager nav: fewer top-level items, each a hub that groups the
// related screens as in-page tabs (matching the Stock and Compliance apps).
const NAV_ITEMS = [
  {
    to: '/',
    label: 'Home',
    description: 'Staff command centre',
    icon: <IconUsers />,
    end: true
  },
  {
    // Today hub: dashboard, daily brief, readiness, and the manager's own clock.
    to: '/manager',
    label: 'Today',
    description: 'Daily brief, readiness, clock and the day at a glance',
    icon: <IconDashboard />,
    match: ['/brief', '/readiness', '/clock']
  },
  {
    // Roster & pay hub: roster, leave, timesheets and tips — the scheduling and
    // labour-cost workflow in one place.
    to: '/roster',
    label: 'Roster & pay',
    description: 'Roster, leave, timesheets, tips and labour',
    icon: <IconCalendarClock />,
    match: ['/leave', '/timesheets', '/tips', '/labour']
  },
  {
    // People hub: profiles, invites, approvals and HR records.
    to: '/profiles',
    label: 'People',
    description: 'Profiles, onboarding invites, approvals and HR records',
    icon: <IconFileText />,
    match: ['/invites', '/approvals', '/hr', '/staff']
  },
  {
    // Compliance & training hub: certifications and the Academy.
    to: '/compliance',
    label: 'Compliance',
    description: 'Staff compliance reminders and Academy training',
    icon: <IconFileLock />,
    match: ['/academy']
  },
  {
    // The standalone Comms app is gone; the board it existed for lives here.
    to: '/noticeboard',
    label: 'Noticeboard',
    description: 'Notices from managers, pinned for the team',
    icon: <IconMail />
  },
  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Policies and guides sent to every new starter',
    icon: <DocumentIcon />
  },
  {
    to: '/settings',
    label: 'Staff settings',
    description: 'Staff defaults, onboarding and access',
    icon: <GearIcon />
  }
];

// Manager "Today" hub tabs — the manager dashboard, daily brief and venue
// readiness were three separate overview screens; they're now one hub.
const TODAY_TABS: HubTab[] = [
  { to: '/manager', label: 'Today', end: true },
  { to: '/brief', label: 'Daily brief' },
  { to: '/readiness', label: 'Readiness' },
  { to: '/clock', label: 'Clock' }
];

// Roster & pay hub — roster, leave, timesheets and tips all share the week
// selector and form the labour-cost workflow.
const ROSTER_PAY_TABS: HubTab[] = [
  { to: '/roster', label: 'Roster' },
  // Managers work shifts too. Without this they reach the roster they BUILD
  // and never the one they are ON — which also put their own calendar feed
  // and roster notifications out of reach entirely, since both live on the
  // personal page.
  { to: '/my-roster', label: 'My shifts' },
  { to: '/leave', label: 'Leave' },
  { to: '/timesheets', label: 'Timesheets' },
  { to: '/tips', label: 'Tips' },
  { to: '/labour', label: 'Labour' }
];

// People hub — profiles, onboarding invites and approvals. HR is appended at
// render time only when the viewer has HR access.
const PEOPLE_TABS_BASE: HubTab[] = [
  { to: '/profiles', label: 'Profiles', end: true },
  { to: '/invites', label: 'Invites' },
  { to: '/approvals', label: 'Approvals' }
];

const COMPLIANCE_TABS: HubTab[] = [
  { to: '/compliance', label: 'Compliance', end: true },
  { to: '/academy', label: 'Academy' }
];

// HR is access-gated, so only show it as a People tab when the viewer can open it.
function peopleTabsFor(canOpenHr: boolean): HubTab[] {
  return canOpenHr ? [...PEOPLE_TABS_BASE, { to: '/hr', label: 'HR' }] : PEOPLE_TABS_BASE;
}

const STAFF_MEMBER_NAV_ITEMS = [
  {
    to: '/',
    label: 'Home',
    description: 'Today, clocking, reminders and announcements',
    icon: <IconDashboard />,
    end: true
  },
  {
    to: '/clock',
    label: 'Clock',
    description: 'Clock in, out and breaks',
    icon: <IconClock />
  },
  {
    to: '/roster',
    label: 'Roster',
    description: 'My upcoming and past shifts',
    icon: <IconCalendarClock />
  },
  {
    to: '/availability',
    label: 'Availability',
    description: 'When you can and cannot work',
    icon: <IconCalendarCheck />
  },
  {
    to: '/leave',
    label: 'Leave',
    description: 'Request leave and view approvals',
    icon: <IconCalendarCheck />
  },
  {
    to: '/academy',
    label: 'Academy',
    description: 'Training, modules and certifications',
    icon: <CapIcon />
  },
  {
    to: '/timesheets',
    label: 'Timesheets',
    description: 'View and submit your timesheets',
    icon: <IconFileText />
  },
  {
    to: '/tips',
    label: 'Tips',
    description: 'View your tip history and entitlements',
    icon: <IconWallet />
  },
  {
    to: '/my-pay',
    label: 'My pay',
    description: 'Your pay rate, employment type and setup',
    icon: <IconBriefcase />
  },
  {
    to: '/compliance',
    label: 'My compliance',
    description: 'My documents, training and reminders',
    icon: <IconFileLock />
  },
  // The jobs that used to mean leaving for another site.
  {
    to: '/checks',
    label: "Today's checks",
    description: 'Opening, closing and food safety checklists',
    icon: <IconChecklist />
  },
  {
    to: '/temperatures',
    label: 'Fridge temps',
    description: 'Log a probe reading',
    icon: <IconTemperature />
  },
  {
    to: '/report',
    label: 'Report a problem',
    description: 'Something broken, unsafe or not right',
    icon: <IconIssues />
  },
  {
    to: '/stocktake',
    label: 'Stocktake',
    description: 'Count stock',
    icon: <IconPackageCheck />
  },
  {
    to: '/documents',
    label: 'Documents',
    description: 'Requests and uploads',
    icon: <DocumentIcon />
  },
  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Policies and guides, the ones you were emailed when you joined',
    icon: <DocumentIcon />
  },
  {
    to: '/communications',
    label: 'Comms',
    description: 'Announcements, messages and channels',
    icon: <IconMail />
  }
];

const DEVICE_NAV_ITEMS = [
  {
    to: '/device',
    label: 'Device',
    description: 'Switch staff user with PIN',
    icon: <IconUsers />,
    end: true
  }
];

const MARKETING_SOCIAL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'];

function RosterCollapsiblePanel({
  title,
  summary,
  open,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`roster-control-panel ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="roster-control-panel-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>{title}</span>
        <small>{summary}</small>
      </button>
      {open ? <div className="roster-control-panel-body">{children}</div> : null}
    </section>
  );
}

function canManageRosterAreas(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      user.role === 'MANAGER' ||
      permissions.admin ||
      permissions.rosterAreaManage)
  );
}

function canAccessStaffHr(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    user.role !== 'STAFF' &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      permissions.admin ||
      permissions.staffHrView ||
      permissions.staffHrManage)
  );
}

function canManageStaffHr(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    user.role !== 'STAFF' &&
    (user.isAdmin || user.role === 'ADMIN' || permissions.admin || permissions.staffHrManage)
  );
}

function canAccessRightToWorkHr(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    user.role !== 'STAFF' &&
    (user.isAdmin || user.role === 'ADMIN' || permissions.admin || permissions.staffHrRightToWork)
  );
}

function canAccessPayChangeHr(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    user.role !== 'STAFF' &&
    (user.isAdmin || user.role === 'ADMIN' || permissions.admin || permissions.staffHrPayChanges)
  );
}

// A pay change must be approved by an admin who didn't draft it (separation of duties).
// Anyone with the pay-changes permission can draft and submit; only admins can approve.
function canApprovePayChange(user: ReturnType<typeof useAuth>['user']) {
  return Boolean(user && (user.isAdmin || user.role === 'ADMIN'));
}

function navItemsForUser(user: ReturnType<typeof useAuth>['user']) {
  if (user?.accountType === 'VENUE_DEVICE') return DEVICE_NAV_ITEMS;
  if (user?.role === 'STAFF') {
    const hasStock =
      Boolean((user as { isAdmin?: boolean }).isAdmin) ||
      ((user as { appAccess?: Array<{ appId: string; status: string }> }).appAccess ?? []).some(
        (access) => access.appId === 'STOCK' && access.status === 'ENABLED'
      );
    return hasStock ? STAFF_MEMBER_NAV_ITEMS : STAFF_MEMBER_NAV_ITEMS.filter((item) => item.to !== '/stocktake');
  }
  const items = canAccessSettings(user)
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.to !== '/settings' && item.to !== '/admin');
  return canAccessStaffHr(user) ? items : items.filter((item) => item.to !== '/hr');
}

function suiteAppsForUser(user: ReturnType<typeof useAuth>['user']) {
  // Shared, manager-safe access filter: admins + managers see every app, only
  // STAFF are scoped to the apps enabled on their profile.
  return accessibleSuiteApps(user, suiteApps);
}

function TopBarWithContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, refresh, user } = useAuth();
  const navItems = navItemsForUser(user);
  const active = currentPage(location.pathname, navItems);
  useDocumentTitle(active.label);

  // Casual staff get a simpler topbar — they don't switch apps (they only
  // have access to Staff anyway) and they don't post announcements.
  // Strip back to: Messages · Alerts · Sign out. Managers and admins still
  // see the full toolkit.
  const isCasualStaff = user?.role === 'STAFF';

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        user ? (
          <>
            {user.deviceAccount ? (
              <div className="staff-device-active-user">
                <span>Using as {user.firstName}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await api('/api/device/pin-logout', { method: 'POST' });
                    await refresh();
                    navigate('/device', { replace: true });
                  }}
                >
                  Lock
                </Button>
              </div>
            ) : null}
            {!isCasualStaff ? (
              <>
                <SuiteAppSwitcher currentApp="staff" apps={suiteAppsForUser(user)} variant="topbar" />
              </>
            ) : null}
            <SuiteInboxWidget
              appId="STAFF"
              api={api}
              currentApp="staff"
              venue={user.venue}
              userName={`${user.firstName} ${user.lastName}`}
              canAnnounce={canManageCommunications(user)}
            />
            <ThemeToggle />
            <SuiteClock />
            <SuiteSignOutButton className="staff-topbar-signout" onClick={() => logout()} />
          </>
        ) : null
      }
    />
  );
}

// A nav item is active for its own route AND any hub sub-route listed in match[]
// (e.g. the "Roster & pay" hub lights up on /leave, /timesheets, /tips).
function staffNavMatches(item: { to: string; match?: string[] }, pathname: string): boolean {
  const candidates = [item.to, ...(item.match ?? [])];
  return candidates.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
  );
}

function currentPage(pathname: string, items = NAV_ITEMS) {
  return (
    [...items]
      .sort((a, b) => b.to.length - a.to.length)
      .find((item) => staffNavMatches(item, pathname)) ?? {
      to: pathname,
      label: 'Page not found',
      description: "The URL didn't match any section",
      icon: null
    }
  );
}

/**
 * The handful of destinations a staff member opens every shift.
 *
 * The mobile nav is a dropdown: tap to open, tap to choose. Fine for a
 * settings page nobody visits twice, wrong for clocking on — which happens
 * twice a day, in a doorway, usually late. A bottom bar makes the things that
 * actually get used one tap from anywhere, and puts them where a thumb
 * already is.
 *
 * Paths not in a person's nav are dropped rather than shown broken, so a
 * manager and a casual get different bars from the same component.
 */
const BOTTOM_TAB_PATHS = ['/', '/clock', '/roster', '/checks'] as const;

/**
 * A standing note that something is waiting to send.
 *
 * A queue you cannot see is a queue you find out about at the pay run. This
 * sits above everything until it drains, and offers to try now rather than
 * making someone guess whether the app is stuck.
 */
function OfflineQueueBanner() {
  const [pending, setPending] = useState(() => queuedRequestCount());
  const [trying, setTrying] = useState(false);

  useEffect(() => {
    // Cheap poll: localStorage has no change event within the same tab, and
    // the count only moves when the person acts or the connection returns.
    const timer = window.setInterval(() => setPending(queuedRequestCount()), 3000);
    return () => window.clearInterval(timer);
  }, []);

  if (pending === 0) return null;

  return (
    <div className="offline-banner" role="status">
      <span>
        {pending} {pending === 1 ? 'thing' : 'things'} saved on this phone, waiting for a connection.
      </span>
      <button
        type="button"
        disabled={trying}
        onClick={async () => {
          setTrying(true);
          await flushQueue();
          setPending(queuedRequestCount());
          setTrying(false);
        }}
      >
        {trying ? 'Trying…' : 'Try now'}
      </button>
    </div>
  );
}

/**
 * The jobs staff actually open the app to do, in the order they reach for them.
 *
 * The bar used to carry the app's four sections. Sections are how the app is
 * organised; they are not what somebody is holding their phone to do. A closing
 * shift wants Clock, a rostered week wants Leave, and neither wants to go
 * through a menu to find it. Everything past the first five sits behind More.
 *
 * One list covers both managers and floor staff: whatever the person's own nav
 * does not contain is simply dropped, so nobody is offered a screen they cannot
 * open.
 */
const TASK_ORDER: Array<{ to: string; label: string }> = [
  { to: '/', label: 'Home' },
  { to: '/clock', label: 'Clock' },
  { to: '/manager', label: 'Today' },
  { to: '/roster', label: 'Roster' },
  { to: '/leave', label: 'Leave' },
  { to: '/checks', label: 'Checks' },
  { to: '/profiles', label: 'People' },
  { to: '/availability', label: 'Availability' },
  { to: '/timesheets', label: 'Timesheets' },
  { to: '/tips', label: 'Tips' },
  { to: '/my-pay', label: 'My pay' },
  { to: '/temperatures', label: 'Temps' },
  { to: '/noticeboard', label: 'Notices' },
  { to: '/handbook', label: 'Handbook' },
  { to: '/academy', label: 'Academy' },
  { to: '/documents', label: 'Documents' },
  { to: '/compliance', label: 'Compliance' },
  { to: '/report', label: 'Report issue' },
  { to: '/stocktake', label: 'Stocktake' },
  { to: '/communications', label: 'Messages' }
];

function BottomTabs({ items }: { items: typeof NAV_ITEMS }) {
  const location = useLocation();
  const navigate = useNavigate();

  const toTask = (item: (typeof items)[number], label: string): TaskBarItem => ({
    key: item.to,
    label,
    href: item.to,
    icon: item.icon,
    active: staffNavMatches(item, location.pathname)
  });

  const ordered = TASK_ORDER.flatMap((task) => {
    const item = items.find((navItem) => navItem.to === task.to);
    return item ? [toTask(item, task.label)] : [];
  });
  // Anything this person can reach that TASK_ORDER does not name goes on the
  // end. The mobile nav dropdown is hidden on phones now that this bar exists,
  // so a screen missing from both would simply be unreachable — and the list
  // above is hand-written, which is exactly the kind of thing that goes stale.
  const named = new Set(ordered.map((task) => task.key));
  const rest = items.filter((item) => !named.has(item.to)).map((item) => toTask(item, item.label));
  const tasks: TaskBarItem[] = [...ordered, ...rest];

  // One tab is not a tab bar. Below two, the dropdown alone is less clutter.
  if (tasks.length < 2) return null;

  return (
    <TaskBar
      items={tasks}
      label="Staff actions"
      onNavigate={(item, event) => {
        // Keep it a real link for middle-click and long-press, but navigate in
        //-app on a plain tap rather than reloading the whole bundle.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(item.href);
      }}
    />
  );
}

function SidebarNav({ items = NAV_ITEMS }: { items?: typeof NAV_ITEMS }) {
  const location = useLocation();
  const active = currentPage(location.pathname, items);
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'staff-mobile-nav');

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div ref={navRef} className="mobile-nav-layer">
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
            {item.to.startsWith('http') ? (
              <a href={item.to} target="_blank" rel="noopener noreferrer" aria-label={item.label} title={item.label}>
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ) : (
              <NavLink
                to={item.to}
                end={item.end}
                className={() => (staffNavMatches(item, location.pathname) ? 'active' : undefined)}
                aria-label={item.label}
                title={item.label}
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function useStaffData() {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [roster, setRoster] = useState<RosterShift[]>([]);
  const [roleTemplates, setRoleTemplates] = useState<StaffRoleTemplate[]>([]);
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
      const [staffData, rosterData, roleTemplateData] = await Promise.all([
        api<StaffProfile[]>('/api/staff'),
        api<RosterShift[]>(`/api/staff/roster${rosterQuery}`),
        api<StaffRoleTemplate[]>('/api/staff/role-templates').catch(() => [])
      ]);
      setStaff(staffData);
      setRoster(rosterData);
      setRoleTemplates(roleTemplateData);
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

  return { staff, roster, roleTemplates, loading, error, reload: load };
}

function StaffMemberHome({
  staff,
  loading,
  reload
}: {
  staff: StaffProfile[];
  loading: boolean;
  reload: (rosterStart?: Date, rosterEnd?: Date) => Promise<void>;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const member = staff.find((item) => item.id === user?.id) ?? staff[0] ?? null;
  const [home, setHome] = useState<StaffDailyHomePayload | null>(null);
  const [shiftTasks, setShiftTasks] = useState<ShiftTaskAssignment[]>([]);
  const [loadingHome, setLoadingHome] = useState(true);
  const [loadingShiftTasks, setLoadingShiftTasks] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingShiftTaskId, setStartingShiftTaskId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const loadHome = useCallback(async () => {
    setLoadingHome(true);
    setMessage(null);
    try {
      setHome(await api<StaffDailyHomePayload>('/api/staff/me/home'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your staff home.');
    } finally {
      setLoadingHome(false);
    }
  }, []);

  const loadShiftTasks = useCallback(async () => {
    setLoadingShiftTasks(true);
    try {
      const payload = await api<ShiftTaskListResponse>('/api/staff/me/shift-tasks');
      setShiftTasks(payload.tasks);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load required shift tasks.');
    } finally {
      setLoadingShiftTasks(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([loadHome(), loadShiftTasks()]);
  }, [loadHome, loadShiftTasks]);

  const activeSession = home?.clock.activeSession ?? null;
  const todayShift = home?.todayShift ?? null;
  const nextShift = home?.nextShift ?? null;
  const reminderCount = home?.complianceReminders.length ?? 0;
  const pendingLeave = (home?.upcomingLeave ?? []).filter((item) => item.status === 'PENDING').length;

  async function confirmShift(shift: RosterShift, target: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(target);
    try {
      await api(`/api/staff/me/shifts/${shift.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      await Promise.all([loadHome(), reload()]);
      setMessage('Shift confirmed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not confirm shift.');
    } finally {
      setSaving(false);
    }
  }

  async function startShiftTask(task: ShiftTaskAssignment) {
    if (task.checklistRunId) {
      window.location.assign(`${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/checklists/runs/${task.checklistRunId}`);
      return;
    }
    setStartingShiftTaskId(task.id);
    setMessage(null);
    setMessageTarget(`shift-task:${task.id}`);
    try {
      const payload = await api<StartAssignedChecklistResult>(`/api/shift-task-assignments/${task.id}/start-checklist`, {
        method: 'POST'
      });
      await loadShiftTasks();
      window.location.assign(`${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/checklists/runs/${payload.run.id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not start required task.');
    } finally {
      setStartingShiftTaskId(null);
    }
  }

  async function runClockAction(action: 'clock-in' | 'clock-out' | 'break-start' | 'break-end') {
    setSaving(true);
    setMessage(null);
    setMessageTarget('clock');
    try {
      if (action === 'clock-in') {
        // Only today's shift. `nextShift` is simply the earliest upcoming one
        // and can be days away, so falling back to it attached this morning's
        // hours to a shift next Tuesday — and roster-versus-actual then
        // compared the wrong two things. No shift now means no shift: the
        // server records an unattached session, which is the truth.
        await api('/api/staff/me/clock/in', {
          method: 'POST',
          body: JSON.stringify({ rosterShiftId: todayShift?.id || '' })
        });
      } else if (action === 'clock-out') {
        await api('/api/staff/me/clock/out', { method: 'POST', body: JSON.stringify({}) });
      } else if (action === 'break-start') {
        await api('/api/staff/me/clock/break/start', { method: 'POST', body: JSON.stringify({}) });
      } else {
        await api('/api/staff/me/clock/break/end', { method: 'POST', body: JSON.stringify({}) });
      }
      await Promise.all([loadHome(), reload()]);
      setMessage(
        action === 'clock-in'
          ? 'Clocked in.'
          : action === 'clock-out'
            ? 'Clocked out.'
            : action === 'break-start'
              ? 'Break started.'
              : 'Break ended.'
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update clock status.');
    } finally {
      setSaving(false);
    }
  }

  if ((loading || loadingHome) && !member && !home?.member) {
    return (
      <Card>
        <Spinner label="Loading your staff home…" />
      </Card>
    );
  }

  const displayMember = home?.member ?? (member
    ? { id: member.id, firstName: member.firstName, lastName: member.lastName, roleTitle: member.roleTitle, venue: member.venue }
    : null);
  const isOnBreak = Boolean(activeSession?.currentBreakStartedAt);

  return (
    <div className="page-stack staff-daily-home">
      <PageHeader
        eyebrow="Staff daily"
        title={displayMember ? `Hi ${displayMember.firstName}` : 'Staff home'}
        description="Your shift, clock status, leave, compliance reminders, and venue announcements."
        actions={<Button type="button" variant="secondary" disabled={loadingHome || loadingShiftTasks} onClick={() => void Promise.all([loadHome(), loadShiftTasks()])}>{loadingHome || loadingShiftTasks ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <Card>
        <div className="staff-quick-clock">
          <div className="staff-quick-clock-status">
            <strong>
              {activeSession
                ? isOnBreak
                  ? `On break since ${timeOf(activeSession.currentBreakStartedAt ?? activeSession.clockInAt)}`
                  : `Clocked in at ${timeOf(activeSession.clockInAt)}`
                : 'Not clocked in'}
            </strong>
            <span className="subtle">
              {todayShift
                ? `Today ${timeOf(todayShift.startsAt)}-${timeOf(todayShift.endsAt)} · ${todayShift.area || todayShift.roleTitle || 'Shift'}`
                : 'No shift rostered today'}
            </span>
          </div>
          <div className="staff-quick-clock-actions">
            {!activeSession ? (
              <Button type="button" disabled={saving} onClick={() => void runClockAction('clock-in')}>
                {saving ? 'Saving…' : 'Clock in'}
              </Button>
            ) : isOnBreak ? (
              <>
                <Button type="button" disabled={saving} onClick={() => void runClockAction('break-end')}>
                  {saving ? 'Saving…' : 'End break'}
                </Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void runClockAction('clock-out')}>
                  Clock out
                </Button>
              </>
            ) : (
              <>
                <Button type="button" disabled={saving} onClick={() => void runClockAction('clock-out')}>
                  {saving ? 'Saving…' : 'Clock out'}
                </Button>
                <Button type="button" variant="secondary" disabled={saving} onClick={() => void runClockAction('break-start')}>
                  Start break
                </Button>
              </>
            )}
          </div>
        </div>
        <ActionFeedback
          message={messageTarget === 'clock' ? message : null}
          tone={message?.includes('Could') || message?.includes('No active') || message?.includes('already') ? 'error' : 'success'}
        />
      </Card>

      <div className="stats-grid">
        <StatCard label="Today" value={todayShift ? timeOf(todayShift.startsAt) : 'Off'} hint={todayShift ? `${todayShift.area || todayShift.roleTitle || 'Shift'} · ${todayShift.venue || displayMember?.venue || 'No venue'}` : 'No shift rostered'} loading={loadingHome} />
        <StatCard label="Next shift" value={nextShift ? new Date(nextShift.startsAt).toLocaleDateString(undefined, { weekday: 'short' }) : 'None'} hint={nextShift ? `${timeOf(nextShift.startsAt)}-${timeOf(nextShift.endsAt)}` : 'No upcoming shift'} loading={loadingHome} />
        <StatCard label="Clock" value={activeSession ? (isOnBreak ? 'On break' : 'Clocked in') : 'Off'} hint={activeSession ? `${timeOf(activeSession.clockInAt)} · ${activeSession.venue || displayMember?.venue || 'No venue'}` : 'Ready when you are'} loading={loadingHome} />
        <StatCard label="Leave" value={pendingLeave} hint={`${home?.upcomingLeave.length ?? 0} upcoming requests`} loading={loadingHome} />
        <StatCard label="Reminders" value={reminderCount} hint="Compliance and training" loading={loadingHome} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Staff launch" subtitle="Use this app for the daily basics from Monday.">
        <div className="staff-launch-panel">
          <span>View your shifts, clock in and out, take breaks, request leave, and check compliance reminders here.</span>
          <span className="subtle">If something looks wrong, speak to a manager before clocking out so the day can be fixed cleanly.</span>
        </div>
      </Card>

      <Card title="Quick actions" subtitle="Everything you’ll use most days lives here.">
        <div className="staff-quick-links">
          <Button type="button" onClick={() => navigate('/roster')}>Open roster</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/clock')}>Open clock</Button>
          <Button type="button" variant="secondary" onClick={() => navigate('/leave')}>Request leave</Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/compliance')}>Compliance</Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/documents')}>Documents</Button>
          <Button type="button" variant="ghost" onClick={() => navigate('/handbook')}>Handbook</Button>
        </div>
      </Card>

      <Card title="Today’s required tasks" subtitle="Checklist work assigned from your rostered shifts.">
        {loadingShiftTasks ? <Spinner label="Loading required tasks..." /> : null}
        {!loadingShiftTasks && shiftTasks.length === 0 ? (
          <EmptyState title="No shift tasks due" description="If a rostered opening, closing or manager task is required, it will appear here." />
        ) : null}
        {shiftTasks.length > 0 ? (
          <div className="staff-expiry-list">
            {shiftTasks.map((task) => (
              <div key={task.id} className="staff-expiry-row">
                <span>
                  <strong>{task.rule?.name || task.checklistTemplate?.name || 'Shift task'}</strong>
                  <span className="subtle">
                    {task.checklistTemplate?.name || task.taskType.replaceAll('_', ' ')} · due {task.dueAt ? new Date(task.dueAt).toLocaleString() : 'during shift'}
                  </span>
                  {task.rosterShift ? (
                    <span className="subtle">
                      {timeOf(task.rosterShift.startsAt)}-{timeOf(task.rosterShift.endsAt)} · {task.rosterShift.area || task.rosterShift.roleTitle || 'Shift'}
                    </span>
                  ) : null}
                </span>
                <span className="staff-row-actions">
                  <Badge tone={task.status === 'COMPLETED' ? 'positive' : task.status === 'IN_PROGRESS' ? 'info' : 'warning'}>
                    {task.status.replaceAll('_', ' ')}
                  </Badge>
                  {task.taskType === 'CHECKLIST' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={startingShiftTaskId === task.id}
                      onClick={() => void startShiftTask(task)}
                    >
                      {task.checklistRunId ? 'Open' : startingShiftTaskId === task.id ? 'Starting…' : 'Start'}
                    </Button>
                  ) : (
                    <Badge tone="muted">Planned</Badge>
                  )}
                  <ActionFeedback message={messageTarget === `shift-task:${task.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>

      <Card title={activeSession ? 'Clock status' : 'Ready to start'} subtitle={todayShift ? `${timeOf(todayShift.startsAt)}-${timeOf(todayShift.endsAt)} · ${todayShift.area || todayShift.roleTitle || 'Shift'}` : nextShift ? `Next: ${new Date(nextShift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${timeOf(nextShift.startsAt)}` : 'No shift linked right now'}>
        <div className="staff-clock-card staff-daily-clock-card">
          <span>
            <strong>
              {activeSession
                ? isOnBreak
                  ? `On break since ${timeOf(activeSession.currentBreakStartedAt ?? activeSession.clockInAt)}`
                  : `Clocked in at ${timeOf(activeSession.clockInAt)}`
                : todayShift
                  ? 'Ready for today’s shift'
                  : 'Clock in when you arrive'}
            </strong>
            <span className="subtle">
              {activeSession
                ? `${activeSession.venue || displayMember?.venue || 'No venue'} · ${activeSession.area || activeSession.roleTitle || 'Shift'} · ${activeSession.accumulatedBreakMinutes}m break logged`
                : todayShift
                  ? `${todayShift.venue || displayMember?.venue || 'No venue'} · ${roundHours(shiftHours(todayShift))} rostered`
                  : 'Clock-in without a linked shift is available when needed.'}
            </span>
          </span>
          <span className="staff-row-actions">
            {!activeSession ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void runClockAction('clock-in')}>
                {saving ? 'Saving…' : 'Clock in'}
              </Button>
            ) : (
              <>
                {isOnBreak ? (
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void runClockAction('break-end')}>
                    {saving ? 'Saving…' : 'End break'}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void runClockAction('break-start')}>
                    {saving ? 'Saving…' : 'Start break'}
                  </Button>
                )}
                <Button type="button" size="sm" disabled={saving} onClick={() => void runClockAction('clock-out')}>
                  {saving ? 'Saving…' : 'Clock out'}
                </Button>
              </>
            )}
          </span>
          <ActionFeedback
            message={messageTarget === 'clock' ? message : null}
            tone={message?.includes('Could') || message?.includes('No active') || message?.includes('already') ? 'error' : 'success'}
          />
        </div>
      </Card>

      <div className="staff-daily-grid">
        <Card title="Today’s shift" subtitle="Confirm it before service when manager acknowledgement is needed.">
          {todayShift ? (
            <div className="staff-mobile-shift-card staff-daily-shift-card">
              <span>
                <strong>{new Date(todayShift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                <span className="subtle">{timeOf(todayShift.startsAt)}-{timeOf(todayShift.endsAt)} · {todayShift.area || todayShift.roleTitle || 'Shift'} · {todayShift.venue || displayMember?.venue || 'No venue'}</span>
                <span className="subtle">{todayShift.breakMinutes ? `${todayShift.breakMinutes}m break` : 'No break planned'} · {todayShift.confirmation ? 'Confirmed' : 'Needs confirmation'}</span>
              </span>
              <span className="staff-row-actions">
                <Badge tone={statusTone(todayShift.status)}>{todayShift.status}</Badge>
                {!todayShift.confirmation && todayShift.status === 'PUBLISHED' ? (
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void confirmShift(todayShift, 'confirm:today')}>
                    {saving ? 'Saving…' : 'Confirm shift'}
                  </Button>
                ) : null}
                <ActionFeedback message={messageTarget === 'confirm:today' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              </span>
            </div>
          ) : (
            <EmptyState title="No shift today" description="The next published shift will still appear below." />
          )}
        </Card>

        <Card title="Next shift" subtitle="The next upcoming rostered shift.">
          {nextShift ? (
            <div className="staff-mobile-shift-card staff-daily-shift-card">
              <span>
                <strong>{new Date(nextShift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                <span className="subtle">{timeOf(nextShift.startsAt)}-{timeOf(nextShift.endsAt)} · {nextShift.area || nextShift.roleTitle || 'Shift'} · {nextShift.venue || displayMember?.venue || 'No venue'}</span>
              </span>
              <span className="staff-row-actions">
                <Badge tone={statusTone(nextShift.status)}>{nextShift.status}</Badge>
                {!nextShift.confirmation && nextShift.status === 'PUBLISHED' ? (
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void confirmShift(nextShift, 'confirm:next')}>
                    {saving ? 'Saving…' : 'Confirm shift'}
                  </Button>
                ) : null}
                <ActionFeedback message={messageTarget === 'confirm:next' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              </span>
            </div>
          ) : (
            <EmptyState title="Nothing upcoming yet" description="Published shifts will appear as soon as a manager assigns them." />
          )}
        </Card>
      </div>

      <Card title="Compliance reminders" subtitle="The things most likely to block the next shift.">
        <div className="staff-expiry-list">
          {home?.complianceReminders.length ? home.complianceReminders.map((item) => (
            <div key={item.id} className="staff-expiry-row">
              <span>
                <strong>{item.title}</strong>
                <span className="subtle">{item.detail}</span>
                {item.dueAt ? <span className="subtle">{new Date(item.dueAt).toLocaleDateString()}</span> : null}
              </span>
              <Badge tone={item.status === 'EXPIRED' ? 'danger' : item.status === 'PENDING' || item.status === 'IN_PROGRESS' ? 'warning' : 'info'}>
                {item.status.replaceAll('_', ' ')}
              </Badge>
            </div>
          )) : (
            <EmptyState title="Nothing urgent" description="Your records and training look clear right now." />
          )}
        </div>
      </Card>

      <div className="staff-daily-grid">
        <Card title="Leave" subtitle="Quick view of approved and pending leave.">
          {(home?.upcomingLeave.length ?? 0) > 0 ? (
            <div className="staff-expiry-list">
              {home?.upcomingLeave.map((item) => (
                <div key={item.id} className="staff-expiry-row">
                  <span>
                    <strong>{leaveTypeLabel(item.type)}</strong>
                    <span className="subtle">{formatRange(new Date(item.startDate), new Date(item.endDate))}</span>
                    {item.notes ? <span>{item.notes}</span> : null}
                  </span>
                  <Badge tone={leaveStatusTone(item.status)}>{leaveStatusLabel(item.status)}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No leave booked" description="Use the leave page when you need time away approved." />
          )}
        </Card>

        <Card title="Announcements" subtitle="Venue updates and team notices for Staff.">
          <div className="staff-mobile-comms-list">
            {home?.announcements.length ? home.announcements.map((announcement) => (
              <div key={announcement.id}>
                <strong>{announcement.title}</strong>
                <span>{announcement.body}</span>
                <small>{announcement.createdByName || 'ALMA'} · {formatDateTime(announcement.createdAt)}</small>
              </div>
            )) : (
              <div>
                <strong>No announcements right now</strong>
                <span className="subtle">Manager announcements will appear here when they’re published.</span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function StaffMemberRosterPage() {
  const [payload, setPayload] = useState<StaffMyRosterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  // Offering or cancelling changes what the open-shifts card should show, and
  // that card owns its own fetch. Bumping this re-pulls it.
  const [swapRefresh, setSwapRefresh] = useState(0);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const end = new Date();
      end.setDate(end.getDate() + 45);
      setPayload(await api<StaffMyRosterPayload>(`/api/staff/me/roster?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const now = new Date();
  const upcoming = (payload?.shifts ?? []).filter((shift) => new Date(shift.endsAt) >= now && shift.status !== 'CANCELLED');
  const past = (payload?.shifts ?? [])
    .filter((shift) => new Date(shift.endsAt) < now)
    .slice()
    .sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());

  async function confirmShift(shift: RosterShift) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(shift.id);
    try {
      await api(`/api/staff/me/shifts/${shift.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
      await loadRoster();
      setMessage('Shift confirmed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not confirm shift.');
    } finally {
      setSaving(false);
    }
  }

  // Offering is not dropping: the shift stays yours, and stays costed against
  // you, until a manager approves somebody taking it.
  async function offerSwap(shift: RosterShift) {
    const note = window.prompt('Anything your team should know? (optional)') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(shift.id);
    try {
      await api(`/api/staff/me/shifts/${shift.id}/offer-swap`, {
        method: 'POST',
        body: JSON.stringify({ note: note.trim() || null })
      });
      await loadRoster();
      setSwapRefresh((n) => n + 1);
      setMessage('Offered to the team. It stays yours until someone takes it.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not offer that shift.');
    } finally {
      setSaving(false);
    }
  }

  async function cancelSwap(shift: RosterShift) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(shift.id);
    try {
      await api(`/api/staff/me/shifts/${shift.id}/cancel-swap`, { method: 'POST', body: JSON.stringify({}) });
      await loadRoster();
      setSwapRefresh((n) => n + 1);
      setMessage('Taken back off the board.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not cancel that offer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Roster"
        title="My shifts"
        description="See your upcoming shifts, confirm them, and review recent past shifts."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadRoster()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <div className="stats-grid">
        <StatCard label="Upcoming" value={payload?.upcomingCount ?? 0} hint="Published and current" loading={loading} />
        <StatCard label="Past" value={payload?.pastCount ?? 0} hint="Recent history" loading={loading} />
        <StatCard label="Need confirmation" value={payload?.pendingConfirmationCount ?? 0} hint="Published future shifts" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <OpenShiftsCard onClaimApproved={loadRoster} refreshKey={swapRefresh} />

      <MyCalendarCard />

      <NotificationsCard />

      <Card title="Upcoming shifts" subtitle="Upcoming rostered shifts and confirmations." padding="none">
        {loading ? <Spinner label="Loading roster…" /> : null}
        {!loading && upcoming.length === 0 ? <EmptyState title="No upcoming shifts" description="Published shifts will appear here once they’re assigned." /> : null}
        <div className="staff-mobile-shift-list">
          {upcoming.map((shift) => (
            <div key={shift.id} className="staff-mobile-shift-card">
              <span>
                <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                <span className="subtle">{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'} · {shift.venue || shift.staffProfile?.venue || 'No venue'}</span>
                <span className="subtle">{shift.breakMinutes ? `${shift.breakMinutes}m break` : 'No break planned'} · {shift.notes || 'No extra notes'}</span>
              </span>
              <span className="staff-row-actions">
                <Badge tone={statusTone(shift.status)}>{shift.status}</Badge>
                <Badge tone={shift.confirmation ? 'positive' : 'warning'}>{shift.confirmation ? 'Confirmed' : 'Pending'}</Badge>
                {!shift.confirmation && shift.status === 'PUBLISHED' ? (
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void confirmShift(shift)}>
                    {saving ? 'Saving…' : 'Confirm'}
                  </Button>
                ) : null}
                {shift.status === 'PUBLISHED' && shift.offeredAt ? (
                  <>
                    <Badge tone="info">Offered to team</Badge>
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void cancelSwap(shift)}>
                      Take back
                    </Button>
                  </>
                ) : shift.status === 'PUBLISHED' ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void offerSwap(shift)}>
                    Offer swap
                  </Button>
                ) : null}
                <ActionFeedback message={messageTarget === shift.id ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Past shifts" subtitle="Recent completed or past rostered shifts." padding="none">
        {!loading && past.length === 0 ? <EmptyState title="No past shifts yet" description="Recent shifts will move here once they’ve passed." /> : null}
        <div className="staff-mobile-shift-list">
          {past.slice(0, 20).map((shift) => (
            <div key={shift.id} className="staff-mobile-shift-card">
              <span>
                <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</strong>
                <span className="subtle">{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'} · {shift.venue || shift.staffProfile?.venue || 'No venue'}</span>
              </span>
              <span className="staff-row-actions">
                <Badge tone={statusTone(shift.status)}>{shift.status}</Badge>
                {shift.confirmation ? <Badge tone="positive">Confirmed</Badge> : null}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <PublishedRosterView />
    </div>
  );
}

// Shifts published with nobody on them. Staff put their hand up here; a
// manager decides. Hidden entirely when there is nothing open, so the roster
// page doesn't carry a permanently empty box.
/**
 * "Put my shifts on my phone."
 *
 * A subscription, not a download. The list above is right today; the
 * subscription is still right after a manager moves a shift on Thursday, which
 * is the whole reason this exists. The download is kept as a fallback for
 * anyone whose calendar app will not take a feed.
 *
 * The link is a credential — anybody holding it can read this person's shifts —
 * so it is not shown in full until asked for, and it can be reset from here if
 * a phone goes missing.
 */
function MyCalendarCard() {
  const [links, setLinks] = useState<{ feedUrl: string; subscribeUrl: string; issuedAt: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await api<{ feedUrl: string; subscribeUrl: string; issuedAt: string | null }>('/api/staff/me/calendar'));
    } catch {
      setError('Could not get your calendar link.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function copy() {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.feedUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused — the link is on screen to copy by hand.
      setRevealed(true);
    }
  }

  async function reset() {
    setResetting(true);
    setError(null);
    try {
      const next = await api<{ feedUrl: string; subscribeUrl: string }>('/api/staff/me/calendar/rotate', {
        method: 'POST',
        body: JSON.stringify({})
      });
      setLinks({ ...next, issuedAt: new Date().toISOString() });
      setRevealed(true);
    } catch {
      setError('Could not reset the link.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card
      title="My shifts on my phone"
      subtitle="Add it once. When a shift moves, your calendar moves with it."
    >
      {loading ? <Spinner label="Getting your link…" /> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {links ? (
        <>
          <div className="staff-calendar-actions">
            {/* webcal:// so iOS and macOS subscribe rather than importing a
                snapshot that goes stale the first time a shift changes. */}
            <Button type="button" onClick={() => window.location.assign(links.subscribeUrl)}>
              Add to my calendar
            </Button>
            <Button type="button" variant="secondary" onClick={() => void copy()}>
              {copied ? 'Link copied' : 'Copy link'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => window.open(links.feedUrl, '_blank', 'noopener')}>
              Download this week
            </Button>
          </div>
          <p className="subtle staff-calendar-hint">
            On an iPhone, tap <strong>Add to my calendar</strong>. On Android or a computer, tap{' '}
            <strong>Copy link</strong> and paste it into Google Calendar under <em>Other calendars → From URL</em>.
          </p>
          <details className="staff-calendar-secret" open={revealed}>
            <summary>Show the link, and reset it if you have lost your phone</summary>
            <p className="staff-calendar-url">{links.feedUrl}</p>
            <p className="subtle">
              Anyone with this link can see your shifts — don't post it anywhere. Resetting it stops the old one
              working straight away, and you'll need to add the calendar again on every device.
            </p>
            <Button type="button" size="sm" variant="danger" disabled={resetting} onClick={() => void reset()}>
              {resetting ? 'Resetting…' : 'Reset my link'}
            </Button>
          </details>
        </>
      ) : null}
    </Card>
  );
}

/**
 * Turning roster notifications on for the phone in your hand.
 *
 * Per device, not per person: the browser subscription belongs to this
 * browser on this handset, so someone who works off a phone and an iPad turns
 * it on twice, and losing one device does not silence the other.
 */
function NotificationsCard() {
  const [state, setState] = useState<{ configured: boolean; publicKey: string; devices: number } | null>(null);
  const [thisDeviceOn, setThisDeviceOn] = useState(false);
  const [readiness, setReadiness] = useState<PushReadiness>({ state: 'ready' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReadiness(pushReadiness());
      const [config, endpoint] = await Promise.all([
        api<{ configured: boolean; publicKey: string; devices: number }>('/api/staff/me/push'),
        currentEndpoint()
      ]);
      setState(config);
      // The browser's subscription belongs to the DEVICE; on a shared handset
      // it may still be registered to whoever signed in before. "On here" is
      // only true when the server says this endpoint is on THIS account —
      // otherwise the badge lies while the pushes go to the previous owner.
      if (endpoint) {
        const status = await api<{ thisDevice: boolean }>('/api/staff/me/push/status', {
          method: 'POST',
          body: JSON.stringify({ endpoint })
        }).catch(() => ({ thisDevice: true }));
        setThisDeviceOn(status.thisDevice);
      } else {
        setThisDeviceOn(false);
      }
    } catch {
      setError('Could not check your notification settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function turnOn() {
    if (!state) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await enablePush(state.publicKey);
      setState({ ...state, devices: result.devices });
      setThisDeviceOn(true);
      setNote('This device will now buzz when a roster is published.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn notifications on.');
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!state) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await disablePush();
      setState({ ...state, devices: result.devices });
      setThisDeviceOn(false);
      setNote('Turned off for this device.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not turn notifications off.');
    } finally {
      setBusy(false);
    }
  }

  // Nothing to offer until the server has keys. Showing a button that cannot
  // work is worse than showing nothing at all.
  if (!loading && state && !state.configured) return null;

  const otherDevices = state ? Math.max(0, state.devices - (thisDeviceOn ? 1 : 0)) : 0;

  return (
    <Card
      title="Tell me when the roster drops"
      subtitle="A notification on this device the moment your shifts are published."
    >
      {loading ? <Spinner label="Checking this device…" /> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!loading && readiness.state === 'needs-install' ? (
        <p className="subtle">
          {readiness.reason} Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>, open ALMA Staff
          from the new icon, and this button will work.
        </p>
      ) : null}
      {!loading && (readiness.state === 'unsupported' || readiness.state === 'blocked') ? (
        <p className="subtle">{readiness.reason}</p>
      ) : null}

      {!loading && readiness.state === 'ready' && state ? (
        <>
          <div className="staff-calendar-actions">
            {thisDeviceOn ? (
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void turnOff()}>
                {busy ? 'Turning off…' : 'Turn off on this device'}
              </Button>
            ) : (
              <Button type="button" disabled={busy} onClick={() => void turnOn()}>
                {busy ? 'Turning on…' : 'Notify me on this device'}
              </Button>
            )}
            <Badge tone={thisDeviceOn ? 'positive' : 'warning'}>{thisDeviceOn ? 'On here' : 'Off here'}</Badge>
          </div>
          {note ? <p className="subtle">{note}</p> : null}
          <p className="subtle staff-calendar-hint">
            {otherDevices > 0
              ? `Also on ${otherDevices} other device${otherDevices === 1 ? '' : 's'}. `
              : ''}
            You'll still get the email either way — this just gets to you faster.
          </p>
        </>
      ) : null}
    </Card>
  );
}

function OpenShiftsCard({ onClaimApproved, refreshKey = 0 }: { onClaimApproved: () => Promise<void>; refreshKey?: number }) {
  const [shifts, setShifts] = useState<StaffOpenShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setShifts(await api<StaffOpenShift[]>('/api/staff/me/open-shifts'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load open shifts.');
      setMessageTarget(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function claim(shift: StaffOpenShift) {
    setBusyId(shift.id);
    setMessage(null);
    setMessageTarget(shift.id);
    try {
      await api(`/api/staff/me/open-shifts/${shift.id}/claim`, {
        method: 'POST',
        body: JSON.stringify({ note: noteFor === shift.id ? note.trim() || null : null })
      });
      setNoteFor(null);
      setNote('');
      await load();
      setMessage('Requested. Your manager will confirm.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not request that shift.');
    } finally {
      setBusyId(null);
    }
  }

  async function withdraw(shift: StaffOpenShift) {
    setBusyId(shift.id);
    setMessage(null);
    setMessageTarget(shift.id);
    try {
      await api(`/api/staff/me/open-shifts/${shift.id}/withdraw`, { method: 'POST', body: JSON.stringify({}) });
      await load();
      // An approved claim that gets withdrawn frees the shift again, so the
      // viewer's own roster above may now be out of date.
      await onClaimApproved();
      setMessage('Request withdrawn.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not withdraw that request.');
    } finally {
      setBusyId(null);
    }
  }

  if (!loading && shifts.length === 0) return null;

  return (
    <Card
      title="Shifts you can pick up"
      subtitle="Shifts that still need somebody, and shifts your team have offered to swap. Put your hand up and a manager will confirm."
      padding="none"
      action={<Badge tone="warning">{shifts.length} available</Badge>}
    >
      {loading ? <Spinner label="Loading open shifts…" /> : null}
      {message && !messageTarget ? <p className="error-text" style={{ padding: '0 1rem' }}>{message}</p> : null}
      <div className="staff-mobile-shift-list">
        {shifts.map((shift) => (
          <div key={shift.id} className="staff-mobile-shift-card">
            <span>
              <strong>
                {new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                {shift.isSwap ? <Badge tone="info">Swap</Badge> : null}
              </strong>
              <span className="subtle">{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'} · {shift.venue || 'No venue'}</span>
              <span className="subtle">
                {shift.isSwap && shift.offeredBy
                  ? `${shift.offeredBy.firstName} ${shift.offeredBy.lastName} wants to swap this`
                  : 'Nobody rostered on'}
                {shift.offerNote ? ` — “${shift.offerNote}”` : ''}
              </span>
              <span className="subtle">
                {shift.breakMinutes ? `${shift.breakMinutes}m break` : 'No break planned'}
                {shift.claimCount > 0 ? ` · ${shift.claimCount} ${shift.claimCount === 1 ? 'person has' : 'people have'} asked` : ' · Nobody has asked yet'}
                {shift.notes ? ` · ${shift.notes}` : ''}
              </span>
              {noteFor === shift.id ? (
                <Input
                  autoFocus
                  placeholder="Anything your manager should know? (optional)"
                  value={note}
                  maxLength={300}
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void claim(shift);
                    if (event.key === 'Escape') { setNoteFor(null); setNote(''); }
                  }}
                />
              ) : null}
            </span>
            <span className="staff-row-actions">
              {shift.myClaimStatus === 'PENDING' ? (
                <>
                  <Badge tone="info">Requested</Badge>
                  <Button type="button" size="sm" variant="ghost" disabled={busyId === shift.id} onClick={() => void withdraw(shift)}>
                    {busyId === shift.id ? 'Working…' : 'Withdraw'}
                  </Button>
                </>
              ) : noteFor === shift.id ? (
                <>
                  <Button type="button" size="sm" disabled={busyId === shift.id} onClick={() => void claim(shift)}>
                    {busyId === shift.id ? 'Sending…' : 'Send request'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setNoteFor(null); setNote(''); }}>Cancel</Button>
                </>
              ) : (
                <>
                  <Button type="button" size="sm" disabled={busyId === shift.id} onClick={() => void claim(shift)}>
                    {busyId === shift.id ? 'Sending…' : 'I can work this'}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => { setNoteFor(shift.id); setNote(''); }}>Add note</Button>
                </>
              )}
              <ActionFeedback message={messageTarget === shift.id ? message : null} tone={message?.includes('Could') || message?.includes('already') ? 'error' : 'success'} />
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Read-only copy of the whole team's published roster for the week, so staff
// can see who else is on without the editable manager board. Live (published)
// shifts only. Uses the standard roster-board week selector.
function PublishedRosterView() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setShifts(
        await api<RosterShift[]>(
          `/api/staff/roster/published?start=${encodeURIComponent(weekStart.toISOString())}&end=${encodeURIComponent(weekEnd.toISOString())}`
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the published roster.');
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const byDay = useMemo(() => {
    const map = new Map<string, RosterShift[]>();
    for (const shift of shifts) {
      const key = toDateInput(new Date(shift.startsAt));
      const list = map.get(key) ?? [];
      list.push(shift);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    }
    return map;
  }, [shifts]);

  return (
    <>
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <span className="alma-roster-eyebrow">Team · Published roster</span>
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, addDays(weekEnd, -1))}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => setWeekStart(startOfWeek(new Date()))}
              >
                This week
              </button>
            </div>
          </div>
        </div>
      </div>

      <Card title="Published roster" subtitle="The live team roster for this week — read-only." padding="none">
        {loading ? <Spinner label="Loading published roster…" /> : null}
        {error ? <p className="error-text" style={{ padding: '12px 16px' }}>{error}</p> : null}
        {!loading && !error && shifts.length === 0 ? (
          <EmptyState title="No published shifts this week" description="Shifts appear here once a manager publishes the roster." />
        ) : null}
        {!loading && !error && shifts.length > 0 ? (
          <div className="published-roster-days">
            {days.map((day) => {
              const key = toDateInput(day);
              const dayShifts = byDay.get(key) ?? [];
              if (dayShifts.length === 0) return null;
              return (
                <div key={key} className="published-roster-day">
                  <div className="published-roster-day-head">
                    {day.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
                  </div>
                  {dayShifts.map((shift) => (
                    <div key={shift.id} className="published-roster-shift">
                      <span className="published-roster-time">
                        {timeOf(shift.startsAt)}–{timeOf(shift.endsAt)}
                      </span>
                      <span className="published-roster-who">
                        {shift.staffProfile
                          ? `${shift.staffProfile.firstName} ${shift.staffProfile.lastName}`.trim()
                          : 'Open shift'}
                      </span>
                      <span className="subtle">
                        {shift.area || shift.roleTitle || 'Shift'}
                        {shift.venue || shift.staffProfile?.venue
                          ? ` · ${shift.venue || shift.staffProfile?.venue}`
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </Card>
    </>
  );
}

function StaffMemberClockPage() {
  const [payload, setPayload] = useState<StaffClockStatusPayload | null>(null);
  const [selectedShiftId, setSelectedShiftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const loadClock = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const next = await api<StaffClockStatusPayload>('/api/staff/me/clock');
      setPayload(next);
      setSelectedShiftId((current) => current || next.currentShift?.id || next.nextShift?.id || '');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your clock status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClock();
  }, [loadClock]);

  const activeSession = payload?.activeSession ?? null;
  const shiftOptions = uniqueValues([payload?.currentShift?.id, payload?.nextShift?.id].filter(Boolean) as string[])
    .map((id) => {
      const shift = [payload?.currentShift, payload?.nextShift].find((item) => item?.id === id);
      return {
        label: shift
          ? `${new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })} ${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} · ${shift.area || shift.roleTitle || 'Shift'}`
          : 'Linked shift',
        value: id
      };
    });

  async function runClockAction(action: 'clock-in' | 'clock-out' | 'break-start' | 'break-end') {
    setSaving(true);
    setMessage(null);
    setMessageTarget(action);
    // The moment the button was pressed. If this has to be queued, that is the
    // time recorded — not whenever the wifi comes back.
    const occurredAt = new Date().toISOString();
    try {
      let outcome = { sent: true };
      if (action === 'clock-in') {
        outcome = await apiQueued('/api/staff/me/clock/in', {
          body: JSON.stringify({ rosterShiftId: selectedShiftId, occurredAt })
        });
      } else if (action === 'clock-out') {
        outcome = await apiQueued('/api/staff/me/clock/out', { body: JSON.stringify({ occurredAt }) });
      } else if (action === 'break-start') {
        outcome = await apiQueued('/api/staff/me/clock/break/start', { body: JSON.stringify({ occurredAt }) });
      } else {
        outcome = await apiQueued('/api/staff/me/clock/break/end', { body: JSON.stringify({ occurredAt }) });
      }
      if (outcome.sent) await loadClock();
      const done =
        action === 'clock-in'
          ? 'Clocked in.'
          : action === 'clock-out'
            ? 'Clocked out.'
            : action === 'break-start'
              ? 'Break started.'
              : 'Break ended.';
      // Say what actually happened. Claiming success on something still
      // sitting in a queue is how people find out at the pay run.
      setMessage(
        outcome.sent
          ? done
          : `Saved at ${new Date(occurredAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}. No connection — it'll send itself when you're back on.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update your clock status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Clock"
        title="Clock in and breaks"
        description="Use shift-linked clocking when possible. Breaks and open sessions are tracked separately from approved payroll timesheets."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadClock()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <div className="stats-grid">
        <StatCard
          label="Status"
          value={activeSession ? (activeSession.currentBreakStartedAt ? 'On break' : 'Clocked in') : 'Not clocked in'}
          hint={activeSession ? `Since ${timeOf(activeSession.clockInAt)}` : 'Clock in when you start work'}
          loading={loading}
        />
        <StatCard label="Breaks" value={activeSession?.accumulatedBreakMinutes ?? 0} hint="Minutes logged" loading={loading} />
        <StatCard label="Current shift" value={payload?.currentShift ? timeOf(payload.currentShift.startsAt) : 'None'} hint={payload?.currentShift ? `${payload.currentShift.area || payload.currentShift.roleTitle || 'Shift'}` : 'No active shift'} loading={loading} />
        <StatCard label="Recent sessions" value={payload?.recentSessions.length ?? 0} hint="Last 10 sessions" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Clock controls" subtitle="Duplicate clock-ins and break starts are blocked automatically. Link a shift when you can.">
        <div className="staff-profile-form">
          {!activeSession ? (
            <Select
              label="Clock against shift"
              value={selectedShiftId}
              onChange={(event) => setSelectedShiftId(event.currentTarget.value)}
              options={[{ label: 'No linked shift', value: '' }, ...shiftOptions]}
            />
          ) : null}
          <div className="staff-row-actions">
            {!activeSession ? (
              <Button type="button" disabled={saving} onClick={() => void runClockAction('clock-in')}>
                {saving ? 'Saving…' : 'Clock in'}
              </Button>
            ) : (
              <>
                {activeSession.currentBreakStartedAt ? (
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => void runClockAction('break-end')}>
                    {saving ? 'Saving…' : 'End break'}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" disabled={saving} onClick={() => void runClockAction('break-start')}>
                    {saving ? 'Saving…' : 'Start break'}
                  </Button>
                )}
                <Button type="button" disabled={saving} onClick={() => void runClockAction('clock-out')}>
                  {saving ? 'Saving…' : 'Clock out'}
                </Button>
              </>
            )}
            <ActionFeedback message={messageTarget ? message : null} tone={message?.includes('Could') || message?.includes('No active') || message?.includes('already') ? 'error' : 'success'} />
          </div>
        </div>
      </Card>

      <Card title="Recent sessions" subtitle="Managers review exceptions from this clock session history.">
        {loading ? <Spinner label="Loading sessions…" /> : null}
        {!loading && !(payload?.recentSessions.length) ? <EmptyState title="No clock sessions yet" description="Your future clock-ins will appear here." /> : null}
        <div className="staff-expiry-list">
          {payload?.recentSessions.map((session) => (
            <div key={session.id} className="staff-expiry-row">
              <span>
                <strong>{new Date(session.clockInAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                <span className="subtle">{timeOf(session.clockInAt)}{session.clockOutAt ? `-${timeOf(session.clockOutAt)}` : ' · Open'} · {session.venue || session.rosterShift?.venue || session.rosterShift?.staffProfile?.venue || 'No venue'}</span>
                <span className="subtle">{session.rosterShift ? `${session.rosterShift.area || session.rosterShift.roleTitle || 'Shift'} · ` : ''}{session.accumulatedBreakMinutes}m break</span>
              </span>
              <span className="staff-row-actions">
                <Badge tone={session.status === 'OPEN' ? 'warning' : session.status === 'EXCEPTION' ? 'danger' : 'positive'}>{session.status}</Badge>
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function StaffMemberLeavePage() {
  const [leave, setLeave] = useState<StaffLeaveRequest[]>([]);
  const [type, setType] = useState<StaffLeaveType>('ANNUAL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const loadLeave = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setLeave(await api<StaffLeaveRequest[]>('/api/staff/me/leave'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your leave requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeave();
  }, [loadLeave]);

  async function submitLeave() {
    setMessageTarget('leave');
    if (!startDate || !endDate || endDate < startDate) {
      setMessage('Use a valid leave date range.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/me/leave', {
        method: 'POST',
        body: JSON.stringify({ type, startDate, endDate, notes })
      });
      setType('ANNUAL');
      setStartDate('');
      setEndDate('');
      setNotes('');
      await loadLeave();
      setMessage('Leave request submitted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not submit leave.');
    } finally {
      setSaving(false);
    }
  }

  const pendingCount = leave.filter((item) => item.status === 'PENDING').length;
  const approvedCount = leave.filter((item) => item.status === 'APPROVED').length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Leave"
        title="My leave"
        description="Request leave and keep track of what’s approved, pending, or declined."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadLeave()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <div className="stats-grid">
        <StatCard label="Pending" value={pendingCount} hint="Awaiting manager review" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Upcoming and past" loading={loading} />
        <StatCard label="Total" value={leave.length} hint="Saved requests" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') || message.includes('valid') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Request leave" subtitle="Leave requests stay visible here once a manager reviews them.">
        <div className="staff-profile-form">
          <div className="form-grid two">
            <Select label="Leave type" value={type} onChange={(event) => setType(event.currentTarget.value as StaffLeaveType)} options={LEAVE_TYPE_OPTIONS} />
            <Input label="Start date" type="date" value={startDate} onChange={(event) => setStartDate(event.currentTarget.value)} />
            <Input label="End date" type="date" value={endDate} onChange={(event) => setEndDate(event.currentTarget.value)} />
          </div>
          <Textarea label="Note" rows={3} value={notes} onChange={(event) => setNotes(event.currentTarget.value)} />
          <div className="toolbar-right">
            <Button type="button" disabled={saving} onClick={() => void submitLeave()}>
              {saving ? 'Saving…' : 'Submit leave request'}
            </Button>
            <ActionFeedback message={messageTarget === 'leave' ? message : null} tone={message?.includes('Could') || message?.includes('valid') ? 'error' : 'success'} />
          </div>
        </div>
      </Card>

      <Card title="Leave requests" subtitle="Your request history and manager notes." padding="none">
        {loading ? <Spinner label="Loading leave…" /> : null}
        {!loading && leave.length === 0 ? (
          <EmptyState
            title="No leave recorded for this period"
            description="Your submitted leave requests and manager responses will appear here."
          />
        ) : null}
        <div className="staff-expiry-list">
          {leave.map((item) => (
            <div key={item.id} className="staff-expiry-row">
              <span>
                <strong>{leaveTypeLabel(item.type)}</strong>
                <span className="subtle">{formatRange(new Date(item.startDate), new Date(item.endDate))}</span>
                {item.notes ? <span>{item.notes}</span> : null}
                {item.managerNote ? <span className="subtle">Manager note: {item.managerNote}</span> : null}
              </span>
              <Badge tone={leaveStatusTone(item.status)}>{leaveStatusLabel(item.status)}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "17:30" -> 1050. Empty string means "no bound". */
function timeToMinute(value: string): number | null {
  if (!value.trim()) return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minuteToTime(minute: number | null | undefined): string {
  if (minute == null) return '';
  const h = Math.floor(minute / 60) % 24;
  return `${String(h).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

type AvailabilityDraftRow = { weekday: number; start: string; end: string; available: boolean; note: string };

/**
 * Staff-facing availability.
 *
 * Deliberately a week of seven rows rather than a list you add to: everyone
 * has exactly seven days, and a fixed shape is quicker to fill in and quicker
 * to read back than a builder. "All day" is the default for a day you mark,
 * because most people think in days first and hours second.
 *
 * Saying nothing is a valid answer and is what an untouched week means — the
 * roster treats no rows as no objection, so a blank week is not a trap.
 */
function StaffMemberAvailabilityPage() {
  const [rows, setRows] = useState<AvailabilityDraftRow[]>(() =>
    WEEKDAY_NAMES.map((_, weekday) => ({ weekday, start: '', end: '', available: true, note: '' }))
  );
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const [blocks, setBlocks] = useState<Array<{ id: string; startsAt: string; endsAt: string; reason: string | null }>>([]);
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{
        rules: Array<{ weekday: number; startMinute: number | null; endMinute: number | null; available: boolean; note: string | null }>;
        blocks: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null }>;
      }>('/api/staff/me/availability');
      const next = WEEKDAY_NAMES.map((_, weekday) => ({ weekday, start: '', end: '', available: true, note: '' }));
      const stated = new Set<number>();
      for (const rule of data.rules) {
        next[rule.weekday] = {
          weekday: rule.weekday,
          start: minuteToTime(rule.startMinute),
          end: minuteToTime(rule.endMinute),
          available: rule.available,
          note: rule.note ?? ''
        };
        stated.add(rule.weekday);
      }
      setRows(next);
      setTouched(stated);
      setBlocks(data.blocks);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your availability.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function update(weekday: number, patch: Partial<AvailabilityDraftRow>) {
    setRows((current) => current.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)));
    setTouched((current) => new Set(current).add(weekday));
  }

  async function save() {
    setMessageTarget('availability');
    setSaving(true);
    setMessage(null);
    try {
      // Only days actually touched are sent. An untouched day stays unstated,
      // which is not the same as being available all day.
      const payload = rows
        .filter((row) => touched.has(row.weekday))
        .map((row) => ({
          weekday: row.weekday,
          startMinute: timeToMinute(row.start),
          endMinute: timeToMinute(row.end),
          available: row.available,
          note: row.note.trim() || null
        }));
      const invalid = payload.find((r) => r.startMinute != null && r.endMinute != null && r.endMinute <= r.startMinute);
      if (invalid) {
        setMessage(`${WEEKDAY_NAMES[invalid.weekday]}: the finish time needs to be after the start time.`);
        setSaving(false);
        return;
      }
      await api('/api/staff/me/availability', { method: 'PUT', body: JSON.stringify({ rules: payload }) });
      setMessage('Availability saved. Your manager sees this when building the roster.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save your availability.');
    } finally {
      setSaving(false);
    }
  }

  async function addBlock() {
    setMessageTarget('block');
    if (!blockStart || !blockEnd || blockEnd < blockStart) {
      setMessage('Pick a start and finish date for the time you are away.');
      return;
    }
    setSaving(true);
    try {
      await api('/api/staff/me/unavailability', {
        method: 'POST',
        body: JSON.stringify({
          startsAt: new Date(`${blockStart}T00:00:00`).toISOString(),
          // Inclusive of the last day: away "14th to 16th" means you are back on the 17th.
          endsAt: new Date(`${blockEnd}T23:59:59`).toISOString(),
          reason: blockReason.trim() || null
        })
      });
      setBlockStart(''); setBlockEnd(''); setBlockReason('');
      setMessage('Added. Your manager will see this on the roster.');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  async function removeBlock(id: string) {
    setSaving(true);
    try {
      await api(`/api/staff/unavailability/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove that.');
    } finally {
      setSaving(false);
    }
  }

  const statedDays = rows.filter((row) => touched.has(row.weekday)).length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Availability"
        title="My availability"
        description="Tell your manager when you can and cannot work. This guides the roster — it does not lock it, so talk to your manager about anything that matters."
      />

      <div className="stats-grid">
        <StatCard label="Days set" value={statedDays} hint="Untouched days stay unstated" loading={loading} />
        <StatCard label="Away periods" value={blocks.length} hint="One-off dates you cannot work" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card
        title="A normal week"
        subtitle="Only the days you set are sent. Leave a day untouched if it varies or you would rather talk about it."
      >
        {loading ? <Spinner label="Loading…" /> : (
          <div className="availability-week">
            {rows.map((row) => (
              <div key={row.weekday} className={`availability-day${touched.has(row.weekday) ? ' is-set' : ''}`}>
                <div className="availability-day-name">
                  <strong>{WEEKDAY_NAMES[row.weekday]}</strong>
                  {touched.has(row.weekday) ? null : <span className="subtle">not set</span>}
                </div>
                <Select
                  label=""
                  value={row.available ? 'yes' : 'no'}
                  onChange={(event) => update(row.weekday, { available: event.currentTarget.value === 'yes' })}
                  options={[{ label: 'Can work', value: 'yes' }, { label: 'Cannot work', value: 'no' }]}
                />
                <Input label="From" type="time" value={row.start} onChange={(event) => update(row.weekday, { start: event.currentTarget.value })} />
                <Input label="Until" type="time" value={row.end} onChange={(event) => update(row.weekday, { end: event.currentTarget.value })} />
                <Input label="Note" value={row.note} placeholder="optional" onChange={(event) => update(row.weekday, { note: event.currentTarget.value })} />
              </div>
            ))}
          </div>
        )}
        <p className="subtle">Leave both times blank for a whole day.</p>
        <div className="toolbar-right">
          <Button type="button" disabled={saving || loading} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save my week'}
          </Button>
          <ActionFeedback message={messageTarget === 'availability' ? message : null} tone={message?.includes('Could') || message?.includes('needs to be') ? 'error' : 'success'} />
        </div>
      </Card>

      <Card title="Away on specific dates" subtitle="A wedding, a trip, exams — anything that is not formal leave.">
        <div className="form-grid two">
          <Input label="From" type="date" value={blockStart} onChange={(event) => setBlockStart(event.currentTarget.value)} />
          <Input label="Until" type="date" value={blockEnd} onChange={(event) => setBlockEnd(event.currentTarget.value)} />
          <Input label="Reason" value={blockReason} placeholder="optional" onChange={(event) => setBlockReason(event.currentTarget.value)} />
        </div>
        <div className="toolbar-right">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void addBlock()}>Add</Button>
          <ActionFeedback message={messageTarget === 'block' ? message : null} tone={message?.includes('Could') || message?.includes('Pick a') ? 'error' : 'success'} />
        </div>
        {blocks.length > 0 ? (
          <div className="staff-expiry-list">
            {blocks.map((block) => (
              <div key={block.id} className="staff-expiry-row">
                <span>
                  <strong>{formatRange(new Date(block.startsAt), new Date(block.endsAt))}</strong>
                  {block.reason ? <span className="subtle">{block.reason}</span> : null}
                </span>
                <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void removeBlock(block.id)}>Remove</Button>
              </div>
            ))}
          </div>
        ) : null}
        <p className="subtle">Taking paid leave? Use the Leave page instead so it is approved and recorded.</p>
      </Card>
    </div>
  );
}

/**
 * The noticeboard: what a venue would have pinned by the roster.
 *
 * Everyone signed in can read it; managers post, pin and clear notices from
 * the same screen rather than a separate admin surface. Pinned notices sit
 * first, then newest — the same order the API returns, which is the order a
 * board is actually read in.
 */
function NoticeboardPage() {
  const { user } = useAuth();
  const canPost = canManageCommunications(user);
  const [notices, setNotices] = useState<SuiteAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '', pinned: false, expiresAt: '' });

  const loadNotices = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<{ notices: SuiteAnnouncement[] }>('/api/communications/notices?appId=STAFF');
      setNotices(payload.notices);
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load the noticeboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  async function postNotice(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim() || !draft.body.trim() || saving) return;
    setSaving(true);
    try {
      await api('/api/communications/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: draft.title.trim(),
          body: draft.body.trim(),
          appId: 'STAFF',
          pinned: draft.pinned,
          expiresAt: draft.expiresAt || undefined
        })
      });
      setDraft({ title: '', body: '', pinned: false, expiresAt: '' });
      setComposing(false);
      await loadNotices();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not post the notice.');
    } finally {
      setSaving(false);
    }
  }

  async function mutate(id: string, init: RequestInit) {
    setSaving(true);
    try {
      await api(`/api/communications/announcements/${id}`, init);
      await loadNotices();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update the notice.');
    } finally {
      setSaving(false);
    }
  }

  const pinned = notices.filter((notice) => notice.pinned);

  return (
    <div className="page-stack staff-noticeboard-page">
      <PageHeader
        eyebrow="Noticeboard"
        title="What the team needs to know"
        description="Notices from managers — rosters, closures, changes and anything worth reading before service."
        actions={
          canPost ? (
            <Button type="button" onClick={() => setComposing((open) => !open)}>
              {composing ? 'Cancel' : 'Post a notice'}
            </Button>
          ) : undefined
        }
      />

      {message ? <p className="error-text">{message}</p> : null}

      {canPost && composing ? (
        <Card title="New notice" subtitle="Everyone with Staff access sees this.">
          <form className="notice-form" onSubmit={postNotice}>
            <Input
              label="Title"
              value={draft.title}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) => ({ ...current, title: value }));
              }}
              required
            />
            <Textarea
              label="Message"
              rows={4}
              value={draft.body}
              onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) => ({ ...current, body: value }));
              }}
              required
            />
            <div className="notice-form-row">
              <label className="notice-form-check">
                <input
                  type="checkbox"
                  checked={draft.pinned}
                  onChange={(event) => {
                    const { checked } = event.currentTarget;
                    setDraft((current) => ({ ...current, pinned: checked }));
                  }}
                />
                Pin to the top
              </label>
              <Input
                label="Clear it after (optional)"
                type="date"
                value={draft.expiresAt}
                onChange={(event) => {
                const { value } = event.currentTarget;
                setDraft((current) => ({ ...current, expiresAt: value }));
              }}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? 'Posting…' : 'Post notice'}
            </Button>
          </form>
        </Card>
      ) : null}

      {loading ? (
        <Card><Spinner /></Card>
      ) : notices.length === 0 ? (
        <EmptyState
          title="Nothing on the board"
          description={canPost ? 'Post the first notice — it shows up for everyone with Staff access.' : 'Managers will post here when there is something to say.'}
        />
      ) : (
        <div className="notice-list">
          {notices.map((notice) => (
            <article key={notice.id} className={`notice ${notice.pinned ? 'is-pinned' : ''}`}>
              <header className="notice-head">
                <h3>{notice.title}</h3>
                {notice.pinned ? <Badge tone="positive">Pinned</Badge> : null}
              </header>
              {/* Notices are typed as plain text with line breaks — respecting
                  them is the difference between a list and a wall of words. */}
              <p className="notice-body">{notice.body}</p>
              <footer className="notice-meta">
                <span>
                  {notice.createdByName || 'ALMA'} · {formatDateTime(notice.createdAt)}
                  {notice.expiresAt ? ` · clears ${new Date(notice.expiresAt).toLocaleDateString()}` : ''}
                </span>
                {canPost ? (
                  <span className="notice-actions">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void mutate(notice.id, { method: 'PATCH', body: JSON.stringify({ pinned: !notice.pinned }) })}
                    >
                      {notice.pinned ? 'Unpin' : 'Pin'}
                    </button>
                    <button
                      type="button"
                      className="is-destructive"
                      disabled={saving}
                      onClick={() => {
                        if (window.confirm(`Remove "${notice.title}" from the board?`)) {
                          void mutate(notice.id, { method: 'DELETE' });
                        }
                      }}
                    >
                      Remove
                    </button>
                  </span>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      )}

      {pinned.length > 3 ? (
        <p className="subtle">
          {pinned.length} notices are pinned. A board where everything is pinned reads the same as one where nothing is.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Report a problem, from the floor.
 *
 * The full issue form lives in the compliance app and asks for severity,
 * category, area, assignee, due date and resolution notes — right for a
 * manager triaging a list, wrong for somebody standing in front of a broken
 * fridge with one hand free. This asks what only they can answer and lets the
 * area rules pick the assignee.
 */
type StaffChecklistItem = {
  id: string;
  label: string;
  description: string | null;
  position: number;
  result: 'PENDING' | 'PASS' | 'FAIL' | 'NA';
  notes: string | null;
};

type StaffChecklistRun = {
  id: string;
  status: string;
  runDate: string;
  area: string | null;
  template: { id: string; name: string };
  items: StaffChecklistItem[];
};

/**
 * Today's checks, done from the floor.
 *
 * The scheduler raises a run from every due template at 04:30, so by the time
 * someone opens the venue there are ten waiting. Until now the only place to
 * complete one was the compliance site on a laptop, which is not where opening
 * checks happen.
 *
 * A failed item is the interesting one: it offers to raise an issue there and
 * then, because the alternative is somebody meaning to report it later and not.
 */
type FridgeAsset = {
  id: string;
  name: string;
  venue: string | null;
  area: string | null;
  assetType: string;
  minTempC: number;
  maxTempC: number;
  integrationProvider: string | null;
  lastReadingAt: string | null;
  logs: Array<{ id: string; temperatureC: number; recordedAt: string; source: string | null }>;
};

/**
 * Fridge temperatures, logged from the floor.
 *
 * Most fridges have a Govee sensor reporting hourly, but not all of them do,
 * and a sensor that has gone quiet still needs a reading in the book. This is
 * the manual path: what each one is sitting at, and a way to write down what
 * the probe says.
 *
 * Out of range asks what was done about it, because a temperature log with no
 * corrective action is a record of a problem nobody addressed.
 */
/**
 * Hands off to the stocktake counting screen, already signed in.
 *
 * Counting lives in the stock app and is 2,000 lines of screen that was tuned
 * for exactly this job earlier — a second, thinner copy here would be a worse
 * version of a good thing, and two places to fix every counting bug. What was
 * actually missing is that reaching it meant signing in again.
 *
 * The suite handoff mints a short-lived token, so the tap lands on the count
 * with a live session. When the native shell arrives this becomes a webview
 * inside the same app and the seam disappears entirely.
 */
function StocktakeHandoffPage() {
  const { user } = useAuth();
  const [failed, setFailed] = useState(false);
  const target = `${STOCK_WEB_URL.replace(/\/+$/, '')}/`;
  const stockAllowed =
    Boolean((user as { isAdmin?: boolean } | null)?.isAdmin) ||
    ((user as { appAccess?: Array<{ appId: string; status: string }> } | null)?.appAccess ?? []).some(
      (access) => access.appId === 'STOCK' && access.status === 'ENABLED'
    );

  useEffect(() => {
    if (!stockAllowed) return;
    let cancelled = false;
    void (async () => {
      try {
        const href = await createSuiteHandoffUrl(target);
        if (!cancelled) window.location.href = href;
      } catch {
        // Without a handoff the plain link still works — it just asks them to
        // sign in, which beats a dead end.
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stockAllowed, target]);

  if (!stockAllowed) {
    return (
      <div style={{ padding: 24, maxWidth: 480 }}>
        <h2>Stocktake needs Stock access</h2>
        <p style={{ opacity: 0.75 }}>
          Counting runs in the Stock app, and this account doesn't have it enabled. Ask a manager to switch on Stock
          access for you in Staff, then this button lands straight on the count.
        </p>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Stock" title="Opening the count" description="Taking you to the stocktake screen." />
      <Card>
        {failed ? (
          <>
            <p className="subtle">Couldn't sign you in automatically.</p>
            <Button type="button" onClick={() => window.location.assign(target)}>Open stocktake</Button>
          </>
        ) : (
          <Spinner />
        )}
      </Card>
    </div>
  );
}

function TemperaturesPage() {
  const { user } = useAuth();
  const [assets, setAssets] = useState<FridgeAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reading, setReading] = useState('');
  const [action, setAction] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAssets(await api<FridgeAsset[]>('/api/temperatures/assets'));
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load the fridges.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed = Number(reading.replace(/[^0-9.-]/g, ''));
  const openAsset = assets.find((asset) => asset.id === openId) ?? null;
  // Whether the number being typed is already outside the safe band — asked
  // for before saving, not after, so the person is still standing there.
  const outOfRange =
    openAsset && Number.isFinite(parsed) && reading.trim() !== ''
      ? parsed < openAsset.minTempC || parsed > openAsset.maxTempC
      : false;

  async function saveReading() {
    if (!openAsset || !Number.isFinite(parsed) || reading.trim() === '' || saving) return;
    if (outOfRange && !action.trim()) return;
    setSaving(true);
    try {
      await api(`/api/temperatures/assets/${openAsset.id}/logs`, {
        method: 'POST',
        body: JSON.stringify({
          temperatureC: parsed,
          correctiveAction: action.trim(),
          recordedBy: user ? `${user.firstName} ${user.lastName}`.trim() : ''
        })
      });
      setOpenId(null);
      setReading('');
      setAction('');
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That reading did not save.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Food safety"
        title="Fridge temperatures"
        description="Sensored fridges report themselves. The rest need a probe reading, and so does any sensor that has gone quiet."
      />
      {message ? <p className="error-text">{message}</p> : null}

      {loading ? (
        <Card><Spinner /></Card>
      ) : (
        <div className="fridge-list">
          {assets.map((asset) => {
            const latest = asset.logs[0];
            const inRange = latest ? latest.temperatureC >= asset.minTempC && latest.temperatureC <= asset.maxTempC : null;
            const stale =
              !asset.lastReadingAt || Date.now() - new Date(asset.lastReadingAt).getTime() > 6 * 3600_000;
            return (
              <article key={asset.id} className={`fridge ${inRange === false ? 'is-out' : ''}`}>
                <div className="fridge-head">
                  <div className="fridge-text">
                    <strong>{asset.name.trim()}</strong>
                    <small>{[asset.area, asset.venue].filter(Boolean).join(' · ') || asset.assetType}</small>
                  </div>
                  <div className="fridge-reading">
                    {latest ? (
                      <>
                        <span className={inRange ? 'is-ok' : 'is-bad'}>{latest.temperatureC.toFixed(1)}°</span>
                        <small>{new Date(latest.recordedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</small>
                      </>
                    ) : (
                      <span className="is-none">—</span>
                    )}
                  </div>
                </div>
                <div className="fridge-meta">
                  <span>Safe {asset.minTempC}° to {asset.maxTempC}°</span>
                  {/* A sensor that stopped reporting looks identical to a cold
                      fridge unless you say so. */}
                  {asset.integrationProvider && stale ? <Badge tone="warning">Sensor quiet</Badge> : null}
                  {!asset.integrationProvider ? <Badge tone="muted">Manual only</Badge> : null}
                </div>

                {openId === asset.id ? (
                  <div className="fridge-form">
                    <Input
                      label="What does the probe say?"
                      inputMode="decimal"
                      value={reading}
                      onChange={(event) => {
                        const { value } = event.currentTarget;
                        setReading(value);
                      }}
                      placeholder="3.5"
                    />
                    {outOfRange ? (
                      <>
                        <p className="fridge-warning">
                          That's outside {asset.minTempC}°–{asset.maxTempC}°. What did you do about it?
                        </p>
                        <Textarea
                          label="What you did"
                          rows={2}
                          value={action}
                          onChange={(event) => {
                            const { value } = event.currentTarget;
                            setAction(value);
                          }}
                          placeholder="Moved stock to the walk-in, called the fridge tech."
                        />
                      </>
                    ) : null}
                    <div className="fridge-form-actions">
                      <Button
                        type="button"
                        disabled={saving || reading.trim() === '' || !Number.isFinite(parsed) || (outOfRange && !action.trim())}
                        onClick={() => void saveReading()}
                      >
                        {saving ? 'Saving…' : 'Log it'}
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => { setOpenId(null); setReading(''); setAction(''); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => { setOpenId(asset.id); setReading(''); setAction(''); }}>
                    Log a reading
                  </Button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TodayChecksPage() {
  const [runs, setRuns] = useState<StaffChecklistRun[]>([]);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [failNoteFor, setFailNoteFor] = useState<string | null>(null);
  const [failNote, setFailNote] = useState('');
  const [raiseIssue, setRaiseIssue] = useState(true);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      // ?today=1 rather than sending our own date: the phone's toISOString()
      // gives the UTC day, which through a Sydney morning is yesterday — the
      // board would read empty with ten checks sitting on it.
      setRuns(await api<StaffChecklistRun[]>('/api/checklists/runs?today=1&status=OPEN'));
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load today’s checks.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  async function setResult(
    run: StaffChecklistRun,
    item: StaffChecklistItem,
    result: StaffChecklistItem['result'],
    options: { notes?: string; createIssue?: boolean } = {}
  ) {
    setSavingItemId(item.id);
    try {
      await api(`/api/checklists/runs/${run.id}/items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          result,
          notes: options.notes ?? item.notes ?? '',
          createIssue: options.createIssue ?? false,
          issueTitle: options.createIssue ? `${item.label} — ${run.template.name}` : '',
          issueCategory: 'Maintenance',
          issueSeverity: 'MEDIUM'
        })
      });
      // Update in place. Reloading the whole list would scroll a half-finished
      // checklist back to the top, which is maddening halfway down sixteen items.
      setRuns((current) =>
        current.map((entry) =>
          entry.id !== run.id
            ? entry
            : {
                ...entry,
                items: entry.items.map((existing) =>
                  existing.id === item.id ? { ...existing, result, notes: options.notes ?? existing.notes } : existing
                )
              }
        )
      );
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'That did not save. Try again.');
    } finally {
      setSavingItemId(null);
      setFailNoteFor(null);
      setFailNote('');
      setRaiseIssue(true);
    }
  }

  const openRun = runs.find((run) => run.id === openRunId) ?? null;

  if (openRun) {
    const done = openRun.items.filter((item) => item.result !== 'PENDING').length;
    return (
      <div className="page-stack">
        <PageHeader
          eyebrow={openRun.area ?? 'Checks'}
          title={openRun.template.name}
          description={`${done} of ${openRun.items.length} done`}
          actions={<Button type="button" variant="secondary" onClick={() => setOpenRunId(null)}>Back</Button>}
        />
        {message ? <p className="error-text">{message}</p> : null}
        <div className="check-list">
          {openRun.items.map((item) => (
            <article key={item.id} className={`check-item is-${item.result.toLowerCase()}`}>
              <div className="check-item-text">
                <strong>{item.label}</strong>
                {item.description ? <span>{item.description}</span> : null}
                {item.notes ? <em>{item.notes}</em> : null}
              </div>
              {failNoteFor === item.id ? (
                <div className="check-fail-form">
                  <Textarea
                    label="What's wrong?"
                    rows={2}
                    value={failNote}
                    onChange={(event) => {
                      const { value } = event.currentTarget;
                      setFailNote(value);
                    }}
                  />
                  <label className="check-fail-raise">
                    <input
                      type="checkbox"
                      checked={raiseIssue}
                      onChange={(event) => {
                        const { checked } = event.currentTarget;
                        setRaiseIssue(checked);
                      }}
                    />
                    Report this so someone fixes it
                  </label>
                  <div className="check-fail-actions">
                    <Button
                      type="button"
                      disabled={savingItemId === item.id}
                      onClick={() => void setResult(openRun, item, 'FAIL', { notes: failNote, createIssue: raiseIssue })}
                    >
                      {savingItemId === item.id ? 'Saving…' : 'Save'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => { setFailNoteFor(null); setFailNote(''); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="check-item-actions">
                  <button
                    type="button"
                    className={item.result === 'PASS' ? 'is-on is-pass' : ''}
                    disabled={savingItemId === item.id}
                    onClick={() => void setResult(openRun, item, 'PASS')}
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    className={item.result === 'FAIL' ? 'is-on is-fail' : ''}
                    disabled={savingItemId === item.id}
                    onClick={() => { setFailNoteFor(item.id); setFailNote(item.notes ?? ''); }}
                  >
                    Not OK
                  </button>
                  <button
                    type="button"
                    className={item.result === 'NA' ? 'is-on' : ''}
                    disabled={savingItemId === item.id}
                    onClick={() => void setResult(openRun, item, 'NA')}
                  >
                    N/A
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Today"
        title="Checks to run"
        description="Raised automatically each morning. Anything not done by close shows on the manager's readiness board."
      />
      {message ? <p className="error-text">{message}</p> : null}
      {loading ? (
        <Card><Spinner /></Card>
      ) : runs.length === 0 ? (
        <EmptyState title="Nothing outstanding" description="Every check raised for today has been completed." />
      ) : (
        <div className="check-runs">
          {runs.map((run) => {
            const done = run.items.filter((item) => item.result !== 'PENDING').length;
            const failed = run.items.filter((item) => item.result === 'FAIL').length;
            return (
              <button key={run.id} type="button" className="check-run" onClick={() => setOpenRunId(run.id)}>
                <span className="check-run-text">
                  <strong>{run.template.name}</strong>
                  <small>{run.area ?? 'Whole venue'}</small>
                </span>
                <span className="check-run-progress">
                  <Badge tone={done === run.items.length ? 'positive' : failed ? 'warning' : 'muted'}>
                    {done}/{run.items.length}
                  </Badge>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReportIssuePage() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('MEDIUM');
  const [area, setArea] = useState('');
  const [category, setCategory] = useState('');
  const [areas, setAreas] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState<{ title: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    // Both lists are admin-managed and small. If either call fails the form
    // still works — area and category simply become free text.
    void Promise.all([
      api<string[]>('/api/issues/areas').catch(() => []),
      api<string[]>('/api/issues/categories').catch(() => [])
    ]).then(([areaNames, categoryNames]) => {
      setAreas(areaNames);
      setCategories(categoryNames);
      setCategory((current) => current || categoryNames[0] || 'Maintenance');
    });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (title.trim().length < 3 || description.trim().length < 3 || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          severity,
          category: category.trim() || 'Maintenance',
          area: area.trim(),
          status: 'OPEN'
        })
      });
      setSent({ title: title.trim() });
      setTitle('');
      setDescription('');
      setSeverity('MEDIUM');
      setArea('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send that. Try again.');
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Reported" title="Thanks — that's logged" description={`"${sent.title}" has gone to whoever looks after that area.`} />
        <Card>
          <p className="subtle">You don't need to do anything else. If it's urgent as well as logged, tell a manager on shift.</p>
          <Button type="button" onClick={() => setSent(null)}>Report another</Button>
        </Card>
        <MyReportedIssues />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Report"
        title="Something needs fixing"
        description="Broken, unsafe, out of stock, not right — log it here and it reaches the person who owns that area."
      />

      {message ? <p className="error-text">{message}</p> : null}

      <Card>
        <form className="issue-form" onSubmit={submit}>
          <Input
            label="What's wrong?"
            value={title}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setTitle(value);
            }}
            placeholder="Bar fridge door won't seal"
            required
          />
          <Textarea
            label="Anything else worth knowing"
            rows={3}
            value={description}
            onChange={(event) => {
              const { value } = event.currentTarget;
              setDescription(value);
            }}
            placeholder="Where it is, when it started, what you've already tried."
            required
          />

          {/* Severity as buttons, not a dropdown — it is the one field that
              changes how fast this gets looked at, and it should be a single
              tap rather than a picker. */}
          <div className="issue-severity">
            <span className="issue-field-label">How bad is it?</span>
            <div className="issue-severity-options">
              {([
                { id: 'LOW', label: 'Minor', hint: 'Annoying' },
                { id: 'MEDIUM', label: 'Should fix', hint: 'Soon' },
                { id: 'HIGH', label: 'Urgent', hint: 'Today' },
                { id: 'CRITICAL', label: 'Stop work', hint: 'Unsafe' }
              ] as const).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={severity === option.id ? 'is-on' : ''}
                  onClick={() => setSeverity(option.id)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="issue-form-row">
            <Select
              label="Where"
              value={area}
              onChange={(event) => setArea(event.currentTarget.value)}
              options={[{ value: '', label: 'Not sure' }, ...areas.map((name) => ({ value: name, label: name }))]}
            />
            <Select
              label="What kind"
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
              options={
                categories.length
                  ? categories.map((name) => ({ value: name, label: name }))
                  : [{ value: 'Maintenance', label: 'Maintenance' }]
              }
            />
          </div>

          <Button type="submit" disabled={saving || title.trim().length < 3 || description.trim().length < 3}>
            {saving ? 'Sending…' : 'Report it'}
          </Button>
        </form>
      </Card>

      <MyReportedIssues />
    </div>
  );
}

/**
 * What you've reported, and what happened to it.
 *
 * Without this, reporting a fault is shouting into a hole — you never learn
 * whether anyone picked it up, which is exactly how people stop bothering.
 */
function MyReportedIssues() {
  const [issues, setIssues] = useState<Array<{
    id: string;
    title: string;
    status: string;
    severity: string;
    assignee: string | null;
    createdAt: string;
  }> | null>(null);

  useEffect(() => {
    // A failure here must not take the report form down with it.
    void api<typeof issues>('/api/issues/mine?limit=20')
      .then((rows) => setIssues(rows ?? []))
      .catch(() => setIssues([]));
  }, []);

  if (!issues || issues.length === 0) return null;

  const open = issues.filter((issue) => !['RESOLVED', 'CLOSED'].includes(issue.status));

  return (
    <Card title="What you've reported" subtitle={open.length ? `${open.length} still open` : 'All sorted'}>
      <div className="my-issues">
        {issues.map((issue) => {
          const done = ['RESOLVED', 'CLOSED'].includes(issue.status);
          return (
            <div key={issue.id} className={`my-issue ${done ? 'is-done' : ''}`}>
              <div className="my-issue-text">
                <strong>{issue.title}</strong>
                <small>
                  {new Date(issue.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
                  {issue.assignee ? ` · with ${issue.assignee}` : ' · not picked up yet'}
                </small>
              </div>
              <Badge tone={done ? 'positive' : issue.status === 'IN_PROGRESS' ? 'info' : 'muted'}>
                {done ? 'Done' : issue.status.replace('_', ' ').toLowerCase()}
              </Badge>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StaffMemberCompliancePage() {
  const [home, setHome] = useState<StaffDailyHomePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const loadCompliance = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setHome(await api<StaffDailyHomePayload>('/api/staff/me/home'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load compliance reminders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCompliance();
  }, [loadCompliance]);

  const reminders = home?.complianceReminders ?? [];
  const expired = reminders.filter((item) => item.status === 'EXPIRED').length;
  const pending = reminders.filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS').length;
  const expiring = reminders.filter((item) => item.dueAt && item.status !== 'EXPIRED').length;

  return (
    <div className="page-stack staff-compliance-page">
      <PageHeader
        eyebrow="Compliance"
        title="My compliance reminders"
        description="Check documents, certificates and training that may need attention before the next shift."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadCompliance()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <div className="stats-grid">
        <StatCard label="Expired" value={expired} hint="Needs manager attention" loading={loading} />
        <StatCard label="Pending" value={pending} hint="Awaiting completion or review" loading={loading} />
        <StatCard label="Upcoming" value={expiring} hint="Due or expiring soon" loading={loading} />
      </div>

      {message ? <p className="error-text">{message}</p> : null}

      <Card title="What to do" subtitle="Compliance records are managed with venue managers.">
        <div className="staff-launch-panel">
          <span>Bring any missing certificates, training evidence, or document updates to a manager.</span>
          <span className="subtle">If this page says everything is clear, there is nothing urgent for you to action right now.</span>
        </div>
      </Card>

      <Card title="Reminders" subtitle="Required documents, expiring certificates and incomplete training.">
        {loading ? <Spinner label="Loading compliance reminders…" /> : null}
        {!loading && reminders.length === 0 ? (
          <EmptyState title="All good" description="No urgent compliance reminders are showing for your profile." />
        ) : null}
        <div className="staff-expiry-list">
          {reminders.map((item) => (
            <div key={`${item.kind}:${item.id}`} className="staff-expiry-row">
              <span>
                <strong>{item.title}</strong>
                <span className="subtle">{item.detail}</span>
                {item.dueAt ? <span className="subtle">Due {new Date(item.dueAt).toLocaleDateString()}</span> : null}
              </span>
              <Badge tone={item.status === 'EXPIRED' ? 'danger' : item.status === 'PENDING' || item.status === 'IN_PROGRESS' ? 'warning' : 'info'}>
                {item.status.replaceAll('_', ' ')}
              </Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

type HandbookDocumentSummary = {
  id: string;
  title: string;
  description: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  venue: string | null;
  sendOnOnboarding: boolean;
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The handbook, on the phone in their pocket.
 *
 * New starters are emailed the policies with their invite, and an email from
 * six weeks ago is not where anybody looks for the allergen matrix mid-service.
 * This is the same set of documents, scoped to their venue, always to hand.
 */
function StaffHandbookPage() {
  const [documents, setDocuments] = useState<HandbookDocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocuments(await api<HandbookDocumentSummary[]>('/api/handbook-documents'));
      setMessage(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load the handbook.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDocument(doc: HandbookDocumentSummary) {
    setOpeningId(doc.id);
    setMessage(null);
    try {
      const blob = await apiBlob(`/api/handbook-documents/${doc.id}/file`);
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener');
      if (!opened) {
        // Popup blocked, which is the norm inside a webview — download instead.
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.fileName;
        link.click();
      }
      // Revoked late: revoking straight away closes the tab that just opened.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open that document.');
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Handbook"
        title="Policies & guides"
        description="The documents you were sent when you joined, plus anything added since."
        actions={
          <Button type="button" variant="secondary" disabled={loading} onClick={() => void load()}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      {message ? <p className="error-text">{message}</p> : null}

      <Card title="Documents" subtitle="Tap to open. PDFs open in your phone's viewer.">
        {loading ? <Spinner label="Loading the handbook…" /> : null}
        {!loading && documents.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description="When a manager adds a policy or a guide, it will appear here and go out with new starter invites."
          />
        ) : null}
        {documents.length > 0 ? (
          <div className="staff-expiry-list">
            {documents.map((doc) => (
              <div key={doc.id} className="staff-expiry-row">
                <span>
                  <strong>{doc.title}</strong>
                  {doc.description ? <span className="subtle">{doc.description}</span> : null}
                  <span className="subtle">
                    {doc.mimeType.startsWith('image/') ? 'Image' : 'PDF'} · {formatFileSize(doc.sizeBytes)}
                    {doc.venue ? ` · ${doc.venue}` : ''}
                  </span>
                </span>
                <span className="staff-row-actions">
                  <Button
                    type="button"
                    size="sm"
                    disabled={openingId === doc.id}
                    onClick={() => void openDocument(doc)}
                  >
                    {openingId === doc.id ? 'Opening…' : 'Open'}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function StaffMemberDocumentsPage() {
  const [records, setRecords] = useState<StaffComplianceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRecordId, setSavingRecordId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setRecords(await api<StaffComplianceRecord[]>('/api/staff/me/documents'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load document requests.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  async function uploadDocument(record: StaffComplianceRecord, file: File) {
    setSavingRecordId(record.id);
    setMessage(null);
    setMessageTarget(`record:${record.id}:upload`);
    try {
      const upload = await readOnboardingUpload(file);
      await api(`/api/staff/me/documents/${record.id}/upload`, {
        method: 'POST',
        body: JSON.stringify({
          documentName: upload.name,
          documentUrl: upload.url,
          status: 'UPLOADED'
        })
      });
      await loadDocuments();
      setMessage('Document uploaded for review.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not upload document.');
    } finally {
      setSavingRecordId(null);
    }
  }

  const requested = records.filter((record) => {
    const status = staffComplianceDocumentRecord(record).status;
    return status === 'REQUESTED' || status === 'REJECTED';
  });
  const uploaded = records.filter((record) => {
    const status = staffComplianceDocumentRecord(record).status;
    return status === 'UPLOADED' || status === 'PENDING';
  });
  const approved = records.filter((record) => staffComplianceDocumentRecord(record).status === 'APPROVED');

  return (
    <div className="page-stack staff-documents-page">
      <PageHeader
        eyebrow="My documents"
        title="Document requests"
        description="Upload requested certificates and documents here. Managers review and approve them inside your staff profile."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadDocuments()}>{loading ? 'Refreshing…' : 'Refresh'}</Button>}
      />

      <div className="stats-grid">
        <StatCard label="Requested" value={requested.length} hint="Needs your upload" loading={loading} />
        <StatCard label="In review" value={uploaded.length} hint="Manager approval" loading={loading} />
        <StatCard label="Approved" value={approved.length} hint="Stored in profile" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card title="Requested documents" subtitle="Upload the requested file so a manager can review it.">
        {loading ? <Spinner label="Loading document requests…" /> : null}
        {!loading && records.length === 0 ? (
          <EmptyState title="No document requests" description="Requests from managers will appear here." />
        ) : null}
        <div className="staff-expiry-list">
          {records.map((record) => {
            const documentRecord = staffComplianceDocumentRecord(record);
            const canUpload = documentRecord.status !== 'APPROVED' && documentRecord.status !== 'EXPIRED';
            return (
              <div key={record.id} className="staff-expiry-row">
                <span>
                  <strong>{record.title}</strong>
                  <span className="subtle">
                    {record.recordType.replaceAll('_', ' ')}
                    {documentRecord.dueAt ? ` · due ${new Date(documentRecord.dueAt).toLocaleDateString()}` : ''}
                    {record.expiryDate ? ` · expires ${new Date(record.expiryDate).toLocaleDateString()}` : ''}
                  </span>
                  {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
                  {documentRecord.rejectionReason ? <span className="subtle">Rejected: {documentRecord.rejectionReason}</span> : null}
                  {record.notes ? <span className="subtle">{record.notes}</span> : null}
                  <StaffDocumentViewLink documentUrl={record.documentUrl} />
                  <ActionFeedback
                    message={messageTarget === `record:${record.id}:upload` ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </span>
                <span className="invite-row-actions">
                  <Badge tone={staffRecordStatusTone(documentRecord.status)}>{staffRecordStatusLabel(documentRecord.status)}</Badge>
                  {canUpload ? (
                    <label className="btn btn-secondary btn-sm" style={{ cursor: savingRecordId ? 'not-allowed' : 'pointer' }}>
                      {savingRecordId === record.id ? 'Uploading…' : record.documentUrl ? 'Replace upload' : 'Upload'}
                      <input
                        type="file"
                        accept={STAFF_DOCUMENT_ACCEPT}
                        disabled={Boolean(savingRecordId)}
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = '';
                          if (file) void uploadDocument(record, file);
                        }}
                      />
                    </label>
                  ) : null}
                </span>
              </div>
            );
          })}
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

      <Card title="Assigned modules" subtitle="Ask a manager to mark completion once practical training is signed off." padding="none">
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

type StaffDocumentRequestDraft = {
  recordType: StaffRecordType;
  title: string;
  dueAt: string;
  expiryRequired: boolean;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  notes: string;
};

function emptyStaffDocumentRequestDraft(): StaffDocumentRequestDraft {
  return {
    recordType: 'RSA',
    title: 'RSA Certificate',
    dueAt: '',
    expiryRequired: true,
    priority: 'NORMAL',
    notes: ''
  };
}

type XeroLinkOptions = {
  staff: string;
  venue: string | null;
  organisations: Array<{
    tenantId: string;
    tenantName: string | null;
    suggested: boolean;
    linkedXeroEmployeeId: string | null;
    linkedSyncedAt: string | null;
    employees: Array<{ id: string; name: string; status: string | null }>;
  }>;
};

// What Xero's own copy of a person says, next to what the profile says.
// `value` never crosses the wire — the apply re-reads Xero and writes only
// what it sees there itself, so this is a display, not a payload.
type XeroPullPreview = {
  staff: string;
  tenantId: string;
  tenantName: string | null;
  xeroEmployeeId: string;
  employeeName: string;
  employeeStatus: string | null;
  fields: Array<{
    key: string;
    label: string;
    current: string | null;
    incoming: string | null;
    differs: boolean;
    recommended: boolean;
    note?: string;
  }>;
  held: { bankAccount: boolean; superFund: boolean; taxDeclaration: boolean };
  leave: Array<{ name: string; units: number | null; unit: string }>;
  warnings: string[];
};

// The profile page's Xero panel: one card per connected organisation, each
// with "push this profile there" and "link to the employee already there".
// Both companies are always shown — a manager can push someone to either,
// whatever the venue field says.
function StaffXeroPanel({ staffId, onChanged }: { staffId: string; onChanged?: () => void }) {
  const [options, setOptions] = useState<XeroLinkOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [picks, setPicks] = useState<Record<string, string>>({});
  // Per organisation: whether the link list also shows people Xero has
  // terminated. Off by default — years of past staff otherwise bury the few
  // current ones the manager is looking for.
  const [showTerminated, setShowTerminated] = useState<Record<string, boolean>>({});
  const [pull, setPull] = useState<XeroPullPreview | null>(null);
  const [take, setTake] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await api<XeroLinkOptions>(`/api/staff/${staffId}/xero-link-options`);
      setOptions(data);
      setPicks(Object.fromEntries(data.organisations.map((org) => [org.tenantId, org.linkedXeroEmployeeId ?? ''])));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not reach Xero.');
    }
  }, [staffId]);
  useEffect(() => {
    void load();
  }, [load]);

  function report(text: string, tone: 'success' | 'error') {
    setMessage(text);
    setMessageTone(tone);
  }

  async function push(tenantId: string) {
    setBusy(`push:${tenantId}`);
    setMessage(null);
    try {
      const result = await api<{
        organisations: Array<{ tenantName: string | null; action: string }>;
        warnings: string[];
      }>(`/api/staff/${staffId}/push-to-xero`, { method: 'POST', body: JSON.stringify({ tenantId }) });
      const done = result.organisations.map((org) => `${org.tenantName ?? 'Xero'}: ${org.action}`).join(' · ');
      report([done, ...result.warnings].join(' — '), 'success');
      await load();
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not push to Xero.', 'error');
    } finally {
      setBusy(null);
    }
  }

  // Read their record in one organisation and show what differs. Ticks the
  // fields worth taking by default, and leaves the judgement calls — their
  // login address, a rate for someone paid outside Xero — for a person.
  async function loadPull(tenantId: string) {
    setBusy(`pull:${tenantId}`);
    setMessage(null);
    try {
      const preview = await api<XeroPullPreview>(
        `/api/staff/${staffId}/xero-pull?tenantId=${encodeURIComponent(tenantId)}`
      );
      setPull(preview);
      setTake(Object.fromEntries(preview.fields.filter((field) => field.recommended).map((field) => [field.key, true])));
    } catch (err) {
      setPull(null);
      report(err instanceof Error ? err.message : 'Could not read them from Xero.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function applyPull() {
    if (!pull) return;
    const fields = Object.entries(take).filter(([, on]) => on).map(([key]) => key);
    if (fields.length === 0) return;
    setBusy('pull:apply');
    setMessage(null);
    try {
      const result = await api<{
        applied: Array<{ key: string; label: string; value: string | null }>;
        skipped: Array<{ key: string; why: string }>;
        message?: string;
      }>(`/api/staff/${staffId}/xero-pull`, {
        method: 'POST',
        body: JSON.stringify({ tenantId: pull.tenantId, fields })
      });
      report(
        result.applied.length > 0
          ? `Took ${result.applied.map((entry) => `${entry.label.toLowerCase()} → ${entry.value ?? 'blank'}`).join(', ')}.`
          : result.message ?? 'Nothing changed.',
        'success'
      );
      setPull(null);
      setTake({});
      onChanged?.();
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not save what Xero had.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function link(tenantId: string, xeroEmployeeId: string | null) {
    setBusy(`link:${tenantId}`);
    setMessage(null);
    try {
      const result = await api<{ tenantName: string | null; linked: boolean; employeeName?: string }>(
        `/api/staff/${staffId}/xero-link`,
        { method: 'POST', body: JSON.stringify({ tenantId, xeroEmployeeId }) }
      );
      report(
        result.linked
          ? `Linked to ${result.employeeName || 'the selected employee'} in ${result.tenantName ?? 'Xero'}.`
          : `Unlinked from ${result.tenantName ?? 'Xero'}.`,
        'success'
      );
      await load();
    } catch (err) {
      report(err instanceof Error ? err.message : 'Could not update the Xero link.', 'error');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="xero-panel">
        <ActionFeedback message={loadError} tone="error" />
        <div>
          <Button type="button" variant="secondary" onClick={() => void load()}>Try again</Button>
        </div>
      </div>
    );
  }
  if (!options) return <Spinner label="Asking Xero for its employee lists..." />;

  const takeCount = Object.values(take).filter(Boolean).length;

  return (
    <div className="xero-panel">
      {options.organisations.map((org) => {
        const linkedEmployee = org.employees.find((employee) => employee.id === org.linkedXeroEmployeeId) ?? null;
        const pick = picks[org.tenantId] ?? '';
        const pickChanged = pick !== (org.linkedXeroEmployeeId ?? '');
        const showAll = Boolean(showTerminated[org.tenantId]);
        const isCurrent = (employee: { status: string | null }) => !employee.status || employee.status.toUpperCase() === 'ACTIVE';
        const terminatedCount = org.employees.filter((employee) => !isCurrent(employee)).length;
        // The linked employee and the current pick always stay listed, so a
        // terminated link is still visible and can still be changed.
        const visibleEmployees = org.employees.filter(
          (employee) => showAll || isCurrent(employee) || employee.id === org.linkedXeroEmployeeId || employee.id === pick
        );
        return (
          <section key={org.tenantId} className="xero-org">
            <div className="xero-org-head">
              <span className="xero-org-title">
                {org.tenantName ?? 'Xero organisation'}
                {org.suggested ? <Badge tone="info">their venue</Badge> : null}
              </span>
              {org.linkedXeroEmployeeId ? (
                <Badge tone="positive">Linked{linkedEmployee ? ` · ${linkedEmployee.name}` : ''}</Badge>
              ) : (
                <Badge tone="warning">Not linked</Badge>
              )}
            </div>
            <div className="xero-org-actions">
              <div className="xero-link-pick">
                <Select
                  label="Link to Xero employee"
                  value={pick}
                  onChange={(event) => {
                    const chosen = event.currentTarget.value;
                    setPicks((current) => ({ ...current, [org.tenantId]: chosen }));
                  }}
                  options={[
                    {
                      label: visibleEmployees.length
                        ? 'Pick an employee…'
                        : org.employees.length
                          ? 'No current employees — tick "Show terminated" for the rest'
                          : 'No employees in this organisation',
                      value: ''
                    },
                    ...visibleEmployees.map((employee) => ({
                      label: employee.status && employee.status !== 'ACTIVE' ? `${employee.name} (${employee.status.toLowerCase()})` : employee.name,
                      value: employee.id
                    }))
                  ]}
                />
                {terminatedCount > 0 ? (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={showAll}
                      onChange={(event) => {
                        const on = event.currentTarget.checked;
                        setShowTerminated((current) => ({ ...current, [org.tenantId]: on }));
                      }}
                    />
                    Show terminated ({terminatedCount})
                  </label>
                ) : null}
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null || !pickChanged || !pick}
                onClick={() => void link(org.tenantId, pick)}
              >
                {busy === `link:${org.tenantId}` ? 'Linking…' : 'Link'}
              </Button>
              {org.linkedXeroEmployeeId ? (
                <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => void link(org.tenantId, null)}>
                  Unlink
                </Button>
              ) : null}
              <Button
                type="button"
                disabled={busy !== null}
                title={`Create or update their employee record in ${org.tenantName ?? 'this organisation'} from this profile`}
                onClick={() => void push(org.tenantId)}
              >
                {busy === `push:${org.tenantId}` ? 'Pushing…' : `Push to ${org.tenantName ?? 'Xero'}`}
              </Button>
              {org.linkedXeroEmployeeId ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy !== null}
                  title={`Read their record in ${org.tenantName ?? 'this organisation'} and show what differs`}
                  onClick={() => void loadPull(org.tenantId)}
                >
                  {busy === `pull:${org.tenantId}` ? 'Reading…' : 'Pull from Xero'}
                </Button>
              ) : null}
            </div>
            {pull && pull.tenantId === org.tenantId ? (
              <div className="xero-pull">
                <div className="xero-pull-head">
                  <strong>{pull.employeeName}</strong>
                  <span className="subtle">
                    in {pull.tenantName ?? 'Xero'}
                    {pull.employeeStatus && pull.employeeStatus.toUpperCase() !== 'ACTIVE'
                      ? ` · ${pull.employeeStatus.toLowerCase()}`
                      : ''}
                  </span>
                </div>
                {pull.warnings.map((warning) => (
                  <p key={warning} className="xero-pull-warning">{warning}</p>
                ))}
                {pull.fields.some((field) => field.differs) ? (
                  <>
                    <table className="xero-pull-table">
                      <thead>
                        <tr>
                          <th aria-label="Take" />
                          <th>Field</th>
                          <th>On the profile</th>
                          <th>In Xero</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pull.fields.map((field) => (
                          <tr key={field.key} className={field.differs ? undefined : 'xero-pull-same'}>
                            <td>
                              <input
                                type="checkbox"
                                checked={Boolean(take[field.key])}
                                disabled={!field.differs}
                                aria-label={`Take ${field.label} from Xero`}
                                onChange={(event) => {
                                  // Read it here: React clears `currentTarget`
                                  // once the handler returns, and the updater
                                  // below runs after that.
                                  const ticked = event.currentTarget.checked;
                                  setTake((current) => ({ ...current, [field.key]: ticked }));
                                }}
                              />
                            </td>
                            <td>
                              {field.label}
                              {field.note ? <div className="subtle">{field.note}</div> : null}
                            </td>
                            <td>{field.current ?? <span className="subtle">not set</span>}</td>
                            <td>
                              {field.differs ? <strong>{field.incoming}</strong> : <span className="subtle">same</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="xero-pull-actions">
                      <Button type="button" disabled={busy !== null || takeCount === 0} onClick={() => void applyPull()}>
                        {busy === 'pull:apply'
                          ? 'Saving…'
                          : takeCount === 1
                            ? 'Take 1 field'
                            : `Take ${takeCount} fields`}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => {
                          setPull(null);
                          setTake({});
                        }}
                      >
                        Close
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="subtle">Everything Xero holds already matches this profile.</p>
                )}
                {!pull.held.taxDeclaration && !pull.held.bankAccount && !pull.held.superFund ? (
                  <p className="subtle">
                    No tax declaration, bank account or super fund is set over there yet — push the profile to set them up.
                  </p>
                ) : null}
                {pull.leave.length > 0 ? (
                  <p className="subtle">
                    Leave:{' '}
                    {pull.leave
                      .map((row) => `${row.name} ${row.units === null ? '—' : row.units.toFixed(2)} ${row.unit.toLowerCase()}`)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
      <p className="subtle">
        Push sends their profile (contact, bank, tax settings, super) into that company's payroll — it matches an
        existing employee by name before ever creating one. Link just points this profile at an employee record that
        already exists, without changing anything in Xero. Pull reads their record the other way — bank account, super
        fund and tax settings included — shows what differs, and writes only the fields you tick. The one thing Xero
        never hands back is the tax file number itself: type that in from their TFN declaration.
      </p>
      <ActionFeedback message={message} tone={messageTone} />
    </div>
  );
}

type StaffProfileSectionId = 'personal' | 'employment' | 'access' | 'payroll' | 'journals' | 'onboarding' | 'right-to-work' | 'documents' | 'shifts' | 'leave' | 'pin';

const STAFF_PROFILE_SECTIONS: Array<{ id: StaffProfileSectionId; label: string; group: 'Profile' | 'Scheduling' | 'Compliance / HR' | 'Device / Security'; sensitive?: boolean }> = [
  { id: 'personal', label: 'Personal', group: 'Profile' },
  { id: 'employment', label: 'Employment', group: 'Profile' },
  { id: 'access', label: 'Access & roles', group: 'Profile' },
  { id: 'payroll', label: 'Payroll', group: 'Profile', sensitive: true },
  { id: 'journals', label: 'Journals / Notes', group: 'Profile', sensitive: true },
  { id: 'onboarding', label: 'Onboarding form', group: 'Compliance / HR' },
  { id: 'right-to-work', label: 'Right to work', group: 'Compliance / HR', sensitive: true },
  { id: 'documents', label: 'Documents', group: 'Compliance / HR' },
  { id: 'shifts', label: 'Shifts', group: 'Scheduling' },
  { id: 'leave', label: 'Leave', group: 'Scheduling' },
  { id: 'pin', label: 'PIN access', group: 'Device / Security' }
];

const STAFF_PROFILE_SECTION_IDS = new Set(STAFF_PROFILE_SECTIONS.map((section) => section.id));

function normaliseStaffProfileSection(value: string | undefined): StaffProfileSectionId {
  return STAFF_PROFILE_SECTION_IDS.has(value as StaffProfileSectionId) ? value as StaffProfileSectionId : 'personal';
}

function staffFullName(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName} ${member.lastName}`.trim() || 'Staff profile';
}

function profileDate(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function complianceStatusTone(status: StaffComplianceRecord['status']): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'APPROVED') return 'positive';
  if (status === 'EXPIRED') return 'danger';
  return status === 'PENDING' ? 'warning' : 'muted';
}

function profileSectionIsLocked(section: StaffProfileSectionId, options: { canOpenHr: boolean; canOpenRightToWork: boolean; canOpenPayroll: boolean }) {
  if (section === 'payroll') return !options.canOpenPayroll;
  if (section === 'right-to-work') return !options.canOpenRightToWork;
  if (section === 'journals') return !options.canOpenHr;
  return false;
}

function ProfileInfoGrid({ items }: { items: Array<{ label: string; value: ReactNode; sensitive?: boolean; redacted?: boolean }> }) {
  return (
    <div className="staff-profile-info-grid">
      {items.map((item) => (
        <div key={item.label} className={item.sensitive ? 'is-sensitive' : undefined}>
          <span className="subtle">{item.label}</span>
          {item.redacted ? (
            <strong style={{ color: '#7a1f3d' }}>Hidden</strong>
          ) : (
            <strong>{item.value || 'Not recorded'}</strong>
          )}
          {item.redacted ? <Badge tone="danger">Permission required</Badge> : item.sensitive ? <Badge tone="warning">Restricted</Badge> : null}
        </div>
      ))}
    </div>
  );
}

function formatPayCents(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'AUD' });
}

const COSTING_EMPLOYMENT_TYPE_OPTIONS: Array<{ label: string; value: StaffAwardEmploymentType }> = [
  { label: 'Casual', value: 'CASUAL' },
  { label: 'Part-time', value: 'PART_TIME' },
  { label: 'Full-time', value: 'FULL_TIME' }
];

const COSTING_PAY_FREQUENCY_OPTIONS: Array<{ label: string; value: ManualFullTimePayFrequency }> = [
  { label: 'Annual salary', value: 'ANNUAL_SALARY' },
  { label: 'Hourly full-time rate', value: 'HOURLY_FULL_TIME' }
];

// Costing pay-profile editor — sets a staffer's employment type and (for
// full-timers) their salary so the Staff app is the source of truth for the
// costing engine. Mirrors the Compliance app's AwardPaySetupPanel logic, minus
// the award/classification selects (those values are preserved on save).
function CostingPayProfilePanel({
  member,
  canManage,
  onSaved
}: {
  member: StaffProfile;
  canManage: boolean;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const profile = member.payProfile;
  const [payEmploymentType, setPayEmploymentType] = useState<StaffAwardEmploymentType>(
    profile?.employmentType ?? 'CASUAL'
  );
  const [paySalary, setPaySalary] = useState(
    profile?.manualFullTimePayAmountCents ? String(profile.manualFullTimePayAmountCents / 100) : ''
  );
  const [payFrequency, setPayFrequency] = useState<ManualFullTimePayFrequency>(
    profile?.manualFullTimePayFrequency ?? 'ANNUAL_SALARY'
  );
  const [payNote, setPayNote] = useState(profile?.manualFullTimePayNote ?? '');
  const [paidInCash, setPaidInCash] = useState(profile?.payMode === 'CASH');
  const [cashRate, setCashRate] = useState(
    profile?.cashHourlyRateCents ? String(profile.cashHourlyRateCents / 100) : ''
  );
  const [savingPayProfile, setSavingPayProfile] = useState(false);
  const [payProfileError, setPayProfileError] = useState<string | null>(null);

  const fullTime = payEmploymentType === 'FULL_TIME' && !paidInCash;
  const salaryCents = Math.round(Number(paySalary) * 100);
  const salaryValid = Number.isFinite(salaryCents) && salaryCents > 0;
  const salaryInvalid = fullTime && !salaryValid;
  const cashRateCents = Math.round(Number(cashRate) * 100);
  const cashRateInvalid = paidInCash && (!Number.isFinite(cashRateCents) || cashRateCents <= 0);

  // Salary → hourly: the costing engine spreads an annual salary over a 45h
  // week (salary ÷ 52 ÷ 45), then adds 12% super. Surface that derived rate live.
  const FULL_TIME_WEEKLY_HOURS = 45;
  const SUPER_MULTIPLIER = 1.12;
  const derivedHourlyCents =
    fullTime && payFrequency === 'ANNUAL_SALARY' && salaryValid
      ? Math.round(salaryCents / 52 / FULL_TIME_WEEKLY_HOURS)
      : null;

  async function savePayProfile() {
    if (!canManage || savingPayProfile || salaryInvalid || cashRateInvalid) return;
    const payload: StaffPayProfileInput = paidInCash
      ? {
          awardCode: profile?.awardCode ?? DEFAULT_STAFF_AWARD_CODE,
          awardClassification: profile?.awardClassification ?? DEFAULT_STAFF_AWARD_CLASSIFICATION,
          employmentType: payEmploymentType,
          payMode: 'CASH',
          cashHourlyRateCents: cashRateCents,
          manualFullTimePayAmountCents: null,
          manualFullTimePayFrequency: null,
          manualFullTimePayNote: ''
        }
      : {
          awardCode: profile?.awardCode ?? DEFAULT_STAFF_AWARD_CODE,
          awardClassification: profile?.awardClassification ?? DEFAULT_STAFF_AWARD_CLASSIFICATION,
          employmentType: payEmploymentType,
          payMode: fullTime ? 'MANUAL_FULL_TIME' : 'AWARD',
          cashHourlyRateCents: null,
          manualFullTimePayAmountCents: fullTime ? salaryCents : null,
          manualFullTimePayFrequency: fullTime ? payFrequency : null,
          manualFullTimePayNote: fullTime ? payNote.trim() : ''
        };

    setSavingPayProfile(true);
    setPayProfileError(null);
    try {
      await api<StaffProfile>(`/api/staff/${member.id}/pay-profile`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      await onSaved('Costing pay profile saved.');
    } catch (err) {
      setPayProfileError(err instanceof Error ? err.message : 'Could not save costing pay profile.');
    } finally {
      setSavingPayProfile(false);
    }
  }

  return (
    <section className="staff-modal-section">
      <h3>Costing pay profile</h3>
      <p className="subtle" style={{ margin: '0 0 10px' }}>
        Sets the employment type and (for full-timers) the agreed salary the costing engine uses for this person. The Staff app is the source of truth.
      </p>
      <div className="form-grid three">
        <Select
          label="Employment type"
          value={payEmploymentType}
          onChange={(event) => setPayEmploymentType(event.currentTarget.value as StaffAwardEmploymentType)}
          options={COSTING_EMPLOYMENT_TYPE_OPTIONS}
          disabled={!canManage}
        />
        {fullTime ? (
          <>
            <Input
              label="Annual salary"
              type="number"
              min="0"
              step="0.01"
              value={paySalary}
              onChange={(event) => setPaySalary(event.currentTarget.value)}
              hint="Required for full-time. Enter dollars, not cents."
              disabled={!canManage}
            />
            <Select
              label="Pay frequency"
              value={payFrequency}
              onChange={(event) => setPayFrequency(event.currentTarget.value as ManualFullTimePayFrequency)}
              options={COSTING_PAY_FREQUENCY_OPTIONS}
              disabled={!canManage}
            />
          </>
        ) : null}
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={paidInCash}
          disabled={!canManage}
          onChange={(event) => setPaidInCash(event.currentTarget.checked)}
        />
        Paid in cash
      </label>
      {paidInCash ? (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Input
            label="Cash hourly rate ($/hr)"
            type="number"
            min="0"
            step="0.01"
            value={cashRate}
            onChange={(event) => setCashRate(event.currentTarget.value)}
            hint="Flat rate, same every day. Not synced to Xero."
            disabled={!canManage}
          />
        </div>
      ) : null}
      {fullTime ? (
        <div className="form-grid" style={{ marginTop: 10 }}>
          <Textarea
            label="Pay note (optional)"
            rows={2}
            value={payNote}
            onChange={(event) => setPayNote(event.currentTarget.value)}
            disabled={!canManage}
          />
        </div>
      ) : null}
      {derivedHourlyCents != null ? (
        <p className="subtle" style={{ margin: '8px 0 0' }}>
          ≈ <strong>{formatPayCents(derivedHourlyCents)}/hr</strong> ordinary (salary ÷ 52 weeks ÷ 45h) ·{' '}
          {formatPayCents(Math.round(derivedHourlyCents * SUPER_MULTIPLIER))}/hr incl. 12% super.
        </p>
      ) : null}
      {salaryInvalid ? <p className="error-text">Enter a positive annual salary for full-time staff.</p> : null}
      {cashRateInvalid ? <p className="error-text">Enter a positive cash hourly rate.</p> : null}
      {payProfileError ? <p className="error-text">{payProfileError}</p> : null}
      {canManage ? (
        <div style={{ marginTop: 10 }}>
          <Button
            type="button"
            size="sm"
            onClick={() => void savePayProfile()}
            disabled={savingPayProfile || salaryInvalid || cashRateInvalid}
          >
            {savingPayProfile ? 'Saving…' : 'Save pay profile'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function StaffProfileWorkspacePage({
  staff,
  roleTemplates,
  hrRecords,
  loading,
  reload,
  reloadHr,
  canOpenHr,
  canManageHr,
  canOpenRightToWork,
  canManageRightToWork,
  canOpenPayChanges
}: {
  staff: StaffProfile[];
  roleTemplates: StaffRoleTemplate[];
  hrRecords: StaffHrRecord[];
  loading: boolean;
  reload: () => Promise<void>;
  reloadHr: () => Promise<void>;
  canOpenHr: boolean;
  canManageHr: boolean;
  canOpenRightToWork: boolean;
  canManageRightToWork: boolean;
  canOpenPayChanges: boolean;
}) {
  const { staffId, section } = useParams();
  // The list response no longer carries every profile's shifts (it was 68% of
  // that payload). A profile page wants them, so it asks for its own member.
  const [memberDetail, setMemberDetail] = useState<StaffProfile | null>(null);
  useEffect(() => {
    let cancelled = false;
    setMemberDetail(null);
    if (!staffId) return;
    void api<StaffProfile>(`/api/staff/${staffId}`)
      .then((full) => { if (!cancelled) setMemberDetail(full); })
      .catch(() => { if (!cancelled) setMemberDetail(null); });
    return () => { cancelled = true; };
  }, [staffId]);
  const navigate = useNavigate();
  const { user } = useAuth();
  const activeSection = normaliseStaffProfileSection(section);
  const selected = staff.find((item) => item.id === staffId) ?? null;
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [payrollModalOpen, setPayrollModalOpen] = useState(false);
  const [xeroModalOpen, setXeroModalOpen] = useState(false);
  // A pull writes to the profile behind the modal. Refreshing it right away
  // remounts the panel and wipes the "here is what I took" line before anyone
  // has read it, so the refresh waits until the modal is closed.
  const [xeroPulled, setXeroPulled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState<{ action: StaffDocumentPromptAction; recordId: string } | null>(null);
  const [documentDraft, setDocumentDraft] = useState({
    recordType: 'TRAINING' as StaffRecordType,
    title: '',
    issuer: '',
    certificateNumber: '',
    issueDate: '',
    expiryDate: '',
    status: 'PENDING',
    documentName: '',
    documentUrl: '',
    notes: ''
  });
  const [profileDraft, setProfileDraft] = useState<StaffDraft>(() => selected ? draftFromStaff(selected) : emptyStaffDraft());
  const [documentRequestDraft, setDocumentRequestDraft] = useState<StaffDocumentRequestDraft>(() => emptyStaffDocumentRequestDraft());
  const [documentRequestOpen, setDocumentRequestOpen] = useState(false);

  useEffect(() => {
    setMessage(null);
    setMessageTarget(null);
    setDocumentPrompt(null);
    setDocumentRequestDraft(emptyStaffDocumentRequestDraft());
    setDocumentRequestOpen(false);
    setProfileDraft(selected ? draftFromStaff(selected) : emptyStaffDraft());
  }, [activeSection, selected?.id]);

  if (staffId && section !== activeSection) {
    return <Navigate to={`/staff/${staffId}/${activeSection}`} replace />;
  }

  if (loading) return <Spinner label="Loading staff profile..." />;

  if (!selected) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Staff profile" title="Profile not found" description="This staff profile is not available in your current Staff register." />
        <NavLink to="/profiles"><Button type="button" variant="secondary">Back to staff register</Button></NavLink>
      </div>
    );
  }

  const member = selected;
  const canManageProfileAccess = Boolean(user && user.accountType !== 'VENUE_DEVICE' && user.role !== 'STAFF');
  const canManageDocuments = canManageProfileAccess;
  const canManageSettings = canAccessSettings(user);
  const visibleStaffApps = canManageSettings ? STAFF_APPS : STAFF_APPS.filter((app) => app.id !== 'SETTINGS');
  const accessByApp = new Map(member.appAccess.map((access) => [access.appId, access]));
  const selectedRoleTemplate = roleTemplates.find((template) => template.id === profileDraft.roleTemplateId) ?? null;
  const canOpenPayroll = canOpenHr || canOpenPayChanges;
  const locked = profileSectionIsLocked(activeSection, { canOpenHr, canOpenRightToWork, canOpenPayroll });
  const profileHrRecords = canOpenHr ? hrRecords.filter((record) => record.staffProfileId === member.id) : [];
  const visibleHrRecords = profileHrRecords.filter((record) => {
    if (record.recordType === 'RIGHT_TO_WORK') return canOpenRightToWork;
    if (record.recordType === 'PAY_CHANGE') return canOpenPayChanges;
    return true;
  });
  const rightToWorkRecords = profileHrRecords.filter((record) => record.recordType === 'RIGHT_TO_WORK' && canOpenRightToWork);
  const payRecords = profileHrRecords.filter((record) => record.recordType === 'PAY_CHANGE' && canOpenPayChanges);
  const recentShifts = [...(memberDetail?.rosterShifts ?? member.rosterShifts ?? [])]
    .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())
    .slice(0, 6);
  const sectionTitle = STAFF_PROFILE_SECTIONS.find((item) => item.id === activeSection)?.label ?? 'Personal';
  const approvedDocuments = member.records.filter((record) => record.status === 'APPROVED').length;
  const attentionDocuments = member.records.filter((record) => record.status !== 'APPROVED' || recordDocumentRequested(record)).length;
  const sidebarGroups = STAFF_PROFILE_SECTIONS.reduce<Record<string, typeof STAFF_PROFILE_SECTIONS>>((groups, item) => {
    groups[item.group] = [...(groups[item.group] ?? []), item];
    return groups;
  }, {});
  // Switch-staff dropdown: list active (non-archived) staff plus the current
  // member (so an archived profile reached via URL stays selectable), sorted by name.
  const switchStaffOptions = staff
    .filter((item) => item.employmentStatus !== 'ARCHIVED' || item.id === member.id)
    .slice()
    .sort((left, right) => staffFullName(left).localeCompare(staffFullName(right)))
    .map((item) => ({
      label: item.venue ? `${staffFullName(item)} · ${item.venue}` : staffFullName(item),
      value: item.id
    }));

  async function handleProfileSaved(saved: StaffProfile) {
    await reload();
    setProfileModalOpen(false);
    if (saved.id !== member.id) navigate(`/staff/${saved.id}/${activeSection}`);
  }

  async function archiveStaff() {
    if (!canManageProfileAccess || member.isAdmin) return;
    if (!window.confirm(`Archive ${staffFullName(member)}? They will be removed from active staff lists. You can bring them back later with Re-onboard.`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('profile');
    try {
      await api(`/api/staff/${member.id}`, { method: 'DELETE' });
      await reload();
      navigate('/profiles');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not archive staff profile.');
      setSaving(false);
    }
  }

  async function setKioskPin() {
    if (!canManageProfileAccess) return;
    const entered = window.prompt(`Set a shared-device kiosk PIN for ${staffFullName(member)} (4 to 6 digits). They use this to switch into their account on a venue iPad.`);
    if (entered === null) return;
    const pin = entered.trim();
    if (!/^\d{4,6}$/.test(pin)) {
      setMessageTarget('pin');
      setMessage('PIN must be 4 to 6 digits.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget('pin');
    try {
      await api(`/api/staff/${member.id}/pin/reset`, { method: 'POST', body: JSON.stringify({ pin }) });
      await reload();
      setMessage(`Kiosk PIN set for ${staffFullName(member)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not set the kiosk PIN.');
    } finally {
      setSaving(false);
    }
  }

  function updateProfile<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setProfileDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveProfileDraft(target: StaffProfileSectionId) {
    if (!canManageProfileAccess) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(target);
    try {
      const saved = await api<StaffProfile>(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify(staffPayloadFromDraft(profileDraft))
      });
      setProfileDraft(draftFromStaff(saved));
      await reload();
      setMessage(`${STAFF_PROFILE_SECTIONS.find((item) => item.id === target)?.label ?? 'Profile'} saved.`);
      if (target === 'payroll') setPayrollModalOpen(false);
      if (saved.id !== member.id) navigate(`/staff/${saved.id}/${target}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save staff profile.');
    } finally {
      setSaving(false);
    }
  }

  function selectProfileRoleTemplate(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setProfileDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  function permissionsFor(appId: AlmaAppId) {
    return accessByApp.get(appId)?.permissions ?? {};
  }

  async function saveAssignedRole() {
    if (!canManageProfileAccess) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('assigned-role');
    try {
      const saved = await api<StaffProfile>(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify(staffPayloadFromDraft(profileDraft))
      });
      setProfileDraft(draftFromStaff(saved));
      await reload();
      setMessage('Assigned role saved. App access now matches the selected role.');
      if (saved.id !== member.id) navigate(`/staff/${saved.id}/access`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save assigned role.');
    } finally {
      setSaving(false);
    }
  }

  async function setAccess(appId: AlmaAppId, status: StaffAppAccessStatus) {
    if (!canManageProfileAccess) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`access:${appId}`);
    try {
      await api(`/api/staff/${member.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: visibleStaffApps.map((app) => {
            const current = accessByApp.get(app.id);
            return {
              appId: app.id,
              status: app.id === appId ? status : current?.status ?? 'DISABLED',
              role: current?.role ?? app.role,
              permissions: current?.permissions ?? {},
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

  async function setPermission(appId: AlmaAppId, permissionKey: string, enabled: boolean) {
    if (!canManageProfileAccess) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`permission:${appId}`);
    try {
      await api(`/api/staff/${member.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: visibleStaffApps.map((app) => {
            const current = accessByApp.get(app.id);
            const currentPermissions = current?.permissions ?? {};
            return {
              appId: app.id,
              status: current?.status ?? 'DISABLED',
              role: current?.role ?? app.role,
              permissions: app.id === appId ? { ...currentPermissions, [permissionKey]: enabled } : currentPermissions,
              notes: current?.notes ?? ''
            };
          })
        })
      });
      await reload();
      setMessage('Custom permission updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update permission.');
    } finally {
      setSaving(false);
    }
  }

  async function addDocument() {
    setMessageTarget('document');
    if (!documentDraft.title.trim()) {
      setMessage('Document title is required.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${member.id}/records`, { method: 'POST', body: JSON.stringify(documentDraft) });
      setDocumentDraft({ recordType: 'TRAINING', title: '', issuer: '', certificateNumber: '', issueDate: '', expiryDate: '', status: 'PENDING', documentName: '', documentUrl: '', notes: '' });
      await reload();
      setMessage(documentDraft.documentUrl ? 'Document uploaded.' : 'Document request added.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add document.');
    } finally {
      setSaving(false);
    }
  }

  async function requestDocument() {
    setMessageTarget('document-request');
    if (!documentRequestDraft.title.trim()) {
      setMessage('Document title is required.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${member.id}/documents/request`, {
        method: 'POST',
        body: JSON.stringify(documentRequestDraft)
      });
      setDocumentRequestDraft(emptyStaffDocumentRequestDraft());
      setDocumentRequestOpen(false);
      await reload();
      setMessage('Document request sent.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not request document.');
    } finally {
      setSaving(false);
    }
  }

  async function attachDocumentDraftFile(file: File) {
    setMessageTarget('document');
    setMessage(null);
    try {
      const upload = await readOnboardingUpload(file);
      setDocumentDraft((current) => ({ ...current, documentName: upload.name, documentUrl: upload.url }));
      setMessage(`${upload.name} attached.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not attach file.');
    }
  }

  async function approveDocument(record: StaffComplianceRecord) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:approve`);
    try {
      await api(`/api/staff/${member.id}/records/${record.id}/approve`, { method: 'POST' });
      await reload();
      setMessage('Document approved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectDocument(record: StaffComplianceRecord) {
    const reason = window.prompt('Reason for rejecting this document?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:reject`);
    try {
      await api(`/api/staff/${member.id}/records/${record.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      await reload();
      setMessage('Document rejected.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject document.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDocumentAction() {
    if (!documentPrompt) return;
    const record = member.records.find((item) => item.id === documentPrompt.recordId);
    if (!record) {
      setDocumentPrompt(null);
      return;
    }
    const actionKey = documentPrompt.action === 'delete' ? 'remove' : 'request';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:${actionKey}`);
    try {
      await api(`/api/staff/${member.id}/records/${record.id}/${documentPrompt.action === 'delete' ? 'document' : 'request-document'}`, {
        method: documentPrompt.action === 'delete' ? 'DELETE' : 'POST'
      });
      await reload();
      setDocumentPrompt(null);
      setMessage(documentPrompt.action === 'delete' ? 'Document removed. The staff record is still available.' : 'Document requested. The profile now shows it as pending.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update document.');
    } finally {
      setSaving(false);
    }
  }

  async function requestHrDocument(record: StaffHrRecord) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`hr:${record.id}:request`);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}/request`, { method: 'POST' });
      await reloadHr();
      setMessage('Replacement requested.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not request replacement.');
    } finally {
      setSaving(false);
    }
  }

  async function removeHrDocument(record: StaffHrRecord) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`hr:${record.id}:remove`);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}`, { method: 'DELETE' });
      await reloadHr();
      setMessage('HR document removed. The HR record remains.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove HR document.');
    } finally {
      setSaving(false);
    }
  }

  function renderLockedSection(title: string) {
    return (
      <Card title={title} subtitle="This section contains restricted staff information.">
        <div className="staff-profile-locked">
          <IconFileLock />
          <span>
            <strong>Restricted section</strong>
            <span className="subtle">You need the matching Staff HR permission to view or manage this staff profile section.</span>
          </span>
        </div>
      </Card>
    );
  }

  function renderComplianceDocument(record: StaffComplianceRecord) {
    const documentRecord = staffComplianceDocumentRecord(record);
    return (
      <div key={record.id} className="staff-profile-document-row">
        <span className="staff-profile-document-icon"><IconFileText /></span>
        <span className="staff-profile-document-main">
          <strong>{record.title}</strong>
          <span className="subtle">{record.recordType.replaceAll('_', ' ')} · {record.issuer || 'No issuer'}</span>
          <span className="subtle">Expiry: {profileDate(record.expiryDate)}</span>
          {documentRecord.dueAt ? <span className="subtle">Due: {profileDate(documentRecord.dueAt)}</span> : null}
          {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
          <StaffDocumentViewLink documentUrl={record.documentUrl} />
          {recordDocumentRequested(documentRecord) ? <span className="subtle">Document requested</span> : null}
          {documentRecord.rejectionReason ? <span className="subtle">Rejected: {documentRecord.rejectionReason}</span> : null}
          {record.notes ? <span className="subtle">{record.notes}</span> : null}
        </span>
        <span className="staff-profile-document-actions">
          <Badge tone={staffRecordStatusTone(documentRecord.status)}>{staffRecordStatusLabel(documentRecord.status)}</Badge>
          {canManageDocuments ? (
            <>
              <Button type="button" size="sm" variant="secondary" disabled={saving || record.status === 'APPROVED' || !record.documentUrl} onClick={() => void approveDocument(record)}>Approve</Button>
              {record.documentUrl && record.status !== 'APPROVED' ? <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void rejectDocument(record)}>Reject</Button> : null}
              {record.documentUrl ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setDocumentPrompt({ action: 'delete', recordId: record.id })}>Remove file</Button> : null}
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => setDocumentPrompt({ action: 'request', recordId: record.id })}>Request</Button>
            </>
          ) : null}
          <ActionFeedback message={messageTarget?.startsWith(`record:${record.id}:`) ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
        </span>
        {documentPrompt?.recordId === record.id ? (
          <StaffDocumentActionPrompt
            action={documentPrompt.action}
            saving={saving}
            feedback={messageTarget?.startsWith(`record:${record.id}:`) ? message : null}
            onCancel={() => setDocumentPrompt(null)}
            onConfirm={() => void confirmDocumentAction()}
          />
        ) : null}
      </div>
    );
  }

  function renderHrDocument(record: StaffHrRecord) {
    const canManageRecord = canManageHr && (record.recordType !== 'RIGHT_TO_WORK' || canManageRightToWork) && (record.recordType !== 'PAY_CHANGE' || canOpenPayChanges);
    return (
      <div key={record.id} className="staff-profile-document-row is-sensitive">
        <span className="staff-profile-document-icon"><IconFileLock /></span>
        <span className="staff-profile-document-main">
          <strong>{record.title}</strong>
          <span className="subtle">{hrTypeLabel(record.recordType)} · Restricted HR</span>
          {record.expiryDate ? <span className="subtle">Expiry: {profileDate(record.expiryDate)}</span> : null}
          {record.effectiveDate ? <span className="subtle">Effective: {profileDate(record.effectiveDate)}</span> : null}
          {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
          <StaffDocumentViewLink documentUrl={record.documentUrl} />
          {record.notes ? <span className="subtle">{record.notes}</span> : null}
        </span>
        <span className="staff-profile-document-actions">
          <Badge tone={hrStatusTone(record.status)}>{record.status.replaceAll('_', ' ')}</Badge>
          {canManageRecord ? (
            <>
              {record.documentUrl ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void removeHrDocument(record)}>Remove file</Button> : null}
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void requestHrDocument(record)}>Request</Button>
            </>
          ) : null}
          <ActionFeedback message={messageTarget?.startsWith(`hr:${record.id}:`) ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
        </span>
      </div>
    );
  }

  function renderDocumentComposer() {
    if (!canManageDocuments) return null;
    return (
      <details className="staff-profile-collapsible">
        <summary>Upload or request a document</summary>
        <form className="staff-profile-form" onSubmit={(event) => { event.preventDefault(); void addDocument(); }}>
          <div className="form-grid three">
            <Select label="Type" value={documentDraft.recordType} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, recordType: el.value as StaffRecordType })); }} options={['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'].map((value) => ({ label: value.replace('_', ' '), value }))} />
            <Input label="Document name" value={documentDraft.title} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, title: el.value })); }} />
            <Input label="Expiry" type="date" value={documentDraft.expiryDate} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, expiryDate: el.value })); }} />
            <Input label="Issuer" value={documentDraft.issuer} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, issuer: el.value })); }} />
            <Input label="Certificate number" value={documentDraft.certificateNumber} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, certificateNumber: el.value })); }} />
            <Select label="Status" value={documentDraft.status} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, status: el.value })); }} options={['PENDING', 'APPROVED', 'EXPIRED'].map((value) => ({ label: value, value }))} />
          </div>
          <div className="invite-row staff-profile-upload-row">
            <span>
              <strong>{documentDraft.documentName || 'No file attached'}</strong>
              <span className="subtle">Upload PDF/image evidence, or save with no file to request it from the staff member.</span>
            </span>
            <span className="invite-row-actions">
              <label className="btn btn-secondary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>
                Upload file
                <input type="file" accept={STAFF_DOCUMENT_ACCEPT} disabled={saving} style={{ display: 'none' }} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void attachDocumentDraftFile(file); }} />
              </label>
              {documentDraft.documentUrl ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => setDocumentDraft((current) => ({ ...current, documentName: '', documentUrl: '' }))}>Remove attachment</Button> : null}
            </span>
          </div>
          <Textarea label="Notes" rows={2} value={documentDraft.notes} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, notes: el.value })); }} />
          <div className="toolbar-right">
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : documentDraft.documentUrl ? 'Upload document' : 'Request document'}</Button>
            <ActionFeedback message={messageTarget === 'document' ? message : null} tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'} />
          </div>
        </form>
      </details>
    );
  }

  function renderDocumentRequestModal() {
    if (!canManageDocuments) return null;
    return (
      <StaffModal
        open={documentRequestOpen}
        title="Request document"
        subtitle={`Send a document request to ${staffFullName(member)}.`}
        width="standard"
        onClose={() => setDocumentRequestOpen(false)}
      >
        <form
          className="staff-profile-form staff-profile-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void requestDocument();
          }}
        >
          <section className="staff-modal-section">
            <div className="form-grid">
              <Select
                label="Document type"
                value={documentRequestDraft.recordType}
                onChange={(event) => {
                  const recordType = event.currentTarget.value as StaffRecordType;
                  setDocumentRequestDraft((current) => ({
                    ...current,
                    recordType,
                    title: current.title || recordType.replaceAll('_', ' ')
                  }));
                }}
                options={['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'].map((value) => ({ label: value.replaceAll('_', ' '), value }))}
              />
              <Input label="Request title" value={documentRequestDraft.title} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, title: el.value })); }} />
              <Input label="Due date" type="date" value={documentRequestDraft.dueAt} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, dueAt: el.value })); }} />
              <Select
                label="Priority"
                value={documentRequestDraft.priority}
                onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, priority: el.value as StaffDocumentRequestDraft['priority'] })); }}
                options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((value) => ({ label: value.charAt(0) + value.slice(1).toLowerCase(), value }))}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={documentRequestDraft.expiryRequired}
                onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, expiryRequired: el.checked })); }}
              />
              Expiry date required where applicable
            </label>
            <Textarea label="Optional note" rows={3} value={documentRequestDraft.notes} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, notes: el.value })); }} />
          </section>
          <div className="staff-modal-footer">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setDocumentRequestOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Sending...' : 'Send request'}</Button>
            <ActionFeedback message={messageTarget === 'document-request' ? message : null} tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'} />
          </div>
        </form>
      </StaffModal>
    );
  }

  function renderPayrollModal() {
    return (
      <StaffModal
        open={payrollModalOpen}
        title={`Edit payroll for ${staffFullName(member)}`}
        subtitle="Payroll, tax, bank, super and Xero fields stay in this staff profile."
        width="wide"
        onClose={() => {
          setProfileDraft(draftFromStaff(member));
          setPayrollModalOpen(false);
        }}
      >
        <form
          className="staff-profile-form staff-profile-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveProfileDraft('payroll');
          }}
        >
          <section className="staff-modal-section">
            <h3>Pay settings</h3>
            <div className="form-grid three">
              <Input label="Pay type" value={profileDraft.payType} onChange={(event) => updateProfile('payType', event.currentTarget.value)} />
              <Input label="Base rate" value={profileDraft.payRate} onChange={(event) => updateProfile('payRate', event.currentTarget.value)} />
              <Input label="Award / classification" value={profileDraft.payAward} onChange={(event) => updateProfile('payAward', event.currentTarget.value)} />
            </div>
          </section>

          <CostingPayProfilePanel
            member={member}
            canManage={canManageProfileAccess}
            onSaved={async (savedMessage) => {
              await reload();
              setMessageTarget('payroll');
              setMessage(savedMessage);
            }}
          />

          <section className="staff-modal-section">
            <h3>Tax</h3>
            <div className="form-grid three">
              <Input label="TFN" value={profileDraft.taxFileNumber} onChange={(event) => updateProfile('taxFileNumber', event.currentTarget.value)} />
              <Input label="Tax residency" value={profileDraft.taxResidencyStatus} onChange={(event) => updateProfile('taxResidencyStatus', event.currentTarget.value)} />
              <label className="check-row">
                <input type="checkbox" checked={profileDraft.taxFreeThreshold} onChange={(event) => updateProfile('taxFreeThreshold', event.currentTarget.checked)} />
                Claims tax-free threshold
              </label>
              <label className="check-row">
                <input type="checkbox" checked={profileDraft.hasStudyTrainingLoan} onChange={(event) => updateProfile('hasStudyTrainingLoan', event.currentTarget.checked)} />
                Study or training loan
              </label>
            </div>
          </section>

          <section className="staff-modal-section">
            <h3>Superannuation</h3>
            <div className="form-grid three">
              <Input label="Super fund" value={profileDraft.superFundName} onChange={(event) => updateProfile('superFundName', event.currentTarget.value)} />
              <Input label="Super ABN" value={profileDraft.superFundAbn} onChange={(event) => updateProfile('superFundAbn', event.currentTarget.value)} />
              <Input label="Super USI" value={profileDraft.superFundUsi} onChange={(event) => updateProfile('superFundUsi', event.currentTarget.value)} />
              <Input label="Member number" value={profileDraft.superMemberNumber} onChange={(event) => updateProfile('superMemberNumber', event.currentTarget.value)} />
            </div>
          </section>

          <section className="staff-modal-section">
            <h3>Bank</h3>
            <div className="form-grid three">
              <Input label="Bank account name" value={profileDraft.bankAccountName} onChange={(event) => updateProfile('bankAccountName', event.currentTarget.value)} />
              <Input label="BSB" value={profileDraft.bankBsb} onChange={(event) => updateProfile('bankBsb', event.currentTarget.value)} />
              <Input label="Account number" value={profileDraft.bankAccountNumber} onChange={(event) => updateProfile('bankAccountNumber', event.currentTarget.value)} />
            </div>
          </section>

          <details className="staff-modal-section staff-modal-details">
            <summary>Xero payroll export fields</summary>
            <div className="form-grid three">
              <Input label="Xero employee ID" value={profileDraft.xeroEmployeeId} onChange={(event) => updateProfile('xeroEmployeeId', event.currentTarget.value)} />
              <Input label="Xero payroll calendar" value={profileDraft.xeroPayrollCalendarId} onChange={(event) => updateProfile('xeroPayrollCalendarId', event.currentTarget.value)} />
              <Input label="Xero earnings rate" value={profileDraft.xeroEarningsRateId} onChange={(event) => updateProfile('xeroEarningsRateId', event.currentTarget.value)} />
            </div>
          </details>

          <div className="staff-modal-footer">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setProfileDraft(draftFromStaff(member));
                setPayrollModalOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save payroll'}</Button>
            <ActionFeedback message={messageTarget === 'payroll' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
          </div>
        </form>
      </StaffModal>
    );
  }

  function renderSection() {
    if (locked) return renderLockedSection(sectionTitle);
    if (activeSection === 'personal') {
      return (
        <Card title="Personal" subtitle="Core identity and contact details for this staff member." action={<Button type="button" size="sm" onClick={() => setProfileModalOpen(true)}>Edit</Button>}>
          <ProfileInfoGrid items={[
            { label: 'Legal name', value: staffFullName(member) },
            { label: 'Email', value: member.email },
            { label: 'Phone', value: member.phone },
            { label: 'Date of birth', value: profileDate(member.dateOfBirth), sensitive: true },
            { label: 'Address', value: [member.addressLine1, member.addressLine2, member.suburb, member.state, member.postcode].filter(Boolean).join(', ') },
            { label: 'Emergency contact', value: member.emergencyContactName ? `${member.emergencyContactName} · ${member.emergencyContactRelationship || 'Relationship not recorded'} · ${member.emergencyContactPhone || 'No phone'}` : null }
          ]} />
        </Card>
      );
    }
    if (activeSection === 'employment') {
      return (
        <Card title="Employment" subtitle="Role, venue, onboarding, and access summary." action={<Button type="button" size="sm" onClick={() => setProfileModalOpen(true)}>Edit</Button>}>
          <ProfileInfoGrid items={[
            { label: 'Role', value: member.roleTemplate?.name ?? member.roleTitle },
            { label: 'Role title', value: member.roleTitle },
            { label: 'Venue', value: member.venue },
            { label: 'Status', value: member.employmentStatus },
            { label: 'Employment type', value: member.employmentType },
            { label: 'Start date', value: profileDate(member.startDate) }
          ]} />
          <div className="staff-profile-chip-row">
            {member.appAccess.filter((access) => access.status === 'ENABLED').map((access) => <Badge key={access.appId} tone="info">{access.appId.toLowerCase()} · {access.role.toLowerCase()}</Badge>)}
            {!member.appAccess.some((access) => access.status === 'ENABLED') ? <span className="subtle">No app access enabled.</span> : null}
          </div>
        </Card>
      );
    }
    if (activeSection === 'access') {
      const roleChanged = profileDraft.roleTemplateId !== (member.roleTemplateId ?? '');
      return (
        <div className="page-stack">
          <Card title="Assigned role" subtitle="Roles come from Alma Admin and apply app access automatically.">
            <div className="form-grid two">
              <Select
                label="Role template"
                value={profileDraft.roleTemplateId}
                disabled={!canManageProfileAccess}
                onChange={(event) => selectProfileRoleTemplate(event.currentTarget.value)}
                options={[
                  { label: roleTemplates.length ? 'Choose a role template' : 'No role templates configured', value: '' },
                  ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                ]}
              />
              <Input label="Role title" value={profileDraft.roleTitle} readOnly />
            </div>
            <details className="staff-role-preview">
              <summary>Role access preview</summary>
              <p className="subtle">{roleTemplateAccessSummary(selectedRoleTemplate)}</p>
              {roleChanged ? (
                <p className="subtle">Changing role will update this person’s app access to match the selected role when you apply it.</p>
              ) : null}
              <p className="subtle">Custom permission overrides remain collapsed below for one-off exceptions.</p>
            </details>
            {!roleTemplates.length ? <p className="subtle">No role templates yet. Create roles in Alma Admin before assigning them here.</p> : null}
            {canManageProfileAccess ? (
              <div className="toolbar-right">
                <Button type="button" disabled={saving || !roleChanged} onClick={() => void saveAssignedRole()}>{saving ? 'Saving...' : roleChanged ? 'Apply role' : 'No role changes'}</Button>
                <ActionFeedback message={messageTarget === 'assigned-role' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              </div>
            ) : <p className="subtle">You do not have permission to change assigned roles.</p>}
          </Card>

          <Card title="App access" subtitle="Summary of enabled Alma apps for this staff member.">
            <div className="app-access-grid">
              {visibleStaffApps.map((app) => {
                const current = accessByApp.get(app.id);
                const enabled = current?.status === 'ENABLED';
                return (
                  <div key={app.id} className="app-access-tile">
                    <strong>{app.label}</strong>
                    <span className="subtle">Role: {current?.role ?? app.role}</span>
                    <Badge tone={enabled ? 'positive' : 'muted'} dot>{current?.status ?? 'DISABLED'}</Badge>
                    <span className="subtle">{Object.entries(current?.permissions ?? {}).filter(([, allowed]) => allowed).length} custom permissions</span>
                    {canManageProfileAccess ? (
                      <Button size="sm" variant={enabled ? 'secondary' : 'primary'} disabled={saving} onClick={() => void setAccess(app.id, enabled ? 'DISABLED' : 'ENABLED')}>
                        {enabled ? 'Disable' : 'Enable'}
                      </Button>
                    ) : null}
                    <ActionFeedback message={messageTarget === `access:${app.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                  </div>
                );
              })}
            </div>
          </Card>

          <details className="staff-profile-collapsible">
            <summary>
              <span>
                <strong>Custom permissions</strong>
                <span className="subtle">Advanced app access overrides are collapsed by default.</span>
              </span>
              <Badge tone={member.appAccess.some((access) => Object.values(access.permissions ?? {}).some(Boolean)) ? 'warning' : 'muted'}>
                {member.appAccess.reduce((count, access) => count + Object.values(access.permissions ?? {}).filter(Boolean).length, 0)} enabled
              </Badge>
            </summary>
            <div className="app-access-grid">
              {visibleStaffApps.map((app) => {
                const permissions = ACCESS_PERMISSION_GROUPS[app.id] ?? [];
                if (!permissions.length) return null;
                return (
                  <AppPermissionTile
                    key={app.id}
                    app={app}
                    access={accessByApp.get(app.id)}
                    permissions={permissions}
                    canEdit={canManageProfileAccess}
                    saving={saving}
                    onToggle={(key, next) => void setPermission(app.id, key, next)}
                    feedback={
                      <ActionFeedback message={messageTarget === `permission:${app.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                    }
                  />
                );
              })}
            </div>
          </details>
        </div>
      );
    }
    if (activeSection === 'payroll') {
      // Field-level redaction (#16) — server returns redactedFieldGroups
      // for fields hidden from the current actor. We use that here to show
      // "Hidden — permission required" instead of "Not recorded" so the
      // manager can tell apart "no data" from "not allowed".
      const hiddenGroups = member.redactedFieldGroups ?? [];
      const payHidden = hiddenGroups.includes('pay');
      const bankHidden = hiddenGroups.includes('banking');
      const taxHidden = hiddenGroups.includes('tax');
      const xeroHidden = hiddenGroups.includes('xero');
      return (
        <Card title="Payroll" subtitle="Sensitive payroll fields are restricted to authorised Staff HR users." action={canManageProfileAccess ? <Button type="button" size="sm" onClick={() => setPayrollModalOpen(true)}>Edit payroll</Button> : undefined}>
          <ProfileInfoGrid items={[
            { label: 'Pay type', value: member.payType, sensitive: true, redacted: payHidden },
            { label: 'Base rate', value: formatCents(member.payRateCents), sensitive: true, redacted: payHidden },
            { label: 'Award', value: member.payAward, sensitive: true, redacted: payHidden },
            { label: 'Tax residency', value: member.taxResidencyStatus, sensitive: true, redacted: taxHidden },
            { label: 'Super fund', value: member.superFundName, sensitive: true, redacted: taxHidden },
            { label: 'Bank account', value: member.bankAccountName ? `${member.bankAccountName} · ${member.bankBsb || 'No BSB'} · ${member.bankAccountNumber || 'No account number'}` : null, sensitive: true, redacted: bankHidden },
            { label: 'Xero employee', value: member.xeroEmployeeId, sensitive: true, redacted: xeroHidden }
          ]} />
          {renderPayrollModal()}
          <ActionFeedback message={messageTarget === 'payroll' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
          {payRecords.length ? <div className="staff-profile-document-list">{payRecords.map(renderHrDocument)}</div> : <p className="subtle">No pay-change HR records filed for this profile.</p>}
        </Card>
      );
    }
    if (activeSection === 'journals') {
      return <Card title="Journals" subtitle="Restricted manager notes and profile history."><div className="staff-profile-note"><strong>Manager notes</strong><p>{member.notes || 'No manager notes recorded.'}</p></div><p className="subtle">Detailed management event history remains in the existing Staff admin workspace.</p></Card>;
    }
    if (activeSection === 'onboarding') {
      const requiredRecords = member.records.filter((record) => ['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY'].includes(record.recordType));
      return (
        <Card title="Onboarding form" subtitle="Onboarding status and required documents for this profile.">
          <ProfileInfoGrid items={[{ label: 'Status', value: member.employmentStatus }, { label: 'Created', value: profileDate(member.createdAt) }, { label: 'Last updated', value: profileDate(member.updatedAt) }, { label: 'Required records', value: requiredRecords.length }]} />
          <details className="staff-profile-collapsible">
            <summary>Imported onboarding resources</summary>
            <p className="subtle">Deputy/source documents such as Welcome Pack, FOH Onboarding Doc, Menu Notes, and Allergens Table are treated as onboarding resources, not randomly attached to individual profiles. Exact-match RSA certificates appear below and in Documents.</p>
          </details>
          <div className="staff-profile-document-list">{requiredRecords.length ? requiredRecords.map(renderComplianceDocument) : <EmptyState title="No onboarding records" description="Requested onboarding documents will appear here when created." />}</div>
        </Card>
      );
    }
    if (activeSection === 'right-to-work') {
      return (
        <Card title="Right to work" subtitle="Visa and work-rights information is restricted to authorised HR users." action={<Button type="button" size="sm" onClick={() => setProfileModalOpen(true)}>Edit</Button>}>
          <ProfileInfoGrid items={[
            { label: 'Visa status', value: member.visaStatus, sensitive: true },
            { label: 'Visa subclass', value: member.visaSubclass, sensitive: true },
            { label: 'Visa expiry', value: profileDate(member.visaExpiryDate), sensitive: true },
            { label: 'Work-rights notes', value: member.workRightsNotes, sensitive: true }
          ]} />
          <div className="staff-profile-document-list">{rightToWorkRecords.length ? rightToWorkRecords.map(renderHrDocument) : <EmptyState title="No right-to-work records" description="Right-to-work HR records filed for this person will appear here." />}</div>
        </Card>
      );
    }
    if (activeSection === 'documents') {
      return (
        <Card
          title="Documents"
          subtitle="Documents are held on this staff profile. Sensitive HR records remain permission-gated."
          action={canManageDocuments ? <Button type="button" size="sm" onClick={() => setDocumentRequestOpen(true)}>Request document</Button> : undefined}
        >
          <div className="staff-profile-document-toolbar"><span><strong>{member.records.length + visibleHrRecords.length} documents</strong><span className="subtle">{approvedDocuments} approved · {attentionDocuments} needing attention</span></span><Badge tone={visibleHrRecords.length ? 'warning' : 'info'}>{visibleHrRecords.length} restricted HR</Badge></div>
          {renderDocumentRequestModal()}
          <ActionFeedback message={messageTarget === 'document-request' ? message : null} tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'} />
          {renderDocumentComposer()}
          <div className="staff-profile-document-list">{member.records.length || visibleHrRecords.length ? <>{member.records.map(renderComplianceDocument)}{visibleHrRecords.map(renderHrDocument)}</> : <EmptyState title="No documents" description="Upload or request RSA, onboarding, right-to-work, contract, and training documents from this profile." />}</div>
        </Card>
      );
    }
    if (activeSection === 'shifts') {
      return (
        <Card title="Shifts" subtitle="Recent roster shifts attached to this staff profile.">
          <div className="staff-profile-document-list">
            {recentShifts.length ? recentShifts.map((shift) => (
              <div key={shift.id} className="staff-profile-document-row">
                <span className="staff-profile-document-icon"><IconCalendarClock /></span>
                <span className="staff-profile-document-main"><strong>{shift.roleTitle || member.roleTitle || 'Rostered shift'}</strong><span className="subtle">{shift.venue || member.venue || 'No venue'} · {timeOf(shift.startsAt)} – {timeOf(shift.endsAt)}</span>{shift.notes ? <span className="subtle">{shift.notes}</span> : null}</span>
                <Badge tone={shift.status === 'PUBLISHED' ? 'positive' : 'warning'}>{shift.status}</Badge>
              </div>
            )) : <EmptyState title="No shifts" description="Published and draft roster shifts for this person will appear here." />}
          </div>
        </Card>
      );
    }
    if (activeSection === 'pin') {
      return (
        <Card title="PIN access" subtitle="Shared-device PIN status for iPad staff switching.">
          <ProfileInfoGrid items={[
            { label: 'PIN status', value: member.pinUpdatedAt ? 'Set' : 'Not set' },
            { label: 'Last updated', value: profileDate(member.pinUpdatedAt) },
            { label: 'Account type', value: member.accountType.replaceAll('_', ' ') }
          ]} />
          {canManageProfileAccess && member.accountType === 'HUMAN' ? (
            <div className="staff-profile-actions">
              <Button type="button" variant="secondary" onClick={setKioskPin} disabled={saving}>
                {member.pinUpdatedAt ? 'Reset kiosk PIN' : 'Set kiosk PIN'}
              </Button>
              {!member.pinUpdatedAt ? (
                <p className="subtle">No PIN set yet — this person can’t switch into their account on a shared venue iPad until you set one.</p>
              ) : null}
            </div>
          ) : null}
          {message && messageTarget === 'pin' ? <p className="subtle">{message}</p> : null}
          <details className="staff-profile-collapsible">
            <summary>Device security notes</summary>
            <p className="subtle">PINs are managed through the staff PIN reset/change flow. Venue device accounts cannot use this profile workspace to access staff documents, payroll, or HR settings.</p>
          </details>
        </Card>
      );
    }
    return <Card title="Leave" subtitle="Leave summary for this staff profile."><EmptyState title="Leave details live in the Leave calendar" description="Open the Leave page to manage requests and approvals. This profile keeps the section available for staff-context navigation." /><NavLink to="/leave"><Button type="button" variant="secondary">Open Leave calendar</Button></NavLink></Card>;
  }

  return (
    <div className="page-stack staff-profile-workspace">
      <div className="staff-profile-topline">
        <NavLink to="/profiles"><Button type="button" variant="ghost" size="sm">Back to profiles</Button></NavLink>
        <span className="subtle">Staff profile workspace</span>
      </div>
      <div className="staff-profile-layout">
        <aside className="staff-profile-rail" aria-label="Staff profile sections">
          <div className="staff-profile-identity">
            <span className="staff-profile-avatar">{staffInitials(member)}</span>
            <span>
              <strong>{staffFullName(member)}</strong>
              <span className="subtle">{member.roleTitle || 'No role'} · {member.venue || 'No venue'}</span>
              <span className="staff-profile-chip-row">
                <Badge tone={member.employmentStatus === 'ACTIVE' ? 'positive' : 'warning'}>{member.employmentStatus}</Badge>
                {member.accountType === 'VENUE_DEVICE' ? <Badge tone="warning">Venue device</Badge> : null}
                {attentionDocuments ? <Badge tone="warning">{attentionDocuments} docs need attention</Badge> : null}
              </span>
            </span>
          </div>
          <Select label="Staff member" value={member.id} onChange={(event) => navigate(`/staff/${event.currentTarget.value}/${activeSection}`)} options={switchStaffOptions} />
          <Select label="Profile section" value={activeSection} onChange={(event) => navigate(`/staff/${member.id}/${event.currentTarget.value}`)} options={STAFF_PROFILE_SECTIONS.map((item) => ({ label: item.sensitive ? `${item.label} (restricted)` : item.label, value: item.id }))} />
          <nav className="staff-profile-section-nav">
            {Object.entries(sidebarGroups).map(([group, items]) => (
              <div key={group}>
                <span className="staff-profile-nav-group">{group}</span>
                {items.map((item) => {
                  const itemLocked = profileSectionIsLocked(item.id, { canOpenHr, canOpenRightToWork, canOpenPayroll });
                  return <NavLink key={item.id} to={`/staff/${member.id}/${item.id}`} className={({ isActive }: { isActive: boolean }) => `${isActive ? 'is-active' : ''} ${itemLocked ? 'is-locked' : ''}`}><span>{item.label}</span>{item.sensitive ? <IconFileLock /> : null}</NavLink>;
                })}
              </div>
            ))}
          </nav>
        </aside>
        <main className="staff-profile-main">
          <PageHeader
            eyebrow={sectionTitle}
            title={staffFullName(member)}
            description="A profile-first workspace for personal details, employment information, documents, roster context, and restricted HR sections."
            actions={
              <>
                {activeSection === 'payroll' && canManageProfileAccess ? (
                  <Button type="button" onClick={() => setProfileModalOpen(true)}>Edit payroll</Button>
                ) : (
                  <Button type="button" onClick={() => setProfileModalOpen(true)}>Edit profile</Button>
                )}
                {canManageProfileAccess ? (
                  <Button type="button" variant="secondary" onClick={() => setXeroModalOpen(true)}>Xero</Button>
                ) : null}
                {canManageProfileAccess && !member.isAdmin ? (
                  <Button type="button" variant="danger" disabled={saving} onClick={() => void archiveStaff()}>Archive staff</Button>
                ) : null}
              </>
            }
          />
          <div className="stats-grid staff-profile-stats">
            <StatCard label="Documents" value={member.records.length + visibleHrRecords.length} hint={`${attentionDocuments} need attention`} />
            <StatCard label="Training" value={member.trainingRecords.length} hint={`Level ${member.trainingLevel ?? 0}`} />
            <StatCard label="Shifts" value={member._count?.rosterShifts ?? memberDetail?.rosterShifts?.length ?? 0} hint="Roster records" />
            <StatCard label="PIN" value={member.pinUpdatedAt ? 'Set' : 'Not set'} hint={member.pinUpdatedAt ? profileDate(member.pinUpdatedAt) : 'Staff iPad access'} />
          </div>
          {renderSection()}
        </main>
      </div>
      <StaffModal open={profileModalOpen} title={`Edit ${staffFullName(member)}`} subtitle="Profile edits stay in a modal so the staff workspace remains in place." onClose={() => setProfileModalOpen(false)}>
        <StaffProfileForm mode="edit" initial={member} roleTemplates={roleTemplates} onSaved={(saved) => void handleProfileSaved(saved)} onCancel={() => setProfileModalOpen(false)} />
      </StaffModal>
      <StaffModal
        open={xeroModalOpen}
        title={`Xero — ${staffFullName(member)}`}
        subtitle="Push this profile into either company's payroll, link it to the employee record already there, or pull that record's details back onto this profile."
        onClose={() => {
          setXeroModalOpen(false);
          if (xeroPulled) {
            setXeroPulled(false);
            void reload();
          }
        }}
      >
        {xeroModalOpen ? <StaffXeroPanel staffId={member.id} onChanged={() => setXeroPulled(true)} /> : null}
      </StaffModal>
    </div>
  );
}

function AccessPage({
  staff,
  roleTemplates,
  selectedId,
  setSelectedId,
  reload
}: {
  staff: StaffProfile[];
  roleTemplates: StaffRoleTemplate[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const selected = staff.find((member) => member.id === selectedId) ?? staff[0] ?? null;
  const [profileDraft, setProfileDraft] = useState<StaffDraft>(() => selected ? draftFromStaff(selected) : emptyStaffDraft());
  const [training, setTraining] = useState<TrainingOverview | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState('');
  const [documentDraft, setDocumentDraft] = useState({
    recordType: 'TRAINING' as StaffRecordType,
    title: '',
    issuer: '',
    certificateNumber: '',
    issueDate: '',
    expiryDate: '',
    status: 'PENDING',
    documentName: '',
    documentUrl: '',
    notes: ''
  });
  const [documentRequestDraft, setDocumentRequestDraft] = useState<StaffDocumentRequestDraft>(() => emptyStaffDocumentRequestDraft());
  const [documentRequestOpen, setDocumentRequestOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState<{ action: StaffDocumentPromptAction; recordId: string } | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const accessByApp = new Map(selected?.appAccess.map((access) => [access.appId, access]));
  const activeModules = (training?.modules ?? []).filter((module) => module.status === 'ACTIVE');
  const selectedTrainingRecords = training?.records.filter((record) => record.staffProfileId === selected?.id) ?? selected?.trainingRecords ?? [];
  const canManageSettings = canAccessSettings(user);
  const visibleStaffApps = canManageSettings ? STAFF_APPS : STAFF_APPS.filter((app) => app.id !== 'SETTINGS');
  const selectedRoleTemplate = roleTemplates.find((template) => template.id === profileDraft.roleTemplateId) ?? null;

  function openProfile(id: string, section: StaffProfileSectionId = 'personal') {
    setSelectedId(id);
    navigate(`/staff/${id}/${section}`);
  }

  function permissionsFor(appId: AlmaAppId) {
    return accessByApp.get(appId)?.permissions ?? {};
  }

  const loadTraining = useCallback(async () => {
    try {
      const overview = await api<TrainingOverview>('/api/training/overview');
      setTraining(overview);
      if (!selectedModuleId && overview.modules[0]) setSelectedModuleId(overview.modules[0].id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load Academy records.');
    }
  }, [selectedModuleId]);

  useEffect(() => {
    setProfileDraft(selected ? draftFromStaff(selected) : emptyStaffDraft());
    setDocumentPrompt(null);
    setDocumentRequestDraft(emptyStaffDocumentRequestDraft());
    setDocumentRequestOpen(false);
    setProfileModalOpen(false);
  }, [selected?.id]);

  useEffect(() => {
    void loadTraining();
  }, [loadTraining]);

  function updateProfile<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setProfileDraft((current) => ({ ...current, [key]: value }));
  }

  function selectProfileRoleTemplate(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setProfileDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  async function setAccess(appId: AlmaAppId, status: StaffAppAccessStatus) {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`access:${appId}`);
    try {
      await api(`/api/staff/${selected.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: visibleStaffApps.map((app) => {
            const current = accessByApp.get(app.id);
            return {
              appId: app.id,
              status: app.id === appId ? status : current?.status ?? 'DISABLED',
              role: current?.role ?? app.role,
              permissions: current?.permissions ?? {},
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

  async function saveAppAccessWithPreset(presetId: string) {
    if (!selected) return;
    const preset = STAFF_PROFILE_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;

    setSaving(true);
    setMessage(null);
    setMessageTarget(`preset:${presetId}`);
    try {
      await api<StaffProfile>(`/api/staff/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...staffPayloadFromDraft({ ...profileDraft, roleTitle: preset.roleTitle, employmentType: preset.employmentType }),
          roleTitle: preset.roleTitle,
          employmentType: preset.employmentType
        })
      });
      await api(`/api/staff/${selected.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: visibleStaffApps.map((app) => {
            const configured = preset.appAccess[app.id];
            const current = accessByApp.get(app.id);
            return {
              appId: app.id,
              status: configured?.status ?? current?.status ?? 'DISABLED',
              role: configured?.role ?? current?.role ?? app.role,
              permissions: configured?.permissions ?? current?.permissions ?? {},
              notes: current?.notes ?? `Preset: ${preset.label}`
            };
          })
        })
      });
      setProfileDraft((current) => ({ ...current, roleTitle: preset.roleTitle, employmentType: preset.employmentType }));
      await reload();
      setMessage(`${preset.label} profile applied.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not apply profile preset.');
    } finally {
      setSaving(false);
    }
  }

  async function setPermission(appId: AlmaAppId, permissionKey: string, enabled: boolean) {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`permission:${appId}`);
    try {
      await api(`/api/staff/${selected.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: visibleStaffApps.map((app) => {
            const current = accessByApp.get(app.id);
            const currentPermissions = current?.permissions ?? {};
            return {
              appId: app.id,
              status: current?.status ?? 'DISABLED',
              role: current?.role ?? app.role,
              permissions: app.id === appId
                ? { ...currentPermissions, [permissionKey]: enabled }
                : currentPermissions,
              notes: current?.notes ?? ''
            };
          })
        })
      });
      await reload();
      setMessage('Custom permission updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update permission.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('profile');
    try {
      await api<StaffProfile>(`/api/staff/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify(staffPayloadFromDraft(profileDraft))
      });
      await reload();
      setMessage('Staff profile saved.');
      setProfileModalOpen(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function archiveProfile() {
    if (!selected || selected.isAdmin) return;
    if (!window.confirm(`Archive ${selected.firstName} ${selected.lastName}? They will disappear from active staff lists.`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('profile');
    try {
      await api(`/api/staff/${selected.id}`, { method: 'DELETE' });
      await reload();
      const next = staff.find((member) => member.id !== selected.id);
      setSelectedId(next?.id ?? '');
      setProfileModalOpen(false);
      setMessage('Staff profile archived.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not archive staff profile.');
    } finally {
      setSaving(false);
    }
  }

  async function addDocument() {
    setMessageTarget('document');
    if (!selected || !documentDraft.title.trim()) {
      setMessage('Document title is required.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${selected.id}/records`, {
        method: 'POST',
        body: JSON.stringify(documentDraft)
      });
      setDocumentDraft({
        recordType: 'TRAINING',
        title: '',
        issuer: '',
        certificateNumber: '',
        issueDate: '',
        expiryDate: '',
        status: 'PENDING',
        documentName: '',
        documentUrl: '',
        notes: ''
      });
      await reload();
      setMessage('Document added.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not add document.');
    } finally {
      setSaving(false);
    }
  }

  async function requestDocument() {
    setMessageTarget('document-request');
    if (!selected || !documentRequestDraft.title.trim()) {
      setMessage('Document title is required.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/${selected.id}/documents/request`, {
        method: 'POST',
        body: JSON.stringify(documentRequestDraft)
      });
      setDocumentRequestDraft(emptyStaffDocumentRequestDraft());
      setDocumentRequestOpen(false);
      await reload();
      setMessage('Document request sent.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not request document.');
    } finally {
      setSaving(false);
    }
  }

  async function attachDocumentDraftFile(file: File) {
    setMessageTarget('document');
    setMessage(null);
    try {
      const upload = await readOnboardingUpload(file);
      setDocumentDraft((current) => ({
        ...current,
        documentName: upload.name,
        documentUrl: upload.url
      }));
      setMessage(`${upload.name} attached.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not attach file.');
    }
  }

  async function approveDocument(record: StaffComplianceRecord) {
    if (!selected) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:approve`);
    try {
      await api(`/api/staff/${selected.id}/records/${record.id}/approve`, { method: 'POST' });
      await reload();
      setMessage('Document approved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectDocument(record: StaffComplianceRecord) {
    if (!selected) return;
    const reason = window.prompt('Reason for rejecting this document?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:reject`);
    try {
      await api(`/api/staff/${selected.id}/records/${record.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      });
      await reload();
      setMessage('Document rejected.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject document.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDocumentAction() {
    if (!selected || !documentPrompt) return;
    const record = selected.records.find((item) => item.id === documentPrompt.recordId);
    if (!record) {
      setDocumentPrompt(null);
      return;
    }

    if (documentPrompt.action === 'delete' && !record.documentUrl) {
      setDocumentPrompt(null);
      return;
    }

    const actionKey = documentPrompt.action === 'delete' ? 'remove' : 'request';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:${actionKey}`);
    try {
      await api(`/api/staff/${selected.id}/records/${record.id}/${documentPrompt.action === 'delete' ? 'document' : 'request-document'}`, {
        method: documentPrompt.action === 'delete' ? 'DELETE' : 'POST'
      });
      await reload();
      setDocumentPrompt(null);
      setMessage(documentPrompt.action === 'delete'
        ? 'Document deleted. The record is still available for follow-up.'
        : 'Document requested again. Marked for follow-up; ask the staff member to upload again.');
    } catch (err) {
      setMessage(err instanceof Error
        ? err.message
        : documentPrompt.action === 'delete' ? 'Could not delete document.' : 'Could not request document.');
    } finally {
      setSaving(false);
    }
  }

  async function assignAcademyModule() {
    setMessageTarget('academy-assign');
    if (!selected || !selectedModuleId) {
      setMessage('Choose a module before assigning Academy training.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/training/assignments', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: selected.id,
          moduleId: selectedModuleId,
          notes: 'Assigned from Access profile.'
        })
      });
      await Promise.all([loadTraining(), reload()]);
      setMessage('Academy module assigned.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not assign Academy module.');
    } finally {
      setSaving(false);
    }
  }

  async function updateAcademyRecord(record: StaffTrainingRecord, status: StaffTrainingStatus) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`academy:${record.id}:${status}`);
    try {
      await api(`/api/training/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          completedAt: status === 'COMPLETED' ? new Date().toISOString() : '',
          notes: record.notes ?? ''
        })
      });
      await Promise.all([loadTraining(), reload()]);
      setMessage('Academy record updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update Academy record.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAcademyRecord(record: StaffTrainingRecord) {
    if (!window.confirm(`Remove ${record.module?.title ?? 'this Academy module'} from ${selected?.firstName ?? 'this staff member'}?`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`academy:${record.id}:remove`);
    try {
      await api(`/api/training/records/${record.id}`, { method: 'DELETE' });
      await Promise.all([loadTraining(), reload()]);
      setMessage('Academy assignment removed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove Academy assignment.');
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
              onClick={() => openProfile(member.id, 'access')}
            >
              <span>
                <strong>
                  {member.firstName} {member.lastName}
                </strong>
                <span className="subtle" style={{ display: 'block' }}>{member.roleTitle}</span>
                <span className="subtle" style={{ display: 'block' }}>{member.venue || 'No venue'} · {member.employmentStatus}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card
        title={selected ? `${selected.firstName} ${selected.lastName}` : 'Staff profile'}
        subtitle="Edit details, documents, Academy tasks, notes, and app access from one admin workspace"
      >
        {!selected ? <EmptyState title="No staff selected" description="Add or import staff first." /> : null}
        {selected ? (
          <>
            <div className="stats-grid">
              <StatCard label="Profile" value={selected.roleTitle} hint={selected.venue || 'No venue'} />
              <StatCard label="Documents" value={selected.records.length} hint={`${selected.records.filter((record) => record.status === 'APPROVED').length} approved`} />
              <StatCard label="Academy" value={`L${selected.trainingLevel ?? 0}`} hint={`${selectedTrainingRecords.length} records`} />
              <StatCard label="Pay" value={formatCents(selected.trainingPayRateCents ?? selected.payRateCents)} hint={selected.payType || 'No pay type'} />
            </div>

            <Card title="Assigned role" subtitle="Roles come from Alma Admin and apply app access automatically.">
              <div className="form-grid two">
                <Select
                  label="Role template"
                  value={profileDraft.roleTemplateId}
                  onChange={(event) => selectProfileRoleTemplate(event.currentTarget.value)}
                  options={[
                    { label: roleTemplates.length ? 'Choose a role template' : 'No role templates configured', value: '' },
                    ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                  ]}
                />
                <Input label="Role title" value={profileDraft.roleTitle} readOnly />
              </div>
              <details className="staff-role-preview">
                <summary>Role access preview</summary>
                <p className="subtle">{roleTemplateAccessSummary(selectedRoleTemplate)}</p>
                {profileDraft.roleTemplateId && profileDraft.roleTemplateId !== (selected.roleTemplateId ?? '') ? (
                  <p className="subtle">Changing role will update this person’s app access to match the selected role when you save profile details.</p>
                ) : null}
                <p className="subtle">Custom permission controls remain available below for one-off overrides.</p>
              </details>
              {!roleTemplates.length ? (
                <p className="subtle">Create role templates in Alma Admin / Roles before assigning them here.</p>
              ) : null}
            </Card>

            <Card
              title="Profile details"
              subtitle="Role, personal details, payroll fields, and manager notes."
              action={
                <span className="inline-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={() => openProfile(selected.id, 'personal')}>
                    Open profile
                  </Button>
                  <Button type="button" size="sm" onClick={() => openProfile(selected.id, 'payroll')}>
                    Payroll
                  </Button>
                </span>
              }
            >
              <div className="staff-profile-summary-grid">
                <div>
                  <span className="subtle">Role</span>
                  <strong>{selected.roleTitle || 'No role'}</strong>
                </div>
                <div>
                  <span className="subtle">Contact</span>
                  <strong>{selected.email || selected.phone || 'No contact recorded'}</strong>
                </div>
                <div>
                  <span className="subtle">Employment</span>
                  <strong>{selected.employmentStatus} · {selected.employmentType || 'No type'}</strong>
                </div>
                <div>
                  <span className="subtle">Pay</span>
                  <strong>{selected.payType || 'No pay type'} · {formatCents(selected.payRateCents)}</strong>
                </div>
              </div>
              <p className="subtle">Editing opens in a modal so this profile stays in place.</p>
            </Card>

            <StaffModal
              open={profileModalOpen}
              title={`Edit ${selected.firstName} ${selected.lastName}`}
              subtitle="Update profile, role, payroll, and work-rights details."
              onClose={() => {
                setProfileDraft(draftFromStaff(selected));
                setProfileModalOpen(false);
              }}
            >
              <form
                className="staff-profile-form staff-profile-modal-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProfile();
                }}
              >
                <section className="staff-modal-section">
                  <h3>Identity</h3>
                  <div className="form-grid three">
                    <Input label="First name" value={profileDraft.firstName} onChange={(event) => updateProfile('firstName', event.currentTarget.value)} />
                    <Input label="Last name" value={profileDraft.lastName} onChange={(event) => updateProfile('lastName', event.currentTarget.value)} />
                    <Input label="Role title" value={profileDraft.roleTitle} readOnly />
                    <Input label="Email" type="email" value={profileDraft.email} onChange={(event) => updateProfile('email', event.currentTarget.value)} />
                    <Input label="Phone" value={profileDraft.phone} onChange={(event) => updateProfile('phone', event.currentTarget.value)} />
                    <Select label="Venue" value={profileDraft.venue} onChange={(event) => updateProfile('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
                    <Select label="Status" value={profileDraft.employmentStatus} onChange={(event) => updateProfile('employmentStatus', event.currentTarget.value)} options={['ACTIVE', 'PENDING', 'ARCHIVED', 'TERMINATED'].map((status) => ({ label: status, value: status }))} />
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span className="subtle" style={{ display: 'block', marginBottom: 6 }}>
                        POS permissions — this person's code can approve these on the register (managers approve everything):
                      </span>
                      {(['refunds', 'voids', 'discounts', 'till', 'office'] as const).map((permissionKey) => {
                        const current = ((selected as unknown as { posPermissions?: Record<string, boolean> })?.posPermissions) ?? {};
                        return (
                          <label key={permissionKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 16, fontSize: 13 }}>
                            <input
                              type="checkbox"
                              defaultChecked={Boolean(current[permissionKey])}
                              onChange={(event) => {
                                if (!selected) return;
                                const next = { ...current, [permissionKey]: event.currentTarget.checked };
                                void api(`/api/staff/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ posPermissions: next }) })
                                  .then(() => reload())
                                  .catch(() => setMessage('Could not save POS permissions.'));
                              }}
                            />
                            {permissionKey}
                          </label>
                        );
                      })}
                    </div>
                    {/* Training till. Admin-only, and deliberately not one of
                        the POS permission chips above — those widen what
                        somebody may approve, this decides whether their sales
                        are real. The API refuses it from a non-admin too; this
                        just doesn't offer what would be refused. */}
                    {user?.isAdmin || user?.role === 'ADMIN' ? (
                      <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            defaultChecked={Boolean(
                              (selected as unknown as { trainingOnly?: boolean })?.trainingOnly
                            )}
                            onChange={(event) => {
                              if (!selected) return;
                              const next = event.currentTarget.checked;
                              void api(`/api/staff/${selected.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ trainingOnly: next })
                              })
                                .then(() => reload())
                                .catch(() => setMessage('Could not change the training setting.'));
                            }}
                          />
                          <strong>Training till</strong>
                        </label>
                        <span className="subtle" style={{ display: 'block', marginTop: 4 }}>
                          Every bill this account opens is a practice sale — no takings, no drawer, no reports, nothing
                          to the kitchen — and card terminals and gift cards are refused on it. The register shows it and
                          offers no way to switch it off. Use it for a new starter learning the till, or for an App
                          Review tester.
                        </span>
                      </div>
                    ) : null}
                    <Input label="Start date" type="date" value={profileDraft.startDate} onChange={(event) => updateProfile('startDate', event.currentTarget.value)} />
                    <Input label="Date of birth" type="date" value={profileDraft.dateOfBirth} onChange={(event) => updateProfile('dateOfBirth', event.currentTarget.value)} />
                  </div>
                  <div className="form-grid three">
                    <Input label="Address" value={profileDraft.addressLine1} onChange={(event) => updateProfile('addressLine1', event.currentTarget.value)} />
                    <Input label="Address 2" value={profileDraft.addressLine2} onChange={(event) => updateProfile('addressLine2', event.currentTarget.value)} />
                    <Input label="Suburb" value={profileDraft.suburb} onChange={(event) => updateProfile('suburb', event.currentTarget.value)} />
                    <Input label="State" value={profileDraft.state} onChange={(event) => updateProfile('state', event.currentTarget.value)} />
                    <Input label="Postcode" value={profileDraft.postcode} onChange={(event) => updateProfile('postcode', event.currentTarget.value)} />
                    <Input label="Employment type" value={profileDraft.employmentType} onChange={(event) => updateProfile('employmentType', event.currentTarget.value)} />
                  </div>
                  <div className="form-grid three">
                    <Input label="Emergency contact" value={profileDraft.emergencyContactName} onChange={(event) => updateProfile('emergencyContactName', event.currentTarget.value)} />
                    <Input label="Relationship" value={profileDraft.emergencyContactRelationship} onChange={(event) => updateProfile('emergencyContactRelationship', event.currentTarget.value)} />
                    <Input label="Emergency phone" value={profileDraft.emergencyContactPhone} onChange={(event) => updateProfile('emergencyContactPhone', event.currentTarget.value)} />
                    <Input label="Pay type" value={profileDraft.payType} onChange={(event) => updateProfile('payType', event.currentTarget.value)} />
                    <Input label="Pay rate" value={profileDraft.payRate} onChange={(event) => updateProfile('payRate', event.currentTarget.value)} />
                    <Input label="Award" value={profileDraft.payAward} onChange={(event) => updateProfile('payAward', event.currentTarget.value)} />
                  </div>
                </section>

                <details className="staff-modal-section staff-modal-details">
                  <summary>Payroll, tax, and work-rights fields</summary>
                  <div className="form-grid three">
                    <Input label="TFN" value={profileDraft.taxFileNumber} onChange={(event) => updateProfile('taxFileNumber', event.currentTarget.value)} />
                    <Input label="Tax residency" value={profileDraft.taxResidencyStatus} onChange={(event) => updateProfile('taxResidencyStatus', event.currentTarget.value)} />
                    <Input label="Super fund" value={profileDraft.superFundName} onChange={(event) => updateProfile('superFundName', event.currentTarget.value)} />
                    <Input label="Super ABN" value={profileDraft.superFundAbn} onChange={(event) => updateProfile('superFundAbn', event.currentTarget.value)} />
                    <Input label="Super USI" value={profileDraft.superFundUsi} onChange={(event) => updateProfile('superFundUsi', event.currentTarget.value)} />
                    <Input label="Member number" value={profileDraft.superMemberNumber} onChange={(event) => updateProfile('superMemberNumber', event.currentTarget.value)} />
                    <Input label="Bank account name" value={profileDraft.bankAccountName} onChange={(event) => updateProfile('bankAccountName', event.currentTarget.value)} />
                    <Input label="BSB" value={profileDraft.bankBsb} onChange={(event) => updateProfile('bankBsb', event.currentTarget.value)} />
                    <Input label="Account number" value={profileDraft.bankAccountNumber} onChange={(event) => updateProfile('bankAccountNumber', event.currentTarget.value)} />
                  </div>
                  <div className="onboarding-toggle-row">
                    <label className="check-row">
                      <input type="checkbox" checked={profileDraft.taxFreeThreshold} onChange={(event) => updateProfile('taxFreeThreshold', event.currentTarget.checked)} />
                      Claims tax-free threshold
                    </label>
                    <label className="check-row">
                      <input type="checkbox" checked={profileDraft.hasStudyTrainingLoan} onChange={(event) => updateProfile('hasStudyTrainingLoan', event.currentTarget.checked)} />
                      Study or training loan
                    </label>
                  </div>
                  <div className="form-grid three">
                    <Input label="Visa status" value={profileDraft.visaStatus} onChange={(event) => updateProfile('visaStatus', event.currentTarget.value)} />
                    <Input label="Visa subclass" value={profileDraft.visaSubclass} onChange={(event) => updateProfile('visaSubclass', event.currentTarget.value)} />
                    <Input label="Visa expiry" type="date" value={profileDraft.visaExpiryDate} onChange={(event) => updateProfile('visaExpiryDate', event.currentTarget.value)} />
                    <Input label="Xero employee ID" value={profileDraft.xeroEmployeeId} onChange={(event) => updateProfile('xeroEmployeeId', event.currentTarget.value)} />
                    <Input label="Xero payroll calendar" value={profileDraft.xeroPayrollCalendarId} onChange={(event) => updateProfile('xeroPayrollCalendarId', event.currentTarget.value)} />
                    <Input label="Xero earnings rate" value={profileDraft.xeroEarningsRateId} onChange={(event) => updateProfile('xeroEarningsRateId', event.currentTarget.value)} />
                  </div>
                  <Textarea label="Work rights notes" rows={2} value={profileDraft.workRightsNotes} onChange={(event) => updateProfile('workRightsNotes', event.currentTarget.value)} />
                </details>

                <section className="staff-modal-section">
                  <h3>Notes</h3>
                  <Textarea label="Manager notes" rows={3} value={profileDraft.notes} onChange={(event) => updateProfile('notes', event.currentTarget.value)} />
                </section>

                <div className="staff-modal-footer">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setProfileDraft(draftFromStaff(selected));
                      setProfileModalOpen(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" variant="danger" disabled={saving || selected.isAdmin} onClick={() => void archiveProfile()}>Archive profile</Button>
                  <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
                  <ActionFeedback
                    message={messageTarget === 'profile' ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </form>
            </StaffModal>

            <div className="app-access-grid">
              {visibleStaffApps.map((app) => {
                const current = accessByApp.get(app.id);
                const enabled = current?.status === 'ENABLED';
                return (
                  <div key={app.id} className="app-access-tile">
                    <strong>{app.label}</strong>
                    <span className="subtle">Role: {current?.role ?? app.role}</span>
                    <Badge tone={enabled ? 'positive' : 'muted'} dot>
                      {current?.status ?? 'DISABLED'}
                    </Badge>
                    <span className="subtle">
                      {Object.entries(current?.permissions ?? {}).filter(([, allowed]) => allowed).length} custom permissions
                    </span>
                    <Button
                      size="sm"
                      variant={enabled ? 'secondary' : 'primary'}
                      disabled={saving}
                      onClick={() => void setAccess(app.id, enabled ? 'DISABLED' : 'ENABLED')}
                    >
                      {enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `access:${app.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </div>
                );
              })}
            </div>

            <Card title="Custom permissions" subtitle="Fine tune what this person can do after applying a profile type.">
              <div className="app-access-grid">
                {visibleStaffApps.map((app) => {
                  const permissions = ACCESS_PERMISSION_GROUPS[app.id] ?? [];
                  if (!permissions.length) return null;
                  return (
                    <AppPermissionTile
                      key={app.id}
                      app={app}
                      access={accessByApp.get(app.id)}
                      permissions={permissions}
                      canEdit
                      saving={saving}
                      onToggle={(key, next) => void setPermission(app.id, key, next)}
                      feedback={
                        <ActionFeedback
                          message={messageTarget === `permission:${app.id}` ? message : null}
                          tone={message?.includes('Could') ? 'error' : 'success'}
                        />
                      }
                    />
                  );
                })}
              </div>
            </Card>

            <Card
              title="Documents"
              subtitle="View uploaded documents, request missing evidence, and approve submitted files."
              action={<Button type="button" size="sm" onClick={() => setDocumentRequestOpen(true)}>Request document</Button>}
            >
              <StaffModal
                open={documentRequestOpen}
                title="Request document"
                subtitle={selected ? `Send a document request to ${selected.firstName} ${selected.lastName}.` : undefined}
                width="standard"
                onClose={() => setDocumentRequestOpen(false)}
              >
                <form
                  className="staff-profile-form staff-profile-modal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void requestDocument();
                  }}
                >
                  <section className="staff-modal-section">
                    <div className="form-grid">
                      <Select
                        label="Document type"
                        value={documentRequestDraft.recordType}
                        onChange={(event) => {
                          const recordType = event.currentTarget.value as StaffRecordType;
                          setDocumentRequestDraft((current) => ({
                            ...current,
                            recordType,
                            title: current.title || recordType.replaceAll('_', ' ')
                          }));
                        }}
                        options={['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'].map((value) => ({ label: value.replaceAll('_', ' '), value }))}
                      />
                      <Input label="Request title" value={documentRequestDraft.title} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, title: el.value })); }} />
                      <Input label="Due date" type="date" value={documentRequestDraft.dueAt} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, dueAt: el.value })); }} />
                      <Select
                        label="Priority"
                        value={documentRequestDraft.priority}
                        onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, priority: el.value as StaffDocumentRequestDraft['priority'] })); }}
                        options={['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((value) => ({ label: value.charAt(0) + value.slice(1).toLowerCase(), value }))}
                      />
                    </div>
                    <label className="check-row">
                      <input
                        type="checkbox"
                        checked={documentRequestDraft.expiryRequired}
                        onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, expiryRequired: el.checked })); }}
                      />
                      Expiry date required where applicable
                    </label>
                    <Textarea label="Optional note" rows={3} value={documentRequestDraft.notes} onChange={(event) => { const el = event.currentTarget; setDocumentRequestDraft((current) => ({ ...current, notes: el.value })); }} />
                  </section>
                  <div className="staff-modal-footer">
                    <Button type="button" variant="ghost" disabled={saving} onClick={() => setDocumentRequestOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={saving}>{saving ? 'Sending…' : 'Send request'}</Button>
                    <ActionFeedback message={messageTarget === 'document-request' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                  </div>
                </form>
              </StaffModal>
              <ActionFeedback message={messageTarget === 'document-request' ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
              <div className="staff-list">
                {selected.records.length === 0 ? <EmptyState title="No documents" description="Add RSA, visa, payroll or training documents below." /> : null}
                {selected.records.map((record) => {
                  const documentRecord = staffComplianceDocumentRecord(record);
                  return (
                  <div key={record.id} className="staff-expiry-row">
                    <span>
                      <strong>{record.title}</strong>
                      <span className="subtle">{record.recordType} · {record.issuer || 'No issuer'} · expires {record.expiryDate ? new Date(record.expiryDate).toLocaleDateString() : 'No expiry'}</span>
                      {documentRecord.dueAt ? <span className="subtle">Due {new Date(documentRecord.dueAt).toLocaleDateString()}</span> : null}
                      {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
                      <StaffDocumentViewLink documentUrl={record.documentUrl} />
                      {recordDocumentRequested(documentRecord) ? <span className="subtle">Document requested{documentRecord.requestedAt ? ` ${new Date(documentRecord.requestedAt).toLocaleDateString()}` : ''}</span> : null}
                      {documentRecord.rejectionReason ? <span className="subtle">Rejected: {documentRecord.rejectionReason}</span> : null}
                      {record.notes ? <span className="subtle">{record.notes}</span> : null}
                    </span>
                    <span className="invite-row-actions">
                      <Badge tone={staffRecordStatusTone(documentRecord.status)}>{staffRecordStatusLabel(documentRecord.status)}</Badge>
                      <Button type="button" size="sm" variant="secondary" disabled={saving || documentRecord.status === 'APPROVED' || !record.documentUrl} onClick={() => void approveDocument(record)}>Approve</Button>
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:approve` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      {record.documentUrl && documentRecord.status !== 'APPROVED' ? (
                        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void rejectDocument(record)}>Reject</Button>
                      ) : null}
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:reject` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      {record.documentUrl ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="danger"
                          disabled={saving}
                          onClick={() => setDocumentPrompt({ action: 'delete', recordId: record.id })}
                        >
                          Delete document
                        </Button>
                      ) : null}
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:remove` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={saving}
                        onClick={() => setDocumentPrompt({ action: 'request', recordId: record.id })}
                      >
                        Re-request document
                      </Button>
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:request` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                    {documentPrompt?.recordId === record.id ? (
                      <StaffDocumentActionPrompt
                        action={documentPrompt.action}
                        saving={saving}
                        feedback={messageTarget === `record:${record.id}:${documentPrompt.action === 'delete' ? 'remove' : 'request'}` ? message : null}
                        onCancel={() => setDocumentPrompt(null)}
                        onConfirm={() => void confirmDocumentAction()}
                      />
                    ) : null}
                  </div>
                  );
                })}
              </div>
              <form
                className="staff-profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addDocument();
                }}
              >
                <div className="form-grid three">
                  <Select label="Type" value={documentDraft.recordType} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, recordType: el.value as StaffRecordType })); }} options={['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'].map((value) => ({ label: value.replace('_', ' '), value }))} />
                  <Input label="Title" value={documentDraft.title} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, title: el.value })); }} />
                  <Input label="Issuer" value={documentDraft.issuer} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, issuer: el.value })); }} />
                  <Input label="Certificate number" value={documentDraft.certificateNumber} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, certificateNumber: el.value })); }} />
                  <Input label="Issue date" type="date" value={documentDraft.issueDate} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, issueDate: el.value })); }} />
                  <Input label="Expiry date" type="date" value={documentDraft.expiryDate} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, expiryDate: el.value })); }} />
                  <Select label="Status" value={documentDraft.status} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, status: el.value })); }} options={['REQUESTED', 'PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED'].map((value) => ({ label: value.replaceAll('_', ' '), value }))} />
                  <Input label="Document name" value={documentDraft.documentName} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, documentName: el.value })); }} />
                  {documentDraft.documentUrl.startsWith('data:') ? (
                    <Input label="Document attachment" value={documentDraft.documentName || 'Attached file'} disabled />
                  ) : (
                    <Input label="Document URL" value={documentDraft.documentUrl} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, documentUrl: el.value })); }} />
                  )}
                </div>
                <div className="invite-row">
                  <span>
                    <strong>Attach document</strong>
                    <span className="subtle">Upload a PDF, PNG, JPEG, WebP, or GIF under 4MB, or paste a document URL above.</span>
                    {documentDraft.documentName ? <span className="subtle">{documentDraft.documentName}</span> : null}
                  </span>
                  <span className="invite-row-actions">
                    <label className="btn btn-secondary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>
                      Upload file
                      <input
                        type="file"
                        accept={STAFF_DOCUMENT_ACCEPT}
                        disabled={saving}
                        style={{ display: 'none' }}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = '';
                          if (file) void attachDocumentDraftFile(file);
                        }}
                      />
                    </label>
                    {documentDraft.documentUrl.startsWith('data:') ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving}
                        onClick={() => setDocumentDraft((current) => ({ ...current, documentName: '', documentUrl: '' }))}
                      >
                        Remove attachment
                      </Button>
                    ) : null}
                  </span>
                </div>
                <Textarea label="Document notes" rows={2} value={documentDraft.notes} onChange={(event) => { const el = event.currentTarget; setDocumentDraft((current) => ({ ...current, notes: el.value })); }} />
                <div className="toolbar-right">
                  <Button type="submit" disabled={saving}>{saving ? 'Adding…' : 'Add document'}</Button>
                  <ActionFeedback
                    message={messageTarget === 'document' ? message : null}
                    tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
                  />
                </div>
              </form>
            </Card>

            <Card title="Academy and tasks" subtitle="Assign modules and update completion from the same profile screen.">
              <div className="form-grid two">
                <Select label="Assign module" value={selectedModuleId} onChange={(event) => setSelectedModuleId(event.currentTarget.value)} options={[{ label: 'Select module', value: '' }, ...activeModules.map((module) => ({ label: `L${module.level} · ${module.title}`, value: module.id }))]} />
                <div className="toolbar-right">
                  <Button type="button" disabled={saving || !selectedModuleId} onClick={() => void assignAcademyModule()}>Assign module</Button>
                  <ActionFeedback
                    message={messageTarget === 'academy-assign' ? message : null}
                    tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
                  />
                </div>
              </div>
              <div className="staff-list">
                {selectedTrainingRecords.length === 0 ? <EmptyState title="No Academy modules assigned" description="Assigned training appears here." /> : null}
                {selectedTrainingRecords.map((record) => (
                  <div key={record.id} className="staff-expiry-row">
                    <span>
                      <strong>{record.module?.title ?? 'Academy module'}</strong>
                      <span className="subtle">Level {record.module?.level ?? '-'} · {record.module?.category ?? 'General'} · {record.notes || 'No notes'}</span>
                    </span>
                    <span className="invite-row-actions">
                      <Badge tone={record.status === 'COMPLETED' ? 'positive' : record.status === 'IN_PROGRESS' ? 'warning' : 'muted'}>{record.status.replace('_', ' ')}</Badge>
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void updateAcademyRecord(record, 'IN_PROGRESS')}>Start</Button>
                      <ActionFeedback
                        message={messageTarget === `academy:${record.id}:IN_PROGRESS` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void updateAcademyRecord(record, 'COMPLETED')}>Complete</Button>
                      <ActionFeedback
                        message={messageTarget === `academy:${record.id}:COMPLETED` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteAcademyRecord(record)}>Remove</Button>
                      <ActionFeedback
                        message={messageTarget === `academy:${record.id}:remove` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}
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
  venues: AppSettingsPayload['venues'];
  notifyEmail: string;
  notifyOverdueIssues: boolean;
  notifyExpiringStaff: boolean;
  notifyOutOfRangeTemp: boolean;
  goveeApiKey: string;
  goveeBaseUrl: string;
  onboardingSettings: OnboardingSettings;
  staffDefaults: StaffDefaults;
};

function draftFromSettings(settings: AppSettingsPayload): AdminSettingsDraft {
  return {
    orgName: settings.orgName,
    primaryContactName: settings.primaryContactName ?? '',
    primaryContactEmail: settings.primaryContactEmail ?? '',
    primaryContactPhone: settings.primaryContactPhone ?? '',
    venues: settings.venues,
    notifyEmail: settings.notifyEmail ?? '',
    notifyOverdueIssues: settings.notifyOverdueIssues,
    notifyExpiringStaff: settings.notifyExpiringStaff,
    notifyOutOfRangeTemp: settings.notifyOutOfRangeTemp,
    goveeApiKey: settings.goveeApiKey ?? '',
    goveeBaseUrl: settings.goveeBaseUrl ?? 'https://openapi.api.govee.com',
    onboardingSettings: normaliseOnboardingSettings(settings.onboardingSettings),
    staffDefaults: normaliseStaffDefaults(settings.staffDefaults)
  };
}

function blankAdminVenue(): AppSettingsPayload['venues'][number] {
  return { name: '', address: '', phone: '' };
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
  roster,
  selectedId,
  setSelectedId,
  reload
}: {
  staff: StaffProfile[];
  roster: RosterShift[];
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
    venues: [],
    notifyEmail: '',
    notifyOverdueIssues: true,
    notifyExpiringStaff: true,
    notifyOutOfRangeTemp: true,
    goveeApiKey: '',
    goveeBaseUrl: 'https://openapi.api.govee.com',
    onboardingSettings: DEFAULT_ONBOARDING_SETTINGS,
    staffDefaults: DEFAULT_STAFF_DEFAULTS
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [rosterSettingsWeekStart, setRosterSettingsWeekStart] = useState(() => startOfWeek(new Date()));
  const [rosterSettingsBoardDays, setRosterSettingsBoardDays] = useState<7 | 14>(7);
  const [rosterSettingsVenue, setRosterSettingsVenue] = useState('Alma Avalon');
  const [settingsSection, setSettingsSection] = useState<'admin' | 'staff' | 'onboarding' | 'roster' | 'access' | 'audit'>('admin');
  const [closedDaysByScope, setClosedDaysByScope] = useState(loadRosterClosedDays);
  const [rosterAreaSettings, setRosterAreaSettings] = useState(loadRosterAreaSettings);
  const [newRosterAreaName, setNewRosterAreaName] = useState('');
  const [marketingSocialAccounts, setMarketingSocialAccounts] = useState<MarketingSocialAccount[]>([]);
  const [marketingSocialLoading, setMarketingSocialLoading] = useState(false);
  const enabledAccessCount = staff.flatMap((member) => member.appAccess).filter((access) => access.status === 'ENABLED').length;
  const adminCount = staff.filter((member) => member.isAdmin).length;
  const venueCount = new Set(staff.map((member) => member.venue).filter(Boolean)).size;
  const venueNames = draft.venues.length
    ? draft.venues.map((venue) => venue.name)
    : VENUE_OPTIONS.filter((item) => item.value && item.value !== 'Both').map((item) => item.value);
  const rosterSettingsDays = useMemo(
    () => weekDays(rosterSettingsWeekStart, rosterSettingsBoardDays),
    [rosterSettingsBoardDays, rosterSettingsWeekStart]
  );
  const rosterVenueValues = uniqueValues(venueNames.filter((venue) => venue && venue !== 'Both'));
  const effectiveRosterSettingsVenue = rosterVenueValues.includes(rosterSettingsVenue)
    ? rosterSettingsVenue
    : rosterVenueValues[0] ?? '';
  const adminSocialVenue = effectiveRosterSettingsVenue || rosterVenueValues[0] || 'Alma Avalon';
  const rosterSettingsScopeKey = rosterClosedDaysScopeKey(
    rosterSettingsWeekStart,
    rosterSettingsBoardDays,
    effectiveRosterSettingsVenue
  );
  const rosterSettingsClosedDayKeys = useMemo(
    () => new Set(closedDaysByScope[rosterSettingsScopeKey] ?? []),
    [closedDaysByScope, rosterSettingsScopeKey]
  );
  // Areas come from the roster itself. They used to be read off a copy of the
  // shifts embedded in every staff profile; with that copy gone this reads the
  // real roster, which is the same data one step closer to source.
  const rosterAreaSource = useMemo(
    () => roster.map((shift) => shift.area || 'Shift'),
    [roster]
  );
  const adminRosterAreas = useMemo(
    () => mergeRosterAreas(rosterAreaSettings, rosterAreaSource),
    [rosterAreaSettings, rosterAreaSource]
  );
  const adminHiddenAreaNames = useMemo(
    () => new Set(rosterAreaSettings.hidden.map(normaliseRosterAreaKey)),
    [rosterAreaSettings.hidden]
  );
  const adminHiddenAreaCount = adminRosterAreas.filter((areaName) => adminHiddenAreaNames.has(normaliseRosterAreaKey(areaName))).length;
  const rosterVenueOptions = rosterVenueValues.map((venue) => ({ label: venue, value: venue }));
  const staffDefaultsAward = AWARD_RATE_SETS.find((award) => award.awardCode === draft.staffDefaults.defaultAwardCode) ?? AWARD_RATE_SETS[0];
  const staffDefaultClassificationOptions = staffDefaultsAward.classifications.map((classification) => ({
    label: classification.label,
    value: classification.id
  }));
  const [managementEvents, setManagementEvents] = useState<StaffManagementEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventFilter, setEventFilter] = useState('');

  const appRows = STAFF_APPS.map((app) => {
    const access = staff.flatMap((member) => member.appAccess.filter((item) => item.appId === app.id));
    return {
      app,
      enabled: access.filter((item) => item.status === 'ENABLED').length,
      pending: access.filter((item) => item.status === 'PENDING').length,
      disabled: access.filter((item) => item.status === 'DISABLED').length
    };
  });
  const managementEventOptions = [
    { label: 'All event types', value: '' },
    ...Array.from(new Set(managementEvents.map((event) => event.eventType))).sort().map((eventType) => ({
      label: eventType.replace(/_/g, ' '),
      value: eventType
    }))
  ];

  const loadMarketingSocialAccounts = useCallback(async (targetVenue: string) => {
    setMarketingSocialLoading(true);
    try {
      const query = targetVenue ? `?venue=${encodeURIComponent(targetVenue)}` : '';
      const dashboard = await api<MarketingContentDashboardSummary>(`/api/marketing/content/dashboard${query}`);
      setMarketingSocialAccounts(dashboard.socialAccounts ?? []);
    } catch {
      setMarketingSocialAccounts([]);
    } finally {
      setMarketingSocialLoading(false);
    }
  }, []);

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

  useEffect(() => {
    if (!canAccessSettings(user)) return;
    void loadMarketingSocialAccounts(adminSocialVenue);
  }, [adminSocialVenue, loadMarketingSocialAccounts, user]);

  useEffect(() => {
    if (effectiveRosterSettingsVenue && effectiveRosterSettingsVenue !== rosterSettingsVenue) {
      setRosterSettingsVenue(effectiveRosterSettingsVenue);
    }
  }, [effectiveRosterSettingsVenue, rosterSettingsVenue]);

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

  function updateStaffDefaults(patch: Partial<StaffDefaults>) {
    setDraft((current) => {
      const nextAwardCode = patch.defaultAwardCode ?? current.staffDefaults.defaultAwardCode;
      const award = AWARD_RATE_SETS.find((item) => item.awardCode === nextAwardCode) ?? AWARD_RATE_SETS[0];
      const nextClassification = patch.defaultAwardClassification ?? current.staffDefaults.defaultAwardClassification;
      return {
        ...current,
        staffDefaults: normaliseStaffDefaults({
          ...current.staffDefaults,
          ...patch,
          defaultAwardCode: nextAwardCode,
          defaultAwardClassification: award.classifications.some((item) => item.id === nextClassification)
            ? nextClassification
            : award.classifications[0]?.id
        })
      };
    });
  }

  const loadManagementEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams({ take: '30' });
      if (eventFilter) params.set('eventType', eventFilter);
      setManagementEvents(await api<StaffManagementEvent[]>(`/api/staff/management-events?${params.toString()}`));
    } catch (err) {
      setMessageTarget('management-events');
      setMessage(err instanceof Error ? err.message : 'Could not load management events.');
    } finally {
      setEventsLoading(false);
    }
  }, [eventFilter]);

  useEffect(() => {
    void loadManagementEvents();
  }, [loadManagementEvents]);

  function updateVenue(index: number, patch: Partial<AppSettingsPayload['venues'][number]>) {
    setDraft((current) => ({
      ...current,
      venues: current.venues.map((venue, venueIndex) => (
        venueIndex === index ? { ...venue, ...patch } : venue
      ))
    }));
  }

  function addVenue() {
    setDraft((current) => ({ ...current, venues: [...current.venues, blankAdminVenue()] }));
  }

  function removeVenue(index: number) {
    setDraft((current) => ({
      ...current,
      venues: current.venues.filter((_, venueIndex) => venueIndex !== index)
    }));
  }

  function persistRosterClosedDays(next: Record<string, string[]>, text: string) {
    setClosedDaysByScope(next);
    window.localStorage.setItem(ROSTER_CLOSED_DAYS_STORAGE_KEY, JSON.stringify(next));
    setMessageTarget('roster-closed-days');
    setMessage(text);
  }

  function persistRosterAreaSettings(next: RosterAreaSettings, target: string, text: string) {
    setRosterAreaSettings(next);
    window.localStorage.setItem(ROSTER_AREA_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    setMessageTarget(target);
    setMessage(text);
  }

  function toggleAdminClosedDay(day: Date) {
    if (!user?.isAdmin) {
      setMessageTarget('roster-closed-days');
      setMessage('Only admin users can update roster closed days.');
      return;
    }
    if (!effectiveRosterSettingsVenue) {
      setMessageTarget('roster-closed-days');
      setMessage('Add a venue before setting closed days.');
      return;
    }

    const key = toDateInput(day);
    const existing = new Set(closedDaysByScope[rosterSettingsScopeKey] ?? []);
    if (existing.has(key)) {
      existing.delete(key);
    } else {
      existing.add(key);
    }

    persistRosterClosedDays(
      {
        ...closedDaysByScope,
        [rosterSettingsScopeKey]: Array.from(existing).sort()
      },
      `${effectiveRosterSettingsVenue} ${day.toLocaleDateString(undefined, { weekday: 'long' })} ${existing.has(key) ? 'closed' : 're-opened'}.`
    );
  }

  function addAdminRosterArea() {
    setMessageTarget('roster-area-add');
    if (!canManageRosterAreas(user)) {
      setMessage('You need manager or admin access to add roster areas.');
      return;
    }

    const name = normaliseRosterAreaName(newRosterAreaName);
    if (!name) {
      setMessage('Enter an area name first.');
      return;
    }
    if (adminRosterAreas.some((item) => normaliseRosterAreaKey(item) === normaliseRosterAreaKey(name))) {
      setMessage(`${name} already exists in roster areas.`);
      return;
    }

    persistRosterAreaSettings(
      {
        order: uniqueRosterAreaNames([...rosterAreaSettings.order, name]),
        hidden: rosterAreaSettings.hidden.filter((item) => normaliseRosterAreaKey(item) !== normaliseRosterAreaKey(name)),
        deleted: rosterAreaSettings.deleted.filter((item) => normaliseRosterAreaKey(item) !== normaliseRosterAreaKey(name))
      },
      'roster-area-add',
      `${name} added to roster areas.`
    );
    setNewRosterAreaName('');
  }

  function toggleAdminRosterAreaHidden(areaName: string) {
    const target = `roster-area:${areaName}`;
    if (!canManageRosterAreas(user)) {
      setMessageTarget(target);
      setMessage('You need manager or admin access to update roster areas.');
      return;
    }

    const key = normaliseRosterAreaKey(areaName);
    const isHidden = rosterAreaSettings.hidden.some((item) => normaliseRosterAreaKey(item) === key);
    persistRosterAreaSettings(
      {
        ...rosterAreaSettings,
        hidden: isHidden
          ? rosterAreaSettings.hidden.filter((item) => normaliseRosterAreaKey(item) !== key)
          : uniqueRosterAreaNames([...rosterAreaSettings.hidden, areaName])
      },
      target,
      `${areaName} ${isHidden ? 'shown on' : 'hidden from'} roster boards.`
    );
  }

  function moveAdminRosterArea(areaName: string, direction: -1 | 1) {
    const target = `roster-area:${areaName}`;
    if (!canManageRosterAreas(user)) {
      setMessageTarget(target);
      setMessage('You need manager or admin access to reorder roster areas.');
      return;
    }

    const ordered = mergeRosterAreas(rosterAreaSettings, rosterAreaSource);
    const index = ordered.findIndex((item) => normaliseRosterAreaKey(item) === normaliseRosterAreaKey(areaName));
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    const nextOrder = [...ordered];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    persistRosterAreaSettings(
      { ...rosterAreaSettings, order: nextOrder },
      target,
      `${areaName} moved ${direction < 0 ? 'up' : 'down'}.`
    );
  }

  function deleteAdminRosterArea(areaName: string) {
    const target = `roster-area:${areaName}`;
    if (!canManageRosterAreas(user)) {
      setMessageTarget(target);
      setMessage('You need manager or admin access to delete roster areas.');
      return;
    }

    const key = normaliseRosterAreaKey(areaName);
    const hasShifts = rosterAreaSource.some((item) => normaliseRosterAreaKey(item) === key);
    if (hasShifts) {
      setMessageTarget(target);
      setMessage(`${areaName} has rostered shifts. Hide it first or move those shifts before deleting.`);
      return;
    }

    persistRosterAreaSettings(
      {
        order: rosterAreaSettings.order.filter((item) => normaliseRosterAreaKey(item) !== key),
        hidden: rosterAreaSettings.hidden.filter((item) => normaliseRosterAreaKey(item) !== key),
        deleted: uniqueRosterAreaNames([...rosterAreaSettings.deleted, areaName])
      },
      target,
      `${areaName} removed from roster areas.`
    );
  }

  async function renameAdminRosterArea(areaName: string) {
    const target = `roster-area:${areaName}`;
    setMessageTarget(target);
    if (!canManageRosterAreas(user)) {
      setMessage('You need manager or admin access to rename roster areas.');
      return;
    }

    const input = window.prompt(`Rename the "${areaName}" area to:`, areaName);
    if (input === null) return; // cancelled
    const newName = normaliseRosterAreaName(input);
    if (!newName) {
      setMessage('Enter a new area name.');
      return;
    }

    const oldKey = normaliseRosterAreaKey(areaName);
    const newKey = normaliseRosterAreaKey(newName);
    if (oldKey !== newKey && adminRosterAreas.some((item) => normaliseRosterAreaKey(item) === newKey)) {
      setMessage(`${newName} already exists in roster areas.`);
      return;
    }
    if (areaName === newName) return; // no-op

    // Replace old → new in the per-browser area settings so areas with no
    // shifts (custom names) rename too, and ordering/hidden state carries.
    const replaceInList = (list: string[]) =>
      uniqueRosterAreaNames(list.map((item) => (normaliseRosterAreaKey(item) === oldKey ? newName : item)));

    persistRosterAreaSettings(
      {
        order: replaceInList(rosterAreaSettings.order),
        hidden: replaceInList(rosterAreaSettings.hidden),
        deleted: replaceInList(rosterAreaSettings.deleted)
      },
      target,
      `${areaName} renamed to ${newName}.`
    );

    // Rewrite the area on existing shifts server-side so the rename sticks
    // across devices and survives a refresh (the settings above are
    // localStorage-only).
    try {
      const { renamed } = await api<{ renamed: number }>('/api/staff/roster/rename-area', {
        method: 'POST',
        body: JSON.stringify({ from: areaName, to: newName })
      });
      await reload();
      setMessage(
        `${areaName} renamed to ${newName}${renamed ? ` · ${renamed} shift${renamed === 1 ? '' : 's'} updated` : ''}.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Renamed in this browser, but could not update existing shifts.');
    }
  }

  async function saveSettings(target: string) {
    setMessageTarget(target);
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
          notifyOverdueIssues: draft.notifyOverdueIssues,
          notifyExpiringStaff: draft.notifyExpiringStaff,
          notifyOutOfRangeTemp: draft.notifyOutOfRangeTemp,
          goveeApiKey: draft.goveeApiKey.trim(),
          goveeBaseUrl: draft.goveeBaseUrl.trim(),
          venues: draft.venues
            .map((venue) => ({
              name: venue.name.trim(),
              address: venue.address?.trim() ?? '',
              phone: venue.phone?.trim() ?? ''
            }))
            .filter((venue) => venue.name),
          onboardingSettings: draft.onboardingSettings,
          staffDefaults: draft.staffDefaults
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

  async function createMarketingSocialSetup(platform: SocialPlatform) {
    setMessageTarget(`marketing-social:${platform}`);
    if (!user?.isAdmin) {
      setMessage('Only admin users can create social setup cards.');
      return;
    }

    setMarketingSocialLoading(true);
    setMessage(null);
    try {
      await api('/api/marketing/content/social-accounts', {
        method: 'POST',
        body: JSON.stringify({
          venue: adminSocialVenue,
          platform,
          displayName: `${adminSocialVenue} ${platform.toLowerCase()} setup`,
          status: 'SETUP_REQUIRED',
          scopes: []
        })
      });
      await loadMarketingSocialAccounts(adminSocialVenue);
      setMessage(`${platform} setup card created in Admin.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not create social setup card.');
    } finally {
      setMarketingSocialLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="ALMA Staff"
        title="Staff settings"
        description="Working editor for staff defaults, onboarding, roster areas and staff audit history. Cross-suite setup starts in Alma Admin."
        actions={
          COMPLIANCE_WEB_URL ? (
            <Button
              variant="secondary"
              type="button"
              onClick={() => {
                window.location.href = `${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/admin`;
              }}
            >
              Open Alma Admin
            </Button>
          ) : undefined
        }
      />

      <div className="stats-grid">
        <StatCard label="Admin users" value={adminCount} hint="Full suite admins" loading={loading} />
        <StatCard label="App access rows" value={enabledAccessCount} hint="Enabled access" loading={loading} />
        <StatCard label="Venues" value={settings?.venues.length ?? venueCount} hint="Configured or detected" loading={loading} />
        <StatCard label="Staff profiles" value={staff.length} hint="Shared authority" loading={loading} />
      </div>

      <div className="staff-settings-section-tabs" aria-label="Staff settings sections">
        {[
          ['admin', 'Admin handoff'],
          ['staff', 'Staff defaults'],
          ['onboarding', 'Onboarding'],
          ['roster', 'Roster setup'],
          ['access', 'Access status'],
          ['audit', 'Audit log']
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={settingsSection === key ? 'is-active' : ''}
            onClick={() => setSettingsSection(key as typeof settingsSection)}
          >
            {label}
          </button>
        ))}
      </div>

      {settingsSection === 'admin' ? (
        <div className="staff-settings-grid staff-settings-grid-primary">
          <Card className="staff-settings-card staff-settings-card-large" title="Moved to Admin" subtitle="Use Admin for business-wide setup and integration controls.">
            <div className="admin-boundary-list">
              <div>
                <strong>Organisation, venues and notifications</strong>
                <span>Configure shared business details and venue setup from Admin.</span>
              </div>
              <div>
                <strong>Integrations and imports</strong>
                <span>Configure Xero, Square, Meta, Govee, imports and sync health from Admin.</span>
              </div>
              <div>
                <strong>Roles and permissions</strong>
                <span>Use Admin for global access setup. Staff keeps daily profile and approval work.</span>
              </div>
            </div>
            {COMPLIANCE_WEB_URL ? (
              <div className="toolbar-right">
                <Button type="button" variant="secondary" onClick={() => { window.location.href = `${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/settings`; }}>
                  Open current settings editor
                </Button>
                <Button type="button" onClick={() => { window.location.href = `${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/admin/staff-settings`; }}>
                  Open Admin settings
                </Button>
              </div>
            ) : null}
          </Card>

          <Card className="staff-settings-card" title="Still in Staff" subtitle="Operational tools managers use during the week.">
            <div className="admin-boundary-list">
              <div>
                <strong>Profile records and documents</strong>
                <span>Add records, view uploaded documents, and approve submitted evidence.</span>
              </div>
              <div>
                <strong>Onboarding approvals</strong>
                <span>Review documents and approve completed staff onboarding submissions.</span>
              </div>
              <div>
                <strong>Roster, timesheets and communications</strong>
                <span>Keep daily manager work in Staff.</span>
              </div>
            </div>
          </Card>
        </div>
      ) : null}

      {settingsSection === 'staff' ? (
        <>
      <Card className="staff-settings-card staff-settings-card-wide" title="Staff defaults" subtitle="Defaults used for new staff profiles and onboarding invites. Individual staff pay and access can still be edited on their profile.">
        <form
          className="staff-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings('staff-defaults');
          }}
        >
          <div className="form-grid two">
            <Input
              label="Default role title"
              value={draft.staffDefaults.defaultRoleTitle}
              onChange={(event) => updateStaffDefaults({ defaultRoleTitle: event.currentTarget.value })}
            />
            <Select
              label="Default venue"
              value={draft.staffDefaults.defaultVenue}
              onChange={(event) => updateStaffDefaults({ defaultVenue: event.currentTarget.value })}
              options={[{ label: 'No default venue', value: '' }, ...rosterVenueOptions]}
            />
            <Select
              label="Default Staff app role"
              value={draft.staffDefaults.defaultStaffAppRole}
              onChange={(event) => updateStaffDefaults({ defaultStaffAppRole: event.currentTarget.value as StaffDefaults['defaultStaffAppRole'] })}
              options={[
                { label: 'User', value: 'USER' },
                { label: 'Manager', value: 'MANAGER' }
              ]}
            />
            <Select
              label="Default employment type"
              value={draft.staffDefaults.defaultEmploymentType}
              onChange={(event) => updateStaffDefaults({ defaultEmploymentType: event.currentTarget.value as StaffDefaults['defaultEmploymentType'] })}
              options={[
                { label: 'Casual', value: 'CASUAL' },
                { label: 'Part-time', value: 'PART_TIME' }
              ]}
            />
            <Select
              label="Default award"
              value={draft.staffDefaults.defaultAwardCode}
              onChange={(event) => updateStaffDefaults({ defaultAwardCode: event.currentTarget.value as StaffDefaults['defaultAwardCode'] })}
              options={AWARD_RATE_SETS.map((award) => ({
                label: `${award.awardName} [${award.awardCode}]`,
                value: award.awardCode
              }))}
            />
            <Select
              label="Default classification"
              value={draft.staffDefaults.defaultAwardClassification}
              onChange={(event) => updateStaffDefaults({ defaultAwardClassification: event.currentTarget.value })}
              options={staffDefaultClassificationOptions}
            />
          </div>
          <p className="subtle">
            Award source: {staffDefaultsAward.sourceLabel}. Effective from first full pay period on or after {staffDefaultsAward.rateEffectiveFrom}; version {staffDefaultsAward.rateSetVersion}.
            Full-time manual pay is recorded on the individual staff profile once the agreed amount is known.
            Penalty rates, overtime, allowances, public holidays, juniors, apprentices and supported wage rules are not calculated here.
          </p>
          <div className="toolbar-right">
            <Button type="submit" disabled={saving || !user?.isAdmin}>{saving ? 'Saving…' : 'Save staff defaults'}</Button>
            <ActionFeedback
              message={messageTarget === 'staff-defaults' ? message : null}
              tone={message?.includes('saved') ? 'success' : 'error'}
            />
          </div>
        </form>
      </Card>

      <Card
        className="staff-settings-card staff-settings-card-wide"
        title="Venues"
        subtitle="Shared venue list used by Staff, Compliance, Stock, Reports, and Reserve"
        action={<Button type="button" size="sm" variant="secondary" onClick={addVenue}>Add venue</Button>}
      >
        <form
          className="staff-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings('venues');
          }}
        >
          {draft.venues.length === 0 ? <p className="subtle">No venues configured yet.</p> : null}
          {draft.venues.map((venue, index) => {
            const members = staff.filter((member) => member.venue === venue.name).length;
            return (
              <div key={index} className="venue-row">
                <Input
                  label={index === 0 ? 'Name' : ''}
                  value={venue.name}
                  placeholder="Alma Avalon"
                  onChange={(event) => updateVenue(index, { name: event.currentTarget.value })}
                />
                <Input
                  label={index === 0 ? 'Address' : ''}
                  value={venue.address ?? ''}
                  onChange={(event) => updateVenue(index, { address: event.currentTarget.value })}
                />
                <Input
                  label={index === 0 ? 'Phone' : ''}
                  value={venue.phone ?? ''}
                  onChange={(event) => updateVenue(index, { phone: event.currentTarget.value })}
                />
                <span className="subtle">{members} staff</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => removeVenue(index)}>Remove</Button>
              </div>
            );
          })}
          <div className="toolbar-right">
            <Button type="submit" disabled={saving || !user?.isAdmin}>{saving ? 'Saving…' : 'Save venues'}</Button>
            <ActionFeedback
              message={messageTarget === 'venues' ? message : null}
              tone={message?.includes('saved') ? 'success' : 'error'}
            />
          </div>
        </form>
      </Card>
        </>
      ) : null}

      {settingsSection === 'roster' ? (
      <Card className="staff-settings-card staff-settings-card-wide" title="Roster settings" subtitle="Closed days are saved separately for each venue. Area rows still control the roster board order.">
        <div className="roster-area-manager">
          <div className="roster-week-controls" aria-label="Roster settings week controls">
            <Button type="button" variant="secondary" size="sm" onClick={() => setRosterSettingsWeekStart(addDays(rosterSettingsWeekStart, -7))}>
              Prev
            </Button>
            <div className="roster-week-label">
              <strong>{formatRange(rosterSettingsWeekStart, addDays(rosterSettingsWeekStart, rosterSettingsBoardDays - 1))}</strong>
              <span>{effectiveRosterSettingsVenue || 'No venue selected'}</span>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setRosterSettingsWeekStart(addDays(rosterSettingsWeekStart, 7))}>
              Next
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRosterSettingsWeekStart(startOfWeek(new Date()))}
            >
              Today
            </Button>
          </div>

          <div className="form-grid two">
            <Select
              label="Venue closed days"
              value={effectiveRosterSettingsVenue}
              onChange={(event) => setRosterSettingsVenue(event.currentTarget.value)}
              options={rosterVenueOptions}
            />
            <Select
              label="Roster range"
              value={String(rosterSettingsBoardDays)}
              onChange={(event) => setRosterSettingsBoardDays(Number(event.currentTarget.value) === 14 ? 14 : 7)}
              options={[
                { label: 'Week', value: '7' },
                { label: '2 weeks', value: '14' }
              ]}
            />
          </div>

          <div className="roster-closed-days" aria-label="Admin roster closed days">
            <strong>Closed days</strong>
            {rosterSettingsDays.map((day) => {
              const key = toDateInput(day);
              const isClosed = rosterSettingsClosedDayKeys.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  className={isClosed ? 'is-closed' : ''}
                  disabled={!user?.isAdmin || !effectiveRosterSettingsVenue}
                  onClick={() => toggleAdminClosedDay(day)}
                  aria-pressed={isClosed}
                >
                  <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <small>{isClosed ? 'Closed' : 'Open'}</small>
                </button>
              );
            })}
            <ActionFeedback
              message={messageTarget === 'roster-closed-days' ? message : null}
              tone={message?.includes('Only') || message?.includes('Add a venue') ? 'error' : 'success'}
            />
          </div>

          <div className="roster-area-create">
            <Input
              label="New roster area"
              value={newRosterAreaName}
              onChange={(event) => setNewRosterAreaName(event.currentTarget.value)}
              placeholder="Example: Host, Pass, Prep"
            />
            <Button type="button" variant="secondary" disabled={!canManageRosterAreas(user)} onClick={addAdminRosterArea}>
              Add area
            </Button>
            <ActionFeedback
              message={messageTarget === 'roster-area-add' ? message : null}
              tone={message?.includes('Enter') || message?.includes('exists') || message?.includes('Only') ? 'error' : 'success'}
            />
          </div>

          <div className="roster-area-manager-list">
            {adminRosterAreas.map((areaName, index) => {
              const isHidden = adminHiddenAreaNames.has(normaliseRosterAreaKey(areaName));
              const shiftCount = rosterAreaSource.filter((item) => normaliseRosterAreaKey(item) === normaliseRosterAreaKey(areaName)).length;
              return (
                <div key={areaName} className={`roster-area-manager-row ${isHidden ? 'is-hidden' : ''}`}>
                  <span className="roster-area-chip" style={areaStyle(areaName)}>
                    <i aria-hidden="true" />
                    <strong>{areaName}</strong>
                    <small>{shiftCount} shifts</small>
                  </span>
                  <span className="roster-area-manager-actions">
                    <Button type="button" size="sm" variant="ghost" disabled={!canManageRosterAreas(user) || index === 0} onClick={() => moveAdminRosterArea(areaName, -1)}>
                      Up
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={!canManageRosterAreas(user) || index === adminRosterAreas.length - 1} onClick={() => moveAdminRosterArea(areaName, 1)}>
                      Down
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={!canManageRosterAreas(user)} onClick={() => void renameAdminRosterArea(areaName)}>
                      Rename
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={!canManageRosterAreas(user)} onClick={() => toggleAdminRosterAreaHidden(areaName)}>
                      {isHidden ? 'Show' : 'Hide'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={!canManageRosterAreas(user)} onClick={() => deleteAdminRosterArea(areaName)}>
                      Delete
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `roster-area:${areaName}` ? message : null}
                      tone={message?.includes('Only') || message?.includes('has rostered') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="subtle">
            {adminHiddenAreaCount ? `${adminHiddenAreaCount} hidden area${adminHiddenAreaCount === 1 ? '' : 's'} are excluded from area view and forecast guidance.` : 'All areas are visible.'}
          </p>
        </div>
      </Card>
      ) : null}

      {settingsSection === 'onboarding' ? (
      <Card className="staff-settings-card staff-settings-card-wide" title="Onboarding process" subtitle="Configure what new staff complete before managers approve them.">
        <form
          className="staff-profile-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveSettings('onboarding');
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
            <ActionFeedback
              message={messageTarget === 'onboarding' ? message : null}
              tone={message?.includes('saved') ? 'success' : 'error'}
            />
          </div>
        </form>
      </Card>
      ) : null}

      {settingsSection === 'access' ? (
      <>
      <div className="staff-settings-grid staff-settings-support-grid">
        <Card className="staff-settings-card" title="Password and email status" subtitle="Staff password recovery is email-only. Managers can request a reset but cannot set or view passwords.">
          <div className="staff-expiry-list">
            <div className="staff-expiry-row">
              <span>
                <strong>Staff reset URL</strong>
                <span className="subtle">{window.location.origin}/reset-password</span>
              </span>
              <Badge tone="positive">Configured route</Badge>
            </div>
            <div className="staff-expiry-row">
              <span>
                <strong>Email service</strong>
                <span className="subtle">API mail service sends reset and onboarding emails. Secrets and reset tokens are never exposed here.</span>
              </span>
              <Badge tone="info">Server managed</Badge>
            </div>
          </div>
        </Card>

        <Card className="staff-settings-card" title="Roles and access" subtitle="Available role presets and permission groups. Elevated Settings/admin access remains admin-only.">
          <div className="staff-expiry-list">
            {STAFF_PROFILE_PRESETS.map((preset) => (
              <div key={preset.id} className="staff-expiry-row">
                <span>
                  <strong>{preset.label}</strong>
                  <span className="subtle">{preset.roleTitle} · {preset.employmentType}</span>
                </span>
                <Badge tone={preset.id === 'admin' ? 'warning' : 'muted'}>{preset.id === 'admin' ? 'Admin-only' : 'Preset'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="staff-settings-card staff-settings-card-wide" title="App access matrix" subtitle="Review app access status here, then open profile access for changes." padding="none">
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
                  navigate('/profiles');
                }}
              >
                Manage
              </Button>
            </div>
          ))}
        </div>
      </Card>
      </>
      ) : null}

      {settingsSection === 'audit' ? (
      <Card className="staff-settings-card staff-settings-card-wide" title="Staff management audit" subtitle="Recent role, access, pay setup, password reset, leave and duplicate-merge events.">
        <div className="toolbar-right">
          <Select
            label="Event type"
            value={eventFilter}
            onChange={(event) => setEventFilter(event.currentTarget.value)}
            options={managementEventOptions}
          />
          <Button type="button" variant="secondary" disabled={eventsLoading} onClick={() => void loadManagementEvents()}>
            {eventsLoading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
        <div className="staff-expiry-list">
          {eventsLoading ? <Spinner label="Loading audit events…" /> : null}
          {!eventsLoading && managementEvents.length === 0 ? (
            <EmptyState title="No management events yet" description="Role, access, pay, password reset, leave and merge events will appear here." />
          ) : null}
          {managementEvents.map((event) => (
            <div key={event.id} className="staff-expiry-row">
              <span>
                <strong>{event.eventType.replace(/_/g, ' ')}</strong>
                <span className="subtle">
                  {event.staffProfile ? `${event.staffProfile.firstName} ${event.staffProfile.lastName}` : 'Staff profile'} · {formatDateTime(event.createdAt)}
                </span>
                <span>{event.summary}</span>
              </span>
              <Badge tone="muted">{event.createdByName || 'System'}</Badge>
            </div>
          ))}
          <ActionFeedback
            message={messageTarget === 'management-events' ? message : null}
            tone="error"
          />
        </div>
      </Card>
      ) : null}
    </div>
  );
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
          <EmptyState title="No paid tips yet" description="Paid tip runs will appear here after a manager marks them paid." />
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

type MyPaySnapshot = {
  firstName: string;
  lastName: string;
  venue: string | null;
  roleTitle: string;
  employmentStatus: string;
  employmentType: string | null;
  payProfile: {
    awardName: string;
    awardClassification: string;
    employmentType: string;
    payMode: string;
    ordinaryHourlyRateCents: number;
    casualLoadedHourlyRateCents: number | null;
    manualFullTimePayAmountCents: number | null;
    manualFullTimePayFrequency: string | null;
    cashHourlyRateCents: number | null;
    payUpdatedAt: string | null;
  } | null;
  hasBankAccount: boolean;
  hasTaxFileNumber: boolean;
};

function employmentTypeLabel(value: string | null | undefined) {
  switch (value) {
    case 'CASUAL':
      return 'Casual';
    case 'PART_TIME':
      return 'Part-time';
    case 'FULL_TIME':
      return 'Full-time';
    default:
      return value || '—';
  }
}

// A staff member's read-only view of their own pay rate and employment setup.
// Backed by GET /api/staff/me/pay, which returns only the caller's data and
// never bank/TFN numbers (only "on file" flags).
function StaffMemberPayPage() {
  const [data, setData] = useState<MyPaySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      setData(await api<MyPaySnapshot>('/api/staff/me/pay'));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load your pay details.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pp = data?.payProfile ?? null;
  const headline = pp
    ? pp.payMode === 'CASH' && pp.cashHourlyRateCents
      ? { label: 'Cash rate', value: `${formatCents(pp.cashHourlyRateCents)}/hr` }
      : pp.manualFullTimePayAmountCents
        ? {
            label: pp.manualFullTimePayFrequency === 'ANNUAL_SALARY' ? 'Annual salary' : 'Full-time rate',
            value: formatCents(pp.manualFullTimePayAmountCents)
          }
        : pp.casualLoadedHourlyRateCents
          ? { label: 'Loaded rate', value: `${formatCents(pp.casualLoadedHourlyRateCents)}/hr` }
          : { label: 'Ordinary rate', value: `${formatCents(pp.ordinaryHourlyRateCents)}/hr` }
    : null;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="My pay"
        title="My pay & details"
        description="Your current pay rate and employment setup. Ask a manager to update any of these."
        actions={
          <Button type="button" variant="secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="stats-grid">
        <StatCard
          label={headline?.label ?? 'Pay rate'}
          value={headline?.value ?? '—'}
          hint="Your current rate"
          loading={loading}
        />
        <StatCard
          label="Employment type"
          value={employmentTypeLabel(data?.employmentType)}
          hint={data?.roleTitle || 'Your role'}
          loading={loading}
        />
      </div>

      {message ? <p className="error-text">{message}</p> : null}
      {loading ? <Spinner label="Loading your pay details..." /> : null}

      {!loading && !pp ? (
        <EmptyState
          title="Pay details not set up yet"
          description="Your pay rate and employment type haven't been configured. Ask your manager to set up your pay profile."
        />
      ) : null}

      {pp ? (
        <Card title="Pay details" subtitle="Set by your manager in the Staff app.">
          <div className="staff-detail-list">
            <div className="staff-expiry-row">
              <span><strong>Award</strong><span className="subtle">{pp.awardName}</span></span>
            </div>
            <div className="staff-expiry-row">
              <span><strong>Classification</strong><span className="subtle">{pp.awardClassification}</span></span>
            </div>
            <div className="staff-expiry-row">
              <span><strong>Ordinary rate</strong><span className="subtle">{formatCents(pp.ordinaryHourlyRateCents)}/hr</span></span>
            </div>
            {pp.casualLoadedHourlyRateCents ? (
              <div className="staff-expiry-row">
                <span><strong>Casual loaded rate</strong><span className="subtle">{formatCents(pp.casualLoadedHourlyRateCents)}/hr (includes casual loading)</span></span>
              </div>
            ) : null}
            {pp.manualFullTimePayAmountCents ? (
              <div className="staff-expiry-row">
                <span><strong>{pp.manualFullTimePayFrequency === 'ANNUAL_SALARY' ? 'Annual salary' : 'Full-time rate'}</strong><span className="subtle">{formatCents(pp.manualFullTimePayAmountCents)}</span></span>
              </div>
            ) : null}
            {pp.payMode === 'CASH' && pp.cashHourlyRateCents ? (
              <div className="staff-expiry-row">
                <span><strong>Cash rate</strong><span className="subtle">{formatCents(pp.cashHourlyRateCents)}/hr</span></span>
              </div>
            ) : null}
            {pp.payUpdatedAt ? (
              <div className="staff-expiry-row">
                <span><strong>Last updated</strong><span className="subtle">{new Date(pp.payUpdatedAt).toLocaleDateString()}</span></span>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      {data ? (
        <Card title="Payment setup" subtitle="Whether your details are on file. Numbers are hidden for security — see a manager to update.">
          <div className="staff-detail-list">
            <div className="staff-expiry-row">
              <span><strong>Bank account</strong><span className="subtle">{data.hasBankAccount ? 'On file' : 'Not on file — give your manager your bank details'}</span></span>
              <Badge tone={data.hasBankAccount ? 'positive' : 'warning'}>{data.hasBankAccount ? '✓' : 'Missing'}</Badge>
            </div>
            <div className="staff-expiry-row">
              <span><strong>Tax file number</strong><span className="subtle">{data.hasTaxFileNumber ? 'On file' : 'Not provided — complete a TFN declaration with your manager'}</span></span>
              <Badge tone={data.hasTaxFileNumber ? 'positive' : 'warning'}>{data.hasTaxFileNumber ? '✓' : 'Missing'}</Badge>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function AlmaAdminRedirect() {
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function openAdmin() {
      const href = `${COMPLIANCE_WEB_URL.replace(/\/+$/, '')}/admin`;
      try {
        window.location.href = await createSuiteHandoffUrl(href);
      } catch {
        window.location.href = href;
      }
      window.setTimeout(() => {
        if (!cancelled) setFallback(true);
      }, 1000);
    }

    void openAdmin();
    return () => {
      cancelled = true;
    };
  }, []);

  if (fallback) return <Navigate to="/settings" replace />;

  return (
    <Card>
      <div className="staff-empty-panel">
        <Spinner label="Opening Alma Admin..." />
      </div>
    </Card>
  );
}

function DeviceHomePage() {
  const { refresh, user } = useAuth();
  const [payload, setPayload] = useState<DeviceStaffListResponse | null>(null);
  const [selected, setSelected] = useState<DeviceStaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await api<DeviceStaffListResponse>('/api/device/staff'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load staff for this device.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitPin() {
    if (!selected || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/device/pin-login', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: selected.id, pin })
      });
      setPin('');
      setSelected(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN login failed.');
    } finally {
      setBusy(false);
    }
  }

  async function changePin() {
    if (newPin.length < 4) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await api('/api/staff/me/pin', {
        method: 'POST',
        body: JSON.stringify({ currentPin: currentPin || undefined, newPin })
      });
      setCurrentPin('');
      setNewPin('');
      setFeedback('PIN updated.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update PIN.');
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    setBusy(true);
    try {
      await api('/api/device/pin-logout', { method: 'POST' });
      await refresh();
      await load();
    } finally {
      setBusy(false);
    }
  }

  const digits = ['1','2','3','4','5','6','7','8','9','0'];

  return (
    <div className="page-stack staff-device-page">
      <PageHeader
        eyebrow="Venue iPad"
        title={user?.deviceAccount ? `Using as ${user.firstName}` : `Staff PIN switcher${payload?.venue ? ` · ${payload.venue}` : ''}`}
        description="Tap your name and enter your PIN. Device-safe permissions are applied on top of your normal staff access."
      />

      {error ? <div className="error-banner">{error}</div> : null}
      {feedback ? <div className="success-banner">{feedback}</div> : null}

      {user?.deviceAccount ? (
        <Card title="Active staff context" subtitle={`Device: ${user.deviceAccount.name}`}>
          <div className="staff-device-active-panel">
            <Badge tone="positive">Using as {user.firstName} {user.lastName}</Badge>
            <div className="staff-device-actions">
              <Button type="button" onClick={lock} disabled={busy}>Lock</Button>
              <Button type="button" variant="secondary" onClick={lock} disabled={busy}>Switch user</Button>
            </div>
          </div>
          <details className="staff-pin-details">
            <summary>Change my PIN</summary>
            <div className="staff-pin-form">
              <Input
                label="Current PIN"
                inputMode="numeric"
                type="password"
                value={currentPin}
                onChange={(event) => setCurrentPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Required if you already have a PIN"
              />
              <Input
                label="New PIN"
                inputMode="numeric"
                type="password"
                value={newPin}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="4 to 6 digits"
              />
              <Button type="button" onClick={changePin} disabled={busy || newPin.length < 4}>Update PIN</Button>
            </div>
          </details>
        </Card>
      ) : null}

      {loading ? <Spinner label="Loading venue staff" /> : null}
      {!loading && !payload?.staff.length ? (
        <EmptyState title="No venue staff available" description="Only active human staff assigned to this device venue can use PIN switching." />
      ) : null}

      {!user?.deviceAccount ? (
        <div className="staff-device-layout">
          <div className="staff-device-grid">
            {(payload?.staff ?? []).map((staffMember) => (
              <button
                key={staffMember.id}
                type="button"
                className={`staff-device-card ${selected?.id === staffMember.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelected(staffMember);
                  setPin('');
                  setError(null);
                }}
              >
                <span className="staff-device-avatar">{staffMember.name.slice(0, 2).toUpperCase()}</span>
                <strong>{staffMember.name}</strong>
                <small>{staffMember.roleTitle}{staffMember.hasPin ? '' : ' · PIN not set'}</small>
              </button>
            ))}
          </div>

          <Card title={selected ? selected.name : 'Select staff'} subtitle="Enter your personal PIN on this shared device.">
            <div className="staff-pin-display" aria-label="PIN length">{'•'.repeat(pin.length) || 'PIN'}</div>
            <div className="staff-pin-keypad">
              {digits.map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => setPin((current) => `${current}${digit}`.slice(0, 6))}
                  disabled={!selected || busy}
                >
                  {digit}
                </button>
              ))}
              <button type="button" onClick={() => setPin((current) => current.slice(0, -1))} disabled={!pin || busy}>Back</button>
              <button type="button" onClick={() => setPin('')} disabled={!pin || busy}>Clear</button>
            </div>
            <Button type="button" onClick={submitPin} disabled={!selected || pin.length < 4 || busy}>
              {busy ? 'Checking...' : 'Use this account'}
            </Button>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function StaffShell() {
  const { user } = useAuth();
  const { staff, roster, roleTemplates, loading, error, reload } = useStaffData();
  const [selectedId, setSelectedId] = useState('');
  const [hrRecords, setHrRecords] = useState<StaffHrRecord[]>([]);
  const [hrLoading, setHrLoading] = useState(false);
  const [hrError, setHrError] = useState<string | null>(null);
  const isStaffUser = user?.role === 'STAFF';
  const canOpenSettings = canAccessSettings(user);
  const canOpenHr = canAccessStaffHr(user);
  const canManageHr = canManageStaffHr(user);
  const canManageRightToWorkHr = canManageHr && canAccessRightToWorkHr(user);
  const canManagePayChangeHr = canManageHr && canAccessPayChangeHr(user);
  const canApprovePayChangeHr = canApprovePayChange(user);
  const currentUserId = user?.id ?? '';
  const navItems = navItemsForUser(user);

  const loadHrRecords = useCallback(async () => {
    if (!canOpenHr) {
      setHrRecords([]);
      return;
    }
    setHrLoading(true);
    setHrError(null);
    try {
      setHrRecords(await api<StaffHrRecord[]>('/api/staff/hr/records'));
    } catch (err) {
      setHrError(err instanceof Error ? err.message : 'Could not load HR records.');
    } finally {
      setHrLoading(false);
    }
  }, [canOpenHr]);

  useEffect(() => {
    if (!selectedId && staff[0]) setSelectedId(staff[0].id);
  }, [selectedId, staff]);

  useEffect(() => {
    void loadHrRecords();
  }, [loadHrRecords]);

  return (
    <AppShell
      brand={<ProductLogo appId="staff" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav items={navItems} />}
      topBar={<TopBarWithContext />}
    >
      <OfflineQueueBanner />
      <BottomTabs items={navItems} />
      {user?.accountType === 'VENUE_DEVICE' ? (
        <Suspense fallback={<div className="full-page-loader"><Spinner label="Loading…" /></div>}>
        <Routes>
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="*" element={<Navigate to="/device" replace />} />
        </Routes>
        </Suspense>
      ) : (
      <>
      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}
      {hrError && canOpenHr ? (
        <Card>
          <p className="error-text">{hrError}</p>
        </Card>
      ) : null}
      {isStaffUser ? (
        <Suspense fallback={<div className="full-page-loader"><Spinner label="Loading…" /></div>}>
        <Routes>
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="/" element={<StaffMemberHome staff={staff} loading={loading} reload={reload} />} />
          <Route path="/roster" element={<StaffMemberRosterPage />} />
          <Route path="/my-roster" element={<StaffMemberRosterPage />} />
          <Route path="/clock" element={<StaffMemberClockPage />} />
          <Route path="/availability" element={<StaffMemberAvailabilityPage />} />
          <Route path="/leave" element={<StaffMemberLeavePage />} />
          <Route path="/noticeboard" element={<NoticeboardPage />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/checks" element={<TodayChecksPage />} />
          <Route path="/temperatures" element={<TemperaturesPage />} />
          <Route path="/stocktake" element={<StocktakeHandoffPage />} />
          <Route path="/compliance" element={<StaffMemberCompliancePage />} />
          <Route path="/documents" element={<StaffMemberDocumentsPage />} />
          <Route path="/handbook" element={<StaffHandbookPage />} />
          <Route path="/academy" element={<StaffMemberAcademyPage staff={staff} loading={loading} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<StaffMemberTipsPage />} />
          <Route path="/my-pay" element={<StaffMemberPayPage />} />
          <Route path="/communications" element={<CommunicationsPage staff={staff} reload={reload} />} />
          <Route path="/settings" element={<Navigate to="/" replace />} />
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      ) : (
        <Suspense fallback={<div className="full-page-loader"><Spinner label="Loading…" /></div>}>
        <Routes>
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="/" element={<StaffHome staff={staff} loading={loading} onSelect={setSelectedId} reload={reload} />} />
          <Route path="/brief" element={<HubLayout tabs={TODAY_TABS}><ManagerDailyBriefPage staff={staff} /></HubLayout>} />
          <Route path="/readiness" element={<HubLayout tabs={TODAY_TABS}><VenueReadinessPage staff={staff} /></HubLayout>} />
          <Route path="/manager" element={<HubLayout tabs={TODAY_TABS}><ManagerDashboardPage staff={staff} roster={roster} /></HubLayout>} />
          <Route path="/clock" element={<HubLayout tabs={TODAY_TABS}><StaffMemberClockPage /></HubLayout>} />
          <Route path="/profiles" element={<HubLayout tabs={peopleTabsFor(canOpenHr)}><StaffProfilesPage staff={staff} roleTemplates={roleTemplates} loading={loading} onSelect={setSelectedId} reload={reload} /></HubLayout>} />
          <Route path="/invites" element={<HubLayout tabs={peopleTabsFor(canOpenHr)}><InvitesPage staff={staff} roleTemplates={roleTemplates} reloadStaff={reload} /></HubLayout>} />
          <Route path="/approvals" element={<HubLayout tabs={peopleTabsFor(canOpenHr)}><ApprovalsPage staff={staff} reload={reload} /></HubLayout>} />
          <Route path="/settings" element={canOpenSettings ? <AdminPage staff={staff} roster={roster} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} /> : <Navigate to="/" replace />} />
          <Route path="/admin" element={canOpenSettings ? <AlmaAdminRedirect /> : <Navigate to="/" replace />} />
          <Route path="/access" element={<Navigate to="/profiles" replace />} />
          <Route path="/staff/:staffId" element={<StaffProfileWorkspacePage staff={staff} roleTemplates={roleTemplates} hrRecords={hrRecords} loading={loading} reload={reload} reloadHr={loadHrRecords} canOpenHr={canOpenHr} canManageHr={canManageHr} canOpenRightToWork={canAccessRightToWorkHr(user)} canManageRightToWork={canManageRightToWorkHr} canOpenPayChanges={canAccessPayChangeHr(user)} />} />
          <Route path="/staff/:staffId/:section" element={<StaffProfileWorkspacePage staff={staff} roleTemplates={roleTemplates} hrRecords={hrRecords} loading={loading} reload={reload} reloadHr={loadHrRecords} canOpenHr={canOpenHr} canManageHr={canManageHr} canOpenRightToWork={canAccessRightToWorkHr(user)} canManageRightToWork={canManageRightToWorkHr} canOpenPayChanges={canAccessPayChangeHr(user)} />} />
          <Route path="/roster" element={<HubLayout tabs={ROSTER_PAY_TABS}><RosterPage staff={staff} roster={roster} reload={reload} /></HubLayout>} />
          <Route path="/my-roster" element={<HubLayout tabs={ROSTER_PAY_TABS}><StaffMemberRosterPage /></HubLayout>} />
          <Route path="/leave" element={<HubLayout tabs={ROSTER_PAY_TABS}><LeaveCalendarPage staff={staff} /></HubLayout>} />
          <Route path="/noticeboard" element={<NoticeboardPage />} />
          <Route path="/handbook" element={<StaffHandbookPage />} />
          <Route path="/report" element={<ReportIssuePage />} />
          <Route path="/checks" element={<TodayChecksPage />} />
          <Route path="/temperatures" element={<TemperaturesPage />} />
          <Route path="/stocktake" element={<StocktakeHandoffPage />} />
          <Route path="/compliance" element={<HubLayout tabs={COMPLIANCE_TABS}><StaffMemberCompliancePage /></HubLayout>} />
          <Route path="/academy" element={<HubLayout tabs={COMPLIANCE_TABS}><TrainingPage staff={staff} reloadStaff={reload} /></HubLayout>} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<HubLayout tabs={ROSTER_PAY_TABS}><TimesheetsPage staff={staff} roster={roster} /></HubLayout>} />
          <Route path="/tips" element={<HubLayout tabs={ROSTER_PAY_TABS}><TipsPage staff={staff} /></HubLayout>} />
          <Route path="/labour" element={<HubLayout tabs={ROSTER_PAY_TABS}><LabourPage /></HubLayout>} />
          <Route path="/communications" element={<CommunicationsPage staff={staff} reload={reload} />} />
          <Route path="/hr" element={canOpenHr ? <HubLayout tabs={peopleTabsFor(canOpenHr)}><HrOverviewPage records={hrRecords} loading={hrLoading} /></HubLayout> : <Navigate to="/" replace />} />
          <Route path="/hr/contracts" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="CONTRACT" mode="contracts" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/warnings" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="WARNING" mode="warnings" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/pay-changes" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="PAY_CHANGE" mode="pay-changes" loading={hrLoading} reload={loadHrRecords} canManage={canManagePayChangeHr} canApprove={canApprovePayChangeHr} currentUserId={currentUserId} /> : <Navigate to="/" replace />} />
          <Route path="/hr/right-to-work" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="RIGHT_TO_WORK" mode="right-to-work" loading={hrLoading} reload={loadHrRecords} canManage={canManageRightToWorkHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/documents" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} mode="documents" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      )}
      </>
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
      <Suspense fallback={<div className="full-page-loader"><Spinner label="Loading…" /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
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
      </Suspense>
    </AuthProvider>
  );
}
