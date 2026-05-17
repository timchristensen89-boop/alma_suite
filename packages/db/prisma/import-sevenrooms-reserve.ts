import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SourceRow = Record<string, string>;

type MappedAvailabilityRule = {
  venue: string;
  name: string;
  servicePeriod: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'EVENT' | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  defaultDurationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  intervalMinutes: number;
  capacity: number;
  onlineEnabled: true;
  googleReserveEnabled: boolean;
  notes: string[];
};

type MappedBlackout = {
  venue: string;
  name: string;
  reason: string;
  startAt: string;
  endAt: string;
};

type InvalidRow = {
  row: number;
  reason: string;
};

type Args = {
  file: string | null;
  help: boolean;
};

const KNOWN_COLUMNS = new Set([
  'venue',
  'service_name',
  'access_rule_name',
  'days_of_week',
  'start_time',
  'end_time',
  'party_size_min',
  'party_size_max',
  'booking_interval',
  'duration_minutes',
  'capacity',
  'booking_cutoff',
  'booking_opening_window',
  'closed_dates',
  'special_dates',
  'notes',
  'google_reserve_enabled',
  'sevenrooms_shift_id',
  'sevenrooms_access_rule_id',
  'shift_id',
  'access_rule_id'
]);

const OPTIONAL_COLUMNS = [
  'duration_minutes',
  'booking_cutoff',
  'booking_opening_window',
  'closed_dates',
  'special_dates',
  'notes'
];
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const DAY_ALIASES = new Map<string, number>([
  ['sun', 0],
  ['sunday', 0],
  ['0', 0],
  ['mon', 1],
  ['monday', 1],
  ['1', 1],
  ['tue', 2],
  ['tues', 2],
  ['tuesday', 2],
  ['2', 2],
  ['wed', 3],
  ['wednesday', 3],
  ['3', 3],
  ['thu', 4],
  ['thur', 4],
  ['thurs', 4],
  ['thursday', 4],
  ['4', 4],
  ['fri', 5],
  ['friday', 5],
  ['5', 5],
  ['sat', 6],
  ['saturday', 6],
  ['6', 6]
]);

function parseArgs(): Args {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  let file: string | null = null;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--dry-run') {
      continue;
    }
    if (arg === '--file') {
      const next = args[index + 1];
      if (!next) throw new Error('--file requires a local CSV or JSON path.');
      file = next;
      index += 1;
      continue;
    }
    if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
      continue;
    }
    if (arg.startsWith('--')) {
      throw new Error(`Unsupported flag: ${arg}. This helper is dry-run only.`);
    }
    file = arg;
  }

  return { file, help };
}

function printHelp() {
  console.log(`Usage:
  pnpm db:import:sevenrooms-reserve -- --file tmp/sevenrooms-reserve-export.csv --dry-run
  pnpm db:import:sevenrooms-reserve -- tmp/sevenrooms-reserve-export.json

This helper is intentionally dry-run only. It does not connect to a database,
does not require credentials, and does not write Reserve configuration.

Accepted CSV/JSON columns:
  venue, service_name, access_rule_name, days_of_week, start_time, end_time,
  party_size_min, party_size_max, booking_interval, duration_minutes, capacity,
  booking_cutoff, booking_opening_window, closed_dates, special_dates, notes

Required for availability rows:
  venue, service_name or access_rule_name, days_of_week, start_time, end_time,
  party_size_min, party_size_max, booking_interval, capacity

Output:
  A mapping preview for ReserveAvailabilityRule and ReserveBlackout rows,
  counts by venue, invalid rows, missing optional fields, and notes that need
  schema support before a future write importer can preserve them.`);
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
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      if (char === '\r' && next === '\n') index += 1;
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    if (row.some((value) => value.trim())) rows.push(row);
  }

  return rows;
}

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function csvObjects(text: string) {
  const rows = parseCsv(text);
  const headers = rows[0]?.map(normaliseHeader) ?? [];
  if (headers.length === 0) throw new Error('CSV file is empty or missing a header row.');

  return rows.slice(1).map((row) => {
    const object: SourceRow = {};
    headers.forEach((header, index) => {
      object[header] = row[index]?.trim() ?? '';
    });
    return object;
  });
}

