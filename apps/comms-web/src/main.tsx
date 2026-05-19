import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';

const navItems = [
  { to: '/', label: 'Home', icon: '⌂', end: true },
  { to: '/inbox', label: 'Inbox', icon: '□' },
  { to: '/venue', label: 'Venue', icon: '✉' },
  { to: '/announcements', label: 'Announcements', icon: '!' },
  { to: '/handover', label: 'Handover', icon: '↪' },
  { to: '/tasks', label: 'Tasks', icon: '✓' },
  { to: '/compose', label: 'Compose', icon: '+' },
  { to: '/settings', label: 'Settings', icon: '⚙' }
];

function PageShell({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <section className="comms-page">
      <p className="comms-eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <article className="comms-card">{children}</article>;
}

function PlaceholderPage({ title, eyebrow, body }: { title: string; eyebrow: string; body: string }) {
  return (
    <PageShell title={title} eyebrow={eyebrow}>
      <Card>
        <p>{body}</p>
      </Card>
    </PageShell>
  );
}

function HomePage() {
  return (
    <PageShell title="Alma Comms" eyebrow="Operational messages">
      <div className="comms-grid">
        <Card>
          <h2>Inbox</h2>
          <p>Messages, announcements, handovers, and follow-ups that need attention.</p>
        </Card>
        <Card>
          <h2>Venue handover</h2>
          <p>Keep opening, service, and closing notes visible for the next person.</p>
        </Card>
        <Card>
          <h2>Alerts</h2>
          <p>Major issues such as high forecast COGS, stock variance, fridge temperature, and failed checks will land here first.</p>
        </Card>
      </div>
    </PageShell>
  );
}

function AppLayout() {
  const location = useLocation();
  const active =
    [...navItems].sort((a, b) => b.to.length - a.to.length).find((item) =>
      item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)
    ) ?? navItems[0]!;

  return (
    <div className="comms-shell">
      <aside className="comms-sidebar">
        <div className="comms-brand">
          <strong>Alma Comms</strong>
          <span>Messages</span>
        </div>
        <nav className="comms-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="comms-nav-link">
              <span className="comms-line-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="comms-main">
        <header className="comms-topbar">
          <div>
            <p>Alma Suite</p>
            <h2>{active.label}</h2>
          </div>
          <a className="comms-admin-link" href="https://alma-suite-admin.web.app">
            Alma Admin
          </a>
        </header>

        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/inbox" element={<PlaceholderPage title="Inbox" eyebrow="Personal messages" body="Read/unread inbox and acknowledgements will live here." />} />
          <Route path="/venue" element={<PlaceholderPage title="Venue messages" eyebrow="Venue comms" body="Venue announcements and operational threads will appear here." />} />
          <Route path="/announcements" element={<PlaceholderPage title="Announcements" eyebrow="Broadcasts" body="Manager and admin announcements will be managed here." />} />
          <Route path="/handover" element={<PlaceholderPage title="Shift handover" eyebrow="Handover" body="Opening, service, and closing handover notes will live here." />} />
          <Route path="/tasks" element={<PlaceholderPage title="Follow-ups" eyebrow="Action messages" body="Alerts and operational follow-ups will appear here." />} />
          <Route path="/compose" element={<PlaceholderPage title="New message" eyebrow="Compose" body="Compose will support staff, venue, role, and manager audiences." />} />
          <Route path="/settings" element={<PlaceholderPage title="Comms settings" eyebrow="Admin only" body="Comms permissions, alert rules, and notification settings will be configured here." />} />
          <Route path="*" element={<PlaceholderPage title="Page not found" eyebrow="Comms" body="Choose a Comms page from the left navigation." />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
