# Alma Suite v18

Local-first multi-venue hospitality operations suite. The live internal-use
products are Compliance, Stock, and Staff, with Academy and Control dashboard
remaining later lanes.

Compliance started with three core modules:

1. Issues
2. Checklists
3. Audits

This repo is pnpm workspace based, Postgres backed, and split into separate
frontend/API apps that share Prisma, shared types, and UI primitives.

## Quick start

1. Copy `.env.example` to `.env`
2. Start Postgres
3. Install dependencies
4. Generate Prisma client and migrate
5. Start API and web

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

### Master admin login

`pnpm db:seed` provisions local/demo admin logins:

| Login | Password | Use |
| --- | --- | --- |
| `admin@alma.local` | `almaadmin` | Local dev / demo |
| `tim@almagroup.com.au` | `Tim@lma2017` | Master owner account |

To (re)create only the master user against an existing database without wiping
data, run:

```bash
pnpm db:create:master-user
```

The script is idempotent — re-running updates the password hash and admin flag
on the existing profile.


## Data migration

Import legacy compliance data from a JSON export:

```bash
pnpm db:import:legacy -- --file ../alma-control-v1-7-data.json
```

Use `--replace` to wipe existing compliance records before import:

```bash
pnpm db:import:legacy -- --file /absolute/path/to/export.json --replace
```

Supported top-level collections in the import JSON:
- `issues` or `incidents`
- `checklistTemplates`
- `checklistRuns`
- `auditTemplates`
- `auditRuns`

Directly extract from the legacy `alma_compliance_v14` Postgres database:

```bash
pnpm db:extract:legacy-compliance
```

Use a different source database or replace existing imported records:

```bash
pnpm db:extract:legacy-compliance -- --source-url postgresql://timothychristensen@localhost:5432/alma_compliance_v14 --replace
```

Extract legacy stock control data directly from the old Firestore project into a portable JSON bundle:

```bash
pnpm db:extract:legacy-stock
```

The extractor supports both known legacy layouts:
- older `organizations/*` stock data with org products, venue recipes, sales, and stocktake sessions
- newer `orgs/*` prototype data with items, suppliers, invoices, movements, and stocktakes

By default the extractor looks for:
- service account: `../alma-stock-firebase-adminsdk-fbsvc-ac4e175402.json`
- legacy functions install: `../alma-stocktake/functions`
- output file: `./tmp/legacy-stock-export.json`

Use a different org, service account, output path, or functions directory when needed:

```bash
pnpm db:extract:legacy-stock -- --org-id alma --out ./tmp/alma-stock-export.json --service-account ../alma-stock-firebase-adminsdk-fbsvc-ac4e175402.json --legacy-functions-dir ../alma-stocktake/functions
```

The stock export includes both the nested Firestore source records and flattened arrays for:
- users
- products or items
- venues
- locations
- recipes and recipe lines
- sales
- stocktakes and stocktake lines
- invoices and invoice lines when present
- movements when present
- product and alias records derived from the legacy catalog

Once you have a `tmp/legacy-stock-export.json` (or any export produced by the
script above), bring the products, categories, and recipes into the new Alma
Stock schema:

```bash
pnpm db:import:legacy-stock
```

Pass `--file <path>` to read from somewhere other than
`tmp/legacy-stock-export.json`, or `--replace` to wipe existing
`StockItem` / `StockCategory` / `Recipe` / `RecipeLine` rows first. The
import is idempotent — repeated runs upsert by the legacy product / recipe
id rather than duplicating rows. On-hand counts are derived from the most
recent stocktake per (venue × template) where one exists; products without a
recent count start at zero. Recipe ingredient lines are linked to
`StockItem` by the legacy product id where the legacy match worked.

## Compliance additions

This compliance suite now has a clear path for:
- staff compliance records such as RSA, first aid, and food safety certificates
- incident reporting with people involved, treatment notes, and follow up
- fridge and freezer monitoring assets with temperature history
- govee temperature polling via API

Run the govee sync manually with:

```bash
pnpm db:sync:govee
```

Required env:

```env
GOVEE_API_KEY=your_api_key
GOVEE_API_BASE_URL=https://openapi.api.govee.com
```

For an hourly pull, keep the app-level sync in place and schedule `pnpm db:sync:govee` once the real `GOVEE_API_KEY` is present in `.env`. Without the key, the sync route and CLI stay safe but will return a clear credential error instead of creating noisy failures.

If the govee account authenticates but returns zero devices, use the Alma Control style fallback:
- discover and persist the connector state with `POST /api/temperatures/integrations/govee/discover`
- map external sensors to fridge assets with `PATCH /api/temperatures/sensors/:id`
- ingest live readings from another job or bridge with `POST /api/temperatures/integrations/webhook`

That lets compliance keep a live cold-chain trail even when direct device discovery is flaky.

### Camera feeds

Camera feeds are possible, but they should stay out of this first compliance pass unless you want live monitoring to become its own product lane. UniFi Protect at Freshie and DMSS at Avalon are two different vendor stacks, so the practical first version is:
- store the camera system details per venue
- link out to the live feed or relevant camera group from an incident record
- avoid trying to restream or proxy video inside the compliance app until incidents, staff, and temperature automations are stable

## Local URLs

| App | URL | Port |
| --- | --- | --- |
| Compliance web | http://localhost:5173 | 5173 |
| Compliance API | http://localhost:3018 | 3018 |
| Stock web | http://localhost:5174 | 5174 |
| Stock API | http://localhost:3019 | 3019 |
| Postgres | localhost:5438 | 5438 |

## Stock app

The Stock app (`apps/stock-web` + `apps/stock-api`) is a sibling product to
Compliance — same shell, same UI kit, with its own stock accent. It includes
real catalogue, stocktake, suppliers, invoices, recipes, and settings flows.
Stocktake submission is review-only: it does not mutate `StockItem.onHand`.
Approved stocktakes create `InventoryMovement` rows first, then update on-hand
inside the same ledger-backed transaction.

Run it alongside Compliance:

```bash
pnpm dev:stock          # both stock-api (3019) + stock-web (5174)
pnpm dev:stock-api      # just the API
pnpm dev:stock-web      # just the web
```

The two apps can run side-by-side in the same terminal session (use a second
tab for `pnpm dev`), and the Stock sidebar has an "Open Compliance" link
down at the bottom for quick switching.

## Deploying

Use [DEPLOYMENT.md](./DEPLOYMENT.md) as the production runbook.

Production uses managed Postgres, deployed API services, and separate deployed
frontend apps. Always apply migrations before starting the APIs:

```bash
pnpm db:migrate:production
```

Do not run `pnpm db:migrate`, `prisma migrate dev`, `pnpm db:seed`, or any
normal demo/local seed command against production.

After adding a new Prisma model or changing a field, generate a migration
locally with `pnpm db:migrate` (which wraps `prisma migrate dev`) — the
resulting `migration.sql` gets committed and applied automatically on the next
production deploy.

## Modules

### Issues
Implemented end to end with:
- create issue
- list issues
- detail page
- edit issue
- severity
- category
- status
- assignee
- due date
- notes
- evidence
- resolution notes
- activity log

### Checklists
Foundation included in schema and shared types. API and UI stubs are deliberately marked as next build target.

### Audits
Foundation included in schema and shared types. API and UI stubs are deliberately marked as next build target.
