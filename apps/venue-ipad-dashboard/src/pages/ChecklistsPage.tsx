// Phase 5.7: Venue iPad — Checklists (complete today's runs).
//
// Compliance is live and the run endpoints are staff-accessible (no
// manager gate), so this is a real working flow: staff open today's
// checklist runs and tick each item Pass / Fail / N/A with an optional
// note. Each tap saves immediately via PUT /runs/:runId/items/:itemId.
//
// Two views: a list of today's open runs, and a single run's items.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChecklistItemResult, ChecklistRun } from '@alma/shared';
import { api, messageForError } from '../api';
import { AppShell, type PageShellProps, type Venue } from '../shell';

type Props = Omit<PageShellProps, 'requirePin'> & { venue: Venue };

const RESULTS: Array<{ value: ChecklistItemResult; label: string; tone: string }> = [
  { value: 'PASS', label: 'Pass', tone: 'pass' },
  { value: 'FAIL', label: 'Fail', tone: 'fail' },
  { value: 'NA', label: 'N/A', tone: 'na' }
];

function isToday(iso: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10) === today;
}

function runProgress(run: ChecklistRun): { done: number; total: number } {
  const total = run.items.length;
  const done = run.items.filter((item) => item.result !== 'PENDING').length;
  return { done, total };
}

export function ChecklistsPage({ venue, auth, onRequestStaffPin, onSwitchStaff }: Props) {
  const [runs, setRuns] = useState<ChecklistRun[] | null>(null);
  const [activeRun, setActiveRun] = useState<ChecklistRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  // Synchronous lock so rapid consecutive taps can't both pass the guard
  // before React has processed the setSavingItemId state update.
  const savingItemRef = useRef<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const all = await api<ChecklistRun[]>('/api/checklists/runs');
      // Today's runs that still need attention. Runs have no venue field,
      // so we scope by date + open status (volumes are small).
      setRuns(all.filter((run) => isToday(run.runDate) && run.status !== 'COMPLETED'));
    } catch (e) {
      setError(messageForError(e, 'Could not load checklists.'));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeRun) void loadRuns();
  }, [activeRun, loadRuns]);

  const openRun = useCallback(async (id: string) => {
    setError('');
    try {
      setActiveRun(await api<ChecklistRun>(`/api/checklists/runs/${id}`));
    } catch (e) {
      setError(messageForError(e, 'Could not open this checklist.'));
    }
  }, []);

  const setItemResult = useCallback(
    async (itemId: string, result: ChecklistItemResult) => {
      if (!activeRun || savingItemRef.current) return;
      savingItemRef.current = itemId;
      setSavingItemId(itemId);
      // Optimistic update.
      const prev = activeRun;
      setActiveRun({
        ...activeRun,
        items: activeRun.items.map((item) => (item.id === itemId ? { ...item, result } : item))
      });
      try {
        const updated = await api<ChecklistRun>(
          `/api/checklists/runs/${activeRun.id}/items/${itemId}`,
          { method: 'PUT', body: JSON.stringify({ result }) }
        );
        setActiveRun(updated);
      } catch (e) {
        setActiveRun(prev);
        setError(messageForError(e, 'Could not save that item.'));
      } finally {
        savingItemRef.current = null;
        setSavingItemId(null);
      }
    },
    [activeRun]
  );

  const activeProgress = useMemo(
    () => (activeRun ? runProgress(activeRun) : { done: 0, total: 0 }),
    [activeRun]
  );

  // ---- Run detail view ----
  if (activeRun) {
    const pct =
      activeProgress.total === 0 ? 0 : Math.round((activeProgress.done / activeProgress.total) * 100);
    return (
      <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
        <section className="page-stack">
          <div className="section-block">
            <div className="section-header">
              <div>
                <p className="eyebrow">
                  {venue.name}
                  {activeRun.area ? ` · ${activeRun.area}` : ''}
                </p>
                <h2>{activeRun.template.name}</h2>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setActiveRun(null)}
                disabled={savingItemId !== null}
                title={savingItemId !== null ? 'Checklist saving, please wait' : undefined}
              >
                Back
              </button>
            </div>
            <p className="section-copy">
              {activeProgress.done}/{activeProgress.total} items done. Tap Pass, Fail or N/A for each.
            </p>
            <div className="stock-progress">
              <div className="stock-progress-bar" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {error ? <p className="device-signin-error">{error}</p> : null}

          <div className="checklist-items">
            {activeRun.items
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((item) => (
                <div key={item.id} className={`checklist-item is-${item.result.toLowerCase()}`}>
                  <div className="checklist-item-text">
                    <strong>{item.label}</strong>
                    {item.description ? <p>{item.description}</p> : null}
                  </div>
                  <div className="checklist-item-buttons">
                    {RESULTS.map((r) => (
                      <button
                        key={r.value}
                        type="button"
                        className={`checklist-result-btn is-${r.tone}${item.result === r.value ? ' is-active' : ''}`}
                        disabled={savingItemId === item.id}
                        onClick={() => void setItemResult(item.id, r.value)}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </AppShell>
    );
  }

  // ---- List view ----
  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Checklists</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">Today's opening, closing and service checks. Tap one to run it.</p>
        </div>

        {error ? <p className="device-signin-error">{error}</p> : null}
        {loading && !runs ? (
          <p className="preview-eyebrow">Loading checklists…</p>
        ) : runs && runs.length === 0 ? (
          <div className="preview-panel">
            <p className="preview-eyebrow">All clear</p>
            <p>No open checklists for today. A manager schedules them in Alma Compliance.</p>
          </div>
        ) : (
          <div className="data-list">
            {(runs ?? []).map((run) => {
              const { done, total } = runProgress(run);
              const complete = total > 0 && done === total;
              return (
                <button
                  key={run.id}
                  type="button"
                  className="stock-resume-row"
                  onClick={() => void openRun(run.id)}
                >
                  <span>
                    <strong>{run.template.name}</strong>
                    <small>
                      {run.area ? `${run.area} · ` : ''}
                      {done}/{total} done
                    </small>
                  </span>
                  <span className={`status-pill ${complete ? 'positive' : 'warning'}`}>
                    {complete ? 'Ready' : 'Open'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
