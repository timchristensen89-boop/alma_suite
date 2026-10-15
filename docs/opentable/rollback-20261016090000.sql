-- Rollback for packages/db/prisma/migrations/20261016090000_opentable_integration.
-- The migration is additive: two new tables, one new enum value, no change to
-- any existing table or row. Rolling back therefore cannot touch menus, venues,
-- staff or any other production data.
--
-- Run inside a transaction after a backup (see docs/menu-editor/backups.md):
--   docker exec -i alma_suite_v18 psql -U alma -d alma_suite -v ON_ERROR_STOP=1 < rollback-20261016090000.sql
BEGIN;
DROP TABLE IF EXISTS "OpenTableSyncRun";
DROP TABLE IF EXISTS "OpenTableVenueSetting";
-- Postgres cannot drop a single enum value. 'OPENTABLE' is never written by
-- any code path once the tables are gone (no IntegrationConnection row uses
-- it), so it is left in place; it is harmless and will be reused if the
-- feature returns.
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261016090000_opentable_integration';
COMMIT;
