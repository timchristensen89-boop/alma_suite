import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
    | 'would_create_review'
    | 'review_created'
    | 'review_existing'
    | 'skipped_generic'
    | 'skipped_sensitive'
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
  reviewId?: string;
  candidateName?: string;
  candidateStaff?: Array<{ id: string; name: string; venue: string | null; email: string | null }>;
  reviewReason?: string;
  sourceFileHash?: string;
  targetModel?: 'StaffComplianceRecord' | 'StaffDocumentReview';
};

type ImportReport = {
  staffReportPath: string;
  documentsDir: string;
  applied: boolean;
  reviewUncertainRsa: boolean;
  filesScanned: number;
  wouldAttach: number;
  wouldUpdateExisting: number;
  attached: number;
  updatedExisting: number;
  alreadyAttached: number;
  exactAttached: number;
  exactUpdated: number;
  exactCreated: number;
  reviewCreated: number;
  reviewExisting: number;
  skippedGeneric: number;
  skippedSensitive: number;
  skippedDuplicate: number;
  ambiguous: number;
  rejectedByRule: number;
  skipped: number;
  results: DocumentResult[];
  reportPath: string;
};

const DEFAULT_STAFF_REPORT = '/tmp/alma-deputy-employee-sync-prod-applied.json';
const DEFAULT_REPORT = '/tmp/alma-deputy-documents-report.json';
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const MAX_DATA_URL_BYTES = 5_700_000;
const DEPUTY_DOCUMENT_REVIEW_SOURCE = 'deputy-document-import';

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
    apply: args.includes('--apply'),
    reviewUncertainRsa: args.includes('--review-uncertain-rsa')
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

function isMissingReviewTableError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = error instanceof Error ? error.message : '';
  return code === 'P2021' || /StaffDocumentReview|relation .* does not exist/i.test(message);
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

async function candidateStaffForName(candidateName: string | null) {
  if (!candidateName) return [];
  const parts = normaliseName(candidateName).split(' ').filter(Boolean);
  if (parts.length < 2) return [];
  const first = parts[0];
  const last = parts.at(-1) ?? '';
  const candidates = await prisma.staffProfile.findMany({
    where: {
      accountType: 'HUMAN',
      mergedIntoStaffProfileId: null,
      OR: [
        {
          firstName: { contains: first, mode: 'insensitive' },
          lastName: { contains: last, mode: 'insensitive' }
        },
        {
          firstName: { contains: last, mode: 'insensitive' },
          lastName: { contains: first, mode: 'insensitive' }
        }
      ]
    },
    select: { id: true, firstName: true, lastName: true, venue: true, email: true },
    take: 8
  });
  return candidates.map((profile) => ({
    id: profile.id,
    name: staffName(profile),
    venue: profile.venue,
    email: profile.email
  }));
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

async function fileHash(file: string) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

async function dataUrlForFile(file: string) {
  const mimeType = mimeTypeFor(file);
  if (!mimeType) return null;
  const buffer = await fs.readFile(file);
  const documentUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
  if (documentUrl.length > MAX_DATA_URL_BYTES) return null;
  return documentUrl;
}

function uncertainReviewReason(file: string) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') return 'image-rendered';
  return 'no confident staff match';
}

function parsedCandidateNameForUncertainRsa(_file: string) {
  return null;
}

async function findExistingReview(sourceFileHash: string, apply: boolean) {
  try {
    return await prisma.staffDocumentReview.findUnique({
      where: {
        source_sourceFileHash: {
          source: DEPUTY_DOCUMENT_REVIEW_SOURCE,
          sourceFileHash
        }
      }
    });
  } catch (error) {
    if (!apply && isMissingReviewTableError(error)) return null;
    throw error;
  }
}

