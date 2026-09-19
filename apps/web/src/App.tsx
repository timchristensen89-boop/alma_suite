import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router-dom';
import { AppShell, Spinner, SUITE_APPS, SuiteAppSwitcher, SuiteClock, SuiteInboxWidget, SuiteSignOutButton, TaskBar, type TaskBarItem, ThemeToggle, TopBar, useDismissibleLayer } from '@alma/ui';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecoveryPages';
import { SuiteAppLoginPage } from './pages/SuiteAppLoginPage';
// AdminPage is exported from this package for admin-web to consume, but the
// Compliance app no longer renders it — admin lives at alma-suite-admin.web.app.
import { NotFoundPage } from './pages/NotFoundPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { NAV_ITEMS, navItemsForRole } from './config/navigation';
import { HubLayout, type HubTab } from './components/HubTabs';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { canAdmin, canManage, type BetaRole } from './lib/rbac';
import {
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconDashboard,
  IconHandbook,
  IconIncident,
  IconInbox,
  IconIssues,
  IconMap,
  IconPlus,
  IconSettings,
  IconStaff,
  IconTemperature
} from './lib/icons';

// Pages load on demand. The whole app used to ship as one chunk, so opening
// the dashboard on a phone also downloaded the audit editor, the handbook
// admin and the icon exporter. Dashboard and the sign-in pages stay eager:
// they are the first paint.
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const IssuesListPage = lazy(() => import('./pages/issues/IssuesListPage').then((m) => ({ default: m.IssuesListPage })));
const IssueDetailPage = lazy(() => import('./pages/issues/IssueDetailPage').then((m) => ({ default: m.IssueDetailPage })));
const IssueCreatePage = lazy(() => import('./pages/issues/IssueCreatePage').then((m) => ({ default: m.IssueCreatePage })));
const IssueEditPage = lazy(() => import('./pages/issues/IssueEditPage').then((m) => ({ default: m.IssueEditPage })));
const ChecklistsListPage = lazy(() => import('./pages/checklists/ChecklistsListPage').then((m) => ({ default: m.ChecklistsListPage })));
const ChecklistRunDetailPage = lazy(() => import('./pages/checklists/ChecklistRunDetailPage').then((m) => ({ default: m.ChecklistRunDetailPage })));
const ChecklistRunCreatePage = lazy(() => import('./pages/checklists/ChecklistRunCreatePage').then((m) => ({ default: m.ChecklistRunCreatePage })));
const ChecklistTemplateEditPage = lazy(() => import('./pages/checklists/ChecklistTemplateEditPage').then((m) => ({ default: m.ChecklistTemplateEditPage })));
const ChecklistIpadPage = lazy(() => import('./pages/checklists/ChecklistIpadPage').then((m) => ({ default: m.ChecklistIpadPage })));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage })));
const StaffPage = lazy(() => import('./pages/StaffPage').then((m) => ({ default: m.StaffPage })));
const TemperaturesPage = lazy(() => import('./pages/TemperaturesPage').then((m) => ({ default: m.TemperaturesPage })));
const LiquorPage = lazy(() => import('./pages/LiquorPage').then((m) => ({ default: m.LiquorPage })));
const AuditsListPage = lazy(() => import('./pages/audits/AuditsListPage').then((m) => ({ default: m.AuditsListPage })));
const AuditRunCreatePage = lazy(() => import('./pages/audits/AuditRunCreatePage').then((m) => ({ default: m.AuditRunCreatePage })));
const AuditRunDetailPage = lazy(() => import('./pages/audits/AuditRunDetailPage').then((m) => ({ default: m.AuditRunDetailPage })));
const AuditTemplateCreatePage = lazy(() => import('./pages/audits/AuditTemplateCreatePage').then((m) => ({ default: m.AuditTemplateCreatePage })));
const HandbookAdminPage = lazy(() => import('./pages/handbook/HandbookIndexPage').then((m) => ({ default: m.HandbookAdminPage })));
const OrgChartPage = lazy(() => import('./pages/handbook/OrgChartPage').then((m) => ({ default: m.OrgChartPage })));
const GuidelinesPage = lazy(() => import('./pages/handbook/GuidelinesPage').then((m) => ({ default: m.GuidelinesPage })));
const HandbookOnboardingPage = lazy(() => import('./pages/handbook/OnboardingPage').then((m) => ({ default: m.OnboardingPage })));
const MaintenancePage = lazy(() => import('./pages/handbook/MaintenancePage').then((m) => ({ default: m.MaintenancePage })));
const IconExportPage = lazy(() => import('./pages/IconExportPage').then((m) => ({ default: m.IconExportPage })));

