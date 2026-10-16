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
  StocktakePrepPreview,
  StocktakePrepRecipeOption,
  StocktakeTemplate,
  StocktakeScope,
  StocktakeTemplatesPayload,
  StocktakeTemplateResolved,
  StocktakeWithLines,
  StocktakesPayload,
  StocktakesSummary
} from '@alma/shared';
import { isPseudoVenue } from '@alma/shared';
import { ActionFeedback, Badge, Button, Card, EmptyState, Input, Select, Spinner, StatCard } from '@alma/ui';
import { LoadedStocktakeImportCard } from '../components/LoadedStocktakeImportCard';
import { IconStocktake } from '../lib/icons';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, api } from '../lib/api';
import { downloadCsv } from '../lib/csv';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';
import { useAuth } from '../lib/auth';
import { canManageStock } from '../lib/stockPermissions';

const SCOPE_LABELS: Record<StocktakeScope, string> = {
  FOOD: 'Food',
  BEVERAGE: 'Beverage',
  COMBINED: 'Combined',
  UNKNOWN: 'Scope unknown'
};
function scopeLabel(scope: StocktakeScope | undefined) {
  return scope ? SCOPE_LABELS[scope] : 'Scope unknown';
}

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

// Still being counted, so anyone at the venue may enter counts. Once it is
// SUBMITTED it belongs to the reviewer; a manager reopens it to hand it back.
// The same rule is enforced server-side in stocktakes.service.updateStocktake.
function stockCountUnit(item: StockItem) {
  return item.countUnit ?? item.unit;
}

function stockUnitCostCents(item: StockItem) {
  if (item.latestCostCents !== null && item.latestCostCents !== undefined) {
    return Math.round(item.latestCostCents / Math.max(item.conversionFactor || 1, 1));
  }
  return item.avgCostCents;
}