async function createReviewResult(file: string, apply: boolean): Promise<DocumentResult> {
  const basename = path.basename(file);
  const documentUrl = await dataUrlForFile(file);
  const sourceFileHash = await fileHash(file);
  const reviewReason = uncertainReviewReason(file);
  const candidateName = parsedCandidateNameForUncertainRsa(file);
  const candidateStaff = await candidateStaffForName(candidateName);

  if (!documentUrl) {
    return {
      file,
      basename,
      action: 'skipped_unrecognised',
      reason: 'Review file is unsupported or larger than Staff document upload limit.',
      sourceFileHash
    };
  }

  const existing = await findExistingReview(sourceFileHash, apply);
  if (existing) {
    return {
      file,
      basename,
      action: 'review_existing',
      reason: 'Manual review item already exists for this RSA file hash.',
      reviewId: existing.id,
      candidateName: existing.candidateName ?? candidateName ?? undefined,
      candidateStaff,
      reviewReason: existing.reviewReason,
      sourceFileHash,
      targetModel: 'StaffDocumentReview'
    };
  }

  if (!apply) {
    return {
      file,
      basename,
      action: 'would_create_review',
      reason: 'Would create a manual review item for uncertain RSA certificate.',
      candidateName: candidateName ?? undefined,
      candidateStaff,
      reviewReason,
      sourceFileHash,
      targetModel: 'StaffDocumentReview'
    };
  }

  const review = await prisma.staffDocumentReview.create({
    data: {
      recordType: 'RSA',
      title: 'RSA Certificate',
      status: 'PENDING_REVIEW',
      source: DEPUTY_DOCUMENT_REVIEW_SOURCE,
      sourceFileName: basename,
      sourceFileHash,
      candidateName,
      candidateStaffIds: candidateStaff.map((candidate) => candidate.id),
      reviewReason,
      documentName: basename,
      documentUrl,
      notes: `Imported from Deputy document archive for manual review. Reason: ${reviewReason}.`
    }
  });

  return {
    file,
    basename,
    action: 'review_created',
    reason: 'Created a manual review item for uncertain RSA certificate.',
    reviewId: review.id,
    candidateName: candidateName ?? undefined,
    candidateStaff,
    reviewReason,
    sourceFileHash,
    targetModel: 'StaffDocumentReview'
  };
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

  const documentUrl = await dataUrlForFile(file);
  if (!documentUrl) {
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

async function importDeputyDocuments(
  staffReportPath: string,
  documentsDir: string,
  reportPath: string,
  apply: boolean,
  reviewUncertainRsa: boolean
): Promise<ImportReport> {
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

    if (/about_blank/i.test(basename)) {
      results.push(createSkipResult(file, 'skipped_sensitive', 'Sensitive or blank browser export is excluded from Deputy document imports.'));
      continue;
    }

    if (UNCERTAIN_RSA_BASENAMES.has(basename)) {
      results.push(
        reviewUncertainRsa
          ? await createReviewResult(file, apply)
          : createSkipResult(file, 'skipped_uncertain', 'RSA file was not an exact staff match. Leave for manual mapping.')
      );
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
    reviewUncertainRsa,
    filesScanned: files.length,
    wouldAttach: results.filter((result) => result.action === 'would_attach').length,
    wouldUpdateExisting: results.filter((result) => result.action === 'would_update_existing').length,
    attached: results.filter((result) => result.action === 'attached').length,
    updatedExisting: results.filter((result) => result.action === 'updated_existing').length,
    alreadyAttached: results.filter((result) => result.action === 'already_attached').length,
    exactAttached: results.filter((result) => ['would_attach', 'would_update_existing', 'attached', 'updated_existing'].includes(result.action)).length,
    exactUpdated: results.filter((result) => ['would_update_existing', 'updated_existing'].includes(result.action)).length,
    exactCreated: results.filter((result) => ['would_attach', 'attached'].includes(result.action)).length,
    reviewCreated: results.filter((result) => ['would_create_review', 'review_created'].includes(result.action)).length,
    reviewExisting: results.filter((result) => result.action === 'review_existing').length,
    skippedGeneric: results.filter((result) => result.action === 'skipped_generic').length,
    skippedSensitive: results.filter((result) => result.action === 'skipped_sensitive').length,
    skippedDuplicate: results.filter((result) => result.action === 'skipped_duplicate_filename').length,
    ambiguous: results.filter((result) => result.action === 'skipped_staff_ambiguous' || result.reviewReason === 'ambiguous name' || result.reviewReason === 'multiple possible staff').length,
    rejectedByRule: results.filter((result) => ['skipped_uncertain', 'skipped_unrecognised', 'skipped_staff_not_found'].includes(result.action)).length,
    skipped: results.filter((result) => result.action.startsWith('skipped_')).length,
    results,
    reportPath
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(importReport, null, 2)}\n`);
  return importReport;
}

async function main() {
  const { staffReportPath, documentsDir, reportPath, apply, reviewUncertainRsa } = parseArgs();
  const report = await importDeputyDocuments(staffReportPath, documentsDir, reportPath, apply, reviewUncertainRsa);
  console.log(JSON.stringify({
    staffReportPath: report.staffReportPath,
    documentsDir: report.documentsDir,
    applied: report.applied,
    reviewUncertainRsa: report.reviewUncertainRsa,
    filesScanned: report.filesScanned,
    wouldAttach: report.wouldAttach,
    wouldUpdateExisting: report.wouldUpdateExisting,
    attached: report.attached,
    updatedExisting: report.updatedExisting,
    alreadyAttached: report.alreadyAttached,
    exactAttached: report.exactAttached,
    exactUpdated: report.exactUpdated,
    exactCreated: report.exactCreated,
    reviewCreated: report.reviewCreated,
    reviewExisting: report.reviewExisting,
    skippedGeneric: report.skippedGeneric,
    skippedSensitive: report.skippedSensitive,
    skippedDuplicate: report.skippedDuplicate,
    ambiguous: report.ambiguous,
    rejectedByRule: report.rejectedByRule,
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
