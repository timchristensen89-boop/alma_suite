import { useEffect, useMemo, useState } from 'react';
import type { StockItemMergeHoldingResolution, StockItemMergePreview, StockItemMergeResult, StockItemMergeVenuePlan } from '@alma/shared';
import { Badge, Button, Spinner } from '@alma/ui';
import { ApiError, api } from '../lib/api';
import { confirmDangerousAction } from '../lib/confirmDangerousAction';

/**
 * Review a duplicate merge before it happens. Shows, venue by venue, what the
 * kept item will hold afterwards, and asks the manager to decide wherever the
 * records disagree. Stock is never added together, and nothing is pre-chosen
 * for a conflict: the most recently counted record is marked as a hint only.
 */

const fmtQty = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : Number(value.toFixed(3)).toLocaleString('en-AU');
const fmtMoney = (cents: number) => (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : null);

type Choice = { kind: 'keep' } | { kind: 'duplicate'; itemId: string } | { kind: 'counted'; text: string };

function outcomeText(v: StockItemMergeVenuePlan, keptUnit: string) {
  if (v.outcome === 'nothing') return 'No stock here. Nothing changes.';
  if (v.outcome === 'keep') return `Stays at ${fmtQty(v.resultOnHand)} ${keptUnit}. The other record has none here.`;
  if (v.outcome === 'carry') {
    const from = v.members.find((m) => !m.isKept && (m.onHand ?? 0) !== 0);
    return `Takes ${fmtQty(v.resultOnHand)} ${keptUnit} from "${from?.name}"${from && from.onHandInKeptUnit !== from.onHand ? ` (${fmtQty(from.onHand)} ${from.unit}, converted)` : ''}. The kept item had none here.`;
  }
  return v.reason ?? 'Choose the quantity that is real.';
}

