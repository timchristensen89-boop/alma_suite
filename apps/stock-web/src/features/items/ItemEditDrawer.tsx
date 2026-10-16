import { useEffect, useState } from 'react';
import type { StockCategory, StockItem } from '@alma/shared';
import { Button, Spinner } from '@alma/ui';
import { ApiError, api } from '../../lib/api';
import { ItemForm } from './ItemForm';

/**
 * The Items page's edit form, opened over the counting screen so a wrong
 * name, unit, category or price gets fixed where it is noticed — without
 * leaving the shelf. It is the same form, so the rules are the same: the
 * item changes everywhere; counts already entered keep their numbers.
 */
export function ItemEditDrawer({
  itemId,
  categories,
  canRemoveLine,
  onCategoryCreated,
  onSaved,
  onRemoveLine,
  onClose
}: {
  itemId: string;
  categories: StockCategory[];
  canRemoveLine: boolean;
  onCategoryCreated: (category: StockCategory) => void;
  onSaved: (item: StockItem) => void;
  onRemoveLine?: () => void;
  onClose: () => void;
}) {
  const [item, setItem] = useState<StockItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItem(null);
    setError(null);
    void (async () => {
      try {
        const full = await api<StockItem>(`/api/items/${itemId}`);
        if (!cancelled) setItem(full);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the item');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="count-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="count-drawer" role="dialog" aria-modal="true" aria-label="Edit item">
        <header className="count-drawer-head">
          <strong>{item ? item.name : 'Edit item'}</strong>
          <button type="button" className="count-drawer-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="count-drawer-body">
          {error ? <p className="error-text">{error}</p> : null}
          {!item && !error ? <Spinner label="Loading item" /> : null}
          {item ? (
            <ItemForm
              mode="edit"
              initial={item}
              categories={categories}
              canManageCategories={false}
              onCategoryCreated={onCategoryCreated}
              onSaved={onSaved}
              onCancel={onClose}
            />
          ) : null}
          {item && canRemoveLine && onRemoveLine ? (
            <div className="count-drawer-foot">
              <span className="subtle">Not stocked here any more?</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => { if (window.confirm(`Remove ${item.name} from this count? The item itself is kept.`)) onRemoveLine(); }}>
                Remove from this count
              </Button>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
