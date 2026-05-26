import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  AlmaAppIcon,
  ALMA_APPS,
  BookIcon,
  CapIcon,
  ChartIcon,
  CommsGlyph,
  DocumentIcon,
  GearIcon,
  PeopleIcon,
  ProduceIcon,
  SearchIcon,
  ShieldIcon,
  WarningIcon,
  type AlmaAppDefinition,
  type AlmaAppIconKey
} from './AlmaAppIcon';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

/**
 * Compatibility wrapper around the new ALMA app icon system.
 *
 * Every legacy import (ProductLogo, SuiteLogo, SuiteAppSwitcher, SUITE_APPS,
 * suiteApp, SuiteApps and the SuiteAppId / SuiteAppIdentity / SuiteAppStatus
 * types) keeps working from this file so existing apps and login pages
 * compile without changes.
 */

export type SuiteAppId =
  | 'compliance'
  | 'stock'
  | 'staff'
  | 'reserve'
  | 'marketing' | 'comms'
  | 'giftcards'
  | 'learning'
  | 'reports'
  | 'policies'
  | 'incidents'
  | 'audits'
  | 'training'
  | 'settings'
  // legacy ids still referenced by older configs
  | 'academy'
  | 'finance'
  | 'ops';

export type SuiteAppStatus = 'active' | 'disabled';

export type SuiteAppIdentity = {
  id: SuiteAppId;
  label: string;
  shortLabel: string;
  description: string;
  status: SuiteAppStatus;
  href?: string;
  fromColor: string;
  toColor: string;
  iconKey: AlmaAppIconKey;
  icon: ReactNode;
};

type SuiteAppSeed = {
  id: SuiteAppId;
  label: string;
  shortLabel: string;
  description: string;
  status: SuiteAppStatus;
  fromColor: string;
  toColor: string;
  iconKey: AlmaAppIconKey;
};

const ICON_FACTORY: Record<AlmaAppIconKey, () => ReactNode> = {
  book: () => <BookIcon />,
  chart: () => <ChartIcon />,
  document: () => <DocumentIcon />,
  shield: () => <ShieldIcon />,
  warning: () => <WarningIcon />,
  search: () => <SearchIcon />,
  cap: () => <CapIcon />,
  produce: () => <ProduceIcon />,
  people: () => <PeopleIcon />,
  gear: () => <GearIcon />,
  comms: () => <CommsGlyph />
};

const LEGACY_APP_SEEDS: SuiteAppSeed[] = [];

const SUITE_APP_SEEDS: SuiteAppSeed[] = ALMA_APPS.map((app): SuiteAppSeed => ({
  id: app.id as SuiteAppId,
  label: titleCase(app.label),
  shortLabel: app.label,
  description: descriptionFor(app.id),
  status:
    app.id === 'compliance' ||
    app.id === 'stock' ||
    app.id === 'staff' ||
    app.id === 'reserve' ||
    app.id === 'marketing' ||
    app.id === 'comms' ||
    app.id === 'giftcards' ||
    app.id === 'reports' ||
    app.id === 'training' ||
    app.id === 'settings'
      ? 'active'
      : 'disabled',
  fromColor: app.from,
  toColor: app.to,
  iconKey: app.iconKey
}));

const LEGACY_APPS: SuiteAppIdentity[] = LEGACY_APP_SEEDS.map((seed) => ({
  ...seed,
  icon: ICON_FACTORY[seed.iconKey]()
}));

// Each app's hosted URL — used by the home page tiles and any cross-app links.
const SUITE_APP_HOSTS: Partial<Record<SuiteAppId, string>> = {
  compliance: 'https://alma-compliance.web.app',
  stock: 'https://alma-stock-v18.web.app',
  staff: 'https://alma-staff.web.app',
  reserve: 'https://alma-reserve.web.app',
  reports: 'https://alma-reports.web.app',
  marketing: 'https://alma-marketing.web.app',
  giftcards: 'https://alma-giftcards.web.app/redeem',
  comms: 'https://alma-comms.web.app',
  settings: 'https://alma-suite-admin.web.app'
};

const assignHref = (app: SuiteAppIdentity): SuiteAppIdentity => {
  const host = SUITE_APP_HOSTS[app.id];
  return host ? { ...app, href: host } : app;
};

const ALL_APPS: SuiteAppIdentity[] = [
  ...SUITE_APP_SEEDS.map((seed) => assignHref({
    ...seed,
    icon: ICON_FACTORY[seed.iconKey]()
  })),
  ...LEGACY_APPS.map(assignHref)
];

