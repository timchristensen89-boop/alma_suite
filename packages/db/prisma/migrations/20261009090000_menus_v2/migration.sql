-- Menus V2: every kind of printed and website menu as data.
--
-- Additive only. Every new column has a default, so the two live à la carte
-- menus, their published snapshots and the running API keep working while
-- this applies (Prisma selects named columns and never `*`).

-- Menu: what kind of menu, a public identifier that survives renames, who may
-- see it, and the private-event details that never print.
ALTER TABLE "Menu" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'FOOD';
ALTER TABLE "Menu" ADD COLUMN "slug" TEXT;
ALTER TABLE "Menu" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "Menu" ADD COLUMN "eventName" TEXT;
ALTER TABLE "Menu" ADD COLUMN "eventDate" TIMESTAMP(3);
ALTER TABLE "Menu" ADD COLUMN "organiserRef" TEXT;
ALTER TABLE "Menu" ADD COLUMN "guestCount" INTEGER;

-- Backfill slugs from the current names ("Food" -> "food"), de-duplicated per
-- venue by creation order ("food", "food-2", ...). After this the slug is
-- minted once at creation and never changes.
WITH named AS (
  SELECT
    "id",
    COALESCE(NULLIF(TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '-', 'g'))), ''), 'menu') AS base,
    ROW_NUMBER() OVER (
      PARTITION BY "venueId", COALESCE(NULLIF(TRIM(BOTH '-' FROM LOWER(REGEXP_REPLACE("name", '[^A-Za-z0-9]+', '-', 'g'))), ''), 'menu')
      ORDER BY "createdAt", "id"
    ) AS n
  FROM "Menu"
)
UPDATE "Menu" m
SET "slug" = CASE WHEN named.n = 1 THEN named.base ELSE named.base || '-' || named.n END
FROM named
WHERE named."id" = m."id";

ALTER TABLE "Menu" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "Menu_venueId_slug_key" ON "Menu"("venueId", "slug");
CREATE INDEX "Menu_kind_status_idx" ON "Menu"("kind", "status");
CREATE INDEX "Menu_eventDate_idx" ON "Menu"("eventDate");

-- MenuVersion: the card and package fields. Empty strings and true/1 keep
-- every existing version printing exactly as it does today.
ALTER TABLE "MenuVersion" ADD COLUMN "subheading" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MenuVersion" ADD COLUMN "whenLine" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MenuVersion" ADD COLUMN "heroPriceCents" INTEGER;
ALTER TABLE "MenuVersion" ADD COLUMN "heroPriceUnit" TEXT;
ALTER TABLE "MenuVersion" ADD COLUMN "conditions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "MenuVersion" ADD COLUMN "showPrices" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MenuVersion" ADD COLUMN "pageCount" INTEGER NOT NULL DEFAULT 1;

-- MenuSection: which page it prints on, the new section types, a short caps
-- lead-in, a prose body (TEXT sections) and the price-column labels (TABLE).
ALTER TYPE "MenuSectionType" ADD VALUE 'TEXT';
ALTER TYPE "MenuSectionType" ADD VALUE 'LIST';
ALTER TYPE "MenuSectionType" ADD VALUE 'TABLE';
ALTER TYPE "MenuSectionType" ADD VALUE 'COURSE';
ALTER TABLE "MenuSection" ADD COLUMN "page" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "MenuSection" ADD COLUMN "lead" TEXT;
ALTER TABLE "MenuSection" ADD COLUMN "body" TEXT;
ALTER TABLE "MenuSection" ADD COLUMN "priceColumns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- MenuItem: per-column prices (TABLE sections; null = not offered), a small
-- detail after the name (ABV, region, vintage), a serving note and the
-- non-dietary marks (staff pick, limited, on tap).
ALTER TABLE "MenuItem" ADD COLUMN "prices" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "MenuItem" ADD COLUMN "meta" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "note" TEXT;
ALTER TABLE "MenuItem" ADD COLUMN "flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
