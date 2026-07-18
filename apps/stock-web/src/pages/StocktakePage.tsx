import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  ApplyStocktakeResult,
  StockItem,
  StockItemsPayload,
  StocktakeMovement,
  StocktakeMovementHistoryPayload,
  StocktakeMovementResult,
  Stocktake,
  StocktakeLineInput,
  StocktakeStatus,
  StocktakeTemplate,
  StocktakeTemplatesPayload,
  StocktakeTemplateResolved,
  StocktakeWithLines,
  StocktakesPayload,
  StocktakesSummary
} from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard, Textarea } from '@alma/ui';
import { LoadedStocktakeImportCard } from '../components/LoadedStocktakeImportCard';
import { StockItemPicker } from '../components/StockItemPicker';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

type FormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; stocktake: StocktakeWithLines };

// Data quality report from /api/items/data-quality. Shape lives in
// stock-api/src/services/items.service.ts → dataQualityReport.
type DataQualityPayload = {
  generatedAt: string;
  totalActiveItems: number;
  itemsWithWarning: number;
  quality: 'good' | 'partial' | 'poor';
  counts: Record<string, number>;
  countAreas: string[];
  problemItems: Array<{
    id: string;
    name: string;
    category: string | null;
    unit: string;
    countUnit: string | null;
    countArea: string | null;
    conversionFactor: number;
    latestCostCents: number | null;
    latestCostAt: string | null;
    warnings: string[];
  }>;
};

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

function normalQuantity(qty: number | null | undefined) {
  return typeof qty === 'number' && Number.isFinite(qty) ? qty : null;
}

function formatQuantity(qty: number | null | undefined, unit: string | null) {
  const safeQty = normalQuantity(qty);
  if (safeQty === null) return '—';
  const value = Number.isInteger(safeQty) ? String(safeQty) : safeQty.toFixed(2);
  return unit ? `${value} ${unit}` : value;
}

function formatSignedQuantity(qty: number | null | undefined, unit: string | null) {
  const safeQty = normalQuantity(qty);
  if (safeQty === null) return '—';
  const sign = safeQty > 0 ? '+' : '';
  return `${sign}${formatQuantity(safeQty, unit)}`;
}

function effectiveItemOnHand(item: StockItem) {
  return item.venueStock?.onHand ?? item.onHand;
}

function stockCountUnit(item: StockItem) {
  return item.countUnit ?? item.unit;
}

function stockUnitCostCents(item: StockItem) {
  if (item.latestCostCents !== null && item.latestCostCents !== undefined) {
    return Math.round(item.latestCostCents / Math.max(item.conversionFactor || 1, 1));
  }
  return item.avgCostCents;
}

// Client mirror of the API's convertQuantityToCostUnit. Enough to estimate a
// line's dollar value live while counting, so a wrong unit (mL vs bottle, g vs
// each) shows up as a wildly off figure before the count is ever submitted. The
// server recomputes the authoritative value on save; this is display-only.
function normUnit(value: string | null | undefined): string {
  const s = (value ?? '').trim().toLowerCase();
  if (['each', 'ea', 'unit', 'units', 'portion', 'portions'].includes(s)) return 'each';
  if (['litre', 'litres', 'liter', 'liters', 'l'].includes(s)) return 'l';
  if (['millilitre', 'millilitres', 'milliliter', 'ml'].includes(s)) return 'ml';
  if (['kilogram', 'kilograms', 'kg'].includes(s)) return 'kg';
  if (['gram', 'grams', 'g'].includes(s)) return 'g';
  return s;
}
function metricFactor(from: string, to: string): number | null {
  if (from === to) return 1;
  if (from === 'l' && to === 'ml') return 1000;
  if (from === 'ml' && to === 'l') return 1 / 1000;
  if (from === 'kg' && to === 'g') return 1000;
  if (from === 'g' && to === 'kg') return 1 / 1000;
  return null;
}
function convertToCountUnitClient(qty: number, fromUnit: string | null | undefined, item: StockItem): { qty: number; via: string } {
  const cost = normUnit(item.countUnit ?? item.unit);
  const from = normUnit(fromUnit);
  const purchase = normUnit(item.unit);
  if (!from || from === cost) return { qty, via: 'same' };
  if (from === 'each') return { qty, via: 'each' };
  if (item.countUnit && cost === normUnit(item.countUnit) && from === purchase && item.conversionFactor > 0) {
    return { qty: qty * item.conversionFactor, via: 'pack' };
  }
  const mf = metricFactor(from, cost);
  if (mf !== null) return { qty: qty * mf, via: 'measure' };
  if (item.measurePerCountUnit && item.measurePerCountUnit > 0 && item.measureUnit) {
    const toMeasure = metricFactor(from, normUnit(item.measureUnit));
    if (toMeasure !== null) return { qty: (qty * toMeasure) / item.measurePerCountUnit, via: 'measure-pack' };
  }
  return { qty, via: 'unknown' };
}
// Live value estimate for a count line. unitMismatch = the entered unit can't be
// resolved to the item's cost unit (the classic mL/g-vs-parent setup error).
function estimateLineValueCents(
  item: StockItem | undefined,
  countedQty: number | null,
  unit: string | null
): { cents: number | null; unitMismatch: boolean; countUnit: string | null; unitCostCents: number | null } {
  if (!item) return { cents: null, unitMismatch: false, countUnit: null, unitCostCents: null };
  const unitCostCents = stockUnitCostCents(item) ?? null;
  const countUnit = stockCountUnit(item);
  if (countedQty === null || unitCostCents === null) {
    return { cents: null, unitMismatch: false, countUnit, unitCostCents };
  }
  const conv = convertToCountUnitClient(countedQty, unit, item);
  const unitMismatch = conv.via === 'unknown' && !!unit && normUnit(unit) !== normUnit(countUnit);
  return {
    cents: unitMismatch ? null : Math.round(unitCostCents * conv.qty),
    unitMismatch,
    countUnit,
    unitCostCents
  };
}

function movementTypeLabel(type: StocktakeMovement['movementType']) {
  switch (type) {
    case 'STOCKTAKE_CORRECTION':
      return 'Correction';
    case 'STOCKTAKE_REVERSAL':
      return 'Reversal';
    case 'STOCKTAKE_ADJUSTMENT':
    default:
      return 'Approval';
  }
}

function movementTone(type: StocktakeMovement['movementType']): 'info' | 'warning' | 'danger' {
  if (type === 'STOCKTAKE_REVERSAL') return 'danger';
  if (type === 'STOCKTAKE_CORRECTION') return 'warning';
  return 'info';
}

function varianceSummary(detail: StocktakeWithLines) {
  return detail.lines.reduce(
    (summary, line) => {
      if (!line.item) return summary;
      const countedQty = normalQuantity(line.countedQty);
      const onHand = normalQuantity(line.item.onHand);
      summary.linkedLines += 1;
      if (countedQty === null || onHand === null) return summary;
      const variance = countedQty - onHand;
      if (Math.abs(variance) > 0.0001) summary.varianceLines += 1;
      if (variance > 0) summary.positiveAdjustments += variance;
      if (variance < 0) summary.negativeAdjustments += variance;
      return summary;
    },
    {
      totalLines: detail.lines.length,
      linkedLines: 0,
      varianceLines: 0,
      positiveAdjustments: 0,
      negativeAdjustments: 0
    }
  );
}