export const SUITE_APPS: SuiteAppIdentity[] = ALL_APPS.filter((app) =>
  ALMA_APPS.some((moduleApp) => moduleApp.id === app.id)
);

/** Legacy alias — same data as `SUITE_APPS`. */
export const suiteApp: SuiteAppIdentity[] = SUITE_APPS;

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

// Functional grouping for the editorial switcher — promotes from a flat list
// to grouped-by-area once we cross the GROUP_THRESHOLD (10) apps.
type SuiteArea = 'service' | 'operations' | 'growth' | 'system';

const SUITE_AREA_BY_APP: Partial<Record<SuiteAppId, SuiteArea>> = {
  reserve: 'service',
  comms: 'service',
  stock: 'operations',
  staff: 'operations',
  compliance: 'operations',
  audits: 'operations',
  reports: 'operations',
  marketing: 'growth',
  giftcards: 'growth',
  training: 'growth',
  academy: 'growth',
  settings: 'system',
  ops: 'system',
  finance: 'system',
  policies: 'operations',
  incidents: 'operations',
  learning: 'growth'
};

const SUITE_AREA_ORDER: { id: SuiteArea; label: string }[] = [
  { id: 'service', label: 'Service floor' },
  { id: 'operations', label: 'Operations' },
  { id: 'growth', label: 'Growth' },
  { id: 'system', label: 'System' }
];

const SUITE_SHORT_LABEL: Partial<Record<SuiteAppId, string>> = {
  reserve: 'Bookings',
  comms: 'Messages',
  stock: 'Inventory',
  staff: 'People & rosters',
  compliance: 'Audits & logs',
  reports: 'Performance',
  marketing: 'Campaigns',
  giftcards: 'Issue & redeem',
  settings: 'Settings',
  training: 'Academy'
};

const SUITE_GROUP_THRESHOLD = 10;

function descriptionFor(id: string) {
  switch (id) {
    case 'compliance':
      return 'Food safety, licences, incidents, audits, and maintenance.';
    case 'stock':
      return 'Inventory, suppliers, counts, orders, and wastage.';
    case 'reports':
      return 'Dashboards, exports, and operating insights.';
    case 'staff':
      return 'Team records, onboarding, roles, roster access, and app access.';
    case 'reserve':
      return 'Reservations, guests, table diary, waitlist, and covers forecast.';
    case 'marketing':
      return 'Guest contacts, segments, campaign drafts, and send-ready lists.';
    case 'comms':
      return 'Messages, handovers, alerts, and operational follow-ups.';
    case 'giftcards':
      return 'Gift card sales, balances, redemptions, and Stripe checkout.';
    case 'policies':
      return 'Policies now live inside Compliance.';
    case 'incidents':
      return 'Incidents now live inside Compliance.';
    case 'audits':
      return 'Audits, checks, and compliance review cycles.';
    case 'training':
      return 'Academy modules, staff training levels, and pay progression.';
    case 'settings':
      return 'Admin settings, venues, integrations, and suite controls.';
    default:
      return 'Alma app module.';
  }
}

function appColorStyle(app: SuiteAppIdentity): CSSProperties {
  return {
    '--suite-app-from': app.fromColor,
    '--suite-app-to': app.toColor
  } as CSSProperties;
}

function getSuiteApp(appId: SuiteAppId): SuiteAppIdentity {
  return ALL_APPS.find((app) => app.id === appId) ?? SUITE_APPS[0]!;
}

type ProductLogoProps = {
  appId?: SuiteAppId;
  size?: 'sm' | 'md' | 'lg';
  /** Kept for compatibility with older mark-only placements. */
  markOnly?: boolean;
  showBrandMark?: boolean;
  className?: string;
};

const PRODUCT_LOGO_SIZE: Record<
  NonNullable<ProductLogoProps['size']>,
  { mark: number; title: number; module: number; gap: number; radius: number }
> = {
  sm: { mark: 36, title: 18, module: 11, gap: 10, radius: 9 },
  md: { mark: 44, title: 22, module: 13, gap: 12, radius: 11 },
  lg: { mark: 50, title: 25, module: 14, gap: 14, radius: 13 }
};

/**
 * Product logo — horizontal lockup used for page headers and login screens.
 * The app switcher below still uses the square product tiles.
 */
