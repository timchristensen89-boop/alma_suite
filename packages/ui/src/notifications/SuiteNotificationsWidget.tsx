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

const panelStyle = {
  position: 'fixed',
  right: 12,
  top: 72,
  width: 'min(420px, calc(100vw - 24px))',
  maxHeight: 'calc(100vh - 92px)',
  overflow: 'auto',
  zIndex: 230,
  padding: 16,
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: '#fff',
  boxShadow: '0 24px 70px rgba(15, 23, 42, 0.22)'
} as const;

const itemBaseStyle = {
  display: 'grid',
  gap: 4,
  width: '100%',
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  color: '#0f172a',
  textDecoration: 'none',
  textAlign: 'left'
} as const;

const toneColour: Record<SuiteNotification['tone'], string> = {
  danger: '#b91c1c',
  warning: '#a16207',
  info: '#2563eb',
  positive: '#15803d'
};

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

  return (
    <div ref={layerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Alerts{unreadCount > 0 ? ` ${unreadCount > 9 ? '9+' : unreadCount}` : ''}
      </button>
      {open ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
            <div>
              <strong style={{ display: 'block', color: '#0f172a' }}>Suite alerts</strong>
              <span style={{ color: '#64748b', fontSize: 13 }}>
                {loading
                  ? 'Refreshing...'
                  : `${unreadCount} unread${readItems.length > 0 ? ` · ${readItems.length} read` : ''}`}
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close alerts">
              ×
            </button>
          </div>

          {message ? <p className="error-text">{message}</p> : null}

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {unreadCount > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
            {readItems.length > 0 ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowRead((value) => !value)}
              >
                {showRead ? 'Hide read' : `Show ${readItems.length} read`}
              </button>
            ) : null}
            {showRead && readItems.length > 0 ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearAllRead}>
                Restore all
              </button>
            ) : null}
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {!displayItems.length && !loading ? (
              <p className="subtle" style={{ margin: 0 }}>
                {unreadCount === 0 && items.length > 0 ? 'All caught up.' : 'Nothing needs attention right now.'}
              </p>
            ) : null}
            {displayItems.map((item) => {
              const href = targetFor(item);
              const isRead = !!readState[item.id];
              return (
                <div
                  key={item.id}
                  style={{
                    ...itemBaseStyle,
                    background: isRead ? '#f1f5f9' : '#f8fafc',
                    opacity: isRead ? 0.65 : 1,
                    position: 'relative'
                  }}
                >
                  <a
                    href={href}
                    style={{ color: 'inherit', textDecoration: 'none', display: 'grid', gap: 4 }}
                    onClick={(event) => {
                      markRead(item.id);
                      setOpen(false);
                      openWithSuiteHandoff(event, href);
                    }}
                  >
                    <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{item.title}</strong>
                      <span style={{ color: toneColour[item.tone], fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                        {item.tone}
                      </span>
                    </span>
                    <span style={{ color: '#475569', fontSize: 13 }}>{item.description}</span>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>
                      {item.appLabel ?? item.appId ?? 'Alma'} · {timeAgo(item.createdAt)}
                    </span>
                  </a>
                  {!isRead ? (
                    <button
                      type="button"
                      onClick={() => markRead(item.id)}
                      aria-label="Mark as read"
                      style={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        border: 0,
                        background: 'transparent',
                        color: '#94a3b8',
                        cursor: 'pointer',
                        fontSize: 13,
                        padding: '2px 6px',
                        borderRadius: 6
                      }}
                    >
                      ✓
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
