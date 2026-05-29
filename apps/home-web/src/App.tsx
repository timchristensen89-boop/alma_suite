import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlmaAppIcon,
  SUITE_APPS,
  type SuiteAppIdentity
} from '@alma/ui';

/*
 * Alma Home — staff clock-in kiosk + suite launcher.
 *
 * Ported from the Claude Design handoff bundle (alma-home.html). Visual
 * vocabulary follows the design exactly: forest-deep left panel for the
 * brand/clock/on-shift list, paper right panel for the PIN pad. After
 * successful clock-in the confirm overlay surfaces a "Jump to" row of
 * suite apps so the screen functions as a real home base for the suite
 * — staff clock in and immediately get to their tool.
 *
 * Clock state is localStorage-only for now (matches the design's
 * prototype behaviour). Real /api/staff/me/clock-in wiring is a
 * follow-up — needs the device-PIN session flow set up on Cloud Run
 * first.
 */

type Person = {
  id: string;
  name: string;
  role: string;
  pin: string | null;
  photo?: string;
};

const PEOPLE: Person[] = [
  { id: 'sofi',   name: 'Sofi Nipper',     role: 'Floor manager',         pin: '1234' },
  { id: 'maximo', name: 'Maximo Martinez', role: 'Chef de cuisine',       pin: '2468' },
  { id: 'steven', name: 'Steven Payne',    role: 'Beverage mgr',          pin: '4321' },
  { id: 'kristy', name: 'Kristy Berry',    role: 'Front of house',        pin: '5678' },
  { id: 'lewis',  name: 'Lewis Holt',      role: 'Sous chef',             pin: '1357' },
  { id: 'jack',   name: 'Jack Leary',      role: 'Owner',                 pin: '1111' },
  { id: 'bea',    name: 'Bea Tran',        role: 'New starter · floor',   pin: null }
];

type ClockState = {
  day: string;
  /** Per-staff PIN overrides set via the setup flow. */
  pins: Record<string, string>;
  /** Currently clocked-in staff and the instant they clocked in (ms). */
  shifts: Record<string, { inAt: number }>;
};

const STORAGE_KEY = 'alma-clock-state-v1';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function seedState(): ClockState {
  // Two people pre-clocked-in so the list isn't empty on first load.
  const now = Date.now();
  return {
    day: todayKey(),
    pins: {},
    shifts: {
      maximo: { inAt: now - 2.5 * 3600e3 },
      kristy: { inAt: now - 1.2 * 3600e3 }
    }
  };
}

function loadState(): ClockState {
  if (typeof window === 'undefined') return seedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as ClockState;
    if (parsed.day !== todayKey()) return seedState();
    return parsed;
  } catch {
    return seedState();
  }
}

function persistState(state: ClockState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage disabled (Safari Private mode etc.); silently ignore so
    // the kiosk still renders even if it can't remember between loads.
  }
}

function pinFor(state: ClockState, person: Person): string | null {
  return state.pins[person.id] ?? person.pin;
}

function findByPin(state: ClockState, code: string): Person | null {
  return PEOPLE.find((p) => pinFor(state, p) === code) ?? null;
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join('');
}

function greetingFor(d: Date): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtTime(d: Date): { h: number; m: string; ap: string } {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return { h, m: m < 10 ? `0${m}` : `${m}`, ap };
}

function clockStr(ts: number): string {
  const { h, m, ap } = fmtTime(new Date(ts));
  return `${h}:${m} ${ap}`;
}