export function ProductLogo({
  appId = 'compliance',
  size = 'md',
  markOnly = false,
  showBrandMark = true,
  className
}: ProductLogoProps) {
  const app = getSuiteApp(appId);
  const logoSize = PRODUCT_LOGO_SIZE[size];
  const titleColor = 'var(--color-text, #111827)';
  const moduleColor = app.id === 'stock' ? '#145f51' : app.fromColor;

  return (
    <a
      href="https://alma-home.web.app"
      className={className ? `product-logo-lockup ${className}` : 'product-logo-lockup'}
      title="Back to Alma Suite home"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: logoSize.gap,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif',
        lineHeight: 1,
        color: titleColor,
        textDecoration: 'none'
      }}
    >
      <AlmaAppIcon
        label={app.label.toUpperCase()}
        colorFrom={app.fromColor}
        colorTo={app.toColor}
        icon={app.icon}
        size={logoSize.mark}
        variant="compact"
        className="product-logo-mark"
        showBrandMark={showBrandMark}
      />

      {markOnly ? null : (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span
            style={{
              fontSize: logoSize.title,
              fontWeight: 700,
              letterSpacing: '0',
              color: titleColor,
              whiteSpace: 'nowrap'
            }}
          >
            ALMA <span style={{ fontWeight: 500 }}>Suites</span>
          </span>
          <span
            style={{
              fontSize: logoSize.module,
              fontWeight: 800,
              letterSpacing: '0.14em',
              paddingLeft: '0.14em',
              textTransform: 'uppercase',
              color: moduleColor,
              whiteSpace: 'nowrap'
            }}
          >
            {app.label}
          </span>
        </span>
      )}
    </a>
  );
}

/** Generic Suites logo — neutral charcoal tile with the ALMA mark. */
export function SuiteLogo({
  size = 'md',
  className
}: Omit<ProductLogoProps, 'appId'>) {
  const tileSize = PRODUCT_LOGO_SIZE[size].mark;
  return (
    <AlmaAppIcon
      label="APPS"
      colorFrom="#2F343A"
      colorTo="#1F2429"
      size={tileSize}
      className={className}
    />
  );
}

type SuiteAppSwitcherProps = {
  currentApp?: SuiteAppId;
  apps?: SuiteAppIdentity[];
  variant?: 'login' | 'sidebar' | 'topbar';
  switcherHref?: string;
};

export function SuiteAppSwitcher({
  currentApp,
  apps = SUITE_APPS,
  variant = 'login',
  switcherHref = '/apps'
}: SuiteAppSwitcherProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isSidebar = variant === 'sidebar';
  const isTopbar = variant === 'topbar';
  const current = apps.find((app) => app.id === currentApp);
  const popoverId = `${currentApp ?? 'suite'}-app-switcher-popover`;
  const className = [
    'suite-switcher',
    isSidebar ? 'suite-switcher--sidebar' : '',
    isTopbar ? 'suite-switcher--topbar' : ''
  ]
    .filter(Boolean)
    .join(' ');
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  useDismissibleLayer(layerRef, mobileOpen, closeMobile, `${currentApp ?? 'suite'}-app-switcher`);

  const openWithHandoff = useCallback((href: string) => {
    const handoff = (globalThis as typeof globalThis & {
      almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
    }).almaCreateSuiteHandoffUrl;

    if (!handoff) {
      window.location.assign(href);
      return;
    }

    void handoff(href).then((handoffHref) => {
      window.location.assign(handoffHref);
    }).catch(() => {
      window.location.assign(href);
    });
  }, []);

  const grid = (
    <div className="suite-app-grid">
      {apps.map((app) => {
        const isCurrent = app.id === currentApp;
        const hasHref = Boolean(app.href);
        const isAvailable = app.status === 'active' && hasHref;
        const tileClassName = [
          'suite-app-tile',
          isCurrent ? 'is-current' : '',
          app.status === 'active' ? '' : 'is-disabled'
        ]
          .filter(Boolean)
          .join(' ');

        const content = (
          <>
            <span className="suite-app-mark" aria-hidden="true">
              <AlmaAppIcon
                label={app.label.toUpperCase()}
                colorFrom={app.fromColor}
                colorTo={app.toColor}
                icon={app.icon}
                size={isSidebar || isTopbar ? 32 : 50}
                featureScale={0.68}
                variant="compact"
                showBrandMark={false}
              />
            </span>
            <span className="suite-app-label">{app.label}</span>
            <span className="suite-app-tooltip" role="tooltip">
              <strong>Alma {app.label}</strong>
              <span>{app.description}</span>
              <em>
                {isCurrent ? 'Current app' : isAvailable ? 'Open app' : 'Coming soon'}
              </em>
            </span>
          </>
        );

        return hasHref ? (
          <a
            key={app.id}
            className={tileClassName}
            href={app.href}
            style={appColorStyle(app)}
            onClick={(event) => {
              if (app.id === currentApp) return;
              event.preventDefault();
              closeMobile();
              openWithHandoff(app.href!);
            }}
            aria-label={
              isAvailable
                ? `Open Alma ${app.label}`
                : `View Alma ${app.label} login page`
            }
          >
            {content}
          </a>
        ) : (
          <span
            key={app.id}
            className={tileClassName}
            style={appColorStyle(app)}
            aria-label={`Alma ${app.label} coming soon`}
          >
            {content}
          </span>
        );
      })}
    </div>
  );

  if (isTopbar) {
    return (
      <SuiteEditorialSwitcher
        layerRef={layerRef}
        className={className}
        popoverId={popoverId}
        switcherHref={switcherHref}
        mobileOpen={mobileOpen}
        setMobileOpen={setMobileOpen}
        closeMobile={closeMobile}
        apps={apps}
        current={current}
        currentApp={currentApp}
        openWithHandoff={openWithHandoff}
        appColorStyle={appColorStyle}
      />
    );
  }

  return (
    <nav
      className={className}
      aria-label="Alma apps"
    >
      {grid}
    </nav>
  );
}

