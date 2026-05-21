import { prisma } from '@alma/db';
import {
  shiftTaskRuleInputSchema,
  shiftTaskRulePreviewInputSchema,
  shiftTaskRuleUpdateInputSchema,
  type AuthUser,
  type ShiftTaskAssignment,
  type ShiftTaskListResponse,
  type ShiftTaskPreviewAssignment,
  type ShiftTaskRule,
  type ShiftTaskRulePreviewResult,
  type StartAssignedChecklistResult
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const SHIFT_LOOKAHEAD_DAYS = 14;
const VENUE_QUEUE_LOOKAHEAD_DAYS = 2;

type ShiftTaskRuleRecord = Awaited<ReturnType<typeof prisma.shiftTaskRule.findMany>>[number];
type RosterShiftRecord = Awaited<ReturnType<typeof prisma.rosterShift.findMany>>[number] & {
  staffProfile?: {
    id: string;
    firstName: string;
    lastName: string;
    roleTitle: string;
    venue: string | null;
    employmentStatus?: string;
  } | null;
};

const assignmentInclude = {
  rule: true,
  rosterShift: {
    include: {
      staffProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          roleTitle: true,
          venue: true,
          employmentStatus: true
        }
      }
    }
  },
  staffProfile: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      roleTitle: true,
      venue: true
    }
  },
  checklistTemplate: {
    select: {
      id: true,
      name: true,
      area: true
    }
  },
  checklistRun: {
    select: {
      id: true,
      status: true,
      runDate: true
    }
  }
} as const;

function isManager(user: AuthUser) {
  if (user.accountType === 'VENUE_DEVICE') return false;
  return user.role === 'ADMIN' || user.role === 'MANAGER' || user.isAdmin;
}

function isAdmin(user: AuthUser) {
  return user.role === 'ADMIN' || user.isAdmin;
}

function canManageVenue(user: AuthUser, venue: string | null | undefined) {
  if (isAdmin(user)) return true;
  if (user.role !== 'MANAGER') return false;
  if (!user.venue || !venue) return true;
  return normalise(user.venue) === normalise(venue);
}

function isVenueDeviceContext(user: AuthUser) {
  return user.accountType === 'VENUE_DEVICE' || Boolean(user.deviceAccount);
}

function deviceVenue(user: AuthUser) {
  return user.deviceAccount?.venue ?? user.venue;
}

function canUseVenueQueue(user: AuthUser, venue: string | null | undefined) {
  if (!isVenueDeviceContext(user)) return false;
  const scope = deviceVenue(user);
  return Boolean(scope && venue && normalise(scope) === normalise(venue));
}

function managedVenueForRequest(user: AuthUser, venue?: string) {
  const requestedVenue = cleanString(venue);
  if (isAdmin(user)) return requestedVenue ?? user.venue;
  if (!isManager(user)) return user.venue;
  if (
    requestedVenue &&
    user.venue &&
    normalise(requestedVenue) !== normalise(user.venue)
  ) {
    throw new HttpError(403, 'Venue access required');
  }
  return requestedVenue ?? user.venue;
}

function canManageSettings(user: AuthUser) {
  if (user.isAdmin || user.role === 'ADMIN') return true;
  const settingsAccess = user.appAccess.find((access) => access.appId === 'SETTINGS' && access.status === 'ENABLED');
  return Boolean(settingsAccess?.role === 'ADMIN' || settingsAccess?.permissions?.admin);
}

function cleanString(value: string | null | undefined) {
  const next = value?.trim();
  return next ? next : null;
}

