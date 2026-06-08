import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { StockCategory, StockItem, StockItemsPayload, VenueStockItem } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard } from '@alma/ui';
import { IconItems } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';
import { ItemForm } from '../features/items/ItemForm';

const UNCATEGORISED_FILTER = '__uncategorised';

type ItemViewMode = 'category' | 'table';

function formatQuantity(value: number, unit: string) {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${formatted} ${unit}`;
}

function formatOptionalQuantity(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return 'Not counted';
  return formatQuantity(value, unit);
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return (value / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function effectivePar(item: StockItem) {
  return item.venueStock?.parLevel ?? item.parLevel;
}

function effectiveReorder(item: StockItem) {
  return item.venueStock?.reorderPoint ?? item.reorderPoint;
}

function effectiveUnit(item: StockItem) {
  return item.venueStock?.unitOverride ?? item.countUnit ?? item.unit;
}

function purchasePackLabel(item: StockItem) {
  const countUnit = item.countUnit ?? item.unit;
  const factor = item.conversionFactor ?? 1;
  if (countUnit === item.unit && factor === 1) return `1 ${item.unit}`;
  const formattedFactor = Number.isInteger(factor) ? String(factor) : factor.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return `1 ${item.unit} = ${formattedFactor} ${countUnit}`;
}

function isLowStock(item: StockItem) {
  const venueStock = item.venueStock;
  if (!venueStock?.active || venueStock.onHand === null) return false;
  const threshold = effectiveReorder(item) ?? effectivePar(item);
  return item.status === 'ACTIVE' && threshold > 0 && venueStock.onHand <= threshold;
}

function isLowVenueStockConfig(row: VenueStockItem) {
  const threshold = row.reorderPoint ?? row.parLevel ?? row.stockItem?.reorderPoint ?? row.stockItem?.parLevel ?? 0;
  return Boolean(
    row.active &&
      row.stockItem?.status === 'ACTIVE' &&
      row.onHand !== null &&
      threshold > 0 &&
      row.onHand <= threshold
  );
}

function duplicateItemKey(item: StockItem) {
  return [
    item.name.trim().toLowerCase().replace(/\s+/g, ' '),
    item.unit.trim().toLowerCase(),
    item.countUnit?.trim().toLowerCase() ?? '',
    String(item.conversionFactor ?? 1),
    item.category?.name.trim().toLowerCase() ?? ''
  ].join('|');
}

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; item: StockItem };

function VenueStockSettingsForm({
  item,
  venue,
  canManage,
  onSaved
}: {
  item: StockItem;
  venue: string;
  canManage: boolean;
  onSaved: (venueStock: VenueStockItem) => void;
}) {
  const [parLevel, setParLevel] = useState(() => item.venueStock?.parLevel?.toString() ?? item.parLevel.toString());
  const [reorderPoint, setReorderPoint] = useState(() => item.venueStock?.reorderPoint?.toString() ?? item.reorderPoint?.toString() ?? '');
  const [unitOverride, setUnitOverride] = useState(() => item.venueStock?.unitOverride ?? '');
  const [active, setActive] = useState(() => item.venueStock?.active ?? (item.status === 'ACTIVE'));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [parSuggestion, setParSuggestion] = useState<{
    avgWeeklyUsage: number | null;
    suggestedPar: number | null;
    currentPar: number | null;
    sampleSize: number;
  } | null>(null);

  useEffect(() => {
    setParLevel(item.venueStock?.parLevel?.toString() ?? item.parLevel.toString());
    setReorderPoint(item.venueStock?.reorderPoint?.toString() ?? item.reorderPoint?.toString() ?? '');
    setUnitOverride(item.venueStock?.unitOverride ?? '');
    setActive(item.venueStock?.active ?? (item.status === 'ACTIVE'));
    setMessage(null);
  }, [item]);

  // Pull 12-week usage history to suggest a par level
  useEffect(() => {
    if (!venue) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<typeof parSuggestion>(
          `/api/items/${item.id}/usage-history?venue=${encodeURIComponent(venue)}&weeks=12`
        );
        if (!cancelled) setParSuggestion(result);
      } catch {
        /* silent — par suggestion is informational only */
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, venue]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!canManage) {
      setMessage('Manager access is required to update venue stock settings.');
      return;
    }
    const par = parLevel.trim() === '' ? undefined : Number(parLevel);
    const reorder = reorderPoint.trim() === '' ? undefined : Number(reorderPoint);
    if ((par !== undefined && (Number.isNaN(par) || par < 0)) || (reorder !== undefined && (Number.isNaN(reorder) || reorder < 0))) {
      setMessage('Par level and reorder point cannot be negative.');
      return;
    }

    setSaving(true);
    try {
      const venueStock = await api<VenueStockItem>(`/api/items/${item.id}/venue-stock`, {
        method: 'PATCH',
        body: JSON.stringify({
          venue,
          parLevel: parLevel.trim(),
          reorderPoint: reorderPoint.trim(),
          unitOverride: unitOverride.trim(),
          active
        })
      });
      onSaved(venueStock);
      setMessage('Venue stock settings saved.');
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'Could not save venue stock settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="venue-stock-settings" onSubmit={handleSubmit}>
      <div>
        <strong>Venue stock settings</strong>
        <p className="subtle">
          {venue}. These controls set local par and reorder levels for this venue without changing the shared catalogue item.
        </p>
      </div>
      <div className="stock-filter-toolbar stock-filter-toolbar-four">
        <Input label="Par level" type="number" min="0" step="0.01" value={parLevel} onChange={(event) => setParLevel(event.currentTarget.value)} />
        <Input label="Reorder point" type="number" min="0" step="0.01" value={reorderPoint} onChange={(event) => setReorderPoint(event.currentTarget.value)} />
        <Input label="Unit override" value={unitOverride} onChange={(event) => setUnitOverride(event.currentTarget.value)} placeholder={item.unit} />
        <label className="venue-stock-toggle">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.currentTarget.checked)} />
          Active at venue
        </label>
      </div>
      <p className="subtle">
        Current on-hand is {formatOptionalQuantity(item.venueStock?.onHand, effectiveUnit(item))}. On-hand is set through approved stocktake movements, not this form.
      </p>
      {parSuggestion && parSuggestion.suggestedPar != null && parSuggestion.sampleSize >= 3 ? (
        <div className={`par-suggestion ${parSuggestion.suggestedPar > (Number(parLevel) || 0) ? 'is-up' : 'is-down'}`}>
          <span className="par-suggestion-eyebrow">12-week usage suggests</span>
          <strong>par of {parSuggestion.suggestedPar}</strong>
          <span className="par-suggestion-meta">
            avg {parSuggestion.avgWeeklyUsage?.toFixed(1) ?? '—'}/wk × 1.4 buffer · {parSuggestion.sampleSize} usable week{parSuggestion.sampleSize === 1 ? '' : 's'} of data
          </span>
          {String(parSuggestion.suggestedPar) !== parLevel ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setParLevel(String(parSuggestion.suggestedPar))}
            >
              Apply suggestion →
            </Button>
          ) : (
            <span className="par-suggestion-meta">Current par matches suggestion</span>
          )}
        </div>
      ) : null}
      {message ? <p className="form-message">{message}</p> : null}
      <Button type="submit" size="sm" disabled={!canManage || saving}>
        {saving ? 'Saving...' : 'Save venue settings'}
      </Button>
    </form>
  );
}

export function ItemsPage() {
  useDocumentTitle('Items');
  const { user } = useAuth();
  const canManage = canManageStock(user);
  const [data, setData] = useState<StockItemsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [exportingItems, setExportingItems] = useState(false);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkStatus, setBulkStatus] = useState<'' | 'ACTIVE' | 'ARCHIVED'>('');
  const [bulkCountAreaOn, setBulkCountAreaOn] = useState(false);
  const [bulkCountArea, setBulkCountArea] = useState('');
  const [bulkVenueActive, setBulkVenueActive] = useState<'' | 'active' | 'inactive'>('');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedVenue, setSelectedVenue] = useState('');
  const [viewMode, setViewMode] = useState<ItemViewMode>('category');

  useEffect(() => {
    let cancelled = false;

    async function loadItems() {
      try {
        const query = selectedVenue ? `?venue=${encodeURIComponent(selectedVenue)}` : '';
        const payload = await api<StockItemsPayload>(`/api/items${query}`);
        if (!cancelled) {
          setData(payload);
          if (!selectedVenue && payload.scope?.venue) {
            setSelectedVenue(payload.scope.venue);
          }
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
  }, [selectedVenue, reloadKey]);

  const activeVenue = selectedVenue || data?.scope?.venue || '';

  const stats = useMemo(() => {
    const items = data?.items ?? [];
    const venueRows = data?.venueStockItems ?? [];
    return {
      active: items.filter((item) => item.status === 'ACTIVE').length,
      lowStock: activeVenue ? items.filter(isLowStock).length : venueRows.filter(isLowVenueStockConfig).length,
      categories: data?.categories.length ?? 0
    };
  }, [activeVenue, data]);

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
  const venueOptions = useMemo(
    () => [
      ...(data?.scope?.admin ? [{ label: 'All venues', value: '' }] : []),
      ...(data?.venues ?? []).map((venue) => ({ label: venue, value: venue }))
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

  function handleVenueStockSaved(venueStock: VenueStockItem) {
    setData((current) => {
      if (!current) return current;
      const nextItems = current.items.map((item) =>
        item.id === venueStock.stockItemId
          ? {
              ...item,
              venueStock: venueStock.venue === activeVenue ? venueStock : item.venueStock
            }
          : item
      );
      const existingRows = current.venueStockItems ?? [];
      const nextVenueRows = existingRows.some((row) => row.id === venueStock.id)
        ? existingRows.map((row) => (row.id === venueStock.id ? venueStock : row))
        : [...existingRows, venueStock];
      return { ...current, items: nextItems, venueStockItems: nextVenueRows };
    });
    if (form.mode === 'edit' && form.item.id === venueStock.stockItemId && venueStock.venue === activeVenue) {
      setForm({ mode: 'edit', item: { ...form.item, venueStock } });
    }
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

  async function applyBulkEdit() {
    if (selectedIds.size === 0 || bulkBusy) return;
    if (!canManage) {
      setError('Manager access is required to edit stock items.');
      return;
    }
    const payload: Record<string, unknown> = { ids: Array.from(selectedIds) };
    if (bulkCategory === '__none__') payload.categoryId = null;
    else if (bulkCategory) payload.categoryId = bulkCategory;
    if (bulkStatus) payload.status = bulkStatus;
    if (bulkCountAreaOn) payload.countArea = bulkCountArea.trim() || null;
    if (bulkVenueActive && activeVenue) {
      payload.venue = activeVenue;
      payload.venueActive = bulkVenueActive === 'active';
    }
    if (!('categoryId' in payload) && !('status' in payload) && !('countArea' in payload) && !('venue' in payload)) {
      setError('Choose at least one field to change.');
      return;
    }
    setBulkBusy(true);
    setError(null);
    try {
      await api<{ updated: number; venueUpdated: number }>('/api/items/bulk', { method: 'POST', body: JSON.stringify(payload) });
      setSelectedIds(new Set());
      setBulkOpen(false);
      setBulkCategory('');
      setBulkStatus('');
      setBulkCountAreaOn(false);
      setBulkCountArea('');
      setBulkVenueActive('');
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not bulk-edit items.');
    } finally {
      setBulkBusy(false);
    }
  }

  async function downloadItemsCsv() {
    setExportingItems(true);
    setError(null);
    try {
      const token = window.localStorage.getItem('alma.stock.session');
      const res = await fetch('/api/items/export.csv', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        credentials: 'include'
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'alma-stock-items.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export items CSV');
    } finally {
      setExportingItems(false);
    }
  }

  async function deleteSelectedItems() {
    if (selectedIds.size === 0) return;
    if (!canManage) {
      setError('Manager access is required to delete stock items.');
      return;
    }
    const ids = Array.from(selectedIds);
    const sampleNames = selectedItems
      .slice(0, 3)
      .map((item) => item.name)
      .join(', ');
    const confirmed = confirmDangerousAction({
      title: `Delete ${ids.length} catalogue item${ids.length === 1 ? '' : 's'}?`,
      message:
        `${sampleNames ? `${sampleNames}${ids.length > 3 ? ', ...' : ''}\n\n` : ''}` +
        'This removes catalogue records only when they are not used by recipes, stocktakes, inventory movements, or invoices. Use Archive for live or referenced items.',
      confirmationText: 'DELETE ITEMS'
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const idSet = new Set(ids);
      await api<{ deleted: number }>('/api/items', {
        method: 'DELETE',
        body: JSON.stringify({ ids, confirmationText: 'DELETE ITEMS' })
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
      : 'Venue catalogue — products, categories and pars.';

  function renderItemRows(items: StockItem[]) {
    return items.map((item) => (
      <tr
        key={item.id}
        className={`${canManage ? 'row-interactive' : ''} ${selectedIds.has(item.id) ? 'stock-selected-row' : ''}`}
        onClick={() => {
          if (canManage) setForm({ mode: 'edit', item });
        }}
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
        <td>
          <span className="cell-stack">
            <span>{purchasePackLabel(item)}</span>
            <span className="subtle">
              {formatCurrency(item.avgCostCents)} / {effectiveUnit(item)}
              {item.latestCostCents !== null ? ` from ${formatCurrency(item.latestCostCents)} / ${item.unit}` : ''}
            </span>
          </span>
        </td>
        <td>
          <span className="cell-stack">
            <span>{formatOptionalQuantity(item.totalOnHand ?? item.venueStock?.onHand ?? item.onHand, effectiveUnit(item))}</span>
            <span className="subtle">
              {activeVenue && item.venueStock
                ? `both venues · ${formatOptionalQuantity(item.venueStock.onHand, effectiveUnit(item))} at ${activeVenue}`
                : 'both venues combined'}
            </span>
          </span>
        </td>
        <td>{formatQuantity(effectivePar(item), effectiveUnit(item))}</td>
        <td>{effectiveReorder(item) === null ? '—' : formatQuantity(effectiveReorder(item) ?? 0, effectiveUnit(item))}</td>
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
            disabled={!canManage}
            title={canManage ? undefined : 'Manager access required'}
            onClick={(event) => {
              event.stopPropagation();
              if (canManage) setForm({ mode: 'edit', item });
            }}
          >
            {canManage ? 'Edit' : 'View only'}
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
            <th>Pack / cost</th>
            <th>On hand</th>
            <th>Par</th>
            <th>Reorder</th>
            <th>Status</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.length > 0 ? (
            renderItemRows(items)
          ) : (
            <tr>
              <td colSpan={9} className="table-empty-cell">
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
          hint="Catalogue items"
        />
        <StatCard
          label="Low stock"
          value={loading ? '—' : String(stats.lowStock)}
          hint={
            activeVenue
              ? `Venue levels for ${activeVenue}`
              : data?.scope?.admin
                ? 'Venue rows across all venues'
                : 'Choose a venue for local levels'
          }
          tone={stats.lowStock > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Venue stock"
          value={
            loading
              ? '—'
              : String(
                  activeVenue
                    ? (data?.venueStockItems ?? []).filter((row) => row.venue === activeVenue).length
                    : data?.venueStockItems?.length ?? 0
                )
          }
          hint={activeVenue ? 'Configured at selected venue' : 'Configured venue rows'}
        />
      </div>

      <Card
        title={cardTitle}
        subtitle={cardSubtitle}
        action={
          form.mode === 'closed' ? (
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={exportingItems}
                title="Download the whole catalogue as a CSV (item, sku, category, count area, status)"
                onClick={() => void downloadItemsCsv()}
              >
                {exportingItems ? 'Exporting…' : 'Export CSV'}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!canManage}
                title={canManage ? undefined : 'Manager access required'}
                onClick={() => setForm({ mode: 'create' })}
              >
                {canManage ? 'New item' : 'Manager required'}
              </Button>
            </div>
          ) : null
        }
      >
        {form.mode === 'create' ? (
          <ItemForm
            mode="create"
            categories={data?.categories ?? []}
            onSaved={handleItemCreated}
            onCategoryCreated={handleCategoryCreated}
            canManageCategories={canManage}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : form.mode === 'edit' ? (
          <div className="stock-edit-stack">
            <ItemForm
              mode="edit"
              initial={form.item}
              categories={data?.categories ?? []}
              onSaved={handleItemUpdated}
              onCategoryCreated={handleCategoryCreated}
              canManageCategories={canManage}
              onCancel={() => setForm({ mode: 'closed' })}
            />
            {activeVenue ? (
              <VenueStockSettingsForm
                item={form.item}
                venue={activeVenue}
                canManage={canManage}
                onSaved={handleVenueStockSaved}
              />
            ) : (
              <EmptyState
                icon={<IconItems size={24} />}
                title="Choose a venue"
                description="Select a venue to edit local par, reorder and active settings for this catalogue item."
              />
            )}
          </div>
        ) : loading ? (
          <Spinner label="Loading items" />
        ) : error ? (
          <EmptyState icon={<IconItems size={24} />} title="Items unavailable" description={error} />
        ) : data && data.items.length > 0 ? (
          <div className="table-card stock-items-table">
            <div className="stock-filter-toolbar stock-filter-toolbar-four">
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
                label="Venue stock"
                value={selectedVenue}
                onChange={(event) => setSelectedVenue(event.currentTarget.value)}
                options={venueOptions}
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
                      disabled={deleting || bulkBusy}
                    >
                      Clear
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setBulkOpen((value) => !value)}
                      disabled={deleting || bulkBusy || !canManage}
                      title={canManage ? undefined : 'Manager access required'}
                    >
                      {bulkOpen ? 'Close bulk edit' : 'Bulk edit'}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => void deleteSelectedItems()}
                      disabled={deleting || bulkBusy || !canManage}
                      title={canManage ? undefined : 'Manager access required'}
                    >
                      {deleting
                        ? 'Deleting...'
                        : canManage
                          ? 'Delete selected'
                          : 'Manager required'}
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
            {bulkOpen && selectedIds.size > 0 ? (
              <div className="stock-bulk-edit-panel">
                <span className="stock-bulk-edit-title">Bulk edit {selectedIds.size} item{selectedIds.size === 1 ? '' : 's'} — only the fields you set are changed.</span>
                <div className="stock-bulk-edit-grid">
                  <Select
                    label="Category"
                    value={bulkCategory}
                    onChange={(event) => setBulkCategory(event.currentTarget.value)}
                    options={[
                      { label: '— leave unchanged —', value: '' },
                      { label: 'Uncategorised', value: '__none__' },
                      ...(data?.categories ?? []).map((category) => ({ label: category.name, value: category.id }))
                    ]}
                  />
                  <Select
                    label="Status"
                    value={bulkStatus}
                    onChange={(event) => setBulkStatus(event.currentTarget.value as '' | 'ACTIVE' | 'ARCHIVED')}
                    options={[
                      { label: '— leave unchanged —', value: '' },
                      { label: 'Active', value: 'ACTIVE' },
                      { label: 'Archived', value: 'ARCHIVED' }
                    ]}
                  />
                  <div className="stock-bulk-edit-area">
                    <label className="stock-bulk-edit-check">
                      <input type="checkbox" checked={bulkCountAreaOn} onChange={(event) => setBulkCountAreaOn(event.currentTarget.checked)} />
                      <span>Set count area</span>
                    </label>
                    <Input label="" placeholder="e.g. Cool room" value={bulkCountArea} disabled={!bulkCountAreaOn} onChange={(event) => setBulkCountArea(event.currentTarget.value)} />
                  </div>
                  <Select
                    label={activeVenue ? `Active at ${activeVenue}` : 'Active at venue'}
                    value={bulkVenueActive}
                    disabled={!activeVenue}
                    onChange={(event) => setBulkVenueActive(event.currentTarget.value as '' | 'active' | 'inactive')}
                    options={[
                      { label: '— leave unchanged —', value: '' },
                      { label: 'Active here', value: 'active' },
                      { label: 'Inactive here', value: 'inactive' }
                    ]}
                  />
                </div>
                <div className="stock-bulk-edit-actions">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setBulkOpen(false)} disabled={bulkBusy}>Cancel</Button>
                  <Button type="button" variant="primary" size="sm" onClick={() => void applyBulkEdit()} disabled={bulkBusy}>
                    {bulkBusy ? 'Applying…' : `Apply to ${selectedIds.size}`}
                  </Button>
                </div>
              </div>
            ) : null}
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
              <Button
                type="button"
                disabled={!canManage}
                title={canManage ? undefined : 'Manager access required'}
                onClick={() => setForm({ mode: 'create' })}
              >
                {canManage ? 'Add the first item' : 'Manager required'}
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}
