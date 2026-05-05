import { useEffect, useMemo, useState } from 'react';
import type { StockCategory, StockItem, StockItemsPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard } from '@alma/ui';
import { IconItems } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { ItemForm } from '../features/items/ItemForm';

const UNCATEGORISED_FILTER = '__uncategorised';

type ItemViewMode = 'category' | 'table';

function formatQuantity(value: number, unit: string) {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${formatted} ${unit}`;
}

function isLowStock(item: StockItem) {
  const threshold = item.reorderPoint ?? item.parLevel;
  return item.status === 'ACTIVE' && threshold > 0 && item.onHand <= threshold;
}

function duplicateItemKey(item: StockItem) {
  return [
    item.name.trim().toLowerCase().replace(/\s+/g, ' '),
    item.unit.trim().toLowerCase(),
    item.category?.name.trim().toLowerCase() ?? ''
  ].join('|');
}

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; item: StockItem };

export function ItemsPage() {
  useDocumentTitle('Items');
  const [data, setData] = useState<StockItemsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [viewMode, setViewMode] = useState<ItemViewMode>('category');

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      try {
        const payload = await api<StockItemsPayload>('/api/items');
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Could not load items';
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadItems();

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const items = data?.items ?? [];
    return {
      active: items.filter((item) => item.status === 'ACTIVE').length,
      lowStock: items.filter(isLowStock).length,
      categories: data?.categories.length ?? 0
    };
  }, [data]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, StockItem[]>();
    for (const item of data?.items ?? []) {
      const key = duplicateItemKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return Array.from(groups.values()).filter((group) => group.length > 1);
  }, [data]);

  const duplicateExtraIds = useMemo(
    () => duplicateGroups.flatMap((group) => group.slice(1).map((item) => item.id)),
    [duplicateGroups]
  );

  const duplicateIds = useMemo(
    () => new Set(duplicateGroups.flatMap((group) => group.map((item) => item.id))),
    [duplicateGroups]
  );

  const selectedItems = useMemo(() => {
    const items = data?.items ?? [];
    return items.filter((item) => selectedIds.has(item.id));
  }, [data, selectedIds]);

  const categoryOptions = useMemo(
    () => [
      { label: 'All categories', value: '' },
      { label: 'Uncategorised', value: UNCATEGORISED_FILTER },
      ...(data?.categories ?? []).map((category) => ({
        label: category.name,
        value: category.id
      }))
    ],
    [data]
  );

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((item) => {
        if (categoryFilter === UNCATEGORISED_FILTER && item.categoryId) return false;
        if (
          categoryFilter &&
          categoryFilter !== UNCATEGORISED_FILTER &&
          item.categoryId !== categoryFilter
        ) {
          return false;
        }
        if (!needle) return true;

        const haystack = [
          item.name,
          item.sku ?? '',
          item.category?.name ?? '',
          item.unit,
          item.notes ?? ''
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => {
        const categoryA = a.category?.name ?? 'Uncategorised';
        const categoryB = b.category?.name ?? 'Uncategorised';
        return categoryA.localeCompare(categoryB) || a.name.localeCompare(b.name);
      });
  }, [data, search, categoryFilter]);

  const itemCategoryGroups = useMemo(() => {
    const groups = new Map<
      string,
      { id: string; name: string; items: StockItem[]; lowStockCount: number }
    >();

    for (const item of filteredItems) {
      const id = item.categoryId ?? UNCATEGORISED_FILTER;
      const name = item.category?.name ?? 'Uncategorised';
      const existing = groups.get(id) ?? { id, name, items: [], lowStockCount: 0 };
      existing.items.push(item);
      if (isLowStock(item)) existing.lowStockCount += 1;
      groups.set(id, existing);
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.id === UNCATEGORISED_FILTER) return 1;
      if (b.id === UNCATEGORISED_FILTER) return -1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredItems]);

  function handleItemCreated(item: StockItem) {
    // Insert locally to avoid a refetch round-trip; sort by name so it lands
    // in the right place.
    setData((current) => {
      const existing = current ?? { items: [], categories: [] };
      const nextItems = [...existing.items, item].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      return { ...existing, items: nextItems };
    });
    setForm({ mode: 'closed' });
  }

  function handleItemUpdated(item: StockItem) {
    setData((current) => {
      const existing = current ?? { items: [], categories: [] };
      const nextItems = existing.items
        .map((i) => (i.id === item.id ? item : i))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ...existing, items: nextItems };
    });
    setForm({ mode: 'closed' });
  }

  function handleCategoryCreated(category: StockCategory) {
    setData((current) => {
      const existing = current ?? { items: [], categories: [] };
      if (existing.categories.some((c) => c.id === category.id)) return existing;
      const nextCategories = [...existing.categories, category].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
      return { ...existing, categories: nextCategories };
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleItemSelection(items: StockItem[]) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (items.every((item) => next.has(item.id))) {
        items.forEach((item) => next.delete(item.id));
      } else {
        items.forEach((item) => next.add(item.id));
      }
      return next;
    });
  }

  async function deleteSelectedItems() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const sampleNames = selectedItems
      .slice(0, 3)
      .map((item) => item.name)
      .join(', ');
    const confirmed = window.confirm(
      `Delete ${ids.length} stock item${ids.length === 1 ? '' : 's'}?` +
        (sampleNames ? `\n\n${sampleNames}${ids.length > 3 ? ', ...' : ''}` : '') +
        '\n\nThis cannot be undone.'
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const idSet = new Set(ids);
      await api<{ deleted: number }>('/api/items', {
        method: 'DELETE',
        body: JSON.stringify({ ids })
      });
      setData((current) =>
        current
          ? { ...current, items: current.items.filter((item) => !idSet.has(item.id)) }
          : current
      );
      if (form.mode === 'edit' && idSet.has(form.item.id)) {
        setForm({ mode: 'closed' });
      }
      setSelectedIds(new Set());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete items');
    } finally {
      setDeleting(false);
    }
  }

  const cardTitle = form.mode === 'edit' ? `Editing ${form.item.name}` : 'Items';
  const cardSubtitle =
    form.mode === 'edit'
      ? 'Update this item — changes save in place.'
      : 'Your catalogue — products, categories and pars.';

  function renderItemRows(items: StockItem[]) {
    return items.map((item) => (
      <tr
        key={item.id}
        className={`row-interactive ${selectedIds.has(item.id) ? 'stock-selected-row' : ''}`}
        onClick={() => setForm({ mode: 'edit', item })}
      >
        <td className="select-cell">
          <input
            type="checkbox"
            aria-label={`Select ${item.name}`}
            checked={selectedIds.has(item.id)}
            onClick={(event) => event.stopPropagation()}
            onChange={() => toggleSelected(item.id)}
          />
        </td>
        <td>
          <span className="cell-stack">
            <strong>{item.name}</strong>
            <span className="subtle">
              {item.sku ?? 'No SKU'}
              {duplicateIds.has(item.id) ? (
                <span className="stock-duplicate-hint">Possible duplicate</span>
              ) : null}
            </span>
          </span>
        </td>
        <td>{item.category?.name ?? 'Uncategorised'}</td>
        <td>{formatQuantity(item.onHand, item.unit)}</td>
        <td>{formatQuantity(item.parLevel, item.unit)}</td>
        <td>
          <Badge
            tone={isLowStock(item) ? 'warning' : item.status === 'ACTIVE' ? 'positive' : 'muted'}
            dot
          >
            {isLowStock(item) ? 'LOW' : item.status}
          </Badge>
        </td>
        <td className="cell-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setForm({ mode: 'edit', item });
            }}
          >
            Edit
          </Button>
        </td>
      </tr>
    ));
  }

  function renderItemsTable(items: StockItem[], emptyMessage: string) {
    const allRowsSelected = Boolean(
      items.length && items.every((item) => selectedIds.has(item.id))
    );

    return (
      <table>
        <thead>
          <tr>
            <th className="select-cell">
              <input
                type="checkbox"
                aria-label="Select visible items"
                checked={allRowsSelected}
                onChange={() => toggleItemSelection(items)}
              />
            </th>
            <th>Item</th>
            <th>Category</th>
            <th>On hand</th>
            <th>Par</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            renderItemRows(items)
          ) : (
            <tr>
              <td colSpan={7} className="table-empty-cell">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard
          icon={<IconItems size={18} />}
          label="Active items"
          value={loading ? '—' : String(stats.active)}
          hint="Tracked in the catalogue"
        />
        <StatCard
          label="Low stock"
          value={loading ? '—' : String(stats.lowStock)}
          hint="At or below reorder point"
          tone={stats.lowStock > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Categories"
          value={loading ? '—' : String(stats.categories)}
          hint="Catalogue groupings"
        />
      </div>

      <Card
        title={cardTitle}
        subtitle={cardSubtitle}
        action={
          form.mode === 'closed' ? (
            <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
              New item
            </Button>
          ) : null
        }
      >
        {form.mode === 'create' ? (
          <ItemForm
            mode="create"
            categories={data?.categories ?? []}
            onSaved={handleItemCreated}
            onCategoryCreated={handleCategoryCreated}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : form.mode === 'edit' ? (
          <ItemForm
            mode="edit"
            initial={form.item}
            categories={data?.categories ?? []}
            onSaved={handleItemUpdated}
            onCategoryCreated={handleCategoryCreated}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : loading ? (
          <Spinner label="Loading items" />
        ) : error ? (
          <EmptyState icon={<IconItems size={24} />} title="Items unavailable" description={error} />
        ) : data && data.items.length > 0 ? (
          <div className="table-card stock-items-table">
            <div className="stock-filter-toolbar stock-filter-toolbar-three">
              <Input
                label="Search"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search items, SKU or notes"
              />
              <Select
                label="Category"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.currentTarget.value)}
                options={categoryOptions}
              />
              <Select
                label="View"
                value={viewMode}
                onChange={(event) => setViewMode(event.currentTarget.value as ItemViewMode)}
                options={[
                  { label: 'By category', value: 'category' },
                  { label: 'Table', value: 'table' }
                ]}
              />
            </div>
            <div className="table-toolbar stock-bulk-toolbar">
              <span>
                {selectedIds.size > 0
                  ? `${selectedIds.size} selected`
                  : `${filteredItems.length} of ${data.items.length} catalogue items`}
              </span>
              <span className="table-toolbar-right stock-bulk-actions">
                {duplicateExtraIds.length > 0 && selectedIds.size === 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedIds(new Set(duplicateExtraIds))}
                  >
                    Select duplicate extras
                  </Button>
                ) : null}
                {selectedIds.size > 0 ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedIds(new Set())}
                      disabled={deleting}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteSelectedItems()}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting...' : 'Delete selected'}
                    </Button>
                  </>
                ) : stats.lowStock > 0 ? (
                  `${stats.lowStock} need attention`
                ) : duplicateGroups.length > 0 ? (
                  `${duplicateGroups.length} duplicate groups`
                ) : (
                  'Stock levels steady'
                )}
              </span>
            </div>
            {viewMode === 'category' ? (
              <div className="stock-category-groups">
                {itemCategoryGroups.length > 0 ? (
                  itemCategoryGroups.map((group) => (
                    <section key={group.id} className="stock-category-group">
                      <div className="stock-category-group-head">
                        <span>
                          <strong>{group.name}</strong>
                          <span className="subtle">
                            {group.items.length} item{group.items.length === 1 ? '' : 's'}
                          </span>
                        </span>
                        <span className="stock-category-mini-stats">
                          {group.lowStockCount > 0
                            ? `${group.lowStockCount} low`
                            : 'Levels steady'}
                        </span>
                      </div>
                      {renderItemsTable(group.items, 'No items in this category.')}
                    </section>
                  ))
                ) : (
                  <div className="table-empty-cell">No items match the current filters.</div>
                )}
              </div>
            ) : (
              renderItemsTable(filteredItems, 'No items match the current filters.')
            )}
          </div>
        ) : (
          <EmptyState
            icon={<IconItems size={24} />}
            title="No items yet"
            description="Add products, group them into categories and set par levels here."
            action={
              <Button type="button" onClick={() => setForm({ mode: 'create' })}>
                Add the first item
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}
