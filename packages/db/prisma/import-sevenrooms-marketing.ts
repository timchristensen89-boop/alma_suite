import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type SourceRow = Record<string, string>;

type MappedReserveGuest = {
  venue: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  tags: string[];
  allergyNotes: string | null;
  visitNotes: string | null;
  notes: string | null;
  dietaryNotes: string | null;
  preferences: Record<string, unknown>;
  marketingOptIn: boolean;
  emailUnsubscribedAt: string | null;
  smsUnsubscribedAt: string | null;
  source: 'sevenrooms';
  totalVisits: number;
  totalSpendCents: number;
  noShowCount: number;
  lastVisitAt: string | null;
  firstVisitAt: string | null;
  dryRunDedupeKey: string;
};

type MappedMarketingContact = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  venue: string | null;
  source: 'sevenrooms';
  tags: string[];
  consentEmail: boolean;
  consentSms: boolean;
  totalVisits: number;
  lastVisitAt: string | null;
  allergyNotes: string | null;
  notes: string | null;
  dryRunDedupeKey: string;
};

type InvalidRow = {
  row: number;
  reason: string;
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const KNOWN_COLUMNS = new Set([
  'venue',
  'first_name',
  'last_name',
  'full_name',
  'name',
  'email',
  'phone',
  'mobile',
  'birthday',
  'date_of_birth',
  'tags',
  'allergy_notes',
  'allergies',
  'dietary_notes',
  'visit_notes',
  'notes',
  'marketing_opt_in',
  'email_opt_in',
  'sms_opt_in',
  'email_unsubscribed',
  'sms_unsubscribed',
  'email_unsubscribed_at',
  'sms_unsubscribed_at',
  'total_visits',
  'visits',
  'total_spend',
  'total_spend_cents',
  'no_show_count',
  'last_visit_at',
  'last_visit',
  'first_visit_at',
  'first_visit',
  'created_at',
  'updated_at',
  'sevenrooms_guest_id',
  'sevenrooms_client_id',
  'client_id',
  'guest_id'
]);

const OPTIONAL_COLUMNS = [
  'phone',
  'birthday',
  'tags',
  'allergy_notes',
  'dietary_notes',
  'visit_notes',
  'marketing_opt_in',
  'email_unsubscribed',
  'sms_unsubscribed',
  'total_visits',
  'total_spend',
  'last_visit_at',
  'first_visit_at'
];

function printHelp() {
  console.log(`Usage:
  pnpm db:import:sevenrooms-marketing -- --file tmp/sevenrooms-customers.csv --dry-run
  pnpm db:import:sevenrooms-marketing -- tmp/sevenrooms-customers.json

This helper is intentionally dry-run only. It does not connect to a database,
does not require credentials, and does not write customers or marketing contacts.

Accepted CSV/JSON columns:
  venue, first_name, last_name, full_name, email, phone, birthday, tags,
  allergy_notes, dietary_notes, visit_notes, notes, marketing_opt_in,
  email_opt_in, sms_opt_in, email_unsubscribed, sms_unsubscribed,
  total_visits, total_spend, no_show_count, last_visit_at, first_visit_at,
  sevenrooms_guest_id

Required:
  first_name and last_name, or full_name/name
  email or phone

Output:
  ReserveGuest and MarketingContact mapping previews, counts by venue,
  duplicate-looking rows, invalid rows, and optional fields missing.`);
}

function parseArgs() {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  let file: string | null = null;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--dry-run') continue;
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
    row[normaliseHeader(key)] = entry === null || entry === undefined ? '' : String(entry).trim();
  });
  return row;
}

function jsonObjects(text: string) {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed.map(normaliseJsonRecord);
  if (parsed && typeof parsed === 'object') {
    const record = parsed as Record<string, unknown>;
    for (const key of ['rows', 'guests', 'customers', 'contacts', 'data']) {
      if (Array.isArray(record[key])) return record[key].map(normaliseJsonRecord);
    }
  }
  throw new Error('JSON must be an array or an object with rows/guests/customers/contacts/data.');
}

async function loadRows(file: string) {
  const resolved = path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file);
  const text = await fs.readFile(resolved, 'utf8');
  const extension = path.extname(resolved).toLowerCase();
  if (extension === '.csv') return { resolved, rows: csvObjects(text) };
  if (extension === '.json') return { resolved, rows: jsonObjects(text) };
  throw new Error('Unsupported file type. Use .csv or .json.');
}

function cleanText(value?: string) {
  return value?.trim() || '';
}

function nullableText(value?: string) {
  return cleanText(value) || null;
}

