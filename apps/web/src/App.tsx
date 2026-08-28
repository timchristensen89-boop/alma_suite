import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
import { OnboardingPage } from './pages/OnboardingPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecoveryPages';
import { SuiteAppLoginPage } from './pages/SuiteAppLoginPage';
// AdminPage is exported from this package for admin-web to consume, but the
// Compliance app no longer renders it — admin lives at alma-suite-admin.web.app.
import { SettingsPage } from './pages/SettingsPage';
import { IssuesListPage } from './pages/issues/IssuesListPage';
import { IssueDetailPage } from './pages/issues/IssueDetailPage';
import { IssueCreatePage } from './pages/issues/IssueCreatePage';
import { IssueEditPage } from './pages/issues/IssueEditPage';
import { ChecklistsListPage } from './pages/checklists/ChecklistsListPage';
import { ChecklistRunDetailPage } from './pages/checklists/ChecklistRunDetailPage';
import { ChecklistRunCreatePage } from './pages/checklists/ChecklistRunCreatePage';
import { ChecklistTemplateEditPage } from './pages/checklists/ChecklistTemplateEditPage';
import { ChecklistIpadPage } from './pages/checklists/ChecklistIpadPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { StaffPage } from './pages/StaffPage';
import { TemperaturesPage } from './pages/TemperaturesPage';
import { LiquorPage } from './pages/LiquorPage';
import { AuditsListPage } from './pages/audits/AuditsListPage';
import { AuditRunCreatePage } from './pages/audits/AuditRunCreatePage';
import { AuditRunDetailPage } from './pages/audits/AuditRunDetailPage';
import { AuditTemplateCreatePage } from './pages/audits/AuditTemplateCreatePage';
import { HandbookAdminPage } from './pages/handbook/HandbookIndexPage';
import { OrgChartPage } from './pages/handbook/OrgChartPage';
import { GuidelinesPage } from './pages/handbook/GuidelinesPage';
import { OnboardingPage as HandbookOnboardingPage } from './pages/handbook/OnboardingPage';
import { MaintenancePage } from './pages/handbook/MaintenancePage';
import { IconExportPage } from './pages/IconExportPage';
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
  const allowed = new Set(navItemsForRole(user).map((item) => item.to));
  const items: TaskBarItem[] = COMPLIANCE_TASKS.filter(
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
          <Route path="/staff" element={<RequireRole minimum="MANAGER"><StaffPage /></RequireRole>} />
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
    </AuthProvider>
  );
}