function cleanNumber(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalise(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function matchesText(value: string | null | undefined, filter: string | null | undefined) {
  const needle = normalise(filter);
  if (!needle) return true;
  return normalise(value).includes(needle);
}

function minutesSinceStartOfDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function daysOfWeek(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

function serialiseDate(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function staffName(staff?: { firstName: string; lastName: string } | null) {
  if (!staff) return null;
  return `${staff.firstName} ${staff.lastName}`.trim();
}

function shiftLabel(shift: RosterShiftRecord) {
  const parts = [shift.area, shift.roleTitle, shift.notes].map((part) => part?.trim()).filter(Boolean);
  return parts.join(' / ') || 'Shift';
}

function plusDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function coerceWindow(start?: string, end?: string, days = SHIFT_LOOKAHEAD_DAYS) {
  const now = new Date();
  const from = start ? new Date(start) : new Date(now.getTime() - 12 * 60 * 60 * 1000);
  const to = end ? new Date(end) : plusDays(now, days);
  return {
    from: Number.isNaN(from.getTime()) ? new Date(now.getTime() - 12 * 60 * 60 * 1000) : from,
    to: Number.isNaN(to.getTime()) ? plusDays(now, days) : to
  };
}

function toRulePayload(rule: ShiftTaskRuleRecord & { checklistTemplate?: { id: string; name: string; area: string | null } | null }): ShiftTaskRule {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    venue: rule.venue,
    matchRoleTitle: rule.matchRoleTitle,
    matchArea: rule.matchArea,
    matchShiftLabel: rule.matchShiftLabel,
    startBeforeMinutes: rule.startBeforeMinutes,
    startAfterMinutes: rule.startAfterMinutes,
    endBeforeMinutes: rule.endBeforeMinutes,
    endAfterMinutes: rule.endAfterMinutes,
    daysOfWeek: daysOfWeek(rule.daysOfWeek),
    taskType: rule.taskType,
    checklistTemplateId: rule.checklistTemplateId,
    stocktakeTemplate: rule.stocktakeTemplate,
    dueTiming: rule.dueTiming,
    dueOffsetMinutes: rule.dueOffsetMinutes,
    assignmentTarget: rule.assignmentTarget,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    checklistTemplate: rule.checklistTemplate ?? null
  };
}

function toAssignmentPayload(assignment: any): ShiftTaskAssignment {
  return {
    id: assignment.id,
    assignmentKey: assignment.assignmentKey,
    ruleId: assignment.ruleId,
    rosterShiftId: assignment.rosterShiftId,
    staffProfileId: assignment.staffProfileId,
    venue: assignment.venue,
    taskType: assignment.taskType,
    checklistTemplateId: assignment.checklistTemplateId,
    checklistRunId: assignment.checklistRunId,
    stocktakeId: assignment.stocktakeId,
    status: assignment.status,
    dueAt: serialiseDate(assignment.dueAt),
    completedAt: serialiseDate(assignment.completedAt),
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString(),
    rule: assignment.rule
      ? {
          id: assignment.rule.id,
          name: assignment.rule.name,
          dueTiming: assignment.rule.dueTiming,
          assignmentTarget: assignment.rule.assignmentTarget
        }
      : null,
    rosterShift: assignment.rosterShift
      ? {
          ...assignment.rosterShift,
          startsAt: assignment.rosterShift.startsAt.toISOString(),
          endsAt: assignment.rosterShift.endsAt.toISOString(),
          createdAt: assignment.rosterShift.createdAt.toISOString(),
          updatedAt: assignment.rosterShift.updatedAt.toISOString()
        }
      : null,
    staffProfile: assignment.staffProfile ?? null,
    checklistTemplate: assignment.checklistTemplate ?? null,
    checklistRun: assignment.checklistRun
      ? {
          ...assignment.checklistRun,
          runDate: assignment.checklistRun.runDate.toISOString()
        }
      : null
  };
}

function ruleMatchesShift(rule: ShiftTaskRuleRecord, shift: RosterShiftRecord) {
  if (!rule.enabled) return false;
  if (rule.venue && normalise(rule.venue) !== normalise(shift.venue)) return false;
  if (!matchesText(shift.roleTitle, rule.matchRoleTitle)) return false;
  if (!matchesText(shift.area, rule.matchArea)) return false;
  if (rule.matchShiftLabel) {
    const labelSource = [shift.notes, shift.area, shift.roleTitle].filter(Boolean).join(' ');
    if (!matchesText(labelSource, rule.matchShiftLabel)) return false;
  }

  const activeDays = daysOfWeek(rule.daysOfWeek);
  if (activeDays.length > 0 && !activeDays.includes(shift.startsAt.getDay())) return false;

  const startMinutes = minutesSinceStartOfDay(shift.startsAt);
  const endMinutes = minutesSinceStartOfDay(shift.endsAt);
  if (rule.startBeforeMinutes !== null && startMinutes > rule.startBeforeMinutes) return false;
  if (rule.startAfterMinutes !== null && startMinutes < rule.startAfterMinutes) return false;
  if (rule.endBeforeMinutes !== null && endMinutes > rule.endBeforeMinutes) return false;
  if (rule.endAfterMinutes !== null && endMinutes < rule.endAfterMinutes) return false;
  return true;
}

function dueAtForRule(rule: ShiftTaskRuleRecord, shift: RosterShiftRecord) {
  const offset = rule.dueOffsetMinutes ?? 0;
  const minuteMs = 60 * 1000;
  switch (rule.dueTiming) {
    case 'BEFORE_SHIFT_START':
      return new Date(shift.startsAt.getTime() - Math.abs(offset) * minuteMs);
    case 'BEFORE_SHIFT_END':
      return new Date(shift.endsAt.getTime() - Math.abs(offset) * minuteMs);
    case 'AFTER_SHIFT_END':
      return new Date(shift.endsAt.getTime() + offset * minuteMs);
    case 'DURING_SHIFT':
    default:
      return new Date(shift.startsAt.getTime() + offset * minuteMs);
  }
}

function assignmentKeyFor(rule: ShiftTaskRuleRecord, shift: RosterShiftRecord, staffProfileId: string | null) {
  return [
    'shift-task',
    rule.id,
    shift.id,
    staffProfileId ?? 'venue',
    rule.taskType,
    rule.checklistTemplateId ?? rule.stocktakeTemplate ?? 'task'
  ].join(':');
}

function shouldAssignToStaff(rule: ShiftTaskRuleRecord) {
  return rule.assignmentTarget === 'ASSIGNED_STAFF' || rule.assignmentTarget === 'ALL_ON_SHIFT' || rule.assignmentTarget === 'MANAGER_ON_DUTY';
}

async function validateRuleData(data: ReturnType<typeof shiftTaskRuleInputSchema.parse>) {
  if (data.taskType === 'CHECKLIST') {
    if (!data.checklistTemplateId) {
      throw new HttpError(400, 'Checklist task rules require a checklist template.');
    }
    const template = await prisma.checklistTemplate.findUnique({ where: { id: data.checklistTemplateId } });
    if (!template) throw new HttpError(404, 'Checklist template not found');
  }
}

function ruleData(input: ReturnType<typeof shiftTaskRuleInputSchema.parse>) {
  return {
    name: input.name.trim(),
    enabled: input.enabled ?? true,
    venue: cleanString(input.venue),
    matchRoleTitle: cleanString(input.matchRoleTitle),
    matchArea: cleanString(input.matchArea),
    matchShiftLabel: cleanString(input.matchShiftLabel),
    startBeforeMinutes: cleanNumber(input.startBeforeMinutes),
    startAfterMinutes: cleanNumber(input.startAfterMinutes),
    endBeforeMinutes: cleanNumber(input.endBeforeMinutes),
    endAfterMinutes: cleanNumber(input.endAfterMinutes),
    daysOfWeek: input.daysOfWeek ?? [],
    taskType: input.taskType,
    checklistTemplateId: cleanString(input.checklistTemplateId),
    stocktakeTemplate: cleanString(input.stocktakeTemplate),
    dueTiming: input.dueTiming,
    dueOffsetMinutes: cleanNumber(input.dueOffsetMinutes),
    assignmentTarget: input.assignmentTarget
  };
}

async function ensureAssignmentsForShifts(shifts: RosterShiftRecord[]) {
  const rules = await prisma.shiftTaskRule.findMany({
    where: { enabled: true },
    include: { checklistTemplate: { select: { id: true, name: true, area: true } } }
  });

  let generated = 0;
  for (const shift of shifts) {
    for (const rule of rules) {
      if (!ruleMatchesShift(rule, shift)) continue;
      const staffProfileId = shouldAssignToStaff(rule) ? shift.staffProfileId : null;
      const assignmentKey = assignmentKeyFor(rule, shift, staffProfileId);

      try {
        await prisma.shiftTaskAssignment.create({
          data: {
            assignmentKey,
            ruleId: rule.id,
            rosterShiftId: shift.id,
            staffProfileId,
            venue: shift.venue,
            taskType: rule.taskType,
            checklistTemplateId: rule.checklistTemplateId,
            status: 'PENDING',
            dueAt: dueAtForRule(rule, shift)
          }
        });
        generated += 1;
      } catch (error) {
        if ((error as { code?: string }).code !== 'P2002') throw error;
      }
    }
  }

  return generated;
}

function assertAssignmentAccess(
  user: AuthUser,
  assignment: { staffProfileId: string | null; venue: string | null }
) {
  if (assignment.staffProfileId) {
    if (assignment.staffProfileId === user.id) return;
    if (canManageVenue(user, assignment.venue)) return;
    throw new HttpError(403, 'Shift task access required');
  }

  if (canUseVenueQueue(user, assignment.venue)) return;

  if (!canManageVenue(user, assignment.venue)) {
    throw new HttpError(403, 'Shift task access required');
  }
}

async function assignmentsForWhere(where: Record<string, unknown>) {
  await prisma.shiftTaskAssignment.updateMany({
    where: { status: 'PENDING', dueAt: { lt: new Date() } },
    data: { status: 'OVERDUE' }
  });

  const assignments = await prisma.shiftTaskAssignment.findMany({
    where,
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    include: assignmentInclude
  });
  return assignments.map(toAssignmentPayload);
}

export const shiftTaskService = {
  async listRules(user: AuthUser) {
    if (!canManageSettings(user)) throw new HttpError(403, 'Settings admin access required');
    const rules = await prisma.shiftTaskRule.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
      include: { checklistTemplate: { select: { id: true, name: true, area: true } } }
    });
    return rules.map(toRulePayload);
  },

  async createRule(input: unknown, user: AuthUser) {
    if (!canManageSettings(user)) throw new HttpError(403, 'Settings admin access required');
    const parsed = shiftTaskRuleInputSchema.parse(input);
    await validateRuleData(parsed);
    const created = await prisma.shiftTaskRule.create({
      data: ruleData(parsed),
      include: { checklistTemplate: { select: { id: true, name: true, area: true } } }
    });
    return toRulePayload(created);
  },

  async updateRule(id: string, input: unknown, user: AuthUser) {
    if (!canManageSettings(user)) throw new HttpError(403, 'Settings admin access required');
    const existing = await prisma.shiftTaskRule.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Shift task rule not found');
    const parsed = shiftTaskRuleUpdateInputSchema.parse(input);
    const merged = shiftTaskRuleInputSchema.parse({
      name: existing.name,
      enabled: existing.enabled,
      venue: existing.venue ?? '',
      matchRoleTitle: existing.matchRoleTitle ?? '',
      matchArea: existing.matchArea ?? '',
      matchShiftLabel: existing.matchShiftLabel ?? '',
      startBeforeMinutes: existing.startBeforeMinutes ?? undefined,
      startAfterMinutes: existing.startAfterMinutes ?? undefined,
      endBeforeMinutes: existing.endBeforeMinutes ?? undefined,
      endAfterMinutes: existing.endAfterMinutes ?? undefined,
      daysOfWeek: daysOfWeek(existing.daysOfWeek),
      taskType: existing.taskType,
      checklistTemplateId: existing.checklistTemplateId ?? '',
      stocktakeTemplate: existing.stocktakeTemplate ?? '',
      dueTiming: existing.dueTiming,
      dueOffsetMinutes: existing.dueOffsetMinutes ?? undefined,
      assignmentTarget: existing.assignmentTarget,
      ...parsed
    });
    await validateRuleData(merged);
    const updated = await prisma.shiftTaskRule.update({
      where: { id },
      data: ruleData(merged),
      include: { checklistTemplate: { select: { id: true, name: true, area: true } } }
    });
    return toRulePayload(updated);
  },

  async previewRule(input: unknown, user: AuthUser): Promise<ShiftTaskRulePreviewResult> {
    if (!canManageSettings(user)) throw new HttpError(403, 'Settings admin access required');
    const parsed = shiftTaskRulePreviewInputSchema.parse(input);
    const data = ruleData(parsed.rule);
    const { from, to } = coerceWindow(parsed.start, parsed.end);
    const shifts = await prisma.rosterShift.findMany({
      where: {
        startsAt: { gte: from, lte: to },
        ...(parsed.venue ? { venue: parsed.venue } : data.venue ? { venue: data.venue } : {})
      },
      orderBy: [{ startsAt: 'asc' }],
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        }
      }
    });
    const virtualRule = {
      ...data,
      id: 'preview',
      createdAt: new Date(),
      updatedAt: new Date(),
      checklistTemplateId: data.checklistTemplateId,
      stocktakeTemplate: data.stocktakeTemplate
    } as ShiftTaskRuleRecord;

    const matches: ShiftTaskPreviewAssignment[] = shifts
      .filter((shift) => ruleMatchesShift(virtualRule, shift))
      .map((shift) => {
        const staffProfileId = shouldAssignToStaff(virtualRule) ? shift.staffProfileId : null;
        return {
          assignmentKey: assignmentKeyFor(virtualRule, shift, staffProfileId),
          ruleId: virtualRule.id,
          ruleName: data.name,
          rosterShiftId: shift.id,
          staffProfileId,
          staffName: staffName(shift.staffProfile),
          venue: shift.venue,
          taskType: data.taskType,
          checklistTemplateId: data.checklistTemplateId,
          checklistTemplateName: null,
          dueAt: dueAtForRule(virtualRule, shift).toISOString(),
          shiftLabel: shiftLabel(shift)
        };
      });

    return { matches, matchCount: matches.length };
  },

  async listForStaff(user: AuthUser): Promise<ShiftTaskListResponse> {
    const { from, to } = coerceWindow(undefined, undefined, SHIFT_LOOKAHEAD_DAYS);
    const shifts = await prisma.rosterShift.findMany({
      where: {
        staffProfileId: user.id,
        startsAt: { gte: from, lte: to }
      },
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        }
      }
    });
    const generated = await ensureAssignmentsForShifts(shifts);
    const tasks = await assignmentsForWhere({
      staffProfileId: user.id,
      status: { not: 'CANCELLED' }
    });
    return { tasks, generated };
  },

  async listForVenue(user: AuthUser, venue?: string): Promise<ShiftTaskListResponse> {
    if (isVenueDeviceContext(user)) {
      const targetVenue = deviceVenue(user);
      if (!targetVenue) throw new HttpError(403, 'Venue device scope required');
      const requestedVenue = cleanString(venue);
      if (requestedVenue && normalise(requestedVenue) !== normalise(targetVenue)) {
        throw new HttpError(403, 'Venue access required');
      }
      const { from, to } = coerceWindow(undefined, undefined, VENUE_QUEUE_LOOKAHEAD_DAYS);
      const shifts = await prisma.rosterShift.findMany({
        where: {
          venue: targetVenue,
          startsAt: { gte: from, lte: to }
        },
        include: {
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              roleTitle: true,
              venue: true,
              employmentStatus: true
            }
          }
        }
      });
      const generated = await ensureAssignmentsForShifts(shifts);
      const tasks = await assignmentsForWhere({
        venue: targetVenue,
        staffProfileId: null,
        status: { not: 'CANCELLED' }
      });
      return { tasks, generated };
    }

    if (!isManager(user)) {
      const { from, to } = coerceWindow(undefined, undefined, VENUE_QUEUE_LOOKAHEAD_DAYS);
      const shifts = await prisma.rosterShift.findMany({
        where: {
          staffProfileId: user.id,
          startsAt: { gte: from, lte: to }
        },
        include: {
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              roleTitle: true,
              venue: true,
              employmentStatus: true
            }
          }
        }
      });
      const generated = await ensureAssignmentsForShifts(shifts);
      const tasks = await assignmentsForWhere({
        staffProfileId: user.id,
        status: { not: 'CANCELLED' }
      });
      return { tasks, generated };
    }

    const targetVenue = managedVenueForRequest(user, venue);
    const { from, to } = coerceWindow(undefined, undefined, VENUE_QUEUE_LOOKAHEAD_DAYS);
    const shifts = await prisma.rosterShift.findMany({
      where: {
        ...(targetVenue ? { venue: targetVenue } : {}),
        startsAt: { gte: from, lte: to }
      },
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        }
      }
    });
    const generated = await ensureAssignmentsForShifts(shifts);
    const venueWhere = targetVenue ? { venue: targetVenue } : {};
    const tasks = await assignmentsForWhere({
      ...venueWhere,
      status: { not: 'CANCELLED' }
    });
    return { tasks, generated };
  },

  async startAssignedChecklist(id: string, user: AuthUser): Promise<StartAssignedChecklistResult> {
    const assignment = await prisma.shiftTaskAssignment.findUnique({
      where: { id },
      include: {
        ...assignmentInclude,
        checklistTemplate: {
          include: { items: { orderBy: [{ position: 'asc' }] } }
        }
      }
    });
    if (!assignment) throw new HttpError(404, 'Shift task assignment not found');
    assertAssignmentAccess(user, assignment);
    if (assignment.taskType !== 'CHECKLIST' || !assignment.checklistTemplateId || !assignment.checklistTemplate) {
      throw new HttpError(400, 'Only checklist shift tasks can be started in this release.');
    }

    const run = await prisma.$transaction(async (tx) => {
      const current = await tx.shiftTaskAssignment.findUnique({
        where: { id: assignment.id },
        include: {
          rule: true,
          rosterShift: assignmentInclude.rosterShift,
          staffProfile: assignmentInclude.staffProfile,
          checklistRun: assignmentInclude.checklistRun,
          checklistTemplate: {
            include: { items: { orderBy: [{ position: 'asc' }] } }
          }
        }
      });

      if (!current) throw new HttpError(404, 'Shift task assignment not found');
      assertAssignmentAccess(user, current);

      if (current.checklistRunId) {
        const existingRun = await tx.checklistRun.findUnique({
          where: { id: current.checklistRunId },
          include: {
            template: { include: { items: { orderBy: [{ position: 'asc' }] } } },
            items: { include: { linkedIssue: true }, orderBy: [{ position: 'asc' }] }
          }
        });
        if (!existingRun) throw new HttpError(404, 'Checklist run not found');
        return existingRun;
      }

      if (current.taskType !== 'CHECKLIST' || !current.checklistTemplateId || !current.checklistTemplate) {
        throw new HttpError(400, 'Only checklist shift tasks can be started in this release.');
      }

      const claim = await tx.shiftTaskAssignment.updateMany({
        where: {
          id: current.id,
          checklistRunId: null,
          status: { in: ['PENDING', 'OVERDUE'] }
        },
        data: { status: 'IN_PROGRESS' }
      });

      if (claim.count === 0) {
        const latest = await tx.shiftTaskAssignment.findUnique({
          where: { id: current.id },
          select: { checklistRunId: true }
        });
        if (latest?.checklistRunId) {
          const existingRun = await tx.checklistRun.findUnique({
            where: { id: latest.checklistRunId },
            include: {
              template: { include: { items: { orderBy: [{ position: 'asc' }] } } },
              items: { include: { linkedIssue: true }, orderBy: [{ position: 'asc' }] }
            }
          });
          if (!existingRun) throw new HttpError(404, 'Checklist run not found');
          return existingRun;
        }
        throw new HttpError(409, 'Shift task is not available to start.');
      }

      const createdRun = await tx.checklistRun.create({
        data: {
          templateId: current.checklistTemplateId,
          performedBy: `${user.firstName} ${user.lastName}`.trim() || user.email || 'Staff',
          area: current.venue || current.checklistTemplate.area || null,
          notes: `Started from shift task: ${current.rule?.name ?? 'Shift task'}`,
          status: 'OPEN',
          items: {
            create: current.checklistTemplate.items.map((item) => ({
              templateItemId: item.id,
              label: item.label,
              description: item.description,
              position: item.position,
              result: 'PENDING'
            }))
          }
        },
        include: {
          template: { include: { items: { orderBy: [{ position: 'asc' }] } } },
          items: { include: { linkedIssue: true }, orderBy: [{ position: 'asc' }] }
        }
      });
      await tx.shiftTaskAssignment.update({
        where: { id: current.id },
        data: {
          checklistRunId: createdRun.id,
          status: 'IN_PROGRESS'
        }
      });
      return createdRun;
    });

    const updatedAssignment = await prisma.shiftTaskAssignment.findUnique({
      where: { id },
      include: assignmentInclude
    });

    if (!updatedAssignment) throw new HttpError(404, 'Shift task assignment not found');
    return {
      assignment: toAssignmentPayload(updatedAssignment),
      run: run as any
    };
  }
};
