import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  ApplyStocktakeResult,
  StockItem,
  StockItemsPayload,
  Stocktake,
  StocktakeLineInput,
  StocktakeStatus,
  StocktakeWithLines,
  StocktakesPayload,
  StocktakesSummary
} from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; stocktake: StocktakeWithLines };

type LineDraft = {
  itemId: string;
  label: string;
  countedQty: string;
  unit: string;
  location: string;
  stockValueCents: string;
  notes: string;
};

type StocktakeDraft = {
  name: string;
  venue: string;
  template: string;
  countedAt: string;
  status: StocktakeStatus;
  notes: string;
  lines: LineDraft[];
};

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatQuantity(qty: number, unit: string | null) {
  const value = Number.isInteger(qty) ? String(qty) : qty.toFixed(2);
  return unit ? `${value} ${unit}` : value;
}

function emptyLine(item?: StockItem): LineDraft {
  const value = item?.avgCostCents ? Math.round(item.avgCostCents * (item.onHand || 0)) : '';
  return {
    itemId: item?.id ?? '',
    label: item?.name ?? '',
    countedQty: item ? String(item.onHand) : '0',
    unit: item?.unit ?? '',
    location: item?.category?.name ?? '',
    stockValueCents: value === '' ? '' : String(value),
    notes: ''
  };
}

function emptyDraft(items: StockItem[]): StocktakeDraft {
  return {
    name: `Stocktake ${new Date().toLocaleDateString()}`,
    venue: '',
    template: 'Full count',
    countedAt: formatDateTimeInput(new Date().toISOString()),
    status: 'IN_PROGRESS',
    notes: '',
    lines: items.filter((item) => item.status === 'ACTIVE').map(emptyLine)
  };
}

function draftFromStocktake(stocktake: StocktakeWithLines): StocktakeDraft {
  return {
    name: stocktake.name,
    venue: stocktake.venue ?? '',
    template: stocktake.template ?? '',
    countedAt: formatDateTimeInput(stocktake.countedAt),
    status: stocktake.status,
    notes: stocktake.notes ?? '',
    lines: stocktake.lines.map((line) => ({
      itemId: line.itemId ?? '',
      label: line.label,
      countedQty: String(line.countedQty),
      unit: line.unit ?? line.item?.unit ?? '',
      location: line.location ?? '',
      stockValueCents: line.stockValueCents === null ? '' : String(line.stockValueCents),
      notes: line.notes ?? ''
    }))
  };
}

function linePayload(line: LineDraft): StocktakeLineInput {
  return {
    itemId: line.itemId,
    label: line.label.trim(),
    countedQty: Number(line.countedQty || 0),
    unit: line.unit.trim(),
    location: line.location.trim(),
    stockValueCents: line.stockValueCents === '' ? undefined : Math.round(Number(line.stockValueCents)),
    notes: line.notes.trim()
  };
}

