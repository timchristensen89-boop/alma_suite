import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

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

type PanelCoords = {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

/**
 * A searchable single-select combobox over {label, value} options. Type to
 * filter the dropdown; reusable anywhere a plain <select> would be unwieldy
 * (recipes, stock items, etc.).
 *
 * The results panel renders in a portal to <body> with fixed positioning, so it
 * is never clipped by an ancestor with `overflow` (cards, scroll areas) and
 * always lands inside the viewport — flipping above the input when there's more
 * room above than below.
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
  const [coords, setCoords] = useState<PanelCoords | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLUListElement | null>(null);

  const selected = useMemo(() => options.find((option) => option.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const base = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
    return base.slice(0, maxResults);
  }, [options, query, maxResults]);

  const updateCoords = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    // Flip up only when there genuinely isn't room below and there's more above.
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    if (openUp) {
      setCoords({
        left: rect.left,
        width: rect.width,
        bottom: window.innerHeight - rect.top + 4,
        maxHeight: Math.max(140, spaceAbove - margin)
      });
    } else {
      setCoords({
        left: rect.left,
        width: rect.width,
        top: rect.bottom + 4,
        maxHeight: Math.max(140, spaceBelow - margin)
      });
    }
  }, []);

  // Keep the floating panel pinned to the input while open, even as the page
  // scrolls or resizes (capture:true catches scrolls in any ancestor too).
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    updateCoords();
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open, updateCoords]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      // The panel lives in a portal (outside the wrapper), so check both.
      if (wrapperRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
      setQuery('');
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
    <div className="search-select" ref={wrapperRef}>
      {label ? <span className="search-select-label">{label}</span> : null}
      <input
        ref={inputRef}
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
      {open && coords && typeof document !== 'undefined'
        ? createPortal(
            <ul
              ref={panelRef}
              className="search-select-panel search-select-panel--floating"
              role="listbox"
              style={{
                position: 'fixed',
                left: coords.left,
                width: coords.width,
                top: coords.top,
                bottom: coords.bottom,
                right: 'auto',
                maxHeight: coords.maxHeight,
                overflowY: 'auto',
                zIndex: 2000
              }}
            >
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
            </ul>,
            document.body
          )
        : null}
    </div>
  );
}
