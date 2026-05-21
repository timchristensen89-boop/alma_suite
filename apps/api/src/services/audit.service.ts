import { prisma } from '@alma/db';
import {
  auditFindingInputSchema,
  auditRunCreateInputSchema,
  auditRunUpdateInputSchema,
  auditTemplateInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const CORE_AUDIT_TEMPLATES = [
  {
    name: 'Health Inspection (AU)',
    sections: [
      {
        title: 'Food Storage & Temperature',
        description: 'Cold chain, fridges, freezers, and storage hygiene.'
      },
      {
        title: 'Food Preparation',
        description: 'Cross-contamination, knife hygiene, allergen handling.'
      },
      {
        title: 'Cleaning & Sanitation',
        description: 'Cleaning schedule adherence, chemical storage, dishwasher temps.'
      },
      {
        title: 'Staff Hygiene',
        description: 'Handwashing, uniforms, illness exclusion, injury covers.'
      },
      {
        title: 'Pest Control',
        description: 'Evidence of pests, traps, recent pest reports.'
      },
      {
        title: 'Premises & Equipment',
        description: 'Condition of surfaces, equipment maintenance, lighting.'
      },
      {
        title: 'Documentation',
        description: 'Temperature logs, cleaning logs, incident log, training records.'
      }
    ]
  },
  {
    name: 'Liquor Licence Conditions Audit',
    sections: [
      {
        title: 'Licence Details & Display',
        description: 'Licence reference, venue details, approved trading hours, and staff visibility.'
      },
      {
        title: 'RSA & Refusal Controls',
        description: 'RSA currency, refusal log, incident register, patron management, and escalation.'
      },
      {
        title: 'Outdoor Seating & Footpath',
        description: 'Approved areas, furniture placement, clearances, noise, and neighbour controls.'
      },
      {
        title: 'Entertainment & Noise Conditions',
        description: 'Music restrictions, speaker placement, cut-off times, and complaint handling.'
      },
      {
        title: 'Close & Lockup Controls',
        description: 'End-of-trade controls, glass removal, intoxication management, and security notes.'
      }
    ]
  },
  {
    name: 'WHS Venue Safety Audit',
    sections: [
      {
        title: 'Slip, Trip & Fall Risks',
        description: 'Floor condition, mats, steps, lighting, outdoor areas, and spill controls.'
      },
      {
        title: 'Manual Handling & Storage',
        description: 'Stock storage, keg handling, shelving, ladders, and heavy item controls.'
      },
      {
        title: 'Plant, Equipment & Electrical',
        description: 'Equipment guards, tagged leads, damaged cables, hot surfaces, and maintenance faults.'
      },
      {
        title: 'Emergency Readiness',
        description: 'Exits, extinguishers, first aid, emergency contacts, and evacuation access.'
      },
      {
        title: 'Staff Training & Consultation',
        description: 'Inductions, toolbox notes, hazard reporting, and open corrective actions.'
      }
    ]
  },
  {
    name: 'Staff Training & Records Audit',
    sections: [
      {
        title: 'Onboarding Completion',
        description: 'Identity, tax, bank, super, venue assignment, contracts, and required uploads.'
      },
      {
        title: 'Role Compliance',
        description: 'RSA, RCG where required, food safety, first aid, and role-specific certificates.'
      },
      {
        title: 'Payroll & Xero Readiness',
        description: 'Employee details, pay rules, awards, emergency contacts, and manager approval trail.'
      },
      {
        title: 'Policy Acknowledgements',
        description: 'Code of conduct, WHS, harassment, privacy, social media, and venue policies.'
      },
      {
        title: 'Expiry & Follow-up',
        description: 'Expired documents, missing renewals, reminders, and owner assignment.'
      }
    ]
  },
  {
    name: 'Stock Control & Storage Audit',
    sections: [
      {
        title: 'Receiving & Invoice Control',
        description: 'Supplier deliveries, invoice match, credits, and damaged or missing items.'
      },
      {
        title: 'Storage & Rotation',
        description: 'FIFO, labels, storage locations, high-value stock, and temperature-sensitive stock.'
      },
      {
        title: 'Stocktake Discipline',
        description: 'Recent counts, variance review, unmapped items, and manager sign-off.'
      },
      {
        title: 'Waste & Transfer Records',
        description: 'Wastage, staff meals, transfers between venues, and adjustment evidence.'
      },
      {
        title: 'COGS Risk Review',
        description: 'High variance categories, recipe usage, supplier price changes, and margin risks.'
      }
    ]
  }
];

async function ensureCoreAuditTemplates() {
  await Promise.all(
    CORE_AUDIT_TEMPLATES.map(async (template) => {
      const existing = await prisma.auditTemplate.findFirst({
        where: { name: template.name }
      });
      if (existing) return;

      await prisma.auditTemplate.create({
        data: {
          name: template.name,
          sections: {
            create: template.sections.map((section, index) => ({
              title: section.title,
              description: section.description,
              position: index
            }))
          }
        }
      });
    })
  );
}

export const auditService = {
  async listTemplates() {
    await ensureCoreAuditTemplates();
    return prisma.auditTemplate.findMany({
      orderBy: [{ name: 'asc' }],
      include: { sections: { orderBy: [{ position: 'asc' }] } }
    });
  },

  async getTemplate(id: string) {
    const template = await prisma.auditTemplate.findUnique({
      where: { id },
      include: { sections: { orderBy: [{ position: 'asc' }] } }
    });
    if (!template) throw new HttpError(404, 'Audit template not found');
    return template;
  },

  async createTemplate(input: unknown) {
    const data = auditTemplateInputSchema.parse(input);
    return prisma.auditTemplate.create({
      data: {
        name: data.name,
        sections: {
          create: data.sections.map((section, index) => ({
            title: section.title,
            description: section.description || null,
            position: section.position ?? index
          }))
        }
      },
      include: { sections: { orderBy: [{ position: 'asc' }] } }
    });
  },

  async updateTemplate(id: string, input: unknown) {
    const data = auditTemplateInputSchema.parse(input);
    const existing = await this.getTemplate(id);

    return prisma.$transaction(async (tx) => {
      await tx.auditTemplate.update({
        where: { id: existing.id },
        data: { name: data.name }
      });

      await tx.auditTemplateSection.deleteMany({
        where: { templateId: existing.id }
      });

      await tx.auditTemplateSection.createMany({
        data: data.sections.map((section, index) => ({
          templateId: existing.id,
          title: section.title,
          description: section.description || null,
          position: section.position ?? index
        }))
      });

      return tx.auditTemplate.findUnique({
        where: { id: existing.id },
        include: { sections: { orderBy: [{ position: 'asc' }] } }
      });
    });
  },

  async deleteTemplate(id: string) {
    await this.getTemplate(id);
    const runCount = await prisma.auditRun.count({ where: { templateId: id } });
    if (runCount > 0) {
      throw new HttpError(409, 'Cannot delete a template that has audit runs.');
    }
    await prisma.auditTemplate.delete({ where: { id } });
    return { ok: true };
  },

  async listRuns() {
    await ensureCoreAuditTemplates();
    return prisma.auditRun.findMany({
      orderBy: [{ runDate: 'desc' }],
      include: {
        template: { include: { sections: { orderBy: [{ position: 'asc' }] } } },
        findings: { include: { linkedIssue: true } }
      }
    });
  },

  async getRunById(id: string) {
    const run = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        template: { include: { sections: { orderBy: [{ position: 'asc' }] } } },
        findings: { include: { linkedIssue: true } }
      }
    });
    if (!run) throw new HttpError(404, 'Audit run not found');
    return run;
  },

  async createRun(input: unknown) {
    const data = auditRunCreateInputSchema.parse(input);
    const template = await this.getTemplate(data.templateId);

    return prisma.auditRun.create({
      data: {
        templateId: template.id,
        title: data.title,
        summary: data.summary || null,
        score: data.score ?? null,
        findings: data.findings?.length
          ? {
              create: data.findings.map((finding) => ({
                sectionTitle: finding.sectionTitle,
                finding: finding.finding,
                score: finding.score ?? null
              }))
            }
          : undefined
      },
      include: {
        template: { include: { sections: { orderBy: [{ position: 'asc' }] } } },
        findings: { include: { linkedIssue: true } }
      }
    });
  },

  async updateRun(id: string, input: unknown) {
    await this.getRunById(id);
    const data = auditRunUpdateInputSchema.parse(input);
    const patch: Record<string, unknown> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.summary !== undefined) patch.summary = data.summary || null;
    if (data.score !== undefined) patch.score = data.score;
    return prisma.auditRun.update({
      where: { id },
      data: patch,
      include: {
        template: { include: { sections: { orderBy: [{ position: 'asc' }] } } },
        findings: { include: { linkedIssue: true } }
      }
    });
  },

  async addFinding(runId: string, input: unknown) {
    const run = await this.getRunById(runId);
    const data = auditFindingInputSchema.parse(input);

    return prisma.$transaction(async (tx) => {
      let linkedIssueId: string | null = null;

      if (data.createIssue) {
        const issue = await tx.issue.create({
          data: {
            title: `${run.title}: ${data.sectionTitle}`,
            description: data.finding,
            severity: 'MEDIUM',
            category: 'Audit finding',
            status: 'OPEN',
            notes: `Created from audit ${run.title}.`,
            activities: {
              create: {
                action: 'created',
                message: 'Issue created from audit finding.',
                actor: 'system'
              }
            }
          }
        });
        linkedIssueId = issue.id;
      }

      return tx.auditFinding.create({
        data: {
          auditRunId: runId,
          sectionTitle: data.sectionTitle,
          finding: data.finding,
          score: data.score ?? null,
          linkedIssueId
        },
        include: { linkedIssue: true }
      });
    });
  },

  /**
   * Turn an existing audit finding into a linked Issue. Idempotent — if the
   * finding already has a linkedIssueId, the existing issue is returned and
   * no duplicate is created.
   */
  async convertFindingToIssue(runId: string, findingId: string, actor = 'system') {
    const run = await this.getRunById(runId);
    const finding = run.findings.find((f) => f.id === findingId);
    if (!finding) throw new HttpError(404, 'Finding not found');
    if (finding.linkedIssue) return finding.linkedIssue;

    const severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' =
      finding.score === null || finding.score === undefined
        ? 'MEDIUM'
        : finding.score < 50
          ? 'HIGH'
          : finding.score < 75
            ? 'MEDIUM'
            : 'LOW';

    return prisma.$transaction(async (tx) => {
      const issue = await tx.issue.create({
        data: {
          title: `${run.title}: ${finding.sectionTitle}`,
          description: finding.finding,
          severity,
          category: 'Audit finding',
          status: 'OPEN',
          notes: `Created from audit "${run.title}" (${run.runDate.toISOString().slice(0, 10)}).`,
          activities: {
            create: {
              action: 'created',
              message: `Issue created from audit finding in "${run.title}".`,
              actor
            }
          }
        }
      });

      await tx.auditFinding.update({
        where: { id: findingId },
        data: { linkedIssueId: issue.id }
      });

      return issue;
    });
  },

  async summary() {
    await ensureCoreAuditTemplates();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalRuns, thisMonth, runs, openFindings] = await Promise.all([
      prisma.auditRun.count(),
      prisma.auditRun.count({ where: { runDate: { gte: monthStart } } }),
      prisma.auditRun.findMany({ where: { score: { not: null } }, select: { score: true } }),
      prisma.auditFinding.count({
        where: {
          OR: [
            { linkedIssueId: null },
            { linkedIssue: { status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] } } }
          ]
        }
      })
    ]);

    const scored = runs.filter((r) => typeof r.score === 'number') as { score: number }[];
    const averageScore =
      scored.length === 0
        ? null
        : Math.round((scored.reduce((sum, r) => sum + r.score, 0) / scored.length) * 10) / 10;

    return { totalRuns, thisMonth, averageScore, openFindings };
  }
};
