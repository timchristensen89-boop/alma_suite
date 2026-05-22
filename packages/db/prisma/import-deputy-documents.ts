import fs from 'node:fs/promises';
import path from 'node:path';
import type { StaffComplianceRecord, StaffProfile } from '@prisma/client';
import { prisma } from '../src/prisma.js';

type StaffReportRow = {
  row: number;
  deputyName: string;
  email: string | null;
  match: string;
  staffProfileId: string | null;
  staffName: string | null;
};

type StaffReport = {
  source: string;
  applied: boolean;
  rows: StaffReportRow[];
};

type KnownDocument = {
  basename: string;
  staffName: string;
  title: string;
  issueDate?: string;
  certificateNumber?: string;
  evidence: string;
};

type DocumentResult = {
  file: string;
  basename: string;
  action:
    | 'would_attach'
    | 'attached'
    | 'would_update_existing'
    | 'updated_existing'
    | 'already_attached'
    | 'skipped_generic'
    | 'skipped_uncertain'
    | 'skipped_unrecognised'
    | 'skipped_missing_file'
    | 'skipped_duplicate_filename'
    | 'skipped_staff_not_found'
    | 'skipped_staff_ambiguous';
  reason: string;
  staffProfileId?: string;
  staffName?: string;
  recordId?: string;
  targetModel?: 'StaffComplianceRecord';
};

type ImportReport = {
  staffReportPath: string;
  documentsDir: string;
  applied: boolean;
  filesScanned: number;
  wouldAttach: number;
  wouldUpdateExisting: number;
  attached: number;
  updatedExisting: number;
  alreadyAttached: number;
  skipped: number;
  results: DocumentResult[];
  reportPath: string;
};

const DEFAULT_STAFF_REPORT = '/tmp/alma-deputy-employee-sync-prod-applied.json';
const DEFAULT_REPORT = '/tmp/alma-deputy-documents-report.json';
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const MAX_DATA_URL_BYTES = 5_700_000;

const KNOWN_RSA_DOCUMENTS: KnownDocument[] = [
  {
    basename: 'RSA Certificate (3).pdf',
    staffName: 'Jordan Haworth',
    title: 'RSA Certificate',
    issueDate: '2025-09-26',
    evidence: 'PDF text matched Jordan Brae Haworth.'
  },
  {
    basename: 'RSA Certificate (4).pdf',
    staffName: 'Sierra Hutchinson',
    title: 'RSA Certificate',
    issueDate: '2024-02-07',
    certificateNumber: '392583',
    evidence: 'PDF text matched Sierra Hutchinson.'
  },
  {
    basename: 'RSA Certificate.pdf',
    staffName: 'Aja Verdouw',
    title: 'RSA Certificate',
    issueDate: '2025-10-16',
    certificateNumber: '10002023009',
    evidence: 'PDF text matched Verdouw, Aja.'
  }
];

const UNCERTAIN_RSA_BASENAMES = new Set([
  'RSA Certificate (1).pdf',
  'RSA Certificate (1).jpeg',
  'RSA Certificate (1).png',
  'RSA Certificate (2).pdf',
  'RSA Certificate (2).png',
  'RSA Certificate (3).png',
  'RSA Certificate (4).png',
  'RSA Certificate (5).png',
  'RSA Certificate (6).png',
  'RSA Certificate.jpeg',
  'RSA Certificate.png'
]);

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    staffReportPath: flag('staff-report') ?? DEFAULT_STAFF_REPORT,
    documentsDir: flag('documents-dir') ?? args[0] ?? '',
    reportPath: flag('report') ?? DEFAULT_REPORT,
    apply: args.includes('--apply')
  };
}

function normaliseName(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/\s+/g, ' ');
}

