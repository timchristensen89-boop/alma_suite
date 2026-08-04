import { useCallback, useEffect, useState } from 'react';
import type { StockUnmatchedSpendPayload } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Spinner } from '@alma/ui';
import { ApiError, api } from '../lib/api';

/**
 * Where the unattributed supplier spend actually is.
 *
 * The review queue is 471 lines, which reads as hopeless. Grouped by the
 * wording the supplier uses it is 138 rows, and 88% of the $45,593 sits in the
 * top twenty — an afternoon's work rather than a standing chore.
 *
 * The two halves need opposite actions, so they are split rather than piled
 * together: a bill that arrived as one summary line needs its detail pasted in,
 * while a real product the venue buys needs a catalogue item. Telling them
 * apart is most of the value here.
 */

function money(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function when(iso: string | null) {
  if (!iso) return 'unknown';
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function UnmatchedSpendCard({ onOpenInvoice }: { onOpenInvoice: (invoiceId: string) => void }) {
  const [payload, setPayload] = useState<StockUnmatchedSpendPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPayload(await api<StockUnmatchedSpendPayload>('/api/invoices/unmatched-spend'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Could not load unmatched spend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = payload ? (showAll ? payload.rows : payload.rows.slice(0, 12)) : [];

  return (
    <Card
      title="Unattributed spend"
      subtitle="Supplier lines no stock item answers to, grouped by what the supplier calls it. Worst first — the top few are most of the money."
      action={
        <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? 'Working…' : 'Refresh'}
        </Button>
      }
    >
      {loading && !payload ? <Spinner label="Adding up unmatched lines…" /> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {payload && payload.lineCount === 0 ? (
        <EmptyState title="Everything is attributed" description="Every invoice line points at a stock item." />
      ) : null}

      {payload && payload.lineCount > 0 ? (
        <>
          <div className="stock-unmatched-summary">
            <span>
              <strong>{money(payload.totalCents)}</strong> across {payload.lineCount} lines,{' '}
              {payload.distinctDescriptions} distinct descriptions
            </span>
            {payload.summarisedCents > 0 ? (
              <Badge tone="warning">{money(payload.summarisedCents)} needs invoice detail pasted</Badge>
            ) : null}
            {payload.catalogueGapCents > 0 ? (
              <Badge tone="info">{money(payload.catalogueGapCents)} needs catalogue items</Badge>
            ) : null}
          </div>

          <div className="stock-unmatched-table-wrap">
            <table className="stock-unmatched-table">
              <thead>
                <tr>
                  <th>What the supplier calls it</th>
                  <th className="numeric">Lines</th>
                  <th className="numeric">Spend</th>
                  <th>Supplier</th>
                  <th>Last seen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.description}>
                    <td>
                      <strong>{row.description}</strong>
                      {row.looksSummarised ? (
                        <span className="stock-unmatched-hint">
                          Came off a one-line bill — this is a total, not a product. Open it and paste the invoice
                          detail.
                        </span>
                      ) : null}
                    </td>
                    <td className="numeric">{row.lineCount}</td>
                    <td className="numeric">{money(row.totalCents)}</td>
                    <td>{row.suppliers.join(', ') || '—'}</td>
                    <td>{when(row.lastSeen)}</td>
                    <td>
                      {row.invoiceIds[0] ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenInvoice(row.invoiceIds[0]!)}
                        >
                          {row.looksSummarised ? 'Paste detail' : 'Match it'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="subtle small">
            Matching one line teaches the wording and clears every other line that shares it, so each of these rows is
            one decision.
            {payload.rows.length > rows.length ? (
              <>
                {' '}
                <button type="button" className="stock-unmatched-more" onClick={() => setShowAll(true)}>
                  Show all {payload.rows.length}
                </button>
              </>
            ) : null}
          </p>
        </>
      ) : null}
    </Card>
  );
}
