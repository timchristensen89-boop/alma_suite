import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageForError } from './api';
import { ALMA_MARK } from './brand';

/**
 * The clock-in kiosk — alma-pos.web.app/#clock — the tablet on the wall by
 * the kitchen door. Replaces the Deputy kiosk.
 *
 * The tablet holds the venue's device session (sign it in once on the
 * register screen); every punch is proven by the person's own PIN, so nobody
 * is ever "logged in" to the wall. Type PIN → see your status → one big
 * button. The idle screen shows who is on right now, which is also the
 * manager's glance-check that everyone remembered to punch.
 */

type PunchResult = {
  staff: { id: string; firstName: string; lastName: string; roleTitle: string | null };
  session: { clockInAt: string; venue: string | null; onBreak: boolean; breakStartedAt: string | null; breakMinutes: number } | null;
};
type OnNowRow = { id: string; name: string; roleTitle: string | null; clockInAt: string; onBreak: boolean };

const RESET_AFTER_ACTION_MS = 6000;
const RESET_IDLE_MS = 25000;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

export function Clock() {
  const [now, setNow] = useState(() => new Date());
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState<PunchResult | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [onNow, setOnNow] = useState<OnNowRow[]>([]);
  const resetTimer = useRef<number | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadOnNow = useCallback(() => {
    void api<OnNowRow[]>('/api/device/kiosk/on-now')
      .then(setOnNow)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    loadOnNow();
    const timer = setInterval(loadOnNow, 60_000);
    return () => clearInterval(timer);
  }, [loadOnNow]);

  const reset = useCallback(() => {
    setPin('');
    setWho(null);
    setDone(null);
    setError(null);
    setBusy(false);
  }, []);

  // Any screen that is not the idle pad walks itself back there — a kiosk
  // must never be left showing somebody's name.
  const armReset = useCallback(
    (ms: number) => {
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(reset, ms);
    },
    [reset]
  );

  async function punch(action: 'status' | 'in' | 'out' | 'break-start' | 'break-end') {
    if (busy || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<PunchResult>('/api/device/kiosk/punch', {
        method: 'POST',
        body: JSON.stringify({ pin, action })
      });
      if (action === 'status') {
        setWho(result);
        armReset(RESET_IDLE_MS);
      } else {
        const first = result.staff.firstName || 'Done';
        setDone(
          action === 'in'
            ? `Clocked in at ${timeOf(result.session!.clockInAt)} — have a good shift, ${first}.`
            : action === 'out'
              ? `Clocked out — see you next time, ${first}.`
              : action === 'break-start'
                ? `On break — enjoy it, ${first}.`
                : `Back on — thanks, ${first}.`
        );
        setWho(null);
        loadOnNow();
        armReset(RESET_AFTER_ACTION_MS);
      }
    } catch (err) {
      setError(messageForError(err, 'That did not work — try again.'));
      setWho(null);
      armReset(RESET_IDLE_MS);
    } finally {
      setBusy(false);
    }
  }

  const press = (digit: string) => {
    setError(null);
    setDone(null);
    if (digit === '⌫') {
      setPin((current) => current.slice(0, -1));
      return;
    }
    setPin((current) => (current.length >= 6 ? current : current + digit));
    armReset(RESET_IDLE_MS);
  };

  const session = who?.session ?? null;

  return (
    <div className="clock-kiosk">
      <header className="clock-head">
        <img src={ALMA_MARK} alt="" className="clock-mark" />
        <div>
          <strong>{now.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}</strong>
          <span>{now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </div>
      </header>

      {done ? (
        <div className="clock-done" onClick={reset}>
          <p>{done}</p>
        </div>
      ) : who ? (
        <div className="clock-actions">
          <h1>
            {who.staff.firstName} {who.staff.lastName}
          </h1>
          <p className="clock-status">
            {session
              ? session.onBreak
                ? `On break since ${timeOf(session.breakStartedAt!)} · on since ${timeOf(session.clockInAt)}`
                : `On since ${timeOf(session.clockInAt)}${session.breakMinutes ? ` · ${session.breakMinutes} min break taken` : ''}`
              : 'Not clocked in.'}
          </p>
          <div className="clock-buttons">
            {!session ? (
              <button type="button" className="clock-primary" disabled={busy} onClick={() => void punch('in')}>
                Clock in
              </button>
            ) : session.onBreak ? (
              <>
                <button type="button" className="clock-primary" disabled={busy} onClick={() => void punch('break-end')}>
                  End break
                </button>
                <button type="button" className="clock-secondary" disabled={busy} onClick={() => void punch('out')}>
                  Clock out
                </button>
              </>
            ) : (
              <>
                <button type="button" className="clock-secondary" disabled={busy} onClick={() => void punch('break-start')}>
                  Start break
                </button>
                <button type="button" className="clock-primary" disabled={busy} onClick={() => void punch('out')}>
                  Clock out
                </button>
              </>
            )}
          </div>
          <button type="button" className="clock-ghost" onClick={reset}>
            Not you? Start again
          </button>
        </div>
      ) : (
        <div className="clock-main">
          <div className="clock-pad">
            <p className="clock-dots">{pin.length === 0 ? 'Your PIN' : '●'.repeat(pin.length)}</p>
            {error ? <p className="clock-error">{error}</p> : null}
            <div className="clock-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((key) => (
                <button key={key} type="button" onClick={() => press(key)}>
                  {key}
                </button>
              ))}
              <button type="button" className="clock-go" disabled={busy || pin.length < 4} onClick={() => void punch('status')}>
                {busy ? '…' : 'Go'}
              </button>
            </div>
          </div>
          <aside className="clock-onnow">
            <h2>On now</h2>
            {onNow.length === 0 ? <p className="clock-muted">Nobody clocked in.</p> : null}
            {onNow.map((row) => (
              <p key={row.id} className={row.onBreak ? 'clock-row clock-row-break' : 'clock-row'}>
                <span>{row.name}</span>
                <span>{row.onBreak ? 'on break' : `since ${timeOf(row.clockInAt)}`}</span>
              </p>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