function normaliseEmail(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

function staffName(profile: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${profile.firstName} ${profile.lastName}`.trim();
}

function mimeTypeFor(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return null;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === '__MACOSX' || entry.name.startsWith('.')) return [];
    if (entry.isDirectory()) return listFiles(fullPath);
    if (entry.isFile()) return [fullPath];
    return [];
  }));
  return files.flat().sort((a, b) => a.localeCompare(b));
}

function staffReportRowForName(report: StaffReport, name: string) {
  const matches = report.rows.filter((row) => normaliseName(row.deputyName) === normaliseName(name));
  return matches.length === 1 ? matches[0] : null;
}

async function resolveStaffProfile(report: StaffReport, document: KnownDocument) {
  const reportRow = staffReportRowForName(report, document.staffName);

  if (reportRow?.staffProfileId) {
    const byId = await prisma.staffProfile.findFirst({
      where: { id: reportRow.staffProfileId, accountType: 'HUMAN', mergedIntoStaffProfileId: null }
    });
    if (byId) return { profile: byId, reason: 'staff-report-id' };
  }

  if (reportRow?.email) {
    const byEmail = await prisma.staffProfile.findMany({
      where: { email: { equals: normaliseEmail(reportRow.email), mode: 'insensitive' }, accountType: 'HUMAN', mergedIntoStaffProfileId: null }
    });
    if (byEmail.length === 1) return { profile: byEmail[0], reason: 'staff-report-email' };
    if (byEmail.length > 1) return { profile: null, reason: 'ambiguous-email' };
  }

  const [first, ...lastParts] = document.staffName.split(' ');
  const last = lastParts.join(' ');
  const byName = await prisma.staffProfile.findMany({
    where: {
      firstName: { equals: first, mode: 'insensitive' },
      lastName: { equals: last, mode: 'insensitive' },
      accountType: 'HUMAN',
      mergedIntoStaffProfileId: null
    }
  });
  if (byName.length === 1) return { profile: byName[0], reason: 'exact-name' };
  if (byName.length > 1) return { profile: null, reason: 'ambiguous-name' };

  return { profile: null, reason: 'not-found' };
}

async function findTargetRecord(staffProfileId: string, documentName: string) {
  const alreadyAttached = await prisma.staffComplianceRecord.findFirst({
    where: { staffProfileId, recordType: 'RSA', documentName }
  });
  if (alreadyAttached) return { existing: alreadyAttached, mode: 'already-attached' as const };

  const pending = await prisma.staffComplianceRecord.findFirst({
    where: {
      staffProfileId,
      recordType: 'RSA',
      documentUrl: null
    },
    orderBy: { createdAt: 'asc' }
  });
  if (pending) return { existing: pending, mode: 'update-existing' as const };

  return { existing: null, mode: 'create' as const };
}

function createSkipResult(file: string, action: DocumentResult['action'], reason: string): DocumentResult {
  return { file, basename: path.basename(file), action, reason };
}

async function importDocumentFile(
  file: string,
  document: KnownDocument,
  report: StaffReport,
  apply: boolean
): Promise<DocumentResult> {
  const staff = await resolveStaffProfile(report, document);
  if (!staff.profile) {
    return createSkipResult(
      file,
      staff.reason.startsWith('ambiguous') ? 'skipped_staff_ambiguous' : 'skipped_staff_not_found',
      `Could not resolve ${document.staffName}: ${staff.reason}.`
    );
  }

  const mimeType = mimeTypeFor(file);
  if (!mimeType) return createSkipResult(file, 'skipped_unrecognised', 'Unsupported file type.');

  const buffer = await fs.readFile(file);
  const documentUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  if (documentUrl.length > MAX_DATA_URL_BYTES) {
    return createSkipResult(file, 'skipped_unrecognised', 'Encoded document is larger than Staff document upload limit.');
  }

  const documentName = path.basename(file);
  const target = await findTargetRecord(staff.profile.id, documentName);
  if (target.mode === 'already-attached' && target.existing) {
    return {
      file,
      basename: documentName,
      action: 'already_attached',
      reason: 'Same RSA document is already attached to this staff profile.',
      staffProfileId: staff.profile.id,
      staffName: staffName(staff.profile),
      recordId: target.existing.id,
      targetModel: 'StaffComplianceRecord'
    };
  }

  const data = {
    recordType: 'RSA' as const,
    title: document.title,
    issuer: 'NSW RSA',
    certificateNumber: document.certificateNumber ?? null,
    issueDate: document.issueDate ? new Date(`${document.issueDate}T00:00:00`) : null,
    status: 'APPROVED' as const,
    documentName,
    documentUrl,
    notes: `Certificate matched to ${document.staffName} from Deputy document archive. ${document.evidence}`
  };

  if (!apply) {
    return {
      file,
      basename: documentName,
      action: target.mode === 'update-existing' ? 'would_update_existing' : 'would_attach',
      reason: target.mode === 'update-existing' ? 'Would attach file to existing pending RSA record.' : 'Would create a new StaffComplianceRecord with this RSA attachment.',
      staffProfileId: staff.profile.id,
      staffName: staffName(staff.profile),
      recordId: target.existing?.id,
      targetModel: 'StaffComplianceRecord'
    };
  }

  const record: StaffComplianceRecord = target.mode === 'update-existing' && target.existing
    ? await prisma.staffComplianceRecord.update({
      where: { id: target.existing.id },
      data
    })
    : await prisma.staffComplianceRecord.create({
      data: {
        ...data,
        staffProfileId: staff.profile.id
      }
    });

  return {
    file,
    basename: documentName,
    action: target.mode === 'update-existing' ? 'updated_existing' : 'attached',
    reason: target.mode === 'update-existing' ? 'Attached file to existing pending RSA record.' : 'Created a new StaffComplianceRecord with this RSA attachment.',
    staffProfileId: staff.profile.id,
    staffName: staffName(staff.profile),
    recordId: record.id,
    targetModel: 'StaffComplianceRecord'
  };
}

async function importDeputyDocuments(staffReportPath: string, documentsDir: string, reportPath: string, apply: boolean): Promise<ImportReport> {
  if (!documentsDir) {
    throw new Error('Pass --documents-dir=/path/to/extracted/deputy/documents.');
  }

  const staffReport = await readJson<StaffReport>(staffReportPath);
  const files = (await listFiles(documentsDir)).filter((file) => SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const filesByBasename = new Map<string, string[]>();
  for (const file of files) {
    const basename = path.basename(file);
    filesByBasename.set(basename, [...(filesByBasename.get(basename) ?? []), file]);
  }

  const knownByBasename = new Map(KNOWN_RSA_DOCUMENTS.map((document) => [document.basename, document]));
  const results: DocumentResult[] = [];

  for (const file of files) {
    const basename = path.basename(file);
    const duplicateFiles = filesByBasename.get(basename) ?? [];
    const known = knownByBasename.get(basename);

    if (duplicateFiles.length > 1) {
      results.push(createSkipResult(file, 'skipped_duplicate_filename', 'Multiple files share this basename in the document folder; provide a narrower folder.'));
      continue;
    }

    if (known) {
      results.push(await importDocumentFile(file, known, staffReport, apply));
      continue;
    }

    if (UNCERTAIN_RSA_BASENAMES.has(basename)) {
      results.push(createSkipResult(file, 'skipped_uncertain', 'RSA file was not an exact staff match. Leave for manual mapping.'));
      continue;
    }

    if (/welcome pack|foh onboarding|menu notes|allergens table/i.test(basename)) {
      results.push(createSkipResult(file, 'skipped_generic', 'Generic Deputy document; not attached to an individual staff profile.'));
      continue;
    }

    results.push(createSkipResult(file, 'skipped_unrecognised', 'File is not part of the exact-match Deputy RSA import allowlist.'));
  }

  for (const known of KNOWN_RSA_DOCUMENTS) {
    if (!filesByBasename.has(known.basename)) {
      results.push({
        file: path.join(documentsDir, known.basename),
        basename: known.basename,
        action: 'skipped_missing_file',
        reason: 'Exact-match RSA file was not present in the provided document folder.'
      });
    }
  }

  const importReport: ImportReport = {
    staffReportPath,
    documentsDir,
    applied: apply,
    filesScanned: files.length,
    wouldAttach: results.filter((result) => result.action === 'would_attach').length,
    wouldUpdateExisting: results.filter((result) => result.action === 'would_update_existing').length,
    attached: results.filter((result) => result.action === 'attached').length,
    updatedExisting: results.filter((result) => result.action === 'updated_existing').length,
    alreadyAttached: results.filter((result) => result.action === 'already_attached').length,
    skipped: results.filter((result) => result.action.startsWith('skipped_')).length,
    results,
    reportPath
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(importReport, null, 2)}\n`);
  return importReport;
}

async function main() {
  const { staffReportPath, documentsDir, reportPath, apply } = parseArgs();
  const report = await importDeputyDocuments(staffReportPath, documentsDir, reportPath, apply);
  console.log(JSON.stringify({
    staffReportPath: report.staffReportPath,
    documentsDir: report.documentsDir,
    applied: report.applied,
    filesScanned: report.filesScanned,
    wouldAttach: report.wouldAttach,
    wouldUpdateExisting: report.wouldUpdateExisting,
    attached: report.attached,
    updatedExisting: report.updatedExisting,
    alreadyAttached: report.alreadyAttached,
    skipped: report.skipped,
    reportPath: report.reportPath
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
