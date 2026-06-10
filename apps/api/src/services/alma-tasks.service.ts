// Phase 5.9: AlmaTask service — list/create/update/complete/dismiss
// + a `createTaskFromSource` helper that other apps' services call to
// emit tasks consistently (Phase 5.11 wires the emitters).
//
// Venue scoping rule (mirrors how stocktake / issue / staff scope work):
//   - Admin users see all tasks.
//   - Non-admin users see tasks for their assigned venue PLUS tasks
//     with venue=null (suite-wide tasks like "fix Square integration"
//     are everyone's concern).
//
// Status transitions are enforced at the service layer (not the DB):
//   OPEN ↔ IN_PROGRESS ↔ BLOCKED  via PATCH
//   * → DONE                       via POST /:id/complete
//   * → DISMISSED                  via POST /:id/dismiss
// Status is intentionally not on PATCH for DONE/DISMISSED so we can
// stamp completedBy / dismissedBy in a single place and never miss it.

import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  type AlmaTask,
  type AlmaTaskCreateInput,
  type AlmaTaskListQuery,
  type AlmaTaskPriority,
  type AlmaTaskSourceApp,
  type AlmaTaskStaffSnapshot,
  type AlmaTasksPayload,
  type AlmaTasksSummary,
  type AlmaTaskUpdateInput,
  type AuthUser,
  almaTaskCreateInputSchema,
  almaTaskListQuerySchema,
  almaTaskUpdateInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const OUTSTANDING_STATUSES = ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as const;
const PRIORITY_VALUES: AlmaTaskPriority[] = ['CRITICAL', 'TODAY', 'THIS_WEEK', 'LOW'];

function isAdminLike(user: AuthUser): boolean {
  return user.isAdmin || user.role === 'ADMIN';
}

function venueScope(user: AuthUser): Prisma.AlmaTaskWhereInput {
  if (isAdminLike(user)) return {};
  // Non-admins see their venue + suite-wide tasks.
  if (!user.venue) return { venue: null };
  return { OR: [{ venue: user.venue }, { venue: null }] };
}

function staffSelect() {
  return {
    id: true,
    firstName: true,
    lastName: true,
    roleTitle: true,
    venue: true
  } as const;
}

type StaffSelectRow = {
  id: string;
  firstName: string;
  lastName: string;
  roleTitle: string;
  venue: string | null;
};

function staffSnapshot(row: StaffSelectRow | null): AlmaTaskStaffSnapshot {
  if (!row) return null;
  const name = `${row.firstName} ${row.lastName}`.trim() || 'Staff';
  return { id: row.id, name, roleTitle: row.roleTitle, venue: row.venue };
}

function taskInclude() {
  return {
    owner: { select: staffSelect() },
    completedBy: { select: staffSelect() },
    dismissedBy: { select: staffSelect() }
  };
}

type DbAlmaTask = Prisma.AlmaTaskGetPayload<{ include: ReturnType<typeof taskInclude> }>;

// Suite app base URLs, mirroring notifications.service's APP_URLS, so a task
// can deep-link back to the surface that raised it.
const TASK_APP_URLS: Record<AlmaTaskSourceApp, string> = {
  HOME: process.env.HOME_WEB_URL ?? 'https://alma-home.web.app',
  STAFF: process.env.STAFF_WEB_URL ?? 'https://alma-staff.web.app',
  STOCK: process.env.STOCK_WEB_URL ?? 'https://alma-stock-v18.web.app',
  COMPLIANCE: process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? 'https://alma-compliance.web.app',
  RESERVE: process.env.RESERVE_WEB_URL ?? 'https://alma-reserve.web.app',
  MARKETING: process.env.MARKETING_WEB_URL ?? 'https://alma-marketing.web.app',
  GIFTCARDS: process.env.GIFTCARDS_WEB_URL ?? 'https://alma-giftcards.web.app',
  REPORTS: process.env.REPORTS_WEB_URL ?? 'https://alma-reports.web.app',
  ADMIN: process.env.ADMIN_WEB_URL ?? 'https://alma-suite-admin.web.app',
  COMMS: process.env.COMMS_WEB_URL ?? 'https://alma-comms.web.app'
};

