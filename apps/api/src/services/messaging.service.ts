import { z } from 'zod';
import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

const threadCategorySchema = z.enum(['INBOX', 'VENUE', 'ANNOUNCEMENT', 'HANDOVER', 'TASK', 'ALERT', 'GENERAL']);
const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

const recipientGroupSchema = z.object({
  type: z.enum(['STAFF', 'VENUE', 'ROLE', 'ROLE_TEMPLATE', 'MANAGERS']),
  id: z.string().trim().min(1),
  label: z.string().trim().optional()
});

export const createMessageThreadSchema = z.object({
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(8000),
  venue: z.string().trim().optional().or(z.literal('')),
  category: threadCategorySchema.default('GENERAL'),
  priority: prioritySchema.default('NORMAL'),
  staffProfileIds: z.array(z.string().trim().min(1)).optional().default([]),
  venues: z.array(z.string().trim().min(1)).optional().default([]),
  roleTitles: z.array(z.string().trim().min(1)).optional().default([]),
  roleTemplateIds: z.array(z.string().trim().min(1)).optional().default([]),
  managerVenues: z.array(z.string().trim().min(1)).optional().default([]),
  recipientGroups: z.array(recipientGroupSchema).optional().default([]),
  role: z.string().trim().optional().or(z.literal('')),
  actionRequired: z.boolean().optional(),
  dueAt: z.string().datetime().optional().or(z.literal(''))
});

export const createMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000)
});

type StaffRecipient = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
  roleTemplateId: string | null;
};

type RecipientOption = {
  id: string;
  type: 'STAFF' | 'VENUE' | 'ROLE' | 'ROLE_TEMPLATE' | 'MANAGERS';
  label: string;
  description?: string;
  venue?: string | null;
  count?: number;
};

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function actorName(actor: AuthUser | undefined | null) {
  if (!actor) return undefined;
  return `${actor.firstName} ${actor.lastName}`.trim() || actor.email || actor.roleTitle || undefined;
}

function actorStaffId(actor: AuthUser | undefined | null) {
  return actor?.id ?? null;
}

export function canManageMessaging(actor: AuthUser | undefined | null) {
  return Boolean(
    actor &&
      actor.accountType !== 'VENUE_DEVICE' &&
      !actor.deviceAccount &&
      (actor.isAdmin ||
        actor.role === 'ADMIN' ||
        actor.role === 'MANAGER' ||
        actor.appAccess.some((access) =>
          access.appId === 'SETTINGS' &&
          access.status === 'ENABLED' &&
          (access.role === 'ADMIN' || access.permissions?.admin || access.permissions?.communicationsManage)
        ) ||
        actor.appAccess.some((access) =>
          access.appId === 'STAFF' &&
          access.status === 'ENABLED' &&
          (access.role === 'MANAGER' || access.role === 'ADMIN' || access.permissions?.communicationsManage)
        ))
  );
}

function canDirectMessage(actor: AuthUser | undefined | null) {
  return Boolean(
    actor &&
      actor.accountType !== 'VENUE_DEVICE' &&
      (canManageMessaging(actor) ||
        actor.appAccess.some((access) =>
          access.appId === 'STAFF' && access.status === 'ENABLED' && Boolean(access.permissions?.chatDirect)
        ))
  );
}

function actorVenue(actor: AuthUser | undefined | null) {
  return actor?.deviceAccount?.venue ?? actor?.venue ?? null;
}

function staffDisplayName(staff: Pick<StaffRecipient, 'firstName' | 'lastName' | 'email'>) {
  return `${staff.firstName} ${staff.lastName}`.trim() || staff.email || 'Staff member';
}

function staffBaseWhere(actor: AuthUser, options?: { includeActor?: boolean }) {
  return {
    accountType: 'HUMAN' as const,
    employmentStatus: 'ACTIVE' as const,
    mergedIntoStaffProfileId: null,
    ...(canManageMessaging(actor) || !actorVenue(actor) ? {} : { venue: actorVenue(actor) }),
    ...(options?.includeActor ? {} : { id: { not: actor.id } })
  };
}

function assertCanUseVenue(actor: AuthUser, venue: string) {
  if (actor.isAdmin || actor.role === 'ADMIN') return;
  const scopedVenue = actorVenue(actor);
  if (!scopedVenue || scopedVenue !== venue) {
    throw new HttpError(403, 'Messages are limited to your venue.');
  }
}

async function activeHumanStaffByIds(ids: string[], actor: AuthUser) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  return prisma.staffProfile.findMany({
    where: {
      ...staffBaseWhere(actor),
      id: { in: unique, ...(staffBaseWhere(actor).id ?? {}) }
    },
    select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
  });
}

