import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  StaffClockSession,
  StaffClockStatusPayload,
  StaffDailyHomePayload,
  StaffTipHistory,
  StaffManagerOperationsPayload,
  StaffProfile,
  StaffRoleTemplate,
  StaffRecordType,
  StaffDefaults,
  StaffHrRecord,
  StaffHrRecordStatus,
  StaffHrRecordType,
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
  StartAssignedChecklistResult,
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
  AlmaHomeBubble,
  AlmaPill,
  AppShell,
  Badge,
  BigStat,
  Button,
  Card,
  CapIcon,
  EditorialAppHeader,
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
  SuiteClock,
  SuiteFeedbackWidget,
  SuiteInboxWidget,
  Textarea,
  ThemeToggle,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { SuiteSignOutButton } from '@alma/ui';
import { LoginPage } from './LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './PasswordRecoveryPages';
import { api, createSuiteHandoffUrl } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { COMPLIANCE_WEB_URL, RESERVE_WEB_URL, SETTINGS_WEB_URL, STOCK_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import {
  IconBadgeCheck,
  IconBriefcase,
  IconCalendarCheck,
  IconCalendarClock,
  IconChecklist,
  IconClock,
  IconDashboard,
  IconFileLock,
  IconFiles,
  IconFileSignature,
  IconFileText,
  IconMail,
  IconTriangle,
  IconUserPlus,
  IconUsers,
  IconWallet
} from '../../web/src/lib/icons';
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

const NAV_ITEMS = [
  {
    to: '/',
    label: 'Home',
    description: 'Staff command centre',
    icon: <IconUsers />,
    end: true
  },
  {
    to: '/brief',
    label: 'Daily brief',
    description: 'Your day in 10 seconds — sales, wages, approvals, heads-ups',
    icon: <IconDashboard />
  },
  {
    to: '/readiness',
    label: 'Readiness',
    description: 'Today’s opening, service and closing checklists at a glance',
    icon: <IconChecklist />
  },
  {
    to: '/manager',
    label: 'Manager Today',
    description: 'Today’s staff, clock sessions, bookings and exceptions',
    icon: <IconDashboard />
  },
  {
    to: '/clock',
    label: 'Clock',
    description: 'My clock in, out and breaks',
    icon: <IconClock />
  },
  {
    to: '/profiles',
    label: 'Profiles',
    description: 'Full staff profiles, permissions, documents, and tasks',
    icon: <IconFileText />
  },
  {
    to: '/invites',
    label: 'Invites',
    description: 'Staff onboarding links',
    icon: <IconUserPlus />
  },
  {
    to: '/approvals',
    label: 'Approvals',
    description: 'Review onboarding documents',
    icon: <IconBadgeCheck />
  },
  {
    to: '/roster',
    label: 'Roster',
    description: 'Roster board foundation',
    icon: <IconCalendarClock />
  },
  {
    to: '/leave',
    label: 'Leave',
    description: 'Manager leave calendar',
    icon: <IconCalendarCheck />
  },
  {
    to: '/compliance',
    label: 'Compliance',
    description: 'Staff compliance reminders',
    icon: <IconFileLock />
  },
  {
    to: '/hr',
    label: 'HR',
    description: 'Restricted employment records',
    icon: <IconBriefcase />
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
    icon: <IconClock />
  },
  {
    to: '/tips',
    label: 'Tips',
    description: 'Cash tips and payout runs',
    icon: <IconWallet />
  },
  {
    to: '/settings',
    label: 'Staff settings',
    description: 'Staff defaults, onboarding and access',
    icon: <GearIcon />
  },
  {
    to: 'https://alma-comms.web.app',
    label: 'Comms',
    description: 'Announcements, group chats, and messaging permissions',
    icon: <IconMail />
  }
];

const STAFF_MEMBER_NAV_ITEMS = [
  {
    to: '/',
    label: 'Home',
    description: 'Today, clocking, reminders and announcements',
    icon: <IconDashboard />,
    end: true
  },
  {
    to: '/roster',
    label: 'Roster',
    description: 'My upcoming and past shifts',
    icon: <IconCalendarClock />
  },
  {
    to: '/clock',
    label: 'Clock',
    description: 'Clock in, out and breaks',
    icon: <IconClock />
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
    to: '/compliance',
    label: 'Compliance',
    description: 'Documents, training and reminders',
    icon: <IconFileLock />
  },
  {
    to: '/documents',
    label: 'Documents',
    description: 'Requests and uploads',
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

type StaffDocumentReviewItem = {
  id: string;
  recordType: string;
  title: string;
  status: string;
  sourceFileName: string;
  sourceFileHash: string;
  candidateName: string | null;
  candidateStaffIds: string[];
  reviewReason: string;
  documentName: string | null;
  documentUrl: string | null;
  notes: string | null;
  createdAt: string;
};

type StaffComplianceDocumentRecord = Omit<StaffComplianceRecord, 'status'> & {
  dueAt?: string | null;
  rejectionReason?: string | null;
  requestedAt?: string | null;
  status: string;
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

type MobileRosterGroupKey = 'late' | 'onShift' | 'scheduled' | 'unassigned' | 'completed';

const MOBILE_ROSTER_MEDIA_QUERY = '(max-width: 900px)';

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

type MobileRosterVenueGroup = {
  venue: string;
  initials: string;
  shifts: RosterShift[];
  areas: Array<{
    area: string;
    shifts: RosterShift[];
  }>;
};

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

function useRosterMobileMode() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia(MOBILE_ROSTER_MEDIA_QUERY).matches || new URLSearchParams(window.location.search).get('force-mobile-runtime') === '1'
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const query = window.matchMedia(MOBILE_ROSTER_MEDIA_QUERY);
    const update = () => {
      const forced = new URLSearchParams(window.location.search).get('force-mobile-runtime') === '1';
      setIsMobile(query.matches || forced);
    };
    update();

    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }

    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  return isMobile;
}

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
  if (user?.role === 'STAFF') return STAFF_MEMBER_NAV_ITEMS;
  const items = canAccessSettings(user)
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.to !== '/settings' && item.to !== '/admin');
  return canAccessStaffHr(user) ? items : items.filter((item) => item.to !== '/hr');
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
            <SuiteFeedbackWidget
              appId="STAFF"
              api={api}
              userName={`${user.firstName} ${user.lastName}`}
            />
            <ThemeToggle />
            <SuiteClock />
            <SuiteSignOutButton
              className="staff-topbar-signout"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            />
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
            {item.to.startsWith('http') ? (
              <a href={item.to} target="_blank" rel="noopener noreferrer" aria-label={item.label} title={item.label}>
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ) : (
              <NavLink to={item.to} end={item.end} aria-label={item.label} title={item.label}>
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
  const navigate = useNavigate();
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
      <AlmaHomeBubble
        app="staff"
        appName="Staff"
        appIcon={<PeopleIcon />}
        eyebrow="People command"
        description="Rosters, pay, contracts, certifications. Where the team and the working week meet."
        statusLabel="Week 25–31 May"
        statusHint={(() => {
          if (loading) return 'Loading the staff register…';
          if (readinessActionCount === 0) {
            return `${activeStaff.length} active profile${activeStaff.length === 1 ? '' : 's'}. Register is ready for daily use.`;
          }
          const bits: string[] = [];
          if (pending.length > 0) bits.push(`${pending.length} pending onboarding`);
          if (expiringSoon.length > 0) bits.push(`${expiringSoon.length} expiring record${expiringSoon.length === 1 ? '' : 's'}`);
          if (missingPayRate.length > 0) bits.push(`${missingPayRate.length} missing pay rate`);
          return bits.length > 0 ? bits.join(' · ') : `${readinessActionCount} readiness item${readinessActionCount === 1 ? '' : 's'} need review`;
        })()}
        statusDot={readinessActionCount === 0 ? 'forest' : 'amber'}
        actions={
          <>
            <NavLink to="/brief" className="alma-home-bubble-btn alma-home-bubble-btn--primary">
              Daily brief →
            </NavLink>
            <NavLink to="/readiness" className="alma-home-bubble-btn alma-home-bubble-btn--ghost">
              Today's readiness
            </NavLink>
            <NavLink to="/roster" className="alma-home-bubble-btn alma-home-bubble-btn--ghost">
              Roster
            </NavLink>
          </>
        }
      />

      <div className="stats-grid staff-settings-stats">
        <NavLink to="/profiles" className="stat-card-link" aria-label="Open staff profiles">
          <StatCard label="Staff profiles" value={staff.length} hint="Shared records" loading={loading} />
        </NavLink>
        <NavLink to="/profiles" className="stat-card-link" aria-label="Open active staff profiles">
          <StatCard label="Active" value={activeStaff.length} hint="Not archived" loading={loading} />
        </NavLink>
        <NavLink to="/approvals" className="stat-card-link" aria-label="Open pending onboarding approvals">
          <StatCard label="Pending onboarding" value={pending.length} hint="Invite created" loading={loading} />
        </NavLink>
        <NavLink to="/hr" className="stat-card-link" aria-label="Open expiring staff records">
          <StatCard label="Expiring records" value={expiringSoon.length} hint="Next 30 days" loading={loading} />
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
  );
}

type StaffProfileStatusFilter = 'current' | 'active' | 'pending' | 'terminated' | 'all';

const STAFF_PROFILE_STATUS_FILTERS: Array<{ id: StaffProfileStatusFilter; label: string }> = [
  { id: 'current', label: 'Current' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'terminated', label: 'Terminated' },
  { id: 'all', label: 'All' }
];

function normaliseEmploymentStatus(member: Pick<StaffProfile, 'employmentStatus'>) {
  return member.employmentStatus.trim().toUpperCase();
}

function isTerminatedStaffProfile(member: Pick<StaffProfile, 'employmentStatus'>) {
  const status = normaliseEmploymentStatus(member);
  return status !== 'ACTIVE' && status !== 'PENDING';
}

function staffProfileStatusRank(member: Pick<StaffProfile, 'employmentStatus'>) {
  const status = normaliseEmploymentStatus(member);
  if (status === 'ACTIVE') return 0;
  if (status === 'PENDING') return 1;
  return 2;
}

function staffProfileSortLabel(member: Pick<StaffProfile, 'firstName' | 'lastName' | 'venue'>) {
  return `${member.venue ?? ''} ${member.firstName} ${member.lastName}`.trim().toLowerCase();
}

function StaffProfilesPage({
  staff,
  roleTemplates,
  loading,
  onSelect,
  reload
}: {
  staff: StaffProfile[];
  roleTemplates: StaffRoleTemplate[];
  loading: boolean;
  onSelect: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState<StaffFormState>({ mode: 'closed' });
  const [reonboardingId, setReonboardingId] = useState<string | null>(null);
  const [reonboardMessage, setReonboardMessage] = useState<string | null>(null);
  const [reonboardError, setReonboardError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StaffProfileStatusFilter>('current');

  const statusCounts = useMemo(() => {
    const active = staff.filter((member) => normaliseEmploymentStatus(member) === 'ACTIVE').length;
    const pending = staff.filter((member) => normaliseEmploymentStatus(member) === 'PENDING').length;
    const terminated = staff.filter(isTerminatedStaffProfile).length;
    return {
      active,
      pending,
      terminated,
      current: active + pending,
      all: staff.length
    };
  }, [staff]);

  const visibleStaff = useMemo(() => {
    return staff
      .filter((member) => {
        const status = normaliseEmploymentStatus(member);
        if (statusFilter === 'active') return status === 'ACTIVE';
        if (statusFilter === 'pending') return status === 'PENDING';
        if (statusFilter === 'terminated') return isTerminatedStaffProfile(member);
        if (statusFilter === 'current') return !isTerminatedStaffProfile(member);
        return true;
      })
      .slice()
      .sort((a, b) => {
        const statusDelta = statusFilter === 'terminated' ? 0 : staffProfileStatusRank(a) - staffProfileStatusRank(b);
        if (statusDelta !== 0) return statusDelta;
        return staffProfileSortLabel(a).localeCompare(staffProfileSortLabel(b));
      });
  }, [staff, statusFilter]);

  function openProfile(id: string, section = 'personal') {
    onSelect(id);
    navigate(`/staff/${id}/${section}`);
  }

  async function handleSaved(member: StaffProfile) {
    await reload();
    openProfile(member.id);
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
        eyebrow="Profiles"
        title="Staff profiles"
        description="Shared StaffProfile records for Staff, Compliance, Stock and Training."
        actions={
          <>
            <Button type="button" variant="ghost" onClick={() => navigate('/')}>Back to staff home</Button>
            <Button type="button" onClick={() => setForm({ mode: 'create' })}>New staff</Button>
          </>
        }
      />

      {reonboardMessage ? <p className="subtle">{reonboardMessage}</p> : null}
      {reonboardError ? <p className="error-text">{reonboardError}</p> : null}

      <Card
        title="Staff register"
        subtitle="Open a profile for documents, role permissions, employment details, and HR sections."
        padding="none"
        action={
          <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
            New staff
          </Button>
        }
      >
        {loading ? <Spinner label="Loading staff..." /> : null}
        {!loading && staff.length === 0 ? (
          <EmptyState
            title="No staff profiles yet"
            description="Create staff here, then manage roster and app access."
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>Create first staff profile</Button>}
          />
        ) : null}
        {!loading && staff.length > 0 ? (
          <div className="staff-status-toolbar" aria-label="Staff status filters">
            <div className="staff-status-filter-group" role="group" aria-label="Filter staff profiles by status">
              {STAFF_PROFILE_STATUS_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`staff-status-filter ${statusFilter === item.id ? 'is-active' : ''}`}
                  onClick={() => setStatusFilter(item.id)}
                  aria-pressed={statusFilter === item.id}
                >
                  <span>{item.label}</span>
                  <strong>{statusCounts[item.id]}</strong>
                </button>
              ))}
            </div>
            <span className="staff-status-toolbar__summary">
              Showing {visibleStaff.length} of {staff.length} profiles
            </span>
          </div>
        ) : null}
        <div className="staff-list" style={{ padding: 12 }}>
          {!loading && staff.length > 0 && visibleStaff.length === 0 ? (
            <EmptyState
              title="No staff match this status"
              description="Choose another status filter to see more profiles."
            />
          ) : null}
          {visibleStaff.map((member) => {
            const soon = member.records.filter((record) => record.expiryDate && isExpiringSoon(record.expiryDate)).length;
            const uploadedDocuments = member.records.filter((record) => Boolean(record.documentUrl)).length;
            const uploadedRsa = member.records.some((record) => record.recordType === 'RSA' && record.documentUrl);
            return (
              <div key={member.id} className="staff-list-button">
                <button type="button" className="staff-list-main" onClick={() => openProfile(member.id)}>
                  <span>
                    <strong>
                      {member.firstName} {member.lastName}
                    </strong>
                    <span className="subtle" style={{ display: 'block' }}>
                      {member.roleTitle} · {member.venue || 'No venue'} · {member.email || 'No email'}
                    </span>
                    {uploadedDocuments ? <span className="subtle" style={{ display: 'block' }}>{uploadedDocuments} uploaded document{uploadedDocuments === 1 ? '' : 's'} in profile</span> : null}
                    {soon ? <span className="subtle" style={{ display: 'block' }}>{soon} record{soon === 1 ? '' : 's'} expiring soon</span> : null}
                  </span>
                </button>
                <span className="staff-row-actions">
                  {uploadedRsa ? <Badge tone="positive">RSA uploaded</Badge> : null}
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
                      {reonboardingId === member.id ? 'Sending...' : 'Re-onboard'}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProfile(member.id, 'documents');
                    }}
                  >
                    Documents
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProfile(member.id, 'personal');
                    }}
                  >
                    Profile
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProfile(member.id, 'payroll');
                    }}
                  >
                    Payroll
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <StaffModal
        open={form.mode !== 'closed'}
        title={form.mode === 'edit' ? `Edit ${form.member.firstName} ${form.member.lastName}` : 'New staff profile'}
        subtitle="Create or update the shared staff authority without losing your place in the register."
        onClose={() => setForm({ mode: 'closed' })}
      >
        {form.mode !== 'closed' ? (
          <StaffProfileForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.member : undefined}
            roleTemplates={roleTemplates}
            onSaved={(member) => void handleSaved(member)}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : null}
      </StaffModal>
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

      <PublishedRosterView />
    </div>
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

type StaffDraft = {
  firstName: string;
  lastName: string;
  roleTemplateId: string;
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

function emptyStaffDraft(): StaffDraft {
  return {
    firstName: '',
    lastName: '',
    roleTemplateId: '',
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
    roleTemplateId: member.roleTemplateId ?? '',
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
    roleTemplateId: draft.roleTemplateId || undefined,
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

function StaffModal({
  open,
  title,
  subtitle,
  children,
  onClose,
  width = 'wide'
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  width?: 'standard' | 'wide';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without making it an effect dependency — otherwise
  // the parent's inline `onClose={() => …}` changes identity every render, the
  // effect re-runs, and `panel.focus()` yanks focus out of whatever input the
  // user is typing in (the "type one letter then it clicks out" bug).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="staff-modal-backdrop">
      <section
        ref={panelRef}
        className={`staff-modal staff-modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="staff-modal-header">
          <span>
            <h2 id="staff-modal-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </span>
          <button type="button" className="staff-modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="staff-modal-body">
          {children}
        </div>
      </section>
    </div>
  );
}

function roleTemplateAccessSummary(template?: StaffRoleTemplate | null) {
  if (!template) return 'Choose a role template to apply app access.';
  const enabled = template.access.filter((access) => access.status === 'ENABLED');
  if (!enabled.length) return 'No apps enabled by this role yet.';
  return enabled
    .map((access) => `${access.appId.toLowerCase()}: ${access.role.toLowerCase()}`)
    .slice(0, 4)
    .join(' · ');
}

function StaffProfileForm({
  mode,
  initial,
  roleTemplates,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: StaffProfile;
  roleTemplates: StaffRoleTemplate[];
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

  function selectRoleTemplate(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  async function submit() {
    setFeedback(null);
    if (!draft.firstName.trim() || !draft.lastName.trim() || (!draft.roleTemplateId && !draft.roleTitle.trim())) {
      setFeedback('First name, last name and role are required');
      setFeedbackTone('error');
      return;
    }
    if (roleTemplates.length && !draft.roleTemplateId) {
      setFeedback('Choose a role template before saving.');
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
        {roleTemplates.length ? (
          <Select
            label="Role"
            required
            value={draft.roleTemplateId}
            onChange={(event) => selectRoleTemplate(event.currentTarget.value)}
            options={[
              { label: 'Choose a role template', value: '' },
              ...roleTemplates.map((template) => ({
                label: template.roleTitle && template.roleTitle !== template.name ? `${template.name} (${template.roleTitle})` : template.name,
                value: template.id
              }))
            ]}
          />
        ) : (
          <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
        )}
        <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
      </div>
      {roleTemplates.length ? (
        <details className="staff-role-preview">
          <summary>{draft.roleTemplateId ? 'Role access preview' : 'Choose a role to preview access'}</summary>
          <p className="subtle">{roleTemplateAccessSummary(roleTemplates.find((template) => template.id === draft.roleTemplateId))}</p>
          {mode === 'edit' && draft.roleTemplateId !== (initial?.roleTemplateId ?? '') ? (
            <p className="subtle">Changing role will update this person’s app access to match the selected role.</p>
          ) : null}
        </details>
      ) : (
        <p className="subtle">No role templates exist yet. Admins can create them in Alma Admin / Roles.</p>
      )}
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

function staffInitials(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.trim().toUpperCase() || 'SP';
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const activeSection = normaliseStaffProfileSection(section);
  const selected = staff.find((item) => item.id === staffId) ?? null;
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [payrollModalOpen, setPayrollModalOpen] = useState(false);
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
  const recentShifts = [...member.rosterShifts]
    .sort((left, right) => new Date(right.startsAt).getTime() - new Date(left.startsAt).getTime())
    .slice(0, 6);
  const sectionTitle = STAFF_PROFILE_SECTIONS.find((item) => item.id === activeSection)?.label ?? 'Personal';
  const approvedDocuments = member.records.filter((record) => record.status === 'APPROVED').length;
  const attentionDocuments = member.records.filter((record) => record.status !== 'APPROVED' || recordDocumentRequested(record)).length;
  const sidebarGroups = STAFF_PROFILE_SECTIONS.reduce<Record<string, typeof STAFF_PROFILE_SECTIONS>>((groups, item) => {
    groups[item.group] = [...(groups[item.group] ?? []), item];
    return groups;
  }, {});

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
                            disabled={!canManageProfileAccess || saving || Boolean(appPermissions.admin && permission.key !== 'admin')}
                            onChange={(event) => void setPermission(app.id, permission.key, event.currentTarget.checked)}
                          />
                          {permission.label}
                        </label>
                      ))}
                    </div>
                    <ActionFeedback message={messageTarget === `permission:${app.id}` ? message : null} tone={message?.includes('Could') ? 'error' : 'success'} />
                  </div>
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
                {canManageProfileAccess && !member.isAdmin ? (
                  <Button type="button" variant="danger" disabled={saving} onClick={() => void archiveStaff()}>Archive staff</Button>
                ) : null}
              </>
            }
          />
          <div className="stats-grid staff-profile-stats">
            <StatCard label="Documents" value={member.records.length + visibleHrRecords.length} hint={`${attentionDocuments} need attention`} />
            <StatCard label="Training" value={member.trainingRecords.length} hint={`Level ${member.trainingLevel ?? 0}`} />
            <StatCard label="Shifts" value={member.rosterShifts.length} hint="Roster records" />
            <StatCard label="PIN" value={member.pinUpdatedAt ? 'Set' : 'Not set'} hint={member.pinUpdatedAt ? profileDate(member.pinUpdatedAt) : 'Staff iPad access'} />
          </div>
          {renderSection()}
        </main>
      </div>
      <StaffModal open={profileModalOpen} title={`Edit ${staffFullName(member)}`} subtitle="Profile edits stay in a modal so the staff workspace remains in place." onClose={() => setProfileModalOpen(false)}>
        <StaffProfileForm mode="edit" initial={member} roleTemplates={roleTemplates} onSaved={(saved) => void handleProfileSaved(saved)} onCancel={() => setProfileModalOpen(false)} />
      </StaffModal>
    </div>
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
  roleTemplateId: string;
  roleTitle: string;
  email: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

type StaffDocumentPromptAction = 'delete' | 'request';

type ReonboardDraft = {
  email: string;
  firstName: string;
  lastName: string;
  roleTemplateId: string;
  roleTitle: string;
  venue: string;
  note: string;
  expiresInDays: string;
};

function emptyInviteDraft(): InviteDraft {
  return {
    firstName: '',
    lastName: '',
    roleTemplateId: '',
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
    roleTemplateId: '',
    roleTitle: '',
    venue: '',
    note: '',
    expiresInDays: '30'
  };
}

function InvitesPage({ staff, roleTemplates, reloadStaff }: { staff: StaffProfile[]; roleTemplates: StaffRoleTemplate[]; reloadStaff: () => Promise<void> }) {
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

  function selectInviteRole(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  function selectReonboardRole(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setReonboardDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  async function createInvite() {
    setError(null);
    setMessage(null);
    setMessageTarget('create-invite');
    if (!draft.firstName.trim() || !draft.lastName.trim() || (!draft.roleTemplateId && !draft.roleTitle.trim())) {
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
          roleTemplateId: draft.roleTemplateId || undefined,
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
          roleTemplateId: reonboardDraft.roleTemplateId || undefined,
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
              {roleTemplates.length ? (
                <Select
                  label="Role"
                  required
                  value={draft.roleTemplateId}
                  onChange={(event) => selectInviteRole(event.currentTarget.value)}
                  options={[
                    { label: 'Choose a role template', value: '' },
                    ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                  ]}
                />
              ) : (
                <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
              )}
              <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            {draft.roleTemplateId ? (
              <p className="subtle">{roleTemplateAccessSummary(roleTemplates.find((template) => template.id === draft.roleTemplateId))}</p>
            ) : null}
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
              <Select
                label="Role override"
                value={reonboardDraft.roleTemplateId}
                onChange={(event) => selectReonboardRole(event.currentTarget.value)}
                options={[
                  { label: 'Keep current role', value: '' },
                  ...roleTemplates.map((template) => ({ label: template.name, value: template.id }))
                ]}
              />
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

type StaffMessageThreadSummary = {
  id: string;
  subject: string;
  venue: string | null;
  category: string;
  priority: string;
  updatedAt: string;
  unread?: boolean;
  actionRequired?: boolean;
  latestMessage?: string | null;
};

type StaffMessageThreadDetail = {
  id: string;
  subject: string;
  venue: string | null;
  category: string;
  priority: string;
  messages: Array<{
    id: string;
    body: string;
    createdById: string | null;
    createdAt: string;
  }>;
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
  const [inboxThreads, setInboxThreads] = useState<StaffMessageThreadSummary[]>([]);
  const [selectedMessageThread, setSelectedMessageThread] = useState<StaffMessageThreadDetail | null>(null);
  const [threadReply, setThreadReply] = useState('');
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
      const [data, inbox] = await Promise.all([
        canManage && !options?.channelId && !options?.recipientId
          ? api<SuiteCommunicationsPayload>('/api/communications/admin')
          : api<SuiteCommunicationsPayload>(`/api/communications?${params.toString()}`),
        api<{ threads: StaffMessageThreadSummary[] }>('/api/messages/inbox')
      ]);
      setPayload(data);
      setInboxThreads(inbox.threads ?? []);
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
    setSelectedMessageThread(null);
    await loadCommunications({ channelId: channel.id });
  }

  async function openDirect(recipientId: string) {
    setDirectRecipientId(recipientId);
    setSelectedChannelId('');
    setSelectedMessageThread(null);
    await loadCommunications({ recipientId });
  }

  async function openInboxThread(threadId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`thread:${threadId}:open`);
    try {
      const data = await api<{ thread: StaffMessageThreadDetail }>(`/api/messages/threads/${threadId}`);
      setSelectedMessageThread(data.thread);
      setDirectRecipientId('');
      setSelectedChannelId('');
      setThreadReply('');
      await api(`/api/messages/threads/${threadId}/read`, { method: 'POST' });
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open message thread.');
    } finally {
      setSaving(false);
    }
  }

  async function sendInboxReply() {
    if (!selectedMessageThread || !threadReply.trim()) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`thread:${selectedMessageThread.id}:reply`);
    try {
      await api(`/api/messages/threads/${selectedMessageThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: threadReply.trim() })
      });
      setThreadReply('');
      await openInboxThread(selectedMessageThread.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send reply.');
    } finally {
      setSaving(false);
    }
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

      <Card title="Messages inbox" subtitle="Comms and Staff messages now share the same conversations.">
        <div className="comms-layout">
          <div className="comms-sidebar">
            <section className="comms-sidebar-section" aria-label="Messages inbox">
              <div className="comms-section-heading">
                <strong>Recent threads</strong>
                <span>{inboxThreads.length} visible</span>
              </div>
              {inboxThreads.length === 0 ? (
                <p className="subtle">No messages have been sent to you yet.</p>
              ) : (
                inboxThreads.slice(0, 12).map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={`staff-list-button comms-thread-button ${selectedMessageThread?.id === thread.id ? 'is-selected' : ''}`}
                    onClick={() => void openInboxThread(thread.id)}
                  >
                    <span>
                      <strong>{thread.subject}</strong>
                      <span className="subtle">
                        {[thread.category, thread.venue, thread.unread ? 'Unread' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </div>
          <div className="staff-mobile-chat">
            {selectedMessageThread ? (
              <>
                <div className="comms-thread-header">
                  <span>
                    <strong>{selectedMessageThread.subject}</strong>
                    <span className="subtle">{selectedMessageThread.category} · {selectedMessageThread.venue || 'All venues'}</span>
                  </span>
                  <Badge tone={selectedMessageThread.priority === 'URGENT' || selectedMessageThread.priority === 'HIGH' ? 'warning' : 'muted'}>{selectedMessageThread.priority}</Badge>
                </div>
                <div className="staff-mobile-comms-list">
                  {selectedMessageThread.messages.map((item) => (
                    <div key={item.id} className={`comms-message ${item.createdById === user?.id ? 'is-mine' : 'is-theirs'}`}>
                      <span className="comms-message-body">{item.body}</span>
                      <small>{formatDateTime(item.createdAt)}</small>
                    </div>
                  ))}
                </div>
                <div className="staff-mobile-chat-form">
                  <Input label="Reply" value={threadReply} onChange={(event) => setThreadReply(event.currentTarget.value)} placeholder="Reply to this message" />
                  <Button type="button" disabled={saving || !threadReply.trim()} onClick={() => void sendInboxReply()}>
                    Reply
                  </Button>
                  <ActionFeedback
                    message={messageTarget === `thread:${selectedMessageThread.id}:reply` ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </>
            ) : (
              <div className="comms-empty-thread">
                <strong>Select a message</strong>
                <span className="subtle">Open a Comms or Staff thread to read and reply from here.</span>
              </div>
            )}
          </div>
        </div>
      </Card>

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
                <Input label="Title" value={announcementDraft.title} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, title: el.value })); }} />
                <Select label="Venue" value={announcementDraft.venue} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, venue: el.value })); }} options={VENUE_OPTIONS} />
              </div>
              <Textarea label="Announcement" rows={3} value={announcementDraft.body} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, body: el.value })); }} />
              <div className="form-grid two">
                <Input label="Audience" value={announcementDraft.audience} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, audience: el.value })); }} />
                <Input label="Expires" type="date" value={announcementDraft.expiresAt} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, expiresAt: el.value })); }} />
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
                <Input label="Group name" value={channelDraft.name} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, name: el.value })); }} placeholder="Kitchen" />
                <Select label="Type" value={channelDraft.type} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, type: el.value as SuiteChatChannel['type'] })); }} options={['GENERAL', 'VENUE', 'AREA', 'GROUP'].map((value) => ({ label: value, value }))} />
                <Select label="Venue" value={channelDraft.venue} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, venue: el.value })); }} options={VENUE_OPTIONS} />
                <Input label="Group key" value={channelDraft.groupKey} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, groupKey: el.value })); }} placeholder="kitchen" />
              </div>
              <Textarea label="Description" rows={2} value={channelDraft.description} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, description: el.value })); }} />
              <Select label="Post permission" value={channelDraft.postPermission} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, postPermission: el.value })); }} options={[{ label: 'Anyone with Staff access', value: '' }, ...COMMUNICATION_PERMISSION_KEYS.map((item) => ({ label: item.label, value: item.key }))]} />
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