// Deep-link a task to the record that raised it. Known source types route to
// the right page; anything else lands on the owning app's home so the row is
// still actionable rather than inert.
function taskLink(row: DbAlmaTask): string | null {
  const base = TASK_APP_URLS[row.sourceApp]?.replace(/\/+$/, '');
  if (!base) return null;
  switch (`${row.sourceApp}:${row.sourceRefType}`) {
    case 'COMPLIANCE:issue':
      return `${base}/issues`;
    case 'STAFF:leave':
      return `${base}/leave`;
    default:
      return base;
  }
}

function toAlmaTask(row: DbAlmaTask): AlmaTask {
  return {
    id: row.id,
    sourceApp: row.sourceApp,
    sourceRefType: row.sourceRefType,
    sourceRefId: row.sourceRefId,
    link: taskLink(row),
    venue: row.venue,
    title: row.title,
    description: row.description,
    ownerStaffProfileId: row.ownerStaffProfileId,
    owner: staffSnapshot(row.owner),
    dueAt: row.dueAt?.toISOString() ?? null,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedByStaffProfileId: row.completedByStaffProfileId,
    completedBy: staffSnapshot(row.completedBy),
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    dismissedByStaffProfileId: row.dismissedByStaffProfileId,
    dismissedBy: staffSnapshot(row.dismissedBy)
  };
}

async function findOwnerStaffId(staffProfileId: string | undefined | null): Promise<string | null> {
  if (!staffProfileId) return null;
  const staff = await prisma.staffProfile.findUnique({
    where: { id: staffProfileId },
    select: { id: true }
  });
  if (!staff) throw new HttpError(400, 'Owner staff profile not found.');
  return staff.id;
}

async function assertTaskVisible(id: string, user: AuthUser): Promise<DbAlmaTask> {
  const row = await prisma.almaTask.findUnique({
    where: { id },
    include: taskInclude()
  });
  if (!row) throw new HttpError(404, 'Task not found.');
  if (isAdminLike(user)) return row;
  if (row.venue == null) return row;
  if (row.venue !== user.venue) throw new HttpError(404, 'Task not found.');
  return row;
}

