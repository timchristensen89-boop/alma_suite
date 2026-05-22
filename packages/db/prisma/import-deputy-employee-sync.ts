import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, StaffProfile } from '@prisma/client';
import { prisma } from '../src/prisma.js';

type DeputyEmployeeRow = Record<
  | 'First Name'
  | 'Last Name'
  | 'Preferred Name'
  | 'Mobile'
  | 'Email'
  | 'Location Name'
  | 'Location Code'
  | 'Date of Birth'
  | 'Gender'
  | 'Address'
  | 'City'
  | 'Post Code'
  | 'State'
  | 'Country'
  | 'Emergency Contact Name'
  | 'Emergency Contact Phone'
  | 'Username'
  | 'Termination Date'
  | 'Send Invite'
  | 'Additional Locations'
  | 'Role'
  | 'Stress Profile'
  | 'Hired Date'
  | 'Deputy ID'
  | 'Payroll ID'
  | 'Library Award'
  | 'Classification'
  | 'Base Rate',
  string
>;

type FieldChange = {
  field: keyof Prisma.StaffProfileUpdateInput;
  current: string | number | boolean | null;
  deputy: string | number | boolean | null;
  action: 'updated' | 'conflict' | 'same' | 'empty';
};

type MatchedRow = {
  row: number;
  deputyId: string;
  deputyName: string;
  email: string | null;
  match: 'email' | 'nameVenue' | 'nameOnly' | 'created' | 'ambiguous' | 'none';
  staffProfileId: string | null;
  staffName: string | null;
  changes: FieldChange[];
  context: Record<string, string>;
};

type ImportReport = {
  source: string;
  applied: boolean;
  rowsRead: number;
  matched: number;
  created: number;
  ambiguous: MatchedRow[];
  unmatched: MatchedRow[];
  updatedProfiles: number;
  conflictProfiles: number;
  rows: MatchedRow[];
  reportPath: string;
};

const DEFAULT_FILE = '/Users/timothychristensen/Downloads/PremiumEmployeeSync-Thu, 21 May 2026 12_57_51 UTC-062f40b8-a851-4f13-bd01-b8834751cc34.csv';

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const fileFlag = args.find((arg) => arg.startsWith('--file='));
  const reportFlag = args.find((arg) => arg.startsWith('--report='));
  return {
    file: fileFlag ? fileFlag.slice('--file='.length) : args[0] || DEFAULT_FILE,
    reportPath: reportFlag ? reportFlag.slice('--report='.length) : '/tmp/alma-deputy-employee-sync-report.json',
    apply: args.includes('--apply')
  };
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') index += 1;
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows: string[][]): DeputyEmployeeRow[] {
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      object[header] = row[index]?.trim() ?? '';
    });
    return object as DeputyEmployeeRow;
  });
}

function clean(value: string | null | undefined) {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normaliseEmail(value: string | null | undefined) {
  return clean(value).toLowerCase() || null;
}

function normaliseName(value: string | null | undefined) {
  return clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '');
}

function normalisePhone(value: string | null | undefined) {
  return clean(value).replace(/[^\d+]/g, '').replace(/^0061/, '+61');
}

function normaliseVenue(location: string) {
  const value = clean(location).toLowerCase();
  if (value.includes('freshwater')) return 'St Alma';
  if (value.includes('avalon')) return 'Alma Avalon';
  return clean(location);
}

