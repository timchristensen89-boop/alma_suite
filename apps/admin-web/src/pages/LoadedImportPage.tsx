// Loaded import admin page — Sprint 2.1 + 2.2.
//
// Two tabs: Items and Historical stocktakes. Each takes a CSV paste
// or upload, shows a preview (create / update / skip / error counts +
// per-row warnings), and commits on confirm. The Loaded replacement
// readiness page links here.

import { useState } from 'react';
import { ActionFeedback, Badge, Button, Card, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type ItemPreview = {
  rows: Array<{
    csvRow: number;
    name: string;
    matchedItemId: string | null;
    action: 'create' | 'update' | 'skip' | 'error';
    warnings: string[];
    reason?: string;
    proposed: {
      name: string;
      categoryName: string | null;
      unit: string;
      countUnit: string | null;
      conversionFactor: number;
      countArea: string | null;
      latestCostCents: number | null;
      active: boolean;
    };
  }>;
  summary: { create: number; update: number; skip: number; error: number };
  duplicateNames: string[];
};

type StocktakePreview = {
  sessions: Array<{
    date: string;
    venue: string;
    lines: Array<{ csvRow: number; itemName: string; matchedItemId: string | null; quantity: number | null; unit: string | null; valueCents: number | null }>;
  }>;
  summary: { totalRows: number; matchedItems: number; unmatchedItems: number; sessionCount: number };
};

// Admin-web routes /api/* to alma-compliance-api via firebase rewrites,
// so we just hit the admin proxy endpoints there.

export function LoadedImportPage() {
  const [tab, setTab] = useState<'items' | 'stocktakes'>('items');

  return (
    <div className="page-stack">
      <div className="admin-debt-card">
        <header className="admin-debt-head">
          <span className="admin-debt-eyebrow">Loaded migration</span>
          <h1 className="admin-debt-title">Import from Loaded</h1>
          <p className="admin-debt-sub">
            Two-step CSV import. Preview first, then commit. <strong>Items</strong> creates or updates the Alma catalogue.
            <strong> Historical stocktakes</strong> lands as LOCKED sessions tagged "Imported from Loaded" so reports trust the historical numbers
            but they can't be edited without a manager reopen.
          </p>
        </header>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="button" variant={tab === 'items' ? 'primary' : 'secondary'} onClick={() => setTab('items')}>Item catalogue</Button>
          <Button type="button" variant={tab === 'stocktakes' ? 'primary' : 'secondary'} onClick={() => setTab('stocktakes')}>Historical stocktakes</Button>
        </div>
      </div>

      {tab === 'items' ? <ItemImportPanel /> : <StocktakeImportPanel />}
    </div>
  );
}

function CsvDropTarget({ value, onChange, hint }: { value: string; onChange: (csv: string, filename: string) => void; hint?: string }) {
  return (
    <>
      <label className="field">
        <span className="field-label">Upload CSV</span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            const text = await file.text();
            onChange(text, file.name);
          }}
        />
      </label>
      <label className="field">
        <span className="field-label">Or paste CSV content</span>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value, '')}
          rows={6}
          placeholder="item,category,purchase unit,count unit,conversion,cost,area,active"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, padding: 10, border: '1px solid var(--color-border)', borderRadius: 8 }}
        />
      </label>
      {hint ? <p className="subtle" style={{ fontSize: 12 }}>{hint}</p> : null}
    </>
  );
}