// blind=true seeds a line WITHOUT the expected on-hand in the qty field, so the
// counter records what they actually see rather than being nudged to the system
// number. Value is left blank too — it is recomputed on apply from the count.
function emptyLine(item?: StockItem, blind = true): LineDraft {
  const onHand = item ? effectiveItemOnHand(item) : 0;
  const unitCostCents = item ? stockUnitCostCents(item) : null;
  const value = unitCostCents ? Math.round(unitCostCents * onHand) : '';
  return {
    itemId: item?.id ?? '',
    label: item?.name ?? '',
    countedQty: blind ? '' : item ? String(onHand) : '0',
    unit: item ? stockCountUnit(item) : '',
    location: item?.category?.name ?? '',
    stockValueCents: blind ? '' : value === '' ? '' : String(value),
    notes: ''
  };
}

function emptyDraft(items: StockItem[], blind = true): StocktakeDraft {
  return {
    name: `Stocktake ${new Date().toLocaleDateString()}`,
    venue: '',
    template: 'Full count',
    countedAt: formatDateTimeInput(new Date().toISOString()),
    status: 'IN_PROGRESS',
    notes: '',
    lines: items.filter((item) => item.status === 'ACTIVE').map((item) => emptyLine(item, blind))
  };
}

// Seed a draft from a template's resolved item ids (walking order: area/category
// then name), carrying the template's name, venue and blind default onto the count.
function draftFromTemplate(
  items: StockItem[],
  resolvedItemIds: string[],
  template: StocktakeTemplate,
  blind: boolean
): StocktakeDraft {
  const order = new Map(resolvedItemIds.map((id, index) => [id, index] as const));
  const chosen = items
    .filter((item) => item.status === 'ACTIVE' && order.has(item.id))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    name: `${template.name} ${new Date().toLocaleDateString()}`,
    venue: template.venue ?? '',
    template: template.name,
    countedAt: formatDateTimeInput(new Date().toISOString()),
    status: 'IN_PROGRESS',
    notes: '',
    lines: chosen.map((item) => emptyLine(item, blind))
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
      countedQty: line.countedQty == null ? '' : String(line.countedQty),
      unit: line.unit ?? line.item?.unit ?? '',
      location: line.location ?? '',
      stockValueCents: line.stockValueCents === null ? '' : String(line.stockValueCents),
      notes: line.notes ?? ''
    }))
  };
}

function linePayload(line: LineDraft): StocktakeLineInput {
  // A blank field means "not counted yet" (null) — distinct from a counted zero.
  const countRaw = String(line.countedQty ?? '').trim();
  return {
    itemId: line.itemId,
    label: line.label.trim(),
    countedQty: countRaw === '' ? null : Number(countRaw),
    unit: line.unit.trim(),
    location: line.location.trim(),
    stockValueCents: line.stockValueCents === '' ? undefined : Math.round(Number(line.stockValueCents)),
    notes: line.notes.trim()
  };
}

