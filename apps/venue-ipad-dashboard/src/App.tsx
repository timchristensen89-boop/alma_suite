import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { AlmaTasksSummary } from '@alma/shared';
import { api } from './api';
import { DeviceSignIn, StaffPinPrompt, useAuth } from './auth';
import {
  AppShell,
  type Auth,
  type PageShellProps,
  type PinIntent,
  type RequirePin,
  type Venue
} from './shell';
import { GiftCardRedeemPage } from './pages/GiftCardRedeemPage';
import { StocktakePage } from './pages/StocktakePage';
import { TasksPage } from './pages/TasksPage';

type LiveSnapshot = {
  venue: string | null;
  generatedAt: string;
  bookings: { today: number; coversToday: number };
  checklists: { active: number };
  temperatures: { outOfRangeSensors: number };
  compliance: { openIssues: number; criticalIssues: number };
};

const VENUE_NAMES: Record<string, string> = {
  'st-alma': 'St Alma',
  'alma-avalon': 'Alma Avalon'
};

// Polls /api/tasks/summary so the Tasks tile shows a real outstanding
// count for any signed-in staff. Returns null silently on 401/403 so
// device-only sessions (no staff PIN yet) don't error — the tile then
// falls back to the venue's mock count.
function useTaskSummary(authed: boolean) {
  const [summary, setSummary] = useState<AlmaTasksSummary | null>(null);

  useEffect(() => {
    if (!authed) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await api<AlmaTasksSummary>('/api/tasks/summary');
        if (!cancelled) setSummary(data);
      } catch {
        if (!cancelled) setSummary(null);
      }
    };
    void tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [authed]);

  return summary;
}

function useVenueSnapshot(venueId: string | undefined) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!venueId) return;
    const venueName = VENUE_NAMES[venueId] ?? '';
    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const path = `/api/public/venue-snapshot${venueName ? `?venue=${encodeURIComponent(venueName)}` : ''}`;
        setSnapshot(await api<LiveSnapshot>(path));
      } catch {
        /* silent — iPad shows last-known values */
      } finally {
        setLoading(false);
      }
    };
    void fetchSnapshot();
    // Refresh every 60 seconds for an always-on display
    const id = window.setInterval(fetchSnapshot, 60_000);
    return () => window.clearInterval(id);
  }, [venueId]);

  return { snapshot, loading };
}

type PermissionKey =
  | 'checklists.run'
  | 'giftCards.sell'
  | 'tasks.update'
  | 'bookings.view'
  | 'stocktake.run'
  | 'handover.post'
  | 'roster.view'
  | 'help.view'
  | 'settings.view';

type TileStatus = 'live' | 'pilot' | 'preview';

type DashboardTool = {
  id: string;
  title: string;
  description: string;
  route: string;
  permission: PermissionKey;
  count?: number;
  tone?: 'neutral' | 'warning' | 'positive';
  status?: TileStatus;
};

// Which permissions need an authenticated staff PIN (vs. just a signed-in
// device account). Read-only tiles work for any staff at the venue; actions
// need the individual staff identity for audit + ownership.
const PERMISSION_REQUIRES_STAFF: Record<PermissionKey, boolean> = {
  'checklists.run': true,
  'giftCards.sell': true,
  'tasks.update': true,
  'handover.post': true,
  'stocktake.run': true,
  'bookings.view': false,
  'roster.view': false,
  'help.view': false,
  'settings.view': true
};

const venues: Venue[] = [
  {
    id: 'st-alma',
    name: 'St Alma',
    subtitle: 'Dining room, bar, kitchen and floor checks',
    manager: 'Venue Manager',
    serviceStatus: 'Dinner setup',
    openTasks: 7,
    bookingsToday: 86,
    checklistProgress: 62,
    lowStock: 5
  },
  {
    id: 'alma-avalon',
    name: 'Alma Avalon',
    subtitle: 'Beach venue operations and service controls',
    manager: 'Venue Manager',
    serviceStatus: 'Lunch service',
    openTasks: 4,
    bookingsToday: 54,
    checklistProgress: 78,
    lowStock: 3
  }
];

