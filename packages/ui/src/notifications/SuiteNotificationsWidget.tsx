import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;

type SuiteNotification = {
  id: string;
  tone: 'danger' | 'warning' | 'info' | 'positive';
  title: string;
  description: string;
  to?: string;
  href?: string;
  appId?: string;
  appLabel?: string;
  createdAt: string;
};

type Props = {
  api: ApiClient;
  currentApp?: string;
};

const READ_STORAGE_KEY = 'alma.notifications.read.v1';
const READ_RETENTION_DAYS = 30;

type ReadState = Record<string, number>; // notificationId -> timestamp marked read

function loadReadState(): ReadState {
  try {
    const raw = window.localStorage.getItem(READ_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ReadState;
    if (!parsed || typeof parsed !== 'object') return {};
    // Prune entries older than retention
    const cutoff = Date.now() - READ_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const next: ReadState = {};
    for (const [id, ts] of Object.entries(parsed)) {
      if (typeof ts === 'number' && ts > cutoff) next[id] = ts;
    }
    return next;
  } catch {
    return {};
  }
}

function persistReadState(state: ReadState) {
  try {
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}

// Map a notification's tone to the severity bucket from the design. Three
// urgency tiers, color-coded via earthy palette pulls — no traffic lights.
type AlertSeverity = 'critical' | 'today' | 'thisWeek';

const TONE_TO_SEVERITY: Record<SuiteNotification['tone'], AlertSeverity> = {
  danger: 'critical',
  warning: 'today',
  info: 'thisWeek',
  positive: 'thisWeek'
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical · now',
  today: 'Today',
  thisWeek: 'This week'
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#A0463A',
  today: '#B27935',
  thisWeek: '#4F627E'
};

// App chip palette — kept in sync with the editorial switcher. Inlined to
// avoid an import cycle with brand/SuiteApps.
const APP_CHIP_PALETTE: Record<string, { bg: string; fg: string }> = {
  compliance: { bg: '#A0463A', fg: '#FBEFE8' },
  stock:      { bg: '#3D5C3F', fg: '#EDF1E2' },
  reports:    { bg: '#B27935', fg: '#FBF1DC' },
  staff:      { bg: '#4F627E', fg: '#EDF1F6' },
  reserve:    { bg: '#1F2A1E', fg: '#E6E8DD' },
  marketing:  { bg: '#5A3D3D', fg: '#F0E0DC' },
  comms:      { bg: '#6E7682', fg: '#F4F6F9' },
  giftcards:  { bg: '#E6B895', fg: '#3D2218' },
  settings:   { bg: '#1A1A18', fg: '#E6E2D8' },
  admin:      { bg: '#1A1A18', fg: '#E6E2D8' }
};

function chipFor(appId: string | undefined): { bg: string; fg: string } {
  if (!appId) return { bg: '#1F3524', fg: '#F8F0E6' };
  return APP_CHIP_PALETTE[appId] ?? { bg: '#1F3524', fg: '#F8F0E6' };
}

function appInitial(appId: string | undefined, appLabel: string | undefined): string {
  const source = appLabel || appId || 'A';
  return source.charAt(0).toUpperCase();
}

function timeAgo(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}

function targetFor(item: SuiteNotification) {
  return item.href ?? item.to ?? '#';
}

function openWithSuiteHandoff(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href || href === '#') return;
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

export function SuiteNotificationsWidget({ api, currentApp = 'suite' }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SuiteNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [readState, setReadState] = useState<ReadState>(() => (typeof window !== 'undefined' ? loadReadState() : {}));
  const [showRead, setShowRead] = useState(false);

  const close = useCallback(() => setOpen(false), []);
  useDismissibleLayer(layerRef, open, close, `${currentApp}-notifications`);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const payload = await api<SuiteNotification[]>('/api/notifications');
      setItems(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const markRead = useCallback((id: string) => {
    setReadState((current) => {
      const next = { ...current, [id]: Date.now() };
      persistReadState(next);
      return next;
    });
  }, []);

  const markAllRead = useCallback(() => {
    setReadState((current) => {
      const next = { ...current };
      for (const item of items) next[item.id] = Date.now();
      persistReadState(next);
      return next;
    });
  }, [items]);

  const clearAllRead = useCallback(() => {
    setReadState({});
    persistReadState({});
  }, []);

  const [filter, setFilter] = useState<'all' | AlertSeverity>('all');

  const { unreadItems, readItems } = useMemo(() => {
    const unread: SuiteNotification[] = [];
    const read: SuiteNotification[] = [];
    for (const item of items) {
      if (readState[item.id]) read.push(item);
      else unread.push(item);
    }
    return { unreadItems: unread, readItems: read };
  }, [items, readState]);

  const displayItems = showRead ? items : unreadItems;
  const unreadCount = unreadItems.length;

  // Bucket items by severity for the grouped layout.
  const buckets = useMemo(() => {
    const out: Record<AlertSeverity, SuiteNotification[]> = {
      critical: [],
      today: [],
      thisWeek: []
    };
    for (const item of displayItems) {
      out[TONE_TO_SEVERITY[item.tone]].push(item);
    }
    return out;
  }, [displayItems]);

  const filteredOrder: AlertSeverity[] = filter === 'all'
    ? ['critical', 'today', 'thisWeek']
    : [filter];

  return (
    <div ref={layerRef} className="suite-alert-anchor">
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Alerts{unreadCount > 0 ? ` ${unreadCount > 9 ? '9+' : unreadCount}` : ''}
      </button>
      {open ? (
        <div className="suite-alert-panel" role="dialog" aria-label="Alerts">
          <div className="suite-alert-head">
            <div>
              <span className="suite-alert-eyebrow">
                Alma Suite · {buckets.critical.length > 0 ? 'Attention' : 'All clear'}
              </span>
              <strong className="suite-alert-title">Needs your eye</strong>
            </div>
            <div className="suite-alert-head-actions">
              {unreadCount > 0 ? (
                <button type="button" className="suite-alert-ghost-link" onClick={markAllRead}>
                  Mark all done
                </button>
              ) : null}
              <button
                type="button"
                className="suite-alert-close"
                onClick={() => setOpen(false)}
                aria-label="Close alerts"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Filter chips */}
          <div className="suite-alert-filters">
            {(
              [
                ['all', 'All', displayItems.length],
                ['critical', 'Critical', buckets.critical.length],
                ['today', 'Today', buckets.today.length],
                ['thisWeek', 'This week', buckets.thisWeek.length]
              ] as Array<['all' | AlertSeverity, string, number]>
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                className={`suite-alert-chip ${filter === id ? 'is-active' : ''}`}
                onClick={() => setFilter(id)}
              >
                {label} <span className="suite-alert-chip-count">{count}</span>
              </button>
            ))}
            {readItems.length > 0 ? (
              <button
                type="button"
                className={`suite-alert-chip ${showRead ? 'is-active' : ''}`}
                onClick={() => setShowRead((value) => !value)}
              >
                {showRead ? 'Hide read' : `Show ${readItems.length} read`}
              </button>
            ) : null}
          </div>

          {message ? <p className="suite-alert-error">{message}</p> : null}

          {displayItems.length === 0 && !loading ? (
            <div className="suite-alert-empty">
              {unreadCount === 0 && items.length > 0 ? 'All caught up.' : 'Nothing needs attention right now.'}
            </div>
          ) : null}

          {filteredOrder.map((severity) => {
            const bucket = buckets[severity];
            if (bucket.length === 0) return null;
            return (
              <div key={severity} className="suite-alert-group">
                <div className="suite-alert-divider">
                  <span className="suite-alert-severity-dot" style={{ background: SEVERITY_COLOR[severity] }} />
                  <span className="suite-alert-eyebrow">{SEVERITY_LABEL[severity]}</span>
                  <span className="suite-alert-divider-line" />
                </div>
                {bucket.map((item) => (
                  <AlertRow
                    key={item.id}
                    item={item}
                    severity={severity}
                    isRead={!!readState[item.id]}
                    onAction={(event) => {
                      const href = targetFor(item);
                      markRead(item.id);
                      setOpen(false);
                      openWithSuiteHandoff(event, href);
                    }}
                    onSnooze={() => markRead(item.id)}
                    onDismiss={() => markRead(item.id)}
                  />
                ))}
              </div>
            );
          })}

          <div className="suite-alert-footer">
            <span className="suite-alert-eyebrow suite-alert-eyebrow--muted">
              {loading ? 'Refreshing…' : `${unreadCount} unread · ${readItems.length} read`}
            </span>
            {showRead && readItems.length > 0 ? (
              <button type="button" className="suite-alert-ghost-link" onClick={clearAllRead}>
                Restore all
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AlertRowProps = {
  item: SuiteNotification;
  severity: AlertSeverity;
  isRead: boolean;
  onAction: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSnooze: () => void;
  onDismiss: () => void;
};

function AlertRow({ item, severity, isRead, onAction, onSnooze, onDismiss }: AlertRowProps) {
  const chip = chipFor(item.appId);
  const href = targetFor(item);
  return (
    <div className={`suite-alert-row ${isRead ? 'is-read' : ''}`}>
      <span className="suite-alert-chip-icon" style={{ background: chip.bg, color: chip.fg }} aria-hidden="true">
        {appInitial(item.appId, item.appLabel)}
        <span
          className="suite-alert-severity-pip"
          style={{ background: SEVERITY_COLOR[severity] }}
        />
      </span>
      <div className="suite-alert-body">
        <div className="suite-alert-meta">
          <a
            href={href}
            className="suite-alert-link"
            onClick={onAction}
          >
            <span className="suite-alert-title-line">{item.title}</span>
          </a>
          <span className="suite-alert-time">{timeAgo(item.createdAt)}</span>
        </div>
        {item.description ? (
          <div className="suite-alert-detail">{item.description}</div>
        ) : null}
        <div className="suite-alert-actions">
          <a href={href} className="suite-alert-primary-btn" onClick={onAction}>
            Open
          </a>
          <button type="button" className="suite-alert-ghost-btn" onClick={onSnooze}>
            Snooze
          </button>
          <button type="button" className="suite-alert-ghost-btn" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