export function StocktakePage() {
  useDocumentTitle('Stocktake');

  const [data, setData] = useState<StocktakesPayload | null>(null);
  const [summary, setSummary] = useState<StocktakesSummary | null>(null);
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StocktakeWithLines | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [list, sum, itemPayload] = await Promise.all([
        api<StocktakesPayload>('/api/stocktake'),
        api<StocktakesSummary>('/api/stocktake/summary'),
        api<StockItemsPayload>('/api/items')
      ]);
      setData(list);
      setSummary(sum);
      setItems(itemPayload.items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load stocktakes');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [] as Stocktake[];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.stocktakes;
    return data.stocktakes.filter((stocktake) =>
      [stocktake.name, stocktake.venue ?? '', stocktake.template ?? ''].join(' ').toLowerCase().includes(needle)
    );
  }, [data, search]);

  const selectedStocktakes = useMemo(
    () => (data?.stocktakes ?? []).filter((stocktake) => selectedIds.has(stocktake.id)),
    [data, selectedIds]
  );

  const allVisibleSelected = Boolean(
    filtered.length && filtered.every((stocktake) => selectedIds.has(stocktake.id))
  );

  async function toggleRow(stocktake: Stocktake) {
    if (expandedId === stocktake.id) {
      setExpandedId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(stocktake.id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      setDetail(await api<StocktakeWithLines>(`/api/stocktake/${stocktake.id}`));
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not load stocktake lines');
    } finally {
      setDetailLoading(false);
    }
  }

  async function editStocktake(stocktake: Stocktake) {
    if (stocktake.appliedAt) {
      setDetailError('Applied stocktakes cannot be edited.');
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const full = await api<StocktakeWithLines>(`/api/stocktake/${stocktake.id}`);
      setForm({ mode: 'edit', stocktake: full });
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not load stocktake');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleSaved() {
    setForm({ mode: 'closed' });
    setExpandedId(null);
    setDetail(null);
    await load();
  }

  async function applyStocktake(stocktake: Stocktake) {
    const confirmed = window.confirm(
      `Apply "${stocktake.name}" to inventory balances?\n\nThis creates ledger movements and cannot be run twice.`
    );
    if (!confirmed) return;

    setApplyingId(stocktake.id);
    setError(null);
    try {
      await api<ApplyStocktakeResult>(`/api/stocktake/${stocktake.id}/apply`, {
        method: 'POST'
      });
      setExpandedId(null);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not apply stocktake');
    } finally {
      setApplyingId(null);
    }
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

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (filtered.every((stocktake) => next.has(stocktake.id))) {
        filtered.forEach((stocktake) => next.delete(stocktake.id));
      } else {
        filtered.forEach((stocktake) => next.add(stocktake.id));
      }
      return next;
    });
  }

  async function deleteSelectedStocktakes() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const sampleNames = selectedStocktakes
      .slice(0, 3)
      .map((stocktake) => stocktake.name)
      .join(', ');
    const confirmed = window.confirm(
      `Delete ${ids.length} stocktake${ids.length === 1 ? '' : 's'}?` +
        (sampleNames ? `\n\n${sampleNames}${ids.length > 3 ? ', ...' : ''}` : '') +
        '\n\nCount lines for deleted stocktakes will also be removed. This cannot be undone.'
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api<{ deleted: number }>('/api/stocktake', {
        method: 'DELETE',
        body: JSON.stringify({ ids })
      });
      setSelectedIds(new Set());
      setExpandedId((current) => (current && ids.includes(current) ? null : current));
      setDetail((current) => (current && ids.includes(current.id) ? null : current));
      if (form.mode === 'edit' && ids.includes(form.stocktake.id)) {
        setForm({ mode: 'closed' });
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete stocktakes');
    } finally {
      setDeleting(false);
    }
  }

  const cardTitle =
    form.mode === 'create'
      ? 'New stocktake'
      : form.mode === 'edit'
        ? `Editing ${form.stocktake.name}`
        : 'Stocktake history';

  return (
    <div className="page-stack">
      <div className="stat-grid">
        <StatCard icon={<IconStocktake size={18} />} label="Stocktakes" value={loading ? '—' : String(summary?.totalStocktakes ?? 0)} hint="On record across venues" />
        <StatCard label="Last counted" value={loading ? '—' : summary?.lastCountedAt ? formatDate(summary.lastCountedAt) : 'Never'} hint="Most recent count" />
        <StatCard label="In progress" value={loading ? '—' : String(summary?.inProgress ?? 0)} hint="Counts not yet submitted" tone={summary && summary.inProgress > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Total counted value" value={loading ? '—' : summary ? formatCurrency(summary.totalValueCents) : '—'} hint="Sum of stock value" />
      </div>

      <Card
        title={cardTitle}
        subtitle={
          form.mode === 'closed'
            ? 'Start a count, save drafts, submit for review, then apply it to inventory through ledger movements.'
            : 'Count lines are saved to stocktake history. Product balances change only when a submitted stocktake is applied.'
        }
        action={
          form.mode === 'closed' ? (
            <Button type="button" size="sm" onClick={() => setForm({ mode: 'create' })}>
              New stocktake
            </Button>
          ) : null
        }
      >
        {form.mode !== 'closed' ? (
          <StocktakeForm
            mode={form.mode}
            initial={form.mode === 'edit' ? form.stocktake : undefined}
            items={items}
            onSaved={() => void handleSaved()}
            onCancel={() => setForm({ mode: 'closed' })}
          />
        ) : loading ? (
          <Spinner label="Loading stocktakes" />
        ) : error ? (
          <EmptyState icon={<IconStocktake size={24} />} title="Stocktakes unavailable" description={error} />
        ) : data && data.stocktakes.length > 0 ? (
          <>
            <div className="recipes-toolbar">
              <Input label="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Search by name, venue or template" />
            </div>

            <div className="table-card stocktake-history-card">
              <div className="table-toolbar stock-bulk-toolbar">
                <span>
                  {selectedIds.size > 0
                    ? `${selectedIds.size} selected`
                    : `${filtered.length} of ${data.stocktakes.length} stocktakes`}
                </span>
                <span className="table-toolbar-right stock-bulk-actions">
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
                        onClick={() => void deleteSelectedStocktakes()}
                        disabled={deleting}
                      >
                        {deleting ? 'Deleting...' : 'Delete selected'}
                      </Button>
                    </>
                  ) : (
                    'Most recent first'
                  )}
                </span>
              </div>
              <div className="stocktake-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th className="select-cell">
                        <input
                          type="checkbox"
                          aria-label="Select visible stocktakes"
                          checked={allVisibleSelected}
                          onChange={toggleAllVisible}
                        />
                      </th>
                      <th>Name</th>
                      <th>Venue</th>
                      <th>Counted</th>
                      <th>Lines</th>
                      <th>Value</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="table-empty-cell">No stocktakes match the current filter.</td>
                      </tr>
                    ) : (
                      filtered.map((stocktake) => {
                        const expanded = expandedId === stocktake.id;
                        return (
                          <Fragment key={stocktake.id}>
                            <tr
                              className={`row-interactive ${selectedIds.has(stocktake.id) ? 'stock-selected-row' : ''}`}
                              onClick={() => void toggleRow(stocktake)}
                            >
                              <td className="select-cell">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${stocktake.name}`}
                                  checked={selectedIds.has(stocktake.id)}
                                  onClick={(event) => event.stopPropagation()}
                                  onChange={() => toggleSelected(stocktake.id)}
                                />
                              </td>
                              <td>
                                <span className="cell-stack">
                                  <strong>{stocktake.name}</strong>
                                  <span className="subtle">{stocktake.template ?? '—'}</span>
                                </span>
                              </td>
                              <td>{stocktake.venue ?? '—'}</td>
                              <td>{formatDate(stocktake.countedAt)}</td>
                              <td>{stocktake.lineCount}</td>
                              <td>{formatCurrency(stocktake.totalValueCents)}</td>
                              <td>
                                <Badge tone={stocktake.appliedAt ? 'info' : stocktake.status === 'SUBMITTED' ? 'positive' : 'warning'} dot>
                                  {stocktake.appliedAt
                                    ? 'Applied'
                                    : stocktake.status === 'SUBMITTED'
                                      ? 'Ready for review'
                                      : 'In progress'}
                                </Badge>
                              </td>
                              <td className="cell-actions">
                                {stocktake.status === 'SUBMITTED' && !stocktake.appliedAt ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={applyingId === stocktake.id}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void applyStocktake(stocktake);
                                    }}
                                  >
                                    {applyingId === stocktake.id ? 'Applying…' : 'Apply'}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={Boolean(stocktake.appliedAt)}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void editStocktake(stocktake);
                                  }}
                                >
                                  Edit
                                </Button>
                              </td>
                            </tr>
                            {expanded ? (
                              <tr className="row-detail">
                                <td colSpan={8}>
                                  {detailLoading ? <Spinner label="Loading lines" /> : null}
                                  {detailError ? <p className="error-text">{detailError}</p> : null}
                                  {detail && detail.id === stocktake.id ? <StocktakeLinesTable detail={detail} /> : null}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<IconStocktake size={24} />}
            title="No counts yet"
            description="Start with a full count from the current item catalogue."
            action={<Button type="button" onClick={() => setForm({ mode: 'create' })}>Start stocktake</Button>}
          />
        )}
      </Card>
    </div>
  );
}

function StocktakeForm({
  mode,
  initial,
  items,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: StocktakeWithLines;
  items: StockItem[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<StocktakeDraft>(() =>
    initial ? draftFromStocktake(initial) : emptyDraft(items)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemOptions = useMemo(
    () => [
      { label: 'Unlinked count line', value: '' },
      ...items.map((item) => ({ label: `${item.name} (${item.unit})`, value: item.id }))
    ],
    [items]
  );

  function update<K extends keyof StocktakeDraft>(key: K, value: StocktakeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line, i) => (i === index ? { ...line, ...patch } : line))
    }));
  }

  function selectLineItem(index: number, itemId: string) {
    const item = items.find((candidate) => candidate.id === itemId);
    updateLine(index, {
      itemId,
      label: item?.name ?? '',
      unit: item?.unit ?? '',
      location: item?.category?.name ?? ''
    });
  }

  function removeLine(index: number) {
    setDraft((current) => ({ ...current, lines: current.lines.filter((_, i) => i !== index) }));
  }

  async function submit(status: StocktakeStatus) {
    setError(null);
    if (!draft.name.trim()) {
      setError('Stocktake name is required');
      return;
    }
    const lines = draft.lines.filter((line) => line.label.trim()).map(linePayload);
    if (lines.length === 0) {
      setError('Add at least one count line');
      return;
    }

    const payload = {
      name: draft.name.trim(),
      venue: draft.venue.trim(),
      template: draft.template.trim(),
      countedAt: new Date(draft.countedAt).toISOString(),
      status,
      notes: draft.notes.trim(),
      lines
    };

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        await api<StocktakeWithLines>(`/api/stocktake/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } else {
        await api<StocktakeWithLines>('/api/stocktake', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save stocktake');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(draft.status);
      }}
    >
      <div className="form-grid three">
        <Input label="Name" required value={draft.name} onChange={(event) => update('name', event.currentTarget.value)} />
        <Input label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} placeholder="Freshie, Avalon…" />
        <Input label="Counted at" type="datetime-local" required value={draft.countedAt} onChange={(event) => update('countedAt', event.currentTarget.value)} />
      </div>
      <div className="form-grid two">
        <Input label="Template" value={draft.template} onChange={(event) => update('template', event.currentTarget.value)} placeholder="Full count, Bar, Kitchen…" />
        <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />
      </div>

      <div className="stocktake-count-toolbar">
        <strong>{draft.lines.length} count lines</strong>
        <Button type="button" variant="secondary" size="sm" onClick={() => update('lines', [...draft.lines, emptyLine()])}>
          Add line
        </Button>
      </div>

      <div className="stocktake-count-lines">
        {draft.lines.map((line, index) => (
          <div key={index} className="stocktake-count-line">
            <Select label="Item" value={line.itemId} onChange={(event) => selectLineItem(index, event.currentTarget.value)} options={itemOptions} />
            <Input label="Label" required value={line.label} onChange={(event) => updateLine(index, { label: event.currentTarget.value })} />
            <Input label="Qty" type="number" step="0.01" value={line.countedQty} onChange={(event) => updateLine(index, { countedQty: event.currentTarget.value })} />
            <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
            <Input label="Location" value={line.location} onChange={(event) => updateLine(index, { location: event.currentTarget.value })} />
            <Input label="Value cents" type="number" step="1" value={line.stockValueCents} onChange={(event) => updateLine(index, { stockValueCents: event.currentTarget.value })} />
            <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
              Remove
            </Button>
          </div>
        ))}
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="secondary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
        <Button type="button" disabled={saving} onClick={() => void submit('SUBMITTED')}>
          {saving ? 'Submitting…' : 'Mark ready for review'}
        </Button>
      </div>
    </form>
  );
}

function StocktakeLinesTable({ detail }: { detail: StocktakeWithLines }) {
  if (detail.lines.length === 0) return <p className="subtle">This stocktake has no recorded lines.</p>;

  const groups = new Map<string, typeof detail.lines>();
  for (const line of detail.lines) {
    const key = line.location ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  return (
    <div className="recipe-lines">
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([location, lines]) => (
        <div key={location} className="stocktake-line-group">
          <h4 className="stocktake-line-group-title">{location}</h4>
          <table className="recipe-lines-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <span className="cell-stack">
                      <strong>{line.label}</strong>
                      <span className="subtle">{line.item ? `Linked to ${line.item.name}` : 'Unlinked count'}</span>
                    </span>
                  </td>
                  <td>{formatQuantity(line.countedQty, line.unit)}</td>
                  <td>{line.stockValueCents === null ? '—' : formatCurrency(line.stockValueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