const HR_SECTION_LINKS: Array<{
  to: string;
  title: string;
  description: string;
  icon: JSX.Element;
  type?: StaffHrRecordType;
}> = [
  {
    to: '/hr/contracts',
    title: 'Contracts',
    description: 'Upload signed contracts and issued employment agreements.',
    icon: <IconFileSignature />,
    type: 'CONTRACT'
  },
  {
    to: '/hr/warnings',
    title: 'Written warnings',
    description: 'Store written warnings, reasons, notes and follow-up dates.',
    icon: <IconTriangle />,
    type: 'WARNING'
  },
  {
    to: '/hr/pay-changes',
    title: 'Pay changes',
    description: 'Record approved pay-change letters and effective dates.',
    icon: <IconWallet />,
    type: 'PAY_CHANGE'
  },
  {
    to: '/hr/right-to-work',
    title: 'Right to work',
    description: 'Restricted visa and work-rights records.',
    icon: <IconBadgeCheck />,
    type: 'RIGHT_TO_WORK'
  },
  {
    to: '/hr/documents',
    title: 'Documents',
    description: 'General HR document register with staff and status filters.',
    icon: <IconFiles />
  }
];

const HR_RECORD_STATUS_OPTIONS: StaffHrRecordStatus[] = [
  'DRAFT',
  'ISSUED',
  'SENT',
  'SIGNED',
  'STORED',
  'PENDING',
  'APPROVED',
  'EXPIRED',
  'RE_REQUESTED'
];

const HR_RECORD_TYPE_OPTIONS: StaffHrRecordType[] = [
  'CONTRACT',
  'WARNING',
  'PAY_CHANGE',
  'RIGHT_TO_WORK',
  'GENERAL'
];

type HrRecordDraft = {
  staffProfileId: string;
  recordType: StaffHrRecordType;
  title: string;
  status: StaffHrRecordStatus;
  issueDate: string;
  effectiveDate: string;
  expiryDate: string;
  followUpDate: string;
  reason: string;
  oldRate: string;
  newRate: string;
  documentName: string;
  documentUrl: string;
  notes: string;
};

function hrTypeLabel(type: StaffHrRecordType) {
  return type.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function hrStatusTone(status: StaffHrRecordStatus): 'positive' | 'warning' | 'danger' | 'info' | 'muted' {
  if (['SIGNED', 'STORED', 'APPROVED'].includes(status)) return 'positive';
  if (['DRAFT', 'PENDING', 'SENT', 'ISSUED', 'RE_REQUESTED'].includes(status)) return 'warning';
  if (status === 'EXPIRED') return 'danger';
  return 'muted';
}

function centsFromCurrencyInput(value: string) {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned) return undefined;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

function defaultHrTitle(type: StaffHrRecordType) {
  if (type === 'CONTRACT') return 'Employment contract';
  if (type === 'WARNING') return 'Written warning';
  if (type === 'PAY_CHANGE') return 'Pay change letter';
  if (type === 'RIGHT_TO_WORK') return 'Right-to-work document';
  return 'HR document';
}

function emptyHrDraft(staff: StaffProfile[], type: StaffHrRecordType): HrRecordDraft {
  return {
    staffProfileId: staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id ?? '',
    recordType: type,
    title: defaultHrTitle(type),
    // Pay changes flow DRAFT → PENDING → APPROVED. Contracts default to ISSUED.
    // Everything else lands as STORED.
    status: type === 'CONTRACT' ? 'ISSUED' : type === 'PAY_CHANGE' ? 'DRAFT' : 'STORED',
    issueDate: toDateInput(new Date()),
    effectiveDate: '',
    expiryDate: '',
    followUpDate: '',
    reason: '',
    oldRate: '',
    newRate: '',
    documentName: '',
    documentUrl: '',
    notes: ''
  };
}

function staffLabel(member?: Pick<StaffProfile, 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null) {
  if (!member) return 'Unknown staff';
  return `${member.firstName} ${member.lastName} · ${member.roleTitle}${member.venue ? ` · ${member.venue}` : ''}`;
}

function HrOverviewPage({ records, loading }: { records: StaffHrRecord[]; loading: boolean }) {
  const attentionItems = records.filter((record) =>
    record.status === 'RE_REQUESTED' ||
    record.status === 'EXPIRED' ||
    (record.expiryDate && new Date(record.expiryDate).getTime() < Date.now() + 30 * 24 * 60 * 60 * 1000)
  );
  const recentRecords = records.slice(0, 6);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Restricted HR"
        title="HR records"
        description="HR records are restricted. Only authorised managers can view these documents."
      />
      <div className="stats-grid">
        <StatCard label="HR records" value={records.length} hint="Restricted register" loading={loading} />
        <StatCard label="Attention items" value={attentionItems.length} hint="Expiry or re-request" tone={attentionItems.length ? 'warning' : 'positive'} loading={loading} />
        <StatCard label="Right-to-work" value={records.filter((record) => record.recordType === 'RIGHT_TO_WORK').length} hint="Sensitive work-rights records" loading={loading} />
      </div>
      <Card title="HR sections" subtitle="Each workflow has its own page. Admin owns setup and permissions.">
        <div className="app-access-grid">
          {HR_SECTION_LINKS.map((link) => (
            <NavLink key={link.to} className="app-access-tile" to={link.to}>
              <span className="app-access-title">
                <span className="sidebar-nav-icon" aria-hidden="true">{link.icon}</span>
                <strong>{link.title}</strong>
              </span>
              <span className="subtle">{link.description}</span>
              <Badge tone="info">{link.type ? records.filter((record) => record.recordType === link.type).length : records.length} records</Badge>
            </NavLink>
          ))}
        </div>
      </Card>
      <Card title="Recent HR actions" subtitle="Record activity from the restricted HR register.">
        <HrRecordList records={recentRecords} emptyTitle="No HR actions yet" />
      </Card>
    </div>
  );
}

function HrSectionPage({
  staff,
  records,
  type,
  mode,
  loading,
  reload,
  canManage,
  canApprove = false,
  currentUserId = ''
}: {
  staff: StaffProfile[];
  records: StaffHrRecord[];
  type?: StaffHrRecordType;
  mode: 'contracts' | 'warnings' | 'pay-changes' | 'right-to-work' | 'documents';
  loading: boolean;
  reload: () => Promise<void>;
  canManage: boolean;
  // Pay-change-only workflow props. Approval is admin-only and must be a
  // different user from the manager who drafted (separation of duties).
  canApprove?: boolean;
  currentUserId?: string;
}) {
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [draft, setDraft] = useState<HrRecordDraft>(() => emptyHrDraft(staff, type ?? 'GENERAL'));

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      recordType: type ?? current.recordType,
      title: current.title || defaultHrTitle(type ?? current.recordType),
      staffProfileId: current.staffProfileId || staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id || ''
    }));
  }, [staff, type]);

  const sectionRecords = records.filter((record) => {
    if (type && record.recordType !== type) return false;
    if (staffFilter && record.staffProfileId !== staffFilter) return false;
    if (statusFilter && record.status !== statusFilter) return false;
    return true;
  });

  const staffOptions = [
    { label: 'Choose staff', value: '' },
    ...staff
      .filter((member) => member.employmentStatus !== 'ARCHIVED')
      .map((member) => ({ label: staffLabel(member), value: member.id }))
  ];
  const filterStaffOptions = [{ label: 'All staff', value: '' }, ...staffOptions.slice(1)];
  const statusOptions = [
    { label: 'All statuses', value: '' },
    ...HR_RECORD_STATUS_OPTIONS.map((status) => ({ label: status.replaceAll('_', ' '), value: status }))
  ];

  const heading = HR_SECTION_LINKS.find((link) => link.to.endsWith(mode)) ?? HR_SECTION_LINKS[4];
  const showCreateForm = canManage && mode !== 'documents';

  function updateDraft<K extends keyof HrRecordDraft>(key: K, value: HrRecordDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function attachDraftFile(file: File) {
    try {
      const upload = await readOnboardingUpload(file);
      updateDraft('documentName', upload.name);
      updateDraft('documentUrl', upload.url);
      setMessage(null);
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not upload document.');
    }
  }

  async function createRecord() {
    if (!draft.staffProfileId) {
      setMessageTone('error');
      setMessage('Choose a staff member before filing this HR record.');
      return;
    }
    if (!draft.title.trim()) {
      setMessageTone('error');
      setMessage('Title is required.');
      return;
    }
    if (mode === 'pay-changes') {
      if (!draft.effectiveDate) {
        setMessageTone('error');
        setMessage('Set the effective date before filing this pay change.');
        return;
      }
      if (!draft.newRate) {
        setMessageTone('error');
        setMessage('Set the new rate before filing this pay change.');
        return;
      }
      // Letter attachment can be uploaded later, but is required before APPROVED.
      if ((draft.status === 'APPROVED' || draft.status === 'PENDING') && !draft.documentUrl) {
        setMessageTone('error');
        setMessage('Attach the approved pay-change letter before marking this pending or approved.');
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>('/api/staff/hr/records', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: draft.staffProfileId,
          recordType: type ?? draft.recordType,
          title: draft.title.trim(),
          status: draft.status,
          issueDate: draft.issueDate,
          effectiveDate: draft.effectiveDate,
          expiryDate: draft.expiryDate,
          followUpDate: draft.followUpDate,
          reason: draft.reason.trim(),
          oldRateCents: centsFromCurrencyInput(draft.oldRate),
          newRateCents: centsFromCurrencyInput(draft.newRate),
          documentName: draft.documentName,
          documentUrl: draft.documentUrl,
          notes: draft.notes.trim()
        })
      });
      setDraft(emptyHrDraft(staff, type ?? 'GENERAL'));
      setMessageTone('success');
      setMessage('HR record filed.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not file HR record.');
    } finally {
      setSaving(false);
    }
  }

  async function removeDocument(record: StaffHrRecord) {
    if (!window.confirm(`Remove the document from "${record.title}"? The HR record will remain.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}`, { method: 'DELETE' });
      setMessageTone('success');
      setMessage('Document removed. HR record kept.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not remove HR document.');
    } finally {
      setSaving(false);
    }
  }

  async function requestDocument(record: StaffHrRecord) {
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}/request`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Replacement requested.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not request replacement.');
    } finally {
      setSaving(false);
    }
  }

  // Pay-change workflow actions. The API enforces real permissions and the
  // separation-of-duties rule, these helpers just submit cleanly and reload.
  async function submitForApproval(record: StaffHrRecord) {
    if (!record.effectiveDate || record.newRateCents === null) {
      setMessageTone('error');
      setMessage('Set the effective date and new rate before submitting for approval.');
      return;
    }
    if (!window.confirm(`Submit "${record.title}" for admin approval? You won't be able to edit it again until an admin returns it to draft.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/submit-for-approval`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Submitted. An Alma admin will be notified to approve.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not submit for approval.');
    } finally {
      setSaving(false);
    }
  }

  async function approvePayChange(record: StaffHrRecord) {
    const rateLine = record.newRateCents !== null
      ? `new rate ${formatCents(record.newRateCents)}`
      : 'new rate not recorded';
    const effective = record.effectiveDate ? new Date(record.effectiveDate).toLocaleDateString() : 'no effective date';
    if (!window.confirm(`Approve "${record.title}"?\n\n${rateLine}, effective ${effective}.\n\nAfter approval, remember to update Xero pay rates and Deputy if you use it. This is the auditable approval — keep the signed letter on file.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/approve`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Approved. Update Xero pay rates next.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSaving(false);
    }
  }

  async function returnToDraft(record: StaffHrRecord) {
    if (!window.confirm(`Return "${record.title}" to draft so it can be edited?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/return-to-draft`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Returned to draft.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not return to draft.');
    } finally {
      setSaving(false);
    }
  }

  // Per-mode privacy callout — every HR surface should explicitly say
  // who can see it, audited on view (#129 from the High School review).
  const privacyByMode: Record<typeof mode, { tag: string; line: string } | null> = {
    'contracts': {
      tag: 'Restricted',
      line: 'Visible to HR-authorised managers and admins. Final signed contracts only — drafts live in Alma Admin → HR templates.'
    },
    'warnings': {
      tag: 'Restricted',
      line: 'Visible to HR-authorised managers and admins. These are formal records, not casual notes.'
    },
    'pay-changes': {
      tag: 'Highly restricted',
      line: 'Visible only to users with the pay-changes permission. Every view and edit is audited.'
    },
    'right-to-work': {
      tag: 'Highly restricted',
      line: 'Visible only to users with the right-to-work permission. Never accessible on a shared device. Every view and edit is audited.'
    },
    'documents': {
      tag: 'Restricted',
      line: 'General HR documents are visible to HR-authorised managers and admins.'
    }
  };
  const privacy = privacyByMode[mode];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Restricted HR"
        title={heading.title}
        description={mode === 'right-to-work' ? 'Right-to-work records are highly sensitive and restricted to HR-authorised users.' : heading.description}
      />
      {privacy ? (
        <div className={`hr-privacy-callout ${mode === 'pay-changes' || mode === 'right-to-work' ? 'is-strict' : ''}`}>
          <span className="hr-privacy-callout-tag">{privacy.tag}</span>
          <span className="hr-privacy-callout-line">{privacy.line}</span>
        </div>
      ) : null}
      {mode === 'pay-changes' ? (
        <div className="pay-change-workflow">
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">1</span>
            <span><strong>Draft</strong><br />Manager fills the form, attaches the letter once signed.</span>
          </div>
          <span className="pay-change-workflow-arrow">→</span>
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">2</span>
            <span><strong>Submit for approval</strong><br />Sends to an admin. Another admin must review (not the drafter).</span>
          </div>
          <span className="pay-change-workflow-arrow">→</span>
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">3</span>
            <span><strong>Approve</strong><br />Admin approves. Then update Xero pay rates and Deputy.</span>
          </div>
        </div>
      ) : null}
      {mode === 'contracts' && canManage ? (
        <Card title="Contract templates" subtitle="Admin owns editable HR templates and legal review warnings. Staff HR stores issued and signed final documents.">
          <div className="toolbar-right">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                window.location.href = SETTINGS_WEB_URL ? `${SETTINGS_WEB_URL.replace(/\/+$/, '')}/staff-hr-templates` : '/staff-hr-templates';
              }}
            >
              Open HR templates
            </Button>
          </div>
        </Card>
      ) : null}
      <div className="stats-grid">
        <StatCard label="Records" value={sectionRecords.length} hint={type ? hrTypeLabel(type) : 'All HR documents'} loading={loading} />
        {mode === 'pay-changes' ? (
          <>
            <StatCard label="Pending approval" value={sectionRecords.filter((record) => record.status === 'PENDING').length} hint="Awaiting admin sign-off" loading={loading} />
            <StatCard label="Drafts" value={sectionRecords.filter((record) => record.status === 'DRAFT').length} hint="Not yet submitted" loading={loading} />
          </>
        ) : (
          <>
            <StatCard label="Needs action" value={sectionRecords.filter((record) => record.status === 'RE_REQUESTED' || record.status === 'EXPIRED').length} hint="Replacement or expiry" loading={loading} />
            <StatCard label="With document" value={sectionRecords.filter((record) => record.documentUrl).length} hint="Viewable files" loading={loading} />
          </>
        )}
      </div>

      {showCreateForm ? (
        <Card title={`File ${heading.title.toLowerCase()}`} subtitle="Upload the signed contract, approved letter, or supporting HR document.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createRecord();
            }}
          >
            <div className="form-grid three">
              <Select label="Staff member" value={draft.staffProfileId} onChange={(event) => updateDraft('staffProfileId', event.currentTarget.value)} options={staffOptions} />
              {!type ? (
                <Select label="Document type" value={draft.recordType} onChange={(event) => updateDraft('recordType', event.currentTarget.value as StaffHrRecordType)} options={HR_RECORD_TYPE_OPTIONS.map((item) => ({ label: hrTypeLabel(item), value: item }))} />
              ) : null}
              {mode === 'pay-changes' ? (
                <Input label="Status" value="Draft" readOnly />
              ) : (
                <Select label="Status" value={draft.status} onChange={(event) => updateDraft('status', event.currentTarget.value as StaffHrRecordStatus)} options={HR_RECORD_STATUS_OPTIONS.map((item) => ({ label: item.replaceAll('_', ' '), value: item }))} />
              )}
              <Input label="Title" value={draft.title} onChange={(event) => updateDraft('title', event.currentTarget.value)} />
              <Input label="Issue date" type="date" value={draft.issueDate} onChange={(event) => updateDraft('issueDate', event.currentTarget.value)} />
              <Input label="Effective date" type="date" value={draft.effectiveDate} onChange={(event) => updateDraft('effectiveDate', event.currentTarget.value)} />
              <Input label="Expiry date" type="date" value={draft.expiryDate} onChange={(event) => updateDraft('expiryDate', event.currentTarget.value)} />
              <Input label="Follow-up date" type="date" value={draft.followUpDate} onChange={(event) => updateDraft('followUpDate', event.currentTarget.value)} />
              {mode === 'pay-changes' ? (
                <>
                  <Input label="Old rate" value={draft.oldRate} onChange={(event) => updateDraft('oldRate', event.currentTarget.value)} />
                  <Input label="New rate" value={draft.newRate} onChange={(event) => updateDraft('newRate', event.currentTarget.value)} />
                </>
              ) : null}
            </div>
            <Textarea label={mode === 'warnings' ? 'Reason / category' : 'Reason'} rows={2} value={draft.reason} onChange={(event) => updateDraft('reason', event.currentTarget.value)} />
            <div className="invite-row">
              <span>
                <strong>Document upload</strong>
                <span className="subtle">PDF, PNG, JPEG, WebP or GIF under 4MB. Do not upload draft legal templates unless they have been approved.</span>
                {draft.documentName ? <span className="subtle">{draft.documentName}</span> : null}
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
                      if (file) void attachDraftFile(file);
                    }}
                  />
                </label>
                {draft.documentUrl ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { updateDraft('documentName', ''); updateDraft('documentUrl', ''); }}>
                    Remove attachment
                  </Button>
                ) : null}
              </span>
            </div>
            <Textarea label="HR notes" rows={2} value={draft.notes} onChange={(event) => updateDraft('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Filing...' : 'File HR record'}</Button>
              <ActionFeedback message={message} tone={messageTone} />
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={mode === 'documents' ? 'HR document register' : `${heading.title} register`} subtitle="Only authorised managers can view these documents.">
        <div className="form-grid three">
          <Select label="Staff" value={staffFilter} onChange={(event) => setStaffFilter(event.currentTarget.value)} options={filterStaffOptions} />
          <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} options={statusOptions} />
        </div>
        <HrRecordList
          records={sectionRecords}
          emptyTitle="No HR records found"
          canManage={canManage}
          saving={saving}
          mode={mode}
          canApprove={canApprove}
          currentUserId={currentUserId}
          onRemoveDocument={removeDocument}
          onRequestDocument={requestDocument}
          onSubmitForApproval={mode === 'pay-changes' ? submitForApproval : undefined}
          onApprovePayChange={mode === 'pay-changes' ? approvePayChange : undefined}
          onReturnToDraft={mode === 'pay-changes' ? returnToDraft : undefined}
        />
        {!showCreateForm ? <ActionFeedback message={message} tone={messageTone} /> : null}
      </Card>
    </div>
  );
}