const suiteApps = withSuiteAppLinks(SUITE_APPS);

const SECONDARY_PAGE_METADATA = [
  {
    to: '/settings',
    label: 'Compliance settings',
    description: 'Account access, Compliance shortcuts, and Admin handoff',
    icon: <IconSettings />
  },
  {
    to: '/admin/handbook',
    label: 'Handbook admin',
    description: 'Edit staff handbook content',
    icon: <IconHandbook />
  }
];

function SidebarNav() {
  const location = useLocation();
  const { user } = useAuth();
  const navItems = navItemsForRole(user);
  const active = currentPage(location.pathname, navItems);
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'compliance-mobile-nav');

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="compliance-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <IconChevronDown className="mobile-nav-toggle-caret" size={16} />
      </button>
      <ul
        id="compliance-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        {(() => {
          let lastSection: string | undefined;
          return navItems.map((item) => {
            const header =
              item.section && item.section !== lastSection ? (
                <li key={`sec:${item.section}`} className="sidebar-nav-section">{item.section}</li>
              ) : null;
            lastSection = item.section;
            return (
              <Fragment key={item.to}>
                {header}
                <li>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={() => (navMatches(item, location.pathname) ? 'active' : undefined)}
                  >
                    <span className="sidebar-nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              </Fragment>
            );
          });
        })()}
      </ul>
    </div>
  );
}

// True when the current path belongs to this nav item (its route or a hub tab).
function navMatches(item: { to: string; match?: string[] }, pathname: string): boolean {
  const candidates = [item.to, ...(item.match ?? [])];
  return candidates.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
  );
}

function currentPage(pathname: string, navItems = NAV_ITEMS) {
  const secondaryMatch = SECONDARY_PAGE_METADATA.find((item) =>
    pathname === item.to || pathname.startsWith(`${item.to}/`)
  );
  if (secondaryMatch) return secondaryMatch;
  // longest-prefix match (incl. hub sub-tabs via match[])
  const match = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => navMatches(item, pathname));
  if (match) return match;
  return {
    to: pathname,
    label: 'Page not found',
    description: 'The URL didn\'t match any section',
    icon: null
  };
}

function UserMenu() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <SuiteSignOutButton onClick={() => logout()} />
  );
}

function TopBarWithContext() {
  const location = useLocation();
  const { user } = useAuth();
  const active = currentPage(location.pathname, navItemsForRole(user));
  useDocumentTitle(active.label);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        <>
          <SuiteAppSwitcher currentApp="compliance" apps={suiteApps} variant="topbar" />
          <SuiteInboxWidget
            appId="COMPLIANCE"
            api={api}
            currentApp="compliance"
            venue={user?.venue}
            userName={user ? `${user.firstName} ${user.lastName}` : undefined}
            canAnnounce={canManage(user)}
          />
          <ThemeToggle />
          <SuiteClock />
          <UserMenu />
        </>
      }
    />
  );
}

/**
 * The compliance jobs somebody does standing up, on a phone, mid-shift.
 *
 * Temperatures and checklists get done walking the floor; an incident gets
 * logged the moment it happens or not at all. Those belong under a thumb, not
 * three taps into a sidebar written for a desk.
 */
const COMPLIANCE_TASKS: Array<{ to: string; label: string; icon: ReactNode; match?: string[] }> = [
  // Named here rather than looked up from NAV_ITEMS: "Log issue" is /issues/new,
  // which has no sidebar entry, so the lookup returned undefined and the bar
  // shipped with a bare label sitting between four icons.
  { to: '/', label: 'Home', icon: <IconDashboard /> },
  { to: '/checklists', label: 'Checks', icon: <IconChecklist />, match: ['/checklists/runs'] },
  { to: '/temperatures', label: 'Temps', icon: <IconTemperature /> },
  { to: '/issues/new', label: 'Log issue', icon: <IconPlus /> },
  { to: '/incidents', label: 'Incidents', icon: <IconIncident /> },
  { to: '/issues', label: 'Issues', icon: <IconIssues /> },
  { to: '/audits', label: 'Audits', icon: <IconCheck /> },
  { to: '/licences', label: 'Licences', icon: <IconMap /> },
  { to: '/handbook', label: 'Handbook', icon: <IconInbox /> },
  { to: '/staff', label: 'Staff', icon: <IconStaff /> }
];

function ComplianceTaskBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const navItems = navItemsForRole(user);
  const allowed = new Set(navItems.map((item) => item.to));
  const named: TaskBarItem[] = COMPLIANCE_TASKS.filter(
    // Only offer what this person's own nav already grants them; the routes
    // themselves are role-gated, and a bar full of locked doors is worse than
    // a shorter bar.
    (task) => allowed.has(task.to) || allowed.has(`/${task.to.split('/')[1] ?? ''}`)
  ).map((task) => ({
    key: task.to,
    label: task.label,
    href: task.to,
    icon: task.icon,
    active: [task.to, ...(task.match ?? [])].some((path) =>
      path === '/' ? location.pathname === '/' : location.pathname === path || location.pathname.startsWith(`${path}/`)
    )
  }));
  // Anything in this person's own nav that the hand-written list above does
  // not name goes on the end. The sidebar is hidden on phones once this bar
  // exists, so a screen missing from both was simply unreachable — Settings
  // (your account and password) was exactly that.
  const covered = new Set(COMPLIANCE_TASKS.flatMap((task) => [task.to, ...(task.match ?? [])]));
  const rest: TaskBarItem[] = navItems
    .filter((item) => !covered.has(item.to))
    .map((item) => ({
      key: item.to,
      label: item.label,
      href: item.to,
      icon: item.icon,
      active: location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    }));
  const items = [...named, ...rest];
  return (
    <TaskBar
      items={items}
      label="Compliance actions"
      onNavigate={(item, event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(item.href);
      }}
    />
  );
}

