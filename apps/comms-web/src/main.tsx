import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
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

const navItems = [
  { to: '/', label: 'Overview', icon: '⌂', end: true },
  { to: '/inbox', label: 'Inbox', icon: '□' },
  { to: '/venue', label: 'Venue', icon: '✉' },
  { to: '/announcements', label: 'Announcements', icon: '!' },
  { to: '/handover', label: 'Handover', icon: '↪' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/compose', label: 'Compose', icon: '+' },
  { to: '/settings', label: 'Settings', icon: '⚙' }
];

const suiteApps = [
  { label: 'Compliance', href: 'https://alma-compliance.web.app', tone: 'red', icon: '◈' },
  { label: 'Stock', href: 'https://alma-stock-v18.web.app', tone: 'green', icon: '●' },
  { label: 'Reports', href: 'https://alma-reports.web.app', tone: 'slate', icon: '▥' },
  { label: 'Staff', href: 'https://alma-staff.web.app', tone: 'blue', icon: '♟' },
  { label: 'Handbook', href: 'https://alma-compliance.web.app/handbook', tone: 'teal', icon: '▣' },
  { label: 'Search', href: 'https://alma-marketing.web.app', tone: 'pink', icon: '⌕' },
  { label: 'Docs', href: 'https://alma-giftcards.web.app', tone: 'gold', icon: '▤' },
  { label: 'Admin', href: 'https://alma-suite-admin.web.app', tone: 'dark', icon: '⚙' },
  { label: 'Comms', href: 'https://alma-comms.web.app', tone: 'purple', icon: '✉' }
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

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <article className={`suite-card ${className}`.trim()}>{children}</article>;
}

function AppTile({ app }: { app: typeof suiteApps[number] }) {
  return (
    <a className={`suite-app-tile tone-${app.tone}`} href={app.href} title={app.label}>
      <span>{app.icon}</span>
    </a>
  );
}

function PageShell({ title, eyebrow, subtitle, children }: { title: string; eyebrow: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="suite-page">
      <p className="suite-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {subtitle ? <p className="suite-subtitle">{subtitle}</p> : null}
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
      await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      onSignedIn();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="suite-login">
      <Card className="suite-login-card">
        <div className="suite-product-lockup compact">
          <span className="suite-product-mark">✉</span>
          <div>
            <strong>ALMA Suites</strong>
            <span>COMMS</span>
          </div>
        </div>
        <h1>Sign in to Comms</h1>
        <p>Messages, handovers, alerts, and follow-ups are restricted to authorised Alma users.</p>
        <form onSubmit={submit} className="suite-form">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {message ? <p className="suite-error">{message}</p> : null}
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
        <p className="suite-muted">There are no Comms items in this view.</p>
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
      <div className="suite-grid">
        <Card>
          <h2>Inbox</h2>
          <p className="suite-muted">Messages, announcements, handovers, and follow-ups that need attention.</p>
          <NavLink className="suite-button ghost" to="/inbox">Open inbox</NavLink>
        </Card>
        <Card>
          <h2>Venue handover</h2>
          <p className="suite-muted">Keep opening, service, and closing notes visible for the next person.</p>
          <NavLink className="suite-button ghost" to="/handover">Open handover</NavLink>
        </Card>
        <Card>
          <h2>Alerts</h2>
          <p className="suite-muted">COGS, stock variance, fridge temperature, and failed checks will land here first.</p>
          <NavLink className="suite-button ghost" to="/tasks">Review alerts</NavLink>
        </Card>
      </div>

      <Card>
        <div className="section-heading">
          <div>
            <h2>Needs attention</h2>
            <p className="suite-muted">Urgent, high-priority, or action-required threads.</p>
          </div>
        </div>
        {loading ? <p>Loading…</p> : null}
        {message ? <p className="suite-error">{message}</p> : null}
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
        <NavLink className="suite-button" to="/compose">New message</NavLink>
      </div>
      {loading ? <Card><p>Loading inbox…</p></Card> : null}
      {message ? <Card><p className="suite-error">{message}</p></Card> : null}
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
      {message ? <Card><p className="suite-error">{message}</p></Card> : null}
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
            <p className="suite-muted">Checks alert rules without sending emails.</p>
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
      {message ? <Card><p className="suite-error">{message}</p></Card> : null}
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
      {message ? <Card><p className="suite-error">{message}</p></Card> : null}
      {thread ? (
        <>
          <Card>
            <div className="section-heading">
              <div>
                <h2>{thread.subject}</h2>
                <p className="suite-muted">{thread.venue || 'All venues'} · {thread.category} · {thread.priority}</p>
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
            <form onSubmit={sendReply} className="suite-form">
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
        <form onSubmit={submit} className="suite-form">
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
          {message ? <p className="suite-error">{message}</p> : null}
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
        <p className="suite-muted">Roster forecast COGS, stock variance, fridge temperatures, checklist failures, and expiring documents will be configured here.</p>
        <p className="suite-muted">Email sending is not enabled yet. Alerts should create Comms tasks first, then email managers only when explicitly configured.</p>
      </Card>
    </PageShell>
  );
}

function AppLayout({ user, onSignedOut }: { user: AuthUser; onSignedOut: () => void }) {
  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      onSignedOut();
    }
  }

  return (
    <div className="suite-shell">
      <header className="suite-topbar">
        <div className="suite-product-lockup">
          <span className="suite-product-mark">✉</span>
          <div>
            <strong>ALMA Suites</strong>
            <span>COMMS</span>
          </div>
        </div>

        <div className="suite-topbar-menu">
          <NavLink to="/" className="suite-topbar-chip">Overview</NavLink>
          <NavLink to="/inbox" className="suite-topbar-chip">Inbox</NavLink>
          <NavLink to="/tasks" className="suite-topbar-chip">Tasks</NavLink>
          <NavLink to="/compose" className="suite-topbar-chip">Compose</NavLink>
        </div>

        <div className="suite-topbar-actions">
          <span>{user.name || user.email || 'Signed in'}</span>
          <a className="suite-admin-link" href="https://alma-suite-admin.web.app">Admin</a>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="suite-app-row">
        <div className="suite-apps">
          {suiteApps.map((app) => <AppTile key={app.label} app={app} />)}
        </div>
      </div>

      <main className="suite-content">
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
      </main>
    </div>
  );
}

function Root() {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);

  async function loadUser() {
    try {
      const data = await api<AuthResponse>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }

  useEffect(() => {
    loadUser();
  }, []);

  if (user === undefined) {
    return <main className="suite-login"><Card><p>Loading Comms…</p></Card></main>;
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
