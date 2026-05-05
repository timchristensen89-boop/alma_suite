import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/prisma.js';

type DeputyRow = Record<
  | 'Location'
  | 'Area'
  | 'Employee'
  | 'Start Date'
  | 'Start Time'
  | 'End Date'
  | 'End Time'
  | 'Total Meal Break'
  | 'Total Rest Break'
  | 'Total Time'
  | 'Status'
  | 'Note'
  | 'Cost'
  | 'Email',
  string
>;

type ImportResult = {
  source: string;
  rowsRead: number;
  shiftsCreated: number;
  previousImportedShiftsDeleted: number;
  staffCreated: number;
  staffMatched: number;
  unallocatedShifts: number;
  skippedRows: Array<{ row: number; reason: string }>;
  dateRange: { start: string | null; end: string | null };
};

const DEFAULT_FILE = '/Users/timothychristensen/Downloads/DeputyRoster2Weeks_20260505_040213.csv';

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const fileFlag = args.find((arg) => arg.startsWith('--file='));
  return {
    file: fileFlag ? fileFlag.slice('--file='.length) : args[0] || DEFAULT_FILE,
    dryRun: args.includes('--dry-run')
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

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') {
        index += 1;
      }
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

function toObjects(rows: string[][]): DeputyRow[] {
  const headers = rows[0]?.map((header) => header.trim()) ?? [];
  return rows.slice(1).filter((row) => row.some((cell) => cell.trim())).map((row) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      object[header] = row[index]?.trim() ?? '';
    });
    return object as DeputyRow;
  });
}

function normaliseVenue(location: string) {
  const value = location.trim().toLowerCase();
  if (value.includes('freshwater')) return 'St Alma';
  if (value.includes('avalon')) return 'Alma Avalon';
  return location.trim();
}

function normaliseArea(area: string) {
  return area.trim().replace(/\s+/g, ' ');
}