function AuthenticatedApp() {
  const { user } = useAuth();
  const canManageChecks = canManage(user);
  // Checks hub tabs — Temperatures & Audits are manager-only, so staff only see
  // the Checklists + iPad runner tabs.
  const checksTabs: HubTab[] = [
    { to: '/checklists', label: 'Checklists', end: true },
    ...(canManageChecks ? ([{ to: '/temperatures', label: 'Temperatures' }] as HubTab[]) : []),
    ...(canManageChecks ? ([{ to: '/audits', label: 'Audits', end: true }] as HubTab[]) : []),
    { to: '/checklists/ipad', label: 'iPad runner' }
  ];
  const issuesTabs: HubTab[] = [
    { to: '/issues', label: 'Issues', end: true },
    { to: '/incidents', label: 'Incidents' }
  ];
  const handbookTabs: HubTab[] = [
    { to: '/handbook/guidelines', label: 'Guidelines' },
    { to: '/handbook/org-chart', label: 'Org chart' },
    { to: '/handbook/onboarding', label: 'Onboarding' },
    { to: '/handbook/maintenance', label: 'Maintenance' }
  ];

  return (
    <AppShell
      sidebar={<SidebarNav />}
      topBar={<TopBarWithContext />}
    >
      <ErrorBoundary>
        <Suspense fallback={<RouteLoader />}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/issues" element={<HubLayout tabs={issuesTabs}><IssuesListPage /></HubLayout>} />
          <Route path="/issues/new" element={<IssueCreatePage />} />
          <Route path="/issues/:id" element={<IssueDetailPage />} />
          <Route path="/issues/:id/edit" element={<IssueEditPage />} />
          <Route path="/checklists" element={<HubLayout tabs={checksTabs}><ChecklistsListPage /></HubLayout>} />
          <Route path="/checklists/new" element={<ChecklistRunCreatePage />} />
          <Route path="/checklists/ipad" element={<ChecklistIpadPage />} />
          <Route path="/checklists/templates/new" element={<RequireRole minimum="MANAGER"><ChecklistTemplateEditPage /></RequireRole>} />
          <Route path="/checklists/templates/:id/edit" element={<RequireRole minimum="MANAGER"><ChecklistTemplateEditPage /></RequireRole>} />
          <Route path="/checklists/runs/:id" element={<ChecklistRunDetailPage />} />
          <Route path="/staff" element={<RequireRole minimum="ADMIN"><StaffPage /></RequireRole>} />
          <Route path="/temperatures" element={<RequireRole minimum="MANAGER"><HubLayout tabs={checksTabs}><TemperaturesPage /></HubLayout></RequireRole>} />
          <Route path="/licences" element={<RequireRole minimum="MANAGER"><LiquorPage /></RequireRole>} />
          <Route path="/licenses" element={<Navigate to="/licences" replace />} />
          <Route path="/license" element={<Navigate to="/licences" replace />} />
          <Route path="/liquor" element={<Navigate to="/licences" replace />} />
          <Route path="/incidents" element={<HubLayout tabs={issuesTabs}><IncidentsPage /></HubLayout>} />
          <Route path="/audits" element={<RequireRole minimum="MANAGER"><HubLayout tabs={checksTabs}><AuditsListPage /></HubLayout></RequireRole>} />
          <Route path="/audits/new" element={<RequireRole minimum="MANAGER"><AuditRunCreatePage /></RequireRole>} />
          <Route path="/audits/templates/new" element={<RequireRole minimum="MANAGER"><AuditTemplateCreatePage /></RequireRole>} />
          <Route path="/audits/:id" element={<RequireRole minimum="MANAGER"><AuditRunDetailPage /></RequireRole>} />
          <Route path="/handbook" element={<Navigate to="/handbook/guidelines" replace />} />
          <Route path="/handbook/guidelines" element={<HubLayout tabs={handbookTabs}><GuidelinesPage /></HubLayout>} />
          <Route path="/handbook/org-chart" element={<HubLayout tabs={handbookTabs}><OrgChartPage /></HubLayout>} />
          <Route path="/handbook/onboarding" element={<HubLayout tabs={handbookTabs}><HandbookOnboardingPage /></HubLayout>} />
          <Route path="/handbook/maintenance" element={<HubLayout tabs={handbookTabs}><MaintenancePage /></HubLayout>} />
          <Route path="/admin/handbook" element={<RequireRole minimum="ADMIN"><HandbookAdminPage /></RequireRole>} />
          <Route path="/icon-export" element={<RequireRole minimum="ADMIN"><IconExportPage /></RequireRole>} />
          {/* Admin moved out of Compliance into the dedicated admin app
              at alma-suite-admin.web.app. Anyone landing on /admin in
              Compliance is bounced to the right place. */}
          <Route path="/admin" element={<AdminRedirect />} />
          <Route path="/admin/*" element={<AdminRedirect />} />
          {/* All roles can reach Settings — SettingsPage self-gates the admin
              tabs and shows non-admins just "My account" (change password). */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </ErrorBoundary>
      <ComplianceTaskBar />
    </AppShell>
  );
}

// Admin lives at alma-suite-admin.web.app. If anyone hits /admin in the
// Compliance app, redirect them there preserving the sub-path so
// /admin/loaded-replacement → admin app's /loaded-replacement, etc.
// The full AdminPage component still ships from this package because
// admin-web imports it — we just don't render it inside Compliance anymore.
function AdminRedirect() {
  const location = useLocation();
  const target = (import.meta.env.VITE_ADMIN_WEB_URL as string | undefined) ?? 'https://alma-suite-admin.web.app';
  // /admin → admin home; /admin/users → /users on admin-web; same for everything else.
  const subPath = location.pathname.replace(/^\/admin/, '') || '/';
  const search = location.search ?? '';
  const hash = location.hash ?? '';
  if (typeof window !== 'undefined') {
    window.location.href = `${target.replace(/\/+$/, '')}${subPath}${search}${hash}`;
  }
  return (
    <div className="full-page-loader">
      <Spinner label="Sending you to the Admin app…" />
    </div>
  );
}

// Shown while a route's chunk downloads — the same full-page spinner the auth
// gate uses, so a slow first open of a section looks like loading, not a blank.
function RouteLoader() {
  return (
    <div className="full-page-loader">
      <Spinner label="Loading…" />
    </div>
  );
}

function RequireRole({ minimum, children }: { minimum: BetaRole; children: JSX.Element }) {
  const { user } = useAuth();
  if (minimum === 'ADMIN' && !canAdmin(user)) return <Navigate to="/" replace />;
  if (minimum === 'MANAGER' && !canManage(user)) return <Navigate to="/" replace />;
  return children;
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
      <Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/onboarding/:token" element={<OnboardingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/apps/:appId/login" element={<SuiteAppLoginPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <AuthenticatedApp />
            </RequireAuth>
          }
        />
      </Routes>
      </Suspense>
    </AuthProvider>
  );
}
