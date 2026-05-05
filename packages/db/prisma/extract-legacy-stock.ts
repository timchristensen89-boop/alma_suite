import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;

type ExtractArgs = {
  legacyFunctionsDir: string;
  orgId: string | null;
  outFile: string;
  projectId: string | null;
  serviceAccountFile: string;
};

type ExtractedOrg = {
  categories: JsonRecord[];
  fieldDefinitions: Array<{
    entityType: string;
    fields: JsonRecord[];
  }>;
  id: string;
  items: JsonRecord[];
  name: string;
  products: JsonRecord[];
  reportViews: JsonRecord[];
  sourceRoot: 'organizations' | 'orgs';
  suppliers: JsonRecord[];
  uoms: JsonRecord[];
  users: JsonRecord[];
  venues: ExtractedVenue[];
};

type ExtractedVenue = {
  id: string;
  invoices: Array<JsonRecord & { lines: JsonRecord[] }>;
  locations: JsonRecord[];
  movements: JsonRecord[];
  name: string;
  raw: JsonRecord;
  recipes: JsonRecord[];
  sales: JsonRecord[];
  stocktakes: Array<JsonRecord & { lines: JsonRecord[] }>;
};

type ExtractedBundle = {
  extractedAt: string;
  normalized: {
    categories: JsonRecord[];
    fieldDefinitions: JsonRecord[];
    invoices: JsonRecord[];
    invoiceLines: JsonRecord[];
    items: JsonRecord[];
    locations: JsonRecord[];
    movements: JsonRecord[];
    productAliases: JsonRecord[];
    products: JsonRecord[];
    recipeLines: JsonRecord[];
    recipes: JsonRecord[];
    reportViews: JsonRecord[];
    sales: JsonRecord[];
    stocktakeLines: JsonRecord[];
    stocktakes: JsonRecord[];
    suppliers: JsonRecord[];
    uoms: JsonRecord[];
    users: JsonRecord[];
    venues: JsonRecord[];
  };
  orgs: ExtractedOrg[];
  source: {
    detectedRoots: Array<'organizations' | 'orgs'>;
    kind: 'firestore';
    legacyFunctionsDir: string;
    orgId: string | null;
    projectId: string | null;
    serviceAccountFile: string;
  };
  summary: JsonRecord;
  version: 1;
};

type FirestoreModule = {
  apps: Array<{ name: string }>;
  app: (name?: string) => { delete: () => Promise<void> };
  credential: {
    cert: (serviceAccount: JsonRecord) => unknown;
  };
  firestore: (app?: unknown) => {
    collection: (name: string) => {
      doc: (id: string) => { get: () => Promise<FirestoreDocumentSnapshot> };
      get: () => Promise<{ docs: FirestoreDocumentSnapshot[] }>;
    };
  };
  initializeApp: (options: JsonRecord, name?: string) => unknown;
};

type FirestoreDocumentSnapshot = {
  data: () => JsonRecord | undefined;
  exists: boolean;
  id: string;
  ref: {
    collection: (name: string) => {
      get: () => Promise<{ docs: FirestoreDocumentSnapshot[] }>;
    };
  };
};

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../../..');
const resolveFrom = process.env.INIT_CWD ?? process.cwd();

function defaultServiceAccountPath() {
  return path.resolve(repoRoot, '../alma-stock-firebase-adminsdk-fbsvc-ac4e175402.json');
}

function defaultLegacyFunctionsDir() {
  return path.resolve(repoRoot, '../alma-stocktake/functions');
}

function defaultOutFile() {
  return path.resolve(resolveFrom, 'tmp/legacy-stock-export.json');
}

function resolveArgPath(value: string) {
  return path.resolve(resolveFrom, value);
}

