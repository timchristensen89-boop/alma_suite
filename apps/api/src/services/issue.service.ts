import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  type AuthUser,
  type IssueAssigneeOption,
  issueActivityInputSchema,
  issueCompleteInputSchema,
  issueCreateInputSchema,
  issueUpdateInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

function formatDateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : '';
}

function issueInclude() {
  return {
    evidence: true,
    activities: {
      orderBy: [{ createdAt: 'desc' as const }]
    }
  };
}

type IssueAssigneeStaff = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
};

function staffName(staff: IssueAssigneeStaff) {
  return `${staff.firstName} ${staff.lastName}`.trim();
}

function staffLabel(staff: IssueAssigneeStaff) {
  const name = staffName(staff) || staff.email || 'Unnamed staff member';
  return [
    name,
    staff.roleTitle,
    staff.venue
  ].filter(Boolean).join(' · ');
}

function assigneeSelect() {
  return {
    id: true,
    firstName: true,
    lastName: true,
    email: true,
    roleTitle: true,
    venue: true
  };
}

function priorityForIssueSeverity(severity: string): 'URGENT' | 'HIGH' | 'NORMAL' {
  if (severity === 'CRITICAL') return 'URGENT';
  if (severity === 'HIGH') return 'HIGH';
  return 'NORMAL';
}

function issueAssignmentMessage(data: {
  title: string;
  category: string;
  severity: string;
  venue?: string | null;
  dueDate?: string | null;
  issueId: string;
  action: 'created' | 'reassigned';
}) {
  const issueUrl = `https://alma-compliance.web.app/issues/${data.issueId}`;
  return [
    data.action === 'reassigned'
      ? `A Compliance issue has been reassigned to you: ${data.title}.`
      : `You have been assigned a new Compliance issue: ${data.title}.`,
    `Category: ${data.category}.`,
    `Severity: ${data.severity}.`,
    data.venue ? `Venue: ${data.venue}.` : null,
    data.dueDate ? `Due: ${data.dueDate}.` : null,
    `Open issue: ${issueUrl}`,
    'Open Compliance issues to review and update the follow-up.'
  ].filter(Boolean).join('\n');
}

async function createIssueAssigneeNotification(
  tx: Prisma.TransactionClient,
  args: {
    issueId: string;
    title: string;
    category: string;
    severity: string;
    dueDate?: string | null;
    assignee: IssueAssigneeStaff;
    actor?: AuthUser | null;
    action: 'created' | 'reassigned';
  }
) {
  await tx.commsThread.create({
    data: {
      subject: args.action === 'reassigned'
        ? `Issue reassigned: ${args.title}`
        : `New issue assigned: ${args.title}`,
      venue: args.assignee.venue,
      category: 'TASK',
      priority: priorityForIssueSeverity(args.severity),
      createdById: args.actor?.id ?? null,
      messages: {
        create: {
          body: issueAssignmentMessage({
            title: args.title,
            category: args.category,
            severity: args.severity,
            venue: args.assignee.venue,
            dueDate: args.dueDate,
            issueId: args.issueId,
            action: args.action
          }),
          createdById: args.actor?.id ?? null
        }
      },
      recipients: {
        create: {
          staffProfileId: args.assignee.id,
          venue: args.assignee.venue,
          role: args.assignee.roleTitle,
          actionRequired: true,
          dueAt: args.dueDate ? new Date(args.dueDate) : null
        }
      },
      links: {
        create: {
          entityType: 'COMPLIANCE_ISSUE',
          entityId: args.issueId
        }
      }
    }
  });
}

async function activeAssigneeStaff() {
  return prisma.staffProfile.findMany({
    where: {
      employmentStatus: 'ACTIVE',
      mergedIntoStaffProfileId: null
    },
    orderBy: [
      { firstName: 'asc' },
      { lastName: 'asc' }
    ],
    select: assigneeSelect()
  });
}

function toAssigneeOption(staff: IssueAssigneeStaff): IssueAssigneeOption {
  const name = staffName(staff) || staff.email || 'Unnamed staff member';
  return {
    id: staff.id,
    name,
    label: staffLabel(staff),
    email: staff.email,
    roleTitle: staff.roleTitle,
    venue: staff.venue
  };
}

async function resolveAssignee(value?: string | null) {
  const assignee = value?.trim();
  if (!assignee) {
    return { assignee: null, staff: null as IssueAssigneeStaff | null };
  }

  const staff = await activeAssigneeStaff();
  const normalized = assignee.toLowerCase();
  const match = staff.find((item) => item.id === assignee)
    ?? staff.find((item) => staffName(item).toLowerCase() === normalized)
    ?? staff.find((item) => staffLabel(item).toLowerCase() === normalized)
    ?? staff.find((item) => item.email?.toLowerCase() === normalized);

  return {
    assignee: match ? staffName(match) : assignee,
    staff: match ?? null
  };
}

