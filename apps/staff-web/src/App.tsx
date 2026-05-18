import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type {
  AppSettingsPayload,
  AlmaAppId,
  MarketingContentDashboardSummary,
  MarketingSocialAccount,
  OnboardingSettings,
  OnboardingStepSettings,
  RosterShift,
  StaffAppAccessStatus,
  StaffComplianceRecord,
  StaffClockSession,
  StaffClockStatusPayload,
  StaffDailyHomePayload,
  StaffTipHistory,
  StaffManagerOperationsPayload,
  StaffProfile,
  StaffRecordType,
  StaffDefaults,
  StaffLeaveRequest,
  StaffLeaveStatus,
  StaffLeaveType,
  StaffManagementEvent,
  StaffManagerDashboardPayload,
  StaffMyRosterPayload,
  StaffTrainingStatus,
  SuiteAnnouncement,
  SuiteChatChannel,
  SuiteChatMessage,
  StaffTipsSummary,
  StaffTrainingRecord,
  SuiteCommunicationsPayload,
  SocialPlatform,
  Timesheet,
  TrainingOverview
} from '@alma/shared';
import {
  AWARD_RATE_SETS,
  DEFAULT_STAFF_DEFAULTS,
  DEFAULT_ONBOARDING_SETTINGS,
  normaliseOnboardingSettings,
  normaliseStaffDefaults
} from '@alma/shared';
import {
  ActionFeedback,
  ActionPanel,
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
  SuiteCommsWidget,
  Textarea,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { LoginPage } from './LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './PasswordRecoveryPages';
import { api, createSuiteHandoffUrl } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { COMPLIANCE_WEB_URL, RESERVE_WEB_URL, STOCK_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import { historicalSalesForDate, normaliseHistoricalVenue } from './data/historicalSales';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

const STAFF_APPS: Array<{ id: AlmaAppId; label: string; role: string }> = [
  { id: 'COMPLIANCE', label: 'Compliance', role: 'MANAGER' },
  { id: 'STOCK', label: 'Stock', role: 'USER' },
  { id: 'STAFF', label: 'Staff', role: 'MANAGER' },
  { id: 'REPORTS', label: 'Reports', role: 'USER' },
  { id: 'RESERVE', label: 'Reserve', role: 'USER' },
  { id: 'MARKETING', label: 'Marketing', role: 'USER' },
  { id: 'GIFTCARDS', label: 'Giftcards', role: 'USER' },
  { id: 'TRAINING', label: 'Academy', role: 'USER' },
  { id: 'SETTINGS', label: 'Settings', role: 'ADMIN' }
];

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

const NAV_ITEMS = [
  {
    to: '/',
    label: 'People',
    description: 'Shared StaffProfile authority',
    icon: <PeopleIcon />,
    end: true
  },
  {
    to: '/manager',
    label: 'Manager Today',
    description: 'Today’s staff, clock sessions, bookings and exceptions',
    icon: <ChartIcon />
  },
  {
    to: '/clock',
    label: 'Clock',
    description: 'My clock in, out and breaks',
    icon: <DocumentIcon />
  },
  {
    to: '/access',
    label: 'Profiles',
    description: 'Full staff profiles, permissions, documents, and tasks',
    icon: <PeopleIcon />
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
    to: '/leave',
    label: 'Leave',
    description: 'Manager leave calendar',
    icon: <DocumentIcon />
  },
  {
    to: '/compliance',
    label: 'Compliance',
    description: 'Staff compliance reminders',
    icon: <DocumentIcon />
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
    label: 'Staff settings',
    description: 'Staff defaults, onboarding and access',
    icon: <GearIcon />
  },
  {
    to: '/communications',
    label: 'Comms',
    description: 'Announcements, group chats, and messaging permissions',
    icon: <DocumentIcon />
  }
];

const STAFF_MEMBER_NAV_ITEMS = [
  {
    to: '/',
    label: 'Home',
    description: 'Today, clocking, reminders and announcements',
    icon: <PeopleIcon />,
    end: true
  },
  {
    to: '/roster',
    label: 'Roster',
    description: 'My upcoming and past shifts',
    icon: <ChartIcon />
  },
  {
    to: '/clock',
    label: 'Clock',
    description: 'Clock in, out and breaks',
    icon: <DocumentIcon />
  },
  {
    to: '/leave',
    label: 'Leave',
    description: 'Request leave and view approvals',
    icon: <DocumentIcon />
  },
  {
    to: '/compliance',
    label: 'Compliance',
    description: 'Documents, training and reminders',
    icon: <DocumentIcon />
  }
];

const VENUE_OPTIONS = [
  { label: 'Select venue / group', value: '' },
  { label: 'Alma Avalon', value: 'Alma Avalon' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Both', value: 'Both' }
];
const MARKETING_SOCIAL_PLATFORMS: SocialPlatform[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK'];

const ROSTER_FORECAST_STORAGE_KEY = 'alma.staff.roster.forecast.v1';
const ROSTER_CLOSED_DAYS_STORAGE_KEY = 'alma.staff.roster.closedDays.v1';
const ROSTER_AREA_SETTINGS_STORAGE_KEY = 'alma.staff.roster.areas.v1';
const DEFAULT_ROSTER_AREAS = ['Floor', 'Bar', 'Kitchen', 'Management', 'Events', 'Training'];
const LEAVE_TYPE_OPTIONS: Array<{ label: string; value: StaffLeaveType }> = [
  { label: 'Annual leave', value: 'ANNUAL' },
  { label: 'Sick leave', value: 'SICK' },
  { label: 'Personal leave', value: 'PERSONAL' },
  { label: 'Unpaid leave', value: 'UNPAID' },
  { label: 'Other leave', value: 'OTHER' }
];
const LEAVE_STATUS_OPTIONS: Array<{ label: string; value: StaffLeaveStatus }> = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Declined', value: 'DECLINED' },
  { label: 'Cancelled', value: 'CANCELLED' }
];

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

type RosterAreaSettings = {
  order: string[];
  hidden: string[];
  deleted: string[];
};

type RosterSidePanelMode = 'staff' | 'history' | 'shift';

type RosterScheduleRow = {
  id: string;
  label: string;
  sublabel: string;
  initials: string;
  shifts: RosterShift[];
  member: StaffProfile | null;
  venue: string;
  area: string;
  isVenueHeader?: boolean;
};

function staffPermissions(user: ReturnType<typeof useAuth>['user']) {
  return user?.appAccess.find((access) => access.appId === 'STAFF' && access.status === 'ENABLED')?.permissions ?? {};
}

function canAccessSettings(user: ReturnType<typeof useAuth>['user']) {
  const settingsAccess = user?.appAccess.find((access) => access.appId === 'SETTINGS' && access.status === 'ENABLED');
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      settingsAccess?.role === 'ADMIN' ||
      settingsAccess?.permissions?.admin)
  );
}

function navItemsForUser(user: ReturnType<typeof useAuth>['user']) {
  if (user?.role === 'STAFF') return STAFF_MEMBER_NAV_ITEMS;
  if (canAccessSettings(user)) return NAV_ITEMS;
  return NAV_ITEMS.filter((item) => item.to !== '/settings' && item.to !== '/admin');
}

function suiteAppsForUser(user: ReturnType<typeof useAuth>['user']) {
  if (!user || user.isAdmin) return suiteApps;

  return suiteApps.filter((app) => {
    const accessAppId = SUITE_APP_ACCESS_MAP[app.id];
    if (!accessAppId) return false;
    if (accessAppId === 'SETTINGS') return canAccessSettings(user);
    return user.appAccess.some((access) => access.appId === accessAppId && access.status === 'ENABLED');
  });
}

function canManageCommunications(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      user.role === 'MANAGER' ||
      permissions.admin ||
      permissions.communicationsManage ||
      permissions.announcementsManage ||
      permissions.chatModerate)
  );
}

function canDirectMessage(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(user && (canManageCommunications(user) || permissions.chatDirect));
}

function TopBarWithContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const navItems = navItemsForUser(user);
  const active = currentPage(location.pathname, navItems);
  useDocumentTitle(active.label);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        user ? (
          <>
            <SuiteAppSwitcher currentApp="staff" apps={suiteAppsForUser(user)} variant="topbar" />
            <SuiteCommsWidget
              appId="STAFF"
              api={api}
              venue={user.venue}
              userName={`${user.firstName} ${user.lastName}`}
              canAnnounce={canManageCommunications(user)}
            />
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
            <NavLink to={item.to} end={item.end}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
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
  const staffForReadiness = activeStaff.filter((member) => !isUnallocatedProfile(member));
  const missingPayRate = staffForReadiness.filter((member) => !member.payRateCents && !member.trainingPayRateCents);
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
    <div className="page-stack staff-settings-page">
      <PageHeader
        eyebrow="ALMA Staff"
        title="One staff authority for every ALMA app"
        description="This app reads and manages the shared StaffProfile register used by Compliance, Stock, Training, Reports, and future modules."
      />

      <div className="stats-grid staff-settings-stats">
        <StatCard label="Staff profiles" value={staff.length} hint="Shared records" loading={loading} />
        <StatCard label="Active" value={activeStaff.length} hint="Not archived" loading={loading} />
        <StatCard label="Pending onboarding" value={pending.length} hint="Invite created" loading={loading} />
        <StatCard label="Expiring records" value={expiringSoon.length} hint="Next 30 days" loading={loading} />
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
              <Button type="button" size="sm" variant="secondary" onClick={() => setForm({ mode: 'edit', member })}>
                Edit profile
              </Button>
            </div>
          ))}
          {missingPayType.slice(0, 8).map((member) => (
            <div key={`paytype:${member.id}`} className="action-panel-row">
              <span>
                <strong>{member.firstName} {member.lastName}</strong>
                <small>{member.venue || 'No venue'} · pay type missing.</small>
              </span>
              <Button type="button" size="sm" variant="secondary" onClick={() => setForm({ mode: 'edit', member })}>
                Edit profile
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
              <Button type="button" size="sm" variant="secondary" onClick={() => onSelect(group[0]!.id)}>
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
  const [loadingHome, setLoadingHome] = useState(true);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

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

  async function runClockAction(action: 'clock-in' | 'clock-out' | 'break-start' | 'break-end') {
    setSaving(true);
    setMessage(null);
    setMessageTarget('clock');
    try {
      if (action === 'clock-in') {
        await api('/api/staff/me/clock/in', {
          method: 'POST',
          body: JSON.stringify({ rosterShiftId: todayShift?.id || nextShift?.id || '' })
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
        actions={<Button type="button" variant="secondary" disabled={loadingHome} onClick={() => void loadHome()}>{loadingHome ? 'Refreshing…' : 'Refresh'}</Button>}
      />

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
        </div>
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
                  ? `${todayShift.venue || displayMember?.venue || 'No venue'} · ${roundHours(shiftHours(todayShift))}h rostered`
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
    </div>
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
    try {
      if (action === 'clock-in') {
        await api('/api/staff/me/clock/in', { method: 'POST', body: JSON.stringify({ rosterShiftId: selectedShiftId }) });
      } else if (action === 'clock-out') {
        await api('/api/staff/me/clock/out', { method: 'POST', body: JSON.stringify({}) });
      } else if (action === 'break-start') {
        await api('/api/staff/me/clock/break/start', { method: 'POST', body: JSON.stringify({}) });
      } else {
        await api('/api/staff/me/clock/break/end', { method: 'POST', body: JSON.stringify({}) });
      }
      await loadClock();
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

type StaffDraft = {
  firstName: string;
  lastName: string;
  roleTitle: string;
  email: string;
  phone: string;
  venue: string;
  employmentStatus: string;
  startDate: string;
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  employmentType: string;
  payType: string;
  payRate: string;
  payAward: string;
  taxFileNumber: string;
  taxResidencyStatus: string;
  taxFreeThreshold: boolean;
  hasStudyTrainingLoan: boolean;
  superFundName: string;
  superFundAbn: string;
  superFundUsi: string;
  superMemberNumber: string;
  bankAccountName: string;
  bankBsb: string;
  bankAccountNumber: string;
  visaStatus: string;
  visaSubclass: string;
  visaExpiryDate: string;
  workRightsNotes: string;
  xeroEmployeeId: string;
  xeroPayrollCalendarId: string;
  xeroEarningsRateId: string;
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
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    suburb: '',
    state: '',
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
    taxFreeThreshold: false,
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
    xeroEmployeeId: '',
    xeroPayrollCalendarId: '',
    xeroEarningsRateId: '',
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
    dateOfBirth: member.dateOfBirth ? toDateInput(new Date(member.dateOfBirth)) : '',
    addressLine1: member.addressLine1 ?? '',
    addressLine2: member.addressLine2 ?? '',
    suburb: member.suburb ?? '',
    state: member.state ?? '',
    postcode: member.postcode ?? '',
    emergencyContactName: member.emergencyContactName ?? '',
    emergencyContactRelationship: member.emergencyContactRelationship ?? '',
    emergencyContactPhone: member.emergencyContactPhone ?? '',
    employmentType: member.employmentType ?? '',
    payType: member.payType ?? '',
    payRate: member.payRateCents ? String(member.payRateCents / 100) : '',
    payAward: member.payAward ?? '',
    taxFileNumber: member.taxFileNumber ?? '',
    taxResidencyStatus: member.taxResidencyStatus ?? '',
    taxFreeThreshold: Boolean(member.taxFreeThreshold),
    hasStudyTrainingLoan: Boolean(member.hasStudyTrainingLoan),
    superFundName: member.superFundName ?? '',
    superFundAbn: member.superFundAbn ?? '',
    superFundUsi: member.superFundUsi ?? '',
    superMemberNumber: member.superMemberNumber ?? '',
    bankAccountName: member.bankAccountName ?? '',
    bankBsb: member.bankBsb ?? '',
    bankAccountNumber: member.bankAccountNumber ?? '',
    visaStatus: member.visaStatus ?? '',
    visaSubclass: member.visaSubclass ?? '',
    visaExpiryDate: member.visaExpiryDate ? toDateInput(new Date(member.visaExpiryDate)) : '',
    workRightsNotes: member.workRightsNotes ?? '',
    xeroEmployeeId: member.xeroEmployeeId ?? '',
    xeroPayrollCalendarId: member.xeroPayrollCalendarId ?? '',
    xeroEarningsRateId: member.xeroEarningsRateId ?? '',
    notes: member.notes ?? ''
  };
}

function staffPayloadFromDraft(draft: StaffDraft) {
  const payRate = Number(draft.payRate.replace(/[^0-9.]/g, ''));
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    roleTitle: draft.roleTitle.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    venue: draft.venue.trim(),
    employmentStatus: draft.employmentStatus,
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
    xeroEmployeeId: draft.xeroEmployeeId.trim(),
    xeroPayrollCalendarId: draft.xeroPayrollCalendarId.trim(),
    xeroEarningsRateId: draft.xeroEarningsRateId.trim(),
    notes: draft.notes.trim()
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

  function update<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    setFeedback(null);
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.roleTitle.trim()) {
      setFeedback('First name, last name and role are required');
      setFeedbackTone('error');
      return;
    }
    const payload = staffPayloadFromDraft(draft);

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        const saved = await api<StaffProfile>(`/api/staff/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
        setFeedback('Staff profile saved.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(saved), 500);
      } else {
        const created = await api<StaffProfile>('/api/staff', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        setFeedback('Staff profile created.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(created), 500);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not save staff profile');
      setFeedbackTone('error');
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
      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create staff'}</Button>
        <ActionFeedback message={feedback} tone={feedbackTone} />
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
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
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
    setMessageTarget('create-invite');
    if (!draft.firstName.trim() || !draft.lastName.trim() || !draft.roleTitle.trim()) {
      const next = 'First name, last name and role are required';
      setError(next);
      setMessage(next);
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
      const next = err instanceof Error ? err.message : 'Could not create invite';
      setError(next);
      setMessage(next);
    } finally {
      setSaving(false);
    }
  }

  async function copyInviteLink(invite: StaffInvite) {
    const link = inviteLink(invite.token);
    await navigator.clipboard?.writeText(link);
    setMessageTarget(`copy:${invite.id}`);
    setMessage('Onboarding link copied.');
  }

  async function reonboardStaff() {
    setError(null);
    setMessage(null);
    setMessageTarget('reonboard');
    if (!reonboardDraft.email.trim()) {
      const next = 'Email is required to reset onboarding.';
      setError(next);
      setMessage(next);
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
      const next = err instanceof Error ? err.message : 'Could not reset onboarding.';
      setError(next);
      setMessage(next);
    } finally {
      setSaving(false);
    }
  }

  async function resendInvite(invite: StaffInvite) {
    setSaving(true);
    setError(null);
    setMessage(null);
    setMessageTarget(`resend:${invite.id}`);
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
      const next = err instanceof Error ? err.message : 'Could not resend invite';
      setError(next);
      setMessage(next);
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
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create invite'}</Button>
              <ActionFeedback
                message={messageTarget === 'create-invite' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
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
              <ActionFeedback
                message={messageTarget === 'reonboard' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
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
                    <ActionFeedback
                      message={messageTarget === `copy:${invite.id}` ? message : null}
                      tone="success"
                    />
                    <Button type="button" size="sm" variant="ghost" disabled={saving || status === 'Completed'} onClick={() => void resendInvite(invite)}>
                      Resend
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `resend:${invite.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
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
  const { user } = useAuth();
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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const accessByApp = new Map(selected?.appAccess.map((access) => [access.appId, access]));
  const activeModules = (training?.modules ?? []).filter((module) => module.status === 'ACTIVE');
  const selectedTrainingRecords = training?.records.filter((record) => record.staffProfileId === selected?.id) ?? selected?.trainingRecords ?? [];
  const canManageSettings = canAccessSettings(user);
  const visibleStaffApps = canManageSettings ? STAFF_APPS : STAFF_APPS.filter((app) => app.id !== 'SETTINGS');
  const visibleProfilePresets = canManageSettings
    ? STAFF_PROFILE_PRESETS
    : STAFF_PROFILE_PRESETS.filter((preset) => preset.id !== 'admin');

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
  }, [selected?.id]);

  useEffect(() => {
    void loadTraining();
  }, [loadTraining]);

  function updateProfile<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setProfileDraft((current) => ({ ...current, [key]: value }));
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

  async function deleteDocument(record: StaffComplianceRecord) {
    if (!selected) return;
    if (!window.confirm(`Remove ${record.title} from ${selected.firstName}'s documents?`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:remove`);
    try {
      await api(`/api/staff/${selected.id}/records/${record.id}`, { method: 'DELETE' });
      await reload();
      setMessage('Document removed.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not remove document.');
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
              onClick={() => setSelectedId(member.id)}
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

            <Card title="Profile type" subtitle="Use these as starting points, then tweak the person below.">
              <div className="app-access-grid">
                {visibleProfilePresets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="app-access-tile"
                    disabled={saving}
                    onClick={() => void saveAppAccessWithPreset(preset.id)}
                  >
                    <strong>{preset.label}</strong>
                    <span className="subtle">{preset.roleTitle}</span>
                    <Badge tone="info">{Object.values(preset.appAccess).filter((access) => access.status === 'ENABLED').length} apps</Badge>
                    <ActionFeedback
                      message={messageTarget === `preset:${preset.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </button>
                ))}
              </div>
            </Card>

            <Card title="Personal and payroll details" subtitle="Admin view of the shared StaffProfile authority.">
              <form
                className="staff-profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveProfile();
                }}
              >
                <div className="form-grid three">
                  <Input label="First name" value={profileDraft.firstName} onChange={(event) => updateProfile('firstName', event.currentTarget.value)} />
                  <Input label="Last name" value={profileDraft.lastName} onChange={(event) => updateProfile('lastName', event.currentTarget.value)} />
                  <Input label="Role title" value={profileDraft.roleTitle} onChange={(event) => updateProfile('roleTitle', event.currentTarget.value)} />
                  <Input label="Email" type="email" value={profileDraft.email} onChange={(event) => updateProfile('email', event.currentTarget.value)} />
                  <Input label="Phone" value={profileDraft.phone} onChange={(event) => updateProfile('phone', event.currentTarget.value)} />
                  <Select label="Venue" value={profileDraft.venue} onChange={(event) => updateProfile('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
                  <Select label="Status" value={profileDraft.employmentStatus} onChange={(event) => updateProfile('employmentStatus', event.currentTarget.value)} options={['ACTIVE', 'PENDING', 'ARCHIVED'].map((status) => ({ label: status, value: status }))} />
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
                <Textarea label="Manager notes" rows={3} value={profileDraft.notes} onChange={(event) => updateProfile('notes', event.currentTarget.value)} />
                <div className="toolbar-right">
                  <Button type="button" variant="danger" disabled={saving || selected.isAdmin} onClick={() => void archiveProfile()}>Archive profile</Button>
                  <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</Button>
                  <ActionFeedback
                    message={messageTarget === 'profile' ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </form>
            </Card>

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
                  const current = accessByApp.get(app.id);
                  const appPermissions = permissionsFor(app.id);
                  return (
                    <div key={app.id} className="app-access-tile">
                      <strong>{app.label}</strong>
                      <span className="subtle">{current?.status ?? 'DISABLED'} · {current?.role ?? app.role}</span>
                      <div className="onboarding-toggle-row">
                        {permissions.map((permission) => (
                          <label key={permission.key} className="check-row">
                            <input
                              type="checkbox"
                              checked={Boolean(appPermissions[permission.key] || appPermissions.admin)}
                              disabled={saving || Boolean(appPermissions.admin && permission.key !== 'admin')}
                              onChange={(event) => void setPermission(app.id, permission.key, event.currentTarget.checked)}
                            />
                            {permission.label}
                          </label>
                        ))}
                      </div>
                      <ActionFeedback
                        message={messageTarget === `permission:${app.id}` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Documents" subtitle="View uploaded documents and add certificates or admin-only notes.">
              <div className="staff-list">
                {selected.records.length === 0 ? <EmptyState title="No documents" description="Add RSA, visa, payroll or training documents below." /> : null}
                {selected.records.map((record) => (
                  <div key={record.id} className="staff-expiry-row">
                    <span>
                      <strong>{record.title}</strong>
                      <span className="subtle">{record.recordType} · {record.issuer || 'No issuer'} · expires {record.expiryDate ? new Date(record.expiryDate).toLocaleDateString() : 'No expiry'}</span>
                      {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
                      <StaffDocumentViewLink documentUrl={record.documentUrl} />
                      {record.notes ? <span className="subtle">{record.notes}</span> : null}
                    </span>
                    <span className="invite-row-actions">
                      <Badge tone={record.status === 'APPROVED' ? 'positive' : record.status === 'EXPIRED' ? 'danger' : 'warning'}>{record.status}</Badge>
                      <Button type="button" size="sm" variant="secondary" disabled={saving || record.status === 'APPROVED' || !record.documentUrl} onClick={() => void approveDocument(record)}>Approve</Button>
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:approve` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                      <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteDocument(record)}>Remove</Button>
                      <ActionFeedback
                        message={messageTarget === `record:${record.id}:remove` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))}
              </div>
              <form
                className="staff-profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void addDocument();
                }}
              >
                <div className="form-grid three">
                  <Select label="Type" value={documentDraft.recordType} onChange={(event) => setDocumentDraft((current) => ({ ...current, recordType: event.currentTarget.value as StaffRecordType }))} options={['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'].map((value) => ({ label: value.replace('_', ' '), value }))} />
                  <Input label="Title" value={documentDraft.title} onChange={(event) => setDocumentDraft((current) => ({ ...current, title: event.currentTarget.value }))} />
                  <Input label="Issuer" value={documentDraft.issuer} onChange={(event) => setDocumentDraft((current) => ({ ...current, issuer: event.currentTarget.value }))} />
                  <Input label="Certificate number" value={documentDraft.certificateNumber} onChange={(event) => setDocumentDraft((current) => ({ ...current, certificateNumber: event.currentTarget.value }))} />
                  <Input label="Issue date" type="date" value={documentDraft.issueDate} onChange={(event) => setDocumentDraft((current) => ({ ...current, issueDate: event.currentTarget.value }))} />
                  <Input label="Expiry date" type="date" value={documentDraft.expiryDate} onChange={(event) => setDocumentDraft((current) => ({ ...current, expiryDate: event.currentTarget.value }))} />
                  <Select label="Status" value={documentDraft.status} onChange={(event) => setDocumentDraft((current) => ({ ...current, status: event.currentTarget.value }))} options={['PENDING', 'APPROVED', 'EXPIRED'].map((value) => ({ label: value, value }))} />
                  <Input label="Document name" value={documentDraft.documentName} onChange={(event) => setDocumentDraft((current) => ({ ...current, documentName: event.currentTarget.value }))} />
                  {documentDraft.documentUrl.startsWith('data:') ? (
                    <Input label="Document attachment" value={documentDraft.documentName || 'Attached file'} disabled />
                  ) : (
                    <Input label="Document URL" value={documentDraft.documentUrl} onChange={(event) => setDocumentDraft((current) => ({ ...current, documentUrl: event.currentTarget.value }))} />
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
                <Textarea label="Document notes" rows={2} value={documentDraft.notes} onChange={(event) => setDocumentDraft((current) => ({ ...current, notes: event.currentTarget.value }))} />
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

const COMMUNICATION_PERMISSION_KEYS = [
  { key: 'chatTeam', label: 'Team chat' },
  { key: 'chatDirect', label: 'Direct messages' },
  { key: 'chatModerate', label: 'Moderate chats' },
  { key: 'announcementsManage', label: 'Announcements' },
  { key: 'communicationsManage', label: 'Comms admin' }
];

type AnnouncementDraft = {
  title: string;
  body: string;
  audience: string;
  appId: AlmaAppId;
  venue: string;
  pinned: boolean;
  expiresAt: string;
};

type ChannelDraft = {
  name: string;
  description: string;
  type: SuiteChatChannel['type'];
  venue: string;
  groupKey: string;
  postPermission: string;
  directMessagesAllowed: boolean;
};

function emptyAnnouncementDraft(): AnnouncementDraft {
  return {
    title: '',
    body: '',
    audience: 'ALL',
    appId: 'STAFF',
    venue: '',
    pinned: false,
    expiresAt: ''
  };
}

function emptyChannelDraft(): ChannelDraft {
  return {
    name: '',
    description: '',
    type: 'GROUP',
    venue: '',
    groupKey: '',
    postPermission: '',
    directMessagesAllowed: true
  };
}

function dateInputFromIso(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function permissionsForMember(member: StaffProfile) {
  return member.appAccess.find((access) => access.appId === 'STAFF')?.permissions ?? {};
}

function CommunicationsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const { user } = useAuth();
  const [payload, setPayload] = useState<SuiteCommunicationsPayload>({ announcements: [], channels: [], chat: [] });
  const [announcementDraft, setAnnouncementDraft] = useState<AnnouncementDraft>(() => emptyAnnouncementDraft());
  const [editingAnnouncementId, setEditingAnnouncementId] = useState('');
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>(() => emptyChannelDraft());
  const [editingChannelId, setEditingChannelId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [directRecipientId, setDirectRecipientId] = useState('');
  const [directSearch, setDirectSearch] = useState('');
  const [chatText, setChatText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const canManage = canManageCommunications(user);
  const canDirect = canDirectMessage(user);
  const permissionStaffApps = canAccessSettings(user) ? STAFF_APPS : STAFF_APPS.filter((app) => app.id !== 'SETTINGS');
  const activeChannels = payload.channels.filter((channel) => channel.isActive);
  const selectedChannel = activeChannels.find((channel) => channel.id === selectedChannelId) ?? activeChannels[0] ?? null;
  const recipients = staff.filter((member) => member.id !== user?.id && member.employmentStatus !== 'ARCHIVED');
  const selectedDirectRecipient = recipients.find((member) => member.id === directRecipientId) ?? null;
  const filteredRecipients = recipients.filter((member) => {
    const query = directSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      member.firstName,
      member.lastName,
      member.email,
      member.roleTitle,
      member.venue
    ].some((value) => value?.toLowerCase().includes(query));
  });

  const loadCommunications = useCallback(async (options?: { channelId?: string; recipientId?: string }) => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ appId: 'STAFF' });
      if (user?.venue) params.set('venue', user.venue);
      if (options?.channelId) params.set('channelId', options.channelId);
      if (options?.recipientId) params.set('recipientId', options.recipientId);
      const data = canManage && !options?.channelId && !options?.recipientId
        ? await api<SuiteCommunicationsPayload>('/api/communications/admin')
        : await api<SuiteCommunicationsPayload>(`/api/communications?${params.toString()}`);
      setPayload(data);
      if (!selectedChannelId && data.channels[0]) setSelectedChannelId(data.channels[0].id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load communications.');
    } finally {
      setLoading(false);
    }
  }, [canManage, selectedChannelId, user?.venue]);

  useEffect(() => {
    void loadCommunications();
  }, [loadCommunications]);

  function startEditAnnouncement(announcement: SuiteAnnouncement) {
    setEditingAnnouncementId(announcement.id);
    setAnnouncementDraft({
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      appId: announcement.appId ?? 'STAFF',
      venue: announcement.venue ?? '',
      pinned: announcement.pinned,
      expiresAt: dateInputFromIso(announcement.expiresAt)
    });
  }

  function startEditChannel(channel: SuiteChatChannel) {
    setEditingChannelId(channel.id);
    setChannelDraft({
      name: channel.name,
      description: channel.description ?? '',
      type: channel.type,
      venue: channel.venue ?? '',
      groupKey: channel.groupKey ?? '',
      postPermission: channel.postPermission ?? '',
      directMessagesAllowed: channel.directMessagesAllowed
    });
  }

  async function saveAnnouncement() {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('announcement');
    try {
      const body = JSON.stringify({
        title: announcementDraft.title,
        body: announcementDraft.body,
        audience: announcementDraft.audience,
        appId: announcementDraft.appId,
        venue: announcementDraft.venue,
        pinned: announcementDraft.pinned,
        expiresAt: announcementDraft.expiresAt
      });
      if (editingAnnouncementId) {
        await api<SuiteAnnouncement>(`/api/communications/announcements/${editingAnnouncementId}`, { method: 'PATCH', body });
        setMessage('Announcement updated.');
      } else {
        await api<SuiteAnnouncement>('/api/communications/announcements', { method: 'POST', body });
        setMessage('Announcement published.');
      }
      setAnnouncementDraft(emptyAnnouncementDraft());
      setEditingAnnouncementId('');
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save announcement.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAnnouncement(announcement: SuiteAnnouncement) {
    if (!canManage || !window.confirm(`Delete announcement "${announcement.title}"?`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`announcement:${announcement.id}:delete`);
    try {
      await api(`/api/communications/announcements/${announcement.id}`, { method: 'DELETE' });
      await loadCommunications();
      setMessage('Announcement deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete announcement.');
    } finally {
      setSaving(false);
    }
  }

  async function saveChannel() {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('channel');
    try {
      const body = JSON.stringify({
        name: channelDraft.name,
        description: channelDraft.description,
        type: channelDraft.type,
        appId: 'STAFF',
        venue: channelDraft.venue,
        groupKey: channelDraft.groupKey,
        postPermission: channelDraft.postPermission,
        directMessagesAllowed: channelDraft.directMessagesAllowed,
        isActive: true
      });
      if (editingChannelId) {
        await api<SuiteChatChannel>(`/api/communications/channels/${editingChannelId}`, { method: 'PATCH', body });
        setMessage('Chat group updated.');
      } else {
        await api<SuiteChatChannel>('/api/communications/channels', { method: 'POST', body });
        setMessage('Chat group created.');
      }
      setChannelDraft(emptyChannelDraft());
      setEditingChannelId('');
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save chat group.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: SuiteChatChannel) {
    if (!canManage || !window.confirm(`Archive chat group "${channel.name}"? Messages stay in history.`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`channel:${channel.id}:delete`);
    try {
      await api(`/api/communications/channels/${channel.id}`, { method: 'DELETE' });
      if (selectedChannelId === channel.id) setSelectedChannelId('');
      await loadCommunications();
      setMessage('Chat group archived.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not archive chat group.');
    } finally {
      setSaving(false);
    }
  }

  async function openChannel(channel: SuiteChatChannel) {
    setSelectedChannelId(channel.id);
    setDirectRecipientId('');
    await loadCommunications({ channelId: channel.id });
  }

  async function openDirect(recipientId: string) {
    setDirectRecipientId(recipientId);
    setSelectedChannelId('');
    await loadCommunications({ recipientId });
  }

  async function sendMessage() {
    if (!chatText.trim()) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('chat-send');
    try {
      await api<SuiteChatMessage>('/api/communications/chat', {
        method: 'POST',
        body: JSON.stringify({
          appId: 'STAFF',
          channelId: directRecipientId ? '' : selectedChannel?.id ?? '',
          recipientId: directRecipientId,
          venue: user?.venue ?? '',
          body: chatText.trim()
        })
      });
      setChatText('');
      await loadCommunications(directRecipientId ? { recipientId: directRecipientId } : { channelId: selectedChannel?.id });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteMessage(chat: SuiteChatMessage) {
    if (!window.confirm('Delete this message?')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`chat:${chat.id}:delete`);
    try {
      await api(`/api/communications/chat/${chat.id}`, { method: 'DELETE' });
      await loadCommunications(directRecipientId ? { recipientId: directRecipientId } : { channelId: selectedChannel?.id });
      setMessage('Message deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete message.');
    } finally {
      setSaving(false);
    }
  }

  async function setChatPermission(member: StaffProfile, key: string, enabled: boolean) {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`chat-permission:${member.id}`);
    try {
      await api(`/api/staff/${member.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: permissionStaffApps.map((app) => {
            const current = member.appAccess.find((access) => access.appId === app.id);
            const permissions = current?.permissions ?? {};
            return {
              appId: app.id,
              status: current?.status ?? (app.id === 'STAFF' ? 'ENABLED' : 'DISABLED'),
              role: current?.role ?? app.role,
              permissions: app.id === 'STAFF' ? { ...permissions, [key]: enabled } : permissions,
              notes: current?.notes ?? ''
            };
          })
        })
      });
      await reload();
      setMessage('Chat permission updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update chat permission.');
    } finally {
      setSaving(false);
    }
  }

  const conversationTitle = directRecipientId
    ? selectedDirectRecipient
      ? `${selectedDirectRecipient.firstName} ${selectedDirectRecipient.lastName}`.trim()
      : 'Direct message'
    : selectedChannel?.name ?? 'Team chat';
  const conversationSubtitle = directRecipientId
    ? 'Private one-to-one staff message. Use this for quick operational follow-up, not announcements.'
    : selectedChannel?.description || 'Team chat for venue updates and shift-day coordination.';
  const messagePlaceholder = directRecipientId
    ? `Message ${selectedDirectRecipient?.firstName ?? 'this staff member'}`
    : 'Message this group';

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Communications"
        title={canManage ? 'Announcements and team chats' : 'Team chat'}
        description={canManage ? 'Manage announcements, venue and area group chats, direct messaging, and staff chat permissions.' : 'Read announcements, use your approved team channels, and direct-message staff if enabled.'}
      />

      <div className="stats-grid">
        <StatCard label="Announcements" value={payload.announcements.length} hint="Active" loading={loading} />
        <StatCard label="Chat groups" value={payload.channels.length} hint="Visible channels" loading={loading} />
        <StatCard label="Messages" value={payload.chat.length} hint="Current thread" loading={loading} />
        <StatCard label="Direct messages" value={canDirect ? 'On' : 'Off'} hint="Controlled in Profiles" loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') || message.includes('permission') ? 'error-text' : 'subtle'}>{message}</p> : null}

      {canManage ? (
        <div className="tips-entry-grid">
          <Card title="Announcements" subtitle="Create, edit, pin, expire, or delete staff announcements.">
            <form
              className="staff-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveAnnouncement();
              }}
            >
              <div className="form-grid two">
                <Input label="Title" value={announcementDraft.title} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, title: event.currentTarget.value }))} />
                <Select label="Venue" value={announcementDraft.venue} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, venue: event.currentTarget.value }))} options={VENUE_OPTIONS} />
              </div>
              <Textarea label="Announcement" rows={3} value={announcementDraft.body} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, body: event.currentTarget.value }))} />
              <div className="form-grid two">
                <Input label="Audience" value={announcementDraft.audience} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, audience: event.currentTarget.value }))} />
                <Input label="Expires" type="date" value={announcementDraft.expiresAt} onChange={(event) => setAnnouncementDraft((current) => ({ ...current, expiresAt: event.currentTarget.value }))} />
              </div>
              <label className="check-row">
                <input type="checkbox" checked={announcementDraft.pinned} onChange={(event) => { const checked = event.currentTarget.checked; setAnnouncementDraft((current) => ({ ...current, pinned: checked })); }} />
                Pin announcement
              </label>
              <div className="toolbar-right">
                {editingAnnouncementId ? <Button type="button" variant="secondary" onClick={() => { setEditingAnnouncementId(''); setAnnouncementDraft(emptyAnnouncementDraft()); }}>Cancel edit</Button> : null}
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingAnnouncementId ? 'Save announcement' : 'Publish announcement'}</Button>
                <ActionFeedback
                  message={messageTarget === 'announcement' ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
              </div>
            </form>
            <div className="staff-list">
              {payload.announcements.length === 0 ? (
                <EmptyState title="No announcements yet" description="Publish a real staff announcement when there is something the team needs to see." />
              ) : (
                payload.announcements.map((announcement) => (
                  <div key={announcement.id} className="staff-expiry-row">
                    <span>
                      <strong>{announcement.title}</strong>
                      <span className="subtle">{announcement.venue || 'All venues'} · {announcement.pinned ? 'Pinned' : 'Standard'} · {formatDateTime(announcement.createdAt)}</span>
                      <span>{announcement.body}</span>
                    </span>
                    <span className="invite-row-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={() => startEditAnnouncement(announcement)}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteAnnouncement(announcement)}>Delete</Button>
                      <ActionFeedback
                        message={messageTarget === `announcement:${announcement.id}:delete` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card title="Group chats" subtitle="Create venue-level and group-level chats like Kitchen, Bar, Floor, and Management.">
            <form
              className="staff-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveChannel();
              }}
            >
              <div className="form-grid two">
                <Input label="Group name" value={channelDraft.name} onChange={(event) => setChannelDraft((current) => ({ ...current, name: event.currentTarget.value }))} placeholder="Kitchen" />
                <Select label="Type" value={channelDraft.type} onChange={(event) => setChannelDraft((current) => ({ ...current, type: event.currentTarget.value as SuiteChatChannel['type'] }))} options={['GENERAL', 'VENUE', 'AREA', 'GROUP'].map((value) => ({ label: value, value }))} />
                <Select label="Venue" value={channelDraft.venue} onChange={(event) => setChannelDraft((current) => ({ ...current, venue: event.currentTarget.value }))} options={VENUE_OPTIONS} />
                <Input label="Group key" value={channelDraft.groupKey} onChange={(event) => setChannelDraft((current) => ({ ...current, groupKey: event.currentTarget.value }))} placeholder="kitchen" />
              </div>
              <Textarea label="Description" rows={2} value={channelDraft.description} onChange={(event) => setChannelDraft((current) => ({ ...current, description: event.currentTarget.value }))} />
              <Select label="Post permission" value={channelDraft.postPermission} onChange={(event) => setChannelDraft((current) => ({ ...current, postPermission: event.currentTarget.value }))} options={[{ label: 'Anyone with Staff access', value: '' }, ...COMMUNICATION_PERMISSION_KEYS.map((item) => ({ label: item.label, value: item.key }))]} />
              <label className="check-row">
                <input type="checkbox" checked={channelDraft.directMessagesAllowed} onChange={(event) => { const checked = event.currentTarget.checked; setChannelDraft((current) => ({ ...current, directMessagesAllowed: checked })); }} />
                Allow this group to use direct messaging
              </label>
              <div className="toolbar-right">
                {editingChannelId ? <Button type="button" variant="secondary" onClick={() => { setEditingChannelId(''); setChannelDraft(emptyChannelDraft()); }}>Cancel edit</Button> : null}
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingChannelId ? 'Save chat group' : 'Create chat group'}</Button>
                <ActionFeedback
                  message={messageTarget === 'channel' ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
              </div>
            </form>
            <div className="staff-list">
              {payload.channels.length === 0 ? (
                <EmptyState title="No chat groups yet" description="Create real venue, area or group chats when the team is ready to use them." />
              ) : (
                payload.channels.map((channel) => (
                  <div key={channel.id} className="staff-expiry-row">
                    <span>
                      <strong>{channel.name}</strong>
                      <span className="subtle">{channel.type} · {channel.venue || 'All venues'} · {channel.postPermission || 'Staff access'} posting</span>
                      {channel.description ? <span>{channel.description}</span> : null}
                    </span>
                    <span className="invite-row-actions">
                      <Badge tone={channel.isActive ? 'positive' : 'muted'}>{channel.isActive ? 'Active' : 'Archived'}</Badge>
                      <Button type="button" size="sm" variant="secondary" onClick={() => startEditChannel(channel)}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!channel.isActive} onClick={() => void deleteChannel(channel)}>Archive</Button>
                      <ActionFeedback
                        message={messageTarget === `channel:${channel.id}:delete` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      ) : null}

      <Card title={conversationTitle} subtitle={conversationSubtitle}>
        <div className="comms-layout">
          <div className="comms-sidebar">
            <section className="comms-sidebar-section" aria-label="Group chats">
              <div className="comms-section-heading">
                <strong>Group chats</strong>
                <span>{activeChannels.length} active</span>
              </div>
              {activeChannels.length === 0 ? (
                <p className="subtle">No active group chats yet.</p>
              ) : (
                activeChannels.map((channel) => (
                  <button key={channel.id} type="button" className={`staff-list-button comms-thread-button ${selectedChannelId === channel.id ? 'is-selected' : ''}`} onClick={() => void openChannel(channel)}>
                    <span>
                      <strong>{channel.name}</strong>
                      <span className="subtle">{channel.type} · {channel.venue || 'All venues'}</span>
                    </span>
                  </button>
                ))
              )}
            </section>
            {canDirect ? (
              <section className="comms-sidebar-section" aria-label="Direct messages">
                <div className="comms-section-heading">
                  <strong>Direct messages</strong>
                  <span>One to one</span>
                </div>
                <Input
                  label="Find staff"
                  value={directSearch}
                  onChange={(event) => setDirectSearch(event.currentTarget.value)}
                  placeholder="Search by name, role, or venue"
                />
                <div className="comms-direct-list">
                  {filteredRecipients.length === 0 ? (
                    <p className="subtle">No matching staff found.</p>
                  ) : (
                    filteredRecipients.map((member) => (
                      <button key={member.id} type="button" className={`staff-list-button comms-thread-button ${directRecipientId === member.id ? 'is-selected' : ''}`} onClick={() => void openDirect(member.id)}>
                        <span>
                          <strong>{member.firstName} {member.lastName}</strong>
                          <span className="subtle">{member.roleTitle || 'Staff'} · {member.venue || 'No venue'}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            ) : (
              <section className="comms-sidebar-section" aria-label="Direct messages unavailable">
                <div className="comms-section-heading">
                  <strong>Direct messages</strong>
                  <span>Off</span>
                </div>
                <p className="subtle">Direct messages are enabled by managers in staff communication permissions.</p>
              </section>
            )}
          </div>
          <div className="staff-mobile-chat">
            <div className="comms-thread-header">
              <span>
                <strong>{conversationTitle}</strong>
                <span className="subtle">
                  {directRecipientId
                    ? `${selectedDirectRecipient?.roleTitle || 'Staff'} · ${selectedDirectRecipient?.venue || 'No venue'}`
                    : `${selectedChannel?.type ?? 'GENERAL'} · ${selectedChannel?.venue || 'All venues'}`}
                </span>
              </span>
              <Badge tone={directRecipientId ? 'info' : 'muted'}>{directRecipientId ? 'Direct' : 'Group'}</Badge>
            </div>
            <div className="staff-mobile-comms-list">
              {payload.chat.length === 0 ? (
                <div className="comms-empty-thread">
                  <strong>No messages yet</strong>
                  <span className="subtle">
                    {directRecipientId
                      ? 'Start with a clear operational message. Direct chats are for one-to-one staff follow-up.'
                      : 'Start the group conversation when there is something useful for the team.'}
                  </span>
                </div>
              ) : (
                payload.chat.map((item) => (
                  <div key={item.id} className={`comms-message ${item.createdById === user?.id ? 'is-mine' : 'is-theirs'}`}>
                    <span className="comms-message-meta">
                      <strong>{item.createdById === user?.id ? 'You' : item.createdByName || 'Team'}</strong>
                      {item.recipientName && !directRecipientId ? <span>to {item.recipientName}</span> : null}
                    </span>
                    <span className="comms-message-body">{item.body}</span>
                    <small>{formatDateTime(item.createdAt)}{item.editedAt ? ' · edited' : ''}</small>
                    {(canManage || item.createdById === user?.id) ? (
                      <span className="comms-message-actions">
                        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteMessage(item)}>Delete</Button>
                        <ActionFeedback
                          message={messageTarget === `chat:${item.id}:delete` ? message : null}
                          tone={message?.includes('Could') ? 'error' : 'success'}
                        />
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="staff-mobile-chat-form">
              <Input label="Message" value={chatText} onChange={(event) => setChatText(event.currentTarget.value)} placeholder={messagePlaceholder} />
              <Button type="button" disabled={saving || !chatText.trim() || (!selectedChannel && !directRecipientId)} onClick={() => void sendMessage()}>
                Send
              </Button>
              <ActionFeedback
                message={messageTarget === 'chat-send' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
            </div>
          </div>
        </div>
      </Card>

      {canManage ? (
        <Card title="Chatting permissions" subtitle="Grant direct messaging, moderation, announcements, and admin communications from one place.">
          <div className="staff-list">
            {staff.map((member) => {
              const permissions = permissionsForMember(member);
              return (
                <div key={member.id} className="staff-expiry-row">
                  <span>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <span className="subtle">{member.roleTitle} · {member.venue || 'No venue'}</span>
                  </span>
                  <span className="communication-permission-grid">
                    {COMMUNICATION_PERMISSION_KEYS.map((permission) => (
                      <label key={permission.key} className="check-row">
                        <input
                          type="checkbox"
                          checked={Boolean(permissions[permission.key] || permissions.admin)}
                          disabled={saving || Boolean(permissions.admin && permission.key !== 'communicationsManage')}
                          onChange={(event) => void setChatPermission(member, permission.key, event.currentTarget.checked)}
                        />
                        {permission.label}
                      </label>
                    ))}
                    <ActionFeedback
                      message={messageTarget === `chat-permission:${member.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

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
  const rosterAreaSource = useMemo(
    () => staff.flatMap((member) => (member.rosterShifts ?? []).map((shift) => shift.area || 'Shift')),
    [staff]
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
    if (!user?.isAdmin) {
      setMessage('Only admin users can add roster areas.');
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
    if (!user?.isAdmin) {
      setMessageTarget(target);
      setMessage('Only admin users can update roster areas.');
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
    if (!user?.isAdmin) {
      setMessageTarget(target);
      setMessage('Only admin users can reorder roster areas.');
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
    if (!user?.isAdmin) {
      setMessageTarget(target);
      setMessage('Only admin users can delete roster areas.');
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
            <Button type="button" variant="secondary" disabled={!user?.isAdmin} onClick={addAdminRosterArea}>
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
                    <Button type="button" size="sm" variant="ghost" disabled={!user?.isAdmin || index === 0} onClick={() => moveAdminRosterArea(areaName, -1)}>
                      Up
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={!user?.isAdmin || index === adminRosterAreas.length - 1} onClick={() => moveAdminRosterArea(areaName, 1)}>
                      Down
                    </Button>
                    <Button type="button" size="sm" variant="secondary" disabled={!user?.isAdmin} onClick={() => toggleAdminRosterAreaHidden(areaName)}>
                      {isHidden ? 'Show' : 'Hide'}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={!user?.isAdmin} onClick={() => deleteAdminRosterArea(areaName)}>
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
                  navigate('/access');
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
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
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
    setMessageTarget('module');
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
    setMessageTarget('pay-rule');
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
    setMessageTarget('assign');
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
    setMessageTarget(`record:${record.id}:${status}`);
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
              <ActionFeedback
                message={messageTarget === 'module' ? message : null}
                tone={message?.includes('Could') || message?.includes('required') ? 'error' : 'success'}
              />
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
              <ActionFeedback
                message={messageTarget === 'pay-rule' ? message : null}
                tone={message?.includes('Could') || message?.includes('needs') ? 'error' : 'success'}
              />
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
            <ActionFeedback
              message={messageTarget === 'assign' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
        </div>
        {message && !messageTarget ? <p className={message.includes('Could') || message.includes('required') ? 'error-text' : 'subtle'}>{message}</p> : null}
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
                    <ActionFeedback
                      message={messageTarget === `record:${record.id}:IN_PROGRESS` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                    <Button type="button" size="sm" disabled={saving} onClick={() => void updateTrainingRecord(record, 'COMPLETED')}>
                      Complete
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `record:${record.id}:COMPLETED` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
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

type LeaveDraft = {
  staffProfileId: string;
  type: StaffLeaveType;
  status: StaffLeaveStatus;
  startDate: string;
  endDate: string;
  notes: string;
  managerNote: string;
};

function leaveDraftFor(staff: StaffProfile[]): LeaveDraft {
  const today = toDateInput(new Date());
  return {
    staffProfileId: staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id ?? '',
    type: 'ANNUAL',
    status: 'APPROVED',
    startDate: today,
    endDate: today,
    notes: '',
    managerNote: ''
  };
}

function leaveStatusTone(status: StaffLeaveStatus): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'APPROVED') return 'positive';
  if (status === 'PENDING') return 'warning';
  if (status === 'DECLINED') return 'danger';
  return 'muted';
}

function leaveTypeLabel(value: StaffLeaveType) {
  return LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function leaveStatusLabel(value: StaffLeaveStatus) {
  return LEAVE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function leaveOverlapsDay(leave: StaffLeaveRequest, day: Date) {
  const start = new Date(leave.startDate);
  const end = new Date(leave.endDate);
  const target = new Date(day);
  target.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return target >= start && target <= end;
}

function LeaveCalendarPage({ staff }: { staff: StaffProfile[] }) {
  const { user } = useAuth();
  const [monthStart, setMonthStart] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [leave, setLeave] = useState<StaffLeaveRequest[]>([]);
  const [draft, setDraft] = useState<LeaveDraft>(() => leaveDraftFor(staff));
  const [venueFilter, setVenueFilter] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);

  const activeStaff = staff.filter((member) => member.employmentStatus !== 'ARCHIVED');
  const venueOptions = [
    { label: 'All permitted venues', value: '' },
    ...uniqueValues(activeStaff.map((member) => member.venue).filter(Boolean) as string[]).map((venue) => ({ label: venue, value: venue }))
  ];
  const staffOptions = [
    { label: 'All staff', value: '' },
    ...activeStaff.map((member) => ({
      label: `${member.firstName} ${member.lastName}`,
      value: member.id
    }))
  ];
  const recordStaffOptions = [
    { label: 'Choose staff', value: '' },
    ...activeStaff.map((member) => ({
      label: `${member.firstName} ${member.lastName} · ${member.venue || 'No venue'}`,
      value: member.id
    }))
  ];
  const calendarStart = useMemo(() => startOfWeek(monthStart), [monthStart]);
  const calendarDays = useMemo(() => weekDays(calendarStart, 42), [calendarStart]);
  const calendarEnd = useMemo(() => addDays(calendarStart, 42), [calendarStart]);
  const approvedCount = leave.filter((item) => item.status === 'APPROVED').length;
  const pendingCount = leave.filter((item) => item.status === 'PENDING').length;

  const loadLeave = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        start: toDateInput(calendarStart),
        end: toDateInput(calendarEnd)
      });
      if (venueFilter) params.set('venue', venueFilter);
      if (staffFilter) params.set('staffProfileId', staffFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('type', typeFilter);
      setLeave(await api<StaffLeaveRequest[]>(`/api/staff/leave?${params.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load leave calendar.');
    } finally {
      setLoading(false);
    }
  }, [calendarEnd, calendarStart, staffFilter, statusFilter, typeFilter, venueFilter]);

  useEffect(() => {
    void loadLeave();
  }, [loadLeave]);

  useEffect(() => {
    if (!draft.staffProfileId && activeStaff[0]) {
      setDraft((current) => ({ ...current, staffProfileId: activeStaff[0].id }));
    }
  }, [activeStaff, draft.staffProfileId]);

  function updateDraft<K extends keyof LeaveDraft>(key: K, value: LeaveDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function saveLeave() {
    setMessageTarget('leave-save');
    if (!draft.staffProfileId) {
      setMessage('Choose a staff member before recording leave.');
      return;
    }
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) {
      setMessage('Use a valid date range for leave.');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      await api<StaffLeaveRequest>('/api/staff/leave', {
        method: 'POST',
        body: JSON.stringify(draft)
      });
      setDraft(leaveDraftFor(activeStaff));
      setMessage('Leave recorded.');
      await loadLeave();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record leave.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(item: StaffLeaveRequest, status: StaffLeaveStatus) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`leave:${item.id}:${status}`);
    try {
      await api<StaffLeaveRequest>(`/api/staff/leave/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      setMessage(`Leave ${status.toLowerCase()}.`);
      await loadLeave();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update leave.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack leave-page">
      <PageHeader
        eyebrow="Leave calendar"
        title="Staff leave"
        description="Record, approve and review pending or approved staff leave across your permitted venues."
      />

      <div className="stats-grid">
        <StatCard label="Leave records" value={leave.length} hint="Visible range" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Roster-impacting" loading={loading} />
        <StatCard label="Pending" value={pendingCount} hint="Needs review" loading={loading} />
        <StatCard label="Staff in scope" value={activeStaff.length} hint={user?.venue || 'Permitted venues'} loading={loading} />
      </div>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <div className="tips-entry-grid">
        <Card title="Record leave" subtitle="Managers can record leave for staff in their permitted venue.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveLeave();
            }}
          >
            <Select label="Staff member" value={draft.staffProfileId} onChange={(event) => updateDraft('staffProfileId', event.currentTarget.value)} options={recordStaffOptions} />
            <div className="form-grid two">
              <Select label="Leave type" value={draft.type} onChange={(event) => updateDraft('type', event.currentTarget.value as StaffLeaveType)} options={LEAVE_TYPE_OPTIONS} />
              <Select label="Status" value={draft.status} onChange={(event) => updateDraft('status', event.currentTarget.value as StaffLeaveStatus)} options={LEAVE_STATUS_OPTIONS} />
              <Input label="Start date" type="date" value={draft.startDate} onChange={(event) => updateDraft('startDate', event.currentTarget.value)} />
              <Input label="End date" type="date" value={draft.endDate} onChange={(event) => updateDraft('endDate', event.currentTarget.value)} />
            </div>
            <Textarea label="Staff note" rows={2} value={draft.notes} onChange={(event) => updateDraft('notes', event.currentTarget.value)} />
            <Textarea label="Manager note" rows={2} value={draft.managerNote} onChange={(event) => updateDraft('managerNote', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving || !draft.staffProfileId}>{saving ? 'Saving…' : 'Record leave'}</Button>
              <ActionFeedback
                message={messageTarget === 'leave-save' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('valid') ? 'error' : 'success'}
              />
            </div>
          </form>
        </Card>

        <Card title="Filters" subtitle="Narrow the calendar and mobile list without changing the saved records.">
          <div className="staff-profile-form">
            <Select label="Venue" value={venueFilter} onChange={(event) => setVenueFilter(event.currentTarget.value)} options={venueOptions} />
            <Select label="Staff member" value={staffFilter} onChange={(event) => setStaffFilter(event.currentTarget.value)} options={staffOptions} />
            <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} options={[{ label: 'All statuses', value: '' }, ...LEAVE_STATUS_OPTIONS]} />
            <Select label="Leave type" value={typeFilter} onChange={(event) => setTypeFilter(event.currentTarget.value)} options={[{ label: 'All leave types', value: '' }, ...LEAVE_TYPE_OPTIONS]} />
            <Button type="button" variant="secondary" disabled={loading} onClick={() => void loadLeave()}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </Card>
      </div>

      <Card title="Month view" subtitle="Approved and pending leave are visible at a glance.">
        <div className="roster-week-controls">
          <Button type="button" variant="secondary" size="sm" onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))}>
            Previous
          </Button>
          <strong>{monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
          <Button type="button" variant="secondary" size="sm" onClick={() => setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))}>
            Next
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setMonthStart(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>
            Today
          </Button>
        </div>
        <div className="leave-calendar-grid" role="grid" aria-label="Staff leave calendar">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
            <strong key={day} className="leave-calendar-heading">{day}</strong>
          ))}
          {calendarDays.map((day) => {
            const dayLeave = leave.filter((item) => leaveOverlapsDay(item, day));
            const outsideMonth = day.getMonth() !== monthStart.getMonth();
            return (
              <div key={toDateInput(day)} className={`leave-calendar-day${outsideMonth ? ' is-muted' : ''}`}>
                <span className="leave-calendar-date">{day.getDate()}</span>
                {dayLeave.slice(0, 3).map((item) => (
                  <span key={item.id} className={`leave-pill is-${item.status.toLowerCase()}`}>
                    {item.staffProfile?.firstName ?? 'Staff'} · {leaveStatusLabel(item.status)}
                  </span>
                ))}
                {dayLeave.length > 3 ? <small className="subtle">+{dayLeave.length - 3} more</small> : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Leave list" subtitle="Mobile-friendly list with review actions.">
        <div className="staff-expiry-list">
          {loading ? <Spinner label="Loading leave…" /> : null}
          {!loading && leave.length === 0 ? (
            <EmptyState title="No leave in this range" description="Record leave when a staff member is away, or adjust the filters." />
          ) : null}
          {leave.map((item) => (
            <div key={item.id} className="staff-expiry-row">
              <span>
                <strong>{item.staffProfile ? `${item.staffProfile.firstName} ${item.staffProfile.lastName}` : 'Staff member'}</strong>
                <span className="subtle">
                  {leaveTypeLabel(item.type)} · {formatRange(new Date(item.startDate), new Date(item.endDate))} · {item.staffProfile?.venue || 'No venue'}
                </span>
                {item.notes ? <span>{item.notes}</span> : null}
                {item.managerNote ? <span className="subtle">Manager note: {item.managerNote}</span> : null}
              </span>
              <span className="invite-row-actions">
                <Badge tone={leaveStatusTone(item.status)}>{leaveStatusLabel(item.status)}</Badge>
                {item.status === 'PENDING' ? (
                  <>
                    <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void changeStatus(item, 'APPROVED')}>
                      Approve
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void changeStatus(item, 'DECLINED')}>
                      Decline
                    </Button>
                  </>
                ) : null}
                {item.status !== 'CANCELLED' ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void changeStatus(item, 'CANCELLED')}>
                    Cancel
                  </Button>
                ) : null}
                <ActionFeedback
                  message={messageTarget?.startsWith(`leave:${item.id}:`) ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
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
  const [sidePanelMode, setSidePanelMode] = useState<RosterSidePanelMode>('staff');
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [forecastDraft] = useState(loadRosterForecastDraft);
  const [forecastSales, setForecastSales] = useState(forecastDraft.forecastSales);
  const [dailyForecastSales, setDailyForecastSales] = useState<Record<string, string>>(forecastDraft.dailyForecastSales);
  const [targetWagePercent, setTargetWagePercent] = useState(forecastDraft.targetWagePercent);
  const [closedDaysByScope] = useState(loadRosterClosedDays);
  const [rosterAreaSettings] = useState(loadRosterAreaSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const days = useMemo(() => weekDays(weekStart, boardDays), [boardDays, weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, boardDays), [boardDays, weekStart]);
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
  const rosterClosedVenueScope = venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both');
  const isVenueClosedOnDate = useCallback((venue: string | null | undefined, day: Date) => {
    const selectedVenue = normaliseRosterAreaName(venue ?? '');
    const scopedVenue =
      selectedVenue && selectedVenue !== 'all' && selectedVenue !== 'Both'
        ? selectedVenue
        : venueFilter !== 'all' && venueFilter !== 'Both'
          ? venueFilter
          : '';
    if (!scopedVenue) return false;
    const scopeKey = rosterClosedDaysScopeKey(weekStart, boardDays, scopedVenue);
    return (closedDaysByScope[scopeKey] ?? []).includes(toDateInput(day));
  }, [boardDays, closedDaysByScope, venueFilter, weekStart]);
  const closedVenuesForDay = useCallback(
    (day: Date) => rosterClosedVenueScope.filter((venue) => isVenueClosedOnDate(venue, day)),
    [isVenueClosedOnDate, rosterClosedVenueScope]
  );
  const isDayClosedForCurrentView = useCallback(
    (day: Date) => rosterClosedVenueScope.length > 0 && rosterClosedVenueScope.every((venue) => isVenueClosedOnDate(venue, day)),
    [isVenueClosedOnDate, rosterClosedVenueScope]
  );
  const closedDayCount = days.reduce((sum, day) => sum + closedVenuesForDay(day).length, 0);
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
  const allRosterAreas = useMemo(
    () => mergeRosterAreas(rosterAreaSettings, visibleRoster.map((shift) => shift.area || 'Shift')),
    [rosterAreaSettings, visibleRoster]
  );
  const hiddenAreaNames = useMemo(() => new Set(rosterAreaSettings.hidden.map(normaliseRosterAreaKey)), [rosterAreaSettings.hidden]);
  const activeAreas = allRosterAreas.filter((areaName) => !hiddenAreaNames.has(normaliseRosterAreaKey(areaName)));
  const areaSelectOptions = uniqueValues([...allRosterAreas, area || 'Floor']).map((item) => ({ label: item, value: item }));
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
  const scheduleRows: RosterScheduleRow[] =
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
        )
          .reduce<RosterScheduleRow[]>((rows, row, index, sourceRows) => {
            const previous = sourceRows[index - 1];
            if (!previous || previous.venue !== row.venue) {
              rows.push({
                id: `venue-header:${row.venue}`,
                label: row.venue,
                sublabel: 'Venue section',
                initials: row.venue.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
                shifts: visibleRoster.filter((shift) => shift.venue === row.venue || shift.staffProfile?.venue === row.venue),
                member: null,
                venue: row.venue,
                area: '',
                isVenueHeader: true
              });
            }
            rows.push(row);
            return rows;
          }, []);
  const activeSidePanelMode: RosterSidePanelMode =
    sidePanelMode === 'shift' && !editorOpen ? 'staff' : sidePanelMode;
  const sidePanelStaff = activeStaff
    .filter((member) => venueFilter === 'all' || member.venue === venueFilter)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
  const scheduleGridStyle = useMemo<CSSProperties>(() => {
    const sideRailOpen = !sidePanelCollapsed;
    const labelColumn = sideRailOpen ? 'minmax(136px, 0.78fr)' : 'minmax(150px, 0.72fr)';
    const openColumn =
      boardDays === 14
        ? sideRailOpen
          ? 'minmax(82px, 1fr)'
          : 'minmax(96px, 1fr)'
        : sideRailOpen
          ? 'minmax(112px, 1fr)'
          : 'minmax(132px, 1fr)';
    const closedColumn = boardDays === 14 ? 'minmax(38px, 0.18fr)' : 'minmax(46px, 0.22fr)';
    return {
      gridTemplateColumns: [
        labelColumn,
        ...days.map((day) => (isDayClosedForCurrentView(day) ? closedColumn : openColumn))
      ].join(' ')
    };
  }, [boardDays, days, isDayClosedForCurrentView, sidePanelCollapsed]);

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

  useEffect(() => {
    if (!publishPreviewOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPublishPreviewOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [publishPreviewOpen]);

  function setRosterWeek(nextWeekStart: Date) {
    setWeekStart(nextWeekStart);
    const selectedDate = new Date(`${date}T00:00:00`);
    if (!isDateInRange(selectedDate, nextWeekStart, addDays(nextWeekStart, boardDays))) {
      setDate(toDateInput(nextWeekStart));
    }
  }

  function openShiftPanel() {
    setEditorOpen(true);
    setSidePanelCollapsed(false);
    setSidePanelMode('shift');
  }

  function closeShiftPanel() {
    setEditingShift(null);
    setEditorOpen(false);
    setSidePanelMode('staff');
  }

  function newShift() {
    setEditingShift(null);
    openShiftPanel();
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
    setMessageTarget('forecast');
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


  useEffect(() => {
    if (!editingShift) {
      const member = staff.find((item) => item.id === staffProfileId);
      if (member?.roleTitle && !roleTitle) setRoleTitle(member.roleTitle);
      if (member?.venue && !shiftVenue) setShiftVenue(member.venue);
    }
  }, [editingShift, roleTitle, shiftVenue, staff, staffProfileId]);

  async function saveShift() {
    setMessageTarget('shift-save');
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
      closeShiftPanel();
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
    openShiftPanel();
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
    setMessageTarget(null);
  }

  async function deleteShift(shift: RosterShift) {
    setShiftContextMenu(null);
    if (!window.confirm('Delete this roster shift? This cannot be undone.')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('shift-delete');
    try {
      await api(`/api/staff/roster/${shift.id}`, { method: 'DELETE' });
      await reload(weekStart, weekEnd);
      if (editingShift?.id === shift.id) {
        closeShiftPanel();
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
    setMessageTarget('publish');
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
    setMessageTarget('shift-copy');
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
    setMessageTarget('copy-week');
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

  function scheduleRowVenue(row: (typeof scheduleRows)[number]) {
    if ('isVenueHeader' in row && row.isVenueHeader) return row.venue;
    return row.venue || row.member?.venue || (venueFilter !== 'all' ? venueFilter : '');
  }

  function prefillCell(row: (typeof scheduleRows)[number], day: Date) {
    if ('isVenueHeader' in row && row.isVenueHeader) {
      setMessage('Choose an area row under this venue before adding a shift.');
      return;
    }
    const targetVenue = scheduleRowVenue(row);
    if (isVenueClosedOnDate(targetVenue, day)) {
      setMessage(`${targetVenue || 'This venue'} is marked closed. Re-open that venue day before adding shifts.`);
      return;
    }
    setEditingShift(null);
    openShiftPanel();
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
    openShiftPanel();
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
    const targetMember =
      viewMode === 'team' && row.member
        ? row.member
        : staff.find((member) => member.id === shift.staffProfileId);
    const targetArea = viewMode === 'area' ? row.area || row.label : shift.area ?? area;
    const targetVenue = viewMode === 'area' ? row.venue : targetMember?.venue ?? shift.venue ?? '';
    if (isVenueClosedOnDate(targetVenue, day)) {
      setMessage(`${targetVenue || 'This venue'} is marked closed. Re-open that venue day before moving shifts here.`);
      setDraggingShiftId(null);
      return;
    }
    const startsAt = moveDateKeepingTime(shift.startsAt, day);
    const endsAt = moveDateKeepingTime(shift.endsAt, day);
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
          <ActionFeedback
            message={messageTarget === 'copy-week' ? message : null}
            tone={message?.includes('Could') ? 'error' : 'success'}
          />
          <Button type="button" variant="secondary" size="sm" disabled={draftCount === 0} onClick={() => setPublishPreviewOpen(true)}>
            Review drafts
          </Button>
          <Button type="button" size="sm" disabled={saving || draftCount === 0} onClick={() => setPublishPreviewOpen(true)}>
            Publish shifts
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
        {message && !messageTarget ? <span className="deputy-roster-message">{message}</span> : null}
      </div>

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

      <div className={`deputy-roster-layout ${sidePanelCollapsed ? 'is-side-collapsed' : 'is-side-open'}`}>
        <section className="deputy-schedule-panel" aria-label="Weekly roster grid">
          <div className={`deputy-schedule-grid roster-days-${boardDays}`} style={scheduleGridStyle}>
            <div className="deputy-schedule-corner">
              <span>{viewMode === 'team' ? 'Team member' : 'Area'}</span>
            </div>
            {days.map((day) => {
              const shifts = visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), day));
              const hours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
              const closedVenues = closedVenuesForDay(day);
              const isClosed = isDayClosedForCurrentView(day);
              return (
                <div key={day.toISOString()} className={`deputy-day-head ${sameDay(day, new Date()) ? 'is-today' : ''} ${isClosed ? 'is-closed' : ''}`}>
                  <strong>{day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
                  <span>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  <small>
                    {isClosed
                      ? 'Closed'
                      : closedVenues.length
                        ? `${closedVenues.length} venue closed`
                        : roundHours(hours)}
                  </small>
                </div>
              );
            })}

            {scheduleRows.length === 0 ? (
              <div className="deputy-schedule-empty">No rows match the current filters.</div>
            ) : (
              scheduleRows.map((row) => {
                const rowHours = row.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                if ('isVenueHeader' in row && row.isVenueHeader) {
                  return (
                    <div className="deputy-schedule-row deputy-venue-row" key={row.id}>
                      <div className="deputy-row-label deputy-venue-label">
                        <span className="roster-avatar">{row.initials}</span>
                        <span>
                          <strong>{row.label}</strong>
                          <small>{roundHours(rowHours)} · {row.shifts.length} shifts</small>
                        </span>
                      </div>
                      {days.map((day) => {
                        const dayShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                        const dayHours = dayShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                        const isClosed = isVenueClosedOnDate(row.venue, day);
                        return (
                          <div key={`${row.id}-${day.toISOString()}`} className={`deputy-schedule-cell deputy-venue-cell ${isClosed ? 'is-closed' : ''}`}>
                            <strong>{isClosed ? 'Closed' : dayShifts.length}</strong>
                            <small>{isClosed && dayShifts.length ? `${dayShifts.length} shifts` : roundHours(dayHours)}</small>
                          </div>
                        );
                      })}
                    </div>
                  );
                }
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
                      const isClosed = isVenueClosedOnDate(scheduleRowVenue(row), day);
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

        <aside className={`roster-right-rail ${sidePanelCollapsed ? 'is-collapsed' : ''}`}>
          {sidePanelCollapsed ? (
            <div className="roster-right-rail-collapsed">
              <button
                type="button"
                onClick={() => {
                  setSidePanelCollapsed(false);
                  setSidePanelMode('staff');
                }}
              >
                Staff
              </button>
              <button
                type="button"
                onClick={() => {
                  setSidePanelCollapsed(false);
                  setSidePanelMode('history');
                }}
              >
                History
              </button>
            </div>
          ) : (
            <>
              <div className="roster-right-rail-head">
                <div className={`deputy-view-toggle roster-side-toggle ${editorOpen ? 'has-three' : ''}`} aria-label="Roster side panel">
                  <button type="button" className={activeSidePanelMode === 'staff' ? 'is-active' : ''} onClick={() => setSidePanelMode('staff')}>
                    Staff
                  </button>
                  <button type="button" className={activeSidePanelMode === 'history' ? 'is-active' : ''} onClick={() => setSidePanelMode('history')}>
                    History
                  </button>
                  {editorOpen ? (
                    <button type="button" className={activeSidePanelMode === 'shift' ? 'is-active' : ''} onClick={() => setSidePanelMode('shift')}>
                      Shift
                    </button>
                  ) : null}
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSidePanelCollapsed(true)}>
                  Collapse
                </Button>
              </div>

              {activeSidePanelMode === 'shift' && editorOpen ? (
                <Card
                  className="roster-side-card"
                  title={editingShift ? 'Edit shift' : 'Add shift'}
                  subtitle={editingShift ? 'Selected shift details' : 'Click a grid cell to prefill the day and row'}
                  action={
                    <Button type="button" size="sm" variant="ghost" onClick={closeShiftPanel}>
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
                        options={areaSelectOptions}
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
                          <ActionFeedback
                            message={messageTarget === 'shift-copy' ? message : null}
                            tone={message?.includes('Could') ? 'error' : 'success'}
                          />
                          <Button type="button" variant="ghost" disabled={saving} onClick={() => void deleteShift(editingShift)}>
                            Delete
                          </Button>
                          <ActionFeedback
                            message={messageTarget === 'shift-delete' ? message : null}
                            tone={message?.includes('Could') ? 'error' : 'success'}
                          />
                        </>
                      ) : null}
                      <Button type="button" disabled={saving || !canSaveShift} onClick={() => void saveShift()}>
                        {saving ? 'Saving…' : editingShift ? 'Save shift' : 'Add shift'}
                      </Button>
                      <ActionFeedback
                        message={messageTarget === 'shift-save' ? message : null}
                        tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Check') ? 'error' : 'success'}
                      />
                    </div>
                  </div>
                </Card>
              ) : activeSidePanelMode === 'history' ? (
                <Card
                  className="roster-side-card roster-history-panel"
                  title="Historical data"
                  subtitle="Forecast inputs, wage budget and suggested roster gaps."
                >
                  <div className="roster-history-actions">
                    <Button type="button" size="sm" variant="secondary" onClick={applyHistoricalForecast}>
                      Use historical
                    </Button>
                    <ActionFeedback
                      message={messageTarget === 'forecast' ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </div>
                  <Input
                    label="Weekly sales override"
                    value={forecastSales}
                    onChange={(event) => setForecastSales(event.currentTarget.value)}
                    placeholder="$85,000"
                  />
                  <Input
                    label="Target wage %"
                    value={targetWagePercent}
                    onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
                    placeholder="28"
                  />
                  <p className="subtle roster-forecast-source">
                    Baseline from previous years: {formatCents(historicalForecastSalesCents)} across {forecastVenues.length || 1} venue{forecastVenues.length === 1 ? '' : 's'}.
                  </p>
                  <div className="roster-forecast-metrics roster-forecast-metrics-compact">
                    <div>
                      <span>Forecast sales</span>
                      <strong>{formatCents(forecastSalesCents)}</strong>
                    </div>
                    <div>
                      <span>Wage budget</span>
                      <strong>{formatCents(wageBudgetCents)}</strong>
                    </div>
                    <div>
                      <span>Roster cost</span>
                      <strong>{formatCents(rosterCostCents)}</strong>
                    </div>
                    <div>
                      <span>Guidance</span>
                      <strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}` : roundHours(forecastHoursGap)}</strong>
                    </div>
                  </div>
                  <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
                    <strong>{forecastCostGapCents >= 0 ? 'Inside wage guide' : 'Over wage guide'}</strong>
                    <span>
                      {forecastCostGapCents >= 0
                        ? `${formatCents(forecastCostGapCents)} remaining against forecast.`
                        : `${formatCents(Math.abs(forecastCostGapCents))} over the current wage guide.`}
                    </span>
                  </div>
                  <div className="roster-history-day-list">
                    {dailySummaries.map((summary) => (
                      <label
                        key={summary.day.toISOString()}
                        className={summary.forecastCents > 0 && summary.plannedCostCents > summary.budgetCents ? 'is-over' : summary.forecastCents > 0 ? 'is-under' : ''}
                      >
                        <span>{summary.day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
                        <input
                          value={dailyForecastSales[toDateInput(summary.day)] ?? ''}
                          onChange={(event) => updateDailyForecast(summary.day, event.currentTarget.value)}
                          placeholder={String(Math.round((historicalDailyForecast[toDateInput(summary.day)] ?? 0) / 100))}
                        />
                        <small>{roundHours(summary.hours)} · {summary.wagePercent ? `${summary.wagePercent.toFixed(1)}%` : 'No sales'}</small>
                      </label>
                    ))}
                  </div>
                  {venueForecastRows.length ? (
                    <div className="roster-venue-forecast roster-venue-forecast-compact">
                      {venueForecastRows.map((row) => (
                        <div key={row.venue}>
                          <span>
                            <strong>{row.venue}</strong>
                            <small>{row.source ? `Historical source: ${row.source}` : 'No historical source'}</small>
                          </span>
                          <span>
                            <strong>{roundHours(row.plannedHours)}</strong>
                            <small>planned</small>
                          </span>
                          <span>
                            <strong>{row.hoursGap >= 0 ? `+${roundHours(row.hoursGap)}` : roundHours(row.hoursGap)}</strong>
                            <small>gap</small>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {missingRateStaff.length ? (
                    <div className="roster-publish-guardrails">
                      <strong>Pay rates missing</strong>
                      <span>{missingRateStaff.map((member) => `${member.firstName} ${member.lastName}`).join(', ')}</span>
                    </div>
                  ) : null}
                  {areaGuidanceRows.length ? (
                    <div className="roster-area-guidance roster-area-guidance-compact">
                      <strong>Area guidance</strong>
                      {areaGuidanceRows.map((row) => (
                        <div key={`${row.venue}:${row.area}`}>
                          <span>
                            <strong>{row.area}</strong>
                            <small>{row.venue} · {row.gap >= 0 ? `add ${roundHours(row.gap)}` : `review ${roundHours(Math.abs(row.gap))}`}</small>
                          </span>
                          <small>{row.day.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                          <Button type="button" size="sm" variant="secondary" onClick={() => applyRosterRecommendation(row)}>
                            Apply
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>
              ) : (
                <Card
                  className="roster-side-card"
                  title="Staff list"
                  subtitle={`${sidePanelStaff.length} active ${venueFilter === 'all' ? 'across all venues' : `for ${venueFilter}`}`}
                >
                  <div className="roster-side-staff-list">
                    {sidePanelStaff.length ? sidePanelStaff.map((member) => {
                      const memberShifts = visibleRoster.filter((shift) => shift.staffProfileId === member.id);
                      const memberHours = memberShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                      const memberRate = member.trainingPayRateCents ?? member.payRateCents;
                      return (
                        <button
                          type="button"
                          key={member.id}
                          className={`roster-side-staff-row ${staffProfileId === member.id ? 'is-selected' : ''}`}
                          onClick={() => {
                            setStaffProfileId(member.id);
                            setShiftVenue(member.venue ?? '');
                            setRoleTitle(member.roleTitle ?? '');
                          }}
                        >
                          <span className="roster-avatar small">{initials(member)}</span>
                          <span>
                            <strong>{member.firstName} {member.lastName}</strong>
                            <small>{member.roleTitle || 'Team member'} · {member.venue || 'No venue'}</small>
                          </span>
                          <span className="roster-side-staff-meta">
                            <Badge tone={memberShifts.length ? 'info' : 'muted'}>{roundHours(memberHours)}</Badge>
                            <small>{memberRate ? `${formatCents(memberRate)}/h` : 'Rate missing'}</small>
                          </span>
                        </button>
                      );
                    }) : (
                      <EmptyState title="No staff match this venue" description="Switch venue filters to see the full team." />
                    )}
                  </div>
                </Card>
              )}
            </>
          )}
        </aside>
      </div>
      {publishPreviewOpen ? (
        <div
          className="roster-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPublishPreviewOpen(false);
          }}
        >
          <section
            className="roster-publish-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-publish-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="roster-publish-modal-header">
              <div>
                <p className="eyebrow">Publish shifts</p>
                <h2 id="roster-publish-title">Publish roster</h2>
                <p className="subtle">
                  Review draft shifts and guardrails before staff see this roster.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPublishPreviewOpen(false)}>
                Close
              </Button>
            </header>
            <div className="roster-publish-modal-summary">
              <div>
                <span>Draft shifts</span>
                <strong>{draftCount}</strong>
              </div>
              <div>
                <span>Roster cost</span>
                <strong>{formatCents(rosterCostCents)}</strong>
              </div>
              <div>
                <span>Wage guide</span>
                <strong>{formatCents(wageBudgetCents)}</strong>
              </div>
              <div>
                <span>Hours gap</span>
                <strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}` : roundHours(forecastHoursGap)}</strong>
              </div>
            </div>
            <div className="roster-publish-modal-body">
              <div>
                <div className="roster-modal-section-head">
                  <h3>Draft shifts</h3>
                  <span>{formatRange(weekStart, addDays(weekStart, boardDays - 1))}</span>
                </div>
                <div className="publish-preview-list">
                  {publishableDrafts.length ? publishableDrafts.map((shift) => (
                    <button
                      key={shift.id}
                      type="button"
                      className="publish-preview-row"
                      onClick={() => {
                        setPublishPreviewOpen(false);
                        startEditShift(shift);
                      }}
                    >
                      <span>
                        <strong>{new Date(shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</strong>
                        <small>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)} · {shift.area || shift.roleTitle || 'Shift'}</small>
                      </span>
                      <span>
                        <strong>{shift.staffProfile?.firstName ?? 'Unallocated'} {shift.staffProfile?.lastName ?? ''}</strong>
                        <small>{shift.venue || shift.staffProfile?.venue || 'No venue set'}</small>
                      </span>
                      <Badge tone={isUnallocatedProfile(shift.staffProfile) ? 'warning' : 'info'}>
                        {roundHours(shiftHours(shift))}
                      </Badge>
                    </button>
                  )) : (
                    <EmptyState title="No draft shifts" description="There is nothing ready to publish in this roster view." />
                  )}
                </div>
              </div>
              <div>
                <div className={`roster-publish-guardrails ${publishWarnings.length ? '' : 'is-clear'}`}>
                  <strong>{publishWarnings.length ? 'Check before publishing' : 'Ready to publish'}</strong>
                  {publishWarnings.length ? publishWarnings.map((warning) => (
                    <span key={warning}>{warning}</span>
                  )) : (
                    <span>No roster warnings for this view.</span>
                  )}
                </div>
                <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
                  <strong>{forecastCostGapCents >= 0 ? 'Inside forecast' : 'Over forecast'}</strong>
                  <span>
                    {forecastCostGapCents >= 0
                      ? `${formatCents(forecastCostGapCents)} wage budget remaining.`
                      : `${formatCents(Math.abs(forecastCostGapCents))} above the wage guide.`}
                  </span>
                </div>
                <div className="roster-publish-modal-actions">
                  <Button type="button" disabled={saving || draftCount === 0} onClick={() => void publishWeek()}>
                    {saving ? 'Publishing…' : 'Publish shifts'}
                  </Button>
                  <ActionFeedback
                    message={messageTarget === 'publish' ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
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

function rosterClosedDaysScopeKey(weekStart: Date, boardDays: number, venue: string) {
  return `${toDateInput(weekStart)}:${boardDays}:${normaliseRosterAreaName(venue)}`;
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

function normaliseRosterAreaName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normaliseRosterAreaKey(value: string) {
  return normaliseRosterAreaName(value).toLowerCase();
}

function loadRosterAreaSettings(): RosterAreaSettings {
  const fallback: RosterAreaSettings = {
    order: DEFAULT_ROSTER_AREAS,
    hidden: [],
    deleted: []
  };

  try {
    const raw = window.localStorage.getItem(ROSTER_AREA_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RosterAreaSettings>;
    return {
      order: Array.isArray(parsed.order) ? uniqueRosterAreaNames(parsed.order) : fallback.order,
      hidden: Array.isArray(parsed.hidden) ? uniqueRosterAreaNames(parsed.hidden) : fallback.hidden,
      deleted: Array.isArray(parsed.deleted) ? uniqueRosterAreaNames(parsed.deleted) : fallback.deleted
    };
  } catch {
    return fallback;
  }
}

function uniqueRosterAreaNames(values: unknown[]) {
  const seen = new Set<string>();
  return values.reduce<string[]>((areas, value) => {
    if (typeof value !== 'string') return areas;
    const name = normaliseRosterAreaName(value);
    const key = normaliseRosterAreaKey(name);
    if (!name || seen.has(key)) return areas;
    seen.add(key);
    areas.push(name);
    return areas;
  }, []);
}

function mergeRosterAreas(settings: RosterAreaSettings, rosterAreas: string[]) {
  const deleted = new Set(settings.deleted.map(normaliseRosterAreaKey));
  const ordered = uniqueRosterAreaNames(settings.order);
  const discovered = uniqueRosterAreaNames([...DEFAULT_ROSTER_AREAS, ...rosterAreas]);
  const merged = uniqueRosterAreaNames([...ordered, ...discovered]);
  return merged.filter((areaName) => !deleted.has(normaliseRosterAreaKey(areaName)));
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

function ApprovalRecordRow({
  member,
  record,
  saving,
  onApprove,
  onUpload,
  feedback
}: {
  member: StaffProfile;
  record: StaffComplianceRecord;
  saving: boolean;
  onApprove: (memberId: string, recordId: string) => void;
  onUpload: (memberId: string, record: StaffComplianceRecord, file: File) => void;
  feedback?: string | null;
}) {
  return (
    <div className="invite-row">
      <span>
        <strong>{record.title}</strong>
        <span className="subtle">
          {member.firstName} {member.lastName} · {member.venue || 'No venue'} · {record.documentName || 'Uploaded document'}
        </span>
        {record.documentUrl ? (
          <StaffDocumentViewLink documentUrl={record.documentUrl} />
        ) : (
          <span className="subtle">No document attached</span>
        )}
      </span>
      <span className="invite-row-actions">
        <Badge tone={record.status === 'APPROVED' ? 'positive' : 'warning'}>{record.status}</Badge>
        <label className="btn btn-secondary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>
          Upload document
          <input
            type="file"
            accept={STAFF_DOCUMENT_ACCEPT}
            disabled={saving}
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) onUpload(member.id, record, file);
            }}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={saving || record.status === 'APPROVED' || !record.documentUrl}
          onClick={() => onApprove(member.id, record.id)}
        >
          Approve document
        </Button>
        <ActionFeedback
          message={feedback}
          tone={feedback?.includes('Could') ? 'error' : 'success'}
        />
      </span>
    </div>
  );
}

function ApprovalsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const pendingProfiles = staff.filter((member) => member.employmentStatus === 'PENDING');
  const pendingRecords = staff.flatMap((member) =>
    member.records
      .filter((record) => record.status === 'PENDING')
      .map((record) => ({ member, record }))
  );

  async function approveRecord(memberId: string, recordId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${recordId}`);
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

  async function uploadRecordDocument(memberId: string, record: StaffComplianceRecord, file: File) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${record.id}:upload`);
    try {
      const upload = await readOnboardingUpload(file);
      await api(`/api/staff/${memberId}/records/${record.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          documentName: upload.name,
          documentUrl: upload.url,
          status: 'PENDING'
        })
      });
      await reload();
      setMessage('Document uploaded.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not upload document.');
    } finally {
      setSaving(false);
    }
  }

  async function approveProfile(memberId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`profile:${memberId}`);
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

      {message && !messageTarget ? <p className={message.includes('Could not') || message.includes('Missing') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <ActionPanel
        title="Pending onboarding profiles"
        description="Approve once details and required uploads have been checked."
        count={pendingProfiles.length}
        tone={pendingProfiles.length ? 'warning' : 'positive'}
        defaultOpen={pendingProfiles.length === 1}
        empty={<EmptyState title="No staff waiting for approval" description="Completed onboarding submissions will appear here." />}
      >
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
                    <ActionFeedback
                      message={messageTarget === `profile:${member.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </ActionPanel>

      <ActionPanel
        title="Document approval queue"
        description="Open each uploaded document, upload missing files if needed, then approve."
        count={pendingRecords.length}
        tone={pendingRecords.length ? 'warning' : 'positive'}
        defaultOpen={pendingRecords.length === 1}
        empty={<EmptyState title="No documents waiting" description="Pending uploaded documents will appear here." />}
      >
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
                onUpload={(memberId, approvalRecord, file) => void uploadRecordDocument(memberId, approvalRecord, file)}
                feedback={messageTarget === `record:${record.id}` || messageTarget === `record:${record.id}:upload` ? message : null}
              />
            ))}
          </div>
        )}
      </ActionPanel>
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
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
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
    setMessageTarget('cash');
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
    setMessageTarget('import');
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
    setMessageTarget('export');
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
    setMessageTarget('paid');
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
            <span className="inline-actions">
              <Button type="button" variant="secondary" onClick={() => void exportTips()} disabled={saving || !summary?.entitlements.length}>Export CSV</Button>
              <ActionFeedback
                message={messageTarget === 'export' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
              />
            </span>
            <span className="inline-actions">
              <Button type="button" onClick={() => void markPaid()} disabled={saving || !summary?.entitlements.length || payoutVarianceCents !== 0}>Mark paid</Button>
              <ActionFeedback
                message={messageTarget === 'paid' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('variance') ? 'error' : 'success'}
              />
            </span>
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
            <ActionFeedback
              message={messageTarget === 'cash' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
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
            <ActionFeedback
              message={messageTarget === 'import' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Paste') ? 'error' : 'success'}
            />
          </div>
        </Card>

        <Card title="Tips week" subtitle="Cash entries and paid runs for the selected week.">
          <div className="roster-week-controls" aria-label="Tips week controls">
            <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</Button>
            <strong>{formatRange(weekStart, addDays(weekEnd, -1))}</strong>
            <Button type="button" size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</Button>
          </div>
          {message && !messageTarget ? <p className={message.includes('Could') || message.includes('Choose') ? 'error-text' : 'subtle'}>{message}</p> : null}
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

function ManagerDashboardPage({ staff }: { staff: StaffProfile[] }) {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<StaffManagerDashboardPayload | null>(null);
  const [operations, setOperations] = useState<StaffManagerOperationsPayload | null>(null);
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

  useEffect(() => {
    void loadDashboard();
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
    ? new Date(updatedAtSource).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
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
  const mondayShiftCount = activeLaunchStaff
    .flatMap((member) => member.rosterShifts ?? [])
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

  return (
    <div className="page-stack manager-mobile-page">
      <PageHeader
        eyebrow="Manager"
        title="Today at a glance"
        description="Approve hours, check live sales and wages, and catch stock or compliance issues before service gets away."
        actions={<Button type="button" variant="secondary" disabled={loading} onClick={() => void loadDashboard()}>Refresh</Button>}
      />

      <Card className="manager-mobile-filter-card">
        <div className="manager-mobile-filters">
          <Input label="Day" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
          <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
        </div>
        <p className="subtle">{updatedAt ? `Last refreshed ${updatedAt}` : 'Pulls from live Alma Suite data.'}</p>
      </Card>

      {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}

      <Card
        title="Monday staff launch checklist"
        subtitle="Read-only checks for the Staff app launch. Use Profiles, Roster, Clock, and Compliance to clear anything highlighted before inviting the team."
      >
        <div className="staff-readiness-grid">
          {launchReadinessItems.map((item) => (
            <div key={item.label} className={`staff-readiness-item is-${item.tone}`}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
        <ActionPanel
          title="Launch checklist actions"
          description="Expand to open the workflow for each warning."
          count={launchActionItems.length}
          tone={launchActionItems.length ? 'warning' : 'positive'}
          empty={<p className="subtle">No launch checklist warnings need action.</p>}
          className="staff-readiness-actions"
        >
          {launchActionItems.map((item) => (
            <div key={item.label} className="action-panel-row">
              <span>
                <strong>{item.label}</strong>
                <small>{item.value} · {item.detail}</small>
              </span>
              {item.label.includes('email') || item.label.includes('venue') || item.label.includes('access') ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/access')}>Open profiles</Button>
              ) : item.label.includes('shifts') ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/roster')}>Check roster</Button>
              ) : item.label.includes('clock') ? (
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/clock')}>Test clock</Button>
              ) : (
                <Button type="button" size="sm" variant="secondary" onClick={() => navigate('/approvals')}>Open approvals</Button>
              )}
            </div>
          ))}
        </ActionPanel>
      </Card>

      <div className="manager-mobile-stats">
        <StatCard label="Sales today" value={formatCents(dashboard?.totals.salesCents ?? 0)} hint={dashboard?.salesByVenue.length ? `${dashboard.salesByVenue.length} venue signal${dashboard.salesByVenue.length === 1 ? '' : 's'}` : 'No sales imported yet'} loading={loading} />
        <StatCard label="Live wages" value={formatCents(dashboard?.totals.actualWageCents ?? 0)} hint={`${roundHours(dashboard?.totals.actualHours ?? 0)} actual hours`} loading={loading} />
        <StatCard label="Wage %" value={wagePercent === null || wagePercent === undefined ? 'No sales' : `${wagePercent.toFixed(1)}%`} hint={`Roster ${formatCents(dashboard?.totals.rosterWageCents ?? 0)}`} loading={loading} />
        <StatCard label="Approvals" value={dashboard?.totals.pendingTimesheets ?? 0} hint="Submitted timesheets" loading={loading} />
        <StatCard label="Bookings" value={operations?.metrics.bookingsToday ?? 0} hint={`${operations?.bookingsSummary?.upcomingBookings ?? 0} still ahead`} loading={loading} />
        <StatCard label="Covers" value={operations?.metrics.coversToday ?? 0} hint={`${operations?.bookingsSummary?.cancellationsToday ?? 0} cancelled today`} loading={loading} />
        <StatCard label="Clocked in" value={operations?.metrics.clockedIn ?? 0} hint={`${operations?.metrics.onBreak ?? 0} on break`} loading={loading} />
        <StatCard label="Late / missed" value={`${operations?.metrics.lateClockIns ?? 0}/${operations?.metrics.missedClockIns ?? 0}`} hint="Clock-in exceptions" loading={loading} />
        <StatCard label="Shift confirms" value={operations?.metrics.pendingConfirmations ?? 0} hint="Still awaiting acknowledgement" loading={loading} />
        <StatCard label="Ops exceptions" value={operations?.metrics.clockExceptions ?? 0} hint="Open sessions, overdue breaks, missed clock-ins" loading={loading} />
      </div>

      <div className="manager-mobile-alert-strip">
        <button type="button" onClick={() => navigate('/timesheets')}>
          <strong>{dashboard?.totals.pendingTimesheets ?? 0}</strong>
          <span>Timesheets</span>
        </button>
        <button type="button" onClick={() => window.location.assign(STOCK_WEB_URL || '/')}>
          <strong>{dashboard?.totals.lowStockItems ?? 0}</strong>
          <span>Low stock</span>
        </button>
        <button type="button" onClick={() => window.location.assign(COMPLIANCE_WEB_URL || '/')}>
          <strong>{dashboard?.totals.openIssues ?? 0}</strong>
          <span>Compliance</span>
        </button>
        <button type="button" onClick={() => window.location.assign(COMPLIANCE_WEB_URL || '/')}>
          <strong>{dashboard?.totals.criticalIssues ?? 0}</strong>
          <span>Critical</span>
        </button>
      </div>

      <div className="manager-mobile-alert-strip">
        <button type="button" onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.scheduledStaff ?? 0}</strong>
          <span>Today's staff</span>
        </button>
        <button type="button" onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.clockedIn ?? 0}</strong>
          <span>Clocked in</span>
        </button>
        <button type="button" onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.pendingConfirmations ?? 0}</strong>
          <span>Pending confirms</span>
        </button>
        <button type="button" onClick={() => navigate('/roster')}>
          <strong>{operations?.metrics.clockExceptions ?? 0}</strong>
          <span>Clock exceptions</span>
        </button>
        <button type="button" onClick={() => window.location.assign(RESERVE_WEB_URL || '/')}>
          <strong>{operations?.metrics.bookingsToday ?? 0}</strong>
          <span>Bookings</span>
        </button>
      </div>

      {loading && !dashboard ? <Spinner label="Loading manager dashboard..." /> : null}

      <div className="manager-mobile-grid">
        <Card
          title="Approve timesheets"
          subtitle="Submitted hours waiting for manager approval"
          action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/timesheets')}>All</Button>}
        >
          {dashboard && dashboard.pendingTimesheets.length === 0 ? (
            <EmptyState title="No timesheets waiting" description="Submitted hours will appear here for quick approval." />
          ) : null}
          <div className="manager-mobile-list">
            {dashboard?.pendingTimesheets.map((entry) => (
              <article key={entry.id} className="manager-mobile-row">
                <span>
                  <strong>{entry.staffProfile ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}` : 'Staff member'}</strong>
                  <span className="subtle">{new Date(entry.workDate).toLocaleDateString()} · {timeOf(entry.clockInAt)}-{timeOf(entry.clockOutAt)} · {roundHours(timesheetHours(entry))}</span>
                  <span className="subtle">{entry.venue ?? 'No venue'} · {entry.area ?? entry.roleTitle ?? 'Shift'} · {entry.paymentMethod}</span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Button type="button" size="sm" disabled={saving} onClick={() => void approveTimesheet(entry.id)}>Approve</Button>
                  <ActionFeedback
                    message={messageTarget === `approve:${entry.id}` ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                  <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void rejectTimesheet(entry.id)}>Reject</Button>
                  <ActionFeedback
                    message={messageTarget === `reject:${entry.id}` ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </span>
              </article>
            ))}
          </div>
        </Card>

        <Card
          title="Today's bookings"
          subtitle="Reserve demand signals for staffing decisions."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(RESERVE_WEB_URL || '/')}>Reserve</Button>}
        >
          {operations && (!operations.bookingsSummary || operations.bookingsSummary.nextReservations.length === 0) ? (
            <EmptyState title="No upcoming bookings today" description="Confirmed, pending, and seated reservations will appear here as service approaches." />
          ) : null}
          <div className="manager-mobile-report-list">
            <div className="manager-mobile-report-row">
              <span>
                <strong>{operations?.bookingsSummary?.bookingsToday ?? 0} bookings</strong>
                <small>{operations?.bookingsSummary?.coversToday ?? 0} covers expected today</small>
              </span>
              <span>
                <strong>{operations?.bookingsSummary?.upcomingBookings ?? 0} ahead</strong>
                <small>{operations?.bookingsSummary?.noShowsToday ?? 0} no-shows · {operations?.bookingsSummary?.cancellationsToday ?? 0} cancelled</small>
              </span>
            </div>
          </div>
          <div className="manager-mobile-list">
            {operations?.bookingsSummary?.nextReservations.map((reservation) => (
              <article key={reservation.id} className="manager-mobile-row">
                <span>
                  <strong>{reservation.guestName || 'Guest booking'}</strong>
                  <span className="subtle">{timeOf(reservation.startsAt)} · {reservation.covers} cover{reservation.covers === 1 ? '' : 's'}</span>
                  <span className="subtle">{reservation.venue || 'No venue'} · {reservation.status.replaceAll('_', ' ')}</span>
                </span>
                <Badge tone={reservation.status === 'CONFIRMED' || reservation.status === 'SEATED' ? 'positive' : reservation.status === 'PENDING' ? 'warning' : 'info'}>
                  {reservation.status.replaceAll('_', ' ')}
                </Badge>
              </article>
            ))}
          </div>
        </Card>

        <Card
          title="Today's staff"
          subtitle="Rostered staff, confirmations, and live clock state."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/roster')}>Roster</Button>}
        >
          {operations && operations.todaysStaff.length === 0 ? (
            <EmptyState title="Nothing scheduled today" description="Published shifts for this date will show up here." />
          ) : null}
          <div className="manager-mobile-list">
            {operations?.todaysStaff.map((row) => (
              <article key={row.shift.id} className="manager-mobile-row">
                <span>
                  <strong>{row.staffProfile ? `${row.staffProfile.firstName} ${row.staffProfile.lastName}` : 'Staff member'}</strong>
                  <span className="subtle">
                    {new Date(row.shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {timeOf(row.shift.startsAt)}-{timeOf(row.shift.endsAt)}
                  </span>
                  <span className="subtle">
                    {row.shift.venue || row.staffProfile?.venue || 'No venue'} · {row.shift.area || row.shift.roleTitle || row.staffProfile?.roleTitle || 'Shift'}
                  </span>
                  <span className="subtle">
                    {row.confirmation ? `Confirmed ${formatDateTime(row.confirmation.confirmedAt)}` : 'Awaiting shift confirmation'}
                    {row.activeSession ? ` · Clocked ${timeOf(row.activeSession.clockInAt)}` : ''}
                  </span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Badge tone={staffClockStateTone(row.state)}>{row.state.replaceAll('_', ' ')}</Badge>
                  <Badge tone={row.confirmation ? 'positive' : 'warning'}>
                    {row.confirmation ? 'Confirmed' : 'Pending'}
                  </Badge>
                </span>
              </article>
            ))}
          </div>
        </Card>

        <Card
          title="Clock exceptions"
          subtitle="Late clock-ins, missed shifts, overdue breaks, and open sessions."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/timesheets')}>Timesheets</Button>}
        >
          {operations && operations.clockExceptions.length === 0 ? (
            <EmptyState title="No clock exceptions" description="Late, missed, overdue break, and open-session exceptions will appear here." />
          ) : null}
          <div className="manager-mobile-list">
            {operations?.clockExceptions.map((exception) => (
              <article key={exception.id} className="manager-mobile-row">
                <span>
                  <strong>{exception.summary}</strong>
                  <span className="subtle">{exception.detail}</span>
                  <span className="subtle">
                    {exception.venue || exception.staffProfile?.venue || 'No venue'} · {exception.staffProfile ? `${exception.staffProfile.firstName} ${exception.staffProfile.lastName}` : 'Unassigned staff'}
                  </span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Badge tone={clockExceptionTone(exception.severity)}>{exception.kind.replaceAll('_', ' ')}</Badge>
                </span>
              </article>
            ))}
          </div>
        </Card>

        <Card
          title="Clocked in now"
          subtitle="Active sessions and current break state."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/roster')}>Roster</Button>}
        >
          {operations && operations.clockedIn.length === 0 ? (
            <EmptyState title="Nobody clocked in" description="Open clock sessions will appear here during service." />
          ) : null}
          <div className="manager-mobile-list">
            {operations?.clockedIn.map((session) => (
              <article key={session.id} className="manager-mobile-row">
                <span>
                  <strong>{session.rosterShift?.staffProfile ? `${session.rosterShift.staffProfile.firstName} ${session.rosterShift.staffProfile.lastName}` : 'Staff member'}</strong>
                  <span className="subtle">{timeOf(session.clockInAt)} · {session.venue || session.rosterShift?.venue || session.rosterShift?.staffProfile?.venue || 'No venue'}</span>
                  <span className="subtle">
                    {session.currentBreakStartedAt ? `On break since ${timeOf(session.currentBreakStartedAt)}` : 'Working'}
                    {` · ${session.area || session.roleTitle || session.rosterShift?.area || session.rosterShift?.roleTitle || 'Shift'}`}
                  </span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Badge tone={session.currentBreakStartedAt ? 'warning' : 'positive'}>
                    {session.currentBreakStartedAt ? 'On break' : 'Clocked in'}
                  </Badge>
                </span>
              </article>
            ))}
          </div>
        </Card>

        <Card
          title="Pending shift confirmations"
          subtitle="Upcoming published shifts still waiting for acknowledgement."
          action={<Button type="button" size="sm" variant="secondary" onClick={() => navigate('/roster')}>Roster</Button>}
        >
          {operations && operations.pendingConfirmations.length === 0 ? (
            <EmptyState title="No pending confirmations" description="Managers will see outstanding shift acknowledgements here." />
          ) : null}
          <div className="manager-mobile-list">
            {operations?.pendingConfirmations.map((entry) => (
              <article key={entry.shift.id} className="manager-mobile-row">
                <span>
                  <strong>{entry.staffProfile ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}` : 'Staff member'}</strong>
                  <span className="subtle">
                    {new Date(entry.shift.startsAt).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {timeOf(entry.shift.startsAt)}-{timeOf(entry.shift.endsAt)}
                  </span>
                  <span className="subtle">
                    {entry.shift.venue || entry.staffProfile?.venue || 'No venue'} · {entry.shift.area || entry.shift.roleTitle || entry.staffProfile?.roleTitle || 'Shift'}
                  </span>
                </span>
                <span className="manager-mobile-row-actions">
                  <Badge tone="warning">Pending</Badge>
                </span>
              </article>
            ))}
          </div>
        </Card>

        <Card title="Quick reporting" subtitle="Today only, from imported sales and current wage records">
          <div className="manager-mobile-report-list">
            {(dashboard?.salesByVenue.length ? dashboard.salesByVenue : [{ venue: venue || 'No sales imported', salesCents: 0 }]).map((row) => {
              const wages = dashboard?.wagesByVenue.find((item) => item.venue === row.venue);
              const percent = row.salesCents > 0 && wages ? (wages.actualWageCents / row.salesCents) * 100 : null;
              return (
                <div key={row.venue} className="manager-mobile-report-row">
                  <span>
                    <strong>{row.venue}</strong>
                    <small>{wages ? `${roundHours(wages.actualHours)} actual hours · ${roundHours(wages.rosterHours)} roster hours` : 'No wage records yet'}</small>
                  </span>
                  <span>
                    <strong>{formatCents(row.salesCents)}</strong>
                    <small>{percent === null ? 'No wage %' : `${percent.toFixed(1)}% wages`}</small>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          title="Low stock warnings"
          subtitle="Active stock items at or below reorder/par level"
          action={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(STOCK_WEB_URL || '/')}>Stock</Button>}
        >
          {dashboard && dashboard.lowStock.length === 0 ? (
            <EmptyState title="No low stock warnings" description="Items with reorder levels will appear here when they need attention." />
          ) : null}
          <div className="manager-mobile-list">
            {dashboard?.lowStock.map((item) => {
              const threshold = item.reorderPoint ?? item.parLevel;
              return (
                <article key={item.id} className="manager-mobile-row">
                  <span>
                    <strong>{item.name}</strong>
                    <span className="subtle">{item.categoryName ?? 'Uncategorised'} · {item.unit}</span>
                  </span>
                  <Badge tone="warning">{item.onHand} / {threshold}</Badge>
                </article>
              );
            })}
          </div>
        </Card>

        <Card
          title="Compliance issues"
          subtitle="Open, blocked, and in-progress issues"
          action={<Button type="button" size="sm" variant="secondary" onClick={() => window.location.assign(COMPLIANCE_WEB_URL || '/')}>Compliance</Button>}
        >
          {dashboard && dashboard.complianceIssues.length === 0 ? (
            <EmptyState title="No open compliance issues" description="Critical or open compliance items will appear here." />
          ) : null}
          <div className="manager-mobile-list">
            {dashboard?.complianceIssues.map((issue) => (
              <article key={issue.id} className="manager-mobile-row">
                <span>
                  <strong>{issue.title}</strong>
                  <span className="subtle">{issue.category} · {issue.assignee ?? 'Unassigned'}</span>
                  <span className="subtle">{issue.dueDate ? `Due ${new Date(issue.dueDate).toLocaleDateString()}` : 'No due date'}</span>
                </span>
                <Badge tone={issue.severity === 'CRITICAL' ? 'danger' : issue.severity === 'HIGH' ? 'warning' : 'info'}>{issue.severity}</Badge>
              </article>
            ))}
          </div>
        </Card>
      </div>
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
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
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
    setMessageTarget('submit');
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
    setMessageTarget(`cash:${id}`);
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
    setMessageTarget(`prefill:${shift.id}`);
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
    setMessageTarget(`approve:${id}`);
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
    setMessageTarget(`reject:${id}`);
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
    setMessageTarget(markExported ? 'export' : 'preview');
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
                  <ActionFeedback
                    message={messageTarget === `prefill:${shift.id}` ? message : null}
                    tone="success"
                  />
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
            <ActionFeedback
              message={messageTarget === 'submit' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
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
              <ActionFeedback
                message={messageTarget === 'preview' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
              <Button type="button" size="sm" disabled={saving} onClick={() => void exportXero(true)}>
                Export to Xero
              </Button>
              <ActionFeedback
                message={messageTarget === 'export' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
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
          {message && !messageTarget ? <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p> : null}
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
                    <>
                      <Button type="button" size="sm" disabled={saving} onClick={() => void approve(entry.id)}>Approve</Button>
                      <ActionFeedback
                        message={messageTarget === `approve:${entry.id}` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </>
                  ) : null}
                  {entry.status === 'APPROVED' && entry.paymentMethod === 'CASH' && !entry.cashPaidAt ? (
                    <>
                      <Button type="button" size="sm" disabled={saving} onClick={() => void markCashPaid(entry.id)}>Mark cash paid</Button>
                      <ActionFeedback
                        message={messageTarget === `cash:${entry.id}` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </>
                  ) : null}
                  {entry.status !== 'EXPORTED' ? (
                    <>
                      <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void reject(entry.id)}>Reject</Button>
                      <ActionFeedback
                        message={messageTarget === `reject:${entry.id}` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </>
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

const ONBOARDING_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const STAFF_DOCUMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif';
const STAFF_DOCUMENT_DATA_URL_PATTERN = /^data:(application\/pdf|image\/png|image\/jpeg|image\/jpg|image\/webp|image\/gif);base64,[A-Za-z0-9+/=]+$/i;
const ONBOARDING_UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ONBOARDING_UPLOAD_EXTENSION_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

function safeUploadName(name: string) {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'uploaded-document').slice(0, 180);
}

function uploadMimeType(file: File) {
  if (ONBOARDING_UPLOAD_TYPES.has(file.type)) return file.type;
  const lowerName = file.name.toLowerCase();
  const match = Array.from(ONBOARDING_UPLOAD_EXTENSION_TYPES.entries()).find(([extension]) => lowerName.endsWith(extension));
  return match?.[1] ?? '';
}

function normaliseUploadDataUrl(dataUrl: string, mimeType: string) {
  if (!mimeType) return dataUrl;
  return dataUrl.replace(/^data:(?:application\/octet-stream)?;base64,/i, `data:${mimeType};base64,`);
}

async function readOnboardingUpload(file: File) {
  if (file.size > ONBOARDING_UPLOAD_MAX_BYTES) {
    throw new Error('Please upload a file smaller than 4MB.');
  }
  const mimeType = uploadMimeType(file);
  if (!mimeType) {
    throw new Error('Upload a PDF, PNG, JPEG, WebP, or GIF document.');
  }

  return {
    name: safeUploadName(file.name),
    url: normaliseUploadDataUrl(await readUploadAsDataUrl(file), mimeType)
  };
}

function staffDocumentExternalUrl(documentUrl?: string | null) {
  const value = documentUrl?.trim();
  if (!value) return null;
  if (value.startsWith('data:')) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function staffDocumentBlobUrl(documentUrl: string) {
  const value = documentUrl.trim();
  if (!STAFF_DOCUMENT_DATA_URL_PATTERN.test(value)) return null;
  const [metadata, payload] = value.split(',');
  const mimeType = metadata?.match(/^data:([^;]+);base64$/i)?.[1] ?? 'application/octet-stream';
  const binary = window.atob(payload ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return window.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function openStaffDocument(documentUrl: string) {
  const blobUrl = staffDocumentBlobUrl(documentUrl);
  if (!blobUrl) return;
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
  if (!opened) {
    window.location.assign(blobUrl);
  }
}

function StaffDocumentViewLink({ documentUrl }: { documentUrl?: string | null }) {
  const value = documentUrl?.trim();
  if (!value) {
    return <span className="subtle">No document attached</span>;
  }

  const externalUrl = staffDocumentExternalUrl(value);
  if (externalUrl) {
    return (
      <a href={externalUrl} target="_blank" rel="noreferrer" className="invite-link">
        View document
      </a>
    );
  }

  if (STAFF_DOCUMENT_DATA_URL_PATTERN.test(value)) {
    return (
      <button type="button" className="invite-link document-view-button" onClick={() => openStaffDocument(value)}>
        View document
      </button>
    );
  }

  return <span className="subtle">Document link unavailable</span>;
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
                        <StaffDocumentViewLink documentUrl={document.documentUrl} />
                      </span>
                      <span className="invite-row-actions">
                        <input
                          aria-label={`Upload ${document.title}`}
                          type="file"
                          accept={STAFF_DOCUMENT_ACCEPT}
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

function StaffShell() {
  const { user } = useAuth();
  const { staff, roster, loading, error, reload } = useStaffData();
  const [selectedId, setSelectedId] = useState('');
  const isStaffUser = user?.role === 'STAFF';
  const canOpenSettings = canAccessSettings(user);
  const navItems = navItemsForUser(user);

  useEffect(() => {
    if (!selectedId && staff[0]) setSelectedId(staff[0].id);
  }, [selectedId, staff]);

  return (
    <AppShell
      brand={<ProductLogo appId="staff" size="md" showBrandMark={false} />}
      sidebar={<SidebarNav items={navItems} />}
      topBar={<TopBarWithContext />}
    >
      {error ? (
        <Card>
          <p className="error-text">{error}</p>
        </Card>
      ) : null}
      {isStaffUser ? (
        <Routes>
          <Route path="/" element={<StaffMemberHome staff={staff} loading={loading} reload={reload} />} />
          <Route path="/roster" element={<StaffMemberRosterPage />} />
          <Route path="/clock" element={<StaffMemberClockPage />} />
          <Route path="/leave" element={<StaffMemberLeavePage />} />
          <Route path="/compliance" element={<StaffMemberCompliancePage />} />
          <Route path="/academy" element={<StaffMemberAcademyPage staff={staff} loading={loading} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<StaffMemberTipsPage />} />
          <Route path="/communications" element={<CommunicationsPage staff={staff} reload={reload} />} />
          <Route path="/settings" element={<Navigate to="/" replace />} />
          <Route path="/admin" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<StaffHome staff={staff} loading={loading} onSelect={setSelectedId} reload={reload} />} />
          <Route path="/manager" element={<ManagerDashboardPage staff={staff} />} />
          <Route path="/clock" element={<StaffMemberClockPage />} />
          <Route path="/invites" element={<InvitesPage staff={staff} reloadStaff={reload} />} />
          <Route path="/approvals" element={<ApprovalsPage staff={staff} reload={reload} />} />
          <Route path="/settings" element={canOpenSettings ? <AdminPage staff={staff} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} /> : <Navigate to="/" replace />} />
          <Route path="/admin" element={canOpenSettings ? <AlmaAdminRedirect /> : <Navigate to="/" replace />} />
          <Route path="/access" element={<AccessPage staff={staff} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} />} />
          <Route path="/roster" element={<RosterPage staff={staff} roster={roster} reload={reload} />} />
          <Route path="/leave" element={<LeaveCalendarPage staff={staff} />} />
          <Route path="/compliance" element={<StaffMemberCompliancePage />} />
          <Route path="/academy" element={<TrainingPage staff={staff} reloadStaff={reload} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<TipsPage staff={staff} />} />
          <Route path="/communications" element={<CommunicationsPage staff={staff} reload={reload} />} />
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
    </AuthProvider>
  );
}
