import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { IconSearch } from '../lib/icons';
import { navItemsForRole } from '../config/navigation';

type ResultType = 'issue' | 'staff' | 'asset' | 'checklist' | 'audit' | 'incident';

type SearchResult = {
  id: string;
  type: ResultType;
  title: string;
  subtitle: string;
  to: string;
};

type NavResult = {
  id: string;
  type: ResultType | 'nav';
  title: string;
  subtitle: string;
  to: string;
};

const TYPE_LABELS: Record<string, string> = {
  nav: 'Go to',
  issue: 'Issue',
  staff: 'Staff',
  asset: 'Asset',
  checklist: 'Checklist',
  audit: 'Audit',
  incident: 'Incident'
};

type Props = {
  open: boolean;
  onClose: () => void;
};

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NavResult[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);

  // Reset + focus on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      const timeout = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Debounced API search + always show nav matches
  useEffect(() => {
    if (!open) return undefined;
    const q = query.trim().toLowerCase();

    const navItems = navItemsForRole(user);
    const navMatches: NavResult[] = (q === ''
      ? navItems
      : navItems.filter((item) =>
          (item.label + ' ' + (item.description ?? ''))
            .toLowerCase()
            .includes(q)
        )
    ).map((item) => ({
      id: `nav-${item.to}`,
      type: 'nav' as const,
      title: item.label,
      subtitle: item.description ?? '',
      to: item.to
    }));

    if (q === '') {
      setResults(navMatches);
      setSelected(0);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const data = await api<SearchResult[]>(
          `/api/search?q=${encodeURIComponent(q)}`
        );
        if (cancelled) return;
        setResults([...navMatches, ...data]);
        setSelected(0);
      } catch {
        if (!cancelled) setResults(navMatches);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [open, query]);

  if (!open) return null;

  function activate(index: number) {
    const target = results[index];
    if (!target) return;
    navigate(target.to);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(selected);
    }
  }

  return (
    <div
      className="cmdk-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="cmdk">
        <div className="cmdk-input">
          <IconSearch size={14} />
          <input
            ref={inputRef}
            placeholder="Search issues, staff, assets…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-results">
          {loading && results.length === 0 ? (
            <div className="cmdk-empty">Searching…</div>
          ) : results.length === 0 ? (
            <div className="cmdk-empty">No matches</div>
          ) : (
            results.map((result, index) => (
              <button
                key={result.id}
                type="button"
                className={`cmdk-row${index === selected ? ' is-selected' : ''}`}
                onMouseEnter={() => setSelected(index)}
                onClick={() => activate(index)}
              >
                <span className="cmdk-row-type">{TYPE_LABELS[result.type] ?? result.type}</span>
                <span className="cmdk-row-title">{result.title}</span>
                {result.subtitle ? (
                  <span className="cmdk-row-sub">{result.subtitle}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑↓</kbd> to move
          </span>
          <span>
            <kbd>↵</kbd> to open
          </span>
          <span>
            <kbd>ESC</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