async function managerStaffForVenue(venue: string, actor: AuthUser) {
  assertCanUseVenue(actor, venue);
  return prisma.staffProfile.findMany({
    where: {
      ...staffBaseWhere(actor),
      venue,
      OR: [
        { isAdmin: true },
        { appAccess: { some: { appId: 'STAFF', status: 'ENABLED', role: { in: ['MANAGER', 'ADMIN'] } } } },
        { appAccess: { some: { appId: 'SETTINGS', status: 'ENABLED', role: 'ADMIN' } } }
      ]
    },
    select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
  });
}

async function resolveRecipients(input: z.infer<typeof createMessageThreadSchema>, actor: AuthUser) {
  const recipientMap = new Map<string, StaffRecipient>();
  const manager = canManageMessaging(actor);

  const addStaff = (items: StaffRecipient[]) => {
    for (const item of items) recipientMap.set(item.id, item);
  };

  const groupStaffIds = input.recipientGroups.filter((group) => group.type === 'STAFF').map((group) => group.id);
  addStaff(await activeHumanStaffByIds([...input.staffProfileIds, ...groupStaffIds], actor));

  const venues = new Set([
    ...input.venues,
    ...input.recipientGroups.filter((group) => group.type === 'VENUE').map((group) => group.id),
    ...(input.venue && ['VENUE', 'ANNOUNCEMENT', 'HANDOVER'].includes(input.category) ? [input.venue] : [])
  ].map((item) => item.trim()).filter(Boolean));

  if (venues.size && !manager) throw new HttpError(403, 'Manager access is required to message venue groups.');
  for (const venue of venues) {
    assertCanUseVenue(actor, venue);
    addStaff(await prisma.staffProfile.findMany({
      where: { ...staffBaseWhere(actor), venue },
      select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
    }));
  }

  const roleTitles = new Set([
    ...input.roleTitles,
    ...input.recipientGroups.filter((group) => group.type === 'ROLE').map((group) => group.id),
    ...(input.role ? [input.role] : [])
  ].map((item) => item.trim()).filter(Boolean));

  if (roleTitles.size && !manager) throw new HttpError(403, 'Manager access is required to message role groups.');
  for (const roleTitle of roleTitles) {
    addStaff(await prisma.staffProfile.findMany({
      where: {
        ...staffBaseWhere(actor),
        roleTitle,
        ...(actorVenue(actor) && !actor.isAdmin && actor.role !== 'ADMIN' ? { venue: actorVenue(actor) } : {})
      },
      select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
    }));
  }

  const roleTemplateIds = new Set([
    ...input.roleTemplateIds,
    ...input.recipientGroups.filter((group) => group.type === 'ROLE_TEMPLATE').map((group) => group.id)
  ].map((item) => item.trim()).filter(Boolean));

  if (roleTemplateIds.size && !manager) throw new HttpError(403, 'Manager access is required to message role template groups.');
  if (roleTemplateIds.size) {
    addStaff(await prisma.staffProfile.findMany({
      where: {
        ...staffBaseWhere(actor),
        roleTemplateId: { in: [...roleTemplateIds] },
        ...(actorVenue(actor) && !actor.isAdmin && actor.role !== 'ADMIN' ? { venue: actorVenue(actor) } : {})
      },
      select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
    }));
  }

  const managerVenues = new Set([
    ...input.managerVenues,
    ...input.recipientGroups.filter((group) => group.type === 'MANAGERS').map((group) => group.id)
  ].map((item) => item.trim()).filter(Boolean));

  if (managerVenues.size && !manager) throw new HttpError(403, 'Manager access is required to message manager groups.');
  for (const venue of managerVenues) addStaff(await managerStaffForVenue(venue, actor));

  if (!recipientMap.size && !manager && input.staffProfileIds.length <= 1) {
    throw new HttpError(400, 'Choose a recipient.');
  }

  const actorId = actorStaffId(actor);
  if (actorId) {
    const actorProfile = await prisma.staffProfile.findFirst({
      where: { id: actorId, accountType: 'HUMAN', employmentStatus: 'ACTIVE', mergedIntoStaffProfileId: null },
      select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
    });
    if (actorProfile) recipientMap.set(actorProfile.id, actorProfile);
  }

  const recipients = [...recipientMap.values()];
  if (!recipients.length) throw new HttpError(400, 'Choose at least one active staff recipient.');
  return recipients;
}

function actorRecipientWhere(actor: AuthUser) {
  const parts = [
    actor.id ? { staffProfileId: actor.id } : undefined,
    actorVenue(actor) ? { venue: actorVenue(actor) } : undefined,
    actor.roleTitle ? { role: actor.roleTitle } : undefined,
    actor.role ? { role: actor.role } : undefined
  ].filter(Boolean) as Array<Record<string, unknown>>;
  return parts.length ? parts : [{ staffProfileId: '__none__' }];
}

