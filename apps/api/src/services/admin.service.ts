import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AlmaAppId,
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminIntegrationsStatusPayload,
  AdminOverviewPayload,
  AdminReadinessWarning,
  AdminSystemHealthPayload
} from '@alma/shared';
import { env } from '../env.js';
import { mailService } from './mail.service.js';
import { settingsService } from './settings.service.js';

const APP_LABELS: Record<AlmaAppId, string> = {
  COMPLIANCE: 'Compliance',
  STOCK: 'Stock',
  STAFF: 'Staff',
  REPORTS: 'Reports',
  RESERVE: 'Reserve',
  MARKETING: 'Marketing',
  GIFTCARDS: 'Gift Cards',
  TRAINING: 'Training',
  SETTINGS: 'Settings'
};

const APP_IDS = Object.keys(APP_LABELS) as AlmaAppId[];

const activeStaffWhere: Prisma.StaffProfileWhereInput = {
  employmentStatus: 'ACTIVE',
  mergedIntoStaffProfileId: null
};

function startOfMonday(input = new Date()) {
  const date = new Date(input);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function endOfDay(input: Date) {
  const date = new Date(input);
  date.setDate(date.getDate() + 1);
  return date;
}

function provider() {
  if (process.env.RESEND_API_KEY && (process.env.RESEND_FROM || process.env.MAIL_FROM)) return 'resend';
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) return 'smtp';
  return 'none';
}

function hasAdminPermission(value: unknown) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { admin?: unknown }).admin === true
  );
}

function summariseAuditEvent(event: {
  id: string;
  staffProfileId: string;
  eventType: string;
  summary: string;
  createdByName: string | null;
  createdAt: Date;
  staffProfile: {
    firstName: string;
    lastName: string;
    roleTitle: string | null;
    venue: string | null;
  };
}): AdminAuditEventSummary {
  return {
    id: event.id,
    staffProfileId: event.staffProfileId,
    staffName: `${event.staffProfile.firstName} ${event.staffProfile.lastName}`.trim(),
    staffRoleTitle: event.staffProfile.roleTitle,
    venue: event.staffProfile.venue,
    eventType: event.eventType,
    summary: event.summary,
    createdByName: event.createdByName,
    createdAt: event.createdAt.toISOString()
  };
}

function appUrlRows() {
  const entries = [
    ['Compliance', 'COMPLIANCE_WEB_URL', process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? null],
    ['Stock', 'STOCK_WEB_URL', process.env.STOCK_WEB_URL ?? null],
    ['Staff', 'STAFF_WEB_URL', process.env.STAFF_WEB_URL ?? null],
    ['Reports', 'REPORTS_WEB_URL', process.env.REPORTS_WEB_URL ?? null],
    ['Reserve', 'RESERVE_WEB_URL', process.env.RESERVE_WEB_URL ?? null],
    ['Marketing', 'MARKETING_WEB_URL', process.env.MARKETING_WEB_URL ?? null],
    ['Gift Cards', 'GIFTCARDS_WEB_URL', process.env.GIFTCARDS_WEB_URL ?? process.env.GIFT_CARDS_WEB_URL ?? null],
    ['API', 'API_PUBLIC_URL', env.publicApiUrl ?? null]
  ] as const;

  return entries.map(([app, envVar, url]) => ({
    app,
    envVar,
    status: url ? 'configured' as const : 'missing' as const,
    url
  }));
}

async function recentAuditEvents(limit = 6, eventType?: string | null) {
  const events = await prisma.staffManagementEvent.findMany({
    where: eventType ? { eventType } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      staffProfile: {
        select: {
          firstName: true,
          lastName: true,
          roleTitle: true,
          venue: true
        }
      }
    }
  });

  return events.map(summariseAuditEvent);
}

