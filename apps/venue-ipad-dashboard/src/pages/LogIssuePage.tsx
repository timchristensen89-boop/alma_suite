// Venue iPad — quick issue / fridge-alarm logging.
//
// Audit blind-spot: floor staff had no fast way to log a fridge alarm,
// equipment fault, or hazard from the iPad — it had to wait for someone to
// open Compliance on a laptop. This is a one-screen capture that POSTs to the
// same /api/issues endpoint the Compliance app uses, so it lands in the normal
// issue queue (and becomes an AlmaTask if it's critical/overdue).
//
// Auth: logging an issue is allowed for any signed-in staff member (not just
// managers), but it must be attributed to a person — so a staff PIN has to be
// active. If none is, we prompt for the PIN instead of silently failing.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { IssueSeverity } from '@alma/shared';
import { api, ApiRequestError, messageForError } from '../api';
import { AppShell, type PageShellProps, type Venue } from '../shell';

type Props = Omit<PageShellProps, 'requirePin'> & { venue: Venue };

const VENUE_LABELS: Record<string, string> = {
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

// Presets tuned for what gets logged from the floor mid-service. "Fridge /
// cold chain" defaults to HIGH because a failing fridge is a cold-chain risk.
const CATEGORY_PRESETS: Array<{ category: string; label: string; severity: IssueSeverity }> = [
  { category: 'Fridge / cold chain', label: '🧊 Fridge alarm', severity: 'HIGH' },
  { category: 'Equipment / maintenance', label: '🔧 Equipment', severity: 'MEDIUM' },
  { category: 'Cleaning / hygiene', label: '🧽 Cleaning', severity: 'MEDIUM' },
  { category: 'Safety / hazard', label: '⚠️ Safety', severity: 'HIGH' },
  { category: 'Other', label: '📝 Other', severity: 'LOW' }
];

const SEVERITIES: IssueSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function LogIssuePage({ venue, auth, onRequestStaffPin, onSwitchStaff }: Props) {
  const venueLabel = VENUE_LABELS[venue.id] ?? venue.name;

  const [category, setCategory] = useState(CATEGORY_PRESETS[0].category);
  const [severity, setSeverity] = useState<IssueSeverity>(CATEGORY_PRESETS[0].severity);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loggedTitle, setLoggedTitle] = useState<string | null>(null);

  const staffActive = Boolean(auth.staff);

  function applyPreset(preset: (typeof CATEGORY_PRESETS)[number]) {
    setCategory(preset.category);
    setSeverity(preset.severity);
  }

  function reset() {
    setTitle('');
    setLocation('');
    setDescription('');
    setLoggedTitle(null);
    setError('');
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      setError('Add a short summary (at least a few words).');
      return;
    }
    const detail = description.trim() || trimmedTitle;
    setSubmitting(true);
    setError('');
    try {
      await api('/api/issues', {
        method: 'POST',
        body: JSON.stringify({
          title: trimmedTitle,
          description: detail.length < 3 ? `${detail} (logged from venue iPad)` : detail,
          severity,
          category,
          area: [venueLabel, location.trim()].filter(Boolean).join(' — ')
        })
      });
      setLoggedTitle(trimmedTitle);
      setTitle('');
      setLocation('');
      setDescription('');
    } catch (e) {
      if (e instanceof ApiRequestError && (e.status === 401 || e.status === 403)) {
        onRequestStaffPin();
        setError('Sign in with your staff PIN to log an issue.');
      } else {
        setError(messageForError(e, 'Could not log the issue. Try again or tell a manager.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Log an issue</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            Fridge alarm, broken equipment, a spill or a hazard — log it here and it goes straight
            into the Compliance issue queue for the manager to action.
          </p>
        </div>

        {!staffActive ? (
          <div className="section-block">
            <p className="eyebrow">Staff sign-in needed</p>
            <h2>Sign in with your PIN to log an issue</h2>
            <p className="section-copy">
              Issues are logged against the person reporting them, so tap below and enter your staff
              PIN first.
            </p>
            <button type="button" className="button" onClick={onRequestStaffPin}>
              Enter staff PIN
            </button>
          </div>
        ) : null}

        {loggedTitle ? (
          <div className="section-block">
            <p className="eyebrow">Logged</p>
            <h2>“{loggedTitle}” is in the issue queue</h2>
            <p className="section-copy">
              A manager will see it in Compliance. If it&apos;s urgent, tell them now too.
            </p>
            <button type="button" className="button" onClick={reset}>
              Log another
            </button>
          </div>
        ) : (
          <>
            <div className="section-block">
              <p className="eyebrow">What kind of issue?</p>
              <div className="issue-presets">
                {CATEGORY_PRESETS.map((preset) => (
                  <button
                    key={preset.category}
                    type="button"
                    className={`button ${category === preset.category ? '' : 'secondary'}`}
                    onClick={() => applyPreset(preset)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="section-block">
              <label className="gift-field">
                <span>Summary</span>
                <input
                  type="text"
                  value={title}
                  maxLength={120}
                  placeholder="e.g. Walk-in fridge reading 9°C"
                  onChange={(event) => setTitle(event.currentTarget.value)}
                />
              </label>

              <label className="gift-field">
                <span>Where (optional)</span>
                <input
                  type="text"
                  value={location}
                  maxLength={80}
                  placeholder="e.g. Kitchen walk-in, Bar 2"
                  onChange={(event) => setLocation(event.currentTarget.value)}
                />
              </label>

              <label className="gift-field">
                <span>Details (optional)</span>
                <textarea
                  value={description}
                  rows={3}
                  maxLength={500}
                  placeholder="Anything the manager needs to know"
                  onChange={(event) => setDescription(event.currentTarget.value)}
                />
              </label>

              <label className="gift-field">
                <span>Severity</span>
                <select value={severity} onChange={(event) => setSeverity(event.currentTarget.value as IssueSeverity)}>
                  {SEVERITIES.map((value) => (
                    <option key={value} value={value}>
                      {value.charAt(0) + value.slice(1).toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>

              {error ? <p className="form-error">{error}</p> : null}

              <button type="button" className="button" disabled={submitting || !staffActive} onClick={() => void submit()}>
                {submitting ? 'Logging…' : 'Log issue'}
              </button>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}
