// Loaded replacement admin page.
//
// Single-page dashboard the admin uses to track Alma's readiness to
// replace Loaded. Every check is editable inline; the cancellation
// readiness guard sits at the top and stays RED until every required
// check is at least 'ready' AND two parallel comparison cycles are
// marked explained.

import { useCallback, useEffect, useState } from 'react';
import { ActionFeedback, Badge, Button, Card, Spinner } from '@alma/ui';
import { api } from '../../../web/src/lib/api';

type LoadedCutoverCategory = 'reports' | 'stocktake' | 'historical_data' | 'comparison' | 'cutover';
type LoadedCutoverStatus = 'not_started' | 'needs_work' | 'ready' | 'verified';

type CheckRow = {
  id: string;
  label: string;
  category: LoadedCutoverCategory;
  order: number;
  requiredForCutover: boolean;
  status: LoadedCutoverStatus;
  notes: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

type Comparison = {
  id: string;
  label: string;
  cycleNumber: number;
  recordedAt: string;
  recordedBy: string;
  loaded: { stockValueCents: number | null; salesCents: number | null; cogsCents: number | null; categoryTotals: Record<string, number> };
  alma: { stockValueCents: number | null; salesCents: number | null; cogsCents: number | null; categoryTotals: Record<string, number> };
  notes?: string;
  explained: boolean;
  explainedBy?: string;
  explainedAt?: string;
};

type Overview = {
  generatedAt: string;
  checks: CheckRow[];
  categoryNotes: Partial<Record<LoadedCutoverCategory, string>>;
  comparisons: Comparison[];
  summary: { total: number; ready: number; needsWork: number; notStarted: number; verified: number };
  cancellationReady: boolean;
  blockers: string[];
};

const CATEGORY_LABELS: Record<LoadedCutoverCategory, { title: string; subtitle: string }> = {
  reports: { title: 'Reports readiness', subtitle: 'Daily, weekly and prime-cost reports must replace the Loaded habit before cancellation.' },
  stocktake: { title: 'Stocktake readiness', subtitle: 'Item catalogue, count areas, draft → submitted → reviewed → locked workflow.' },
  historical_data: { title: 'Historical data export', subtitle: 'Archive everything Loaded holds before cancelling — you only get one shot.' },
  comparison: { title: 'Loaded ⨯ Alma comparison', subtitle: 'Two parallel cycles. Variance must be explained, not just observed.' },
  cutover: { title: 'Cutover preparation', subtitle: 'Training, fallback procedures, and the cancellation booking itself.' }
};

const STATUS_LABEL: Record<LoadedCutoverStatus, string> = {
  not_started: 'Not started',
  needs_work: 'Needs work',
  ready: 'Ready',
  verified: 'Verified'
};

function statusTone(status: LoadedCutoverStatus): 'muted' | 'warning' | 'positive' | 'info' {
  if (status === 'verified') return 'positive';
  if (status === 'ready') return 'positive';
  if (status === 'needs_work') return 'warning';
  return 'muted';
}

const NEXT_STATUS: Record<LoadedCutoverStatus, LoadedCutoverStatus> = {
  not_started: 'needs_work',
  needs_work: 'ready',
  ready: 'verified',
  verified: 'not_started'
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function LoadedReplacementPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingCheck, setSavingCheck] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<'success' | 'error'>('success');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Overview>('/api/admin/loaded-replacement');
      setOverview(data);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not load Loaded replacement state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cycleStatus(check: CheckRow) {
    setSavingCheck(check.id);
    setMessage(null);
    try {
      const data = await api<Overview>(`/api/admin/loaded-replacement/check/${encodeURIComponent(check.id)}`, {
        method: 'POST',
        body: JSON.stringify({ status: NEXT_STATUS[check.status] })
      });
      setOverview(data);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not update check.');
    } finally {
      setSavingCheck(null);
    }
  }

  async function updateNotes(check: CheckRow, notes: string) {
    setSavingCheck(check.id);
    setMessage(null);
    try {
      const data = await api<Overview>(`/api/admin/loaded-replacement/check/${encodeURIComponent(check.id)}`, {
        method: 'POST',
        body: JSON.stringify({ status: check.status, notes })
      });
      setOverview(data);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not save notes.');
    } finally {
      setSavingCheck(null);
    }
  }

  async function toggleExplained(cycleId: string, explained: boolean) {
    setMessage(null);
    try {
      const data = await api<Overview>(`/api/admin/loaded-replacement/comparison/${encodeURIComponent(cycleId)}/explained`, {
        method: 'POST',
        body: JSON.stringify({ explained })
      });
      setOverview(data);
      setTone('success');
      setMessage(explained ? 'Marked variance as understood.' : 'Marked as needing review.');
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not update comparison cycle.');
    }
  }

  if (loading && !overview) return <Spinner label="Loading Loaded replacement readiness" />;
  if (!overview) {
    return (
      <div className="page-stack">
        <Card title="Loaded replacement"><p>Could not load readiness state. Try again in a moment.</p></Card>
        {message ? <ActionFeedback message={message} tone={tone} /> : null}
      </div>
    );
  }

  const byCategory: Record<LoadedCutoverCategory, CheckRow[]> = {
    reports: [],
    stocktake: [],
    historical_data: [],
    comparison: [],
    cutover: []
  };
  for (const check of overview.checks) {
    byCategory[check.category].push(check);
  }

  return (
    <div className="page-stack loaded-replacement-page">
      <div className="admin-debt-card" style={{ borderLeft: `4px solid ${overview.cancellationReady ? '#2F5C36' : '#9A3A2E'}` }}>
        <header className="admin-debt-head">
          <span className="admin-debt-eyebrow">Loaded replacement</span>
          <h1 className="admin-debt-title">
            {overview.cancellationReady ? '✅ Loaded cancellation ready' : '🚫 Loaded cancellation NOT ready'}
          </h1>
          <p className="admin-debt-sub">
            Tracks whether Alma Stock + Alma Reports can replace Loaded. <strong>Do not cancel Loaded until two full Alma stocktake cycles match expected results.</strong>
          </p>
        </header>
        {overview.blockers.length > 0 ? (
          <ul className="admin-debt-list">
            {overview.blockers.map((blocker, index) => (
              <li key={index} className="admin-debt-row is-warning">
                <span className="admin-debt-row-tag">Blocker</span>
                <span className="admin-debt-row-detail">{blocker}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap', fontSize: 13 }}>
          <span><strong>{overview.summary.verified}</strong> verified</span>
          <span><strong>{overview.summary.ready}</strong> ready or verified</span>
          <span><strong>{overview.summary.needsWork}</strong> needs work</span>
          <span><strong>{overview.summary.notStarted}</strong> not started</span>
          <span style={{ marginLeft: 'auto', color: 'var(--color-text-muted)' }}>Pulled {formatTime(overview.generatedAt)}</span>
        </div>
      </div>

      <Card title="Useful jumps" subtitle="Pages that feed the checklist below.">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = 'https://alma-stock-v18.web.app/items'; }}>Open Stock catalogue</Button>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = 'https://alma-stock-v18.web.app/stocktake'; }}>Open Stocktake</Button>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = 'https://alma-reports.web.app'; }}>Open Reports</Button>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = '/integrations/health'; }}>Integration health</Button>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = '/api/admin/exports/sales-by-day'; }}>Download sales CSV</Button>
          <Button type="button" variant="secondary" onClick={() => { window.location.href = '/api/admin/exports/low-stock'; }}>Download low-stock CSV</Button>
        </div>
      </Card>

      {(Object.keys(byCategory) as LoadedCutoverCategory[]).map((category) => {
        const checks = byCategory[category];
        if (checks.length === 0) return null;
        const cat = CATEGORY_LABELS[category];
        return (
          <Card key={category} title={cat.title} subtitle={cat.subtitle}>
            <ul className="loaded-replacement-list">
              {checks.map((check) => (
                <li key={check.id} className={`loaded-replacement-row is-${check.status}`}>
                  <button
                    type="button"
                    className="loaded-replacement-status-btn"
                    onClick={() => void cycleStatus(check)}
                    disabled={savingCheck === check.id}
                    title="Click to cycle status"
                  >
                    <Badge tone={statusTone(check.status)}>{STATUS_LABEL[check.status]}</Badge>
                  </button>
                  <div className="loaded-replacement-row-body">
                    <strong>
                      {check.label}
                      {check.requiredForCutover ? <span className="loaded-replacement-required" title="Required for cancellation">★</span> : null}
                    </strong>
                    <input
                      type="text"
                      className="loaded-replacement-notes-input"
                      placeholder="Notes (optional)…"
                      defaultValue={check.notes ?? ''}
                      onBlur={(event) => {
                        if (event.target.value !== (check.notes ?? '')) {
                          void updateNotes(check, event.target.value);
                        }
                      }}
                    />
                    {check.updatedAt ? (
                      <small style={{ color: 'var(--color-text-muted)' }}>
                        Updated {formatTime(check.updatedAt)}{check.updatedBy ? ` by ${check.updatedBy}` : ''}
                      </small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}

      <Card title="Parallel comparison cycles" subtitle="Run Alma and Loaded side-by-side for at least two stocktake cycles before cancelling.">
        {overview.comparisons.length === 0 ? (
          <p className="subtle">
            No comparison cycles recorded yet. After your next stocktake, record Loaded's totals here so the variance is visible and explainable.
            Future passes of this page will let you submit cycles inline — for now, drop the variance notes into the related checks above.
          </p>
        ) : (
          <ul className="loaded-replacement-list">
            {overview.comparisons.map((cycle) => (
              <li key={cycle.id} className={`loaded-replacement-row is-${cycle.explained ? 'ready' : 'needs_work'}`}>
                <Badge tone={cycle.explained ? 'positive' : 'warning'}>
                  Cycle {cycle.cycleNumber} {cycle.explained ? '· explained' : '· needs review'}
                </Badge>
                <div className="loaded-replacement-row-body">
                  <strong>{cycle.label}</strong>
                  <small>Recorded {formatTime(cycle.recordedAt)} by {cycle.recordedBy}</small>
                  {cycle.notes ? <span className="subtle">{cycle.notes}</span> : null}
                  <Button
                    type="button"
                    size="sm"
                    variant={cycle.explained ? 'ghost' : 'primary'}
                    onClick={() => void toggleExplained(cycle.id, !cycle.explained)}
                  >
                    {cycle.explained ? 'Mark as needing review' : 'Mark variance explained'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {message ? <ActionFeedback message={message} tone={tone} /> : null}
    </div>
  );
}