export const adminService = {
  async overview(): Promise<AdminOverviewPayload> {
    const settingsPromise = settingsService.get();
    const activeStaffPromise = prisma.staffProfile.findMany({
      where: activeStaffWhere,
      select: {
        id: true,
        email: true,
        passwordHash: true,
        isAdmin: true,
        venue: true,
        appAccess: {
          select: {
            appId: true,
            status: true,
            role: true,
            permissions: true
          }
        }
      }
    });
    const monday = startOfMonday();
    const mondayEnd = endOfDay(monday);
    const [
      settings,
      activeStaff,
      mondayRosterShiftCount,
      openClockSessions,
      pendingComplianceRecords,
      expiredComplianceRecords,
      auditEvents
    ] = await Promise.all([
      settingsPromise,
      activeStaffPromise,
      prisma.rosterShift.count({ where: { startsAt: { gte: monday, lt: mondayEnd } } }),
      prisma.staffClockSession.count({ where: { status: 'OPEN' } }),
      prisma.staffComplianceRecord.count({
        where: { status: 'PENDING', staffProfile: activeStaffWhere }
      }),
      prisma.staffComplianceRecord.count({
        where: { status: 'EXPIRED', staffProfile: activeStaffWhere }
      }),
      recentAuditEvents(5)
    ]);

    const staffMissingLoginEmail = activeStaff.filter((member) => !member.email?.trim()).length;
    const staffWithoutPassword = activeStaff.filter((member) => !member.passwordHash).length;
    const staffMissingStaffAccess = activeStaff.filter(
      (member) => !member.appAccess.some((access) => access.appId === 'STAFF' && access.status === 'ENABLED')
    ).length;
    const adminUsers = activeStaff.filter((member) => member.isAdmin).length;
    const staffManagersOrAdmins = activeStaff.filter((member) =>
      member.appAccess.some(
        (access) =>
          access.status === 'ENABLED' &&
          access.appId === 'STAFF' &&
          ['ADMIN', 'MANAGER'].includes(access.role.toUpperCase())
      )
    ).length;

    const venueStaffCounts = activeStaff.reduce<Record<string, number>>((acc, member) => {
      const venue = member.venue?.trim() || 'Unassigned';
      acc[venue] = (acc[venue] ?? 0) + 1;
      return acc;
    }, {});

    const configuredVenues = settings.venues.length
      ? settings.venues
      : Object.keys(venueStaffCounts).map((name) => ({ name, address: '', phone: '' }));

    const appAccess = APP_IDS.map((appId) => {
      const rows = activeStaff.flatMap((member) => member.appAccess.filter((access) => access.appId === appId));
      return {
        appId,
        label: APP_LABELS[appId],
        enabled: rows.filter((access) => access.status === 'ENABLED').length,
        pending: rows.filter((access) => access.status === 'PENDING').length,
        disabled: rows.filter((access) => access.status === 'DISABLED').length,
        managerOrAdmin: rows.filter(
          (access) =>
            access.status === 'ENABLED' &&
            (['ADMIN', 'MANAGER'].includes(access.role.toUpperCase()) || hasAdminPermission(access.permissions))
        ).length
      };
    });

    const warningCandidates: Array<AdminReadinessWarning | null> = [
      staffMissingLoginEmail > 0
        ? {
            label: 'Staff missing login email',
            detail: `${staffMissingLoginEmail} active staff profile${staffMissingLoginEmail === 1 ? '' : 's'} need an email before login can work cleanly.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      staffMissingStaffAccess > 0
        ? {
            label: 'Staff app access missing',
            detail: `${staffMissingStaffAccess} active staff profile${staffMissingStaffAccess === 1 ? '' : 's'} do not have Staff app access enabled.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      staffWithoutPassword > 0
        ? {
            label: 'Password setup incomplete',
            detail: `${staffWithoutPassword} active staff profile${staffWithoutPassword === 1 ? '' : 's'} still need password setup or invite completion.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      !mailService.isConfigured()
        ? {
            label: 'Email is not configured',
            detail: 'Password reset and invite email delivery will need Resend or SMTP before production use.',
            tone: 'danger' as const,
            href: '#system-health'
          }
        : null,
      pendingComplianceRecords + expiredComplianceRecords > 0
        ? {
            label: 'Compliance records need attention',
            detail: `${pendingComplianceRecords} pending and ${expiredComplianceRecords} expired staff records are visible across active staff.`,
            tone: 'warning' as const,
            href: '/staff'
          }
        : null,
      openClockSessions > 0
        ? {
            label: 'Open clock sessions',
            detail: `${openClockSessions} clock session${openClockSessions === 1 ? ' is' : 's are'} still open.`,
            tone: 'info' as const
          }
        : null,
      mondayRosterShiftCount === 0
        ? {
            label: 'Monday roster not loaded',
            detail: 'No shifts are rostered for the next Monday window checked by Admin.',
            tone: 'muted' as const
          }
        : null
    ];
    const warnings = warningCandidates.filter((warning): warning is AdminReadinessWarning => warning !== null);

    return {
      generatedAt: new Date().toISOString(),
      readiness: {
        status: warnings.some((warning) => warning.tone === 'danger' || warning.tone === 'warning')
          ? 'needs_attention'
          : 'ready',
        label: warnings.length ? 'Needs attention before broad rollout' : 'Ready for normal manager use',
        warnings
      },
      counts: {
        activeStaff: activeStaff.length,
        staffMissingLoginEmail,
        staffMissingStaffAccess,
        staffWithoutPassword,
        mondayRosterLoaded: mondayRosterShiftCount > 0,
        mondayRosterShiftCount,
        openClockSessions,
        pendingComplianceRecords,
        expiredComplianceRecords,
        adminUsers,
        staffManagersOrAdmins
      },
      business: {
        orgName: settings.orgName,
        primaryContactName: settings.primaryContactName,
        primaryContactEmail: settings.primaryContactEmail,
        primaryContactPhone: settings.primaryContactPhone,
        venues: configuredVenues.map((venue) => ({
          name: venue.name,
          address: venue.address || null,
          phone: venue.phone || null,
          activeStaffCount: venueStaffCounts[venue.name] ?? 0
        }))
      },
      staffDefaults: settings.staffDefaults,
      appAccess,
      handoffLinks: [
        {
          label: 'Staff settings',
          description: 'Current editor for onboarding, staff defaults and access while controls migrate into Admin.',
          appId: 'staff',
          href: '/settings'
        },
        {
          label: 'Staff profiles',
          description: 'Individual notes, role access, password reset, pay setup and merge workflows stay in Staff.',
          appId: 'staff',
          href: '/'
        },
        {
          label: 'Stock setup',
          description: 'Stock items, supplier context and stocktake work stay in Stock for now.',
          appId: 'stock',
          href: '/'
        },
        {
          label: 'Reports',
          description: 'Trading, labour and reporting checks stay in Reports.',
          appId: 'reports',
          href: '/'
        }
      ],
      recentAuditEvents: auditEvents
    };
  },

  async integrationsStatus(): Promise<AdminIntegrationsStatusPayload> {
    const settings = await settingsService.get();
    const mailProvider = provider();

    return {
      generatedAt: new Date().toISOString(),
      square: {
        provider: 'square',
        label: 'Square',
        status: 'NOT_CONNECTED',
        powers: ['Live sales', 'payments', 'product movement', 'trading pace'],
        requiredSetup: ['Application ID', 'secret', 'redirect URL', 'webhook signature key'],
        actionLabel: 'Set up later',
        actionDisabled: true
      },
      xero: {
        provider: 'xero',
        label: 'Xero',
        status: 'NOT_CONNECTED',
        powers: ['Invoices', 'bills', 'supplier spend', 'accounting status'],
        requiredSetup: ['Client ID', 'client secret', 'redirect URL', 'webhook key'],
        actionLabel: 'Set up later',
        actionDisabled: true
      },
      email: {
        status: mailService.isConfigured() ? 'CONFIGURED' : 'NOT_CONFIGURED',
        provider: mailProvider
      },
      govee: {
        status: settings.goveeApiKey ? 'CONFIGURED' : 'NOT_CONFIGURED',
        baseUrl: settings.goveeBaseUrl
      }
    };
  },

  async systemHealth(): Promise<AdminSystemHealthPayload> {
    const mailProvider = provider();
    let database: AdminSystemHealthPayload['database'] = {
      status: 'ok',
      detail: 'Database query succeeded.'
    };
    let migrations: AdminSystemHealthPayload['migrations'] = {
      status: 'not_checked',
      latest: null,
      detail: 'Migration version was not checked.'
    };

    try {
      await prisma.staffProfile.findFirst({ select: { id: true } });
    } catch (error) {
      database = {
        status: 'error',
        detail: error instanceof Error ? error.message : 'Database query failed.'
      };
    }

    try {
      const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at
        FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at DESC
        LIMIT 1
      `;
      migrations = {
        status: rows[0]?.migration_name ? 'available' : 'not_checked',
        latest: rows[0]?.migration_name ?? null,
        detail: rows[0]?.migration_name ? 'Latest applied Prisma migration.' : 'No applied Prisma migration was found.'
      };
    } catch {
      migrations = {
        status: 'not_checked',
        latest: null,
        detail: 'Migration table was not available in this environment.'
      };
    }

    return {
      generatedAt: new Date().toISOString(),
      api: { status: 'ok' },
      database,
      email: {
        configured: mailService.isConfigured(),
        provider: mailProvider
      },
      migrations,
      appUrls: appUrlRows()
    };
  },

  async auditEvents(eventType?: string): Promise<AdminAuditEventsPayload> {
    const [events, eventTypes] = await Promise.all([
      recentAuditEvents(25, eventType),
      prisma.staffManagementEvent.findMany({
        select: { eventType: true },
        distinct: ['eventType'],
        orderBy: { eventType: 'asc' }
      })
    ]);

    return {
      eventTypes: eventTypes.map((event) => event.eventType),
      events
    };
  }
};
