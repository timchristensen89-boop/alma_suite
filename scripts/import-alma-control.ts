import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AlmaAppId,
  LiquorLicenceStatus,
  LiquorLicenceType,
  Prisma,
  StaffAppAccessStatus,
  StaffRecordStatus,
  StaffRecordType,
  StockItemStatus,
  StocktakeStatus,
  SupplierStatus
} from '@prisma/client';
import { prisma } from '../packages/db/src/prisma.js';
import {
  asArray,
  asDate,
  asNumber,
  asRecord,
  asString,
  importCompliancePayload,
  nullableString
} from '../packages/db/prisma/compliance-import.js';

type JsonRecord = Record<string, unknown>;
type SummaryKey =
  | 'appSettings'
  | 'venues'
  | 'staffProfiles'
  | 'staffAppAccess'
  | 'staffComplianceRecords'
  | 'compliance'
  | 'incidentReports'
  | 'licences'
  | 'temperatureAssets'
  | 'temperatureLogs'
  | 'stockCategories'
  | 'stockItems'
  | 'stocktakes'
  | 'stocktakeLines'
  | 'suppliers'
  | 'recipes'
  | 'recipeLines';
type SummaryRow = { read: number; created: number; updated: number; skipped: number };

type CliArgs = {
  dryRun: boolean;
  file: string;
  trustedOpeningBalances: boolean;
};

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = 'tmp/alma-control-export.json';
const APP_IDS: AlmaAppId[] = ['COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'SETTINGS'];

const summary = Object.fromEntries(
  (
    [
      'appSettings',
      'venues',
      'staffProfiles',
      'staffAppAccess',
      'staffComplianceRecords',
      'compliance',
      'incidentReports',
      'licences',
      'temperatureAssets',
      'temperatureLogs',
      'stockCategories',
      'stockItems',
      'stocktakes',
      'stocktakeLines',
      'suppliers',
      'recipes',
      'recipeLines'
    ] as SummaryKey[]
  ).map((key) => [key, { read: 0, created: 0, updated: 0, skipped: 0 }])
) as Record<SummaryKey, SummaryRow>;

const errors: string[] = [];
const warnings: string[] = [];

function inc(key: SummaryKey, field: keyof SummaryRow, amount = 1) {
  summary[key][field] += amount;
}

function resetSummary() {
  for (const row of Object.values(summary)) {
    row.read = 0;
    row.created = 0;
    row.updated = 0;
    row.skipped = 0;
  }
  errors.length = 0;
  warnings.length = 0;
}

function parseArgs(argv: string[]): CliArgs {
  let file = process.env.ALMA_CONTROL_IMPORT_FILE ?? DEFAULT_FILE;
  let dryRun = false;
  let trustedOpeningBalances = process.env.ALMA_CONTROL_TRUSTED_OPENING_BALANCES === 'true';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--':
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--trusted-opening-balances':
        trustedOpeningBalances = true;
        break;
      case '--file': {
        const next = argv[index + 1];

        if (!next) {
          throw new Error('--file requires a path.');
        }

        file = next;
        index += 1;
        break;
      }
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dryRun, file, trustedOpeningBalances };
}

function printHelp() {
  console.log(`Usage:
  pnpm db:import:alma-control -- --file tmp/alma-control-export.json --dry-run
  pnpm db:import:alma-control -- --file tmp/alma-control-export.json
  pnpm db:import:alma-control -- --file tmp/alma-control-export.json --trusted-opening-balances

Options:
  --file <path>                    Alma Control JSON export. Defaults to ${DEFAULT_FILE}
  --dry-run                        Validate and summarize without writing.
  --trusted-opening-balances       Import stock onHand/currentBalance as opening baseline values.
`);
}

function normalizeFilePath(file: string) {
  return resolve(REPO_ROOT, file);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function stringValue(record: JsonRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = asString(record[key]);

    if (value) {
      return value;
    }
  }

  return fallback;
}

