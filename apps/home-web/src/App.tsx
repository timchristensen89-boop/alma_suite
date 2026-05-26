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
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loadingNotifications, setLoadingNotifications] = useState(true);
  const [authPromptVisible, setAuthPromptVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // Try compliance API for notifications (where the API actually lives)
        const apiUrl = 'https://alma-compliance.web.app/api/notifications';
        const response = await fetch(apiUrl, { credentials: 'include' });
        if (response.status === 401) {
          setAuthPromptVisible(true);
          return;
        }
        if (!response.ok) throw new Error('Could not load notifications');
        const data = await response.json();
        setNotifications(Array.isArray(data) ? data : []);
      } catch {
        // Silent fallback — show empty notification state
      } finally {
        setLoadingNotifications(false);
      }
    })();
  }, []);

  const activeApps = useMemo(
    () => SUITE_APPS.filter((app) => app.status === 'active'),
    []
  );

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
