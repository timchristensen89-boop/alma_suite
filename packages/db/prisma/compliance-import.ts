import { Prisma } from '@prisma/client';
import { prisma } from '../src/prisma.js';

export type JsonRecord = Record<string, unknown>;

export type ImportMode = 'merge' | 'replace';

export type ImportPayload = {
  issues?: unknown[];
  incidents?: unknown[];
  checklistTemplates?: unknown[];
  checklistRuns?: unknown[];
  auditTemplates?: unknown[];
  auditRuns?: unknown[];
};

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function nullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized ? normalized : null;
}

export function cleanImportedChecklistAuditText(value: unknown): string | null {
  const normalized = nullableString(value);
  if (!normalized) return null;

  const cleaned = normalized
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/legacy:\/\/\S+/gi, '')
    .replace(/Imported from alma_compliance_v14 audit_runs with status ([^.]+)\./gi, 'Legacy audit status: $1.')
    .replace(/\bSource:\s*[^.]+(?:\.[a-z0-9_-]+)?\.\s*/gi, '')
    .replace(/\bImported\s+(?:directly\s+)?from\s+[^.]+(?:\.[a-z0-9_-]+)?[^.]*\.\s*/gi, '')
    .replace(/\bActive operating checklist\.\s*/gi, '')
    .replace(/\s+\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned && cleaned !== '.' ? cleaned : null;
}

export function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeIssueSeverity(value: unknown): Prisma.IssueSeverity {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'LOW':
    case 'MEDIUM':
    case 'HIGH':
    case 'CRITICAL':
      return normalized;
    default:
      return 'MEDIUM';
  }
}

export function normalizeIssueStatus(value: unknown): Prisma.IssueStatus {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'OPEN':
    case 'IN_PROGRESS':
    case 'BLOCKED':
    case 'RESOLVED':
    case 'CLOSED':
      return normalized;
    default:
      return 'OPEN';
  }
}

export function normalizeChecklistRunStatus(value: unknown): Prisma.ChecklistRunStatus {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'OPEN':
    case 'IN_PROGRESS':
    case 'COMPLETED':
      return normalized;
    default:
      return 'OPEN';
  }
}

export function normalizeChecklistItemResult(value: unknown): Prisma.ChecklistItemResult {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'PENDING':
    case 'PASS':
    case 'FAIL':
    case 'NA':
      return normalized;
    default:
      return 'PENDING';
  }
}

function issueLegacyId(record: JsonRecord, fallbackPrefix: string, index: number): string {
  return (
    nullableString(record.legacyId) ??
    nullableString(record.id) ??
    nullableString(record.issueId) ??
    `${fallbackPrefix}-${index + 1}`
  );
}

export async function resetComplianceData() {
  await prisma.auditFinding.deleteMany();
  await prisma.auditRun.deleteMany();
  await prisma.auditTemplateSection.deleteMany();
  await prisma.auditTemplate.deleteMany();
  await prisma.checklistItem.deleteMany();
  await prisma.checklistRun.deleteMany();
  await prisma.checklistItemTemplate.deleteMany();
  await prisma.checklistTemplate.deleteMany();
  await prisma.issueActivity.deleteMany();
  await prisma.issueEvidence.deleteMany();
  await prisma.issue.deleteMany();
}

