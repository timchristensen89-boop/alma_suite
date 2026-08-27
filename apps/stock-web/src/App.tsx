import { Suspense, lazy, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppAccessGate, AppShell, HelpButton, Spinner, SUITE_APPS, SuiteAppSwitcher, SuiteClock, SuiteInboxWidget, SuiteSignOutButton, TaskBar, type TaskBarItem, ThemeToggle, TopBar, accessibleSuiteApps, useDismissibleLayer } from '@alma/ui';
import { STOCK_HELP } from './config/help';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { StockBrand } from './components/StockBrand';
import { NAV_ITEMS, type NavItem } from './config/navigation';
import { HubLayout, type HubTab } from './components/HubTabs';
import { withSuiteAppLinks } from './config/suiteLinks';
import { useDocumentTitle } from './hooks/useDocumentTitle';
import {
  IconChevronDown,
  IconDashboard,
  IconDeliveries,
  IconExternal,
  IconInvoices,
  IconItems,
  IconPrep,
  IconPriceChange,
  IconRecipes,
  IconReorder,
  IconStocktake,
  IconSuppliers,
  IconTransfer,
  IconWastage
} from './lib/icons';
import { api } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';

// Routes load on demand. Every page used to ship in one chunk, so opening the
// stocktake screen also downloaded recipes, invoices, dish margin and the rest —
// on a phone in a cool room, over venue wifi. Dashboard and Login stay eager:
// they are the first paint and the gate in front of it.
const ItemsPage = lazy(() => import('./pages/ItemsPage').then((m) => ({ default: m.ItemsPage })));
const ConfigHealthPage = lazy(() => import('./pages/ConfigHealthPage').then((m) => ({ default: m.ConfigHealthPage })));
const StocktakePage = lazy(() => import('./pages/StocktakePage').then((m) => ({ default: m.StocktakePage })));
const StocktakeTemplatesPage = lazy(() => import('./pages/StocktakeTemplatesPage').then((m) => ({ default: m.StocktakeTemplatesPage })));
const TransfersPage = lazy(() => import('./pages/TransfersPage').then((m) => ({ default: m.TransfersPage })));
const SuppliersPage = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const DeliveriesPage = lazy(() => import('./pages/DeliveriesPage').then((m) => ({ default: m.DeliveriesPage })));
const PurchaseOrdersPage = lazy(() => import('./pages/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })));
const RecipesPage = lazy(() => import('./pages/RecipesPage').then((m) => ({ default: m.RecipesPage })));
const WineListPage = lazy(() => import('./pages/WineListPage').then((m) => ({ default: m.WineListPage })));
const DishMarginPage = lazy(() => import('./pages/DishMarginPage').then((m) => ({ default: m.DishMarginPage })));
const PriceMovementPage = lazy(() => import('./pages/PriceMovementPage').then((m) => ({ default: m.PriceMovementPage })));
const PaymentsPage = lazy(() => import('./pages/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const ReorderNoticesPage = lazy(() => import('./pages/ReorderNoticesPage').then((m) => ({ default: m.ReorderNoticesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const WastagePage = lazy(() => import('./pages/WastagePage').then((m) => ({ default: m.WastagePage })));
const StaffUsagePage = lazy(() => import('./pages/StaffUsagePage').then((m) => ({ default: m.StaffUsagePage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));


const suiteApps = withSuiteAppLinks(SUITE_APPS);

// Tabs for each consolidated hub. Every tab is a real, deep-linkable route.
const ITEMS_TABS: HubTab[] = [
  { to: '/items', label: 'Catalogue', end: true },
  { to: '/reorder', label: 'Below par' },
  { to: '/items/health', label: 'Costing health' },
  { to: '/items/categories', label: 'Categories' },
  { to: '/items/units', label: 'Units' }
];
const STOCK_COUNT_TABS: HubTab[] = [
  { to: '/stocktake', label: 'Count' },
  { to: '/stocktake-templates', label: 'Templates' },
  { to: '/wastage', label: 'Wastage' },
  { to: '/staff-usage', label: 'Staff usage' },
  { to: '/transfers', label: 'Transfers' }
];
const PURCHASING_TABS: HubTab[] = [
  { to: '/invoices', label: 'Invoices' },
  { to: '/purchase-orders', label: 'Ordering' },
  { to: '/payments', label: 'Payments' },
  { to: '/deliveries', label: 'Deliveries' },
  { to: '/suppliers', label: 'Suppliers' },
  { to: '/price-movement', label: 'Price changes' }
];
const RECIPE_TABS: HubTab[] = [
  { to: '/recipes', label: 'Menu items', end: true },
  { to: '/recipes/prep', label: 'Prep recipes' },
  { to: '/recipes/wine', label: 'Wine' },
  { to: '/recipes/margins', label: 'Margins' },
  { to: '/recipes/categories', label: 'Categories' }
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

/**
 * The jobs a stock person opens the app to do, in the order they reach for them.
 *
 * Not the sidebar. The sidebar is how the app is organised — Items, Purchasing,
 * Recipes — and organisation is not what somebody standing in a cool room with
 * a phone is trying to do. They are counting, writing off a broken bottle,
 * moving a keg between venues, checking a delivery in, or raising an order.
 */
const STOCK_TASKS: Array<{ to: string; label: string; icon: ReactNode; match?: string[] }> = [
  // Icons are named here rather than looked up from NAV_ITEMS. Most of these
  // are hub sub-pages — /wastage, /transfers, /deliveries, /purchase-orders —
  // so the sidebar has no entry for them and the lookup returned undefined:
  // the bar shipped with a single icon on Count and bare labels either side.
  { to: '/stocktake', label: 'Count', icon: <IconStocktake />, match: ['/stocktake-templates'] },
  { to: '/wastage', label: 'Wastage', icon: <IconWastage /> },
  { to: '/transfers', label: 'Transfer', icon: <IconTransfer /> },
  { to: '/deliveries', label: 'Delivery', icon: <IconDeliveries /> },
  { to: '/purchase-orders', label: 'Orders', icon: <IconReorder />, match: ['/buying'] },
  { to: '/', label: 'Home', icon: <IconDashboard /> },
  { to: '/items', label: 'Items', icon: <IconItems />, match: ['/items/health', '/reorder'] },
  { to: '/invoices', label: 'Invoices', icon: <IconInvoices /> },
  { to: '/recipes', label: 'Recipes', icon: <IconRecipes /> },
  { to: '/suppliers', label: 'Suppliers', icon: <IconSuppliers /> },
  { to: '/staff-usage', label: 'Staff usage', icon: <IconPrep /> },
  { to: '/price-movement', label: 'Prices', icon: <IconPriceChange /> }
];

function StockTaskBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const items: TaskBarItem[] = STOCK_TASKS.map((task) => ({
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
      label="Stock actions"
      onNavigate={(item, event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(item.href);
      }}
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
      <Suspense
        fallback={
          <div className="route-loading" role="status" aria-live="polite">
            <Spinner />
          </div>
        }
      >
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />

        {/* Items hub */}
        <Route path="/items" element={<HubLayout tabs={ITEMS_TABS}><ItemsPage /></HubLayout>} />
        <Route path="/items/health" element={<HubLayout tabs={ITEMS_TABS}><ConfigHealthPage /></HubLayout>} />
        <Route path="/reorder" element={<HubLayout tabs={ITEMS_TABS}><ReorderNoticesPage /></HubLayout>} />
        <Route path="/items/categories" element={<HubLayout tabs={ITEMS_TABS}><SettingsPage section="stock" /></HubLayout>} />
        <Route path="/items/units" element={<HubLayout tabs={ITEMS_TABS}><SettingsPage section="units" /></HubLayout>} />

        {/* Stock count hub */}
        <Route path="/stocktake" element={<HubLayout tabs={STOCK_COUNT_TABS}><StocktakePage /></HubLayout>} />
        <Route path="/stocktake-templates" element={<HubLayout tabs={STOCK_COUNT_TABS}><StocktakeTemplatesPage /></HubLayout>} />
        <Route path="/wastage" element={<HubLayout tabs={STOCK_COUNT_TABS}><WastagePage /></HubLayout>} />
        <Route path="/staff-usage" element={<HubLayout tabs={STOCK_COUNT_TABS}><StaffUsagePage /></HubLayout>} />
        <Route path="/transfers" element={<HubLayout tabs={STOCK_COUNT_TABS}><TransfersPage /></HubLayout>} />

        {/* Purchasing hub */}
        <Route path="/invoices" element={<HubLayout tabs={PURCHASING_TABS}><InvoicesPage /></HubLayout>} />
        <Route path="/purchase-orders" element={<HubLayout tabs={PURCHASING_TABS}><PurchaseOrdersPage /></HubLayout>} />
        <Route path="/payments" element={<HubLayout tabs={PURCHASING_TABS}><PaymentsPage /></HubLayout>} />
        <Route path="/deliveries" element={<HubLayout tabs={PURCHASING_TABS}><DeliveriesPage /></HubLayout>} />
        <Route path="/suppliers" element={<HubLayout tabs={PURCHASING_TABS}><SuppliersPage /></HubLayout>} />
        {/* Buying folded into the order guide — everything it showed lives there now. */}
        <Route path="/buying" element={<Navigate to="/purchase-orders" replace />} />
        <Route path="/price-movement" element={<HubLayout tabs={PURCHASING_TABS}><PriceMovementPage /></HubLayout>} />

        {/* Recipes hub */}
        <Route path="/recipes" element={<HubLayout tabs={RECIPE_TABS}><RecipesPage mode="item" /></HubLayout>} />
        <Route path="/recipes/prep" element={<HubLayout tabs={RECIPE_TABS}><RecipesPage mode="production" /></HubLayout>} />
        <Route path="/recipes/wine" element={<HubLayout tabs={RECIPE_TABS}><WineListPage /></HubLayout>} />
        <Route path="/recipes/margins" element={<HubLayout tabs={RECIPE_TABS}><DishMarginPage /></HubLayout>} />
        <Route path="/recipes/categories" element={<HubLayout tabs={RECIPE_TABS}><SettingsPage section="recipe" /></HubLayout>} />
        {/* Old routes → keep bookmarks/deep-links working */}
        <Route path="/production-recipes" element={<Navigate to="/recipes/prep" replace />} />
        <Route path="/dish-margins" element={<Navigate to="/recipes/margins" replace />} />

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
      </AppAccessGate>
      <StockTaskBar />
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