function threadSummary(thread: {
  id: string;
  subject: string;
  venue: string | null;
  category: string;
  priority: string;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  recipients: Array<{ staffProfileId: string | null; readAt: Date | null; actionRequired: boolean; dueAt: Date | null }>;
  messages: Array<{ body: string }>;
}, actor?: AuthUser) {
  const actorId = actor?.id;
  const relevantRecipients = actorId
    ? thread.recipients.filter((recipient) => recipient.staffProfileId === actorId)
    : thread.recipients;
  const unreadRecipients = relevantRecipients.length ? relevantRecipients : thread.recipients;
  return {
    id: thread.id,
    subject: thread.subject,
    venue: thread.venue,
    category: thread.category,
    priority: thread.priority,
    createdById: thread.createdById,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    archivedAt: thread.archivedAt?.toISOString() ?? null,
    unread: unreadRecipients.some((recipient) => !recipient.readAt),
    actionRequired: unreadRecipients.some((recipient) => recipient.actionRequired),
    dueAt: unreadRecipients.find((recipient) => recipient.dueAt)?.dueAt?.toISOString() ?? null,
    latestMessage: thread.messages[0]?.body ?? null
  };
}

export async function listInboxForUser(actor: AuthUser) {
  const where = canManageMessaging(actor)
    ? { archivedAt: null }
    : {
        archivedAt: null,
        OR: [
          { recipients: { some: { OR: actorRecipientWhere(actor) } } },
          { createdById: actor.id }
        ]
      };

  const threads = await prisma.commsThread.findMany({
    where,
    include: {
      recipients: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 }
    },
    orderBy: { updatedAt: 'desc' },
    take: 100
  });

  return threads.map((thread) => threadSummary(thread, actor));
}

export async function getThreadForUser(threadId: string, actor: AuthUser) {
  const thread = await prisma.commsThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
      recipients: true,
      links: true
    }
  });

  if (!thread) return null;

  if (!canManageMessaging(actor)) {
    const allowed = thread.createdById === actor.id || thread.recipients.some((recipient) =>
      recipient.staffProfileId === actor.id ||
      (actorVenue(actor) && recipient.venue === actorVenue(actor)) ||
      (actor.roleTitle && recipient.role === actor.roleTitle) ||
      recipient.role === actor.role
    );
    if (!allowed) throw new HttpError(403, 'Message access required');
  }

  return thread;
}

export async function createThread(actor: AuthUser, input: unknown) {
  if (actor.accountType === 'VENUE_DEVICE' && !actor.deviceAccount) {
    throw new HttpError(403, 'Staff PIN required on this shared device.');
  }

  const data = createMessageThreadSchema.parse(input);
  const manager = canManageMessaging(actor);
  const explicitStaffOnly = data.staffProfileIds.length > 0 &&
    !data.venues.length && !data.roleTitles.length && !data.roleTemplateIds.length && !data.managerVenues.length && !data.recipientGroups.some((group) => group.type !== 'STAFF') &&
    !data.venue && !data.role;

  if (!manager) {
    if (!explicitStaffOnly || data.staffProfileIds.length !== 1) {
      throw new HttpError(403, 'Manager access is required to message groups or multiple staff.');
    }
    if (!canDirectMessage(actor)) {
      throw new HttpError(403, 'Direct messaging is not enabled for your profile.');
    }
  }

  const recipients = await resolveRecipients(data, actor);
  const actorId = actorStaffId(actor);
  const dueAt = data.dueAt ? new Date(data.dueAt) : undefined;
  const thread = await prisma.commsThread.create({
    data: {
      subject: data.subject,
      venue: clean(data.venue) ?? recipients.find((recipient) => recipient.venue)?.venue ?? null,
      category: data.category,
      priority: data.priority,
      createdById: actorId,
      messages: {
        create: {
          body: data.body,
          createdById: actorId
        }
      },
      recipients: {
        create: recipients.map((recipient) => ({
          staffProfileId: recipient.id,
          venue: recipient.venue,
          role: recipient.roleTitle,
          readAt: recipient.id === actorId ? new Date() : undefined,
          actionRequired: Boolean(data.actionRequired) && recipient.id !== actorId,
          dueAt
        }))
      }
    },
    include: { messages: true, recipients: true }
  });

  return thread;
}

