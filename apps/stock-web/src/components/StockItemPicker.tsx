import { useEffect, useMemo, useRef, useState } from 'react';
import type { StockItem } from '@alma/shared';

const USAGE_KEY = 'alma.stock.itemUsage';

function readUsage(): Record<string, number> {
  try {
    return (JSON.parse(window.localStorage.getItem(USAGE_KEY) || '{}') as Record<string, number>) || {};
  } catch {
    return {};
  }
}

function bumpUsage(id: string) {
  if (!id) return;
  try {
    const usage = readUsage();
    usage[id] = (usage[id] ?? 0) + 1;
    window.localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* ignore quota / private mode */
  }
}

function labelFor(item: StockItem) {
  return `${item.name}${item.sku ? ` · ${item.sku}` : ''}`;
}

type Props = {
  items: StockItem[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
};

/**
 * Searchable stock-item picker with a "Frequent" shortlist (top 5 most-used on
 * this device). Replaces the plain <Select> wherever an item is chosen, so long
 * catalogues are searchable rather than an unwieldy dropdown.
 */
export function StockItemPicker({ items, value, onChange, label = 'Item', placeholder = 'Search stock items…', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [usageTick, setUsageTick] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => items.find((item) => item.id === value) ?? null, [items, value]);

  const frequent = useMemo(() => {
    const usage = readUsage();
    return [...items]
      .filter((item) => usage[item.id])
      .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, usageTick]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [] as StockItem[];
    return items
      .filter((item) => item.name.toLowerCase().includes(term) || (item.sku ?? '').toLowerCase().includes(term))
      .slice(0, 50);
  }, [items, query]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function pick(id: string) {
    bumpUsage(id);
    setUsageTick((tick) => tick + 1);
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  const inputValue = open ? query : selected ? labelFor(selected) : '';
  const searching = query.trim() !== '';
  const showFrequent = !searching && frequent.length > 0;

  return (
    <div className="item-search field" ref={ref}>
      <span className="field-label">{label}</span>
      <input
        className="field-control item-search-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        placeholder={selected ? undefined : placeholder}
        value={inputValue}
        onFocus={() => { if (disabled) return; setQuery(''); setOpen(true); }}
        onChange={(event) => { if (disabled) return; setQuery(event.currentTarget.value); if (!open) setOpen(true); }}
        onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); setQuery(''); } }}
      />
      {open ? (
        <ul className="item-search-panel" role="listbox">
          {showFrequent ? (
            <>
              <li className="item-search-section-label" role="presentation">★ Frequent</li>
              {frequent.map((item) => (
                <li
                  key={`fav-${item.id}`}
                  className="item-search-option"
                  role="option"
                  aria-selected={item.id === value}
                  onMouseDown={(event) => { event.preventDefault(); pick(item.id); }}
                >
                  {labelFor(item)}
                </li>
              ))}
              <li className="item-search-section-label" role="presentation">Type to search all items</li>
            </>
          ) : null}

          {searching ? (
            filtered.length > 0 ? (
              filtered.map((item) => (
                <li
                  key={item.id}
                  className="item-search-option"
                  role="option"
                  aria-selected={item.id === value}
                  onMouseDown={(event) => { event.preventDefault(); pick(item.id); }}
                >
                  {labelFor(item)}
                </li>
              ))
            ) : (
              <li className="item-search-empty" role="presentation">No matching items</li>
            )
          ) : showFrequent ? null : (
            <li className="item-search-empty" role="presentation">Start typing to find an item</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
