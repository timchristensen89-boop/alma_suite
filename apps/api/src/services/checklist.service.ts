import { prisma } from '@alma/db';
import {
  ALMA_IMPORTED_CHECKLIST_TEMPLATES,
  checklistItemUpdateInputSchema,
  checklistRunCreateInputSchema,
  checklistTemplateInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

type CoreChecklistTemplate = {
  name: string;
  area: string;
  items: Array<[label: string, description: string]>;
};

const CORE_CHECKLIST_TEMPLATES: CoreChecklistTemplate[] = [
  {
    name: 'Opening Food Safety & Venue Readiness',
    area: 'Whole venue',
    items: [
      ['Venue entry and public areas are clean, dry, and ready for trade.', 'Check floors, tables, chairs, front windows, menus, bins, and walkways.'],
      ['Fridges, freezers, and cool rooms are within safe temperature range.', 'Record any out-of-range unit as a failed item and raise a maintenance issue if needed.'],
      ['Handwash stations are stocked and accessible.', 'Soap, paper towel, warm water, and no stored equipment in front of basins.'],
      ['Food prep benches, chopping boards, and equipment are sanitised.', 'Confirm ready-to-use sanitiser is available and labelled.'],
      ['Opening manager has checked bookings, specials, staffing, and handover notes.', 'Capture anything that needs follow-up in the notes.']
    ]
  },
  {
    name: 'Closing Food Safety & Security',
    area: 'Whole venue',
    items: [
      ['All perishable food is labelled, dated, covered, and stored correctly.', 'Check use-by dates and discard anything unsafe.'],
      ['Dishwasher, glasswasher, benches, sinks, and floors are cleaned down.', 'Include drains, under benches, and splashback areas.'],
      ['Bins are emptied, waste areas are tidy, and pest risks are removed.', 'Record overflowing bins, food waste, or pest evidence as failures.'],
      ['Gas, appliances, lights, doors, safes, alarms, and locks are checked.', 'Follow the venue lockup procedure before leaving.'],
      ['Closing cash, tills, keys, and manager handover are complete.', 'Leave notes for the next shift where needed.']
    ]
  },
  {
    name: 'Bar Opening & Responsible Service Check',
    area: 'Bar',
    items: [
      ['Liquor licence summary and RSA signage are visible to staff.', 'Confirm current conditions are accessible before trade.'],
      ['Bar fridges, ice wells, taps, garnish trays, and glasswash are ready.', 'Check temperatures, stock rotation, cleanliness, and chemical levels.'],
      ['No glassware damage, broken glass, or contamination risk is present.', 'Remove chipped glassware immediately.'],
      ['Incident register, refusal log, and first aid access are ready.', 'Record missing registers or blocked access as failures.'],
      ['Outdoor, music, and trading-condition restrictions are understood for the shift.', 'Capture any special licence conditions in notes.']
    ]
  },
  {
    name: 'Kitchen Prep & Allergen Control',
    area: 'Kitchen',
    items: [
      ['Prep list is current and allergen information is available to the team.', 'Confirm menu changes, specials, and substitutions are reflected.'],
      ['Raw and ready-to-eat food are separated during prep and storage.', 'Check boards, knives, containers, shelves, and handling flow.'],
      ['Date labels, batch labels, and use-first rotation are correct.', 'Fix labels before marking pass.'],
      ['Sanitiser, probe wipes, gloves, and cleaning cloths are stocked.', 'Replace cloths and chemicals where needed.'],
      ['Chef handover has captured shortages, equipment faults, and high-risk prep.', 'Raise issues for any fault that needs follow-up.']
    ]
  },
  {
    name: 'Bathroom & Public Area Check',
    area: 'Floor',
    items: [
      ['Bathrooms are clean, stocked, dry, and free from hazards.', 'Soap, paper, bins, floors, mirrors, locks, odours, and lighting.'],
      ['Dining, bar, and outdoor areas are clear of trip or slip hazards.', 'Check mats, cables, spills, broken furniture, and footpath clearance.'],
      ['Music, lighting, heating/cooling, and ambience are appropriate for trade.', 'Record faults or licence-sensitive noise concerns.'],
      ['Emergency exits, extinguishers, and access paths are unobstructed.', 'Do not mark pass if anything is stored in an exit path.'],
      ['Customer-facing signage and menus are current and tidy.', 'Remove damaged, outdated, or non-compliant signage.']
    ]
  },
  {
    name: 'Weekly Compliance Walk',
    area: 'Manager',
    items: [
      ['Licences, permits, and key conditions have been reviewed.', 'Check liquor, outdoor seating, footpath, music, and operating windows.'],
      ['RSA, food safety, first aid, and onboarding records have no urgent gaps.', 'Record missing or expired records for follow-up.'],
      ['Incident, refusal, hazard, and maintenance registers have been reviewed.', 'Confirm high-risk items are assigned and not stale.'],
      ['Cleaning, pest, temperature, and equipment records are current.', 'Capture missing records as checklist failures.'],
      ['Manager has documented actions and owners for any outstanding compliance risk.', 'Use failures to create issues where appropriate.']
    ]
  },
  ...ALMA_IMPORTED_CHECKLIST_TEMPLATES.map((template) => ({
    name: template.name,
    area: template.area,
    items: template.items.map(([label, description]) => [
      label,
      template.reviewStatus === 'active'
        ? description
        : `${description} Needs manager review before active use.`
    ] as [string, string])
  }))
];

async function ensureCoreTemplates() {
  await Promise.all(
    CORE_CHECKLIST_TEMPLATES.map(async (template) => {
      const existing = await prisma.checklistTemplate.findFirst({
        where: { name: template.name }
      });
      if (existing) return;

      await prisma.checklistTemplate.create({
        data: {
          name: template.name,
          area: template.area,
          items: {
            create: template.items.map(([label, description], index) => ({
              label,
              description,
              position: index
            }))
          }
        }
      });
    })
  );
}

export const checklistService = {
  async listTemplates() {
    await ensureCoreTemplates();
    return prisma.checklistTemplate.findMany({
      orderBy: [{ name: 'asc' }],
      include: { items: { orderBy: [{ position: 'asc' }] } }
    });
  },

  async getTemplateById(id: string) {
    const template = await prisma.checklistTemplate.findUnique({
      where: { id },
      include: { items: { orderBy: [{ position: 'asc' }] } }
    });
    if (!template) throw new HttpError(404, 'Checklist template not found');
    return template;
  },

  async createTemplate(input: unknown) {
    const data = checklistTemplateInputSchema.parse(input);

    return prisma.checklistTemplate.create({
      data: {
        name: data.name,
        area: data.area || null,
        items: {
          create: data.items.map((item, index) => ({
            label: item.label,
            description: item.description || null,
            position: item.position ?? index
          }))
        }
      },
      include: { items: { orderBy: [{ position: 'asc' }] } }
    });
  },

  async updateTemplate(id: string, input: unknown) {
    const data = checklistTemplateInputSchema.parse(input);
    const existing = await this.getTemplateById(id);

    return prisma.$transaction(async (tx) => {
      await tx.checklistTemplate.update({
        where: { id: existing.id },
        data: { name: data.name, area: data.area || null }
      });

      // Replace items fully. Safe because ChecklistItem (from runs) references the
      // templateItem via optional templateItemId, and those are set to null on
      // template-item delete since the field is not required with Cascade.
      await tx.checklistItemTemplate.deleteMany({
        where: { templateId: existing.id }
      });

      await tx.checklistItemTemplate.createMany({
        data: data.items.map((item, index) => ({
          templateId: existing.id,
          label: item.label,
          description: item.description || null,
          position: item.position ?? index
        }))
      });

      return tx.checklistTemplate.findUnique({
        where: { id: existing.id },
        include: { items: { orderBy: [{ position: 'asc' }] } }
      });
    });
  },

  async deleteTemplate(id: string) {
    await this.getTemplateById(id);
    const runCount = await prisma.checklistRun.count({ where: { templateId: id } });
    if (runCount > 0) {
      throw new HttpError(
        409,
        'Cannot delete a template that has runs. Archive it instead.'
      );
    }
    await prisma.checklistTemplate.delete({ where: { id } });
    return { ok: true };
  },

  async listRuns() {
    return prisma.checklistRun.findMany({
      orderBy: [{ runDate: 'desc' }],
      include: {
        template: { include: { items: { orderBy: [{ position: 'asc' }] } } },
        items: { include: { linkedIssue: true }, orderBy: [{ position: 'asc' }] }
      }
    });
  },

  // Venue readiness (#20/#21): for a given day, return one summary row per
  // template, marked green / amber / red. Templates that don't have a run
  // for that day yet are returned as "missing" so the manager sees the gap.
  // Optional venue filter narrows to templates with that `area` value.
  async getTodayReadiness(options: { date?: string; venue?: string } = {}) {
    const target = options.date ? new Date(options.date) : new Date();
    const startOfDay = new Date(target);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const venueFilter = options.venue?.trim() || null;

    const templates = await prisma.checklistTemplate.findMany({
      where: venueFilter
        ? { OR: [{ area: venueFilter }, { area: 'Whole venue' }, { area: null }] }
        : {},
      orderBy: [{ name: 'asc' }],
      include: { items: { select: { id: true } } }
    });

    const runs = await prisma.checklistRun.findMany({
      where: {
        runDate: { gte: startOfDay, lt: endOfDay },
        ...(venueFilter ? { OR: [{ area: venueFilter }, { area: null }] } : {})
      },
      orderBy: [{ updatedAt: 'desc' }],
      include: { items: true, template: true }
    });

    const lowerName = (name: string) => name.toLowerCase();

    type ReadinessRow = {
      templateId: string;
      templateName: string;
      area: string | null;
      // Buckets the template into "opening" / "closing" / "service" so the UI
      // can split into the two columns the user asked for.
      kind: 'opening' | 'closing' | 'service';
      itemsTotal: number;
      itemsPassed: number;
      itemsFailed: number;
      itemsPending: number;
      // GREEN: all items PASS. AMBER: in progress / no failures. RED: any FAIL.
      // MISSING: no run for today yet.
      status: 'GREEN' | 'AMBER' | 'RED' | 'MISSING';
      runId: string | null;
      updatedAt: string | null;
      performedBy: string | null;
    };

    function classify(name: string): ReadinessRow['kind'] {
      const lower = lowerName(name);
      if (lower.includes('open')) return 'opening';
      if (lower.includes('clos')) return 'closing';
      return 'service';
    }

    const rows: ReadinessRow[] = templates.map((template) => {
      const run = runs.find((entry) => entry.templateId === template.id) ?? null;
      const items = run?.items ?? [];
      const itemsTotal = items.length || template.items.length;
      const itemsPassed = items.filter((item) => item.result === 'PASS').length;
      const itemsFailed = items.filter((item) => item.result === 'FAIL').length;
      const itemsPending = Math.max(0, itemsTotal - itemsPassed - itemsFailed - items.filter((item) => item.result === 'NA').length);

      let status: ReadinessRow['status'];
      if (!run) status = 'MISSING';
      else if (itemsFailed > 0) status = 'RED';
      else if (itemsPassed > 0 && itemsPending === 0) status = 'GREEN';
      else status = 'AMBER';

      return {
        templateId: template.id,
        templateName: template.name,
        area: template.area ?? null,
        kind: classify(template.name),
        itemsTotal,
        itemsPassed,
        itemsFailed,
        itemsPending,
        status,
        runId: run?.id ?? null,
        updatedAt: run?.updatedAt?.toISOString() ?? null,
        performedBy: run?.performedBy ?? null
      };
    });

    // Roll up to an overall readiness colour so the venue can hang a green
    // banner / amber banner / red banner above the checklist grid.
    const opening = rows.filter((row) => row.kind === 'opening');
    const closing = rows.filter((row) => row.kind === 'closing');
    function rollup(group: ReadinessRow[]): ReadinessRow['status'] {
      if (group.length === 0) return 'GREEN'; // nothing to do = green
      if (group.some((row) => row.status === 'RED')) return 'RED';
      if (group.some((row) => row.status === 'MISSING')) return 'AMBER';
      if (group.some((row) => row.status === 'AMBER')) return 'AMBER';
      return 'GREEN';
    }

    return {
      date: startOfDay.toISOString().slice(0, 10),
      venue: venueFilter,
      generatedAt: new Date().toISOString(),
      overall: {
        opening: rollup(opening),
        closing: rollup(closing),
        overall: rollup(rows)
      },
      rows
    };
  },

  async getRunById(id: string) {
    const run = await prisma.checklistRun.findUnique({
      where: { id },
      include: {
        template: { include: { items: { orderBy: [{ position: 'asc' }] } } },
        items: { include: { linkedIssue: true }, orderBy: [{ position: 'asc' }] }
      }
    });

    if (!run) {
      throw new HttpError(404, 'Checklist run not found');
    }

    return run;
  },

  async createRun(input: unknown) {
    const data = checklistRunCreateInputSchema.parse(input);

    const template = await prisma.checklistTemplate.findUnique({
      where: { id: data.templateId },
      include: { items: { orderBy: [{ position: 'asc' }] } }
    });

    if (!template) {
      throw new HttpError(404, 'Checklist template not found');
    }

    return prisma.checklistRun.create({
      data: {
        templateId: template.id,
        performedBy: data.performedBy || null,
        area: data.area || template.area || null,
        notes: data.notes || null,
        status: 'OPEN',
        items: {
          create: template.items.map((item) => ({
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
  },

  // Generates one OPEN run per template for today if none already exists.
  // Designed to be invoked by Cloud Scheduler each morning at venue open
  // time so the daily compliance checklists are always there when staff
  // start their shift, instead of being created manually.
  async autoScheduleDailyRuns() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const templates = await prisma.checklistTemplate.findMany({
      include: { items: { orderBy: [{ position: 'asc' }] } }
    });

    const created: Array<{ templateId: string; templateName: string; runId: string }> = [];
    const skipped: Array<{ templateId: string; templateName: string; reason: string }> = [];

    for (const template of templates) {
      // Skip if no items
      if (template.items.length === 0) {
        skipped.push({ templateId: template.id, templateName: template.name, reason: 'no items' });
        continue;
      }

      // Check if an open run already exists for this template today
      const existing = await prisma.checklistRun.findFirst({
        where: {
          templateId: template.id,
          createdAt: { gte: startOfDay, lt: endOfDay }
        }
      });

      if (existing) {
        skipped.push({ templateId: template.id, templateName: template.name, reason: 'already exists' });
        continue;
      }

      const run = await prisma.checklistRun.create({
        data: {
          templateId: template.id,
          performedBy: null,
          area: template.area || null,
          notes: 'Auto-generated by daily scheduler',
          status: 'OPEN',
          items: {
            create: template.items.map((item) => ({
              templateItemId: item.id,
              label: item.label,
              description: item.description,
              position: item.position,
              result: 'PENDING'
            }))
          }
        }
      });

      created.push({ templateId: template.id, templateName: template.name, runId: run.id });
    }

    return {
      generatedAt: now.toISOString(),
      created: created.length,
      skipped: skipped.length,
      runs: created,
      skippedRuns: skipped
    };
  },

  async updateItem(runId: string, itemId: string, input: unknown) {
    const data = checklistItemUpdateInputSchema.parse(input);
    const run = await this.getRunById(runId);
    const item = run.items.find((current) => current.id === itemId);

    if (!item) {
      throw new HttpError(404, 'Checklist item not found');
    }

    return prisma.$transaction(async (tx) => {
      let linkedIssueId = item.linkedIssueId;

      if (data.result === 'FAIL' && data.createIssue && !item.linkedIssueId) {
        const issue = await tx.issue.create({
          data: {
            title: data.issueTitle || `${run.template.name}: ${item.label}`,
            description: data.notes || item.description || `Failure recorded against checklist item: ${item.label}`,
            category: data.issueCategory || 'Checklist Failure',
            severity: data.issueSeverity || 'MEDIUM',
            status: 'OPEN',
            assignee: run.performedBy || null,
            notes: `Created from checklist run ${run.id}`,
            activities: {
              create: {
                action: 'created',
                message: `Issue created from checklist failure in ${run.template.name}.`,
                actor: 'system'
              }
            }
          }
        });

        linkedIssueId = issue.id;
      }

      const updatedItem = await tx.checklistItem.update({
        where: { id: itemId },
        data: {
          result: data.result,
          notes: data.notes || null,
          linkedIssueId: linkedIssueId || null
        },
        include: { linkedIssue: true }
      });

      const runItems = await tx.checklistItem.findMany({ where: { runId } });
      const nextStatus = runItems.every((current) => ['PASS', 'FAIL', 'NA'].includes(current.id === itemId ? data.result : current.result))
        ? 'COMPLETED'
        : runItems.some((current) => ['PASS', 'FAIL', 'NA'].includes(current.id === itemId ? data.result : current.result))
          ? 'IN_PROGRESS'
          : 'OPEN';

      await tx.checklistRun.update({
        where: { id: runId },
        data: { status: nextStatus }
      });

      await tx.shiftTaskAssignment.updateMany({
        where: { checklistRunId: runId, status: { not: 'CANCELLED' } },
        data: {
          status: nextStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
          completedAt: nextStatus === 'COMPLETED' ? new Date() : null
        }
      });

      return updatedItem;
    });
  }
};