export function MergeReviewDrawer({
  parentId,
  duplicateIds,
  onClose,
  onMerged
}: {
  parentId: string;
  duplicateIds: string[];
  onClose: () => void;
  onMerged: (message: string) => void;
}) {
  const [preview, setPreview] = useState<StockItemMergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [merging, setMerging] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    void (async () => {
      try {
        const payload = await api<StockItemMergePreview>('/api/items/merge/preview', { method: 'POST', body: JSON.stringify({ parentId, duplicateIds }) });
        if (!cancelled) { setPreview(payload); setChoices({}); }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not prepare the merge.');
      }
    })();
    return () => { cancelled = true; };
  }, [parentId, duplicateIds.join(','), reloadKey]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const decisions = useMemo(() => {
    if (!preview) return { ready: false, holdings: [] as StockItemMergeHoldingResolution[], afterCents: 0 };
    const holdings: StockItemMergeHoldingResolution[] = [];
    let ready = true;
    let after = 0;
    for (const v of preview.venues) {
      let qty = v.resultOnHand ?? v.members[0]?.onHand ?? 0;
      if (v.needsDecision) {
        const c = choices[v.venue];
        if (!c) { ready = false; continue; }
        if (c.kind === 'keep') { holdings.push({ venue: v.venue, keep: 'keep' }); qty = v.members[0]?.onHand ?? 0; }
        if (c.kind === 'duplicate') { holdings.push({ venue: v.venue, keep: 'duplicate', itemId: c.itemId }); qty = v.members.find((m) => m.itemId === c.itemId)?.onHandInKeptUnit ?? 0; }
        if (c.kind === 'counted') {
          const n = Number(c.text);
          if (c.text.trim() === '' || !Number.isFinite(n) || n < 0) { ready = false; continue; }
          holdings.push({ venue: v.venue, keep: 'counted', countedQty: n });
          qty = n;
        }
      }
      after += (qty ?? 0) * (preview.keptCostCents ?? 0);
    }
    return { ready: ready && preview.blockers.length === 0 && !preview.alreadyMerged, holdings, afterCents: Math.round(after) };
  }, [preview, choices]);

  async function confirmMerge() {
    if (!preview || !decisions.ready) return;
    const names = preview.duplicates.filter((d) => !d.alreadyMerged).map((d) => `"${d.name}"`).join(', ');
    const ok = confirmDangerousAction({
      title: `Merge ${names} into "${preview.parentName}"?`,
      message: 'History moves to the kept item exactly as recorded. Stock is set to the quantities shown, never added together. The other records are archived.',
      confirmationText: 'MERGE ITEMS'
    });
    if (!ok) return;
    setMerging(true);
    setError(null);
    try {
      const result = await api<StockItemMergeResult>('/api/items/merge', {
        method: 'POST',
        body: JSON.stringify({ parentId, duplicateIds, confirmationText: 'MERGE ITEMS', holdings: decisions.holdings, planToken: preview.planToken })
      });
      if (result.alreadyMerged) {
        onMerged(`Already merged into "${preview.parentName}". Nothing changed.`);
        return;
      }
      const changed = (result.holdings ?? []).filter((h) => (h.before ?? 0) !== (h.after ?? 0)).map((h) => `${h.venue} ${fmtQty(h.before)} → ${fmtQty(h.after)} ${preview.keptUnit}`);
      onMerged(`Merged ${result.mergedCount} item${result.mergedCount === 1 ? '' : 's'} into "${preview.parentName}". ${changed.length ? `Stock: ${changed.join('; ')}.` : 'Stock unchanged.'} History kept as recorded.`);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not merge.';
      setError(message);
      if (/changed since you reviewed/.test(message)) setReloadKey((k) => k + 1);
    } finally {
      setMerging(false);
    }
  }

  const unit = preview?.keptUnit ?? '';
  const r = preview?.repoint;
  const historyParts = r
    ? [
        r.stocktakeLines && `${r.stocktakeLines} count line${r.stocktakeLines === 1 ? '' : 's'}`,
        r.movements && `${r.movements} stock movement${r.movements === 1 ? '' : 's'}`,
        r.invoiceLines && `${r.invoiceLines} invoice line${r.invoiceLines === 1 ? '' : 's'}`,
        r.recipeLines && `${r.recipeLines} recipe line${r.recipeLines === 1 ? '' : 's'}`,
        r.purchaseOrderLines && `${r.purchaseOrderLines} order line${r.purchaseOrderLines === 1 ? '' : 's'}`,
        r.aliases && `${r.aliases} supplier name${r.aliases === 1 ? '' : 's'}`
      ].filter(Boolean)
    : [];

  return (
    <div className="count-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="count-drawer merge-review" role="dialog" aria-modal="true" aria-label="Review merge">
        <header className="count-drawer-head">
          <strong>{preview ? `Merge into "${preview.parentName}"` : 'Review merge'}</strong>
          <button type="button" className="count-drawer-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="count-drawer-body">
          {error ? <p className="error-text">{error}</p> : null}
          {!preview && !error ? <Spinner label="Checking what this merge would do" /> : null}
          {preview ? (
            <>
              {preview.alreadyMerged ? <p className="merge-review-note">These records are already merged into "{preview.parentName}". Nothing will change.</p> : null}
              <ul className="merge-review-rules">
                <li>
                  <strong>History stays exactly as recorded.</strong>{' '}
                  {historyParts.length ? `${historyParts.join(', ')} move to the kept item.` : 'The other records have no history to move.'} No count, quantity or value is changed.
                </li>
                <li><strong>Stock is never added together.</strong> Each venue keeps one quantity, shown below, in {unit}.</li>
                <li>
                  <strong>{preview.duplicates.filter((d) => !d.alreadyMerged).map((d) => `"${d.name}"`).join(', ')}</strong> will be archived.
                </li>
              </ul>

              {preview.blockers.length ? (
                <div className="merge-review-blockers">
                  <strong>This merge can't happen yet</strong>
                  <ul>{preview.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </div>
              ) : null}

              {preview.venues.filter((v) => v.outcome === 'nothing').length ? (
                <p className="subtle">No stock at {preview.venues.filter((v) => v.outcome === 'nothing').map((v) => v.venue).join(', ')}: nothing changes there.</p>
              ) : null}
              {preview.venues.filter((v) => v.outcome !== 'nothing').map((v) => (
                <section key={v.venue} className={`merge-review-venue${v.needsDecision ? ' needs-decision' : ''}`}>
                  <h4>{v.venue} {v.needsDecision ? <Badge tone="warning">your decision</Badge> : null}</h4>
                  <table className="merge-review-table">
                    <thead><tr><th>Record</th><th>On hand</th><th>Last counted</th></tr></thead>
                    <tbody>
                      {v.members.map((m) => (
                        <tr key={m.itemId}>
                          <td>{m.name} {m.isKept ? <Badge tone="info">kept</Badge> : null}</td>
                          <td>
                            {fmtQty(m.onHand)} {m.unit}
                            {m.onHandInKeptUnit !== null && m.onHand && Math.abs(m.onHandInKeptUnit - m.onHand) > 1e-9 ? <span className="subtle merge-review-converted">= {fmtQty(m.onHandInKeptUnit)} {unit}</span> : null}
                          </td>
                          <td>{m.lastCountedAt ? `${fmtDate(m.lastCountedAt)} (${fmtQty(m.lastCountedQty)})` : <span className="subtle">never</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="merge-review-outcome">{outcomeText(v, unit)}</p>
                  {v.needsDecision ? (
                    <fieldset className="merge-review-choices">
                      <legend>What is really on the shelf at {v.venue}?</legend>
                      {v.members.filter((m) => (m.onHand ?? 0) !== 0).map((m) => {
                        const disabled = m.onHandInKeptUnit === null;
                        const checked = m.isKept ? choices[v.venue]?.kind === 'keep' : choices[v.venue]?.kind === 'duplicate' && (choices[v.venue] as { itemId: string }).itemId === m.itemId;
                        return (
                          <label key={m.itemId} className={disabled ? 'is-disabled' : ''}>
                            <input
                              type="radio" name={`merge-${v.venue}`} disabled={disabled} checked={checked}
                              onChange={() => setChoices((c) => ({ ...c, [v.venue]: m.isKept ? { kind: 'keep' } : { kind: 'duplicate', itemId: m.itemId } }))}
                            />
                            <span className="merge-review-choice-text">
                              Keep "{m.name}": <strong>{disabled ? `${fmtQty(m.onHand)} ${m.unit} (can't convert to ${unit})` : `${fmtQty(m.onHandInKeptUnit)} ${unit}`}</strong>{' '}
                              {v.suggestedItemId === m.itemId ? <Badge tone="neutral">counted most recently</Badge> : null}
                            </span>
                          </label>
                        );
                      })}
                      <label>
                        <input
                          type="radio" name={`merge-${v.venue}`} checked={choices[v.venue]?.kind === 'counted'}
                          onChange={() => setChoices((c) => ({ ...c, [v.venue]: { kind: 'counted', text: c[v.venue]?.kind === 'counted' ? (c[v.venue] as { text: string }).text : '' } }))}
                        />
                        <span className="merge-review-choice-text">
                          Enter what is on the shelf:{' '}
                          <input
                            type="number" inputMode="decimal" min={0} step="any" className="merge-review-counted" aria-label={`Counted quantity at ${v.venue}`}
                            value={choices[v.venue]?.kind === 'counted' ? (choices[v.venue] as { text: string }).text : ''}
                            onFocus={() => setChoices((c) => (c[v.venue]?.kind === 'counted' ? c : { ...c, [v.venue]: { kind: 'counted', text: '' } }))}
                            onChange={(event) => setChoices((c) => ({ ...c, [v.venue]: { kind: 'counted', text: event.target.value } }))}
                          />{' '}
                          {unit}
                        </span>
                      </label>
                    </fieldset>
                  ) : null}
                </section>
              ))}

              <p className="merge-review-value subtle">
                Stock value at today's cost: {fmtMoney(preview.valueBeforeCents)} now
                {decisions.ready || !preview.venues.some((v) => v.needsDecision) ? ` → ${fmtMoney(decisions.afterCents)} after the merge` : ''}.
              </p>
              <div className="count-drawer-foot">
                <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
                <Button type="button" disabled={!decisions.ready || merging} onClick={() => void confirmMerge()}>
                  {merging ? 'Merging…' : preview.venues.some((v) => v.needsDecision) && !decisions.ready ? 'Decide each venue first' : 'Merge'}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
