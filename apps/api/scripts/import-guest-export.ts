/**
 * Import a booking-system guest export.
 *
 *   node --import tsx scripts/import-guest-export.ts <file.csv> [--apply]
 *
 * Dry run by default. Recognises the SevenRooms client export and the
 * no-email extract by their headers, so the caller does not have to say which
 * is which.
 */
import { readFileSync } from 'node:fs';
import {
  normaliseEmail,
  normalisePhone,
  parseConsent,
  parseCount,
  parseExportDate,
  parseMoneyCents,
  parseTags,
  type ImportedGuest
} from '@alma/shared';
import { guestImportService } from '../src/services/guest-crm.service.js';

/** Minimal RFC-4180 reader: the export quotes fields containing commas. */
function readCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = (rows.shift() ?? []).map((h) => h.replace(/^﻿/, '').trim());
  return rows
    .filter((r) => r.some((cell) => cell.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('usage: import-guest-export.ts <file.csv> [--apply]'); process.exit(1); }
const apply = flags.includes('--apply');

const records = readCsv(readFileSync(file, 'utf8'));
const columns = new Set(Object.keys(records[0] ?? {}));

let guests: ImportedGuest[];
if (columns.has('Client First Name')) {
  // SevenRooms client export. Consent is per venue and must stay that way.
  guests = records.map((r) => ({
    firstName: (r['Client First Name'] ?? '').trim(),
    lastName: (r['Client Last Name'] ?? '').trim(),
    email: normaliseEmail(r.Email) ?? normaliseEmail(r['Alt Email']),
    phone: normalisePhone(r.Phone) ?? normalisePhone(r['Work Phone']),
    visits: parseCount(r.Visits),
    noShows: parseCount(r['No Shows']),
    cancels: parseCount(r.Cancels),
    spendCents: parseMoneyCents(r['Total Spend']),
    lastVisitAt: parseExportDate(r['Last Visit']),
    birthday: parseExportDate(r.Birthday),
    tags: parseTags(r.Tags),
    consent: {
      'St Alma': parseConsent(r['St Alma Marketing Opt-In']),
      'Alma Avalon': parseConsent(r['Alma Avalon Marketing Opt-In'])
    },
    venue: (r['Last Location'] ?? '').trim() || null
  }));
} else if (columns.has('First Name') && columns.has('OptIn')) {
  // The no-email extract: phone-only guests, single opt-in, single venue.
  guests = records.map((r) => {
    const venue = (r.Venue ?? '').trim() || null;
    return {
      firstName: (r['First Name'] ?? '').trim(),
      lastName: (r['Last Name'] ?? '').trim(),
      email: null,
      phone: normalisePhone(r.Phone),
      visits: parseCount(r.Visits),
      noShows: 0,
      cancels: 0,
      spendCents: parseMoneyCents(r.Spend),
      lastVisitAt: parseExportDate(r.LastVisit),
      birthday: null,
      tags: parseTags(r.Tags),
      consent: venue ? { [venue]: parseConsent(r.OptIn) } : {},
      venue
    };
  });
} else {
  console.error('Unrecognised export. Expected a SevenRooms client export or the no-email extract.');
  process.exit(1);
}

const result = await guestImportService.importGuests(guests, { dryRun: !apply });
console.log(JSON.stringify(result, null, 1));
if (!apply) console.log('\nDry run — nothing written. Re-run with --apply.');
process.exit(0);