function numberValue(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = asNumber(record[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function legacyId(record: JsonRecord, prefix: string, index: number) {
  return (
    nullableString(record.legacyId) ??
    nullableString(record.id) ??
    nullableString(record._id) ??
    `${prefix}:${index + 1}`
  );
}

function requireString(record: JsonRecord, keys: string[], label: string, collection: string, index: number) {
  const value = stringValue(record, keys);

  if (!value) {
    errors.push(`${collection}[${index}] is missing ${label}.`);
  }

  return value;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T) {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_') as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeAppId(value: unknown): AlmaAppId | null {
  const normalized = asString(value).toUpperCase().replace(/[\s-]+/g, '_') as AlmaAppId;
  return APP_IDS.includes(normalized) ? normalized : null;
}

function payloadArray(payload: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const values = asArray(payload[key]);

    if (values.length) {
      return values;
    }
  }

  return [];
}

async function readPayload(filePath: string) {
  const raw = await readFile(filePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  const record = asRecord(parsed);

  if (!record) {
    throw new Error('Alma Control import file must be a JSON object.');
  }

  return record;
}

async function upsertVenue(raw: unknown, index: number, dryRun: boolean) {
  const record = asRecord(raw);

  if (!record) {
    inc('venues', 'skipped');
    return null;
  }

  inc('venues', 'read');
  const name = requireString(record, ['name', 'venue'], 'name', 'venues', index);
  const slug = stringValue(record, ['slug'], slugify(name));

  if (!name || !slug) {
    inc('venues', 'skipped');
    return null;
  }

  const existing = await prisma.venue.findUnique({ where: { slug }, select: { id: true } });

  if (dryRun) {
    inc('venues', existing ? 'updated' : 'created');
    return null;
  }

  await prisma.venue.upsert({
    where: { slug },
    update: {
      name,
      address: nullableString(record.address),
      lga: nullableString(record.lga)
    },
    create: {
      name,
      slug,
      address: nullableString(record.address),
      lga: nullableString(record.lga)
    }
  });
  inc('venues', existing ? 'updated' : 'created');
  return name;
}

async function importSettings(payload: JsonRecord, dryRun: boolean) {
  const settings = asRecord(payload.appSettings ?? payload.settings);

  if (!settings) {
    return;
  }

  inc('appSettings', 'read');
  const existing = await prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { id: true } });

  if (dryRun) {
    inc('appSettings', existing ? 'updated' : 'created');
    return;
  }

  await prisma.appSettings.upsert({
    where: { id: 'singleton' },
    update: {
      orgName: stringValue(settings, ['orgName', 'organisationName'], 'Alma Group'),
      primaryContactName: nullableString(settings.primaryContactName),
      primaryContactEmail: nullableString(settings.primaryContactEmail),
      primaryContactPhone: nullableString(settings.primaryContactPhone),
      venues: settings.venues === undefined ? [] : (settings.venues as Prisma.InputJsonValue)
    },
    create: {
      id: 'singleton',
      orgName: stringValue(settings, ['orgName', 'organisationName'], 'Alma Group'),
      primaryContactName: nullableString(settings.primaryContactName),
      primaryContactEmail: nullableString(settings.primaryContactEmail),
      primaryContactPhone: nullableString(settings.primaryContactPhone),
      venues: settings.venues === undefined ? [] : (settings.venues as Prisma.InputJsonValue)
    }
  });
  inc('appSettings', existing ? 'updated' : 'created');
}

async function importStaff(payload: JsonRecord, dryRun: boolean) {
  const staff = payloadArray(payload, ['staffProfiles', 'staff', 'employees']);
  const emailToId = new Map<string, string>();

  for (const [index, raw] of staff.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('staffProfiles', 'skipped');
      continue;
    }

    inc('staffProfiles', 'read');
    const email = stringValue(record, ['email', 'emailAddress']).toLowerCase();
    const firstName = requireString(record, ['firstName', 'givenName'], 'firstName', 'staffProfiles', index);
    const lastName = requireString(record, ['lastName', 'familyName', 'surname'], 'lastName', 'staffProfiles', index);

    if (!email) {
      errors.push(`staffProfiles[${index}] is missing email. Staff import requires email for duplicate protection and invite/reset flow.`);
      inc('staffProfiles', 'skipped');
      continue;
    }

    const existing = await prisma.staffProfile.findUnique({ where: { email }, select: { id: true } });

    if (dryRun) {
      inc('staffProfiles', existing ? 'updated' : 'created');
      emailToId.set(email, existing?.id ?? `dry-run:${email}`);
    } else {
      const profile = await prisma.staffProfile.upsert({
        where: { email },
        update: {
          firstName,
          lastName,
          roleTitle: stringValue(record, ['roleTitle', 'role', 'position'], 'Staff'),
          phone: nullableString(record.phone),
          venue: nullableString(record.venue),
          employmentStatus: stringValue(record, ['employmentStatus', 'status'], 'ACTIVE'),
          startDate: asDate(record.startDate),
          notes: nullableString(record.notes),
          passwordHash: null,
          isAdmin: false
        },
        create: {
          email,
          firstName,
          lastName,
          roleTitle: stringValue(record, ['roleTitle', 'role', 'position'], 'Staff'),
          phone: nullableString(record.phone),
          venue: nullableString(record.venue),
          employmentStatus: stringValue(record, ['employmentStatus', 'status'], 'ACTIVE'),
          startDate: asDate(record.startDate),
          notes: nullableString(record.notes),
          passwordHash: null,
          isAdmin: false
        }
      });
      emailToId.set(email, profile.id);
      inc('staffProfiles', existing ? 'updated' : 'created');
    }

    const accessRows = asArray(record.appAccess);

    if (accessRows.length) {
      for (const [accessIndex, rawAccess] of accessRows.entries()) {
        const access = asRecord(rawAccess);
        const appId = access ? normalizeAppId(access.appId ?? access.app ?? access.module) : null;

        if (!access || !appId) {
          errors.push(`staffProfiles[${index}].appAccess[${accessIndex}] has an invalid appId.`);
          inc('staffAppAccess', 'skipped');
          continue;
        }

        inc('staffAppAccess', 'read');

        if (dryRun) {
          inc('staffAppAccess', 'created');
          continue;
        }

        const staffProfileId = emailToId.get(email);

        if (!staffProfileId) {
          inc('staffAppAccess', 'skipped');
          continue;
        }

        const status = normalizeEnum<StaffAppAccessStatus>(
          access.status,
          ['ENABLED', 'DISABLED', 'PENDING'],
          'DISABLED'
        );
        await prisma.staffAppAccess.upsert({
          where: { staffProfileId_appId: { staffProfileId, appId } },
          update: {
            status,
            role: stringValue(access, ['role'], 'USER'),
            notes: nullableString(access.notes) ?? 'Imported from Alma Control. Confirm access before go-live.'
          },
          create: {
            staffProfileId,
            appId,
            status,
            role: stringValue(access, ['role'], 'USER'),
            notes: nullableString(access.notes) ?? 'Imported from Alma Control. Confirm access before go-live.'
          }
        });
        inc('staffAppAccess', 'created');
      }
    } else {
      for (const appId of APP_IDS) {
        inc('staffAppAccess', 'read');

        if (dryRun) {
          inc('staffAppAccess', 'created');
          continue;
        }

        const staffProfileId = emailToId.get(email);

        if (!staffProfileId) {
          inc('staffAppAccess', 'skipped');
          continue;
        }

        await prisma.staffAppAccess.upsert({
          where: { staffProfileId_appId: { staffProfileId, appId } },
          update: {
            status: 'DISABLED',
            notes: 'Imported from Alma Control. Enable from Alma Staff after verification.'
          },
          create: {
            staffProfileId,
            appId,
            status: 'DISABLED',
            role: 'USER',
            notes: 'Imported from Alma Control. Enable from Alma Staff after verification.'
          }
        });
        inc('staffAppAccess', 'created');
      }
    }
  }

  await importStaffRecords(payload, emailToId, dryRun);
}

