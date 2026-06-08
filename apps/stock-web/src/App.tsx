import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppAccessGate, AppShell, HelpButton, Spinner, SUITE_APPS, SuiteAppSwitcher, SuiteClock, SuiteFeedbackWidget, SuiteInboxWidget, SuiteSignOutButton, ThemeToggle, TopBar, accessibleSuiteApps, useDismissibleLayer } from '@alma/ui';
import { STOCK_HELP } from './config/help';
import { DashboardPage } from './pages/DashboardPage';
import { ItemsPage } from './pages/ItemsPage';
import { StocktakePage } from './pages/StocktakePage';
import { TransfersPage } from './pages/TransfersPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { RecipesPage } from './pages/RecipesPage';
import { DishMarginPage } from './pages/DishMarginPage';
import { PriceMovementPage } from './pages/PriceMovementPage';
import { ReorderNoticesPage } from './pages/ReorderNoticesPage';
import { SettingsPage } from './pages/SettingsPage';
import { WastagePage } from './pages/WastagePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { StockBrand } from './components/StockBrand';
import { NAV_ITEMS, NAV_SECTIONS, type NavItem } from './config/navigation';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { IconChevronDown, IconExternal } from './lib/icons';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

function openWithSuiteHandoff(event: MouseEvent<HTMLAnchorElement>, href: string) {
  const handoff = (globalThis as typeof globalThis & {
    almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
  }).almaCreateSuiteHandoffUrl;

  if (!handoff) return;

  event.preventDefault();
  void handoff(href).then((handoffHref) => {
    window.location.assign(handoffHref);
  }).catch(() => {
    window.location.assign(href);
  });
}

function NavItemLink({ item }: { item: NavItem }) {
  // External jump to another app — only render as a link when we have a URL.
  if (item.external) {
    if (!item.externalHref) {
      return (
        <li>
          <span aria-disabled="true" title="Unavailable — Admin app not configured" style={{ opacity: 0.45, cursor: 'not-allowed' }}>
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </span>
        </li>
      );
    }
    return (
      <li>
        <a href={item.externalHref} onClick={(event) => openWithSuiteHandoff(event, item.externalHref!)}>
          <span className="sidebar-nav-icon">{item.icon}</span>
          <span>{item.label}</span>
          <IconExternal size={13} style={{ marginLeft: 'auto', opacity: 0.6 }} />
        </a>
      </li>
    );
  }
  return (
    <li>
      <NavLink to={item.to} end={item.end}>
        <span className="sidebar-nav-icon">{item.icon}</span>
        <span>{item.label}</span>
      </NavLink>
    </li>
  );
}

function SidebarNav() {
  const location = useLocation();
  const active = currentPage(location.pathname);
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'stock-mobile-nav');

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div ref={navRef} className="mobile-nav-layer">
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
        {NAV_ITEMS.filter((item) => !item.section).map((item) => (
          <NavItemLink key={item.to} item={item} />
        ))}
        {NAV_SECTIONS.map((section) => {
          const items = NAV_ITEMS.filter((item) => item.section === section);
          if (items.length === 0) return null;
          return (
            <Fragment key={section}>
              <li className="sidebar-nav-section">{section}</li>
              {items.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </Fragment>
          );
        })}
      </ul>
    </div>
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
            {STOCK_HELP[active.to] ? (
              <HelpButton {...STOCK_HELP[active.to]!} layerId={`stock-help-${active.to}`} />
            ) : null}
            <SuiteAppSwitcher currentApp="stock" apps={accessibleSuiteApps(user, suiteApps)} variant="topbar" />
            <SuiteInboxWidget
              appId="STOCK"
              api={api}
              currentApp="stock"
              venue={user.venue}
              userName={`${user.firstName} ${user.lastName}`}
              canAnnounce={user.role !== 'STAFF'}
            />
            <SuiteFeedbackWidget appId="STOCK" api={api} userName={`${user.firstName} ${user.lastName}`} />
            <ThemeToggle />
            <SuiteClock />
            <SuiteSignOutButton
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
  const { user } = useAuth();
  return (
    <AppShell
      brand={<StockBrand />}
      sidebar={<SidebarNav />}
      topBar={<TopBarWithContext />}
    >
      <AppAccessGate user={user} appId="STOCK" appName="Stock" apps={suiteApps}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/stocktake" element={<StocktakePage />} />
        <Route path="/transfers" element={<TransfersPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/invoices" element={<InvoicesPage />} />
        <Route path="/deliveries" element={<DeliveriesPage />} />
        <Route path="/wastage" element={<WastagePage />} />
        <Route path="/reorder" element={<ReorderNoticesPage />} />
        <Route path="/recipes" element={<RecipesPage mode="item" />} />
        <Route path="/dish-margins" element={<DishMarginPage />} />
        <Route path="/price-movement" element={<PriceMovementPage />} />
        <Route path="/production-recipes" element={<RecipesPage mode="production" />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </AppAccessGate>
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
