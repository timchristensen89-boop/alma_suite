// iPad-first Stocktake — Phase 5.6a (count + save draft + resume)
//
// Three internal views drive the page:
//   list     — open + recent stocktakes for this venue (resume / view only)
//   session  — area picker for a chosen stocktake (groups lines by `location`)
//   count    — count items in the chosen area, big inputs, save draft
//
// What this commit covers
// - Read open + recent stocktakes for the venue, group lines by area, count
//   with big inputs, save draft to the existing PATCH /api/stocktake/:id.
// - "Touched" state is tracked iPad-local: a line shows as "Not counted yet"
//   until the staff member explicitly types a value or taps +/-/zero. This
//   approximates the strategy doc's zero-vs-not-counted concern WITHOUT a
//   schema change. A future migration to make StocktakeLine.countedQty
//   nullable would let us persist this distinction.
//
// What this commit does NOT cover (Phase 5.6b)
// - Submit / review / lock (requires manager PIN — current RBAC blocks staff)
// - Variance review screen before submit
// - High-variance + missing-count warnings (the data for this lives in
//   the variance endpoint we'll wire in 5.6b)
// - CSV export action
// - Start-new-session button (manager-only path; safer to add with submit)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Stocktake, StocktakeLine, StocktakeWithLines, StocktakesPayload } from '@alma/shared';
import { api, ApiRequestError, messageForError } from '../api';
import { AppShell, type PageShellProps, type Venue } from '../shell';

type Props = Omit<PageShellProps, 'requirePin'> & { venue: Venue };

// Lines without an explicit location are bucketed as "Unsorted".
const UNSORTED = 'Unsorted';

function areaKey(line: StocktakeLine): string {
  const loc = line.location?.trim();
  return loc && loc.length > 0 ? loc : UNSORTED;
}

function isOpenStatus(s: Stocktake['status']) {
  return s === 'IN_PROGRESS' || s === 'REOPENED';
}

// We can't get the canonical venue name reliably from the iPad's local venue
// id, but the API filters by req.user's venue server-side. We still filter
// client-side as belt-and-braces in case multiple venues come back.
function belongsToVenue(stocktake: Stocktake, venueName: string | null): boolean {
  if (!stocktake.venue) return true;
  if (!venueName) return true;
  return stocktake.venue.toLowerCase() === venueName.toLowerCase();
}

