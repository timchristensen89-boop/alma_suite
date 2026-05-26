import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StaffCostingReportPage } from './pages/StaffCostingReportPage';
import type {
  AuthUser,
  RecipesSummary,
  ReportsMenuProfitabilityPayload,
  ReportsOverviewPayload,
  ReportsPrimeCostPayload,
  RosterForecastSnapshot,
  RosterShift,
  SalesActualSummary,
  SalesItemActualSummary,
  StaffProfile,
  StaffTipsSummary,
  StockItemsPayload,
  StockItemsSummary,
  StocktakesSummary,
  Timesheet
} from '@alma/shared';
import {
  AlmaHomeBubble,
  AlmaPill,
  AppShell,
  ActionPanel,
  Badge,
  BigStat,
  Button,
  Card,
  ChartIcon,
  DocumentIcon,
  EditorialPanel,
  Input,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteCommsWidget,
  SuiteNotificationsWidget,
  TopBar,
  useDismissibleLayer
} from '@alma/ui';
import {
  clearApiAuthTokens,
  consumeSuiteHandoffToken,
  installSuiteHandoff,
  setStaffApiAuthToken,
  setStockApiAuthToken,
  staffApi,
  stockApi
} from './lib/api';
import { COMPLIANCE_WEB_URL, GIFTCARDS_WEB_URL, STAFF_WEB_URL, STOCK_WEB_URL, withSuiteAppLinks } from './config/suiteLinks';
import { historicalSalesForWeek, normaliseHistoricalVenue } from './data/historicalSales';

type SuiteSummary = {
  incidents?: { total?: number; open?: number; followUp?: number };
  issues?: { total?: number; open?: number; overdue?: number; critical?: number };
  staff?: { totalProfiles?: number; expiringSoon?: number; expired?: number; pendingApproval?: number };
  temperatures?: { assets?: number; outOfRange?: number; due?: number };
  audits?: { templates?: number; runs?: number; averageScore?: number | null };
};

type ReportsData = {
  overview: ReportsOverviewPayload | null;
  summary: SuiteSummary | null;
  staff: StaffProfile[];
  timesheets: Timesheet[];
  roster: RosterShift[];
  rosterForecastSnapshots: RosterForecastSnapshot[];
  actualSales: SalesActualSummary | null;
  itemSales: SalesItemActualSummary | null;
  menuProfitability: ReportsMenuProfitabilityPayload | null;
  primeCost: ReportsPrimeCostPayload | null;
  tips: StaffTipsSummary | null;
  stockItems: StockItemsPayload | null;
  stockSummary: StockItemsSummary | null;
  stocktakes: StocktakesSummary | null;
  recipes: RecipesSummary | null;
};

type WageRow = {
  staffProfileId: string;
  name: string;
  email: string;
  venue: string;
  roleTitle: string;
  hours: number;
  approvedHours: number;
  xeroHours: number;
  cashHours: number;
  projectedCostCents: number;
  approvedCostCents: number;
  rateCents: number;
  tipsCents: number;
  exportedCount: number;
  approvedCount: number;
  cashPaidMissingCount: number;
};

type ForecastInput = {
  sales: string;
  targetWagePercent: string;
};

type ForecastVenueRow = {
  venue: string;
  forecastSalesCents: number;
  historicalSalesCents: number;
  historicalSource: string | null;
  targetWagePercent: number;
  wageBudgetCents: number;
  plannedHours: number;
  plannedCostCents: number;
  recommendedHours: number;
  hoursGap: number;
  costGapCents: number;
  areaRows: Array<{
    area: string;
    plannedHours: number;
    recommendedHours: number;
  }>;
};

type SalesTrendVenueRow = {
  venue: string;
  actualSalesCents: number;
  actualDays: number;
  manualForecastCents: number;
  historicalSalesCents: number;
  previousHistoricalSalesCents: number;
  predictedSalesCents: number;
  trendPercent: number | null;
  forecastVarianceCents: number;
  paceLabel: string;
};

type ReportSectionId =
  | 'overview'
  | 'sales'
  | 'staff'
  | 'compliance'
  | 'stock'
  | 'menu-engineering'
  | 'reserve'
  | 'marketing'
  | 'content'
  | 'gift-cards'
  | 'exports';

type ReportNavItem = {
  id: ReportSectionId;
  label: string;
  title: string;
  description: string;
  icon: JSX.Element;
};

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const REPORTS_FORECAST_STORAGE_KEY = 'alma.reports.forecast.v1';
const REPORT_NAV_ITEMS: ReportNavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    title: 'Reports Overview',
    description: 'High-level attention signals across the suite.',
    icon: <ChartIcon />
  },
  {
    id: 'sales',
    label: 'Sales',
    title: 'Sales Reports',
    description: 'Venue sales, trends, and sales forecasting for Alma Avalon and St Alma.',
    icon: <ChartIcon />
  },
  {
    id: 'staff',
    label: 'Staff',
    title: 'Staff Reports',
    description: 'Active staff, leave, payroll readiness, and recent management events.',
    icon: <ChartIcon />
  },
  {
    id: 'compliance',
    label: 'Compliance',
    title: 'Compliance Reports',
    description: 'Outstanding compliance records, expiring items, and venue attention signals.',
    icon: <DocumentIcon />
  },
  {
    id: 'stock',
    label: 'Stock',
    title: 'Stock Reports',
    description: 'Catalogue health, venue stock status, low stock, and stocktake review signals.',
    icon: <DocumentIcon />
  },
  {
    id: 'menu-engineering',
    label: 'Menu Engineering',
    title: 'Menu Engineering',
    description: 'Readiness for item sales, recipe costs, COGS, margin, and menu action decisions.',
    icon: <ChartIcon />
  },
  {
    id: 'reserve',
    label: 'Reserve',
    title: 'Reserve Reports',
    description: 'Bookings, covers, cancellations, no-shows, and guest mix.',
    icon: <ChartIcon />
  },
  {
    id: 'marketing',
    label: 'Marketing',
    title: 'Marketing Reports',
    description: 'Guest CRM reach, consent, campaigns, and simulated sends.',
    icon: <DocumentIcon />
  },
  {
    id: 'content',
    label: 'Content',
    title: 'Content Reports',
    description: 'Scheduled posts, approvals, simulated publishing, and social setup readiness.',
    icon: <DocumentIcon />
  },
  {
    id: 'gift-cards',
    label: 'Gift Cards',
    title: 'Gift Card Reports',
    description: 'Pending gift card orders, value, fulfilment, and payment readiness.',
    icon: <DocumentIcon />
  },
  {
    id: 'exports',
    label: 'Exports',
    title: 'Exports',
    description: 'Read-only CSV downloads and weekly summary exports.',
    icon: <DocumentIcon />
  }
];

const LEGACY_REPORT_HASHES: Record<string, ReportSectionId> = {
  '#report-staff': 'staff',
  '#report-compliance': 'compliance',
  '#report-stock': 'stock',
  '#report-reserve': 'reserve',
  '#report-marketing': 'marketing',
  '#report-content': 'content',
  '#report-giftcards': 'gift-cards',
  '#giftcards': 'gift-cards',
  '#forecast': 'sales',
  '#wages': 'staff',
  '#cogs': 'stock',
  '#menu-engineering': 'menu-engineering',
  '#website-menu': 'exports'
};

function reportHash(section: ReportSectionId) {
  return `#${section}`;
}

function reportSectionFromHash(hash: string): ReportSectionId {
  if (hash in LEGACY_REPORT_HASHES) return LEGACY_REPORT_HASHES[hash]!;
  const section = hash.replace(/^#/, '') as ReportSectionId;
  return REPORT_NAV_ITEMS.some((item) => item.id === section) ? section : 'overview';
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offset);
  return start;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(cents / 100);
}

function formatPercent(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
}

function qualityLabel(value: ReportsPrimeCostPayload['totals']['sourceQuality'] | undefined) {
  if (!value) return 'Missing data';
  return value.replace(/_/g, ' ');
}

function menuMappingLabel(value: ReportsMenuProfitabilityPayload['rows'][number]['mappingStatus']) {
  return value.replace(/_/g, ' ');
}