async function importStaffRecords(payload: JsonRecord, emailToId: Map<string, string>, dryRun: boolean) {
  const records = payloadArray(payload, ['staffComplianceRecords', 'staffRecords', 'certificates']);

  for (const [index, raw] of records.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('staffComplianceRecords', 'skipped');
      continue;
    }

    inc('staffComplianceRecords', 'read');
    const email = stringValue(record, ['staffEmail', 'email', 'employeeEmail']).toLowerCase();
    const title = requireString(record, ['title', 'name'], 'title', 'staffComplianceRecords', index);
    const recordType = normalizeEnum<StaffRecordType>(
      record.recordType ?? record.type,
      ['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER'],
      'OTHER'
    );
    const staffProfileId =
      emailToId.get(email) ??
      (email ? (await prisma.staffProfile.findUnique({ where: { email }, select: { id: true } }))?.id : null);

    if (!staffProfileId || !title) {
      errors.push(`staffComplianceRecords[${index}] could not be linked to a staff email or is missing title.`);
      inc('staffComplianceRecords', 'skipped');
      continue;
    }

    const existing = staffProfileId.startsWith('dry-run:')
      ? null
      : await prisma.staffComplianceRecord.findFirst({
          where: {
            staffProfileId,
            recordType,
            title,
            certificateNumber: nullableString(record.certificateNumber)
          },
          select: { id: true }
        });

    if (dryRun) {
      inc('staffComplianceRecords', existing ? 'updated' : 'created');
      continue;
    }

    const data = {
      staffProfileId,
      recordType,
      title,
      issuer: nullableString(record.issuer),
      certificateNumber: nullableString(record.certificateNumber),
      issueDate: asDate(record.issueDate),
      expiryDate: asDate(record.expiryDate),
      status: normalizeEnum<StaffRecordStatus>(record.status, ['PENDING', 'APPROVED', 'EXPIRED'], 'PENDING'),
      documentName: nullableString(record.documentName),
      documentUrl: nullableString(record.documentUrl),
      notes: nullableString(record.notes)
    };

    if (existing) {
      await prisma.staffComplianceRecord.update({ where: { id: existing.id }, data });
      inc('staffComplianceRecords', 'updated');
    } else {
      await prisma.staffComplianceRecord.create({ data });
      inc('staffComplianceRecords', 'created');
    }
  }
}