function normaliseJsonRecord(value: unknown): SourceRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON rows must be objects.');
  }
  const row: SourceRow = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    const normalisedKey = normaliseHeader(key);
    row[normalisedKey] = entry === null || entry === undefined ? '' : String(entry).trim();
  });
  return row;
}

function jsonObjects(text: string) {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed.map(normaliseJsonRecord);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    for (const key of ['rows', 'rules', 'availabilityRules', 'availability_rules', 'data']) {
      if (Array.isArray(record[key])) return record[key].map(normaliseJsonRecord);
    }
  }
  throw new Error('JSON must be an array or an object with rows/rules/availabilityRules/data.');
}

async function loadRows(file: string) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file);
  const text = await fs.readFile(resolved, 'utf8');
  const extension = path.extname(resolved).toLowerCase();
  if (extension === '.json') return { resolved, rows: jsonObjects(text) };
  if (extension === '.csv') return { resolved, rows: csvObjects(text) };
  throw new Error('Unsupported file type. Use .csv or .json.');
}

function normaliseVenue(value: string) {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return '';
  if (normalised.includes('avalon')) return 'Alma Avalon';
  if (normalised.includes('freshwater') || normalised.includes('st alma') || normalised.includes('st. alma')) return 'St Alma';
  return value.trim();
}

function parseBoolean(value: string) {
  return /^(true|yes|y|1|enabled)$/i.test(value.trim());
}