export const issueService = {
  async list(filters: { status?: string; severity?: string; search?: string }) {
    const where: Prisma.IssueWhereInput = {
      status: filters.status ? (filters.status as never) : undefined,
      severity: filters.severity ? (filters.severity as never) : undefined,
      OR: filters.search
        ? [
            { title: { contains: filters.search, mode: 'insensitive' } },
            { description: { contains: filters.search, mode: 'insensitive' } },
            { category: { contains: filters.search, mode: 'insensitive' } },
            { assignee: { contains: filters.search, mode: 'insensitive' } }
          ]
        : undefined
    };

    return prisma.issue.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        evidence: true,
        activities: {
          orderBy: [{ createdAt: 'desc' }],
          take: 5
        }
      }
    });
  },

  async summary() {
    const now = new Date();
    const [total, open, overdue, critical] = await Promise.all([
      prisma.issue.count(),
      prisma.issue.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } } }),
      prisma.issue.count({ where: { dueDate: { lt: now }, status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } } }),
      prisma.issue.count({ where: { severity: 'CRITICAL', status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } } })
    ]);

    return { total, open, overdue, critical };
  },

  async getById(id: string) {
    const issue = await prisma.issue.findUnique({
      where: { id },
      include: issueInclude()
    });

    if (!issue) {
      throw new HttpError(404, 'Issue not found');
    }

    return issue;
  },

  async assignees() {
    const staff = await activeAssigneeStaff();
    return staff.map(toAssigneeOption);
  },

  async create(input: unknown, actor?: AuthUser | null) {
    const data = issueCreateInputSchema.parse(input);
    const resolvedAssignee = await resolveAssignee(data.assignee);

    return prisma.$transaction(async (tx) => {
      const issue = await tx.issue.create({
        data: {
          title: data.title,
          description: data.description,
          severity: data.severity,
          category: data.category,
          status: data.status,
          assignee: resolvedAssignee.assignee,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          notes: data.notes || null,
          resolutionNotes: data.resolutionNotes || null,
          evidence: data.evidence?.length
            ? {
                create: data.evidence.map((item) => ({
                  name: item.name,
                  url: item.url,
                  fileType: item.fileType || null
                }))
              }
            : undefined,
          activities: {
            create: {
              action: 'created',
              message: `Issue created${resolvedAssignee.assignee ? ` and assigned to ${resolvedAssignee.assignee}` : ''}`,
              actor: actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.email || 'system' : 'system'
            }
          }
        },
        include: issueInclude()
      });

      if (resolvedAssignee.staff) {
        await createIssueAssigneeNotification(tx, {
          issueId: issue.id,
          title: data.title,
          category: data.category,
          severity: data.severity,
          dueDate: data.dueDate,
          assignee: resolvedAssignee.staff,
          actor,
          action: 'created'
        });
      }

      return issue;
    });
  },

  async update(id: string, input: unknown, actor?: AuthUser | null) {
    const data = issueUpdateInputSchema.parse(input);
    const existing = await this.getById(id);
    const resolvedAssignee = await resolveAssignee(data.assignee);
    const assigneeChanged = (existing.assignee ?? '') !== (resolvedAssignee.assignee ?? '');

    const changes: string[] = [];
    if (existing.status !== data.status) changes.push(`status ${existing.status} → ${data.status}`);
    if (existing.severity !== data.severity) changes.push(`severity ${existing.severity} → ${data.severity}`);
    if (assigneeChanged) changes.push(`assignee ${existing.assignee ?? 'Unassigned'} → ${resolvedAssignee.assignee || 'Unassigned'}`);
    if (formatDateOnly(existing.dueDate) !== (data.dueDate ?? '')) changes.push('due date updated');
    if (existing.title !== data.title) changes.push('title updated');
    if (existing.description !== data.description) changes.push('description updated');
    if ((existing.resolutionNotes ?? '') !== (data.resolutionNotes ?? '')) changes.push('resolution notes updated');

    return prisma.$transaction(async (tx) => {
      await tx.issueEvidence.deleteMany({ where: { issueId: id } });

      const issue = await tx.issue.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          severity: data.severity,
          category: data.category,
          status: data.status,
          assignee: resolvedAssignee.assignee,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          notes: data.notes || null,
          resolutionNotes: data.resolutionNotes || null,
          evidence: data.evidence?.length
            ? {
                create: data.evidence.map((item) => ({
                  name: item.name,
                  url: item.url,
                  fileType: item.fileType || null
                }))
              }
            : undefined,
          activities: {
            create: {
              action: 'updated',
              message: changes.length ? `Issue updated: ${changes.join(', ')}.` : 'Issue updated with no material field changes recorded.',
              actor: 'system'
            }
          }
        },
        include: issueInclude()
      });

      if (assigneeChanged && resolvedAssignee.staff) {
        await createIssueAssigneeNotification(tx, {
          issueId: issue.id,
          title: data.title,
          category: data.category,
          severity: data.severity,
          dueDate: data.dueDate,
          assignee: resolvedAssignee.staff,
          actor,
          action: 'reassigned'
        });
      }

      return issue;
    });
  },

  async complete(id: string, input: unknown) {
    const data = issueCompleteInputSchema.parse(input);
    const existing = await this.getById(id);
    const note = data.resolutionNotes?.trim();
    const resolutionNotes = note
      ? [existing.resolutionNotes, note].filter(Boolean).join('\n\n')
      : existing.resolutionNotes;

    if (existing.status === 'CLOSED') {
      return existing;
    }

    return prisma.issue.update({
      where: { id },
      data: {
        status: 'CLOSED',
        resolutionNotes,
        activities: {
          create: {
            action: 'completed',
            message: note
              ? `Issue completed with resolution notes: ${note}`
              : 'Issue completed.',
            actor: 'system'
          }
        }
      },
      include: issueInclude()
    });
  },

  async addActivity(issueId: string, input: unknown) {
    const data = issueActivityInputSchema.parse(input);
    await this.getById(issueId);

    return prisma.issueActivity.create({
      data: {
        issueId,
        action: data.action,
        message: data.message,
        actor: data.actor
      }
    });
  },

  async meta() {
    return {
      statuses: ['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED'],
      severities: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    };
  }
};
