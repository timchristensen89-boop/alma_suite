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
  type SuiteAnnouncement,
  type SuiteChatChannel,
  type SuiteChatChannelInput,
  type SuiteChatChannelType,
  type SuiteChatMessage,
  type SuiteCommunicationsPayload
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type ListInput = {
  appId?: string;
  venue?: string;
  channel?: string;
  channelId?: string;
  recipientId?: string;
};

const DEFAULT_GROUPS = ['Kitchen', 'Bar', 'Floor', 'Management'];

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

    if (selectedChannel?.postPermission && !hasPermission(user, selectedChannel.postPermission, selectedChannel.appId ?? 'STAFF')) {
      throw new HttpError(403, 'You do not have permission for this chat channel.');
    }

    const chatWhere = recipientId
      ? {
          channel: directChannelKey(user?.id ?? '', recipientId),
          channelType: 'DIRECT' as const,
          deletedAt: null
        }
      : selectedChannel
        ? {
            channelId: selectedChannel.id,
            deletedAt: null
          }
        : {
            channel: channelName,
            deletedAt: null,
            OR: [
              { appId: null },
              { appId }
            ],
            AND: [
              { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
            ]
          };

    if (recipientId && !canDirectMessage(user)) {
      throw new HttpError(403, 'Direct messaging is not enabled for your profile.');
    }

    const [announcements, chat] = await Promise.all([
      prisma.suiteAnnouncement.findMany({
        where: {
          deletedAt: null,
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ appId: null }, { appId }] },
            { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
          ]
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 10
      }),
      prisma.suiteChatMessage.findMany({
        where: chatWhere,
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ]);

    return {
      announcements: announcements.map(toAnnouncement),
      channels,
      chat: chat.reverse().map(toChatMessage)
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
      prisma.suiteChatMessage.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 100
      })
    ]);
    return {
      announcements: announcements.map(toAnnouncement),
      channels: channels.map(toChannel),
      chat: chat.reverse().map(toChatMessage)
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
    const data = suiteChatMessageInputSchema.parse(input);
    const appId = data.appId ?? 'STAFF';
    const channelId = clean(data.channelId);
    const recipientId = clean(data.recipientId);
    const direct = Boolean(recipientId);
    const channel = channelId
      ? await prisma.suiteChatChannel.findUnique({ where: { id: channelId } })
      : null;

    if (direct && !canDirectMessage(user)) {
      throw new HttpError(403, 'Direct messaging is not enabled for your profile.');
    }
    if (!direct && channel?.postPermission && !hasPermission(user, channel.postPermission, channel.appId ?? 'STAFF')) {
      throw new HttpError(403, 'You do not have permission to post in this channel.');
    }
    if (!direct && !channel?.postPermission && !canPostTeamChat(user)) {
      throw new HttpError(403, 'Chat posting is not enabled for your profile.');
    }

    const directRecipientName = recipientId ? await recipientName(recipientId) : null;
    const message = await prisma.suiteChatMessage.create({
      data: {
        channelId: channel?.id ?? null,
        channel: direct
          ? directChannelKey(user?.id ?? '', recipientId!)
          : channel?.channelKey ?? clean(data.channel) ?? 'general',
        channelType: direct ? 'DIRECT' : channel?.type ?? data.channelType ?? 'GENERAL',
        appId: channel?.appId ?? appId,
        venue: channel?.venue ?? clean(data.venue) ?? null,
        recipientId: recipientId ?? null,
        recipientName: directRecipientName,
        body: data.body.trim(),
        createdById: user?.id,
        createdByName: actorName(user)
      }
    });

    return toChatMessage(message);
  },

  async updateChatMessage(id: string, input: unknown, user: AuthUser | undefined) {
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
