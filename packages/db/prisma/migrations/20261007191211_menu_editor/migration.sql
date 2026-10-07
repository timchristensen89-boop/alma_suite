-- Menu Editor: the printed food menus as data (Alma Suite Menus).
--
-- New tables only, plus one new value on the AlmaAppId enum so access to the
-- module can be granted like any other app. Nothing existing is rewritten.
--
-- Menu            one printed sheet per venue, locked to a print template
-- MenuVersion     draft / published / archived content, with the frozen
--                 snapshot and rendered PDF kept from the moment of publish
-- MenuSection     a heading on the sheet, with its column placement and type
-- MenuItem        a dish, with a stable dishKey carried across versions
-- MenuAuditEvent  who changed what and when

-- CreateEnum
CREATE TYPE "MenuVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MenuSectionType" AS ENUM ('STANDARD', 'HEADER_PRICED', 'SET_MENUS');

-- CreateEnum
CREATE TYPE "MenuPlacement" AS ENUM ('LEFT', 'RIGHT', 'FULL');

-- AlterEnum
ALTER TYPE "AlmaAppId" ADD VALUE 'MENUS';

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "versionCounter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuVersion" (
    "id" TEXT NOT NULL,
    "menuId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "state" "MenuVersionState" NOT NULL DEFAULT 'DRAFT',
    "dietaryNote" TEXT NOT NULL DEFAULT '',
    "surchargeLine" TEXT NOT NULL DEFAULT '',
    "snapshotJson" JSONB,
    "pdfData" BYTEA,
    "pdfByteSize" INTEGER,
    "pdfGeneratedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "restoredFromVersionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuSection" (
    "id" TEXT NOT NULL,
    "menuVersionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headerSuffix" TEXT,
    "subheading" TEXT,
    "sectionType" "MenuSectionType" NOT NULL DEFAULT 'STANDARD',
    "placement" "MenuPlacement" NOT NULL DEFAULT 'LEFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "dishKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER,
    "priceUnit" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSeafood" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "recipeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuAuditEvent" (
    "id" TEXT NOT NULL,
    "menuId" TEXT,
    "menuVersionId" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MenuAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Menu_venueId_idx" ON "Menu"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "Menu_venueId_name_key" ON "Menu"("venueId", "name");

-- CreateIndex
CREATE INDEX "MenuVersion_menuId_state_idx" ON "MenuVersion"("menuId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "MenuVersion_menuId_versionNumber_key" ON "MenuVersion"("menuId", "versionNumber");

-- CreateIndex
CREATE INDEX "MenuSection_menuVersionId_sortOrder_idx" ON "MenuSection"("menuVersionId", "sortOrder");

-- CreateIndex
CREATE INDEX "MenuItem_sectionId_sortOrder_idx" ON "MenuItem"("sectionId", "sortOrder");

-- CreateIndex
CREATE INDEX "MenuItem_dishKey_idx" ON "MenuItem"("dishKey");

-- CreateIndex
CREATE INDEX "MenuItem_recipeId_idx" ON "MenuItem"("recipeId");

-- CreateIndex
CREATE INDEX "MenuAuditEvent_menuId_createdAt_idx" ON "MenuAuditEvent"("menuId", "createdAt");

-- CreateIndex
CREATE INDEX "MenuAuditEvent_menuVersionId_createdAt_idx" ON "MenuAuditEvent"("menuVersionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuVersion" ADD CONSTRAINT "MenuVersion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuSection" ADD CONSTRAINT "MenuSection_menuVersionId_fkey" FOREIGN KEY ("menuVersionId") REFERENCES "MenuVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "MenuSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuAuditEvent" ADD CONSTRAINT "MenuAuditEvent_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
