import type { AuthUser } from '@alma/shared';
import { prisma } from '@alma/db';
import { listCommsInbox } from './comms.service.js';

export type NotificationTone = 'danger' | 'warning' | 'info' | 'positive';

export type SuiteNotification = {
  id: string;
  tone: NotificationTone;
  title: string;
  description: string;
  to: string;
  href: string;
  appId: 'compliance' | 'staff' | 'comms';
  appLabel: string;
  createdAt: string;
};

const APP_URLS = {
  compliance: (process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? 'https://alma-compliance.web.app').replace(/\/+$/, ''),
  staff: (process.env.STAFF_WEB_URL ?? 'https://alma-staff.web.app').replace(/\/+$/, ''),
  comms: (process.env.COMMS_WEB_URL ?? 'https://alma-comms.web.app').replace(/\/+$/, '')
};

function fullName(actor: AuthUser) {
  return `${actor.firstName} ${actor.lastName}`.trim();
}

function isManager(actor: AuthUser) {
  return actor.accountType !== 'VENUE_DEVICE' && !actor.deviceAccount && (actor.isAdmin || actor.role === 'ADMIN' || actor.role === 'MANAGER');
}

function appLink(appId: keyof typeof APP_URLS, path: string) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${APP_URLS[appId]}${cleanPath}`;
}

function notification(input: Omit<SuiteNotification, 'href'>): SuiteNotification {
  return {
    ...input,
    href: appLink(input.appId, input.to)
  };
}

function issueWhereFor(actor: AuthUser) {
  if (isManager(actor)) {
    return {};
  }

  const name = fullName(actor);
  return {
    OR: [
      name ? { assignee: { equals: name, mode: 'insensitive' as const } } : undefined,
      actor.email ? { assignee: { equals: actor.email, mode: 'insensitive' as const } } : undefined
    ].filter(Boolean) as Array<{ assignee: { equals: string; mode: 'insensitive' } }>
  };
}

export const notificationsService = {
  async list(actor: AuthUser): Promise<SuiteNotification[]> {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const manager = isManager(actor);
    const venueWhere = actor.isAdmin ? {} : { venue: actor.venue ?? undefined };
    const notifications: SuiteNotification[] = [];

    const commsThreads = await listCommsInbox(actor).catch(() => []);
    for (const thread of commsThreads.filter((item) => item.unread || item.actionRequired).slice(0, 12)) {
      notifications.push(notification({
        id: `comms-${thread.id}`,
        tone: thread.priority === 'URGENT' ? 'danger' : thread.actionRequired ? 'warning' : 'info',
        title: thread.actionRequired ? `Action required: ${thread.subject}` : `Unread: ${thread.subject}`,
        description: thread.latestMessage?.slice(0, 140) || `${thread.category.toLowerCase()} message`,
        to: `/threads/${thread.id}`,
        appId: 'comms',
        appLabel: 'Comms',
        createdAt: thread.updatedAt
      }));
    }

    const [criticalIssues, overdueIssues] = await Promise.all([
      prisma.issue.findMany({
        where: {
          ...issueWhereFor(actor),
          severity: 'CRITICAL',
          status: { notIn: ['RESOLVED', 'CLOSED'] }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.issue.findMany({
        where: {
          ...issueWhereFor(actor),
          status: { notIn: ['RESOLVED', 'CLOSED'] },
          dueDate: { lt: now }
        },
        orderBy: { dueDate: 'asc' },
        take: 5
      })
    ]);

    for (const issue of criticalIssues) {
      notifications.push(notification({
        id: `issue-crit-${issue.id}`,
        tone: 'danger',
        title: `Critical issue: ${issue.title}`,
        description: issue.description.slice(0, 140),
        to: `/issues/${issue.id}`,
        appId: 'compliance',
        appLabel: 'Compliance',
        createdAt: issue.createdAt.toISOString()
      }));
    }

    for (const issue of overdueIssues) {
      notifications.push(notification({
        id: `issue-overdue-${issue.id}`,
        tone: 'warning',
        title: `Overdue: ${issue.title}`,
        description: issue.dueDate
          ? `Due ${issue.dueDate.toISOString().slice(0, 10)}`
          : 'Past due date',
        to: `/issues/${issue.id}`,
        appId: 'compliance',
        appLabel: 'Compliance',
        createdAt: (issue.dueDate ?? issue.createdAt).toISOString()
      }));
    }

    if (manager) {
      const [outOfRangeTemps, expiringRecords, openIncidents] = await Promise.all([
        prisma.temperatureLog.findMany({
          where: {
            status: 'OUT_OF_RANGE',
            asset: actor.isAdmin ? undefined : { venue: actor.venue ?? undefined }
          },
          orderBy: { recordedAt: 'desc' },
          include: { asset: true },
          take: 5
        }),
        prisma.staffComplianceRecord.findMany({
          where: {
            expiryDate: { gte: now, lte: soon },
            staffProfile: {
              accountType: 'HUMAN',
              ...(actor.isAdmin ? {} : { venue: actor.venue ?? undefined })
            }
          },
          orderBy: { expiryDate: 'asc' },
          include: { staffProfile: true },
          take: 5
        }),
        prisma.incidentReport.findMany({
          where: {
            status: 'OPEN',
            ...venueWhere
          },
          orderBy: { occurredAt: 'desc' },
          take: 5
        })
      ]);

      for (const log of outOfRangeTemps) {
        notifications.push(notification({
          id: `temp-${log.id}`,
          tone: 'danger',
          title: `Temperature out of range: ${log.asset.name}`,
          description: `${log.temperatureC.toFixed(1)}C at ${log.recordedAt.toISOString().slice(11, 16)}`,
          to: '/temperatures',
          appId: 'compliance',
          appLabel: 'Compliance',
          createdAt: log.recordedAt.toISOString()
        }));
      }

      for (const record of expiringRecords) {
        const name = `${record.staffProfile.firstName} ${record.staffProfile.lastName}`.trim();
        notifications.push(notification({
          id: `staff-${record.id}`,
          tone: 'warning',
          title: `${name} - ${record.title} expiring`,
          description: record.expiryDate
            ? `Expires ${record.expiryDate.toISOString().slice(0, 10)}`
            : 'Expiring soon',
          to: `/compliance`,
          appId: 'staff',
          appLabel: 'Staff',
          createdAt: (record.expiryDate ?? record.createdAt).toISOString()
        }));
      }

      for (const incident of openIncidents) {
        notifications.push(notification({
          id: `incident-${incident.id}`,
          tone: 'info',
          title: `Open incident: ${incident.title}`,
          description: incident.summary.slice(0, 140),
          to: '/incidents',
          appId: 'compliance',
          appLabel: 'Compliance',
          createdAt: incident.occurredAt.toISOString()
        }));
      }
    }

    notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return notifications.slice(0, 30);
  }
};
