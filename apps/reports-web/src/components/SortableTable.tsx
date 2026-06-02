import { useMemo, useState, type ReactNode } from 'react';

export type SortableColumn<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  // Value used for sorting. Omit to make a column non-sortable. Nulls sort last.
  sortValue?: (row: T) => number | string | null | undefined;
  render: (row: T) => ReactNode;
};

// A drop-in replacement for the hand-written report tables that adds
// click-to-sort on any column (asc/desc, nulls last). Sort state is owned by
// this component so it's safe to use inside the section render functions
// without tripping rules-of-hooks.
export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir = 'desc',
  className = 'report-table',
  footer
}: {
  columns: SortableColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string | number;
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  className?: string;
  // Optional totals row(s); rendered inside <tfoot> and not affected by sort.
  footer?: ReactNode;
}) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [dir, setDir] = useState<'asc' | 'desc'>(defaultSortDir);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const accessor = col.sortValue;
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const an = av == null;
      const bn = bv == null;
      if (an && bn) return 0;
      if (an) return 1;
      if (bn) return -1;
      const cmp =
        typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, columns, sortKey, dir]);

  function onHeader(col: SortableColumn<T>) {
    if (!col.sortValue) return;
    if (sortKey === col.key) {
      setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setDir('desc');
    }
  }

  return (
    <table className={className}>
      <thead>
        <tr>
          {columns.map((col) => {
            const sortable = Boolean(col.sortValue);
            const active = sortKey === col.key;
            return (
              <th
                key={col.key}
                className={
                  [col.className, sortable ? 'report-th-sortable' : '', active ? 'is-active' : '']
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                style={col.align ? { textAlign: col.align } : undefined}
                onClick={sortable ? () => onHeader(col) : undefined}
                aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                role={sortable ? 'button' : undefined}
                tabIndex={sortable ? 0 : undefined}
                onKeyDown={
                  sortable
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onHeader(col);
                        }
                      }
                    : undefined
                }
              >
                {col.label}
                {sortable ? (
                  <span className="report-sort-caret" aria-hidden="true">
                    {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
                  </span>
                ) : null}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((row, index) => (
          <tr key={rowKey(row, index)}>
            {columns.map((col) => (
              <td
                key={col.key}
                className={col.className}
                style={col.align ? { textAlign: col.align } : undefined}
              >
                {col.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer ? <tfoot>{footer}</tfoot> : null}
    </table>
  );
}
