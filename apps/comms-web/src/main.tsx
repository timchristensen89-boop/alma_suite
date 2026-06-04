import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams
} from 'react-router-dom';
import {
  AlmaHomeBubble,
  AppShell,
  Card,
  CommsGlyph,
  ProductLogo,
  SUITE_APPS,
  SuiteAppSwitcher,
  SuiteClock,
  SuiteFeedbackWidget,
  SuiteNotificationsWidget,
  ThemeToggle,
  TopBar
} from '@alma/ui';
import {
  IconBriefcase,
  IconChecklist,
  IconChevronDown,
  IconDashboard,
  IconFileText,
  IconIssues,
  IconSettings,
  IconStore,
  IconUpload
} from '../../web/src/lib/icons';
import { withSuiteAppLinks } from './config/suiteLinks';
import '../../web/src/styles.css';
import './styles.css';

const suiteApps = withSuiteAppLinks(SUITE_APPS);

type AuthUser = {
  id?: string;
  email?: string;
  name?: string;
  role?: string;
  isAdmin?: boolean;
};

type AuthResponse = {
  user: AuthUser | null;
};

type ThreadSummary = {
  id: string;
  subject: string;
  venue?: string | null;
  category: string;
  priority: string;
  createdById?: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  unread?: boolean;
  actionRequired?: boolean;
  dueAt?: string | null;
  latestMessage?: string | null;
};

type ThreadMessage = {
  id: string;
  threadId: string;
  body: string;
  createdById?: string | null;
  createdAt: string;
  editedAt?: string | null;
};

type ThreadDetail = {
  id: string;
  subject: string;
  venue?: string | null;
  category: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
};

type AlertDryRunEvent = {
  alertType: string;
  subject: string;
  venue?: string | null;
  value?: number | null;
  thresholdValue?: number | null;
  severity: string;
};

type AlertDryRunResult = {
  dryRun: boolean;
  evaluated: number;
  wouldCreate: number;
  events: AlertDryRunEvent[];
};

type RecipientOption = {
  id: string;
  type: 'STAFF' | 'VENUE' | 'ROLE' | 'ROLE_TEMPLATE' | 'MANAGERS';
  label: string;
  description?: string;
  venue?: string | null;
  count?: number;
};

type RecipientOptionsPayload = {
  staff: RecipientOption[];
  groups: RecipientOption[];
  canBroadcast: boolean;
  canDirect: boolean;
};

const TOKEN_STORAGE_KEY = 'alma-comms-token';

function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}


type CommsNavItem = {
  to: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  end?: boolean;
};

const navItems: CommsNavItem[] = [
  { to: '/', label: 'Overview', description: 'Recent threads, handover, and alerts', icon: <IconDashboard />, end: true },
  { to: '/inbox', label: 'Inbox', description: 'Direct messages and replies', icon: <IconFileText /> },
  { to: '/venue', label: 'Venue', description: 'Venue-wide team conversations', icon: <IconStore /> },
  { to: '/announcements', label: 'Announcements', description: 'Broadcasts to all staff', icon: <IconIssues /> },
  { to: '/handover', label: 'Handover', description: 'Shift handover notes', icon: <IconBriefcase /> },
  { to: '/tasks', label: 'Tasks', description: 'Follow-ups and action items', icon: <IconChecklist /> },
  { to: '/compose', label: 'Compose', description: 'Start a new thread or announcement', icon: <IconUpload /> },
  { to: '/settings', label: 'Settings', description: 'Comms preferences and integrations', icon: <IconSettings /> }
];

function apiUrl(path: string) {
  return path.startsWith('/api') ? path : `/api${path}`;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(getStoredToken() ? { Authorization: `Bearer ${getStoredToken()}` } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error ?? data?.message ?? `Request failed with ${response.status}`);
  }

  return data as T;
}


function urlWithSuiteToken(href: string, token: string) {
  const url = new URL(href, window.location.origin);
  url.searchParams.set('suite_token', token);
  url.searchParams.set('suite_from', window.location.origin);
  return url.toString();
}

async function createSuiteHandoffUrl(href: string) {
  const data = await api<{ token: string }>('/api/auth/handoff', { method: 'POST' });
  return urlWithSuiteToken(href, data.token);
}

async function consumeSuiteHandoffToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('suite_token');

  if (!token) return null;

  const data = await api<{ user: AuthUser; token?: string }>('/api/auth/handoff/consume', {
    method: 'POST',
    body: JSON.stringify({ token })
  });

  setStoredToken(data.token ?? null);
  params.delete('suite_token');
  params.delete('suite_from');

  const nextSearch = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
  );

  return data.user;
}

