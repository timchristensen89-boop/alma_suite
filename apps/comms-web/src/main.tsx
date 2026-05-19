import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import {
  AppShell,
  Card,
  ProductLogo,
  SuiteAppSwitcher,
  TopBar
} from '@alma/ui';
import {
  IconBriefcase,
  IconChecklist,
  IconDashboard,
  IconFileText,
  IconIssues,
  IconSettings,
  IconStore,
  IconUpload
} from '../../web/src/lib/icons';
import '../../web/src/styles.css';
import './styles.css';

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
  icon: React.ReactNode;
  end?: boolean;
};

const navItems: CommsNavItem[] = [
  { to: '/', label: 'Overview', icon: <IconDashboard />, end: true },
  { to: '/inbox', label: 'Inbox', icon: <IconFileText /> },
  { to: '/venue', label: 'Venue', icon: <IconStore /> },
  { to: '/announcements', label: 'Announcements', icon: <IconIssues /> },
  { to: '/handover', label: 'Handover', icon: <IconBriefcase /> },
  { to: '/tasks', label: 'Tasks', icon: <IconChecklist /> },
  { to: '/compose', label: 'Compose', icon: <IconUpload /> },
  { to: '/settings', label: 'Settings', icon: <IconSettings /> }
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
    <PageShell title="Alma Comms" eyebrow="Operational messages" subtitle="Messages, handovers, alerts, and follow-ups for the group.">
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
    </PageShell>
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

function FilteredThreadsPage({ title, eyebrow, category }: { title: string; eyebrow: string; category: string }) {
  const { threads, loading, message } = useInbox();
  const filtered = useMemo(() => threads.filter((thread) => thread.category === category), [threads, category]);

  return (
    <PageShell title={title} eyebrow={eyebrow}>
      {loading ? <Card><p>Loading…</p></Card> : null}
      {message ? <Card><p className="comms-error">{message}</p></Card> : null}
      {!loading && !message ? <ThreadList threads={filtered} /> : null}
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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
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
          actionRequired
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

function AppLayout({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  const location = window.location.pathname;
  const active =
    [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) =>
      item.to === '/' ? location === '/' : location.startsWith(item.to)
    ) ?? navItems[0]!;

  async function signOut() {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredToken(null);
      onSignedOut();
    }
  }

  const sidebar = (
    <nav className="comms-nav">
      {navItems.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className="comms-nav-link">
          <span className="comms-line-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  const topBar = (
    <TopBar
      title={active.label}
      subtitle="Messages, handovers, alerts, and follow-ups"
      right={
        <div className="topbar-action-group">
          <SuiteAppSwitcher />
          <span>{user.name || user.email || 'Signed in'}</span>
          <a className="comms-admin-link" href="https://alma-suite-admin.web.app">Admin</a>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      }
    />
  );

  return (
    <AppShell
      brand={<ProductLogo appId="comms" size="md" showBrandMark={false} />}
      sidebar={sidebar}
      topBar={topBar}
    >
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/venue" element={<FilteredThreadsPage title="Venue messages" eyebrow="Venue comms" category="VENUE" />} />
        <Route path="/announcements" element={<FilteredThreadsPage title="Announcements" eyebrow="Broadcasts" category="ANNOUNCEMENT" />} />
        <Route path="/handover" element={<FilteredThreadsPage title="Shift handover" eyebrow="Handover" category="HANDOVER" />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/threads/:id" element={<ThreadDetailPage />} />
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<PageShell title="Page not found" eyebrow="Comms"><Card><p>Choose a Comms page from the navigation.</p></Card></PageShell>} />
      </Routes>
    </AppShell>
  );
}

function Root() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  async function loadUser() {
    try {
      const data = await api<AuthResponse>('/api/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    loadUser();
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