async function importCompliance(payload: JsonRecord, dryRun: boolean) {
  const compliancePayload = {
    issues: payloadArray(payload, ['issues', 'complianceIssues']),
    checklistTemplates: payloadArray(payload, ['checklistTemplates']),
    checklistRuns: payloadArray(payload, ['checklistRuns']),
    auditTemplates: payloadArray(payload, ['auditTemplates']),
    auditRuns: payloadArray(payload, ['auditRuns'])
  };
  const readCount =
    compliancePayload.issues.length +
    compliancePayload.checklistTemplates.length +
    compliancePayload.checklistRuns.length +
    compliancePayload.auditTemplates.length +
    compliancePayload.auditRuns.length;

  if (!readCount) {
    return;
  }

  inc('compliance', 'read', readCount);

  if (dryRun) {
    inc('compliance', 'updated', readCount);
    return;
  }

  await importCompliancePayload(compliancePayload, 'merge');
  inc('compliance', 'updated', readCount);
}

async function importLicences(payload: JsonRecord, dryRun: boolean) {
  const licences = payloadArray(payload, ['licences', 'licenses', 'liquorLicences', 'operatingLicences']);

  for (const [index, raw] of licences.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('licences', 'skipped');
      continue;
    }

    inc('licences', 'read');
    const licenceNumber = requireString(record, ['licenceNumber', 'licenseNumber', 'number'], 'licenceNumber', 'licences', index);
    const venue = stringValue(record, ['venue'], 'Alma');
    const existing = licenceNumber
      ? await prisma.liquorLicence.findUnique({ where: { licenceNumber }, select: { id: true } })
      : null;

    if (!licenceNumber) {
      inc('licences', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('licences', existing ? 'updated' : 'created');
      continue;
    }

    await prisma.liquorLicence.upsert({
      where: { licenceNumber },
      update: {
        venue,
        licenceType: normalizeEnum<LiquorLicenceType>(
          record.licenceType ?? record.type,
          [
            'HOTEL',
            'ON_PREMISES',
            'SMALL_BAR',
            'CLUB',
            'PACKAGED',
            'PRODUCER_WHOLESALER',
            'LIMITED',
            'OUTDOOR_SEATING',
            'FOOD_BUSINESS',
            'FOOTPATH_DINING',
            'MUSIC_ENTERTAINMENT',
            'SIGNAGE',
            'FIRE_SAFETY',
            'WASTE_TRADE',
            'OTHER'
          ],
          'OTHER'
        ),
        status: normalizeEnum<LiquorLicenceStatus>(record.status, ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING'], 'ACTIVE'),
        licensee: stringValue(record, ['licensee'], 'Alma Group'),
        issuer: stringValue(record, ['issuer'], 'NSW Liquor & Gaming'),
        issueDate: asDate(record.issueDate),
        expiryDate: asDate(record.expiryDate),
        tradingHours: nullableString(record.tradingHours),
        conditions: nullableString(record.conditions),
        restrictions: nullableString(record.restrictions),
        notes: nullableString(record.notes),
        documentName: nullableString(record.documentName),
        documentUrl: nullableString(record.documentUrl)
      },
      create: {
        venue,
        licenceNumber,
        licenceType: normalizeEnum<LiquorLicenceType>(record.licenceType ?? record.type, ['HOTEL', 'ON_PREMISES', 'SMALL_BAR', 'CLUB', 'PACKAGED', 'PRODUCER_WHOLESALER', 'LIMITED', 'OUTDOOR_SEATING', 'FOOD_BUSINESS', 'FOOTPATH_DINING', 'MUSIC_ENTERTAINMENT', 'SIGNAGE', 'FIRE_SAFETY', 'WASTE_TRADE', 'OTHER'], 'OTHER'),
        status: normalizeEnum<LiquorLicenceStatus>(record.status, ['ACTIVE', 'SUSPENDED', 'EXPIRED', 'PENDING'], 'ACTIVE'),
        licensee: stringValue(record, ['licensee'], 'Alma Group'),
        issuer: stringValue(record, ['issuer'], 'NSW Liquor & Gaming'),
        issueDate: asDate(record.issueDate),
        expiryDate: asDate(record.expiryDate),
        tradingHours: nullableString(record.tradingHours),
        conditions: nullableString(record.conditions),
        restrictions: nullableString(record.restrictions),
        notes: nullableString(record.notes),
        documentName: nullableString(record.documentName),
        documentUrl: nullableString(record.documentUrl)
      }
    });
    inc('licences', existing ? 'updated' : 'created');
  }
}

async function importStock(payload: JsonRecord, dryRun: boolean, trustedOpeningBalances: boolean) {
  const categoryIdByKey = new Map<string, string>();
  const categories = payloadArray(payload, ['stockCategories', 'categories']);

  for (const [index, raw] of categories.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('stockCategories', 'skipped');
      continue;
    }

    inc('stockCategories', 'read');
    const name = requireString(record, ['name', 'title'], 'name', 'stockCategories', index);
    const id = legacyId(record, 'stock-category', index);
    const existing = (await prisma.stockCategory.findUnique({ where: { legacyId: id }, select: { id: true } })) ??
      (name ? await prisma.stockCategory.findUnique({ where: { name }, select: { id: true } }) : null);

    if (!name) {
      inc('stockCategories', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('stockCategories', existing ? 'updated' : 'created');
      continue;
    }

    const category = existing
      ? await prisma.stockCategory.update({
          where: { id: existing.id },
          data: { legacyId: id, name, description: nullableString(record.description) }
        })
      : await prisma.stockCategory.create({
          data: { legacyId: id, name, description: nullableString(record.description) }
        });

    categoryIdByKey.set(id, category.id);
    categoryIdByKey.set(name, category.id);
    inc('stockCategories', existing ? 'updated' : 'created');
  }

  const itemIdByKey = new Map<string, string>();
  const items = payloadArray(payload, ['stockItems', 'items', 'products']);

  for (const [index, raw] of items.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('stockItems', 'skipped');
      continue;
    }

    inc('stockItems', 'read');
    const id = legacyId(record, 'stock-item', index);
    const name = requireString(record, ['name', 'title', 'label'], 'name', 'stockItems', index);
    const unit = stringValue(record, ['unit', 'baseUnit', 'countUnit'], 'unit');
    const sku = nullableString(record.sku);
    const categoryKey = stringValue(record, ['categoryLegacyId', 'categoryId', 'category']);
    const existing =
      (await prisma.stockItem.findUnique({ where: { legacyId: id }, select: { id: true, onHand: true } })) ??
      (sku ? await prisma.stockItem.findUnique({ where: { sku }, select: { id: true, onHand: true } }) : null);
    const openingBalance = trustedOpeningBalances ? numberValue(record, ['onHand', 'currentBalance', 'currentQty', 'quantity']) : null;

    if (!name) {
      inc('stockItems', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('stockItems', existing ? 'updated' : 'created');
      continue;
    }

    const data = {
      legacyId: id,
      sku,
      name,
      categoryId: categoryKey ? categoryIdByKey.get(categoryKey) ?? null : null,
      unit,
      onHand: openingBalance ?? existing?.onHand ?? 0,
      parLevel: numberValue(record, ['parLevel', 'par']) ?? 0,
      reorderPoint: numberValue(record, ['reorderPoint']),
      avgCostCents: numberValue(record, ['avgCostCents']),
      status: normalizeEnum<StockItemStatus>(record.status, ['ACTIVE', 'ARCHIVED'], 'ACTIVE'),
      notes: nullableString(record.notes)
    };
    const item = existing
      ? await prisma.stockItem.update({ where: { id: existing.id }, data })
      : await prisma.stockItem.create({ data });

    itemIdByKey.set(id, item.id);
    itemIdByKey.set(name, item.id);
    if (sku) {
      itemIdByKey.set(sku, item.id);
    }
    inc('stockItems', existing ? 'updated' : 'created');
  }

  await importStocktakes(payload, dryRun, itemIdByKey);
  await importSuppliers(payload, dryRun);
  await importRecipes(payload, dryRun, itemIdByKey);
}

async function importStocktakes(payload: JsonRecord, dryRun: boolean, itemIdByKey: Map<string, string>) {
  const stocktakes = payloadArray(payload, ['stocktakes', 'historicalStocktakes']);

  for (const [index, raw] of stocktakes.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('stocktakes', 'skipped');
      continue;
    }

    inc('stocktakes', 'read');
    const id = legacyId(record, 'stocktake', index);
    const name = stringValue(record, ['name', 'title'], `Imported stocktake ${index + 1}`);
    const existing = await prisma.stocktake.findUnique({ where: { legacyId: id }, select: { id: true } });

    if (dryRun) {
      inc('stocktakes', existing ? 'updated' : 'created');
      inc('stocktakeLines', 'read', asArray(record.lines).length);
      inc('stocktakeLines', existing ? 'updated' : 'created', asArray(record.lines).length);
      continue;
    }

    const stocktake = await prisma.stocktake.upsert({
      where: { legacyId: id },
      update: {
        name,
        venue: nullableString(record.venue),
        template: nullableString(record.template),
        countedAt: asDate(record.countedAt) ?? asDate(record.createdAt) ?? new Date(),
        status: normalizeEnum<StocktakeStatus>(record.status, ['IN_PROGRESS', 'SUBMITTED'], 'SUBMITTED'),
        notes: nullableString(record.notes),
        appliedAt: null,
        lines: { deleteMany: {} }
      },
      create: {
        legacyId: id,
        name,
        venue: nullableString(record.venue),
        template: nullableString(record.template),
        countedAt: asDate(record.countedAt) ?? asDate(record.createdAt) ?? new Date(),
        status: normalizeEnum<StocktakeStatus>(record.status, ['IN_PROGRESS', 'SUBMITTED'], 'SUBMITTED'),
        notes: nullableString(record.notes),
        appliedAt: null
      }
    });
    inc('stocktakes', existing ? 'updated' : 'created');

    for (const [lineIndex, rawLine] of asArray(record.lines).entries()) {
      const line = asRecord(rawLine);

      if (!line) {
        inc('stocktakeLines', 'skipped');
        continue;
      }

      inc('stocktakeLines', 'read');
      const lineId = legacyId(line, `${id}:line`, lineIndex);
      const itemKey = stringValue(line, ['itemLegacyId', 'stockItemLegacyId', 'itemId', 'sku', 'label', 'name']);
      const label = stringValue(line, ['label', 'name'], `Line ${lineIndex + 1}`);
      const countedQty = numberValue(line, ['countedQty', 'quantity', 'qty', 'count']) ?? 0;

      await prisma.stocktakeLine.create({
        data: {
          legacyId: lineId,
          stocktakeId: stocktake.id,
          itemId: itemKey ? itemIdByKey.get(itemKey) ?? null : null,
          position: asNumber(line.position) ?? lineIndex + 1,
          label,
          countedQty,
          unit: nullableString(line.unit),
          location: nullableString(line.location),
          stockValueCents: numberValue(line, ['stockValueCents']),
          notes: nullableString(line.notes)
        }
      });
      inc('stocktakeLines', 'created');
    }
  }
}

