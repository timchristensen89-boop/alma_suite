import { useState } from 'react';
import type { StockInvoicePasteResult, StockSupplierInvoice } from '@alma/shared';
import { ActionFeedback, Badge, Button, Textarea } from '@alma/ui';
import { ApiError, api } from '../lib/api';

/**
 * Paste the invoice back in.
 *
 * Some bills reach the suite as one summary line — a Xero sync that carried a
 * single "Alcoholic Beverages $1,035.25" row, or a scan OCR only read a total
 * from. Every item on that invoice then sits uncosted with nothing to match.
 * The detail is on the PDF the whole time; this is somewhere to put it.
 *
 * It always previews first. Replacing the lines on an invoice is not something
 * to find out about afterwards, and the preview is also where the reconciliation
 * against the supplier's own total is shown — which is the check that says
 * whether the copy caught every row.
 */

function money(cents: number) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

const PLACEHOLDER = `Select the line-item table on the invoice, copy, and paste it here. For example:

63331 AGUAS MANSAS ESPADIN MEZCAL : 750ml 6/750 ml 0 / 1 $390.00 $65.00
9000000 Carton Freight MISC 4 $1.30 $5.20

Copying a PDF often splits the right-hand columns off into their own list —
paste those too, headings and all, and they will be lined back up.`;