function HrRecordList({
  records,
  emptyTitle,
  canManage = false,
  saving = false,
  mode,
  canApprove = false,
  currentUserId = '',
  onRemoveDocument,
  onRequestDocument,
  onSubmitForApproval,
  onApprovePayChange,
  onReturnToDraft
}: {
  records: StaffHrRecord[];
  emptyTitle: string;
  canManage?: boolean;
  saving?: boolean;
  mode?: 'contracts' | 'warnings' | 'pay-changes' | 'right-to-work' | 'documents';
  canApprove?: boolean;
  currentUserId?: string;
  onRemoveDocument?: (record: StaffHrRecord) => Promise<void>;
  onRequestDocument?: (record: StaffHrRecord) => Promise<void>;
  onSubmitForApproval?: (record: StaffHrRecord) => Promise<void>;
  onApprovePayChange?: (record: StaffHrRecord) => Promise<void>;
  onReturnToDraft?: (record: StaffHrRecord) => Promise<void>;
}) {
  if (!records.length) {
    return <EmptyState title={emptyTitle} description="HR records filed here stay separate from normal staff compliance documents." />;
  }

  const isPayChangePage = mode === 'pay-changes';

  return (
    <div className="staff-list">
      {records.map((record) => {
        const isPayChange = record.recordType === 'PAY_CHANGE';
        // Separation of duties: the manager who drafted cannot approve their own change.
        const draftedByMe = isPayChange && currentUserId && record.createdById === currentUserId;
        const canShowSubmit = isPayChange && canManage && onSubmitForApproval && (record.status === 'DRAFT' || record.status === 'RE_REQUESTED');
        const canShowApprove = isPayChange && canApprove && onApprovePayChange && record.status === 'PENDING' && !draftedByMe;
        const canShowReturn = isPayChange && canManage && onReturnToDraft && record.status === 'PENDING';
        const blockedBySeparation = isPayChange && canApprove && record.status === 'PENDING' && draftedByMe;

        return (
        <div key={record.id} className="staff-expiry-row">
          <span>
            <strong>{record.title}</strong>
            <span className="subtle">{hrTypeLabel(record.recordType)} · {staffLabel(record.staffProfile)} · {record.issueDate ? new Date(record.issueDate).toLocaleDateString() : 'No issue date'}</span>
            {record.effectiveDate ? <span className="subtle">Effective {new Date(record.effectiveDate).toLocaleDateString()}</span> : null}
            {record.expiryDate ? <span className="subtle">Expires {new Date(record.expiryDate).toLocaleDateString()}</span> : null}
            {record.followUpDate ? <span className="subtle">Follow up {new Date(record.followUpDate).toLocaleDateString()}</span> : null}
            {isPayChange ? (
              <span className="subtle">
                {record.oldRateCents !== null ? `Old ${formatCents(record.oldRateCents)}` : 'Old rate not recorded'}
                {' -> '}
                {record.newRateCents !== null ? `New ${formatCents(record.newRateCents)}` : 'New rate not recorded'}
              </span>
            ) : null}
            {record.reason ? <span className="subtle">{record.reason}</span> : null}
            {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
            <StaffDocumentViewLink documentUrl={record.documentUrl} />
            {record.notes ? <span className="subtle">{record.notes}</span> : null}
            {isPayChange ? (
              <span className="subtle">
                {record.createdById ? `Drafted by ${record.createdById === currentUserId ? 'you' : 'a manager'}` : 'Drafted'}
                {' on '}
                {new Date(record.createdAt).toLocaleDateString()}
                {record.updatedById && record.updatedById !== record.createdById && record.status === 'APPROVED'
                  ? ` · Approved ${new Date(record.updatedAt).toLocaleDateString()}${record.updatedById === currentUserId ? ' by you' : ''}`
                  : ''}
              </span>
            ) : null}
            {blockedBySeparation ? (
              <span className="subtle" style={{ color: '#7a1f3d' }}>
                You drafted this pay change, so another admin must approve it.
              </span>
            ) : null}
          </span>
          <span className="invite-row-actions">
            <Badge tone={hrStatusTone(record.status)}>{record.status.replaceAll('_', ' ')}</Badge>
            {canShowSubmit ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void onSubmitForApproval!(record)}>
                Submit for approval
              </Button>
            ) : null}
            {canShowApprove ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void onApprovePayChange!(record)}>
                Approve pay change
              </Button>
            ) : null}
            {canShowReturn ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onReturnToDraft!(record)}>
                Return to draft
              </Button>
            ) : null}
            {canManage && record.documentUrl && onRemoveDocument && !(isPayChangePage && record.status === 'APPROVED') ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onRemoveDocument(record)}>
                Remove document
              </Button>
            ) : null}
            {canManage && onRequestDocument && !(isPayChangePage && record.status === 'APPROVED') ? (
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void onRequestDocument(record)}>
                Re-request
              </Button>
            ) : null}
          </span>
        </div>
        );
      })}
    </div>
  );
}

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
  const [selectedDay, setSelectedDay] = useState(() => toDateInput(new Date()));

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
  const selectedDayDate = useMemo(() => new Date(`${selectedDay}T00:00:00`), [selectedDay]);
  const selectedDayLeave = leave.filter((item) => leaveOverlapsDay(item, selectedDayDate));

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

  function selectLeaveDay(day: Date) {
    const dayKey = toDateInput(day);
    setSelectedDay(dayKey);
    setDraft((current) => ({
      ...current,
      staffProfileId: current.staffProfileId || staffFilter || activeStaff[0]?.id || '',
      startDate: dayKey,
      endDate: dayKey
    }));
  }

  function changeLeaveMonth(offset: -1 | 1) {
    const next = new Date(monthStart.getFullYear(), monthStart.getMonth() + offset, 1);
    setMonthStart(next);
    selectLeaveDay(next);
  }

  function jumpToCurrentLeaveMonth() {
    const today = new Date();
    const next = new Date(today.getFullYear(), today.getMonth(), 1);
    setMonthStart(next);
    selectLeaveDay(today);
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
      setDraft({
        ...leaveDraftFor(activeStaff),
        staffProfileId: draft.staffProfileId,
        startDate: selectedDay,
        endDate: selectedDay
      });
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

      <div className="leave-board-layout">
        <Card className="leave-calendar-card" title="Month view" subtitle="Click any day to add leave or review who is already away.">
          <div className="roster-week-controls leave-month-controls">
            <Button type="button" variant="secondary" size="sm" onClick={() => changeLeaveMonth(-1)}>
              Previous
            </Button>
            <strong>{monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</strong>
            <Button type="button" variant="secondary" size="sm" onClick={() => changeLeaveMonth(1)}>
              Next
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={jumpToCurrentLeaveMonth}>
              Today
            </Button>
          </div>
          <div className="leave-calendar-grid" role="grid" aria-label="Staff leave calendar">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <strong key={day} className="leave-calendar-heading">{day}</strong>
            ))}
            {calendarDays.map((day) => {
              const dayKey = toDateInput(day);
              const dayLeave = leave.filter((item) => leaveOverlapsDay(item, day));
              const outsideMonth = day.getMonth() !== monthStart.getMonth();
              const selected = dayKey === selectedDay;
              return (
                <button
                  key={dayKey}
                  type="button"
                  className={`leave-calendar-day${outsideMonth ? ' is-muted' : ''}${selected ? ' is-selected' : ''}${dayLeave.length ? ' has-leave' : ''}`}
                  aria-pressed={selected}
                  onClick={() => selectLeaveDay(day)}
                >
                  <span className="leave-calendar-date">{day.getDate()}</span>
                  {dayLeave.slice(0, 3).map((item) => (
                    <span key={item.id} className={`leave-pill is-${item.status.toLowerCase()}`}>
                      {item.staffProfile?.firstName ?? 'Staff'} · {leaveStatusLabel(item.status)}
                    </span>
                  ))}
                  {dayLeave.length > 3 ? <small className="subtle">+{dayLeave.length - 3} more</small> : null}
                  {dayLeave.length === 0 ? <small className="leave-day-empty">Click to add</small> : null}
                </button>
              );
            })}
          </div>
        </Card>

        <aside className="leave-day-panel">
          <Card
            title={selectedDayDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            subtitle={`${selectedDayLeave.length} leave record${selectedDayLeave.length === 1 ? '' : 's'} on this day`}
          >
            {selectedDayLeave.length ? (
              <div className="leave-day-list">
                {selectedDayLeave.map((item) => (
                  <div key={item.id} className="leave-day-item">
                    <span>
                      <strong>{item.staffProfile ? `${item.staffProfile.firstName} ${item.staffProfile.lastName}` : 'Staff member'}</strong>
                      <small>{leaveTypeLabel(item.type)} · {formatRange(new Date(item.startDate), new Date(item.endDate))}</small>
                    </span>
                    <Badge tone={leaveStatusTone(item.status)}>{leaveStatusLabel(item.status)}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No leave on this day" description="Use the form below to record leave for this date." />
            )}
          </Card>

          <Card title="Add leave" subtitle="The selected calendar day is prefilled. Extend the end date for longer leave.">
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

          <Card title="Filters" subtitle="Narrow the board without changing saved records.">
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
        </aside>
      </div>

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
  // Leave requests overlapping the displayed week — drives the on-leave
  // overlay on roster cells so managers don't have to cross-check leave
  // before scheduling a shift.
  const [leaveOverlays, setLeaveOverlays] = useState<StaffLeaveRequest[]>([]);
  // Deputy stop-gap import modal — open via the editorial header button.
  const [deputyImportOpen, setDeputyImportOpen] = useState(false);
  const [draggingShiftId, setDraggingShiftId] = useState<string | null>(null);
  const [staffDropTargetShiftId, setStaffDropTargetShiftId] = useState<string | null>(null);
  const [shiftContextMenu, setShiftContextMenu] = useState<RosterShiftContextMenu | null>(null);
  const [publishPreviewOpen, setPublishPreviewOpen] = useState(false);
  // Roster delete controls: one "Delete" dropdown + a section/area picker.
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const [sidePanelMode, setSidePanelMode] = useState<RosterSidePanelMode>('staff');
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(new Set());
  const [collapsedVenues, setCollapsedVenues] = useState<Set<string>>(new Set());
  const [forecastDraft] = useState(loadRosterForecastDraft);
  const [forecastSales, setForecastSales] = useState(forecastDraft.forecastSales);
  const [dailyForecastSales, setDailyForecastSales] = useState<Record<string, string>>(forecastDraft.dailyForecastSales);
  const [targetWagePercent, setTargetWagePercent] = useState(forecastDraft.targetWagePercent);
  const [closedDaysByScope] = useState(loadRosterClosedDays);
  const [rosterAreaSettings] = useState(loadRosterAreaSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [staffCardHover, setStaffCardHover] = useState<{
    member: StaffProfile;
    memberShifts: RosterShift[];
    memberHours: number;
    rateLabel: string;
    costLabel: string;
    x: number;
    y: number;
  } | null>(null);
  const [mobileSelectedDay, setMobileSelectedDay] = useState(() => toDateInput(new Date()));
  const isMobileRoster = useRosterMobileMode();
  const days = useMemo(() => weekDays(weekStart, boardDays), [boardDays, weekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, boardDays), [boardDays, weekStart]);
  const venues = useMemo(() => uniqueValues(staff.map((member) => member.venue).filter(Boolean) as string[]), [staff]);
  // Roster only shows staff who can actually work a shift. Exclude both
  // ARCHIVED and TERMINATED; keep PENDING (new hires about to start are
  // commonly rostered ahead of their first shift).
  const activeStaff = useMemo(
    () =>
      staff.filter(
        (member) => member.employmentStatus !== 'ARCHIVED' && member.employmentStatus !== 'TERMINATED'
      ),
    [staff]
  );
  // O(1) pay-rate lookups — avoids O(N) staff.find() inside every reduce/map
  const staffById = useMemo(() => new Map(staff.map((m) => [m.id, m])), [staff]);
  const venueRoster = useMemo(() => roster
    .filter((shift) => venueFilter === 'all' || shift.venue === venueFilter || shift.staffProfile?.venue === venueFilter)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
    [roster, venueFilter]
  );
  const visibleRoster = useMemo(() => venueRoster
    .filter((shift) => statusFilter === 'all' || shift.status === statusFilter),
    [venueRoster, statusFilter]
  );
  const publishableDrafts = useMemo(() => venueRoster.filter((shift) => shift.status === 'DRAFT'), [venueRoster]);
  const draftCount = publishableDrafts.length;
  const rosteredStaffIds = useMemo(() => new Set(visibleRoster.map((shift) => shift.staffProfileId)), [visibleRoster]);
  const totalHours = useMemo(() => visibleRoster.reduce((sum, shift) => sum + shiftHours(shift), 0), [visibleRoster]);
  const averageRateCents = useMemo(() => {
    const rates = activeStaff
      .map((member) => member.trainingPayRateCents ?? member.payRateCents ?? 0)
      .filter((rate) => rate > 0);
    return rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : 3200;
  }, [activeStaff]);
  const rosterCostCents = useMemo(() => visibleRoster.reduce((sum, shift) => {
    const member = staffById.get(shift.staffProfileId);
    const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
    return sum + Math.round(shiftHours(shift) * rateCents);
  }, 0), [averageRateCents, staffById, visibleRoster]);
  const operationalVenues = useMemo(() => venues.some((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    ? venues.filter((venue) => venue === 'Alma Avalon' || venue === 'St Alma')
    : venues, [venues]);
  const forecastVenues = useMemo(() => venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both'), [operationalVenues, venueFilter]);
  const rosterClosedVenueScope = useMemo(() => venueFilter === 'all' ? operationalVenues : [venueFilter].filter((venue) => venue && venue !== 'all' && venue !== 'Both'), [operationalVenues, venueFilter]);
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
  const closedDayCount = useMemo(() => days.reduce((sum, day) => sum + closedVenuesForDay(day).length, 0), [closedVenuesForDay, days]);
  const historicalDailyForecast = useMemo(() => days.reduce((map, day) => {
    const cents = Math.round(
      forecastVenues.reduce((sum, venue) => sum + historicalSalesForDate(venue, day), 0) * 100
    );
    map[toDateInput(day)] = cents;
    return map;
  }, {} as Record<string, number>), [days, forecastVenues]);
  const historicalForecastSalesCents = useMemo(() => Object.values(historicalDailyForecast).reduce((sum, cents) => sum + cents, 0), [historicalDailyForecast]);
  const forecastHasManualDailyInputs = useMemo(() => days.some((day) => parseMoneyCents(dailyForecastSales[toDateInput(day)] ?? '') > 0), [dailyForecastSales, days]);
  // Sum of MANUAL per-day forecast inputs only. Previously this fell
  // through to the historical daily forecast when no per-day inputs
  // were set — but that meant typing $50,000 into the weekly forecast
  // field was silently overridden by ~$57,992 of historical sales,
  // and labour-% maths used the historical number instead of the user
  // input. Now the historical fallback only kicks in at the top level
  // (when both daily and weekly are empty).
  const dailyForecastTotalCents = useMemo(() => days.reduce((sum, day) => {
    const key = toDateInput(day);
    return sum + parseMoneyCents(dailyForecastSales[key] ?? '');
  }, 0), [dailyForecastSales, days]);
  // Priority for the weekly aggregate: per-day manual sum → weekly
  // manual input → historical reference. Whichever the user actually
  // touched most recently wins.
  const forecastSalesCents = useMemo(() => {
    if (dailyForecastTotalCents > 0) return dailyForecastTotalCents;
    const weekly = parseMoneyCents(forecastSales);
    if (weekly > 0) return weekly;
    return historicalForecastSalesCents;
  }, [dailyForecastTotalCents, forecastSales, historicalForecastSalesCents]);
  const wageBudgetCents = useMemo(() => Math.round(forecastSalesCents * (parsePercent(targetWagePercent) / 100)), [forecastSalesCents, targetWagePercent]);
  const recommendedHours = averageRateCents > 0 ? wageBudgetCents / averageRateCents : 0;
  const forecastCostGapCents = wageBudgetCents - rosterCostCents;
  const forecastHoursGap = recommendedHours - totalHours;
  const missingRateStaff = useMemo(() => activeStaff.filter((member) =>
    rosteredStaffIds.has(member.id) &&
    !member.payRateCents &&
    !member.trainingPayRateCents
  ), [activeStaff, rosteredStaffIds]);
  const publishedCount = useMemo(() => visibleRoster.filter((shift) => shift.status === 'PUBLISHED').length, [visibleRoster]);
  const targetWagePercentParsed = useMemo(() => parsePercent(targetWagePercent) / 100, [targetWagePercent]);
  const dailySummaries = useMemo(() => days.map((day) => {
    const shifts = visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), day));
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = staffById.get(shift.staffProfileId);
      const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
      return sum + Math.round(shiftHours(shift) * rateCents);
    }, 0);
    const dayKey = toDateInput(day);
    const manualCents = parseMoneyCents(dailyForecastSales[dayKey] ?? '');
    const forecastCents = manualCents || (!forecastHasManualDailyInputs ? historicalDailyForecast[dayKey] ?? 0 : 0);
    const budgetCents = Math.round(forecastCents * targetWagePercentParsed);
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
  }), [averageRateCents, dailyForecastSales, days, forecastHasManualDailyInputs, historicalDailyForecast, staffById, targetWagePercentParsed, visibleRoster]);
  const mobileSelectedDate = useMemo(() => new Date(`${mobileSelectedDay}T00:00:00`), [mobileSelectedDay]);
  const mobileSelectedSummary = useMemo(() => dailySummaries.find((summary) => sameDay(summary.day, mobileSelectedDate)), [dailySummaries, mobileSelectedDate]);
  const mobileDayShifts = useMemo(() => visibleRoster.filter((shift) => sameDay(new Date(shift.startsAt), mobileSelectedDate)), [mobileSelectedDate, visibleRoster]);
  const rowSearch = useMemo(() => search.trim().toLowerCase(), [search]);
  const allRosterAreas = useMemo(
    () => mergeRosterAreas(rosterAreaSettings, visibleRoster.map((shift) => shift.area || 'Shift')),
    [rosterAreaSettings, visibleRoster]
  );
  // Distinct area values present in the currently-visible roster — drives
  // the "Delete by location/area" bulk-delete control.
  const bulkDeleteAreas = useMemo(
    () => uniqueValues(visibleRoster.map((shift) => shift.area || 'Shift')),
    [visibleRoster]
  );
  const unallocatedShiftCount = useMemo(
    () => visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length,
    [visibleRoster]
  );
  const hiddenAreaNames = useMemo(() => new Set(rosterAreaSettings.hidden.map(normaliseRosterAreaKey)), [rosterAreaSettings.hidden]);
  const activeAreas = useMemo(
    () => allRosterAreas.filter((areaName) => !hiddenAreaNames.has(normaliseRosterAreaKey(areaName))),
    [allRosterAreas, hiddenAreaNames]
  );
  const areaSelectOptions = useMemo(
    () => uniqueValues([...allRosterAreas, area || 'Floor']).map((item) => ({ label: item, value: item })),
    [allRosterAreas, area]
  );
  const areaVenues = useMemo(
    () => uniqueValues([
      ...(venueFilter === 'all' ? operationalVenues : [venueFilter]),
      ...visibleRoster.map((shift) => shift.venue || shift.staffProfile?.venue || '').filter(Boolean)
    ]).filter((venue) => venue && venue !== 'all' && venue !== 'Both'),
    [operationalVenues, venueFilter, visibleRoster]
  );
  const splitAreaRows = useMemo(() => areaVenues.flatMap((venue) =>
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
  ), [activeAreas, areaVenues, visibleRoster]);
  const mobileVenueGroups: MobileRosterVenueGroup[] = useMemo(() => areaVenues
    .map((venue) => {
      const areaRows = splitAreaRows
        .filter((row) => row.venue === venue)
        .filter((row) => `${row.venue} ${row.label} ${row.sublabel}`.toLowerCase().includes(rowSearch))
        .map((row) => ({
          area: row.area || row.label,
          shifts: row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), mobileSelectedDate))
        }))
        .filter((row) => row.shifts.length > 0);
      const shifts = areaRows.flatMap((row) => row.shifts);
      return {
        venue,
        initials: venue.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
        shifts,
        areas: areaRows
      };
    })
    .filter((group) => group.shifts.length > 0), [areaVenues, mobileSelectedDate, rowSearch, splitAreaRows]);
  const venueForecastRows = useMemo(() => forecastVenues.map((venue) => {
    const shifts = visibleRoster.filter((shift) => shift.venue === venue || shift.staffProfile?.venue === venue);
    const plannedHours = shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
    const plannedCostCents = shifts.reduce((sum, shift) => {
      const member = staffById.get(shift.staffProfileId);
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
  }), [averageRateCents, dailyForecastSales, days, forecastSales, forecastVenues, staffById, targetWagePercent, venueFilter, visibleRoster]);
  const publishWarnings = useMemo(() => {
    const unallocatedCount = visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length;
    const noVenueCount = visibleRoster.filter((shift) => !shift.venue && !shift.staffProfile?.venue).length;
    const overlapCount = countRosterOverlaps(visibleRoster);
    return [
      ...(forecastSalesCents > 0 && forecastCostGapCents < 0
        ? [`Roster is ${formatCents(Math.abs(forecastCostGapCents))} over the forecast wage budget.`]
        : []),
      ...(missingRateStaff.length
        ? [`${missingRateStaff.length} rostered staff member${missingRateStaff.length === 1 ? '' : 's'} missing pay rates.`]
        : []),
      ...(unallocatedCount > 0
        ? [`${unallocatedCount} unallocated shift${unallocatedCount === 1 ? '' : 's'} still need a real staff member.`]
        : []),
      ...(noVenueCount > 0
        ? [`${noVenueCount} shift${noVenueCount === 1 ? '' : 's'} missing a venue.`]
        : []),
      ...(overlapCount > 0
        ? [`${overlapCount} overlapping shift conflict${overlapCount === 1 ? '' : 's'} found.`]
        : [])
    ];
  }, [forecastCostGapCents, forecastSalesCents, missingRateStaff, visibleRoster]);
  const areaGuidanceRows = useMemo(() => areaVenues.flatMap((venue) => activeAreas.map((areaName) => {
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
  })).filter((row) => row.plannedHours > 0 || row.recommendedHours > 0),
  [activeAreas, areaVenues, averageRateCents, dailySummaries, days, venueForecastRows, visibleRoster, weekStart]);
  const selectedMember = useMemo(() => staffById.get(staffProfileId ?? ''), [staffById, staffProfileId]);
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
  // Leave clashes — if the staff is on approved/pending leave during the
  // shift window, surface it so we can hard-block the save.
  const shiftLeaveClashes = useMemo(() => {
    if (!selectedShiftHours || !staffProfileId) return [];
    const start = selectedShiftHours.startsAt;
    return leaveOverlays.filter((leave) => {
      if (leave.staffProfileId !== staffProfileId) return false;
      if (leave.status === 'CANCELLED' || leave.status === 'DECLINED') return false;
      return leaveOverlapsDay(leave, start);
    });
  }, [leaveOverlays, selectedShiftHours, staffProfileId]);
  const hasHardClash = shiftConflicts.length > 0 || shiftLeaveClashes.length > 0;
  const canSaveShift = Boolean(staffProfileId && date && startTime && endTime && selectedShiftHours) && !hasHardClash;
  const scheduleRows: RosterScheduleRow[] = useMemo(() =>
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
          }, []),
  [activeStaff, rowSearch, splitAreaRows, viewMode, visibleRoster]);
  const activeSidePanelMode: RosterSidePanelMode =
    sidePanelMode === 'shift' && !editorOpen ? 'staff' : sidePanelMode;
  const sidePanelStaff = useMemo(() => activeStaff
    .filter((member) => venueFilter === 'all' || member.venue === venueFilter)
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)),
  [activeStaff, venueFilter]);
  const scheduleGridStyle = useMemo<CSSProperties>(() => {
    const sideRailOpen = !sidePanelCollapsed;
    const labelColumn = sideRailOpen ? 'minmax(88px, 0.46fr)' : 'minmax(96px, 0.42fr)';
    const openColumn =
      boardDays === 14
        ? sideRailOpen
          ? 'minmax(72px, 1fr)'
          : 'minmax(84px, 1fr)'
        : sideRailOpen
          ? 'minmax(98px, 1fr)'
          : 'minmax(116px, 1fr)';
    const closedColumn = boardDays === 14 ? 'minmax(34px, 0.16fr)' : 'minmax(40px, 0.2fr)';
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

  // Pull leave overlapping the displayed roster window — PENDING and
  // APPROVED only, so cancelled/rejected leave doesn't ghost the cells.
  useEffect(() => {
    void (async () => {
      try {
        const params = new URLSearchParams({
          start: toDateInput(weekStart),
          end: toDateInput(addDays(weekEnd, -1))
        });
        const leave = await api<StaffLeaveRequest[]>(`/api/staff/leave?${params.toString()}`);
        setLeaveOverlays(
          leave.filter((item) => item.status === 'PENDING' || item.status === 'APPROVED')
        );
      } catch {
        setLeaveOverlays([]);
      }
    })();
  }, [weekStart, weekEnd]);

  useEffect(() => {
    const selectedDate = new Date(`${mobileSelectedDay}T00:00:00`);
    if (!isDateInRange(selectedDate, weekStart, weekEnd)) {
      setMobileSelectedDay(toDateInput(weekStart));
    }
  }, [mobileSelectedDay, weekEnd, weekStart]);

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
    const selectedMobileDate = new Date(`${mobileSelectedDay}T00:00:00`);
    if (!isDateInRange(selectedMobileDate, nextWeekStart, addDays(nextWeekStart, boardDays))) {
      setMobileSelectedDay(toDateInput(nextWeekStart));
    }
  }

  function openShiftPanel() {
    setEditorOpen(true);
  }

  function closeShiftPanel() {
    setEditingShift(null);
    setEditorOpen(false);
  }

  function newShift(preferredDate?: string) {
    setEditingShift(null);
    openShiftPanel();
    setDate((current) => {
      if (preferredDate) return preferredDate;
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
    // Hard block — staff on leave can't be rostered for this window.
    // No prompt-to-override, they need to clear the leave first.
    if (shiftLeaveClashes.length > 0) {
      const leave = shiftLeaveClashes[0]!;
      setMessage(
        `${selectedMember?.firstName ?? 'This team member'} is on ${leave.type.toLowerCase().replace('_', ' ')} this day. Resolve the leave request first or pick a different person.`
      );
      return;
    }
    // Hard block — staff already rostered overlapping (at this venue or
    // any other) can't be double-booked. They need to be released from
    // the existing shift first.
    if (shiftConflicts.length > 0) {
      const clash = shiftConflicts[0]!;
      const clashVenue = clash.venue || clash.staffProfile?.venue || 'another venue';
      setMessage(
        `${selectedMember?.firstName ?? 'This team member'} is already rostered ${timeOf(clash.startsAt)}–${timeOf(clash.endsAt)} at ${clashVenue}. Release that shift first or pick a different person.`
      );
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

  async function bulkDeleteRoster(
    scope: 'this-week' | 'next-week' | 'visible' | 'reset-all' | 'unallocated' | 'area',
    selectedArea?: string
  ) {
    setShiftContextMenu(null);
    setDeleteMenuOpen(false);
    setSectionMenuOpen(false);
    const venueLabel = venueFilter === 'all' ? 'all venues' : venueFilter;
    const venueParam = venueFilter === 'all' ? '' : venueFilter;
    const nextStart = addDays(weekStart, boardDays);
    const nextEnd = addDays(weekEnd, boardDays);

    // -1 scopeCount means "can't pre-count" (next week / reset-all aren't
    // loaded into the board) — skip the empty-view short-circuit for those.
    let scopeCount = 0;
    let confirmMessage = '';
    let body: Record<string, unknown>;

    if (scope === 'this-week') {
      scopeCount = visibleRoster.length;
      confirmMessage = `Delete ALL ${scopeCount} shift${scopeCount === 1 ? '' : 's'} for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'all' };
    } else if (scope === 'next-week') {
      scopeCount = -1;
      confirmMessage = `Delete every shift for ${venueLabel} NEXT week? This cannot be undone.`;
      body = { start: nextStart.toISOString(), end: nextEnd.toISOString(), venue: venueParam, filter: 'all' };
    } else if (scope === 'visible') {
      const ids = visibleRoster.map((shift) => shift.id);
      scopeCount = ids.length;
      confirmMessage = `Delete the ${scopeCount} shift${scopeCount === 1 ? '' : 's'} currently visible for ${venueLabel}? This respects your active filters and cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'ids', ids };
    } else if (scope === 'reset-all') {
      scopeCount = -1;
      confirmMessage = `RESET ALL ROSTER DATA for ${venueLabel}? This permanently deletes every shift across every week. This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'reset-all' };
    } else if (scope === 'unallocated') {
      scopeCount = visibleRoster.filter((shift) => isUnallocatedProfile(shift.staffProfile)).length;
      confirmMessage = `Delete ${scopeCount} unallocated shift${scopeCount === 1 ? '' : 's'} for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'unallocated' };
    } else {
      if (!selectedArea) return;
      scopeCount = visibleRoster.filter((shift) => (shift.area || 'Shift') === selectedArea).length;
      confirmMessage = `Delete ${scopeCount} shift${scopeCount === 1 ? '' : 's'} in the ${selectedArea} section for ${venueLabel} this week? This cannot be undone.`;
      body = { start: weekStart.toISOString(), end: weekEnd.toISOString(), venue: venueParam, filter: 'area', area: selectedArea };
    }

    if (scopeCount === 0) {
      setMessage('No shifts to delete in this view.');
      setMessageTarget('shift-delete');
      return;
    }
    if (!window.confirm(confirmMessage)) return;
    // Reset-all is destructive enough to warrant a second confirm.
    if (scope === 'reset-all' && !window.confirm('Are you absolutely sure? This wipes the entire roster for every week.')) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget('shift-delete');
    try {
      const { deleted } = await api<{ deleted: number }>('/api/staff/roster/bulk-delete', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      await reload(weekStart, weekEnd);
      setMessage(`Deleted ${deleted} shift${deleted === 1 ? '' : 's'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete shifts.');
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

  // "Import from Deputy" now runs the same full Deputy auto-sync the admin
  // Integration Health page triggers (roster + employees + documents),
  // instead of the manual CSV paste flow.
  async function syncDeputyNow() {
    setSaving(true);
    setMessage(null);
    setMessageTarget('copy-week');
    try {
      const result = await api<{
        roster?: { shiftsCreated: number };
        employees?: { created: number; updated: number };
        documents?: { complianceCreated: number; reviewsCreated: number };
      }>('/api/integrations/deputy/sync-all', { method: 'POST' });
      const parts: string[] = [];
      if (result.roster) parts.push(`${result.roster.shiftsCreated} shifts`);
      if (result.employees) parts.push(`${result.employees.created} new staff, ${result.employees.updated} updated`);
      if (result.documents) parts.push(`${result.documents.complianceCreated + result.documents.reviewsCreated} docs`);
      await reload(weekStart, weekEnd);
      setMessage(`Deputy sync complete${parts.length ? ` — ${parts.join(', ')}` : ''}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not sync Deputy.');
    } finally {
      setSaving(false);
    }
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

  function toggleRowCollapsed(rowId: string) {
    setCollapsedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
      return next;
    });
  }

  function toggleVenueCollapsed(venue: string) {
    setCollapsedVenues((prev) => {
      const next = new Set(prev);
      if (next.has(venue)) next.delete(venue); else next.add(venue);
      return next;
    });
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

  function handleStaffBubbleDragStart(event: DragEvent<HTMLButtonElement>, member: StaffProfile) {
    event.dataTransfer.setData('text/plain', `staff:${member.id}`);
    event.dataTransfer.effectAllowed = 'copyMove';
    const ghost = document.createElement('div');
    ghost.textContent = `${member.firstName} ${member.lastName}`;
    ghost.style.cssText = 'position:fixed;top:-999px;left:-999px;padding:6px 14px;background:#fff;border:1.5px solid #d0d5dd;border-radius:20px;font-size:13px;font-weight:600;font-family:inherit;box-shadow:0 4px 12px rgba(0,0,0,0.15);white-space:nowrap;pointer-events:none;';
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }

  async function handleDropOnShift(event: DragEvent<HTMLElement>, shift: RosterShift) {
    event.preventDefault();
    event.stopPropagation();
    const data = event.dataTransfer.getData('text/plain');
    if (!data.startsWith('staff:')) return;
    const memberId = data.slice('staff:'.length);
    const member = staffById.get(memberId);
    if (!member) return;
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/roster/${shift.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          staffProfileId: member.id,
          venue: member.venue ?? shift.venue,
          area: shift.area,
          roleTitle: member.roleTitle ?? shift.roleTitle ?? '',
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
          breakMinutes: shift.breakMinutes,
          status: shift.status,
          notes: shift.notes ?? ''
        })
      });
      await reload(weekStart, weekEnd);
      setMessage(`Assigned ${member.firstName} ${member.lastName} to shift.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reassign shift.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDrop(event: DragEvent<HTMLButtonElement>, row: (typeof scheduleRows)[number], day: Date) {
    event.preventDefault();
    const data = event.dataTransfer.getData('text/plain');
    // Staff bubble dropped onto an empty cell → open shift editor for that person
    if (data.startsWith('staff:')) {
      const memberId = data.slice('staff:'.length);
      const member = staffById.get(memberId);
      if (!member) return;
      openShiftPanel();
      setEditingShift(null);
      setDate(toDateInput(day));
      setStaffProfileId(member.id);
      setShiftVenue(member.venue ?? row.venue ?? '');
      setRoleTitle(member.roleTitle ?? '');
      setArea(row.area ?? area);
      setShiftStatus('DRAFT');
      return;
    }
    const shift = roster.find((item) => item.id === data);
    if (!shift) return;
    await moveShiftToCell(shift, row, day);
  }

  const activeFilterChips = [
    search.trim()
      ? {
          key: 'search',
          label: `Search: ${search.trim()}`,
          clear: () => setSearch('')
        }
      : null,
    venueFilter !== 'all'
      ? {
          key: 'venue',
          label: `Venue: ${venueFilter}`,
          clear: () => setVenueFilter('all')
        }
      : null,
    statusFilter !== 'all'
      ? {
          key: 'status',
          label: `Status: ${statusFilter.toLowerCase()}`,
          clear: () => setStatusFilter('all')
        }
      : null
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;
  const rosterRangeEnd = addDays(weekStart, boardDays - 1);
  const viewOptionsSummary = `${viewMode === 'team' ? 'Team member' : 'Area'} · ${boardDays === 7 ? 'Week' : '2 weeks'}`;
  const toolSummary = draftCount > 0 ? `${draftCount} draft${draftCount === 1 ? '' : 's'} ready` : 'Copy, review and publish';

  // Wage % of forecast revenue for the KPI strip
  const wagePercent = forecastSalesCents > 0
    ? ((rosterCostCents / forecastSalesCents) * 100)
    : null;
  const wageGuide = parsePercent(targetWagePercent);
  const wageTone: 'success' | 'warn' | 'danger' | 'neutral' = wagePercent == null
    ? 'neutral'
    : wagePercent > wageGuide + 2
      ? 'danger'
      : wagePercent > wageGuide
        ? 'warn'
        : 'success';

  // Forecast variance — how far off-guide we are as a percent. Drives the
  // red-down / green-up pill on the KPI strip and the tint on issue cards.
  const wageBudgetVariancePercent = wageBudgetCents > 0
    ? ((rosterCostCents - wageBudgetCents) / wageBudgetCents) * 100
    : null;
  const isOverBudget = (wageBudgetVariancePercent ?? 0) > 0;
  const isWayOverBudget = (wageBudgetVariancePercent ?? 0) > 10;
  const wageBudgetTone: 'success' | 'warn' | 'danger' | 'neutral' = wageBudgetVariancePercent == null
    ? 'neutral'
    : wageBudgetVariancePercent > 5
      ? 'danger'
      : wageBudgetVariancePercent > 0
        ? 'warn'
        : 'success';
  function formatVariance(pct: number | null): string {
    if (pct == null) return '—';
    if (Math.abs(pct) < 0.5) return '~ on budget';
    return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
  }
  const coverageGap = draftCount === 0 && totalHours < recommendedHours - 2;

  return (
    <div className="page-stack">
      {/* Editorial roster header — eyebrow + Cormorant serif title + week nav */}
      <div className="alma-roster-header">
        <div className="alma-roster-header-titles">
          <span className="alma-roster-eyebrow">Staff · Roster</span>
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, rosterRangeEnd)}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => setRosterWeek(addDays(weekStart, -7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => setRosterWeek(addDays(weekStart, 7))}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => {
                  const today = new Date();
                  setWeekStart(startOfWeek(today));
                  setDate(toDateInput(today));
                  setMobileSelectedDay(toDateInput(today));
                }}
              >
                This week
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                disabled={saving}
                onClick={() => void syncDeputyNow()}
                title="Run a full Deputy sync now — pulls the latest roster, staff, and documents from Deputy."
              >
                Import from Deputy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* The 5-card KPI strip used to live here. Everything it showed
          (planned hours, wage cost, wage %, drafts, status) is now in
          the forecast hairline + metric strip above the schedule grid,
          so this top block was wasting ~150px of vertical space without
          adding new information. */}

      {/* Editorial filter strip — search + venue + status + view mode + chips,
          all consolidated into one tidy row in the editorial chrome. The
          duplicate prev/next/today nav and Copy/Review/Publish buttons
          previously here are now handled by the editorial header above. */}
      <div className="alma-roster-toolbar">
        <div className="alma-roster-toolbar-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16" y1="16" x2="21" y2="21" strokeLinecap="round" />
          </svg>
          <input
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder="Search team or area"
            aria-label="Search"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <Select
          aria-label="Venue"
          value={venueFilter}
          onChange={(event) => setVenueFilter(event.currentTarget.value)}
          options={[{ label: 'All venues', value: 'all' }, ...venues.map((venue) => ({ label: venue, value: venue }))]}
        />
        <Select
          aria-label="Status"
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
        <div className="alma-segmented" aria-label="Schedule view">
          <button type="button" className={viewMode === 'team' ? 'is-active' : ''} onClick={() => setViewMode('team')}>Team</button>
          <button type="button" className={viewMode === 'area' ? 'is-active' : ''} onClick={() => setViewMode('area')}>Area</button>
        </div>
        <div className="alma-segmented" aria-label="Roster range">
          <button type="button" className={boardDays === 7 ? 'is-active' : ''} onClick={() => setBoardDays(7)}>Week</button>
          <button type="button" className={boardDays === 14 ? 'is-active' : ''} onClick={() => setBoardDays(14)}>2w</button>
        </div>
      </div>

      {/* Action row — sits directly under the search/filter strip so
          the actions and the filters they operate on read as one
          control block. */}
      <div className="alma-roster-actions">
        <Button type="button" size="sm" variant="secondary" onClick={() => newShift()}>
          Add shift
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void copyPreviousWeek()}>
          Copy last week
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setHistoricalOpen(true)}
          aria-label="Open historical forecast data"
        >
          Historical data{wageBudgetVariancePercent != null ? ` · ${formatVariance(wageBudgetVariancePercent)}` : ''}
        </Button>
        <label className="roster-forecast-inline roster-forecast-inline--utility" title="Forecast sales · target wage %">
          <span className="roster-forecast-inline-label">Forecast</span>
          <span className="roster-forecast-inline-prefix" aria-hidden="true">$</span>
          <input
            value={forecastSales}
            onChange={(event) => setForecastSales(event.currentTarget.value)}
            placeholder="Sales"
            aria-label="Weekly forecast sales"
          />
          <span className="forecast-sep">·</span>
          <input
            value={targetWagePercent}
            onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
            placeholder="28"
            aria-label="Target wage %"
          />
          <span className="roster-forecast-inline-suffix" aria-hidden="true">%</span>
        </label>
        <button
          type="button"
          className="alma-roster-publish"
          disabled={saving || draftCount === 0}
          onClick={() => setPublishPreviewOpen(true)}
        >
          <span>Publish roster</span>
          {draftCount > 0 ? <span className="alma-roster-publish-sub">{draftCount} {draftCount === 1 ? 'change' : 'changes'}</span> : null}
        </button>
        <div className="alma-roster-delete-controls" aria-label="Delete roster shifts">
          {/* Small red section button — delete a single area/section */}
          <div className="alma-roster-delete-wrap">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving || bulkDeleteAreas.length === 0}
              aria-haspopup="menu"
              aria-expanded={sectionMenuOpen}
              title="Delete a roster section"
              onClick={() => {
                setSectionMenuOpen((open) => !open);
                setDeleteMenuOpen(false);
              }}
            >
              Sections
            </Button>
            {sectionMenuOpen ? (
              <>
                <button
                  type="button"
                  className="alma-roster-delete-backdrop"
                  aria-label="Close section menu"
                  onClick={() => setSectionMenuOpen(false)}
                />
                <div className="alma-roster-delete-menu" role="menu">
                  <p className="alma-roster-delete-menu-head">Delete a section</p>
                  {bulkDeleteAreas.length === 0 ? (
                    <span className="alma-roster-delete-menu-empty">No sections to delete</span>
                  ) : (
                    bulkDeleteAreas.map((areaName) => (
                      <button
                        key={areaName}
                        type="button"
                        role="menuitem"
                        className="alma-roster-delete-menu-item is-danger"
                        onClick={() => void bulkDeleteRoster('area', areaName)}
                      >
                        {areaName}
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : null}
          </div>

          {/* Consolidated Delete dropdown — sits next to Publish */}
          <div className="alma-roster-delete-wrap">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={saving}
              aria-haspopup="menu"
              aria-expanded={deleteMenuOpen}
              rightIcon={<span aria-hidden="true">▾</span>}
              onClick={() => {
                setDeleteMenuOpen((open) => !open);
                setSectionMenuOpen(false);
              }}
            >
              Delete
            </Button>
            {deleteMenuOpen ? (
              <>
                <button
                  type="button"
                  className="alma-roster-delete-backdrop"
                  aria-label="Close delete menu"
                  onClick={() => setDeleteMenuOpen(false)}
                />
                <div className="alma-roster-delete-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    disabled={visibleRoster.length === 0}
                    onClick={() => void bulkDeleteRoster('this-week')}
                  >
                    This week
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    onClick={() => void bulkDeleteRoster('next-week')}
                  >
                    Next week
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item"
                    disabled={visibleRoster.length === 0}
                    onClick={() => void bulkDeleteRoster('visible')}
                  >
                    Visible shifts
                  </button>
                  <div className="alma-roster-delete-menu-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="alma-roster-delete-menu-item is-danger"
                    onClick={() => void bulkDeleteRoster('reset-all')}
                  >
                    Reset all data
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {activeFilterChips.length > 0 ? (
        <div className="alma-roster-active-chips" aria-label="Active roster filters">
          {activeFilterChips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.clear}>
              <span>{chip.label}</span>
              <span aria-hidden="true" className="alma-roster-active-chip-x">×</span>
            </button>
          ))}
        </div>
      ) : null}

      {messageTarget === 'copy-week' && message ? (
        <div className="alma-roster-toolbar-feedback">
          <ActionFeedback message={message} tone={message.includes('Could') ? 'error' : 'success'} />
        </div>
      ) : null}

      {historicalOpen ? (
        <div
          className="alma-historical-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Historical data and forecast"
          onClick={(event) => {
            if (event.target === event.currentTarget) setHistoricalOpen(false);
          }}
        >
          <div className="alma-historical-modal-panel">
            <div className="alma-historical-modal-head">
              <div>
                <span className="alma-roster-eyebrow">Roster · Forecast</span>
                <h2 className="alma-historical-modal-title">Historical data</h2>
                <p className="alma-historical-modal-sub">
                  {formatCents(forecastSalesCents)} forecast · {forecastCostGapCents >= 0 ? 'Inside guide' : 'Over guide'}
                  {wageBudgetVariancePercent != null ? ` · ${formatVariance(wageBudgetVariancePercent)} vs budget` : ''}
                </p>
              </div>
              <button
                type="button"
                className="alma-historical-modal-close"
                aria-label="Close historical data"
                onClick={() => setHistoricalOpen(false)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M3 3 L11 11 M11 3 L3 11" />
                </svg>
              </button>
            </div>
            <div className="alma-historical-modal-body">
        <div className="roster-historical-grid">
          {/* Left col: inputs + callout */}
          <div className="roster-historical-left">
            <div className="roster-historical-inputs">
              <Input
                label="Sales forecast"
                value={forecastSales}
                onChange={(event) => setForecastSales(event.currentTarget.value)}
                placeholder="$85,000"
              />
              <Input
                label="Wage target %"
                value={targetWagePercent}
                onChange={(event) => setTargetWagePercent(event.currentTarget.value)}
                placeholder="28"
              />
              <Button type="button" size="sm" variant="secondary" onClick={applyHistoricalForecast}>
                Use historical
              </Button>
              <ActionFeedback
                message={messageTarget === 'forecast' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
            </div>
            <div className={`roster-forecast-callout ${forecastCostGapCents >= 0 ? 'is-under' : ''}`}>
              <strong>{forecastCostGapCents >= 0 ? 'Inside wage guide' : 'Over wage guide'}</strong>
              <span>
                {forecastCostGapCents >= 0
                  ? `${formatCents(forecastCostGapCents)} remaining.`
                  : `${formatCents(Math.abs(forecastCostGapCents))} over guide.`}
              </span>
            </div>
            {missingRateStaff.length ? (
              <div className="roster-publish-guardrails">
                <strong>Pay rates missing</strong>
                <span>{missingRateStaff.map((m) => m.firstName).join(', ')}</span>
              </div>
            ) : null}
          </div>

          {/* Right col: metrics + day list */}
          <div className="roster-historical-right">
            <div className="roster-forecast-metrics roster-forecast-metrics-inline">
              <div><span>Forecast</span><strong>{formatCents(forecastSalesCents)}</strong></div>
              <div><span>Wage budget</span><strong>{formatCents(wageBudgetCents)}</strong></div>
              <div><span>Roster cost</span><strong>{formatCents(rosterCostCents)}</strong></div>
              <div><span>Gap</span><strong>{forecastHoursGap >= 0 ? `+${roundHours(forecastHoursGap)}h` : `${roundHours(forecastHoursGap)}h`}</strong></div>
            </div>
            <div className="roster-history-day-list roster-history-day-list-2col">
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
                  <small>{roundHours(summary.hours)} · {summary.wagePercent ? `${summary.wagePercent.toFixed(1)}%` : '—'}</small>
                </label>
              ))}
            </div>
          </div>
        </div>

        {areaGuidanceRows.length ? (
          <div className="roster-area-guidance roster-area-guidance-compact">
            <strong>Area guidance</strong>
            {areaGuidanceRows.map((row) => (
              <div key={`${row.venue}:${row.area}`}>
                <span>
                  <strong>{row.area}</strong>
                  <small>{row.venue} · {row.gap >= 0 ? `+${roundHours(row.gap)}h` : `${roundHours(Math.abs(row.gap))}h`}</small>
                </span>
                <small>{row.day.toLocaleDateString(undefined, { weekday: 'short' })}</small>
                <Button type="button" size="sm" variant="secondary" onClick={() => applyRosterRecommendation(row)}>
                  Apply
                </Button>
              </div>
            ))}
          </div>
        ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {message && !messageTarget ? (
        <div className="deputy-roster-summary">
          <span className="deputy-roster-message">{message}</span>
        </div>
      ) : null}

      {isMobileRoster ? (
        <div data-roster-view="mobile" className="mobile-roster-runtime">
          <MobileRosterView
            dailySummaries={dailySummaries}
            selectedDate={mobileSelectedDate}
            selectedSummary={mobileSelectedSummary}
            shifts={mobileDayShifts}
            venueGroups={mobileVenueGroups}
            venueLabel={venueFilter === 'all' ? 'All venues' : venueFilter}
            onSelectDay={setMobileSelectedDay}
            onAddShift={() => newShift(mobileSelectedDay)}
            onOpenShift={startEditShift}
          />

        </div>
      ) : null}

      {!isMobileRoster ? (
        <div data-roster-view="desktop" className={`deputy-roster-layout desktop-roster-surface ${sidePanelCollapsed ? 'is-side-collapsed' : 'is-side-open'}`}>
        <section className="deputy-schedule-panel" aria-label="Weekly roster grid">
          {/* One-line natural-language summary above the metric strip —
              the executive read; pills below are the breakdown. */}
          {(() => {
            if (forecastSalesCents === 0 && rosterCostCents === 0) return null;
            const targetPct = parsePercent(targetWagePercent);
            const wagePct = forecastSalesCents > 0 ? (rosterCostCents / forecastSalesCents) * 100 : null;
            const gap = wagePct != null ? wagePct - targetPct : null;
            const status = gap == null
              ? null
              : Math.abs(gap) < 0.5
                ? 'on target'
                : gap > 0
                  ? `${gap.toFixed(1)}% over target`
                  : `${Math.abs(gap).toFixed(1)}% under target`;
            return (
              <p className="roster-forecast-summary" aria-live="polite">
                {forecastSalesCents > 0 ? (
                  <>
                    Forecasting <strong>{formatCents(forecastSalesCents)}</strong>
                    {' · planning '}
                    <strong>{formatCents(rosterCostCents)}</strong>
                    {wagePct != null ? <> <em>({wagePct.toFixed(1)}%)</em></> : null}
                    {status ? <>{' · '}<em>{status}</em></> : null}
                  </>
                ) : (
                  <>
                    Planning <strong>{formatCents(rosterCostCents)}</strong>
                    {' · '}
                    <em>set a weekly forecast to see target variance</em>
                  </>
                )}
              </p>
            );
          })()}

          <div className="roster-board-command roster-board-command--inline" aria-label={`Roster board · ${boardDays === 7 ? '7 day' : '14 day'} · ${venueFilter === 'all' ? `${areaVenues.length} venues` : venueFilter}`}>
            <div className="roster-board-command-meta" aria-label="Roster board summary">
              <span><strong>{scheduleRows.filter((row) => !('isVenueHeader' in row && row.isVenueHeader)).length}</strong> rows</span>
              <span><strong>{visibleRoster.length}</strong> shifts</span>
              <span><strong>{roundHours(totalHours)}</strong> hours</span>
              <span><strong>{publishedCount}</strong> live</span>
              {draftCount ? <span className="is-warning"><strong>{draftCount}</strong> drafts</span> : null}
              {(() => {
                const wagePct = forecastSalesCents > 0 ? (rosterCostCents / forecastSalesCents) * 100 : null;
                const targetPct = parsePercent(targetWagePercent);
                const overBudget = wageBudgetCents > 0 && rosterCostCents > wageBudgetCents;
                const tone = wagePct == null ? 'neutral' : overBudget ? 'danger' : wagePct > targetPct * 0.92 ? 'warning' : 'positive';
                return (
                  <span className={`roster-cost-forecast-pill is-${tone}`} title="Projected labour cost vs target wage budget">
                    <span>Labour</span>
                    <strong>{formatCents(rosterCostCents)}</strong>
                    {wagePct !== null ? (
                      <span className="roster-cost-forecast-pct">{wagePct.toFixed(1)}%</span>
                    ) : null}
                    {wageBudgetCents > 0 ? (
                      <small>
                        {overBudget ? '▲' : '▼'} {formatCents(Math.abs(forecastCostGapCents))} {overBudget ? 'over' : 'under'} budget
                      </small>
                    ) : null}
                  </span>
                );
              })()}
              {!sidePanelCollapsed ? (
                <span className="roster-board-command-staff-inline">
                  <span className="roster-right-rail-title">Staff</span>
                  <button
                    type="button"
                    className="roster-board-command-staff-collapse"
                    onClick={() => setSidePanelCollapsed(true)}
                    aria-label="Collapse Staff rail"
                  >
                    Collapse
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="roster-board-command-staff-inline roster-board-command-staff-inline--expand"
                  onClick={() => setSidePanelCollapsed(false)}
                  aria-label="Expand Staff rail"
                >
                  <span className="roster-right-rail-title">Staff</span>
                  <span>Expand</span>
                </button>
              )}
            </div>
          </div>
          <div className={`deputy-schedule-grid roster-days-${boardDays} is-venue-separated`} style={scheduleGridStyle}>
            {/* The global day-head and day-summary rows are gone — each
                venue now carries its own day labels + per-day summary
                in the venue header row beneath. No group total at the
                top until we add a per-venue comparison view. */}

            {scheduleRows.length === 0 ? (
              <div className="deputy-schedule-empty">No rows match the current filters.</div>
            ) : (
              scheduleRows.map((row) => {
                if ('isVenueHeader' in row && row.isVenueHeader) {
                  const venueCollapsed = collapsedVenues.has(row.venue);
                  return (
                    <div className="deputy-schedule-row deputy-venue-row" key={row.id}>
                      <div
                        className="deputy-row-label deputy-venue-label"
                        role="button"
                        tabIndex={0}
                        onClick={() => toggleVenueCollapsed(row.venue)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleVenueCollapsed(row.venue); } }}
                        title={venueCollapsed ? 'Expand venue' : 'Collapse venue'}
                      >
                        <span className="deputy-venue-eyebrow">Venue</span>
                        <strong>{row.label}</strong>
                      </div>
                      {days.map((day) => {
                        // Per-venue daily summary in the same style as the
                        // top global summary strip — hours / cost / wage%
                        // scoped to this venue. The top strip aggregates
                        // these across all venues, so they're not double
                        // counted in any downstream total.
                        const dayShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                        const dayHours = dayShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                        const dayCostCents = dayShifts.reduce((sum, shift) => {
                          const member = staffById.get(shift.staffProfileId);
                          const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
                          return sum + Math.round(shiftHours(shift) * rateCents);
                        }, 0);
                        const isClosed = isVenueClosedOnDate(row.venue, day);
                        const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                        const venueForecastCents = Math.round(historicalSalesForDate(row.venue, day) * 100);
                        const wagePercent = venueForecastCents > 0 ? (dayCostCents / venueForecastCents) * 100 : 0;
                        const isOver = venueForecastCents > 0 && dayCostCents > Math.round(venueForecastCents * targetWagePercentParsed);
                        const hasCost = !isClosed && dayCostCents > 0;
                        const isTodayCell = sameDay(day, new Date());
                        return (
                          <div
                            key={`${row.id}-${day.toISOString()}`}
                            className={`deputy-schedule-cell deputy-venue-cell ${isClosed ? 'is-closed' : ''} ${isWeekend ? 'is-weekend' : ''} ${isTodayCell ? 'is-today' : ''}`}
                          >
                            {/* Day label folds INTO the venue cell so each
                                venue's section is self-contained. */}
                            <span className="deputy-venue-cell-day">
                              <strong>{day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
                              <em>{day.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</em>
                            </span>
                            {isClosed ? (
                              <span className="deputy-venue-cell-closed">Closed</span>
                            ) : (
                              <>
                                <span className="deputy-venue-cell-hours">{roundHours(dayHours)}h</span>
                                {hasCost ? (
                                  <>
                                    <span className="deputy-venue-cell-cost">{formatCents(dayCostCents)}</span>
                                    {wagePercent > 0 ? (
                                      <span className={`deputy-venue-cell-pct ${isOver ? 'is-over' : 'is-under'}`}>
                                        {wagePercent.toFixed(0)}%
                                      </span>
                                    ) : null}
                                  </>
                                ) : null}
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                // Skip rows whose venue section is collapsed
                if (collapsedVenues.has(row.venue)) return null;
                const isRowCollapsed = collapsedRowIds.has(row.id);
                return (
                  <div className="deputy-schedule-row" key={row.id}>
                    <div
                      className={`deputy-row-label${isRowCollapsed ? ' is-row-collapsed' : ''}`}
                      role="button"
                      tabIndex={0}
                      title={isRowCollapsed ? 'Expand row' : 'Collapse row'}
                      onClick={() => toggleRowCollapsed(row.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleRowCollapsed(row.id); } }}
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="row-collapse-toggle" aria-hidden>
                        {isRowCollapsed ? '▸' : '▾'}
                      </span>
                      <span className="roster-avatar small">{row.initials}</span>
                      <strong>{row.label}</strong>
                    </div>
                    {days.map((day) => {
                      const cellShifts = row.shifts.filter((shift) => sameDay(new Date(shift.startsAt), day));
                      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                      // Match leave on this staff member for this day
                      const memberLeave = row.member
                        ? leaveOverlays.find((l) => l.staffProfileId === row.member!.id && leaveOverlapsDay(l, day))
                        : null;
                      if (isRowCollapsed) {
                        return (
                          <button
                            key={`${row.id}-${day.toISOString()}`}
                            type="button"
                            className={`deputy-schedule-cell is-row-collapsed${memberLeave ? ' has-leave' : ''}${isWeekend ? ' is-weekend' : ''}`}
                            onClick={() => {
                              toggleRowCollapsed(row.id);
                              prefillCell(row, day);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                              toggleRowCollapsed(row.id);
                              void handleDrop(event, row, day);
                            }}
                          >
                            {cellShifts.length > 0 ? <span className="collapsed-shift-count">{cellShifts.length}</span> : null}
                          </button>
                        );
                      }
                      const isClosed = isVenueClosedOnDate(scheduleRowVenue(row), day);
                      return (
                        <button
                          key={`${row.id}-${day.toISOString()}`}
                          type="button"
                          className={`deputy-schedule-cell ${cellShifts.length ? 'has-shifts' : ''} ${isClosed ? 'is-closed' : ''}${memberLeave ? ` has-leave is-leave-${memberLeave.status.toLowerCase()}` : ''}${isWeekend ? ' is-weekend' : ''}`}
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
                          {memberLeave && !isClosed ? (
                            <span className={`deputy-leave-overlay is-${memberLeave.status.toLowerCase()}`} title={`${leaveTypeLabel(memberLeave.type)} · ${memberLeave.status.toLowerCase()}`}>
                              {memberLeave.status === 'APPROVED' ? '✓' : '⏳'}
                              <small>{leaveTypeLabel(memberLeave.type).split(' ')[0]}</small>
                            </span>
                          ) : null}
                          {!isClosed && cellShifts.length === 0 ? <span className="deputy-add-shift">+ Shift</span> : null}
                          {!isClosed ? cellShifts.map((shift) => (
                            <span
                              key={shift.id}
                              draggable
                              role="button"
                              tabIndex={0}
                              className={`deputy-shift-card deputy-shift-${shift.status.toLowerCase()} ${isDeputyImportedShift(shift) ? 'is-deputy-import' : ''} ${isUnallocatedProfile(shift.staffProfile) ? 'is-unallocated' : ''} ${draggingShiftId === shift.id ? 'is-dragging' : ''} ${staffDropTargetShiftId === shift.id ? 'is-staff-drop-target' : ''}`}
                              style={areaStyle(shift.area || row.label)}
                              onDragStart={(event) => handleDragStart(event, shift)}
                              onDragEnd={() => setDraggingShiftId(null)}
                              onDragOver={(event) => {
                                if (event.dataTransfer.types.includes('text/plain')) {
                                  event.preventDefault();
                                  setStaffDropTargetShiftId(shift.id);
                                }
                              }}
                              onDragLeave={() => setStaffDropTargetShiftId(null)}
                              onDrop={(event) => { setStaffDropTargetShiftId(null); void handleDropOnShift(event, shift); }}
                              onClick={(event) => {
                                event.stopPropagation();
                                startEditShift(shift);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return;
                                event.preventDefault();
                                event.stopPropagation();
                                startEditShift(shift);
                              }}
                              onContextMenu={(event) => openShiftContextMenu(event, shift)}
                            >
                              <span className="deputy-shift-topline">
                                <strong>{timeOf(shift.startsAt)}-{timeOf(shift.endsAt)}</strong>
                                <em className={`deputy-shift-status-pill is-${shift.status.toLowerCase()}`}>
                                  {shift.status === 'PUBLISHED' ? 'Live' : shift.status.toLowerCase()}
                                </em>
                              </span>
                              <span className="deputy-shift-person">{viewMode === 'team' ? shift.area || shift.roleTitle || 'Shift' : `${shift.staffProfile?.firstName ?? ''} ${shift.staffProfile?.lastName ?? ''}`.trim()}</span>
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
              {false ? (
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
                >
                  <div className="roster-side-staff-list">
                    {sidePanelStaff.length ? sidePanelStaff.map((member) => {
                      const memberShifts = visibleRoster.filter((shift) => shift.staffProfileId === member.id);
                      const memberHours = memberShifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                      const memberRateCents = member.trainingPayRateCents ?? member.payRateCents ?? averageRateCents;
                      const memberWeekCost = Math.round(memberHours * memberRateCents);
                      const rateLabel = memberRateCents ? `$${(memberRateCents / 100).toFixed(2)}/hr` : 'No rate set';
                      const costLabel = memberWeekCost > 0 ? ` · $${(memberWeekCost / 100).toFixed(2)} this week` : '';
                      const fullName = `${member.firstName} ${member.lastName}`;
                      const isLongName = fullName.length > 18;
                      return (
                        <button
                          type="button"
                          key={member.id}
                          draggable
                          className={`roster-staff-bubble ${staffProfileId === member.id ? 'is-selected' : ''}${isLongName ? ' is-long-name' : ''}`}
                          onDragStart={(event) => handleStaffBubbleDragStart(event, member)}
                          onMouseEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setStaffCardHover({
                              member,
                              memberShifts,
                              memberHours,
                              rateLabel,
                              costLabel,
                              x: rect.left,
                              y: rect.top + rect.height / 2,
                            });
                          }}
                          onMouseLeave={() => setStaffCardHover(null)}
                          onClick={() => {
                            setStaffProfileId(member.id);
                            setShiftVenue(member.venue ?? '');
                            setRoleTitle(member.roleTitle ?? '');
                          }}
                        >
                          <span className="roster-avatar">{fullName}</span>
                          {memberShifts.length > 0 ? (
                            <span className="roster-staff-bubble-shifts">{memberShifts.length}</span>
                          ) : null}
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
      ) : null}
      {editorOpen ? (
        <div
          className="roster-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeShiftPanel();
          }}
        >
          <section
            className="roster-shift-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="roster-shift-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="roster-shift-modal-header">
              <div>
                <p className="eyebrow">{editingShift ? 'Edit shift' : 'New shift'}</p>
                <h2 id="roster-shift-modal-title">{editingShift ? `${editingShift.area || 'Shift'} · ${timeOf(editingShift.startsAt)}–${timeOf(editingShift.endsAt)}` : 'Add a shift'}</h2>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={closeShiftPanel}>Close</Button>
            </header>
            <div className="staff-profile-form roster-shift-modal-form">
              <div className="form-grid two">
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
              </div>
              <div className="form-grid two">
                <Select
                  label="Area"
                  value={area}
                  onChange={(event) => setArea(event.currentTarget.value)}
                  options={areaSelectOptions}
                />
                <Input label="Role" value={roleTitle} onChange={(event) => setRoleTitle(event.currentTarget.value)} placeholder="Use profile role" />
              </div>
              <div className="form-grid two">
                <Input label="Date" type="date" value={date} onChange={(event) => setDate(event.currentTarget.value)} />
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
              </div>
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
              {shiftLeaveClashes.length > 0 ? (
                <div className="roster-conflict-warning is-blocking">
                  <strong>On leave this day · save blocked</strong>
                  <span>
                    {shiftLeaveClashes
                      .slice(0, 2)
                      .map((leave) => `${leave.type.toLowerCase().replace('_', ' ')}${leave.status === 'PENDING' ? ' (pending)' : ''}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              {shiftConflicts.length > 0 ? (
                <div className="roster-conflict-warning is-blocking">
                  <strong>Already rostered · save blocked</strong>
                  <span>
                    {shiftConflicts
                      .slice(0, 2)
                      .map((shift) => `${timeOf(shift.startsAt)}-${timeOf(shift.endsAt)} ${shift.venue || shift.area || 'Shift'}`)
                      .join(', ')}
                  </span>
                </div>
              ) : null}
              <div className="form-grid two">
                <Input label="Meal break (min)" type="number" min="0" step="5" value={breakMinutes} onChange={(event) => setBreakMinutes(event.currentTarget.value)} />
              </div>
              <Textarea label="Notes" rows={2} value={shiftNotes} onChange={(event) => setShiftNotes(event.currentTarget.value)} />
            </div>
            <footer className="roster-shift-modal-footer">
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
              <span style={{ flex: 1 }} />
              <ActionFeedback
                message={messageTarget === 'shift-save' || messageTarget === 'shift-copy' || messageTarget === 'shift-delete' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Check') ? 'error' : 'success'}
              />
              <Button type="button" disabled={saving || !canSaveShift} onClick={() => void saveShift()}>
                {saving ? 'Saving…' : editingShift ? 'Save shift' : 'Add shift'}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
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
      {staffCardHover ? (() => {
        const { member, memberShifts, memberHours, rateLabel, costLabel, x, y } = staffCardHover;
        const cardWidth = 240;
        const left = Math.max(8, x - cardWidth - 12);
        const top = Math.max(8, y);
        return (
          <div
            className="roster-staff-card-popup"
            style={{ left, top }}
            role="tooltip"
          >
            <strong>{member.firstName} {member.lastName}</strong>
            <span className="roster-staff-card-role">{member.roleTitle || 'Team member'}</span>
            <div className="roster-staff-card-divider" />
            <div className="roster-staff-card-row"><span>Pay rate</span><span>{rateLabel}</span></div>
            {memberShifts.length > 0 ? (
              <>
                <div className="roster-staff-card-row"><span>Shifts this week</span><span>{memberShifts.length}</span></div>
                <div className="roster-staff-card-row"><span>Hours</span><span>{roundHours(memberHours)}h</span></div>
                {costLabel ? <div className="roster-staff-card-row"><span>Est. cost</span><span>{costLabel.replace(' · ', '')}</span></div> : null}
              </>
            ) : (
              <div className="roster-staff-card-row subtle"><span>No shifts this week</span></div>
            )}
          </div>
        );
      })() : null}

      {/* Deputy stop-gap import modal — opens when "Import from Deputy" is
          clicked in the editorial roster header. */}
      {deputyImportOpen ? (
        <DeputyImportModal
          onClose={() => setDeputyImportOpen(false)}
          onSuccess={async () => {
            await reload(weekStart, weekEnd);
          }}
        />
      ) : null}
    </div>
  );
}

// Deputy roster CSV importer modal. Takes a CSV paste or file upload,
// runs a dry-run preview first, then the real import. Stays a stop-gap
// until Alma roster is fully tested.
function DeputyImportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> | void }) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<{
    source: string;
    rowsRead: number;
    shiftsCreated: number;
    previousImportedShiftsDeleted: number;
    staffCreated: number;
    staffMatched: number;
    unallocatedShifts: number;
    dateRange: { start: string | null; end: string | null };
    skippedRows: Array<{ row: number; reason: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [step, setStep] = useState<'paste' | 'preview' | 'done'>('paste');

  async function handleFile(file: File) {
    try {
      const text = await file.text();
      setCsv(text);
      setFilename(file.name);
      setMessage(null);
    } catch {
      setMessageTone('error');
      setMessage('Could not read that file. Try copy-pasting the CSV content instead.');
    }
  }

  async function runPreview() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<typeof preview>('/api/integrations/deputy/import-roster', {
        method: 'POST',
        body: JSON.stringify({ csv, filename: filename || undefined, dryRun: true })
      });
      setPreview(result);
      setStep('preview');
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not preview the Deputy import.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<typeof preview>('/api/integrations/deputy/import-roster', {
        method: 'POST',
        body: JSON.stringify({ csv, filename: filename || undefined, dryRun: false })
      });
      setPreview(result);
      setStep('done');
      setMessageTone('success');
      setMessage(`Imported ${result?.shiftsCreated ?? 0} shifts.`);
      await onSuccess();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not run the Deputy import.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="staff-modal-backdrop" role="dialog" aria-labelledby="deputy-import-title" onClick={(event) => {
      // Click on backdrop closes, but clicks inside the dialog don't bubble.
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="staff-modal staff-modal--deputy">
        <header className="staff-modal-head">
          <span className="suite-feedback-eyebrow">Stop-gap integration</span>
          <h2 id="deputy-import-title" className="staff-modal-title">Import roster from Deputy</h2>
          <p className="staff-modal-sub">
            Deputy stays the source of truth until Alma roster is fully tested.
            Drop the latest CSV here to refresh shifts. Re-imports of the same file
            replace previous Deputy shifts in the same date range so they're idempotent.
          </p>
        </header>

        {step === 'paste' ? (
          <div className="staff-modal-body">
            <label className="field">
              <span className="field-label">Upload CSV</span>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">Or paste CSV content</span>
              <textarea
                value={csv}
                onChange={(event) => setCsv(event.currentTarget.value)}
                placeholder="Paste the CSV exported from Deputy (headers included)…"
                rows={8}
                className="field-control"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px' }}
              />
            </label>
            {filename ? <p className="subtle">Loaded: {filename}</p> : null}
          </div>
        ) : null}

        {step === 'preview' && preview ? (
          <div className="staff-modal-body">
            <div className="stats-grid">
              <StatCard label="Rows read" value={preview.rowsRead} hint="Total CSV rows" />
              <StatCard label="Shifts to create" value={preview.shiftsCreated || (preview.rowsRead - preview.skippedRows.length)} hint="After validation" />
              <StatCard label="Staff matched" value={preview.staffMatched} hint="Existing profiles" />
              <StatCard label="Staff to create" value={preview.staffCreated} hint="New from this CSV" />
            </div>
            {preview.dateRange.start ? (
              <p className="subtle">
                Range: {new Date(preview.dateRange.start).toLocaleDateString()} → {preview.dateRange.end ? new Date(preview.dateRange.end).toLocaleDateString() : '—'}
              </p>
            ) : null}
            {preview.skippedRows.length ? (
              <div className="alma-preview-banner" role="status">
                <strong>{preview.skippedRows.length} rows will be skipped</strong>
                <span>{preview.skippedRows.slice(0, 3).map((r) => `Row ${r.row}: ${r.reason}`).join(' · ')}{preview.skippedRows.length > 3 ? ' …' : ''}</span>
              </div>
            ) : null}
            <p className="subtle">
              On confirm, previously-imported Deputy shifts in this date range with the same filename will be deleted and re-created so the data stays consistent with the latest Deputy export.
            </p>
          </div>
        ) : null}

        {step === 'done' && preview ? (
          <div className="staff-modal-body">
            <div className="alma-preview-banner" role="status">
              <strong>Done — Deputy roster imported.</strong>
              <span>
                {preview.shiftsCreated} shifts created · {preview.previousImportedShiftsDeleted} replaced ·
                {preview.staffCreated} new staff · {preview.staffMatched} matched · {preview.unallocatedShifts} unallocated
              </span>
            </div>
            <p className="subtle">
              The roster grid will refresh once you close this dialog.
            </p>
          </div>
        ) : null}

        {message ? <ActionFeedback message={message} tone={messageTone} /> : null}

        <footer className="staff-modal-actions">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {step === 'done' ? 'Close' : 'Cancel'}
          </Button>
          {step === 'paste' ? (
            <Button type="button" onClick={() => void runPreview()} disabled={busy || !csv.trim()}>
              {busy ? 'Checking…' : 'Preview import'}
            </Button>
          ) : null}
          {step === 'preview' ? (
            <Button type="button" onClick={() => void runImport()} disabled={busy}>
              {busy ? 'Importing…' : 'Confirm import'}
            </Button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}

function MobileRosterView({
  dailySummaries,
  selectedDate,
  selectedSummary,
  shifts,
  venueGroups,
  venueLabel,
  onSelectDay,
  onAddShift,
  onOpenShift
}: {
  dailySummaries: Array<{ day: Date; shifts: number; hours: number; people: number }>;
  selectedDate: Date;
  selectedSummary?: { day: Date; shifts: number; hours: number; people: number };
  shifts: RosterShift[];
  venueGroups: MobileRosterVenueGroup[];
  venueLabel: string;
  onSelectDay: (day: string) => void;
  onAddShift: () => void;
  onOpenShift: (shift: RosterShift) => void;
}) {
  const peopleCount = selectedSummary?.people ?? new Set(shifts.map((shift) => shift.staffProfileId)).size;
  const hours = selectedSummary?.hours ?? shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);

  return (
    <section className="mobile-roster-surface mobile-roster" aria-label="Mobile roster">
      <div className="mobile-roster-topbar">
        <div>
          <p className="eyebrow">Roster</p>
          <h2>{selectedDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}</h2>
          <span>
            {venueLabel} · {selectedSummary?.shifts ?? shifts.length} shifts
          </span>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={onAddShift}>
          Add shift
        </Button>
      </div>

      <div className="mobile-roster-day-cards" aria-label="Roster day summary">
        {dailySummaries.map((summary) => {
          const selected = sameDay(summary.day, selectedDate);
          return (
            <button
              key={summary.day.toISOString()}
              type="button"
              className={`mobile-roster-day-card ${selected ? 'is-selected' : ''} ${sameDay(summary.day, new Date()) ? 'is-today' : ''}`}
              aria-pressed={selected}
              aria-current={selected ? 'date' : undefined}
              onClick={() => onSelectDay(toDateInput(summary.day))}
            >
              <span>{summary.day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <strong>{summary.day.toLocaleDateString(undefined, { day: 'numeric' })}</strong>
              <small>{summary.shifts} shifts</small>
              <small>{summary.people} people · {roundHours(summary.hours)}</small>
            </button>
          );
        })}
      </div>

      <div className="mobile-roster-day-detail">
        <div className="mobile-roster-day-heading">
          <div>
            <strong>{selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}</strong>
            <span>{peopleCount} people · {roundHours(hours)}</span>
          </div>
          <Badge tone={shifts.length ? 'info' : 'muted'}>{shifts.length} shifts</Badge>
        </div>

        {shifts.length === 0 ? (
          <EmptyState
            title="No shifts scheduled"
            description="This day has no rostered shifts for the current filters."
            action={<Button type="button" size="sm" onClick={onAddShift}>Add shift</Button>}
          />
        ) : venueGroups.length === 0 ? (
          <EmptyState
            title="No area rows match"
            description="This day has shifts, but no venue or area rows match the current search and view filters."
          />
        ) : (
          <div className="mobile-roster-sections">
            {venueGroups.map((venueGroup) => (
              <section key={venueGroup.venue} className="mobile-roster-venue-section">
                <div className="mobile-roster-venue-header">
                  <span className="roster-avatar" aria-hidden="true">{venueGroup.initials}</span>
                  <div>
                    <strong>{venueGroup.venue}</strong>
                    <small>
                      {venueGroup.areas.length} area{venueGroup.areas.length === 1 ? '' : 's'} · {venueGroup.shifts.length} shift{venueGroup.shifts.length === 1 ? '' : 's'} · {roundHours(venueGroup.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0))}
                    </small>
                  </div>
                </div>

                {venueGroup.areas.map((areaGroup) => {
                  const areaHours = areaGroup.shifts.reduce((sum, shift) => sum + shiftHours(shift), 0);
                  return (
                    <section key={`${venueGroup.venue}:${areaGroup.area}`} className="mobile-roster-area-section">
                      <div className="mobile-roster-section-header" style={areaStyle(areaGroup.area)}>
                        <strong>{areaGroup.area}</strong>
                        <small>{roundHours(areaHours)}</small>
                        <span>{areaGroup.shifts.length}</span>
                      </div>
                      <div className="mobile-shift-list">
                        {areaGroup.shifts.map((shift) => {
                          const staffName = rosterShiftStaffName(shift);
                          const shiftVenueName = shift.venue || shift.staffProfile?.venue || venueGroup.venue || 'No venue';
                          const shiftArea = shift.area || areaGroup.area || shift.roleTitle || 'Shift';
                          const statusGroup = mobileRosterStatusGroup(shift);
                          return (
                            <button
                              key={shift.id}
                              type="button"
                              className="mobile-shift-row"
                              style={areaStyle(shiftArea)}
                              onClick={() => onOpenShift(shift)}
                            >
                              <span className="mobile-shift-avatar" aria-hidden="true">
                                {shift.staffProfile && !isUnallocatedProfile(shift.staffProfile) ? initials(shift.staffProfile) : shiftArea.slice(0, 2).toUpperCase()}
                              </span>
                              <span className={`mobile-shift-status-dot is-${mobileRosterGroupClass(statusGroup)}`} aria-hidden="true" />
                              <span className="mobile-shift-main">
                                <strong>{staffName}</strong>
                                <span>{timeOf(shift.startsAt)} - {timeOf(shift.endsAt)}</span>
                                <small>{shiftArea} · {shiftVenueName}</small>
                              </span>
                              <span className="mobile-shift-meta">
                                <small>{mobileRosterStatusText(shift, statusGroup)}</small>
                                <span aria-hidden="true">›</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
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
  const d = new Date(value);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
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

function mobileRosterStatusGroup(shift: RosterShift): MobileRosterGroupKey {
  if (isUnallocatedProfile(shift.staffProfile)) return 'unassigned';
  if (shift.status === 'COMPLETED' || shift.status === 'CANCELLED') return 'completed';
  const startsAt = new Date(shift.startsAt).getTime();
  const endsAt = new Date(shift.endsAt).getTime();
  const now = Date.now();
  if (!Number.isNaN(startsAt) && !Number.isNaN(endsAt)) {
    if (startsAt <= now && endsAt >= now && shift.status === 'PUBLISHED') return 'onShift';
    if (endsAt < now) return 'late';
  }
  return 'scheduled';
}

function mobileRosterGroupClass(group: MobileRosterGroupKey) {
  return group.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function mobileRosterStatusText(shift: RosterShift, group: MobileRosterGroupKey) {
  if (group === 'onShift') return 'On shift';
  if (group === 'late') return 'Needs review';
  if (group === 'unassigned') return 'Unassigned';
  if (shift.status === 'DRAFT') return 'Draft';
  if (shift.status === 'CANCELLED') return 'Cancelled';
  if (shift.status === 'COMPLETED') return 'Completed';
  return 'Scheduled';
}

function rosterShiftStaffName(shift: RosterShift) {
  if (isUnallocatedProfile(shift.staffProfile)) return 'Unassigned shift';
  return `${shift.staffProfile?.firstName ?? ''} ${shift.staffProfile?.lastName ?? ''}`.trim() || 'Unassigned shift';
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

function StaffDocumentActionPrompt({
  action,
  saving,
  feedback,
  onCancel,
  onConfirm
}: {
  action: StaffDocumentPromptAction;
  saving: boolean;
  feedback?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isDelete = action === 'delete';
  return (
    <div className={`staff-document-confirm ${isDelete ? 'is-danger' : ''}`} role="group" aria-label={isDelete ? 'Remove this document confirmation' : 'Request this document again confirmation'}>
      <span>
        <strong>{isDelete ? 'Remove this document?' : 'Request this document again?'}</strong>
        <span className="subtle">
          {isDelete
            ? 'This clears the uploaded file from the record. The staff record will stay in Alma.'
            : 'This clears the current upload and marks the document for follow-up. Ask the staff member to upload the correct document again.'}
        </span>
      </span>
      <span className="staff-document-confirm-actions">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant={isDelete ? 'danger' : 'secondary'} disabled={saving} onClick={onConfirm}>
          {saving ? (isDelete ? 'Removing...' : 'Requesting...') : isDelete ? 'Remove document' : 'Request again'}
        </Button>
        <ActionFeedback
          message={feedback ?? null}
          tone={feedback?.includes('Could') ? 'error' : 'success'}
        />
      </span>
    </div>
  );
}

function ApprovalRecordRow({
  member,
  record,
  saving,
  onApprove,
  onReject,
  onUpload,
  onDelete,
  onRequest,
  promptAction,
  onCancelPrompt,
  onConfirmPrompt,
  feedback,
  promptFeedback
}: {
  member: StaffProfile;
  record: StaffComplianceRecord;
  saving: boolean;
  onApprove: (memberId: string, recordId: string) => void;
  onReject: (memberId: string, recordId: string) => void;
  onUpload: (memberId: string, record: StaffComplianceRecord, file: File) => void;
  onDelete: (memberId: string, recordId: string) => void;
  onRequest: (memberId: string, recordId: string) => void;
  promptAction?: StaffDocumentPromptAction | null;
  onCancelPrompt: () => void;
  onConfirmPrompt: () => void;
  feedback?: string | null;
  promptFeedback?: string | null;
}) {
  const documentRecord = staffComplianceDocumentRecord(record);
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
        {documentRecord.dueAt ? <span className="subtle">Due {new Date(documentRecord.dueAt).toLocaleDateString()}</span> : null}
        {recordDocumentRequested(documentRecord) ? <span className="subtle">Document requested</span> : null}
      </span>
      <span className="invite-row-actions">
        <Badge tone={staffRecordStatusTone(documentRecord.status)}>{staffRecordStatusLabel(documentRecord.status)}</Badge>
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
          disabled={saving || documentRecord.status === 'APPROVED' || !record.documentUrl}
          onClick={() => onApprove(member.id, record.id)}
        >
          Approve document
        </Button>
        {record.documentUrl && documentRecord.status !== 'APPROVED' ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={saving}
            onClick={() => onReject(member.id, record.id)}
          >
            Reject
          </Button>
        ) : null}
        <ActionFeedback
          message={feedback}
          tone={feedback?.includes('Could') ? 'error' : 'success'}
        />
        {record.documentUrl ? (
          <Button
            type="button"
            size="sm"
            variant="danger"
            disabled={saving}
            onClick={() => onDelete(member.id, record.id)}
          >
            Delete document
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={saving}
          onClick={() => onRequest(member.id, record.id)}
        >
          Re-request document
        </Button>
      </span>
      {promptAction ? (
        <StaffDocumentActionPrompt
          action={promptAction}
          saving={saving}
          feedback={promptFeedback}
          onCancel={onCancelPrompt}
          onConfirm={onConfirmPrompt}
        />
      ) : null}
    </div>
  );
}

function ApprovalsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const [documentPrompt, setDocumentPrompt] = useState<{ action: StaffDocumentPromptAction; memberId: string; recordId: string } | null>(null);
  const [reviewItems, setReviewItems] = useState<StaffDocumentReviewItem[]>([]);
  const [reviewStaffSelection, setReviewStaffSelection] = useState<Record<string, string>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const pendingProfiles = staff.filter((member) => member.employmentStatus === 'PENDING');
  const pendingRecords = staff.flatMap((member) =>
    member.records
      .filter((record) => {
        const status = staffComplianceDocumentRecord(record).status;
        return (status === 'PENDING' || status === 'UPLOADED') && Boolean(record.documentUrl);
      })
      .map((record) => ({ member, record }))
  );
  const documentReviewStaff = staff.filter((member) =>
    member.employmentStatus !== 'ARCHIVED' &&
    (member as StaffProfile & { accountType?: string }).accountType !== 'VENUE_DEVICE'
  );
  const staffById = new Map(staff.map((member) => [member.id, member]));

  const loadReviewItems = useCallback(async () => {
    try {
      setReviewError(null);
      setReviewItems(await api<StaffDocumentReviewItem[]>('/api/staff/document-reviews'));
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not load manual document reviews.');
    }
  }, []);

  useEffect(() => {
    void loadReviewItems();
  }, [loadReviewItems]);

  useEffect(() => {
    setReviewStaffSelection((current) => {
      const next = { ...current };
      for (const item of reviewItems) {
        if (!next[item.id] && item.candidateStaffIds.length === 1) {
          next[item.id] = item.candidateStaffIds[0]!;
        }
      }
      return next;
    });
  }, [reviewItems]);

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

  async function rejectRecord(memberId: string, recordId: string) {
    const reason = window.prompt('Reason for rejecting this document?') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`record:${recordId}`);
    try {
      await api(`/api/staff/${memberId}/records/${recordId}/reject`, {
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
          status: 'UPLOADED'
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

  async function confirmDocumentAction() {
    if (!documentPrompt) return;
    const member = staff.find((item) => item.id === documentPrompt.memberId);
    const record = member?.records.find((item) => item.id === documentPrompt.recordId);
    if (!member || !record) {
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
      await api(`/api/staff/${member.id}/records/${record.id}/${documentPrompt.action === 'delete' ? 'document' : 'request-document'}`, {
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

  async function approveReviewItem(reviewId: string) {
    const staffProfileId = reviewStaffSelection[reviewId];
    if (!staffProfileId) {
      setMessageTarget(`review:${reviewId}`);
      setMessage('Choose a staff member before approving this RSA document.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget(`review:${reviewId}`);
    try {
      await api(`/api/staff/document-reviews/${reviewId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ staffProfileId })
      });
      await Promise.all([reload(), loadReviewItems()]);
      setMessage('Review approved. RSA document is now attached to the selected staff profile for document approval.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve document review.');
    } finally {
      setSaving(false);
    }
  }

  async function rejectReviewItem(reviewId: string) {
    if (!window.confirm('Reject this imported RSA document review item?')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`review:${reviewId}`);
    try {
      await api(`/api/staff/document-reviews/${reviewId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Rejected from Staff approvals.' })
      });
      await loadReviewItems();
      setMessage('Review item rejected.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not reject document review.');
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
        <StatCard label="Manual RSA reviews" value={reviewItems.length} hint="Imported files to map" />
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
        title="Manual RSA review queue"
        description="Uncertain Deputy RSA files sit here until a manager selects the right staff member. They are not attached to staff profiles until approved."
        count={reviewItems.length}
        tone={reviewItems.length ? 'warning' : 'positive'}
        defaultOpen={reviewItems.length === 1}
        empty={<EmptyState title="No RSA documents waiting for manual review" description="Run the Deputy document importer with --review-uncertain-rsa to populate this queue." />}
      >
        {reviewError ? <p className="error-text">{reviewError}</p> : null}
        {reviewItems.length === 0 ? (
          <EmptyState title="No RSA documents waiting for manual review" description="Run the Deputy document importer with --review-uncertain-rsa to populate this queue." />
        ) : (
          <div className="invite-list">
            {reviewItems.map((item) => {
              const candidateStaff = item.candidateStaffIds
                .map((id) => staffById.get(id))
                .filter((member): member is StaffProfile => Boolean(member));
              const selectedStaffId = reviewStaffSelection[item.id] ?? '';
              return (
                <div key={item.id} className="invite-row">
                  <span>
                    <strong>{item.title}</strong>
                    <span className="subtle">
                      {item.sourceFileName} · {item.reviewReason.replaceAll('_', ' ')}
                    </span>
                    {item.candidateName ? <span className="subtle">Candidate name: {item.candidateName}</span> : null}
                    {candidateStaff.length ? (
                      <span className="subtle">
                        Candidate staff: {candidateStaff.map((member) => `${member.firstName} ${member.lastName}`).join(', ')}
                      </span>
                    ) : (
                      <span className="subtle">No confident candidate staff match.</span>
                    )}
                    <StaffDocumentViewLink documentUrl={item.documentUrl} />
                    {item.notes ? <span className="subtle">{item.notes}</span> : null}
                  </span>
                  <span className="invite-row-actions staff-review-actions">
                    <Badge tone="warning">Manual review</Badge>
                    <Select
                      label="Attach to staff"
                      value={selectedStaffId}
                      onChange={(event) => { const el = event.currentTarget; setReviewStaffSelection((current) => ({ ...current, [item.id]: el.value })); }}
                      options={[
                        { label: 'Choose staff', value: '' },
                        ...documentReviewStaff.map((member) => ({
                          label: `${member.firstName} ${member.lastName}${member.venue ? ` · ${member.venue}` : ''}`,
                          value: member.id
                        }))
                      ]}
                    />
                    <Button type="button" size="sm" disabled={saving || !selectedStaffId} onClick={() => void approveReviewItem(item.id)}>
                      Approve and attach
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void rejectReviewItem(item.id)}>
                      Reject
                    </Button>
                    <ActionFeedback
                      message={messageTarget === `review:${item.id}` ? message : null}
                      tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
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
                onReject={(memberId, recordId) => void rejectRecord(memberId, recordId)}
                onUpload={(memberId, approvalRecord, file) => void uploadRecordDocument(memberId, approvalRecord, file)}
                onDelete={(memberId, recordId) => setDocumentPrompt({ action: 'delete', memberId, recordId })}
                onRequest={(memberId, recordId) => setDocumentPrompt({ action: 'request', memberId, recordId })}
                promptAction={documentPrompt?.memberId === member.id && documentPrompt.recordId === record.id ? documentPrompt.action : null}
                onCancelPrompt={() => setDocumentPrompt(null)}
                onConfirmPrompt={() => void confirmDocumentAction()}
                feedback={
                  messageTarget === `record:${record.id}` ||
                  messageTarget === `record:${record.id}:upload` ||
                  messageTarget === `record:${record.id}:remove` ||
                  messageTarget === `record:${record.id}:request`
                    ? message
                    : null
                }
                promptFeedback={
                  messageTarget === `record:${record.id}:remove` || messageTarget === `record:${record.id}:request`
                    ? message
                    : null
                }
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
  const [cashNotes, setCashNotes] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [cardImportSource, setCardImportSource] = useState('control');
  const [cardImportText, setCardImportText] = useState('');
  const [manualStaffId, setManualStaffId] = useState('');
  const [manualHours, setManualHours] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [breakagePerDay, setBreakagePerDay] = useState('30');
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [adjustments, setAdjustments] = useState<Record<string, { adjustment: string; excluded: boolean; notes: string }>>({});
  const [summary, setSummary] = useState<StaffTipsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const breakageCentsPerDay = useMemo(() => Math.round((Number(breakagePerDay) || 0) * 100), [breakagePerDay]);
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
        venue,
        breakageCentsPerDay: String(breakageCentsPerDay)
      });
      setSummary(await api<StaffTipsSummary>(`/api/staff/tips?${query.toString()}`));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load tips.');
    } finally {
      setLoading(false);
    }
  }, [breakageCentsPerDay, venue, weekEnd, weekStart]);

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
  const payoutVarianceCents = totalPayoutCents - (summary?.allocatablePoolCents ?? 0);
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
        body: JSON.stringify({ venue, serviceDate: `${serviceDate}T00:00:00`, amountCents, notes: cashNotes })
      });
      setMessage(amountCents > 0 ? `Saved ${formatCents(amountCents)} cash tips.` : 'Cleared cash tips for that date.');
      setCashAmount('');
      setCashNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save cash tips.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCashEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/cash/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete cash entry.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteCardEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/card/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete card entry.');
    } finally {
      setSaving(false);
    }
  }

  async function bulkDeleteEntries(type: 'cash' | 'card' | 'all') {
    if (!venue) return;
    const label = type === 'all' ? 'all cash and card tip entries' : `all ${type} tip entries`;
    if (!window.confirm(`Delete ${label} for ${venue} this week? This cannot be undone.`)) return;
    setBulkDeleting(true);
    setMessage(null);
    try {
      const result = await api<{ deletedCash: number; deletedCard: number }>('/api/staff/tips/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ venue, start: weekStart.toISOString(), end: weekEnd.toISOString(), type })
      });
      setMessage(`Deleted ${result.deletedCash + result.deletedCard} entries.`);
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete entries.');
    } finally {
      setBulkDeleting(false);
    }
  }

  async function saveManualHours() {
    setMessageTarget('manual');
    if (!venue || !manualStaffId || !manualHours) {
      setMessage('Choose venue, staff member, and hours.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api('/api/staff/tips/manual-hours', {
        method: 'POST',
        body: JSON.stringify({ staffProfileId: manualStaffId, venue, weekStart: weekStart.toISOString(), hours: Number(manualHours), notes: manualNotes })
      });
      setMessage('Manual hours entry saved.');
      setManualStaffId('');
      setManualHours('');
      setManualNotes('');
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save manual hours.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteManualHoursEntry(id: string) {
    setSaving(true);
    setMessage(null);
    try {
      await api(`/api/staff/tips/manual-hours/${id}`, { method: 'DELETE' });
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete manual entry.');
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

  async function importSquareTips(targetVenue = venue) {
    setMessageTarget('square-import');
    if (!targetVenue) {
      setMessage('Choose a venue before importing Square tips.');
      return;
    }
    setVenue(targetVenue);
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{
        label: string;
        paymentsRead: number;
        tipRows: number;
        imported: number;
        updated: number;
        amountCents: number;
        warnings: string[];
      }>('/api/staff/tips/square-import', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue: targetVenue
        })
      });
      const warning = result.warnings.length ? ` ${result.warnings[0]}` : '';
      setMessage(`${result.label}: imported ${result.imported}, updated ${result.updated}, ${formatCents(result.amountCents)} from ${result.tipRows} Square tip payment${result.tipRows === 1 ? '' : 's'}.${warning}`);
      await loadTips();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not import Square tips.');
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
    if (!hasPaidRun) {
      setMessage('Approve and pay this tip run before exporting CSV.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ csv: string }>('/api/staff/tips/export/csv', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, breakageCentsPerDay, adjustments: adjustmentPayload })
      });
      downloadTextFile(`alma-tips-${venue}-${toDateInput(weekStart)}.csv`, result.csv);
      setMessage('Tips CSV exported.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export tips.');
    } finally {
      setSaving(false);
    }
  }

  async function exportTipsAba() {
    setMessageTarget('aba');
    if (!venue) {
      setMessage('Choose a venue before exporting an ABA file.');
      return;
    }
    if (!hasPaidRun) {
      setMessage('Approve and pay this tip run before exporting an ABA file.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<{ aba: string; filename: string; count: number; totalCents: number }>('/api/staff/tips/export/aba', {
        method: 'POST',
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, breakageCentsPerDay })
      });
      downloadTextFile(result.filename || `alma-tips-${venue}-${toDateInput(weekStart)}.aba`, result.aba, 'text/plain');
      setMessage(`ABA exported for ${result.count} staff · ${formatCents(result.totalCents)}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not export ABA file.');
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
      setMessage(`Final payout must balance to the allocatable pool (after breakage) before marking paid. Current variance is ${formatCents(payoutVarianceCents)}.`);
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
        body: JSON.stringify({ start: weekStart.toISOString(), end: weekEnd.toISOString(), venue, breakageCentsPerDay, notes: payoutNotes, adjustments: adjustmentPayload })
      });
      setMessage('Tips approved and paid. You can now export ABA or CSV.');
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

  const staffOptions = useMemo(
    () => staff
      .filter((member) => !member.venue || member.venue === venue || !venue)
      .map((member) => ({ value: member.id, label: `${member.firstName} ${member.lastName}${member.venue ? ` · ${member.venue}` : ''}` })),
    [staff, venue]
  );

  return (
    <div className="page-stack tips-page">
      <PageHeader
        eyebrow="Payroll"
        title="Tips"
        description="Record tips, allocate across approved hours, and export a payout run."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void loadTips()} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {/* Tips week navigator — same editorial style as the roster board so
          the two pages feel like one tool. Venue + breakage live below. */}
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <span className="alma-roster-eyebrow">Staff · Tips</span>
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

      {/* Venue + breakage controls live just below the week selector. */}
      <TipsSection title="Review settings" summary={`${venue || 'Choose venue'} · $${breakagePerDay || 0}/day breakage`}>
        <Card padding="tight">
          <div className="tips-controls-row">
            <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
            <Input label="Breakage/day ($)" type="number" min="0" step="1" value={breakagePerDay} onChange={(event) => setBreakagePerDay(event.currentTarget.value)} style={{ width: 130 }} />
          </div>
        </Card>
      </TipsSection>

      {/* Summary stats */}
      <TipsSection title="Summary" summary={`${formatCents(summary?.allocatablePoolCents ?? 0)} allocatable · ${hasPaidRun ? 'approved' : 'waiting for review'}`}>
        <div className="stats-grid">
          <StatCard label="Gross tips" value={formatCents(summary?.tipPoolCents ?? 0)} hint={`Cash + card · ${summary?.tradingDays ?? 0} trading day${summary?.tradingDays === 1 ? '' : 's'}`} loading={loading} />
          <StatCard label="Breakage" value={formatCents(summary?.breakageCents ?? 0)} hint={`$${breakagePerDay}/day × ${summary?.tradingDays ?? 0} days`} loading={loading} />
          <StatCard label="Allocatable pool" value={formatCents(summary?.allocatablePoolCents ?? 0)} hint="After breakage deduction" loading={loading} />
          <StatCard label="Final payout" value={formatCents(totalPayoutCents)} hint={payoutVarianceCents === 0 ? 'Balances to pool' : `${formatCents(Math.abs(payoutVarianceCents))} ${payoutVarianceCents > 0 ? 'over' : 'under'}`} loading={loading} />
          <StatCard label="Approved hours" value={roundHours(summary?.approvedHours ?? 0)} hint="Used for allocation" loading={loading} />
          <StatCard label="Run status" value={hasPaidRun ? 'Locked' : 'Waiting'} hint={hasPaidRun ? 'Payroll export ready' : 'Approve at the bottom'} loading={loading} />
        </div>
      </TipsSection>

      {loading ? <Spinner label="Loading tips..." /> : null}
      {message && !messageTarget ? <p className={message.includes('Could') || message.includes('Choose') ? 'error-text' : 'subtle'}>{message}</p> : null}

      {/* Per-day breakdown */}
      {(summary?.cardEntries.length || summary?.cashEntries.length) ? (
        <TipsSection title="Daily breakdown" summary={`Square + cash less $${breakagePerDay}/day breakage`}>
          <Card title="Daily breakdown" subtitle={`Square + cash tips minus $${breakagePerDay} breakage per trading day.`}>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Day</th>
                    <th>Square tips</th>
                    <th>Cash tips</th>
                    <th>− Breakage</th>
                    <th>= Allocatable</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const byDate = new Map<string, { square: number; cash: number }>();
                    for (const e of (summary?.cardEntries ?? [])) {
                      const d = e.serviceDate.slice(0, 10);
                      const cur = byDate.get(d) ?? { square: 0, cash: 0 };
                      cur.square += e.amountCents;
                      byDate.set(d, cur);
                    }
                    for (const e of (summary?.cashEntries ?? [])) {
                      const d = e.serviceDate.slice(0, 10);
                      const cur = byDate.get(d) ?? { square: 0, cash: 0 };
                      cur.cash += e.amountCents;
                      byDate.set(d, cur);
                    }
                    return Array.from(byDate.entries())
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([date, row]) => {
                        const dayName = new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
                        const allocatable = Math.max(0, row.square + row.cash - breakageCentsPerDay);
                        return (
                          <tr key={date}>
                            <td>{date}</td>
                            <td>{dayName}</td>
                            <td>{formatCents(row.square)}</td>
                            <td>{row.cash ? formatCents(row.cash) : <span className="subtle">—</span>}</td>
                            <td className="subtle">−{formatCents(breakageCentsPerDay)}</td>
                            <td><strong>{formatCents(allocatable)}</strong></td>
                          </tr>
                        );
                      });
                  })()}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><strong>Total</strong></td>
                    <td><strong>{formatCents(summary?.squareTipsCents ?? 0)}</strong></td>
                    <td><strong>{formatCents(summary?.cashTipsCents ?? 0)}</strong></td>
                    <td className="subtle">−{formatCents(summary?.breakageCents ?? 0)}</td>
                    <td><strong>{formatCents(summary?.allocatablePoolCents ?? 0)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </TipsSection>
      ) : null}

      {/* Import card tips — one-click per venue */}
      <TipsSection title="Import card tips" summary="Square import or manual CSV">
        <Card title="Import card tips" subtitle="One-click Square import for each venue, or paste a CSV manually.">
          <div className="tips-import-row">
            <div className="tips-import-venue-group">
              <strong>Alma Avalon</strong>
              <div className="toolbar">
                <Button
                  type="button"
                  onClick={() => void importSquareTips('Alma Avalon')}
                  disabled={saving}
                >
                  {saving && messageTarget === 'square-import' && venue === 'Alma Avalon' ? 'Importing…' : 'Import from Square'}
                </Button>
              </div>
            </div>
            <div className="tips-import-venue-group">
              <strong>St Alma</strong>
              <div className="toolbar">
                <Button
                  type="button"
                  onClick={() => void importSquareTips('St Alma')}
                  disabled={saving}
                >
                  {saving && messageTarget === 'square-import' && venue === 'St Alma' ? 'Importing…' : 'Import from Square'}
                </Button>
              </div>
            </div>
          </div>
          <ActionFeedback
            message={messageTarget === 'square-import' ? message : null}
            tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
          />
          <details className="staff-profile-collapsible">
            <summary>Manual CSV import</summary>
            <div className="form-grid two">
              <Select
                label="Source"
                value={cardImportSource}
                onChange={(event) => setCardImportSource(event.currentTarget.value)}
                options={[
                  { label: 'Alma Control', value: 'control' },
                  { label: 'Square', value: 'square' },
                  { label: 'Other', value: 'card' }
                ]}
              />
              <Input label="Default venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} placeholder="Alma Avalon" />
            </div>
            <Textarea
              label="CSV rows"
              rows={6}
              value={cardImportText}
              onChange={(event) => setCardImportText(event.currentTarget.value)}
              placeholder="date,venue,tips&#10;2026-05-04,Alma Avalon,125.50"
            />
            <div className="toolbar-right">
              <Button type="button" variant="secondary" onClick={downloadTipsTemplate}>Download template</Button>
              <Button type="button" variant="secondary" onClick={() => setCardImportText('')} disabled={saving || !cardImportText.trim()}>Clear</Button>
              <Button type="button" disabled={saving || !cardImportText.trim()} onClick={() => void importCardTips()}>
                {saving && messageTarget === 'import' ? 'Importing…' : 'Import card tips'}
              </Button>
              <ActionFeedback
                message={messageTarget === 'import' ? message : null}
                tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('Paste') ? 'error' : 'success'}
              />
            </div>
          </details>
        </Card>
      </TipsSection>

      {/* Add cash tips */}
      <TipsSection title="Add cash tips" summary="Enter cash pool by service date">
        <Card title="Add cash tips" subtitle="Enter the cash tip pool for a service date. Enter $0 to clear that date.">
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
          <div className="form-grid three">
            <Select label="Venue" value={venue} onChange={(event) => setVenue(event.currentTarget.value)} options={venueOptions} />
            <Input label="Service date" type="date" value={serviceDate} onChange={(event) => setServiceDate(event.currentTarget.value)} />
            <Input label="Cash tips ($)" type="number" min="0" step="0.01" value={cashAmount} onChange={(event) => setCashAmount(event.currentTarget.value)} placeholder="0.00" />
          </div>
          <Input label="Notes" value={cashNotes} onChange={(event) => setCashNotes(event.currentTarget.value)} placeholder="Optional notes" />
          <div className="toolbar-right">
            <Button type="button" disabled={saving || !venue} onClick={() => void saveCashTips()}>
              {saving && messageTarget === 'cash' ? 'Saving…' : 'Save cash tips'}
            </Button>
            <ActionFeedback
              message={messageTarget === 'cash' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
        </Card>
      </TipsSection>

      {/* Entries for this week — with delete */}
      <TipsSection title="This week's entries" summary={`${(summary?.cashEntries.length ?? 0) + (summary?.cardEntries.length ?? 0)} entries`}>
        <Card
          title="This week's entries"
          subtitle="Cash and card entries for the selected week and venue."
          action={
            (summary?.cashEntries.length || summary?.cardEntries.length) ? (
              <div className="toolbar">
                <Button type="button" size="sm" variant="ghost" onClick={() => void bulkDeleteEntries('cash')} disabled={bulkDeleting || !summary?.cashEntries.length}>Delete all cash</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => void bulkDeleteEntries('card')} disabled={bulkDeleting || !summary?.cardEntries.length}>Delete all card</Button>
              </div>
            ) : undefined
          }
        >
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
                    <div className="tips-row-right">
                      <Badge tone="warning">{formatCents(entry.amountCents)}</Badge>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteCashEntry(entry.id)} disabled={saving}>✕</Button>
                    </div>
                  </article>
                ))}
              </div>
              {!loading && (summary?.cashEntries.length ?? 0) === 0 ? <p className="subtle">No cash tips entered this week.</p> : null}
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
                    <div className="tips-row-right">
                      <Badge tone="info">{formatCents(entry.amountCents)}</Badge>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteCardEntry(entry.id)} disabled={saving}>✕</Button>
                    </div>
                  </article>
                ))}
              </div>
              {!loading && (summary?.cardEntries.length ?? 0) === 0 ? <p className="subtle">No card tips imported this week.</p> : null}
            </div>
            {(summary?.paidRuns.length ?? 0) > 0 ? (
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
              </div>
            ) : null}
          </div>
        </Card>
      </TipsSection>

      {/* Manual staff hours */}
      <TipsSection title="Manual staff hours" summary={`${summary?.manualHoursEntries.length ?? 0} manual entries`}>
        <Card title="Manually add staff hours" subtitle="Add a staff member to the tips allocation pool for this week — useful when they have no approved timesheets.">
          <div className="form-grid three">
            <Select
              label="Staff member"
              value={manualStaffId}
              onChange={(event) => setManualStaffId(event.currentTarget.value)}
              options={[{ value: '', label: 'Choose staff…' }, ...staffOptions]}
            />
            <Input label="Hours" type="number" min="0.25" step="0.25" value={manualHours} onChange={(event) => setManualHours(event.currentTarget.value)} placeholder="e.g. 6.5" />
            <Input label="Notes" value={manualNotes} onChange={(event) => setManualNotes(event.currentTarget.value)} placeholder="Optional notes" />
          </div>
          <div className="toolbar-right">
            <Button type="button" disabled={saving || !manualStaffId || !manualHours} onClick={() => void saveManualHours()}>
              {saving && messageTarget === 'manual' ? 'Saving…' : 'Add to allocation'}
            </Button>
            <ActionFeedback
              message={messageTarget === 'manual' ? message : null}
              tone={message?.includes('Could') || message?.includes('Choose') ? 'error' : 'success'}
            />
          </div>
          {(summary?.manualHoursEntries.length ?? 0) > 0 ? (
            <div className="staff-list" style={{ marginTop: 12 }}>
              {(summary?.manualHoursEntries ?? []).map((entry) => (
                <article key={entry.id} className="staff-list-button tips-row">
                  <span>
                    <strong>{entry.staffName}</strong>
                    <span className="subtle">{entry.hours}h manual · {entry.venue}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => void deleteManualHoursEntry(entry.id)} disabled={saving}>✕</Button>
                </article>
              ))}
            </div>
          ) : null}
        </Card>
      </TipsSection>

      {/* Payroll status + entitlements */}
      <TipsSection title="Staff entitlements" summary={`${reviewedRows.length} staff · ${hasPaidRun ? 'approved' : 'waiting for review'}`}>
        <Card title="Staff entitlements" subtitle={`Tip pool after $${breakagePerDay}/day breakage deduction, split by approved hours. Review and adjust before locking.`} padding="none" className="tips-entitlements-card">
        <div className="tips-status-bar">
          <div className={`tips-status-panel ${hasPaidRun ? 'is-locked' : ''}`}>
            <span>
              <strong>{hasPaidRun ? 'Approved tip run locked' : 'Waiting for review'}</strong>
              <span className="subtle">
                {hasPaidRun
                  ? 'Reports payroll export will use the latest paid run for this week and venue.'
                  : 'Review, then approve and pay at the bottom to lock the run for payroll.'}
              </span>
            </span>
            <Badge tone={hasPaidRun ? 'positive' : 'warning'}>{hasPaidRun ? 'Payroll ready' : 'Waiting for review'}</Badge>
          </div>
          <div style={{ padding: '0 16px 12px' }}>
            <Input label="Paid run notes" value={payoutNotes} onChange={(event) => setPayoutNotes(event.currentTarget.value)} placeholder="Optional notes for payroll" />
          </div>
        </div>
        {!loading && !reviewedRows.length ? (
          <EmptyState title="No tip entitlements yet" description="Approve timesheets, import tips, and add manual hours to calculate staff payouts." />
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
      </TipsSection>

      {lockedRows.length ? (
        <TipsSection title="Approved tip run" summary={`${lockedRows.length} staff locked for payroll`}>
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
        </TipsSection>
      ) : null}

      <TipsSection title="Approve and pay" summary={hasPaidRun ? 'Export the approved run' : 'Final payroll approval'}>
        <Card title={hasPaidRun ? 'Approved run exports' : 'Approve and pay'} subtitle={hasPaidRun ? 'Export the locked tip run for bank payment or payroll records.' : 'Approve once the final payout balances to the allocatable pool.'}>
          <div className="tips-approval-footer">
            <div>
              <strong>{hasPaidRun ? 'Ready to export' : 'Waiting for review'}</strong>
              <p className="subtle">
                {hasPaidRun
                  ? `${lockedRows.length} staff · ${formatCents(lockedRows.reduce((sum, row) => sum + row.amountCents, 0))} approved.`
                  : `${reviewedRows.length} staff · final payout ${formatCents(totalPayoutCents)} · variance ${formatCents(payoutVarianceCents)}.`}
              </p>
            </div>
            {!hasPaidRun ? (
              <Button type="button" onClick={() => void markPaid()} disabled={saving || !summary?.entitlements.length || payoutVarianceCents !== 0}>
                {saving && messageTarget === 'paid' ? 'Approving…' : 'Approve and pay'}
              </Button>
            ) : (
              <div className="toolbar">
                <Button type="button" onClick={() => void exportTipsAba()} disabled={saving || !lockedRows.length}>
                  {saving && messageTarget === 'aba' ? 'Exporting…' : 'Export ABA'}
                </Button>
                <Button type="button" variant="secondary" onClick={() => void exportTips()} disabled={saving || !lockedRows.length}>
                  {saving && messageTarget === 'export' ? 'Exporting…' : 'Export CSV'}
                </Button>
              </div>
            )}
          </div>
          <ActionFeedback
            message={['paid', 'aba', 'export'].includes(messageTarget ?? '') ? message : null}
            tone={message?.includes('Could') || message?.includes('Choose') || message?.includes('variance') || message?.includes('Cannot') || message?.includes('Approve') || message?.includes('already') || message?.includes('not configured') || message?.includes('No approved') ? 'error' : 'success'}
          />
        </Card>
      </TipsSection>
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

// Venue Readiness (#20/#21) — green/amber/red checklist status for today.
// Built on the existing ChecklistRun data; the API method is
// /api/checklists/today-readiness?date=&venue=.
type ReadinessRow = {
  templateId: string;
  templateName: string;
  area: string | null;
  kind: 'opening' | 'closing' | 'service';
  itemsTotal: number;
  itemsPassed: number;
  itemsFailed: number;
  itemsPending: number;
  status: 'GREEN' | 'AMBER' | 'RED' | 'MISSING';
  runId: string | null;
  updatedAt: string | null;
  performedBy: string | null;
};

type ReadinessPayload = {
  date: string;
  venue: string | null;
  generatedAt: string;
  overall: { opening: ReadinessRow['status']; closing: ReadinessRow['status']; overall: ReadinessRow['status'] };
  rows: ReadinessRow[];
};

function readinessTone(status: ReadinessRow['status']): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'GREEN') return 'positive';
  if (status === 'AMBER') return 'warning';
  if (status === 'RED') return 'danger';
  return 'muted'; // MISSING
}

function readinessLabel(status: ReadinessRow['status']): string {
  if (status === 'GREEN') return 'Ready';
  if (status === 'AMBER') return 'In progress';
  if (status === 'RED') return 'Failed item';
  return 'Not started';
}

function VenueReadinessPage({ staff }: { staff: StaffProfile[] }) {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
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
      const data = await api<ReadinessPayload>(`/api/checklists/today-readiness?${params.toString()}`);
      setPayload(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load venue readiness.');
    } finally {
      setLoading(false);
    }
  }, [date, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Auto-refresh once every two minutes — readiness changes as items are
    // ticked off, but we don't need second-by-second polling.
    const id = setInterval(() => { void load(); }, 120_000);
    return () => clearInterval(id);
  }, [load]);

  const openingRows = payload?.rows.filter((row) => row.kind === 'opening') ?? [];
  const closingRows = payload?.rows.filter((row) => row.kind === 'closing') ?? [];
  const serviceRows = payload?.rows.filter((row) => row.kind === 'service') ?? [];

  function renderGroup(title: string, subtitle: string, rows: ReadinessRow[], rollup: ReadinessRow['status'] | undefined) {
    return (
      <Card>
        <div className="readiness-group-head">
          <div>
            <span className="readiness-eyebrow">{title}</span>
            <p className="readiness-subtitle">{subtitle}</p>
          </div>
          {rollup ? (
            <span className={`readiness-rollup is-${rollup.toLowerCase()}`}>
              <span className="readiness-rollup-dot" aria-hidden="true" />
              {readinessLabel(rollup)}
            </span>
          ) : null}
        </div>
        {rows.length ? (
          <ul className="readiness-list">
            {rows.map((row) => (
              <li key={row.templateId} className={`readiness-row is-${row.status.toLowerCase()}`}>
                <span className="readiness-row-dot" aria-hidden="true" />
                <span className="readiness-row-text">
                  <strong>{row.templateName}</strong>
                  <span className="subtle">
                    {row.area || 'Whole venue'}
                    {' · '}
                    {row.itemsPassed}/{row.itemsTotal} done
                    {row.itemsFailed > 0 ? ` · ${row.itemsFailed} failed` : ''}
                    {row.performedBy ? ` · ${row.performedBy}` : ''}
                    {row.updatedAt ? ` · updated ${new Date(row.updatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ''}
                  </span>
                </span>
                <span className="readiness-row-status">
                  <Badge tone={readinessTone(row.status)}>{readinessLabel(row.status)}</Badge>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      // Compliance app hosts the checklist runs. Deep-link if we have a run id,
                      // otherwise drop the manager into the checklists landing for that template.
                      const base = 'https://alma-compliance.web.app';
                      window.location.href = row.runId ? `${base}/checklists/runs/${row.runId}` : `${base}/checklists`;
                    }}
                  >
                    Open
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="subtle">No {title.toLowerCase()} checklists scheduled for today.</p>
        )}
      </Card>
    );
  }

  return (
    <div className="page-stack readiness-page">
      <PageHeader
        eyebrow="Venue readiness"
        title="Are we ready to open / close?"
        description="Today's checklists at a glance. Green = done, amber = in progress, red = failed item, grey = not started."
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

      {payload ? (
        <div className="readiness-banners">
          <div className={`readiness-banner is-${payload.overall.opening.toLowerCase()}`}>
            <span className="readiness-banner-tag">Opening</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.opening)}</span>
          </div>
          <div className={`readiness-banner is-${payload.overall.closing.toLowerCase()}`}>
            <span className="readiness-banner-tag">Closing</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.closing)}</span>
          </div>
          <div className={`readiness-banner is-${payload.overall.overall.toLowerCase()}`}>
            <span className="readiness-banner-tag">Overall</span>
            <span className="readiness-banner-label">{readinessLabel(payload.overall.overall)}</span>
          </div>
        </div>
      ) : null}

      {renderGroup('Opening', 'Get-ready checks. Aim for green before service starts.', openingRows, payload?.overall.opening)}
      {renderGroup('Closing', 'End-of-day checks. Aim for green before lockup.', closingRows, payload?.overall.closing)}
      {serviceRows.length ? renderGroup('During service', 'Mid-service checks like temperature logs and bar walks.', serviceRows, undefined) : null}
    </div>
  );
}

// Manager Daily Brief (#29) — the 10-second morning glance.
// Reads the same /manager-dashboard payload, but renders a focused,
// scannable summary with deep-link buttons into the work surfaces.
// Auto-refreshes once a minute so the page stays fresh through the day.
function ManagerDailyBriefPage({ staff }: { staff: StaffProfile[] }) {
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
            <strong>Reply to last shift's handover.</strong> If anything's outstanding, acknowledge it in <a href="https://alma-comms.web.app/handover">Comms · Handover</a>.
          </li>
          <li>
            <strong>Pre-walkthrough bookings.</strong> Open <a href="https://alma-reserve.web.app">Reserve</a> and read the night's notes.
          </li>
        </ul>
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
          <span className="live-hero-hint">{dashboard?.salesByVenue.length ? `${dashboard.salesByVenue.length} venue${dashboard.salesByVenue.length === 1 ? '' : 's'}` : 'No sales yet'}</span>
        </div>
        <div className={`live-hero-metric ${wageTone}`}>
          <span className="live-hero-label">Wage cost</span>
          <span className="live-hero-value">{wagePercent == null ? '—' : `${wagePercent.toFixed(1)}%`}</span>
          <span className="live-hero-hint">{formatCents(dashboard?.totals.actualWageCents ?? 0)} · {roundHours(dashboard?.totals.actualHours ?? 0)}h actual</span>
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
                  <span className="subtle">{new Date(entry.workDate).toLocaleDateString()} · {timeOf(entry.clockInAt)}–{timeOf(entry.clockOutAt)} · {roundHours(timesheetHours(entry))}h</span>
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

type TimesheetGroup = {
  id: string;
  member: StaffProfile | undefined;
  name: string;
  venue: string;
  roleTitle: string;
  entries: Timesheet[];
  totalHours: number;
  submittedIds: string[];
  approvedCount: number;
};

// Group timesheets by staff member. Each group exposes the member's display
// name, derived venue/role, total hours, the ids that still need approval
// (SUBMITTED or REJECTED) and how many are already approved. Entries are sorted
// newest-first; groups are sorted alphabetically by name.
function groupTimesheetsByStaff(entries: Timesheet[], staff: StaffProfile[]): TimesheetGroup[] {
  const map = new Map<string, { id: string; member: StaffProfile | undefined; name: string; entries: Timesheet[] }>();
  for (const entry of entries) {
    const id = entry.staffProfileId;
    let group = map.get(id);
    if (!group) {
      const member = staff.find((candidate) => candidate.id === id);
      const name = entry.staffProfile
        ? `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}`.trim()
        : member
          ? `${member.firstName} ${member.lastName}`.trim()
          : 'Staff member';
      group = { id, member, name, entries: [] };
      map.set(id, group);
    }
    group.entries.push(entry);
  }
  return Array.from(map.values())
    .map((group) => {
      const entries = [...group.entries].sort(
        (a, b) => new Date(b.workDate).getTime() - new Date(a.workDate).getTime()
      );
      return {
        ...group,
        entries,
        venue: group.member?.venue ?? entries[0]?.staffProfile?.venue ?? entries[0]?.venue ?? '',
        roleTitle: group.member?.roleTitle ?? entries[0]?.staffProfile?.roleTitle ?? '',
        totalHours: entries.reduce((sum, entry) => sum + timesheetHours(entry), 0),
        submittedIds: entries
          .filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'REJECTED')
          .map((entry) => entry.id),
        approvedCount: entries.filter((entry) => entry.status === 'APPROVED').length
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Which slice of the explorer the manager is currently focused on.
type TimesheetSelection = { type: 'all' } | { type: 'venue'; venue: string } | { type: 'staff'; id: string };

function TimesheetsPage({ staff, roster = [] }: { staff: StaffProfile[]; roster?: RosterShift[] }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  // Range mode: 'week' uses the week navigator; '30'/'90' look back N days.
  const [rangeMode, setRangeMode] = useState<'week' | '30' | '90'>('week');
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
  const [clockSessions, setClockSessions] = useState<StaffClockSession[]>([]);
  // Submit-new-timesheet modal visibility.
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  // Explorer rail selection (all / a venue / a staff member).
  const [selection, setSelection] = useState<TimesheetSelection>({ type: 'all' });

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  // Effective query window: the navigated week, or a rolling N-day lookback.
  const rangeStart = useMemo(
    () => (rangeMode === 'week' ? weekStart : addDays(new Date(), -Number(rangeMode))),
    [rangeMode, weekStart]
  );
  const rangeEnd = useMemo(
    () => (rangeMode === 'week' ? weekEnd : addDays(new Date(), 1)),
    [rangeMode, weekEnd]
  );
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

  // All loaded timesheets grouped by staff member (powers the staff rail).
  const allGroups = useMemo(() => groupTimesheetsByStaff(timesheets, staff), [timesheets, staff]);

  // Per-venue counts for the explorer rail's "Locations" section.
  const venueSummaries = useMemo(() => {
    const map = new Map<string, { venue: string; count: number; submitted: number; approved: number }>();
    for (const entry of timesheets) {
      const venue = entry.venue || entry.staffProfile?.venue || 'No venue';
      const summary = map.get(venue) ?? { venue, count: 0, submitted: 0, approved: 0 };
      summary.count += 1;
      if (entry.status === 'SUBMITTED' || entry.status === 'REJECTED') summary.submitted += 1;
      if (entry.status === 'APPROVED') summary.approved += 1;
      map.set(venue, summary);
    }
    return Array.from(map.values()).sort((a, b) => a.venue.localeCompare(b.venue));
  }, [timesheets]);

  // Overall counts shown against the "All timesheets" rail item.
  const overallCounts = useMemo(
    () => ({
      count: timesheets.length,
      submitted: timesheets.filter((entry) => entry.status === 'SUBMITTED' || entry.status === 'REJECTED').length,
      approved: timesheets.filter((entry) => entry.status === 'APPROVED').length
    }),
    [timesheets]
  );

  // Groups filtered to the current explorer selection (shown in the detail pane).
  const visibleGroups = useMemo(() => {
    const filtered = timesheets.filter((entry) => {
      if (selection.type === 'all') return true;
      if (selection.type === 'staff') return entry.staffProfileId === selection.id;
      return (entry.venue || entry.staffProfile?.venue || 'No venue') === selection.venue;
    });
    return groupTimesheetsByStaff(filtered, staff);
  }, [timesheets, staff, selection]);

  const detailTitle =
    selection.type === 'all'
      ? 'All timesheets'
      : selection.type === 'venue'
        ? selection.venue
        : allGroups.find((group) => group.id === selection.id)?.name ?? 'Employee';

  const loadTimesheets = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const query = new URLSearchParams({
        start: rangeStart.toISOString(),
        end: rangeEnd.toISOString(),
        status: statusFilter,
        venue: venueFilter
      });
      setTimesheets(await api<Timesheet[]>(`/api/staff/timesheets?${query.toString()}`));

      // Fetch clock sessions for the same window to power timesheet
      // reconciliation. Gracefully no-op if the endpoint isn't deployed.
      try {
        const clockQuery = new URLSearchParams({
          start: rangeStart.toISOString(),
          end: rangeEnd.toISOString(),
          venue: venueFilter
        });
        const sessions = await api<StaffClockSession[]>(`/api/staff/clock-sessions?${clockQuery.toString()}`);
        setClockSessions(sessions);
      } catch {
        setClockSessions([]);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load timesheets.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, venueFilter, rangeEnd, rangeStart]);

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
      setShowSubmitModal(false);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not submit timesheet.');
    } finally {
      setSaving(false);
    }
  }

  async function markCashPaid(id: string) {
    const cashNotes = window.prompt('Cash payment notes (optional)') ?? '';
    setSaving(true);
    setMessage(null);
    setMessageTarget(`cash:${id}`);
    try {
      await api(`/api/staff/timesheets/${id}/cash-paid`, {
        method: 'POST',
        body: JSON.stringify({ notes: cashNotes })
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

  // Bulk-approve a whole group's outstanding timesheets in parallel.
  async function approveGroup(ids: string[]) {
    if (ids.length === 0) return;
    setMessageTarget('approve-group');
    setSaving(true);
    setMessage(null);
    try {
      await Promise.all(
        ids.map((id) => api(`/api/staff/timesheets/${id}/approve`, { method: 'POST', body: JSON.stringify({}) }))
      );
      setMessage(`Approved ${ids.length} timesheet${ids.length === 1 ? '' : 's'}.`);
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not approve timesheets.');
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

  // Push approved Xero timesheets straight into Xero as draft timesheets.
  async function pushToXero() {
    if (
      !window.confirm(
        'Push approved Xero timesheets for this period straight into Xero as draft timesheets? Review them in Xero before the pay run.'
      )
    ) {
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageTarget('push');
    try {
      const result = await api<{
        pushed: number;
        failed: number;
        results: { employee: string; status: string; message: string }[];
      }>('/api/staff/timesheets/push/xero', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          venue: venueFilter
        })
      });
      const failures = result.results
        .filter((entry) => entry.status === 'failed')
        .map((entry) => `${entry.employee}: ${entry.message}`);
      setMessage(
        `Pushed ${result.pushed} employee timesheet${result.pushed === 1 ? '' : 's'} to Xero as drafts${
          result.failed ? `. ${result.failed} failed — ${failures.join('; ')}` : '.'
        }`
      );
      await loadTimesheets();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not push timesheets to Xero.');
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

  function renderSubmitFields() {
    return (
      <>
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
      </>
    );
  }

  function renderGroup(group: TimesheetGroup) {
    return (
      <section key={group.id} className="timesheet-group">
        <header className="timesheet-group-head">
          <span className="timesheet-group-avatar">
            {group.member ? staffInitials(group.member) : (group.name[0] ?? 'A').toUpperCase()}
          </span>
          <div className="timesheet-group-meta">
            <strong>{group.name}</strong>
            <span className="subtle">{[group.roleTitle, group.venue].filter(Boolean).join(' · ') || 'No venue set'}</span>
          </div>
          <div className="timesheet-group-stats">
            <span>
              <strong>{group.entries.length}</strong> shift{group.entries.length === 1 ? '' : 's'}
            </span>
            <span>
              <strong>{roundHours(group.totalHours)}</strong>h
            </span>
            {group.submittedIds.length ? (
              <Badge tone="info" dot>{group.submittedIds.length} to approve</Badge>
            ) : null}
            {group.approvedCount ? <Badge tone="positive">{group.approvedCount} approved</Badge> : null}
          </div>
          {group.submittedIds.length ? (
            <Button type="button" size="sm" disabled={saving} onClick={() => void approveGroup(group.submittedIds)}>
              Approve all
            </Button>
          ) : null}
        </header>
        <div className="timesheet-group-rows">
          {group.entries.map((entry) => {
            const member = group.member;
            const awardCheck = checkAwardCompliance(member);
            const clockDrift = computeClockDrift(entry, clockSessions);
            return (
              <div key={entry.id} className="timesheet-row">
                <div className="timesheet-row-when">
                  <strong>{new Date(entry.workDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
                  <span>{timeOf(entry.clockInAt)}–{timeOf(entry.clockOutAt)}</span>
                </div>
                <span className="timesheet-row-hours">{roundHours(timesheetHours(entry))}h</span>
                <span className="timesheet-row-area subtle">{entry.area || '—'}</span>
                <div className="timesheet-row-badges">
                  <Badge tone={timesheetTone(entry.status)} dot>{entry.status}</Badge>
                  <Badge tone={entry.paymentMethod === 'CASH' ? 'warning' : 'muted'}>
                    {entry.paymentMethod === 'CASH' ? (entry.cashPaidAt ? 'Cash paid' : 'Cash') : 'Xero'}
                  </Badge>
                  {awardCheck.status === 'below' ? (
                    <Badge tone="danger" dot>Award ⚠</Badge>
                  ) : null}
                  {clockDrift ? (
                    <span title={`Clock ${clockDrift.clockHours.toFixed(2)}h vs timesheet ${timesheetHours(entry).toFixed(2)}h`}>
                      <Badge tone={clockDrift.severity === 'danger' ? 'danger' : 'warning'} dot>
                        Drift {clockDrift.driftHours >= 0 ? '+' : ''}{clockDrift.driftHours.toFixed(1)}h
                      </Badge>
                    </span>
                  ) : null}
                </div>
                <div className="timesheet-row-actions">
                  {entry.status === 'SUBMITTED' || entry.status === 'REJECTED' ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void approve(entry.id)}>
                      Approve
                    </Button>
                  ) : null}
                  {entry.status === 'APPROVED' && entry.paymentMethod === 'CASH' && !entry.cashPaidAt ? (
                    <Button type="button" size="sm" disabled={saving} onClick={() => void markCashPaid(entry.id)}>
                      Cash paid
                    </Button>
                  ) : null}
                  {entry.status !== 'EXPORTED' ? (
                    <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void reject(entry.id)}>
                      Reject
                    </Button>
                  ) : null}
                </div>
                {awardCheck.status === 'below' ? (
                  <span className="timesheet-row-note award-compliance-warning" role="alert">
                    ⚠ Pay rate ${(member?.payRateCents ?? 0) / 100}/hr below{' '}
                    {awardCheck.employmentType === 'CASUAL' ? 'casual loaded' : 'ordinary'} minimum ${awardCheck.minimumCents / 100}/hr ({awardCheck.classificationLabel})
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Payroll"
        title="Timesheets"
        description="Staff submit worked hours, managers approve them, then approved hours push straight into Xero as draft timesheets (or export a Xero-ready CSV)."
      />

      <div className="stats-grid">
        <StatCard label="Submitted" value={submittedCount} hint="Awaiting approval" loading={loading} />
        <StatCard label="Approved" value={approvedCount} hint="Ready for Xero" loading={loading} />
        <StatCard label="Approved hours" value={roundHours(approvedHours)} hint={formatRange(weekStart, addDays(weekEnd, -1))} loading={loading} />
      </div>

      <div className="timesheet-page-toolbar">
        <Button
          type="button"
          onClick={() => {
            setMessage(null);
            setMessageTarget(null);
            setShowSubmitModal(true);
          }}
        >
          + Submit new timesheet
        </Button>
        <div className="toolbar-right">
          <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void exportXero(false)}>
            Preview CSV
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void exportXero(true)}>
            Export CSV
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void pushToXero()}>
            Push to Xero
          </Button>
        </div>
      </div>

      {/* Week selector — same editorial style as the roster board, sitting
          between the toolbar and the approval queue. */}
      <div className="alma-roster-header alma-roster-header--tight">
        <div className="alma-roster-header-titles">
          <div className="alma-roster-title-row">
            <span className="alma-roster-title">Week of</span>
            <span className="alma-roster-title is-italic">{formatRange(weekStart, addDays(weekEnd, -1))}</span>
            <div className="alma-roster-weeknav">
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Previous week"
                onClick={() => { setRangeMode('week'); setWeekStart(addDays(weekStart, -7)); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="15 6 9 12 15 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn"
                aria-label="Next week"
                onClick={() => { setRangeMode('week'); setWeekStart(addDays(weekStart, 7)); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <polyline points="9 6 15 12 9 18" />
                </svg>
              </button>
              <button
                type="button"
                className="alma-roster-weeknav-btn alma-roster-weeknav-btn--text"
                onClick={() => { setRangeMode('week'); setWeekStart(startOfWeek(new Date())); }}
              >
                This week
              </button>
            </div>
          </div>
        </div>
      </div>

      {(messageTarget === 'preview' || messageTarget === 'export' || messageTarget === 'push') && message ? (
        <p className={message.includes('Could') || message.includes('failed') ? 'error-text' : 'subtle'}>{message}</p>
      ) : null}

      {showSubmitModal ? (
        <div className="timesheet-modal-overlay" role="dialog" aria-modal="true" onClick={() => setShowSubmitModal(false)}>
          <div className="timesheet-modal" onClick={(event) => event.stopPropagation()}>
            <header className="timesheet-modal-head">
              <strong>Submit new timesheet</strong>
              <button type="button" className="timesheet-modal-close" aria-label="Close" onClick={() => setShowSubmitModal(false)}>
                ×
              </button>
            </header>
            <div className="timesheet-modal-body">{renderSubmitFields()}</div>
          </div>
        </div>
      ) : null}

      <div className="timesheet-board">
        <Card title="Approval queue" subtitle="Review and approve submitted hours by employee or location">
          <div className="roster-week-controls" aria-label="Timesheet week controls">
            <Select
              label="Range"
              value={rangeMode}
              onChange={(event) => {
                const value = event.currentTarget.value as 'week' | '30' | '90';
                setRangeMode(value);
              }}
              options={[
                { label: 'By week', value: 'week' },
                { label: 'Last 30 days', value: '30' },
                { label: 'Last 90 days', value: '90' }
              ]}
            />
            {rangeMode !== 'week' ? (
              <strong>{formatRange(rangeStart, addDays(rangeEnd, -1))}</strong>
            ) : null}
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

          {message && (messageTarget === null || messageTarget === 'approve-group' || /^(approve|reject|cash):/.test(messageTarget)) ? (
            <p className={message.includes('Could') ? 'error-text' : 'subtle'}>{message}</p>
          ) : null}

          {loading ? <Spinner label="Loading timesheets…" /> : null}
          {!loading && timesheets.length === 0 ? (
            <EmptyState title="No timesheets yet" description="Submitted timesheets for this period will appear here." />
          ) : null}

          {!loading && timesheets.length > 0 ? (
            <div className="timesheet-explorer">
              <aside className="timesheet-explorer-rail" aria-label="Timesheet filters">
                <button
                  type="button"
                  className={`ts-rail-item ${selection.type === 'all' ? 'is-active' : ''}`}
                  onClick={() => setSelection({ type: 'all' })}
                >
                  <span className="ts-rail-name">All timesheets</span>
                  <span className="ts-rail-counts">
                    {overallCounts.approved} Approved · {overallCounts.submitted} Submitted
                  </span>
                </button>
                {venueSummaries.length > 1 ? (
                  <div className="ts-rail-section">
                    <span className="ts-rail-heading">Locations</span>
                    {venueSummaries.map((summary) => (
                      <button
                        key={summary.venue}
                        type="button"
                        className={`ts-rail-item ${selection.type === 'venue' && selection.venue === summary.venue ? 'is-active' : ''}`}
                        onClick={() => setSelection({ type: 'venue', venue: summary.venue })}
                      >
                        <span className="ts-rail-name">{summary.venue}</span>
                        <span className="ts-rail-counts">
                          {summary.approved} Approved · {summary.submitted} Submitted
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="ts-rail-section">
                  <span className="ts-rail-heading">Staff</span>
                  {allGroups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      className={`ts-rail-item ts-rail-staff ${selection.type === 'staff' && selection.id === group.id ? 'is-active' : ''}`}
                      onClick={() => setSelection({ type: 'staff', id: group.id })}
                    >
                      <span className="ts-rail-avatar">
                        {group.member ? staffInitials(group.member) : (group.name[0] ?? 'A').toUpperCase()}
                      </span>
                      <span className="ts-rail-staff-meta">
                        <span className="ts-rail-name">{group.name}</span>
                        <span className="ts-rail-counts">
                          {group.approvedCount} Approved · {group.submittedIds.length} Submitted
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="timesheet-explorer-detail">
                <div className="timesheet-explorer-detail-head">
                  <strong>{detailTitle}</strong>
                  {selection.type !== 'all' ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelection({ type: 'all' })}>
                      View all
                    </Button>
                  ) : null}
                </div>
                {visibleGroups.length === 0 ? (
                  <EmptyState title="No timesheets" description="Nothing matches this selection for the chosen period." />
                ) : null}
                <div className="timesheet-groups">{visibleGroups.map((group) => renderGroup(group))}</div>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

type ClockDriftResult = {
  driftHours: number;
  clockHours: number;
  clockInAt: string;
  clockOutAt: string | null;
  severity: 'ok' | 'warning' | 'danger';
};

function computeClockDrift(timesheet: Timesheet, clockSessions: StaffClockSession[]): ClockDriftResult | null {
  // Match clock sessions where the staff member is the same and the clock-in
  // falls on the same calendar date as the timesheet's workDate.
  const tsDate = new Date(timesheet.workDate);
  const dayKey = tsDate.toISOString().slice(0, 10);
  const candidates = clockSessions.filter((s) =>
    s.staffProfileId === timesheet.staffProfileId &&
    s.clockOutAt !== null &&
    s.clockInAt.slice(0, 10) === dayKey
  );
  if (candidates.length === 0) return null;

  // If there are multiple, pick the one closest to the timesheet's clock-in
  const tsClockIn = new Date(timesheet.clockInAt).getTime();
  candidates.sort((a, b) =>
    Math.abs(new Date(a.clockInAt).getTime() - tsClockIn) -
    Math.abs(new Date(b.clockInAt).getTime() - tsClockIn)
  );
  const match = candidates[0]!;

  const clockOutMs = new Date(match.clockOutAt!).getTime();
  const clockInMs = new Date(match.clockInAt).getTime();
  const clockHours = (clockOutMs - clockInMs) / 1000 / 60 / 60 - (match.accumulatedBreakMinutes / 60);
  const tsHours = timesheetHours(timesheet);
  const driftHours = tsHours - clockHours;
  const absDrift = Math.abs(driftHours);
  const severity: 'ok' | 'warning' | 'danger' =
    absDrift < 0.1 ? 'ok' : absDrift < 0.5 ? 'warning' : 'danger';
  // Don't surface drift if it's negligible
  if (severity === 'ok') return null;
  return { driftHours, clockHours, clockInAt: match.clockInAt, clockOutAt: match.clockOutAt, severity };
}

type AwardComplianceResult =
  | { status: 'compliant'; minimumCents: number; employmentType: string; classificationLabel: string }
  | { status: 'below'; minimumCents: number; employmentType: string; classificationLabel: string }
  | { status: 'unknown' };

function checkAwardCompliance(member: StaffProfile | undefined): AwardComplianceResult {
  if (!member?.payRateCents) return { status: 'unknown' };
  if (!member.payProfile) return { status: 'unknown' };
  const pp = member.payProfile;
  const isCasual = pp.employmentType === 'CASUAL';
  const minimumCents = isCasual && pp.casualLoadedHourlyRateCents
    ? pp.casualLoadedHourlyRateCents
    : pp.ordinaryHourlyRateCents;
  const actualCents = member.payRateCents;
  const classificationLabel = pp.awardClassification.replace(/-/g, ' ');
  if (actualCents < minimumCents) {
    return { status: 'below', minimumCents, employmentType: pp.employmentType, classificationLabel };
  }
  return { status: 'compliant', minimumCents, employmentType: pp.employmentType, classificationLabel };
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

function TipsSection({
  title,
  summary,
  defaultOpen = true,
  children
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`tips-collapsible-section ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="tips-collapsible-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{title}</span>
        {summary ? <small>{summary}</small> : null}
      </button>
      {open ? <div className="tips-collapsible-body">{children}</div> : null}
    </section>
  );
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

function staffComplianceDocumentRecord(record: StaffComplianceRecord): StaffComplianceDocumentRecord {
  return record as StaffComplianceDocumentRecord;
}

function recordDocumentRequested(record: Pick<StaffComplianceRecord, 'notes' | 'documentUrl'> & { status: string }) {
  return !record.documentUrl && (record.status === 'REQUESTED' || (record.status === 'PENDING' && Boolean(record.notes?.includes('Document requested again'))));
}

function staffRecordStatusTone(status: string) {
  if (status === 'APPROVED') return 'positive';
  if (status === 'EXPIRED' || status === 'REJECTED') return 'danger';
  if (status === 'UPLOADED') return 'info';
  if (status === 'REQUESTED' || status === 'PENDING') return 'warning';
  return 'muted';
}

function staffRecordStatusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (value) => value.toUpperCase());
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
              <Input label="Role" required value={draft.roleTitle} readOnly />
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
      {user?.accountType === 'VENUE_DEVICE' ? (
        <Routes>
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="*" element={<Navigate to="/device" replace />} />
        </Routes>
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
        <Routes>
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="/" element={<StaffMemberHome staff={staff} loading={loading} reload={reload} />} />
          <Route path="/roster" element={<StaffMemberRosterPage />} />
          <Route path="/clock" element={<StaffMemberClockPage />} />
          <Route path="/leave" element={<StaffMemberLeavePage />} />
          <Route path="/compliance" element={<StaffMemberCompliancePage />} />
          <Route path="/documents" element={<StaffMemberDocumentsPage />} />
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
          <Route path="/device" element={<DeviceHomePage />} />
          <Route path="/" element={<StaffHome staff={staff} loading={loading} onSelect={setSelectedId} reload={reload} />} />
          <Route path="/brief" element={<ManagerDailyBriefPage staff={staff} />} />
          <Route path="/readiness" element={<VenueReadinessPage staff={staff} />} />
          <Route path="/manager" element={<ManagerDashboardPage staff={staff} />} />
          <Route path="/clock" element={<StaffMemberClockPage />} />
          <Route path="/profiles" element={<StaffProfilesPage staff={staff} roleTemplates={roleTemplates} loading={loading} onSelect={setSelectedId} reload={reload} />} />
          <Route path="/invites" element={<InvitesPage staff={staff} roleTemplates={roleTemplates} reloadStaff={reload} />} />
          <Route path="/approvals" element={<ApprovalsPage staff={staff} reload={reload} />} />
          <Route path="/settings" element={canOpenSettings ? <AdminPage staff={staff} selectedId={selectedId} setSelectedId={setSelectedId} reload={reload} /> : <Navigate to="/" replace />} />
          <Route path="/admin" element={canOpenSettings ? <AlmaAdminRedirect /> : <Navigate to="/" replace />} />
          <Route path="/access" element={<Navigate to="/profiles" replace />} />
          <Route path="/staff/:staffId" element={<StaffProfileWorkspacePage staff={staff} roleTemplates={roleTemplates} hrRecords={hrRecords} loading={loading} reload={reload} reloadHr={loadHrRecords} canOpenHr={canOpenHr} canManageHr={canManageHr} canOpenRightToWork={canAccessRightToWorkHr(user)} canManageRightToWork={canManageRightToWorkHr} canOpenPayChanges={canAccessPayChangeHr(user)} />} />
          <Route path="/staff/:staffId/:section" element={<StaffProfileWorkspacePage staff={staff} roleTemplates={roleTemplates} hrRecords={hrRecords} loading={loading} reload={reload} reloadHr={loadHrRecords} canOpenHr={canOpenHr} canManageHr={canManageHr} canOpenRightToWork={canAccessRightToWorkHr(user)} canManageRightToWork={canManageRightToWorkHr} canOpenPayChanges={canAccessPayChangeHr(user)} />} />
          <Route path="/roster" element={<RosterPage staff={staff} roster={roster} reload={reload} />} />
          <Route path="/leave" element={<LeaveCalendarPage staff={staff} />} />
          <Route path="/compliance" element={<StaffMemberCompliancePage />} />
          <Route path="/academy" element={<TrainingPage staff={staff} reloadStaff={reload} />} />
          <Route path="/training" element={<Navigate to="/academy" replace />} />
          <Route path="/timesheets" element={<TimesheetsPage staff={staff} roster={roster} />} />
          <Route path="/tips" element={<TipsPage staff={staff} />} />
          <Route path="/communications" element={<CommunicationsPage staff={staff} reload={reload} />} />
          <Route path="/hr" element={canOpenHr ? <HrOverviewPage records={hrRecords} loading={hrLoading} /> : <Navigate to="/" replace />} />
          <Route path="/hr/contracts" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="CONTRACT" mode="contracts" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/warnings" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="WARNING" mode="warnings" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/pay-changes" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="PAY_CHANGE" mode="pay-changes" loading={hrLoading} reload={loadHrRecords} canManage={canManagePayChangeHr} canApprove={canApprovePayChangeHr} currentUserId={currentUserId} /> : <Navigate to="/" replace />} />
          <Route path="/hr/right-to-work" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} type="RIGHT_TO_WORK" mode="right-to-work" loading={hrLoading} reload={loadHrRecords} canManage={canManageRightToWorkHr} /> : <Navigate to="/" replace />} />
          <Route path="/hr/documents" element={canOpenHr ? <HrSectionPage staff={staff} records={hrRecords} mode="documents" loading={hrLoading} reload={loadHrRecords} canManage={canManageHr} /> : <Navigate to="/" replace />} />
        </Routes>
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
