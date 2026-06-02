import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom';

// Read-only live snapshot endpoint on the compliance API. Public path —
// no auth required (shared trusted iPad device).
const COMPLIANCE_API = (
  (import.meta as unknown as { env: Record<string, string | undefined> }).env?.VITE_COMPLIANCE_API_URL
  ?? 'https://alma-compliance.web.app'
).replace(/\/+$/, '');

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

function useVenueSnapshot(venueId: string | undefined) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!venueId) return;
    const venueName = VENUE_NAMES[venueId] ?? '';
    const fetchSnapshot = async () => {
      setLoading(true);
      try {
        const url = `${COMPLIANCE_API}/api/public/venue-snapshot${venueName ? `?venue=${encodeURIComponent(venueName)}` : ''}`;
        const response = await fetch(url, { credentials: 'omit' });
        if (response.ok) {
          setSnapshot(await response.json());
        }
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

type VenueId = 'st-alma' | 'alma-avalon';

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

type Venue = {
  id: VenueId;
  name: string;
  subtitle: string;
  manager: string;
  serviceStatus: string;
  openTasks: number;
  bookingsToday: number;
  checklistProgress: number;
  lowStock: number;
};

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

const ALMA_HOME_URL = '/apps';

const mockRole = {
  label: 'Shared venue iPad',
  permissions: {
    'checklists.run': true,
    'giftCards.sell': true,
    'tasks.update': true,
    'bookings.view': true,
    'stocktake.run': true,
    'handover.post': true,
    'roster.view': true,
    'help.view': true,
    'settings.view': false
  } satisfies Record<PermissionKey, boolean>
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

function toolsForVenue(venue: Venue): DashboardTool[] {
  return [
    {
      id: 'gift-cards',
      title: 'Gift cards',
      description: 'Redeem, check balance and sell on shared iPad.',
      route: `/venue/${venue.id}/gift-cards`,
      permission: 'giftCards.sell',
      tone: 'neutral',
      status: 'preview'
    },
    {
      id: 'stocktake',
      title: 'Stocktake',
      description: 'Count by area, save drafts, submit when locked.',
      route: `/venue/${venue.id}/stocktake`,
      permission: 'stocktake.run',
      count: venue.lowStock,
      tone: venue.lowStock > 0 ? 'warning' : 'neutral',
      status: 'preview'
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
      description: 'Open venue tasks and manager follow-ups.',
      route: `/venue/${venue.id}/tasks`,
      permission: 'tasks.update',
      count: venue.openTasks,
      tone: venue.openTasks > 5 ? 'warning' : 'neutral',
      status: 'preview'
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

function canUse(permission: PermissionKey) {
  return mockRole.permissions[permission];
}

function AppShell({ venue, children }: { venue?: Venue | null; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/venue" className="brand-link" aria-label="Venue iPad home">
          <span className="brand-mark">A</span>
          <span>
            <strong>Alma Venue</strong>
            <small>iPad dashboard</small>
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
          <summary>Settings</summary>
          <div className="settings-body">
            <p>Role: {mockRole.label}</p>
            <p>Permissions are placeholders for the future Alma auth merge.</p>
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
            <Link className="button secondary" to={ALMA_HOME_URL}>Alma Home</Link>
            <Link className="button" to={venue ? `/venue/${venue.id}` : '/venue'}>Venue Home</Link>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function VenueSelectPage() {
  return (
    <AppShell>
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

function VenueHomePage() {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  const { snapshot } = useVenueSnapshot(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  const tools = toolsForVenue(venue);
  const liveBookings = snapshot?.bookings.today ?? venue.bookingsToday;
  const liveCovers = snapshot?.bookings.coversToday;
  const liveChecklists = snapshot?.checklists.active;
  const tempAlerts = snapshot?.temperatures.outOfRangeSensors ?? 0;
  const openIssues = snapshot?.compliance.openIssues ?? venue.openTasks;
  const criticalIssues = snapshot?.compliance.criticalIssues ?? 0;
  const lastUpdated = snapshot ? new Date(snapshot.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : null;

  return (
    <AppShell venue={venue}>
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
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function ToolCard({ tool }: { tool: DashboardTool }) {
  const disabled = !canUse(tool.permission);

  if (disabled) {
    return (
      <article className="tool-card disabled">
        <strong>{tool.title}</strong>
        <p>{tool.description}</p>
        <span className="permission-chip">Permission pending</span>
      </article>
    );
  }

  const tone = tool.tone ?? 'neutral';
  const statusClass = tool.status === 'preview' ? ' is-preview' : tool.status === 'pilot' ? ' is-pilot' : '';

  return (
    <Link to={tool.route} className={`tool-card ${tone}${statusClass}`}>
      <span className="tool-card-body">
        <strong>{tool.title}</strong>
        <p>{tool.description}</p>
        {tool.status && tool.status !== 'live' ? (
          <span className={`status-chip status-chip-${tool.status}`}>
            {tool.status === 'preview' ? 'Preview' : 'Pilot'}
          </span>
        ) : null}
      </span>
      {tool.count !== undefined ? <span className="tool-count">{tool.count}</span> : null}
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

function VenueToolPage({ kind }: { kind: 'checklists' | 'gift-cards' | 'tasks' | 'bookings' | 'stocktake' }) {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  const page = toolPageContent[kind];

  return (
    <AppShell venue={venue}>
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
  'gift-cards': {
    title: 'Gift cards',
    description: 'Shared iPad actions for selling, checking and redeeming gift cards.',
    actions: [
      { title: 'Sell gift card', detail: 'Create new card sale' },
      { title: 'Redeem card', detail: 'Enter card code or scan' },
      { title: 'Check balance', detail: 'Lookup card value' }
    ],
    listTitle: 'Recent activity',
    rows: [
      { title: 'Gift card sale', detail: '$150 mock sale', status: 'Paid', tone: 'positive' as const },
      { title: 'Balance check', detail: 'Card ending 4412', status: 'Viewed', tone: 'neutral' as const }
    ]
  },
  tasks: {
    title: 'Tasks',
    description: 'Venue handover jobs, manager notes and daily follow-up items.',
    actions: [
      { title: 'Add task', detail: 'Create a visible venue job' },
      { title: 'Mark complete', detail: 'Close selected task' },
      { title: 'Escalate', detail: 'Flag for manager review' }
    ],
    listTitle: 'Open tasks',
    rows: [
      { title: 'Repair loose table leg', detail: 'Dining room, table 12', status: 'Open', tone: 'warning' as const },
      { title: 'Print new menus', detail: 'Dinner service', status: 'Due today', tone: 'warning' as const },
      { title: 'Restock receipt rolls', detail: 'POS station', status: 'Done', tone: 'positive' as const }
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
  },
  stocktake: {
    title: 'Stocktake',
    description: 'Count by area, save drafts, and submit when locked. iPad-first stocktake — the workflow that lets us retire Loaded.',
    actions: [
      { title: 'Start new count', detail: 'Pick the count area to begin' },
      { title: 'Resume draft', detail: 'Pick up an in-progress count' },
      { title: 'Review variance', detail: 'High-variance items before submit' }
    ],
    listTitle: 'Recent stocktakes',
    rows: [
      { title: 'Bar — Friday', detail: '83 of 120 items counted', status: 'Draft', tone: 'warning' as const },
      { title: 'Kitchen — Tuesday', detail: 'Submitted, awaiting review', status: 'Submitted', tone: 'neutral' as const },
      { title: 'Cellar — last week', detail: 'Locked', status: 'Locked', tone: 'positive' as const }
    ]
  }
} satisfies Record<string, {
  title: string;
  description: string;
  actions: Array<{ title: string; detail: string }>;
  listTitle: string;
  rows: Array<{ title: string; detail: string; status: string; tone: 'neutral' | 'warning' | 'positive' }>;
}>;

function HandoverPage() {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue}>
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

function RosterPage() {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue}>
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

function HelpFallbackPage() {
  const { venueId } = useParams();
  const venue = venueById(venueId);
  if (!venue) return <Navigate to="/venue" replace />;

  return (
    <AppShell venue={venue}>
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/venue" replace />} />
      <Route path="/venue" element={<VenueSelectPage />} />
      <Route path="/venue/:venueId" element={<VenueHomePage />} />
      <Route path="/venue/:venueId/checklists" element={<VenueToolPage kind="checklists" />} />
      <Route path="/venue/:venueId/gift-cards" element={<VenueToolPage kind="gift-cards" />} />
      <Route path="/venue/:venueId/tasks" element={<VenueToolPage kind="tasks" />} />
      <Route path="/venue/:venueId/bookings" element={<VenueToolPage kind="bookings" />} />
      <Route path="/venue/:venueId/stocktake" element={<VenueToolPage kind="stocktake" />} />
      <Route path="/venue/:venueId/stock" element={<Navigate to="stocktake" replace />} />
      <Route path="/venue/:venueId/handover" element={<HandoverPage />} />
      <Route path="/venue/:venueId/roster" element={<RosterPage />} />
      <Route path="/venue/:venueId/help" element={<HelpFallbackPage />} />
      <Route path="*" element={<Navigate to="/venue" replace />} />
    </Routes>
  );
}