function venueById(venueId?: string) {
  return venues.find((venue) => venue.id === venueId) ?? null;
}

function toolsForVenue(venue: Venue, taskSummary: AlmaTasksSummary | null = null): DashboardTool[] {
  return [
    {
      id: 'gift-cards',
      title: 'Gift cards',
      description: 'Scan a code, check balance, redeem against a bill.',
      route: `/venue/${venue.id}/gift-cards`,
      permission: 'giftCards.sell',
      tone: 'neutral',
      status: 'pilot'
    },
    {
      id: 'stocktake',
      title: 'Stocktake',
      description: 'Count by area, save drafts. Manager submits.',
      route: `/venue/${venue.id}/stocktake`,
      permission: 'stocktake.run',
      count: venue.lowStock,
      tone: venue.lowStock > 0 ? 'warning' : 'neutral',
      status: 'pilot'
    },
    {
      id: 'bookings',
      title: 'Bookings',
      description: "Today's diary and upcoming covers.",
      route: `/venue/${venue.id}/bookings`,
      permission: 'bookings.view',
      count: venue.bookingsToday,
      tone: 'positive',
      status: 'preview'
    },
    {
      id: 'checklists',
      title: 'Checklists',
      description: 'Opening, closing, bar, kitchen and service checks.',
      route: `/venue/${venue.id}/checklists`,
      permission: 'checklists.run',
      count: venue.checklistProgress,
      tone: venue.checklistProgress >= 75 ? 'positive' : 'warning',
      status: 'preview'
    },
    {
      id: 'handover',
      title: 'Handover',
      description: 'Current shift notes and post a new handover.',
      route: `/venue/${venue.id}/handover`,
      permission: 'handover.post',
      tone: 'neutral',
      status: 'preview'
    },
    {
      id: 'roster',
      title: 'Roster',
      description: "Who's on now and the rest of the day.",
      route: `/venue/${venue.id}/roster`,
      permission: 'roster.view',
      tone: 'neutral',
      status: 'preview'
    },
    {
      id: 'tasks',
      title: 'Tasks',
      description: 'Open jobs across every app — count, fix, follow up.',
      route: `/venue/${venue.id}/tasks`,
      permission: 'tasks.update',
      count: taskSummary?.outstandingTotal ?? venue.openTasks,
      tone:
        (taskSummary?.byPriority.CRITICAL ?? 0) > 0
          ? 'warning'
          : (taskSummary?.outstandingTotal ?? venue.openTasks) > 5
            ? 'warning'
            : 'neutral',
      status: 'pilot'
    },
    {
      id: 'help',
      title: 'Help & fallback',
      description: 'What to do when an app fails during service.',
      route: `/venue/${venue.id}/help`,
      permission: 'help.view',
      tone: 'neutral',
      status: 'preview'
    }
  ];
}

// A tile is "usable now" if the device is signed in AND, if the permission
// needs staff, a staff PIN is active. Settings is always device-only and
// surfaces via Admin, not the iPad — so it's blocked here.
function canUseNow(permission: PermissionKey, auth: Auth) {
  if (!auth.device) return false;
  if (permission === 'settings.view') return false;
  if (PERMISSION_REQUIRES_STAFF[permission] && !auth.staff) return false;
  return true;
}

// A tile is "lockable" — visible but needs staff PIN — when device is in
// but staff isn't yet. Clicking opens the PIN modal.
function isStaffLocked(permission: PermissionKey, auth: Auth) {
  return Boolean(auth.device) && PERMISSION_REQUIRES_STAFF[permission] && !auth.staff;
}