export function StocktakePage() {
  useDocumentTitle('Stocktake');
  const { user } = useAuth();

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
  const [bulkBusy, setBulkBusy] = useState<null | 'submit' | 'approve'>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  // Data quality snapshot from /api/items/data-quality — fed by Sprint 1's
  // new dataQualityReport service. Renders as a Card above the stocktake
  // list so the user spots catalogue gaps before counting.
  const [dataQuality, setDataQuality] = useState<DataQualityPayload | null>(null);
  const canManageReview = canManageStock(user);

  async function load() {
    setLoading(true);
    try {
      const [list, sum, itemPayload, quality] = await Promise.all([
        api<StocktakesPayload>('/api/stocktake'),
        api<StocktakesSummary>('/api/stocktake/summary'),
        api<StockItemsPayload>('/api/items'),
        // Data quality is optional — gracefully degrade if the endpoint
        // isn't deployed yet so older builds don't break.
        api<DataQualityPayload>('/api/items/data-quality').catch(() => null)
      ]);
      setData(list);
      setSummary(sum);
      setItems(itemPayload.items);
      setDataQuality(quality);
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

  const readyForReview = useMemo(
    () =>
      (data?.stocktakes ?? [])
        .filter((stocktake) => stocktake.status === 'SUBMITTED' && !stocktake.appliedAt)
        .sort((a, b) =>
          new Date(b.submittedAt ?? b.updatedAt).getTime() -
          new Date(a.submittedAt ?? a.updatedAt).getTime()
        ),
    [data]
  );

  const selectableStocktakes = useMemo(
    () => filtered.filter((stocktake) => !stocktake.appliedAt),
    [filtered]
  );

  const allVisibleSelected = Boolean(
    selectableStocktakes.length && selectableStocktakes.every((stocktake) => selectedIds.has(stocktake.id))
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

  async function refreshDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const full = await api<StocktakeWithLines>(`/api/stocktake/${id}`);
      setDetail(full);
      await load();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not refresh stocktake');
    } finally {
      setDetailLoading(false);
    }
  }

  async function applyStocktake(stocktake: Stocktake) {
    if (!canManageReview) {
      setError('Manager access is required to approve stocktakes.');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: `Apply "${stocktake.name}" to stock?`,
      message:
        'This locks in the count: it updates item balances and records the movement. It cannot be run twice.',
      confirmationText: 'APPLY COUNT'
    });
    if (!confirmed) return;

    setApplyingId(stocktake.id);
    setError(null);
    try {
      await api<ApplyStocktakeResult>(`/api/stocktake/${stocktake.id}/approve`, {
        method: 'POST'
      });
      setExpandedId(null);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve stocktake');
    } finally {
      setApplyingId(null);
    }
  }

  async function downloadStocktakeCsv(stocktake: Stocktake) {
    setError(null);
    try {
      await downloadCsv(
        `/api/stocktake/${stocktake.id}/export.csv`,
        `${(stocktake.name || 'stocktake').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-stocktake.csv`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export stocktake CSV');
    }
  }

  async function reopenStocktake(stocktake: Stocktake) {
    if (!canManageReview) {
      setError('Manager access is required to reopen stocktakes.');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: `Reopen "${stocktake.name}"?`,
      message:
        'This returns the submitted count to draft/in-progress so it can be corrected. It does not change item balances.',
      confirmationText: 'REOPEN STOCKTAKE'
    });
    if (!confirmed) return;

    setReopeningId(stocktake.id);
    setError(null);
    try {
      await api<Stocktake>(`/api/stocktake/${stocktake.id}/reopen`, {
        method: 'POST'
      });
      setExpandedId(null);
      setDetail(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reopen stocktake');
    } finally {
      setReopeningId(null);
    }
  }

  function toggleSelected(id: string) {
    const stocktake = data?.stocktakes.find((item) => item.id === id);
    if (stocktake?.appliedAt) return;
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
      if (selectableStocktakes.every((stocktake) => next.has(stocktake.id))) {
        selectableStocktakes.forEach((stocktake) => next.delete(stocktake.id));
      } else {
        selectableStocktakes.forEach((stocktake) => next.add(stocktake.id));
      }
      return next;
    });
  }

  async function deleteSelectedStocktakes() {
    if (selectedIds.size === 0) return;
    if (!canManageReview) {
      setError('Manager access is required to delete stocktakes.');
      return;
    }
    const ids = Array.from(selectedIds);
    const sampleNames = selectedStocktakes
      .slice(0, 3)
      .map((stocktake) => stocktake.name)
      .join(', ');
    const confirmed = confirmDangerousAction({
      title: `Delete ${ids.length} stocktake${ids.length === 1 ? '' : 's'}?`,
      message:
        `${sampleNames ? `${sampleNames}${ids.length > 3 ? ', ...' : ''}\n\n` : ''}` +
        'Draft and review count lines will also be removed. Applied stocktakes must be reversed before deletion.',
      confirmationText: 'DELETE STOCKTAKES'
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api<{ deleted: number }>('/api/stocktake', {
        method: 'DELETE',
        body: JSON.stringify({ ids, confirmationText: 'DELETE STOCKTAKES' })
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

  async function submitSelectedStocktakes() {
    const targets = selectedStocktakes.filter((stocktake) => stocktake.status === 'IN_PROGRESS');
    if (targets.length === 0) {
      setError('Select one or more in-progress stocktakes to submit.');
      return;
    }
    setBulkBusy('submit');
    setError(null);
    const results = await Promise.allSettled(
      targets.map((stocktake) => api(`/api/stocktake/${stocktake.id}/submit`, { method: 'POST' }))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setSelectedIds(new Set());
    setBulkBusy(null);
    await load();
    if (failed) setError(`Submitted ${results.length - failed} of ${results.length}; ${failed} could not be submitted.`);
  }

  async function approveSelectedStocktakes() {
    if (!canManageReview) {
      setError('Manager access is required to approve stocktakes.');
      return;
    }
    const targets = selectedStocktakes.filter(
      (stocktake) => (stocktake.status === 'SUBMITTED' || stocktake.status === 'REVIEWED') && !stocktake.appliedAt
    );
    if (targets.length === 0) {
      setError('Select one or more submitted stocktakes to approve.');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: `Apply ${targets.length} stocktake${targets.length === 1 ? '' : 's'} to stock?`,
      message:
        'Each one locks in its count: it updates item balances and records the movements. This cannot be run twice and is not bulk-reversible.',
      confirmationText: 'APPLY COUNT'
    });
    if (!confirmed) return;
    setBulkBusy('approve');
    setError(null);
    const results = await Promise.allSettled(
      targets.map((stocktake) => api(`/api/stocktake/${stocktake.id}/approve`, { method: 'POST' }))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    setSelectedIds(new Set());
    setBulkBusy(null);
    await load();
    if (failed) setError(`Approved ${results.length - failed} of ${results.length}; ${failed} could not be approved.`);
  }

  const cardTitle =
    form.mode === 'create'
      ? 'New stocktake'
      : form.mode === 'edit'
        ? `Editing ${form.stocktake.name}`
        : 'Stocktake history';

  return (
    <div className="page-stack stocktake-page">
      <div className="stat-grid">
        <StatCard icon={<IconStocktake size={18} />} label="Stocktakes" value={loading ? '—' : String(summary?.totalStocktakes ?? 0)} hint="On record across venues" />
        <StatCard label="Last counted" value={loading ? '—' : summary?.lastCountedAt ? formatDate(summary.lastCountedAt) : 'Never'} hint="Most recent count" />
        <StatCard label="In progress" value={loading ? '—' : String(summary?.inProgress ?? 0)} hint="Counts not yet submitted" tone={summary && summary.inProgress > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Ready for review" value={loading ? '—' : String(summary?.submitted ?? 0)} hint="Submitted counts" tone={summary && summary.submitted > 0 ? 'warning' : 'neutral'} />
      </div>

      <LoadedStocktakeImportCard onImported={() => void load()} />

      {dataQuality ? (
        <Card
          title="Catalogue data quality"
          subtitle={`Sprint 1 / Loaded replacement: catches missing units, conversion factors, count areas, and stale costs. Grade: ${dataQuality.quality.toUpperCase()} (${dataQuality.itemsWithWarning} of ${dataQuality.totalActiveItems} active items have at least one warning).`}
          action={
            <Badge tone={dataQuality.quality === 'good' ? 'positive' : dataQuality.quality === 'partial' ? 'warning' : 'danger'}>
              {dataQuality.quality === 'good' ? 'Good' : dataQuality.quality === 'partial' ? 'Partial' : 'Poor'}
            </Badge>
          }
        >
          <div className="stocktake-data-quality">
            {([
              ['missing_unit', 'Missing unit'],
              ['missing_count_unit', 'No count unit'],
              ['missing_conversion', 'No conversion'],
              ['missing_category', 'No category'],
              ['missing_count_area', 'No count area'],
              ['missing_latest_cost', 'No cost'],
              ['stale_latest_cost', 'Stale cost (>90d)']
            ] as const).map(([key, label]) => {
              const value = dataQuality.counts[key] ?? 0;
              const tone = value > 0 ? (key === 'missing_unit' || key === 'missing_latest_cost' || key === 'missing_count_unit' ? 'is-danger' : 'is-warning') : '';
              return (
                <div key={key} className={`stocktake-data-quality-cell ${tone}`}>
                  <strong>{value}</strong>
                  <span>{label}</span>
                </div>
              );
            })}
          </div>
          {dataQuality.countAreas.length > 0 ? (
            <p className="subtle" style={{ marginTop: 12 }}>
              Walking-order areas: {dataQuality.countAreas.join(' · ')}
            </p>
          ) : (
            <p className="subtle" style={{ marginTop: 12 }}>
              No count areas configured. Set a <em>countArea</em> on each item so stocktakes group by walking order.
            </p>
          )}
          {dataQuality.problemItems.length > 0 ? (
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                Items with warnings ({dataQuality.problemItems.length} shown)
              </summary>
              <ul style={{ marginTop: 8, paddingLeft: 18, fontSize: 13 }}>
                {dataQuality.problemItems.slice(0, 30).map((row) => (
                  <li key={row.id} style={{ marginBottom: 4 }}>
                    <strong>{row.name}</strong>
                    {' — '}
                    <span style={{ color: '#9A3A2E' }}>{row.warnings.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>
      ) : null}

      <Card
        title="Review queue"
        subtitle="Submitted stocktakes are reviewed here before any ledger-backed inventory adjustment is approved."
        padding="none"
      >
        <div className="stocktake-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Stocktake</th>
                <th>Venue</th>
                <th>Submitted</th>
                <th>Lines</th>
                <th>Value</th>
                <th aria-label="Review actions" />
              </tr>
            </thead>
            <tbody>
              {readyForReview.length ? (
                readyForReview.map((stocktake) => (
                  <tr key={stocktake.id}>
                    <td>
                      <span className="cell-stack">
                        <strong>{stocktake.name}</strong>
                        <span className="subtle">{stocktake.template ?? 'No template'}</span>
                      </span>
                    </td>
                    <td>{stocktake.venue ?? 'Unassigned'}</td>
                    <td>{stocktake.submittedAt ? formatDate(stocktake.submittedAt) : formatDate(stocktake.updatedAt)}</td>
                    <td>{stocktake.lineCount}</td>
                    <td>{formatCurrency(stocktake.totalValueCents)}</td>
                    <td className="cell-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={applyingId === stocktake.id || !canManageReview}
                        title={canManageReview ? undefined : 'Manager access required'}
                        onClick={() => void applyStocktake(stocktake)}
                      >
                        {applyingId === stocktake.id ? 'Approving…' : 'Apply count to stock'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={reopeningId === stocktake.id || !canManageReview}
                        title={canManageReview ? undefined : 'Manager access required'}
                        onClick={() => void reopenStocktake(stocktake)}
                      >
                        {reopeningId === stocktake.id ? 'Reopening…' : 'Reopen draft'}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title="Download counted vs expected variance as CSV"
                        onClick={() => void downloadStocktakeCsv(stocktake)}
                      >
                        Export CSV
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="table-empty-cell">
                    No submitted stocktakes are waiting for review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={cardTitle}
        subtitle={
          form.mode === 'closed'
            ? 'Start a count, save drafts, submit for review, then approve ledger-backed inventory adjustments.'
            : 'Count lines are saved to stocktake history. Submitting sends the count for review and does not update stock balances.'
        }
        action={
          form.mode === 'closed' ? (
            <Button
              type="button"
              size="sm"
              disabled={!canManageReview}
              title={canManageReview ? undefined : 'Manager access required'}
              onClick={() => setForm({ mode: 'create' })}
            >
              {canManageReview ? 'New stocktake' : 'Manager required'}
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
                        disabled={deleting || bulkBusy !== null}
                      >
                        Clear
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void submitSelectedStocktakes()}
                        disabled={deleting || bulkBusy !== null}
                      >
                        {bulkBusy === 'submit' ? 'Submitting…' : 'Submit selected'}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void approveSelectedStocktakes()}
                        disabled={deleting || bulkBusy !== null || !canManageReview}
                        title={canManageReview ? 'Submit + post to the ledger' : 'Manager access required'}
                      >
                        {bulkBusy === 'approve' ? 'Approving…' : 'Approve selected'}
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        onClick={() => void deleteSelectedStocktakes()}
                        disabled={deleting || bulkBusy !== null || !canManageReview}
                        title={canManageReview ? undefined : 'Manager access required'}
                      >
                        {deleting
                          ? 'Deleting...'
                          : canManageReview
                            ? 'Delete selected'
                            : 'Manager required'}
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
                          disabled={selectableStocktakes.length === 0}
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
                                  disabled={Boolean(stocktake.appliedAt)}
                                  title={stocktake.appliedAt ? 'Applied stocktakes cannot be deleted.' : undefined}
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
                                    ? 'Applied and locked'
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
                                    disabled={applyingId === stocktake.id || !canManageReview}
                                    title={canManageReview ? undefined : 'Manager access required'}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void applyStocktake(stocktake);
                                    }}
                                  >
                                    {applyingId === stocktake.id
                                      ? 'Approving…'
                                      : canManageReview
                                        ? 'Apply count to stock'
                                        : 'Manager required'}
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={Boolean(stocktake.appliedAt) || !canManageReview}
                                  title={
                                    !canManageReview
                                      ? 'Manager access required'
                                      : stocktake.appliedAt
                                        ? 'Applied stocktakes are locked until a ledger reversal exists.'
                                        : undefined
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (canManageReview) void editStocktake(stocktake);
                                  }}
                                >
                                  {canManageReview ? 'Edit' : 'View only'}
                                </Button>
                              </td>
                            </tr>
                            {expanded ? (
                              <tr className="row-detail">
                                <td colSpan={8}>
                                  {detailLoading ? <Spinner label="Loading lines" /> : null}
                                  {detailError ? <p className="error-text">{detailError}</p> : null}
                                  {detail && detail.id === stocktake.id ? (
                                    <StocktakeLinesTable
                                      detail={detail}
                                      items={items}
                                      canManageReview={canManageReview}
                                      onChanged={() => void refreshDetail(stocktake.id)}
                                    />
                                  ) : null}
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
            action={
              <Button
                type="button"
                disabled={!canManageReview}
                title={canManageReview ? undefined : 'Manager access required'}
                onClick={() => setForm({ mode: 'create' })}
              >
                {canManageReview ? 'Start stocktake' : 'Manager required'}
              </Button>
            }
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
    initial ? draftFromStocktake(initial) : emptyDraft(items, mode === 'create')
  );
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');
  const [feedbackTarget, setFeedbackTarget] = useState<'draft' | 'review'>('draft');
  // Blind count (best practice: don't show the expected number while counting)
  // defaults on for new counts. Walk-by-area orders entry by physical location.
  const [blind, setBlind] = useState(mode === 'create');
  const [walkByArea, setWalkByArea] = useState(false);
  // Start-from-template (new counts only): pick a saved template to seed the
  // draft with just that template's resolved items, in walking order.
  const [templates, setTemplates] = useState<StocktakeTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);
  useEffect(() => {
    if (mode !== 'create') return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await api<StocktakeTemplatesPayload>('/api/stocktake-templates');
        if (!cancelled) setTemplates(payload.templates.filter((template) => template.active));
      } catch {
        /* templates are optional — a blank list just means "Full count only" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    if (!templateId) {
      setDraft(emptyDraft(items, blind));
      return;
    }
    setTemplateBusy(true);
    try {
      const resolved = await api<StocktakeTemplateResolved>(`/api/stocktake-templates/${templateId}/resolve`);
      setBlind(resolved.template.blindDefault);
      setDraft(draftFromTemplate(items, resolved.items.map((item) => item.id), resolved.template, resolved.template.blindDefault));
    } catch {
      /* leave the current draft as-is on failure */
    } finally {
      setTemplateBusy(false);
    }
  }

  const countedCount = draft.lines.filter((line) => line.countedQty.trim() !== '').length;
  const progressPct = draft.lines.length ? Math.round((countedCount / draft.lines.length) * 100) : 0;

  const orderedIndices = useMemo(() => {
    const idx = draft.lines.map((_, i) => i);
    if (!walkByArea) return idx;
    return idx.sort((a, b) =>
      (draft.lines[a]?.location || 'ZZZ').localeCompare(draft.lines[b]?.location || 'ZZZ')
    );
  }, [draft.lines, walkByArea]);

  function toggleBlind(next: boolean) {
    setBlind(next);
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => {
        if (!line.itemId) return line;
        const item = items.find((candidate) => candidate.id === line.itemId);
        if (!item) return line;
        if (next) return { ...line, countedQty: '', stockValueCents: '' };
        if (line.countedQty.trim() !== '') return line; // never clobber a real count
        const seeded = emptyLine(item, false);
        return { ...line, countedQty: seeded.countedQty, stockValueCents: seeded.stockValueCents };
      })
    }));
  }

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

  async function submit(status: StocktakeStatus, target: 'draft' | 'review') {
    setFeedback(null);
    setFeedbackTarget(target);
    if (!draft.name.trim()) {
      setFeedback('Stocktake name is required');
      setFeedbackTone('error');
      return;
    }
    const lines = draft.lines.filter((line) => line.label.trim()).map(linePayload);
    if (lines.length === 0) {
      setFeedback('Add at least one count line');
      setFeedbackTone('error');
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
      setFeedback(status === 'SUBMITTED' ? 'Stocktake marked ready for review.' : 'Stocktake draft saved.');
      setFeedbackTone('success');
      window.setTimeout(() => onSaved(), 500);
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Could not save stocktake');
      setFeedbackTone('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="new-item-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(draft.status, 'draft');
      }}
    >
      {mode === 'create' && templates.length > 0 ? (
        <div className="stocktake-template-start">
          <Select
            label="Start from template"
            value={selectedTemplateId}
            disabled={templateBusy}
            onChange={(event) => void applyTemplate(event.currentTarget.value)}
            options={[
              { label: 'Full count — all active items', value: '' },
              ...templates.map((template) => ({
                label: `${template.name}${template.venue ? ` · ${template.venue}` : ''} (≈ ${template.resolvedItemCount} items)`,
                value: template.id
              }))
            ]}
          />
          <span className="subtle">{templateBusy ? 'Loading template…' : 'Loads just that template’s items, in walking order.'}</span>
        </div>
      ) : null}
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
        <div className="stocktake-count-progress">
          <strong>{countedCount} / {draft.lines.length} counted</strong>
          <div className="stocktake-progress-track" aria-hidden>
            <div className="stocktake-progress-bar" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="subtle">{progressPct}%</span>
        </div>
        <div className="stocktake-count-toggles">
          <label className="stocktake-toggle" title="Hide the expected on-hand while counting — record what you actually see.">
            <input type="checkbox" checked={blind} onChange={(event) => toggleBlind(event.currentTarget.checked)} />
            Blind count
          </label>
          <label className="stocktake-toggle" title="Order the count lines by location so you can count one area at a time.">
            <input type="checkbox" checked={walkByArea} onChange={(event) => setWalkByArea(event.currentTarget.checked)} />
            Walk by area
          </label>
          <Button type="button" variant="secondary" size="sm" onClick={() => update('lines', [...draft.lines, emptyLine(undefined, blind)])}>
            Add line
          </Button>
        </div>
      </div>

      <div className="stocktake-count-lines">
        {orderedIndices.map((index, displayPos) => {
          const line = draft.lines[index];
          if (!line) return null;
          const prevIdx = displayPos > 0 ? orderedIndices[displayPos - 1] : undefined;
          const prevLine = prevIdx !== undefined ? draft.lines[prevIdx] ?? null : null;
          const showAreaHeader = walkByArea && (!prevLine || (prevLine.location || '') !== (line.location || ''));
          return (
            <div key={index}>
              {showAreaHeader ? (
                <div className="stocktake-area-header">{line.location || 'No location'}</div>
              ) : null}
              <div className="stocktake-count-line">
                <StockItemPicker
                  label="Item"
                  items={items}
                  value={line.itemId}
                  onChange={(itemId) => selectLineItem(index, itemId)}
                />
                <Input label="Label" required value={line.label} onChange={(event) => updateLine(index, { label: event.currentTarget.value })} />
                <Input label="Qty" type="number" step="0.01" value={line.countedQty} onChange={(event) => updateLine(index, { countedQty: event.currentTarget.value })} />
                <Input label="Unit" value={line.unit} onChange={(event) => updateLine(index, { unit: event.currentTarget.value })} />
                <Input label="Location" value={line.location} onChange={(event) => updateLine(index, { location: event.currentTarget.value })} />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(index)}>
                  Remove
                </Button>
              </div>
              {(() => {
                const lineItem = line.itemId ? items.find((candidate) => candidate.id === line.itemId) : undefined;
                if (!lineItem) return null;
                const countRaw = String(line.countedQty ?? '').trim();
                const countedQty = countRaw === '' ? null : Number(countRaw);
                const estimate = estimateLineValueCents(lineItem, Number.isFinite(countedQty as number) ? (countedQty as number) : null, line.unit || null);
                if (estimate.unitCostCents === null) {
                  return <div className="stocktake-count-cost is-missing">No cost set for {lineItem.name} — value can't be checked</div>;
                }
                return (
                  <div className={`stocktake-count-cost${estimate.unitMismatch ? ' is-alert' : ''}`}>
                    <span>{formatCurrency(estimate.unitCostCents)} / {estimate.countUnit}</span>
                    {estimate.unitMismatch ? (
                      <strong>⚠ unit “{line.unit}” ≠ {estimate.countUnit} — check against parent product</strong>
                    ) : estimate.cents !== null ? (
                      <strong>line value {formatCurrency(estimate.cents)}</strong>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      <p className="subtle">Submitting sends this count for review. It does not update stock balances.</p>

      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="secondary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
        <ActionFeedback message={feedbackTarget === 'draft' ? feedback : null} tone={feedbackTone} />
        <Button type="button" disabled={saving} onClick={() => void submit('SUBMITTED', 'review')}>
          {saving ? 'Submitting…' : 'Submit for review'}
        </Button>
        <ActionFeedback message={feedbackTarget === 'review' ? feedback : null} tone={feedbackTone} />
      </div>
    </form>
  );
}

// Response shape from GET /api/stocktake/:id/variance (the expected-vs-counted
// usage analytic). Typed inline — the endpoint has no shared type yet.
type UsageVarianceRow = {
  lineId: string;
  label: string;
  itemId: string | null;
  unit: string | null;
  currentQty: number | null;
  expectedQty: number | null;
  expectedVarianceQty: number | null;
  expectedVarianceValueCents: number | null;
  theoreticalUsageQty: number | null;
};
type UsageVarianceReport = {
  summary: { expectedAvailable: boolean; unexplainedShrinkageValueCents: number | null };
  rows: UsageVarianceRow[];
};

function StocktakeLinesTable({
  detail,
  items,
  canManageReview,
  onChanged
}: {
  detail: StocktakeWithLines;
  items: StockItem[];
  canManageReview: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const openItem = (itemId: string) => navigate(`/items?edit=${itemId}`);
  // Category groups start collapsed; `expanded` holds the ones the user opened.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleGroup = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // Expected-vs-counted usage variance from the API (the theoretical-depletion
  // analytic): what the shelf should hold given deliveries, wastage and sales.
  const [usageVariance, setUsageVariance] = useState<UsageVarianceReport | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const report = await api<UsageVarianceReport>(`/api/stocktake/${detail.id}/variance`);
        if (!cancelled) setUsageVariance(report);
      } catch {
        /* silent — expected-variance is informational */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail.id]);

  // ── Bulk line editing (review) ──────────────────────────────────────────
  // Select any lines, then correct their unit and/or counted qty together —
  // the fast fix when a batch of lines was counted in the wrong unit (mL vs
  // bottle, g vs each) relative to their parent product. Edits save through the
  // normal stocktake update, which re-derives each line's value server-side; on
  // a not-yet-applied count this touches no ledger balances.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkUnit, setBulkUnit] = useState('');
  const [bulkQty, setBulkQty] = useState('');
  const [savingBulk, setSavingBulk] = useState(false);
  const [bulkFeedback, setBulkFeedback] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  useEffect(() => {
    // Reset selection when the stocktake changes.
    setSelected(new Set());
    setBulkUnit('');
    setBulkQty('');
    setBulkFeedback(null);
  }, [detail.id]);

  const toggleLine = (lineId: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });

  async function saveBulkEdit() {
    const unitOverride = bulkUnit.trim();
    const qtyRaw = bulkQty.trim();
    const qtyOverride = qtyRaw === '' ? undefined : Number(qtyRaw);
    if (!unitOverride && qtyOverride === undefined) {
      setBulkFeedback({ message: 'Set a new unit or quantity to apply.', tone: 'error' });
      return;
    }
    if (qtyOverride !== undefined && !Number.isFinite(qtyOverride)) {
      setBulkFeedback({ message: 'Quantity must be a number.', tone: 'error' });
      return;
    }
    setSavingBulk(true);
    setBulkFeedback(null);
    try {
      const lines: StocktakeLineInput[] = detail.lines.map((line) => {
        const apply = selected.has(line.id);
        return {
          itemId: line.itemId ?? '',
          label: line.label,
          countedQty:
            apply && qtyOverride !== undefined ? qtyOverride : line.countedQty ?? null,
          unit: apply && unitOverride ? unitOverride : line.unit ?? '',
          location: line.location ?? '',
          notes: line.notes ?? ''
        };
      });
      await api<StocktakeWithLines>(`/api/stocktake/${detail.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ lines })
      });
      setBulkFeedback({ message: `Updated ${selected.size} line${selected.size === 1 ? '' : 's'}.`, tone: 'success' });
      setSelected(new Set());
      setBulkUnit('');
      setBulkQty('');
      onChanged();
    } catch (err) {
      setBulkFeedback({
        message: err instanceof ApiError ? err.message : 'Could not save line edits',
        tone: 'error'
      });
    } finally {
      setSavingBulk(false);
    }
  }

  if (detail.lines.length === 0) return <p className="subtle">This stocktake has no recorded lines.</p>;

  const summary = varianceSummary(detail);
  const shrinkageRows = (usageVariance?.rows ?? [])
    .filter((row) => row.expectedVarianceValueCents !== null && row.expectedVarianceValueCents < 0)
    .sort((a, b) => (a.expectedVarianceValueCents ?? 0) - (b.expectedVarianceValueCents ?? 0))
    .slice(0, 8);
  const groups = new Map<string, typeof detail.lines>();
  for (const line of detail.lines) {
    const key = line.location ?? 'Other';
    const list = groups.get(key) ?? [];
    list.push(line);
    groups.set(key, list);
  }

  // Valuation check — surface the lines driving the stocktake value so a
  // mis-valued line (usually a unit/cost setup error blowing one line up by
  // ~1000×) is obvious instead of buried in a collapsed group.
  const valuedLines = detail.lines
    .map((line) => ({
      id: line.id,
      label: line.label,
      itemId: line.itemId ?? null,
      itemName: line.item?.name ?? null,
      value: line.stockValueCents ?? 0,
      countedQty: normalQuantity(line.countedQty),
      unit: line.unit ?? line.item?.unit ?? null
    }))
    .filter((line) => line.value > 0)
    .sort((a, b) => b.value - a.value);
  const totalValuedCents = valuedLines.reduce((sum, line) => sum + line.value, 0);
  const topValuedLines = valuedLines.slice(0, 5);
  const suspectShareThreshold = 0.25;
  const hasSuspectLine = totalValuedCents > 0 && topValuedLines.some((line) => line.value / totalValuedCents >= suspectShareThreshold);

  return (
    <div className="recipe-lines">
      {summary.linkedLines > 0 ? (
        <div className="stocktake-variance-summary">
          <div>
            <span>Total lines</span>
            <strong>{summary.totalLines}</strong>
          </div>
          <div>
            <span>Linked lines</span>
            <strong>{summary.linkedLines}</strong>
          </div>
          <div>
            <span>Variance lines</span>
            <strong>{summary.varianceLines}</strong>
          </div>
          <div>
            <span>Positive adjustments</span>
            <strong>{formatSignedQuantity(summary.positiveAdjustments, null)}</strong>
          </div>
          <div>
            <span>Negative adjustments</span>
            <strong>{formatSignedQuantity(summary.negativeAdjustments, null)}</strong>
          </div>
        </div>
      ) : (
        <p className="subtle">No linked stock items yet, so variances cannot be calculated for this stocktake.</p>
      )}
      {usageVariance?.summary.expectedAvailable ? (
        <div className={`stocktake-shrinkage${(usageVariance.summary.unexplainedShrinkageValueCents ?? 0) < 0 ? ' is-loss' : ''}`}>
          <div className="stocktake-shrinkage-head">
            <span>Usage variance · counted vs expected</span>
            <strong>{formatCurrency(usageVariance.summary.unexplainedShrinkageValueCents ?? 0)} unexplained</strong>
          </div>
          <p className="subtle">
            Expected = last count + deliveries − wastage − theoretical sales usage. Lines below expected are stock you
            counted short of what should be on the shelf — the real, unexplained loss.
          </p>
          {shrinkageRows.length ? (
            <ul className="stocktake-shrinkage-list">
              {shrinkageRows.map((row) => (
                <li key={row.lineId}>
                  <span className="stocktake-shrinkage-name">{row.label}</span>
                  <span className="stocktake-shrinkage-qty">
                    counted {formatQuantity(row.currentQty, row.unit)} · expected {formatQuantity(row.expectedQty, row.unit)}
                  </span>
                  <strong>{formatCurrency(row.expectedVarianceValueCents ?? 0)}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className="subtle">No unexplained shortfalls — counted stock matches expected usage.</p>
          )}
        </div>
      ) : null}
      {totalValuedCents > 0 ? (
        <div className={`stocktake-valuation-check${hasSuspectLine ? ' is-suspect' : ''}`}>
          <div className="stocktake-valuation-head">
            <span>Top value lines</span>
            <strong>{formatCurrency(totalValuedCents)} total</strong>
          </div>
          <ul className="stocktake-valuation-list">
            {topValuedLines.map((line) => {
              const share = totalValuedCents > 0 ? line.value / totalValuedCents : 0;
              const suspect = share >= suspectShareThreshold;
              return (
                <li key={line.id} className={suspect ? 'is-suspect' : ''}>
                  <span className="stocktake-valuation-name">
                    {line.itemId ? (
                      <button type="button" className="stocktake-item-link" onClick={() => openItem(line.itemId!)} title="Open item details to fix its unit/cost">
                        {line.itemName ?? line.label}
                      </button>
                    ) : (
                      line.itemName ?? line.label
                    )}
                    {suspect ? <span className="stocktake-valuation-flag"> ⚠ check unit/cost</span> : null}
                  </span>
                  <span className="stocktake-valuation-num">
                    {formatCurrency(line.value)} · {(share * 100).toFixed(0)}%
                    {line.countedQty !== null ? ` · counted ${formatQuantity(line.countedQty, line.unit)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          {hasSuspectLine ? (
            <p className="subtle">
              One line driving most of the value is almost always a unit/cost setup error — e.g. a spirit counted in mL
              but costed per bottle (×1000), or a wrong pack size. Open that item and check its count unit, cost unit and
              average cost.
            </p>
          ) : null}
        </div>
      ) : null}
      {canManageReview && selected.size > 0 ? (
        <div className="stocktake-bulk-bar">
          <div className="stocktake-bulk-head">
            <strong>{selected.size} line{selected.size === 1 ? '' : 's'} selected</strong>
            <button type="button" className="stocktake-groups-toggle" onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
          <p className="subtle">
            Fix a wrong count unit (e.g. mL vs bottle) across the selected lines. Leave a field blank to keep it. Values
            are re-derived from each item's cost on save.
          </p>
          <div className="stocktake-bulk-fields">
            <Input label="Set unit" placeholder="e.g. bottle" value={bulkUnit} onChange={(event) => setBulkUnit(event.currentTarget.value)} />
            <Input label="Set qty" type="number" step="0.01" placeholder="unchanged" value={bulkQty} onChange={(event) => setBulkQty(event.currentTarget.value)} />
            <Button type="button" variant="secondary" size="sm" disabled={savingBulk} onClick={() => void saveBulkEdit()}>
              {savingBulk ? 'Saving…' : `Apply to ${selected.size}`}
            </Button>
            <ActionFeedback message={bulkFeedback?.message ?? null} tone={bulkFeedback?.tone ?? 'success'} />
          </div>
        </div>
      ) : null}
      <div className="stocktake-groups-toolbar">
        <span className="subtle">{groups.size} categor{groups.size === 1 ? 'y' : 'ies'}</span>
        <button
          type="button"
          className="stocktake-groups-toggle"
          onClick={() => {
            const allKeys = [...groups.keys()];
            const allOpen = allKeys.length > 0 && allKeys.every((key) => expanded.has(key));
            setExpanded(allOpen ? new Set() : new Set(allKeys));
          }}
        >
          {[...groups.keys()].length > 0 && [...groups.keys()].every((key) => expanded.has(key)) ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {[...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([location, lines]) => {
        const isOpen = expanded.has(location);
        const groupValue = lines.reduce((sum, line) => sum + (line.stockValueCents ?? 0), 0);
        return (
        <div key={location} className={`stocktake-line-group ${isOpen ? 'is-open' : 'is-collapsed'}`}>
          <button type="button" className="stocktake-line-group-title" onClick={() => toggleGroup(location)} aria-expanded={isOpen}>
            <span className="stocktake-group-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            <span className="stocktake-group-name">{location}</span>
            <span className="stocktake-group-meta">{lines.length} item{lines.length === 1 ? '' : 's'}{groupValue ? ` · ${formatCurrency(groupValue)}` : ''}</span>
          </button>
          {isOpen ? (
          <table className="recipe-lines-table">
            <thead>
              <tr>
                {canManageReview ? <th aria-label="Select" /> : null}
                <th>Item</th>
                <th>Qty</th>
                <th>Unit cost</th>
                <th>Current</th>
                <th>Variance</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const countedQty = normalQuantity(line.countedQty);
                const currentQty = line.item ? normalQuantity(line.item.onHand) : null;
                const variance = line.item && countedQty !== null && currentQty !== null ? countedQty - currentQty : null;
                // Variance %: cap at the larger of counted/current to avoid div-by-zero
                // and absurd %s when one side is 0.
                const variancePct = variance !== null && currentQty !== null && currentQty !== 0
                  ? Math.abs(variance / currentQty) * 100
                  : null;
                // Liquid categories (default 10% threshold), everything else 5%.
                // Use the line's location (set from category name) + label as a proxy.
                const categoryHint = `${line.location ?? ''} ${line.label}`;
                const isLiquid = /liquor|beer|wine|spirit|liquid|cocktail|bottle|keg|draught|draft/i.test(categoryHint);
                const threshold = isLiquid ? 10 : 5;
                const isAlert = variancePct !== null && variancePct > threshold;
                const fullItem = line.itemId ? items.find((candidate) => candidate.id === line.itemId) : undefined;
                const unitCostCents = fullItem ? stockUnitCostCents(fullItem) : null;
                const unitCostLabel = fullItem ? stockCountUnit(fullItem) : null;
                const isSelected = selected.has(line.id);
                return (
                  <tr key={line.id} className={`${isAlert ? 'stocktake-variance-row-alert' : ''}${isSelected ? ' is-selected' : ''}`}>
                    {canManageReview ? (
                      <td className="stocktake-select-cell">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleLine(line.id)}
                          aria-label={`Select ${line.label}`}
                        />
                      </td>
                    ) : null}
                    <td>
                      <span className="cell-stack">
                        {line.itemId ? (
                          <button type="button" className="stocktake-item-link" onClick={() => openItem(line.itemId!)} title="Open item details to fix its unit/cost">
                            {line.label}
                          </button>
                        ) : (
                          <strong>{line.label}</strong>
                        )}
                        <span className="subtle">{line.item ? `Linked to ${line.item.name}` : 'Unlinked count'}</span>
                      </span>
                    </td>
                    <td>{formatQuantity(countedQty, line.unit)}</td>
                    <td>{unitCostCents === null || unitCostCents === undefined ? '—' : `${formatCurrency(unitCostCents)} / ${unitCostLabel}`}</td>
                    <td>{line.item ? formatQuantity(currentQty, line.unit ?? line.item.unit) : '—'}</td>
                    <td>
                      {variance === null ? (
                        '—'
                      ) : (
                        <span className={variance === 0 ? 'subtle' : variance > 0 ? 'stocktake-variance-positive' : 'stocktake-variance-negative'}>
                          {formatSignedQuantity(variance, line.unit ?? line.item?.unit ?? null)}
                          {variancePct !== null ? (
                            <small className={isAlert ? 'stocktake-variance-alert' : 'stocktake-variance-pct'}>
                              {' '}({variancePct.toFixed(1)}%{isAlert ? ` · >${threshold}%` : ''})
                            </small>
                          ) : null}
                        </span>
                      )}
                    </td>
                    <td>{line.stockValueCents === null ? '—' : formatCurrency(line.stockValueCents)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          ) : null}
        </div>
        );
      })}
      <StocktakeMovementReview
        detail={detail}
        canManageReview={canManageReview}
        onChanged={onChanged}
      />
    </div>
  );
}

type CorrectionDraftState = {
  quantityAfter: string;
  reason: string;
  saving: boolean;
  feedback: string | null;
  feedbackTone: 'success' | 'error';
};

function StocktakeMovementReview({
  detail,
  canManageReview,
  onChanged
}: {
  detail: StocktakeWithLines;
  canManageReview: boolean;
  onChanged: () => void;
}) {
  const [history, setHistory] = useState<StocktakeMovementHistoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Record<string, CorrectionDraftState>>({});
  const [reversalReason, setReversalReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reversalFeedback, setReversalFeedback] = useState<string | null>(null);
  const [reversalTone, setReversalTone] = useState<'success' | 'error'>('success');

  const linkedLines = useMemo(
    () => detail.lines.filter((line) => line.itemId && line.item),
    [detail.lines]
  );

  async function loadHistory() {
    setLoading(true);
    try {
      const payload = await api<StocktakeMovementHistoryPayload>(`/api/stocktake/${detail.id}/movements`);
      setHistory(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load stocktake movement history');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, [detail.id]);

  useEffect(() => {
    setCorrections((current) => {
      const next: Record<string, CorrectionDraftState> = {};
      for (const line of linkedLines) {
        next[line.id] = current[line.id] ?? {
          quantityAfter: String(line.item?.onHand ?? line.countedQty),
          reason: '',
          saving: false,
          feedback: null,
          feedbackTone: 'success'
        };
      }
      return next;
    });
  }, [linkedLines]);

  function updateCorrection(lineId: string, patch: Partial<CorrectionDraftState>) {
    setCorrections((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] ?? {
          quantityAfter: '',
          reason: '',
          saving: false,
          feedback: null,
          feedbackTone: 'success'
        }),
        ...patch
      }
    }));
  }

  async function submitCorrection(line: StocktakeWithLines['lines'][number]) {
    const draft = corrections[line.id];
    if (!draft) return;
    const confirmed = confirmDangerousAction({
      title: `Save ledger correction for ${line.label}?`,
      message:
        'This creates a STOCKTAKE_CORRECTION movement and updates the linked item balance through the ledger-backed correction flow.',
      confirmationText: 'SAVE CORRECTION'
    });
    if (!confirmed) return;

    updateCorrection(line.id, { feedback: null, saving: true });
    try {
      await api<StocktakeMovementResult>(`/api/stocktake/${detail.id}/corrections`, {
        method: 'POST',
        body: JSON.stringify({
          corrections: [
            {
              sourceStocktakeLineId: line.id,
              quantityAfter: Number(draft.quantityAfter || 0),
              reason: draft.reason.trim()
            }
          ]
        })
      });
      updateCorrection(line.id, {
        feedback: 'Correction saved.',
        feedbackTone: 'success',
        saving: false
      });
      await loadHistory();
      onChanged();
    } catch (err) {
      updateCorrection(line.id, {
        feedback: err instanceof ApiError ? err.message : 'Could not save correction',
        feedbackTone: 'error',
        saving: false
      });
    }
  }

  async function reverseStocktake() {
    const confirmed = confirmDangerousAction({
      title: `Reverse "${detail.name}"?`,
      message:
        'This writes ledger reversal movements and returns the stocktake to draft so it can be edited or deleted safely.',
      confirmationText: 'REVERSE LEDGER'
    });
    if (!confirmed) return;

    setReversing(true);
    setReversalFeedback(null);
    try {
      await api<StocktakeMovementResult>(`/api/stocktake/${detail.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reversalReason.trim() })
      });
      setReversalFeedback('Reversal movements saved.');
      setReversalTone('success');
      await loadHistory();
      onChanged();
    } catch (err) {
      setReversalFeedback(err instanceof ApiError ? err.message : 'Could not reverse stocktake');
      setReversalTone('error');
    } finally {
      setReversing(false);
    }
  }

  if (!loading && !history?.movements.length && !detail.appliedAt) return null;

  const canChangeLedger = canManageReview && Boolean(detail.appliedAt) && Boolean(history?.canReverse);

  return (
    <div className="stocktake-review-panel">
      <div className="stocktake-review-header">
        <div>
          <h4>Movement history</h4>
          <p className="subtle">Ledger-backed records created from approval, corrections and reversals.</p>
        </div>
        {history?.hasReversal ? (
          <Badge tone="danger" dot>Reversed</Badge>
        ) : detail.appliedAt ? (
          <Badge tone="info" dot>Applied</Badge>
        ) : (
          <Badge tone="warning" dot>Draft after reversal</Badge>
        )}
      </div>

      {loading ? <Spinner label="Loading movement history" /> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {history?.movements.length ? (
        <div className="stocktake-table-scroll">
          <table className="recipe-lines-table stocktake-movement-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Item</th>
                <th>Line</th>
                <th>Before</th>
                <th>Delta</th>
                <th>After</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {history.movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.createdAt)}</td>
                  <td>
                    <Badge tone={movementTone(movement.movementType)}>{movementTypeLabel(movement.movementType)}</Badge>
                  </td>
                  <td>{movement.item?.name ?? movement.itemId}</td>
                  <td>{movement.sourceStocktakeLine?.label ?? 'Stocktake'}</td>
                  <td>{formatQuantity(movement.quantityBefore, movement.unit)}</td>
                  <td>
                    <span className={movement.quantityDelta === 0 ? 'subtle' : movement.quantityDelta > 0 ? 'stocktake-variance-positive' : 'stocktake-variance-negative'}>
                      {formatSignedQuantity(movement.quantityDelta, movement.unit)}
                    </span>
                  </td>
                  <td>{formatQuantity(movement.quantityAfter, movement.unit)}</td>
                  <td>{movement.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="subtle">No ledger movements have been created for this stocktake yet.</p>
      )}

      {detail.appliedAt && !history?.hasReversal ? (
        <div className="stocktake-review-actions">
          <div className="stocktake-correction-list">
            <h4>Ledger-backed corrections</h4>
            {!canManageReview ? (
              <p className="subtle">Manager access is required to correct applied stocktakes.</p>
            ) : linkedLines.length === 0 ? (
              <p className="subtle">No linked stock items are available for corrections.</p>
            ) : (
              linkedLines.map((line) => {
                const draft = corrections[line.id];
                return (
                  <div key={line.id} className="stocktake-correction-row">
                    <span className="cell-stack">
                      <strong>{line.label}</strong>
                      <span className="subtle">Current: {formatQuantity(line.item?.onHand ?? 0, line.unit ?? line.item?.unit ?? null)}</span>
                    </span>
                    <Input
                      label="Correct to"
                      type="number"
                      step="0.01"
                      value={draft?.quantityAfter ?? ''}
                      disabled={!canChangeLedger}
                      onChange={(event) => updateCorrection(line.id, { quantityAfter: event.currentTarget.value })}
                    />
                    <Input
                      label="Reason"
                      value={draft?.reason ?? ''}
                      disabled={!canChangeLedger}
                      onChange={(event) => updateCorrection(line.id, { reason: event.currentTarget.value })}
                      placeholder="e.g. recount found one extra"
                    />
                    <div className="stocktake-inline-action">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={!canChangeLedger || draft?.saving}
                        onClick={() => void submitCorrection(line)}
                      >
                        {draft?.saving ? 'Saving...' : 'Save ledger correction'}
                      </Button>
                      <ActionFeedback message={draft?.feedback} tone={draft?.feedbackTone} />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="stocktake-reversal-box">
            <h4>Ledger-backed reversal</h4>
            <p className="subtle">Use this when the approved count needs to be edited or deleted. It creates reversal movements first.</p>
            <Input
              label="Reason"
              value={reversalReason}
              disabled={!canChangeLedger || reversing}
              onChange={(event) => setReversalReason(event.currentTarget.value)}
              placeholder="e.g. wrong stocktake approved"
            />
            <div className="stocktake-inline-action">
              <Button
                type="button"
                variant="danger"
                disabled={!canChangeLedger || reversing}
                onClick={() => void reverseStocktake()}
              >
                {reversing ? 'Reversing...' : 'Create ledger reversal'}
              </Button>
              <ActionFeedback message={reversalFeedback} tone={reversalTone} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
