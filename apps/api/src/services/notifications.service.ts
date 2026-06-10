import type { AuthUser } from '@alma/shared';
import { prisma } from '@alma/db';
import { listCommsInbox } from './comms.service.js';

export type NotificationTone = 'danger' | 'warning' | 'info' | 'positive';

// A notification category is a mutable channel a user can silence. Each
// generated notification belongs to exactly one.
export type NotificationCategory =
  | 'COMMS'
  | 'ISSUE_CRITICAL'
  | 'ISSUE_OVERDUE'
  | 'TEMP_OUT_OF_RANGE'
  | 'STAFF_EXPIRING'
  | 'INCIDENT_OPEN'
  | 'INTEGRATION_FAILED'
  | 'TIMESHEET_OPEN';

export const NOTIFICATION_CATEGORIES: Array<{ category: NotificationCategory; label: string }> = [
  { category: 'COMMS', label: 'Comms messages' },
  { category: 'ISSUE_CRITICAL', label: 'Critical issues' },
  { category: 'ISSUE_OVERDUE', label: 'Overdue issues' },
  { category: 'TEMP_OUT_OF_RANGE', label: 'Temperature alerts' },
  { category: 'STAFF_EXPIRING', label: 'Expiring staff records' },
  { category: 'INCIDENT_OPEN', label: 'Open incidents' },
  { category: 'INTEGRATION_FAILED', label: 'Integration sync failures' },
  { category: 'TIMESHEET_OPEN', label: 'Forgotten clock-outs' }
];

const CATEGORY_LABEL: Record<NotificationCategory, string> = NOTIFICATION_CATEGORIES.reduce(
  (acc, item) => ({ ...acc, [item.category]: item.label }),
  {} as Record<NotificationCategory, string>
);

const VALID_CATEGORIES = new Set<string>(NOTIFICATION_CATEGORIES.map((item) => item.category));

export type SuiteNotification = {
  id: string;
  tone: NotificationTone;
  category: NotificationCategory;
  categoryLabel: string;
  title: string;
  description: string;
  to: string;
  href: string;
  appId: 'compliance' | 'staff' | 'comms' | 'admin';
  appLabel: string;
  createdAt: string;
  // ISO timestamp the current user read/dismissed this notification, or null
  // if still unread. Server-tracked so read state syncs across every app.
  readAt: string | null;
};

