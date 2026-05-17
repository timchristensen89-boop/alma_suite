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

const panelStyle = {
  position: 'fixed',
  right: 12,
  top: 72,
  width: 'min(420px, calc(100vw - 24px))',
  maxHeight: 'calc(100vh - 92px)',
  overflow: 'auto',
  zIndex: 220,
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

const cardStyle = {
  padding: 12,
  borderRadius: 12,
  background: '#f8fafc',
  border: '1px solid rgba(148, 163, 184, 0.2)'
} as const;

export function SuiteCommsWidget({ appId, api, venue, userName, canAnnounce = false }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
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
    <div ref={layerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        Messages
      </button>
      {open ? (
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
            <div>
              <strong style={{ display: 'block', color: '#0f172a' }}>Team messages</strong>
              <span style={{ color: '#64748b', fontSize: 13 }}>
                Announcements and general chat for {venue || 'all venues'}
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
              <p className="subtle">No announcements are pinned for this app.</p>
            ) : (
              data.announcements.map((announcement) => (
                <article key={announcement.id} style={cardStyle}>
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
            <strong>General team chat</strong>
            <div style={{ display: 'grid', gap: 8 }}>
              {data.chat.length === 0 ? (
                <p className="subtle">No general chat messages yet. Use Staff communications for direct messages.</p>
              ) : (
                data.chat.map((item) => (
                  <div key={item.id} style={{ ...cardStyle, display: 'grid', gap: 4 }}>
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
                placeholder={`General message as ${userName || 'team'}`}
              />
              <button className="btn btn-primary" type="submit">
                Send
              </button>
            </form>
            <p className="subtle" style={{ margin: 0 }}>
              Direct one-to-one chat is managed inside the Staff app so recipient permissions stay clear.
            </p>
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
