/**
 * One-shot importer for the St Alma SevenRooms configuration into
 * Alma Reserve. Idempotent — re-running upserts by (venue, label) for
 * tables and by (venue, name) for availability rules. Run with:
 *
 *   pnpm --filter @alma/db import:stalma-reserve
 *
 * Data source: the four PDFs the operator exported from SevenRooms
 * (shifts, tables, table combinations, reservation statuses). Captured
 * here as inline literals so the script is self-documenting and
 * reproducible; if anything drifts in SevenRooms, edit this file and
 * re-run.
 *
 * What gets created / updated:
 *   - 19 base tables across "Bar Stools", "Dining Room", "Kitchen Stools"
 *   - 9 combination "virtual" tables under "Combinations" (high sortOrder
 *     so they sit at the bottom of the admin floor plan list — first-class
 *     combination conflict-checking is a follow-up, but the rows make
 *     the cover ranges discoverable to the host)
 *   - 3 availability rules: Day Fr-Su, Tuesday, Wed-Thu
 *
 * Known mappings / lossy bits:
 *   - SevenRooms' per-party-size durations collapse to a single
 *     defaultDurationMinutes (we pick 120 = 2h to match the bulk of
 *     1-4 guest bookings; the host can extend the table manually for
 *     larger parties as they always could).
 *   - SevenRooms' custom per-time pacing (e.g. 6:15-7:30pm tighter on
 *     the Day shift) collapses to a single capacity = 40 covers per
 *     interval, matching the dominant pacing setting.
 *   - SevenRooms in-service reservation statuses (Seated / 1st Course /
 *     Order Placed / etc.) are SevenRooms-specific UI; Alma Reserve has
 *     its own status enum (PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED
 *     /NO_SHOW). No mapping needed — Alma's lifecycle is a superset.
 *   - Tuesday vs Wed-Thu: the operator's typed snippet collapsed both
 *     into "Tue-Thu" but the calendar PDF shows Tuesday with its own
 *     5pm–8:30pm shift while Wed-Thu runs 5pm–8:15pm. We model that
 *     visible difference; flip the script if you want them merged.
 */

import { prisma } from '../src/index.js';

const VENUE = 'St Alma';

type TableSeed = {
  area: string;
  label: string;
  minCovers: number;
  maxCovers: number;
  sortOrder: number;
};

const BASE_TABLES: TableSeed[] = [
  // Bar Stools (3) — lowest sortOrder so they sit at the top of the
  // admin list under their area heading.
  { area: 'Bar Stools',     label: 'B1',   minCovers: 1, maxCovers: 2, sortOrder: 10 },
  { area: 'Bar Stools',     label: 'B2',   minCovers: 1, maxCovers: 2, sortOrder: 20 },
  { area: 'Bar Stools',     label: 'B3',   minCovers: 1, maxCovers: 2, sortOrder: 30 },

  // Dining Room (15)
  { area: 'Dining Room',    label: '10',   minCovers: 1, maxCovers: 2, sortOrder: 100 },
  { area: 'Dining Room',    label: '11',   minCovers: 1, maxCovers: 2, sortOrder: 110 },
  { area: 'Dining Room',    label: '20',   minCovers: 3, maxCovers: 5, sortOrder: 200 },
  { area: 'Dining Room',    label: '21',   minCovers: 3, maxCovers: 5, sortOrder: 210 },
  { area: 'Dining Room',    label: '30',   minCovers: 3, maxCovers: 4, sortOrder: 300 },
  { area: 'Dining Room',    label: '31',   minCovers: 3, maxCovers: 4, sortOrder: 310 },
  { area: 'Dining Room',    label: '32',   minCovers: 3, maxCovers: 4, sortOrder: 320 },
  { area: 'Dining Room',    label: '40',   minCovers: 1, maxCovers: 2, sortOrder: 400 },
  { area: 'Dining Room',    label: '41',   minCovers: 1, maxCovers: 2, sortOrder: 410 },
  { area: 'Dining Room',    label: '42',   minCovers: 1, maxCovers: 2, sortOrder: 420 },
  { area: 'Dining Room',    label: '50',   minCovers: 1, maxCovers: 2, sortOrder: 500 },
  { area: 'Dining Room',    label: '51',   minCovers: 1, maxCovers: 2, sortOrder: 510 },
  { area: 'Dining Room',    label: '52',   minCovers: 1, maxCovers: 2, sortOrder: 520 },
  { area: 'Dining Room',    label: 'Com1', minCovers: 4, maxCovers: 6, sortOrder: 600 },
  { area: 'Dining Room',    label: 'Com2', minCovers: 4, maxCovers: 10, sortOrder: 610 },

  // Kitchen Stools (1)
  { area: 'Kitchen Stools', label: 'K2',   minCovers: 1, maxCovers: 2, sortOrder: 700 }
];