function dateFromDeputy(value: string) {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function centsFromRate(value: string) {
  const amount = Number(clean(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function csvContext(row: DeputyEmployeeRow) {
  return {
    deputyId: clean(row['Deputy ID']),
    username: clean(row.Username),
    payrollId: clean(row['Payroll ID']),
    locationName: clean(row['Location Name']),
    locationCode: clean(row['Location Code']),
    additionalLocations: clean(row['Additional Locations']).replace(/^"+|"+$/g, ''),
    role: clean(row.Role),
    stressProfile: clean(row['Stress Profile']),
    libraryAward: clean(row['Library Award']),
    classification: clean(row.Classification),
    baseRate: clean(row['Base Rate']),
    gender: clean(row.Gender),
    country: clean(row.Country),
    sendInvite: clean(row['Send Invite']),
    terminationDate: clean(row['Termination Date'])
  };
}

function staffName(profile: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${profile.firstName} ${profile.lastName}`.trim();
}

function deputyName(row: DeputyEmployeeRow) {
  return `${clean(row['First Name'])} ${clean(row['Last Name'])}`.trim();
}

function currentComparable(value: unknown) {
  if (value instanceof Date) return dateKey(value);
  if (typeof value === 'string') return clean(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return value ?? null;
}

function deputyComparable(field: keyof Prisma.StaffProfileUpdateInput, value: string | number | boolean | Date | null) {
  if (value instanceof Date) return dateKey(value);
  if (field === 'phone' || field === 'emergencyContactPhone') return normalisePhone(String(value ?? ''));
  if (typeof value === 'string') return clean(value);
  return value;
}

function addFieldChange(
  changes: FieldChange[],
  profile: StaffProfile | null,
  updates: Prisma.StaffProfileUpdateInput,
  field: keyof Prisma.StaffProfileUpdateInput,
  deputyValue: string | number | boolean | Date | null | undefined,
  options: { compareCurrent?: unknown; forceConflict?: boolean } = {}
) {
  if (deputyValue === undefined || deputyValue === null || deputyValue === '') {
    changes.push({ field, current: profile ? currentComparable(options.compareCurrent ?? profile[field as keyof StaffProfile]) as string | number | boolean | null : null, deputy: null, action: 'empty' });
    return;
  }

  const currentRaw = profile ? options.compareCurrent ?? profile[field as keyof StaffProfile] : null;
  const current = currentComparable(currentRaw);
  const deputy = deputyComparable(field, deputyValue);

  if (!profile || current === null || current === '') {
    updates[field] = deputyValue as never;
    changes.push({ field, current: current as string | number | boolean | null, deputy: deputy as string | number | boolean | null, action: 'updated' });
    return;
  }

  const currentForCompare = field === 'phone' || field === 'emergencyContactPhone' ? normalisePhone(String(current)) : current;
  if (!options.forceConflict && String(currentForCompare).toLowerCase() === String(deputy).toLowerCase()) {
    changes.push({ field, current: current as string | number | boolean | null, deputy: deputy as string | number | boolean | null, action: 'same' });
    return;
  }

  changes.push({ field, current: current as string | number | boolean | null, deputy: deputy as string | number | boolean | null, action: 'conflict' });
}

function rowUpdates(row: DeputyEmployeeRow, profile: StaffProfile | null) {
  const updates: Prisma.StaffProfileUpdateInput = {};
  const changes: FieldChange[] = [];
  const venue = normaliseVenue(row['Location Name']);
  const payRateCents = centsFromRate(row['Base Rate']);
  const terminatedAt = dateFromDeputy(row['Termination Date']);

  addFieldChange(changes, profile, updates, 'firstName', clean(row['First Name']));
  addFieldChange(changes, profile, updates, 'lastName', clean(row['Last Name']));
  addFieldChange(changes, profile, updates, 'email', normaliseEmail(row.Email));
  addFieldChange(changes, profile, updates, 'phone', clean(row.Mobile));
  addFieldChange(changes, profile, updates, 'venue', venue);
  addFieldChange(changes, profile, updates, 'dateOfBirth', dateFromDeputy(row['Date of Birth']));
  addFieldChange(changes, profile, updates, 'addressLine1', clean(row.Address));
  addFieldChange(changes, profile, updates, 'suburb', clean(row.City));
  addFieldChange(changes, profile, updates, 'postcode', clean(row['Post Code']));
  addFieldChange(changes, profile, updates, 'state', clean(row.State));
  addFieldChange(changes, profile, updates, 'emergencyContactName', clean(row['Emergency Contact Name']));
  addFieldChange(changes, profile, updates, 'emergencyContactPhone', clean(row['Emergency Contact Phone']));
  addFieldChange(changes, profile, updates, 'roleTitle', clean(row.Role));
  addFieldChange(changes, profile, updates, 'startDate', dateFromDeputy(row['Hired Date']));
  addFieldChange(changes, profile, updates, 'payRateCents', payRateCents);
  addFieldChange(changes, profile, updates, 'payAward', clean(row['Library Award']));

  if (terminatedAt) {
    addFieldChange(changes, profile, updates, 'employmentStatus', 'ARCHIVED', {
      forceConflict: profile?.employmentStatus !== 'ARCHIVED'
    });
  }

  return { updates, changes };
}

function notesBlock(source: string, row: DeputyEmployeeRow, changes: FieldChange[]) {
  const context = csvContext(row);
  const conflicts = changes.filter((change) => change.action === 'conflict');
  const lines = [
    `Deputy PremiumEmployeeSync import: ${path.basename(source)}`,
    `Deputy ID: ${context.deputyId || 'not supplied'}; username: ${context.username || 'not supplied'}; payroll ID: ${context.payrollId || 'not supplied'}`,
    `Deputy location: ${context.locationName || 'not supplied'}${context.additionalLocations ? `; additional locations: ${context.additionalLocations}` : ''}`,
    `Deputy role: ${context.role || 'not supplied'}; stress profile: ${context.stressProfile || 'not supplied'}`
  ];
  if (context.gender || context.country || context.sendInvite) {
    lines.push(`Deputy extra: gender=${context.gender || 'not supplied'}; country=${context.country || 'not supplied'}; sendInvite=${context.sendInvite || 'not supplied'}`);
  }
  if (conflicts.length) {
    lines.push(`Deputy conflicts for confirmation: ${conflicts.map((change) => String(change.field)).join(', ')}. Values are stored in the import report and management event metadata.`);
  }
  return lines.join('\n');
}

function appendNotes(existing: string | null, block: string, source: string) {
  const marker = `Deputy PremiumEmployeeSync import: ${path.basename(source)}`;
  if (existing?.includes(marker)) return existing;
  return [existing?.trim(), block].filter(Boolean).join('\n\n');
}

async function findProfile(row: DeputyEmployeeRow, profiles: StaffProfile[]) {
  const email = normaliseEmail(row.Email);
  const first = normaliseName(row['First Name']);
  const last = normaliseName(row['Last Name']);
  const venue = normaliseVenue(row['Location Name']).toLowerCase();

  if (email) {
    const byEmail = profiles.find((profile) => normaliseEmail(profile.email) === email);
    if (byEmail) return { match: 'email' as const, profile: byEmail };
  }

  const byNameVenue = profiles.filter((profile) =>
    normaliseName(profile.firstName) === first &&
    normaliseName(profile.lastName) === last &&
    clean(profile.venue).toLowerCase() === venue
  );
  if (byNameVenue.length === 1) return { match: 'nameVenue' as const, profile: byNameVenue[0] };
  if (byNameVenue.length > 1) return { match: 'ambiguous' as const, profile: null };

  const byName = profiles.filter((profile) =>
    normaliseName(profile.firstName) === first &&
    normaliseName(profile.lastName) === last
  );
  if (byName.length === 1) return { match: 'nameOnly' as const, profile: byName[0] };
  if (byName.length > 1) return { match: 'ambiguous' as const, profile: null };

  return { match: 'none' as const, profile: null };
}

async function importEmployeeSync(file: string, reportPath: string, apply: boolean): Promise<ImportReport> {
  const text = await fs.readFile(file, 'utf8');
  const rows = toObjects(parseCsv(text.replace(/^\uFEFF/, '')));
  const profiles = await prisma.staffProfile.findMany({
    where: { accountType: 'HUMAN', mergedIntoStaffProfileId: null },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }]
  });
  const reportRows: MatchedRow[] = [];
  let created = 0;
  let updatedProfiles = 0;

  for (const [index, row] of rows.entries()) {
    const found = await findProfile(row, profiles);
    const matchRow: MatchedRow = {
      row: index + 2,
      deputyId: clean(row['Deputy ID']),
      deputyName: deputyName(row),
      email: normaliseEmail(row.Email),
      match: found.match,
      staffProfileId: found.profile?.id ?? null,
      staffName: found.profile ? staffName(found.profile) : null,
      changes: [],
      context: csvContext(row)
    };

    if (found.match === 'ambiguous') {
      reportRows.push(matchRow);
      continue;
    }

    const { updates, changes } = rowUpdates(row, found.profile);
    matchRow.changes = changes;
    const changedFields = changes.filter((change) => change.action === 'updated');
    const conflicts = changes.filter((change) => change.action === 'conflict');
    const block = notesBlock(file, row, changes);

    if (!apply) {
      reportRows.push(matchRow);
      continue;
    }

    if (!found.profile) {
      const createdProfile = await prisma.staffProfile.create({
        data: {
          firstName: clean(row['First Name']) || 'Unknown',
          lastName: clean(row['Last Name']) || 'Deputy',
          roleTitle: clean(row.Role) || 'Employee',
          email: normaliseEmail(row.Email),
          phone: clean(row.Mobile) || null,
          venue: normaliseVenue(row['Location Name']) || null,
          employmentStatus: clean(row['Termination Date']) ? 'ARCHIVED' : 'ACTIVE',
          dateOfBirth: dateFromDeputy(row['Date of Birth']),
          addressLine1: clean(row.Address) || null,
          suburb: clean(row.City) || null,
          state: clean(row.State) || null,
          postcode: clean(row['Post Code']) || null,
          emergencyContactName: clean(row['Emergency Contact Name']) || null,
          emergencyContactPhone: clean(row['Emergency Contact Phone']) || null,
          startDate: dateFromDeputy(row['Hired Date']),
          payRateCents: centsFromRate(row['Base Rate']),
          payAward: clean(row['Library Award']) || null,
          notes: block
        }
      });
      profiles.push(createdProfile);
      created += 1;
      matchRow.match = 'created';
      matchRow.staffProfileId = createdProfile.id;
      matchRow.staffName = staffName(createdProfile);
      await prisma.staffManagementEvent.create({
        data: {
          staffProfileId: createdProfile.id,
          eventType: 'DEPUTY_EMPLOYEE_SYNC_IMPORTED',
          summary: 'Created from Deputy PremiumEmployeeSync export.',
          metadata: { source: path.basename(file), row: index + 2, deputy: csvContext(row), changes, conflicts }
        }
      });
      reportRows.push(matchRow);
      continue;
    }

    if (changedFields.length || conflicts.length) {
      const notes = appendNotes(found.profile.notes, block, file);
      await prisma.staffProfile.update({
        where: { id: found.profile.id },
        data: {
          ...updates,
          notes
        }
      });
      updatedProfiles += 1;
      await prisma.staffManagementEvent.create({
        data: {
          staffProfileId: found.profile.id,
          eventType: 'DEPUTY_EMPLOYEE_SYNC_IMPORTED',
          summary: conflicts.length
            ? 'Deputy PremiumEmployeeSync imported with conflicts for review.'
            : 'Deputy PremiumEmployeeSync imported.',
          metadata: { source: path.basename(file), row: index + 2, deputy: csvContext(row), changes, conflicts }
        }
      });
    }

    reportRows.push(matchRow);
  }

  const report: ImportReport = {
    source: file,
    applied: apply,
    rowsRead: rows.length,
    matched: reportRows.filter((row) => ['email', 'nameVenue', 'nameOnly'].includes(row.match)).length,
    created,
    ambiguous: reportRows.filter((row) => row.match === 'ambiguous'),
    unmatched: reportRows.filter((row) => row.match === 'none'),
    updatedProfiles,
    conflictProfiles: reportRows.filter((row) => row.changes.some((change) => change.action === 'conflict')).length,
    rows: reportRows,
    reportPath
  };

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const { file, reportPath, apply } = parseArgs();
  const report = await importEmployeeSync(file, reportPath, apply);
  console.log(JSON.stringify({
    source: report.source,
    applied: report.applied,
    rowsRead: report.rowsRead,
    matched: report.matched,
    created: report.created,
    updatedProfiles: report.updatedProfiles,
    conflictProfiles: report.conflictProfiles,
    ambiguous: report.ambiguous.length,
    unmatched: report.unmatched.length,
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
