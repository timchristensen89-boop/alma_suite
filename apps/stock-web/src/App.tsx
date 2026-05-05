import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, IconButton, Spinner, SUITE_APPS, SuiteAppSwitcher, TopBar } from '@alma/ui';
import { DashboardPage } from './pages/DashboardPage';
import { ItemsPage } from './pages/ItemsPage';
import { StocktakePage } from './pages/StocktakePage';
import { SuppliersPage } from './pages/SuppliersPage';
import { RecipesPage } from './pages/RecipesPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StockBrand } from './components/StockBrand';
import { NAV_ITEMS } from './config/navigation';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { IconChevronDown, IconExternal } from './lib/icons';
import { AuthProvider, useAuth } from './lib/auth';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

function SidebarNav() {
  const location = useLocation();
  const active = currentPage(location.pathname);
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
        aria-controls="stock-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <IconChevronDown className="mobile-nav-toggle-caret" size={16} />
      </button>
      <ul
        id="stock-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        <li className="sidebar-nav-section">Stock</li>
        {NAV_ITEMS.map((item) => (
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

function currentPage(pathname: string) {
  const match = [...NAV_ITEMS]
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
    description: "The URL didn't match any section",
    icon: null
  };
}

function TopBarWithContext() {
  const location = useLocation();
  const active = currentPage(location.pathname);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  useDocumentTitle(active.label);

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        user ? (
          <>
            <SuiteAppSwitcher currentApp="stock" apps={suiteApps} variant="topbar" />
            <IconButton
              label="Sign out"
              icon={<IconExternal size={15} />}
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

function StockAppShell() {
  return (
    <AppShell
      brand={<StockBrand />}
      sidebar={<SidebarNav />}
      topBar={<TopBarWithContext />}
    >
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/stocktake" element={<StocktakePage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/recipes" element={<RecipesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
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

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={
            <RequireAuth>
              <StockAppShell />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
