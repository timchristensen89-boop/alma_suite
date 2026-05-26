import { useEffect, useMemo, useState } from 'react';
import { SUITE_APPS, type SuiteAppIdentity } from '@alma/ui';

type Notification = {
  id: string;
  app?: string;
  tone?: 'danger' | 'warning' | 'info' | 'positive';
  title: string;
  body?: string;
  link?: string;
};

// Minimal user shape — Home only needs role + accountType + admin flag
// to decide which tiles to show. We grab it from /api/auth/me, which
// already returns this in production.
type HomeUser = {
  role?: 'ADMIN' | 'MANAGER' | 'STAFF' | string;
  isAdmin?: boolean;
  accountType?: 'HUMAN' | 'VENUE_DEVICE' | string;
  appAccess?: Array<{ appId: string; status?: string }>;
};

// Which Suite app IDs each role can actually USE. Used to filter the
// Home tile grid so casual staff don't see admin noise. Apps still appear
// on the suite switcher inside each app for managers — this only filters
// the launcher.
const TILES_BY_ROLE: Record<string, string[]> = {
  STAFF: ['staff', 'training'],
  MANAGER: ['staff', 'stock', 'compliance', 'giftcards', 'reports', 'comms', 'reserve', 'training'],
  ADMIN: ['staff', 'stock', 'compliance', 'giftcards', 'reports', 'comms', 'reserve', 'marketing', 'training', 'settings']
};

const APP_LABELS: Record<string, string> = {
  staff: 'Staff',
  compliance: 'Compliance',
  stock: 'Stock',
  reserve: 'Reserve',
  reports: 'Reports',
  marketing: 'Marketing',
  giftcards: 'Gift Cards',
  comms: 'Comms',
  settings: 'Admin',
  training: 'Academy',
  learning: 'Academy'
};

const APP_TAGLINES: Record<string, string> = {
  staff: 'Roster, timesheets, HR, training, tips',
  compliance: 'Issues, checklists, audits, temperatures',
  stock: 'Items, recipes, stocktakes, invoices, deliveries',
  reserve: 'Bookings, tables, availability, guests',
  reports: 'Sales, prime cost, menu engineering, exports',
  marketing: 'Campaigns, automations, content, segments',
  giftcards: 'Orders, balances, promotions',
  comms: 'Messages, announcements, handovers',
  settings: 'Configuration, users, integrations, imports',
  training: 'Courses, certifications, completion tracking',
  learning: 'Courses, certifications, completion tracking'
};

function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function dateString() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
}

export function App() {
  // Route-by-pathname — no react-router needed for one extra page.
  // /venue and /ipad both serve the shared-device home; everything else
  // goes through the standard suite launcher.
  const path = typeof window !== 'undefined' ? window.location.pathname.replace(/\/+$/, '') : '';
  if (path === '/venue' || path === '/ipad') {
    return <VenueMode />;
  }
  return <SuiteLauncher />;
}

