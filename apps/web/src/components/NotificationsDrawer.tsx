import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconButton } from '@alma/ui';
import { api } from '../lib/api';
import { IconBell, IconClock, IconIncident, IconIssues, IconStaff, IconTemperature } from '../lib/icons';

type Tone = 'danger' | 'warning' | 'info' | 'positive';
type Notification = {
  id: string;
  tone: Tone;
  title: string;
  description: string;
  to: string;
  createdAt: string;
};

function iconFor(id: string) {
  if (id.startsWith('temp-')) return <IconTemperature size={14} />;
  if (id.startsWith('staff-')) return <IconStaff size={14} />;
  if (id.startsWith('incident-')) return <IconIncident size={14} />;
  if (id.startsWith('issue-overdue-')) return <IconClock size={14} />;
  return <IconIssues size={14} />;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function NotificationsDrawer() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api<Notification[]>('/api/notifications');
      setItems(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  // Load once on mount so the badge dot can reflect real state even before
  // the drawer is opened.
  useEffect(() => {
    void load();
    const intervalId = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const hasAny = items.length > 0;

  return (
    <div className="notifications-wrap">
      <IconButton
        label={`Notifications${hasAny ? ` (${items.length})` : ''}`}
        icon={<IconBell size={16} />}
        onClick={() => setOpen((prev) => !prev)}
        className={hasAny ? 'has-notifications' : ''}
      />
      {hasAny ? <span className="notifications-dot" aria-hidden="true" /> : null}

      {open ? (
        <>
          <div className="notifications-backdrop" onClick={() => setOpen(false)} />
          <div className="notifications-panel">
            <div className="notifications-head">
              <strong>Notifications</strong>
              <span className="subtle">{loading ? 'Refreshing…' : `${items.length} items`}</span>
            </div>
            <div className="notifications-body">
              {items.length === 0 ? (
                <div className="notifications-empty">
                  Nothing to flag right now — everything is in range, in date, and on time.
                </div>
              ) : (
                items.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={`notification tone-${item.tone}`}
                    onClick={() => setOpen(false)}
                  >
                    <span className="notification-icon">{iconFor(item.id)}</span>
                    <span className="notification-body">
                      <strong>{item.title}</strong>
                      <span className="subtle">{item.description}</span>
                      <span className="notification-meta">{timeAgo(item.createdAt)}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