function parseTime(value: string) {
  const trimmed = value.trim();
  const twentyFourHour = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHour) {
    const hours = Number(twentyFourHour[1]);
    const minutes = Number(twentyFourHour[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  const twelveHour = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (twelveHour) {
    let hours = Number(twelveHour[1]);
    const minutes = Number(twelveHour[2] ?? '0');
    const meridiem = twelveHour[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  return null;
}

function parseInteger(value: string, label: string, errors: string[], options: { min?: number; max?: number } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    errors.push(`${label} must be an integer`);
    return null;
  }
  if (options.min !== undefined && number < options.min) errors.push(`${label} must be at least ${options.min}`);
  if (options.max !== undefined && number > options.max) errors.push(`${label} must be at most ${options.max}`);
  return number;
}

function parseDayToken(token: string) {
  const value = token.trim().toLowerCase();
  return DAY_ALIASES.get(value);
}

function expandDayRange(start: number, end: number) {
  const days: number[] = [];
  let current = start;
  while (true) {
    days.push(current);
    if (current === end) break;
    current = (current + 1) % 7;
    if (days.length > 7) break;
  }
  return days;
}

function parseDays(value: string) {
  const days = new Set<number>();
  const tokens = value
    .replace(/\band\b/gi, ',')
    .split(/[;,|]/)
    .map((token) => token.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const range = token.split(/\s*-\s*/);
    if (range.length === 2) {
      const start = parseDayToken(range[0] ?? '');
      const end = parseDayToken(range[1] ?? '');
      if (start === undefined || end === undefined) return null;
      expandDayRange(start, end).forEach((day) => days.add(day));
      continue;
    }

    const day = parseDayToken(token);
    if (day === undefined) return null;
    days.add(day);
  }

  return Array.from(days).sort((a, b) => a - b);
}

function inferServicePeriod(value: string): MappedAvailabilityRule['servicePeriod'] {
  const text = value.toLowerCase();
  if (text.includes('breakfast')) return 'BREAKFAST';
  if (text.includes('lunch')) return 'LUNCH';
  if (text.includes('dinner')) return 'DINNER';
  if (text.includes('event') || text.includes('function')) return 'EVENT';
  return null;
}

function splitList(value: string) {
  return value.split(/[;|]/).map((item) => item.trim()).filter(Boolean);
}

function normaliseDate(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${trimmed}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : trimmed;
}

function endExclusiveDate(date: string) {
  const [year = '0', month = '1', day = '1'] = date.split('-');
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  value.setDate(value.getDate() + 1);
  return value.toISOString();
}

function mapBlackouts(row: SourceRow, index: number, invalidRows: InvalidRow[]) {
  const venue = normaliseVenue(row.venue ?? '');
  const notes = row.notes?.trim() || 'Imported from SevenRooms dry-run source.';
  const blackouts: MappedBlackout[] = [];
  const values = [
    ...splitList(row.closed_dates ?? ''),
    ...splitList(row.special_dates ?? '').filter((date) => /\bclosed\b/i.test(date))
  ];

  for (const value of values) {
    const cleaned = value.replace(/\bclosed\b/gi, '').replace(/^:+|:+$/g, '').trim();
    const [startRaw, endRaw] = cleaned.split(/\s*(?:to|\.\.)\s*/);
    const start = normaliseDate(startRaw ?? '');
    const end = normaliseDate(endRaw || startRaw || '');
    if (!venue || !start || !end) {
      invalidRows.push({ row: index + 2, reason: `Invalid blackout date "${value}". Use YYYY-MM-DD or YYYY-MM-DD..YYYY-MM-DD.` });
      continue;
    }
    blackouts.push({
      venue,
      name: row.access_rule_name || row.service_name || 'SevenRooms closed date',
      reason: notes,
      startAt: `${start}T00:00:00.000Z`,
      endAt: endExclusiveDate(end)
    });
  }

  return blackouts;
}

function hasAvailabilityData(row: SourceRow) {
  return [
    'service_name',
    'access_rule_name',
    'days_of_week',
    'start_time',
    'end_time',
    'party_size_min',
    'party_size_max',
    'booking_interval',
    'capacity'
  ].some((key) => Boolean(row[key]?.trim()));
}

function mapAvailabilityRule(row: SourceRow, index: number): { rule: MappedAvailabilityRule | null; invalid: InvalidRow | null } {
  if (!hasAvailabilityData(row)) return { rule: null, invalid: null };

  const errors: string[] = [];
  const venue = normaliseVenue(row.venue ?? '');
  const name = (row.service_name || row.access_rule_name || '').trim();
  const daysOfWeek = parseDays(row.days_of_week ?? '');
  const startTime = parseTime(row.start_time ?? '');
  const endTime = parseTime(row.end_time ?? '');
  const minPartySize = parseInteger(row.party_size_min ?? '', 'party_size_min', errors, { min: 1, max: 50 });
  const maxPartySize = parseInteger(row.party_size_max ?? '', 'party_size_max', errors, { min: 1, max: 50 });
  const intervalMinutes = parseInteger(row.booking_interval ?? '', 'booking_interval', errors, { min: 15, max: 240 });
  const capacity = parseInteger(row.capacity ?? '', 'capacity', errors, { min: 1 });
  const defaultDurationMinutes = row.duration_minutes?.trim()
    ? parseInteger(row.duration_minutes, 'duration_minutes', errors, { min: 30, max: 480 })
    : 120;

  if (!venue) errors.push('venue is required');
  if (!name) errors.push('service_name or access_rule_name is required');
  if (!daysOfWeek || daysOfWeek.length === 0) errors.push('days_of_week is required and must contain valid days');
  if (!startTime) errors.push('start_time must be HH:MM or h:mm AM/PM');
  if (!endTime) errors.push('end_time must be HH:MM or h:mm AM/PM');
  if (startTime && endTime && endTime <= startTime) errors.push('end_time must be after start_time');
  if (minPartySize !== null && maxPartySize !== null && maxPartySize < minPartySize) {
    errors.push('party_size_max must be at least party_size_min');
  }

  if (errors.length > 0 || !daysOfWeek || !startTime || !endTime || minPartySize === null || maxPartySize === null || intervalMinutes === null || capacity === null || defaultDurationMinutes === null) {
    return { rule: null, invalid: { row: index + 2, reason: errors.join('; ') } };
  }

  const notes = [
    row.notes,
    row.booking_cutoff ? `booking_cutoff=${row.booking_cutoff}` : '',
    row.booking_opening_window ? `booking_opening_window=${row.booking_opening_window}` : '',
    row.sevenrooms_shift_id || row.shift_id ? `SevenRooms shift id requires schema support: ${row.sevenrooms_shift_id || row.shift_id}` : '',
    row.sevenrooms_access_rule_id || row.access_rule_id ? `SevenRooms access rule id requires schema support: ${row.sevenrooms_access_rule_id || row.access_rule_id}` : ''
  ].map((note) => note?.trim()).filter(Boolean);

  return {
    invalid: null,
    rule: {
      venue,
      name,
      servicePeriod: inferServicePeriod(name),
      daysOfWeek,
      startTime,
      endTime,
      defaultDurationMinutes,
      minPartySize,
      maxPartySize,
      intervalMinutes,
      capacity,
      onlineEnabled: true,
      googleReserveEnabled: parseBoolean(row.google_reserve_enabled ?? ''),
      notes
    }
  };
}

function summarizeMissingOptional(rows: SourceRow[]) {
  return OPTIONAL_COLUMNS
    .map((column) => ({
      column,
      missing: rows.filter((row) => !row[column]?.trim()).length
    }))
    .filter((entry) => entry.missing > 0);
}

function countByVenue<T extends { venue: string }>(rows: T[]) {
  return rows.reduce((counts, row) => {
    counts.set(row.venue, (counts.get(row.venue) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function printCounts(title: string, counts: Map<string, number>) {
  console.log(`\n${title}`);
  if (counts.size === 0) {
    console.log('  None');
    return;
  }
  for (const [venue, count] of Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${venue}: ${count}`);
  }
}

function printPreview<T>(title: string, rows: T[]) {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log('  None');
    return;
  }
  console.log(JSON.stringify(rows.slice(0, 5), null, 2));
  if (rows.length > 5) console.log(`  ...${rows.length - 5} more`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.file) {
    throw new Error('A local SevenRooms CSV or JSON file path is required. Use --file <path>.');
  }

  const { resolved, rows } = await loadRows(args.file);
  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  const unknownColumns = Array.from(columns).filter((column) => !KNOWN_COLUMNS.has(column));
  const availabilityRules: MappedAvailabilityRule[] = [];
  const blackouts: MappedBlackout[] = [];
  const invalidRows: InvalidRow[] = [];

  rows.forEach((row, index) => {
    const mapped = mapAvailabilityRule(row, index);
    if (mapped.rule) availabilityRules.push(mapped.rule);
    if (mapped.invalid) invalidRows.push(mapped.invalid);
    blackouts.push(...mapBlackouts(row, index, invalidRows));
  });

  console.log('SevenRooms Reserve dry-run importer');
  console.log(`Source: ${resolved}`);
  console.log(`Rows read: ${rows.length}`);
  console.log('Mode: dry-run only. No database connection was opened and no data was written.');

  printCounts('Availability rules by venue', countByVenue(availabilityRules));
  printCounts('Blackouts by venue', countByVenue(blackouts));

  const missingOptional = summarizeMissingOptional(rows);
  console.log('\nMissing optional fields');
  if (missingOptional.length === 0) {
    console.log('  None');
  } else {
    missingOptional.forEach((entry) => console.log(`  ${entry.column}: missing on ${entry.missing} row(s)`));
  }

  console.log('\nUnrecognised columns');
  if (unknownColumns.length === 0) {
    console.log('  None');
  } else {
    unknownColumns.forEach((column) => console.log(`  ${column}: ignored in dry-run output`));
  }

  printPreview('ReserveAvailabilityRule preview', availabilityRules);
  printPreview('ReserveBlackout preview', blackouts);

  console.log('\nInvalid rows');
  if (invalidRows.length === 0) {
    console.log('  None');
  } else {
    invalidRows.forEach((row) => console.log(`  Row ${row.row}: ${row.reason}`));
  }

  if (invalidRows.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