const APP_URLS = {
  compliance: (process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? 'https://alma-compliance.web.app').replace(/\/+$/, ''),
  staff: (process.env.STAFF_WEB_URL ?? 'https://alma-staff.web.app').replace(/\/+$/, ''),
  comms: (process.env.COMMS_WEB_URL ?? 'https://alma-comms.web.app').replace(/\/+$/, ''),
  admin: (process.env.ADMIN_WEB_URL ?? 'https://alma-suite-admin.web.app').replace(/\/+$/, '')
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

function notification(input: Omit<SuiteNotification, 'href' | 'categoryLabel' | 'readAt'>): SuiteNotification {
  return {
    ...input,
    categoryLabel: CATEGORY_LABEL[input.category],
    href: appLink(input.appId, input.to),
    readAt: null
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
    const mutedCategories = await this.mutedCategorySet(actor);

    const commsThreads = await listCommsInbox(actor).catch(() => []);
    for (const thread of commsThreads.filter((item) => item.unread || item.actionRequired).slice(0, 12)) {
      notifications.push(notification({
        id: `comms-${thread.id}`,
        category: 'COMMS',
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
        category: 'ISSUE_CRITICAL',
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
        category: 'ISSUE_OVERDUE',
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
      // Forgotten clock-out: an open timesheet (no clock-out) older than this.
      const openShiftCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
      // Integration sync failure: only surface errors from the last 2 days so the
      // alert clears once a later sync succeeds / time passes.
      const syncFailCutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      const [outOfRangeTemps, expiringRecords, openIncidents, openTimesheets, failedSyncRuns] = await Promise.all([
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
        }),
        // An open clock-in stays status DRAFT until clock-out (liveTimesheetHours
        // treats DRAFT as still-running), so a DRAFT older than 12h = forgotten
        // clock-out.
        prisma.timesheet.findMany({
          where: {
            status: 'DRAFT',
            clockInAt: { lt: openShiftCutoff },
            staffProfile: { accountType: 'HUMAN', mergedIntoStaffProfileId: null },
            ...venueWhere
          },
          orderBy: { clockInAt: 'asc' },
          include: { staffProfile: true },
          take: 5
        }),
        // Integration failures are business-level, so admins always see them and a
        // venue manager sees them too (a broken Deputy/Xero sync affects everyone).
        prisma.integrationSyncRun.findMany({
          where: { status: 'ERROR', finishedAt: { gte: syncFailCutoff } },
          orderBy: { finishedAt: 'desc' },
          take: 5
        })
      ]);

      for (const log of outOfRangeTemps) {
        notifications.push(notification({
          id: `temp-${log.id}`,
          category: 'TEMP_OUT_OF_RANGE',
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
          category: 'STAFF_EXPIRING',
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
          category: 'INCIDENT_OPEN',
          tone: 'info',
          title: `Open incident: ${incident.title}`,
          description: incident.summary.slice(0, 140),
          to: '/incidents',
          appId: 'compliance',
          appLabel: 'Compliance',
          createdAt: incident.occurredAt.toISOString()
        }));
      }

      for (const ts of openTimesheets) {
        const name = `${ts.staffProfile.firstName} ${ts.staffProfile.lastName}`.trim();
        const hours = Math.floor((Date.now() - ts.clockInAt.getTime()) / 3_600_000);
        notifications.push(notification({
          id: `timesheet-open-${ts.id}`,
          category: 'TIMESHEET_OPEN',
          tone: 'warning',
          title: `${name || 'Someone'} still clocked in (${hours}h)`,
          description: `Clocked in ${ts.clockInAt.toISOString().slice(11, 16)} and not clocked out — fix before approving the timesheet.`,
          to: '/timesheets',
          appId: 'staff',
          appLabel: 'Staff',
          createdAt: ts.clockInAt.toISOString()
        }));
      }

      // One alert per failed provider (latest error) so the feed doesn't repeat.
      const seenProviders = new Set<string>();
      for (const run of failedSyncRuns) {
        if (seenProviders.has(run.provider)) continue;
        seenProviders.add(run.provider);
        notifications.push(notification({
          id: `integration-failed-${run.provider}`,
          category: 'INTEGRATION_FAILED',
          tone: 'danger',
          title: `${run.provider} sync failed`,
          description: (run.errorSummary ?? 'A sync run errored — check Integration Health.').slice(0, 140),
          to: '/integrations/health',
          appId: 'admin',
          appLabel: 'Admin',
          createdAt: (run.finishedAt ?? now).toISOString()
        }));
      }
    }

    const visible = mutedCategories.size
      ? notifications.filter((item) => !mutedCategories.has(item.category))
      : notifications;
    visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const top = visible.slice(0, 30);

    // Stamp each notification with the user's server-side read marker so the
    // unread badge is identical on every app in the suite.
    const reads = await this.readMap(
      actor,
      top.map((item) => item.id)
    );
    for (const item of top) {
      item.readAt = reads.get(item.id) ?? null;
    }
    return top;
  },

  // Map of notificationId -> ISO readAt for this user, limited to the given ids.
  async readMap(actor: AuthUser, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.notificationRead
      .findMany({
        where: { staffProfileId: actor.id, notificationId: { in: ids } },
        select: { notificationId: true, readAt: true }
      })
      .catch(() => [] as Array<{ notificationId: string; readAt: Date }>);
    return new Map(rows.map((row) => [row.notificationId, row.readAt.toISOString()]));
  },

  // Mark a set of notifications read for this user (idempotent upsert).
  async markRead(actor: AuthUser, ids: string[]): Promise<{ marked: number }> {
    const clean = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean))).slice(0, 200);
    let marked = 0;
    for (const notificationId of clean) {
      await prisma.notificationRead
        .upsert({
          where: { staffProfileId_notificationId: { staffProfileId: actor.id, notificationId } },
          create: { staffProfileId: actor.id, notificationId },
          update: {}
        })
        .then(() => {
          marked += 1;
        })
        .catch(() => undefined);
    }
    return { marked };
  },

  // Mark every currently-visible notification read for this user.
  async markAllRead(actor: AuthUser): Promise<{ marked: number }> {
    const current = await this.list(actor);
    return this.markRead(
      actor,
      current.map((item) => item.id)
    );
  },

  // Clear all read markers for this user ("restore" everything to unread).
  async clearReads(actor: AuthUser): Promise<{ cleared: number }> {
    const result = await prisma.notificationRead
      .deleteMany({ where: { staffProfileId: actor.id } })
      .catch(() => ({ count: 0 }));
    return { cleared: result.count };
  },

  // Set of categories this user has silenced.
  async mutedCategorySet(actor: AuthUser): Promise<Set<string>> {
    const rows = await prisma.notificationMutePreference
      .findMany({ where: { staffProfileId: actor.id }, select: { category: true } })
      .catch(() => [] as Array<{ category: string }>);
    return new Set(rows.map((row) => row.category));
  },

  // The mute settings payload for the UI: every available category +
  // which ones the user has currently muted.
  async mutes(actor: AuthUser): Promise<{
    available: Array<{ category: NotificationCategory; label: string }>;
    muted: string[];
  }> {
    const muted = await this.mutedCategorySet(actor);
    return {
      available: NOTIFICATION_CATEGORIES,
      muted: [...muted]
    };
  },

  // Toggle a category mute for the user. Unknown categories are rejected
  // so a typo can't silently persist a dead preference.
  async setMute(actor: AuthUser, category: string, muted: boolean): Promise<{ muted: string[] }> {
    if (!VALID_CATEGORIES.has(category)) {
      throw new Error(`Unknown notification category: ${category}`);
    }
    if (muted) {
      await prisma.notificationMutePreference.upsert({
        where: { staffProfileId_category: { staffProfileId: actor.id, category } },
        create: { staffProfileId: actor.id, category },
        update: {}
      });
    } else {
      await prisma.notificationMutePreference.deleteMany({
        where: { staffProfileId: actor.id, category }
      });
    }
    return { muted: [...(await this.mutedCategorySet(actor))] };
  }
};