function installSuiteHandoff() {
  (globalThis as typeof globalThis & {
    almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
  }).almaCreateSuiteHandoffUrl = createSuiteHandoffUrl;

  return () => {
    delete (globalThis as typeof globalThis & {
      almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
    }).almaCreateSuiteHandoffUrl;
  };
}

function formatDateTime(value: string) {
  try {
    return new Intl.DateTimeFormat('en-AU', {
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function priorityLabel(priority: string) {
  return priority.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

/**
 * /apps inside any individual app means "back to the suite launcher".
 * Some older iPad/handoff links point here — bounce them to the home app.
 */
function AppsBounce() {
  useEffect(() => {
    window.location.replace('https://alma-home.web.app');
  }, []);
  return null;
}

function PageShell({
  title,
  eyebrow,
  subtitle,
  children
}: {
  title: string;
  eyebrow: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="comms-page">
      <p className="comms-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {subtitle ? <p className="comms-subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}

function LoginGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');

    try {
      const data = await api<{ user: AuthUser; token?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setStoredToken(data.token ?? null);
      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="comms-login">
      <Card className="comms-login-card">
        <ProductLogo appId="comms" size="lg" />
        <h1>Sign in to Comms</h1>
        <p>Messages, handovers, alerts, and follow-ups are restricted to authorised Alma users.</p>
        <form onSubmit={submit} className="comms-form">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {message ? <p className="comms-error">{message}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </Card>
    </main>
  );
}

function ThreadList({ threads }: { threads: ThreadSummary[] }) {
  if (threads.length === 0) {
    return (
      <Card>
        <h2>No messages yet</h2>
        <p className="comms-muted">There are no Comms items in this view.</p>
      </Card>
    );
  }

  return (
    <div className="thread-list">
      {threads.map((thread) => (
        <NavLink key={thread.id} to={`/threads/${thread.id}`} className="thread-card">
          <div className="thread-topline">
            <span className={`priority-pill priority-${thread.priority.toLowerCase()}`}>{priorityLabel(thread.priority)}</span>
            <span>{formatDateTime(thread.updatedAt)}</span>
          </div>
          <h3>{thread.subject}</h3>
          <p>{thread.latestMessage || 'Open thread'}</p>
          <div className="thread-meta">
            {thread.venue ? <span>{thread.venue}</span> : null}
            <span>{thread.category}</span>
            {thread.unread ? <strong>Unread</strong> : null}
            {thread.actionRequired ? <strong>Action required</strong> : null}
          </div>
        </NavLink>
      ))}
    </div>
  );
}

function useInbox() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      const data = await api<{ threads: ThreadSummary[] }>('/comms/inbox');
      setThreads(data.threads ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load Comms.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return { threads, loading, message, reload: load };
}

function HomePage() {
  const { threads, loading, message } = useInbox();
  const urgentThreads = threads.filter((thread) => thread.priority === 'HIGH' || thread.priority === 'URGENT' || thread.actionRequired).slice(0, 4);

  return (
    <section className="comms-page">
      <AlmaHomeBubble
        app="comms"
        appName="Comms"
        appIcon={<CommsGlyph />}
        eyebrow="Team comms"
        description="Pinned announcements, group threads, supplier sign-offs. The internal voice of the group."
        statusLabel={urgentThreads.length > 0 ? `${urgentThreads.length} unread` : 'All clear'}
        statusHint={(() => {
          if (loading) return 'Loading the inbox…';
          if (message) return 'Could not refresh Comms.';
          if (urgentThreads.length === 0) return 'Inbox is current, no handovers pending.';
          return `${urgentThreads.length} priority thread${urgentThreads.length === 1 ? '' : 's'} waiting on a reply.`;
        })()}
        statusDot={urgentThreads.length > 0 ? 'amber' : 'forest'}
        actions={
          <>
            <NavLink className="alma-home-bubble-btn alma-home-bubble-btn--primary" to="/compose">
              New thread →
            </NavLink>
            <NavLink className="alma-home-bubble-btn alma-home-bubble-btn--ghost" to="/inbox">
              Broadcast
            </NavLink>
          </>
        }
      />

      <div className="comms-grid">
        <Card>
          <h2>Inbox</h2>
          <p className="comms-muted">Messages, announcements, handovers, and follow-ups that need attention.</p>
          <NavLink className="comms-button ghost" to="/inbox">Open inbox</NavLink>
        </Card>
        <Card>
          <h2>Venue handover</h2>
          <p className="comms-muted">Keep opening, service, and closing notes visible for the next person.</p>
          <NavLink className="comms-button ghost" to="/handover">Open handover</NavLink>
        </Card>
        <Card>
          <h2>Alerts</h2>
          <p className="comms-muted">COGS, stock variance, fridge temperature, and failed checks will land here first.</p>
          <NavLink className="comms-button ghost" to="/tasks">Review alerts</NavLink>
        </Card>
      </div>

      <Card>
        <div className="section-heading">
          <div>
            <h2>Needs attention</h2>
            <p className="comms-muted">Urgent, high-priority, or action-required threads.</p>
          </div>
        </div>
        {loading ? <p>Loading…</p> : null}
        {message ? <p className="comms-error">{message}</p> : null}
        {!loading && !message ? <ThreadList threads={urgentThreads} /> : null}
      </Card>
    </section>
  );
}

function InboxPage() {
  const { threads, loading, message, reload } = useInbox();

  return (
    <PageShell title="Inbox" eyebrow="Personal messages">
      <div className="toolbar">
        <button type="button" onClick={reload}>Refresh</button>
        <NavLink className="comms-button" to="/compose">New message</NavLink>
      </div>
      {loading ? <Card><p>Loading inbox…</p></Card> : null}
      {message ? <Card><p className="comms-error">{message}</p></Card> : null}
      {!loading && !message ? <ThreadList threads={threads} /> : null}
    </PageShell>
  );
}

// Endpoint map for category-filtered pages — use dedicated API endpoints where available
const CATEGORY_ENDPOINTS: Record<string, string> = {
  ANNOUNCEMENT: '/comms/announcements',
  HANDOVER: '/comms/handover'
};

function FilteredThreadsPage({ title, eyebrow, category }: { title: string; eyebrow: string; category: string }) {
  const endpoint = CATEGORY_ENDPOINTS[category] ?? null;
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // If there's a dedicated endpoint, fetch from it directly; otherwise fall back to inbox + filter
  const inboxResult = useInbox();

  useEffect(() => {
    if (!endpoint) return; // handled by useInbox fallback
    setLoading(true);
    setMessage('');
    api<{ threads: ThreadSummary[] }>(endpoint)
      .then((data) => setThreads(data.threads ?? []))
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Could not load.'))
      .finally(() => setLoading(false));
  }, [endpoint]);

  const displayThreads = endpoint ? threads : inboxResult.threads.filter((t) => t.category === category);
  const isLoading = endpoint ? loading : inboxResult.loading;
  const errorMessage = endpoint ? message : inboxResult.message;

  return (
    <PageShell title={title} eyebrow={eyebrow}>
      {category === 'HANDOVER' ? (
        <Card>
          <div className="section-heading">
            <div>
              <h2>End-of-shift wrap</h2>
              <p className="comms-muted">Structured close-of-day prompt: incidents, complaints, stock, maintenance, notes for the next shift.</p>
            </div>
            <NavLink className="comms-button" to="/handover/new">File shift wrap</NavLink>
          </div>
        </Card>
      ) : null}
      {isLoading ? <Card><p>Loading…</p></Card> : null}
      {errorMessage ? <Card><p className="comms-error">{errorMessage}</p></Card> : null}
      {!isLoading && !errorMessage ? <ThreadList threads={displayThreads} /> : null}
    </PageShell>
  );
}

function TasksPage() {
  const { threads, loading, message } = useInbox();
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState<AlertDryRunResult | null>(null);
  const actionThreads = useMemo(() => threads.filter((thread) => thread.category === 'TASK' || thread.category === 'ALERT' || thread.actionRequired), [threads]);

  async function evaluate() {
    setEvaluating(true);
    setResult(null);
    try {
      const data = await api<AlertDryRunResult>('/comms/alerts/evaluate', { method: 'POST' });
      setResult(data);
    } catch (error) {
      setResult({
        dryRun: true,
        evaluated: 0,
        wouldCreate: 0,
        events: [{
          alertType: 'GENERAL',
          subject: error instanceof Error ? error.message : 'Could not evaluate alerts.',
          severity: 'WARNING'
        }]
      });
    } finally {
      setEvaluating(false);
    }
  }

  return (
    <PageShell title="Follow-ups" eyebrow="Action messages">
      <Card>
        <div className="section-heading">
          <div>
            <h2>Alert dry run</h2>
            <p className="comms-muted">Checks alert rules without sending emails.</p>
          </div>
          <button type="button" onClick={evaluate} disabled={evaluating}>
            {evaluating ? 'Checking…' : 'Evaluate alerts'}
          </button>
        </div>
        {result ? (
          <div className="alert-result">
            <p>{result.evaluated} rules checked. {result.wouldCreate} events would be created.</p>
            {result.events.length ? (
              <div className="thread-list">
                {result.events.map((event, index) => (
                  <article key={`${event.alertType}-${index}`} className="thread-card static">
                    <div className="thread-topline">
                      <span className={`priority-pill priority-${event.severity.toLowerCase()}`}>{event.severity}</span>
                      {event.venue ? <span>{event.venue}</span> : null}
                    </div>
                    <h3>{event.subject}</h3>
                    <p>{event.alertType}</p>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {loading ? <Card><p>Loading tasks…</p></Card> : null}
      {message ? <Card><p className="comms-error">{message}</p></Card> : null}
      {!loading && !message ? <ThreadList threads={actionThreads} /> : null}
    </PageShell>
  );
}

function ThreadDetailPage() {
  const { id } = useParams();
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    if (!id) return;
    setLoading(true);
    setMessage('');
    try {
      const data = await api<{ thread: ThreadDetail }>(`/comms/threads/${id}`);
      setThread(data.thread);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load thread.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function markRead() {
    if (!id) return;
    await api(`/comms/threads/${id}/read`, { method: 'POST' });
    await load();
  }

  async function acknowledge() {
    if (!id) return;
    await api(`/comms/threads/${id}/acknowledge`, { method: 'POST' });
    await load();
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!id || !reply.trim()) return;
    await api(`/comms/threads/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body: reply })
    });
    setReply('');
    await load();
  }

  return (
    <PageShell title={thread?.subject ?? 'Thread'} eyebrow="Message thread">
      {loading ? <Card><p>Loading thread…</p></Card> : null}
      {message ? <Card><p className="comms-error">{message}</p></Card> : null}
      {thread ? (
        <>
          <Card>
            <div className="section-heading">
              <div>
                <h2>{thread.subject}</h2>
                <p className="comms-muted">{thread.venue || 'All venues'} · {thread.category} · {thread.priority}</p>
              </div>
              <div className="toolbar">
                <button type="button" onClick={markRead}>Mark read</button>
                <button type="button" onClick={acknowledge}>Acknowledge</button>
              </div>
            </div>
          </Card>

          <div className="message-list">
            {thread.messages.map((item) => (
              <Card key={item.id} className="message-card">
                <p>{item.body}</p>
                <span>{formatDateTime(item.createdAt)}</span>
              </Card>
            ))}
          </div>

          <Card>
            <form onSubmit={sendReply} className="comms-form">
              <label>
                Reply
                <textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={4} required />
              </label>
              <button type="submit">Send reply</button>
            </form>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}

function ComposePage() {
  const navigate = useNavigate();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [venue, setVenue] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [priority, setPriority] = useState('NORMAL');
  const [actionRequired, setActionRequired] = useState(false);
  const [recipientOptions, setRecipientOptions] = useState<RecipientOptionsPayload>({ staff: [], groups: [], canBroadcast: false, canDirect: false });
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Array<{ type: RecipientOption['type']; id: string }>>([]);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<RecipientOptionsPayload>('/messages/recipient-options')
      .then((data) => {
        if (!cancelled) setRecipientOptions(data);
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Could not load recipients.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredStaff = useMemo(() => {
    const query = recipientSearch.trim().toLowerCase();
    if (!query) return recipientOptions.staff;
    return recipientOptions.staff.filter((option) =>
      [option.label, option.description, option.venue].some((value) => value?.toLowerCase().includes(query))
    );
  }, [recipientOptions.staff, recipientSearch]);

  const selectedRecipientCount = selectedStaffIds.length + selectedGroups.length;

  function toggleStaff(id: string) {
    setSelectedStaffIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function toggleGroup(option: RecipientOption) {
    setSelectedGroups((current) => {
      const exists = current.some((item) => item.type === option.type && item.id === option.id);
      return exists
        ? current.filter((item) => !(item.type === option.type && item.id === option.id))
        : [...current, { type: option.type, id: option.id }];
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selectedRecipientCount === 0) {
      setMessage('Choose at least one person or group.');
      return;
    }
    setBusy(true);
    setMessage('');

    try {
      const data = await api<{ thread: { id: string } }>('/comms/threads', {
        method: 'POST',
        body: JSON.stringify({
          subject,
          body,
          venue: venue || undefined,
          category,
          priority,
          actionRequired,
          staffProfileIds: selectedStaffIds,
          recipientGroups: selectedGroups
        })
      });
      navigate(`/threads/${data.thread.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="New message" eyebrow="Compose">
      <Card>
        <form onSubmit={submit} className="comms-form">
          <label>
            Subject
            <input value={subject} onChange={(event) => setSubject(event.target.value)} required />
          </label>
          <label>
            Message
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={7} required />
          </label>
          <div className="recipient-picker">
            <div className="section-heading">
              <div>
                <h2>Recipients</h2>
                <p className="comms-muted">Choose staff, venue groups, managers, or role-based groups. Device accounts and inactive staff are excluded.</p>
              </div>
              <span className="recipient-count">{selectedRecipientCount} selected</span>
            </div>
            <label>
              Find staff
              <input value={recipientSearch} onChange={(event) => setRecipientSearch(event.target.value)} placeholder="Search by name, role, or venue" />
            </label>
            <div className="recipient-grid">
              <div className="recipient-column">
                <strong>Staff</strong>
                {filteredStaff.length === 0 ? <p className="comms-muted">No matching staff.</p> : null}
                {filteredStaff.slice(0, 30).map((option) => (
                  <label key={option.id} className="recipient-option">
                    <input
                      type="checkbox"
                      checked={selectedStaffIds.includes(option.id)}
                      onChange={() => toggleStaff(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div className="recipient-column">
                <strong>Groups</strong>
                {recipientOptions.groups.length === 0 ? <p className="comms-muted">No groups available.</p> : null}
                {recipientOptions.groups.map((option) => (
                  <label key={`${option.type}:${option.id}`} className="recipient-option">
                    <input
                      type="checkbox"
                      checked={selectedGroups.some((item) => item.type === option.type && item.id === option.id)}
                      onChange={() => toggleGroup(option)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{[option.description, option.count ? `${option.count} staff` : null].filter(Boolean).join(' · ')}</small>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="form-grid">
            <label>
              Venue
              <input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="Optional" />
            </label>
            <label>
              Category
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="GENERAL">General</option>
                <option value="VENUE">Venue</option>
                <option value="ANNOUNCEMENT">Announcement</option>
                <option value="HANDOVER">Handover</option>
                <option value="TASK">Task</option>
                <option value="ALERT">Alert</option>
              </select>
            </label>
            <label>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={actionRequired} onChange={(event) => setActionRequired(event.target.checked)} />
            Action required
          </label>
          {message ? <p className="comms-error">{message}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create thread'}
          </button>
        </form>
      </Card>
    </PageShell>
  );
}

// End-of-Shift Wrap (#23): a structured handover form the manager fills
// at close. Saves a HANDOVER comms thread the next shift's manager sees
// in their handover inbox. Designed for fast tap-through on an iPad.
function EndOfShiftPage() {
  const navigate = useNavigate();
  const today = new Date();
  const defaultDate = today.toISOString().slice(0, 10);
  // Default shift type by current hour: before 16:00 → Lunch, before 22:00 → Dinner, else Late.
  const hour = today.getHours();
  const defaultShift = hour < 16 ? 'Lunch' : hour < 22 ? 'Dinner' : 'Late';

  // Pre-fill venue from the iPad localStorage if the home-web venue mode set it.
  const localVenue = typeof window !== 'undefined'
    ? (window.localStorage.getItem('alma.venue.name') || '').trim()
    : '';

  const [shiftDate, setShiftDate] = useState(defaultDate);
  const [shiftType, setShiftType] = useState(defaultShift);
  const [venue, setVenue] = useState(localVenue);
  const [duty, setDuty] = useState('');
  const [covers, setCovers] = useState('');
  const [sales, setSales] = useState('');
  const [staffOnLate, setStaffOnLate] = useState('');
  const [incidentsHappened, setIncidentsHappened] = useState<'none' | 'minor' | 'reportable'>('none');
  const [incidentsDetail, setIncidentsDetail] = useState('');
  const [stockIssues, setStockIssues] = useState('');
  const [complaints, setComplaints] = useState<'none' | 'resolved' | 'open'>('none');
  const [complaintDetail, setComplaintDetail] = useState('');
  const [maintenance, setMaintenance] = useState('');
  const [bookingsTomorrow, setBookingsTomorrow] = useState('');
  const [noteForNext, setNoteForNext] = useState('');
  const [allLockedUp, setAllLockedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [tone, setTone] = useState<'success' | 'error'>('success');

  // Compose a clean markdown-ish body so the next shift can scan quickly.
  function buildBody() {
    const lines: string[] = [];
    lines.push(`Shift: ${shiftType} · ${shiftDate}${venue ? ` · ${venue}` : ''}`);
    lines.push(`Duty manager: ${duty || '—'}`);
    lines.push('');
    lines.push('Service');
    lines.push(`  Covers: ${covers || '—'}`);
    lines.push(`  Sales: ${sales || '—'}`);
    lines.push(`  Staff staying late: ${staffOnLate || '—'}`);
    lines.push('');
    lines.push('Incidents');
    if (incidentsHappened === 'none') {
      lines.push('  None.');
    } else {
      lines.push(`  ${incidentsHappened === 'reportable' ? 'REPORTABLE — also log in Compliance · Incidents.' : 'Minor.'} ${incidentsDetail || ''}`.trim());
    }
    lines.push('');
    lines.push('Customer complaints');
    if (complaints === 'none') {
      lines.push('  None.');
    } else {
      lines.push(`  ${complaints === 'open' ? 'OPEN — follow up tomorrow.' : 'Resolved tonight.'} ${complaintDetail || ''}`.trim());
    }
    lines.push('');
    lines.push('Stock — low or out');
    lines.push(`  ${stockIssues || 'Nothing flagged.'}`);
    lines.push('');
    lines.push('Maintenance / equipment');
    lines.push(`  ${maintenance || 'Nothing flagged.'}`);
    lines.push('');
    lines.push('Tomorrow / next shift');
    lines.push(`  Bookings: ${bookingsTomorrow || '—'}`);
    lines.push(`  Notes: ${noteForNext || '—'}`);
    lines.push('');
    lines.push(`Locked up correctly: ${allLockedUp ? 'YES' : 'NO — please double-check.'}`);
    return lines.join('\n');
  }

  function subjectLine() {
    const v = venue || 'Venue';
    return `End of shift — ${v} — ${shiftType} ${shiftDate}`;
  }

  // Pre-submit validation: the manager must at least say who was DM and lock-up state.
  function validate(): string | null {
    if (!duty.trim()) return 'Enter who was duty manager.';
    if (!shiftDate.trim()) return 'Pick a shift date.';
    if (incidentsHappened !== 'none' && !incidentsDetail.trim()) return 'Describe the incident before filing.';
    if (complaints !== 'none' && !complaintDetail.trim()) return 'Describe the complaint before filing.';
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const error = validate();
    if (error) {
      setTone('error');
      setMessage(error);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const priority = incidentsHappened === 'reportable' || complaints === 'open' ? 'HIGH' : 'NORMAL';
      const actionRequired = incidentsHappened === 'reportable' || complaints === 'open';
      // Fan out to the venue managers group, plus anyone with manager role at this venue.
      // The /api/comms/handover endpoint also auto-routes to handover category.
      await api<{ thread: { id: string } }>('/comms/handover', {
        method: 'POST',
        body: JSON.stringify({
          subject: subjectLine(),
          body: buildBody(),
          venue: venue || undefined,
          priority,
          actionRequired,
          managerVenues: venue ? [venue] : []
        })
      });
      setTone('success');
      setMessage('Shift wrap filed. Next shift can see it in Handover.');
      // Brief delay so the success message is visible before navigation.
      setTimeout(() => navigate('/handover'), 700);
    } catch (err) {
      setTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not file shift wrap.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title="End-of-shift wrap" eyebrow="Handover">
      <Card>
        <p className="comms-muted">
          Run this in the last 15 minutes of service. It captures what tomorrow needs to know so the
          handover isn't lost in a text message. Reportable incidents and open complaints will be flagged
          as <strong>HIGH</strong> priority so the next shift sees them first.
        </p>
      </Card>
      <Card>
        <form className="comms-form end-of-shift-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              Shift date
              <input type="date" value={shiftDate} onChange={(event) => setShiftDate(event.target.value)} required />
            </label>
            <label>
              Shift type
              <select value={shiftType} onChange={(event) => setShiftType(event.target.value)}>
                <option value="Lunch">Lunch</option>
                <option value="Dinner">Dinner</option>
                <option value="Late">Late / close</option>
                <option value="Day">All-day</option>
              </select>
            </label>
            <label>
              Venue
              <input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="e.g. Alma Avalon" />
            </label>
            <label>
              Duty manager
              <input value={duty} onChange={(event) => setDuty(event.target.value)} placeholder="Your name" required />
            </label>
          </div>

          <h3 className="end-of-shift-h">Service</h3>
          <div className="form-grid">
            <label>
              Covers
              <input value={covers} onChange={(event) => setCovers(event.target.value)} placeholder="e.g. 142" inputMode="numeric" />
            </label>
            <label>
              Sales
              <input value={sales} onChange={(event) => setSales(event.target.value)} placeholder="e.g. $8,420" inputMode="decimal" />
            </label>
            <label>
              Staff staying late
              <input value={staffOnLate} onChange={(event) => setStaffOnLate(event.target.value)} placeholder="Names + reason" />
            </label>
          </div>

          <h3 className="end-of-shift-h">Incidents</h3>
          <div className="end-of-shift-radio-row">
            <label className="end-of-shift-radio">
              <input type="radio" name="incidents" checked={incidentsHappened === 'none'} onChange={() => setIncidentsHappened('none')} />
              <span>Nothing to report</span>
            </label>
            <label className="end-of-shift-radio">
              <input type="radio" name="incidents" checked={incidentsHappened === 'minor'} onChange={() => setIncidentsHappened('minor')} />
              <span>Minor — handled in-house</span>
            </label>
            <label className="end-of-shift-radio is-strict">
              <input type="radio" name="incidents" checked={incidentsHappened === 'reportable'} onChange={() => setIncidentsHappened('reportable')} />
              <span>Reportable — also file in Compliance</span>
            </label>
          </div>
          {incidentsHappened !== 'none' ? (
            <label>
              What happened
              <textarea value={incidentsDetail} onChange={(event) => setIncidentsDetail(event.target.value)} rows={3} placeholder="Time, what happened, who was involved, what action was taken." required />
            </label>
          ) : null}

          <h3 className="end-of-shift-h">Customer complaints</h3>
          <div className="end-of-shift-radio-row">
            <label className="end-of-shift-radio">
              <input type="radio" name="complaints" checked={complaints === 'none'} onChange={() => setComplaints('none')} />
              <span>None</span>
            </label>
            <label className="end-of-shift-radio">
              <input type="radio" name="complaints" checked={complaints === 'resolved'} onChange={() => setComplaints('resolved')} />
              <span>Resolved tonight</span>
            </label>
            <label className="end-of-shift-radio is-strict">
              <input type="radio" name="complaints" checked={complaints === 'open'} onChange={() => setComplaints('open')} />
              <span>Open — needs follow-up</span>
            </label>
          </div>
          {complaints !== 'none' ? (
            <label>
              Complaint detail
              <textarea value={complaintDetail} onChange={(event) => setComplaintDetail(event.target.value)} rows={3} placeholder="Guest name (if appropriate), table, complaint, how it was handled, what's left to do." required />
            </label>
          ) : null}

          <h3 className="end-of-shift-h">Stock — low or out</h3>
          <label>
            What's running low
            <textarea value={stockIssues} onChange={(event) => setStockIssues(event.target.value)} rows={3} placeholder="e.g. 86 Riesling by-the-glass · low on chips · out of vegan brownie" />
          </label>

          <h3 className="end-of-shift-h">Maintenance & equipment</h3>
          <label>
            Anything broken / needs a tradie?
            <textarea value={maintenance} onChange={(event) => setMaintenance(event.target.value)} rows={2} placeholder="e.g. fridge #2 not holding temp · dishwasher leaking · POS terminal 4 cracked" />
          </label>

          <h3 className="end-of-shift-h">Tomorrow / next shift</h3>
          <div className="form-grid">
            <label>
              Bookings tomorrow
              <input value={bookingsTomorrow} onChange={(event) => setBookingsTomorrow(event.target.value)} placeholder="e.g. 60 covers, two large tables" />
            </label>
            <label>
              Notes for next shift
              <input value={noteForNext} onChange={(event) => setNoteForNext(event.target.value)} placeholder="Heads-up worth saying" />
            </label>
          </div>

          <label className="check-row end-of-shift-check">
            <input type="checkbox" checked={allLockedUp} onChange={(event) => setAllLockedUp(event.target.checked)} />
            All doors, safes and gas locked / off
          </label>

          {message ? <p className={tone === 'error' ? 'comms-error' : 'comms-success'}>{message}</p> : null}

          <div className="end-of-shift-actions">
            <button type="button" className="comms-button ghost" onClick={() => navigate('/handover')}>Cancel</button>
            <button type="submit" disabled={busy}>{busy ? 'Filing…' : 'File shift wrap'}</button>
          </div>
        </form>
      </Card>
    </PageShell>
  );
}

function SettingsPage() {
  return (
    <PageShell title="Comms settings" eyebrow="Admin only">
      <Card>
        <h2>Alert rules</h2>
        <p className="comms-muted">Roster forecast COGS, stock variance, fridge temperatures, checklist failures, and expiring documents will be configured here.</p>
        <p className="comms-muted">Email sending is not enabled yet. Alerts should create Comms tasks first, then email managers only when explicitly configured.</p>
      </Card>
    </PageShell>
  );
}


function currentCommsPage(pathname: string) {
  return [...navItems]
    .sort((a, b) => b.to.length - a.to.length)
    .find((item) =>
      item.to === '/' ? pathname === '/' : pathname === item.to || pathname.startsWith(`${item.to}/`)
    ) ?? navItems[0]!;
}

function initialsOf(user: AuthUser) {
  const nameParts = (user.name ?? '').trim().split(/\s+/).filter(Boolean);
  const fromName = nameParts.length > 1
    ? `${nameParts[0]?.[0] ?? ''}${nameParts[nameParts.length - 1]?.[0] ?? ''}`
    : nameParts[0]?.slice(0, 2) ?? '';
  return fromName.toUpperCase() || user.email?.trim().charAt(0).toUpperCase() || 'A';
}

function CommsSidebar() {
  const location = useLocation();
  const active = currentCommsPage(location.pathname);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className="mobile-nav-layer">
      <button
        className="mobile-nav-toggle"
        type="button"
        aria-expanded={mobileMenuOpen}
        aria-controls="comms-mobile-nav"
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        <span className="mobile-nav-toggle-current">
          <span className="sidebar-nav-icon">{active.icon}</span>
          <span>{active.label}</span>
        </span>
        <IconChevronDown className="mobile-nav-toggle-caret" size={16} />
      </button>

      <ul id="comms-mobile-nav" className={`sidebar-nav ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <li className="sidebar-nav-section">Comms</li>
        {navItems.map((item) => (
          <li key={item.to}>
            <NavLink to={item.to} end={item.end}>
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommsUserMenu({
  user,
  adminUrl,
  onAdmin,
  onSignOut
}: {
  user: AuthUser;
  adminUrl: string;
  onAdmin: (event: React.MouseEvent<HTMLAnchorElement>) => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="user-menu" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="topbar-avatar"
        onClick={() => setOpen((current) => !current)}
        aria-label="Account menu"
      >
        {initialsOf(user)}
      </button>
      {open ? (
        <div className="user-menu-panel">
          <div className="user-menu-head">
            <strong>{user.name || user.email || 'Signed in'}</strong>
            {user.email && user.name ? <span className="subtle">{user.email}</span> : null}
          </div>
          <a
            className="user-menu-item"
            href={adminUrl}
            onClick={(event) => {
              setOpen(false);
              onAdmin(event);
            }}
          >
            <IconSettings size={14} />
            <span>Admin</span>
          </a>
          <button
            type="button"
            className="user-menu-item"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function AppLayout({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const location = useLocation();
  const active = currentCommsPage(location.pathname);
  const adminUrl = 'https://alma-suite-admin.web.app';

  useEffect(() => {
    document.title = `${active.label} · Alma Comms`;
  }, [active.label]);

  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
      onSignedOut();
    }
  }

  function openWithHandoff(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    void createSuiteHandoffUrl(href).then((nextHref) => {
      window.location.assign(nextHref);
    }).catch(() => {
      window.location.assign(href);
    });
  }

  const topBar = (
    <TopBar
      title={active.label}
      subtitle={active.description}
      right={
        <div className="topbar-action-group">
          <SuiteAppSwitcher currentApp="comms" apps={suiteApps} variant="topbar" />
          <SuiteNotificationsWidget api={api} currentApp="comms" />
          <SuiteFeedbackWidget appId="COMMS" api={api} userName={user?.name ?? undefined} />
          <ThemeToggle />
          <SuiteClock />
          <CommsUserMenu
            user={user}
            adminUrl={adminUrl}
            onAdmin={(event) => openWithHandoff(event, adminUrl)}
            onSignOut={() => void signOut()}
          />
        </div>
      }
    />
  );

  return (
    <AppShell
      brand={<ProductLogo appId="comms" size="md" showBrandMark={false} />}
      sidebar={<CommsSidebar />}
      topBar={topBar}
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/venue" element={<FilteredThreadsPage title="Venue messages" eyebrow="Venue comms" category="VENUE" />} />
        <Route path="/announcements" element={<FilteredThreadsPage title="Announcements" eyebrow="Broadcasts" category="ANNOUNCEMENT" />} />
        <Route path="/handover" element={<FilteredThreadsPage title="Shift handover" eyebrow="Handover" category="HANDOVER" />} />
        <Route path="/handover/new" element={<EndOfShiftPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/apps" element={<AppsBounce />} />
        <Route path="*" element={<PageShell title="Page not found" eyebrow="Comms"><Card><p>Choose a Comms page from the navigation, or <a href="https://alma-home.web.app">return to the Alma Suite home</a>.</p></Card></PageShell>} />
      </Routes>
    </AppShell>
  );
}

function Root() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  async function loadUser() {
    try {
      const handoffUser = await consumeSuiteHandoffToken();

      if (handoffUser) {
        setUser(handoffUser);
        return;
      }

      const data = await api<AuthResponse>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    const cleanup = installSuiteHandoff();
    loadUser();
    return cleanup;
  }, []);

  if (user === undefined) {
    return <main className="comms-login"><Card><p>Loading Comms…</p></Card></main>;
  }

  if (!user) {
    return <LoginGate onSignedIn={loadUser} />;
  }

  return (
    <BrowserRouter>
      <AppLayout user={user} onSignedOut={() => setUser(null)} />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<Root />);
