import { prisma } from '@alma/db';
import {
  almaAppIdSchema,
  suiteAnnouncementInputSchema,
  suiteAnnouncementUpdateSchema,
  suiteChatChannelInputSchema,
  suiteChatChannelUpdateSchema,
  suiteChatMessageInputSchema,
  suiteChatMessageUpdateSchema,
  type AlmaAppId,
  type AuthUser,
  type NoticeboardName,
  type NoticeboardsPayload,
  type PublicAgistmentNoticesPayload,
  type SuiteAnnouncement,
  type SuiteChatChannel,
  type SuiteChatChannelInput,
  type SuiteChatChannelType,
  type SuiteChatMessage,
  type SuiteCommunicationsPayload
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import {
  addMessage,
  canManageMessaging,
  createThread,
  getThreadForUser,
  listInboxForUser
} from './messaging.service.js';

type ListInput = {
  appId?: string;
  venue?: string;
  channel?: string;
  channelId?: string;
  recipientId?: string;
};

const DEFAULT_GROUPS = ['Kitchen', 'Bar', 'Floor', 'Management'];

type ChatChannelLike = {
  id: string;
  name: string;
  channelKey: string;
  type: SuiteChatChannelType;
  appId: AlmaAppId | null;
  venue: string | null;
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAppId(value: string | null | undefined): AlmaAppId | undefined {
  const normalised = clean(value)?.toUpperCase();
  const parsed = almaAppIdSchema.safeParse(normalised);
  return parsed.success ? parsed.data : undefined;
}

function actorName(user: AuthUser | undefined) {
  if (!user) return undefined;
  return `${user.firstName} ${user.lastName}`.trim() || user.email || user.roleTitle;
}

function optionalDate(value: string | undefined | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid expiry date.');
  return date;
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'general';
}

function permissionRecord(user: AuthUser | undefined, appId: AlmaAppId = 'STAFF') {
  const access = user?.appAccess.find((item) => item.appId === appId && item.status === 'ENABLED');
  return access?.permissions ?? {};
}

function hasPermission(user: AuthUser | undefined, key?: string | null, appId: AlmaAppId = 'STAFF') {
  if (!user) return false;
  if (user.isAdmin || user.role === 'ADMIN') return true;
  const permissions = permissionRecord(user, appId);
  if (permissions.admin) return true;
  if (!key) return user.role === 'MANAGER';
  return Boolean(permissions[key]);
}

function canManageCommunications(user: AuthUser | undefined) {
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      user.role === 'MANAGER' ||
      hasPermission(user, 'communicationsManage') ||
      hasPermission(user, 'announcementsManage') ||
      hasPermission(user, 'chatModerate'))
  );
}

function canDirectMessage(user: AuthUser | undefined) {
  return Boolean(user && (canManageCommunications(user) || hasPermission(user, 'chatDirect')));
}

function canPostTeamChat(user: AuthUser | undefined) {
  if (!user) return false;
  const staffAccess = user.appAccess.find((item) => item.appId === 'STAFF' && item.status === 'ENABLED');
  return canManageCommunications(user) || Boolean(staffAccess);
}

function directChannelKey(leftId: string, rightId: string) {
  return `dm:${[leftId, rightId].sort().join(':')}`;
}

function channelKeyFor(input: Pick<SuiteChatChannelInput, 'name' | 'type' | 'venue' | 'groupKey' | 'appId'>) {
  const app = (input.appId ?? 'STAFF').toLowerCase();
  if (input.type === 'GENERAL') return `${app}:general`;
  if (input.type === 'VENUE') return `${app}:venue:${slug(input.venue ?? input.name)}`;
  if (input.type === 'AREA') return `${app}:area:${slug(input.groupKey ?? input.name)}`;
  return `${app}:group:${slug(input.groupKey ?? input.name)}`;
}

function toAnnouncement(row: {
  id: string;
  title: string;
  body: string;
  audience: string;
  board: string;
  appId: AlmaAppId | null;
  venue: string | null;
  pinned: boolean;
  createdById: string | null;
  createdByName: string | null;
  updatedById: string | null;
  updatedByName: string | null;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}): SuiteAnnouncement {
  return {
    ...row,
    board: (row.board as NoticeboardName) ?? 'STAFF',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null
  };
}

