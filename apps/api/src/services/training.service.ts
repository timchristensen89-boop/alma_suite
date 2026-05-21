import { prisma } from '@alma/db';
import {
  staffTrainingAssignInputSchema,
  staffTrainingUpdateInputSchema,
  trainingModuleInputSchema,
  trainingPayRuleInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

function dateOrNull(value: string | undefined) {
  return value ? new Date(value) : null;
}

function textOrNull(value: string | undefined) {
  return value?.trim() || null;
}

async function recalculateStaffTrainingPay(staffProfileId: string) {
  const completed = await prisma.staffTrainingRecord.findMany({
    where: { staffProfileId, status: 'COMPLETED' },
    include: { module: true }
  });
  const trainingLevel = completed.reduce((max, record) => Math.max(max, record.module.level), 0);
  const payRule = trainingLevel
    ? await prisma.trainingLevelPayRule.findFirst({
        where: { level: { lte: trainingLevel } },
        orderBy: { level: 'desc' }
      })
    : null;
  const staff = await prisma.staffProfile.findFirst({
    where: {
      id: staffProfileId,
      accountType: 'HUMAN',
      employmentStatus: { not: 'ARCHIVED' },
      mergedIntoStaffProfileId: null
    },
    select: { payRateCents: true }
  });

  if (!staff) {
    throw new HttpError(404, 'Staff profile not found');
  }

  const trainingPayRateCents = payRule?.payRateCents ?? null;
  const payRateCents =
    trainingPayRateCents && (!staff.payRateCents || staff.payRateCents < trainingPayRateCents)
      ? trainingPayRateCents
      : staff.payRateCents;

  await prisma.staffProfile.update({
    where: { id: staffProfileId },
    data: { trainingLevel, trainingPayRateCents, payRateCents }
  });
}

export const trainingService = {
  async overview() {
    const [modules, payRules, records, staff] = await Promise.all([
      prisma.trainingModule.findMany({
        orderBy: [{ status: 'asc' }, { level: 'asc' }, { title: 'asc' }]
      }),
      prisma.trainingLevelPayRule.findMany({
        orderBy: [{ level: 'asc' }]
      }),
      prisma.staffTrainingRecord.findMany({
        where: {
          staffProfile: {
            accountType: 'HUMAN'
          }
        },
        orderBy: [{ updatedAt: 'desc' }],
        include: {
          module: true,
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              roleTitle: true,
              venue: true,
              payRateCents: true,
              trainingLevel: true,
              trainingPayRateCents: true
            }
          }
        }
      }),
      prisma.staffProfile.findMany({
        where: {
          accountType: 'HUMAN',
          employmentStatus: { not: 'ARCHIVED' },
          mergedIntoStaffProfileId: null
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: {
          id: true,
          firstName: true,
          lastName: true,
          roleTitle: true,
          venue: true,
          payRateCents: true,
          trainingLevel: true,
          trainingPayRateCents: true
        }
      })
    ]);

    return { modules, payRules, records, staff };
  },

  async createModule(input: unknown) {
    const data = trainingModuleInputSchema.parse(input);

    return prisma.trainingModule.create({
      data: {
        title: data.title.trim(),
        description: textOrNull(data.description),
        category: textOrNull(data.category),
        level: data.level,
        estimatedMinutes: data.estimatedMinutes ?? null,
        status: data.status
      }
    });
  },

  async updateModule(id: string, input: unknown) {
    const data = trainingModuleInputSchema.partial().parse(input);
    const existing = await prisma.trainingModule.findUnique({ where: { id } });

    if (!existing) {
      throw new HttpError(404, 'Training module not found');
    }

    return prisma.trainingModule.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.description !== undefined && { description: textOrNull(data.description) }),
        ...(data.category !== undefined && { category: textOrNull(data.category) }),
        ...(data.level !== undefined && { level: data.level }),
        ...(data.estimatedMinutes !== undefined && { estimatedMinutes: data.estimatedMinutes ?? null }),
        ...(data.status !== undefined && { status: data.status })
      }
    });
  },

  async upsertPayRule(input: unknown) {
    const data = trainingPayRuleInputSchema.parse(input);

    return prisma.trainingLevelPayRule.upsert({
      where: { level: data.level },
      update: {
        label: data.label.trim(),
        payRateCents: data.payRateCents,
        notes: textOrNull(data.notes)
      },
      create: {
        level: data.level,
        label: data.label.trim(),
        payRateCents: data.payRateCents,
        notes: textOrNull(data.notes)
      }
    });
  },

  async assign(input: unknown) {
    const data = staffTrainingAssignInputSchema.parse(input);
    const [staff, module] = await Promise.all([
      prisma.staffProfile.findFirst({
        where: {
          id: data.staffProfileId,
          accountType: 'HUMAN',
          employmentStatus: { not: 'ARCHIVED' },
          mergedIntoStaffProfileId: null
        }
      }),
      prisma.trainingModule.findUnique({ where: { id: data.moduleId } })
    ]);

    if (!staff) {
      throw new HttpError(404, 'Staff profile not found');
    }

    if (!module || module.status === 'ARCHIVED') {
      throw new HttpError(404, 'Active training module not found');
    }

    return prisma.staffTrainingRecord.upsert({
      where: {
        staffProfileId_moduleId: {
          staffProfileId: data.staffProfileId,
          moduleId: data.moduleId
        }
      },
      update: {
        status: 'ASSIGNED',
        expiresAt: dateOrNull(data.expiresAt),
        notes: textOrNull(data.notes)
      },
      create: {
        staffProfileId: data.staffProfileId,
        moduleId: data.moduleId,
        status: 'ASSIGNED',
        expiresAt: dateOrNull(data.expiresAt),
        notes: textOrNull(data.notes)
      },
      include: {
        module: true,
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            payRateCents: true,
            trainingLevel: true,
            trainingPayRateCents: true
          }
        }
      }
    });
  },

  async updateRecord(id: string, input: unknown) {
    const data = staffTrainingUpdateInputSchema.parse(input);
    const existing = await prisma.staffTrainingRecord.findUnique({ where: { id } });

    if (!existing) {
      throw new HttpError(404, 'Training record not found');
    }

    const record = await prisma.staffTrainingRecord.update({
      where: { id },
      data: {
        status: data.status,
        startedAt: data.status === 'IN_PROGRESS' && !existing.startedAt ? new Date() : existing.startedAt,
        completedAt: data.status === 'COMPLETED' ? dateOrNull(data.completedAt) ?? new Date() : null,
        score: data.score ?? null,
        evidenceName: textOrNull(data.evidenceName),
        evidenceUrl: textOrNull(data.evidenceUrl),
        notes: textOrNull(data.notes)
      },
      include: {
        module: true,
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            payRateCents: true,
            trainingLevel: true,
            trainingPayRateCents: true
          }
        }
      }
    });

    await recalculateStaffTrainingPay(record.staffProfileId);
    return record;
  },

  async deleteRecord(id: string) {
    const existing = await prisma.staffTrainingRecord.findUnique({ where: { id } });

    if (!existing) {
      throw new HttpError(404, 'Training record not found');
    }

    await prisma.staffTrainingRecord.delete({ where: { id } });
    await recalculateStaffTrainingPay(existing.staffProfileId);
    return { id, deleted: true };
  }
};