function VenueSelectPage({ auth, onRequestStaffPin, onSwitchStaff }: PageShellProps) {
  return (
    <AppShell auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="hero-panel">
          <p className="eyebrow">Shared operations</p>
          <h2>Choose a venue dashboard</h2>
          <p>Large tap targets for shared iPads, mock data for now, and clean routes ready to merge into Alma Suite.</p>
        </div>

        <div className="venue-grid">
          {venues.map((venue) => (
            <Link key={venue.id} to={`/venue/${venue.id}`} className="venue-card">
              <span>
                <strong>{venue.name}</strong>
                <small>{venue.subtitle}</small>
              </span>
              <span className="venue-status">{venue.serviceStatus}</span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function VenueHomePage({ auth, onRequestStaffPin, onSwitchStaff, requirePin }: PageShellProps) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  const { snapshot } = useVenueSnapshot(venueId);
  const taskSummary = useTaskSummary(Boolean(auth.staff));
  if (!venue) return <Navigate to="/venue" replace />;

  const tools = toolsForVenue(venue, taskSummary);
  const liveBookings = snapshot?.bookings.today ?? venue.bookingsToday;
  const liveCovers = snapshot?.bookings.coversToday;
  const liveChecklists = snapshot?.checklists.active;
  const tempAlerts = snapshot?.temperatures.outOfRangeSensors ?? 0;
  const openIssues = snapshot?.compliance.openIssues ?? venue.openTasks;
  const criticalIssues = snapshot?.compliance.criticalIssues ?? 0;
  const lastUpdated = snapshot ? new Date(snapshot.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <AppShell
      venue={venue}
      auth={auth}
      onRequestStaffPin={onRequestStaffPin}
      onSwitchStaff={onSwitchStaff}
    >
      <section className="page-stack">
        {/* Live operational snapshot — refreshed every 60 seconds */}
        <div className="ipad-live-panels">
          <div className={`ipad-live-panel is-${liveBookings > 0 ? 'positive' : 'neutral'}`}>
            <span className="ipad-live-eyebrow">Today's bookings</span>
            <strong className="ipad-live-value">{liveBookings}</strong>
            <span className="ipad-live-detail">{liveCovers !== undefined ? `${liveCovers} covers` : 'No covers data'}</span>
          </div>
          <div className={`ipad-live-panel is-${liveChecklists !== undefined && liveChecklists > 0 ? 'warning' : 'positive'}`}>
            <span className="ipad-live-eyebrow">Active checklists</span>
            <strong className="ipad-live-value">{liveChecklists ?? '—'}</strong>
            <span className="ipad-live-detail">{venue.checklistProgress}% progress overall</span>
          </div>
          <div className={`ipad-live-panel is-${tempAlerts > 0 ? 'danger' : 'positive'}`}>
            <span className="ipad-live-eyebrow">Temp alerts</span>
            <strong className="ipad-live-value">{tempAlerts}</strong>
            <span className="ipad-live-detail">{tempAlerts === 0 ? 'All sensors in range' : `${tempAlerts} sensor${tempAlerts === 1 ? '' : 's'} out of range`}</span>
          </div>
          <div className={`ipad-live-panel is-${criticalIssues > 0 ? 'danger' : openIssues > 0 ? 'warning' : 'positive'}`}>
            <span className="ipad-live-eyebrow">Open issues</span>
            <strong className="ipad-live-value">{openIssues}</strong>
            <span className="ipad-live-detail">{criticalIssues > 0 ? `${criticalIssues} critical / overdue` : 'No critical issues'}</span>
          </div>
        </div>
        {lastUpdated ? (
          <p className="ipad-live-updated">Live data · last refreshed {lastUpdated}</p>
        ) : null}

        <div className="stats-grid">
          <Metric label="Service" value={venue.serviceStatus} />
          <Metric label="Bookings" value={String(liveBookings)} />
          <Metric label="Open tasks" value={String(openIssues)} tone={openIssues > 5 ? 'warning' : 'neutral'} />
          <Metric label="Checklist progress" value={`${venue.checklistProgress}%`} tone={venue.checklistProgress >= 75 ? 'positive' : 'warning'} />
        </div>

        <section className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">Tools</p>
              <h2>Venue controls</h2>
            </div>
            <p>{venue.manager}</p>
          </div>

          <div className="tool-grid">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} auth={auth} requirePin={requirePin} />
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function ToolCard({
  tool,
  auth,
  requirePin
}: {
  tool: DashboardTool;
  auth: Auth;
  requirePin: RequirePin;
}) {
  const usable = canUseNow(tool.permission, auth);
  const locked = isStaffLocked(tool.permission, auth);
  const tone = tool.tone ?? 'neutral';
  const statusClass = tool.status === 'preview' ? ' is-preview' : tool.status === 'pilot' ? ' is-pilot' : '';

  // Permanently disabled (e.g. settings.view, or device not signed in — though
  // the latter is handled at App level by DeviceSignIn).
  if (!usable && !locked) {
    return (
      <article className="tool-card disabled">
        <strong>{tool.title}</strong>
        <p>{tool.description}</p>
        <span className="permission-chip">Not available on iPad</span>
      </article>
    );
  }

  const body = (
    <span className="tool-card-body">
      <strong>{tool.title}</strong>
      <p>{tool.description}</p>
      <span className="tool-card-chips">
        {tool.status && tool.status !== 'live' ? (
          <span className={`status-chip status-chip-${tool.status}`}>
            {tool.status === 'preview' ? 'Preview' : 'Pilot'}
          </span>
        ) : null}
        {locked ? <span className="status-chip status-chip-locked">PIN required</span> : null}
      </span>
    </span>
  );

  const count = tool.count !== undefined ? <span className="tool-count">{tool.count}</span> : null;

  // Locked: no staff PIN. Render as a button that opens the PIN modal; on
  // success the App-level handler navigates to the tile's route.
  if (locked) {
    return (
      <button
        type="button"
        className={`tool-card ${tone} is-locked${statusClass}`}
        onClick={() => requirePin({ intent: `Open ${tool.title}`, targetRoute: tool.route })}
      >
        {body}
        {count}
      </button>
    );
  }

  // Usable: device + (if needed) staff are signed in. Link navigates.
  return (
    <Link to={tool.route} className={`tool-card ${tone}${statusClass}`}>
      {body}
      {count}
    </Link>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'warning' | 'positive' }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PreviewBanner({ note }: { note: string }) {
  return (
    <div className="preview-panel">
      <p className="preview-eyebrow">Preview</p>
      <p>{note}</p>
    </div>
  );
}

function FallbackSteps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <section className="section-block">
      <div className="section-header">
        <div>
          <p className="eyebrow">Today's fallback</p>
          <h2>{title}</h2>
        </div>
      </div>
      <ol className="fallback-steps">
        {steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

function VenueToolPage({
  kind,
  auth,
  onRequestStaffPin,
  onSwitchStaff
}: {
  kind: 'checklists' | 'bookings';
} & Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  const page = toolPageContent[kind];

  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>{page.title}</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>Back to venue</Link>
          </div>
          <p className="section-copy">{page.description}</p>
        </div>

        <div className="action-grid">
          {page.actions.map((action) => (
            <button key={action.title} type="button" className="tap-action">
              <strong>{action.title}</strong>
              <span>{action.detail}</span>
            </button>
          ))}
        </div>

        <section className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">Mock data</p>
              <h2>{page.listTitle}</h2>
            </div>
          </div>
          <div className="data-list">
            {page.rows.map((row) => (
              <article key={row.title} className="data-row">
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                <span className={`status-pill ${row.tone}`}>{row.status}</span>
              </article>
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

const toolPageContent = {
  checklists: {
    title: 'Checklists',
    description: 'Run venue checks with large tap targets. These are mock checklist surfaces ready for Alma Compliance integration.',
    actions: [
      { title: 'Start opening check', detail: 'Floor, bar and venue readiness' },
      { title: 'Start closing check', detail: 'End of service handover' },
      { title: 'Log failed item', detail: 'Create a manager follow-up' }
    ],
    listTitle: 'Today checks',
    rows: [
      { title: 'Opening floor check', detail: '12 of 16 items complete', status: 'In progress', tone: 'warning' as const },
      { title: 'Kitchen close', detail: 'Assigned to kitchen lead', status: 'Not started', tone: 'neutral' as const },
      { title: 'Bar setup', detail: 'Completed 10:22 AM', status: 'Done', tone: 'positive' as const }
    ]
  },
  bookings: {
    title: 'Bookings',
    description: 'Read-only booking flow for service awareness. Live booking integrations can be added later.',
    actions: [
      { title: 'View next hour', detail: 'Upcoming arrivals' },
      { title: 'Add service note', detail: 'Mock handover note' },
      { title: 'Flag VIP', detail: 'Placeholder action' }
    ],
    listTitle: 'Today bookings',
    rows: [
      { title: '6:00 PM wave', detail: '28 covers', status: 'Ready', tone: 'positive' as const },
      { title: '7:30 PM wave', detail: '42 covers', status: 'Busy', tone: 'warning' as const },
      { title: 'Late tables', detail: '16 covers', status: 'Open', tone: 'neutral' as const }
    ]
  }
} satisfies Record<string, {
  title: string;
  description: string;
  actions: Array<{ title: string; detail: string }>;
  listTitle: string;
  rows: Array<{ title: string; detail: string; status: string; tone: 'neutral' | 'warning' | 'positive' }>;
}>;

function HandoverPage({ auth, onRequestStaffPin, onSwitchStaff }: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Handover</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            Current shift notes and a place to post a new handover for the next shift. Stock issues,
            staff issues, guest issues, maintenance and tomorrow's prep all live here.
          </p>
        </div>
        <PreviewBanner note="The Handover model and post-a-note flow are being built next. For now, use the fallback below." />
        <FallbackSteps
          title="How to handover right now"
          steps={[
            'Post the handover in the venue Slack channel.',
            'If service-critical, also message the next shift manager directly.',
            'Cover stock, staff, guests, maintenance and tomorrow.'
          ]}
        />
      </section>
    </AppShell>
  );
}

function RosterPage({ auth, onRequestStaffPin, onSwitchStaff }: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Roster</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            Who's on now and the rest of the day's shifts. Read-only on the venue iPad — manager
            changes happen in Alma Staff.
          </p>
        </div>
        <PreviewBanner note="The roster API is being wired into the iPad next. Today, check Deputy or the printed sheet." />
        <FallbackSteps
          title="Where to find the roster right now"
          steps={[
            'Check Deputy on the office terminal.',
            'The printed roster is on the office wall.',
            'If neither is available, message the venue manager.'
          ]}
        />
      </section>
    </AppShell>
  );
}

const APP_FALLBACKS: Array<{ app: string; steps: string[] }> = [
  {
    app: 'Gift cards',
    steps: [
      'Write down the gift card code and the amount being redeemed.',
      'Photograph the back of the card.',
      'Charge as cash equivalent on Square so service is not blocked.',
      'Hand the note to the manager to reconcile after service.'
    ]
  },
  {
    app: 'Stocktake',
    steps: [
      'Use the paper count sheet in the office.',
      'Photograph each completed count area.',
      'Hand the sheets to the manager for entry once the system is back.'
    ]
  },
  {
    app: 'Bookings',
    steps: [
      'Use SevenRooms until the Alma cutover is complete.',
      'For walk-ins, write on the floor plan and reconcile after service.'
    ]
  },
  {
    app: 'Checklists',
    steps: [
      'Use the paper checklist on the office clipboard.',
      'Sign and date each one.',
      'Hand to the manager to upload once the system is back.'
    ]
  },
  {
    app: 'Roster',
    steps: [
      'Check Deputy on the office terminal until the cutover is complete.',
      'The printed roster lives on the office wall.'
    ]
  },
  {
    app: 'Clock in / out',
    steps: [
      'Use the wall iPad clock kiosk at the staff entry.',
      'If both fail, write your start and end times on the paper sheet by the office.',
      'Notify the manager so payroll is correct.'
    ]
  },
  {
    app: 'Anything else',
    steps: ['Call the venue manager on shift.', 'In a genuine emergency, call the venue mobile.']
  }
];

function HelpFallbackPage({ auth, onRequestStaffPin, onSwitchStaff }: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue} auth={auth} onRequestStaffPin={onRequestStaffPin} onSwitchStaff={onSwitchStaff}>
      <section className="page-stack">
        <div className="section-block">
          <div className="section-header">
            <div>
              <p className="eyebrow">{venue.name}</p>
              <h2>Help &amp; fallback</h2>
            </div>
            <Link className="button secondary" to={`/venue/${venue.id}`}>
              Back to venue
            </Link>
          </div>
          <p className="section-copy">
            If an app fails during service, find it in the list below, do the fallback, and fix the
            system after service. Service does not wait for software.
          </p>
        </div>
        <div className="fallback-list">
          {APP_FALLBACKS.map((row) => (
            <article key={row.app} className="fallback-card">
              <strong>{row.app}</strong>
              <ol>
                {row.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function StocktakeRoute(props: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;
  return <StocktakePage venue={venue} {...props} />;
}

function TasksRoute(props: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;
  return <TasksPage venue={venue} {...props} />;
}

function GiftCardRoute(props: Omit<PageShellProps, 'requirePin'>) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;
  return <GiftCardRedeemPage venue={venue} {...props} />;
}

export function App() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [pinIntent, setPinIntent] = useState<PinIntent>(null);

  const requirePin: RequirePin = useCallback((intent) => {
    setPinIntent(intent);
  }, []);

  const onRequestStaffPin = useCallback(() => {
    setPinIntent({ intent: 'Staff sign-in' });
  }, []);

  const onSwitchStaff = useCallback(() => {
    void auth.signOutStaff();
    setPinIntent({ intent: 'Switch staff' });
  }, [auth]);

  const handlePinSubmit = useCallback(
    async (staffProfileId: string, pin: string) => {
      const targetRoute = pinIntent?.targetRoute;
      await auth.signInStaffWithPin(staffProfileId, pin);
      if (targetRoute) {
        navigate(targetRoute);
      }
    },
    [auth, navigate, pinIntent]
  );

  if (auth.loading) {
    return (
      <div className="device-signin">
        <div className="device-signin-card">
          <p className="eyebrow">Alma Venue iPad</p>
          <h1>Loading…</h1>
        </div>
      </div>
    );
  }

  if (!auth.device) {
    return <DeviceSignIn onSignIn={auth.signInDevice} />;
  }

  const shellProps: PageShellProps = {
    auth,
    onRequestStaffPin,
    onSwitchStaff,
    requirePin
  };

  return (
    <>
      <Routes>
        <Route path="/" element={<Navigate to="/venue" replace />} />
        <Route path="/venue" element={<VenueSelectPage {...shellProps} />} />
        <Route path="/venue/:venueId" element={<VenueHomePage {...shellProps} />} />
        <Route
          path="/venue/:venueId/checklists"
          element={<VenueToolPage kind="checklists" {...shellProps} />}
        />
        <Route path="/venue/:venueId/gift-cards" element={<GiftCardRoute {...shellProps} />} />
        <Route path="/venue/:venueId/tasks" element={<TasksRoute {...shellProps} />} />
        <Route
          path="/venue/:venueId/bookings"
          element={<VenueToolPage kind="bookings" {...shellProps} />}
        />
        <Route path="/venue/:venueId/stocktake" element={<StocktakeRoute {...shellProps} />} />
        <Route path="/venue/:venueId/stock" element={<Navigate to="stocktake" replace />} />
        <Route path="/venue/:venueId/handover" element={<HandoverPage {...shellProps} />} />
        <Route path="/venue/:venueId/roster" element={<RosterPage {...shellProps} />} />
        <Route path="/venue/:venueId/help" element={<HelpFallbackPage {...shellProps} />} />
        <Route path="*" element={<Navigate to="/venue" replace />} />
      </Routes>
      {pinIntent ? (
        <StaffPinPrompt
          staffList={auth.staffList}
          intent={pinIntent.intent}
          onClose={() => setPinIntent(null)}
          onSubmit={handlePinSubmit}
        />
      ) : null}
    </>
  );
}
