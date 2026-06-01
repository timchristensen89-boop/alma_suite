import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;

export type SuiteSearchItem = {
  id: string;
  label: string;
  description?: string | null;
  href: string;
  type?: string;
};

type SuiteSearchResult = {
  id: string;
  type: string;
  title: string;
  subtitle?: string | null;
  to: string;
};

type Props = {
  api?: ApiClient;
  currentApp: string;
  items?: SuiteSearchItem[];
  placeholder?: string;
  remoteSearch?: boolean;
  remoteResultBaseUrl?: string;
};

const panelStyle = {
  position: 'fixed',
  right: 12,
  top: 72,
  width: 'min(520px, calc(100vw - 24px))',
  maxHeight: 'calc(100vh - 92px)',
  overflow: 'auto',
  zIndex: 230,
  padding: 14,
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: '#fff',
  boxShadow: '0 24px 70px rgba(15, 23, 42, 0.22)'
} as const;

const rowStyle = {
  width: '100%',
  display: 'grid',
  gap: 3,
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: '#f8fafc',
  textAlign: 'left',
  cursor: 'pointer'
} as const;

function apiPath(path: string) {
  return path.startsWith('/api/') ? path : `/api/${path.replace(/^\/+/, '')}`;
}

function normaliseUrl(path: string, base?: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!base) return path;
  return new URL(path, base.replace(/\/+$/, '') + '/').toString();
}

async function openWithSuiteHandoff(href: string) {
  const handoff = (globalThis as typeof globalThis & {
    almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
  }).almaCreateSuiteHandoffUrl;

  if (handoff) {
    window.location.assign(await handoff(href));
    return;
  }

  window.location.assign(href);
}

export function SuiteSearchWidget({
  api,
  currentApp,
  items = [],
  placeholder = 'Search this app...',
  remoteSearch = false,
  remoteResultBaseUrl
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remoteResults, setRemoteResults] = useState<SuiteSearchResult[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const close = () => setOpen(false);
  useDismissibleLayer(layerRef, open, close, `${currentApp}-suite-search`);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    setRemoteResults([]);
    setMessage('');
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timeout);
  }, [open]);

  const localMatches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice(0, 8);
    return items
      .filter((item) => `${item.label} ${item.description ?? ''} ${item.type ?? ''}`.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [items, query]);

  useEffect(() => {
    if (!open || !remoteSearch || !api) return undefined;
    const needle = query.trim();
    if (!needle) {
      setRemoteResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setMessage('');
    const timeout = window.setTimeout(async () => {
      try {
        const results = await api<SuiteSearchResult[]>(apiPath(`/search?q=${encodeURIComponent(needle)}`));
        if (!cancelled) setRemoteResults(results);
      } catch (error) {
        if (!cancelled) {
          setRemoteResults([]);
          setMessage(error instanceof Error ? error.message : 'Search is unavailable.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [api, open, query, remoteSearch]);

  async function openLocal(item: SuiteSearchItem) {
    setOpen(false);
    await openWithSuiteHandoff(item.href);
  }

  async function openRemote(result: SuiteSearchResult) {
    setOpen(false);
    await openWithSuiteHandoff(normaliseUrl(result.to, remoteResultBaseUrl));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const firstLocal = localMatches[0];
    const firstRemote = remoteResults[0];
    if (firstLocal) void openLocal(firstLocal);
    else if (firstRemote) void openRemote(firstRemote);
  }

  const hasResults = localMatches.length > 0 || remoteResults.length > 0;

  return (
    <div ref={layerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Open search"
      >
        Search
      </button>
      {open ? (
        <div style={panelStyle}>
          <form onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>Search</span>
              <input
                ref={inputRef}
                className="field-control"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={placeholder}
              />
            </label>
          </form>

          {message ? <p className="error-text">{message}</p> : null}
          {loading ? <p className="subtle">Searching...</p> : null}

          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {localMatches.length > 0 ? (
              <>
                <strong style={{ color: '#334155', fontSize: 13 }}>This app</strong>
                {localMatches.map((item) => (
                  <button key={item.id} type="button" style={rowStyle} onClick={() => void openLocal(item)}>
                    <span style={{ color: '#0f172a', fontWeight: 700 }}>{item.label}</span>
                    {item.description ? <span style={{ color: '#64748b', fontSize: 13 }}>{item.description}</span> : null}
                  </button>
                ))}
              </>
            ) : null}

            {remoteResults.length > 0 ? (
              <>
                <strong style={{ color: '#334155', fontSize: 13, marginTop: 4 }}>Suite records</strong>
                {remoteResults.map((result) => (
                  <button key={`${result.type}-${result.id}`} type="button" style={rowStyle} onClick={() => void openRemote(result)}>
                    <span style={{ color: '#0f172a', fontWeight: 700 }}>{result.title}</span>
                    <span style={{ color: '#64748b', fontSize: 13 }}>{result.type}{result.subtitle ? ` · ${result.subtitle}` : ''}</span>
                  </button>
                ))}
              </>
            ) : null}

            {!loading && !hasResults ? (
              <p className="subtle" style={{ margin: 0 }}>No matches yet.</p>
            ) : null}
          </div>
          <p className="subtle" style={{ margin: '12px 0 0' }}>Shortcut: ⌘K or Ctrl+K.</p>
        </div>
      ) : null}
    </div>
  );
}
