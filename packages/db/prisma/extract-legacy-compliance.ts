import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { prisma } from '../src/prisma.js';
import { importCompliancePayload, type ImportMode, type ImportPayload } from './compliance-import.js';

const execFileAsync = promisify(execFile);

type ExtractArgs = {
  mode: ImportMode;
  sourceUrl: string;
};

type SourceIssueRow = {
  id: string;
  title: string;
  type: string | null;
  severity: string | null;
  status: string | null;
  owner: string | null;
  due_date: string | null;
  venue: string | null;
  created_at: string | null;
};

type SourceIncidentRow = {
  id: string;
  title: string;
  severity: string | null;
  occurred_at: string | null;
  status: string | null;
  created_at: string | null;
};

type SourceChecklistTemplateRow = {
  id: string;
  name: string;
  checklist_type: string | null;
  area: string | null;
  status: string | null;
  created_at: string | null;
};

type SourceChecklistRunRow = {
  id: string;
  name: string;
  area: string | null;
  status: string | null;
  due_at: string | null;
  assigned_to: string | null;
  created_at: string | null;
};

type SourceAuditRunRow = {
  id: string;
  title: string;
  score: number | null;
  status: string | null;
  completed_at: string | null;
  created_at: string | null;
};

type SourceDocumentRow = {
  id: string;
  file_name: string;
  linked_record_type: string | null;
  linked_record_id: string | null;
  created_at: string | null;
};

function parseArgs(argv: string[]): ExtractArgs {
  let mode: ImportMode = 'merge';
  let sourceUrl =
    process.env.LEGACY_COMPLIANCE_DATABASE_URL ??
    'postgresql://timothychristensen@localhost:5432/alma_compliance_v14';

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--replace') {
      mode = 'replace';
      continue;
    }

    if (current === '--source-url') {
      sourceUrl = argv[index + 1] ?? sourceUrl;
      index += 1;
    }
  }

  return { mode, sourceUrl };
}

async function runSourceQuery<T>(sourceUrl: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    'psql',
    [sourceUrl, '-X', '-t', '-A', '-c', `select coalesce(json_agg(row_to_json(t)), '[]'::json)::text from (${sql}) t`],
    { maxBuffer: 1024 * 1024 * 8 },
  );

  const raw = stdout.trim() || '[]';
  return JSON.parse(raw) as T[];
}

function normalizeLegacyIssueStatus(status: string | null): string {
  const normalized = (status ?? '').toLowerCase();

  switch (normalized) {
    case 'open':
      return 'OPEN';
    case 'in_progress':
    case 'in progress':
      return 'IN_PROGRESS';
    case 'blocked':
      return 'BLOCKED';
    case 'resolved':
      return 'RESOLVED';
    case 'closed':
      return 'CLOSED';
    default:
      return 'OPEN';
  }
}

function normalizeLegacyIssueSeverity(severity: string | null): string {
  const normalized = (severity ?? '').toLowerCase();

  switch (normalized) {
    case 'low':
      return 'LOW';
    case 'medium':
      return 'MEDIUM';
    case 'high':
      return 'HIGH';
    case 'critical':
      return 'CRITICAL';
    default:
      return 'MEDIUM';
  }
}

function normalizeLegacyChecklistRunStatus(status: string | null): string {
  const normalized = (status ?? '').toLowerCase();

  switch (normalized) {
    case 'completed':
    case 'complete':
      return 'COMPLETED';
    case 'in_progress':
    case 'in progress':
      return 'IN_PROGRESS';
    default:
      return 'OPEN';
  }
}

function normalizeLegacyChecklistItemResult(status: string | null): string {
  const normalized = (status ?? '').toLowerCase();

  switch (normalized) {
    case 'completed':
    case 'complete':
      return 'PASS';
    case 'failed':
    case 'missed':
    case 'overdue':
      return 'FAIL';
    case 'na':
      return 'NA';
    default:
      return 'PENDING';
  }
}

function normalizeLegacyAuditStatus(status: string | null): string {
  const normalized = (status ?? '').toLowerCase();

  if (normalized === 'completed' || normalized === 'complete') {
    return 'completed';
  }

  if (normalized === 'in_progress' || normalized === 'in progress') {
    return 'in_progress';
  }

  return 'open';
}

