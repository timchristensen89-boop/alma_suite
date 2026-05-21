import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { Router } from 'express';

export const notificationsRouter = Router();

const COMMS_WEB_URL = (process.env.COMMS_WEB_URL ?? 'https://alma-comms.web.app').replace(/\/+$/, '');

function actorScope(user: AuthUser | undefined) {
  return {
    venue: user?.venue ?? null,
    staffProfileId: user?.id ?? null,
    role: user?.roleTitle ?? user?.role ?? null
  };
}

notificationsRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authenticated' });
      return;
    }

    const { venue, staffProfileId, role } = actorScope(req.user);
    const threads = await prisma.commsThread.findMany({
      where: {
        archivedAt: null,
        OR: [
          staffProfileId ? { recipients: { some: { staffProfileId, readAt: null } } } : undefined,
          venue ? { recipients: { some: { venue, readAt: null } } } : undefined,
          role ? { recipients: { some: { role, readAt: null } } } : undefined,
          staffProfileId ? { recipients: { some: { staffProfileId, actionRequired: true, acknowledgedAt: null } } } : undefined,
          venue ? { recipients: { some: { venue, actionRequired: true, acknowledgedAt: null } } } : undefined,
          role ? { recipients: { some: { role, actionRequired: true, acknowledgedAt: null } } } : undefined
        ].filter(Boolean) as any
      },
      include: {
        recipients: true,
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { updatedAt: 'desc' },
      take: 12
    });

    res.json(threads.map((thread) => {
      const actionRequired = thread.recipients.some((recipient) => recipient.actionRequired && !recipient.acknowledgedAt);
      return {
        id: `comms-${thread.id}`,
        tone: thread.priority === 'URGENT' ? 'danger' : actionRequired ? 'warning' : 'info',
        title: actionRequired ? `Action required: ${thread.subject}` : `Unread: ${thread.subject}`,
        description: thread.messages[0]?.body?.slice(0, 140) || `${thread.category.toLowerCase()} message`,
        to: `/threads/${thread.id}`,
        href: `${COMMS_WEB_URL}/threads/${thread.id}`,
        appId: 'comms',
        appLabel: 'Comms',
        createdAt: thread.updatedAt.toISOString()
      };
    }));
  } catch (error) {
    next(error);
  }
});
