import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
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

  async create(input: unknown) {
    const data = issueCreateInputSchema.parse(input);

    return prisma.issue.create({
      data: {
        title: data.title,
        description: data.description,
        severity: data.severity,
        category: data.category,
        status: data.status,
        assignee: data.assignee || null,
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
            message: `Issue created${data.assignee ? ` and assigned to ${data.assignee}` : ''}`,
            actor: 'system'
          }
        }
      },
      include: issueInclude()
    });
  },

  async update(id: string, input: unknown) {
    const data = issueUpdateInputSchema.parse(input);
    const existing = await this.getById(id);

    const changes: string[] = [];
    if (existing.status !== data.status) changes.push(`status ${existing.status} → ${data.status}`);
    if (existing.severity !== data.severity) changes.push(`severity ${existing.severity} → ${data.severity}`);
    if ((existing.assignee ?? '') !== (data.assignee ?? '')) changes.push(`assignee ${existing.assignee ?? 'Unassigned'} → ${data.assignee || 'Unassigned'}`);
    if (formatDateOnly(existing.dueDate) !== (data.dueDate ?? '')) changes.push('due date updated');
    if (existing.title !== data.title) changes.push('title updated');
    if (existing.description !== data.description) changes.push('description updated');
    if ((existing.resolutionNotes ?? '') !== (data.resolutionNotes ?? '')) changes.push('resolution notes updated');

    return prisma.$transaction(async (tx) => {
      await tx.issueEvidence.deleteMany({ where: { issueId: id } });

      return tx.issue.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          severity: data.severity,
          category: data.category,
          status: data.status,
          assignee: data.assignee || null,
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