function durSince(ts: number): string {
  const ms = Date.now() - ts;
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m < 10 ? `0${m}` : m}m`;
}

// Suite apps to surface as quick-launch tiles. Filters to apps that are
// currently live; settings/admin is dropped so the kiosk never tempts a
// random staff member into admin land.
function quickLaunchApps(): SuiteAppIdentity[] {
  return SUITE_APPS.filter((app) =>
    app.status === 'active' &&
    Boolean(app.href) &&
    app.id !== 'settings'
  );
}

type ConfirmInfo = { person: Person; dir: 'in' | 'out'; worked?: string };

export function App() {
  const [state, setState] = useState<ClockState>(() => loadState());
  const [now, setNow] = useState<Date>(() => new Date());

  // Active PIN entry — applies to whichever pad is currently visible.
  const [entry, setEntry] = useState('');
  const [entryStatus, setEntryStatus] = useState<'idle' | 'err' | 'ok'>('idle');
  const [entryMsg, setEntryMsg] = useState('');
  const [locked, setLocked] = useState(false);

  // Modal overlays.
  const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStage, setSetupStage] = useState<'name' | 'choose' | 'confirm' | 'done'>('name');
  const [setupPerson, setSetupPerson] = useState<Person | null>(null);
  const [setupFirstPin, setSetupFirstPin] = useState('');

  // Where to send keypad input. The clock pad and the setup pad share
  // the same `entry` state but different completion handlers.
  const onCompleteRef = useRef<(code: string) => void>(() => undefined);

  // ── Ticking clock ─────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // ── Persist state whenever it changes ────────────────────────────
  useEffect(() => { persistState(state); }, [state]);

  // ── Confirm overlay auto-dismiss after 4.2s ─────────────────────
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(null), 4200);
    return () => window.clearTimeout(id);
  }, [confirm]);

  const resetEntry = useCallback(() => {
    setEntry('');
    setLocked(false);
    setEntryStatus('idle');
    setEntryMsg('');
  }, []);

  // ── Clock pad PIN handler ────────────────────────────────────────
  const handleClockPin = useCallback((code: string) => {
    const person = findByPin(state, code);
    if (!person) {
      setEntryStatus('err');
      setEntryMsg('PIN not recognised — try again, or set up your PIN.');
      window.setTimeout(() => { resetEntry(); }, 1100);
      return;
    }
    setEntryStatus('ok');
    const onShift = Boolean(state.shifts[person.id]);
    window.setTimeout(() => {
      setState((prev) => {
        const next: ClockState = {
          ...prev,
          shifts: { ...prev.shifts }
        };
        if (onShift) {
          const inAt = prev.shifts[person.id]!.inAt;
          const worked = durSince(inAt);
          delete next.shifts[person.id];
          setConfirm({ person, dir: 'out', worked });
        } else {
          next.shifts[person.id] = { inAt: Date.now() };
          setConfirm({ person, dir: 'in' });
        }
        return next;
      });
      resetEntry();
    }, 420);
  }, [state, resetEntry]);

  // Default keypad completion is the clock handler; the setup flow
  // swaps it in via onCompleteRef when its pad mounts.
  useEffect(() => {
    if (!setupOpen) onCompleteRef.current = handleClockPin;
  }, [handleClockPin, setupOpen]);

  // ── Keypress ─────────────────────────────────────────────────────
  const press = useCallback((key: string) => {
    if (locked) return;
    if (key === 'del') {
      setEntry((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      setEntry('');
      return;
    }
    setEntry((prev) => {
      if (prev.length >= 4) return prev;
      const next = prev + key;
      if (next.length === 4) {
        setLocked(true);
        window.setTimeout(() => onCompleteRef.current(next), 160);
      }
      return next;
    });
  }, [locked]);

  // Physical keyboard support — clock pad only (setup pad listens too).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') press(e.key);
      else if (e.key === 'Backspace') press('del');
      else if (e.key === 'Escape') press('clear');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  // ── Setup flow PIN handler ──────────────────────────────────────
  const handleSetupPin = useCallback((code: string) => {
    if (!setupPerson) return;
    if (setupStage === 'choose') {
      setSetupFirstPin(code);
      setSetupStage('confirm');
      resetEntry();
      return;
    }
    if (code !== setupFirstPin) {
      setEntryStatus('err');
      setEntryMsg("Didn't match — let's try again.");
      window.setTimeout(() => {
        setSetupStage('choose');
        setSetupFirstPin('');
        resetEntry();
      }, 1200);
      return;
    }
    const clash = PEOPLE.some(
      (p) => p.id !== setupPerson.id && pinFor(state, p) === code
    );
    if (clash) {
      setEntryStatus('err');
      setEntryMsg('That PIN is taken — pick another.');
      window.setTimeout(() => {
        setSetupStage('choose');
        setSetupFirstPin('');
        resetEntry();
      }, 1200);
      return;
    }
    setEntryStatus('ok');
    setState((prev) => ({ ...prev, pins: { ...prev.pins, [setupPerson.id]: code } }));
    window.setTimeout(() => {
      setSetupStage('done');
      resetEntry();
    }, 480);
  }, [setupPerson, setupStage, setupFirstPin, state, resetEntry]);

  useEffect(() => {
    if (setupOpen && (setupStage === 'choose' || setupStage === 'confirm')) {
      onCompleteRef.current = handleSetupPin;
    } else if (!setupOpen) {
      onCompleteRef.current = handleClockPin;
    }
  }, [setupOpen, setupStage, handleSetupPin, handleClockPin]);

  const openSetup = useCallback(() => {
    setSetupOpen(true);
    setSetupStage('name');
    setSetupPerson(null);
    setSetupFirstPin('');
    resetEntry();
  }, [resetEntry]);

  const closeSetup = useCallback(() => {
    setSetupOpen(false);
    setSetupStage('name');
    setSetupPerson(null);
    setSetupFirstPin('');
    resetEntry();
  }, [resetEntry]);

  const setupBack = useCallback(() => {
    if (setupStage === 'name') return closeSetup();
    if (setupStage === 'choose') return setSetupStage('name');
    if (setupStage === 'confirm') {
      setSetupFirstPin('');
      resetEntry();
      return setSetupStage('choose');
    }
    closeSetup();
  }, [setupStage, closeSetup, resetEntry]);

  // ── Derived values ──────────────────────────────────────────────
  const time = fmtTime(now);
  const dateLabel = now.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const shiftRows = useMemo(() => {
    const ids = Object.keys(state.shifts).sort(
      (a, b) => state.shifts[a]!.inAt - state.shifts[b]!.inAt
    );
    return ids
      .map((id) => {
        const p = PEOPLE.find((person) => person.id === id);
        if (!p) return null;
        return { person: p, inAt: state.shifts[id]!.inAt };
      })
      .filter((row): row is { person: Person; inAt: number } => row !== null);
  }, [state.shifts]);

  const apps = useMemo(() => quickLaunchApps(), []);

  return (
    <div className="kiosk">
      {/* ── LEFT: brand + clock + on-shift ── */}
      <div className="kiosk__left">
        <div className="kiosk-brandbar">
          <div className="kiosk-wordmark">
            alma <em>home</em>
          </div>
          <div className="kiosk-venue-pill">
            <span className="kiosk-pulse" />
            Avalon · Clock
          </div>
        </div>

        <div className="kiosk-clockwrap">
          <div className="kiosk-greeting">{greetingFor(now)}</div>
          <div className="kiosk-bigtime">
            {time.h}:{time.m}
            <span className="kiosk-bigtime__ap">{time.ap}</span>
          </div>
          <div className="kiosk-datestr">{dateLabel}</div>
        </div>

        <div className="kiosk-onshift">
          <h4>
            On shift now · <span className="kiosk-onshift__count">{shiftRows.length}</span>
          </h4>
          <div className="kiosk-shift-list">
            {shiftRows.length === 0 ? (
              <div className="kiosk-shift-empty">Nobody clocked in yet. Be the first.</div>
            ) : (
              shiftRows.map(({ person, inAt }) => (
                <div key={person.id} className="kiosk-shift-row">
                  <span className="kiosk-avatar">{initials(person.name)}</span>
                  <div className="kiosk-shift-row__who">
                    <div className="kiosk-shift-row__nm">{person.name}</div>
                    <div className="kiosk-shift-row__role">{person.role}</div>
                  </div>
                  <div className="kiosk-shift-row__since">
                    in at<b>{clockStr(inAt)}</b>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="kiosk-hint">
          Demo — try PIN <b>1234</b> (Sofi) or <b>2468</b> (Maximo).{' '}
          New starter: <b>Bea</b> via Set up.
        </div>
      </div>

      {/* ── RIGHT: PIN pad + quick-launch apps ── */}
      <div className="kiosk__right">
        <div className="kiosk-right-head">
          <div className="kiosk-eyebrow">Clock in &amp; out</div>
          <h2>
            Enter your <span className="kiosk-it">PIN.</span>
          </h2>
          <p>Four digits — same to clock in or out.</p>
        </div>

        <PinDots entry={entry} status={entryStatus} />
        <div className={`kiosk-msg${entryStatus === 'err' ? ' is-error' : ''}`}>
          {entryMsg || ' '}
        </div>

        <Keypad onPress={press} />

        <div className="kiosk-right-foot">
          <button type="button" className="kiosk-linkbtn" onClick={openSetup}>
            First shift here? Set up your PIN
            <svg viewBox="0 0 14 6" fill="none" className="kiosk-linkbtn__arr">
              <path d="M0 3 H13 M10 0 L13 3 L10 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Suite-app launcher — present at all times so the kiosk is a
            real home base, not just a clock. Tapping a tile opens that
            app in the same tab; if the user is signed in elsewhere the
            suite handoff token will carry their session over. */}
        <SuiteAppGrid apps={apps} />
      </div>

      {/* ── Confirm overlay ── */}
      {confirm && (
        <ConfirmOverlay
          info={confirm}
          apps={apps}
          onDone={() => setConfirm(null)}
        />
      )}

      {/* ── Setup overlay ── */}
      {setupOpen && (
        <SetupOverlay
          stage={setupStage}
          person={setupPerson}
          entry={entry}
          entryStatus={entryStatus}
          entryMsg={entryMsg}
          onBack={setupBack}
          onPickPerson={(p) => {
            setSetupPerson(p);
            setSetupStage('choose');
            setSetupFirstPin('');
            resetEntry();
          }}
          onPress={press}
          onDone={closeSetup}
          isPersonNew={(p) => !(state.pins[p.id] || p.pin)}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//                          Subcomponents
// ──────────────────────────────────────────────────────────────────

function PinDots({ entry, status }: { entry: string; status: 'idle' | 'err' | 'ok' }) {
  return (
    <div className={`kiosk-dots${status === 'err' ? ' is-err' : ''}${status === 'ok' ? ' is-ok' : ''}`}>
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className={`kiosk-dot${i < entry.length ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}