function menuMappingTone(value: ReportsMenuProfitabilityPayload['rows'][number]['mappingStatus']): 'positive' | 'warning' | 'danger' | 'muted' {
  if (value === 'mapped') return 'positive';
  if (value === 'missing_cost') return 'warning';
  if (value === 'missing_recipe') return 'danger';
  return 'muted';
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function roundHours(value: number) {
  return `${Math.round(value * 10) / 10}h`;
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function timesheetHours(timesheet: Timesheet) {
  const start = new Date(timesheet.clockInAt).getTime();
  const end = new Date(timesheet.clockOutAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, (end - start) / 36e5 - timesheet.breakMinutes / 60);
}

function rosterShiftHours(shift: RosterShift) {
  const start = new Date(shift.startsAt).getTime();
  const end = new Date(shift.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.max(0, (end - start) / 36e5 - shift.breakMinutes / 60);
}

function parseMoneyCents(value: string) {
  const isNegative = value.includes('(') && value.includes(')') || value.trim().startsWith('-');
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  if (isNegative) return 0;
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function parsePercent(value: string, fallback = 32) {
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function centsInput(cents: number) {
  return cents > 0 ? String(Math.round(cents / 100)) : '';
}

function signedCurrency(cents: number) {
  if (cents === 0) return formatCurrency(0);
  return `${cents > 0 ? '+' : '-'}${formatCurrency(Math.abs(cents))}`;
}

function loadJsonDraft<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

function staffName(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function initialsOf(user: AuthUser) {
  const first = user.firstName?.trim().charAt(0) ?? '';
  const last = user.lastName?.trim().charAt(0) ?? '';
  return `${first}${last}`.toUpperCase() || user.email?.charAt(0).toUpperCase() || 'A';
}

function ReportsUserMenu({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

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
              await onLogout();
            }}
          >
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useReportsAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const handoffUser = await consumeSuiteHandoffToken();
      if (handoffUser) {
        setUser(handoffUser);
        return;
      }
      const data = await staffApi<{ user: AuthUser | null }>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => installSuiteHandoff(), []);

  const login = useCallback(async (email: string, password: string) => {
    const staffSession = await staffApi<{ user: AuthUser; token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setStaffApiAuthToken(staffSession.token);

    try {
      const stockSession = await stockApi<{ user: AuthUser; token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setStockApiAuthToken(stockSession.token);
      setUser(staffSession.user);
      return null;
    } catch (error) {
      setUser(staffSession.user);
      return error instanceof Error ? error.message : 'Stock reports may need a separate Stock sign-in.';
    }
  }, []);

  const logout = useCallback(async () => {
    await Promise.allSettled([
      staffApi('/api/auth/logout', { method: 'POST' }),
      stockApi('/api/auth/logout', { method: 'POST' })
    ]);
    clearApiAuthTokens();
    setUser(null);
  }, []);

  return { user, loading, login, logout };
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<string | null> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const warning = await onLogin(email.trim(), password);
      setMessage(warning);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-brand">
          <ProductLogo appId="reports" size="lg" />
        </div>
        <Card title="Sign in" subtitle="Use your ALMA account to view operating reports">
          <form className="login-form" onSubmit={handleSubmit}>
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
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
            {message ? <p className="error-text">{message}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <SuiteAppSwitcher currentApp="reports" apps={suiteApps} />
      </div>
    </div>
  );
}

function SidebarNav({
  activeSection = reportSectionFromHash(window.location.hash),
  onSectionChange = () => undefined
}: {
  activeSection?: ReportSectionId;
  onSectionChange?: (section: ReportSectionId) => void;
} = {}) {
  const navRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const active = REPORT_NAV_ITEMS.find((item) => item.id === activeSection) ?? REPORT_NAV_ITEMS[0]!;
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);
  useDismissibleLayer(navRef, mobileMenuOpen, closeMobileMenu, 'reports-mobile-nav');

  return (
    <div ref={navRef} className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="reports-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <span className="mobile-nav-toggle-caret" aria-hidden="true">⌄</span>
      </button>
      <ul
        id="reports-mobile-nav"
        className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}
      >
        <li className="sidebar-nav-section">Reports</li>
        {REPORT_NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <a
              href={reportHash(item.id)}
              className={item.id === activeSection ? 'active' : undefined}
              onClick={(event) => {
                event.preventDefault();
                onSectionChange(item.id);
                setMobileMenuOpen(false);
              }}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReportsDashboard({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [activeSection, setActiveSection] = useState<ReportSectionId>(() => reportSectionFromHash(window.location.hash));
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => isoDate(startOfWeek(new Date())));
  const weekStart = useMemo(() => startOfWeek(new Date(`${selectedWeekStart}T00:00:00`)), [selectedWeekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const [overviewRange, setOverviewRange] = useState<'7' | '30' | '90'>('30');
  const [menuAccountKey, setMenuAccountKey] = useState<'all' | 'primary' | 'secondary'>('all');
  const [menuVenue, setMenuVenue] = useState('');
  const [menuCategory, setMenuCategory] = useState('');
  const [menuMappingStatus, setMenuMappingStatus] = useState<'all' | 'mapped' | 'unmapped' | 'missing_recipe' | 'missing_cost'>('all');
  const [data, setData] = useState<ReportsData>({
    overview: null,
    summary: null,
    staff: [],
    timesheets: [],
    roster: [],
    rosterForecastSnapshots: [],
    actualSales: null,
    itemSales: null,
    menuProfitability: null,
    primeCost: null,
    tips: null,
    stockItems: null,
    stockSummary: null,
    stocktakes: null,
    recipes: null
  });
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [stockMessage, setStockMessage] = useState<string | null>(null);
  const [forecastInputs, setForecastInputs] = useState<Record<string, ForecastInput>>(() =>
    loadJsonDraft<Record<string, ForecastInput>>(REPORTS_FORECAST_STORAGE_KEY, {})
  );
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  // 4-week historical prime cost trend (most recent on the right, current week as the 5th).
  const [primeCostHistory, setPrimeCostHistory] = useState<Array<{ weekStart: string; primeCostPercent: number | null; wagePercent: number | null; cogsPercent: number | null; salesCents: number }>>([]);
  // 8-week forecast vs actual history for the sales section chart.
  const [forecastHistory, setForecastHistory] = useState<Array<{ weekStart: string; forecastCents: number; actualCents: number; variance: number | null }>>([]);
  const activeReport = REPORT_NAV_ITEMS.find((item) => item.id === activeSection) ?? REPORT_NAV_ITEMS[0]!;
  const overviewWindowLabel = `Last ${data.overview?.rangeDays ?? overviewRange} days`;
  const weekWindowLabel = `${isoDate(weekStart)} to ${isoDate(addDays(weekEnd, -1))}`;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setStockMessage(null);
    try {
      const menuProfitabilityParams = new URLSearchParams({
        start: weekStart.toISOString(),
        end: weekEnd.toISOString(),
        accountKey: menuAccountKey,
        mappingStatus: menuMappingStatus
      });
      if (menuVenue) menuProfitabilityParams.set('venue', menuVenue);
      if (menuCategory) menuProfitabilityParams.set('category', menuCategory);
      const [overview, summary, staff, timesheets, roster, rosterForecastSnapshots, actualSales, itemSales, menuProfitability, primeCost, tips] = await Promise.all([
        staffApi<ReportsOverviewPayload>(`/api/reports/overview?range=${overviewRange}`),
        staffApi<SuiteSummary>('/api/summary'),
        staffApi<StaffProfile[]>('/api/staff'),
        staffApi<Timesheet[]>(`/api/staff/timesheets?start=${isoDate(weekStart)}&end=${isoDate(weekEnd)}&status=all`),
        staffApi<RosterShift[]>(`/api/staff/roster?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<RosterForecastSnapshot[]>(`/api/staff/roster/forecast-snapshots?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<SalesActualSummary>(`/api/reports/sales?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<SalesItemActualSummary>(`/api/reports/item-sales?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<ReportsMenuProfitabilityPayload>(`/api/reports/menu-profitability?${menuProfitabilityParams.toString()}`),
        staffApi<ReportsPrimeCostPayload>(`/api/reports/prime-cost?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<StaffTipsSummary>(`/api/staff/tips?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`)
      ]);

      let stockItems: StockItemsPayload | null = null;
      let stockSummary: StockItemsSummary | null = null;
      let stocktakes: StocktakesSummary | null = null;
      let recipes: RecipesSummary | null = null;

      try {
        [stockItems, stockSummary, stocktakes, recipes] = await Promise.all([
          stockApi<StockItemsPayload>('/api/items'),
          stockApi<StockItemsSummary>('/api/items/summary'),
          stockApi<StocktakesSummary>('/api/stocktake/summary'),
          stockApi<RecipesSummary>('/api/recipes/summary')
        ]);
      } catch (error) {
        setStockMessage(error instanceof Error ? error.message : 'Could not load stock reports.');
      }

      setData({ overview, summary, staff, timesheets, roster, rosterForecastSnapshots, actualSales, itemSales, menuProfitability, primeCost, tips, stockItems, stockSummary, stocktakes, recipes });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [menuAccountKey, menuCategory, menuMappingStatus, menuVenue, overviewRange, weekEnd, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  // Fetch 4 weeks of historical prime cost for the hero trend
  useEffect(() => {
    void (async () => {
      try {
        const weeks: Array<{ start: Date; end: Date }> = [];
        for (let i = 4; i >= 1; i -= 1) {
          const start = addDays(weekStart, -7 * i);
          const end = addDays(start, 7);
          weeks.push({ start, end });
        }
        const results = await Promise.all(
          weeks.map((w) =>
            staffApi<ReportsPrimeCostPayload>(
              `/api/reports/prime-cost?start=${w.start.toISOString()}&end=${w.end.toISOString()}`
            ).catch(() => null)
          )
        );
        setPrimeCostHistory(
          weeks.map((w, i) => {
            const totals = results[i]?.totals;
            return {
              weekStart: isoDate(w.start),
              primeCostPercent: totals?.primeCostPercent ?? null,
              wagePercent: totals?.wagePercent ?? null,
              cogsPercent: totals?.cogsPercent ?? null,
              salesCents: totals?.salesCents ?? 0
            };
          })
        );
      } catch {
        /* silent — hero will fall back to current week only */
      }
    })();
  }, [weekStart]);

  // 8-week forecast vs actual history (oldest left, current week rightmost)
  useEffect(() => {
    void (async () => {
      try {
        const earliest = addDays(weekStart, -7 * 7);
        const [snapshots, actuals] = await Promise.all([
          staffApi<RosterForecastSnapshot[]>(
            `/api/staff/roster/forecast-snapshots?start=${earliest.toISOString()}&end=${weekEnd.toISOString()}`
          ),
          staffApi<SalesActualSummary>(
            `/api/reports/sales?start=${earliest.toISOString()}&end=${weekEnd.toISOString()}`
          )
        ]);

        // Bucket actuals by ISO week-start date
        const actualByWeek = new Map<string, number>();
        for (const entry of actuals.entries ?? []) {
          const d = new Date(entry.serviceDate);
          d.setHours(0, 0, 0, 0);
          // Move to Monday of that week
          const day = d.getDay();
          const diff = day === 0 ? -6 : 1 - day;
          d.setDate(d.getDate() + diff);
          const key = isoDate(d);
          actualByWeek.set(key, (actualByWeek.get(key) ?? 0) + entry.salesCents);
        }

        // Bucket forecast snapshots by week
        const forecastByWeek = new Map<string, number>();
        for (const snap of snapshots) {
          const key = isoDate(new Date(snap.weekStart));
          forecastByWeek.set(key, (forecastByWeek.get(key) ?? 0) + snap.forecastSalesCents);
        }

        // Build 8-week skeleton (current week last)
        const buckets: typeof forecastHistory = [];
        for (let i = 7; i >= 0; i -= 1) {
          const ws = addDays(weekStart, -7 * i);
          const key = isoDate(ws);
          const forecastCents = forecastByWeek.get(key) ?? 0;
          const actualCents = actualByWeek.get(key) ?? 0;
          const variance = forecastCents > 0 && actualCents > 0
            ? ((actualCents - forecastCents) / forecastCents) * 100
            : null;
          buckets.push({ weekStart: key, forecastCents, actualCents, variance });
        }
        setForecastHistory(buckets);
      } catch {
        /* silent */
      }
    })();
  }, [weekStart, weekEnd]);

  useEffect(() => {
    const handleHashChange = () => setActiveSection(reportSectionFromHash(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Wage forecasts now live in Admin → Wage forecasts. Pull them from
  // app settings so reports stay in sync with whatever admin configured.
  useEffect(() => {
    void (async () => {
      try {
        const settings = await staffApi<{ venues?: Array<{ name: string; weeklyForecastSalesCents?: number; targetWagePercent?: number }> }>('/api/settings');
        const next: Record<string, ForecastInput> = {};
        for (const venue of settings.venues ?? []) {
          if (typeof venue.weeklyForecastSalesCents === 'number' || typeof venue.targetWagePercent === 'number') {
            next[venue.name] = {
              sales: typeof venue.weeklyForecastSalesCents === 'number' ? String(Math.round(venue.weeklyForecastSalesCents / 100)) : '',
              targetWagePercent: typeof venue.targetWagePercent === 'number' ? String(venue.targetWagePercent) : '32'
            };
          }
        }
        if (Object.keys(next).length > 0) {
          setForecastInputs((current) => ({ ...current, ...next }));
        }
      } catch {
        /* fallback to localStorage values already loaded */
      }
    })();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(REPORTS_FORECAST_STORAGE_KEY, JSON.stringify(forecastInputs));
  }, [forecastInputs]);

  const activeStaff = data.staff.filter((member) => member.employmentStatus !== 'ARCHIVED');
  const staffById = useMemo(() => new Map(activeStaff.map((member) => [member.id, member])), [activeStaff]);
  const tipsByStaffId = useMemo(
    () => new Map(((data.tips?.paidEntitlements.length ? data.tips.paidEntitlements : data.tips?.entitlements) ?? []).map((row) => [row.staffProfileId, row.amountCents])),
    [data.tips]
  );
  const venues = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...activeStaff.map((member) => member.venue ?? ''),
            ...data.roster.map((shift) => shift.venue ?? shift.staffProfile?.venue ?? '')
          ].filter((venue) => venue && venue !== 'Both')
        )
      ).sort(),
    [activeStaff, data.roster]
  );

  const wageRows = useMemo<WageRow[]>(() => {
    const rows = new Map<string, WageRow>();
    for (const timesheet of data.timesheets) {
      const staff = staffById.get(timesheet.staffProfileId);
      const rateCents = staff?.trainingPayRateCents ?? staff?.payRateCents ?? 0;
      const hours = timesheetHours(timesheet);
      const costCents = Math.round(hours * rateCents);
      const existing =
        rows.get(timesheet.staffProfileId) ??
        {
          staffProfileId: timesheet.staffProfileId,
          name: staff ? staffName(staff) : staffName(timesheet.staffProfile ?? { firstName: 'Unknown', lastName: 'staff' }),
          email: staff?.email ?? timesheet.staffProfile?.email ?? '',
          venue: timesheet.venue ?? staff?.venue ?? 'Unassigned',
          roleTitle: timesheet.roleTitle ?? staff?.roleTitle ?? 'Team member',
          hours: 0,
          approvedHours: 0,
          xeroHours: 0,
          cashHours: 0,
          projectedCostCents: 0,
          approvedCostCents: 0,
          rateCents,
          tipsCents: tipsByStaffId.get(timesheet.staffProfileId) ?? 0,
          exportedCount: 0,
          approvedCount: 0,
          cashPaidMissingCount: 0
        };

      existing.hours += hours;
      existing.projectedCostCents += costCents;
      if (timesheet.status === 'APPROVED' || timesheet.status === 'EXPORTED') {
        existing.approvedHours += hours;
        existing.approvedCostCents += costCents;
        if (timesheet.paymentMethod === 'CASH') {
          existing.cashHours += hours;
          if (!timesheet.cashPaidAt) existing.cashPaidMissingCount += 1;
        } else {
          existing.xeroHours += hours;
        }
        if (timesheet.status === 'APPROVED') existing.approvedCount += 1;
        if (timesheet.status === 'EXPORTED') existing.exportedCount += 1;
      }
      rows.set(timesheet.staffProfileId, existing);
    }
    return Array.from(rows.values()).sort((a, b) => b.projectedCostCents - a.projectedCostCents);
  }, [data.timesheets, staffById, tipsByStaffId]);

  const wageTotals = wageRows.reduce(
    (total, row) => ({
      hours: total.hours + row.hours,
      approvedHours: total.approvedHours + row.approvedHours,
      projectedCostCents: total.projectedCostCents + row.projectedCostCents,
      approvedCostCents: total.approvedCostCents + row.approvedCostCents
    }),
    { hours: 0, approvedHours: 0, projectedCostCents: 0, approvedCostCents: 0 }
  );

  const wageByVenue = Array.from(
    wageRows.reduce((map, row) => {
      const current = map.get(row.venue) ?? { venue: row.venue, hours: 0, costCents: 0 };
      current.hours += row.hours;
      current.costCents += row.projectedCostCents;
      map.set(row.venue, current);
      return map;
    }, new Map<string, { venue: string; hours: number; costCents: number }>())
      .values()
  ).sort((a, b) => b.costCents - a.costCents);

  useEffect(() => {
    if (!venues.length) return;
    setForecastInputs((current) => {
      const next = { ...current };
      let changed = false;
      for (const venue of venues) {
        if (!next[venue]) {
          const historical = historicalSalesForWeek(venue, weekStart);
          next[venue] = { sales: centsInput(Math.round(historical.total * 100)), targetWagePercent: '32' };
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [venues, weekStart]);

  function updateForecastInput(venue: string, patch: Partial<ForecastInput>) {
    setForecastInputs((current) => ({
      ...current,
      [venue]: {
        sales: current[venue]?.sales ?? '',
        targetWagePercent: current[venue]?.targetWagePercent ?? '32',
        ...patch
      }
    }));
  }

  function applyHistoricalForecast(venue?: string) {
    setForecastInputs((current) => {
      const next = { ...current };
      const targetVenues = venue ? [venue] : venues;
      for (const targetVenue of targetVenues) {
        const historical = historicalSalesForWeek(targetVenue, weekStart);
        if (historical.total <= 0) continue;
        next[targetVenue] = {
          sales: centsInput(Math.round(historical.total * 100)),
          targetWagePercent: current[targetVenue]?.targetWagePercent ?? '32'
        };
      }
      return next;
    });
  }

  function exportPerformanceCsv() {
    setExportMessage(null);
    const rows = [
      [
        'Venue',
        'Forecast sales',
        'Actual sales',
        'Sales variance',
        'Planned wages',
        'Actual wages',
        'Wage variance',
        'Target wage %',
        'Actual wage %',
        'Hours'
      ],
      ...venuePerformanceRows.map((row) => [
        row.venue,
        (row.forecastSalesCents / 100).toFixed(2),
        (row.actualSalesCents / 100).toFixed(2),
        (row.salesVarianceCents / 100).toFixed(2),
        (row.plannedWageCents / 100).toFixed(2),
        (row.actualWageCents / 100).toFixed(2),
        (row.wageVarianceCents / 100).toFixed(2),
        row.targetPercent ? row.targetPercent.toFixed(2) : '',
        row.actualPercent ? row.actualPercent.toFixed(2) : '',
        (row.actualHours || row.plannedHours).toFixed(2)
      ])
    ];
    downloadTextFile(`alma-weekly-performance-${isoDate(weekStart)}.csv`, csvRows(rows));
    setExportMessage('Weekly performance CSV downloaded.');
  }

  function exportWagesCsv() {
    setExportMessage(null);
    const rows = [
      [
        'Staff',
        'Email',
        'Venue',
        'Role',
        'Total hours',
        'Approved hours',
        'Xero hours',
        'Cash hours',
        'Rate',
        'Projected wages',
        'Approved wages',
        'Tips',
        'Payroll total',
        'Approved timesheets',
        'Exported timesheets',
        'Cash payments pending'
      ],
      ...wageRows.map((row) => [
        row.name,
        row.email,
        row.venue,
        row.roleTitle,
        row.hours.toFixed(2),
        row.approvedHours.toFixed(2),
        row.xeroHours.toFixed(2),
        row.cashHours.toFixed(2),
        (row.rateCents / 100).toFixed(2),
        (row.projectedCostCents / 100).toFixed(2),
        (row.approvedCostCents / 100).toFixed(2),
        (row.tipsCents / 100).toFixed(2),
        ((row.approvedCostCents + row.tipsCents) / 100).toFixed(2),
        row.approvedCount,
        row.exportedCount,
        row.cashPaidMissingCount
      ])
    ];
    downloadTextFile(`alma-weekly-payroll-${isoDate(weekStart)}.csv`, csvRows(rows));
    setExportMessage('Weekly payroll CSV downloaded with wages and tips.');
  }

  function exportOverviewCsv() {
    setExportMessage(null);
    const overview = data.overview;
    if (!overview) {
      setExportMessage('Overview data is still loading.');
      return;
    }
    const rows = [
      ['Section', 'Metric', 'Value'],
      ['Staff', 'Active staff', overview.staff.totalActiveStaff],
      ['Staff', 'Missing / pending compliance', overview.staff.missingRequiredCompliance],
      ['Staff', 'Pending leave', overview.staff.pendingLeaveCount],
      ['Staff', 'Approved leave next 30 days', overview.staff.approvedLeaveNext30Days],
      ['Compliance', 'Pending staff records', overview.compliance.pendingStaffRecords],
      ['Compliance', 'Expired staff records', overview.compliance.expiredStaffRecords],
      ['Compliance', 'Expiring records next 30 days', overview.compliance.expiringStaffRecordsNext30Days],
      ['Compliance', 'Missing temperature readings today', overview.compliance.missingTemperatureReadingsToday],
      ['Stock', 'Active catalogue items', overview.stock.activeStockItems],
      ['Stock', 'Low stock venue rows', overview.stock.lowStockCount],
      ['Stock', 'Out of stock venue rows', overview.stock.outOfStockCount],
      ['Stock', 'Stocktakes ready for review', overview.stock.stocktakesReadyForReview],
      ['Reserve', 'Bookings today', overview.reserve.bookingsToday],
      ['Reserve', 'Covers today', overview.reserve.coversToday],
      ['Reserve', 'Upcoming bookings', overview.reserve.upcomingBookings],
      ['Reserve', 'Cancellations', overview.reserve.cancellations],
      ['Reserve', 'No shows', overview.reserve.noShows],
      ['Marketing', 'Guests', overview.marketing.totalGuests],
      ['Marketing', 'Opted in guests', overview.marketing.optedInGuests],
      ['Marketing', 'Campaign drafts', overview.marketing.campaignDrafts],
      ['Marketing', 'Simulated sends', overview.marketing.simulatedSends],
      ['Content', 'Scheduled posts this week', overview.content.scheduledPostsThisWeek],
      ['Content', 'Posts needing approval', overview.content.postsNeedingApproval],
      ['Content', 'Setup required social accounts', overview.content.setupRequiredSocialAccounts],
      ['Gift cards', 'Pending orders', overview.giftCards.pendingOrders],
      ['Gift cards', 'Pending amount', overview.giftCards.totalPendingAmountCents],
      ['Gift cards', 'Fulfilled orders', overview.giftCards.fulfilledOrders]
    ];
    downloadTextFile(`alma-management-overview-${overview.rangeDays}d.csv`, csvRows(rows));
    setExportMessage('Management overview CSV downloaded.');
  }

  async function copyWeeklySummary() {
    setExportMessage(null);
    const lines = [
      `ALMA weekly summary: ${isoDate(weekStart)} to ${isoDate(addDays(weekEnd, -1))}`,
      `Forecast sales: ${formatCurrency(publishedForecastTotals.salesCents || forecastTotals.salesCents)}`,
      `Actual sales: ${actualSalesCents ? formatCurrency(actualSalesCents) : 'not imported'}`,
      `Sales variance: ${actualSalesCents ? formatCurrency(forecastSalesVarianceCents) : 'not available'}`,
      `Planned roster wages: ${formatCurrency(publishedForecastTotals.rosterCostCents || forecastTotals.plannedCostCents)}`,
      `Actual timesheet wages: ${formatCurrency(actualWageCostCents)}`,
      `Tips pool: ${data.tips ? formatCurrency(data.tips.allocatablePoolCents ?? data.tips.tipPoolCents) : 'not loaded'}`,
      `Actual wage percentage: ${actualWagePercent ? `${actualWagePercent.toFixed(1)}%` : 'not available'}`,
      '',
      ...venuePerformanceRows.map((row) =>
        `${row.venue}: sales ${row.actualSalesCents ? formatCurrency(row.actualSalesCents) : 'not imported'} vs forecast ${row.forecastSalesCents ? formatCurrency(row.forecastSalesCents) : 'not set'}, wages ${row.actualPercent ? `${row.actualPercent.toFixed(1)}%` : 'not available'}.`
      )
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setExportMessage('Weekly summary copied.');
    } catch {
      setExportMessage('Could not copy summary.');
    }
  }

  const averageRateCents = useMemo(() => {
    const rates = activeStaff
      .map((member) => member.trainingPayRateCents ?? member.payRateCents ?? 0)
      .filter((rate) => rate > 0);
    return rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : 3200;
  }, [activeStaff]);

  const forecastRows = useMemo<ForecastVenueRow[]>(() => {
    return venues.map((venue) => {
      const input = forecastInputs[venue] ?? { sales: '', targetWagePercent: '32' };
      const historical = historicalSalesForWeek(venue, weekStart);
      const historicalSalesCents = Math.round(historical.total * 100);
      const historicalSource = normaliseHistoricalVenue(venue);
      const forecastSalesCents = parseMoneyCents(input.sales);
      const targetWagePercent = parsePercent(input.targetWagePercent);
      const wageBudgetCents = Math.round(forecastSalesCents * (targetWagePercent / 100));
      const shifts = data.roster.filter((shift) => (shift.venue ?? shift.staffProfile?.venue ?? 'Unassigned') === venue);
      const planned = shifts.reduce(
        (total, shift) => {
          const member = staffById.get(shift.staffProfileId);
          const rateCents = member?.trainingPayRateCents ?? member?.payRateCents ?? averageRateCents;
          const hours = rosterShiftHours(shift);
          total.hours += hours;
          total.costCents += Math.round(hours * rateCents);
          return total;
        },
        { hours: 0, costCents: 0 }
      );
      const blendedRateCents = planned.hours > 0 ? Math.round(planned.costCents / planned.hours) : averageRateCents;
      const recommendedHours = blendedRateCents > 0 ? wageBudgetCents / blendedRateCents : 0;
      const byArea = shifts.reduce((map, shift) => {
        const area = shift.area ?? 'Shift';
        map.set(area, (map.get(area) ?? 0) + rosterShiftHours(shift));
        return map;
      }, new Map<string, number>());
      const areas = Array.from(byArea.entries()).sort((a, b) => b[1] - a[1]);
      const fallbackAreas = [['Floor', 0.55], ['Bar', 0.25], ['Kitchen', 0.2]] as const;
      const areaRows = areas.length
        ? areas.map(([area, hours]) => ({
            area,
            plannedHours: hours,
            recommendedHours: planned.hours > 0 ? recommendedHours * (hours / planned.hours) : 0
          }))
        : fallbackAreas.map(([area, share]) => ({
            area,
            plannedHours: 0,
            recommendedHours: recommendedHours * share
          }));

      return {
        venue,
        forecastSalesCents,
        historicalSalesCents,
        historicalSource,
        targetWagePercent,
        wageBudgetCents,
        plannedHours: planned.hours,
        plannedCostCents: planned.costCents,
        recommendedHours,
        hoursGap: recommendedHours - planned.hours,
        costGapCents: wageBudgetCents - planned.costCents,
        areaRows
      };
    });
  }, [averageRateCents, data.roster, forecastInputs, staffById, venues, weekStart]);

  const forecastTotals = forecastRows.reduce(
    (total, row) => ({
      salesCents: total.salesCents + row.forecastSalesCents,
      budgetCents: total.budgetCents + row.wageBudgetCents,
      plannedCostCents: total.plannedCostCents + row.plannedCostCents,
      plannedHours: total.plannedHours + row.plannedHours,
      recommendedHours: total.recommendedHours + row.recommendedHours
    }),
    { salesCents: 0, budgetCents: 0, plannedCostCents: 0, plannedHours: 0, recommendedHours: 0 }
  );
  const publishedForecastTotals = data.rosterForecastSnapshots.reduce(
    (total, snapshot) => ({
      salesCents: total.salesCents + snapshot.forecastSalesCents,
      budgetCents: total.budgetCents + snapshot.wageBudgetCents,
      rosterCostCents: total.rosterCostCents + snapshot.rosterCostCents,
      plannedHours: total.plannedHours + snapshot.plannedHours,
      recommendedHours: total.recommendedHours + snapshot.recommendedHours
    }),
    { salesCents: 0, budgetCents: 0, rosterCostCents: 0, plannedHours: 0, recommendedHours: 0 }
  );
  const actualWageCostCents = wageTotals.projectedCostCents;
  const actualApprovedWageCostCents = wageTotals.approvedCostCents;
  const actualSalesCents = data.actualSales?.totalSalesCents ?? 0;
  const primeTotals = data.primeCost?.totals;
  const forecastSalesVarianceCents = actualSalesCents - publishedForecastTotals.salesCents;
  const plannedVsActualWageCents = actualWageCostCents - publishedForecastTotals.rosterCostCents;
  const actualWagePercent = actualSalesCents > 0 ? (actualWageCostCents / actualSalesCents) * 100 : 0;
  const targetWagePercent =
    publishedForecastTotals.salesCents > 0
      ? (publishedForecastTotals.budgetCents / publishedForecastTotals.salesCents) * 100
      : 0;
  const actualSalesByVenue = new Map((data.actualSales?.byVenue ?? []).map((row) => [row.venue, row]));
  const wageByVenueMap = new Map(wageByVenue.map((row) => [row.venue, row]));
  const publishedSnapshotVenues = data.rosterForecastSnapshots.map((snapshot) => snapshot.venue || 'All venues');
  const performanceVenues = uniqueValues([
    ...venues,
    ...publishedSnapshotVenues,
    ...(data.actualSales?.byVenue ?? []).map((row) => row.venue),
    ...wageByVenue.map((row) => row.venue)
  ]).filter((venue) => venue !== 'All venues' || data.rosterForecastSnapshots.some((snapshot) => !snapshot.venue));
  const venuePerformanceRows = performanceVenues.map((venue) => {
    const snapshots =
      venue === 'All venues'
        ? data.rosterForecastSnapshots.filter((snapshot) => !snapshot.venue)
        : data.rosterForecastSnapshots.filter((snapshot) => snapshot.venue === venue);
    const snapshotTotals = snapshots.reduce(
      (total, snapshot) => ({
        salesCents: total.salesCents + snapshot.forecastSalesCents,
        budgetCents: total.budgetCents + snapshot.wageBudgetCents,
        rosterCostCents: total.rosterCostCents + snapshot.rosterCostCents,
        plannedHours: total.plannedHours + snapshot.plannedHours
      }),
      { salesCents: 0, budgetCents: 0, rosterCostCents: 0, plannedHours: 0 }
    );
    const actualSales = actualSalesByVenue.get(venue)?.salesCents ?? 0;
    const wages = wageByVenueMap.get(venue);
    const actualWages = wages?.costCents ?? 0;
    const actualHours = wages?.hours ?? 0;
    const actualPercent = actualSales > 0 ? (actualWages / actualSales) * 100 : 0;
    const targetPercent = snapshotTotals.salesCents > 0 ? (snapshotTotals.budgetCents / snapshotTotals.salesCents) * 100 : 0;

    return {
      venue,
      forecastSalesCents: snapshotTotals.salesCents,
      actualSalesCents: actualSales,
      salesVarianceCents: actualSales - snapshotTotals.salesCents,
      plannedWageCents: snapshotTotals.rosterCostCents,
      actualWageCents: actualWages,
      wageVarianceCents: actualWages - snapshotTotals.rosterCostCents,
      plannedHours: snapshotTotals.plannedHours,
      actualHours,
      targetPercent,
      actualPercent
    };
  });
  const salesReportVenues = useMemo(
    () =>
      uniqueValues([
        'Alma Avalon',
        'St Alma',
        ...venues,
        ...(data.actualSales?.byVenue ?? []).map((row) => row.venue)
      ]).filter((venue) => venue && venue !== 'Both' && venue !== 'All venues'),
    [data.actualSales?.byVenue, venues]
  );
  const actualSalesEntriesByVenue = useMemo(() => {
    return (data.actualSales?.entries ?? []).reduce((map, entry) => {
      const rows = map.get(entry.venue) ?? [];
      rows.push(entry);
      map.set(entry.venue, rows);
      return map;
    }, new Map<string, SalesActualSummary['entries']>());
  }, [data.actualSales?.entries]);
  const salesTrendRows = useMemo<SalesTrendVenueRow[]>(() => {
    return salesReportVenues.map((venue) => {
      const historical = historicalSalesForWeek(venue, weekStart);
      const previousHistorical = historicalSalesForWeek(venue, addDays(weekStart, -7));
      const entries = actualSalesEntriesByVenue.get(venue) ?? [];
      const actualSalesCents = entries.reduce((sum, entry) => sum + entry.salesCents, 0);
      const actualDates = new Set(entries.map((entry) => isoDate(new Date(entry.serviceDate))));
      const actualHistoricalCents = historical.days
        .filter((day) => actualDates.has(isoDate(day.date)))
        .reduce((sum, day) => sum + Math.round(day.sales * 100), 0);
      const historicalSalesCents = Math.round(historical.total * 100);
      const previousHistoricalSalesCents = Math.round(previousHistorical.total * 100);
      const manualForecastCents = parseMoneyCents(forecastInputs[venue]?.sales ?? '');
      const predictedSalesCents = actualSalesCents > 0 && actualHistoricalCents > 0
        ? Math.round(actualSalesCents * (historicalSalesCents / actualHistoricalCents))
        : manualForecastCents || historicalSalesCents;
      const trendPercent = previousHistoricalSalesCents > 0
        ? ((predictedSalesCents - previousHistoricalSalesCents) / previousHistoricalSalesCents) * 100
        : null;
      const forecastVarianceCents = actualSalesCents > 0
        ? actualSalesCents - manualForecastCents
        : predictedSalesCents - manualForecastCents;

      return {
        venue,
        actualSalesCents,
        actualDays: actualDates.size,
        manualForecastCents,
        historicalSalesCents,
        previousHistoricalSalesCents,
        predictedSalesCents,
        trendPercent,
        forecastVarianceCents,
        paceLabel: actualSalesCents > 0 && actualHistoricalCents > 0
          ? 'Actual pace vs matching historical days'
          : manualForecastCents > 0
            ? 'Manual forecast'
            : historicalSalesCents > 0
              ? 'Historical baseline'
              : 'Missing sales history'
      };
    });
  }, [actualSalesEntriesByVenue, forecastInputs, salesReportVenues, weekStart]);
  const salesDailyRows = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const dateKey = isoDate(date);
      return {
        date,
        venues: salesReportVenues.map((venue) => {
          const actualSalesCents = (actualSalesEntriesByVenue.get(venue) ?? [])
            .filter((entry) => isoDate(new Date(entry.serviceDate)) === dateKey)
            .reduce((sum, entry) => sum + entry.salesCents, 0);
          const historicalSalesCents = Math.round((historicalSalesForWeek(venue, weekStart).days[index]?.sales ?? 0) * 100);
          const historicalWeekCents = salesTrendRows.find((row) => row.venue === venue)?.historicalSalesCents ?? 0;
          const manualForecastCents = parseMoneyCents(forecastInputs[venue]?.sales ?? '');
          const forecastSalesCents = manualForecastCents > 0 && historicalWeekCents > 0
            ? Math.round(manualForecastCents * (historicalSalesCents / historicalWeekCents))
            : historicalSalesCents;
          return { venue, actualSalesCents, historicalSalesCents, forecastSalesCents };
        })
      };
    });
  }, [actualSalesEntriesByVenue, forecastInputs, salesReportVenues, salesTrendRows, weekStart]);
  const salesGraphMaxCents = Math.max(
    1,
    ...salesTrendRows.flatMap((row) => [row.actualSalesCents, row.manualForecastCents, row.predictedSalesCents, row.historicalSalesCents])
  );
  const salesDailyMaxCents = Math.max(
    1,
    ...salesDailyRows.flatMap((day) => day.venues.flatMap((row) => [row.actualSalesCents, row.forecastSalesCents, row.historicalSalesCents]))
  );

  const venueStockValueRows = (data.stockItems?.venueStockItems ?? []).filter(
    (row) => row.active && row.stockItem?.status === 'ACTIVE'
  );
  const stockCostUsesVenueRows = venueStockValueRows.length > 0;
  const stockValueCents = stockCostUsesVenueRows
    ? venueStockValueRows.reduce(
        (sum, row) => sum + Math.round((row.onHand ?? 0) * (row.stockItem?.avgCostCents ?? 0)),
        0
      )
    : data.stockItems?.items.reduce(
        (sum, item) => sum + Math.round(item.onHand * (item.avgCostCents ?? 0)),
        0
      ) ?? 0;

  const categoryValueRows = (
    stockCostUsesVenueRows
      ? Array.from(
          venueStockValueRows
            .reduce((map, row) => {
              const category = row.stockItem?.category?.name ?? 'Uncategorised';
              const current =
                map.get(category) ?? { category, itemCount: 0, valueCents: 0, lowStock: 0 };
              const threshold =
                row.reorderPoint ??
                row.parLevel ??
                row.stockItem?.reorderPoint ??
                row.stockItem?.parLevel ??
                0;
              current.itemCount += 1;
              current.valueCents += Math.round((row.onHand ?? 0) * (row.stockItem?.avgCostCents ?? 0));
              if (row.onHand !== null && threshold > 0 && row.onHand <= threshold) {
                current.lowStock += 1;
              }
              map.set(category, current);
              return map;
            }, new Map<string, { category: string; itemCount: number; valueCents: number; lowStock: number }>())
            .values()
        )
      : Array.from(
          (data.stockItems?.items ?? [])
            .reduce((map, item) => {
              const category = item.category?.name ?? 'Uncategorised';
              const current =
                map.get(category) ?? { category, itemCount: 0, valueCents: 0, lowStock: 0 };
              current.itemCount += 1;
              current.valueCents += Math.round(item.onHand * (item.avgCostCents ?? 0));
              map.set(category, current);
              return map;
            }, new Map<string, { category: string; itemCount: number; valueCents: number; lowStock: number }>())
            .values()
        )
  ).sort((a, b) => b.valueCents - a.valueCents);
  const stockCategoryCountLabel = stockCostUsesVenueRows ? 'Venue rows' : 'Items';
  const stockLowStockLabel = stockCostUsesVenueRows ? 'Low stock venue rows' : 'Low stock';

  function moveWeek(days: number) {
    setSelectedWeekStart(isoDate(addDays(weekStart, days)));
  }

  function selectReportSection(section: ReportSectionId) {
    const nextHash = reportHash(section);
    setActiveSection(section);
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, '', nextHash);
    }
  }

  function sectionButton(section: ReportSectionId, label = `Open ${REPORT_NAV_ITEMS.find((item) => item.id === section)?.label ?? 'section'}`) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => selectReportSection(section)}>
        {label}
      </Button>
    );
  }

  function appButton(baseUrl: string, path: string, label: string) {
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={!baseUrl}
        onClick={() => window.location.assign(`${baseUrl.replace(/\/+$/, '')}${path}`)}
      >
        {label}
      </Button>
    );
  }

  function SectionShell({
    id,
    title,
    description,
    children,
    action
  }: {
    id: ReportSectionId;
    title: string;
    description: string;
    children: JSX.Element;
    action?: JSX.Element;
  }) {
    const label = id === 'exports' || id === 'menu-engineering' ? weekWindowLabel : overviewWindowLabel;
    const sectionAction = id === 'overview'
      ? action
      : (
        <div className="reports-section-actions">
          {action}
          {sectionButton('overview', 'Back to reports overview')}
        </div>
      );
    // Overview owns its own gradient bubble header (AlmaHomeBubble); skip
    // the Card title/subtitle so we don't render two stacked headers.
    if (id === 'overview') {
      return (
        <section id={id} className="reports-section report-active-section" aria-labelledby={`${id}-heading`}>
          {children}
        </section>
      );
    }
    return (
      <section id={id} className="reports-section report-active-section" aria-labelledby={`${id}-heading`}>
        <Card
          title={title}
          subtitle={`${description} ${label}.`}
          action={sectionAction}
        >
          {children}
        </Card>
      </section>
    );
  }

  function Metric({
    label,
    value,
    tone = 'neutral',
    hint
  }: {
    label: string;
    value: string | number;
    tone?: 'positive' | 'warning' | 'danger' | 'info' | 'neutral';
    hint?: string;
  }) {
    return (
      <div className="metric-row">
        <span>
          <strong>{label}</strong>
          {hint ? <span className="subtle">{hint}</span> : null}
        </span>
        <Badge tone={tone}>{value}</Badge>
      </div>
    );
  }

  function renderOverviewSection() {
    const attentionCount =
      (data.overview?.staff.pendingLeaveCount ?? 0) +
      (data.overview?.staff.missingRequiredCompliance ?? 0) +
      (data.overview?.compliance.expiredStaffRecords ?? 0) +
      (data.overview?.stock.lowStockCount ?? 0) +
      (data.overview?.stock.stocktakesReadyForReview ?? 0) +
      (data.overview?.content.postsNeedingApproval ?? 0) +
      (data.overview?.giftCards.pendingOrders ?? 0);

    // Build 5-week trend (4 historical + current week as the last point)
    const currentWeekPrimeCost = {
      weekStart: isoDate(weekStart),
      primeCostPercent: primeTotals?.primeCostPercent ?? null,
      wagePercent: primeTotals?.wagePercent ?? null,
      cogsPercent: primeTotals?.cogsPercent ?? null,
      salesCents: primeTotals?.salesCents ?? 0
    };
    const trendPoints = [...primeCostHistory, currentWeekPrimeCost];
    const trendMaxPct = Math.max(75, ...trendPoints.map((p) => p.primeCostPercent ?? 0));
    const currentPct = primeTotals?.primeCostPercent ?? null;
    const heroTone: 'positive' | 'warning' | 'danger' | 'neutral' =
      currentPct == null ? 'neutral' : currentPct >= 65 ? 'danger' : currentPct >= 55 ? 'warning' : 'positive';

    // Weekly Snapshot (editorial dashboard from the design)
    const salesCentsForRange = primeTotals?.salesCents ?? 0;
    const itemSalesQuantity = data.itemSales?.totalQuantity ?? 0;
    const coversForRange = itemSalesQuantity > 0 ? itemSalesQuantity : (data.overview?.reserve.coversToday ?? 0);
    const noShowsForRange = data.overview?.reserve.noShows ?? 0;
    const bookingsForRange = (data.overview?.reserve.bookingsToday ?? 0) + (data.overview?.reserve.upcomingBookings ?? 0);
    const avgPerCoverCents = coversForRange > 0 ? salesCentsForRange / coversForRange : 0;
    const noShowDenominator = coversForRange + noShowsForRange;
    const noShowRate = noShowDenominator > 0 ? (noShowsForRange / noShowDenominator) * 100 : null;

    // Trends from the 5-week history we already pull
    const salesTrend = primeCostHistory.length > 1 ? primeCostHistory.map((p) => p.salesCents / 100) : undefined;

    // Compare current vs previous week for delta pills
    const previousWeek = primeCostHistory[primeCostHistory.length - 1];
    function deltaPill(curr: number | null | undefined, prev: number | null | undefined): string | undefined {
      if (curr == null || prev == null || prev === 0) return undefined;
      const pct = ((curr - prev) / prev) * 100;
      if (Math.abs(pct) < 0.5) return '~ flat';
      return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(0)}%`;
    }
    const takingsDelta = deltaPill(salesCentsForRange, previousWeek?.salesCents);

    // Top dishes — built from itemSales entries we already pull
    const dishGroups = new Map<string, { name: string; quantity: number; netSalesCents: number }>();
    for (const entry of data.itemSales?.entries ?? []) {
      const key = entry.itemName;
      const row = dishGroups.get(key) ?? { name: entry.itemName, quantity: 0, netSalesCents: 0 };
      row.quantity += entry.quantity;
      row.netSalesCents += entry.netSalesCents;
      dishGroups.set(key, row);
    }
    const topDishes = Array.from(dishGroups.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 6);

    // Per-venue comparison rows from primeCost.
    // Drop legacy "Both" rollup rows — the totals row beneath already plays
    // that role, so showing both creates a confusing duplicate column.
    const venueRows = (data.primeCost?.venues ?? []).filter(
      (row) => row.venue && row.venue !== 'Both'
    );
    // If the API ever stops returning a totals row, fold the venues together
    // ourselves so we always have a Group total to show.
    const totalsRow = data.primeCost?.totals ?? (venueRows.length > 0
      ? {
          salesCents: venueRows.reduce((sum, v) => sum + v.salesCents, 0),
          wageCents: venueRows.reduce((sum, v) => sum + v.wageCents, 0),
          approvedWageCents: venueRows.reduce((sum, v) => sum + v.approvedWageCents, 0),
          rosterWageEstimateCents: venueRows.reduce((sum, v) => sum + v.rosterWageEstimateCents, 0),
          cogsCents: venueRows.reduce((sum, v) => sum + v.cogsCents, 0),
          invoiceCogsCents: venueRows.reduce((sum, v) => sum + v.invoiceCogsCents, 0),
          wastageCents: venueRows.reduce((sum, v) => sum + v.wastageCents, 0),
          primeCostCents: venueRows.reduce((sum, v) => sum + v.primeCostCents, 0),
          wagePercent: (() => {
            const sales = venueRows.reduce((sum, v) => sum + v.salesCents, 0);
            const wage = venueRows.reduce((sum, v) => sum + v.wageCents, 0);
            return sales > 0 ? (wage / sales) * 100 : null;
          })(),
          cogsPercent: (() => {
            const sales = venueRows.reduce((sum, v) => sum + v.salesCents, 0);
            const cogs = venueRows.reduce((sum, v) => sum + v.cogsCents, 0);
            return sales > 0 ? (cogs / sales) * 100 : null;
          })(),
          primeCostPercent: (() => {
            const sales = venueRows.reduce((sum, v) => sum + v.salesCents, 0);
            const prime = venueRows.reduce((sum, v) => sum + v.primeCostCents, 0);
            return sales > 0 ? (prime / sales) * 100 : null;
          })(),
          timesheetHours: venueRows.reduce((sum, v) => sum + v.timesheetHours, 0),
          rosterHours: venueRows.reduce((sum, v) => sum + v.rosterHours, 0),
          salesDays: venueRows.reduce((sum, v) => Math.max(sum, v.salesDays), 0),
          sourceQuality: 'incomplete' as const,
          missing: [] as string[]
        }
      : null);

    return (
      <SectionShell
        id="overview"
        title="Reports Overview"
        description="High-level snapshot only, with shortcuts into each detailed report"
        action={<Button type="button" size="sm" variant="secondary" onClick={exportOverviewCsv}>Export overview CSV</Button>}
      >
        <div className="report-section-stack">
          {(() => {
            const variancePct = primeTotals?.primeCostPercent != null
              ? primeTotals.primeCostPercent - 60
              : null;
            const sub = (() => {
              if (loading) return 'Loading the week in numbers.';
              if (salesCentsForRange === 0) return 'No sales imported for the period yet — connect a source to see this week shape up.';
              if (variancePct != null && variancePct > 5) {
                return `Prime cost ${primeTotals?.primeCostPercent?.toFixed(1)}% — running hot vs the 60% target.`;
              }
              if (variancePct != null && variancePct < -5) {
                return `Prime cost ${primeTotals?.primeCostPercent?.toFixed(1)}% — well inside guide for the week.`;
              }
              return `Signed in as ${user.firstName}`;
            })();
            return (
              <AlmaHomeBubble
                app="reports"
                appName="Reports"
                appIcon={<ChartIcon />}
                eyebrow="Reports command"
                description="High-level attention signals across the suite. Reports are read-only and scoped to the venues you have access to."
                statusLabel="Overview"
                statusHint={sub}
                statusDot={variancePct != null && variancePct > 5 ? 'terracotta' : variancePct != null && variancePct < -5 ? 'forest' : 'amber'}
                actions={
                  <>
                    <button
                      type="button"
                      className="alma-home-bubble-btn alma-home-bubble-btn--primary"
                      onClick={() => void load()}
                    >
                      Refresh →
                    </button>
                    <button
                      type="button"
                      className="alma-home-bubble-btn alma-home-bubble-btn--ghost"
                      onClick={exportOverviewCsv}
                    >
                      Export overview
                    </button>
                  </>
                }
              />
            );
          })()}

          {/* Weekly Snapshot — editorial dashboard from the design */}
          <div className="alma-page-grid-kpis">
            <BigStat
              eyebrow={`Takings · ${weekWindowLabel}`}
              value={formatCurrency(salesCentsForRange)}
              sub={data.primeCost?.sources.sales === 'missing' ? 'Sales import missing' : 'Group total'}
              delta={takingsDelta}
              trend={salesTrend}
              sparkColor="#684A4A"
            />
            <BigStat
              eyebrow={`Covers · ${weekWindowLabel}`}
              value={coversForRange.toLocaleString()}
              sub={itemSalesQuantity > 0
                ? `${data.itemSales?.entries.length ?? 0} menu rows · Square actuals`
                : `${bookingsForRange} bookings on the books`}
            />
            <BigStat
              eyebrow="Avg per cover"
              value={avgPerCoverCents > 0 ? formatCurrency(avgPerCoverCents) : '—'}
              sub={coversForRange > 0 ? `${coversForRange.toLocaleString()} covers` : 'Awaiting Square import'}
            />
            <BigStat
              eyebrow="No-show rate"
              value={noShowRate != null ? `${noShowRate.toFixed(1)}%` : '—'}
              sub={`${noShowsForRange} no-shows today`}
              sparkColor="#9A3A2E"
            />
          </div>

          {/* By venue — editorial panel using primeCost venues data */}
          {venueRows.length > 0 && totalsRow ? (
            <EditorialPanel
              eyebrow={`This week · ${weekWindowLabel}`}
              title="By venue"
              actions={
                <Button type="button" size="sm" variant="secondary" onClick={exportOverviewCsv}>
                  Export CSV
                </Button>
              }
            >
              <div className="alma-venue-table">
                <div className="alma-venue-table-head">
                  <span>Venue</span>
                  <span>Sales</span>
                  <span>Wages %</span>
                  <span>COGS %</span>
                  <span>Prime cost</span>
                </div>
                {venueRows.map((row) => (
                  <div className="alma-venue-row" key={row.venue}>
                    <span className="alma-venue-name">{row.venue}</span>
                    <span className="alma-venue-num">{formatCurrency(row.salesCents)}</span>
                    <span className="alma-venue-num">{formatPercent(row.wagePercent)}</span>
                    <span className="alma-venue-num">{formatPercent(row.cogsPercent)}</span>
                    <span>
                      <AlmaPill kind={row.primeCostPercent == null
                        ? 'neutral'
                        : row.primeCostPercent >= 65
                          ? 'danger'
                          : row.primeCostPercent >= 55
                            ? 'warn'
                            : 'success'}>
                        {row.primeCostPercent != null ? `${row.primeCostPercent.toFixed(1)}%` : '—'}
                      </AlmaPill>
                    </span>
                  </div>
                ))}
                <div className="alma-venue-row is-total">
                  <span className="alma-venue-name">Group total</span>
                  <span className="alma-venue-num">{formatCurrency(totalsRow.salesCents)}</span>
                  <span className="alma-venue-num">{formatPercent(totalsRow.wagePercent)}</span>
                  <span className="alma-venue-num">{formatPercent(totalsRow.cogsPercent)}</span>
                  <span>
                    <AlmaPill kind={totalsRow.primeCostPercent == null
                      ? 'neutral'
                      : totalsRow.primeCostPercent >= 65
                        ? 'danger'
                        : totalsRow.primeCostPercent >= 55
                          ? 'warn'
                          : 'success'}>
                      {totalsRow.primeCostPercent != null ? `${totalsRow.primeCostPercent.toFixed(1)}%` : '—'}
                    </AlmaPill>
                  </span>
                </div>
              </div>
            </EditorialPanel>
          ) : null}

          {/* Top dishes — editorial panel */}
          {topDishes.length > 0 ? (
            <EditorialPanel
              eyebrow={`This week · ${weekWindowLabel}`}
              title="Top dishes"
              actions={
                <Button type="button" size="sm" variant="ghost" onClick={() => selectReportSection('sales')}>
                  Open sales detail
                </Button>
              }
            >
              <div className="alma-top-dishes">
                {topDishes.map((dish, index) => (
                  <div className="alma-top-dish-row" key={dish.name}>
                    <span className="alma-top-dish-rank">{index + 1}</span>
                    <span className="alma-top-dish-name">{dish.name}</span>
                    <span className="alma-top-dish-count">{dish.quantity.toLocaleString()}</span>
                    <span className="alma-top-dish-sales">{formatCurrency(dish.netSalesCents)}</span>
                  </div>
                ))}
              </div>
            </EditorialPanel>
          ) : null}

          {/* Prime cost hero — the single most important metric */}
          <button
            type="button"
            className={`prime-cost-hero is-${heroTone}`}
            onClick={() => selectReportSection('stock')}
            aria-label="Open prime cost detail"
          >
            <div className="prime-cost-hero-main">
              <span className="prime-cost-hero-eyebrow">Prime cost · {weekWindowLabel}</span>
              <span className="prime-cost-hero-value">
                {currentPct != null ? `${currentPct.toFixed(1)}%` : '—'}
              </span>
              <span className="prime-cost-hero-split">
                Wages {formatPercent(primeTotals?.wagePercent)}
                <span aria-hidden="true">·</span>
                COGS {formatPercent(primeTotals?.cogsPercent)}
                <span aria-hidden="true">·</span>
                Sales {formatCurrency(primeTotals?.salesCents ?? 0)}
              </span>
            </div>
            <div className="prime-cost-hero-trend" aria-label="5 week prime cost trend">
              {trendPoints.map((point, i) => {
                const pct = point.primeCostPercent;
                const height = pct != null ? Math.max(8, (pct / trendMaxPct) * 100) : 6;
                const barTone = pct == null ? 'muted' : pct >= 65 ? 'danger' : pct >= 55 ? 'warning' : 'positive';
                const isCurrent = i === trendPoints.length - 1;
                return (
                  <div key={point.weekStart} className={`prime-cost-hero-bar is-${barTone}${isCurrent ? ' is-current' : ''}`}>
                    <div className="prime-cost-hero-bar-fill" style={{ height: `${height}%` }} />
                    <span className="prime-cost-hero-bar-label">
                      {pct != null ? `${pct.toFixed(0)}%` : '—'}
                    </span>
                    <small>
                      {new Date(point.weekStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </small>
                  </div>
                );
              })}
            </div>
          </button>

          {/* Venue comparison panel removed — replaced by the editorial
              "By venue" panel above. The new panel uses the same primeCost
              data with the editorial chrome (eyebrow + Cormorant title +
              AlmaPill prime cost) and merges the group total row in. */}

          <div className="stats-grid report-metric-grid">
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('compliance')} aria-label="Open attention reports">
              <StatCard label="Attention items" value={attentionCount} hint="Across staff, compliance, stock, content, and gift cards" loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('staff')} aria-label="Open staff reports">
              <StatCard label="Active staff" value={data.overview?.staff.totalActiveStaff ?? 0} hint="Current staff profiles" loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('reserve')} aria-label="Open reserve reports">
              <StatCard label="Bookings today" value={data.overview?.reserve.bookingsToday ?? 0} hint={`${data.overview?.reserve.coversToday ?? 0} covers`} loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('stock')} aria-label="Open stock reports">
              <StatCard label="Low stock" value={data.overview?.stock.lowStockCount ?? 0} hint="Venue stock rows" loading={loading} />
            </button>
          </div>

          <div className="stats-grid report-metric-grid">
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('sales')} aria-label="Open sales reports">
              <StatCard label="Sales" value={formatCurrency(primeTotals?.salesCents ?? 0)} hint={data.primeCost?.sources.sales === 'missing' ? 'Missing sales import' : weekWindowLabel} loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('staff')} aria-label="Open wage reports">
              <StatCard label="Wages" value={formatCurrency(primeTotals?.wageCents ?? 0)} hint={data.primeCost?.sources.wages === 'roster_estimate' ? 'Roster estimate' : `${formatPercent(primeTotals?.wagePercent)} of sales`} loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('stock')} aria-label="Open COGS reports">
              <StatCard label="COGS" value={formatCurrency(primeTotals?.cogsCents ?? 0)} hint={data.primeCost?.sources.cogs === 'missing' ? 'Missing matched invoices' : `${formatPercent(primeTotals?.cogsPercent)} of sales`} loading={loading} />
            </button>
            <button type="button" className="stat-card-link" onClick={() => selectReportSection('stock')} aria-label="Open data quality detail">
              <StatCard label="Data quality" value={qualityLabel(primeTotals?.sourceQuality) ?? '—'} hint="Sales · wages · COGS sources" loading={loading} />
            </button>
          </div>

          <div className="report-detail-grid">
            <ActionPanel
              title="Needs attention"
              description="Expand to open the right app for each live signal."
              count={attentionCount}
              tone={attentionCount ? 'warning' : 'positive'}
              empty={<p className="subtle">No report signals need action in this range.</p>}
            >
              {(data.overview?.staff.pendingLeaveCount ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Pending leave</strong>
                    <small>{data.overview?.staff.pendingLeaveCount ?? 0} leave request{(data.overview?.staff.pendingLeaveCount ?? 0) === 1 ? '' : 's'} awaiting manager decision.</small>
                  </span>
                  {appButton(STAFF_WEB_URL, '/leave', 'Open Staff')}
                </div>
              ) : null}
              {(data.overview?.staff.missingRequiredCompliance ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Missing or pending staff compliance</strong>
                    <small>{data.overview?.staff.missingRequiredCompliance ?? 0} staff compliance item{(data.overview?.staff.missingRequiredCompliance ?? 0) === 1 ? '' : 's'} need follow-up.</small>
                  </span>
                  {appButton(STAFF_WEB_URL, '/approvals', 'Open approvals')}
                </div>
              ) : null}
              {(data.overview?.compliance.expiredStaffRecords ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Expired compliance records</strong>
                    <small>{data.overview?.compliance.expiredStaffRecords ?? 0} record{(data.overview?.compliance.expiredStaffRecords ?? 0) === 1 ? '' : 's'} need review.</small>
                  </span>
                  {appButton(COMPLIANCE_WEB_URL, '/staff', 'Open Compliance')}
                </div>
              ) : null}
              {(data.overview?.stock.stocktakesReadyForReview ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Stocktakes ready for review</strong>
                    <small>{data.overview?.stock.stocktakesReadyForReview ?? 0} submitted stocktake{(data.overview?.stock.stocktakesReadyForReview ?? 0) === 1 ? '' : 's'} waiting.</small>
                  </span>
                  {appButton(STOCK_WEB_URL, '/stocktake', 'Open Stock')}
                </div>
              ) : null}
              {(data.overview?.stock.lowStockCount ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Low stock</strong>
                    <small>{data.overview?.stock.lowStockCount ?? 0} venue stock row{(data.overview?.stock.lowStockCount ?? 0) === 1 ? '' : 's'} below reorder level.</small>
                  </span>
                  {appButton(STOCK_WEB_URL, '/', 'Open Stock')}
                </div>
              ) : null}
              {(data.overview?.content.postsNeedingApproval ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Posts needing approval</strong>
                    <small>{data.overview?.content.postsNeedingApproval ?? 0} content item{(data.overview?.content.postsNeedingApproval ?? 0) === 1 ? '' : 's'} waiting.</small>
                  </span>
                  {sectionButton('content', 'Open content report')}
                </div>
              ) : null}
              {(data.overview?.giftCards.pendingOrders ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Pending gift card orders</strong>
                    <small>{data.overview?.giftCards.pendingOrders ?? 0} order{(data.overview?.giftCards.pendingOrders ?? 0) === 1 ? '' : 's'} need follow-up.</small>
                  </span>
                  {appButton(GIFTCARDS_WEB_URL, '/orders', 'Open orders')}
                </div>
              ) : null}
            </ActionPanel>

            <div className="report-panel">
              <h4>Open detailed reports</h4>
              <div className="report-shortcut-grid">
                {REPORT_NAV_ITEMS.filter((item) => item.id !== 'overview').map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="report-shortcut"
                    onClick={() => selectReportSection(item.id)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderSalesSection() {
    const totalForecastCents = salesTrendRows.reduce((sum, row) => sum + row.manualForecastCents, 0);
    const totalHistoricalCents = salesTrendRows.reduce((sum, row) => sum + row.historicalSalesCents, 0);
    const totalPredictedCents = salesTrendRows.reduce((sum, row) => sum + row.predictedSalesCents, 0);
    const importedDays = salesTrendRows.reduce((sum, row) => sum + row.actualDays, 0);
    const missingHistoryCount = salesTrendRows.filter((row) => row.historicalSalesCents <= 0).length;

    return (
      <SectionShell
        id="sales"
        title="Sales Reports"
        description="Alma Avalon and St Alma sales actuals, daily trends, historical baseline, and weekly prediction"
      >
        <div className="report-section-stack">
          <div className="stats-grid report-metric-grid">
            <StatCard label="Actual imported" value={formatCurrency(actualSalesCents)} hint={`${importedDays} venue day${importedDays === 1 ? '' : 's'} imported`} loading={loading} />
            <StatCard label="Manual forecast" value={formatCurrency(totalForecastCents)} hint="Editable venue inputs" loading={loading} />
            <StatCard label="Predicted sales" value={formatCurrency(totalPredictedCents)} hint="Current pace, forecast, or history" loading={loading} />
            <StatCard label="Historical baseline" value={formatCurrency(totalHistoricalCents)} hint={missingHistoryCount ? `${missingHistoryCount} missing baseline${missingHistoryCount === 1 ? '' : 's'}` : 'Selected week baseline'} loading={loading} />
          </div>

          {data.actualSales?.entries.length ? null : (
            <p className="report-warning-text">No imported sales actuals are available for this week. The predicted sales value falls back to manual forecast first, then historical baseline.</p>
          )}
          {missingHistoryCount ? (
            <p className="report-warning-text">Historical sales history is missing for {missingHistoryCount} venue{missingHistoryCount === 1 ? '' : 's'}, so trend percentage and historical reset may be unavailable there.</p>
          ) : null}

          <div className="sales-venue-grid">
            {salesTrendRows.map((row) => {
              const trendLabel = row.trendPercent === null ? 'No trend' : `${row.trendPercent >= 0 ? '+' : ''}${row.trendPercent.toFixed(1)}%`;
              const trendTone = row.trendPercent === null ? 'neutral' : row.trendPercent >= 0 ? 'positive' : 'warning';
              const varianceTone = row.forecastVarianceCents >= 0 ? 'positive' : 'warning';
              return (
                <section key={row.venue} className="sales-venue-panel">
                  <div className="sales-panel-header">
                    <span>
                      <h4>{row.venue}</h4>
                      <small>{normaliseHistoricalVenue(row.venue) ? 'Historical baseline available' : 'No historical baseline'} · {row.actualDays || 'No'} imported day{row.actualDays === 1 ? '' : 's'}</small>
                    </span>
                    <Badge tone={trendTone}>{trendLabel}</Badge>
                  </div>

                  <div className="sales-trend-bars" aria-label={`${row.venue} sales trend bars`}>
                    {[
                      ['Actual/imported', row.actualSalesCents, 'actual'],
                      ['Forecast input', row.manualForecastCents, 'forecast'],
                      ['predicted sales', row.predictedSalesCents, 'predicted'],
                      ['Historical baseline', row.historicalSalesCents, 'history']
                    ].map(([label, cents, tone]) => (
                      <div key={label} className={`sales-horizontal-row is-${tone}`}>
                        <span>{label}</span>
                        <div className="sales-horizontal-track">
                          <div className={`sales-horizontal-bar is-${tone}`} style={{ width: `${Math.max(4, (Number(cents) / salesGraphMaxCents) * 100)}%` }} />
                        </div>
                        <strong>{formatCurrency(Number(cents))}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="form-grid two">
                    <Input
                      label="Forecast input"
                      value={forecastInputs[row.venue]?.sales ?? ''}
                      placeholder={centsInput(row.historicalSalesCents) || 'Set in Admin'}
                      readOnly
                      onChange={() => {}}
                    />
                    <Input
                      label="Target wage %"
                      value={forecastInputs[row.venue]?.targetWagePercent ?? '32'}
                      readOnly
                      onChange={() => {}}
                    />
                  </div>
                  <p className="subtle" style={{ marginTop: 0 }}>
                    Edit these values in <a href="https://alma-suite-admin.web.app/wage-forecasts" target="_blank" rel="noreferrer">Admin → Wage forecasts</a>.
                  </p>

                  <div className="sales-mini-metrics">
                    <Metric label="Prediction source" value={row.paceLabel} tone={row.actualSalesCents ? 'info' : row.predictedSalesCents ? 'warning' : 'neutral'} />
                    <Metric label="Forecast variance" value={signedCurrency(row.forecastVarianceCents)} tone={varianceTone} hint={row.actualSalesCents ? 'Actual minus forecast input' : 'Prediction minus forecast input'} />
                    <Metric label="Previous historical week" value={formatCurrency(row.previousHistoricalSalesCents)} tone="neutral" />
                  </div>

                </section>
              );
            })}
          </div>

          <div className="report-panel">
            <h4>Daily sales trend</h4>
            <div className="sales-daily-chart">
              {salesDailyRows.map((day) => (
                <div key={isoDate(day.date)} className="sales-daily-row">
                  <span>{day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</span>
                  <div>
                    {day.venues.map((row) => (
                      <div key={row.venue} className="sales-daily-bar-row">
                        <small>{row.venue}</small>
                        <div className="sales-horizontal-track">
                          <div className="sales-horizontal-bar is-actual" style={{ width: `${Math.max(4, (row.actualSalesCents / salesDailyMaxCents) * 100)}%` }} />
                        </div>
                        <div className="sales-horizontal-track">
                          <div className="sales-horizontal-bar is-forecast" style={{ width: `${Math.max(4, (row.forecastSalesCents / salesDailyMaxCents) * 100)}%` }} />
                        </div>
                        <strong>{row.actualSalesCents ? formatCurrency(row.actualSalesCents) : formatCurrency(row.forecastSalesCents)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="sales-chart-legend">
              <span><i className="legend-dot is-actual" />Actual/imported sales</span>
              <span><i className="legend-dot is-forecast" />Forecast or historical baseline</span>
            </div>
          </div>

          {/* 8-week forecast vs actual */}
          {forecastHistory.some((w) => w.forecastCents > 0 || w.actualCents > 0) ? (
            <div className="report-panel">
              <h4>Forecast vs actual · last 8 weeks</h4>
              <p className="subtle" style={{ marginTop: -4 }}>
                Side-by-side bars per week. Variance shows how the forecast compared to imported actuals.
              </p>
              {(() => {
                const maxCents = Math.max(
                  ...forecastHistory.map((w) => Math.max(w.forecastCents, w.actualCents)),
                  1
                );
                const avgVariance = (() => {
                  const valid = forecastHistory.filter((w) => w.variance !== null) as Array<{ variance: number }>;
                  if (valid.length === 0) return null;
                  return valid.reduce((sum, w) => sum + Math.abs(w.variance), 0) / valid.length;
                })();
                return (
                  <>
                    <div className="forecast-vs-actual-chart">
                      {forecastHistory.map((week) => {
                        const fHeight = (week.forecastCents / maxCents) * 100;
                        const aHeight = (week.actualCents / maxCents) * 100;
                        const tone = week.variance === null ? 'muted'
                          : Math.abs(week.variance) <= 5 ? 'positive'
                          : Math.abs(week.variance) <= 15 ? 'warning'
                          : 'danger';
                        return (
                          <div key={week.weekStart} className={`forecast-vs-actual-week is-${tone}`}>
                            <div className="forecast-vs-actual-bars">
                              <div className="forecast-vs-actual-bar is-forecast" style={{ height: `${Math.max(2, fHeight)}%` }} title={`Forecast: ${formatCurrency(week.forecastCents)}`} />
                              <div className="forecast-vs-actual-bar is-actual" style={{ height: `${Math.max(2, aHeight)}%` }} title={`Actual: ${formatCurrency(week.actualCents)}`} />
                            </div>
                            <small>{new Date(week.weekStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</small>
                            <span>
                              {week.variance !== null
                                ? `${week.variance > 0 ? '+' : ''}${week.variance.toFixed(0)}%`
                                : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="sales-chart-legend">
                      <span><i className="legend-dot is-forecast" />Forecast</span>
                      <span><i className="legend-dot is-actual" />Actual</span>
                      {avgVariance !== null ? (
                        <span className="subtle">
                          · Average absolute variance across 8 weeks: <strong>{avgVariance.toFixed(1)}%</strong>
                        </span>
                      ) : null}
                    </div>
                  </>
                );
              })()}
            </div>
          ) : null}

          <div className="report-panel">
            <h4>Actual/imported sales rows</h4>
            {data.actualSales?.entries.length ? (
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Venue</th>
                      <th>Sales</th>
                      <th>Source</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.actualSales.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.serviceDate).toLocaleDateString()}</td>
                        <td>{entry.venue}</td>
                        <td>{formatCurrency(entry.salesCents)}</td>
                        <td>{entry.source}</td>
                        <td>{entry.notes || entry.externalId || 'Imported actual'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="subtle">No actual sales rows are available for the selected week. Import sales actuals before using actual pace projections.</p>
            )}
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderStaffSection() {
    const missingPayRateStaff = activeStaff.filter((member) => !member.payRateCents && !member.trainingPayRateCents);
    const submittedTimesheets = data.timesheets.filter((item) => item.status === 'SUBMITTED');
    const exportedTimesheets = data.timesheets.filter((item) => item.status === 'APPROVED' || item.status === 'EXPORTED');
    const staffAttentionCount =
      (data.overview?.staff.missingRequiredCompliance ?? 0) +
      missingPayRateStaff.length +
      submittedTimesheets.length;
    return (
      <SectionShell
        id="staff"
        title="Staff Reports"
        description="Active staff, leave, clocking, payroll readiness, and wage costing"
        action={<Button type="button" size="sm" variant="secondary" onClick={exportWagesCsv} disabled={!wageRows.length}>Export wages CSV</Button>}
      >
        <div className="report-section-stack">
          <div className="stats-grid report-metric-grid">
            <StatCard label="Active staff" value={data.overview?.staff.totalActiveStaff ?? activeStaff.length} hint="Current profiles" loading={loading} />
            <StatCard label="Pending leave" value={data.overview?.staff.pendingLeaveCount ?? 0} hint="Awaiting manager decision" loading={loading} />
            <StatCard label="Approved leave" value={data.overview?.staff.approvedLeaveNext30Days ?? 0} hint="Next 30 days" loading={loading} />
            <StatCard label="Awaiting approval" value={data.timesheets.filter((item) => item.status === 'SUBMITTED').length} hint={weekWindowLabel} loading={loading} />
          </div>

          <div className="stats-grid report-metric-grid">
            <StatCard label="Projected wages" value={formatCurrency(wageTotals.projectedCostCents)} hint={`${roundHours(wageTotals.hours)}h total`} loading={loading} />
            <StatCard label="Approved wages" value={formatCurrency(wageTotals.approvedCostCents)} hint={`${roundHours(wageTotals.approvedHours)}h approved`} loading={loading} />
            <StatCard label="Weekly tips pool" value={formatCurrency(data.tips?.allocatablePoolCents ?? data.tips?.tipPoolCents ?? 0)} hint="After breakage deduction" loading={loading} />
            <StatCard label="Payroll total" value={formatCurrency(wageTotals.approvedCostCents + (data.tips?.allocatablePoolCents ?? data.tips?.tipPoolCents ?? 0))} hint="Approved wages + tips" loading={loading} />
          </div>

          <div className="report-detail-grid">
            <ActionPanel
              title="Staff attention"
              description="Expand to see the affected staff rows and the safest next action."
              count={staffAttentionCount}
              tone={staffAttentionCount ? 'warning' : 'positive'}
              empty={<p className="subtle">No staff report items need action in this range.</p>}
            >
              {(data.overview?.staff.missingRequiredCompliance ?? 0) > 0 ? (
                <div className="action-panel-row">
                  <span>
                    <strong>Missing or pending compliance</strong>
                    <small>{data.overview?.staff.missingRequiredCompliance ?? 0} compliance item{(data.overview?.staff.missingRequiredCompliance ?? 0) === 1 ? '' : 's'} need review.</small>
                  </span>
                  {appButton(STAFF_WEB_URL, '/approvals', 'Review approvals')}
                </div>
              ) : null}
              {missingPayRateStaff.slice(0, 8).map((member) => (
                <div key={member.id} className="action-panel-row">
                  <span>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <small>{member.venue || 'No venue'} · pay rate missing</small>
                  </span>
                  {appButton(STAFF_WEB_URL, '/settings', 'Open Staff settings')}
                </div>
              ))}
              {missingPayRateStaff.length > 8 ? <p className="subtle">{missingPayRateStaff.length - 8} more staff missing pay rate.</p> : null}
              {submittedTimesheets.slice(0, 8).map((timesheet) => (
                <div key={timesheet.id} className="action-panel-row">
                  <span>
                    <strong>{staffName(timesheet.staffProfile ?? { firstName: 'Unknown', lastName: 'staff' })}</strong>
                    <small>{roundHours(timesheetHours(timesheet))} submitted hours · awaiting approval</small>
                  </span>
                  {appButton(STAFF_WEB_URL, '/timesheets', 'Review timesheet')}
                </div>
              ))}
              {submittedTimesheets.length > 8 ? <p className="subtle">{submittedTimesheets.length - 8} more timesheets waiting.</p> : null}
            </ActionPanel>

            <div className="report-panel">
              <h4>Wages by venue</h4>
              {(data.primeCost?.venues ?? []).filter((venue) => venue.venue && venue.venue !== 'Both').length ? (
                (data.primeCost?.venues ?? []).filter((venue) => venue.venue && venue.venue !== 'Both').map((venue) => (
                  <Metric
                    key={venue.venue}
                    label={venue.venue}
                    value={formatCurrency(venue.wageCents)}
                    tone={venue.missing.includes('wages') ? 'warning' : 'info'}
                    hint={`${formatPercent(venue.wagePercent)} of sales · ${roundHours(venue.timesheetHours || venue.rosterHours)}`}
                  />
                ))
              ) : (
                <p className="subtle">No timesheets found for this week.</p>
              )}
              <Metric label="Approved wages" value={formatCurrency(primeTotals?.approvedWageCents ?? actualApprovedWageCostCents)} tone="positive" hint="Approved/exported timesheets only" />
            </div>
          </div>

          {wageRows.length ? (
            <div className="report-panel">
              <h4>Wage costing — {weekWindowLabel}</h4>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Venue</th>
                      <th>Role</th>
                      <th>Total hrs</th>
                      <th>Appr. hrs</th>
                      <th>Rate</th>
                      <th>Projected wages</th>
                      <th>Approved wages</th>
                      <th>Tips</th>
                      <th>Payroll total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {wageRows.map((row) => (
                      <tr key={row.staffProfileId}>
                        <td><strong>{row.name}</strong></td>
                        <td>{row.venue}</td>
                        <td>{row.roleTitle}</td>
                        <td>{row.hours.toFixed(2)}</td>
                        <td>{row.approvedHours.toFixed(2)}</td>
                        <td>{row.rateCents ? formatCurrency(row.rateCents) : <span className="subtle">—</span>}</td>
                        <td>{formatCurrency(row.projectedCostCents)}</td>
                        <td>{formatCurrency(row.approvedCostCents)}</td>
                        <td>{row.tipsCents ? formatCurrency(row.tipsCents) : <span className="subtle">—</span>}</td>
                        <td><strong>{formatCurrency(row.approvedCostCents + row.tipsCents)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3}><strong>Total</strong></td>
                      <td><strong>{wageTotals.hours.toFixed(2)}</strong></td>
                      <td><strong>{wageTotals.approvedHours.toFixed(2)}</strong></td>
                      <td></td>
                      <td><strong>{formatCurrency(wageTotals.projectedCostCents)}</strong></td>
                      <td><strong>{formatCurrency(wageTotals.approvedCostCents)}</strong></td>
                      <td><strong>{formatCurrency(wageRows.reduce((s, r) => s + r.tipsCents, 0))}</strong></td>
                      <td><strong>{formatCurrency(wageTotals.approvedCostCents + wageRows.reduce((s, r) => s + r.tipsCents, 0))}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}

          <div className="report-panel">
            <h4>Recent staff management events</h4>
            <Metric label="Approved or exported timesheets" value={exportedTimesheets.length} tone="positive" />
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Staff</th>
                    <th>Event</th>
                    <th>Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overview?.staff.recentManagementEvents.length ? (
                    data.overview.staff.recentManagementEvents.map((event) => (
                      <tr key={event.id}>
                        <td>{formatDateTime(event.createdAt)}</td>
                        <td>{event.staffProfile ? `${event.staffProfile.firstName} ${event.staffProfile.lastName}` : 'Staff profile'}</td>
                        <td>{event.eventType}</td>
                        <td>{event.summary}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4}>No recent staff management events in this range.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-detail-grid">
            <div className="report-panel" style={{ gridColumn: '1 / -1' }}>
              <h4>Staff costing detail</h4>
              <p className="subtle">Wage cost, cost per hour, section mix, variance, and labour charts. Moved here from Admin so wage reporting lives in one place.</p>
              <StaffCostingReportPage />
            </div>
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderComplianceSection() {
    return (
      <SectionShell
        id="compliance"
        title="Compliance Reports"
        description="Outstanding compliance, expired records, expiring records, and venue attention"
      >
        <div className="report-detail-grid">
          <div className="report-panel">
            <h4>Record attention</h4>
            <Metric label="Pending staff records" value={data.overview?.compliance.pendingStaffRecords ?? 0} tone={(data.overview?.compliance.pendingStaffRecords ?? 0) > 0 ? 'warning' : 'positive'} />
            <Metric label="Expired staff records" value={data.overview?.compliance.expiredStaffRecords ?? 0} tone={(data.overview?.compliance.expiredStaffRecords ?? 0) > 0 ? 'danger' : 'positive'} />
            <Metric label="Expiring staff records" value={data.overview?.compliance.expiringStaffRecordsNext30Days ?? 0} tone={(data.overview?.compliance.expiringStaffRecordsNext30Days ?? 0) > 0 ? 'warning' : 'positive'} hint="Next 30 days" />
            <Metric label="Licences expiring" value={data.overview?.compliance.expiringLicencesNext30Days ?? 0} tone={(data.overview?.compliance.expiringLicencesNext30Days ?? 0) > 0 ? 'warning' : 'positive'} hint="Next 30 days" />
          </div>

          <div className="report-panel">
            <h4>Operational compliance</h4>
            <Metric label="Open issues" value={data.summary?.issues?.open ?? 0} tone={(data.summary?.issues?.open ?? 0) > 0 ? 'warning' : 'positive'} />
            <Metric label="Critical issues" value={data.summary?.issues?.critical ?? 0} tone={(data.summary?.issues?.critical ?? 0) > 0 ? 'danger' : 'positive'} />
            <Metric label="Missing temperature readings today" value={data.overview?.compliance.missingTemperatureReadingsToday ?? 0} tone={(data.overview?.compliance.missingTemperatureReadingsToday ?? 0) > 0 ? 'warning' : 'positive'} />
            <Metric label="Out-of-range temperature assets" value={data.summary?.temperatures?.outOfRange ?? 0} tone={(data.summary?.temperatures?.outOfRange ?? 0) > 0 ? 'danger' : 'positive'} />
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderStockSection() {
    return (
      <SectionShell
        id="stock"
        title="Stock Reports"
        description="Catalogue health, venue stock status, low stock, and stocktake review"
      >
        <div className="report-section-stack">
          {stockMessage ? <p className="error-text">{stockMessage}</p> : null}
          <div className="stats-grid report-metric-grid">
            <StatCard label="Active catalogue items" value={data.overview?.stock.activeStockItems ?? data.stockSummary?.activeItems ?? 0} hint="Global catalogue" loading={loading} />
            <StatCard label="Low stock" value={data.overview?.stock.lowStockCount ?? data.stockSummary?.lowStockItems ?? 0} hint="Venue-aware rows" loading={loading} />
            <StatCard label="Out of stock" value={data.overview?.stock.outOfStockCount ?? 0} hint="Venue-aware rows" loading={loading} />
            <StatCard label="Ready for review" value={data.overview?.stock.stocktakesReadyForReview ?? 0} hint="Submitted stocktakes" loading={loading} />
          </div>

          <div className="stats-grid report-metric-grid">
            <StatCard label="COGS" value={formatCurrency(primeTotals?.cogsCents ?? 0)} hint={data.primeCost?.sources.cogs === 'missing' ? 'Supplier invoices not matched' : `${formatPercent(primeTotals?.cogsPercent)} of sales`} loading={loading} />
            <StatCard label="Prime cost" value={formatCurrency(primeTotals?.primeCostCents ?? 0)} hint={`${formatPercent(primeTotals?.primeCostPercent)} of sales`} loading={loading} />
            <StatCard label="Invoice COGS" value={formatCurrency(primeTotals?.invoiceCogsCents ?? 0)} hint="Matched supplier invoice lines" loading={loading} />
            <StatCard label="Wastage cost" value={formatCurrency(primeTotals?.wastageCents ?? 0)} hint="Recorded wastage impact" loading={loading} />
          </div>

          <div className="report-detail-grid">
            <div className="report-panel">
              <h4>Stock health</h4>
              <Metric label="Current stock value" value={formatCurrency(stockValueCents)} tone="info" />
              <Metric label={stockLowStockLabel} value={data.stockSummary?.lowStockItems ?? 0} tone={(data.stockSummary?.lowStockItems ?? 0) > 0 ? 'warning' : 'positive'} />
              <Metric label="Latest stocktake value" value={formatCurrency(data.stocktakes?.totalValueCents ?? 0)} tone="neutral" />
            </div>

            <div className="report-panel">
              <h4>Prime cost data quality</h4>
              <Metric label="Sales source" value={data.primeCost?.sources.sales.replace(/_/g, ' ') ?? 'missing'} tone={data.primeCost?.sources.sales === 'missing' ? 'warning' : 'positive'} />
              <Metric label="Wage source" value={data.primeCost?.sources.wages.replace(/_/g, ' ') ?? 'missing'} tone={data.primeCost?.sources.wages === 'missing' ? 'warning' : 'positive'} />
              <Metric label="COGS source" value={data.primeCost?.sources.cogs.replace(/_/g, ' ') ?? 'missing'} tone={data.primeCost?.sources.cogs === 'missing' ? 'warning' : 'positive'} />
              {(data.primeCost?.warnings ?? []).map((warning) => (
                <p key={warning} className="subtle">{warning}</p>
              ))}
            </div>
          </div>

          <div className="report-panel">
            <h4>Prime cost by venue</h4>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th>Sales</th>
                    <th>Wages</th>
                    <th>Wage %</th>
                    <th>COGS</th>
                    <th>COGS %</th>
                    <th>Prime cost</th>
                    <th>Prime %</th>
                    <th>Quality</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.primeCost?.venues ?? []).filter((row) => row.venue && row.venue !== 'Both').length ? (
                    (data.primeCost?.venues ?? []).filter((row) => row.venue && row.venue !== 'Both').map((row) => (
                      <tr key={row.venue}>
                        <td>{row.venue}</td>
                        <td>{formatCurrency(row.salesCents)}</td>
                        <td>{formatCurrency(row.wageCents)}</td>
                        <td>{formatPercent(row.wagePercent)}</td>
                        <td>{formatCurrency(row.cogsCents)}</td>
                        <td>{formatPercent(row.cogsPercent)}</td>
                        <td>{formatCurrency(row.primeCostCents)}</td>
                        <td>{formatPercent(row.primeCostPercent)}</td>
                        <td>{qualityLabel(row.sourceQuality)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9}>No wage, sales, or COGS data found for this week.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="report-detail-grid">
            <div className="report-panel">
              <h4>Stocktake variance attention</h4>
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Stocktake</th>
                      <th>Item</th>
                      <th>Venue</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.overview?.stock.highestVarianceLines.length ? (
                      data.overview.stock.highestVarianceLines.map((line, index) => (
                        <tr key={`${line.stocktakeId}:${line.itemName}:${index}`}>
                          <td>{line.stocktakeName}</td>
                          <td>{line.itemName}</td>
                          <td>{line.venue ?? 'Unassigned'}</td>
                          <td>{line.variance > 0 ? '+' : ''}{line.variance.toFixed(2)} {line.unit ?? ''}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4}>No submitted stocktake variances in this range.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="report-panel">
            <h4>Stock value by category</h4>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>{stockCategoryCountLabel}</th>
                    <th>{stockLowStockLabel}</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryValueRows.map((row) => (
                    <tr key={row.category}>
                      <td>{row.category}</td>
                      <td>{row.itemCount}</td>
                      <td>{row.lowStock}</td>
                      <td>{formatCurrency(row.valueCents)}</td>
                    </tr>
                  ))}
                  {!categoryValueRows.length ? (
                    <tr>
                      <td colSpan={4}>No stock values are available yet.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderMenuEngineeringSection() {
    const hasVenueSales = Boolean(data.actualSales?.entries.length);
    const hasItemSales = Boolean(data.itemSales?.entries.length);
    const menuProfit = data.menuProfitability;
    const menuRows = menuProfit?.rows ?? [];
    const mappedMenuRows = menuProfit?.totals.mappedRows ?? 0;
    const menuEstimatedCogs = menuProfit?.totals.estimatedCogsCents;
    const menuGrossProfit = menuProfit?.totals.grossProfitCents;
    const itemSalesMatched = data.itemSales?.matchedRecipeRows ?? 0;
    const itemSalesUnmatched = data.itemSales?.unmatchedRows ?? 0;
    const itemSalesQuantity = data.itemSales?.totalQuantity ?? 0;
    const hasRecipeSummary = Boolean(data.recipes && data.recipes.totalRecipes > 0);
    const menuCategoryOptions = [
      { label: 'All categories', value: '' },
      ...(menuProfit?.categories ?? []).map((category) => ({ label: category, value: category }))
    ];
    const menuVenueOptions = [
      { label: 'All venues', value: '' },
      ...(menuProfit?.venues ?? venues).map((venue) => ({ label: venue, value: venue }))
    ];
    const readinessRows = [
      {
        item: 'Imported item-level sales',
        status: hasItemSales ? (mappedMenuRows > 0 ? 'Ready' : 'Partly ready') : 'Missing',
        note: hasItemSales
          ? `${itemSalesQuantity.toLocaleString()} units imported across ${data.itemSales?.entries.length ?? 0} menu rows. ${mappedMenuRows} Square items have mapped recipe costs, ${menuProfit?.totals.unmappedRows ?? itemSalesUnmatched} need recipe mapping.`
          : 'Square item sales have not been imported for the selected week.'
      },
      {
        item: 'Recipe cost data',
        status: hasRecipeSummary ? 'Partly ready' : 'Missing',
        note: hasRecipeSummary
          ? `${data.recipes?.totalRecipes ?? 0} recipes are available from Stock.${hasItemSales ? ` ${itemSalesMatched} Square item rows are matched.` : ' Item matching still needs review.'}`
          : 'Create item recipes in Stock before margin analysis can run.'
      },
      {
        item: 'Selling price by item',
        status: hasItemSales ? 'Ready' : 'Missing',
        note: hasItemSales
          ? `${formatCurrency(data.itemSales?.totalNetSalesCents ?? 0)} net Square item sales imported for the selected week.`
          : 'No reliable item price source is wired into Reports yet.'
      },
      {
        item: 'Venue sales totals',
        status: hasVenueSales ? 'Ready' : 'Missing',
        note: hasVenueSales
          ? `${formatCurrency(data.actualSales?.totalSalesCents ?? 0)} imported for the selected week.`
          : 'Import weekly sales totals to compare venue trading before item analysis is available.'
      }
    ];
    const bucketRows = [
      {
        bucket: 'Stars',
        meaning: 'High sales and high contribution margin.',
        action: 'Keep visible and protect quality.'
      },
      {
        bucket: 'Plowhorses',
        meaning: 'High sales and low contribution margin.',
        action: 'Review pricing, portions, or prep cost.'
      },
      {
        bucket: 'Puzzles',
        meaning: 'Low sales and high contribution margin.',
        action: 'Train the team to suggest them or improve menu placement.'
      },
      {
        bucket: 'Dogs',
        meaning: 'Low sales and low contribution margin.',
        action: 'Replace, remove, or rework the recipe.'
      }
    ];

    return (
      <SectionShell
        id="menu-engineering"
        title="Menu Engineering"
        description="Shows whether the data is ready for COGS, margin, popularity, and menu action decisions"
      >
        <div className="report-section-stack">
          <div className="stats-grid report-metric-grid">
            <StatCard label="Sales source" value={hasItemSales ? 'Square item sales' : hasVenueSales ? 'Venue totals' : 'Missing'} hint={hasItemSales ? `${itemSalesMatched} recipe matches` : 'Waiting on item-level sales'} loading={loading} />
            <StatCard label="Recipes available" value={data.recipes?.totalRecipes ?? 0} hint="From Stock recipe costing" loading={loading} />
            <StatCard label="Menu COGS" value={menuEstimatedCogs === null || menuEstimatedCogs === undefined ? 'Incomplete' : formatCurrency(menuEstimatedCogs)} hint={menuEstimatedCogs === null || menuEstimatedCogs === undefined ? 'Missing mapped recipe costs' : `${formatPercent(menuProfit?.totals.foodCostPercent)} food cost`} loading={loading} />
            <StatCard label="Gross profit" value={menuGrossProfit === null || menuGrossProfit === undefined ? 'Incomplete' : formatCurrency(menuGrossProfit)} hint={hasItemSales ? `${menuProfit?.totals.unmappedRows ?? itemSalesUnmatched} unmapped rows` : 'Needs item sales, price, and recipe matches'} loading={loading} />
          </div>

          {/* Margin alerts — items below threshold flagged as action items */}
          {(() => {
            const threshold = 60; // food cost % threshold; >60% means margin <40%
            const flagged = menuRows.filter((row) =>
              row.foodCostPercent !== null && row.foodCostPercent !== undefined && row.foodCostPercent > threshold
            );
            if (flagged.length === 0) return null;
            const top = flagged.slice().sort((a, b) => (b.foodCostPercent ?? 0) - (a.foodCostPercent ?? 0)).slice(0, 8);
            const totalSales = flagged.reduce((sum, r) => sum + r.netSalesCents, 0);
            return (
              <Card
                title="Margin alerts"
                subtitle={`${flagged.length} item${flagged.length === 1 ? '' : 's'} above ${threshold}% food cost (i.e. under 40% margin) — ${formatCurrency(totalSales)} of net sales is currently at low margin. Re-price, re-cost, or swap a cheaper ingredient.`}
              >
                <div className="margin-alerts-list">
                  {top.map((row) => (
                    <div key={row.key} className="margin-alert-row">
                      <div className="margin-alert-main">
                        <strong>{row.squareItem}</strong>
                        <small>
                          {row.venue}{row.categoryName ? ` · ${row.categoryName}` : ''}
                          {' · '}
                          {row.quantitySold.toLocaleString()} sold · {formatCurrency(row.netSalesCents)} net
                        </small>
                      </div>
                      <div className="margin-alert-meta">
                        <Badge tone="danger">{row.foodCostPercent != null ? `${row.foodCostPercent.toFixed(0)}% food cost` : 'No cost'}</Badge>
                        {row.recipeCostCents != null ? <small>cost {formatCurrency(row.recipeCostCents)}</small> : null}
                      </div>
                    </div>
                  ))}
                  {flagged.length > top.length ? (
                    <p className="subtle" style={{ margin: 0 }}>
                      {flagged.length - top.length} more flagged items — see full menu profitability table below.
                    </p>
                  ) : null}
                </div>
              </Card>
            );
          })()}

          <Card title="Menu profitability" subtitle="Read-only Square item sales matched to Alma recipe costs. Rows without mappings or costs stay incomplete." padding="none">
            <div className="reports-filter-grid">
              <Select
                label="Square account"
                value={menuAccountKey}
                onChange={(event) => setMenuAccountKey(event.currentTarget.value as typeof menuAccountKey)}
                options={[
                  { label: 'All Square accounts', value: 'all' },
                  { label: 'Primary / St Alma', value: 'primary' },
                  { label: 'Secondary / Alma Avalon', value: 'secondary' }
                ]}
              />
              <Select label="Venue" value={menuVenue} onChange={(event) => setMenuVenue(event.currentTarget.value)} options={menuVenueOptions} />
              <Select label="Category" value={menuCategory} onChange={(event) => setMenuCategory(event.currentTarget.value)} options={menuCategoryOptions} />
              <Select
                label="Mapping"
                value={menuMappingStatus}
                onChange={(event) => setMenuMappingStatus(event.currentTarget.value as typeof menuMappingStatus)}
                options={[
                  { label: 'All rows', value: 'all' },
                  { label: 'Mapped', value: 'mapped' },
                  { label: 'Unmapped', value: 'unmapped' },
                  { label: 'Missing recipe', value: 'missing_recipe' },
                  { label: 'Missing cost', value: 'missing_cost' }
                ]}
              />
            </div>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Square item</th>
                    <th>Recipe</th>
                    <th>Venue</th>
                    <th>Qty sold</th>
                    <th>Sales</th>
                    <th>Recipe cost</th>
                    <th>COGS</th>
                    <th>Gross profit</th>
                    <th>Food cost %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {menuRows.length ? (
                    menuRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <strong>{row.squareItem}</strong>
                          <span className="subtle">{[row.variationName, row.categoryName, row.accountKey].filter(Boolean).join(' · ')}</span>
                        </td>
                        <td>{row.almaRecipeTitle ?? 'Not mapped'}</td>
                        <td>{row.venue}</td>
                        <td>{row.quantitySold.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td>{formatCurrency(row.netSalesCents)}</td>
                        <td>{row.recipeCostCents === null ? '—' : formatCurrency(row.recipeCostCents)}</td>
                        <td>{row.estimatedCogsCents === null ? '—' : formatCurrency(row.estimatedCogsCents)}</td>
                        <td>{row.grossProfitCents === null ? '—' : formatCurrency(row.grossProfitCents)}</td>
                        <td>{formatPercent(row.foodCostPercent)}</td>
                        <td><Badge tone={menuMappingTone(row.mappingStatus)}>{menuMappingLabel(row.mappingStatus)}</Badge></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={10}>No Square item-level sales found for this filter. Import Square item sales or widen the date/account filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {menuProfit?.warnings.length ? (
            <ActionPanel title="Menu profitability data quality" description="Expand to see why totals may be incomplete." count={menuProfit.warnings.length} tone="warning">
              {menuProfit.warnings.map((warning) => (
                <div key={warning} className="action-panel-row">
                  <span>
                    <strong>{warning}</strong>
                    <small>Reports will not estimate missing sales, recipe cost, or unmapped item COGS.</small>
                  </span>
                  <Badge tone="warning">Review</Badge>
                </div>
              ))}
            </ActionPanel>
          ) : null}

          <div className="report-detail-grid">
            <div className="report-panel">
              <h4>What can be checked now</h4>
              <Metric label="Venue sales imported" value={hasVenueSales ? 'Yes' : 'No'} tone={hasVenueSales ? 'positive' : 'warning'} />
              <Metric label="Recipe costs available" value={hasRecipeSummary ? 'Partial' : 'No'} tone={hasRecipeSummary ? 'info' : 'warning'} />
              <Metric
                label="Menu item sales"
                value={hasItemSales ? `${itemSalesQuantity.toLocaleString()} units` : 'Not connected'}
                tone={hasItemSales ? 'positive' : 'warning'}
                hint={hasItemSales ? `${data.itemSales?.entries.length ?? 0} Square item rows` : undefined}
              />
              <Metric
                label="Item price source"
                value={hasItemSales ? formatCurrency(data.itemSales?.totalNetSalesCents ?? 0) : 'Not connected'}
                tone={hasItemSales ? 'positive' : 'warning'}
                hint={hasItemSales ? 'Square order line net sales' : undefined}
              />
            </div>

            <div className="report-panel">
              <h4>Next data needed</h4>
              <p className="subtle">
                {hasItemSales
                  ? 'Square item sales are importing now. Review unmatched rows by aligning Square item names with Stock recipe names before using menu buckets for decisions.'
                  : 'To classify Stars, Plowhorses, Puzzles and Dogs, Reports needs item-level sales with units sold, revenue, venue, date range, menu category, and a recipe match from Stock.'}
              </p>
              <div className="reports-export-actions spacious">
                {sectionButton('stock', 'Review stock and recipe data')}
                {sectionButton('overview', 'Back to reports overview')}
              </div>
            </div>
          </div>

          <div className="report-panel">
            <h4>Bucket guide</h4>
            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Bucket</th>
                    <th>Meaning</th>
                    <th>Usual action</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketRows.map((row) => (
                    <tr key={row.bucket}>
                      <td>{row.bucket}</td>
                      <td>{row.meaning}</td>
                      <td>{row.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="subtle">
              {hasItemSales
                ? 'These buckets stay informational until recipe cost matches are reviewed for each Square item.'
                : 'These buckets stay informational until item-level sales, selling price, and recipe cost matches are available.'}
            </p>
          </div>

          <ActionPanel
            title="Data readiness"
            description="Expand to see each missing input and where to fix it."
            count={readinessRows.filter((row) => row.status !== 'Ready').length}
            tone={readinessRows.some((row) => row.status === 'Missing') ? 'warning' : 'info'}
            defaultOpen={!hasVenueSales || !hasRecipeSummary}
          >
            {readinessRows.map((row) => (
              <div key={row.item} className="action-panel-row">
                <span>
                  <strong>{row.item}</strong>
                  <small>{row.status} · {row.note}</small>
                </span>
                {row.item === 'Recipe cost data'
                  ? appButton(STOCK_WEB_URL, '/recipes', 'Open recipes')
                  : row.item === 'Venue sales totals'
                    ? sectionButton('exports', 'Open imports/exports')
                    : row.item === 'Imported item-level sales' && hasItemSales
                      ? sectionButton('stock', 'Review recipe matches')
                    : <Badge tone="muted">Action not available yet</Badge>}
              </div>
            ))}
          </ActionPanel>
        </div>
      </SectionShell>
    );
  }

  function renderReserveSection() {
    return (
      <SectionShell
        id="reserve"
        title="Reserve Reports"
        description="Bookings, covers, cancellations, no-shows, and guest mix"
      >
        <div className="stats-grid report-metric-grid">
          <StatCard label="Bookings today" value={data.overview?.reserve.bookingsToday ?? 0} hint={`${data.overview?.reserve.coversToday ?? 0} covers`} loading={loading} />
          <StatCard label="Upcoming bookings" value={data.overview?.reserve.upcomingBookings ?? 0} hint="Future reservations" loading={loading} />
          <StatCard label="Cancellations" value={data.overview?.reserve.cancellations ?? 0} hint={overviewWindowLabel} loading={loading} />
          <StatCard label="No shows" value={data.overview?.reserve.noShows ?? 0} hint={overviewWindowLabel} loading={loading} />
          <StatCard label="New guests" value={data.overview?.reserve.newGuests ?? 0} hint={overviewWindowLabel} loading={loading} />
          <StatCard label="Covers today" value={data.overview?.reserve.coversToday ?? 0} hint="Booked covers" loading={loading} />
        </div>
      </SectionShell>
    );
  }

  function renderMarketingSection() {
    return (
      <SectionShell
        id="marketing"
        title="Marketing Reports"
        description="Guest CRM reach, consent, campaigns, lapsed guests, and simulated sends"
      >
        <div className="stats-grid report-metric-grid">
          <StatCard label="Total guests" value={data.overview?.marketing.totalGuests ?? 0} hint="Reserve and Marketing guest profiles" loading={loading} />
          <StatCard label="Opted-in guests" value={data.overview?.marketing.optedInGuests ?? 0} hint="Email marketing consent" loading={loading} />
          <StatCard label="Unsubscribed guests" value={data.overview?.marketing.unsubscribedGuests ?? 0} hint="Excluded from email campaigns" loading={loading} />
          <StatCard label="Repeat visitors" value={data.overview?.marketing.repeatVisitors ?? 0} hint="Behavioural segment" loading={loading} />
          <StatCard label="Campaign drafts" value={data.overview?.marketing.campaignDrafts ?? 0} hint="Email campaigns in draft" loading={loading} />
          <StatCard label="Simulated sends" value={data.overview?.marketing.simulatedSends ?? 0} hint="No external email sent" loading={loading} />
        </div>
      </SectionShell>
    );
  }

  function renderContentSection() {
    return (
      <SectionShell
        id="content"
        title="Content Reports"
        description="Scheduled posts, approvals, simulated publish attempts, and social setup readiness"
      >
        <div className="stats-grid report-metric-grid">
          <StatCard label="Scheduled posts" value={data.overview?.content.scheduledPostsThisWeek ?? 0} hint="This week" loading={loading} />
          <StatCard label="Needs approval" value={data.overview?.content.postsNeedingApproval ?? 0} hint="Review queue" loading={loading} />
          <StatCard label="Failed simulations" value={data.overview?.content.failedSimulatedPublishAttempts ?? 0} hint="No live social posting" loading={loading} />
          <StatCard label="Setup required accounts" value={data.overview?.content.setupRequiredSocialAccounts ?? 0} hint="Facebook, Instagram, TikTok" loading={loading} />
          <StatCard label="Assets uploaded" value={data.overview?.content.assetsUploaded ?? 0} hint="Content library" loading={loading} />
        </div>
      </SectionShell>
    );
  }

  function renderGiftCardsSection() {
    return (
      <SectionShell
        id="gift-cards"
        title="Gift Card Reports"
        description="Pending gift card orders, pending value, fulfilment, and setup state"
      >
        <div className="report-detail-grid">
          <ActionPanel
            title="Gift card order actions"
            description="Expand to open the operational Gift Cards page."
            count={data.overview?.giftCards.pendingOrders ?? 0}
            tone={(data.overview?.giftCards.pendingOrders ?? 0) > 0 ? 'warning' : 'positive'}
            empty={
              <div className="action-panel-row">
                <span>
                  <strong>No pending gift card orders</strong>
                  <small>Open the orders page to review fulfilled, expired, or email issue rows.</small>
                </span>
                {appButton(GIFTCARDS_WEB_URL, '/orders', 'View orders')}
              </div>
            }
          >
            {(data.overview?.giftCards.pendingOrders ?? 0) > 0 ? (
              <div className="action-panel-row">
                <span>
                  <strong>Pending gift card orders</strong>
                  <small>{data.overview?.giftCards.pendingOrders ?? 0} order{(data.overview?.giftCards.pendingOrders ?? 0) === 1 ? '' : 's'} · {formatCurrency(data.overview?.giftCards.totalPendingAmountCents ?? 0)} pending value.</small>
                </span>
                {appButton(GIFTCARDS_WEB_URL, '/orders', 'Open orders')}
              </div>
            ) : null}
            <div className="action-panel-row">
              <span>
                <strong>Fulfilled orders</strong>
                <small>{data.overview?.giftCards.fulfilledOrders ?? 0} fulfilled in this report range.</small>
              </span>
              {appButton(GIFTCARDS_WEB_URL, '/orders', 'View orders')}
            </div>
          </ActionPanel>
          <div className="report-panel">
            <h4>Payment readiness</h4>
            <p className="subtle">Gift card checkout setup and payment provider configuration are managed in Admin. Reports stays read-only and never exposes payment secrets.</p>
            {sectionButton('exports', 'Open exports')}
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderExportsSection() {
    return (
      <SectionShell
        id="exports"
        title="Exports"
        description="Read-only downloads for management reporting"
      >
        <div className="report-detail-grid">
          <div className="report-panel">
            <h4>Available exports</h4>
            <div className="reports-export-actions spacious">
              <Button type="button" size="sm" variant="secondary" onClick={exportOverviewCsv}>
                Download overview CSV
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={exportPerformanceCsv} disabled={!venuePerformanceRows.length}>
                Download performance CSV
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={exportWagesCsv} disabled={!wageRows.length}>
                Download wage CSV
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void copyWeeklySummary()}>
                Copy weekly summary
              </Button>
              {exportMessage ? <span className="subtle">{exportMessage}</span> : null}
            </div>
          </div>

          <div className="report-panel">
            <h4>Export notes</h4>
            <p className="subtle">Reports exports do not change production data. Sales imports, Xero export marking, website menu publishing, provider setup, and report configuration belong in Admin or the relevant operational app.</p>
            <Metric label="Overview range" value={overviewWindowLabel} tone="neutral" />
            <Metric label="Weekly payroll range" value={weekWindowLabel} tone="neutral" />
          </div>
        </div>
      </SectionShell>
    );
  }

  function renderActiveReportSection() {
    switch (activeSection) {
      case 'sales':
        return renderSalesSection();
      case 'staff':
        return renderStaffSection();
      case 'compliance':
        return renderComplianceSection();
      case 'stock':
        return renderStockSection();
      case 'menu-engineering':
        return renderMenuEngineeringSection();
      case 'reserve':
        return renderReserveSection();
      case 'marketing':
        return renderMarketingSection();
      case 'content':
        return renderContentSection();
      case 'gift-cards':
        return renderGiftCardsSection();
      case 'exports':
        return renderExportsSection();
      case 'overview':
      default:
        return renderOverviewSection();
    }
  }

  return (
    <AppShell
      brand={<ProductLogo appId="reports" size="md" />}
      sidebar={<SidebarNav activeSection={activeSection} onSectionChange={selectReportSection} />}
      topBar={
        <TopBar
          title="Reports"
          subtitle="Read-only operating reports"
          right={
            <>
              <SuiteAppSwitcher currentApp="reports" apps={suiteApps} variant="topbar" />
              <SuiteCommsWidget
                appId="REPORTS"
                api={staffApi}
                venue={user.venue}
                userName={`${user.firstName} ${user.lastName}`}
                canAnnounce={user.role !== 'STAFF'}
              />
              <SuiteNotificationsWidget api={staffApi} currentApp="reports" />
              <ReportsUserMenu user={user} onLogout={onLogout} />
            </>
          }
        />
      }
    >
      <div className="page-stack reports-page">
        <section className="hero">
          <div className="hero-text">
            <p className="page-header-eyebrow">Reports command</p>
            <h1>Alma Group Reports</h1>
            <p>{activeReport.description} Reports are read-only and scoped to permitted venues.</p>
            <div className="hero-meta">
              <span className="hero-meta-dot" aria-hidden="true" />
              <span>{activeReport.label}</span>
              <span aria-hidden="true">·</span>
              <span>{loading ? 'Loading live report data…' : `Signed in as ${user.firstName}`}</span>
            </div>
          </div>
          <div className="hero-actions">
            <Button type="button" onClick={() => void load()} disabled={loading}>
              Refresh
            </Button>
            <Button type="button" variant="secondary" onClick={exportOverviewCsv}>
              Export overview
            </Button>
          </div>
        </section>

        <Card title="Report controls" subtitle="Choose the reporting range without changing production data.">
          <div className="reports-week-controls">
            <Select
              label="Overview range"
              value={overviewRange}
              onChange={(event) => setOverviewRange(event.currentTarget.value as '7' | '30' | '90')}
              options={[
                { label: 'Last 7 days', value: '7' },
                { label: 'Last 30 days', value: '30' },
                { label: 'Last 90 days', value: '90' }
              ]}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => moveWeek(-7)}>
              Prev week
            </Button>
            <Input
              label="Week"
              type="date"
              value={selectedWeekStart}
              onChange={(event) => setSelectedWeekStart(isoDate(startOfWeek(new Date(`${event.currentTarget.value}T00:00:00`))))}
            />
            <Button type="button" variant="secondary" size="sm" onClick={() => moveWeek(7)}>
              Next week
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedWeekStart(isoDate(startOfWeek(new Date())))}>
              This week
            </Button>
          </div>
        </Card>

        {message ? <p className="error-text">{message}</p> : null}
        {loading ? <Spinner label={`Loading ${activeReport.label.toLowerCase()} reports`} /> : null}
        {renderActiveReportSection()}
      </div>
    </AppShell>
  );

}

export function App() {
  const auth = useReportsAuth();

  if (auth.loading) {
    return (
      <div className="login-page">
        <Spinner label="Checking session" />
      </div>
    );
  }

  if (!auth.user) {
    return <LoginScreen onLogin={auth.login} />;
  }

  return <ReportsDashboard user={auth.user} onLogout={auth.logout} />;
}
