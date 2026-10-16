import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  StockCategory,
  StockItem,
  StockItemsPayload,
  Stocktake,
  StocktakeLine,
  StocktakeLinesPatchResult,
  StocktakePrepRecipeOption,
  StocktakeScope,
  StocktakeWithLines
} from '@alma/shared';
import {
  IMPLAUSIBLE_COUNT_FLOOR_CENTS,
  IMPLAUSIBLE_COUNT_SHARE,
  convertQuantityToCostUnit,
  countSearchMatcher,
  normaliseUnitLabel,
  organiseCountRows,
  setActiveUnitAliases,
  type CountSection
} from '@alma/shared';
import { Badge, Button, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { ItemEditDrawer } from '../features/items/ItemEditDrawer';
import { PreppedItemsPicker } from '../components/PreppedItemsPicker';
import { StockItemPicker } from '../components/StockItemPicker';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

/**
 * The counting screen.
 *
 * One count, one list: categories in walking order, wines grouped by name
 * with their vintages underneath, a search box that filters the whole sheet
 * as you type, and a quantity box per line that saves itself. Enter or Tab
 * moves to the next line, opening the next category when the current one
 * runs out, so a manager with a keyboard keys a sheet in the way they would
 * a spreadsheet, and a manager with a phone taps, types, taps Next.
 *
 * Nothing here is submitted by saving. Counts go to the API a few hundred
 * milliseconds after they are typed, line by line, and the screen says
 * whether they have landed. Submitting for review is a separate, manager
 * only, deliberate act.
 */

type LineMeta = {
  id: string;
  itemId: string;
  recipeId: string;
  label: string;
  unit: string;
  notes: string;
  position: number;
};

type LinePatch = { countedQty?: string; unit?: string; label?: string; notes?: string };

type SaveState = 'saved' | 'saving' | 'error' | 'offline' | 'closed';

const SCOPE_LABELS: Record<StocktakeScope, string> = {
  FOOD: 'Food',
  BEVERAGE: 'Beverage',
  COMBINED: 'Combined',
  UNKNOWN: 'Scope unknown'
};

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'AUD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTimeInput(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatQty(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function isOpenForCounting(stocktake: Pick<Stocktake, 'status' | 'appliedAt'>) {
  return !stocktake.appliedAt && (stocktake.status === 'IN_PROGRESS' || stocktake.status === 'REOPENED');
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

// Live value estimate, using the same conversion the API applies on save so
// the number on screen is the number that lands.
function estimateLineValueCents(item: StockItem | undefined, countedQty: number | null, unit: string | null) {
  if (!item) return { cents: null as number | null, unitMismatch: false, countUnit: null as string | null, unitCostCents: null as number | null };
  const unitCostCents = stockUnitCostCents(item) ?? null;
  const countUnit = stockCountUnit(item);
  if (countedQty === null || unitCostCents === null) return { cents: null, unitMismatch: false, countUnit, unitCostCents };
  const conv = convertQuantityToCostUnit(countedQty, unit, item);
  const unitMismatch = conv.via === 'unknown' && !!unit && normaliseUnitLabel(unit) !== normaliseUnitLabel(countUnit);
  return { cents: unitMismatch ? null : Math.round(unitCostCents * conv.quantity), unitMismatch, countUnit, unitCostCents };
}

function parseQty(raw: string): number | null {
  const text = raw.trim();
  if (text === '') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

// Digits and one decimal point — the field is text so phones show the
// decimal keypad and the scroll wheel cannot change a number already typed.
function sanitiseQty(raw: string) {
  const cleaned = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

function lineMeta(line: StocktakeLine): LineMeta {
  return {
    id: line.id,
    itemId: line.itemId ?? '',
    recipeId: line.recipeId ?? '',
    label: line.label,
    unit: line.unit ?? line.item?.unit ?? '',
    notes: line.notes ?? '',
    position: line.position
  };
}

async function loadUnitAliases() {
  try {
    const rows = await api<Array<{ alias: string; canonical: string }>>('/api/items/unit-aliases');
    if (rows.length > 0) setActiveUnitAliases(Object.fromEntries(rows.map((row) => [row.alias, row.canonical])));
  } catch {
    /* defaults still apply */
  }
}

/**
 * Autosave: patches queue per line, flush after a short pause, retry with
 * backoff, and never lose a keystroke — a patch that fails goes back under
 * anything newer for the same line. A flush on page hide uses keepalive so a
 * phone locking mid-count still delivers the last number.
 */
function useLineAutosave(stocktakeId: string | undefined, onSaved: (result: StocktakeLinesPatchResult) => void) {
  const queue = useRef(new Map<string, LinePatch>());
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const flushAgain = useRef(false);
  const attempts = useRef(0);
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [state, setState] = useState<SaveState>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const flush = useCallback(
    async (options: { keepalive?: boolean } = {}) => {
      if (!stocktakeId) return;
      if (inFlight.current) {
        flushAgain.current = true;
        return;
      }
      if (queue.current.size === 0) return;
      const batch = new Map(queue.current);
      queue.current = new Map();
      inFlight.current = true;
      setState('saving');
      try {
        const result = await api<StocktakeLinesPatchResult>(`/api/stocktake/${stocktakeId}/lines`, {
          method: 'PATCH',
          body: JSON.stringify({ lines: Array.from(batch.entries()).map(([id, patch]) => ({ id, ...patch })) }),
          keepalive: options.keepalive ?? false
        });
        attempts.current = 0;
        setFailedIds((current) => {
          if (current.size === 0) return current;
          const next = new Set(current);
          batch.forEach((_, id) => next.delete(id));
          return next;
        });
        setPendingIds((current) => {
          const next = new Set(current);
          batch.forEach((_, id) => {
            if (!queue.current.has(id)) next.delete(id);
          });
          return next;
        });
        setLastSavedAt(new Date());
        setMessage(null);
        onSaved(result);
        setState(queue.current.size > 0 ? 'saving' : 'saved');
      } catch (err) {
        // Put the failed patches back, underneath anything typed since.
        batch.forEach((patch, id) => {
          queue.current.set(id, { ...patch, ...(queue.current.get(id) ?? {}) });
        });
        const closed = err instanceof ApiError && (err.status === 403 || err.status === 409 || err.status === 404);
        if (closed) {
          setState('closed');
          setMessage(err.message);
        } else {
          attempts.current += 1;
          setFailedIds((current) => {
            const next = new Set(current);
            batch.forEach((_, id) => next.add(id));
            return next;
          });
          setState(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
          setMessage(err instanceof ApiError ? err.message : 'Could not reach the Stock API');
          const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempts.current - 1, 4));
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void flush(), delay);
        }
      } finally {
        inFlight.current = false;
        if (flushAgain.current) {
          flushAgain.current = false;
          void flush();
        }
      }
    },
    [stocktakeId, onSaved]
  );

  const enqueue = useCallback(
    (lineId: string, patch: LinePatch) => {
      queue.current.set(lineId, { ...(queue.current.get(lineId) ?? {}), ...patch });
      setPendingIds((current) => (current.has(lineId) ? current : new Set(current).add(lineId)));
      setState((current) => (current === 'closed' ? current : 'saving'));
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), 600);
    },
    [flush]
  );

  const retry = useCallback(() => {
    attempts.current = 0;
    if (timer.current) window.clearTimeout(timer.current);
    void flush();
  }, [flush]);

  useEffect(() => {
    function onHide() {
      if (document.visibilityState === 'hidden' && queue.current.size > 0) void flush({ keepalive: true });
    }
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (queue.current.size > 0 || inFlight.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    }
    function onOnline() {
      if (queue.current.size > 0) retry();
    }
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('online', onOnline);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [flush, retry]);

  const hasUnsaved = pendingIds.size > 0;
  return { enqueue, flush, retry, state, message, lastSavedAt, pendingIds, failedIds, hasUnsaved };
}