function toChannel(row: {
  id: string;
  name: string;
  description: string | null;
  channelKey: string;
  type: SuiteChatChannelType;
  appId: AlmaAppId | null;
  venue: string | null;
  groupKey: string | null;
  isActive: boolean;
  readPermission: string | null;
  postPermission: string | null;
  directMessagesAllowed: boolean;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SuiteChatChannel {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toChatMessage(row: {
  id: string;
  channelId: string | null;
  channel: string;
  channelType: SuiteChatChannelType;
  appId: AlmaAppId | null;
  venue: string | null;
  recipientId: string | null;
  recipientName: string | null;
  body: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  deletedById: string | null;
  deletedByName: string | null;
}): SuiteChatMessage {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null
  };
}

function toCommsBackedChatMessage(row: {
  id: string;
  threadId: string;
  body: string;
  createdById: string | null;
  createdAt: Date;
  editedAt: Date | null;
  thread: {
    category: string;
    venue: string | null;
    createdById: string | null;
    links?: Array<{ entityType: string; entityId: string }>;
    recipients?: Array<{ staffProfileId: string | null }>;
  };
}, options: { channel?: ChatChannelLike | null; recipientName?: string | null; appId?: AlmaAppId | null } = {}): SuiteChatMessage {
  const direct = row.thread.category === 'INBOX';
  return {
    id: row.id,
    channelId: options.channel?.id ?? null,
    channel: direct ? row.threadId : options.channel?.channelKey ?? row.threadId,
    channelType: direct ? 'DIRECT' : options.channel?.type ?? 'GENERAL',
    appId: options.channel?.appId ?? options.appId ?? 'STAFF',
    venue: row.thread.venue,
    recipientId: direct ? row.thread.recipients?.find((recipient) => recipient.staffProfileId !== row.createdById)?.staffProfileId ?? null : null,
    recipientName: options.recipientName ?? null,
    body: row.body,
    createdById: row.createdById,
    createdByName: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.editedAt ?? row.createdAt).toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: null,
    deletedById: null,
    deletedByName: null
  };
}

async function staffNameById(id: string | null | undefined) {
  if (!id) return null;
  const staff = await prisma.staffProfile.findUnique({
    where: { id },
    select: { firstName: true, lastName: true, email: true }
  });
  return staff ? `${staff.firstName} ${staff.lastName}`.trim() || staff.email || 'Staff member' : null;
}

async function commsMessagesForList(input: {
  user?: AuthUser;
  selectedChannel?: ChatChannelLike | null;
  recipientId?: string;
  appId: AlmaAppId;
}) {
  if (!input.user) return [];

  if (input.recipientId) {
    const messages = await prisma.commsMessage.findMany({
      where: {
        thread: {
          category: 'INBOX',
          archivedAt: null,
          AND: [
            { recipients: { some: { staffProfileId: input.user.id } } },
            { recipients: { some: { staffProfileId: input.recipientId } } }
          ]
        }
      },
      include: { thread: { include: { recipients: true, links: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const recipient = await staffNameById(input.recipientId);
    return messages.reverse().map((message) => toCommsBackedChatMessage(message, { recipientName: recipient, appId: input.appId }));
  }

  const channel = input.selectedChannel;
  if (!channel) return [];

  const messages = await prisma.commsMessage.findMany({
    where: {
      thread: {
        archivedAt: null,
        links: { some: { entityType: 'SUITE_CHAT_CHANNEL', entityId: channel.id } }
      }
    },
    include: { thread: { include: { recipients: true, links: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return messages.reverse().map((message) => toCommsBackedChatMessage(message, { channel, appId: input.appId }));
}

async function ensureDefaultChannels(appId: AlmaAppId = 'STAFF', venue?: string) {
  const defaults: SuiteChatChannelInput[] = [
    {
      name: 'Team',
      description: 'All staff team chat.',
      channelKey: channelKeyFor({ name: 'Team', type: 'GENERAL', appId }),
      type: 'GENERAL',
      appId,
      venue: '',
      groupKey: 'general',
      isActive: true,
      readPermission: '',
      postPermission: '',
      directMessagesAllowed: true
    },
    ...DEFAULT_GROUPS.map((group) => ({
      name: group,
      description: `${group} team chat.`,
      channelKey: channelKeyFor({ name: group, type: 'AREA', appId, groupKey: group }),
      type: 'AREA' as const,
      appId,
      venue: '',
      groupKey: group,
      isActive: true,
      readPermission: '',
      postPermission: '',
      directMessagesAllowed: true
    }))
  ];

  if (venue) {
    defaults.push({
      name: `${venue} team`,
      description: `Venue-level chat for ${venue}.`,
      channelKey: channelKeyFor({ name: venue, type: 'VENUE', appId, venue }),
      type: 'VENUE',
      appId,
      venue,
      groupKey: venue,
      isActive: true,
      readPermission: '',
      postPermission: '',
      directMessagesAllowed: true
    });
  }

  await Promise.all(defaults.map((channel) =>
    prisma.suiteChatChannel.upsert({
      where: { channelKey: channel.channelKey || channelKeyFor(channel) },
      create: {
        name: channel.name,
        description: clean(channel.description) ?? null,
        channelKey: channel.channelKey || channelKeyFor(channel),
        type: channel.type,
        appId: channel.appId ?? null,
        venue: clean(channel.venue) ?? null,
        groupKey: clean(channel.groupKey) ?? null,
        isActive: channel.isActive ?? true,
        readPermission: clean(channel.readPermission) ?? null,
        postPermission: clean(channel.postPermission) ?? null,
        directMessagesAllowed: channel.directMessagesAllowed ?? false
      },
      update: {}
    })
  ));
}

async function recipientName(recipientId: string) {
  const recipient = await prisma.staffProfile.findUnique({
    where: { id: recipientId },
    select: { firstName: true, lastName: true, email: true }
  });
  if (!recipient) throw new HttpError(404, 'Recipient staff profile not found.');
  return `${recipient.firstName} ${recipient.lastName}`.trim() || recipient.email || 'Staff member';
}

export const communicationsService = {
  canManageCommunications,
  canDirectMessage,

  async list(input: ListInput, user?: AuthUser): Promise<SuiteCommunicationsPayload> {
    const appId = parseAppId(input.appId) ?? 'STAFF';
    const venue = clean(input.venue);
    const channelName = clean(input.channel) ?? 'general';
    const recipientId = clean(input.recipientId);
    const now = new Date();

    await ensureDefaultChannels(appId, venue);

    const channels = await this.listChannels({ appId, venue, includeInactive: false }, user);
    const selectedChannel = clean(input.channelId)
      ? await prisma.suiteChatChannel.findFirst({ where: { id: clean(input.channelId), isActive: true } })
      : null;
    const chatChannel = selectedChannel ?? channels[0] ?? null;

    if (selectedChannel?.postPermission && !hasPermission(user, selectedChannel.postPermission, selectedChannel.appId ?? 'STAFF')) {
      throw new HttpError(403, 'You do not have permission for this chat channel.');
    }

    if (recipientId && !canDirectMessage(user)) {
      throw new HttpError(403, 'Direct messaging is not enabled for your profile.');
    }

    const [announcements, chat] = await Promise.all([
      prisma.suiteAnnouncement.findMany({
        where: {
          deletedAt: null,
          board: 'STAFF',
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ appId: null }, { appId }] },
            { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
          ]
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 10
      }),
      commsMessagesForList({ user, selectedChannel: recipientId ? null : chatChannel, recipientId, appId })
    ]);

    return {
      announcements: announcements.map(toAnnouncement),
      channels,
      chat
    };
  },

  async adminList(user?: AuthUser) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const [announcements, channels, chat] = await Promise.all([
      prisma.suiteAnnouncement.findMany({
        where: { deletedAt: null },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 100
      }),
      prisma.suiteChatChannel.findMany({
        orderBy: [{ isActive: 'desc' }, { type: 'asc' }, { name: 'asc' }]
      }),
      listInboxForUser(user!).then((threads): SuiteChatMessage[] => threads.map((thread) => ({
        id: thread.id,
        channelId: null,
        channel: thread.category,
        channelType: thread.category === 'INBOX' ? 'DIRECT' as const : 'GENERAL' as const,
        appId: 'STAFF' as AlmaAppId,
        venue: thread.venue,
        recipientId: null,
        recipientName: null,
        body: thread.latestMessage ?? thread.subject,
        createdById: thread.createdById,
        createdByName: null,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        editedAt: null,
        deletedAt: null,
        deletedById: null,
        deletedByName: null
      })))
    ]);
    return {
      announcements: announcements.map(toAnnouncement),
      channels: channels.map(toChannel),
      chat
    };
  },

  // Noticeboard read view — active notices for both boards (staff + agistment),
  // pinned first. Any signed-in user can read; posting/editing stays manager-gated.
  async listBoards(_user?: AuthUser): Promise<NoticeboardsPayload> {
    const now = new Date();
    const forBoard = (board: NoticeboardName) =>
      prisma.suiteAnnouncement.findMany({
        where: {
          deletedAt: null,
          board,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 100
      });
    const [staff, agistment] = await Promise.all([forBoard('STAFF'), forBoard('AGISTMENT')]);
    return { staff: staff.map(toAnnouncement), agistment: agistment.map(toAnnouncement) };
  },

  // Public (no-login) agistment notices for horse owners — read-only, no
  // internal author/audience metadata exposed.
  async listPublicAgistmentNotices(): Promise<PublicAgistmentNoticesPayload> {
    const now = new Date();
    const notices = await prisma.suiteAnnouncement.findMany({
      where: {
        deletedAt: null,
        board: 'AGISTMENT',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 100
    });
    return {
      venue: null,
      notices: notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        pinned: n.pinned,
        createdAt: n.createdAt.toISOString(),
        expiresAt: n.expiresAt?.toISOString() ?? null
      }))
    };
  },

  async listChannels(input: { appId?: AlmaAppId; venue?: string; includeInactive?: boolean }, user?: AuthUser) {
    const appId = input.appId ?? 'STAFF';
    const venue = clean(input.venue);
    const channels = await prisma.suiteChatChannel.findMany({
      where: {
        ...(input.includeInactive ? {} : { isActive: true }),
        OR: [
          { appId: null },
          { appId }
        ],
        AND: [
          { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
        ]
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }]
    });

    return channels
      .filter((channel) => !channel.readPermission || hasPermission(user, channel.readPermission, channel.appId ?? 'STAFF'))
      .map(toChannel);
  },

  async createAnnouncement(input: unknown, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const data = suiteAnnouncementInputSchema.parse(input);
    const announcement = await prisma.suiteAnnouncement.create({
      data: {
        title: data.title.trim(),
        body: data.body.trim(),
        audience: clean(data.audience)?.toUpperCase() ?? 'ALL',
        board: data.board ?? 'STAFF',
        appId: data.appId ?? null,
        venue: clean(data.venue) ?? null,
        pinned: data.pinned ?? false,
        expiresAt: optionalDate(data.expiresAt),
        createdById: user?.id,
        createdByName: actorName(user)
      }
    });

    return toAnnouncement(announcement);
  },

  async updateAnnouncement(id: string, input: unknown, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const data = suiteAnnouncementUpdateSchema.parse(input);
    const announcement = await prisma.suiteAnnouncement.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.body !== undefined && { body: data.body.trim() }),
        ...(data.audience !== undefined && { audience: clean(data.audience)?.toUpperCase() ?? 'ALL' }),
        ...(data.board !== undefined && { board: data.board }),
        ...(data.appId !== undefined && { appId: data.appId ?? null }),
        ...(data.venue !== undefined && { venue: clean(data.venue) ?? null }),
        ...(data.pinned !== undefined && { pinned: data.pinned }),
        ...(data.expiresAt !== undefined && { expiresAt: optionalDate(data.expiresAt) }),
        updatedById: user?.id,
        updatedByName: actorName(user)
      }
    });
    return toAnnouncement(announcement);
  },

  async removeAnnouncement(id: string, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const announcement = await prisma.suiteAnnouncement.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById: user?.id,
        deletedByName: actorName(user)
      }
    });
    return toAnnouncement(announcement);
  },

  async createChannel(input: unknown, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const data = suiteChatChannelInputSchema.parse(input);
    const channelKey = clean(data.channelKey) ?? channelKeyFor(data);
    const channel = await prisma.suiteChatChannel.create({
      data: {
        name: data.name.trim(),
        description: clean(data.description) ?? null,
        channelKey,
        type: data.type,
        appId: data.appId ?? null,
        venue: clean(data.venue) ?? null,
        groupKey: clean(data.groupKey) ?? null,
        isActive: data.isActive ?? true,
        readPermission: clean(data.readPermission) ?? null,
        postPermission: clean(data.postPermission) ?? null,
        directMessagesAllowed: data.directMessagesAllowed ?? false,
        createdById: user?.id,
        createdByName: actorName(user)
      }
    });
    return toChannel(channel);
  },

  async updateChannel(id: string, input: unknown, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const data = suiteChatChannelUpdateSchema.parse(input);
    const channel = await prisma.suiteChatChannel.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: clean(data.description) ?? null }),
        ...(data.channelKey !== undefined && clean(data.channelKey) && { channelKey: clean(data.channelKey) }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.appId !== undefined && { appId: data.appId ?? null }),
        ...(data.venue !== undefined && { venue: clean(data.venue) ?? null }),
        ...(data.groupKey !== undefined && { groupKey: clean(data.groupKey) ?? null }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.readPermission !== undefined && { readPermission: clean(data.readPermission) ?? null }),
        ...(data.postPermission !== undefined && { postPermission: clean(data.postPermission) ?? null }),
        ...(data.directMessagesAllowed !== undefined && { directMessagesAllowed: data.directMessagesAllowed })
      }
    });
    return toChannel(channel);
  },

  async removeChannel(id: string, user: AuthUser | undefined) {
    if (!canManageCommunications(user)) throw new HttpError(403, 'Communications admin access required.');
    const channel = await prisma.suiteChatChannel.update({
      where: { id },
      data: { isActive: false }
    });
    return toChannel(channel);
  },

  async createChatMessage(input: unknown, user: AuthUser | undefined) {
    if (!user) throw new HttpError(401, 'Not authenticated');
    const data = suiteChatMessageInputSchema.parse(input);
    const appId = data.appId ?? 'STAFF';
    const channelId = clean(data.channelId);
    const recipientId = clean(data.recipientId);
    const direct = Boolean(recipientId);
    const channel = channelId
      ? await prisma.suiteChatChannel.findUnique({ where: { id: channelId } })
      : await prisma.suiteChatChannel.findFirst({
          where: {
            isActive: true,
            OR: [{ appId: null }, { appId }],
            channelKey: channelKeyFor({ name: 'Team', type: 'GENERAL', appId })
          }
        });

    if (direct && !canDirectMessage(user)) {
      throw new HttpError(403, 'Direct messaging is not enabled for your profile.');
    }
    if (!direct && channel?.postPermission && !hasPermission(user, channel.postPermission, channel.appId ?? 'STAFF')) {
      throw new HttpError(403, 'You do not have permission to post in this channel.');
    }
    if (!direct && !channel?.postPermission && !canPostTeamChat(user)) {
      throw new HttpError(403, 'Chat posting is not enabled for your profile.');
    }

    if (direct) {
      const existingThread = await prisma.commsThread.findFirst({
        where: {
          category: 'INBOX',
          archivedAt: null,
          AND: [
            { recipients: { some: { staffProfileId: user.id } } },
            { recipients: { some: { staffProfileId: recipientId! } } }
          ]
        },
        include: { recipients: true, links: true },
        orderBy: { updatedAt: 'desc' }
      });
      if (existingThread) {
        const message = await addMessage(user, existingThread.id, { body: data.body.trim() });
        return toCommsBackedChatMessage({
          ...message,
          thread: {
            category: existingThread.category,
            venue: existingThread.venue,
            createdById: existingThread.createdById,
            recipients: existingThread.recipients,
            links: existingThread.links
          }
        }, { recipientName: await recipientName(recipientId!), appId });
      }

      const thread = await createThread(user, {
        subject: `Direct message with ${await recipientName(recipientId!)}`,
        body: data.body.trim(),
        venue: user.venue ?? '',
        category: 'INBOX',
        priority: 'NORMAL',
        staffProfileIds: [recipientId!]
      });
      const message = thread.messages[0];
      if (!message) throw new HttpError(500, 'Message was not created.');
      return toCommsBackedChatMessage({
        ...message,
        threadId: thread.id,
        thread: {
          category: thread.category,
          venue: thread.venue,
          createdById: thread.createdById,
          recipients: thread.recipients,
          links: []
        }
      }, { recipientName: await recipientName(recipientId!), appId });
    }

    const messageVenue = channel?.venue ?? clean(data.venue) ?? user.venue ?? null;
    const recipientWhere = {
      accountType: 'HUMAN' as const,
      employmentStatus: 'ACTIVE' as const,
      mergedIntoStaffProfileId: null,
      ...(messageVenue ? { venue: messageVenue } : {}),
      id: { not: user.id }
    };
    const recipients = await prisma.staffProfile.findMany({
      where: recipientWhere,
      select: { id: true, venue: true, roleTitle: true }
    });

    const thread = await prisma.commsThread.create({
      data: {
        subject: `${channel?.name ?? clean(data.channel) ?? 'Team'} chat`,
        venue: messageVenue,
        category: channel?.type === 'VENUE' ? 'VENUE' : 'GENERAL',
        priority: 'NORMAL',
        createdById: user.id,
        messages: {
          create: {
            body: data.body.trim(),
            createdById: user.id
          }
        },
        recipients: {
          create: [
            {
              staffProfileId: user.id,
              venue: user.venue ?? messageVenue,
              role: user.roleTitle,
              readAt: new Date()
            },
            ...recipients.map((recipient) => ({
              staffProfileId: recipient.id,
              venue: recipient.venue,
              role: recipient.roleTitle
            }))
          ]
        },
        ...(channel ? { links: { create: { entityType: 'SUITE_CHAT_CHANNEL', entityId: channel.id } } } : {})
      },
      include: { messages: true, recipients: true, links: true }
    });

    const firstMessage = thread.messages[0];
    if (!firstMessage) throw new HttpError(500, 'Message was not created.');
    return toCommsBackedChatMessage({
      ...firstMessage,
      threadId: thread.id,
      thread: {
        category: thread.category,
        venue: thread.venue,
        createdById: thread.createdById,
        recipients: thread.recipients,
        links: thread.links
      }
    }, { channel, appId });
  },

  async updateChatMessage(id: string, input: unknown, user: AuthUser | undefined) {
    const commsMessage = await prisma.commsMessage.findUnique({
      where: { id },
      include: { thread: { include: { recipients: true, links: true } } }
    });
    if (commsMessage) {
      if (!user) throw new HttpError(401, 'Not authenticated');
      await getThreadForUser(commsMessage.threadId, user);
      if (!canManageMessaging(user) && commsMessage.createdById !== user.id) {
        throw new HttpError(403, 'You can only edit your own message.');
      }
      const data = suiteChatMessageUpdateSchema.parse(input);
      const message = await prisma.commsMessage.update({
        where: { id },
        data: { body: data.body.trim(), editedAt: new Date() },
        include: { thread: { include: { recipients: true, links: true } } }
      });
      return toCommsBackedChatMessage(message);
    }

    const existing = await prisma.suiteChatMessage.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new HttpError(404, 'Chat message not found.');
    if (!canManageCommunications(user) && existing.createdById !== user?.id) {
      throw new HttpError(403, 'You can only edit your own message.');
    }
    const data = suiteChatMessageUpdateSchema.parse(input);
    const message = await prisma.suiteChatMessage.update({
      where: { id },
      data: {
        body: data.body.trim(),
        editedAt: new Date()
      }
    });
    return toChatMessage(message);
  },

  async removeChatMessage(id: string, user: AuthUser | undefined) {
    const commsMessage = await prisma.commsMessage.findUnique({
      where: { id },
      include: { thread: { include: { recipients: true, links: true } } }
    });
    if (commsMessage) {
      if (!user) throw new HttpError(401, 'Not authenticated');
      await getThreadForUser(commsMessage.threadId, user);
      if (!canManageMessaging(user) && commsMessage.createdById !== user.id) {
        throw new HttpError(403, 'You can only delete your own message.');
      }
      const message = toCommsBackedChatMessage(commsMessage);
      await prisma.commsMessage.delete({ where: { id } });
      return message;
    }

    const existing = await prisma.suiteChatMessage.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new HttpError(404, 'Chat message not found.');
    if (!canManageCommunications(user) && existing.createdById !== user?.id) {
      throw new HttpError(403, 'You can only delete your own message.');
    }
    const message = await prisma.suiteChatMessage.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById: user?.id,
        deletedByName: actorName(user)
      }
    });
    return toChatMessage(message);
  }
};
