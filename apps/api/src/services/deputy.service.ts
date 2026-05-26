// Deputy stop-gap integration.
//
// The full Alma roster app is still being tested, so until it's ready
// the team will keep running the actual schedule in Deputy and pull a
// CSV into Alma so the rest of the suite (timesheets, daily brief,
// wage forecast) keeps working.
//
// This service wraps the CSV import that previously lived in
// packages/db/prisma/import-deputy-roster.ts so it can be called from
// the HTTP API. Two endpoints sit on top of it:
//   - POST /api/integrations/deputy/import-roster  → run the import
//   - GET  /api/integrations/deputy/status         → quick check
//
// Behaviour matches the existing CLI: idempotent re-import (deletes
// previous shifts from the same CSV marker before re-creating).

import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import { HttpError } from '../lib/http.js';

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

export type DeputyImportResult = {
  source: string;
  mode: 'live' | 'dry-run';
  rowsRead: number;
  shiftsCreated: number;
  previousImportedShiftsDeleted: number;
  staffCreated: number;
  staffMatched: number;
  unallocatedShifts: number;
  skippedRows: Array<{ row: number; reason: string }>;
  dateRange: { start: string | null; end: string | null };
  importedAt: string;
  importedBy: string;
};

function assertCanImportDeputy(actor: AuthUser) {
  if (actor.isAdmin || actor.role === 'ADMIN') return;
  if (actor.role === 'MANAGER') return;
  const access = actor.appAccess?.find((entry) => entry.appId === 'STAFF' && entry.status === 'ENABLED');
  const isStaffAdmin = access?.role === 'ADMIN' || Boolean(access?.permissions?.admin);
  if (!isStaffAdmin) {
    throw new HttpError(403, 'Deputy roster import requires manager or admin access.');
  }
}

function parseCsv(text: string): string[][] {
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
      continue;
    }
    if (char === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (char === '\r' && next === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      index += 1;
      continue;
    }
    if (char === '\n' || char === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
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
  const meridiemUpper = (meridiem ?? '').toUpperCase();
  let hours = Number(hourText);
  const minutes = Number(minuteText);
  if (meridiemUpper === 'PM' && hours < 12) hours += 12;
  if (meridiemUpper === 'AM' && hours === 12) hours = 0;
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

function importMarker(label: string) {
  return `Deputy import: ${label}`;
}

async function findOrCreateStaff(row: DeputyRow, marker: string) {
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
        notes: `Deputy unallocated placeholder. ${marker}`
      }
    });
    return { profile, created: true, unallocated: true };
  }

  const { firstName, lastName } = employeeNameParts(employee);
  const existingByName = await prisma.staffProfile.findFirst({
    where: { firstName, lastName, venue }
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
      notes: `Created from Deputy roster import. ${marker}`
    }
  });
  return { profile, created: true, unallocated: false };
}

export const deputyService = {
  // Quick status check for the UI — useful before showing the import form.
  async getStatus() {
    const [importedShifts, importedProfiles, lastImport] = await Promise.all([
      prisma.rosterShift.count({ where: { notes: { contains: 'Deputy import:' } } }),
      prisma.staffProfile.count({ where: { notes: { contains: 'Deputy' } } }),
      prisma.rosterShift.findFirst({
        where: { notes: { contains: 'Deputy import:' } },
        orderBy: [{ createdAt: 'desc' }],
        select: { createdAt: true, notes: true }
      })
    ]);
    return {
      mode: 'CSV_IMPORT' as const,
      importedShifts,
      importedProfiles,
      lastImportAt: lastImport?.createdAt?.toISOString() ?? null,
      note: 'Deputy is the source of truth while Alma roster is being tested. Re-import the latest CSV to refresh shifts. Same CSV name re-imports are idempotent.'
    };
  },

  async importRosterCsv(input: { csv: string; filename?: string; dryRun?: boolean; actor: AuthUser }): Promise<DeputyImportResult> {
    assertCanImportDeputy(input.actor);
    const csv = (input.csv ?? '').trim();
    if (!csv) {
      throw new HttpError(400, 'No CSV content supplied. Paste the Deputy roster CSV or upload the file.');
    }
    const filename = (input.filename || `deputy-${new Date().toISOString().slice(0, 10)}.csv`).trim();
    const marker = importMarker(filename);
    const skippedRows: DeputyImportResult['skippedRows'] = [];

    const rows = toObjects(parseCsv(csv.replace(/^﻿/, '')));
    if (rows.length === 0) {
      throw new HttpError(400, 'No usable rows found in the CSV. Make sure the header row is included.');
    }

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

    const result: DeputyImportResult = {
      source: filename,
      mode: input.dryRun ? 'dry-run' : 'live',
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
      },
      importedAt: new Date().toISOString(),
      importedBy: `${input.actor.firstName} ${input.actor.lastName}`.trim() || input.actor.email || input.actor.id
    };

    if (input.dryRun) return result;

    // Idempotency: wipe previously-imported shifts in the same date range
    // (matched by the same marker) before re-creating, so a re-run of the
    // same CSV doesn't duplicate.
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
      const { profile, created, unallocated } = await findOrCreateStaff(entry.row, marker);
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
};
