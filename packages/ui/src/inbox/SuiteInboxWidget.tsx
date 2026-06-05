import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from 'react';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';

type ApiClient = <T>(path: string, init?: RequestInit) => Promise<T>;

/* ─────────────────────────────────────────────────────────────────────────
 * Unified Suite Inbox — one trigger, one popup, two tabs.
 *
 * Replaces the separate SuiteNotificationsWidget (Alerts) and SuiteCommsWidget
 * (Messages) buttons in the topbar. Both data sources are server-backed and
 * user-scoped, so the same alerts, read-state and unread counts appear in
 * every app. The widget re-syncs whenever the tab/app regains focus so
 * switching between apps reflects the latest server state immediately.
 * ───────────────────────────────────────────────────────────────────────── */

type Props = {
  api: ApiClient;
  /** Lowercase app id used for the notifications layer + scoping (e.g. 'reports'). */
  currentApp?: string;
  /** Uppercase comms app id used when posting chat/announcements (e.g. 'REPORTS'). */
  appId: string;
  venue?: string | null;
  userName?: string | null;
  canAnnounce?: boolean;
  /** Which tab opens first. Defaults to alerts. */
  defaultTab?: InboxTab;
};

type InboxTab = 'alerts' | 'messages';

/* ── Alerts (notifications) types ──────────────────────────────────────── */
type SuiteNotification = {
  id: string;
  tone: 'danger' | 'warning' | 'info' | 'positive';
  category?: string;
  categoryLabel?: string;
  title: string;
  description: string;
  to?: string;
  href?: string;
  appId?: string;
  appLabel?: string;
  createdAt: string;
  readAt?: string | null;
};

type NotificationMutes = {
  available: Array<{ category: string; label: string }>;
  muted: string[];
};

type ReadOverrides = Record<string, boolean>;

type AlertSeverity = 'critical' | 'today' | 'thisWeek';

const TONE_TO_SEVERITY: Record<SuiteNotification['tone'], AlertSeverity> = {
  danger: 'critical',
  warning: 'today',
  info: 'thisWeek',
  positive: 'thisWeek'
};

const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critical · now',
  today: 'Today',
  thisWeek: 'This week'
};

const SEVERITY_COLOR: Record<AlertSeverity, string> = {
  critical: '#A0463A',
  today: '#B27935',
  thisWeek: '#4F627E'
};

const APP_CHIP_PALETTE: Record<string, { bg: string; fg: string }> = {
  compliance: { bg: '#A0463A', fg: '#FBEFE8' },
  stock: { bg: '#3D5C3F', fg: '#EDF1E2' },
  reports: { bg: '#B27935', fg: '#FBF1DC' },
  staff: { bg: '#4F627E', fg: '#EDF1F6' },
  reserve: { bg: '#1F2A1E', fg: '#E6E8DD' },
  marketing: { bg: '#5A3D3D', fg: '#F0E0DC' },
  comms: { bg: '#6E7682', fg: '#F4F6F9' },
  giftcards: { bg: '#E6B895', fg: '#3D2218' },
  settings: { bg: '#1A1A18', fg: '#E6E2D8' },
  admin: { bg: '#1A1A18', fg: '#E6E2D8' }
};

function chipFor(appId: string | undefined): { bg: string; fg: string } {
  if (!appId) return { bg: '#1F3524', fg: '#F8F0E6' };
  return APP_CHIP_PALETTE[appId] ?? { bg: '#1F3524', fg: '#F8F0E6' };
}

function appInitial(appId: string | undefined, appLabel: string | undefined): string {
  const source = appLabel || appId || 'A';
  return source.charAt(0).toUpperCase();
}

function timeAgo(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toISOString().slice(0, 10);
}

function targetFor(item: SuiteNotification) {
  return item.href ?? item.to ?? '#';
}

function openWithSuiteHandoff(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href || href === '#') return;
  const handoff = (globalThis as typeof globalThis & {
    almaCreateSuiteHandoffUrl?: (href: string) => Promise<string>;
  }).almaCreateSuiteHandoffUrl;
  if (!handoff) return;
  event.preventDefault();
  void handoff(href).then((handoffHref) => {
    window.location.assign(handoffHref);
  }).catch(() => {
    window.location.assign(href);
  });
}

/* ── Messages (comms) types ────────────────────────────────────────────── */
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

const AVATAR_TINTS = ['#4F6B47', '#684A4A', '#A0463A', '#3D5C3F', '#5A3D3D', '#B27935', '#4F627E'];