async function importSuppliers(payload: JsonRecord, dryRun: boolean) {
  const suppliers = payloadArray(payload, ['suppliers']);

  for (const [index, raw] of suppliers.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('suppliers', 'skipped');
      continue;
    }

    inc('suppliers', 'read');
    const id = legacyId(record, 'supplier', index);
    const name = requireString(record, ['name'], 'name', 'suppliers', index);
    const existing =
      (await prisma.supplier.findUnique({ where: { legacyId: id }, select: { id: true } })) ??
      (name ? await prisma.supplier.findFirst({ where: { name }, select: { id: true } }) : null);

    if (!name) {
      inc('suppliers', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('suppliers', existing ? 'updated' : 'created');
      continue;
    }

    const data = {
      legacyId: id,
      name,
      contactName: nullableString(record.contactName),
      email: nullableString(record.email),
      phone: nullableString(record.phone),
      website: nullableString(record.website),
      address: nullableString(record.address),
      accountNumber: nullableString(record.accountNumber),
      paymentTerms: nullableString(record.paymentTerms),
      notes: nullableString(record.notes),
      status: normalizeEnum<SupplierStatus>(record.status, ['ACTIVE', 'ARCHIVED'], 'ACTIVE')
    };

    if (existing) {
      await prisma.supplier.update({ where: { id: existing.id }, data });
      inc('suppliers', 'updated');
    } else {
      await prisma.supplier.create({ data });
      inc('suppliers', 'created');
    }
  }
}