function parseArgs(argv: string[]): ExtractArgs {
  let legacyFunctionsDir = process.env.LEGACY_STOCK_FUNCTIONS_DIR ?? defaultLegacyFunctionsDir();
  let orgId = process.env.LEGACY_STOCK_ORG_ID ?? null;
  let outFile = process.env.LEGACY_STOCK_EXPORT_FILE ?? defaultOutFile();
  let projectId = process.env.LEGACY_STOCK_PROJECT_ID ?? null;
  let serviceAccountFile =
    process.env.LEGACY_STOCK_SERVICE_ACCOUNT_FILE ?? defaultServiceAccountPath();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--legacy-functions-dir') {
      legacyFunctionsDir = resolveArgPath(argv[index + 1] ?? legacyFunctionsDir);
      index += 1;
      continue;
    }

    if (current === '--org-id') {
      orgId = (argv[index + 1] ?? '').trim() || null;
      index += 1;
      continue;
    }

    if (current === '--out') {
      outFile = resolveArgPath(argv[index + 1] ?? outFile);
      index += 1;
      continue;
    }

    if (current === '--project-id') {
      projectId = (argv[index + 1] ?? '').trim() || null;
      index += 1;
      continue;
    }

    if (current === '--service-account') {
      serviceAccountFile = resolveArgPath(argv[index + 1] ?? serviceAccountFile);
      index += 1;
    }
  }

  return {
    legacyFunctionsDir,
    orgId,
    outFile,
    projectId,
    serviceAccountFile
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as JsonRecord;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function nullableString(value: unknown): string | null {
  const normalized = asString(value);
  return normalized ? normalized : null;
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => asString(entry))
    .filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => (value ?? '').trim()).filter(Boolean)));
}

function toIsoString(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
  }

  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') {
    const parsed = value.toDate();

    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

function serializeFirestoreValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  const timestamp = toIsoString(value);

  if (timestamp) {
    return timestamp;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeFirestoreValue(entry));
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (
      typeof record.id === 'string' &&
      typeof record.path === 'string' &&
      Object.keys(record).length <= 3
    ) {
      return {
        id: record.id,
        path: record.path
      };
    }

    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, serializeFirestoreValue(entry)]),
    );
  }

  return String(value);
}

function serializeSnapshot(snapshot: FirestoreDocumentSnapshot): JsonRecord {
  return {
    id: snapshot.id,
    ...((serializeFirestoreValue(snapshot.data() ?? {}) as JsonRecord | null) ?? {})
  };
}

async function readCollectionDocs(
  collection:
    | { get: () => Promise<{ docs: FirestoreDocumentSnapshot[] }> }
    | { docs: FirestoreDocumentSnapshot[] },
) {
  const snapshot = 'get' in collection ? await collection.get() : collection;
  return snapshot.docs.map((doc) => serializeSnapshot(doc));
}

async function readFieldDefinitions(
  orgRef: FirestoreDocumentSnapshot['ref'],
): Promise<Array<{ entityType: string; fields: JsonRecord[] }>> {
  const entityTypeSnapshot = await orgRef.collection('fieldDefs').get();
  const fieldDefinitions: Array<{ entityType: string; fields: JsonRecord[] }> = [];

  for (const entityTypeDoc of entityTypeSnapshot.docs) {
    const fields = await readCollectionDocs(entityTypeDoc.ref.collection('fields'));

    fieldDefinitions.push({
      entityType: entityTypeDoc.id,
      fields
    });
  }

  return fieldDefinitions;
}

async function readPrototypeVenue(venueSnapshot: FirestoreDocumentSnapshot): Promise<ExtractedVenue> {
  const [locations, invoiceSnapshots, movements, stocktakeSnapshots] = await Promise.all([
    readCollectionDocs(venueSnapshot.ref.collection('locations')),
    venueSnapshot.ref.collection('invoices').get(),
    readCollectionDocs(venueSnapshot.ref.collection('movements')),
    venueSnapshot.ref.collection('stocktakes').get()
  ]);

  const invoices = await Promise.all(
    invoiceSnapshots.docs.map(async (invoiceDoc) => ({
      ...serializeSnapshot(invoiceDoc),
      lines: await readCollectionDocs(invoiceDoc.ref.collection('lines'))
    })),
  );

  const stocktakes = await Promise.all(
    stocktakeSnapshots.docs.map(async (stocktakeDoc) => ({
      ...serializeSnapshot(stocktakeDoc),
      lines: await readCollectionDocs(stocktakeDoc.ref.collection('lines'))
    })),
  );

  const raw = serializeSnapshot(venueSnapshot);

  return {
    id: asString(raw.id, venueSnapshot.id),
    invoices,
    locations,
    movements,
    name: asString(raw.name, venueSnapshot.id),
    raw,
    recipes: [],
    sales: [],
    stocktakes
  };
}