const VENUE_API_NAMES: Record<string, string> = {
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

export function StocktakePage({ venue, auth, onRequestStaffPin, onSwitchStaff }: Props) {
  const venueApiName = VENUE_API_NAMES[venue.id] ?? null;

  const wrap = (body: React.ReactNode) => (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      {body}
    </AppShell>
  );

  const [view, setView] = useState<'list' | 'session' | 'count'>('list');
  const [list, setList] = useState<Stocktake[] | null>(null);
  const [listError, setListError] = useState<string>('');
  const [listLoading, setListLoading] = useState(true);

  const [session, setSession] = useState<StocktakeWithLines | null>(null);
  const [sessionError, setSessionError] = useState<string>('');
  const [sessionLoading, setSessionLoading] = useState(false);

  const [activeArea, setActiveArea] = useState<string | null>(null);

  // Per-line draft counts + touched flag, scoped to the open session.
  // Cleared whenever a different session is loaded.
  const [draftCounts, setDraftCounts] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Record<string, true>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // ---------- Load list ----------

  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const payload = await api<StocktakesPayload>('/api/stocktake');
      setList(payload.stocktakes.filter((s) => belongsToVenue(s, venueApiName)));
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 403) {
        setListError(
          "Your staff account doesn't have stock access at this venue. Ask the manager to add stock access in Admin."
        );
      } else {
        setListError(messageForError(e, 'Could not load stocktakes.'));
      }
      setList([]);
    } finally {
      setListLoading(false);
    }
  }, [venueApiName]);

  useEffect(() => {
    if (view === 'list') void loadList();
  }, [loadList, view]);

  // ---------- Load + open a session ----------

  const openSession = useCallback(async (id: string) => {
    setSessionLoading(true);
    setSessionError('');
    setSession(null);
    try {
      const data = await api<StocktakeWithLines>(`/api/stocktake/${id}`);
      setSession(data);
      // Seed drafts from current line values; touched stays empty.
      const seed: Record<string, number> = {};
      for (const line of data.lines) seed[line.id] = line.countedQty;
      setDraftCounts(seed);
      setTouched({});
      setActiveArea(null);
      setView('session');
    } catch (e) {
      setSessionError(messageForError(e, 'Could not open this stocktake.'));
    } finally {
      setSessionLoading(false);
    }
  }, []);

  // ---------- Area grouping ----------

  const areas = useMemo(() => {
    if (!session) return [];
    const groups = new Map<string, { area: string; total: number; touched: number }>();
    for (const line of session.lines) {
      const key = areaKey(line);
      const current = groups.get(key) ?? { area: key, total: 0, touched: 0 };
      current.total += 1;
      if (touched[line.id]) current.touched += 1;
      groups.set(key, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.area.localeCompare(b.area));
  }, [session, touched]);

  const linesInActiveArea = useMemo(() => {
    if (!session || !activeArea) return [];
    return session.lines
      .filter((line) => areaKey(line) === activeArea)
      .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label));
  }, [activeArea, session]);

  // ---------- Save draft ----------

  const saveDraft = useCallback(async () => {
    if (!session) return;
    setSaving(true);
    setSaveError('');
    try {
      const linesPayload = session.lines.map((line) => ({
        itemId: line.itemId ?? undefined,
        label: line.label,
        countedQty: draftCounts[line.id] ?? line.countedQty,
        unit: line.unit ?? undefined,
        location: line.location ?? undefined,
        notes: line.notes ?? undefined
      }));
      const updated = await api<StocktakeWithLines>(`/api/stocktake/${session.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ lines: linesPayload })
      });
      setSession(updated);
      // Re-seed drafts from the server response, keep "touched" set so the
      // staff member can see what they updated this session.
      const seed: Record<string, number> = {};
      for (const line of updated.lines) seed[line.id] = line.countedQty;
      setDraftCounts(seed);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(messageForError(e, 'Could not save draft.'));
    } finally {
      setSaving(false);
    }
  }, [draftCounts, session]);

  // Auto-clear the "Saved" flash after 3s
  useEffect(() => {
    if (!savedAt) return;
    const id = window.setTimeout(() => setSavedAt(null), 3000);
    return () => window.clearTimeout(id);
  }, [savedAt]);

  // ---------- Line update helpers ----------

  const setCount = useCallback(
    (lineId: string, value: number) => {
      setDraftCounts((prev) => ({ ...prev, [lineId]: Number.isFinite(value) ? value : 0 }));
      setTouched((prev) => ({ ...prev, [lineId]: true }));
    },
    []
  );

  const bumpCount = useCallback(
    (lineId: string, delta: number) => {
      setDraftCounts((prev) => {
        const next = (prev[lineId] ?? 0) + delta;
        return { ...prev, [lineId]: Math.max(0, next) };
      });
      setTouched((prev) => ({ ...prev, [lineId]: true }));
    },
    []
  );

  // ---------- Render ----------

  const totalLines = session?.lines.length ?? 0;
  const touchedCount = Object.keys(touched).length;
  const progressPercent = totalLines === 0 ? 0 : Math.round((touchedCount / totalLines) * 100);

  if (view === 'list') {
    return wrap(
      <section className="page-stack">
          <div className="section-block">
            <div className="section-header">
              <div>
                <p className="eyebrow">{venue.name}</p>
                <h2>Stocktake</h2>
              </div>
              <Link className="button secondary" to={`/venue/${venue.id}`}>
                Back to venue
              </Link>
            </div>
            <p className="section-copy">
              Resume an open stocktake to count by area on this iPad. A manager submits the count
              once every area is finished.
            </p>
          </div>

          {listError ? <p className="device-signin-error">{listError}</p> : null}
          {listLoading && !list ? (
            <p className="preview-eyebrow">Loading…</p>
          ) : (
            <StocktakeList
              list={list ?? []}
              venueId={venue.id}
              onResume={(id) => void openSession(id)}
            />
          )}
        </section>
    );
  }

  if (view === 'session') {
    if (sessionLoading) {
      return wrap(
        <section className="page-stack">
          <p className="preview-eyebrow">Loading session…</p>
        </section>
      );
    }
    if (sessionError || !session) {
      return wrap(
        <section className="page-stack">
          <p className="device-signin-error">{sessionError || 'Stocktake not available.'}</p>
          <button type="button" className="button secondary" onClick={() => setView('list')}>
            Back to stocktake list
          </button>
        </section>
      );
    }
    return wrap(
      <section className="page-stack">
          <div className="section-block">
            <div className="section-header">
              <div>
                <p className="eyebrow">{venue.name} · {session.status.replace('_', ' ').toLowerCase()}</p>
                <h2>{session.name}</h2>
              </div>
              <button type="button" className="button secondary" onClick={() => setView('list')}>
                Back
              </button>
            </div>
            <p className="section-copy">
              Pick a count area below. Progress saves to the manager's review queue when you tap
              Save. {touchedCount > 0 ? `${touchedCount}/${totalLines} lines updated this session.` : null}
            </p>
            <div className="stock-progress">
              <div className="stock-progress-bar" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="stock-area-grid">
            {areas.length === 0 ? (
              <p className="preview-eyebrow">No lines on this stocktake.</p>
            ) : (
              areas.map((area) => (
                <button
                  key={area.area}
                  type="button"
                  className="stock-area-card"
                  onClick={() => {
                    setActiveArea(area.area);
                    setView('count');
                  }}
                >
                  <strong>{area.area}</strong>
                  <span>
                    {area.touched}/{area.total} counted
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="stock-save-row">
            {saveError ? <span className="device-signin-error">{saveError}</span> : null}
            {savedAt ? <span className="stock-saved-flash">Saved · drafts updated</span> : null}
            <button
              type="button"
              className="button"
              disabled={saving || touchedCount === 0}
              onClick={() => void saveDraft()}
            >
              {saving ? 'Saving…' : `Save draft${touchedCount ? ` (${touchedCount})` : ''}`}
            </button>
          </div>
        </section>
    );
  }

  // view === 'count'
  return wrap(
    <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{session?.name} · {venue.name}</p>
              <h2>{activeArea}</h2>
            </div>
            <button type="button" className="button secondary" onClick={() => setView('session')}>
              Areas
            </button>
          </div>
          <p className="section-copy">
            Tap a count to type, or use +/- for quick adjustments. Lines stay marked
            "Not counted yet" until you touch them on this iPad.
          </p>
        </div>

        <div className="stock-lines">
          {linesInActiveArea.map((line) => {
            const value = draftCounts[line.id] ?? line.countedQty;
            const isTouched = Boolean(touched[line.id]);
            const onHand = line.item?.onHand;
            return (
              <div key={line.id} className={`stock-line${isTouched ? ' is-touched' : ''}`}>
                <div className="stock-line-meta">
                  <strong>{line.label}</strong>
                  <span>
                    {line.unit ?? '—'}
                    {onHand !== undefined ? ` · on hand ${onHand}` : null}
                  </span>
                  {!isTouched ? <span className="stock-line-untouched">Not counted yet</span> : null}
                </div>
                <div className="stock-line-controls">
                  <button
                    type="button"
                    className="stock-bump"
                    onClick={() => bumpCount(line.id, -1)}
                    aria-label={`Decrease ${line.label}`}
                  >
                    −
                  </button>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="stock-count-input"
                    value={value}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => {
                      const raw = e.currentTarget.value;
                      const num = raw === '' || raw === '-' ? 0 : Number(raw);
                      setCount(line.id, num);
                    }}
                  />
                  <button
                    type="button"
                    className="stock-bump"
                    onClick={() => bumpCount(line.id, 1)}
                    aria-label={`Increase ${line.label}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="stock-save-row">
          {saveError ? <span className="device-signin-error">{saveError}</span> : null}
          {savedAt ? <span className="stock-saved-flash">Saved · drafts updated</span> : null}
          <button
            type="button"
            className="button"
            disabled={saving || touchedCount === 0}
            onClick={() => void saveDraft()}
          >
            {saving ? 'Saving…' : `Save draft${touchedCount ? ` (${touchedCount})` : ''}`}
          </button>
        </div>
      </section>
  );
}

// ----------------------------------------------------------------------
// StocktakeList — open + recent (last 5 of each)
// ----------------------------------------------------------------------

function StocktakeList({
  list,
  venueId,
  onResume
}: {
  list: Stocktake[];
  venueId: string;
  onResume: (id: string) => void;
}) {
  const open = list.filter((s) => isOpenStatus(s.status));
  const recent = list.filter((s) => !isOpenStatus(s.status)).slice(0, 5);

  if (list.length === 0) {
    return (
      <div className="preview-panel">
        <p className="preview-eyebrow">No stocktakes</p>
        <p>
          No stocktakes for this venue yet. A manager creates the session in Alma Stock; staff then
          count from this iPad.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="section-block">
        <div className="section-header">
          <div>
            <p className="eyebrow">Open</p>
            <h2>Resume a count</h2>
          </div>
        </div>
        {open.length === 0 ? (
          <p className="section-copy">No open stocktakes. Ask a manager to start a new one.</p>
        ) : (
          <div className="data-list">
            {open.map((s) => (
              <button key={s.id} type="button" className="stock-resume-row" onClick={() => onResume(s.id)}>
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.lineCount} lines · {s.status.replace('_', ' ').toLowerCase()}
                  </small>
                </span>
                <span className="status-pill warning">Resume</span>
              </button>
            ))}
          </div>
        )}
      </section>
      {recent.length > 0 ? (
        <section className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recent</p>
              <h2>Submitted / locked</h2>
            </div>
            <Link to={`/venue/${venueId}`} className="button secondary">
              Done
            </Link>
          </div>
          <div className="data-list">
            {recent.map((s) => (
              <div key={s.id} className="data-row">
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.lineCount} lines · {new Date(s.countedAt).toLocaleDateString('en-AU')}
                  </small>
                </span>
                <span
                  className={`status-pill ${s.status === 'LOCKED' || s.status === 'REVIEWED' ? 'positive' : 'neutral'}`}
                >
                  {s.status.replace('_', ' ').toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
