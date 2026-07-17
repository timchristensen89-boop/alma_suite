// Venue iPad auth: device account + staff PIN, persistent staff session.
//
// Unlike home-web's clock kiosk (which auto-logs-out 700ms after every PIN),
// the ops console keeps the staff session alive until the user taps "Switch"
// or the device signs out. That's intentional — Gift Card Redeem, Stocktake,
// Checklist sign-off, and Handover posts all need a continuous staff identity.
//
// Auth shape:
//   - device: VENUE_DEVICE account, set by the email/password sign-in form.
//             Persists across page reloads via the auth cookie.
//   - staff:  the human currently using the iPad, set by PIN. Cleared when
//             "Switch" or "Sign out device" is tapped. Read-only tiles work
//             without staff; action tiles require it.

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthUser, DeviceStaffOption, DeviceStaffListResponse } from '@alma/shared';
import { api, ApiRequestError, messageForError } from './api';

export type AuthState = {
  device: AuthUser | null;
  staff: DeviceStaffOption | null;
  staffUser: AuthUser | null;
  staffList: DeviceStaffOption[];
  venueLabel: string | null;
  loading: boolean;
};

export type AuthActions = {
  signInDevice: (email: string, password: string) => Promise<void>;
  signOutDevice: () => Promise<void>;
  signInStaffWithPin: (staffProfileId: string, pin: string) => Promise<void>;
  signOutStaff: () => Promise<void>;
  refresh: () => Promise<void>;
};

const EMPTY: AuthState = {
  device: null,
  staff: null,
  staffUser: null,
  staffList: [],
  venueLabel: null,
  loading: true
};

function isDeviceUser(user: AuthUser | null): boolean {
  return Boolean(user && (user.accountType === 'VENUE_DEVICE' || user.deviceAccount));
}

export function useAuth(): AuthState & AuthActions {
  const [state, setState] = useState<AuthState>(EMPTY);

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    try {
      const me = await api<{ user: AuthUser | null }>('/api/auth/me');
      const meUser = me.user ?? null;

      if (isDeviceUser(meUser)) {
        const list = await api<DeviceStaffListResponse>('/api/device/staff');
        const activeStaff = list.activeUser;
        const activeOption =
          activeStaff != null
            ? list.staff.find((s) => s.id === activeStaff.id) ?? {
                id: activeStaff.id,
                name: `${activeStaff.firstName} ${activeStaff.lastName}`.trim() || activeStaff.email || 'Staff',
                roleTitle: activeStaff.roleTitle || 'Staff',
                venue: activeStaff.venue,
                email: activeStaff.email,
                hasPin: true
              }
            : null;
        setState({
          device: meUser,
          staff: activeOption,
          staffUser: activeStaff,
          staffList: list.staff,
          venueLabel: list.venue,
          loading: false
        });
      } else if (meUser) {
        // Someone signed in as a non-device account. The iPad ops console
        // requires a VENUE_DEVICE account — sign them out and force re-login.
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        setState({ ...EMPTY, loading: false });
      } else {
        setState({ ...EMPTY, loading: false });
      }
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 401) {
        setState({ ...EMPTY, loading: false });
        return;
      }
      setState((prev) => ({ ...prev, loading: false }));
      throw error;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signInDevice = useCallback(async (email: string, password: string) => {
    const result = await api<{ user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!isDeviceUser(result.user)) {
      await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
      throw new Error('Sign in with a venue device account for the iPad ops console.');
    }
    await refresh();
  }, [refresh]);

  const signOutDevice = useCallback(async () => {
    await api('/api/device/pin-logout', { method: 'POST' }).catch(() => undefined);
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState({ ...EMPTY, loading: false });
  }, []);

  const signInStaffWithPin = useCallback(async (staffProfileId: string, pin: string) => {
    await api<{ user: AuthUser }>('/api/device/pin-login', {
      method: 'POST',
      body: JSON.stringify({ staffProfileId, pin })
    });
    // Persistent: do NOT immediately pin-logout (that's the clock kiosk behavior).
    await refresh();
  }, [refresh]);

  const signOutStaff = useCallback(async () => {
    await api('/api/device/pin-logout', { method: 'POST' }).catch(() => undefined);
    setState((prev) => ({ ...prev, staff: null, staffUser: null }));
  }, []);

  return useMemo(
    () => ({
      ...state,
      signInDevice,
      signOutDevice,
      signInStaffWithPin,
      signOutStaff,
      refresh
    }),
    [refresh, signInDevice, signInStaffWithPin, signOutDevice, signOutStaff, state]
  );
}

// ----------------------------------------------------------------------
// DeviceSignIn — full-page sign-in for the iPad device account
// ----------------------------------------------------------------------

