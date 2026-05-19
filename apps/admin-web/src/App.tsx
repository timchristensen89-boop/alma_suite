import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate
} from 'react-router-dom';
import {
  AppShell,
  Button,
  Card,
  EmptyState,
  Input,
  ProductLogo,
  Spinner,
  SUITE_APPS,
  SuiteAppSwitcher,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import { ForgotPasswordPage, ResetPasswordPage } from '../../web/src/pages/PasswordRecoveryPages';
import { HandbookAdminPage } from '../../web/src/pages/handbook/HandbookIndexPage';
import { AuthProvider, useAuth } from '../../web/src/lib/auth';
import { canAdmin } from '../../web/src/lib/rbac';
import { useDocumentTitle } from '../../web/src/hooks/useDocumentTitle';
import {
  IconChecklist,
  IconChevronDown,
  IconBadgeCheck,
  IconBriefcase,
  IconDashboard,
  IconFileSignature,
  IconFileText,
  IconHandbook,
  IconIssues,
  IconKeyRound,
  IconLogout,
  IconPlug,
  IconReceipt,
  IconStore,
  IconSettings,
  IconUpload,
  IconUsers
} from '../../web/src/lib/icons';
import { COMPLIANCE_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import {
  AdminOverviewPage,
  AuditTemplatesPage,
  ChecklistTemplatesPage,
  ComplianceSettingsPage,
  DangerZonePage,
  GeneralSettingsPage,
  HumanAgentDemoPage,
  ImportsPage,
  IntegrationsPage,
  RolesPage,
  StaffOnboardingPage,
  StaffRecordTypesPage,
  StaffSettingsPage,
  UsersPage,
  VenuesPage,
  XeroIntegrationPage
} from './pages/AdminFeaturePages';
import { StaffHrTemplatesPage } from './pages/StaffHrTemplatesPage';

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const complianceUrl = COMPLIANCE_WEB_URL
  ? COMPLIANCE_WEB_URL.replace(/\/+$/, '')
  : 'https://alma-compliance.web.app';

type AdminNavItem = {
  to: string;
  label: string;
  description: string;
  icon: JSX.Element;
  end?: boolean;
};

const NAV_ITEMS: AdminNavItem[] = [
  {
    to: '/',
    label: 'Overview',
    description: 'Launchpad for setup, integrations, imports, and system controls',
    icon: <IconDashboard />,
    end: true
  },
  {
    to: '/settings',
    label: 'Settings',
    description: 'General settings, system health, and app URLs',
    icon: <IconSettings />
  },
  {
    to: '/venues',
    label: 'Venues',
    description: 'Venue setup and operating configuration',
    icon: <IconStore />
  },
  {
    to: '/users',
    label: 'Users',
    description: 'Access, roles, and admin permissions',
    icon: <IconUsers />
  },
  {
    to: '/roles',
    label: 'Roles',
    description: 'Roles, permissions, and bulk access updates',
    icon: <IconKeyRound />
  },
  {
    to: '/staff-settings',
    label: 'Staff settings',
    description: 'Staff defaults and configuration',
    icon: <IconBriefcase />
  },
  {
    to: '/staff-record-types',
    label: 'Record types',
    description: 'Staff document and record type setup',
    icon: <IconFileText />
  },
  {
    to: '/staff-hr-templates',
    label: 'HR templates',
    description: 'Restricted HR document template setup',
    icon: <IconFileSignature />
  },
  {
    to: '/staff-onboarding',
    label: 'Onboarding',
    description: 'Staff onboarding setup',
    icon: <IconBadgeCheck />
  },
  {
    to: '/compliance-settings',
    label: 'Compliance setup',
    description: 'Handbook, templates, checklists, audits, and daily controls',
    icon: <IconChecklist />
  },
  {
    to: '/handbook',
    label: 'Handbook',
    description: 'Edit and publish staff handbook content',
    icon: <IconHandbook />
  },
  {
    to: '/checklist-templates',
    label: 'Checklist templates',
    description: 'Checklist template management',
    icon: <IconChecklist />
  },
  {
    to: '/audit-templates',
    label: 'Audit templates',
    description: 'Audit template management',
    icon: <IconChecklist />
  },
  {
    to: '/integrations',
    label: 'Integrations',
    description: 'Connection health and external service setup',
    icon: <IconPlug />
  },
  {
    to: '/integrations/xero',
    label: 'Xero',
    description: 'Health checks, previews, and selected imports',
    icon: <IconReceipt />
  },
  {
    to: '/imports',
    label: 'Imports',
    description: 'Review and run explicit import actions',
    icon: <IconUpload />
  },
  {
    to: '/danger-zone',
    label: 'Danger zone',
    description: 'Restricted setup controls and irreversible actions',
    icon: <IconIssues />
  }
];

function pageFor(pathname: string) {
  return [...NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) =>
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`)
    ) ?? {
      to: pathname,
      label: 'Admin',
      description: 'Alma setup and configuration',
      icon: <IconSettings />
    };
}

function AdminSidebar() {
  const location = useLocation();
  const active = pageFor(location.pathname);
  const navRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useDismissibleLayer(navRef, open, () => setOpen(false), 'admin-mobile-nav');

  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="admin-mobile-nav"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <IconChevronDown className="mobile-nav-toggle-caret" size={16} />
      </button>
      <ul id="admin-mobile-nav" className={`sidebar-nav ${open ? 'mobile-open' : ''}`}>
        <li className="sidebar-nav-section">Alma Admin</li>
        {NAV_ITEMS.map((item) => (
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

function initialsOf(user: { firstName: string; lastName: string } | null) {
  if (!user) return '';
  return `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase();
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
        onClick={() => setOpen((current) => !current)}
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

function AdminTopBar() {
  const location = useLocation();
  const active = pageFor(location.pathname);
  useDocumentTitle(active.label);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        <>
          <SuiteAppSwitcher currentApp="settings" apps={suiteApps} variant="topbar" />
          <UserMenu />
        </>
      }
    />
  );
}

function AdminLoginPage() {
  useDocumentTitle('Sign in');
  const location = useLocation();
  const { user, login, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) {
    const redirect = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={redirect} replace />;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-wrap admin-login-page">
      <div className="login-card">
        <div className="login-brand">
          <ProductLogo appId="settings" size="lg" />
        </div>
        <Card title="Sign in to Alma Admin" subtitle="Use your manager or admin account.">
          <form className="page-stack compact" onSubmit={onSubmit}>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            {error ? <p className="error-text">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="settings" apps={suiteApps} />
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="full-page-loader">
        <Spinner label="Loading..." />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user } = useAuth();

  if (!canAdmin(user)) {
    return (
      <div className="login-wrap admin-login-page">
        <Card title="Admin access required" subtitle="Ask an Alma admin to update your access if you need setup controls.">
          <Button type="button" onClick={() => { window.location.href = `${complianceUrl}/`; }}>
            Open Compliance
          </Button>
        </Card>
      </div>
    );
  }

  return children;
}

function AdminWorkspace() {
  return (
    <AppShell
      brand={<ProductLogo appId="settings" size="md" showBrandMark={false} />}
      sidebar={<AdminSidebar />}
      topBar={<AdminTopBar />}
    >
      <Routes>
        <Route path="/" element={<AdminOverviewPage />} />
        <Route path="/settings" element={<GeneralSettingsPage />} />
        <Route path="/venues" element={<VenuesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/roles" element={<RolesPage />} />
        <Route path="/staff-settings" element={<StaffSettingsPage />} />
        <Route path="/staff-record-types" element={<StaffRecordTypesPage />} />
        <Route path="/staff-hr-templates" element={<StaffHrTemplatesPage />} />
        <Route path="/staff-onboarding" element={<StaffOnboardingPage />} />
        <Route path="/compliance-settings" element={<ComplianceSettingsPage />} />
        <Route path="/checklist-templates" element={<ChecklistTemplatesPage />} />
        <Route path="/audit-templates" element={<AuditTemplatesPage />} />
        <Route path="/handbook" element={<HandbookAdminPage staffHandbookHref={`${complianceUrl}/handbook`} />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/integrations/xero" element={<XeroIntegrationPage />} />
        <Route path="/imports" element={<ImportsPage />} />
        <Route path="/danger-zone" element={<DangerZonePage />} />
        <Route path="/meta-human-agent-demo" element={<HumanAgentDemoPage />} />
        <Route path="/admin/handbook" element={<Navigate to="/handbook" replace />} />
        <Route path="/admin/*" element={<Navigate to="/" replace />} />
        <Route
          path="*"
          element={
            <EmptyState
              title="Admin page not found"
              description="Choose an Admin section from the left navigation."
            />
          }
        />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AdminLoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <RequireAdmin>
                <AdminWorkspace />
              </RequireAdmin>
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