function Keypad({ onPress }: { onPress: (key: string) => void }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];
  return (
    <div className="kiosk-pad">
      {keys.map((k) => {
        const isUtil = k === 'clear' || k === 'del';
        return (
          <button
            key={k}
            type="button"
            className={`kiosk-key${isUtil ? ' is-util' : ''}`}
            onClick={() => onPress(k)}
            aria-label={k === 'del' ? 'Delete' : k === 'clear' ? 'Clear' : `Number ${k}`}
          >
            {k === 'del' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 5 H8 L2 12 L8 19 H21 V5 Z" />
                <path d="M18 9 L12 15 M12 9 L18 15" />
              </svg>
            ) : k === 'clear' ? (
              'Clear'
            ) : (
              k
            )}
          </button>
        );
      })}
    </div>
  );
}

function SuiteAppGrid({ apps }: { apps: SuiteAppIdentity[] }) {
  if (apps.length === 0) return null;
  return (
    <div className="kiosk-suitegrid">
      <h4 className="kiosk-suitegrid__head">Jump to a suite app</h4>
      <div className="kiosk-suitegrid__row">
        {apps.map((app) => (
          <a
            key={app.id}
            href={app.href}
            className="kiosk-suitegrid__tile"
            aria-label={`Open ${app.label}`}
          >
            <span className="kiosk-suitegrid__mark">
              <AlmaAppIcon
                label={app.label.toUpperCase()}
                colorFrom={app.fromColor}
                colorTo={app.toColor}
                icon={app.icon}
                size={36}
                featureScale={0.68}
                variant="compact"
                showBrandMark={false}
              />
            </span>
            <span className="kiosk-suitegrid__label">{app.shortLabel || app.label}</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function ConfirmOverlay({
  info,
  apps,
  onDone
}: {
  info: ConfirmInfo;
  apps: SuiteAppIdentity[];
  onDone: () => void;
}) {
  const isIn = info.dir === 'in';
  const first = info.person.name.split(' ')[0];
  // Show app launcher tiles when clocking IN so a manager can jump
  // straight to Staff / Reports / etc. without an extra screen.
  const showLauncher = isIn && apps.length > 0;
  return (
    <div className={`kiosk-overlay show ${isIn ? 'tint-in' : 'tint-out'}`}>
      <div className="kiosk-confirm">
        <span className="kiosk-confirm__ava">{initials(info.person.name)}</span>
        <div className="kiosk-confirm__status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="kiosk-confirm__tick">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {isIn ? 'Clocked in' : 'Clocked out'}
        </div>
        <h1>
          {isIn ? 'Welcome, ' : 'See you, '}
          <span className="kiosk-it">{first}.</span>
        </h1>
        <div className="kiosk-confirm__detail">
          {isIn ? (
            <>Clocked <b>in</b> at <b>{clockStr(Date.now())}</b>. Have a good one.</>
          ) : (
            <>
              Clocked <b>out</b> at <b>{clockStr(Date.now())}</b> · <b>{info.worked}</b> on shift today.
            </>
          )}
        </div>

        {showLauncher ? (
          <div className="kiosk-confirm__launcher">
            <div className="kiosk-confirm__launcher-head">Open a suite app</div>
            <div className="kiosk-confirm__launcher-row">
              {apps.slice(0, 6).map((app) => (
                <a
                  key={app.id}
                  href={app.href}
                  className="kiosk-confirm__launcher-tile"
                  aria-label={`Open ${app.label}`}
                >
                  <AlmaAppIcon
                    label={app.label.toUpperCase()}
                    colorFrom={app.fromColor}
                    colorTo={app.toColor}
                    icon={app.icon}
                    size={42}
                    featureScale={0.68}
                    variant="compact"
                    showBrandMark={false}
                  />
                  <span>{app.shortLabel || app.label}</span>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        <button type="button" className="kiosk-done-btn" onClick={onDone}>
          Done
        </button>
        <div className="kiosk-confirm__auto">Returning to the clock…</div>
      </div>
    </div>
  );
}

type SetupOverlayProps = {
  stage: 'name' | 'choose' | 'confirm' | 'done';
  person: Person | null;
  entry: string;
  entryStatus: 'idle' | 'err' | 'ok';
  entryMsg: string;
  onBack: () => void;
  onPickPerson: (person: Person) => void;
  onPress: (key: string) => void;
  onDone: () => void;
  isPersonNew: (person: Person) => boolean;
};

function SetupOverlay(props: SetupOverlayProps) {
  const { stage, person, entry, entryStatus, entryMsg, onBack, onPickPerson, onPress, onDone, isPersonNew } = props;

  let step: string;
  let body: JSX.Element;

  if (stage === 'name') {
    step = 'Step 1 of 3 · Who are you?';
    body = (
      <>
        <div className="kiosk-eyebrow">Set up</div>
        <h2>
          Find <span className="kiosk-it">your name.</span>
        </h2>
        <p>Tap your name to set a 4-digit PIN for clocking in.</p>
        <div className="kiosk-people">
          {PEOPLE.map((p) => (
            <button
              key={p.id}
              type="button"
              className="kiosk-person"
              onClick={() => onPickPerson(p)}
            >
              <span className="kiosk-avatar kiosk-avatar--md">{initials(p.name)}</span>
              <div className="kiosk-person__text">
                <div className="kiosk-person__nm">{p.name}</div>
                <div className="kiosk-person__role">{p.role}</div>
              </div>
              {isPersonNew(p) ? <span className="kiosk-person__new">New</span> : null}
            </button>
          ))}
        </div>
      </>
    );
  } else if (stage === 'choose' || stage === 'confirm') {
    const choosing = stage === 'choose';
    step = `${choosing ? 'Step 2 of 3' : 'Step 3 of 3'} · ${person?.name ?? ''}`;
    body = (
      <>
        <div className="kiosk-eyebrow">{choosing ? 'Choose a PIN' : 'Confirm it'}</div>
        <h2>
          {choosing ? (
            <>
              <span className="kiosk-it">New</span> 4-digit PIN.
            </>
          ) : (
            <>
              Type it <span className="kiosk-it">again.</span>
            </>
          )}
        </h2>
        <p>
          {choosing
            ? "Pick something memorable — you'll use it every shift."
            : "Just to be sure it's right."}
        </p>
        <PinDots entry={entry} status={entryStatus} />
        <div className={`kiosk-msg${entryStatus === 'err' ? ' is-error' : ''}`}>
          {entryMsg || ' '}
        </div>
        <Keypad onPress={onPress} />
      </>
    );
  } else {
    step = 'All set';
    body = (
      <>
        <span className="kiosk-avatar kiosk-avatar--lg">{person ? initials(person.name) : '?'}</span>
        <div className="kiosk-eyebrow" style={{ marginTop: 22 }}>You’re set</div>
        <h2>
          Welcome aboard,
          <br />
          <span className="kiosk-it">{person?.name.split(' ')[0]}.</span>
        </h2>
        <p>Your PIN is ready. Tap below, then clock in whenever your shift starts.</p>
        <button type="button" className="kiosk-done-btn kiosk-done-btn--forest" onClick={onDone}>
          Go to the clock
        </button>
      </>
    );
  }

  return (
    <div className="kiosk-overlay show">
      <div className="kiosk-setup">
        <div className="kiosk-setup__top">
          <button type="button" className="kiosk-setup__back" onClick={onBack}>
            <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
              <path d="M14 5 H1 M4 1 L1 5 L4 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <span className="kiosk-setup__step">{step}</span>
        </div>
        <div className="kiosk-setup__body">{body}</div>
      </div>
    </div>
  );
}