export function DeviceSignIn({
  onSignIn
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSignIn(email, password);
    } catch (e) {
      setError(messageForError(e, 'Could not sign in this device.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-signin">
      <div className="device-signin-card">
        <p className="eyebrow">Alma Venue iPad</p>
        <h1>Sign in this device</h1>
        <p className="device-signin-blurb">
          Enter the venue device account for this iPad. Staff sign in with their PIN once the
          device is set up.
        </p>
        <form onSubmit={handleSubmit} className="device-signin-form">
          <label>
            <span>Device email</span>
            <input
              type="email"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          {error ? <p className="device-signin-error">{error}</p> : null}
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in venue iPad'}
          </button>
        </form>
        <p className="device-signin-foot">
          The device account is created in Alma Admin → Venue Devices. Ask the venue manager if
          you don't have credentials.
        </p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// StaffPinPrompt — modal overlay shown when a tile needs staff PIN
// ----------------------------------------------------------------------

export function StaffPinPrompt({
  staffList,
  onClose,
  onSubmit,
  onRefresh,
  intent
}: {
  staffList: DeviceStaffOption[];
  onClose: () => void;
  onSubmit: (staffProfileId: string, pin: string) => Promise<void>;
  onRefresh?: () => Promise<void>;
  intent?: string;
}) {
  const [selected, setSelected] = useState<DeviceStaffOption | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const canSubmit = Boolean(selected?.hasPin) && pin.length >= 4 && pin.length <= 6 && !busy;

  const submit = useCallback(async () => {
    if (!selected || !canSubmit) return;
    setBusy(true);
    setError('');
    try {
      await onSubmit(selected.id, pin);
      onClose();
    } catch (e) {
      setError(messageForError(e, 'PIN login failed.'));
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [canSubmit, onClose, onSubmit, pin, selected]);

  const press = useCallback(
    (key: string) => {
      if (busy) return;
      if (key === 'del') {
        setPin((prev) => prev.slice(0, -1));
        return;
      }
      if (key === 'clear') {
        setPin('');
        return;
      }
      if (!/^\d$/.test(key)) return;
      setPin((prev) => (prev.length >= 6 ? prev : `${prev}${key}`));
    },
    [busy]
  );

  // Auto-submit at 6 digits
  useEffect(() => {
    if (pin.length === 6 && selected?.hasPin && !busy) {
      void submit();
    }
  }, [busy, pin, selected, submit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key >= '0' && event.key <= '9') press(event.key);
      else if (event.key === 'Backspace') press('del');
      else if (event.key === 'Escape') onClose();
      else if (event.key === 'Enter') void submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, press, submit]);

  return (
    <div className="pin-modal-backdrop" onClick={onClose}>
      <div className="pin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pin-modal-head">
          <div>
            <p className="eyebrow">{intent ?? 'Staff sign-in'}</p>
            <h2>{selected ? `Enter PIN for ${selected.name}` : 'Who is using the iPad?'}</h2>
          </div>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
        </div>

        {!selected ? (
          <div className="pin-staff-grid">
            {staffList.length === 0 ? (
              <div className="pin-empty">
                <p>
                  No staff have set a Device PIN yet. Each staff member sets their PIN in Alma
                  Staff on their phone — this usually takes 1–2 minutes to sync.
                </p>
                {onRefresh ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={refreshing}
                    onClick={async () => {
                      setRefreshing(true);
                      try {
                        await onRefresh();
                      } finally {
                        setRefreshing(false);
                      }
                    }}
                  >
                    {refreshing ? 'Refreshing…' : 'Refresh staff list'}
                  </button>
                ) : null}
              </div>
            ) : (
              staffList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`pin-staff-card${s.hasPin ? '' : ' disabled'}`}
                  onClick={() => s.hasPin && setSelected(s)}
                  disabled={!s.hasPin}
                >
                  <strong>{s.name}</strong>
                  <span>{s.roleTitle}</span>
                  {!s.hasPin ? <span className="pin-staff-hint">PIN not set</span> : null}
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="pin-entry">
            <div className="pin-dots">
              {Array.from({ length: 6 }).map((_, i) => (
                <span key={i} className={`pin-dot${i < pin.length ? ' filled' : ''}`} />
              ))}
            </div>
            {error ? <p className="device-signin-error">{error}</p> : null}
            <div className="pin-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del'].map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`pin-key${key === 'clear' || key === 'del' ? ' pin-key-action' : ''}`}
                  onClick={() => press(key)}
                  disabled={busy}
                >
                  {key === 'del' ? '⌫' : key === 'clear' ? 'Clear' : key}
                </button>
              ))}
            </div>
            <div className="pin-entry-foot">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setSelected(null);
                  setPin('');
                  setError('');
                }}
                disabled={busy}
              >
                Back to staff list
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {busy ? 'Checking…' : 'Sign in'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------
// AuthChip — TopBar element showing current staff or "Tap to sign in"
// ----------------------------------------------------------------------

export function AuthChip({
  staff,
  onSignIn,
  onSwitch
}: {
  staff: DeviceStaffOption | null;
  onSignIn: () => void;
  onSwitch: () => void;
}) {
  if (!staff) {
    return (
      <button type="button" className="auth-chip auth-chip-unsigned" onClick={onSignIn}>
        <span className="auth-chip-eyebrow">No staff signed in</span>
        <strong>Tap to sign in</strong>
      </button>
    );
  }

  return (
    <button type="button" className="auth-chip auth-chip-signed" onClick={onSwitch}>
      <span className="auth-chip-eyebrow">Signed in</span>
      <strong>{staff.name}</strong>
      <span className="auth-chip-switch">Switch →</span>
    </button>
  );
}
