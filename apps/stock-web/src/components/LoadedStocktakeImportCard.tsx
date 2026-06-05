import { useRef, useState } from 'react';
import { Card } from '@alma/ui';
import { ApiError, api } from '../lib/api';

type PreviewLine = {
  csvRow: number;
  itemName: string;
  matchedItemId: string | null;
  category: string | null;
  area: string | null;
  quantity: number | null;
  unit: string | null;
  valueCents: number | null;
  costCents: number | null;
};

type PreviewSession = { date: string; venue: string; lines: PreviewLine[] };

type PreviewResult = {
  sessions: PreviewSession[];
  summary: { totalRows: number; matchedItems: number; unmatchedItems: number; sessionCount: number };
};

type CommitResult = { sessionsCreated: number; linesCreated: number; linesSkipped: number };

function money(cents: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'AUD' }).format(cents / 100);
}

function sessionValueCents(session: PreviewSession) {
  return session.lines.reduce((sum, line) => sum + (line.valueCents ?? 0), 0);
}

export function LoadedStocktakeImportCard({ onImported }: { onImported?: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [keepUnmatched, setKeepUnmatched] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  function reset() {
    setCsv('');
    setFileName(null);
    setPreview(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setFileName(file.name);
    setCsv(await file.text());
  }

  async function runPreview() {
    if (!csv.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await api<PreviewResult>('/api/imports/loaded/stocktakes/preview', {
        method: 'POST',
        body: JSON.stringify({ csv })
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not preview the CSV.');
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<CommitResult>('/api/imports/loaded/stocktakes/commit', {
        method: 'POST',
        body: JSON.stringify({ csv, skipUnmatched: !keepUnmatched })
      });
      setResult(res);
      setPreview(null);
      onImported?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import the stocktake.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Import from Loaded"
      subtitle="Bring stocktakes in from a Loaded CSV export. Each unique date + venue becomes one locked stocktake."
    >
      <div className="loaded-import">
        <div className="loaded-import-controls">
          <label className="loaded-import-file">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} />
            <span>{fileName ?? 'Choose a CSV file…'}</span>
          </label>
          <button type="button" className="btn btn-secondary" onClick={runPreview} disabled={!csv.trim() || busy}>
            {busy && !result ? 'Reading…' : 'Preview'}
          </button>
          {(preview || result || csv) ? (
            <button type="button" className="btn btn-ghost" onClick={reset} disabled={busy}>
              Clear
            </button>
          ) : null}
        </div>

        <details className="loaded-import-paste">
          <summary>…or paste CSV text</summary>
          <textarea
            className="loaded-import-textarea"
            value={csv}
            placeholder="date,venue,category,item,unit,quantity,value"
            onChange={(event) => { setCsv(event.currentTarget.value); setFileName(null); setPreview(null); setResult(null); }}
            rows={5}
          />
          <p className="loaded-import-hint">
            Columns: <code>date, venue, category, item, unit, quantity, value</code>. Items match existing stock by
            name; unmatched rows are kept as label-only lines (with their value) unless you turn that off.
          </p>
        </details>

        {error ? <p className="loaded-import-error">{error}</p> : null}

        {result ? (
          <div className="loaded-import-result">
            <strong>Imported.</strong> {result.sessionsCreated} stocktake{result.sessionsCreated === 1 ? '' : 's'} created
            · {result.linesCreated} line{result.linesCreated === 1 ? '' : 's'}
            {result.linesSkipped > 0 ? ` · ${result.linesSkipped} skipped` : ''}.
          </div>
        ) : null}

        {preview ? (
          <div className="loaded-import-preview">
            <div className="loaded-import-summary">
              <span><strong>{preview.summary.sessionCount}</strong> stocktake{preview.summary.sessionCount === 1 ? '' : 's'}</span>
              <span><strong>{preview.summary.totalRows}</strong> rows</span>
              <span><strong>{preview.summary.matchedItems}</strong> matched</span>
              <span className={preview.summary.unmatchedItems > 0 ? 'is-warn' : ''}><strong>{preview.summary.unmatchedItems}</strong> unmatched</span>
            </div>

            <ul className="loaded-import-sessions">
              {preview.sessions.map((session) => (
                <li key={`${session.date}|${session.venue}`}>
                  <span className="loaded-import-session-name">{session.venue} · {session.date}</span>
                  <span className="loaded-import-session-meta">
                    {session.lines.length} lines · {money(sessionValueCents(session))}
                  </span>
                </li>
              ))}
            </ul>

            <label className="loaded-import-toggle">
              <input type="checkbox" checked={keepUnmatched} onChange={(event) => setKeepUnmatched(event.currentTarget.checked)} />
              <span>Keep unmatched items as label-only lines (recommended — preserves the full count &amp; value)</span>
            </label>

            <button type="button" className="btn btn-primary" onClick={runImport} disabled={busy}>
              {busy ? 'Importing…' : `Import ${preview.summary.sessionCount} stocktake${preview.summary.sessionCount === 1 ? '' : 's'}`}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