function isOpenForCounting(status: Stocktake['status']) {
  return status === 'IN_PROGRESS' || status === 'REOPENED';
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

// Every status the API can hold, not the three the badge used to collapse
// them to. LOCKED in particular is the state the variance report depends on
// and there was no way to see it.
function stocktakeBadge(stocktake: Stocktake): { tone: 'info' | 'positive' | 'warning' | 'indigo' | 'neutral'; label: string } {
  if (stocktake.status === 'LOCKED') return { tone: 'indigo', label: 'Locked baseline' };
  if (stocktake.appliedAt) return { tone: 'info', label: 'Applied to stock' };
  switch (stocktake.status) {
    case 'SUBMITTED':
      return { tone: 'positive', label: 'Ready for review' };
    case 'REVIEWED':
      return { tone: 'positive', label: 'Reviewed, not applied' };
    case 'REOPENED':
      return { tone: 'warning', label: 'Reopened for correction' };
    default:
      return { tone: 'warning', label: 'In progress' };
  }
}

function countSheetUrl(stocktakeId: string) {
  return `/stocktake/${stocktakeId}/print`;
}

export function StocktakePage() {
  useDocumentTitle('Stocktake');
  const { user } = useAuth();
  const navigate = useNavigate();

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
  const [starting, setStarting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleting, setDeleting] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<null | 'submit' | 'approve'>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  // Outcomes that are not errors (a bulk submit that zeroed blanks, an
  // export that ran) used to go through `error`, which replaced the whole
  // history table with "Stocktakes unavailable". They get their own line.
  const [notice, setNotice] = useState<string | null>(null);
  const [venues, setVenues] = useState<string[]>([]);
  const canManageReview = canManageStock(user);

  async function load() {
    setLoading(true);
    try {
      const [list, sum, itemPayload] = await Promise.all([
        api<StocktakesPayload>('/api/stocktake'),
        api<StocktakesSummary>('/api/stocktake/summary'),
        api<StockItemsPayload>('/api/items/picker')
      ]);
      setData(list);
      setSummary(sum);
      setItems(itemPayload.items);
      setVenues((itemPayload.venues ?? []).filter((venue) => !isPseudoVenue(venue)));
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

  // REVIEWED (through the review endpoint) is still waiting to be applied;
  // the bulk approver already accepted it, the queue just did not show it.
  const readyForReview = useMemo(
    () =>
      (data?.stocktakes ?? [])
        .filter((stocktake) => (stocktake.status === 'SUBMITTED' || stocktake.status === 'REVIEWED') && !stocktake.appliedAt)
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

  // Counting happens on its own screen — one list, autosaved — so opening a
  // count is a navigation, not a form that takes over the history page.
  function openCount(stocktake: Stocktake) {
    if (stocktake.appliedAt) {
      setDetailError('Applied stocktakes cannot be edited.');
      return;
    }
    navigate(`/stocktake/${stocktake.id}/count`);
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

  /**
   * Lock a count so it becomes the baseline the next one is measured against.
   *
   * The variance report — counted versus what sales and deliveries say should
   * be there, which is the whole reason to count — needs a previous LOCKED
   * stocktake at the venue. In production **not one count had ever been
   * locked**, because the API could do it and nothing in the app called it. So
   * the report has always come back blank. Locking a single count turned it
   * from 0 to 149 comparable lines.
   */
  async function lockStocktake(stocktake: Stocktake) {
    if (!canManageReview) {
      setError('Manager access is required to lock stocktakes.');
      return;
    }
    const confirmed = confirmDangerousAction({
      title: `Lock "${stocktake.name}"?`,
      message:
        'A locked count becomes the baseline the next count is measured against, and reports prefer it. ' +
        'Lock it once you are happy the numbers are right — you can still reopen it with a reason.',
      confirmationText: 'LOCK COUNT'
    });
    if (!confirmed) return;

    setLockingId(stocktake.id);
    setError(null);
    try {
      await api<Stocktake>(`/api/stocktake/${stocktake.id}/lock`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not lock the stocktake.');
    } finally {
      setLockingId(null);
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
    if (!canManageReview) {
      setError('Manager access is required to export stocktakes.');
      return;
    }
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
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete stocktakes');
    } finally {
      setDeleting(false);
    }
  }

  async function submitSelectedStocktakes() {
    if (!canManageReview) {
      setError('Manager access is required to submit stocktakes for review.');
      return;
    }
    const targets = selectedStocktakes.filter(
      (stocktake) => stocktake.status === 'IN_PROGRESS' || stocktake.status === 'REOPENED'
    );
    if (targets.length === 0) {
      setError('Select one or more in-progress stocktakes to submit.');
      return;
    }
    setBulkBusy('submit');
    setError(null);
    setNotice(null);
    const results = await Promise.allSettled(
      targets.map((stocktake) => api<Stocktake>(`/api/stocktake/${stocktake.id}/submit`, { method: 'POST' }))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    // Submitting turns every blank line into a counted zero. It is the right
    // reading of a finished sheet, and it is still a real change to stock, so
    // it gets said out loud rather than happening quietly.
    const zeroed = results.reduce(
      (sum, r) => sum + (r.status === 'fulfilled' ? r.value.blankLinesZeroed ?? 0 : 0),
      0
    );
    setSelectedIds(new Set());
    setBulkBusy(null);
    await load();
    if (failed) setError(`Submitted ${results.length - failed} of ${results.length}; ${failed} could not be submitted.`);
    else if (zeroed > 0) {
      setNotice(
        `Submitted. ${zeroed} line${zeroed === 1 ? '' : 's'} left blank ${zeroed === 1 ? 'was' : 'were'} recorded as zero — check the variance report before approving.`
      );
    }
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
    // Apply sequentially, NOT in parallel: each approval is a ledger transaction
    // that reads then overwrites item on-hand, so two running at once on shared
    // items deadlock and exhaust the DB connection pool (which reads as the whole
    // section hanging). One at a time is also correct — each count sees the
    // previous one's applied balances.
    let failed = 0;
    let lastError: string | null = null;
    for (const stocktake of targets) {
      try {
        await api(`/api/stocktake/${stocktake.id}/approve`, { method: 'POST' });
      } catch (err) {
        failed += 1;
        lastError = err instanceof ApiError ? err.message : 'Could not approve stocktake';
      }
    }
    setSelectedIds(new Set());
    setBulkBusy(null);
    await load();
    if (failed) {
      setError(`Approved ${targets.length - failed} of ${targets.length}; ${failed} could not be approved${lastError ? ` (${lastError})` : ''}.`);
    }
  }

  return (
    <div className="page-stack stocktake-page">
      <div className="stat-grid">
        <StatCard icon={<IconStocktake size={18} />} label="Stocktakes" value={loading ? '—' : String(summary?.totalStocktakes ?? 0)} hint="On record across venues" />
        <StatCard label="Last counted" value={loading ? '—' : summary?.lastCountedAt ? formatDate(summary.lastCountedAt) : 'Never'} hint="Most recent count" />
        <StatCard label="In progress" value={loading ? '—' : String(summary?.inProgress ?? 0)} hint="Counts not yet submitted" tone={summary && summary.inProgress > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Ready for review" value={loading ? '—' : String(summary?.submitted ?? 0)} hint="Submitted counts" tone={summary && summary.submitted > 0 ? 'warning' : 'neutral'} />
        <StatCard
          label="Stock on hand"
          value={loading ? '—' : summary?.latestCount.valueCents != null ? formatCurrency(summary.latestCount.valueCents) : 'Unavailable'}
          hint={
            !summary
              ? 'Latest valid count'
              : summary.latestCount.status === 'ok'
                ? `Latest complete count, ${summary.latestCount.countedOn}${summary.latestCount.composition === 'food_and_beverage' ? ' (kitchen + bar)' : ''}`
                : summary.latestCount.reasons.length
                  ? summary.latestCount.reasons.join(' · ')
                  : summary.latestCount.venuesWithoutCount.length
                    ? `No complete count for ${summary.latestCount.venuesWithoutCount.join(', ')}`
                    : `No finalised count in the last ${summary.latestCount.windowDays} days`
          }
          tone={summary && summary.latestCount.status !== 'ok' ? 'warning' : 'neutral'}
        />
      </div>

      <LoadedStocktakeImportCard onImported={() => void load()} />

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
                        <span className="subtle">{stocktake.template ?? 'No template'} · {scopeLabel(stocktake.scope)}</span>
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
                        disabled={applyingId !== null || bulkBusy === 'approve' || !canManageReview}
                        title={canManageReview ? undefined : 'Manager access required'}
                        onClick={() => void applyStocktake(stocktake)}
                      >
                        {applyingId === stocktake.id ? 'Approving…' : 'Apply count to stock'}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={lockingId !== null || !canManageReview}
                        title={
                          canManageReview
                            ? 'Lock this count as the baseline the next one is measured against — the variance report needs it'
                            : 'Manager access required'
                        }
                        onClick={() => void lockStocktake(stocktake)}
                      >
                        {lockingId === stocktake.id ? 'Locking…' : 'Lock as baseline'}
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
                        disabled={!canManageReview}
                        title={canManageReview ? 'Download counted vs expected variance as CSV' : 'Manager access required'}
                        onClick={() => void downloadStocktakeCsv(stocktake)}
                      >
                        Export CSV
                      </Button>
                      <a
                        className="btn btn-ghost btn-sm"
                        href={countSheetUrl(stocktake.id)}
                        target="_blank"
                        rel="noopener"
                        title="Open the printable count sheet in a new tab"
                      >
                        <span>Print sheet</span>
                      </a>
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
        title="Stocktake history"
        subtitle="Start a count, count it on its own screen, then submit it for review here. Catalogue problems (units, costs) live under Items → Costing health."
        action={
          !starting ? (
            <Button
              type="button"
              size="sm"
              disabled={!canManageReview}
              title={canManageReview ? undefined : 'Manager access required'}
              onClick={() => setStarting(true)}
            >
              {canManageReview ? 'Start a count' : 'Manager required'}
            </Button>
          ) : null
        }
      >
        {starting ? (
          <StartCountCard
            items={items}
            venues={venues}
            defaultVenue={user?.venue && !isPseudoVenue(user.venue) ? user.venue : ''}
            onCancel={() => setStarting(false)}
          />
        ) : loading ? (
          <Spinner label="Loading stocktakes" />
        ) : error && !data ? (
          <EmptyState icon={<IconStocktake size={24} />} title="Stocktakes unavailable" description={error} />
        ) : data && data.stocktakes.length > 0 ? (
          <>
            {error || notice ? (
              <div className="stocktake-page-feedback">
                <ActionFeedback message={error} tone="error" />
                <ActionFeedback message={notice} tone="success" />
              </div>
            ) : null}
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
                        disabled={deleting || bulkBusy !== null || !canManageReview}
                        title={canManageReview ? 'Mark the selected drafts ready for review' : 'Manager access required'}
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
                                  <span className="subtle">{stocktake.template ?? '—'} · {scopeLabel(stocktake.scope)}</span>
                                </span>
                              </td>
                              <td>{stocktake.venue ?? '—'}</td>
                              <td>{formatDate(stocktake.countedAt)}</td>
                              <td>{stocktake.lineCount}</td>
                              <td>{formatCurrency(stocktake.totalValueCents)}</td>
                              <td>
                                <Badge tone={stocktakeBadge(stocktake).tone} dot>
                                  {stocktakeBadge(stocktake).label}
                                </Badge>
                              </td>
                              <td className="cell-actions">
                                {(stocktake.status === 'SUBMITTED' || stocktake.status === 'REVIEWED') && !stocktake.appliedAt ? (
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={applyingId !== null || bulkBusy === 'approve' || !canManageReview}
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
                                  disabled={
                                    Boolean(stocktake.appliedAt) ||
                                    !(canManageReview || isOpenForCounting(stocktake.status))
                                  }
                                  title={
                                    stocktake.appliedAt
                                      ? 'Applied stocktakes are locked until a ledger reversal exists.'
                                      : canManageReview || isOpenForCounting(stocktake.status)
                                        ? undefined
                                        : 'This count is closed for counting — ask a manager to reopen it.'
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    if (canManageReview || isOpenForCounting(stocktake.status)) {
                                      openCount(stocktake);
                                    }
                                  }}
                                >
                                  {canManageReview || isOpenForCounting(stocktake.status) ? 'Count' : 'View only'}
                                </Button>
                                {stocktake.appliedAt && stocktake.status !== 'LOCKED' && canManageReview ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={lockingId !== null}
                                    title="Lock this count as the baseline the next one is measured against — the variance report needs it"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void lockStocktake(stocktake);
                                    }}
                                  >
                                    {lockingId === stocktake.id ? 'Locking…' : 'Lock as baseline'}
                                  </Button>
                                ) : null}
                                {canManageReview ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    title="Download this count as CSV"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void downloadStocktakeCsv(stocktake);
                                    }}
                                  >
                                    Export CSV
                                  </Button>
                                ) : null}
                                <a
                                  className="btn btn-ghost btn-sm"
                                  href={countSheetUrl(stocktake.id)}
                                  target="_blank"
                                  rel="noopener"
                                  title="Open the printable count sheet in a new tab"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <span>Print sheet</span>
                                </a>
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
                onClick={() => setStarting(true)}
              >
                {canManageReview ? 'Start a count' : 'Manager required'}
              </Button>
            }
          />
        )}
      </Card>
    </div>
  );
}

/**
 * Starting a count: pick the sheet (template), the venue and the date, and
 * go. The count is created on the API with its lines straight away, blank,
 * so the counting screen has something to autosave into from the first tap.
 */
function StartCountCard({
  items,
  venues,
  defaultVenue,
  onCancel
}: {
  items: StockItem[];
  venues: string[];
  defaultVenue: string;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<StocktakeTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [venue, setVenue] = useState(defaultVenue);
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [countedAt, setCountedAt] = useState(() => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await api<StocktakeTemplatesPayload>('/api/stocktake-templates');
        if (cancelled) return;
        const active = payload.templates.filter((template) => template.active);
        setTemplates(active);
        // A manager at a venue starts on that venue's first sheet.
        const first = active.find((template) => !defaultVenue || template.venue === defaultVenue);
        if (first) {
          setTemplateId(first.id);
          if (!venue && first.venue) setVenue(first.venue);
        }
      } catch {
        if (!cancelled) setTemplates([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultVenue]);

  const template = templates?.find((entry) => entry.id === templateId) ?? null;
  const suggestedName = `${template ? template.name : 'Full count'} ${new Date(countedAt).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
  const effectiveName = nameTouched ? name : suggestedName;

  function chooseTemplate(id: string) {
    setTemplateId(id);
    const chosen = templates?.find((entry) => entry.id === id);
    if (chosen?.venue) setVenue(chosen.venue);
  }

  async function start() {
    setFeedback(null);
    if (!effectiveName.trim()) {
      setFeedback('Give the count a name.');
      return;
    }
    if (!venue) {
      setFeedback('Choose the venue this count is for.');
      return;
    }
    setBusy(true);
    try {
      let lines: Array<{ itemId: string; recipeId: string; label: string; unit: string; location: string; countedQty: null }>;
      let templateName = '';
      if (template) {
        const resolved = await api<StocktakeTemplateResolved>(`/api/stocktake-templates/${template.id}/resolve`);
        templateName = resolved.template.name;
        lines = [
          ...resolved.items.map((item) => ({ itemId: item.id, recipeId: '', label: item.name, unit: item.countUnit ?? item.unit, location: item.categoryName ?? '', countedQty: null })),
          ...(resolved.prepRecipes ?? []).map((recipe) => ({ itemId: '', recipeId: recipe.id, label: recipe.title, unit: recipe.yieldUnit ?? '', location: 'Prep (made items)', countedQty: null }))
        ];
      } else {
        templateName = 'Full count';
        lines = items
          .filter((item) => item.status === 'ACTIVE')
          .map((item) => ({ itemId: item.id, recipeId: '', label: item.name, unit: item.countUnit ?? item.unit, location: item.category?.name ?? item.categoryName ?? '', countedQty: null }));
      }
      if (lines.length === 0) {
        setFeedback('That sheet has no items. Check the template.');
        return;
      }
      const created = await api<StocktakeWithLines>('/api/stocktake', {
        method: 'POST',
        body: JSON.stringify({
          name: effectiveName.trim(),
          venue,
          template: templateName,
          countedAt: new Date(countedAt).toISOString(),
          status: 'IN_PROGRESS',
          lines
        })
      });
      navigate(`/stocktake/${created.id}/count`);
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Could not start the count');
    } finally {
      setBusy(false);
    }
  }

  // A count belongs to a venue. The blank option that used to sit here is
  // how a venue-less 778-line "count" came to exist in June 2026.
  const venueOptions = [...(venue ? [] : [{ label: 'Choose a venue', value: '' }]), ...(venues.length ? venues : ['Alma Avalon', 'St Alma']).map((entry) => ({ label: entry, value: entry }))];
  const templateOptions = [
    ...(templates ?? []).map((entry) => ({ label: `${entry.name}${entry.venue ? ` · ${entry.venue}` : ''} (${entry.resolvedItemCount} items)`, value: entry.id })),
    { label: `Full count — every active item (${items.filter((item) => item.status === 'ACTIVE').length})`, value: '' }
  ];

  return (
    <form
      className="start-count"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      <div className="form-grid three">
        <Select label="Count sheet" value={templateId} disabled={templates === null || busy} options={templateOptions} onChange={(event) => chooseTemplate(event.currentTarget.value)} />
        <Select label="Venue" value={venue} disabled={busy} options={venueOptions} onChange={(event) => setVenue(event.currentTarget.value)} />
        <Input label="Counted at" type="datetime-local" required value={countedAt} disabled={busy} onChange={(event) => setCountedAt(event.currentTarget.value)} />
      </div>
      <div className="form-grid two">
        <Input
          label="Name"
          value={effectiveName}
          disabled={busy}
          onChange={(event) => {
            setNameTouched(true);
            setName(event.currentTarget.value);
          }}
        />
        <div className="start-count-actions">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={busy || templates === null || !venue}>{busy ? 'Starting…' : 'Start counting'}</Button>
        </div>
      </div>
      <ActionFeedback message={feedback} tone="error" />
    </form>
  );
}

/**
 * What the prepped-item lines on a count will actually book.
 *
 * Shown before approval because the two ways this feature fails are both
 * silent. A prep line whose recipe has no yield explodes into nothing and
 * looks identical to one that worked. And an ingredient the prep holds but
 * the sheet never counted is deliberately NOT booked — setting its on-hand to
 * the tub's share alone would record every loose jar as shrinkage — which is
 * right, but only if somebody is told.
 */
function PrepPreviewPanel({ preview }: { preview: StocktakePrepPreview }) {
  const uncounted = preview.lines.filter((line) => line.countedQty === null);
  const explodedNothing = preview.lines.filter(
    (line) => line.countedQty !== null && line.componentCount === 0
  );

  return (
    <div className={`stocktake-prep-preview${explodedNothing.length || preview.notOnSheet.length ? ' is-alert' : ''}`}>
      <div className="stocktake-prep-preview-head">
        <span>Prepped items · {preview.lines.length} counted as made</span>
        <strong>
          {preview.totalValueCents === null ? 'value incomplete' : `${formatCurrency(preview.totalValueCents)} of raw material`}
        </strong>
      </div>
      <p className="subtle">
        Approving adds these quantities to the same items&apos; counted totals. Nothing is booked
        against a recipe.
      </p>

      {preview.contributions.length > 0 ? (
        <ul className="stocktake-prep-preview-list">
          {preview.contributions.map((row) => (
            <li key={row.itemId}>
              <span className="stocktake-shrinkage-name">{row.itemName}</span>
              <span className="stocktake-shrinkage-qty">
                counted {row.countedOnSheet} + {row.quantity} {row.unit} in {row.fromPrep.join(', ')}
              </span>
              <strong>
                {row.totalToBook} {row.unit}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="subtle">No ingredients resolved yet — check the warnings below.</p>
      )}

      {preview.notOnSheet.length > 0 ? (
        <div className="stocktake-prep-blocked">
          <strong>Held in prep but not counted on this sheet ({preview.notOnSheet.length})</strong>
          <p className="subtle">
            Their stock is left untouched on purpose — a prep line says what is inside a tub, not
            what is loose on the shelf. Add them to the count sheet to include them.
          </p>
          <ul>
            {preview.notOnSheet.map((row) => (
              <li key={row.itemId}>
                <strong>{row.itemName}</strong> — {row.quantity} {row.unit} in {row.fromPrep.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {explodedNothing.length > 0 ? (
        <div className="stocktake-prep-blocked">
          <strong>Counted but booked nothing ({explodedNothing.length})</strong>
          <ul>
            {explodedNothing.map((line) => (
              <li key={line.lineId}>
                <strong>{line.label}</strong> — {line.warnings.join(' ') || 'the recipe has no linked ingredients.'}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {uncounted.length > 0 ? (
        <p className="subtle">
          Not counted yet: {uncounted.map((line) => line.label).join(', ')}.
        </p>
      ) : null}
    </div>
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

  // What the prepped-item lines will book, run without writing anything. This
  // is NOT informational: a prep line that explodes into nothing looks exactly
  // like one that worked until the ledger is already wrong.
  const [prepPreview, setPrepPreview] = useState<StocktakePrepPreview | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const preview = await api<StocktakePrepPreview>(`/api/stocktake/${detail.id}/prep-preview`);
        if (!cancelled) setPrepPreview(preview);
      } catch {
        /* older API build — the panel simply doesn't appear */
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
          // The PATCH deletes and recreates every line from this payload, so a
          // bulk unit fix that forgot this would quietly unlink every prepped
          // item on the sheet and stop its ingredients being booked.
          recipeId: line.recipeId ?? '',
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
      {prepPreview && prepPreview.lines.length > 0 ? <PrepPreviewPanel preview={prepPreview} /> : null}
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
