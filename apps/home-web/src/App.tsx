import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AlmaTask,
  AlmaTaskPriority,
  AlmaTaskSourceApp,
  AlmaTasksPayload,
  AlmaTasksSummary,
  AuthUser,
  DeviceClockedInStaff,
  DeviceStaffListResponse,
  DeviceStaffOption,
  HomeOperationalSummary,
  StaffClockStatusPayload
} from '@alma/shared';
import {
  AlmaAppIcon,
  SUITE_APPS,
  type SuiteAppIdentity
} from '@alma/ui';

/*
 * Alma Home - venue device clock-in kiosk + suite launcher.
 *
 * This page must not carry sample staff or local-only clock state. Staff names,
 * PIN checks, and clock sessions come from the venue-device API, which is
 * scoped to the signed-in venue iPad account.
 */

function normalisePath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

function messageForError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status >= 500) return fallback;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Bearer token captured from a staff PIN login. The same-origin session cookie
// set behind the Firebase→Cloud Run rewrite doesn't reliably carry on the kiosk
// (login 200, then /me/clock 401), so we also send the token the login endpoint
// returns — the auth middleware accepts cookie OR bearer. Cleared on sign-out so
// a shared kiosk never leaks a session.
let homeAuthToken: string | null = null;
function setHomeAuthToken(token: string | null) {
  homeAuthToken = token;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (homeAuthToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${homeAuthToken}`);
  }

  const response = await fetch(normalisePath(path), {
    credentials: 'include',
    ...init,
    headers
  });

  if (!response.ok) {
    let message = response.statusText || 'Request failed';
    try {
      const data = await response.json();
      if (typeof data?.message === 'string') message = data.message;
      if (typeof data?.error === 'string') message = data.error;
    } catch {
      // Keep the HTTP status text if the API did not return JSON.
    }
    throw new ApiRequestError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
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

function clockStr(value: string | number | Date): string {
  const { h, m, ap } = fmtTime(new Date(value));
  return `${h}:${m} ${ap}`;
}

function durSince(value: string | number | Date): string {
  const ms = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m < 10 ? `0${m}` : m}m`;
}

function displayName(user: Pick<AuthUser, 'firstName' | 'lastName' | 'email'> | null | undefined) {
  if (!user) return '';
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email || '';
}

function isVenueDeviceUser(user: AuthUser | null) {
  return Boolean(user && (user.accountType === 'VENUE_DEVICE' || user.deviceAccount));
}

function quickLaunchApps(): SuiteAppIdentity[] {
  return SUITE_APPS.filter((app) =>
    app.status === 'active' &&
    Boolean(app.href) &&
    app.id !== 'settings'
  );
}

function staffPinHref() {
  const staffHref = SUITE_APPS.find((app) => app.id === 'staff')?.href || 'https://alma-staff.web.app';
  return `${staffHref.replace(/\/+$/, '')}/pin`;
}

function routeFromLocation(pathname = window.location.pathname) {
  const path = pathname.replace(/\/+$/, '');
  return path || '/';
}

function staffOptionFromUser(user: AuthUser): DeviceStaffOption {
  return {
    id: user.id,
    name: displayName(user),
    roleTitle: user.roleTitle || 'Staff',
    venue: user.venue,
    email: null,
    hasPin: true
  };
}

type ConfirmInfo = {
  staffName: string;
  dir: 'in' | 'out' | 'login';
  worked?: string;
  at: number;
};

type AppOpenHandler = (event: MouseEvent<HTMLAnchorElement>, app: SuiteAppIdentity) => void;

export function App() {
  const [routePath, setRoutePath] = useState(() => routeFromLocation());
  const isVenueDeviceRoute = routePath === '/ipad' || routePath === '/venue';
  const isPinSetupRoute = !isVenueDeviceRoute && routePath === '/set-pin';
  const [now, setNow] = useState<Date>(() => new Date());
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('alma.kiosk.theme') === 'dark' ? 'dark' : 'light'
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('alma.kiosk.theme', theme);
    } catch {
      /* private mode — fine, just don't persist */
    }
  }, [theme]);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [payload, setPayload] = useState<DeviceStaffListResponse | null>(null);
  const [homeSummary, setHomeSummary] = useState<HomeOperationalSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [almaTasks, setAlmaTasks] = useState<AlmaTask[] | null>(null);
  const [almaTasksSummary, setAlmaTasksSummary] = useState<AlmaTasksSummary | null>(null);
  const [almaTasksActioningId, setAlmaTasksActioningId] = useState<string | null>(null);
  const [humanClock, setHumanClock] = useState<StaffClockStatusPayload | null>(null);
  const [selected, setSelected] = useState<DeviceStaffOption | null>(null);
  const [entry, setEntry] = useState('');
  const [entryStatus, setEntryStatus] = useState<'idle' | 'err' | 'ok'>('idle');
  const [entryMsg, setEntryMsg] = useState('');
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signInEmail, setSignInEmail] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupStatus, setSetupStatus] = useState<'idle' | 'err' | 'ok'>('idle');
  const [setupMsg, setSetupMsg] = useState('');
  const [confirm, setConfirm] = useState<ConfirmInfo | null>(null);

  const apps = useMemo(() => quickLaunchApps(), []);
  const pinSetupHref = useMemo(() => staffPinHref(), []);
  const deviceReady = isVenueDeviceRoute && isVenueDeviceUser(user);

  const navigateHome = useCallback((path: string) => {
    const next = path.replace(/\/+$/, '') || '/';
    window.history.pushState(null, '', next);
    setRoutePath(next);
    window.scrollTo({ top: 0 });
  }, []);

  const handleLocalNav = useCallback((event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    navigateHome(path);
  }, [navigateHome]);

  useEffect(() => {
    const onPopState = () => setRoutePath(routeFromLocation());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadHomeSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setHomeSummary(await api<HomeOperationalSummary>('/api/device/home-summary'));
    } catch {
      setHomeSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // AlmaTasks (strategy doc #15) — visible on Home for signed-in staff
  // so they see what's outstanding before they tap into Stock / Comms /
  // wherever. Top 6 outstanding, refreshed alongside home summary.
  const loadAlmaTasks = useCallback(async () => {
    try {
      const [list, sum] = await Promise.all([
        api<AlmaTasksPayload>('/api/tasks?outstanding=true'),
        api<AlmaTasksSummary>('/api/tasks/summary')
      ]);
      setAlmaTasks(list.tasks.slice(0, 6));
      setAlmaTasksSummary(sum);
    } catch {
      // 401/403 expected when not signed in as HUMAN; render nothing.
      setAlmaTasks(null);
      setAlmaTasksSummary(null);
    }
  }, []);

  const completeAlmaTask = useCallback(
    async (task: AlmaTask, kind: 'complete' | 'dismiss') => {
      if (almaTasksActioningId) return;
      setAlmaTasksActioningId(task.id);
      const prev = almaTasks;
      setAlmaTasks((current) => (current ? current.filter((t) => t.id !== task.id) : current));
      try {
        await api<AlmaTask>(`/api/tasks/${task.id}/${kind}`, { method: 'POST' });
        await loadAlmaTasks();
      } catch {
        // Rollback on failure — keep the row so the staff can retry.
        setAlmaTasks(prev);
      } finally {
        setAlmaTasksActioningId(null);
      }
    },
    [almaTasks, almaTasksActioningId, loadAlmaTasks]
  );

  const loadHomeState = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await api<{ user: AuthUser | null }>('/api/auth/me');
      const authUser = auth.user ?? null;
      setUser(authUser);
      if (isVenueDeviceRoute && isVenueDeviceUser(authUser)) {
        setHumanClock(null);
        const data = await api<DeviceStaffListResponse>('/api/device/staff');
        setPayload(data);
        setSelected((current) => {
          if (!current) return null;
          return data.staff.some((staff) => staff.id === current.id) ? current : null;
        });
      } else {
        setPayload(null);
        if (authUser?.accountType === 'HUMAN' && !isPinSetupRoute) {
          const staff = staffOptionFromUser(authUser);
          const clock = await api<StaffClockStatusPayload>('/api/staff/me/clock');
          setSelected(staff);
          setHumanClock(clock);
        } else if (isVenueDeviceRoute) {
          setHumanClock(null);
          setSelected(null);
        } else {
          setHumanClock(null);
          setSelected(null);
        }
      }
    } catch (error) {
      setPayload(null);
      setHumanClock(null);
      if (!isVenueDeviceRoute) setSelected(null);
      if (error instanceof ApiRequestError && error.status === 401) {
        setEntryStatus('idle');
        setEntryMsg('');
      } else {
        setEntryStatus('err');
        setEntryMsg(messageForError(error, 'Could not reach Alma device API.'));
      }
    } finally {
      setLoading(false);
    }
  }, [isPinSetupRoute, isVenueDeviceRoute]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    void loadHomeState();
  }, [loadHomeState]);

  useEffect(() => {
    void loadHomeSummary();
    const id = window.setInterval(() => {
      void loadHomeSummary();
    }, 60000);
    return () => window.clearInterval(id);
  }, [loadHomeSummary]);

  // Tasks only render for a signed-in HUMAN (not VENUE_DEVICE accounts).
  // Refresh whenever the user changes (sign-in / switch staff / sign-out).
  useEffect(() => {
    if (!user || user.accountType !== 'HUMAN') {
      setAlmaTasks(null);
      setAlmaTasksSummary(null);
      return;
    }
    void loadAlmaTasks();
    const id = window.setInterval(() => {
      void loadAlmaTasks();
    }, 60000);
    return () => window.clearInterval(id);
  }, [loadAlmaTasks, user]);

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

  async function signInDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setEntryStatus('idle');
    setEntryMsg('');
    try {
      const result = await api<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: signInEmail, password: signInPassword })
      });
      if (result.user.accountType !== 'VENUE_DEVICE') {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        throw new Error('Sign in with a venue device account for Alma Home.');
      }
      setSignInPassword('');
      await loadHomeState();
    } catch (error) {
      setEntryStatus('err');
      setEntryMsg(messageForError(error, 'Could not sign in this device.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitPinSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setSetupStatus('idle');
    setSetupMsg('');

    if (!/^\d{4,6}$/.test(setupPin)) {
      setBusy(false);
      setSetupStatus('err');
      setSetupMsg('PIN must be 4 to 6 digits.');
      return;
    }
    if (setupPin !== setupConfirm) {
      setBusy(false);
      setSetupStatus('err');
      setSetupMsg('PIN confirmation does not match.');
      return;
    }

    let loggedIn = false;
    try {
      const result = await api<{ user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: setupEmail, password: setupPassword })
      });
      loggedIn = true;

      if (result.user.accountType === 'VENUE_DEVICE') {
        throw new Error('Use your own staff email and password to set a personal PIN.');
      }

      await api('/api/staff/me/pin', {
        method: 'POST',
        // Pass the password as proof so the server lets us set a new PIN even
        // when one already exists (we have no current PIN to supply here).
        body: JSON.stringify({ newPin: setupPin, password: setupPassword })
      });

      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      loggedIn = false;

      setSetupEmail('');
      setSetupPassword('');
      setSetupPin('');
      setSetupConfirm('');
      setSetupStatus('ok');
      setSetupMsg('');
      setEntryStatus('idle');
      setEntryMsg('PIN set. Enter it to sign in.');
      navigateHome('/');
    } catch (error) {
      if (loggedIn) {
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      }
      setSetupStatus('err');
      setSetupMsg(messageForError(error, 'Could not set this PIN.'));
    } finally {
      setBusy(false);
    }
  }

  async function signOutSession() {
    setBusy(true);
    try {
      await api('/api/device/pin-logout', { method: 'POST' }).catch(() => undefined);
      await api('/api/auth/logout', { method: 'POST' });
      setHomeAuthToken(null);
      setUser(null);
      setPayload(null);
      setHumanClock(null);
      setSelected(null);
      resetEntry();
    } finally {
      setBusy(false);
    }
  }

  const selectedOpenSession = useMemo(() => {
    if (!selected) return null;
    if (isVenueDeviceRoute) {
      return payload?.clockedIn.find((row) => row.staffProfileId === selected.id) ?? null;
    }
    return humanClock?.activeSession?.staffProfileId === selected.id ? humanClock.activeSession : null;
  }, [humanClock?.activeSession, isVenueDeviceRoute, payload?.clockedIn, selected]);
  const selectedCanUsePin = Boolean(selected?.hasPin);

  const submitPin = useCallback(async () => {
    if (entry.length < 4 || entry.length > 6 || busy) return;
    if (isVenueDeviceRoute && !selected) {
      setEntryStatus('err');
      setEntryMsg('Select a staff profile first.');
      return;
    }
    if (isVenueDeviceRoute && !selected?.hasPin) {
      setEntryStatus('err');
      setEntryMsg('Set your Device PIN in Alma Staff on your phone first.');
      return;
    }

    setBusy(true);
    setLocked(true);
    setEntryStatus('idle');
    setEntryMsg('');

    try {
      if (isVenueDeviceRoute) {
        const selectedStaff = selected;
        if (!selectedStaff) throw new Error('Select a staff profile first.');
        await api<{ user: AuthUser }>('/api/device/pin-login', {
          method: 'POST',
          body: JSON.stringify({ staffProfileId: selectedStaff.id, pin: entry })
        });

        const clock = await api<StaffClockStatusPayload>('/api/staff/me/clock');
        if (clock.activeSession) {
          const worked = durSince(clock.activeSession.clockInAt);
          await api('/api/staff/me/clock/out', { method: 'POST', body: JSON.stringify({}) });
          setConfirm({ staffName: selectedStaff.name, dir: 'out', worked, at: Date.now() });
        } else {
          await api('/api/staff/me/clock/in', { method: 'POST', body: JSON.stringify({}) });
          setConfirm({ staffName: selectedStaff.name, dir: 'in', at: Date.now() });
        }
      } else {
        const result = await api<{ user: AuthUser; token?: string }>('/api/device/staff-pin-login', {
          method: 'POST',
          body: JSON.stringify({ pin: entry })
        });
        setHomeAuthToken(result.token ?? null);
        const staff = staffOptionFromUser(result.user);
        const clock = await api<StaffClockStatusPayload>('/api/staff/me/clock');
        setUser(result.user);
        setSelected(staff);
        // Don't auto clock the person in/out — the PIN is also used just to land
        // on the launcher and switch between apps. Show their current status and
        // a Clock in / Clock out button on the signed-in panel so they choose
        // when to clock.
        setHumanClock(clock);
      }

      setEntryStatus('ok');
    } catch (error) {
      setEntryStatus('err');
      setEntryMsg(messageForError(error, 'PIN login failed.'));
    } finally {
      if (isVenueDeviceRoute) {
        await api('/api/device/pin-logout', { method: 'POST' }).catch(() => undefined);
      }
      await loadHomeState();
      await loadHomeSummary();
      setBusy(false);
      window.setTimeout(resetEntry, 700);
    }
  }, [busy, entry, isVenueDeviceRoute, loadHomeState, loadHomeSummary, resetEntry, selected]);

  const toggleSignedInClock = useCallback(async () => {
    if (!user || user.accountType !== 'HUMAN' || busy) return;
    setBusy(true);
    setEntryStatus('idle');
    setEntryMsg('');
    try {
      const clock = humanClock ?? await api<StaffClockStatusPayload>('/api/staff/me/clock');
      const staffName = displayName(user);
      if (clock.activeSession) {
        const worked = durSince(clock.activeSession.clockInAt);
        await api('/api/staff/me/clock/out', { method: 'POST', body: JSON.stringify({}) });
        setConfirm({ staffName, dir: 'out', worked, at: Date.now() });
      } else {
        await api('/api/staff/me/clock/in', { method: 'POST', body: JSON.stringify({}) });
        setConfirm({ staffName, dir: 'in', at: Date.now() });
      }
      setHumanClock(await api<StaffClockStatusPayload>('/api/staff/me/clock'));
      await loadHomeSummary();
    } catch (error) {
      setEntryStatus('err');
      setEntryMsg(messageForError(error, 'Could not update your clock status.'));
    } finally {
      setBusy(false);
    }
  }, [busy, humanClock, loadHomeSummary, user]);

  const press = useCallback((key: string) => {
    if (locked || busy) return;
    if (key === 'del') {
      setEntry((prev) => prev.slice(0, -1));
      return;
    }
    if (key === 'clear') {
      setEntry('');
      setEntryStatus('idle');
      setEntryMsg('');
      return;
    }
    if (!/^\d$/.test(key)) return;
    setEntry((prev) => (prev.length >= 6 ? prev : `${prev}${key}`));
  }, [busy, locked]);

  const openSuiteApp = useCallback<AppOpenHandler>(async (event, app) => {
    if (!user || !app.href) return;
    event.preventDefault();
    try {
      const data = await api<{ token: string }>('/api/auth/handoff', { method: 'POST' });
      const url = new URL(app.href, window.location.origin);
      url.searchParams.set('suite_token', data.token);
      url.searchParams.set('suite_from', window.location.origin);
      window.location.href = url.toString();
    } catch {
      window.location.href = app.href;
    }
  }, [user]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const pinEntryReady = isVenueDeviceRoute ? deviceReady : !isPinSetupRoute;
      if (!pinEntryReady) return;
      if (event.key >= '0' && event.key <= '9') press(event.key);
      else if (event.key === 'Backspace') press('del');
      else if (event.key === 'Escape') press('clear');
      else if (event.key === 'Enter') void submitPin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deviceReady, isPinSetupRoute, isVenueDeviceRoute, press, submitPin]);

  useEffect(() => {
    const pinEntryReady = isVenueDeviceRoute ? deviceReady : !isPinSetupRoute;
    const canSubmitPin = isVenueDeviceRoute ? selectedCanUsePin : true;
    if (!pinEntryReady || !canSubmitPin || busy || locked || entry.length < 4 || entry.length > 6) return;
    const id = window.setTimeout(() => {
      void submitPin();
    }, entry.length === 6 ? 120 : 850);
    return () => window.clearTimeout(id);
  }, [
    busy,
    deviceReady,
    entry,
    isPinSetupRoute,
    isVenueDeviceRoute,
    locked,
    selectedCanUsePin,
    submitPin
  ]);

  const time = fmtTime(now);
  const dateLabel = now.toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  });
  const shiftRows = payload?.clockedIn ?? [];
  const venueLabel = payload?.venue ?? user?.venue ?? 'Venue';
  const actionLabel = selectedOpenSession ? 'Clock out' : 'Clock in';
  const staffRows = isVenueDeviceRoute ? payload?.staff ?? [] : [];
  const signedInHuman = !isVenueDeviceRoute && user?.accountType === 'HUMAN' ? user : null;
  const keypadEnabled = isVenueDeviceRoute ? selectedCanUsePin : true;
  const statusMessage =
    entryMsg ||
    (selected
      ? isVenueDeviceRoute
        ? `${actionLabel} for ${selected.name}`
        : 'Enter your staff PIN.'
      : isVenueDeviceRoute
        ? 'Select a staff profile first.'
        : 'Enter your staff PIN.');

  return (
    <div className="kiosk">
      <button
        type="button"
        className="kiosk-theme-toggle"
        onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        {theme === 'dark' ? '☀' : '☾'}
      </button>
      <div className="kiosk__left">
        <div className="kiosk-brandbar">
          <div className="kiosk-wordmark" aria-label="Alma Group Home">
            <img src="/images/alma-group-logo.png" alt="Alma Group" className="kiosk-wordmark__logo" />
            <span>home</span>
          </div>
          <div className="kiosk-venue-pill">
            <span className="kiosk-pulse" />
            {isVenueDeviceRoute ? (deviceReady ? `${venueLabel} · Clock` : 'Venue device') : 'Staff PIN'}
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

        {isVenueDeviceRoute ? (
          <div className="kiosk-onshift">
            <h4>
              On shift now · <span className="kiosk-onshift__count">{shiftRows.length}</span>
            </h4>
            <div className="kiosk-shift-list">
              {loading ? (
                <div className="kiosk-shift-empty">Loading current clock sessions...</div>
              ) : shiftRows.length === 0 ? (
                <div className="kiosk-shift-empty">No open clock sessions for this venue.</div>
              ) : (
                shiftRows.map((row) => (
                  <ShiftRow key={row.sessionId} row={row} />
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="kiosk-summary-desktop">
            <HomeSummaryPanel summary={homeSummary} loading={summaryLoading} />
          </div>
        )}
      </div>

      <div className="kiosk__right">
        {isVenueDeviceRoute && !deviceReady ? (
          <DeviceSignInPanel
            email={signInEmail}
            password={signInPassword}
            busy={busy}
            error={entryStatus === 'err' ? entryMsg : ''}
            onEmail={setSignInEmail}
            onPassword={setSignInPassword}
            onSubmit={signInDevice}
            apps={apps}
            pinSetupHref={pinSetupHref}
            onOpenApp={openSuiteApp}
          />
        ) : isPinSetupRoute ? (
          <PinSetupPanel
            email={setupEmail}
            password={setupPassword}
            pin={setupPin}
            confirmPin={setupConfirm}
            busy={busy}
            status={setupStatus}
            message={setupMsg}
            onEmail={setSetupEmail}
            onPassword={setSetupPassword}
            onPin={setSetupPin}
            onConfirmPin={setSetupConfirm}
            onSubmit={submitPinSetup}
            onBack={() => navigateHome('/')}
          />
        ) : signedInHuman ? (
          <HumanWelcomePanel
            user={signedInHuman}
            clock={humanClock}
            apps={apps}
            busy={busy}
            error={entryStatus === 'err' ? entryMsg : ''}
            onClockToggle={toggleSignedInClock}
            onOpenApp={openSuiteApp}
            onRefresh={() => {
              void loadHomeState();
              void loadHomeSummary();
              void loadAlmaTasks();
            }}
            onSwitchStaff={() => {
              void signOutSession().then(() => navigateHome('/'));
            }}
            onSignOut={() => void signOutSession()}
            tasksPanel={
              <AlmaTasksPanel
                tasks={almaTasks}
                summary={almaTasksSummary}
                actioningId={almaTasksActioningId}
                onComplete={(task) => void completeAlmaTask(task, 'complete')}
                onDismiss={(task) => void completeAlmaTask(task, 'dismiss')}
              />
            }
          />
        ) : (
          <>
            <div className="kiosk-right-head">
              <div className="kiosk-eyebrow">{isVenueDeviceRoute ? 'Clock in & out' : 'Staff PIN login'}</div>
              <h2>
                {isVenueDeviceRoute ? 'Select staff, then enter ' : 'Enter your '}
                <span className="kiosk-it">PIN.</span>
              </h2>
              <p>
                {isVenueDeviceRoute
                  ? user?.deviceAccount
                    ? `Using ${displayName(user)} on ${user.deviceAccount.name}.`
                    : `${venueLabel} device signed in.`
                  : 'Your PIN signs you in — then clock in or out, or jump straight to an app.'}
              </p>
            </div>

            {signedInHuman ? (
              <div className="kiosk-session-strip">
                Signed in as <b>{displayName(signedInHuman)}</b>
              </div>
            ) : null}

            {isVenueDeviceRoute ? (
              <StaffPicker
                staff={staffRows}
                selected={selected}
                onSelect={(staff) => {
                  setSelected(staff);
                  setEntry('');
                  setLocked(false);
                  if (staff.hasPin) {
                    setEntryStatus('idle');
                    setEntryMsg('');
                  } else {
                    setEntryStatus('err');
                    setEntryMsg('Set your Device PIN in Alma Staff on your phone first.');
                  }
                }}
                loading={loading}
              />
            ) : null}

            <PinDots entry={entry} status={entryStatus} />
            <div className={`kiosk-msg${entryStatus === 'err' ? ' is-error' : ''}`}>
              {statusMessage}
            </div>
            {!isVenueDeviceRoute ? (
              <a className="kiosk-phone-code" href="/set-pin" onClick={(event) => handleLocalNav(event, '/set-pin')}>
                Don't have your PIN yet? Click here
              </a>
            ) : null}

            <Keypad onPress={press} disabled={!keypadEnabled || busy} />
            <div className="kiosk-auto-submit-note">
              {keypadEnabled ? 'PIN submits automatically.' : 'Choose a staff profile with a PIN.'}
            </div>

            {!isVenueDeviceRoute ? (
              <div className="kiosk-summary-mobile">
                <HomeSummaryPanel summary={homeSummary} loading={summaryLoading} />
              </div>
            ) : null}

            <div className="kiosk-right-foot">
              <button
                type="button"
                className="kiosk-linkbtn"
                onClick={() => {
                  void loadHomeState();
                  void loadHomeSummary();
                }}
                disabled={busy}
              >
                {isVenueDeviceRoute ? 'Refresh staff' : 'Refresh'}
              </button>
              {!isVenueDeviceRoute ? (
                <a className="kiosk-linkbtn kiosk-linkbtn--anchor" href="/ipad">
                  Login venue device
                </a>
              ) : null}
              {user ? (
                <button type="button" className="kiosk-linkbtn" onClick={() => void signOutSession()} disabled={busy}>
                  {isVenueDeviceRoute ? 'Sign out device' : 'Sign out'}
                </button>
              ) : null}
            </div>

            {(isVenueDeviceRoute || signedInHuman) ? <SuiteAppGrid apps={apps} onOpenApp={user ? openSuiteApp : undefined} /> : null}
          </>
        )}
      </div>

      {confirm ? (
        <ConfirmOverlay
          info={confirm}
          apps={apps}
          onOpenApp={user ? openSuiteApp : undefined}
          onDone={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function ShiftRow({ row }: { row: DeviceClockedInStaff }) {
  return (
    <div className="kiosk-shift-row">
      <span className="kiosk-avatar">{initials(row.name)}</span>
      <div className="kiosk-shift-row__who">
        <div className="kiosk-shift-row__nm">{row.name}</div>
        <div className="kiosk-shift-row__role">{row.roleTitle || row.venue || 'Staff'}</div>
      </div>
      <div className="kiosk-shift-row__since">
        in at<b>{clockStr(row.clockInAt)}</b>
      </div>
    </div>
  );
}

function compactCount(value: number) {
  if (value < 1000) return `${value}`;
  return new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function HomeSummaryPanel({
  summary,
  loading
}: {
  summary: HomeOperationalSummary | null;
  loading: boolean;
}) {
  const next = summary?.bookings.next ?? null;
  const scheduledMarketing = (summary?.marketing.scheduledCampaigns ?? 0) + (summary?.marketing.scheduledPosts ?? 0);

  return (
    <div className="kiosk-ops">
      <h4>Today at Alma</h4>
      {loading ? (
        <div className="kiosk-shift-empty">Loading live venue context...</div>
      ) : summary ? (
        <>
          <div className="kiosk-ops__grid">
            <div className="kiosk-ops__stat">
              <span>Bookings</span>
              <strong>{summary.bookings.today}</strong>
              <em>{summary.bookings.coversToday} covers today</em>
            </div>
            <div className="kiosk-ops__stat">
              <span>Upcoming</span>
              <strong>{summary.bookings.upcoming}</strong>
              <em>{next ? `${clockStr(next.startsAt)} · ${next.venue ?? 'Venue'}` : 'No next booking'}</em>
            </div>
            <div className="kiosk-ops__stat">
              <span>Team</span>
              <strong>{summary.staff.clockedInNow}</strong>
              <em>{summary.staff.rosteredToday} rostered today</em>
            </div>
            <div className="kiosk-ops__stat">
              <span>Marketing</span>
              <strong>{compactCount(summary.marketing.optedInContacts)}</strong>
              <em>{scheduledMarketing} scheduled</em>
            </div>
          </div>
          {next ? (
            <div className="kiosk-ops__next">
              Next booking is {next.covers} cover{next.covers === 1 ? '' : 's'} at <b>{clockStr(next.startsAt)}</b>.
            </div>
          ) : null}
        </>
      ) : (
        <div className="kiosk-shift-empty">Live venue context will appear here once the summary API is available.</div>
      )}
    </div>
  );
}

const ALMA_TASK_SOURCE_LABEL: Record<AlmaTaskSourceApp, string> = {
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

const ALMA_TASK_PRIORITY_ORDER: AlmaTaskPriority[] = ['CRITICAL', 'TODAY', 'THIS_WEEK', 'LOW'];

const ALMA_TASK_PRIORITY_LABEL: Record<AlmaTaskPriority, string> = {
  CRITICAL: 'Critical',
  TODAY: 'Today',
  THIS_WEEK: 'This week',
  LOW: 'Backlog'
};

function AlmaTasksPanel({
  tasks,
  summary,
  actioningId,
  onComplete,
  onDismiss
}: {
  tasks: AlmaTask[] | null;
  summary: AlmaTasksSummary | null;
  actioningId: string | null;
  onComplete: (task: AlmaTask) => void;
  onDismiss: (task: AlmaTask) => void;
}) {
  // Hide the panel entirely when there's no signal (not signed in, or
  // the API isn't reachable). Don't dilute the Home view with empty
  // "no tasks" chatter — when there's nothing to do, say nothing.
  if (!tasks || tasks.length === 0) return null;

  const total = summary?.outstandingTotal ?? tasks.length;
  const remaining = Math.max(0, total - tasks.length);

  return (
    <div className="kiosk-tasks">
      <div className="kiosk-tasks__head">
        <h4>Your tasks</h4>
        <span className="kiosk-tasks__total">{total} outstanding</span>
      </div>
      {summary ? (
        <div className="kiosk-tasks__chips">
          {ALMA_TASK_PRIORITY_ORDER.filter((p) => summary.byPriority[p] > 0).map((p) => (
            <span key={p} className={`kiosk-tasks__chip is-${p.toLowerCase()}`}>
              <b>{summary.byPriority[p]}</b>
              <em>{ALMA_TASK_PRIORITY_LABEL[p]}</em>
            </span>
          ))}
        </div>
      ) : null}
      <ul className="kiosk-tasks__list">
        {tasks.map((task) => (
          <li key={task.id} className="kiosk-tasks__row">
            <div className="kiosk-tasks__rowtext">
              <div className="kiosk-tasks__rowmeta">
                <span className="kiosk-tasks__source">{ALMA_TASK_SOURCE_LABEL[task.sourceApp]}</span>
                {task.priority === 'CRITICAL' ? <span className="kiosk-tasks__crit">Critical</span> : null}
              </div>
              <strong>{task.title}</strong>
              {task.description ? <p>{task.description}</p> : null}
            </div>
            <div className="kiosk-tasks__rowactions">
              <button
                type="button"
                className="kiosk-tasks__btn kiosk-tasks__btn--dismiss"
                disabled={actioningId === task.id}
                onClick={() => onDismiss(task)}
                aria-label={`Dismiss ${task.title}`}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="kiosk-tasks__btn kiosk-tasks__btn--done"
                disabled={actioningId === task.id}
                onClick={() => onComplete(task)}
                aria-label={`Complete ${task.title}`}
              >
                ✓ Done
              </button>
            </div>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <div className="kiosk-tasks__more">{remaining} more — open Alma to see the full list.</div>
      ) : null}
    </div>
  );
}

function HumanWelcomePanel({
  user,
  clock,
  apps,
  busy,
  error,
  onClockToggle,
  onOpenApp,
  onRefresh,
  onSwitchStaff,
  onSignOut,
  tasksPanel
}: {
  user: AuthUser;
  clock: StaffClockStatusPayload | null;
  apps: SuiteAppIdentity[];
  busy: boolean;
  error: string;
  onClockToggle: () => void;
  onOpenApp: AppOpenHandler;
  onRefresh: () => void;
  onSwitchStaff: () => void;
  onSignOut: () => void;
  tasksPanel?: React.ReactNode;
}) {
  const name = displayName(user);
  const first = user.firstName || name.split(' ')[0] || 'there';
  const activeSession = clock?.activeSession ?? null;
  const nextShift = clock?.currentShift ?? clock?.nextShift ?? null;
  const clockLabel = activeSession ? 'Clock out' : 'Clock in';
  const status = activeSession
    ? `Clocked in at ${clockStr(activeSession.clockInAt)}${activeSession.venue ? ` · ${activeSession.venue}` : ''}`
    : nextShift
      ? `Next shift ${clockStr(nextShift.startsAt)}${nextShift.area ? ` · ${nextShift.area}` : ''}`
      : 'Ready when you are.';

  return (
    <>
      <div className="kiosk-right-head">
        <div className="kiosk-eyebrow">Alma Home</div>
        <h2>
          Welcome, <span className="kiosk-it">{first}.</span>
        </h2>
        <p>Open the app you need — and clock in or out below whenever you want.</p>
      </div>

      <div className={`kiosk-welcome-card${activeSession ? ' is-clocked-in' : ''}`}>
        <div className="kiosk-welcome-card__top">
          <span className="kiosk-avatar kiosk-avatar--welcome">{initials(name)}</span>
          <div className="kiosk-welcome-card__text">
            <div className="kiosk-welcome-card__label">{activeSession ? 'On shift' : 'Signed in'}</div>
            <strong>{name}</strong>
            <span>{user.roleTitle || user.venue || 'Staff'}</span>
          </div>
        </div>
        <div className="kiosk-clock-status">
          <span>{status}</span>
          {activeSession ? <b>{durSince(activeSession.clockInAt)} on shift</b> : null}
        </div>
        {error ? <div className="kiosk-msg is-error">{error}</div> : null}
        <button type="button" className="kiosk-clock-btn kiosk-clock-btn--wide" onClick={onClockToggle} disabled={busy}>
          {busy ? 'Updating...' : clockLabel}
        </button>
      </div>

      {tasksPanel}

      <SuiteAppGrid apps={apps} onOpenApp={onOpenApp} />

      <div className="kiosk-right-foot">
        <button type="button" className="kiosk-linkbtn" onClick={onRefresh} disabled={busy}>
          Refresh
        </button>
        <button type="button" className="kiosk-linkbtn" onClick={onSwitchStaff} disabled={busy}>
          Use another PIN
        </button>
        <button type="button" className="kiosk-linkbtn" onClick={onSignOut} disabled={busy}>
          Sign out
        </button>
      </div>
    </>
  );
}

function DeviceSignInPanel({
  email,
  password,
  busy,
  error,
  onEmail,
  onPassword,
  onSubmit,
  apps,
  pinSetupHref,
  onOpenApp
}: {
  email: string;
  password: string;
  busy: boolean;
  error: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  apps: SuiteAppIdentity[];
  pinSetupHref: string;
  onOpenApp?: AppOpenHandler;
}) {
  return (
    <>
      <div className="kiosk-right-head">
        <div className="kiosk-eyebrow">Venue device sign in</div>
        <h2>
          Use a real <span className="kiosk-it">device account.</span>
        </h2>
        <p>Sign in this device once. Staff then use their own PIN from Alma Staff on their phone.</p>
      </div>

      <form className="kiosk-auth-form" onSubmit={onSubmit}>
        <label className="kiosk-auth-field">
          <span>Email</span>
          <input
            value={email}
            onChange={(event) => onEmail(event.currentTarget.value)}
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="kiosk-auth-field">
          <span>Password</span>
          <input
            value={password}
            onChange={(event) => onPassword(event.currentTarget.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <div className="kiosk-msg is-error">{error}</div> : null}
        <button type="submit" className="kiosk-clock-btn" disabled={busy}>
          {busy ? 'Signing in...' : 'Sign in device'}
        </button>
      </form>
      <a className="kiosk-phone-code" href={pinSetupHref}>
        Staff PIN setup opens in Alma Staff
      </a>

      <SuiteAppGrid apps={apps} onOpenApp={onOpenApp} />
    </>
  );
}

function PinSetupPanel({
  email,
  password,
  pin,
  confirmPin,
  busy,
  status,
  message,
  onEmail,
  onPassword,
  onPin,
  onConfirmPin,
  onSubmit,
  onBack
}: {
  email: string;
  password: string;
  pin: string;
  confirmPin: string;
  busy: boolean;
  status: 'idle' | 'err' | 'ok';
  message: string;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onPin: (value: string) => void;
  onConfirmPin: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="kiosk-setup__top">
        <button type="button" className="kiosk-setup__back" onClick={onBack}>
          Back to PIN
        </button>
        <div className="kiosk-setup__step">PIN setup</div>
      </div>
      <div className="kiosk-right-head kiosk-right-head--spaced">
        <div className="kiosk-eyebrow">Don't have your PIN?</div>
        <h2>
          Set it with your <span className="kiosk-it">password.</span>
        </h2>
        <p>Use your staff email and password once. This browser signs you out again after the PIN is saved.</p>
      </div>

      <form className="kiosk-auth-form" onSubmit={onSubmit}>
        <label className="kiosk-auth-field">
          <span>Email</span>
          <input
            value={email}
            onChange={(event) => onEmail(event.currentTarget.value)}
            type="email"
            autoComplete="username"
            required
          />
        </label>
        <label className="kiosk-auth-field">
          <span>Password</span>
          <input
            value={password}
            onChange={(event) => onPassword(event.currentTarget.value)}
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label className="kiosk-auth-field">
          <span>New PIN</span>
          <input
            value={pin}
            onChange={(event) => onPin(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            placeholder="4 to 6 digits"
            required
          />
        </label>
        <label className="kiosk-auth-field">
          <span>Confirm PIN</span>
          <input
            value={confirmPin}
            onChange={(event) => onConfirmPin(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            type="password"
            autoComplete="new-password"
            placeholder="Repeat PIN"
            required
          />
        </label>
        {message ? <div className={`kiosk-msg${status === 'err' ? ' is-error' : ''}`}>{message}</div> : null}
        <button type="submit" className="kiosk-clock-btn" disabled={busy || pin.length < 4 || confirmPin.length < 4}>
          {busy ? 'Setting PIN...' : 'Set PIN'}
        </button>
      </form>
    </>
  );
}

function StaffPicker({
  staff,
  selected,
  onSelect,
  loading,
  loadingLabel = 'Loading venue staff...',
  emptyLabel = 'No active staff assigned to this venue device.',
  ariaLabel = 'Venue staff'
}: {
  staff: DeviceStaffOption[];
  selected: DeviceStaffOption | null;
  onSelect: (staff: DeviceStaffOption) => void;
  loading: boolean;
  loadingLabel?: string;
  emptyLabel?: string;
  ariaLabel?: string;
}) {
  if (loading) {
    return <div className="kiosk-staff-empty">{loadingLabel}</div>;
  }
  if (staff.length === 0) {
    return <div className="kiosk-staff-empty">{emptyLabel}</div>;
  }
  return (
    <div className="kiosk-people" aria-label={ariaLabel}>
      {staff.map((member) => (
        <button
          key={member.id}
          type="button"
          className={`kiosk-person${selected?.id === member.id ? ' is-selected' : ''}${!member.hasPin ? ' is-pin-missing' : ''}`}
          onClick={() => onSelect(member)}
        >
          <span className="kiosk-avatar kiosk-avatar--md">{initials(member.name)}</span>
          <div className="kiosk-person__text">
            <div className="kiosk-person__nm">{member.name}</div>
            <div className="kiosk-person__role">{member.roleTitle || member.venue || 'Staff'}</div>
          </div>
          {!member.hasPin ? <span className="kiosk-person__new">No PIN</span> : null}
        </button>
      ))}
    </div>
  );
}

function PinDots({ entry, status }: { entry: string; status: 'idle' | 'err' | 'ok' }) {
  return (
    <div className={`kiosk-dots${status === 'err' ? ' is-err' : ''}${status === 'ok' ? ' is-ok' : ''}`}>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <span key={index} className={`kiosk-dot${index < entry.length ? ' is-on' : ''}`} />
      ))}
    </div>
  );
}

function Keypad({ onPress, disabled = false }: { onPress: (key: string) => void; disabled?: boolean }) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'];
  return (
    <div className="kiosk-pad">
      {keys.map((key) => {
        const isUtil = key === 'clear' || key === 'del';
        return (
          <button
            key={key}
            type="button"
            className={`kiosk-key${isUtil ? ' is-util' : ''}`}
            onClick={() => onPress(key)}
            aria-label={key === 'del' ? 'Delete' : key === 'clear' ? 'Clear' : `Number ${key}`}
            disabled={disabled}
          >
            {key === 'del' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 5 H8 L2 12 L8 19 H21 V5 Z" />
                <path d="M18 9 L12 15 M12 9 L18 15" />
              </svg>
            ) : key === 'clear' ? (
              'Clear'
            ) : (
              key
            )}
          </button>
        );
      })}
    </div>
  );
}

function SuiteAppGrid({ apps, onOpenApp }: { apps: SuiteAppIdentity[]; onOpenApp?: AppOpenHandler }) {
  if (apps.length === 0) return null;
  return (
    <div className="kiosk-suitegrid">
      <h4 className="kiosk-suitegrid__head">Jump to a suite app</h4>
      <div className="kiosk-suitegrid__row">
        {apps.map((app) => (
          <a
            key={app.id}
            href={app.href ?? '#'}
            onClick={onOpenApp ? (event) => onOpenApp(event, app) : undefined}
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
  onOpenApp,
  onDone
}: {
  info: ConfirmInfo;
  apps: SuiteAppIdentity[];
  onOpenApp?: AppOpenHandler;
  onDone: () => void;
}) {
  const isIn = info.dir === 'in';
  const isLogin = info.dir === 'login';
  const first = info.staffName.split(' ')[0] || 'there';
  return (
    <div className={`kiosk-overlay show ${isIn || isLogin ? 'tint-in' : 'tint-out'}`}>
      <div className="kiosk-confirm">
        <span className="kiosk-confirm__ava">{initials(info.staffName)}</span>
        <div className="kiosk-confirm__status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="kiosk-confirm__tick">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {isLogin ? 'Signed in' : isIn ? 'Clocked in' : 'Clocked out'}
        </div>
        <h1>
          {isLogin || isIn ? 'Welcome, ' : 'See you, '}
          <span className="kiosk-it">{first}.</span>
        </h1>
        <div className="kiosk-confirm__detail">
          {isLogin ? (
            <>Signed in with your <b>Device PIN</b>.</>
          ) : isIn ? (
            <>Clocked <b>in</b> at <b>{clockStr(info.at)}</b>.</>
          ) : (
            <>
              Clocked <b>out</b> at <b>{clockStr(info.at)}</b> · <b>{info.worked}</b> on shift today.
            </>
          )}
        </div>

        {(isIn || isLogin) && apps.length > 0 ? (
          <div className="kiosk-confirm__launcher">
            <div className="kiosk-confirm__launcher-head">Open a suite app</div>
            <div className="kiosk-confirm__launcher-row">
              {apps.slice(0, 6).map((app) => (
                <a
                  key={app.id}
                  href={app.href ?? '#'}
                  onClick={onOpenApp ? (event) => onOpenApp(event, app) : undefined}
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
        <div className="kiosk-confirm__auto">Returning to the clock...</div>
      </div>
    </div>
  );
}