async function importRecipes(payload: JsonRecord, dryRun: boolean, itemIdByKey: Map<string, string>) {
  const recipes = payloadArray(payload, ['recipes']);

  for (const [index, raw] of recipes.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('recipes', 'skipped');
      continue;
    }

    inc('recipes', 'read');
    const id = legacyId(record, 'recipe', index);
    const title = requireString(record, ['title', 'name'], 'title', 'recipes', index);
    const existing = await prisma.recipe.findUnique({ where: { legacyId: id }, select: { id: true } });

    if (!title) {
      inc('recipes', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('recipes', existing ? 'updated' : 'created');
      inc('recipeLines', 'read', asArray(record.lines).length);
      inc('recipeLines', existing ? 'updated' : 'created', asArray(record.lines).length);
      continue;
    }

    const recipe = await prisma.recipe.upsert({
      where: { legacyId: id },
      update: {
        title,
        kind: nullableString(record.kind),
        category: nullableString(record.category),
        subcategory: nullableString(record.subcategory),
        venue: nullableString(record.venue),
        estimatedCost: asNumber(record.estimatedCost) ?? 0,
        notes: nullableString(record.notes),
        lines: { deleteMany: {} }
      },
      create: {
        legacyId: id,
        title,
        kind: nullableString(record.kind),
        category: nullableString(record.category),
        subcategory: nullableString(record.subcategory),
        venue: nullableString(record.venue),
        estimatedCost: asNumber(record.estimatedCost) ?? 0,
        notes: nullableString(record.notes)
      }
    });
    inc('recipes', existing ? 'updated' : 'created');

    for (const [lineIndex, rawLine] of asArray(record.lines).entries()) {
      const line = asRecord(rawLine);

      if (!line) {
        inc('recipeLines', 'skipped');
        continue;
      }

      inc('recipeLines', 'read');
      const ingredientName = stringValue(line, ['ingredientName', 'name'], `Ingredient ${lineIndex + 1}`);
      const itemKey = stringValue(line, ['itemLegacyId', 'stockItemLegacyId', 'itemId', 'sku', 'ingredientName', 'name']);

      await prisma.recipeLine.create({
        data: {
          legacyId: legacyId(line, `${id}:line`, lineIndex),
          recipeId: recipe.id,
          position: asNumber(line.position) ?? lineIndex + 1,
          ingredientName,
          quantity: numberValue(line, ['quantity', 'qty']),
          unit: nullableString(line.unit),
          cost: asNumber(line.cost),
          itemId: itemKey ? itemIdByKey.get(itemKey) ?? null : null
        }
      });
      inc('recipeLines', 'created');
    }
  }
}