// Editorial app switcher — the redesigned topbar popover.
// Flat list with type-to-filter; promotes to area-grouped layout once the suite
// crosses SUITE_GROUP_THRESHOLD. Color chip per row, italic Cormorant
// descriptor, "Here now" pill on the current app, keyboard nav.
type SuiteEditorialSwitcherProps = {
  layerRef: React.MutableRefObject<HTMLDivElement | null>;
  className: string;
  popoverId: string;
  switcherHref: string;
  mobileOpen: boolean;
  setMobileOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
  closeMobile: () => void;
  apps: SuiteAppIdentity[];
  current: SuiteAppIdentity | undefined;
  currentApp: SuiteAppId | undefined;
  openWithHandoff: (href: string) => void;
  appColorStyle: (app: SuiteAppIdentity) => CSSProperties;
};

function SuiteEditorialSwitcher({
  layerRef,
  className,
  popoverId,
  switcherHref,
  mobileOpen,
  setMobileOpen,
  closeMobile,
  apps,
  current,
  currentApp,
  openWithHandoff,
  appColorStyle
}: SuiteEditorialSwitcherProps) {
  const [query, setQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const grouped = apps.length >= SUITE_GROUP_THRESHOLD;

  const otherApps = useMemo(
    () => apps.filter((app) => app.id !== currentApp),
    [apps, currentApp]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return otherApps;
    return otherApps.filter((app) =>
      app.label.toLowerCase().includes(needle) ||
      app.description.toLowerCase().includes(needle) ||
      (SUITE_SHORT_LABEL[app.id] ?? '').toLowerCase().includes(needle)
    );
  }, [otherApps, query]);

  const searching = query.trim().length > 0;
  const showGrouped = grouped && !searching;

  const groups = useMemo(() => {
    if (!showGrouped) return [];
    return SUITE_AREA_ORDER
      .map((area) => ({
        ...area,
        apps: filtered.filter((app) => SUITE_AREA_BY_APP[app.id] === area.id)
      }))
      .filter((group) => group.apps.length > 0);
  }, [filtered, showGrouped]);

  // Reset focus whenever the result set changes
  useEffect(() => {
    setFocusIndex(0);
  }, [query, mobileOpen]);

  // When keyboard nav moves focus past the visible area, scroll it into view.
  // Skip when focus is 0 (start of list) so the header stays visible.
  useEffect(() => {
    if (!mobileOpen || !popoverRef.current) return;
    const row = popoverRef.current.querySelector<HTMLElement>('.suite-switch-row.is-focused');
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex, mobileOpen]);

  // Autofocus the search field when the popover opens
  useEffect(() => {
    if (mobileOpen) {
      window.requestAnimationFrame(() => searchRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [mobileOpen]);

  function activate(app: SuiteAppIdentity) {
    if (!app.href || app.id === currentApp || app.status !== 'active') return;
    closeMobile();
    openWithHandoff(app.href);
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setFocusIndex((index) => Math.min(index + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setFocusIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[focusIndex];
      if (target) activate(target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query) {
        setQuery('');
      } else {
        closeMobile();
      }
    }
  }

  return (
    <div ref={layerRef} className={`${className} ${mobileOpen ? 'is-open' : ''}`}>
      <button
        type="button"
        className="suite-switch-apps-button"
        aria-label="Switch Alma apps"
        aria-expanded={mobileOpen}
        aria-controls={popoverId}
        style={current ? appColorStyle(current) : undefined}
        onClick={() => setMobileOpen((open) => !open)}
      >
        <span className="suite-switcher-current-mark" aria-hidden="true">
          {current ? (
            <AlmaAppIcon
              label={current.label.toUpperCase()}
              colorFrom={current.fromColor}
              colorTo={current.toColor}
              icon={current.icon}
              size={28}
              featureScale={0.68}
              variant="compact"
              showBrandMark={false}
            />
          ) : null}
        </span>
        <span className="suite-switcher-current-copy">
          <span>Switch apps</span>
          {current ? <strong>{current.label}</strong> : null}
        </span>
        <span className="suite-switcher-chevron" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false">
            <path d="M5 7.5 10 12.5 15 7.5" />
          </svg>
        </span>
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        className="suite-switcher-popover suite-switcher-popover--list"
        role="dialog"
        aria-label="Switch Alma apps"
        aria-hidden={!mobileOpen}
      >
        <div className="suite-switch-list-head">
          <div>
            <span className="suite-switch-eyebrow">Alma Suite</span>
            <strong>Open another app</strong>
          </div>
          <span className="suite-switch-eyebrow suite-switch-eyebrow--muted">
            {apps.length} apps
          </span>
        </div>

        <div className="suite-switch-search">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16" y1="16" x2="21" y2="21" strokeLinecap="round" />
          </svg>
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKey}
            placeholder={`Search ${apps.length} apps`}
            aria-label="Search apps"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="suite-switch-kbd">↵</span>
        </div>

        {!searching && current ? (
          <SuiteSwitchRow app={current} current focused={false} appColorStyle={appColorStyle} onSelect={() => closeMobile()} />
        ) : null}

        {filtered.length === 0 ? (
          <div className="suite-switch-empty">No app matches &ldquo;{query}&rdquo;.</div>
        ) : null}

        {showGrouped && groups.length > 0
          ? groups.map((group) => (
              <div key={group.id} className="suite-switch-group">
                <SuiteSwitchDivider label={group.label} />
                <div className="suite-switch-list">
                  {group.apps.map((app) => {
                    const i = filtered.indexOf(app);
                    return (
                      <SuiteSwitchRow
                        key={app.id}
                        app={app}
                        focused={i === focusIndex}
                        appColorStyle={appColorStyle}
                        onSelect={() => activate(app)}
                        onHover={() => setFocusIndex(i)}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          : null}

        {!showGrouped && filtered.length > 0 ? (
          <>
            {!searching ? <SuiteSwitchDivider label="Switch to" /> : null}
            <div className="suite-switch-list">
              {filtered.map((app, i) => (
                <SuiteSwitchRow
                  key={app.id}
                  app={app}
                  focused={i === focusIndex}
                  appColorStyle={appColorStyle}
                  onSelect={() => activate(app)}
                  onHover={() => setFocusIndex(i)}
                />
              ))}
            </div>
          </>
        ) : null}

        <div className="suite-switch-footer">
          <a className="suite-switch-directory" href={switcherHref} onClick={closeMobile}>
            All apps →
          </a>
          <span className="suite-switch-mode">
            <span className={`suite-switch-mode-dot ${grouped ? 'is-grouped' : ''}`} />
            {grouped ? 'Grouped by area' : 'Flat list'}
          </span>
        </div>
      </div>
    </div>
  );
}

function SuiteSwitchDivider({ label }: { label: string }) {
  return (
    <div className="suite-switch-divider">
      <span className="suite-switch-eyebrow">{label}</span>
      <span className="suite-switch-divider-line" />
    </div>
  );
}

type SuiteSwitchRowProps = {
  app: SuiteAppIdentity;
  current?: boolean;
  focused?: boolean;
  onSelect: () => void;
  onHover?: () => void;
  appColorStyle: (app: SuiteAppIdentity) => CSSProperties;
};

function SuiteSwitchRow({ app, current = false, focused = false, onSelect, onHover, appColorStyle }: SuiteSwitchRowProps) {
  const disabled = app.status !== 'active' || !app.href;
  const className = [
    'suite-switch-row',
    current ? 'is-current' : '',
    focused ? 'is-focused' : '',
    disabled ? 'is-disabled' : ''
  ].filter(Boolean).join(' ');

  const Tag: 'a' | 'button' = disabled ? 'button' : 'a';

  return (
    <Tag
      className={className}
      style={appColorStyle(app)}
      onMouseEnter={onHover}
      {...(disabled
        ? { type: 'button' as const, disabled: true }
        : { href: app.href, onClick: (event: MouseEvent) => { event.preventDefault(); onSelect(); } })}
    >
      <span className="suite-switch-chip" aria-hidden="true">
        <AlmaAppIcon
          label={app.label.toUpperCase()}
          colorFrom={app.fromColor}
          colorTo={app.toColor}
          icon={app.icon}
          size={40}
          featureScale={0.6}
          variant="compact"
          showBrandMark={false}
        />
      </span>
      <span className="suite-switch-row-copy">
        <span className="suite-switch-row-name">{app.label}</span>
        <span className="suite-switch-row-descriptor">{app.description}</span>
      </span>
      {current ? (
        <span className="suite-switch-here">Here now</span>
      ) : (
        <svg className="suite-switch-arrow" width="13" height="13" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1 5 H9 M6 2 L9 5 L6 8" />
        </svg>
      )}
    </Tag>
  );
}

type SuiteAppDirectoryProps = {
  currentApp?: SuiteAppId;
  apps?: SuiteAppIdentity[];
  title?: string;
  description?: string;
  activity?: ReactNode;
};

export function SuiteAppDirectory({
  currentApp,
  apps = SUITE_APPS,
  title = 'Switch apps',
  description = 'Open the Alma Suite app you need. We pass a short-lived handoff token when you move between apps, so your login stays current where the destination app supports it.',
  activity
}: SuiteAppDirectoryProps) {
  const staffApp = apps.find((app) => app.id === 'staff');
  const iPadHref = staffApp?.href ? `${staffApp.href.replace(/\/+$/, '')}/device` : undefined;

  const openWithHandoff = useCallback((event: MouseEvent<HTMLAnchorElement>, href: string, isCurrent: boolean) => {
    if (isCurrent) return;
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
  }, []);

  return (
    <div className="suite-directory">
      <section className="suite-directory-hero">
        <div>
          <p className="suite-directory-eyebrow">Alma Suite</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {iPadHref ? (
          <a
            className="suite-directory-ipad"
            href={iPadHref}
            onClick={(event) => openWithHandoff(event, iPadHref, false)}
          >
            <span>Venue iPad login</span>
            <strong>Open shared device mode</strong>
          </a>
        ) : null}
      </section>

      {activity ? (
        <section className="suite-directory-activity" aria-label="Suite alerts and messages">
          {activity}
        </section>
      ) : null}

      <section className="suite-directory-grid" aria-label="Alma Suite apps">
        {apps.map((app) => {
          const isCurrent = app.id === currentApp;
          const isAvailable = app.status === 'active' && Boolean(app.href);
          return (
            <a
              key={app.id}
              className={`suite-directory-card ${isCurrent ? 'is-current' : ''} ${isAvailable ? '' : 'is-disabled'}`}
              href={app.href ?? '#'}
              aria-disabled={!isAvailable}
              style={appColorStyle(app)}
              onClick={(event) => {
                if (!isAvailable) {
                  event.preventDefault();
                  return;
                }
                openWithHandoff(event, app.href!, isCurrent);
              }}
            >
              <span className="suite-directory-card-icon" aria-hidden="true">
                <AlmaAppIcon
                  label={app.label.toUpperCase()}
                  colorFrom={app.fromColor}
                  colorTo={app.toColor}
                  icon={app.icon}
                  size={54}
                  featureScale={0.68}
                  variant="compact"
                  showBrandMark={false}
                />
              </span>
              <span className="suite-directory-card-copy">
                <strong>{app.label}</strong>
                <span>{app.description}</span>
                <em>{isCurrent ? 'Current app' : isAvailable ? 'Open app' : 'Coming soon'}</em>
              </span>
            </a>
          );
        })}
      </section>
    </div>
  );
}

/** Renders every ALMA module icon in a row. Handy for previews / brand pages. */
export function SuiteApps() {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {ALMA_APPS.map((app: AlmaAppDefinition) => (
        <AlmaAppIcon
          key={app.id}
          label={app.label}
          colorFrom={app.from}
          colorTo={app.to}
          icon={app.icon}
        />
      ))}
    </div>
  );
}
