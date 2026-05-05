import type { ReactNode } from 'react';
import {
  AlmaAppIcon,
  ALMA_APPS,
  BookIcon,
  CapIcon,
  ChartIcon,
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
  | 'marketing'
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
  gear: () => <GearIcon />
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

const ALL_APPS: SuiteAppIdentity[] = [
  ...SUITE_APP_SEEDS.map((seed) => ({
    ...seed,
    icon: ICON_FACTORY[seed.iconKey]()
  })),
  ...LEGACY_APPS
];

export const SUITE_APPS: SuiteAppIdentity[] = ALL_APPS.filter((app) =>
  ALMA_APPS.some((moduleApp) => moduleApp.id === app.id)
);

/** Legacy alias — same data as `SUITE_APPS`. */
export const suiteApp: SuiteAppIdentity[] = SUITE_APPS;

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

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
    <span
      className={className ? `product-logo-lockup ${className}` : 'product-logo-lockup'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: logoSize.gap,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Helvetica Neue", "Segoe UI", Roboto, Arial, sans-serif',
        lineHeight: 1,
        color: titleColor
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
    </span>
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
};

export function SuiteAppSwitcher({
  currentApp,
  apps = SUITE_APPS,
  variant = 'login'
}: SuiteAppSwitcherProps) {
  const isSidebar = variant === 'sidebar';
  const isTopbar = variant === 'topbar';
  const current = apps.find((app) => app.id === currentApp);
  const className = [
    'suite-switcher',
    isSidebar ? 'suite-switcher--sidebar' : '',
    isTopbar ? 'suite-switcher--topbar' : ''
  ]
    .filter(Boolean)
    .join(' ');

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
                showBrandMark={!isSidebar && !isTopbar}
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
            onClick={(event) => {
              const handoff = (globalThis as typeof globalThis & {
                almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
              }).almaCreateSuiteHandoffUrl;
              if (!handoff || app.id === currentApp) return;
              event.preventDefault();
              void handoff(app.href!).then((href) => {
                window.location.assign(href);
              }).catch(() => {
                window.location.assign(app.href!);
              });
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
      <details className={className}>
        <summary aria-label="Open Alma app switcher">
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
          <span>Apps</span>
        </summary>
        {grid}
      </details>
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
