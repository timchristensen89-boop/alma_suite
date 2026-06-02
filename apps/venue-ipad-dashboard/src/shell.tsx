// Shared layout shell + auxiliary types for every iPad page.
//
// Extracted from App.tsx so page modules under src/pages/ can render the
// same chrome (sidebar nav, topbar, AuthChip) without re-implementing it.

import { Link } from 'react-router-dom';
import { AuthChip, useAuth } from './auth';

export type Venue = {
  id: 'st-alma' | 'alma-avalon';
  name: string;
  subtitle: string;
  manager: string;
  serviceStatus: string;
  openTasks: number;
  bookingsToday: number;
  checklistProgress: number;
  lowStock: number;
};

export type Auth = ReturnType<typeof useAuth>;

export type PinIntent = {
  intent: string;
  targetRoute?: string;
} | null;

export type RequirePin = (intent: PinIntent) => void;

export type PageShellProps = {
  auth: Auth;
  onRequestStaffPin: () => void;
  onSwitchStaff: () => void;
  requirePin: RequirePin;
};

export const ALMA_HOME_URL = '/apps';

export function AppShell({
  venue,
  auth,
  onRequestStaffPin,
  onSwitchStaff,
  children
}: {
  venue?: Venue | null;
  auth: Auth;
  onRequestStaffPin: () => void;
  onSwitchStaff: () => void;
  children: React.ReactNode;
}) {
  const deviceName = auth.device?.deviceAccount?.name ?? auth.device?.firstName ?? 'Venue iPad';
  const deviceVenue = auth.device?.deviceAccount?.venue ?? auth.venueLabel ?? auth.device?.venue ?? null;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/venue" className="brand-link" aria-label="Venue iPad home">
          <span className="brand-mark">A</span>
          <span>
            <strong>Alma Venue</strong>
            <small>iPad ops</small>
          </span>
        </Link>

        <nav className="side-nav" aria-label="Venue navigation">
          <Link to={ALMA_HOME_URL}>Alma Home</Link>
          <Link to="/venue">Venue Home</Link>
          {venue ? (
            <>
              <Link to={`/venue/${venue.id}`}>{venue.name}</Link>
              <Link to={`/venue/${venue.id}/gift-cards`}>Gift cards</Link>
              <Link to={`/venue/${venue.id}/stocktake`}>Stocktake</Link>
              <Link to={`/venue/${venue.id}/bookings`}>Bookings</Link>
              <Link to={`/venue/${venue.id}/checklists`}>Checklists</Link>
              <Link to={`/venue/${venue.id}/handover`}>Handover</Link>
              <Link to={`/venue/${venue.id}/roster`}>Roster</Link>
              <Link to={`/venue/${venue.id}/tasks`}>Tasks</Link>
              <Link to={`/venue/${venue.id}/help`}>Help &amp; fallback</Link>
            </>
          ) : null}
        </nav>

        <details className="settings-panel">
          <summary>Device</summary>
          <div className="settings-body">
            <p>
              <strong>{deviceName}</strong>
              {deviceVenue ? <small> · {deviceVenue}</small> : null}
            </p>
            <p>
              {auth.staff ? (
                <>
                  Signed in as <strong>{auth.staff.name}</strong>
                </>
              ) : (
                <>No staff signed in</>
              )}
            </p>
            <button
              type="button"
              className="button secondary settings-signout"
              onClick={() => void auth.signOutDevice()}
            >
              Sign out device
            </button>
          </div>
        </details>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">Venue iPad</p>
            <h1>{venue ? venue.name : 'Select venue'}</h1>
          </div>
          <div className="topbar-actions">
            <AuthChip
              staff={auth.staff}
              onSignIn={onRequestStaffPin}
              onSwitch={onSwitchStaff}
            />
            <Link className="button secondary" to={ALMA_HOME_URL}>
              Alma Home
            </Link>
            <Link className="button" to={venue ? `/venue/${venue.id}` : '/venue'}>
              Venue Home
            </Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
