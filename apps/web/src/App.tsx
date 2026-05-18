import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router-dom';
import { AppShell, Spinner, SUITE_APPS, SuiteAppSwitcher, SuiteCommsWidget, TopBar, useDismissibleLayer } from '@alma/ui';
import { DashboardPage } from './pages/DashboardPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecoveryPages';
import { SuiteAppLoginPage } from './pages/SuiteAppLoginPage';
import { AdminPage } from './pages/AdminPage';
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
import { HandbookIndexPage } from './pages/handbook/HandbookIndexPage';
import { OrgChartPage } from './pages/handbook/OrgChartPage';
import { GuidelinesPage } from './pages/handbook/GuidelinesPage';
import { OnboardingPage as HandbookOnboardingPage } from './pages/handbook/OnboardingPage';
import { MaintenancePage } from './pages/handbook/MaintenancePage';
import { IconExportPage } from './pages/IconExportPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { NAV_ITEMS, navItemsForRole } from './config/navigation';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { canAdmin, canManage, type BetaRole } from './lib/rbac';
import {
  IconChevronDown,
  IconLogout,
  IconSearch,
  IconSettings
} from './lib/icons';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

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
        <li className="sidebar-nav-section">Compliance</li>
        {navItems.map((item) => (
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

function currentPage(pathname: string, navItems = NAV_ITEMS) {
  // longest-prefix match
  const match = [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) =>
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`)
    );
  if (match) return match;
  return {
    to: pathname,
    label: 'Page not found',
    description: 'The URL didn\'t match any section',
    icon: null
  };
}

function initialsOf(user: { firstName: string; lastName: string } | null) {
  if (!user) return '';
  return (
    (user.firstName?.[0] ?? '').toUpperCase() +
    (user.lastName?.[0] ?? '').toUpperCase()
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  if (!user) return null;

  return (
    <div className="user-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="topbar-avatar"
        onClick={() => setOpen((p) => !p)}
        aria-label="Account menu"
      >
        {initialsOf(user)}
      </button>
      {open ? (
        <div className="user-menu-panel">
          <div className="user-menu-head">
            <strong>
              {user.firstName} {user.lastName}
            </strong>
            <span className="subtle">{user.email ?? user.roleTitle}</span>
          </div>
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            <IconSettings size={14} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="user-menu-item"
            onClick={async () => {
              setOpen(false);
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <IconLogout size={14} />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TopBarWithContext({ onOpenPalette }: { onOpenPalette: () => void }) {
  const location = useLocation();
  const { user } = useAuth();
  const active = currentPage(location.pathname, navItemsForRole(user));
  useDocumentTitle(active.label);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenPalette();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onOpenPalette]);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        <>
          <button
            type="button"
            className="topbar-search"
            onClick={onOpenPalette}
            aria-label="Open search"
          >
            <IconSearch size={14} />
            <span>Search issues, staff, assets…</span>
            <kbd>⌘K</kbd>
          </button>
          <SuiteCommsWidget
            appId="COMPLIANCE"
            api={api}
            venue={user?.venue}
            userName={user ? `${user.firstName} ${user.lastName}` : undefined}
            canAnnounce={canManage(user)}
          />
          <SuiteAppSwitcher currentApp="compliance" apps={suiteApps} variant="topbar" />
          <NotificationsDrawer />
          <UserMenu />
        </>
      }
    />
  );
}

function AuthenticatedApp() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <AppShell
      sidebar={<SidebarNav />}
      topBar={<TopBarWithContext onOpenPalette={() => setPaletteOpen(true)} />}
    >
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/issues" element={<IssuesListPage />} />
          <Route path="/issues/new" element={<IssueCreatePage />} />
          <Route path="/issues/:id" element={<IssueDetailPage />} />
          <Route path="/issues/:id/edit" element={<IssueEditPage />} />
          <Route path="/checklists" element={<ChecklistsListPage />} />
          <Route path="/checklists/new" element={<ChecklistRunCreatePage />} />
          <Route path="/checklists/ipad" element={<ChecklistIpadPage />} />
          <Route path="/checklists/templates/new" element={<RequireRole minimum="MANAGER"><ChecklistTemplateEditPage /></RequireRole>} />
          <Route path="/checklists/templates/:id/edit" element={<RequireRole minimum="MANAGER"><ChecklistTemplateEditPage /></RequireRole>} />
          <Route path="/checklists/runs/:id" element={<ChecklistRunDetailPage />} />
          <Route path="/staff" element={<RequireRole minimum="MANAGER"><StaffPage /></RequireRole>} />
          <Route path="/temperatures" element={<RequireRole minimum="MANAGER"><TemperaturesPage /></RequireRole>} />
          <Route path="/licences" element={<RequireRole minimum="MANAGER"><LiquorPage /></RequireRole>} />
          <Route path="/licenses" element={<Navigate to="/licences" replace />} />
          <Route path="/license" element={<Navigate to="/licences" replace />} />
          <Route path="/liquor" element={<Navigate to="/licences" replace />} />
          <Route path="/incidents" element={<IncidentsPage />} />
          <Route path="/audits" element={<RequireRole minimum="MANAGER"><AuditsListPage /></RequireRole>} />
          <Route path="/audits/new" element={<RequireRole minimum="MANAGER"><AuditRunCreatePage /></RequireRole>} />
          <Route path="/audits/templates/new" element={<RequireRole minimum="MANAGER"><AuditTemplateCreatePage /></RequireRole>} />
          <Route path="/audits/:id" element={<RequireRole minimum="MANAGER"><AuditRunDetailPage /></RequireRole>} />
          <Route path="/handbook" element={<HandbookIndexPage />} />
          <Route path="/handbook/org-chart" element={<OrgChartPage />} />
          <Route path="/handbook/guidelines" element={<GuidelinesPage />} />
          <Route path="/handbook/onboarding" element={<HandbookOnboardingPage />} />
          <Route path="/handbook/maintenance" element={<MaintenancePage />} />
          <Route path="/icon-export" element={<IconExportPage />} />
          <Route path="/admin" element={<RequireRole minimum="ADMIN"><AdminPage /></RequireRole>} />
          <Route path="/admin/*" element={<RequireRole minimum="ADMIN"><AdminPage /></RequireRole>} />
          <Route path="/settings" element={<RequireRole minimum="ADMIN"><SettingsPage /></RequireRole>} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ErrorBoundary>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </AppShell>
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
