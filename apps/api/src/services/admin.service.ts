import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AlmaAppId,
  AuthUser,
  AdminAccessBulkUpdateResult,
  AdminAccessUsersPayload,
  AdminAuditEventsPayload,
  AdminAuditEventSummary,
  AdminIntegrationsStatusPayload,
  AdminOverviewPayload,
  AdminReadinessWarning,
  AdminSystemHealthPayload
} from '@alma/shared';
import {
  adminAccessBulkUpdateInputSchema,
  adminAccessUserCreateInputSchema
} from '@alma/shared';
import { env } from '../env.js';
import { integrationService } from './integration.service.js';
import { mailService } from './mail.service.js';
import { settingsService } from './settings.service.js';
import { HttpError } from '../lib/http.js';

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

const ACCESS_PERMISSION_KEYS = [
  {
    key: 'view',
    label: 'View',
    description: 'Can open the app and read permitted venue data.'
  },
  {
    key: 'create',
    label: 'Create',
    description: 'Can add new operational records where the app supports it.'
  },
  {
    key: 'edit',
    label: 'Edit',
    description: 'Can update operational records in permitted venues.'
  },
  {
    key: 'approve',
    label: 'Approve',
    description: 'Can approve reviews, requests, stocktakes or content where available.'
  },
  {
    key: 'export',
    label: 'Export',
    description: 'Can export reports or operational data where available.'
  },
  {
    key: 'delete',
    label: 'Delete',
    description: 'Can archive or remove records where the app allows it.',
    dangerous: true
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Can manage setup or admin-only actions for that app.',
    dangerous: true
  }
];

const activeStaffWhere: Prisma.StaffProfileWhereInput = {
  accountType: 'HUMAN',
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

function permissionRecord(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, allowed]) => typeof allowed === 'boolean')
  ) as Record<string, boolean>;
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
  async accessUsers(): Promise<AdminAccessUsersPayload> {
    const users = await prisma.staffProfile.findMany({
      where: {
        mergedIntoStaffProfileId: null,
        NOT: { employmentStatus: 'ARCHIVED' }
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        venue: true,
        roleTitle: true,
        employmentStatus: true,
        accountType: true,
        isAdmin: true,
        passwordHash: true,
        pinHash: true,
        pinUpdatedAt: true,
        appAccess: { orderBy: [{ appId: 'asc' }] }
      }
    });

    return {
      generatedAt: new Date().toISOString(),
      apps: APP_IDS.map((appId) => ({ appId, label: APP_LABELS[appId] })),
      permissionKeys: ACCESS_PERMISSION_KEYS,
      users: users.map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        venue: user.venue,
        roleTitle: user.roleTitle,
        employmentStatus: user.employmentStatus,
        accountType: user.accountType,
        isAdmin: user.isAdmin,
        hasPassword: Boolean(user.passwordHash),
        hasPin: Boolean(user.pinHash),
        pinUpdatedAt: user.pinUpdatedAt?.toISOString() ?? null,
        appAccess: user.appAccess.map((access) => ({
          ...access,
          createdAt: access.createdAt.toISOString(),
          updatedAt: access.updatedAt.toISOString(),
          permissions: permissionRecord(access.permissions)
        }))
      }))
    };
  },

  async createAccessUser(input: unknown, actor?: AuthUser | null) {
    const data = adminAccessUserCreateInputSchema.parse(input);
    const email = data.email?.trim().toLowerCase() || null;
    if (email) {
      const existing = await prisma.staffProfile.findUnique({ where: { email } });
      if (existing) throw new HttpError(409, 'A staff profile already exists for that email.');
    }

    const staffPermissions =
      data.staffRole === 'ADMIN'
        ? { view: true, create: true, edit: true, approve: true, export: true, admin: true }
        : data.staffRole === 'MANAGER'
          ? { view: true, create: true, edit: true, approve: true, export: true }
          : { view: true };

    const profile = await prisma.staffProfile.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        email,
        venue: data.venue || null,
        roleTitle: data.roleTitle || (data.staffRole === 'MANAGER' ? 'Manager' : 'Team member'),
        employmentStatus: 'ACTIVE',
        appAccess: data.enableStaffApp
          ? {
              create: {
                appId: 'STAFF',
                status: 'ENABLED',
                role: data.staffRole,
                permissions: staffPermissions
              }
            }
          : undefined
      },
      include: { appAccess: { orderBy: [{ appId: 'asc' }] } }
    });

    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: profile.id,
        eventType: 'ADMIN_ACCESS_USER_CREATED',
        summary: 'Staff user created from Admin access settings.',
        createdById: actor?.id ?? null,
        createdByName: actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email : null,
        createdByEmail: actor?.email ?? null,
        metadata: {
          email,
          venue: data.venue || null,
          staffRole: data.staffRole,
          enableStaffApp: data.enableStaffApp
        }
      }
    });

    return profile;
  },

  async bulkUpdateAccess(input: unknown, actor?: AuthUser | null): Promise<AdminAccessBulkUpdateResult> {
    const data = adminAccessBulkUpdateInputSchema.parse(input);
    const users = await prisma.staffProfile.findMany({
      where: {
        id: { in: data.staffProfileIds },
        mergedIntoStaffProfileId: null,
        NOT: { employmentStatus: 'ARCHIVED' }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        appAccess: {
          where: { appId: { in: data.appIds } },
          select: { appId: true, permissions: true }
        }
      }
    });

    const existingByUser = new Map(users.map((user) => [user.id, new Map(user.appAccess.map((row) => [row.appId, row]))]));
    let updatedRows = 0;

    await prisma.$transaction(async (tx) => {
      for (const user of users) {
        const existing = existingByUser.get(user.id) ?? new Map();
        for (const appId of data.appIds) {
          const currentPermissions = permissionRecord(existing.get(appId)?.permissions);
          const permissions =
            data.permissionMode === 'REPLACE'
              ? data.permissions
              : { ...currentPermissions, ...data.permissions };
          await tx.staffAppAccess.upsert({
            where: { staffProfileId_appId: { staffProfileId: user.id, appId } },
            update: {
              status: data.status,
              role: data.role,
              permissions,
              notes: data.notes || null
            },
            create: {
              staffProfileId: user.id,
              appId,
              status: data.status,
              role: data.role,
              permissions,
              notes: data.notes || null
            }
          });
          updatedRows += 1;
        }

        await tx.staffManagementEvent.create({
          data: {
            staffProfileId: user.id,
            eventType: 'ADMIN_BULK_APP_ACCESS_UPDATED',
            summary: 'App access updated in bulk from Admin.',
            createdById: actor?.id ?? null,
            createdByName: actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email : null,
            createdByEmail: actor?.email ?? null,
            metadata: {
              appIds: data.appIds,
              status: data.status,
              role: data.role,
              permissionMode: data.permissionMode,
              permissionKeys: Object.keys(data.permissions)
            }
          }
        });
      }
    });

    return { updatedUsers: users.length, updatedRows };
  },

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
    const integrations = await integrationService.status();

    return {
      ...integrations,
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