function toIssueDescription(row: SourceIssueRow) {
  const parts = [
    'Imported directly from alma_compliance_v14.',
    row.type ? `Legacy type: ${row.type}.` : null,
    row.venue ? `Venue: ${row.venue}.` : null,
    row.owner ? `Legacy owner: ${row.owner}.` : null
  ].filter(Boolean);

  return parts.join(' ');
}

function toIncidentDescription(row: SourceIncidentRow) {
  const parts = [
    'Imported directly from alma_compliance_v14 incidents.',
    row.occurred_at ? `Occurred at: ${row.occurred_at}.` : null
  ].filter(Boolean);

  return parts.join(' ');
}

function buildPayload(input: {
  issues: SourceIssueRow[];
  incidents: SourceIncidentRow[];
  checklistTemplates: SourceChecklistTemplateRow[];
  checklistRuns: SourceChecklistRunRow[];
  auditRuns: SourceAuditRunRow[];
  documents: SourceDocumentRow[];
}): ImportPayload {
  const templateByName = new Map(
    input.checklistTemplates.map((template) => [template.name.trim().toLowerCase(), template]),
  );

  const documentsByRecord = new Map<string, SourceDocumentRow[]>();
  for (const document of input.documents) {
    if (!document.linked_record_id) {
      continue;
    }

    const key = `${document.linked_record_type ?? 'unknown'}:${document.linked_record_id}`;
    const existing = documentsByRecord.get(key) ?? [];
    existing.push(document);
    documentsByRecord.set(key, existing);
  }

  const issues = input.issues.map((row) => {
    const linkedDocuments = documentsByRecord.get(`issue:${row.id}`) ?? documentsByRecord.get(`issues:${row.id}`) ?? [];

    return {
      legacyId: `v14:issue:${row.id}`,
      title: row.title,
      description: toIssueDescription(row),
      severity: normalizeLegacyIssueSeverity(row.severity),
      category: row.type ?? 'Imported',
      status: normalizeLegacyIssueStatus(row.status),
      assignee: row.owner,
      dueDate: row.due_date,
      notes: row.venue ? `Legacy venue: ${row.venue}` : 'Imported from alma_compliance_v14 issues.',
      evidence: linkedDocuments.map((document) => ({
        legacyId: `v14:document:${document.id}`,
        name: document.file_name,
        url: `legacy://alma_compliance_v14/documents/${document.id}`,
        fileType: 'legacy_document'
      })),
      activities: [
        {
          legacyId: `v14:issue:${row.id}:created`,
          action: 'imported',
          message: 'Imported directly from alma_compliance_v14 issues.',
          actor: 'migration',
          createdAt: row.created_at
        }
      ]
    };
  });

  const incidents = input.incidents.map((row) => {
    const linkedDocuments =
      documentsByRecord.get(`incident:${row.id}`) ??
      documentsByRecord.get(`incidents:${row.id}`) ??
      [];

    return {
      legacyId: `v14:incident:${row.id}`,
      title: `[Incident] ${row.title}`,
      description: toIncidentDescription(row),
      severity: normalizeLegacyIssueSeverity(row.severity),
      category: 'Incident',
      status: normalizeLegacyIssueStatus(row.status),
      assignee: null,
      dueDate: null,
      notes: row.occurred_at ? `Occurred at ${row.occurred_at}` : 'Imported incident record.',
      evidence: linkedDocuments.map((document) => ({
        legacyId: `v14:document:${document.id}`,
        name: document.file_name,
        url: `legacy://alma_compliance_v14/documents/${document.id}`,
        fileType: 'legacy_document'
      })),
      activities: [
        {
          legacyId: `v14:incident:${row.id}:created`,
          action: 'imported',
          message: 'Imported directly from alma_compliance_v14 incidents.',
          actor: 'migration',
          createdAt: row.created_at ?? row.occurred_at
        }
      ]
    };
  });

  const checklistTemplates = input.checklistTemplates.map((row) => ({
    legacyId: `v14:checklist-template:${row.id}`,
    name: row.name,
    area: row.area,
    items: [
      {
        legacyId: `v14:checklist-template:${row.id}:item:1`,
        label: `Complete ${row.name}`,
        description: row.checklist_type
          ? `Legacy checklist type: ${row.checklist_type}. Imported from alma_compliance_v14.`
          : 'Imported from alma_compliance_v14.',
        position: 1
      }
    ]
  }));

  const checklistRuns = input.checklistRuns.map((row) => {
    const matchingTemplate = templateByName.get(row.name.trim().toLowerCase());
    const templateLegacyId = matchingTemplate
      ? `v14:checklist-template:${matchingTemplate.id}`
      : `v14:checklist-template:synthetic:${row.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    return {
      legacyId: `v14:checklist-run:${row.id}`,
      templateLegacyId,
      runDate: row.due_at ?? row.created_at,
      status: normalizeLegacyChecklistRunStatus(row.status),
      area: row.area,
      performedBy: row.assigned_to,
      notes: 'Imported directly from alma_compliance_v14 checklist_runs.',
      items: [
        {
          legacyId: `v14:checklist-run:${row.id}:item:1`,
          label: `Complete ${row.name}`,
          description: 'Synthetic checklist item generated during direct extraction.',
          position: 1,
          result: normalizeLegacyChecklistItemResult(row.status),
          notes: row.assigned_to ? `Legacy assignee: ${row.assigned_to}` : null
        }
      ]
    };
  });

  const syntheticAuditTemplates = Array.from(
    new Map(
      input.auditRuns.map((row) => {
        const key = row.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return [
          key,
          {
            legacyId: `v14:audit-template:${key}`,
            name: row.title,
            sections: [
              {
                legacyId: `v14:audit-template:${key}:section:1`,
                title: 'Legacy audit summary',
                description: 'Synthetic section generated from alma_compliance_v14 audit_runs.',
                position: 1
              }
            ]
          }
        ];
      }),
    ).values(),
  );

  const auditRuns = input.auditRuns.map((row) => {
    const key = row.title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');

    return {
      legacyId: `v14:audit-run:${row.id}`,
      templateLegacyId: `v14:audit-template:${key}`,
      title: row.title,
      score: row.score,
      summary: `Imported from alma_compliance_v14 audit_runs with status ${normalizeLegacyAuditStatus(row.status)}.`,
      runDate: row.completed_at ?? row.created_at,
      findings: [
        {
          legacyId: `v14:audit-run:${row.id}:finding:1`,
          sectionTitle: 'Legacy audit summary',
          finding: `Legacy audit status: ${row.status ?? 'unknown'}.`,
          score: row.score
        }
      ]
    };
  });

  return {
    issues,
    incidents,
    checklistTemplates,
    checklistRuns,
    auditTemplates: syntheticAuditTemplates,
    auditRuns
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const [issues, incidents, checklistTemplates, checklistRuns, auditRuns, documents] = await Promise.all([
    runSourceQuery<SourceIssueRow>(
      args.sourceUrl,
      'select id, title, type, severity, status, owner, due_date, venue, created_at from issues order by created_at asc',
    ),
    runSourceQuery<SourceIncidentRow>(
      args.sourceUrl,
      'select id, title, severity, occurred_at, status, created_at from incidents order by created_at asc',
    ),
    runSourceQuery<SourceChecklistTemplateRow>(
      args.sourceUrl,
      'select id, name, checklist_type, area, status, created_at from checklist_templates order by created_at asc',
    ),
    runSourceQuery<SourceChecklistRunRow>(
      args.sourceUrl,
      'select id, name, area, status, due_at, assigned_to, created_at from checklist_runs order by created_at asc',
    ),
    runSourceQuery<SourceAuditRunRow>(
      args.sourceUrl,
      'select id, title, score, status, completed_at, created_at from audit_runs order by created_at asc',
    ),
    runSourceQuery<SourceDocumentRow>(
      args.sourceUrl,
      'select id, file_name, linked_record_type, linked_record_id, created_at from documents order by created_at asc',
    )
  ]);

  const payload = buildPayload({
    issues,
    incidents,
    checklistTemplates,
    checklistRuns,
    auditRuns,
    documents
  });

  const result = await importCompliancePayload(payload, args.mode);

  console.log(
    JSON.stringify(
      {
        sourceUrl: args.sourceUrl,
        mode: args.mode,
        extracted: {
          issues: issues.length,
          incidents: incidents.length,
          checklistTemplates: checklistTemplates.length,
          checklistRuns: checklistRuns.length,
          auditRuns: auditRuns.length,
          documents: documents.length
        },
        imported: result.imported
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