function SuiteLauncher() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);
  const [user, setUser] = useState<HomeUser | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        // Pull notifications + user role in parallel from compliance API.
        // User role drives which tiles we show.
        const [notifResp, userResp] = await Promise.all([
          fetch('https://alma-compliance.web.app/api/notifications', { credentials: 'include' }),
          fetch('https://alma-compliance.web.app/api/auth/me', { credentials: 'include' }).catch(() => null)
        ]);
        if (notifResp.status === 401) {
          setAuthPromptVisible(true);
          return;
        }
        if (notifResp.ok) {
          const data = await notifResp.json();
          setNotifications(Array.isArray(data) ? data : []);
        }
        if (userResp && userResp.ok) {
          const userData = await userResp.json();
          // /api/auth/me returns { user } in the staff API; the compliance
          // shape may differ. Handle both.
          const u = (userData?.user ?? userData) as HomeUser | null;
          if (u) {
            setUser(u);
            // Venue devices auto-redirect to the venue iPad home.
            if (u.accountType === 'VENUE_DEVICE' && window.location.pathname !== '/venue') {
              window.location.replace('/venue');
              return;
            }
          }
        }
      } catch {
        // Silent fallback — show empty state and all tiles
      } finally {
        setLoadingNotifications(false);
      }
    })();
  }, []);

  const activeApps = useMemo(() => {
    const all = SUITE_APPS.filter((app) => app.status === 'active');
    // No user loaded yet (signed out or fetch failed): show everything,
    // so the visitor knows what's in the suite. Per-app auth still gates
    // access on click.
    if (!user) return all;
    // Admin / no explicit role on an isAdmin user: full set.
    if (user.isAdmin || user.role === 'ADMIN') return TILES_BY_ROLE.ADMIN
      ? all.filter((app) => TILES_BY_ROLE.ADMIN!.includes(app.id))
      : all;
    const allowed = TILES_BY_ROLE[String(user.role ?? '').toUpperCase()];
    if (!allowed) return all;
    return all.filter((app) => allowed.includes(app.id));
  }, [user]);

  const notificationsByApp = useMemo(() => {
    const map = new Map<string, Notification[]>();
    for (const n of notifications) {
      const key = n.app?.toLowerCase() ?? 'general';
      const list = map.get(key) ?? [];
      list.push(n);
      map.set(key, list);
    }
    return map;
  }, [notifications]);

  const totalAlerts = notifications.length;
  const dangerCount = notifications.filter((n) => n.tone === 'danger').length;
  const warningCount = notifications.filter((n) => n.tone === 'warning').length;

  return (
    <div className="home-page">
      <header className="home-header">
        <div className="home-header-text">
          <p className="home-eyebrow">Alma Suite</p>
          <h1>{timeOfDayGreeting()}</h1>
          <p className="home-meta">{dateString()}</p>
        </div>
        {!loadingNotifications && totalAlerts > 0 ? (
          <div className="home-pulse">
            <span className="home-pulse-count">
              <strong>{totalAlerts}</strong>
              <small>open</small>
            </span>
            {dangerCount > 0 ? <span className="home-pulse-chip is-danger">{dangerCount} urgent</span> : null}
            {warningCount > 0 ? <span className="home-pulse-chip is-warning">{warningCount} warnings</span> : null}
          </div>
        ) : null}
      </header>

      {authPromptVisible ? (
        <div className="home-auth-prompt">
          <strong>Sign in to see your alerts</strong>
          <span>Click any app below — it'll bring you back here once you're signed in.</span>
        </div>
      ) : null}

      <main className="home-grid">
        {activeApps.map((app) => (
          <AppTile
            key={app.id}
            app={app}
            notifications={notificationsByApp.get(app.id) ?? []}
          />
        ))}
      </main>

      <footer className="home-footer">
        <span>Alma Group</span>
        <span className="home-footer-divider" aria-hidden="true">·</span>
        <a href="https://almagroup.com.au" target="_blank" rel="noreferrer">almagroup.com.au</a>
      </footer>
    </div>
  );
}

/**
 * Venue iPad home — the entry route for shared devices.
 *
 * Strips the suite down to exactly the actions a venue device should do:
 * redeem · stocktake · roster · bookings · checklists · handover.
 * Hides Admin, Reports, HR, Marketing, anything sensitive.
 *
 * Backend already enforces this via VENUE_DEVICE write block + per-path
 * role gates in apps/api/src/lib/auth-middleware.ts. This page is the
 * UI half of that gate — the floor staff never have to navigate past
 * what they need.
 */
type VenueTile = {
  id: string;
  label: string;
  description: string;
  href: string;
  // Single-glyph mark so we don't depend on any icon system being
  // imported here. Each tile uses its app's accent stripe.
  glyph: string;
  accent: string;
};

const VENUE_TILES: VenueTile[] = [
  {
    id: 'redeem',
    label: 'Redeem gift card',
    description: 'Look up, redeem and print',
    href: 'https://alma-giftcards.web.app/redeem',
    glyph: 'GC',
    accent: '#E5C6B0'
  },
  {
    id: 'stocktake',
    label: 'Stocktake',
    description: 'Today’s count',
    href: 'https://alma-stock-v18.web.app/stocktake',
    glyph: 'ST',
    accent: '#4F6B47'
  },
  {
    id: 'roster',
    label: 'Roster',
    description: 'Who’s on today',
    href: 'https://alma-staff.web.app/roster',
    glyph: 'RT',
    accent: '#4D5E7A'
  },
  {
    id: 'bookings',
    label: 'Bookings',
    description: 'Tonight’s diary',
    href: 'https://alma-reserve.web.app',
    glyph: 'BK',
    accent: '#253326'
  },
  {
    id: 'checklists',
    label: 'Checklists',
    description: 'Open, close, compliance',
    href: 'https://alma-compliance.web.app/checklists',
    glyph: 'CL',
    accent: '#9A3A2E'
  },
  {
    id: 'handover',
    label: 'Handover',
    description: 'Shift to shift notes',
    href: 'https://alma-comms.web.app',
    glyph: 'HO',
    accent: '#6E7682'
  }
];

