import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser } from '@alma/shared';
import {
  AppAccessGate,
  AppShell,
  Button,
  Card,
  Input,
  MenuIcon,
  ProductLogo,
  SUITE_APPS,
  Spinner,
  SuiteAppSwitcher,
  SuiteClock,
  SuiteInboxWidget,
  SuiteSignOutButton,
  TaskBar,
  ThemeToggle,
  TopBar,
  installSuiteAppAccess,
  useDismissibleLayer,
  type TaskBarItem
} from '@alma/ui';
import { withSuiteAppLinks } from './config/suiteLinks';
import { api, clearApiAuthToken, consumeSuiteHandoffToken, installSuiteHandoff, setApiAuthToken } from './lib/api';
import { EditorPage } from './pages/EditorPage';
import { HistoryPage } from './pages/HistoryPage';
import { HomePage } from './pages/HomePage';
import { PromotionPage } from './pages/PromotionPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { IconClock, IconDashboard, IconBell } from '../../web/src/lib/icons';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

/*
 * ALMA Menus — the printed food menus, edited as data and published as PDF.
 *
 * Routes:
 *   /                          module home: one card per venue menu
 *   /menus/:menuId/edit        the editor (split view on desktop, tabs on a phone)
 *   /menus/:menuId/history     published versions, PDFs, diffs, restore, audit log
 *   /whats-on                  the promotions (What's On listings and their cards)
 *   /whats-on/:promotionId     one promotion: listing, photo, card link, publish
 *
 * Every screen carries the module home in its nav and Alma Suite Home in the
 * app switcher, so there is always a way back.
 */

function useMenusAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        installSuiteAppAccess(handoffUser as never);
        return;
      }
      const data = await api<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user);
      installSuiteAppAccess(data.user as never);
    } catch {
      setUser(null);
      installSuiteAppAccess(null as never);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installSuiteHandoff(), []);

  const login = useCallback(async (email: string, password: string) => {
    const session = await api<{ user: AuthUser; token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setApiAuthToken(session.token);
    setUser(session.user);
    installSuiteAppAccess(session.user as never);
  }, []);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearApiAuthToken();
    setUser(null);
    installSuiteAppAccess(null as never);
  }, []);

  return { user, loading, login, logout };
}

function LoginPage({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await onLogin(email, password);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-shell">
        <ProductLogo appId="menus" size="lg" />
        <Card title="Menus" subtitle="Sign in to edit and publish the printed menus">
          <form className="login-form" onSubmit={handleSubmit}>
            <Input label="Email" type="email" required autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
            <Input label="Password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="menus" apps={suiteApps} />
      </div>
    </main>
  );
}

const NAV_ITEMS = [
  { href: '/', key: 'home', label: 'Menus', description: 'Both venues, drafts and what is live', icon: <IconDashboard /> },
  { href: '/whats-on', key: 'whats-on', label: 'What’s On', description: 'Promotions: the website listing and the printed card', icon: <IconBell /> }
];

function sectionFromPath(pathname: string) {
  if (/^\/menus\/[^/]+\/history/.test(pathname)) return 'history';
  if (/^\/menus\/[^/]+\/edit/.test(pathname)) return 'edit';
  if (/^\/whats-on/.test(pathname)) return 'whats-on';
  return 'home';
}

function SidebarNav({ menuId }: { menuId: string | null }) {
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'menus-mobile-nav');
  const location = useLocation();
  const section = sectionFromPath(location.pathname);

  const items = useMemo(() => {
    const list = NAV_ITEMS.map((item) => ({ ...item, active: section === item.key }));
    if (menuId) {
      list.push({ href: `/menus/${menuId}/edit`, key: 'edit', label: 'Edit', description: 'Draft, preview, publish', icon: <MenuIcon size={18} />, active: section === 'edit' });
      list.push({ href: `/menus/${menuId}/history`, key: 'history', label: 'History', description: 'Versions, PDFs and the audit log', icon: <IconClock />, active: section === 'history' });
    }
    return list;
  }, [menuId, section]);
  const active = items.find((item) => item.active) ?? items[0]!;

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="menus-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul id="menus-mobile-nav" className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <li className="sidebar-nav-section">Menus</li>
        {items.map((item) => (
          <li key={item.key}>
            <Link to={item.href} className={item.active ? 'active' : ''} onClick={() => setMobileMenuOpen(false)}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenusTaskBar({ menuId }: { menuId: string | null }) {
  const location = useLocation();
  const section = sectionFromPath(location.pathname);
  const items: TaskBarItem[] = [
    { key: 'home', label: 'Menus', href: '/', icon: <IconDashboard />, active: section === 'home', primary: true },
    { key: 'whats-on', label: 'What’s On', href: '/whats-on', icon: <IconBell />, active: section === 'whats-on', primary: true }
  ];
  if (menuId) {
    items.push({ key: 'edit', label: 'Edit', href: `/menus/${menuId}/edit`, icon: <MenuIcon size={18} />, active: section === 'edit', primary: true });
    items.push({ key: 'history', label: 'History', href: `/menus/${menuId}/history`, icon: <IconClock />, active: section === 'history', primary: true });
  }
  return <TaskBar items={items} label="Menu pages" />;
}

function menuIdFromPath(pathname: string): string | null {
  const match = /^\/menus\/([^/]+)/.exec(pathname);
  return match?.[1] ?? null;
}

export function App() {
  const auth = useMenusAuth();
  const location = useLocation();
  const menuId = menuIdFromPath(location.pathname);

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }
  if (!auth.user) return <LoginPage onLogin={auth.login} />;

  const user = auth.user;
  return (
    <AppAccessGate user={user} appId="MENUS" appName="Menus" apps={suiteApps}>
      <AppShell
        brand={<ProductLogo appId="menus" size="md" showBrandMark={false} />}
        sidebar={<SidebarNav menuId={menuId} />}
        topBar={
          <TopBar
            title="ALMA Menus"
            subtitle="Printed food menus — edit, preview, publish"
            right={
              <>
                <SuiteAppSwitcher currentApp="menus" apps={suiteApps} variant="topbar" />
                <SuiteInboxWidget
                  appId="MENUS"
                  api={api}
                  currentApp="menus"
                  venue={user.venue}
                  userName={`${user.firstName} ${user.lastName}`}
                  canAnnounce={user.role !== 'STAFF'}
                />
                <ThemeToggle />
                <SuiteClock />
                <SuiteSignOutButton onClick={() => void auth.logout()} />
              </>
            }
          />
        }
      >
        <div className="menus-page">
          <Routes>
            <Route path="/" element={<HomePage user={user} />} />
            <Route path="/menus/:menuId/edit" element={<EditorPage user={user} />} />
            <Route path="/menus/:menuId/history" element={<HistoryPage user={user} />} />
            <Route path="/whats-on" element={<PromotionsPage user={user} />} />
            <Route path="/whats-on/:promotionId" element={<PromotionPage user={user} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        <MenusTaskBar menuId={menuId} />
      </AppShell>
    </AppAccessGate>
  );
}