async function importIncidentReports(payload: JsonRecord, dryRun: boolean) {
  const incidentReports = payloadArray(payload, ['incidentReports', 'safetyIncidents']);

  for (const [index, raw] of incidentReports.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('incidentReports', 'skipped');
      continue;
    }

    inc('incidentReports', 'read');
    const title = requireString(record, ['title'], 'title', 'incidentReports', index);
    const occurredAt = asDate(record.occurredAt) ?? asDate(record.date);

    if (!title || !occurredAt) {
      errors.push(`incidentReports[${index}] is missing occurredAt/date.`);
      inc('incidentReports', 'skipped');
      continue;
    }

    const existing = await prisma.incidentReport.findFirst({ where: { title, occurredAt }, select: { id: true } });

    if (dryRun) {
      inc('incidentReports', existing ? 'updated' : 'created');
      continue;
    }

    const data = {
      title,
      incidentType: stringValue(record, ['incidentType', 'type'], 'Imported'),
      severity: normalizeEnum(record.severity, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const, 'MEDIUM'),
      status: normalizeEnum(record.status, ['OPEN', 'UNDER_REVIEW', 'CLOSED'] as const, 'OPEN'),
      occurredAt,
      reportedBy: stringValue(record, ['reportedBy'], 'Alma Control import'),
      venue: nullableString(record.venue),
      location: nullableString(record.location),
      summary: stringValue(record, ['summary', 'description'], title),
      immediateActions: nullableString(record.immediateActions),
      treatmentProvided: nullableString(record.treatmentProvided),
      followUpRequired: Boolean(record.followUpRequired),
      followUpNotes: nullableString(record.followUpNotes)
    };

    if (existing) {
      await prisma.incidentPerson.deleteMany({ where: { incidentReportId: existing.id } });
      await prisma.incidentReport.update({ where: { id: existing.id }, data });
      inc('incidentReports', 'updated');
    } else {
      await prisma.incidentReport.create({ data });
      inc('incidentReports', 'created');
    }
  }
}