function parseMinutes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const [hours = '0', minutes = '0'] = trimmed.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function parseDateTime(dateValue: string, timeValue: string) {
  const match = timeValue.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!match) return new Date(Number.NaN);
  const [, hourText, minuteText, meridiem] = match;
  let hours = Number(hourText);
  const minutes = Number(minuteText);
  if (meridiem.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (meridiem.toUpperCase() === 'AM' && hours === 12) hours = 0;
  return new Date(`${dateValue.trim()}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
}

function employeeNameParts(employee: string) {
  const cleaned = employee.trim().replace(/\s+/g, ' ');
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { firstName: cleaned, lastName: '' };
  return {
    firstName: parts.slice(0, -1).join(' '),
    lastName: parts[parts.length - 1] ?? ''
  };
}

function normaliseEmail(email: string) {
  return email.trim().toLowerCase() || null;
}

function importMarker(source: string) {
  return `Deputy import: ${path.basename(source)}`;
}

async function findOrCreateStaff(row: DeputyRow, source: string) {
  const area = normaliseArea(row.Area);
  const venue = normaliseVenue(row.Location);
  const employee = row.Employee.trim();
  const email = normaliseEmail(row.Email);
  const isUnallocated = employee === '**UNALLOCATED**';

  if (email) {
    const existingByEmail = await prisma.staffProfile.findUnique({ where: { email } });
    if (existingByEmail) {
      return { profile: existingByEmail, created: false, unallocated: false };
    }
  }

  if (isUnallocated) {
    const existingPlaceholder = await prisma.staffProfile.findFirst({
      where: {
        firstName: 'Unallocated',
        lastName: area,
        venue,
        notes: { contains: 'Deputy unallocated placeholder' }
      }
    });
    if (existingPlaceholder) {
      return { profile: existingPlaceholder, created: false, unallocated: true };
    }

    const profile = await prisma.staffProfile.create({
      data: {
        firstName: 'Unallocated',
        lastName: area,
        roleTitle: area || 'Unallocated shift',
        venue,
        employmentStatus: 'ACTIVE',
        notes: `Deputy unallocated placeholder. ${importMarker(source)}`
      }
    });
    return { profile, created: true, unallocated: true };
  }

  const { firstName, lastName } = employeeNameParts(employee);
  const existingByName = await prisma.staffProfile.findFirst({
    where: {
      firstName,
      lastName,
      venue
    }
  });
  if (existingByName) {
    return { profile: existingByName, created: false, unallocated: false };
  }

  const profile = await prisma.staffProfile.create({
    data: {
      firstName,
      lastName,
      roleTitle: area || 'Team member',
      email,
      venue,
      employmentStatus: 'ACTIVE',
      notes: `Created from Deputy roster import. ${importMarker(source)}`
    }
  });

  return { profile, created: true, unallocated: false };
}

async function importRoster(file: string, dryRun: boolean): Promise<ImportResult> {
  const text = await fs.readFile(file, 'utf8');
  const rows = toObjects(parseCsv(text.replace(/^\uFEFF/, '')));
  const marker = importMarker(file);
  const skippedRows: ImportResult['skippedRows'] = [];

  const parsed = rows.map((row, index) => {
    const startsAt = parseDateTime(row['Start Date'], row['Start Time']);
    const endsAt = parseDateTime(row['End Date'], row['End Time']);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      skippedRows.push({ row: index + 2, reason: 'Invalid start or end time' });
      return null;
    }
    if (endsAt <= startsAt) {
      skippedRows.push({ row: index + 2, reason: 'End time is not after start time' });
      return null;
    }
    return { row, startsAt, endsAt };
  }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const minStart = parsed.reduce<Date | null>((current, entry) => {
    return !current || entry.startsAt < current ? entry.startsAt : current;
  }, null);
  const maxEnd = parsed.reduce<Date | null>((current, entry) => {
    return !current || entry.endsAt > current ? entry.endsAt : current;
  }, null);

  const result: ImportResult = {
    source: file,
    rowsRead: rows.length,
    shiftsCreated: 0,
    previousImportedShiftsDeleted: 0,
    staffCreated: 0,
    staffMatched: 0,
    unallocatedShifts: 0,
    skippedRows,
    dateRange: {
      start: minStart?.toISOString() ?? null,
      end: maxEnd?.toISOString() ?? null
    }
  };

  if (dryRun) return result;

  if (minStart && maxEnd) {
    const deleted = await prisma.rosterShift.deleteMany({
      where: {
        startsAt: { gte: minStart },
        endsAt: { lte: maxEnd },
        notes: { contains: marker }
      }
    });
    result.previousImportedShiftsDeleted = deleted.count;
  }

  for (const entry of parsed) {
    const { profile, created, unallocated } = await findOrCreateStaff(entry.row, file);
    if (created) result.staffCreated += 1;
    else result.staffMatched += 1;
    if (unallocated) result.unallocatedShifts += 1;

    const breakMinutes = parseMinutes(entry.row['Total Meal Break']) + parseMinutes(entry.row['Total Rest Break']);
    const status = entry.row.Status.trim().toLowerCase() === 'published' ? 'PUBLISHED' : 'DRAFT';
    const area = normaliseArea(entry.row.Area);
    const venue = normaliseVenue(entry.row.Location);
    const noteParts = [
      marker,
      `Deputy status: ${entry.row.Status.trim() || 'Unknown'}`,
      entry.row['Total Time'] ? `Deputy total hours: ${entry.row['Total Time']}` : null,
      entry.row.Cost && entry.row.Cost !== '0' ? `Deputy cost: ${entry.row.Cost}` : null,
      entry.row.Note ? `Deputy note: ${entry.row.Note}` : null
    ].filter(Boolean);

    await prisma.rosterShift.create({
      data: {
        staffProfileId: profile.id,
        venue,
        area,
        roleTitle: area || profile.roleTitle,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        breakMinutes,
        status,
        notes: noteParts.join(' | ')
      }
    });
    result.shiftsCreated += 1;
  }

  return result;
}

async function main() {
  const { file, dryRun } = parseArgs();
  const result = await importRoster(file, dryRun);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
