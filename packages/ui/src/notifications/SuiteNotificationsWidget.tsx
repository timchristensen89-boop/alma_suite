import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
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

const itemStyle = {
  display: 'grid',
  gap: 4,
  width: '100%',
  padding: 12,
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: '#f8fafc',
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

  const hasItems = items.length > 0;

  return (
    <div ref={layerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Alerts{hasItems ? ` ${items.length}` : ''}
      </button>
      {open ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
            <div>
              <strong style={{ display: 'block', color: '#0f172a' }}>Suite alerts</strong>
              <span style={{ color: '#64748b', fontSize: 13 }}>
                {loading ? 'Refreshing...' : `${items.length} active item${items.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close alerts">
              x
            </button>
          </div>

          {message ? <p className="error-text">{message}</p> : null}

          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
            {!items.length && !loading ? (
              <p className="subtle" style={{ margin: 0 }}>Nothing needs attention right now.</p>
            ) : null}
            {items.map((item) => {
              const href = targetFor(item);
              return (
                <a
                  key={item.id}
                  href={href}
                  style={itemStyle}
                  onClick={(event) => {
                    setOpen(false);
                    openWithSuiteHandoff(event, href);
                  }}
                >
                  <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <strong>{item.title}</strong>
                    <span style={{ color: toneColour[item.tone], fontSize: 12, textTransform: 'uppercase' }}>{item.tone}</span>
                  </span>
                  <span style={{ color: '#475569', fontSize: 13 }}>{item.description}</span>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>
                    {item.appLabel ?? item.appId ?? 'Alma'} · {timeAgo(item.createdAt)}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
