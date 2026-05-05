# Alma Control Production Data Import

This runbook is for the one-time Alma Control data import before first production deployment.

Production data must not be mixed with demo/local seed data. Run Prisma migrations, run the production bootstrap, dry-run the Alma Control import, then run the actual import only after the dry run is clean.

## Existing Import Sources

The repo already contains legacy Alma Control tooling:

- `packages/db/prisma/import-legacy.ts`
- `packages/db/prisma/compliance-import.ts`
- `packages/db/prisma/import-legacy-stock.ts`
- `packages/db/prisma/extract-legacy-compliance.ts`
- `packages/db/prisma/extract-legacy-stock.ts`
- `tmp/legacy-stock-export.json`

The production-safe importer is:

- `scripts/import-alma-control.ts`

## Current Schema Targets

Alma Control data can be mapped into these current Prisma models:

- Compliance: `Issue`, `IssueEvidence`, `IssueActivity`, `ChecklistTemplate`, `ChecklistItemTemplate`, `ChecklistRun`, `ChecklistItem`, `AuditTemplate`, `AuditTemplateSection`, `AuditRun`, `AuditFinding`, `IncidentReport`, `IncidentPerson`, `LiquorLicence`, `TemperatureAsset`, `TemperatureLog`
- Staff: `StaffProfile`, `StaffAppAccess`, `StaffComplianceRecord`, `StaffInvite`, `RosterShift`, `Timesheet`
- Stock: `StockCategory`, `StockItem`, `Stocktake`, `StocktakeLine`, `InventoryMovement`, `Recipe`, `RecipeLine`, `Supplier`
- Platform/settings: `AppSettings`, `Venue`

The first production importer currently handles settings, venues, staff profiles, staff compliance records, compliance issues/checklists/audits, incident reports, licences, temperature assets, stock categories/items, stocktakes/lines, suppliers, and recipes/lines.

## Export File

Place the Alma Control JSON export at:

```bash
tmp/alma-control-export.json
```

Or pass a custom path with `--file`.

Recommended top-level shape:

```json
{
  "appSettings": {},
  "venues": [],
  "staffProfiles": [],
  "staffComplianceRecords": [],
  "issues": [],
  "checklistTemplates": [],
  "checklistRuns": [],
  "auditTemplates": [],
  "auditRuns": [],
  "incidentReports": [],
  "licences": [],
  "temperatureAssets": [],
  "stockCategories": [],
  "stockItems": [],
  "stocktakes": [],
  "suppliers": [],
  "recipes": []
}
```

Aliases are also accepted for common export names, such as `staff`, `employees`, `products`, `categories`, `licenses`, and `liquorLicences`.

## Production Bootstrap

Run migrations first:

```bash
pnpm db:migrate:deploy
```

Then create production basics only:

```bash
NODE_ENV=production \
PROD_ADMIN_EMAIL="admin@example.com" \
PROD_ADMIN_PASSWORD="replace-with-a-real-secret" \
pnpm db:seed:prod
```

`pnpm db:seed:prod` is idempotent and non-destructive. It only creates/upserts required basics such as venues, app settings, and an optional production admin from env variables.

## Dry Run

Always run the dry run first:

```bash
NODE_ENV=production \
DATABASE_URL="postgresql://..." \
pnpm db:import:alma-control -- --file tmp/alma-control-export.json --dry-run
```

The dry run validates required fields, checks likely duplicate targets, and prints a table showing read, create, update, and skipped counts.

## Actual Import

After the dry run is clean:

```bash
NODE_ENV=production \
DATABASE_URL="postgresql://..." \
pnpm db:import:alma-control -- --file tmp/alma-control-export.json
```

For stock, current balances are only imported when the export is trusted as the opening production baseline:

```bash
NODE_ENV=production \
DATABASE_URL="postgresql://..." \
pnpm db:import:alma-control -- --file tmp/alma-control-export.json --trusted-opening-balances
```

Without `--trusted-opening-balances`, stock items are created with `onHand = 0`, and existing `onHand` values are preserved.

Historical stocktakes are imported as submitted/review records with `appliedAt = null`. They do not create `InventoryMovement` rows and do not mutate final stock balances.

## Staff Accounts

Imported staff users do not receive demo passwords. Staff profiles are imported with `passwordHash = null`, and app access is disabled by default unless the source export explicitly provides access statuses.

Production login access should be enabled through Alma Staff after verification, invite, or password reset.

The production admin account is created only from env-provided credentials via `pnpm db:seed:prod`.

## Verify Counts

After import, compare the import summary against the source export and spot-check counts:

```sql
select count(*) from "StaffProfile";
select count(*) from "StaffComplianceRecord";
select count(*) from "Issue";
select count(*) from "LiquorLicence";
select count(*) from "StockItem";
select count(*) from "Stocktake";
select count(*) from "Recipe";
select count(*) from "Supplier";
```

For stock opening balances:

```sql
select name, "onHand", unit from "StockItem" order by name limit 50;
```

For unapplied historical stocktakes:

```sql
select name, status, "appliedAt" from "Stocktake" order by "countedAt" desc limit 50;
```

## Do Not Use Demo Seed In Production

Do not run this in production:

```bash
pnpm db:seed
```

The normal seed is local/demo only. It resets and creates sample operational data and demo credentials, which would pollute production and could overwrite real deployment assumptions.

Production sequence:

```bash
pnpm install
pnpm db:migrate:deploy
pnpm db:seed:prod
pnpm db:import:alma-control -- --file tmp/alma-control-export.json --dry-run
pnpm db:import:alma-control -- --file tmp/alma-control-export.json
pnpm typecheck
pnpm build
```
