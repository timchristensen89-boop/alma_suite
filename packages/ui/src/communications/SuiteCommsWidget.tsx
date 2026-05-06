import { FormEvent, useEffect, useMemo, useState } from 'react';

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

const panelStyle = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 10px)',
  width: 'min(420px, calc(100vw - 24px))',
  maxHeight: '72vh',
  overflow: 'auto',
  zIndex: 120,
  padding: 16,
  borderRadius: 16,
  border: '1px solid rgba(148, 163, 184, 0.35)',
  background: '#fff',
  boxShadow: '0 24px 70px rgba(15, 23, 42, 0.22)'
} as const;

const sectionStyle = {
  display: 'grid',
  gap: 10,
  padding: '12px 0',
  borderTop: '1px solid rgba(148, 163, 184, 0.22)'
} as const;

export function SuiteCommsWidget({ appId, api, venue, userName, canAnnounce = false }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [chatText, setChatText] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [data, setData] = useState<SuiteCommunicationsPayload>({ announcements: [], chat: [] });

  const query = useMemo(() => {
    const params = new URLSearchParams({ appId, channel: 'general' });
    if (venue) params.set('venue', venue);
    return params.toString();
  }, [appId, venue]);

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

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Chat
      </button>
      {open ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
            <div>
              <strong style={{ display: 'block', color: '#0f172a' }}>Team chat</strong>
              <span style={{ color: '#64748b', fontSize: 13 }}>
                Announcements and messages for {venue || 'all venues'}
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </div>

          {message ? <p className="error-text">{message}</p> : null}
          {loading ? <p className="subtle">Loading messages...</p> : null}

          <div style={sectionStyle}>
            <strong>Announcements</strong>
            {data.announcements.length === 0 ? (
              <p className="subtle">No announcements yet.</p>
            ) : (
              data.announcements.map((announcement) => (
                <article key={announcement.id} style={{ padding: 10, borderRadius: 12, background: '#f8fafc' }}>
                  <strong>{announcement.title}</strong>
                  <p style={{ margin: '4px 0 0', color: '#475569' }}>{announcement.body}</p>
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>
                    {announcement.createdByName || 'ALMA'} · {displayTime(announcement.createdAt)}
                  </span>
                </article>
              ))
            )}
          </div>

          <div style={sectionStyle}>
            <strong>Messages</strong>
            <div style={{ display: 'grid', gap: 8 }}>
              {data.chat.length === 0 ? (
                <p className="subtle">Start the team chat for today.</p>
              ) : (
                data.chat.map((item) => (
                  <div key={item.id} style={{ display: 'grid', gap: 2 }}>
                    <span style={{ color: '#64748b', fontSize: 12 }}>
                      {item.createdByName || 'Team'} · {displayTime(item.createdAt)}
                    </span>
                    <span style={{ color: '#0f172a' }}>{item.body}</span>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={submitChat} style={{ display: 'flex', gap: 8 }}>
              <input
                className="field-control"
                value={chatText}
                onChange={(event) => setChatText(event.currentTarget.value)}
                placeholder={`Message as ${userName || 'team'}`}
              />
              <button className="btn btn-primary" type="submit">
                Send
              </button>
            </form>
          </div>

          {canAnnounce ? (
            <form onSubmit={submitAnnouncement} style={sectionStyle}>
              <strong>New announcement</strong>
              <input
                className="field-control"
                value={announcementTitle}
                onChange={(event) => setAnnouncementTitle(event.currentTarget.value)}
                placeholder="Title"
              />
              <textarea
                className="field-textarea"
                value={announcementBody}
                onChange={(event) => setAnnouncementBody(event.currentTarget.value)}
                placeholder="What should the team know?"
                rows={3}
              />
              <button className="btn btn-primary" type="submit">
                Publish announcement
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
