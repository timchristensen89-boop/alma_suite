import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
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
import { NAV_ITEMS, type NavItem } from './config/navigation';
import { HubLayout, type HubTab } from './components/HubTabs';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import { IconChevronDown, IconExternal } from './lib/icons';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

// Tabs for each consolidated hub. Every tab is a real, deep-linkable route.
const ITEMS_TABS: HubTab[] = [
  { to: '/items', label: 'Catalogue' },
  { to: '/reorder', label: 'Below par' }
];
const STOCK_COUNT_TABS: HubTab[] = [
  { to: '/stocktake', label: 'Count' },
  { to: '/wastage', label: 'Wastage' },
  { to: '/transfers', label: 'Transfers' }
];
const PURCHASING_TABS: HubTab[] = [
  { to: '/invoices', label: 'Invoices' },
  { to: '/deliveries', label: 'Deliveries' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/price-movement', label: 'Price changes' }
];
const RECIPE_TABS: HubTab[] = [
  { to: '/recipes', label: 'Menu items', end: true },
  { to: '/recipes/prep', label: 'Prep recipes' },
  { to: '/recipes/margins', label: 'Margins' }
];

// True when the current path belongs to this nav item (its route or a hub tab).
function navMatches(item: { to: string; match?: string[] }, pathname: string): boolean {
  const candidates = [item.to, ...(item.match ?? [])];
  return candidates.some((p) =>
    p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)
  );
}

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

function NavItemLink({ item, pathname }: { item: NavItem; pathname: string }) {
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
      <NavLink to={item.to} end={item.end} className={() => (navMatches(item, pathname) ? 'active' : undefined)}>
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
        {NAV_ITEMS.map((item) => (
          <NavItemLink key={item.to} item={item} pathname={location.pathname} />
        ))}
      </ul>
    </div>
  );
}

function currentPage(pathname: string) {
  const match = [...NAV_ITEMS]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) => navMatches(item, pathname));
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

  // Prefer help for the exact sub-page (e.g. Deliveries inside the Purchasing
  // hub); fall back to the hub's help.
  const helpKey = STOCK_HELP[location.pathname] ? location.pathname : active.to;

  return (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        user ? (
          <>
            {STOCK_HELP[helpKey] ? (
              <HelpButton {...STOCK_HELP[helpKey]!} layerId={`stock-help-${helpKey}`} />
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
        <Route path="/settings" element={<SettingsPage />} />

        {/* Items hub */}
        <Route path="/items" element={<HubLayout tabs={ITEMS_TABS}><ItemsPage /></HubLayout>} />
        <Route path="/reorder" element={<HubLayout tabs={ITEMS_TABS}><ReorderNoticesPage /></HubLayout>} />

        {/* Stock count hub */}
        <Route path="/stocktake" element={<HubLayout tabs={STOCK_COUNT_TABS}><StocktakePage /></HubLayout>} />
        <Route path="/wastage" element={<HubLayout tabs={STOCK_COUNT_TABS}><WastagePage /></HubLayout>} />
        <Route path="/transfers" element={<HubLayout tabs={STOCK_COUNT_TABS}><TransfersPage /></HubLayout>} />

        {/* Purchasing hub */}
        <Route path="/invoices" element={<HubLayout tabs={PURCHASING_TABS}><InvoicesPage /></HubLayout>} />
        <Route path="/deliveries" element={<HubLayout tabs={PURCHASING_TABS}><DeliveriesPage /></HubLayout>} />
        <Route path="/suppliers" element={<HubLayout tabs={PURCHASING_TABS}><SuppliersPage /></HubLayout>} />
        <Route path="/price-movement" element={<HubLayout tabs={PURCHASING_TABS}><PriceMovementPage /></HubLayout>} />

        {/* Recipes hub */}
        <Route path="/recipes" element={<HubLayout tabs={RECIPE_TABS}><RecipesPage mode="item" /></HubLayout>} />
        <Route path="/recipes/prep" element={<HubLayout tabs={RECIPE_TABS}><RecipesPage mode="production" /></HubLayout>} />
        <Route path="/recipes/margins" element={<HubLayout tabs={RECIPE_TABS}><DishMarginPage /></HubLayout>} />
        {/* Old routes → keep bookmarks/deep-links working */}
        <Route path="/production-recipes" element={<Navigate to="/recipes/prep" replace />} />
        <Route path="/dish-margins" element={<Navigate to="/recipes/margins" replace />} />

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