async function importIssues(items: unknown[]) {
  const issueIdByLegacyId = new Map<string, string>();

  for (const [index, rawIssue] of items.entries()) {
    const issue = asRecord(rawIssue);

    if (!issue) {
      continue;
    }

    const legacyId = issueLegacyId(issue, 'issue', index);
    const title = asString(issue.title, `Imported issue ${index + 1}`);
    const description = asString(issue.description, title);
    const evidence = asArray(issue.evidence)
      .map((entry, evidenceIndex) => {
        const record = asRecord(entry);

        if (!record) {
          return null;
        }

        return {
          legacyId:
            nullableString(record.legacyId) ??
            nullableString(record.id) ??
            `${legacyId}:evidence:${evidenceIndex + 1}`,
          name: asString(record.name, `Evidence ${evidenceIndex + 1}`),
          url: asString(record.url, 'about:blank'),
          fileType: nullableString(record.fileType ?? record.type)
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const activities = asArray(issue.activities)
      .map((entry, activityIndex) => {
        const record = asRecord(entry);

        if (!record) {
          return null;
        }

        return {
          legacyId:
            nullableString(record.legacyId) ??
            nullableString(record.id) ??
            `${legacyId}:activity:${activityIndex + 1}`,
          action: asString(record.action, 'imported'),
          message: asString(record.message, 'Imported from legacy Alma Control data.'),
          actor: asString(record.actor, 'migration'),
          createdAt: asDate(record.createdAt)
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    const upserted = await prisma.issue.upsert({
      where: { legacyId },
      update: {
        title,
        description,
        severity: normalizeIssueSeverity(issue.severity),
        category: asString(issue.category, 'Imported'),
        status: normalizeIssueStatus(issue.status),
        assignee: nullableString(issue.assignee),
        dueDate: asDate(issue.dueDate),
        notes: nullableString(issue.notes),
        resolutionNotes: nullableString(issue.resolutionNotes),
        evidence: {
          deleteMany: {}
        },
        activities: {
          deleteMany: {}
        }
      },
      create: {
        legacyId,
        title,
        description,
        severity: normalizeIssueSeverity(issue.severity),
        category: asString(issue.category, 'Imported'),
        status: normalizeIssueStatus(issue.status),
        assignee: nullableString(issue.assignee),
        dueDate: asDate(issue.dueDate),
        notes: nullableString(issue.notes),
        resolutionNotes: nullableString(issue.resolutionNotes)
      }
    });

    if (evidence.length) {
      await prisma.issueEvidence.createMany({
        data: evidence.map((entry) => ({
          legacyId: entry.legacyId,
          issueId: upserted.id,
          name: entry.name,
          url: entry.url,
          fileType: entry.fileType
        })),
        skipDuplicates: true
      });
    }

    if (activities.length) {
      await prisma.issueActivity.createMany({
        data: activities.map((entry) => ({
          legacyId: entry.legacyId,
          issueId: upserted.id,
          action: entry.action,
          message: entry.message,
          actor: entry.actor,
          createdAt: entry.createdAt ?? undefined
        })),
        skipDuplicates: true
      });
    }

    issueIdByLegacyId.set(legacyId, upserted.id);
  }

  return issueIdByLegacyId;
}

async function importChecklistTemplates(items: unknown[]) {
  const templateIdByLegacyId = new Map<string, string>();

  for (const [index, rawTemplate] of items.entries()) {
    const template = asRecord(rawTemplate);

    if (!template) {
      continue;
    }

    const legacyId =
      nullableString(template.legacyId) ??
      nullableString(template.id) ??
      `checklist-template-${index + 1}`;

    const upserted = await prisma.checklistTemplate.upsert({
      where: { legacyId },
      update: {
        name: asString(template.name, `Imported checklist ${index + 1}`),
        area: nullableString(template.area),
        items: {
          deleteMany: {}
        }
      },
      create: {
        legacyId,
        name: asString(template.name, `Imported checklist ${index + 1}`),
        area: nullableString(template.area)
      }
    });

    const itemInputs = asArray(template.items).flatMap((rawItem, itemIndex) => {
      const item = asRecord(rawItem);

      if (!item) {
        return [];
      }

      return [
        {
          legacyId:
            nullableString(item.legacyId) ??
            nullableString(item.id) ??
            `${legacyId}:item:${itemIndex + 1}`,
          templateId: upserted.id,
          label: asString(item.label, `Item ${itemIndex + 1}`),
          description: cleanImportedChecklistAuditText(item.description),
          position: asNumber(item.position) ?? itemIndex + 1
        }
      ];
    });

    if (itemInputs.length) {
      await prisma.checklistItemTemplate.createMany({
        data: itemInputs,
        skipDuplicates: true
      });
    }

    templateIdByLegacyId.set(legacyId, upserted.id);
  }

  return templateIdByLegacyId;
}

async function importChecklistRuns(items: unknown[], issueIdByLegacyId: Map<string, string>, templateIdByLegacyId: Map<string, string>) {
  for (const [index, rawRun] of items.entries()) {
    const run = asRecord(rawRun);

    if (!run) {
      continue;
    }

    const legacyId =
      nullableString(run.legacyId) ??
      nullableString(run.id) ??
      `checklist-run-${index + 1}`;
    const templateLegacyId =
      nullableString(run.templateLegacyId) ??
      nullableString(run.templateId);
    const templateId = templateLegacyId ? templateIdByLegacyId.get(templateLegacyId) : null;

    if (!templateId) {
      continue;
    }

    const upserted = await prisma.checklistRun.upsert({
      where: { legacyId },
      update: {
        templateId,
        runDate: asDate(run.runDate) ?? new Date(),
        status: normalizeChecklistRunStatus(run.status),
        area: nullableString(run.area),
        performedBy: nullableString(run.performedBy),
        notes: cleanImportedChecklistAuditText(run.notes),
        items: {
          deleteMany: {}
        }
      },
      create: {
        legacyId,
        templateId,
        runDate: asDate(run.runDate) ?? new Date(),
        status: normalizeChecklistRunStatus(run.status),
        area: nullableString(run.area),
        performedBy: nullableString(run.performedBy),
        notes: cleanImportedChecklistAuditText(run.notes)
      }
    });

    const itemInputs = asArray(run.items).flatMap((rawItem, itemIndex) => {
      const item = asRecord(rawItem);

      if (!item) {
        return [];
      }

      const linkedIssueLegacyId =
        nullableString(item.linkedIssueLegacyId) ??
        nullableString(item.linkedIssueId);

      return [
        {
          legacyId:
            nullableString(item.legacyId) ??
            nullableString(item.id) ??
            `${legacyId}:item:${itemIndex + 1}`,
          runId: upserted.id,
          templateItemId: null,
          label: asString(item.label, `Checklist item ${itemIndex + 1}`),
          description: cleanImportedChecklistAuditText(item.description),
          position: asNumber(item.position) ?? itemIndex + 1,
          result: normalizeChecklistItemResult(item.result),
          notes: cleanImportedChecklistAuditText(item.notes),
          linkedIssueId: linkedIssueLegacyId ? issueIdByLegacyId.get(linkedIssueLegacyId) ?? null : null
        }
      ];
    });

    if (itemInputs.length) {
      await prisma.checklistItem.createMany({
        data: itemInputs,
        skipDuplicates: true
      });
    }
  }
}

async function importAuditTemplates(items: unknown[]) {
  const templateIdByLegacyId = new Map<string, string>();

  for (const [index, rawTemplate] of items.entries()) {
    const template = asRecord(rawTemplate);

    if (!template) {
      continue;
    }

    const legacyId =
      nullableString(template.legacyId) ??
      nullableString(template.id) ??
      `audit-template-${index + 1}`;

    const upserted = await prisma.auditTemplate.upsert({
      where: { legacyId },
      update: {
        name: asString(template.name, `Imported audit ${index + 1}`),
        sections: {
          deleteMany: {}
        }
      },
      create: {
        legacyId,
        name: asString(template.name, `Imported audit ${index + 1}`)
      }
    });

    const sectionInputs = asArray(template.sections).flatMap((rawSection, sectionIndex) => {
      const section = asRecord(rawSection);

      if (!section) {
        return [];
      }

      return [
        {
          legacyId:
            nullableString(section.legacyId) ??
            nullableString(section.id) ??
            `${legacyId}:section:${sectionIndex + 1}`,
          templateId: upserted.id,
          title: asString(section.title, `Section ${sectionIndex + 1}`),
          description: cleanImportedChecklistAuditText(section.description),
          position: asNumber(section.position) ?? sectionIndex + 1
        }
      ];
    });

    if (sectionInputs.length) {
      await prisma.auditTemplateSection.createMany({
        data: sectionInputs,
        skipDuplicates: true
      });
    }

    templateIdByLegacyId.set(legacyId, upserted.id);
  }

  return templateIdByLegacyId;
}

async function importAuditRuns(items: unknown[], issueIdByLegacyId: Map<string, string>, templateIdByLegacyId: Map<string, string>) {
  for (const [index, rawRun] of items.entries()) {
    const run = asRecord(rawRun);

    if (!run) {
      continue;
    }

    const legacyId =
      nullableString(run.legacyId) ??
      nullableString(run.id) ??
      `audit-run-${index + 1}`;
    const templateLegacyId =
      nullableString(run.templateLegacyId) ??
      nullableString(run.templateId);
    const templateId = templateLegacyId ? templateIdByLegacyId.get(templateLegacyId) : null;

    if (!templateId) {
      continue;
    }

    const upserted = await prisma.auditRun.upsert({
      where: { legacyId },
      update: {
        templateId,
        title: asString(run.title, `Imported audit run ${index + 1}`),
        score: asNumber(run.score),
        summary: cleanImportedChecklistAuditText(run.summary),
        runDate: asDate(run.runDate) ?? new Date(),
        findings: {
          deleteMany: {}
        }
      },
      create: {
        legacyId,
        templateId,
        title: asString(run.title, `Imported audit run ${index + 1}`),
        score: asNumber(run.score),
        summary: cleanImportedChecklistAuditText(run.summary),
        runDate: asDate(run.runDate) ?? new Date()
      }
    });

    const findingInputs = asArray(run.findings).flatMap((rawFinding, findingIndex) => {
      const finding = asRecord(rawFinding);

      if (!finding) {
        return [];
      }

      const linkedIssueLegacyId =
        nullableString(finding.linkedIssueLegacyId) ??
        nullableString(finding.linkedIssueId);

      return [
        {
          legacyId:
            nullableString(finding.legacyId) ??
            nullableString(finding.id) ??
            `${legacyId}:finding:${findingIndex + 1}`,
          auditRunId: upserted.id,
          sectionTitle: asString(finding.sectionTitle, `Section ${findingIndex + 1}`),
          finding: cleanImportedChecklistAuditText(finding.finding) ?? 'Audit finding',
          score: asNumber(finding.score),
          linkedIssueId: linkedIssueLegacyId ? issueIdByLegacyId.get(linkedIssueLegacyId) ?? null : null
        }
      ];
    });

    if (findingInputs.length) {
      await prisma.auditFinding.createMany({
        data: findingInputs,
        skipDuplicates: true
      });
    }
  }
}

export async function importCompliancePayload(payload: ImportPayload, mode: ImportMode) {
  if (mode === 'replace') {
    await resetComplianceData();
  }

  const issues = [...asArray(payload.issues), ...asArray(payload.incidents)];
  const checklistTemplates = asArray(payload.checklistTemplates);
  const checklistRuns = asArray(payload.checklistRuns);
  const auditTemplates = asArray(payload.auditTemplates);
  const auditRuns = asArray(payload.auditRuns);

  const issueIdByLegacyId = await importIssues(issues);
  const checklistTemplateIdByLegacyId = await importChecklistTemplates(checklistTemplates);
  await importChecklistRuns(checklistRuns, issueIdByLegacyId, checklistTemplateIdByLegacyId);
  const auditTemplateIdByLegacyId = await importAuditTemplates(auditTemplates);
  await importAuditRuns(auditRuns, issueIdByLegacyId, auditTemplateIdByLegacyId);

  return {
    imported: {
      issues: issues.length,
      checklistTemplates: checklistTemplates.length,
      checklistRuns: checklistRuns.length,
      auditTemplates: auditTemplates.length,
      auditRuns: auditRuns.length
    }
  };
}