export function InvoicePasteLinesPanel({
  invoice,
  canManage,
  onApplied
}: {
  invoice: StockSupplierInvoice;
  canManage: boolean;
  onApplied: () => void | Promise<void>;
}) {
  const lineCount = invoice.lines?.length ?? 0;
  // A one-line invoice is the case this exists for, so it opens itself there.
  // On a fully detailed invoice it stays out of the way until asked for.
  const looksSummarised = lineCount <= 1;
  const [open, setOpen] = useState(looksSummarised);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<StockInvoicePasteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error' | 'info'>('info');
  // Set when the API refused because the lines don't add up, so the second
  // press is an explicit decision rather than the same button behaving differently.
  const [varianceBlocked, setVarianceBlocked] = useState(false);

  function say(text: string, nextTone: 'success' | 'error' | 'info') {
    setMessage(text);
    setTone(nextTone);
  }

  async function runPreview() {
    if (!text.trim()) {
      say('Paste the invoice text first.', 'error');
      return;
    }
    setBusy(true);
    setMessage(null);
    setVarianceBlocked(false);
    try {
      const result = await api<StockInvoicePasteResult>(`/api/invoices/${invoice.id}/paste-lines`, {
        method: 'POST',
        body: JSON.stringify({ text, dryRun: true })
      });
      setPreview(result);
      if (result.lines.length === 0) {
        say('Nothing in that text looked like an invoice line.', 'error');
      } else {
        say(
          `Read ${result.lines.length} line${result.lines.length === 1 ? '' : 's'}. Check them below, then replace.`,
          result.matches ? 'success' : 'info'
        );
      }
    } catch (err) {
      say(err instanceof ApiError || err instanceof Error ? err.message : 'Could not read that text.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function apply(acceptVariance: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<StockInvoicePasteResult>(`/api/invoices/${invoice.id}/paste-lines`, {
        method: 'POST',
        body: JSON.stringify({ text, acceptVariance })
      });
      setPreview(result);
      setVarianceBlocked(false);
      setText('');
      say(
        `Replaced ${result.replacedLineCount} line${result.replacedLineCount === 1 ? '' : 's'} with ${
          result.lines.length
        }. ${result.matchedCount} matched a stock item, ${result.needsReviewCount} need review.`,
        'success'
      );
      await onApplied();
    } catch (err) {
      const detail = err instanceof ApiError || err instanceof Error ? err.message : 'Could not save those lines.';
      // The API refuses a total that doesn't reconcile until it is confirmed.
      if (detail.includes('confirm to save anyway')) setVarianceBlocked(true);
      say(detail, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!canManage) return null;

  if (!open) {
    return (
      <div className="stock-invoice-paste-bar">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Paste lines from the invoice
        </Button>
        <span className="subtle small">
          For bills that arrived as one summary line — paste the table off the original.
        </span>
      </div>
    );
  }

  return (
    <div className="stock-invoice-paste">
      <div className="stock-invoice-paste-head">
        <div>
          <strong>Paste lines from the invoice</strong>
          <span className="subtle small">
            {looksSummarised
              ? `This invoice has ${lineCount === 0 ? 'no lines' : 'a single line'} — paste the real ones off the original document.`
              : 'Replaces every line on this invoice with what you paste.'}
          </span>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Hide
        </Button>
      </div>

      <Textarea
        label=""
        rows={8}
        value={text}
        placeholder={PLACEHOLDER}
        onChange={(event) => setText(event.currentTarget.value)}
      />

      <div className="stock-invoice-paste-actions">
        <Button type="button" variant="secondary" disabled={busy || !text.trim()} onClick={() => void runPreview()}>
          {busy ? 'Reading…' : 'Preview'}
        </Button>
        {preview && !preview.applied && preview.lines.length > 0 ? (
          <Button type="button" disabled={busy} onClick={() => void apply(false)}>
            Replace {lineCount} line{lineCount === 1 ? '' : 's'} with {preview.lines.length}
          </Button>
        ) : null}
        {varianceBlocked ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void apply(true)}>
            Save anyway
          </Button>
        ) : null}
        <ActionFeedback message={message} tone={tone} />
      </div>

      {preview && preview.lines.length > 0 ? (
        <div className="stock-invoice-paste-preview">
          <div className="stock-invoice-paste-reconcile">
            <span>
              Lines total <strong>{money(preview.parsedTotalCents)}</strong>
              {preview.parsedTaxCents !== 0 ? ` (${money(preview.parsedSubtotalCents)} + ${money(preview.parsedTaxCents)} GST)` : ''}
            </span>
            <span>
              Invoice says <strong>{money(preview.invoiceTotalCents)}</strong>
            </span>
            {preview.matches ? (
              <Badge tone="positive">
                {preview.totalVarianceCents === 0 ? 'Balances exactly' : `${money(Math.abs(preview.totalVarianceCents))} rounding`}
              </Badge>
            ) : (
              <Badge tone="danger">
                {money(Math.abs(preview.totalVarianceCents))} {preview.totalVarianceCents > 0 ? 'over' : 'short'} — a row may be missing
              </Badge>
            )}
          </div>

          {preview.columnsApplied.length > 0 ? (
            <p className="subtle small">Lined up detached columns: {preview.columnsApplied.join(', ')}.</p>
          ) : null}

          {preview.warnings.map((warning) => (
            <p key={warning} className="stock-invoice-paste-warning">
              {warning}
            </p>
          ))}

          <div className="stock-invoice-paste-table-wrap">
            <table className="stock-invoice-paste-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th className="numeric">Qty</th>
                  <th className="numeric">Unit</th>
                  <th className="numeric">Line</th>
                  <th className="numeric">GST</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((line) => (
                  <tr key={line.lineNumber} className={line.warnings.length > 0 ? 'has-warning' : undefined}>
                    <td>{line.itemCode ?? '—'}</td>
                    <td>
                      {line.description}
                      {line.pack ? <span className="subtle small"> · {line.pack}</span> : null}
                      {line.warnings.map((warning) => (
                        <span key={warning} className="stock-invoice-paste-line-warning">
                          {warning}
                        </span>
                      ))}
                    </td>
                    <td className="numeric">
                      {line.quantity}
                      {line.printedQuantity && String(line.quantity) !== line.printedQuantity ? (
                        <span className="subtle small"> (printed {line.printedQuantity})</span>
                      ) : null}
                    </td>
                    <td className="numeric">{money(line.unitAmountCents)}</td>
                    <td className="numeric">{money(line.lineAmountCents)}</td>
                    <td className="numeric">{line.taxAmountCents ? money(line.taxAmountCents) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.dryRun ? (
            <p className="subtle small">
              {preview.matchedCount} of {preview.lines.length} will match a stock item straight away;{' '}
              {preview.needsReviewCount} will need matching by hand.
            </p>
          ) : null}

          {preview.unparsed.length > 0 ? (
            <details className="stock-invoice-paste-unparsed">
              <summary>
                {preview.unparsed.length} line{preview.unparsed.length === 1 ? '' : 's'} not understood — check nothing
                was missed
              </summary>
              <ul>
                {preview.unparsed.map((line, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