async function readLegacyVenue(venueSnapshot: FirestoreDocumentSnapshot): Promise<ExtractedVenue> {
  const [recipes, sales, stocktakeSnapshots] = await Promise.all([
    readCollectionDocs(venueSnapshot.ref.collection('recipes')),
    readCollectionDocs(venueSnapshot.ref.collection('sales')),
    venueSnapshot.ref.collection('stocktakeSessions').get()
  ]);

  const stocktakes = await Promise.all(
    stocktakeSnapshots.docs.map(async (stocktakeDoc) => ({
      ...serializeSnapshot(stocktakeDoc),
      lines: await readCollectionDocs(stocktakeDoc.ref.collection('stocktakeLines'))
    })),
  );

  const raw = serializeSnapshot(venueSnapshot);

  return {
    id: asString(raw.id, venueSnapshot.id),
    invoices: [],
    locations: [],
    movements: [],
    name: asString(raw.name, venueSnapshot.id),
    raw,
    recipes,
    sales,
    stocktakes
  };
}

async function extractOrganizationsRoot(
  db: ReturnType<FirestoreModule['firestore']>,
  args: ExtractArgs,
): Promise<ExtractedOrg[]> {
  const orgSnapshots = args.orgId
    ? [await db.collection('organizations').doc(args.orgId).get()]
    : (await db.collection('organizations').get()).docs;

  const orgs: ExtractedOrg[] = [];

  for (const orgSnapshot of orgSnapshots) {
    if (!orgSnapshot.exists) {
      continue;
    }

    const rawOrg = serializeSnapshot(orgSnapshot);
    const [users, products, venueSnapshots] = await Promise.all([
      readCollectionDocs(orgSnapshot.ref.collection('users')),
      readCollectionDocs(orgSnapshot.ref.collection('products')),
      orgSnapshot.ref.collection('venues').get()
    ]);

    const venues = await Promise.all(
      venueSnapshots.docs.map((venueSnapshot) => readLegacyVenue(venueSnapshot)),
    );

    orgs.push({
      categories: [],
      fieldDefinitions: [],
      id: asString(rawOrg.id, orgSnapshot.id),
      items: [],
      name: asString(rawOrg.name, orgSnapshot.id),
      products,
      reportViews: [],
      sourceRoot: 'organizations',
      suppliers: [],
      uoms: [],
      users,
      venues
    });
  }

  return orgs;
}

async function extractPrototypeRoot(
  db: ReturnType<FirestoreModule['firestore']>,
  args: ExtractArgs,
): Promise<ExtractedOrg[]> {
  const orgSnapshots = args.orgId
    ? [await db.collection('orgs').doc(args.orgId).get()]
    : (await db.collection('orgs').get()).docs;

  const orgs: ExtractedOrg[] = [];

  for (const orgSnapshot of orgSnapshots) {
    if (!orgSnapshot.exists) {
      continue;
    }

    const rawOrg = serializeSnapshot(orgSnapshot);
    const [users, categories, uoms, fieldDefinitions, items, suppliers, reportViews, venueSnapshots] =
      await Promise.all([
        readCollectionDocs(orgSnapshot.ref.collection('users')),
        readCollectionDocs(orgSnapshot.ref.collection('categories')),
        readCollectionDocs(orgSnapshot.ref.collection('uoms')),
        readFieldDefinitions(orgSnapshot.ref),
        readCollectionDocs(orgSnapshot.ref.collection('items')),
        readCollectionDocs(orgSnapshot.ref.collection('suppliers')),
        readCollectionDocs(orgSnapshot.ref.collection('reportViews')),
        orgSnapshot.ref.collection('venues').get()
      ]);

    const venues = await Promise.all(
      venueSnapshots.docs.map((venueSnapshot) => readPrototypeVenue(venueSnapshot)),
    );

    orgs.push({
      categories,
      fieldDefinitions,
      id: asString(rawOrg.id, orgSnapshot.id),
      items,
      name: asString(rawOrg.name, orgSnapshot.id),
      products: [],
      reportViews,
      sourceRoot: 'orgs',
      suppliers,
      uoms,
      users,
      venues
    });
  }

  return orgs;
}