function VenueMode() {
  // Read the venue name from localStorage if a manager has set it on
  // this device. Otherwise we just say "Venue".
  const venueName = typeof window !== 'undefined'
    ? (window.localStorage.getItem('alma.venue.name') || '').trim()
    : '';

  const now = new Date();
  const timeLabel = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  function promptVenue() {
    if (typeof window === 'undefined') return;
    const current = window.localStorage.getItem('alma.venue.name') || '';
    const next = window.prompt('Set the venue for this iPad (e.g. "Alma Avalon" or "St Alma"):', current);
    if (next === null) return;
    window.localStorage.setItem('alma.venue.name', next.trim());
    window.location.reload();
  }

  function exitVenueMode() {
    if (typeof window === 'undefined') return;
    window.location.assign('/');
  }

  return (
    <div className="venue-page">
      <header className="venue-header">
        <div className="venue-header-text">
          <p className="venue-eyebrow">Alma · Venue mode</p>
          <h1 className="venue-title">{venueName || 'Venue'}</h1>
          <p className="venue-meta">{dateLabel} · {timeLabel}</p>
        </div>
        <div className="venue-header-actions">
          <button type="button" className="venue-action-pill" onClick={promptVenue}>
            {venueName ? 'Switch venue' : 'Set venue'}
          </button>
          <button type="button" className="venue-action-pill venue-action-pill--ghost" onClick={exitVenueMode}>
            Exit venue mode
          </button>
        </div>
      </header>

      <main className="venue-grid" aria-label="Venue actions">
        {VENUE_TILES.map((tile) => (
          <a
            key={tile.id}
            className="venue-tile"
            href={tile.href}
            style={{ ['--venue-accent' as string]: tile.accent }}
          >
            <span className="venue-tile-glyph" aria-hidden="true">{tile.glyph}</span>
            <span className="venue-tile-body">
              <span className="venue-tile-label">{tile.label}</span>
              <span className="venue-tile-description">{tile.description}</span>
            </span>
          </a>
        ))}
      </main>

      <footer className="venue-footer">
        <span>This iPad is signed in as a shared venue device. Admin, HR, payroll and reports are restricted.</span>
      </footer>
    </div>
  );
}

function AppTile({ app, notifications }: { app: SuiteAppIdentity; notifications: Notification[] }) {
  const label = APP_LABELS[app.id] ?? app.label ?? app.id;
  const tagline = APP_TAGLINES[app.id] ?? '';
  const badge = notifications.length;
  const hasDanger = notifications.some((n) => n.tone === 'danger');
  const hasWarning = notifications.some((n) => n.tone === 'warning');
  const tone = hasDanger ? 'danger' : hasWarning ? 'warning' : 'neutral';

  const gradient = `linear-gradient(135deg, ${app.fromColor ?? '#244C9F'}, ${app.toColor ?? '#0D2260'})`;
  const href = app.href ?? '#';

  return (
    <a
      className={`home-tile is-${tone}`}
      href={href}
      style={{ ['--tile-gradient' as string]: gradient }}
    >
      <div className="home-tile-glow" aria-hidden="true" />
      <div className="home-tile-icon" aria-hidden="true">
        {app.icon}
      </div>
      <div className="home-tile-body">
        <span className="home-tile-label">
          {label}
          {app.lifecycle && app.lifecycle !== 'live' && app.lifecycle !== 'hidden' ? (
            <span className={`home-tile-lifecycle is-${app.lifecycle}`}>
              {app.lifecycle === 'pilot' ? 'Pilot' : app.lifecycle === 'preview' ? 'Preview' : 'Setup'}
            </span>
          ) : null}
        </span>
        {tagline ? <span className="home-tile-tagline">{tagline}</span> : null}
      </div>
      {badge > 0 ? (
        <span className={`home-tile-badge is-${tone}`} aria-label={`${badge} ${tone === 'danger' ? 'urgent' : 'open'} item${badge === 1 ? '' : 's'}`}>
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </a>
  );
}