async function importTemperature(payload: JsonRecord, dryRun: boolean) {
  const assets = payloadArray(payload, ['temperatureAssets']);

  for (const [index, raw] of assets.entries()) {
    const record = asRecord(raw);

    if (!record) {
      inc('temperatureAssets', 'skipped');
      continue;
    }

    inc('temperatureAssets', 'read');
    const name = requireString(record, ['name'], 'name', 'temperatureAssets', index);
    const existing = await prisma.temperatureAsset.findFirst({
      where: { name, venue: nullableString(record.venue) },
      select: { id: true }
    });

    if (!name) {
      inc('temperatureAssets', 'skipped');
      continue;
    }

    if (dryRun) {
      inc('temperatureAssets', existing ? 'updated' : 'created');
      continue;
    }

    if (existing) {
      await prisma.temperatureAsset.update({
        where: { id: existing.id },
        data: {
          venue: nullableString(record.venue),
          area: nullableString(record.area),
          assetType: stringValue(record, ['assetType', 'type'], 'Fridge'),
          minTempC: numberValue(record, ['minTempC', 'min']) ?? 0,
          maxTempC: numberValue(record, ['maxTempC', 'max']) ?? 5,
          notes: nullableString(record.notes)
        }
      });
      inc('temperatureAssets', 'updated');
    } else {
      await prisma.temperatureAsset.create({
        data: {
          name,
          venue: nullableString(record.venue),
          area: nullableString(record.area),
          assetType: stringValue(record, ['assetType', 'type'], 'Fridge'),
          minTempC: numberValue(record, ['minTempC', 'min']) ?? 0,
          maxTempC: numberValue(record, ['maxTempC', 'max']) ?? 5,
          notes: nullableString(record.notes)
        }
      });
      inc('temperatureAssets', 'created');
    }
  }

  const logs = payloadArray(payload, ['temperatureLogs']);
  if (logs.length) {
    inc('temperatureLogs', 'read', logs.length);
    inc('temperatureLogs', dryRun ? 'skipped' : 'skipped', logs.length);
    warnings.push('temperatureLogs were detected but skipped. Import temperature assets first, then sync/import logs with asset IDs if needed.');
  }
}

async function runImport(payload: JsonRecord, args: CliArgs) {
  await importSettings(payload, args.dryRun);
  for (const [index, rawVenue] of payloadArray(payload, ['venues']).entries()) {
    await upsertVenue(rawVenue, index, args.dryRun);
  }
  await importStaff(payload, args.dryRun);
  await importCompliance(payload, args.dryRun);
  await importIncidentReports(payload, args.dryRun);
  await importLicences(payload, args.dryRun);
  await importTemperature(payload, args.dryRun);
  await importStock(payload, args.dryRun, args.trustedOpeningBalances);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = normalizeFilePath(args.file);
  const payload = await readPayload(filePath);

  if (!args.dryRun) {
    await runImport(payload, { ...args, dryRun: true });

    if (errors.length) {
      printSummary({ ...args, dryRun: true }, filePath);
      throw new Error(`Import validation failed with ${errors.length} issue(s). No production writes were attempted.`);
    }

    resetSummary();
  }

  await runImport(payload, args);

  printSummary(args, filePath);

  if (errors.length) {
    throw new Error(`Import validation failed with ${errors.length} issue(s). Fix the export and run again.`);
  }

  if (warnings.length) {
    console.warn('\nWarnings:');
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

function printSummary(args: CliArgs, filePath: string) {
  console.log('\nAlma Control import summary');
  console.log(`Mode: ${args.dryRun ? 'DRY RUN - no writes' : 'IMPORT - database updated'}`);
  console.log(`File: ${filePath}`);
  console.log(`Trusted opening stock balances: ${args.trustedOpeningBalances ? 'yes' : 'no'}`);
  console.table(summary);

  if (errors.length) {
    console.error('\nValidation issues:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
