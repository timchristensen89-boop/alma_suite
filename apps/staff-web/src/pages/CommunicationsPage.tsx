// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useCallback, useEffect, useState } from 'react';
import type {
  AlmaAppId,
  StaffProfile,
  SuiteAnnouncement,
  SuiteChatChannel,
  SuiteChatMessage,
  SuiteCommunicationsPayload
} from '@alma/shared';
import {
  ActionFeedback,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Select,
  StatCard,
  Textarea
} from '@alma/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  STAFF_APPS,
  VENUE_OPTIONS,
  staffPermissions,
  canAccessSettings,
  canManageCommunications,
  formatDateTime
} from './shared';

function canDirectMessage(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(user && (canManageCommunications(user) || permissions.chatDirect));
}

const COMMUNICATION_PERMISSION_KEYS = [
  { key: 'chatTeam', label: 'Team chat' },
  { key: 'chatDirect', label: 'Direct messages' },
  { key: 'chatModerate', label: 'Moderate chats' },
  { key: 'announcementsManage', label: 'Announcements' },
  { key: 'communicationsManage', label: 'Comms admin' }
];

type AnnouncementDraft = {
  title: string;
  body: string;
  audience: string;
  appId: AlmaAppId;
  venue: string;
  pinned: boolean;
  expiresAt: string;
};

type ChannelDraft = {
  name: string;
  description: string;
  type: SuiteChatChannel['type'];
  venue: string;
  groupKey: string;
  postPermission: string;
  directMessagesAllowed: boolean;
};

type StaffMessageThreadSummary = {
  id: string;
  subject: string;
  venue: string | null;
  category: string;
  priority: string;
  updatedAt: string;
  unread?: boolean;
  actionRequired?: boolean;
  latestMessage?: string | null;
};

type StaffMessageThreadDetail = {
  id: string;
  subject: string;
  venue: string | null;
  category: string;
  priority: string;
  messages: Array<{
    id: string;
    body: string;
    createdById: string | null;
    createdAt: string;
  }>;
};

function emptyAnnouncementDraft(): AnnouncementDraft {
  return {
    title: '',
    body: '',
    audience: 'ALL',
    appId: 'STAFF',
    venue: '',
    pinned: false,
    expiresAt: ''
  };
}

function emptyChannelDraft(): ChannelDraft {
  return {
    name: '',
    description: '',
    type: 'GROUP',
    venue: '',
    groupKey: '',
    postPermission: '',
    directMessagesAllowed: true
  };
}