// SevenRooms-style combinations. Modelled as separate "virtual" rows
// in a Combinations area with sortOrder 900+ so they sit at the bottom
// of the admin list. The conflict checking (when Com1+Com2 is booked,
// hide Com1 and Com2 from the same slot) is NOT enforced yet — that
// needs first-class combination support in the schema + booking
// service. Surfacing the rows up front lets the host see the cover
// ranges and choose the right combination manually.
const COMBINATION_TABLES: TableSeed[] = [
  { area: 'Combinations', label: '40+41',      minCovers: 3,  maxCovers: 5,  sortOrder: 900 },
  { area: 'Combinations', label: '40+41+42',   minCovers: 6,  maxCovers: 7,  sortOrder: 910 },
  { area: 'Combinations', label: '41+42',      minCovers: 3,  maxCovers: 5,  sortOrder: 920 },
  { area: 'Combinations', label: '50+51',      minCovers: 3,  maxCovers: 5,  sortOrder: 930 },
  { area: 'Combinations', label: '50+51+52',   minCovers: 6,  maxCovers: 7,  sortOrder: 940 },
  { area: 'Combinations', label: '51+52',      minCovers: 3,  maxCovers: 5,  sortOrder: 950 },
  { area: 'Combinations', label: 'B1+B2',      minCovers: 3,  maxCovers: 3,  sortOrder: 960 },
  { area: 'Combinations', label: 'B2+B3',      minCovers: 3,  maxCovers: 3,  sortOrder: 970 },
  { area: 'Combinations', label: 'Com1+Com2',  minCovers: 10, maxCovers: 18, sortOrder: 980 }
];

type RuleSeed = {
  name: string;
  daysOfWeek: number[]; // JS Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat
  startTime: string;
  endTime: string;
  defaultDurationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  intervalMinutes: number;
  capacity: number;
  servicePeriod: 'BREAKFAST' | 'LUNCH' | 'DINNER' | 'EVENT' | null;
};

const RULES: RuleSeed[] = [
  {
    name: 'Day · Fri–Sun',
    daysOfWeek: [0, 5, 6], // Sun, Fri, Sat
    startTime: '12:00',
    endTime: '20:45',
    defaultDurationMinutes: 120,
    minPartySize: 1,
    maxPartySize: 18,
    intervalMinutes: 15,
    capacity: 40,
    servicePeriod: 'DINNER' // SevenRooms 'Day' meal period spans lunch + dinner; tagging DINNER as the dominant tail.
  },
  {
    name: 'Tuesday · dinner',
    daysOfWeek: [2], // Tue
    startTime: '17:00',
    endTime: '20:30',
    defaultDurationMinutes: 120,
    minPartySize: 1,
    maxPartySize: 18,
    intervalMinutes: 15,
    capacity: 40,
    servicePeriod: 'DINNER'
  },
  {
    name: 'Wed–Thu · dinner',
    daysOfWeek: [3, 4], // Wed, Thu
    startTime: '17:00',
    endTime: '20:15',
    defaultDurationMinutes: 120,
    minPartySize: 1,
    maxPartySize: 18,
    intervalMinutes: 15,
    capacity: 40,
    servicePeriod: 'DINNER'
  }
];

async function upsertTable(seed: TableSeed) {
  return prisma.reserveTable.upsert({
    where: { venue_label: { venue: VENUE, label: seed.label } },
    create: {
      venue: VENUE,
      area: seed.area,
      label: seed.label,
      minCovers: seed.minCovers,
      maxCovers: seed.maxCovers,
      sortOrder: seed.sortOrder,
      isActive: true
    },
    update: {
      area: seed.area,
      minCovers: seed.minCovers,
      maxCovers: seed.maxCovers,
      sortOrder: seed.sortOrder,
      isActive: true
    }
  });
}

async function upsertRule(seed: RuleSeed) {
  const existing = await prisma.reserveAvailabilityRule.findFirst({
    where: { venue: VENUE, name: seed.name }
  });
  const data = {
    venue: VENUE,
    name: seed.name,
    servicePeriod: seed.servicePeriod,
    daysOfWeek: seed.daysOfWeek,
    startTime: seed.startTime,
    endTime: seed.endTime,
    defaultDurationMinutes: seed.defaultDurationMinutes,
    minPartySize: seed.minPartySize,
    maxPartySize: seed.maxPartySize,
    intervalMinutes: seed.intervalMinutes,
    capacity: seed.capacity,
    onlineEnabled: true,
    googleReserveEnabled: false,
    active: true
  } as const;
  if (existing) {
    return prisma.reserveAvailabilityRule.update({ where: { id: existing.id }, data });
  }
  return prisma.reserveAvailabilityRule.create({ data });
}

async function main() {
  console.log(`Importing St Alma reserve config into venue "${VENUE}"`);

  let tablesCreatedOrUpdated = 0;
  for (const seed of [...BASE_TABLES, ...COMBINATION_TABLES]) {
    await upsertTable(seed);
    tablesCreatedOrUpdated += 1;
  }
  console.log(`  ✓ ${tablesCreatedOrUpdated} tables (${BASE_TABLES.length} base + ${COMBINATION_TABLES.length} combinations)`);

  let rulesCreatedOrUpdated = 0;
  for (const seed of RULES) {
    await upsertRule(seed);
    rulesCreatedOrUpdated += 1;
  }
  console.log(`  ✓ ${rulesCreatedOrUpdated} availability rules`);

  console.log('Done. Open Admin → Reserve → Floor plan / Availability to confirm.');
}

main()
  .catch((error) => {
    console.error('Import failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