export const almaTaskService = {
  async list(query: AlmaTaskListQuery, user: AuthUser): Promise<AlmaTasksPayload> {
    const parsed = almaTaskListQuerySchema.parse(query);
    const where: Prisma.AlmaTaskWhereInput = { AND: [venueScope(user)] };

    const filters: Prisma.AlmaTaskWhereInput[] = [];
    if (parsed.venue) filters.push({ venue: parsed.venue });
    if (parsed.status) filters.push({ status: parsed.status });
    if (parsed.priority) filters.push({ priority: parsed.priority });
    if (parsed.sourceApp) filters.push({ sourceApp: parsed.sourceApp });
    if (parsed.ownerStaffProfileId) filters.push({ ownerStaffProfileId: parsed.ownerStaffProfileId });
    if (parsed.outstanding) filters.push({ status: { in: [...OUTSTANDING_STATUSES] } });

    if (filters.length) {
      where.AND = [...(where.AND as Prisma.AlmaTaskWhereInput[]), ...filters];
    }

    const rows = await prisma.almaTask.findMany({
      where,
      include: taskInclude(),
      orderBy: [
        // CRITICAL first via enum index order, then due dates, newest last.
        { priority: 'asc' },
        { dueAt: 'asc' },
        { createdAt: 'desc' }
      ],
      take: 500
    });

    return { tasks: rows.map(toAlmaTask) };
  },

  async summary(user: AuthUser): Promise<AlmaTasksSummary> {
    const where: Prisma.AlmaTaskWhereInput = {
      AND: [venueScope(user), { status: { in: [...OUTSTANDING_STATUSES] } }]
    };

    const [outstandingTotal, priorityGroups, venueGroups, oldest] = await Promise.all([
      prisma.almaTask.count({ where }),
      prisma.almaTask.groupBy({
        by: ['priority'],
        where,
        _count: { _all: true }
      }),
      prisma.almaTask.groupBy({
        by: ['venue'],
        where,
        _count: { _all: true },
        orderBy: { _count: { id: 'desc' } }
      }),
      prisma.almaTask.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true }
      })
    ]);

    const byPriority: Record<AlmaTaskPriority, number> = {
      CRITICAL: 0,
      TODAY: 0,
      THIS_WEEK: 0,
      LOW: 0
    };
    for (const row of priorityGroups) byPriority[row.priority] = row._count._all;
    // Stable ordering for the UI even when a priority has 0 tasks.
    const orderedByPriority = PRIORITY_VALUES.reduce<Record<AlmaTaskPriority, number>>(
      (acc, p) => ({ ...acc, [p]: byPriority[p] }),
      { CRITICAL: 0, TODAY: 0, THIS_WEEK: 0, LOW: 0 }
    );

    return {
      outstandingTotal,
      byPriority: orderedByPriority,
      byVenue: venueGroups.map((g) => ({ venue: g.venue, outstanding: g._count._all })),
      oldestOpenAt: oldest?.createdAt.toISOString() ?? null
    };
  },

  async get(id: string, user: AuthUser): Promise<AlmaTask> {
    const row = await assertTaskVisible(id, user);
    return toAlmaTask(row);
  },

  async create(input: AlmaTaskCreateInput, user: AuthUser): Promise<AlmaTask> {
    const parsed = almaTaskCreateInputSchema.parse(input);
    const ownerStaffProfileId = await findOwnerStaffId(parsed.ownerStaffProfileId);

    // Non-admins can only create venue-scoped tasks for THEIR venue.
    const venue =
      isAdminLike(user)
        ? parsed.venue ?? null
        : (parsed.venue ?? user.venue ?? null);
    if (!isAdminLike(user) && venue && venue !== user.venue) {
      throw new HttpError(403, 'You can only create tasks for your own venue.');
    }

    const row = await prisma.almaTask.create({
      data: {
        sourceApp: parsed.sourceApp,
        sourceRefType: parsed.sourceRefType ?? null,
        sourceRefId: parsed.sourceRefId ?? null,
        venue,
        title: parsed.title,
        description: parsed.description ?? null,
        ownerStaffProfileId,
        dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
        priority: parsed.priority ?? 'THIS_WEEK'
      },
      include: taskInclude()
    });
    return toAlmaTask(row);
  },

  async update(id: string, input: AlmaTaskUpdateInput, user: AuthUser): Promise<AlmaTask> {
    const parsed = almaTaskUpdateInputSchema.parse(input);
    const existing = await assertTaskVisible(id, user);

    const data: Prisma.AlmaTaskUpdateInput = {};
    if (parsed.title !== undefined) data.title = parsed.title;
    if (parsed.description !== undefined) data.description = parsed.description ?? null;
    if (parsed.priority !== undefined) data.priority = parsed.priority;
    if (parsed.dueAt !== undefined) data.dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;
    if (parsed.ownerStaffProfileId !== undefined) {
      const ownerId = parsed.ownerStaffProfileId
        ? await findOwnerStaffId(parsed.ownerStaffProfileId)
        : null;
      data.owner = ownerId ? { connect: { id: ownerId } } : { disconnect: true };
    }
    if (parsed.status !== undefined) {
      // Block PATCH from setting terminal statuses; use complete/dismiss.
      if (existing.status === 'DONE' || existing.status === 'DISMISSED') {
        throw new HttpError(409, 'Task is already closed.');
      }
      data.status = parsed.status;
    }

    const row = await prisma.almaTask.update({
      where: { id },
      data,
      include: taskInclude()
    });
    return toAlmaTask(row);
  },

  async complete(id: string, user: AuthUser): Promise<AlmaTask> {
    const existing = await assertTaskVisible(id, user);
    if (existing.status === 'DONE') return toAlmaTask(existing);
    if (existing.status === 'DISMISSED') {
      throw new HttpError(409, 'Cannot complete a dismissed task.');
    }
    const row = await prisma.almaTask.update({
      where: { id },
      data: {
        status: 'DONE',
        completedAt: new Date(),
        completedByStaffProfileId: user.id
      },
      include: taskInclude()
    });
    return toAlmaTask(row);
  },

  async dismiss(id: string, user: AuthUser): Promise<AlmaTask> {
    const existing = await assertTaskVisible(id, user);
    if (existing.status === 'DISMISSED') return toAlmaTask(existing);
    if (existing.status === 'DONE') {
      throw new HttpError(409, 'Cannot dismiss a completed task.');
    }
    const row = await prisma.almaTask.update({
      where: { id },
      data: {
        status: 'DISMISSED',
        dismissedAt: new Date(),
        dismissedByStaffProfileId: user.id
      },
      include: taskInclude()
    });
    return toAlmaTask(row);
  }
};

