import { useEffect, useMemo, useState } from 'react';
import type { StockItemDuplicateGroup, StockItemDuplicatesPayload, StockItemMergeResult } from '@alma/shared';
import { ActionFeedback, Badge, Button, CollapsibleCard } from '@alma/ui';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';

/**
 * Possible duplicate items, as the API sees them, with a one-click merge per
 * group. The detection rule lives in @alma/shared (stock-duplicates.ts) and
 * the merge in the API; this only shows the groups, lets a manager pick the
 * keeper (the suggested one is pre-selected) and confirms before merging.
 *
 * Flagged groups (different pack sizes, different units) can still be merged
 * — a manager may know they really are one shelf — but they say why they were
 * flagged and are never pre-selected.
 */

function formatCents(value: number | null) {
  if (value === null) return '—';
  return (value / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
}

function GroupRow({
  group,
  canManage,
  busy,
  onMerge
}: {
  group: StockItemDuplicateGroup;
  canManage: boolean;
  busy: boolean;
  onMerge: (group: StockItemDuplicateGroup, parentId: string) => void;
}) {
  const [parentId, setParentId] = useState(group.suggestedParentId);
  const flagged = group.sizeConflict || group.unitConflict;
  const keeper = group.items.find((item) => item.id === parentId);
  return (
    <div className={`stock-duplicate-group${flagged ? ' is-flagged' : ''}`}>
      <div className="stock-duplicate-group-head">
        <span className="stock-duplicate-group-title">
          {group.items.length} items that look like one
          {group.basis === 'exact' ? <Badge tone="neutral">same name</Badge> : <Badge tone="neutral">same product</Badge>}
          {group.sizeConflict ? <Badge tone="warning">different pack sizes</Badge> : null}
          {group.unitConflict ? <Badge tone="warning">different units</Badge> : null}
        </span>
        <Button
          type="button"
          size="sm"
          variant={flagged ? 'ghost' : 'secondary'}
          disabled={busy || !canManage || !keeper}
          title={
            !canManage
              ? 'Admin or group-wide manager access required'
              : flagged
                ? 'Flagged: check these really are the same product before merging'
                : `Merge the others into "${keeper?.name ?? ''}"`
          }
          onClick={() => onMerge(group, parentId)}
        >
          {busy ? 'Merging…' : `Keep "${keeper?.name ?? '—'}", merge the rest`}
        </Button>
      </div>
      <div className="stock-duplicate-members">
        {group.items.map((item) => (
          <label key={item.id} className={`stock-merge-option${parentId === item.id ? ' is-parent' : ''}`}>
            <input
              type="radio"
              name={`dup-${group.key}`}
              checked={parentId === item.id}
              disabled={!canManage}
              onChange={() => setParentId(item.id)}
            />
            <span className="stock-merge-name">{item.name}</span>
            <span className="subtle">
              {[
                item.sku,
                item.categoryName ?? 'Uncategorised',
                item.countUnit && item.countUnit !== item.unit ? `${item.unit} → ${item.countUnit}` : item.unit,
                item.countArea,
                formatCents(item.latestCostCents),
                `${item.onHand} on hand`,
                item.venues.length ? item.venues.join(' + ') : 'no venue stock',
                `${item.referenceCount} linked record${item.referenceCount === 1 ? '' : 's'}`
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            {item.id === group.suggestedParentId ? <Badge tone="info">suggested</Badge> : null}
          </label>
        ))}
      </div>
    </div>
  );
}

export function DuplicateItemsPanel({
  canManage,
  reloadKey,
  onFlagged,
  onMerged
}: {
  canManage: boolean;
  reloadKey: number;
  onFlagged: (ids: Set<string>, groupCount: number) => void;
  onMerged: (message: string) => void;
}) {
  const [report, setReport] = useState<StockItemDuplicatesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mergingKey, setMergingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void (async () => {
      try {
        const payload = await api<StockItemDuplicatesPayload>('/api/items/duplicates');
        if (cancelled) return;
        setReport(payload);
        setError(null);
        onFlagged(new Set(payload.groups.flatMap((group) => group.items.map((item) => item.id))), payload.groups.length);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not check for duplicates.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // onFlagged is a fresh closure every render; the report only needs
    // re-fetching when the catalogue changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, reloadKey]);

  const flaggedCount = useMemo(() => report?.groups.filter((group) => group.sizeConflict || group.unitConflict).length ?? 0, [report]);

  async function merge(group: StockItemDuplicateGroup, parentId: string) {
    const keeper = group.items.find((item) => item.id === parentId);
    const others = group.items.filter((item) => item.id !== parentId);
    if (!keeper || others.length === 0) return;
    const confirmed = confirmDangerousAction({
      title: `Merge ${others.map((item) => `"${item.name}"`).join(', ')} into "${keeper.name}"?`,
      message:
        'All recipe, invoice, stocktake, movement, delivery, order, supplier-alias and Square history from the other items moves onto the kept one. Per-venue stock is combined. The others are archived. This cannot be undone from the app.',
      confirmationText: 'MERGE ITEMS'
    });
    if (!confirmed) return;
    setMergingKey(group.key);
    setFeedback(null);
    try {
      const result = await api<StockItemMergeResult>('/api/items/merge', {
        method: 'POST',
        body: JSON.stringify({ parentId, duplicateIds: others.map((item) => item.id), confirmationText: 'MERGE ITEMS' })
      });
      const moved = result.moved;
      const parts = [
        moved.stocktakeLines ? `${moved.stocktakeLines} count line${moved.stocktakeLines === 1 ? '' : 's'}` : null,
        moved.invoiceLines ? `${moved.invoiceLines} invoice line${moved.invoiceLines === 1 ? '' : 's'}` : null,
        moved.recipeLines ? `${moved.recipeLines} recipe line${moved.recipeLines === 1 ? '' : 's'}` : null,
        moved.movements ? `${moved.movements} movement${moved.movements === 1 ? '' : 's'}` : null,
        moved.aliases ? `${moved.aliases} supplier alias${moved.aliases === 1 ? '' : 'es'}` : null
      ].filter(Boolean);
      onMerged(
        `Merged ${result.mergedCount} item${result.mergedCount === 1 ? '' : 's'} into "${keeper.name}"${parts.length ? ` — moved ${parts.join(', ')}` : ''}${
          result.venuesAdded.length ? `; now stocked at ${result.venuesAdded.join(', ')} too` : ''
        }.`
      );
    } catch (err) {
      setFeedback(err instanceof ApiError ? err.message : 'Could not merge items.');
    } finally {
      setMergingKey(null);
    }
  }

  if (!canManage || (!report && !error)) return null;
  if (report && report.groups.length === 0 && !error) return null;

  const title = report
    ? `${report.groups.length} possible duplicate group${report.groups.length === 1 ? '' : 's'}${flaggedCount ? ` (${flaggedCount} flagged)` : ''}`
    : 'Duplicate check';

  return (
    <CollapsibleCard
      title={title}
      description={report ? `Checked ${report.activeItems} active items` : undefined}
      defaultOpen={false}
      className="stock-duplicates-card"
    >
      <p className="subtle stock-duplicates-intro">
        Same product entered more than once (spelling, pack note or plural aside). Merging keeps one row and moves every
        record from the others onto it, so counts, purchases and recipes stop splitting across two rows. Wine and
        spirits only match on an identical name — vintages and bottle sizes are different products.
      </p>
      {error ? <ActionFeedback message={error} tone="error" /> : null}
      {feedback ? <ActionFeedback message={feedback} tone="error" /> : null}
      <div className="stock-duplicate-groups">
        {report?.groups.map((group) => (
          <GroupRow key={group.key} group={group} canManage={canManage} busy={mergingKey === group.key} onMerge={(g, parentId) => void merge(g, parentId)} />
        ))}
      </div>
    </CollapsibleCard>
  );
}