async function extractOrgs(args: ExtractArgs): Promise<ExtractedOrg[]> {
  const firebaseAdminRequire = createRequire(path.join(args.legacyFunctionsDir, 'package.json'));
  const admin = firebaseAdminRequire('firebase-admin') as FirestoreModule;
  const serviceAccountRaw = await fs.readFile(args.serviceAccountFile, 'utf8');
  const serviceAccount = JSON.parse(serviceAccountRaw) as JsonRecord;
  const appName = `legacy-stock-extract-${Date.now()}`;

  const app = admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
      projectId: args.projectId ?? serviceAccount.project_id
    },
    appName,
  );

  const db = admin.firestore(app);

  try {
    const organizations = await extractOrganizationsRoot(db, args);

    if (organizations.length > 0) {
      return organizations;
    }

    return extractPrototypeRoot(db, args);
  } finally {
    await admin.app(appName).delete();
  }
}

function buildNormalizedBundle(orgs: ExtractedOrg[]) {
  const normalized = {
    categories: [] as JsonRecord[],
    fieldDefinitions: [] as JsonRecord[],
    invoices: [] as JsonRecord[],
    invoiceLines: [] as JsonRecord[],
    items: [] as JsonRecord[],
    locations: [] as JsonRecord[],
    movements: [] as JsonRecord[],
    productAliases: [] as JsonRecord[],
    products: [] as JsonRecord[],
    recipeLines: [] as JsonRecord[],
    recipes: [] as JsonRecord[],
    reportViews: [] as JsonRecord[],
    sales: [] as JsonRecord[],
    stocktakeLines: [] as JsonRecord[],
    stocktakes: [] as JsonRecord[],
    suppliers: [] as JsonRecord[],
    uoms: [] as JsonRecord[],
    users: [] as JsonRecord[],
    venues: [] as JsonRecord[]
  };
  const derivedLocationKeys = new Set<string>();

  for (const org of orgs) {
    const categoryById = new Map(org.categories.map((category) => [asString(category.id), category]));
    const supplierById = new Map(org.suppliers.map((supplier) => [asString(supplier.id), supplier]));
    const uomById = new Map(org.uoms.map((uom) => [asString(uom.id), uom]));
    const venueIds = org.venues.map((venue) => venue.id);

    normalized.users.push(
      ...org.users.map((user) => ({
        ...user,
        orgId: org.id
      })),
    );

    normalized.categories.push(
      ...org.categories.map((category) => ({
        ...category,
        orgId: org.id
      })),
    );

    normalized.uoms.push(
      ...org.uoms.map((uom) => ({
        ...uom,
        orgId: org.id
      })),
    );

    normalized.suppliers.push(
      ...org.suppliers.map((supplier) => ({
        ...supplier,
        orgId: org.id
      })),
    );

    normalized.reportViews.push(
      ...org.reportViews.map((view) => ({
        ...view,
        orgId: org.id
      })),
    );

    normalized.fieldDefinitions.push(
      ...org.fieldDefinitions.flatMap((definition) =>
        definition.fields.map((field) => ({
          ...field,
          entityType: definition.entityType,
          orgId: org.id
        })),
      ),
    );

    normalized.items.push(
      ...org.items.map((item) => ({
        ...item,
        orgId: org.id
      })),
    );

    for (const item of org.items) {
      const itemId = asString(item.id);
      const defaultUom = uomById.get(asString(item.defaultUomId));
      const preferredSupplier = supplierById.get(asString(item.preferredSupplierId));
      const category = categoryById.get(asString(item.categoryId));
      const productId = `legacy-product:${org.id}:${itemId}`;
      const aliases = asStringArray(item.aliases);

      normalized.products.push({
        active: asBoolean(item.active, true),
        aliases,
        availableVenueIds: venueIds,
        barcode: nullableString(item.barcode),
        baseType: nullableString(defaultUom?.baseType),
        baseUnit: asString(defaultUom?.name, asString(item.defaultUomId, 'unit')),
        categoryId: nullableString(item.categoryId),
        categoryName: nullableString(category?.name),
        defaultSupplierId: nullableString(item.preferredSupplierId),
        defaultSupplierName: nullableString(preferredSupplier?.name),
        id: productId,
        legacyItemId: itemId,
        name: asString(item.name, itemId),
        orgId: org.id,
        packSize: nullableString(item.packSize),
        parLevel: asNumber(item.parLevel),
        reorderPoint: asNumber(item.reorderPoint),
        source: 'firestore_items'
      });

      aliases.forEach((aliasText, aliasIndex) => {
        normalized.productAliases.push({
          aliasText,
          id: `${productId}:alias:${aliasIndex + 1}`,
          orgId: org.id,
          productId,
          source: 'firestore_item_alias'
        });
      });
    }

    for (const product of org.products) {
      const productId = asString(product.id);
      const aliasTexts = uniqueStrings([
        nullableString(product.ingredientName),
        nullableString(product.mappedProduct),
        nullableString(product.normIngredient),
        nullableString(product.normMapped),
        ...asStringArray(product.supplierBarcodes)
      ]);
      const availableVenueIds = uniqueStrings([
        ...Object.keys(asRecord(product.venueOverrides) ?? {}),
        nullableString(product.venueId),
        ...venueIds
      ]);

      normalized.products.push({
        active: asString(product.status, 'active') === 'active',
        aliases: aliasTexts,
        availableVenueIds,
        barcode: nullableString(product.internalBarcode ?? product.barcode),
        baseType: nullableString(product.countingMethod),
        baseUnit: asString(product.baseUnit, 'unit'),
        categoryId: nullableString(product.productGroupId),
        categoryName: nullableString(product.category),
        currentCost: asNumber(product.currentCost),
        currentCostPerBaseUnit: asNumber(product.currentCostPerBaseUnit ?? product.costPerBaseUnit),
        defaultSupplierId: nullableString(product.defaultSupplierId),
        defaultSupplierName: null,
        id: productId,
        inventoryType: nullableString(product.inventoryType),
        legacyItemId: productId,
        managedBy: nullableString(product.managedBy),
        name: asString(product.name, productId),
        orgId: org.id,
        packSize: nullableString(
          [asNumber(product.packQty), asString(product.packUnit)].filter(Boolean).join(' ') || null,
        ),
        purchaseUnit: nullableString(product.purchaseUnit),
        purchaseUnitSize: asNumber(product.purchaseUnitSize),
        source: 'firestore_products',
        storage: asRecord(product.storage),
        yieldLossDefault: asNumber(product.yieldLossDefault)
      });

      aliasTexts.forEach((aliasText, aliasIndex) => {
        normalized.productAliases.push({
          aliasText,
          id: `${productId}:alias:${aliasIndex + 1}`,
          orgId: org.id,
          productId,
          source: 'firestore_product_alias'
        });
      });
    }

    for (const venue of org.venues) {
      normalized.venues.push({
        ...venue.raw,
        orgId: org.id
      });

      normalized.locations.push(
        ...venue.locations.map((location) => ({
          ...location,
          orgId: org.id,
          venueId: venue.id
        })),
      );

      for (const recipe of venue.recipes) {
        const lines = asArray(recipe.lines).map((entry) => asRecord(entry)).filter(Boolean) as JsonRecord[];

        normalized.recipes.push({
          ...recipe,
          lineCount: lines.length,
          orgId: org.id,
          venueId: venue.id
        });

        normalized.recipeLines.push(
          ...lines.map((line, lineIndex) => ({
            ...line,
            lineOrder: lineIndex + 1,
            orgId: org.id,
            recipeId: asString(recipe.id),
            recipeTitle: asString(recipe.title),
            venueId: venue.id
          })),
        );
      }

      normalized.sales.push(
        ...venue.sales.map((sale) => ({
          ...sale,
          orgId: org.id,
          venueId: venue.id
        })),
      );

      normalized.movements.push(
        ...venue.movements.map((movement) => ({
          ...movement,
          itemLegacyProductId: `legacy-product:${org.id}:${asString(movement.itemId)}`,
          orgId: org.id,
          venueId: venue.id
        })),
      );

      for (const invoice of venue.invoices) {
        normalized.invoices.push({
          ...invoice,
          lineCount: invoice.lines.length,
          orgId: org.id,
          venueId: venue.id
        });

        normalized.invoiceLines.push(
          ...invoice.lines.map((line) => ({
            ...line,
            invoiceId: asString(invoice.id),
            itemLegacyProductId: asString(line.itemId)
              ? `legacy-product:${org.id}:${asString(line.itemId)}`
              : null,
            orgId: org.id,
            supplierId: nullableString(invoice.supplierId),
            venueId: venue.id
          })),
        );
      }

      for (const stocktake of venue.stocktakes) {
        normalized.stocktakes.push({
          ...stocktake,
          lineCount: stocktake.lines.length,
          orgId: org.id,
          venueId: venue.id
        });

        normalized.stocktakeLines.push(
          ...stocktake.lines.map((line) => ({
            ...line,
            itemLegacyProductId: asString(line.itemId)
              ? `legacy-product:${org.id}:${asString(line.itemId)}`
              : null,
            orgId: org.id,
            stocktakeId: asString(stocktake.id),
            venueId: venue.id
          })),
        );

        for (const line of stocktake.lines) {
          const locationName = asString(line.location);

          if (!locationName) {
            continue;
          }

          const key = `${org.id}:${venue.id}:${locationName.toLowerCase()}`;

          if (derivedLocationKeys.has(key)) {
            continue;
          }

          derivedLocationKeys.add(key);
          normalized.locations.push({
            id: `derived-location:${venue.id}:${locationName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            name: locationName,
            orgId: org.id,
            source: 'stocktake_line_location',
            venueId: venue.id
          });
        }
      }
    }
  }

  return normalized;
}

function buildSummary(bundle: ExtractedBundle) {
  return {
    categoryCount: bundle.normalized.categories.length,
    fieldDefinitionCount: bundle.normalized.fieldDefinitions.length,
    invoiceCount: bundle.normalized.invoices.length,
    invoiceLineCount: bundle.normalized.invoiceLines.length,
    itemCount: bundle.normalized.items.length,
    locationCount: bundle.normalized.locations.length,
    movementCount: bundle.normalized.movements.length,
    orgCount: bundle.orgs.length,
    productAliasCount: bundle.normalized.productAliases.length,
    productCount: bundle.normalized.products.length,
    recipeCount: bundle.normalized.recipes.length,
    recipeLineCount: bundle.normalized.recipeLines.length,
    reportViewCount: bundle.normalized.reportViews.length,
    saleCount: bundle.normalized.sales.length,
    stocktakeCount: bundle.normalized.stocktakes.length,
    stocktakeLineCount: bundle.normalized.stocktakeLines.length,
    supplierCount: bundle.normalized.suppliers.length,
    uomCount: bundle.normalized.uoms.length,
    userCount: bundle.normalized.users.length,
    venueCount: bundle.normalized.venues.length
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orgs = await extractOrgs(args);
  const normalized = buildNormalizedBundle(orgs);
  const bundle: ExtractedBundle = {
    extractedAt: new Date().toISOString(),
    normalized,
    orgs,
    source: {
      detectedRoots: Array.from(new Set(orgs.map((org) => org.sourceRoot))),
      kind: 'firestore',
      legacyFunctionsDir: args.legacyFunctionsDir,
      orgId: args.orgId,
      projectId: args.projectId,
      serviceAccountFile: args.serviceAccountFile
    },
    summary: {},
    version: 1
  };

  bundle.summary = buildSummary(bundle);

  await fs.mkdir(path.dirname(args.outFile), { recursive: true });
  await fs.writeFile(args.outFile, JSON.stringify(bundle, null, 2));

  console.log(
    JSON.stringify(
      {
        extractedAt: bundle.extractedAt,
        orgIds: orgs.map((org) => org.id),
        outFile: args.outFile,
        source: bundle.source,
        summary: bundle.summary
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