// ----------------------------------------------------------------------
// Service-internal: createTaskFromSource
//
// Other apps' services call this to emit tasks. It dedupes by
// (sourceApp, sourceRefType, sourceRefId) against the active-status
// set so re-emitting from the same source doesn't pile up duplicates.
// If a matching outstanding task already exists, it's returned as-is.
// If a matching task exists in DONE/DISMISSED, a new task IS created
// — the source is signalling that "this needs attention again."
// ----------------------------------------------------------------------

export type CreateTaskFromSourceInput = {
  sourceApp: AlmaTaskSourceApp;
  sourceRefType: string;
  sourceRefId: string;
  venue?: string | null;
  title: string;
  description?: string | null;
  ownerStaffProfileId?: string | null;
  dueAt?: Date | null;
  priority?: AlmaTaskPriority;
};

export async function createTaskFromSource(input: CreateTaskFromSourceInput): Promise<AlmaTask> {
  const sourceWhere = {
    sourceApp: input.sourceApp,
    sourceRefType: input.sourceRefType,
    sourceRefId: input.sourceRefId
  };

  // One row per source object, ever (enforced by a DB unique index on the
  // source triple). Look up any prior task for this source:
  //   - already outstanding → return it (the dedupe path the reconciler relies on)
  //   - previously DONE/DISMISSED but the source qualifies again → resurrect it
  //   - none → create it
  const existing = await prisma.almaTask.findFirst({ where: sourceWhere, include: taskInclude() });
  if (existing) {
    if ((OUTSTANDING_STATUSES as readonly string[]).includes(existing.status)) {
      return toAlmaTask(existing);
    }
    const revived = await prisma.almaTask.update({
      where: { id: existing.id },
      data: {
        status: 'OPEN',
        venue: input.venue ?? null,
        title: input.title,
        description: input.description ?? null,
        ownerStaffProfileId: input.ownerStaffProfileId ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? 'THIS_WEEK',
        completedAt: null,
        completedByStaffProfileId: null,
        dismissedAt: null,
        dismissedByStaffProfileId: null
      },
      include: taskInclude()
    });
    return toAlmaTask(revived);
  }

  try {
    const row = await prisma.almaTask.create({
      data: {
        sourceApp: input.sourceApp,
        sourceRefType: input.sourceRefType,
        sourceRefId: input.sourceRefId,
        venue: input.venue ?? null,
        title: input.title,
        description: input.description ?? null,
        ownerStaffProfileId: input.ownerStaffProfileId ?? null,
        dueAt: input.dueAt ?? null,
        priority: input.priority ?? 'THIS_WEEK'
      },
      include: taskInclude()
    });
    return toAlmaTask(row);
  } catch (error) {
    // Lost a create race against another API instance — the unique index
    // fired. Re-read and return the winning row instead of duplicating.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.almaTask.findFirst({ where: sourceWhere, include: taskInclude() });
      if (winner) return toAlmaTask(winner);
    }
    throw error;
  }
}

// Companion: when a source object is resolved (e.g. stocktake locked,
// issue resolved), call this to auto-close any outstanding task that
// pointed at it. Returns the count of tasks that got auto-completed.
export async function resolveTasksFromSource(
  sourceApp: AlmaTaskSourceApp,
  sourceRefType: string,
  sourceRefId: string
): Promise<number> {
  const result = await prisma.almaTask.updateMany({
    where: {
      sourceApp,
      sourceRefType,
      sourceRefId,
      status: { in: [...OUTSTANDING_STATUSES] }
    },
    data: {
      status: 'DONE',
      completedAt: new Date()
    }
  });
  return result.count;
}
