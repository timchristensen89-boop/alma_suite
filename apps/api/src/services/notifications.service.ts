import { prisma } from '@alma/db';

export type NotificationTone = 'danger' | 'warning' | 'info' | 'positive';

export type Notification = {
  id: string;
  tone: NotificationTone;
  title: string;
  description: string;
  to: string;
  createdAt: string;
};

export const notificationsService = {
  async list(): Promise<Notification[]> {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [
      criticalIssues,
      overdueIssues,
      outOfRangeTemps,
      expiringRecords,
      openIncidents
    ] = await Promise.all([
      prisma.issue.findMany({
        where: { severity: 'CRITICAL', status: { notIn: ['RESOLVED', 'CLOSED'] } },
        orderBy: { createdAt: 'desc' },
        take: 5
      }),
      prisma.issue.findMany({
        where: {
          status: { notIn: ['RESOLVED', 'CLOSED'] },
          dueDate: { lt: now }
        },
        orderBy: { dueDate: 'asc' },
        take: 5
      }),
      prisma.temperatureLog.findMany({
        where: { status: 'OUT_OF_RANGE' },
        orderBy: { recordedAt: 'desc' },
        include: { asset: true },
        take: 5
      }),
      prisma.staffComplianceRecord.findMany({
        where: { expiryDate: { gte: now, lte: soon } },
        orderBy: { expiryDate: 'asc' },
        include: { staffProfile: true },
        take: 5
      }),
      prisma.incidentReport.findMany({
        where: { status: 'OPEN' },
        orderBy: { occurredAt: 'desc' },
        take: 5
      })
    ]);

    const notifications: Notification[] = [];

    for (const issue of criticalIssues) {
      notifications.push({
        id: `issue-crit-${issue.id}`,
        tone: 'danger',
        title: `Critical issue: ${issue.title}`,
        description: issue.description.slice(0, 140),
        to: `/issues/${issue.id}`,
        createdAt: issue.createdAt.toISOString()
      });
    }

    for (const issue of overdueIssues) {
      notifications.push({
        id: `issue-overdue-${issue.id}`,
        tone: 'warning',
        title: `Overdue: ${issue.title}`,
        description: issue.dueDate
          ? `Due ${issue.dueDate.toISOString().slice(0, 10)}`
          : 'Past due date',
        to: `/issues/${issue.id}`,
        createdAt: (issue.dueDate ?? issue.createdAt).toISOString()
      });
    }

    for (const log of outOfRangeTemps) {
      notifications.push({
        id: `temp-${log.id}`,
        tone: 'danger',
        title: `Temperature out of range: ${log.asset.name}`,
        description: `${log.temperatureC.toFixed(1)}°C at ${log.recordedAt.toISOString().slice(11, 16)}`,
        to: '/temperatures',
        createdAt: log.recordedAt.toISOString()
      });
    }

    for (const record of expiringRecords) {
      const name = `${record.staffProfile.firstName} ${record.staffProfile.lastName}`;
      notifications.push({
        id: `staff-${record.id}`,
        tone: 'warning',
        title: `${name} — ${record.title} expiring`,
        description: record.expiryDate
          ? `Expires ${record.expiryDate.toISOString().slice(0, 10)}`
          : 'Expiring soon',
        to: '/staff',
        createdAt: (record.expiryDate ?? record.createdAt).toISOString()
      });
    }

    for (const incident of openIncidents) {
      notifications.push({
        id: `incident-${incident.id}`,
        tone: 'info',
        title: `Open incident: ${incident.title}`,
        description: incident.summary.slice(0, 140),
        to: '/incidents',
        createdAt: incident.occurredAt.toISOString()
      });
    }

    notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return notifications;
  }
};
