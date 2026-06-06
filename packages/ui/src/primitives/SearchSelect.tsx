import { useEffect, useMemo, useRef, useState } from 'react';

export type SearchSelectOption = { label: string; value: string };

type Props = {
  options: SearchSelectOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  /** When provided, a top "clear" option (value "") shown with this label. */
  emptyLabel?: string;
  disabled?: boolean;
  maxResults?: number;
};

/**
 * A searchable single-select combobox over {label, value} options. Type to
 * filter the dropdown; reusable anywhere a plain <select> would be unwieldy
 * (recipes, stock items, etc.).
 */
export function SearchSelect({
  options,
  value,
  onChange,
  label,
  placeholder = 'Search…',
  emptyLabel,
  disabled,
  maxResults = 50
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const base = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
    return base.slice(0, maxResults);
  }, [options, query, maxResults]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
    setQuery('');
  }

  const inputValue = open ? query : selected ? selected.label : '';

  return (
    <div className="search-select" ref={ref}>
      {label ? <span className="search-select-label">{label}</span> : null}
      <input
        className="search-select-input"
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
        <ul className="search-select-panel" role="listbox">
          {emptyLabel !== undefined ? (
            <li
              className="search-select-option is-clear"
              role="option"
              aria-selected={value === ''}
              onMouseDown={(event) => { event.preventDefault(); pick(''); }}
            >
              {emptyLabel}
            </li>
          ) : null}
          {filtered.length > 0 ? (
            filtered.map((option) => (
              <li
                key={option.value}
                className="search-select-option"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => { event.preventDefault(); pick(option.value); }}
              >
                {option.label}
              </li>
            ))
          ) : (
            <li className="search-select-empty" role="presentation">No matches</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