function ItemImportPanel() {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<ItemPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  async function runPreview() {
    setBusy(true); setMessage(null);
    try {
      const result = await api<ItemPreview>('/api/admin/loaded-import/items/preview', {
        method: 'POST',
        body: JSON.stringify({ csv })
      });
      setPreview(result);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not preview.');
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!preview) return;
    if (!window.confirm(`Commit ${preview.summary.create} create + ${preview.summary.update} update operations? Skipped and error rows will not run.`)) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ created: number; updated: number; skipped: number; errors: number }>('/api/admin/loaded-import/items/commit', {
        method: 'POST',
        body: JSON.stringify({ csv })
      });
      setTone('success');
      setMessage(`Done. ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors.`);
      setPreview(null);
      setCsv('');
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Commit failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Item catalogue" subtitle="Loaded item exports use varied column names. We accept item / item name, category / group, purchase unit / unit, count unit, conversion / conversion factor, cost / latest cost, area / count area, active / status.">
      <CsvDropTarget value={csv} onChange={(text) => { setCsv(text); setPreview(null); }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button type="button" onClick={() => void runPreview()} disabled={busy || !csv.trim()}>
          {busy && !preview ? 'Previewing…' : 'Preview import'}
        </Button>
        {preview ? (
          <Button type="button" variant="primary" onClick={() => void runCommit()} disabled={busy || (preview.summary.create === 0 && preview.summary.update === 0)}>
            {busy ? 'Committing…' : 'Commit import'}
          </Button>
        ) : null}
      </div>
      {busy ? <Spinner label="Running…" /> : null}
      {preview ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="positive">{preview.summary.create} to create</Badge>
            <Badge tone="info">{preview.summary.update} to update</Badge>
            <Badge tone="warning">{preview.summary.skip} skipped</Badge>
            <Badge tone="danger">{preview.summary.error} errors</Badge>
          </div>
          {preview.duplicateNames.length > 0 ? (
            <p className="comms-error">Duplicate names within the CSV (each counted once): {preview.duplicateNames.join(', ')}</p>
          ) : null}
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>First 50 rows</summary>
            <table className="stocktake-variance-table" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Row</th><th>Name</th><th>Action</th><th>Warnings</th><th>Unit</th><th>Count unit</th><th>Conv</th><th>Cost</th></tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 50).map((row) => (
                  <tr key={row.csvRow}>
                    <td>{row.csvRow}</td>
                    <td>{row.name}</td>
                    <td>
                      <Badge tone={row.action === 'create' ? 'positive' : row.action === 'update' ? 'info' : row.action === 'skip' ? 'warning' : 'danger'}>
                        {row.action}
                      </Badge>
                    </td>
                    <td style={{ color: '#9A3A2E', fontSize: 11 }}>{row.warnings.join(', ') || row.reason || ''}</td>
                    <td>{row.proposed.unit}</td>
                    <td>{row.proposed.countUnit ?? ''}</td>
                    <td>{row.proposed.conversionFactor}</td>
                    <td>{row.proposed.latestCostCents !== null ? `$${(row.proposed.latestCostCents / 100).toFixed(2)}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      ) : null}
      {message ? <ActionFeedback message={message} tone={tone} /> : null}
    </Card>
  );
}

function StocktakeImportPanel() {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<StocktakePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipUnmatched, setSkipUnmatched] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  async function runPreview() {
    setBusy(true); setMessage(null);
    try {
      const result = await api<StocktakePreview>('/api/admin/loaded-import/stocktakes/preview', {
        method: 'POST',
        body: JSON.stringify({ csv })
      });
      setPreview(result);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not preview.');
    } finally {
      setBusy(false);
    }
  }

  async function runCommit() {
    if (!preview) return;
    if (!window.confirm(`Commit ${preview.summary.sessionCount} historical stocktake session${preview.summary.sessionCount === 1 ? '' : 's'} (${preview.summary.matchedItems} matched, ${preview.summary.unmatchedItems} unmatched${skipUnmatched ? ' will be skipped' : ' will be created as label-only lines'})?`)) return;
    setBusy(true); setMessage(null);
    try {
      const result = await api<{ sessionsCreated: number; linesCreated: number; linesSkipped: number }>('/api/admin/loaded-import/stocktakes/commit', {
        method: 'POST',
        body: JSON.stringify({ csv, skipUnmatched })
      });
      setTone('success');
      setMessage(`Done. ${result.sessionsCreated} sessions, ${result.linesCreated} lines created, ${result.linesSkipped} skipped.`);
      setPreview(null);
      setCsv('');
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Commit failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Historical stocktakes" subtitle="Expects: date, venue, item, category, area, quantity, unit, value, cost. Rows are grouped by (date, venue) into separate LOCKED sessions.">
      <CsvDropTarget value={csv} onChange={(text) => { setCsv(text); setPreview(null); }} />
      <label className="field" style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={skipUnmatched} onChange={(event) => setSkipUnmatched(event.target.checked)} />
        <span>Skip rows whose item name doesn't match an existing Alma item (recommended)</span>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button type="button" onClick={() => void runPreview()} disabled={busy || !csv.trim()}>
          {busy && !preview ? 'Previewing…' : 'Preview import'}
        </Button>
        {preview ? (
          <Button type="button" variant="primary" onClick={() => void runCommit()} disabled={busy}>
            {busy ? 'Committing…' : 'Commit import'}
          </Button>
        ) : null}
      </div>
      {preview ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <Badge tone="positive">{preview.summary.matchedItems} matched lines</Badge>
            <Badge tone="warning">{preview.summary.unmatchedItems} unmatched</Badge>
            <Badge tone="info">{preview.summary.sessionCount} session{preview.summary.sessionCount === 1 ? '' : 's'}</Badge>
          </div>
          <ul className="loaded-replacement-list">
            {preview.sessions.slice(0, 10).map((session, idx) => (
              <li key={idx} className="loaded-replacement-row">
                <Badge tone="info">{session.date}</Badge>
                <div className="loaded-replacement-row-body">
                  <strong>{session.venue} · {session.lines.length} lines</strong>
                  <small>
                    Matched: {session.lines.filter((line) => line.matchedItemId).length} ·
                    Unmatched: {session.lines.filter((line) => !line.matchedItemId).length}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {message ? <ActionFeedback message={message} tone={tone} /> : null}
    </Card>
  );
}
