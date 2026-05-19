import { z } from 'zod';
import { prisma } from '@alma/db';

const threadCategorySchema = z.enum(['INBOX', 'VENUE', 'ANNOUNCEMENT', 'HANDOVER', 'TASK', 'ALERT', 'GENERAL']);
const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const createCommsThreadSchema = z.object({
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(8000),
  venue: z.string().trim().optional(),
  category: threadCategorySchema.default('GENERAL'),
  priority: prioritySchema.default('NORMAL'),
  staffProfileIds: z.array(z.string()).optional(),
  role: z.string().trim().optional(),
  actionRequired: z.boolean().optional(),
  dueAt: z.string().datetime().optional()
});

export const createCommsMessageSchema = z.object({
  body: z.string().trim().min(1).max(8000)
});

export function canManageComms(actor: any) {
  return Boolean(
    actor?.isAdmin ||
      actor?.role === 'ADMIN' ||
      actor?.role === 'MANAGER' ||
      actor?.appAccess?.some?.((access: any) =>
        access.app === 'SETTINGS' &&
        access.enabled &&
        (access.role === 'ADMIN' || access.permissions?.admin || access.permissions?.communicationsManage)
      )
  );
}

function getActorScope(actor: any) {
  return {
    venue: actor?.venue ?? actor?.staffProfile?.venue ?? null,
    staffProfileId: actor?.staffProfileId ?? actor?.staffProfile?.id ?? actor?.id ?? null,
    role: actor?.roleTitle ?? actor?.staffProfile?.roleTitle ?? actor?.role ?? null
  };
}

export async function listCommsInbox(actor: any) {
  const { venue, staffProfileId, role } = getActorScope(actor);

  const threads = await prisma.commsThread.findMany({
    where: {
      archivedAt: null,
      OR: [
        staffProfileId ? { recipients: { some: { staffProfileId } } } : undefined,
        venue ? { recipients: { some: { venue } } } : undefined,
        role ? { recipients: { some: { role } } } : undefined,
        venue ? { venue, category: { in: ['VENUE', 'ANNOUNCEMENT', 'HANDOVER'] } } : undefined
      ].filter(Boolean) as any
    },
    include: {
      recipients: true,
      messages: { orderBy: { createdAt: 'desc' }, take: 1 }
    },
    orderBy: { updatedAt: 'desc' },
    take: 80
  });

  return threads.map((thread) => ({
    id: thread.id,
    subject: thread.subject,
    venue: thread.venue,
    category: thread.category,
    priority: thread.priority,
    createdById: thread.createdById,
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    archivedAt: thread.archivedAt?.toISOString() ?? null,
    unread: thread.recipients.some((recipient) => !recipient.readAt),
    actionRequired: thread.recipients.some((recipient) => recipient.actionRequired),
    dueAt: thread.recipients.find((recipient) => recipient.dueAt)?.dueAt?.toISOString() ?? null,
    latestMessage: thread.messages[0]?.body ?? null
  }));
}

export async function getCommsThread(threadId: string, actor: any) {
  const thread = await prisma.commsThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, include: { attachments: true } },
      recipients: true,
      links: true
    }
  });

  if (!thread) return null;

  if (!canManageComms(actor)) {
    const { venue, staffProfileId, role } = getActorScope(actor);
    const allowed =
      thread.recipients.some((recipient) =>
        (staffProfileId && recipient.staffProfileId === staffProfileId) ||
        (venue && recipient.venue === venue) ||
        (role && recipient.role === role)
      ) ||
      (venue && thread.venue === venue && ['VENUE', 'ANNOUNCEMENT', 'HANDOVER'].includes(thread.category));

    if (!allowed) {
      const error = new Error('Comms access required');
      (error as any).statusCode = 403;
      throw error;
    }
  }

  return thread;
}

export async function createCommsThread(input: unknown, actor: any) {
  if (!canManageComms(actor)) {
    const error = new Error('Comms manager access required');
    (error as any).statusCode = 403;
    throw error;
  }

  const data = createCommsThreadSchema.parse(input);
  const createdById = getActorScope(actor).staffProfileId;

  return prisma.commsThread.create({
    data: {
      subject: data.subject,
      venue: data.venue,
      category: data.category,
      priority: data.priority,
      createdById,
      messages: {
        create: {
          body: data.body,
          createdById
        }
      },
      recipients: {
        create: [
          ...(data.staffProfileIds ?? []).map((staffProfileId) => ({
            staffProfileId,
            actionRequired: Boolean(data.actionRequired),
            dueAt: data.dueAt ? new Date(data.dueAt) : undefined
          })),
          ...(data.venue
            ? [
                {
                  venue: data.venue,
                  actionRequired: Boolean(data.actionRequired),
                  dueAt: data.dueAt ? new Date(data.dueAt) : undefined
                }
              ]
            : []),
          ...(data.role
            ? [
                {
                  role: data.role,
                  actionRequired: Boolean(data.actionRequired),
                  dueAt: data.dueAt ? new Date(data.dueAt) : undefined
                }
              ]
            : [])
        ]
      }
    },
    include: { messages: true, recipients: true }
  });
}

export async function addCommsMessage(threadId: string, input: unknown, actor: any) {
  await getCommsThread(threadId, actor);
  const data = createCommsMessageSchema.parse(input);
  const createdById = getActorScope(actor).staffProfileId;

  const message = await prisma.commsMessage.create({
    data: {
      threadId,
      body: data.body,
      createdById
    }
  });

  await prisma.commsThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() }
  });

  return message;
}

export async function markCommsThreadRead(threadId: string, actor: any) {
  const thread = await getCommsThread(threadId, actor);
  if (!thread) {
    const error = new Error('Thread not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const { staffProfileId, venue, role } = getActorScope(actor);

  await prisma.commsRecipient.updateMany({
    where: {
      threadId: thread.id,
      OR: [
        staffProfileId ? { staffProfileId } : undefined,
        venue ? { venue } : undefined,
        role ? { role } : undefined
      ].filter(Boolean) as any
    },
    data: { readAt: new Date() }
  });

  return { ok: true };
}

export async function acknowledgeCommsThread(threadId: string, actor: any) {
  const thread = await getCommsThread(threadId, actor);
  if (!thread) {
    const error = new Error('Thread not found');
    (error as any).statusCode = 404;
    throw error;
  }

  const { staffProfileId, venue, role } = getActorScope(actor);

  await prisma.commsRecipient.updateMany({
    where: {
      threadId: thread.id,
      actionRequired: true,
      OR: [
        staffProfileId ? { staffProfileId } : undefined,
        venue ? { venue } : undefined,
        role ? { role } : undefined
      ].filter(Boolean) as any
    },
    data: { acknowledgedAt: new Date() }
  });

  return { ok: true };
}

export async function evaluateCommsAlertsDryRun() {
  const rules = await prisma.commsAlertRule.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'desc' }
  });

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