function dateInputFromIso(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function permissionsForMember(member: StaffProfile) {
  return member.appAccess.find((access) => access.appId === 'STAFF')?.permissions ?? {};
}

export function CommunicationsPage({ staff, reload }: { staff: StaffProfile[]; reload: () => Promise<void> }) {
  const { user } = useAuth();
  const [payload, setPayload] = useState<SuiteCommunicationsPayload>({ announcements: [], channels: [], chat: [] });
  const [announcementDraft, setAnnouncementDraft] = useState<AnnouncementDraft>(() => emptyAnnouncementDraft());
  const [editingAnnouncementId, setEditingAnnouncementId] = useState('');
  const [channelDraft, setChannelDraft] = useState<ChannelDraft>(() => emptyChannelDraft());
  const [editingChannelId, setEditingChannelId] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState('');
  const [directRecipientId, setDirectRecipientId] = useState('');
  const [directSearch, setDirectSearch] = useState('');
  const [chatText, setChatText] = useState('');
  const [inboxThreads, setInboxThreads] = useState<StaffMessageThreadSummary[]>([]);
  const [selectedMessageThread, setSelectedMessageThread] = useState<StaffMessageThreadDetail | null>(null);
  const [threadReply, setThreadReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTarget, setMessageTarget] = useState<string | null>(null);
  const canManage = canManageCommunications(user);
  const canDirect = canDirectMessage(user);
  const permissionStaffApps = canAccessSettings(user) ? STAFF_APPS : STAFF_APPS.filter((app) => app.id !== 'SETTINGS');
  const activeChannels = payload.channels.filter((channel) => channel.isActive);
  const selectedChannel = activeChannels.find((channel) => channel.id === selectedChannelId) ?? activeChannels[0] ?? null;
  const recipients = staff.filter((member) => member.id !== user?.id && member.employmentStatus !== 'ARCHIVED');
  const selectedDirectRecipient = recipients.find((member) => member.id === directRecipientId) ?? null;
  const filteredRecipients = recipients.filter((member) => {
    const query = directSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      member.firstName,
      member.lastName,
      member.email,
      member.roleTitle,
      member.venue
    ].some((value) => value?.toLowerCase().includes(query));
  });

  const loadCommunications = useCallback(async (options?: { channelId?: string; recipientId?: string }) => {
    setLoading(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({ appId: 'STAFF' });
      if (user?.venue) params.set('venue', user.venue);
      if (options?.channelId) params.set('channelId', options.channelId);
      if (options?.recipientId) params.set('recipientId', options.recipientId);
      const [data, inbox] = await Promise.all([
        canManage && !options?.channelId && !options?.recipientId
          ? api<SuiteCommunicationsPayload>('/api/communications/admin')
          : api<SuiteCommunicationsPayload>(`/api/communications?${params.toString()}`),
        api<{ threads: StaffMessageThreadSummary[] }>('/api/messages/inbox')
      ]);
      setPayload(data);
      setInboxThreads(inbox.threads ?? []);
      if (!selectedChannelId && data.channels[0]) setSelectedChannelId(data.channels[0].id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load communications.');
    } finally {
      setLoading(false);
    }
  }, [canManage, selectedChannelId, user?.venue]);

  useEffect(() => {
    void loadCommunications();
  }, [loadCommunications]);

  function startEditAnnouncement(announcement: SuiteAnnouncement) {
    setEditingAnnouncementId(announcement.id);
    setAnnouncementDraft({
      title: announcement.title,
      body: announcement.body,
      audience: announcement.audience,
      appId: announcement.appId ?? 'STAFF',
      venue: announcement.venue ?? '',
      pinned: announcement.pinned,
      expiresAt: dateInputFromIso(announcement.expiresAt)
    });
  }

  function startEditChannel(channel: SuiteChatChannel) {
    setEditingChannelId(channel.id);
    setChannelDraft({
      name: channel.name,
      description: channel.description ?? '',
      type: channel.type,
      venue: channel.venue ?? '',
      groupKey: channel.groupKey ?? '',
      postPermission: channel.postPermission ?? '',
      directMessagesAllowed: channel.directMessagesAllowed
    });
  }

  async function saveAnnouncement() {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('announcement');
    try {
      const body = JSON.stringify({
        title: announcementDraft.title,
        body: announcementDraft.body,
        audience: announcementDraft.audience,
        appId: announcementDraft.appId,
        venue: announcementDraft.venue,
        pinned: announcementDraft.pinned,
        expiresAt: announcementDraft.expiresAt
      });
      if (editingAnnouncementId) {
        await api<SuiteAnnouncement>(`/api/communications/announcements/${editingAnnouncementId}`, { method: 'PATCH', body });
        setMessage('Announcement updated.');
      } else {
        await api<SuiteAnnouncement>('/api/communications/announcements', { method: 'POST', body });
        setMessage('Announcement published.');
      }
      setAnnouncementDraft(emptyAnnouncementDraft());
      setEditingAnnouncementId('');
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save announcement.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteAnnouncement(announcement: SuiteAnnouncement) {
    if (!canManage || !window.confirm(`Delete announcement "${announcement.title}"?`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`announcement:${announcement.id}:delete`);
    try {
      await api(`/api/communications/announcements/${announcement.id}`, { method: 'DELETE' });
      await loadCommunications();
      setMessage('Announcement deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete announcement.');
    } finally {
      setSaving(false);
    }
  }

  async function saveChannel() {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('channel');
    try {
      const body = JSON.stringify({
        name: channelDraft.name,
        description: channelDraft.description,
        type: channelDraft.type,
        appId: 'STAFF',
        venue: channelDraft.venue,
        groupKey: channelDraft.groupKey,
        postPermission: channelDraft.postPermission,
        directMessagesAllowed: channelDraft.directMessagesAllowed,
        isActive: true
      });
      if (editingChannelId) {
        await api<SuiteChatChannel>(`/api/communications/channels/${editingChannelId}`, { method: 'PATCH', body });
        setMessage('Chat group updated.');
      } else {
        await api<SuiteChatChannel>('/api/communications/channels', { method: 'POST', body });
        setMessage('Chat group created.');
      }
      setChannelDraft(emptyChannelDraft());
      setEditingChannelId('');
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save chat group.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteChannel(channel: SuiteChatChannel) {
    if (!canManage || !window.confirm(`Archive chat group "${channel.name}"? Messages stay in history.`)) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`channel:${channel.id}:delete`);
    try {
      await api(`/api/communications/channels/${channel.id}`, { method: 'DELETE' });
      if (selectedChannelId === channel.id) setSelectedChannelId('');
      await loadCommunications();
      setMessage('Chat group archived.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not archive chat group.');
    } finally {
      setSaving(false);
    }
  }

  async function openChannel(channel: SuiteChatChannel) {
    setSelectedChannelId(channel.id);
    setDirectRecipientId('');
    setSelectedMessageThread(null);
    await loadCommunications({ channelId: channel.id });
  }

  async function openDirect(recipientId: string) {
    setDirectRecipientId(recipientId);
    setSelectedChannelId('');
    setSelectedMessageThread(null);
    await loadCommunications({ recipientId });
  }

  async function openInboxThread(threadId: string) {
    setSaving(true);
    setMessage(null);
    setMessageTarget(`thread:${threadId}:open`);
    try {
      const data = await api<{ thread: StaffMessageThreadDetail }>(`/api/messages/threads/${threadId}`);
      setSelectedMessageThread(data.thread);
      setDirectRecipientId('');
      setSelectedChannelId('');
      setThreadReply('');
      await api(`/api/messages/threads/${threadId}/read`, { method: 'POST' });
      await loadCommunications();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open message thread.');
    } finally {
      setSaving(false);
    }
  }

  async function sendInboxReply() {
    if (!selectedMessageThread || !threadReply.trim()) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`thread:${selectedMessageThread.id}:reply`);
    try {
      await api(`/api/messages/threads/${selectedMessageThread.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body: threadReply.trim() })
      });
      setThreadReply('');
      await openInboxThread(selectedMessageThread.id);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send reply.');
    } finally {
      setSaving(false);
    }
  }

  async function sendMessage() {
    if (!chatText.trim()) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget('chat-send');
    try {
      await api<SuiteChatMessage>('/api/communications/chat', {
        method: 'POST',
        body: JSON.stringify({
          appId: 'STAFF',
          channelId: directRecipientId ? '' : selectedChannel?.id ?? '',
          recipientId: directRecipientId,
          venue: user?.venue ?? '',
          body: chatText.trim()
        })
      });
      setChatText('');
      await loadCommunications(directRecipientId ? { recipientId: directRecipientId } : { channelId: selectedChannel?.id });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not send message.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteMessage(chat: SuiteChatMessage) {
    if (!window.confirm('Delete this message?')) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`chat:${chat.id}:delete`);
    try {
      await api(`/api/communications/chat/${chat.id}`, { method: 'DELETE' });
      await loadCommunications(directRecipientId ? { recipientId: directRecipientId } : { channelId: selectedChannel?.id });
      setMessage('Message deleted.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not delete message.');
    } finally {
      setSaving(false);
    }
  }

  async function setChatPermission(member: StaffProfile, key: string, enabled: boolean) {
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setMessageTarget(`chat-permission:${member.id}`);
    try {
      await api(`/api/staff/${member.id}/app-access`, {
        method: 'PUT',
        body: JSON.stringify({
          apps: permissionStaffApps.map((app) => {
            const current = member.appAccess.find((access) => access.appId === app.id);
            const permissions = current?.permissions ?? {};
            return {
              appId: app.id,
              status: current?.status ?? (app.id === 'STAFF' ? 'ENABLED' : 'DISABLED'),
              role: current?.role ?? app.role,
              permissions: app.id === 'STAFF' ? { ...permissions, [key]: enabled } : permissions,
              notes: current?.notes ?? ''
            };
          })
        })
      });
      await reload();
      setMessage('Chat permission updated.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not update chat permission.');
    } finally {
      setSaving(false);
    }
  }

  const conversationTitle = directRecipientId
    ? selectedDirectRecipient
      ? `${selectedDirectRecipient.firstName} ${selectedDirectRecipient.lastName}`.trim()
      : 'Direct message'
    : selectedChannel?.name ?? 'Team chat';
  const conversationSubtitle = directRecipientId
    ? 'Private one-to-one staff message. Use this for quick operational follow-up, not announcements.'
    : selectedChannel?.description || 'Team chat for venue updates and shift-day coordination.';
  const messagePlaceholder = directRecipientId
    ? `Message ${selectedDirectRecipient?.firstName ?? 'this staff member'}`
    : 'Message this group';

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Communications"
        title={canManage ? 'Announcements and team chats' : 'Team chat'}
        description={canManage ? 'Manage announcements, venue and area group chats, direct messaging, and staff chat permissions.' : 'Read announcements, use your approved team channels, and direct-message staff if enabled.'}
      />

      <div className="stats-grid">
        <StatCard label="Announcements" value={payload.announcements.length} hint="Active" loading={loading} />
        <StatCard label="Chat groups" value={payload.channels.length} hint="Visible channels" loading={loading} />
        <StatCard label="Messages" value={payload.chat.length} hint="Current thread" loading={loading} />
        <StatCard label="Direct messages" value={canDirect ? 'On' : 'Off'} hint="Controlled in Profiles" loading={loading} />
      </div>

      <Card title="Messages inbox" subtitle="Comms and Staff messages now share the same conversations.">
        <div className="comms-layout">
          <div className="comms-sidebar">
            <section className="comms-sidebar-section" aria-label="Messages inbox">
              <div className="comms-section-heading">
                <strong>Recent threads</strong>
                <span>{inboxThreads.length} visible</span>
              </div>
              {inboxThreads.length === 0 ? (
                <p className="subtle">No messages have been sent to you yet.</p>
              ) : (
                inboxThreads.slice(0, 12).map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    className={`staff-list-button comms-thread-button ${selectedMessageThread?.id === thread.id ? 'is-selected' : ''}`}
                    onClick={() => void openInboxThread(thread.id)}
                  >
                    <span>
                      <strong>{thread.subject}</strong>
                      <span className="subtle">
                        {[thread.category, thread.venue, thread.unread ? 'Unread' : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </section>
          </div>
          <div className="staff-mobile-chat">
            {selectedMessageThread ? (
              <>
                <div className="comms-thread-header">
                  <span>
                    <strong>{selectedMessageThread.subject}</strong>
                    <span className="subtle">{selectedMessageThread.category} · {selectedMessageThread.venue || 'All venues'}</span>
                  </span>
                  <Badge tone={selectedMessageThread.priority === 'URGENT' || selectedMessageThread.priority === 'HIGH' ? 'warning' : 'muted'}>{selectedMessageThread.priority}</Badge>
                </div>
                <div className="staff-mobile-comms-list">
                  {selectedMessageThread.messages.map((item) => (
                    <div key={item.id} className={`comms-message ${item.createdById === user?.id ? 'is-mine' : 'is-theirs'}`}>
                      <span className="comms-message-body">{item.body}</span>
                      <small>{formatDateTime(item.createdAt)}</small>
                    </div>
                  ))}
                </div>
                <div className="staff-mobile-chat-form">
                  <Input label="Reply" value={threadReply} onChange={(event) => setThreadReply(event.currentTarget.value)} placeholder="Reply to this message" />
                  <Button type="button" disabled={saving || !threadReply.trim()} onClick={() => void sendInboxReply()}>
                    Reply
                  </Button>
                  <ActionFeedback
                    message={messageTarget === `thread:${selectedMessageThread.id}:reply` ? message : null}
                    tone={message?.includes('Could') ? 'error' : 'success'}
                  />
                </div>
              </>
            ) : (
              <div className="comms-empty-thread">
                <strong>Select a message</strong>
                <span className="subtle">Open a Comms or Staff thread to read and reply from here.</span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {message && !messageTarget ? <p className={message.includes('Could') || message.includes('permission') ? 'error-text' : 'subtle'}>{message}</p> : null}

      {canManage ? (
        <div className="tips-entry-grid">
          <Card title="Announcements" subtitle="Create, edit, pin, expire, or delete staff announcements.">
            <form
              className="staff-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveAnnouncement();
              }}
            >
              <div className="form-grid two">
                <Input label="Title" value={announcementDraft.title} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, title: el.value })); }} />
                <Select label="Venue" value={announcementDraft.venue} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, venue: el.value })); }} options={VENUE_OPTIONS} />
              </div>
              <Textarea label="Announcement" rows={3} value={announcementDraft.body} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, body: el.value })); }} />
              <div className="form-grid two">
                <Input label="Audience" value={announcementDraft.audience} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, audience: el.value })); }} />
                <Input label="Expires" type="date" value={announcementDraft.expiresAt} onChange={(event) => { const el = event.currentTarget; setAnnouncementDraft((current) => ({ ...current, expiresAt: el.value })); }} />
              </div>
              <label className="check-row">
                <input type="checkbox" checked={announcementDraft.pinned} onChange={(event) => { const checked = event.currentTarget.checked; setAnnouncementDraft((current) => ({ ...current, pinned: checked })); }} />
                Pin announcement
              </label>
              <div className="toolbar-right">
                {editingAnnouncementId ? <Button type="button" variant="secondary" onClick={() => { setEditingAnnouncementId(''); setAnnouncementDraft(emptyAnnouncementDraft()); }}>Cancel edit</Button> : null}
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingAnnouncementId ? 'Save announcement' : 'Publish announcement'}</Button>
                <ActionFeedback
                  message={messageTarget === 'announcement' ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
              </div>
            </form>
            <div className="staff-list">
              {payload.announcements.length === 0 ? (
                <EmptyState title="No announcements yet" description="Publish a real staff announcement when there is something the team needs to see." />
              ) : (
                payload.announcements.map((announcement) => (
                  <div key={announcement.id} className="staff-expiry-row">
                    <span>
                      <strong>{announcement.title}</strong>
                      <span className="subtle">{announcement.venue || 'All venues'} · {announcement.pinned ? 'Pinned' : 'Standard'} · {formatDateTime(announcement.createdAt)}</span>
                      <span>{announcement.body}</span>
                    </span>
                    <span className="invite-row-actions">
                      <Button type="button" size="sm" variant="secondary" onClick={() => startEditAnnouncement(announcement)}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => void deleteAnnouncement(announcement)}>Delete</Button>
                      <ActionFeedback
                        message={messageTarget === `announcement:${announcement.id}:delete` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card title="Group chats" subtitle="Create venue-level and group-level chats like Kitchen, Bar, Floor, and Management.">
            <form
              className="staff-profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveChannel();
              }}
            >
              <div className="form-grid two">
                <Input label="Group name" value={channelDraft.name} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, name: el.value })); }} placeholder="Kitchen" />
                <Select label="Type" value={channelDraft.type} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, type: el.value as SuiteChatChannel['type'] })); }} options={['GENERAL', 'VENUE', 'AREA', 'GROUP'].map((value) => ({ label: value, value }))} />
                <Select label="Venue" value={channelDraft.venue} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, venue: el.value })); }} options={VENUE_OPTIONS} />
                <Input label="Group key" value={channelDraft.groupKey} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, groupKey: el.value })); }} placeholder="kitchen" />
              </div>
              <Textarea label="Description" rows={2} value={channelDraft.description} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, description: el.value })); }} />
              <Select label="Post permission" value={channelDraft.postPermission} onChange={(event) => { const el = event.currentTarget; setChannelDraft((current) => ({ ...current, postPermission: el.value })); }} options={[{ label: 'Anyone with Staff access', value: '' }, ...COMMUNICATION_PERMISSION_KEYS.map((item) => ({ label: item.label, value: item.key }))]} />
              <label className="check-row">
                <input type="checkbox" checked={channelDraft.directMessagesAllowed} onChange={(event) => { const checked = event.currentTarget.checked; setChannelDraft((current) => ({ ...current, directMessagesAllowed: checked })); }} />
                Allow this group to use direct messaging
              </label>
              <div className="toolbar-right">
                {editingChannelId ? <Button type="button" variant="secondary" onClick={() => { setEditingChannelId(''); setChannelDraft(emptyChannelDraft()); }}>Cancel edit</Button> : null}
                <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editingChannelId ? 'Save chat group' : 'Create chat group'}</Button>
                <ActionFeedback
                  message={messageTarget === 'channel' ? message : null}
                  tone={message?.includes('Could') ? 'error' : 'success'}
                />
              </div>
            </form>
            <div className="staff-list">
              {payload.channels.length === 0 ? (
                <EmptyState title="No chat groups yet" description="Create real venue, area or group chats when the team is ready to use them." />
              ) : (
                payload.channels.map((channel) => (
                  <div key={channel.id} className="staff-expiry-row">
                    <span>
                      <strong>{channel.name}</strong>
                      <span className="subtle">{channel.type} · {channel.venue || 'All venues'} · {channel.postPermission || 'Staff access'} posting</span>
                      {channel.description ? <span>{channel.description}</span> : null}
                    </span>
                    <span className="invite-row-actions">
                      <Badge tone={channel.isActive ? 'positive' : 'muted'}>{channel.isActive ? 'Active' : 'Archived'}</Badge>
                      <Button type="button" size="sm" variant="secondary" onClick={() => startEditChannel(channel)}>Edit</Button>
                      <Button type="button" size="sm" variant="ghost" disabled={!channel.isActive} onClick={() => void deleteChannel(channel)}>Archive</Button>
                      <ActionFeedback
                        message={messageTarget === `channel:${channel.id}:delete` ? message : null}
                        tone={message?.includes('Could') ? 'error' : 'success'}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      ) : null}

      <Card title={conversationTitle} subtitle={conversationSubtitle}>
        <div className="comms-layout">
          <div className="comms-sidebar">
            <section className="comms-sidebar-section" aria-label="Group chats">
              <div className="comms-section-heading">
                <strong>Group chats</strong>
                <span>{activeChannels.length} active</span>
              </div>
              {activeChannels.length === 0 ? (
                <p className="subtle">No active group chats yet.</p>
              ) : (
                activeChannels.map((channel) => (
                  <button key={channel.id} type="button" className={`staff-list-button comms-thread-button ${selectedChannelId === channel.id ? 'is-selected' : ''}`} onClick={() => void openChannel(channel)}>
                    <span>
                      <strong>{channel.name}</strong>
                      <span className="subtle">{channel.type} · {channel.venue || 'All venues'}</span>
                    </span>
                  </button>
                ))
              )}
            </section>
            {canDirect ? (
              <section className="comms-sidebar-section" aria-label="Direct messages">
                <div className="comms-section-heading">
                  <strong>Direct messages</strong>
                  <span>One to one</span>
                </div>
                <Input
                  label="Find staff"
                  value={directSearch}
                  onChange={(event) => setDirectSearch(event.currentTarget.value)}
                  placeholder="Search by name, role, or venue"
                />
                <div className="comms-direct-list">
                  {filteredRecipients.length === 0 ? (
                    <p className="subtle">No matching staff found.</p>
                  ) : (
                    filteredRecipients.map((member) => (
                      <button key={member.id} type="button" className={`staff-list-button comms-thread-button ${directRecipientId === member.id ? 'is-selected' : ''}`} onClick={() => void openDirect(member.id)}>
                        <span>
                          <strong>{member.firstName} {member.lastName}</strong>
                          <span className="subtle">{member.roleTitle || 'Staff'} · {member.venue || 'No venue'}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </section>
            ) : (
              <section className="comms-sidebar-section" aria-label="Direct messages unavailable">
                <div className="comms-section-heading">
                  <strong>Direct messages</strong>
                  <span>Off</span>
                </div>
                <p className="subtle">Direct messages are enabled by managers in staff communication permissions.</p>
              </section>
            )}
          </div>
          <div className="staff-mobile-chat">
            <div className="comms-thread-header">
              <span>
                <strong>{conversationTitle}</strong>
                <span className="subtle">
                  {directRecipientId
                    ? `${selectedDirectRecipient?.roleTitle || 'Staff'} · ${selectedDirectRecipient?.venue || 'No venue'}`
                    : `${selectedChannel?.type ?? 'GENERAL'} · ${selectedChannel?.venue || 'All venues'}`}
                </span>
              </span>
              <Badge tone={directRecipientId ? 'info' : 'muted'}>{directRecipientId ? 'Direct' : 'Group'}</Badge>
            </div>
            <div className="staff-mobile-comms-list">
              {payload.chat.length === 0 ? (
                <div className="comms-empty-thread">
                  <strong>No messages yet</strong>
                  <span className="subtle">
                    {directRecipientId
                      ? 'Start with a clear operational message. Direct chats are for one-to-one staff follow-up.'
                      : 'Start the group conversation when there is something useful for the team.'}
                  </span>
                </div>
              ) : (
                payload.chat.map((item) => (
                  <div key={item.id} className={`comms-message ${item.createdById === user?.id ? 'is-mine' : 'is-theirs'}`}>
                    <span className="comms-message-meta">
                      <strong>{item.createdById === user?.id ? 'You' : item.createdByName || 'Team'}</strong>
                      {item.recipientName && !directRecipientId ? <span>to {item.recipientName}</span> : null}
                    </span>
                    <span className="comms-message-body">{item.body}</span>
                    <small>{formatDateTime(item.createdAt)}{item.editedAt ? ' · edited' : ''}</small>
                    {(canManage || item.createdById === user?.id) ? (
                      <span className="comms-message-actions">
                        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void deleteMessage(item)}>Delete</Button>
                        <ActionFeedback
                          message={messageTarget === `chat:${item.id}:delete` ? message : null}
                          tone={message?.includes('Could') ? 'error' : 'success'}
                        />
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="staff-mobile-chat-form">
              <Input label="Message" value={chatText} onChange={(event) => setChatText(event.currentTarget.value)} placeholder={messagePlaceholder} />
              <Button type="button" disabled={saving || !chatText.trim() || (!selectedChannel && !directRecipientId)} onClick={() => void sendMessage()}>
                Send
              </Button>
              <ActionFeedback
                message={messageTarget === 'chat-send' ? message : null}
                tone={message?.includes('Could') ? 'error' : 'success'}
              />
            </div>
          </div>
        </div>
      </Card>

      {canManage ? (
        <Card title="Chatting permissions" subtitle="Grant direct messaging, moderation, announcements, and admin communications from one place.">
          <div className="staff-list">
            {staff.map((member) => {
              const permissions = permissionsForMember(member);
              return (
                <div key={member.id} className="staff-expiry-row">
                  <span>
                    <strong>{member.firstName} {member.lastName}</strong>
                    <span className="subtle">{member.roleTitle} · {member.venue || 'No venue'}</span>
                  </span>
                  <span className="communication-permission-grid">
                    {COMMUNICATION_PERMISSION_KEYS.map((permission) => (
                      <label key={permission.key} className="check-row">
                        <input
                          type="checkbox"
                          checked={Boolean(permissions[permission.key] || permissions.admin)}
                          disabled={saving || Boolean(permissions.admin && permission.key !== 'communicationsManage')}
                          onChange={(event) => void setChatPermission(member, permission.key, event.currentTarget.checked)}
                        />
                        {permission.label}
                      </label>
                    ))}
                    <ActionFeedback
                      message={messageTarget === `chat-permission:${member.id}` ? message : null}
                      tone={message?.includes('Could') ? 'error' : 'success'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