function initialsFrom(name: string | null | undefined): string {
  if (!name) return 'AS';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  if (parts.length === 0) return 'AS';
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || 'AS';
}

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

function commsApiPath(path: string) {
  return path.startsWith('/api/') ? path : `/api/${path.replace(/^\/+/, '')}`;
}

export function SuiteInboxWidget({
  api,
  currentApp = 'suite',
  appId,
  venue,
  userName,
  canAnnounce = false,
  defaultTab = 'alerts'
}: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<InboxTab>(defaultTab);

  const close = useCallback(() => setOpen(false), []);
  useDismissibleLayer(layerRef, open, close, `${currentApp}-inbox`);

  /* ── Alerts state ───────────────────────────────────────────────────── */
  const [items, setItems] = useState<SuiteNotification[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertsMessage, setAlertsMessage] = useState('');
  const [overrides, setOverrides] = useState<ReadOverrides>({});
  const [showRead, setShowRead] = useState(false);
  const [mutes, setMutes] = useState<NotificationMutes | null>(null);
  const [showMutes, setShowMutes] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | AlertSeverity>('all');

  const loadMutes = useCallback(async () => {
    try {
      setMutes(await api<NotificationMutes>('/api/notifications/mutes'));
    } catch {
      setMutes(null);
    }
  }, [api]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsMessage('');
    try {
      const payload = await api<SuiteNotification[]>('/api/notifications');
      setItems(Array.isArray(payload) ? payload : []);
      setOverrides({});
    } catch (error) {
      setAlertsMessage(error instanceof Error ? error.message : 'Could not load notifications.');
    } finally {
      setAlertsLoading(false);
    }
  }, [api]);

  const toggleMute = useCallback(
    async (category: string | undefined, muted: boolean) => {
      if (!category || muteBusy) return;
      setMuteBusy(true);
      try {
        await api('/api/notifications/mutes', {
          method: 'POST',
          body: JSON.stringify({ category, muted })
        });
        await Promise.all([loadAlerts(), loadMutes()]);
      } catch (error) {
        setAlertsMessage(error instanceof Error ? error.message : 'Could not update notification settings.');
      } finally {
        setMuteBusy(false);
      }
    },
    [api, loadAlerts, loadMutes, muteBusy]
  );

  const isReadItem = useCallback(
    (item: SuiteNotification) => {
      const override = overrides[item.id];
      if (override !== undefined) return override;
      return Boolean(item.readAt);
    },
    [overrides]
  );

  const markRead = useCallback(
    (id: string) => {
      setOverrides((current) => ({ ...current, [id]: true }));
      void api('/api/notifications/reads', {
        method: 'POST',
        body: JSON.stringify({ ids: [id] })
      }).catch(() => undefined);
    },
    [api]
  );

  const markAllRead = useCallback(() => {
    setOverrides((current) => {
      const next = { ...current };
      for (const item of items) next[item.id] = true;
      return next;
    });
    void api('/api/notifications/reads', {
      method: 'POST',
      body: JSON.stringify({ all: true })
    }).catch(() => undefined);
  }, [api, items]);

  const clearAllRead = useCallback(() => {
    setOverrides((current) => {
      const next = { ...current };
      for (const item of items) next[item.id] = false;
      return next;
    });
    void api('/api/notifications/reads', { method: 'DELETE' })
      .catch(() => undefined)
      .then(() => void loadAlerts());
  }, [api, items, loadAlerts]);

  const { unreadItems, readItems } = useMemo(() => {
    const unread: SuiteNotification[] = [];
    const read: SuiteNotification[] = [];
    for (const item of items) {
      if (isReadItem(item)) read.push(item);
      else unread.push(item);
    }
    return { unreadItems: unread, readItems: read };
  }, [items, isReadItem]);

  const displayItems = showRead ? items : unreadItems;
  const alertsUnread = unreadItems.length;

  const buckets = useMemo(() => {
    const out: Record<AlertSeverity, SuiteNotification[]> = { critical: [], today: [], thisWeek: [] };
    for (const item of displayItems) out[TONE_TO_SEVERITY[item.tone]].push(item);
    return out;
  }, [displayItems]);

  const filteredOrder: AlertSeverity[] = filter === 'all' ? ['critical', 'today', 'thisWeek'] : [filter];

  /* ── Messages state ─────────────────────────────────────────────────── */
  const [data, setData] = useState<SuiteCommunicationsPayload>({ announcements: [], chat: [] });
  const [commsLoading, setCommsLoading] = useState(false);
  const [commsMessage, setCommsMessage] = useState('');
  const [chatText, setChatText] = useState('');
  const [announcementTitle, setAnnouncementTitle] = useState('');
  const [announcementBody, setAnnouncementBody] = useState('');
  const [messagesUnread, setMessagesUnread] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({ appId, channel: 'general' });
    if (venue) params.set('venue', venue);
    return params.toString();
  }, [appId, venue]);

  const loadComms = useCallback(async () => {
    setCommsLoading(true);
    setCommsMessage('');
    try {
      setData(await api<SuiteCommunicationsPayload>(commsApiPath(`/communications?${query}`)));
    } catch (error) {
      setCommsMessage(error instanceof Error ? error.message : 'Could not load chat.');
    } finally {
      setCommsLoading(false);
    }
  }, [api, query]);

  const loadMessagesUnread = useCallback(async () => {
    try {
      const inbox = await api<Array<{ unread?: boolean; actionRequired?: boolean }>>(commsApiPath('/comms/inbox'));
      setMessagesUnread(
        Array.isArray(inbox) ? inbox.filter((thread) => thread.unread || thread.actionRequired).length : 0
      );
    } catch {
      setMessagesUnread(0);
    }
  }, [api]);

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chatText.trim()) return;
    setCommsMessage('');
    try {
      await api<SuiteChatMessage>(commsApiPath('/communications/chat'), {
        method: 'POST',
        body: JSON.stringify({ appId, venue: venue ?? '', channel: 'general', body: chatText.trim() })
      });
      setChatText('');
      await loadComms();
    } catch (error) {
      setCommsMessage(error instanceof Error ? error.message : 'Could not send chat message.');
    }
  }

  async function submitAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!announcementTitle.trim() || !announcementBody.trim()) return;
    setCommsMessage('');
    try {
      await api<SuiteAnnouncement>(commsApiPath('/communications/announcements'), {
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
      await loadComms();
    } catch (error) {
      setCommsMessage(error instanceof Error ? error.message : 'Could not publish announcement.');
    }
  }

  const recentCount = data.announcements.length + data.chat.length;

  /* ── Polling + cross-app re-sync ────────────────────────────────────── */
  // Badge counts (alerts + messages) stay live in the background. The full
  // alert/comms lists load on demand when the relevant tab is shown.
  useEffect(() => {
    void loadAlerts();
    void loadMutes();
    void loadMessagesUnread();
    const intervalId = window.setInterval(() => {
      void loadAlerts();
      void loadMessagesUnread();
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [loadAlerts, loadMutes, loadMessagesUnread]);

  // Re-sync the moment this tab/app regains focus, so switching between Alma
  // apps reflects the latest server-side read-state right away.
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      void loadAlerts();
      void loadMessagesUnread();
      if (open && tab === 'messages') void loadComms();
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [loadAlerts, loadMessagesUnread, loadComms, open, tab]);

  // Load the active tab's full content when the popover opens / tab switches.
  useEffect(() => {
    if (!open) return;
    if (tab === 'alerts') {
      void loadAlerts();
      void loadMutes();
    } else {
      void loadComms();
    }
  }, [open, tab, loadAlerts, loadMutes, loadComms]);

  const totalUnread = alertsUnread + messagesUnread;

  return (
    <div ref={layerRef} className="suite-inbox-anchor suite-alert-anchor">
      <button
        type="button"
        className="btn btn-secondary suite-alert-trigger suite-inbox-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-label={totalUnread > 0 ? `Inbox, ${totalUnread > 9 ? '9 plus' : totalUnread} unread` : 'Inbox'}
        aria-expanded={open}
        title={totalUnread > 0 ? `Inbox (${totalUnread > 9 ? '9+' : totalUnread})` : 'Alerts & messages'}
      >
        <span className="suite-alert-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" />
            <path d="M10 20a2.2 2.2 0 0 0 4 0" />
          </svg>
        </span>
        <span className="suite-alert-trigger-label">Inbox</span>
        {totalUnread > 0 ? (
          <span className="suite-alert-trigger-count" aria-hidden="true">
            {totalUnread > 9 ? '9+' : totalUnread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="suite-alert-panel suite-inbox-panel" role="dialog" aria-label="Alerts and messages">
          <button
            type="button"
            className="suite-alert-close suite-alert-close--corner"
            onClick={() => setOpen(false)}
            aria-label="Close inbox"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5" />
            </svg>
          </button>

          {/* Tab selector */}
          <div className="suite-inbox-tabs" role="tablist" aria-label="Inbox sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'alerts'}
              className={`suite-inbox-tab ${tab === 'alerts' ? 'is-active' : ''}`}
              onClick={() => setTab('alerts')}
            >
              Alerts
              {alertsUnread > 0 ? <span className="suite-inbox-tab-count">{alertsUnread > 9 ? '9+' : alertsUnread}</span> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'messages'}
              className={`suite-inbox-tab ${tab === 'messages' ? 'is-active' : ''}`}
              onClick={() => setTab('messages')}
            >
              Messages
              {messagesUnread > 0 ? <span className="suite-inbox-tab-count">{messagesUnread > 9 ? '9+' : messagesUnread}</span> : null}
            </button>
          </div>

          {tab === 'alerts' ? (
            <div className="suite-inbox-pane">
              <div className="suite-alert-head">
                <div>
                  <span className="suite-alert-eyebrow">
                    Alma Suite · {buckets.critical.length > 0 ? 'Attention' : 'All clear'}
                  </span>
                  <strong className="suite-alert-title">Needs your eye</strong>
                </div>
              </div>

              <div className="suite-alert-filters">
                {(
                  [
                    ['all', 'All', displayItems.length],
                    ['critical', 'Critical', buckets.critical.length],
                    ['today', 'Today', buckets.today.length],
                    ['thisWeek', 'This week', buckets.thisWeek.length]
                  ] as Array<['all' | AlertSeverity, string, number]>
                ).map(([id, label, count]) => (
                  <button
                    key={id}
                    type="button"
                    className={`suite-alert-chip ${filter === id ? 'is-active' : ''}`}
                    onClick={() => setFilter(id)}
                  >
                    {label} <span className="suite-alert-chip-count">{count}</span>
                  </button>
                ))}
                {readItems.length > 0 ? (
                  <button
                    type="button"
                    className={`suite-alert-chip ${showRead ? 'is-active' : ''}`}
                    onClick={() => setShowRead((value) => !value)}
                  >
                    {showRead ? 'Hide read' : `Show ${readItems.length} read`}
                  </button>
                ) : null}
              </div>

              {alertsMessage ? <p className="suite-alert-error">{alertsMessage}</p> : null}

              {displayItems.length === 0 && !alertsLoading ? (
                <div className="suite-alert-empty">
                  {alertsUnread === 0 && items.length > 0 ? 'All caught up.' : 'Nothing needs attention right now.'}
                </div>
              ) : null}

              {filteredOrder.map((severity) => {
                const bucket = buckets[severity];
                if (bucket.length === 0) return null;
                return (
                  <div key={severity} className="suite-alert-group">
                    <div className="suite-alert-divider">
                      <span className="suite-alert-severity-dot" style={{ background: SEVERITY_COLOR[severity] }} />
                      <span className="suite-alert-eyebrow">{SEVERITY_LABEL[severity]}</span>
                      <span className="suite-alert-divider-line" />
                    </div>
                    {bucket.map((item) => (
                      <AlertRow
                        key={item.id}
                        item={item}
                        severity={severity}
                        isRead={isReadItem(item)}
                        canMute={!!mutes && !!item.category}
                        onAction={(event) => {
                          const href = targetFor(item);
                          markRead(item.id);
                          setOpen(false);
                          openWithSuiteHandoff(event, href);
                        }}
                        onSnooze={() => markRead(item.id)}
                        onDismiss={() => markRead(item.id)}
                        onMute={() => void toggleMute(item.category, true)}
                      />
                    ))}
                  </div>
                );
              })}

              {mutes && showMutes ? (
                <div className="suite-alert-mutes">
                  <div className="suite-alert-divider">
                    <span className="suite-alert-eyebrow">Silence notification types</span>
                    <span className="suite-alert-divider-line" />
                  </div>
                  <p className="suite-alert-mutes-hint">
                    Muted types are hidden from your alerts everywhere in the suite.
                  </p>
                  {mutes.available.map((cat) => {
                    const isMuted = mutes.muted.includes(cat.category);
                    return (
                      <div key={cat.category} className="suite-alert-mute-row">
                        <span className="suite-alert-mute-label">{cat.label}</span>
                        <button
                          type="button"
                          className={`suite-alert-ghost-btn ${isMuted ? 'is-muted' : ''}`}
                          disabled={muteBusy}
                          onClick={() => void toggleMute(cat.category, !isMuted)}
                        >
                          {isMuted ? 'Unmute' : 'Mute'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="suite-alert-footer">
                <span className="suite-alert-eyebrow suite-alert-eyebrow--muted">
                  {alertsLoading
                    ? 'Refreshing…'
                    : `${alertsUnread} unread · ${readItems.length} read${
                        mutes && mutes.muted.length ? ` · ${mutes.muted.length} muted` : ''
                      }`}
                </span>
                <div className="suite-alert-footer-actions">
                  {mutes ? (
                    <button type="button" className="suite-alert-ghost-link" onClick={() => setShowMutes((value) => !value)}>
                      {showMutes ? 'Hide settings' : 'Notification settings'}
                    </button>
                  ) : null}
                  {alertsUnread > 0 ? (
                    <button type="button" className="suite-alert-ghost-link" onClick={markAllRead}>
                      Mark all done
                    </button>
                  ) : null}
                  {showRead && readItems.length > 0 ? (
                    <button type="button" className="suite-alert-ghost-link" onClick={clearAllRead}>
                      Restore all
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="suite-inbox-pane">
              <div className="suite-msg-head">
                <div>
                  <span className="suite-msg-eyebrow">Alma Suite · Team</span>
                  <strong className="suite-msg-title">Team chat &amp; announcements</strong>
                </div>
                {recentCount > 0 ? (
                  <span className="suite-msg-pill" title="Loaded recently.">{recentCount} recent</span>
                ) : null}
              </div>

              {commsMessage ? <p className="suite-msg-error">{commsMessage}</p> : null}

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

              {commsLoading ? <p className="suite-msg-subtle">Loading messages…</p> : null}

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
              {data.chat.length === 0 && data.announcements.length === 0 && !commsLoading ? (
                <div className="suite-msg-empty">No messages yet. Anything you post here lands in the Comms inbox.</div>
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
                  <button type="submit" className="suite-msg-compose-send">Publish announcement</button>
                </form>
              ) : null}

              <div className="suite-msg-footer">
                <span className="suite-msg-eyebrow suite-msg-eyebrow--muted">{recentCount} in inbox</span>
                <span className="suite-msg-eyebrow suite-msg-eyebrow--muted">{venue || 'All venues'}</span>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── Alerts row ────────────────────────────────────────────────────────── */
type AlertRowProps = {
  item: SuiteNotification;
  severity: AlertSeverity;
  isRead: boolean;
  canMute: boolean;
  onAction: (event: MouseEvent<HTMLAnchorElement>) => void;
  onSnooze: () => void;
  onDismiss: () => void;
  onMute: () => void;
};

function AlertRow({ item, severity, isRead, canMute, onAction, onSnooze, onDismiss, onMute }: AlertRowProps) {
  const chip = chipFor(item.appId);
  const href = targetFor(item);
  return (
    <div className={`suite-alert-row ${isRead ? 'is-read' : ''}`}>
      <span className="suite-alert-chip-icon" style={{ background: chip.bg, color: chip.fg }} aria-hidden="true">
        {appInitial(item.appId, item.appLabel)}
        <span className="suite-alert-severity-pip" style={{ background: SEVERITY_COLOR[severity] }} />
      </span>
      <div className="suite-alert-body">
        <div className="suite-alert-meta">
          <a href={href} className="suite-alert-link" onClick={onAction}>
            <span className="suite-alert-title-line">{item.title}</span>
          </a>
          <span className="suite-alert-time">{timeAgo(item.createdAt)}</span>
        </div>
        {item.description ? <div className="suite-alert-detail">{item.description}</div> : null}
        <div className="suite-alert-actions">
          <a href={href} className="suite-alert-primary-btn" onClick={onAction}>Open</a>
          <button type="button" className="suite-alert-ghost-btn" onClick={onSnooze} title="Mark as done for now (this alert won't return)">
            Done for now
          </button>
          <button type="button" className="suite-alert-ghost-btn" onClick={onDismiss}>Dismiss</button>
          {canMute ? (
            <button
              type="button"
              className="suite-alert-ghost-btn"
              onClick={onMute}
              title={`Silence all "${item.categoryLabel ?? 'these'}" alerts`}
            >
              Mute type
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Messages row ──────────────────────────────────────────────────────── */
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
      <span className="suite-msg-avatar" style={{ background: avatarTintFor(who) }} aria-hidden="true">
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