export async function addMessage(actor: AuthUser, threadId: string, input: unknown) {
  if (actor.accountType === 'VENUE_DEVICE' && !actor.deviceAccount) {
    throw new HttpError(403, 'Staff PIN required on this shared device.');
  }

  await getThreadForUser(threadId, actor);
  const data = createMessageSchema.parse(input);
  const actorId = actorStaffId(actor);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.commsMessage.create({
      data: { threadId, body: data.body, createdById: actorId }
    });
    await tx.commsThread.update({ where: { id: threadId }, data: { updatedAt: new Date() } });
    await tx.commsRecipient.updateMany({
      where: actorId ? { threadId, staffProfileId: { not: actorId } } : { threadId },
      data: { readAt: null }
    });
    if (actorId) {
      await tx.commsRecipient.updateMany({ where: { threadId, staffProfileId: actorId }, data: { readAt: new Date() } });
    }
    return created;
  });

  return message;
}

export async function markThreadRead(actor: AuthUser, threadId: string) {
  const thread = await getThreadForUser(threadId, actor);
  if (!thread) throw new HttpError(404, 'Thread not found');
  await prisma.commsRecipient.updateMany({
    where: { threadId: thread.id, OR: actorRecipientWhere(actor) as any },
    data: { readAt: new Date() }
  });
  return { ok: true };
}

export async function acknowledgeThread(actor: AuthUser, threadId: string) {
  const thread = await getThreadForUser(threadId, actor);
  if (!thread) throw new HttpError(404, 'Thread not found');
  await prisma.commsRecipient.updateMany({
    where: { threadId: thread.id, actionRequired: true, OR: actorRecipientWhere(actor) as any },
    data: { acknowledgedAt: new Date(), readAt: new Date() }
  });
  return { ok: true };
}

export async function listRecipientOptions(actor: AuthUser) {
  const staff = await prisma.staffProfile.findMany({
    where: staffBaseWhere(actor),
    orderBy: [{ venue: 'asc' }, { firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, email: true, roleTitle: true, venue: true, roleTemplateId: true }
  });

  const staffOptions: RecipientOption[] = staff.map((member) => ({
    id: member.id,
    type: 'STAFF',
    label: staffDisplayName(member),
    description: [member.roleTitle || 'Staff', member.venue].filter(Boolean).join(' · '),
    venue: member.venue
  }));

  const groupBy = <T extends string | null>(getKey: (member: StaffRecipient) => T) => {
    const map = new Map<string, StaffRecipient[]>();
    for (const member of staff) {
      const key = getKey(member);
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), member]);
    }
    return map;
  };

  const venueOptions: RecipientOption[] = [...groupBy((member) => member.venue).entries()].map(([venue, members]) => ({
    id: venue,
    type: 'VENUE',
    label: `${venue} staff`,
    description: 'All active staff at this venue',
    venue,
    count: members.length
  }));

  const roleOptions: RecipientOption[] = [...groupBy((member) => member.roleTitle || null).entries()].map(([role, members]) => ({
    id: role,
    type: 'ROLE',
    label: role,
    description: 'Active staff with this role title',
    count: members.length
  }));

  const roleTemplates = await prisma.staffRoleTemplate.findMany({
    where: {
      isActive: true,
      ...(actorVenue(actor) && !actor.isAdmin && actor.role !== 'ADMIN' ? { OR: [{ venue: actorVenue(actor) }, { venue: null }] } : {})
    },
    orderBy: [{ name: 'asc' }],
    include: { staffProfiles: { where: staffBaseWhere(actor), select: { id: true } } }
  });

  const roleTemplateOptions: RecipientOption[] = roleTemplates
    .filter((template) => template.staffProfiles.length > 0)
    .map((template) => ({
      id: template.id,
      type: 'ROLE_TEMPLATE',
      label: template.name,
      description: template.description ?? template.roleTitle ?? 'Role template group',
      venue: template.venue,
      count: template.staffProfiles.length
    }));

  const managerOptions: RecipientOption[] = [];
  if (canManageMessaging(actor)) {
    for (const option of venueOptions) {
      const managers = await managerStaffForVenue(option.id, actor);
      if (managers.length) {
        managerOptions.push({
          id: option.id,
          type: 'MANAGERS',
          label: `${option.id} managers`,
          description: 'Managers and admins for this venue',
          venue: option.id,
          count: managers.length
        });
      }
    }
  }

  return {
    staff: staffOptions,
    groups: [...venueOptions, ...roleOptions, ...roleTemplateOptions, ...managerOptions],
    canBroadcast: canManageMessaging(actor),
    canDirect: canDirectMessage(actor)
  };
}

export async function evaluateCommsAlertsDryRun() {
  const rules = await prisma.commsAlertRule.findMany({ where: { enabled: true }, orderBy: { createdAt: 'desc' } });
  return {
    dryRun: true,
    evaluated: rules.length,
    wouldCreate: 0,
    events: rules.map((rule) => ({
      alertType: rule.alertType,
      subject: `${rule.name} will be evaluated once its data source is wired`,
      venue: rule.venue,
      value: null,
      thresholdValue: rule.thresholdValue,
      severity: 'INFO'
    }))
  };
}
