import { prisma } from '@alma/db';
import {
  almaAppIdSchema,
  suiteAnnouncementInputSchema,
  suiteChatMessageInputSchema,
  type AlmaAppId,
  type AuthUser
} from '@alma/shared';
import { Router } from 'express';
import { HttpError } from '../lib/http.js';

export const communicationsRouter = Router();

function clean(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseAppId(value: string | null | undefined): AlmaAppId | undefined {
  const parsed = almaAppIdSchema.safeParse(clean(value)?.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

function actorName(user: AuthUser | undefined) {
  if (!user) return undefined;
  return `${user.firstName} ${user.lastName}`.trim() || user.email || user.roleTitle;
}

function requireManager(user: AuthUser | undefined) {
  if (!user) throw new HttpError(401, 'Not authenticated');
  if (!user.isAdmin && user.role !== 'ADMIN' && user.role !== 'MANAGER') {
    throw new HttpError(403, 'Manager access required');
  }
}

communicationsRouter.get('/', async (req, res, next) => {
  try {
    const appId = parseAppId(String(req.query.appId ?? ''));
    const venue = clean(String(req.query.venue ?? ''));
    const channel = clean(String(req.query.channel ?? '')) ?? 'general';
    const now = new Date();
    const [announcements, chat] = await Promise.all([
      prisma.suiteAnnouncement.findMany({
        where: {
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            { OR: [{ appId: null }, ...(appId ? [{ appId }] : [])] },
            { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
          ]
        },
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        take: 10
      }),
      prisma.suiteChatMessage.findMany({
        where: {
          AND: [
            { channel },
            { OR: [{ appId: null }, ...(appId ? [{ appId }] : [])] },
            { OR: [{ venue: null }, ...(venue ? [{ venue }] : [])] }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 30
      })
    ]);
    res.json({
      announcements: announcements.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
        expiresAt: item.expiresAt?.toISOString() ?? null
      })),
      chat: chat.reverse().map((item) => ({ ...item, createdAt: item.createdAt.toISOString() }))
    });
  } catch (error) {
    next(error);
  }
});

communicationsRouter.post('/chat', async (req, res, next) => {
  try {
    const data = suiteChatMessageInputSchema.parse(req.body);
    const message = await prisma.suiteChatMessage.create({
      data: {
        channel: clean(data.channel) ?? 'general',
        appId: data.appId ?? null,
        venue: clean(data.venue) ?? null,
        body: data.body.trim(),
        createdById: req.user?.id,
        createdByName: actorName(req.user)
      }
    });
    res.status(201).json({ ...message, createdAt: message.createdAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

communicationsRouter.post('/announcements', async (req, res, next) => {
  try {
    requireManager(req.user);
    const data = suiteAnnouncementInputSchema.parse(req.body);
    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const announcement = await prisma.suiteAnnouncement.create({
      data: {
        title: data.title.trim(),
        body: data.body.trim(),
        audience: clean(data.audience)?.toUpperCase() ?? 'ALL',
        appId: data.appId ?? null,
        venue: clean(data.venue) ?? null,
        pinned: data.pinned ?? false,
        expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
        createdById: req.user?.id,
        createdByName: actorName(req.user)
      }
    });
    res.status(201).json({
      ...announcement,
      createdAt: announcement.createdAt.toISOString(),
      updatedAt: announcement.updatedAt.toISOString(),
      expiresAt: announcement.expiresAt?.toISOString() ?? null
    });
  } catch (error) {
    next(error);
  }
});
