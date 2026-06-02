import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;

type SuiteAnnouncement = {
  id: string;
  title: string;
  body: string;
  createdByName: string | null;
  createdAt: string;
  pinned: boolean;
};

type SuiteChatMessage = {
  id: string;
  body: string;
  createdByName: string | null;
  createdAt: string;
};

type SuiteCommunicationsPayload = {
  announcements: SuiteAnnouncement[];
  chat: SuiteChatMessage[];
};

type Props = {
  appId: string;
  api: ApiClient;
  venue?: string | null;
  userName?: string | null;
  canAnnounce?: boolean;
};

function displayTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function apiPath(path: string) {
  return path.startsWith('/api/') ? path : `/api/${path.replace(/^\/+/, '')}`;
}

// Editorial palette pulled from the Alma Suite design system. Cream surface,
// Cormorant for reading material, Avenir for UI affordances.
const INK = '#1F3524';
const AVATAR_TINTS = ['#4F6B47', '#684A4A', '#A0463A', '#3D5C3F', '#5A3D3D', '#B27935', '#4F627E'];

function initialsFrom(name: string | null | undefined): string {
  if (!name) return 'AS';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return 'AS';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || 'AS';
}

// Pick a stable avatar tint based on the user's name so each contact keeps the
// same color across renders.
function avatarTintFor(name: string | null | undefined): string {
  const fallback = '#4F6B47';
  if (!name) return AVATAR_TINTS[0] ?? fallback;
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % AVATAR_TINTS.length;
  }
  return AVATAR_TINTS[hash] ?? fallback;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function SuiteCommsWidget({ appId, api, venue, userName, canAnnounce = false }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [chatText, setChatText] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [data, setData] = useState<SuiteCommunicationsPayload>({ announcements: [], chat: [] });
  // Suite-wide unread count from the user's Comms inbox. Server-tracked
  // (CommsRecipient.readAt) so the badge is identical on every app.
  const [unreadCount, setUnreadCount] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ appId, channel: 'general' });
    if (venue) params.set('venue', venue);
    return params.toString();
  }, [appId, venue]);

  const close = useCallback(() => setOpen(false), []);
  useDismissibleLayer(layerRef, open, close, `${appId}-messages`);

  async function load() {
    setLoading(true);
    setMessage('');
    try {
      setData(await api<SuiteCommunicationsPayload>(apiPath(`/communications?${query}`)));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load chat.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, query]);

  // Poll the user's suite-wide inbox for a real unread badge — same number
  // on every app, regardless of which app's chat the panel is showing.
  useEffect(() => {
    let cancelled = false;
    const loadUnread = async () => {
      try {
        const inbox = await api<Array<{ unread?: boolean; actionRequired?: boolean }>>(apiPath('/comms/inbox'));
        if (cancelled) return;
        const count = Array.isArray(inbox)
          ? inbox.filter((thread) => thread.unread || thread.actionRequired).length
          : 0;
        setUnreadCount(count);
      } catch {
        // Older API builds may not expose the inbox — hide the badge quietly.
        if (!cancelled) setUnreadCount(0);
      }
    };
    void loadUnread();
    const intervalId = window.setInterval(() => void loadUnread(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatText.trim()) return;
    setMessage('');
    try {
      await api<SuiteChatMessage>(apiPath('/communications/chat'), {
        method: 'POST',
        body: JSON.stringify({
          appId,
          venue: venue ?? '',
          channel: 'general',
          body: chatText.trim()
        })
      });
      setChatText('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not send chat message.');
    }
  }

  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!announcementTitle.trim() || !announcementBody.trim()) return;
    setMessage('');
    try {
      await api<SuiteAnnouncement>(apiPath('/communications/announcements'), {
        method: 'POST',
        body: JSON.stringify({
          title: announcementTitle.trim(),
          body: announcementBody.trim(),
          appId,
          venue: venue ?? '',
          audience: 'ALL',
          pinned: true
        })
      });
      setAnnouncementTitle('');
      setAnnouncementBody('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not publish announcement.');
    }
  }

  // We don't have per-user read receipts yet, so this is "loaded recently"
  // rather than true unread-to-you. Label it accurately so the badge isn't
  // dishonest. Real read state is on the to-do.
  const recentCount = data.announcements.length + data.chat.length;
  const totalCount = recentCount;

  return (
    <div ref={layerRef} className="suite-msg-anchor">
      <button
        type="button"
        className="btn btn-secondary suite-msg-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-label={unreadCount > 0 ? `Messages, ${unreadCount > 9 ? '9 plus' : unreadCount} unread` : 'Messages'}
        aria-expanded={open}
        title={unreadCount > 0 ? `Messages (${unreadCount > 9 ? '9+' : unreadCount})` : 'Messages'}
      >
        <span className="suite-msg-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 6.5h15v10h-15z" />
            <path d="m5 7 7 6 7-6" />
          </svg>
        </span>
        <span className="suite-msg-trigger-label">Messages</span>
        {unreadCount > 0 ? (
          <span className="suite-msg-trigger-count" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="suite-msg-panel" role="dialog" aria-label="Messages">
          <button
            type="button"
            className="suite-msg-close suite-msg-close--corner"
            onClick={() => setOpen(false)}
            aria-label="Close messages"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
            </svg>
          </button>

          <div className="suite-msg-head">
            <div>
              <span className="suite-msg-eyebrow">Alma Suite · Team</span>
              <strong className="suite-msg-title">Team chat &amp; announcements</strong>
            </div>
            {recentCount > 0 ? (
              <span className="suite-msg-pill" title="Loaded recently. Per-user unread state is coming.">{recentCount} recent</span>
            ) : null}
          </div>

          {message ? <p className="suite-msg-error">{message}</p> : null}

          <form onSubmit={submitChat} className="suite-msg-compose">
            <input
              className="suite-msg-compose-input"
              value={chatText}
              onChange={(event) => setChatText(event.currentTarget.value)}
              placeholder={`Message the team as ${userName || 'you'}`}
            />
            <button type="submit" className="suite-msg-compose-send" aria-label="Send">
              Send
            </button>
          </form>

          {loading ? <p className="suite-msg-subtle">Loading messages…</p> : null}

          {data.announcements.length > 0 ? (
            <>
              <SuiteMsgDivider label="Pinned" />
              {data.announcements.map((announcement) => (
                <MessageRow
                  key={announcement.id}
                  who={announcement.createdByName || 'ALMA'}
                  role={announcement.pinned ? 'Pinned announcement' : 'Announcement'}
                  subject={announcement.title}
                  snippet={announcement.body}
                  time={formatRelativeTime(announcement.createdAt)}
                  unread
                />
              ))}
            </>
          ) : null}

          <SuiteMsgDivider label={data.chat.length > 0 ? 'Recent' : 'General team chat'} />
          {data.chat.length === 0 && data.announcements.length === 0 && !loading ? (
            <div className="suite-msg-empty">
              No messages yet. Anything you post here lands in the Comms inbox.
            </div>
          ) : (
            data.chat.map((item) => (
              <MessageRow
                key={item.id}
                who={item.createdByName || 'Team'}
                role="Team chat"
                subject={item.body}
                snippet=""
                time={formatRelativeTime(item.createdAt)}
              />
            ))
          )}

          {canAnnounce ? (
            <form onSubmit={submitAnnouncement} className="suite-msg-announcement">
              <span className="suite-msg-eyebrow">New announcement</span>
              <input
                className="suite-msg-compose-input"
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.currentTarget.value)}
                placeholder="Title"
              />
              <textarea
                className="suite-msg-textarea"
                value={announcementBody}
                onChange={(event) => setAnnouncementBody(event.currentTarget.value)}
                placeholder="What should the team know?"
                rows={3}
              />
              <button type="submit" className="suite-msg-compose-send">
                Publish announcement
              </button>
            </form>
          ) : null}

          <div className="suite-msg-footer">
            <span className="suite-msg-eyebrow suite-msg-eyebrow--muted">
              {totalCount} in inbox
            </span>
            <span className="suite-msg-eyebrow suite-msg-eyebrow--muted">
              {venue || 'All venues'}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SuiteMsgDivider({ label }: { label: string }) {
  return (
    <div className="suite-msg-divider">
      <span className="suite-msg-eyebrow">{label}</span>
      <span className="suite-msg-divider-line" />
    </div>
  );
}

type MessageRowProps = {
  who: string;
  role: string;
  subject: string;
  snippet?: string;
  time: string;
  unread?: boolean;
};

function MessageRow({ who, role, subject, snippet, time, unread = false }: MessageRowProps) {
  return (
    <div className={`suite-msg-row ${unread ? 'is-unread' : ''}`}>
      <span
        className="suite-msg-avatar"
        style={{ background: avatarTintFor(who) }}
        aria-hidden="true"
      >
        {initialsFrom(who)}
      </span>
      <div className="suite-msg-body">
        <div className="suite-msg-meta">
          <span className="suite-msg-name">{who}</span>
          {role ? <span className="suite-msg-role">· {role}</span> : null}
          <span className="suite-msg-time">{time}</span>
        </div>
        <div className="suite-msg-subject">{subject}</div>
        {snippet ? <div className="suite-msg-snippet">{snippet}</div> : null}
      </div>
      {unread ? <span className="suite-msg-dot" aria-label="Unread" /> : null}
    </div>
  );
}

// Suppress unused-var noise from helpers kept for callers that import them
void INK;
void displayTime;