export function StocktakeCountPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageStock(user);

  const [stocktake, setStocktake] = useState<StocktakeWithLines | null>(null);
  const [meta, setMeta] = useState<LineMeta[]>([]);
  const [qty, setQty] = useState<Map<string, string>>(() => new Map());
  const [items, setItems] = useState<StockItem[]>([]);
  const [categories, setCategories] = useState<StockCategory[]>([]);
  const [prepRecipes, setPrepRecipes] = useState<StocktakePrepRecipeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());
  const [showExpected, setShowExpected] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pendingFocus = useRef<string | null>(null);

  useDocumentTitle(stocktake ? `Count · ${stocktake.name}` : 'Count');

  const onSaved = useCallback((result: StocktakeLinesPatchResult) => {
    setStocktake((current) => (current ? { ...current, updatedAt: result.updatedAt } : current));
  }, []);
  const autosave = useLineAutosave(id, onSaved);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const detail = await api<StocktakeWithLines>(`/api/stocktake/${id}`);
      const [picker, prep] = await Promise.all([
        api<StockItemsPayload>(`/api/items/picker${detail.venue ? `?venue=${encodeURIComponent(detail.venue)}` : ''}`),
        api<{ prepRecipes: StocktakePrepRecipeOption[] }>('/api/stocktake/prep-recipes').catch(() => ({ prepRecipes: [] }))
      ]);
      setStocktake(detail);
      setMeta(detail.lines.map(lineMeta));
      setQty(new Map(detail.lines.map((line) => [line.id, formatQty(line.countedQty)])));
      setItems(picker.items);
      setCategories(picker.categories);
      setPrepRecipes(prep.prepRecipes);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this count');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
    void loadUnitAliases();
  }, [load]);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const open = stocktake ? isOpenForCounting(stocktake) : false;
  const readOnly = !open || autosave.state === 'closed';

  // The walk: categories in order, wines grouped. Depends on the sheet's
  // structure (which lines, which items), never on the quantities, so typing
  // does not re-sort 800 rows.
  const sections = useMemo(
    () =>
      organiseCountRows(meta, {
        name: (line) => (line.itemId ? itemsById.get(line.itemId)?.name ?? line.label : line.label),
        category: (line) => {
          const item = line.itemId ? itemsById.get(line.itemId) : undefined;
          return item ? item.category?.name ?? item.categoryName ?? null : null;
        },
        isPrep: (line) => Boolean(line.recipeId)
      }),
    [meta, itemsById]
  );

  // Open the first category that still has something to count, once.
  const seededOpen = useRef(false);
  useEffect(() => {
    if (seededOpen.current || sections.length === 0) return;
    seededOpen.current = true;
    const first = sections.find((section) => section.groups.some((group) => group.entries.some((entry) => (qty.get(entry.row.id) ?? '') === ''))) ?? sections[0];
    if (first) setOpenSections(new Set([first.category]));
  }, [sections, qty]);

  const matcher = useMemo(() => countSearchMatcher(query), [query]);
  const searching = query.trim() !== '';

  // What is on screen: when searching, every matching row in every category;
  // otherwise the open categories.
  const visible = useMemo(() => {
    const out: Array<{ section: CountSection<LineMeta>; groups: CountSection<LineMeta>['groups'] }> = [];
    for (const section of sections) {
      if (!searching) {
        out.push({ section, groups: openSections.has(section.category) ? section.groups : [] });
        continue;
      }
      const groups = section.groups
        .map((group) => ({
          ...group,
          entries: group.entries.filter((entry) =>
            matcher(`${group.name} ${entry.vintageLabel ?? ''} ${entry.detail ?? ''} ${entry.row.label} ${section.category}`)
          )
        }))
        .filter((group) => group.entries.length > 0);
      if (groups.length > 0) out.push({ section, groups });
    }
    return out;
  }, [sections, openSections, searching, matcher]);

  const visibleOrder = useMemo(
    () => visible.flatMap((entry) => entry.groups.flatMap((group) => group.entries.map((e) => e.row.id))),
    [visible]
  );
  const matchCount = searching ? visibleOrder.length : null;

  const counted = useMemo(() => {
    let n = 0;
    qty.forEach((value) => {
      if (value.trim() !== '') n += 1;
    });
    return n;
  }, [qty]);

  // A line worth a large share of the whole count is a units mistake, not a
  // count. One pass per keystroke over the sheet is cheap; passing the total
  // into every row would re-render all of them instead.
  const flagged = useMemo(() => {
    let total = 0;
    const values: Array<[string, number]> = [];
    for (const line of meta) {
      const item = line.itemId ? itemsById.get(line.itemId) : undefined;
      if (!item) continue;
      const value = parseQty(qty.get(line.id) ?? '');
      if (value === null) continue;
      const cents = estimateLineValueCents(item, value, line.unit || null).cents ?? 0;
      if (cents > 0) {
        total += cents;
        values.push([line.id, cents]);
      }
    }
    const set = new Set<string>();
    if (total > 0) {
      for (const [lineId, cents] of values) {
        if (cents >= IMPLAUSIBLE_COUNT_FLOOR_CENTS && cents / total >= IMPLAUSIBLE_COUNT_SHARE) set.add(lineId);
      }
    }
    return { set, total };
  }, [meta, qty, itemsById]);

  const toggleSection = useCallback((name: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setLineQty = useCallback(
    (lineId: string, raw: string) => {
      const value = sanitiseQty(raw);
      setQty((current) => {
        if (current.get(lineId) === value) return current;
        const next = new Map(current);
        next.set(lineId, value);
        return next;
      });
      autosave.enqueue(lineId, { countedQty: value });
    },
    [autosave]
  );

  // Focus a line's box once it exists — used after opening the next category
  // or adding a line, when the input is not in the DOM yet.
  useEffect(() => {
    if (!pendingFocus.current) return;
    const target = document.querySelector<HTMLInputElement>(`input[data-line-id="${pendingFocus.current}"]`);
    if (target) {
      pendingFocus.current = null;
      target.focus();
      target.select();
    }
  });

  const focusLine = useCallback((lineId: string) => {
    const target = document.querySelector<HTMLInputElement>(`input[data-line-id="${lineId}"]`);
    if (target) {
      target.focus();
      target.select();
    } else {
      pendingFocus.current = lineId;
    }
  }, []);

  // Enter / Tab: next box. Past the end of an open category, open the next
  // one that has lines and land on its first box. Shift+Tab goes back.
  const moveFrom = useCallback(
    (lineId: string, direction: 1 | -1) => {
      const index = visibleOrder.indexOf(lineId);
      const next = visibleOrder[index + direction];
      if (next) {
        focusLine(next);
        return true;
      }
      if (searching || direction === -1) return false;
      const currentSection = sections.find((section) => section.groups.some((group) => group.entries.some((e) => e.row.id === lineId)));
      const from = currentSection ? sections.indexOf(currentSection) : -1;
      const following = sections.slice(from + 1).find((section) => section.rowCount > 0);
      if (!following) return false;
      const first = following.groups[0]?.entries[0]?.row.id;
      if (!first) return false;
      setOpenSections((current) => new Set(current).add(following.category));
      pendingFocus.current = first;
      return true;
    },
    [visibleOrder, sections, searching, focusLine]
  );

  const onLineKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, lineId: string) => {
      if (event.key === 'Enter' || (event.key === 'Tab' && !event.shiftKey)) {
        if (moveFrom(lineId, 1)) event.preventDefault();
        else if (event.key === 'Enter') event.currentTarget.blur();
      } else if (event.key === 'Tab' && event.shiftKey) {
        if (moveFrom(lineId, -1)) event.preventDefault();
      }
    },
    [moveFrom]
  );

  async function addItemLine(itemId: string) {
    if (!id || !itemId) return;
    try {
      const line = await api<StocktakeLine>(`/api/stocktake/${id}/lines`, { method: 'POST', body: JSON.stringify({ itemId }) });
      setMeta((current) => [...current, lineMeta(line)]);
      setQty((current) => new Map(current).set(line.id, ''));
      const item = itemsById.get(itemId);
      const category = item ? item.category?.name ?? item.categoryName ?? 'Uncategorised' : 'Uncategorised';
      setOpenSections((current) => new Set(current).add(category));
      setQuery('');
      setNotice(null);
      focusLine(line.id);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not add that item');
    }
  }

  async function addPrepLines(chosen: StocktakePrepRecipeOption[]) {
    if (!id) return;
    for (const recipe of chosen) {
      try {
        const line = await api<StocktakeLine>(`/api/stocktake/${id}/lines`, { method: 'POST', body: JSON.stringify({ recipeId: recipe.id }) });
        setMeta((current) => [...current, lineMeta(line)]);
        setQty((current) => new Map(current).set(line.id, ''));
      } catch (err) {
        setNotice(err instanceof ApiError ? err.message : `Could not add ${recipe.title}`);
      }
    }
    setOpenSections((current) => new Set(current).add('Prep (made items)'));
  }

  async function removeLine(lineId: string) {
    if (!id) return;
    try {
      await api(`/api/stocktake/${id}/lines/${lineId}`, { method: 'DELETE' });
      setMeta((current) => current.filter((line) => line.id !== lineId));
      setQty((current) => {
        const next = new Map(current);
        next.delete(lineId);
        return next;
      });
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not remove that line');
    }
  }

  // An item edited from the sheet: the catalogue row changes, and any line
  // that was still carrying the old name or unit follows it. Lines keep what
  // was typed; completed counts elsewhere are untouched.
  function onItemSaved(saved: StockItem) {
    const before = itemsById.get(saved.id);
    setItems((current) => current.map((item) => (item.id === saved.id ? { ...item, ...saved, venueStock: item.venueStock } : item)));
    setMeta((current) =>
      current.map((line) => {
        if (line.itemId !== saved.id) return line;
        const patch: LinePatch = {};
        if (before && line.label === before.name && saved.name !== before.name) patch.label = saved.name;
        const oldUnit = before ? stockCountUnit(before) : null;
        const newUnit = stockCountUnit(saved);
        if (oldUnit && line.unit === oldUnit && newUnit !== oldUnit) patch.unit = newUnit;
        if (Object.keys(patch).length === 0) return line;
        autosave.enqueue(line.id, patch);
        return { ...line, ...patch };
      })
    );
  }

  async function submitForReview() {
    if (!id || !stocktake) return;
    const blanks = meta.length - counted;
    const ok = window.confirm(
      `Submit "${stocktake.name}" for review?\n\n${counted} of ${meta.length} lines counted.${
        blanks > 0 ? ` ${blanks} blank line${blanks === 1 ? '' : 's'} will be recorded as zero.` : ''
      }`
    );
    if (!ok) return;
    setSubmitting(true);
    try {
      await autosave.flush();
      await api<Stocktake>(`/api/stocktake/${id}/submit`, { method: 'POST' });
      navigate('/stocktake');
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not submit the count');
    } finally {
      setSubmitting(false);
    }
  }

  async function downloadExcel() {
    if (!id || !stocktake) return;
    try {
      await downloadCsv(`/api/stocktake/${id}/export.xlsx?blank=0`, `${stocktake.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}.xlsx`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not download the Excel sheet');
    }
  }

  if (loading && !stocktake) {
    return (
      <div className="count-page">
        <Spinner label="Loading the count" />
      </div>
    );
  }
  if (error || !stocktake) {
    return (
      <div className="count-page">
        <EmptyState icon={<IconStocktake size={24} />} title="Count unavailable" description={error ?? 'Not found.'} action={<Link className="btn btn-secondary btn-md" to="/stocktake"><span>Back to counts</span></Link>} />
      </div>
    );
  }

  const editingItem = editingItemId ? itemsById.get(editingItemId) ?? null : null;
  const editingLine = editingItemId ? meta.find((line) => line.itemId === editingItemId) ?? null : null;
  const progressPct = meta.length ? Math.round((counted / meta.length) * 100) : 0;

  return (
    <div className="count-page">
      <header className="count-head">
        <div className="count-head-row">
          <Link to="/stocktake" className="count-back" aria-label="Back to counts">‹ Counts</Link>
          <div className="count-title">
            <strong>{stocktake.name}</strong>
            <span className="subtle">
              {stocktake.venue ?? 'Venue not set'} · {formatDate(stocktake.countedAt)}
              {stocktake.status !== 'IN_PROGRESS' ? <> · <Badge tone={open ? 'warning' : 'neutral'}>{stocktake.status === 'REOPENED' ? 'Reopened' : stocktake.status.toLowerCase()}</Badge></> : null}
            </span>
          </div>
          <SaveIndicator state={autosave.state} message={autosave.message} lastSavedAt={autosave.lastSavedAt} readOnly={readOnly} onRetry={autosave.retry} />
        </div>
        <div className="count-tools">
          <input
            type="search"
            className="count-search"
            placeholder="Search item or vintage…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
              if (event.key === 'Enter' && visibleOrder[0]) {
                event.preventDefault();
                focusLine(visibleOrder[0]);
              }
            }}
            aria-label="Search this count"
            autoComplete="off"
            enterKeyHint="search"
          />
          <div className="count-progress" title={`${counted} of ${meta.length} lines counted`}>
            <span>{counted} / {meta.length}</span>
            <div className="count-progress-track" aria-hidden><div className="count-progress-bar" style={{ width: `${progressPct}%` }} /></div>
          </div>
          <div className="count-actions">
            <Button type="button" variant="ghost" size="sm" onClick={() => setDetailsOpen((value) => !value)} aria-expanded={detailsOpen}>
              Details
            </Button>
            <a className="btn btn-ghost btn-sm" href={`/stocktake/${stocktake.id}/print`} target="_blank" rel="noopener" title="Print sheet"><span>Print</span></a>
            <Button type="button" variant="ghost" size="sm" onClick={() => void downloadExcel()} title="Download this count as an Excel sheet">Excel</Button>
            {canManage && open ? (
              <Button type="button" size="sm" disabled={submitting} onClick={() => void submitForReview()}>
                {submitting ? 'Submitting…' : 'Submit for review'}
              </Button>
            ) : null}
          </div>
        </div>
        {detailsOpen ? (
          <CountDetails
            stocktake={stocktake}
            canManage={canManage && open}
            showExpected={showExpected}
            onShowExpected={setShowExpected}
            onSaved={(next) => setStocktake((current) => (current ? { ...current, ...next } : current))}
          />
        ) : null}
        {notice ? <p className="count-notice" role="status">{notice} <button type="button" className="link" onClick={() => setNotice(null)}>Dismiss</button></p> : null}
        {!open ? (
          <p className="count-notice is-closed">
            {stocktake.appliedAt ? 'This count has been applied to stock and can no longer be changed.' : 'This count is closed for counting. A manager can reopen it from the counts list.'}
          </p>
        ) : null}
      </header>

      <main className="count-body">
        {visible.length === 0 && searching ? (
          <div className="count-empty">
            <p>Nothing on this count matches “{query}”.</p>
            {!readOnly ? <StockItemPicker label="Add an item to this count" items={items} value="" onChange={(itemId) => void addItemLine(itemId)} /> : null}
          </div>
        ) : null}
        {visible.map(({ section, groups }) => {
          const isOpen = searching || openSections.has(section.category);
          const sectionCounted = section.groups.reduce((sum, group) => sum + group.entries.filter((entry) => (qty.get(entry.row.id) ?? '').trim() !== '').length, 0);
          return (
            <section key={section.category} className={`count-section${isOpen ? ' is-open' : ''}`}>
              <button type="button" className="count-section-head" onClick={() => toggleSection(section.category)} aria-expanded={isOpen}>
                <span className="count-section-name">{section.category}</span>
                <span className="count-section-meta">
                  {searching ? `${groups.reduce((n, g) => n + g.entries.length, 0)} match${groups.reduce((n, g) => n + g.entries.length, 0) === 1 ? '' : 'es'}` : `${sectionCounted} / ${section.rowCount}`}
                </span>
                <span className="count-section-chevron" aria-hidden>{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen ? (
                <div className="count-rows">
                  {groups.map((group) => {
                    const grouped = group.wine && group.entries.length > 1;
                    return (
                      <div key={group.key} className={`count-group${grouped ? ' is-wine-group' : ''}`}>
                        {grouped ? (
                          <div className="count-group-head">
                            <span>{group.name}</span>
                            <span className="subtle">{group.entries.length} vintages</span>
                          </div>
                        ) : null}
                        {group.entries.map((entry) => (
                          <CountRow
                            key={entry.row.id}
                            line={entry.row}
                            item={entry.row.itemId ? itemsById.get(entry.row.itemId) : undefined}
                            name={grouped ? null : group.name}
                            vintage={group.wine ? entry.vintageLabel : null}
                            detail={entry.detail}
                            value={qty.get(entry.row.id) ?? ''}
                            flagged={flagged.set.has(entry.row.id)}
                            pending={autosave.pendingIds.has(entry.row.id)}
                            failed={autosave.failedIds.has(entry.row.id)}
                            showExpected={showExpected}
                            readOnly={readOnly}
                            canEdit={canManage && Boolean(entry.row.itemId)}
                            onChange={setLineQty}
                            onKeyDown={onLineKey}
                            onEdit={setEditingItemId}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>
          );
        })}

        {!searching && !readOnly ? (
          <div className="count-add">
            <StockItemPicker label="Add an item that is not on this count" items={items} value="" onChange={(itemId) => void addItemLine(itemId)} />
            <PreppedItemsPicker recipes={prepRecipes} lines={meta} onAdd={(chosen) => void addPrepLines(chosen)} />
          </div>
        ) : null}

        {!readOnly && flagged.total > 0 ? (
          <p className="subtle count-total">Counted value so far {formatCurrency(flagged.total)} — values are checked again when the count is reviewed.</p>
        ) : null}
      </main>

      {editingItem ? (
        <ItemEditDrawer
          itemId={editingItem.id}
          categories={categories}
          canRemoveLine={Boolean(editingLine) && !readOnly}
          onCategoryCreated={(category) => setCategories((current) => (current.some((c) => c.id === category.id) ? current : [...current, category].sort((a, b) => a.name.localeCompare(b.name))))}
          onSaved={(saved) => {
            onItemSaved(saved);
            setEditingItemId(null);
          }}
          onRemoveLine={editingLine ? () => void removeLine(editingLine.id).then(() => setEditingItemId(null)) : undefined}
          onClose={() => setEditingItemId(null)}
        />
      ) : null}
    </div>
  );
}

function SaveIndicator({ state, message, lastSavedAt, readOnly, onRetry }: { state: SaveState; message: string | null; lastSavedAt: Date | null; readOnly: boolean; onRetry: () => void }) {
  if (readOnly && state !== 'closed') return <span className="count-save is-readonly">Read only</span>;
  switch (state) {
    case 'saving':
      return <span className="count-save is-saving">Saving…</span>;
    case 'error':
    case 'offline':
      return (
        <span className="count-save is-error" role="alert">
          {state === 'offline' ? 'Offline — will save when back online' : 'Not saved yet'}
          <button type="button" className="link" onClick={onRetry}>Retry</button>
          {message ? <span className="count-save-detail">{message}</span> : null}
        </span>
      );
    case 'closed':
      return <span className="count-save is-error" role="alert">{message ?? 'This count can no longer be changed.'}</span>;
    default:
      return (
        <span className="count-save is-saved">
          ✓ Saved{lastSavedAt ? ` ${lastSavedAt.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : ''}
        </span>
      );
  }
}

type CountRowProps = {
  line: LineMeta;
  item: StockItem | undefined;
  /** Full name for a standalone row; null inside a wine group (the group head carries it). */
  name: string | null;
  vintage: string | null;
  detail: string | null;
  value: string;
  flagged: boolean;
  pending: boolean;
  failed: boolean;
  showExpected: boolean;
  readOnly: boolean;
  canEdit: boolean;
  onChange: (lineId: string, raw: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>, lineId: string) => void;
  onEdit: (itemId: string) => void;
};

/**
 * One line. Memoised: a full count is 800 of these and only the one being
 * typed in should re-render on a keystroke.
 */
const CountRow = memo(function CountRow({ line, item, name, vintage, detail, value, flagged, pending, failed, showExpected, readOnly, canEdit, onChange, onKeyDown, onEdit }: CountRowProps) {
  const parsed = parseQty(value);
  const estimate = item ? estimateLineValueCents(item, parsed, line.unit || null) : null;
  const expected = item ? item.venueStock?.onHand ?? item.onHand : null;
  const measurePer = item?.measurePerCountUnit ?? null;
  const asMeasure = flagged && measurePer && measurePer > 0 && item?.measureUnit && parsed ? Math.round((parsed / measurePer) * 100) / 100 : null;
  const isPrep = Boolean(line.recipeId);

  let hint: string | null = null;
  let hintTone: '' | ' is-alert' | ' is-muted' = ' is-muted';
  if (estimate?.unitMismatch) {
    hint = `Unit “${line.unit}” does not match ${estimate.countUnit} — check the item`;
    hintTone = ' is-alert';
  } else if (flagged && estimate?.cents != null) {
    hint = `${formatCurrency(estimate.cents)} — most of this whole count. ${asMeasure !== null ? `If you counted ${item?.measureUnit}, that is about ${asMeasure} ${estimate.countUnit}.` : `Check you are counting ${estimate.countUnit}.`}`;
    hintTone = ' is-alert';
  } else if (showExpected && expected !== null && expected !== undefined) {
    hint = `Expected ${formatQty(expected) || '0'}`;
  }

  return (
    <div className={`count-row${pending ? ' is-pending' : ''}${failed ? ' is-failed' : ''}${isPrep ? ' is-prep' : ''}${name === null ? ' is-vintage' : ''}`}>
      <div className="count-row-main">
        <span className="count-row-name">
          {name === null ? (
            <>
              <span className="count-row-vintage">{vintage}</span>
              {detail ? <span className="count-row-detail">{detail}</span> : null}
            </>
          ) : (
            <>
              {vintage && vintage !== 'No year' ? <span className="count-row-vintage">{vintage}</span> : null}
              {name}
            </>
          )}
          {isPrep ? <span className="count-row-detail">made item</span> : null}
        </span>
        <span className="count-row-unit">{line.unit || estimate?.countUnit || ''}</span>
        {hint ? <span className={`count-row-hint${hintTone}`}>{hint}</span> : null}
      </div>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        className="count-qty"
        data-line-id={line.id}
        aria-label={`Count for ${name ?? `${vintage ?? ''} ${line.label}`.trim()}`}
        value={value}
        placeholder="–"
        disabled={readOnly}
        onChange={(event) => onChange(line.id, event.currentTarget.value)}
        onKeyDown={(event) => onKeyDown(event, line.id)}
        onFocus={(event) => event.currentTarget.select()}
      />
      {canEdit ? (
        <button type="button" className="count-row-edit" aria-label={`Edit ${line.label}`} title="Edit this item" onClick={() => onEdit(line.itemId)}>
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden><path d="M13.6 3.2a1.5 1.5 0 0 1 2.1 0l1.1 1.1a1.5 1.5 0 0 1 0 2.1L7.5 15.7 3.5 16.5l.8-4L13.6 3.2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </button>
      ) : (
        <span className="count-row-edit is-placeholder" aria-hidden />
      )}
    </div>
  );
});

/**
 * The count's own details — name, venue, date, scope, notes — tucked away
 * because they are set once and read never. Managers edit; counters read.
 */
function CountDetails({ stocktake, canManage, showExpected, onShowExpected, onSaved }: { stocktake: StocktakeWithLines; canManage: boolean; showExpected: boolean; onShowExpected: (value: boolean) => void; onSaved: (next: Partial<Stocktake>) => void }) {
  const [name, setName] = useState(stocktake.name);
  const [venue, setVenue] = useState(stocktake.venue ?? '');
  const [countedAt, setCountedAt] = useState(formatDateTimeInput(stocktake.countedAt));
  const [scope, setScope] = useState<StocktakeScope>(stocktake.scope ?? 'UNKNOWN');
  const [notes, setNotes] = useState(stocktake.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const dirty =
    name !== stocktake.name ||
    venue !== (stocktake.venue ?? '') ||
    countedAt !== formatDateTimeInput(stocktake.countedAt) ||
    scope !== (stocktake.scope ?? 'UNKNOWN') ||
    notes !== (stocktake.notes ?? '');

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const updated = await api<StocktakeWithLines>(`/api/stocktake/${stocktake.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim(), venue, countedAt: new Date(countedAt).toISOString(), scope, notes })
      });
      onSaved({ name: updated.name, venue: updated.venue, countedAt: updated.countedAt, scope: updated.scope, notes: updated.notes, updatedAt: updated.updatedAt });
      setFeedback('Saved.');
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const venues = ['Alma Avalon', 'St Alma'];
  const venueOptions = [{ label: 'Not set', value: '' }, ...(venue && !venues.includes(venue) ? [...venues, venue] : venues).map((v) => ({ label: v, value: v }))];

  return (
    <div className="count-details">
      <div className="form-grid three">
        <Input label="Name" value={name} disabled={!canManage} onChange={(event) => setName(event.currentTarget.value)} />
        <Select label="Venue" value={venue} disabled={!canManage} options={venueOptions} onChange={(event) => setVenue(event.currentTarget.value)} />
        <Input label="Counted at" type="datetime-local" value={countedAt} disabled={!canManage} onChange={(event) => setCountedAt(event.currentTarget.value)} />
      </div>
      <div className="form-grid two">
        <Select
          label="What this count covers"
          value={scope}
          disabled={!canManage}
          options={(Object.keys(SCOPE_LABELS) as StocktakeScope[]).map((key) => ({ label: SCOPE_LABELS[key], value: key }))}
          hint="Cost of goods needs a combined count, or a food count plus a beverage count, at each month end."
          onChange={(event) => setScope(event.currentTarget.value as StocktakeScope)}
        />
        <Textarea label="Notes" rows={2} value={notes} disabled={!canManage} onChange={(event) => setNotes(event.currentTarget.value)} />
      </div>
      <div className="count-details-foot">
        <label className="count-toggle">
          <input type="checkbox" checked={showExpected} onChange={(event) => onShowExpected(event.currentTarget.checked)} />
          Show expected on hand under each line
        </label>
        {canManage ? (
          <span className="count-details-save">
            {feedback ? <span className="subtle">{feedback}</span> : null}
            <Button type="button" size="sm" variant="secondary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save details'}</Button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
