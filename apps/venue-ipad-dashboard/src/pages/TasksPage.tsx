// Phase 5.10a: Venue iPad — real Tasks tile backed by AlmaTask API.
//
// Reads /api/tasks?outstanding=true&venue=NAME, groups by priority
// (CRITICAL → TODAY → THIS_WEEK → LOW), shows the source app +
// optional due / owner. Tap Complete / Dismiss to action a task;
// the row clears optimistically and the list refreshes after the
// API call settles.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  AlmaTask,
  AlmaTaskPriority,
  AlmaTaskSourceApp,
  AlmaTasksPayload,
  AlmaTasksSummary
} from '@alma/shared';
import { api, ApiRequestError, messageForError } from '../api';
import { AppShell, type PageShellProps, type Venue } from '../shell';

type Props = Omit<PageShellProps, 'requirePin'> & { venue: Venue };

const VENUE_API_NAMES: Record<string, string> = {
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

const PRIORITY_ORDER: AlmaTaskPriority[] = ['CRITICAL', 'TODAY', 'THIS_WEEK', 'LOW'];

const PRIORITY_LABEL: Record<AlmaTaskPriority, string> = {
  CRITICAL: 'Critical',
  TODAY: 'Today',
  THIS_WEEK: 'This week',
  LOW: 'Backlog'
};

const PRIORITY_TONE: Record<AlmaTaskPriority, 'danger' | 'warning' | 'neutral' | 'muted'> = {
  CRITICAL: 'danger',
  TODAY: 'warning',
  THIS_WEEK: 'neutral',
  LOW: 'muted'
};

const SOURCE_LABEL: Record<AlmaTaskSourceApp, string> = {
  HOME: 'Home',
  STAFF: 'Staff',
  STOCK: 'Stock',
  COMPLIANCE: 'Compliance',
  RESERVE: 'Reserve',
  MARKETING: 'Marketing',
  GIFTCARDS: 'Gift cards',
  REPORTS: 'Reports',
  ADMIN: 'Admin',
  COMMS: 'Comms'
};

function relativeDue(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((due - now) / 60000);
  if (Math.abs(diffMin) < 60) return diffMin <= 0 ? 'overdue' : `due in ${diffMin}m`;
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 36) return diffHr <= 0 ? 'overdue' : `due in ${diffHr}h`;
  const diffDay = Math.round(diffHr / 24);
  return diffDay <= 0 ? 'overdue' : `due in ${diffDay}d`;
}

export function TasksPage({ venue, auth, onRequestStaffPin, onSwitchStaff }: Props) {
  const venueApiName = VENUE_API_NAMES[venue.id] ?? null;

  const [tasks, setTasks] = useState<AlmaTask[] | null>(null);
  const [summary, setSummary] = useState<AlmaTasksSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ outstanding: 'true' });
      if (venueApiName) params.set('venue', venueApiName);
      const [list, sum] = await Promise.all([
        api<AlmaTasksPayload>(`/api/tasks?${params.toString()}`),
        api<AlmaTasksSummary>('/api/tasks/summary')
      ]);
      setTasks(list.tasks);
      setSummary(sum);
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setError("Your staff account doesn't have access to tasks at this venue.");
        setTasks([]);
      } else {
        setError(messageForError(e, 'Could not load tasks.'));
      }
    } finally {
      setLoading(false);
    }
  }, [venueApiName]);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh every 60s — tasks emitted by other apps land without a manual reload.
  useEffect(() => {
    const id = window.setInterval(() => {
      void load();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const grouped = useMemo(() => {
    const groups: Record<AlmaTaskPriority, AlmaTask[]> = {
      CRITICAL: [],
      TODAY: [],
      THIS_WEEK: [],
      LOW: []
    };
    if (!tasks) return groups;
    for (const t of tasks) groups[t.priority].push(t);
    return groups;
  }, [tasks]);

  const action = useCallback(
    async (task: AlmaTask, kind: 'complete' | 'dismiss') => {
      if (actioningId) return;
      setActioningId(task.id);
      // Optimistic: remove from local list.
      const prev = tasks;
      setTasks((current) => (current ? current.filter((t) => t.id !== task.id) : current));
      try {
        await api<AlmaTask>(`/api/tasks/${task.id}/${kind}`, { method: 'POST' });
        // Reload to refresh the summary counts too.
        await load();
      } catch (e) {
        // Rollback on failure.
        setTasks(prev);
        setError(messageForError(e, `Could not ${kind} task.`));
      } finally {
        setActioningId(null);
      }
    },
    [actioningId, load, tasks]
  );

  return (
    <AppShell
      venue={venue}
      auth={auth}
      onRequestStaffPin={onRequestStaffPin}
      onSwitchStaff={onSwitchStaff}
    >
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Tasks</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            Open jobs across the venue. Tasks land here from every app — stock counts, compliance
            checks, gift card fulfilment, manager follow-ups. Tap to complete or dismiss.
          </p>
          {summary ? (
            <div className="task-summary-row">
              {PRIORITY_ORDER.map((p) => (
                <span key={p} className={`task-summary-chip is-${PRIORITY_TONE[p]}`}>
                  <strong>{summary.byPriority[p]}</strong>
                  <small>{PRIORITY_LABEL[p]}</small>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {error ? <p className="device-signin-error">{error}</p> : null}
        {loading && !tasks ? (
          <p className="preview-eyebrow">Loading tasks…</p>
        ) : tasks && tasks.length === 0 ? (
          <div className="preview-panel">
            <p className="preview-eyebrow">All clear</p>
            <p>
              No outstanding tasks for {venue.name}. New tasks emitted from any app show up here
              automatically.
            </p>
          </div>
        ) : (
          PRIORITY_ORDER.map((priority) => {
            const inGroup = grouped[priority];
            if (inGroup.length === 0) return null;
            return (
              <section key={priority} className="task-group">
                <header className={`task-group-head is-${PRIORITY_TONE[priority]}`}>
                  <strong>{PRIORITY_LABEL[priority]}</strong>
                  <span>{inGroup.length}</span>
                </header>
                <div className="task-list">
                  {inGroup.map((task) => (
                    <article key={task.id} className="task-card">
                      <div className="task-card-body">
                        <div className="task-card-meta">
                          <span className="task-source-chip">{SOURCE_LABEL[task.sourceApp]}</span>
                          {task.dueAt ? (
                            <span className="task-due-chip">{relativeDue(task.dueAt)}</span>
                          ) : null}
                          {task.owner ? (
                            <span className="task-owner-chip">
                              {task.owner.name.split(' ')[0]}
                            </span>
                          ) : null}
                        </div>
                        <strong>{task.title}</strong>
                        {task.description ? <p>{task.description}</p> : null}
                      </div>
                      <div className="task-card-actions">
                        <button
                          type="button"
                          className="button secondary"
                          disabled={actioningId === task.id}
                          onClick={() => void action(task, 'dismiss')}
                          aria-label={`Dismiss ${task.title}`}
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="button"
                          disabled={actioningId === task.id}
                          onClick={() => void action(task, 'complete')}
                          aria-label={`Complete ${task.title}`}
                        >
                          ✓ Done
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })
        )}
      </section>
    </AppShell>
  );
}
