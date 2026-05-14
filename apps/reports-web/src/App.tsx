import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AuthUser,
  RecipesSummary,
  ReportsOverviewPayload,
  RosterForecastSnapshot,
  RosterShift,
  SalesActualSummary,
  StaffProfile,
  StaffTipsSummary,
  StockItemsPayload,
  StockItemsSummary,
  StocktakesSummary,
  Timesheet
} from '@alma/shared';
import {
  AppShell,
  Badge,
  Button,
  Card,
  ChartIcon,
  DocumentIcon,
  Input,
  PageHeader,
  ProductLogo,
  Select,
  Spinner,
  StatCard,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteCommsWidget,
  TopBar
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
import { withSuiteAppLinks } from './config/suiteLinks';
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

type WebsiteMenuPayload = {
  updatedAt: string;
  message?: string;
  venues: Array<{
    title: string;
    sections: Array<{
      title: string;
      items: Array<{ name: string; price?: string; tag?: string }>;
    }>;
    drinks: Array<{
      title: string;
      items: Array<{ name: string; price?: string; tag?: string }>;
    }>;
  }>;
};

type WebsiteMenuPublishResult = {
  ok: boolean;
  dryRun: boolean;
  venueCount?: number;
  itemCount?: number;
  branch?: string;
  commitUrl?: string;
  fileUrl?: string;
  message?: string;
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

const suiteApps = withSuiteAppLinks(SUITE_APPS);
const REPORTS_FORECAST_STORAGE_KEY = 'alma.reports.forecast.v1';
const WEBSITE_MENU_STORAGE_KEY = 'alma.reports.websiteMenuDraft.v1';

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

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseSalesImportRows(text: string, defaultSource: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('Paste a CSV with date, venue and sales columns.');
  const header = splitCsvLine(lines[0] ?? '').map((cell) => cell.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const findColumn = (names: string[]) => names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
  const dateIndex = findColumn(['date', 'servicedate', 'businessdate', 'businessday', 'tradingdate']);
  const venueIndex = findColumn(['venue', 'location', 'site', 'locationname', 'storename', 'outlet']);
  const salesIndex = findColumn(['sales', 'netsales', 'grosssales', 'amount', 'total', 'salestotal', 'nettotal', 'grossamount']);
  const idIndex = findColumn(['id', 'externalid', 'transactionid', 'reportid', 'rowid']);
  if (dateIndex < 0 || venueIndex < 0 || salesIndex < 0) {
    throw new Error('CSV needs date, venue and sales columns.');
  }

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const serviceDate = cells[dateIndex] ?? '';
    const venue = cells[venueIndex] ?? '';
    const salesCents = parseMoneyCents(cells[salesIndex] ?? '');
    const externalId = cells[idIndex] || `${defaultSource}:${venue}:${serviceDate}:${index}`;
    return { serviceDate, venue, salesCents, externalId };
  }).filter((row) => row.serviceDate && row.venue && row.salesCents > 0);
}

function parsePercent(value: string, fallback = 32) {
  const numeric = Number(value.replace(/[^0-9.]/g, ''));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function centsInput(cents: number) {
  return cents > 0 ? String(Math.round(cents / 100)) : '';
}

function defaultWebsiteMenuPayload(): WebsiteMenuPayload {
  return {
    updatedAt: new Date().toISOString(),
    venues: [
      {
        title: 'Alma Avalon',
        sections: [
          {
            title: 'To start',
            items: [
              { name: 'Guacamole, corn chips, wakame', price: '16', tag: 'Start here' }
            ]
          }
        ],
        drinks: [
          {
            title: 'Margaritas',
            items: [{ name: 'Classic margarita' }]
          }
        ]
      },
      {
        title: 'St Alma',
        sections: [
          {
            title: 'To start',
            items: [
              { name: 'Guacamole, salsa macha, tostadas', price: '16', tag: 'Start here' }
            ]
          }
        ],
        drinks: [
          {
            title: 'Margaritas',
            items: [{ name: 'Tommy’s margarita', tag: 'Popular' }]
          }
        ]
      }
    ]
  };
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

function SidebarNav() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeHash, setActiveHash] = useState(() => window.location.hash || '#overview');
  const navItems = [
    { href: '#overview', label: 'Overview', icon: <ChartIcon /> },
    { href: '#report-staff', label: 'Staff', icon: <ChartIcon /> },
    { href: '#report-compliance', label: 'Compliance', icon: <DocumentIcon /> },
    { href: '#report-stock', label: 'Stock', icon: <DocumentIcon /> },
    { href: '#report-reserve', label: 'Reserve', icon: <ChartIcon /> },
    { href: '#report-marketing', label: 'Marketing', icon: <DocumentIcon /> },
    { href: '#report-content', label: 'Content', icon: <DocumentIcon /> },
    { href: '#report-giftcards', label: 'Gift Cards', icon: <DocumentIcon /> },
    { href: '#forecast', label: 'Forecast', icon: <ChartIcon /> },
    { href: '#wages', label: 'Wages', icon: <ChartIcon /> },
    { href: '#cogs', label: 'COGS', icon: <DocumentIcon /> },
    { href: '#website-menu', label: 'Exports', icon: <DocumentIcon /> }
  ];
  const active = navItems.find((item) => item.href === activeHash) ?? navItems[0]!;

  useEffect(() => {
    const handleHashChange = () => {
      setActiveHash(window.location.hash || '#overview');
      setMobileMenuOpen(false);
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
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
        {navItems.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className={item.href === activeHash ? 'active' : undefined}
              onClick={() => {
                setActiveHash(item.href);
                setMobileMenuOpen(false);
              }}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function ReportsDashboard({ user, onLogout }: { user: AuthUser; onLogout: () => Promise<void> }) {
  const [selectedWeekStart, setSelectedWeekStart] = useState(() => isoDate(startOfWeek(new Date())));
  const weekStart = useMemo(() => startOfWeek(new Date(`${selectedWeekStart}T00:00:00`)), [selectedWeekStart]);
  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const [overviewRange, setOverviewRange] = useState<'7' | '30' | '90'>('30');
  const [data, setData] = useState<ReportsData>({
    overview: null,
    summary: null,
    staff: [],
    timesheets: [],
    roster: [],
    rosterForecastSnapshots: [],
    actualSales: null,
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
  const [websiteMenuDraft, setWebsiteMenuDraft] = useState(() =>
    JSON.stringify(loadJsonDraft<WebsiteMenuPayload>(WEBSITE_MENU_STORAGE_KEY, defaultWebsiteMenuPayload()), null, 2)
  );
  const [websiteMenuMessage, setWebsiteMenuMessage] = useState<string | null>(null);
  const [salesImportText, setSalesImportText] = useState('date,venue,sales\n2026-05-04,Alma Avalon,12500.00');
  const [salesImportSource, setSalesImportSource] = useState('manual');
  const [salesImportMessage, setSalesImportMessage] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setStockMessage(null);
    try {
      const [overview, summary, staff, timesheets, roster, rosterForecastSnapshots, actualSales, tips] = await Promise.all([
        staffApi<ReportsOverviewPayload>(`/api/reports/overview?range=${overviewRange}`),
        staffApi<SuiteSummary>('/api/summary'),
        staffApi<StaffProfile[]>('/api/staff'),
        staffApi<Timesheet[]>(`/api/staff/timesheets?start=${isoDate(weekStart)}&end=${isoDate(weekEnd)}&status=all`),
        staffApi<RosterShift[]>(`/api/staff/roster?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<RosterForecastSnapshot[]>(`/api/staff/roster/forecast-snapshots?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
        staffApi<SalesActualSummary>(`/api/reports/sales?start=${weekStart.toISOString()}&end=${weekEnd.toISOString()}`),
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

      setData({ overview, summary, staff, timesheets, roster, rosterForecastSnapshots, actualSales, tips, stockItems, stockSummary, stocktakes, recipes });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, [overviewRange, weekEnd, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    window.localStorage.setItem(REPORTS_FORECAST_STORAGE_KEY, JSON.stringify(forecastInputs));
  }, [forecastInputs]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WEBSITE_MENU_STORAGE_KEY, JSON.stringify(JSON.parse(websiteMenuDraft)));
    } catch {
      window.localStorage.setItem(WEBSITE_MENU_STORAGE_KEY, websiteMenuDraft);
    }
  }, [websiteMenuDraft]);

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

  function parseWebsiteMenuDraft() {
    const parsed = JSON.parse(websiteMenuDraft) as WebsiteMenuPayload;
    if (!Array.isArray(parsed.venues) || parsed.venues.length === 0) {
      throw new Error('Menu JSON needs at least one venue in venues[].');
    }
    for (const venue of parsed.venues) {
      if (!venue.title || !Array.isArray(venue.sections) || !Array.isArray(venue.drinks)) {
        throw new Error('Each venue needs title, sections[] and drinks[].');
      }
    }
    return parsed;
  }

  async function validateWebsiteMenuPayload() {
    setWebsiteMenuMessage(null);
    try {
      const parsed = parseWebsiteMenuDraft();
      const result = await staffApi<WebsiteMenuPublishResult>('/api/website/menu/validate', {
        method: 'POST',
        body: JSON.stringify({ ...parsed, dryRun: true })
      });
      setWebsiteMenuMessage(`Menu validated: ${result.venueCount ?? parsed.venues.length} venues and ${result.itemCount ?? 0} menu items.`);
    } catch (error) {
      setWebsiteMenuMessage(error instanceof Error ? error.message : 'Menu validation failed.');
    }
  }

  async function publishWebsiteMenuPayload() {
    setWebsiteMenuMessage(null);
    try {
      const parsed = parseWebsiteMenuDraft();
      if (!window.confirm('Publish this menu update to the Alma Group website repo? Vercel will deploy after the website repo accepts the commit.')) {
        return;
      }
      const result = await staffApi<WebsiteMenuPublishResult>('/api/website/menu/publish', {
        method: 'POST',
        body: JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() })
      });
      setWebsiteMenuMessage(
        result.commitUrl
          ? `Website menu update committed to ${result.branch ?? 'the website branch'}. ${result.commitUrl}`
          : 'Website menu update accepted.'
      );
    } catch (error) {
      setWebsiteMenuMessage(error instanceof Error ? error.message : 'Could not publish website menu.');
    }
  }

  async function copyWebsiteMenuPayload() {
    setWebsiteMenuMessage(null);
    try {
      const parsed = parseWebsiteMenuDraft();
      const text = JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() }, null, 2);
      await navigator.clipboard.writeText(text);
      setWebsiteMenuMessage('Website menu JSON copied.');
    } catch (error) {
      setWebsiteMenuMessage(error instanceof Error ? error.message : 'Menu JSON is invalid.');
    }
  }

  function downloadWebsiteMenuPayload() {
    setWebsiteMenuMessage(null);
    try {
      const parsed = parseWebsiteMenuDraft();
      downloadTextFile(
        `alma-website-menu-${isoDate(new Date())}.json`,
        JSON.stringify({ ...parsed, updatedAt: new Date().toISOString() }, null, 2)
      );
      setWebsiteMenuMessage('Website menu JSON downloaded.');
    } catch (error) {
      setWebsiteMenuMessage(error instanceof Error ? error.message : 'Menu JSON is invalid.');
    }
  }

  async function importActualSales() {
    setSalesImportMessage(null);
    try {
      const rows = parseSalesImportRows(salesImportText, salesImportSource.trim() || 'manual');
      if (!rows.length) {
        setSalesImportMessage('No valid sales rows found.');
        return;
      }
      const result = await staffApi<{ imported: number }>('/api/reports/sales/import', {
        method: 'POST',
        body: JSON.stringify({
          source: salesImportSource.trim() || 'manual',
          rows
        })
      });
      setSalesImportMessage(`Imported ${result.imported} sales row${result.imported === 1 ? '' : 's'}.`);
      await load();
    } catch (error) {
      setSalesImportMessage(error instanceof Error ? error.message : 'Could not import sales.');
    }
  }

  async function deleteActualSalesEntry(id: string) {
    if (!window.confirm('Delete this actual sales row?')) return;
    setSalesImportMessage(null);
    try {
      await staffApi(`/api/reports/sales/${id}`, { method: 'DELETE' });
      setSalesImportMessage('Sales row deleted.');
      await load();
    } catch (error) {
      setSalesImportMessage(error instanceof Error ? error.message : 'Could not delete sales row.');
    }
  }

  async function clearActualSalesForWeek() {
    if (!window.confirm(`Clear imported actual sales for ${isoDate(weekStart)} to ${isoDate(addDays(weekEnd, -1))}?`)) return;
    setSalesImportMessage(null);
    try {
      const result = await staffApi<{ deleted: number }>('/api/reports/sales/clear', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString()
        })
      });
      setSalesImportMessage(`Deleted ${result.deleted} sales row${result.deleted === 1 ? '' : 's'}.`);
      await load();
    } catch (error) {
      setSalesImportMessage(error instanceof Error ? error.message : 'Could not clear sales rows.');
    }
  }

  function downloadSalesTemplate() {
    downloadTextFile(
      `alma-actual-sales-template-${isoDate(weekStart)}.csv`,
      [
        'date,venue,sales',
        `${isoDate(weekStart)},Alma Avalon,0`,
        `${isoDate(weekStart)},St Alma,0`
      ].join('\n')
    );
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

  async function exportApprovedXeroTimesheets() {
    const approvedXeroCount = data.timesheets.filter((timesheet) => timesheet.status === 'APPROVED' && timesheet.paymentMethod !== 'CASH').length;
    if (!approvedXeroCount) {
      setExportMessage('No approved Xero timesheets to export.');
      return;
    }
    if (!window.confirm(`Export and mark ${approvedXeroCount} approved Xero timesheet${approvedXeroCount === 1 ? '' : 's'} as exported?`)) {
      return;
    }
    setExportMessage(null);
    try {
      const result = await staffApi<{ count: number; markedExported: boolean; exportBatchId: string; csv: string }>('/api/staff/timesheets/export/xero', {
        method: 'POST',
        body: JSON.stringify({
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          markExported: true
        })
      });
      if (!result.count) {
        setExportMessage('No approved Xero timesheets were returned by the API.');
        return;
      }
      downloadTextFile(`alma-xero-timesheets-${isoDate(weekStart)}-${result.exportBatchId}.csv`, result.csv);
      setExportMessage(`Exported ${result.count} Xero timesheet${result.count === 1 ? '' : 's'} and marked them exported.`);
      await load();
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : 'Could not export Xero timesheets.');
    }
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
      `Tips pool: ${data.tips ? formatCurrency(data.tips.tipPoolCents) : 'not loaded'}`,
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

  return (
    <AppShell
      brand={<ProductLogo appId="reports" size="md" />}
      sidebar={<SidebarNav />}
      topBar={
        <TopBar
          title="Reports"
          subtitle="Wages, stock value, and operating cost signals"
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
              <Button size="sm" variant="secondary" onClick={() => void onLogout()}>
                Sign out
              </Button>
            </>
          }
        />
      }
    >
      <div className="page-stack">
        <PageHeader
          eyebrow="ALMA Reports"
          title="Operating reports"
          description={`Signed in as ${user.firstName}. This app keeps management reporting separate from Staff admin screens.`}
          actions={
            <div className="reports-week-controls">
              <Select
                label="Overview"
                value={overviewRange}
                onChange={(event) => setOverviewRange(event.currentTarget.value as '7' | '30' | '90')}
                options={[
                  { label: 'Last 7 days', value: '7' },
                  { label: 'Last 30 days', value: '30' },
                  { label: 'Last 90 days', value: '90' }
                ]}
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => moveWeek(-7)}>
                Prev
              </Button>
              <Input
                label="Week"
                type="date"
                value={selectedWeekStart}
                onChange={(event) => setSelectedWeekStart(isoDate(startOfWeek(new Date(`${event.currentTarget.value}T00:00:00`))))}
              />
              <Button type="button" variant="secondary" size="sm" onClick={() => moveWeek(7)}>
                Next
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedWeekStart(isoDate(startOfWeek(new Date())))}>
                This week
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
                Refresh
              </Button>
            </div>
          }
        />

        {message ? <p className="error-text">{message}</p> : null}
        {loading ? <Spinner label="Loading reports" /> : null}

        <div className="stats-grid">
          <StatCard label="Forecast sales" value={formatCurrency(forecastTotals.salesCents)} hint={`${roundHours(forecastTotals.recommendedHours)} recommended`} loading={loading} />
          <StatCard label="Roster cost" value={formatCurrency(forecastTotals.plannedCostCents)} hint={`${roundHours(forecastTotals.plannedHours)} planned`} loading={loading} />
          <StatCard label="Weekly wages" value={formatCurrency(wageTotals.projectedCostCents)} hint={roundHours(wageTotals.hours)} loading={loading} />
          <StatCard label="Stock value" value={formatCurrency(stockValueCents)} hint={`${data.stockSummary?.activeItems ?? 0} active items`} loading={loading} />
        </div>

        <section id="overview" className="reports-section">
          <Card
            title="Management overview"
            subtitle={`Read-only suite signals for the last ${data.overview?.rangeDays ?? overviewRange} days. Manager views are limited to their venue.`}
            action={
              <Button type="button" size="sm" variant="secondary" onClick={exportOverviewCsv}>
                Export CSV
              </Button>
            }
          >
            <div className="report-overview-grid">
              <div id="report-staff" className="report-panel">
                <h4>Staff</h4>
                <div className="metric-row">
                  <span>Active staff</span>
                  <Badge tone="info">{data.overview?.staff.totalActiveStaff ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Pending leave</span>
                  <Badge tone={(data.overview?.staff.pendingLeaveCount ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.staff.pendingLeaveCount ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Approved leave next 30 days</span>
                  <Badge tone="neutral">{data.overview?.staff.approvedLeaveNext30Days ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Missing or pending compliance</span>
                  <Badge tone={(data.overview?.staff.missingRequiredCompliance ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.staff.missingRequiredCompliance ?? 0}
                  </Badge>
                </div>
              </div>

              <div id="report-compliance" className="report-panel">
                <h4>Compliance</h4>
                <div className="metric-row">
                  <span>Pending records</span>
                  <Badge tone={(data.overview?.compliance.pendingStaffRecords ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.compliance.pendingStaffRecords ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Expired records</span>
                  <Badge tone={(data.overview?.compliance.expiredStaffRecords ?? 0) > 0 ? 'danger' : 'positive'}>
                    {data.overview?.compliance.expiredStaffRecords ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Temp readings missing today</span>
                  <Badge tone={(data.overview?.compliance.missingTemperatureReadingsToday ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.compliance.missingTemperatureReadingsToday ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Licences expiring next 30 days</span>
                  <Badge tone={(data.overview?.compliance.expiringLicencesNext30Days ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.compliance.expiringLicencesNext30Days ?? 0}
                  </Badge>
                </div>
              </div>

              <div id="report-stock" className="report-panel">
                <h4>Stock</h4>
                <div className="metric-row">
                  <span>Catalogue items</span>
                  <Badge tone="info">{data.overview?.stock.activeStockItems ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Low stock venue rows</span>
                  <Badge tone={(data.overview?.stock.lowStockCount ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.stock.lowStockCount ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Out of stock venue rows</span>
                  <Badge tone={(data.overview?.stock.outOfStockCount ?? 0) > 0 ? 'danger' : 'positive'}>
                    {data.overview?.stock.outOfStockCount ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Stocktakes ready for review</span>
                  <Badge tone={(data.overview?.stock.stocktakesReadyForReview ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.stock.stocktakesReadyForReview ?? 0}
                  </Badge>
                </div>
              </div>

              <div id="report-reserve" className="report-panel">
                <h4>Reserve</h4>
                <div className="metric-row">
                  <span>Bookings today</span>
                  <Badge tone="info">{data.overview?.reserve.bookingsToday ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Covers today</span>
                  <Badge tone="neutral">{data.overview?.reserve.coversToday ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Upcoming bookings</span>
                  <Badge tone={(data.overview?.reserve.upcomingBookings ?? 0) > 0 ? 'positive' : 'neutral'}>
                    {data.overview?.reserve.upcomingBookings ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Cancellations / no-shows</span>
                  <Badge tone={(data.overview?.reserve.cancellations ?? 0) + (data.overview?.reserve.noShows ?? 0) > 0 ? 'warning' : 'positive'}>
                    {(data.overview?.reserve.cancellations ?? 0) + (data.overview?.reserve.noShows ?? 0)}
                  </Badge>
                </div>
              </div>

              <div id="report-marketing" className="report-panel">
                <h4>Marketing</h4>
                <div className="metric-row">
                  <span>Total guests</span>
                  <Badge tone="info">{data.overview?.marketing.totalGuests ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Opted in guests</span>
                  <Badge tone="positive">{data.overview?.marketing.optedInGuests ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Campaign drafts</span>
                  <Badge tone={(data.overview?.marketing.campaignDrafts ?? 0) > 0 ? 'warning' : 'neutral'}>
                    {data.overview?.marketing.campaignDrafts ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Simulated sends</span>
                  <Badge tone="neutral">{data.overview?.marketing.simulatedSends ?? 0}</Badge>
                </div>
              </div>

              <div id="report-content" className="report-panel">
                <h4>Content</h4>
                <div className="metric-row">
                  <span>Scheduled this week</span>
                  <Badge tone="info">{data.overview?.content.scheduledPostsThisWeek ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Needs approval</span>
                  <Badge tone={(data.overview?.content.postsNeedingApproval ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.content.postsNeedingApproval ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Failed simulated publishes</span>
                  <Badge tone={(data.overview?.content.failedSimulatedPublishAttempts ?? 0) > 0 ? 'danger' : 'positive'}>
                    {data.overview?.content.failedSimulatedPublishAttempts ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Setup required accounts</span>
                  <Badge tone={(data.overview?.content.setupRequiredSocialAccounts ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.content.setupRequiredSocialAccounts ?? 0}
                  </Badge>
                </div>
              </div>

              <div id="report-giftcards" className="report-panel">
                <h4>Gift cards</h4>
                <div className="metric-row">
                  <span>Pending orders</span>
                  <Badge tone={(data.overview?.giftCards.pendingOrders ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.overview?.giftCards.pendingOrders ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Pending amount</span>
                  <Badge tone="neutral">{formatCurrency(data.overview?.giftCards.totalPendingAmountCents ?? 0)}</Badge>
                </div>
                <div className="metric-row">
                  <span>Fulfilled orders</span>
                  <Badge tone="info">{data.overview?.giftCards.fulfilledOrders ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>New guests</span>
                  <Badge tone="neutral">{data.overview?.reserve.newGuests ?? 0}</Badge>
                </div>
              </div>
            </div>

            <div className="report-overview-grid report-overview-grid-wide">
              <div className="report-panel">
                <h4>Recent staff management events</h4>
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
                          <td colSpan={4}>No recent management events in this range.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

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
          </Card>
        </section>

        <section id="forecast" className="reports-section">
          <Card
            title="Roster forecast"
            subtitle={`${isoDate(weekStart)} to ${isoDate(addDays(weekEnd, -1))}. Starts from previous-year sales by month and trading day, then lets managers adjust before publishing.`}
            action={
              <Button size="sm" variant="secondary" onClick={() => applyHistoricalForecast()} disabled={!forecastRows.some((row) => row.historicalSalesCents > 0)}>
                Use historical forecast
              </Button>
            }
            padding="none"
          >
            <div className="forecast-grid">
              {forecastRows.map((row) => (
                <div key={row.venue} className="forecast-card">
                  <div className="forecast-card-header">
                    <span>
                      <strong>{row.venue}</strong>
                      <small>{row.forecastSalesCents ? `${row.targetWagePercent}% wage target` : 'Enter sales forecast'}</small>
                    </span>
                    <Badge tone={row.costGapCents >= 0 ? 'positive' : 'warning'}>
                      {row.costGapCents >= 0 ? `${formatCurrency(row.costGapCents)} under` : `${formatCurrency(Math.abs(row.costGapCents))} over`}
                    </Badge>
                  </div>

                  <div className="form-grid two">
                    <Input
                      label="Forecast sales"
                      value={forecastInputs[row.venue]?.sales ?? ''}
                      onChange={(event) => updateForecastInput(row.venue, { sales: event.currentTarget.value })}
                      placeholder={centsInput(row.historicalSalesCents) || '32000'}
                    />
                    <Input
                      label="Target wage %"
                      value={forecastInputs[row.venue]?.targetWagePercent ?? '32'}
                      onChange={(event) => updateForecastInput(row.venue, { targetWagePercent: event.currentTarget.value })}
                      placeholder="32"
                    />
                  </div>

                  <div className="forecast-history-row">
                    <span>
                      Previous-year guide
                      {row.historicalSource ? <small>{row.historicalSource} historical sales for this week pattern</small> : null}
                    </span>
                    <div className="forecast-history-actions">
                      <Badge tone={row.historicalSalesCents > 0 ? 'info' : 'neutral'}>
                        {row.historicalSalesCents > 0 ? formatCurrency(row.historicalSalesCents) : 'No match'}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => applyHistoricalForecast(row.venue)} disabled={row.historicalSalesCents <= 0}>
                        Apply
                      </Button>
                    </div>
                  </div>

                  <div className="forecast-metrics">
                    <div>
                      <span>Wage budget</span>
                      <strong>{formatCurrency(row.wageBudgetCents)}</strong>
                    </div>
                    <div>
                      <span>Planned cost</span>
                      <strong>{formatCurrency(row.plannedCostCents)}</strong>
                    </div>
                    <div>
                      <span>Recommended hours</span>
                      <strong>{roundHours(row.recommendedHours)}</strong>
                    </div>
                    <div>
                      <span>Planned hours</span>
                      <strong>{roundHours(row.plannedHours)}</strong>
                    </div>
                  </div>

                  <table className="report-table forecast-table">
                    <thead>
                      <tr>
                        <th>Area</th>
                        <th>Planned</th>
                        <th>Recommended</th>
                      </tr>
                    </thead>
                    <tbody>
                      {row.areaRows.map((areaRow) => (
                        <tr key={areaRow.area}>
                          <td>{areaRow.area}</td>
                          <td>{roundHours(areaRow.plannedHours)}</td>
                          <td>{roundHours(areaRow.recommendedHours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="published-forecast-panel">
              <div className="published-forecast-header">
                <span>
                  <strong>Published roster forecast</strong>
                  <small>Snapshot saved when the manager publishes the roster.</small>
                </span>
                <Badge tone={data.rosterForecastSnapshots.length ? 'info' : 'neutral'}>
                  {data.rosterForecastSnapshots.length ? `${data.rosterForecastSnapshots.length} saved` : 'Not published yet'}
                </Badge>
              </div>
              {data.rosterForecastSnapshots.length ? (
                <>
                  <div className="forecast-metrics">
                    <div>
                      <span>Published sales</span>
                      <strong>{formatCurrency(publishedForecastTotals.salesCents)}</strong>
                    </div>
                    <div>
                      <span>Published wage budget</span>
                      <strong>{formatCurrency(publishedForecastTotals.budgetCents)}</strong>
                    </div>
                    <div>
                      <span>Published roster cost</span>
                      <strong>{formatCurrency(publishedForecastTotals.rosterCostCents)}</strong>
                    </div>
                    <div>
                      <span>Published hours</span>
                      <strong>{roundHours(publishedForecastTotals.plannedHours)}</strong>
                    </div>
                  </div>
                  <table className="report-table forecast-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        <th>Source</th>
                        <th>Sales</th>
                        <th>Budget</th>
                        <th>Roster cost</th>
                        <th>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rosterForecastSnapshots.map((snapshot) => (
                        <tr key={snapshot.id}>
                          <td>{snapshot.venue || 'All venues'}</td>
                          <td>{snapshot.source || 'Forecast'}</td>
                          <td>{formatCurrency(snapshot.forecastSalesCents)}</td>
                          <td>{formatCurrency(snapshot.wageBudgetCents)}</td>
                          <td>{formatCurrency(snapshot.rosterCostCents)}</td>
                          <td>{roundHours(snapshot.plannedHours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <p className="subtle">No published forecast snapshot yet. Publish the week from Staff roster to lock the forecast used for this roster.</p>
              )}
            </div>
            <div className="published-forecast-panel">
              <div className="published-forecast-header">
                <span>
                  <strong>Forecast vs actual</strong>
                  <small>Uses imported actual sales and submitted or approved timesheets for the same week.</small>
                </span>
                <Badge tone={actualSalesCents > 0 ? 'info' : 'neutral'}>
                  {actualSalesCents > 0 ? formatCurrency(actualSalesCents) : 'Import sales'}
                </Badge>
              </div>
              <div className="forecast-metrics">
                <div>
                  <span>Sales variance</span>
                  <strong>{actualSalesCents > 0 ? formatCurrency(forecastSalesVarianceCents) : 'No sales'}</strong>
                </div>
                <div>
                  <span>Planned vs actual wages</span>
                  <strong>{publishedForecastTotals.rosterCostCents > 0 ? formatCurrency(plannedVsActualWageCents) : 'No snapshot'}</strong>
                </div>
                <div>
                  <span>Actual wage %</span>
                  <strong>{actualWagePercent ? `${actualWagePercent.toFixed(1)}%` : 'No sales'}</strong>
                </div>
                <div>
                  <span>Target wage %</span>
                  <strong>{targetWagePercent ? `${targetWagePercent.toFixed(1)}%` : 'No snapshot'}</strong>
                </div>
              </div>
              <div className="actual-sales-import">
                <div className="form-grid two">
                  <Input label="Sales source" value={salesImportSource} onChange={(event) => setSalesImportSource(event.currentTarget.value)} placeholder="square" />
                  <Input label="Expected columns" readOnly value="date, venue, sales" />
                </div>
                <textarea
                  aria-label="Actual sales CSV"
                  value={salesImportText}
                  onChange={(event) => setSalesImportText(event.currentTarget.value)}
                  spellCheck={false}
                />
                <div className="website-menu-actions">
                  <Button type="button" size="sm" onClick={() => void importActualSales()}>
                    Import actual sales
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={downloadSalesTemplate}>
                    Download template
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => void clearActualSalesForWeek()} disabled={!data.actualSales?.entries.length}>
                    Clear week
                  </Button>
                  {salesImportMessage ? <span className="subtle">{salesImportMessage}</span> : null}
                </div>
                <div className="reports-export-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={exportPerformanceCsv} disabled={!venuePerformanceRows.length}>
                    Export performance CSV
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={exportWagesCsv} disabled={!wageRows.length}>
                    Export wage CSV
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void copyWeeklySummary()}>
                    Copy summary
                  </Button>
                  {exportMessage ? <span className="subtle">{exportMessage}</span> : null}
                </div>
              </div>
              {data.actualSales?.byVenue.length ? (
                <table className="report-table forecast-table">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Actual sales</th>
                      <th>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.actualSales.byVenue.map((row) => (
                      <tr key={row.venue}>
                        <td>{row.venue}</td>
                        <td>{formatCurrency(row.salesCents)}</td>
                        <td>{row.days}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              {data.actualSales?.entries.length ? (
                <div className="table-scroll">
                  <table className="report-table forecast-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Venue</th>
                        <th>Sales</th>
                        <th>Source</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.actualSales.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td>{isoDate(new Date(entry.serviceDate))}</td>
                          <td>{entry.venue}</td>
                          <td>{formatCurrency(entry.salesCents)}</td>
                          <td>{entry.source}</td>
                          <td>
                            <Button type="button" size="sm" variant="danger" onClick={() => void deleteActualSalesEntry(entry.id)}>
                              Delete
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="table-scroll">
                <table className="report-table venue-performance-table">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Forecast sales</th>
                      <th>Actual sales</th>
                      <th>Sales variance</th>
                      <th>Planned wages</th>
                      <th>Actual wages</th>
                      <th>Wage variance</th>
                      <th>Target %</th>
                      <th>Actual %</th>
                      <th>Hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {venuePerformanceRows.map((row) => (
                      <tr key={row.venue}>
                        <td>{row.venue}</td>
                        <td>{row.forecastSalesCents ? formatCurrency(row.forecastSalesCents) : '-'}</td>
                        <td>{row.actualSalesCents ? formatCurrency(row.actualSalesCents) : '-'}</td>
                        <td className={row.salesVarianceCents >= 0 ? 'is-positive' : 'is-warning'}>
                          {row.actualSalesCents || row.forecastSalesCents ? formatCurrency(row.salesVarianceCents) : '-'}
                        </td>
                        <td>{row.plannedWageCents ? formatCurrency(row.plannedWageCents) : '-'}</td>
                        <td>{row.actualWageCents ? formatCurrency(row.actualWageCents) : '-'}</td>
                        <td className={row.wageVarianceCents <= 0 ? 'is-positive' : 'is-warning'}>
                          {row.actualWageCents || row.plannedWageCents ? formatCurrency(row.wageVarianceCents) : '-'}
                        </td>
                        <td>{row.targetPercent ? `${row.targetPercent.toFixed(1)}%` : '-'}</td>
                        <td className={row.targetPercent && row.actualPercent > row.targetPercent ? 'is-warning' : 'is-positive'}>
                          {row.actualPercent ? `${row.actualPercent.toFixed(1)}%` : '-'}
                        </td>
                        <td>{roundHours(row.actualHours || row.plannedHours)}</td>
                      </tr>
                    ))}
                    {!venuePerformanceRows.length ? (
                      <tr>
                        <td colSpan={10}>Publish a roster forecast and import sales to compare venue performance.</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
        </section>

        <section id="wages" className="reports-section">
          <Card
            title="Wage report"
            subtitle={`${isoDate(weekStart)} to ${isoDate(addDays(weekEnd, -1))}. Uses submitted timesheets and staff pay rates.`}
            padding="none"
          >
            <div className="report-split">
              <div className="report-panel">
                <h4>By venue</h4>
                {wageByVenue.length ? (
                  wageByVenue.map((venue) => (
                    <div key={venue.venue} className="metric-row">
                      <span>
                        <strong>{venue.venue}</strong>
                        <span className="subtle">{roundHours(venue.hours)}</span>
                      </span>
                      <Badge tone="info">{formatCurrency(venue.costCents)}</Badge>
                    </div>
                  ))
                ) : (
                  <p className="subtle">No timesheets found for this week.</p>
                )}
              </div>

              <div className="report-panel">
                <h4>Payroll readiness</h4>
                <div className="metric-row">
                  <span>Timesheets awaiting approval</span>
                  <Badge tone="warning">{data.timesheets.filter((item) => item.status === 'SUBMITTED').length}</Badge>
                </div>
                <div className="metric-row">
                  <span>Approved or exported</span>
                  <Badge tone="positive">
                    {data.timesheets.filter((item) => item.status === 'APPROVED' || item.status === 'EXPORTED').length}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Staff missing pay rate</span>
                  <Badge tone="danger">{activeStaff.filter((member) => !member.payRateCents && !member.trainingPayRateCents).length}</Badge>
                </div>
                <div className="metric-row">
                  <span>Weekly tips pool</span>
                  <Badge tone={(data.tips?.tipPoolCents ?? 0) > 0 ? 'positive' : 'neutral'}>{formatCurrency(data.tips?.tipPoolCents ?? 0)}</Badge>
                </div>
                <div className="reports-export-actions">
                  <Button type="button" size="sm" variant="secondary" onClick={exportWagesCsv} disabled={!wageRows.length}>
                    Export payroll CSV
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void exportApprovedXeroTimesheets()}
                    disabled={!data.timesheets.some((item) => item.status === 'APPROVED' && item.paymentMethod !== 'CASH')}
                  >
                    Export Xero timesheets
                  </Button>
                  {exportMessage ? <span className="subtle">{exportMessage}</span> : null}
                </div>
              </div>
            </div>

            <div className="table-scroll">
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Venue</th>
                    <th>Role</th>
                    <th>Hours</th>
                    <th>Xero</th>
                    <th>Cash</th>
                    <th>Rate</th>
                    <th>Projected</th>
                    <th>Approved</th>
                    <th>Tips</th>
                    <th>Payroll total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {wageRows.map((row) => (
                    <tr key={row.staffProfileId}>
                      <td>{row.name}</td>
                      <td>{row.venue}</td>
                      <td>{row.roleTitle}</td>
                      <td>{roundHours(row.hours)}</td>
                      <td>{roundHours(row.xeroHours)}</td>
                      <td>{roundHours(row.cashHours)}</td>
                      <td>{formatCurrency(row.rateCents)}</td>
                      <td>{formatCurrency(row.projectedCostCents)}</td>
                      <td>{formatCurrency(row.approvedCostCents)}</td>
                      <td>{formatCurrency(row.tipsCents)}</td>
                      <td>{formatCurrency(row.approvedCostCents + row.tipsCents)}</td>
                      <td>
                        {row.cashPaidMissingCount > 0 ? (
                          <Badge tone="warning">{row.cashPaidMissingCount} cash pending</Badge>
                        ) : row.approvedCount > 0 ? (
                          <Badge tone="info">{row.approvedCount} ready</Badge>
                        ) : row.exportedCount > 0 ? (
                          <Badge tone="positive">Exported</Badge>
                        ) : (
                          <Badge tone="neutral">No approved hours</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!wageRows.length ? (
                    <tr>
                      <td colSpan={12}>No wage rows yet. Submit or approve timesheets to populate this report.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        <section id="cogs" className="reports-section">
          <Card
            title="COGS signals"
            subtitle="Stock value and recipe cost indicators. Venue stock rows are used where configured; true COGS will still need POS sales mapped into the ledger."
            padding="none"
          >
            {stockMessage ? <p className="error-text report-error">{stockMessage}</p> : null}
            <div className="report-split">
              <div className="report-panel">
                <h4>Stock cost base</h4>
                <div className="metric-row">
                  <span>Current stock value</span>
                  <Badge tone="info">{formatCurrency(stockValueCents)}</Badge>
                </div>
                <div className="metric-row">
                  <span>{stockLowStockLabel}</span>
                  <Badge tone={(data.stockSummary?.lowStockItems ?? 0) > 0 ? 'warning' : 'positive'}>
                    {data.stockSummary?.lowStockItems ?? 0}
                  </Badge>
                </div>
                <div className="metric-row">
                  <span>Latest stocktake value</span>
                  <Badge tone="neutral">{formatCurrency(data.stocktakes?.totalValueCents ?? 0)}</Badge>
                </div>
              </div>

              <div className="report-panel">
                <h4>Recipe cost base</h4>
                <div className="metric-row">
                  <span>Recipes costed</span>
                  <Badge tone="info">{data.recipes?.totalRecipes ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Recipe lines</span>
                  <Badge tone="neutral">{data.recipes?.totalLines ?? 0}</Badge>
                </div>
                <div className="metric-row">
                  <span>Average recipe cost</span>
                  <Badge tone="info">{formatMoney(data.recipes?.averageEstimatedCost ?? 0)}</Badge>
                </div>
              </div>
            </div>

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
          </Card>
        </section>

        <section id="website-menu" className="reports-section">
          <Card
            title="Website menu publisher"
            subtitle="Manager-safe menu updates for the Alma Group website. The API validates the payload and only commits when GitHub publishing is configured."
          >
            <div className="website-menu-grid">
              <div className="website-menu-editor">
                <Input
                  label="Fallback script"
                  readOnly
                  value="pnpm website:menu:update -- --file alma-website-menu.json"
                />
                <textarea
                  aria-label="Website menu JSON"
                  value={websiteMenuDraft}
                  onChange={(event) => setWebsiteMenuDraft(event.currentTarget.value)}
                  spellCheck={false}
                />
              </div>
              <div className="website-menu-guide">
                <strong>How this works</strong>
                <span>1. Edit or paste the current menu JSON here.</span>
                <span>2. Validate it before publishing.</span>
                <span>3. Publish commits the website menu data through the protected API.</span>
                <span>If publishing is not configured, the API returns a clear setup error and nothing is changed.</span>
                <div className="website-menu-actions">
                  <Button type="button" variant="secondary" onClick={() => void validateWebsiteMenuPayload()}>
                    Validate
                  </Button>
                  <Button type="button" onClick={() => void publishWebsiteMenuPayload()}>
                    Publish to website
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void copyWebsiteMenuPayload()}>
                    Copy JSON
                  </Button>
                  <Button type="button" variant="secondary" onClick={downloadWebsiteMenuPayload}>
                    Download JSON
                  </Button>
                </div>
                {websiteMenuMessage ? (
                  <p className={websiteMenuMessage.includes('invalid') || websiteMenuMessage.includes('needs') ? 'error-text' : 'subtle'}>
                    {websiteMenuMessage}
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </section>
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
