-- What a count covered (FOOD / BEVERAGE / COMBINED / UNKNOWN) and where its
-- date came from. Every existing count becomes UNKNOWN: historical scope is
-- not inferred from names or dollar values here, it is proposed record by
-- record for review (docs/stocktake-scope-remediation.md). No row's countedAt
-- is changed by this migration.
DO $$ BEGIN
  CREATE TYPE "StocktakeScope" AS ENUM ('FOOD', 'BEVERAGE', 'COMBINED', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Stocktake" ADD COLUMN IF NOT EXISTS "scope" "StocktakeScope" NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Stocktake" ADD COLUMN IF NOT EXISTS "scopeEvidence" TEXT;
ALTER TABLE "Stocktake" ADD COLUMN IF NOT EXISTS "countedAtText" TEXT;
ALTER TABLE "Stocktake" ADD COLUMN IF NOT EXISTS "countedAtSource" TEXT;
