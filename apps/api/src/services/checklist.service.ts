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
      `${description} Source: ${template.sourceFile}. ${
        template.reviewStatus === 'active'
          ? 'Imported from current operating spreadsheet.'
          : 'Needs manager review before active use.'
      }`
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

      return updatedItem;
    });
  }
};