function normaliseVenue(value: string) {
  const normalised = value.trim().toLowerCase();
  if (!normalised) return null;
  if (normalised.includes('avalon')) return 'Alma Avalon';
  if (normalised.includes('freshwater') || normalised.includes('st alma') || normalised.includes('st. alma')) return 'St Alma';
  return value.trim();
}

function parseName(row: SourceRow) {
  const firstName = cleanText(row.first_name);
  const lastName = cleanText(row.last_name);
  if (firstName || lastName) return { firstName: firstName || 'Guest', lastName };

  const fullName = cleanText(row.full_name) || cleanText(row.name);
  const parts = fullName.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1) ?? '' };
}

function normaliseEmail(value?: string) {
  const email = cleanText(value).toLowerCase();
  if (!email) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalisePhone(row: SourceRow) {
  return nullableText(row.phone) ?? nullableText(row.mobile);
}

function parseBoolean(value?: string) {
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (['true', 'yes', 'y', '1', 'subscribed', 'opted in', 'opt-in', 'opt in'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'unsubscribed', 'opted out', 'opt-out', 'opt out'].includes(text)) return false;
  return null;
}

function parseDate(value?: string) {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseInteger(value: string | undefined, fallback = 0) {
  const text = cleanText(value);
  if (!text) return fallback;
  const number = Number(text.replace(/[$,]/g, ''));
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function parseSpendCents(row: SourceRow) {
  if (cleanText(row.total_spend_cents)) return parseInteger(row.total_spend_cents);
  const spend = Number(cleanText(row.total_spend).replace(/[$,]/g, ''));
  return Number.isFinite(spend) ? Math.max(0, Math.round(spend * 100)) : 0;
}

function splitTags(value?: string) {
  return cleanText(value)
    .split(/[;,|]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function dedupeKey(venue: string | null, email: string | null, phone: string | null, firstName: string, lastName: string) {
  if (email) return `${venue ?? 'unknown'}:email:${email}`;
  if (phone) return `${venue ?? 'unknown'}:phone:${phone.replace(/\s+/g, '')}`;
  return `${venue ?? 'unknown'}:name:${firstName.toLowerCase()} ${lastName.toLowerCase()}`.trim();
}

function mapRow(row: SourceRow, index: number): { guest: MappedReserveGuest | null; contact: MappedMarketingContact | null; invalid: InvalidRow | null } {
  const errors: string[] = [];
  const venue = normaliseVenue(row.venue ?? '');
  const { firstName, lastName } = parseName(row);
  const email = normaliseEmail(row.email);
  const rawEmail = cleanText(row.email);
  const phone = normalisePhone(row);
  const marketingOptIn = parseBoolean(row.marketing_opt_in) ?? parseBoolean(row.email_opt_in) ?? false;
  const emailUnsubscribed = parseBoolean(row.email_unsubscribed);
  const smsUnsubscribed = parseBoolean(row.sms_unsubscribed);
  const emailUnsubscribedAt = parseDate(row.email_unsubscribed_at) ?? (emailUnsubscribed ? new Date(0).toISOString() : null);
  const smsUnsubscribedAt = parseDate(row.sms_unsubscribed_at) ?? (smsUnsubscribed ? new Date(0).toISOString() : null);
  const tags = splitTags(row.tags);
  const birthday = parseDate(row.birthday) ?? parseDate(row.date_of_birth);
  const lastVisitAt = parseDate(row.last_visit_at) ?? parseDate(row.last_visit);
  const firstVisitAt = parseDate(row.first_visit_at) ?? parseDate(row.first_visit);
  const totalVisits = parseInteger(row.total_visits ?? row.visits);
  const totalSpendCents = parseSpendCents(row);
  const noShowCount = parseInteger(row.no_show_count);

  if (!firstName && !lastName) errors.push('name is required');
  if (rawEmail && !email) errors.push('email is invalid');
  if (!email && !phone) errors.push('email or phone is required for matching');

  if (errors.length > 0) {
    return { guest: null, contact: null, invalid: { row: index + 2, reason: errors.join('; ') } };
  }

  const dryRunDedupeKey = dedupeKey(venue, email, phone, firstName, lastName);
  const allergyNotes = nullableText(row.allergy_notes) ?? nullableText(row.allergies);
  const notes = nullableText(row.notes);
  const visitNotes = nullableText(row.visit_notes);
  const dietaryNotes = nullableText(row.dietary_notes);
  const sevenRoomsId = nullableText(row.sevenrooms_guest_id) ?? nullableText(row.sevenrooms_client_id) ?? nullableText(row.client_id) ?? nullableText(row.guest_id);
  const preferences: Record<string, unknown> = {};
  if (sevenRoomsId) preferences.sevenRoomsGuestId = sevenRoomsId;

  const guest: MappedReserveGuest = {
    venue,
    firstName: firstName || 'Guest',
    lastName,
    email,
    phone,
    birthday,
    tags,
    allergyNotes,
    visitNotes,
    notes,
    dietaryNotes,
    preferences,
    marketingOptIn,
    emailUnsubscribedAt,
    smsUnsubscribedAt,
    source: 'sevenrooms',
    totalVisits,
    totalSpendCents,
    noShowCount,
    lastVisitAt,
    firstVisitAt,
    dryRunDedupeKey
  };

  const contact: MappedMarketingContact = {
    firstName: guest.firstName,
    lastName: guest.lastName,
    email,
    phone,
    venue,
    source: 'sevenrooms',
    tags,
    consentEmail: Boolean(marketingOptIn && email && !emailUnsubscribedAt),
    consentSms: Boolean((parseBoolean(row.sms_opt_in) ?? marketingOptIn) && phone && !smsUnsubscribedAt),
    totalVisits,
    lastVisitAt,
    allergyNotes: dietaryNotes ?? allergyNotes,
    notes: notes ?? visitNotes,
    dryRunDedupeKey
  };

  return { guest, contact, invalid: null };
}

function summarizeMissingOptional(rows: SourceRow[]) {
  return OPTIONAL_COLUMNS
    .map((column) => ({ column, missing: rows.filter((row) => !row[column]?.trim()).length }))
    .filter((entry) => entry.missing > 0);
}

function countByVenue<T extends { venue: string | null }>(rows: T[]) {
  return rows.reduce((counts, row) => {
    const venue = row.venue ?? 'No venue';
    counts.set(venue, (counts.get(venue) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

function duplicateKeys(rows: Array<{ dryRunDedupeKey: string }>) {
  const counts = new Map<string, number>();
  rows.forEach((row) => counts.set(row.dryRunDedupeKey, (counts.get(row.dryRunDedupeKey) ?? 0) + 1));
  return Array.from(counts.entries()).filter(([, count]) => count > 1);
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
  if (!args.file) throw new Error('A local SevenRooms customer CSV or JSON file path is required. Use --file <path>.');

  const { resolved, rows } = await loadRows(args.file);
  const guests: MappedReserveGuest[] = [];
  const contacts: MappedMarketingContact[] = [];
  const invalidRows: InvalidRow[] = [];

  rows.forEach((row, index) => {
    const mapped = mapRow(row, index);
    if (mapped.guest) guests.push(mapped.guest);
    if (mapped.contact) contacts.push(mapped.contact);
    if (mapped.invalid) invalidRows.push(mapped.invalid);
  });

  const columns = new Set(rows.flatMap((row) => Object.keys(row)));
  const unknownColumns = Array.from(columns).filter((column) => !KNOWN_COLUMNS.has(column));
  const duplicates = duplicateKeys(guests);

  console.log('SevenRooms Marketing dry-run importer');
  console.log(`Source: ${resolved}`);
  console.log(`Rows read: ${rows.length}`);
  console.log('Mode: dry-run only. No database connection was opened and no data was written.');

  printCounts('ReserveGuest previews by venue', countByVenue(guests));
  printCounts('MarketingContact previews by venue', countByVenue(contacts));

  console.log('\nConsent summary');
  console.log(`  Email consent: ${contacts.filter((contact) => contact.consentEmail).length}`);
  console.log(`  SMS consent: ${contacts.filter((contact) => contact.consentSms).length}`);
  console.log(`  Missing email: ${contacts.filter((contact) => !contact.email).length}`);
  console.log(`  Missing phone: ${contacts.filter((contact) => !contact.phone).length}`);

  console.log('\nDuplicate-looking rows');
  if (duplicates.length === 0) {
    console.log('  None');
  } else {
    duplicates.forEach(([key, count]) => console.log(`  ${key}: ${count}`));
  }

  console.log('\nMissing optional fields');
  const missingOptional = summarizeMissingOptional(rows);
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

  printPreview('ReserveGuest preview', guests);
  printPreview('MarketingContact preview', contacts);

  console.log('\nInvalid rows');
  if (invalidRows.length === 0) {
    console.log('  None');
  } else {
    invalidRows.forEach((row) => console.log(`  Row ${row.row}: ${row.reason}`));
  }

  if (invalidRows.length > 0 || duplicates.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
