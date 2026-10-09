-- Menus V2: promotions — the one record behind a What's On listing and its
-- printed card, with a publication history so the website only ever serves
-- what was published.
--
-- Additive only: three new tables and one nullable column on the audit log.

CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicTitle" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "dayLabel" TEXT NOT NULL DEFAULT '',
    "cadenceLabel" TEXT NOT NULL DEFAULT '',
    "timeLabel" TEXT NOT NULL DEFAULT '',
    "validDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startTime" TEXT,
    "startsOn" TIMESTAMP(3),
    "endsOn" TIMESTAMP(3),
    "heroPriceCents" INTEGER,
    "heroPriceUnit" TEXT,
    "priceLabel" TEXT NOT NULL DEFAULT '',
    "conditions" TEXT NOT NULL DEFAULT '',
    "bookDestination" TEXT NOT NULL DEFAULT 'OPENTABLE',
    "bookLabel" TEXT NOT NULL DEFAULT '',
    "bookUrl" TEXT,
    "imageId" TEXT,
    "menuId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByName" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionImage" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "data" BYTEA NOT NULL,
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionPublication" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "publicationNumber" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "menuVersionId" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT,
    "publishedByName" TEXT,

    CONSTRAINT "PromotionPublication_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MenuAuditEvent" ADD COLUMN "promotionId" TEXT;

CREATE UNIQUE INDEX "Promotion_menuId_key" ON "Promotion"("menuId");
CREATE UNIQUE INDEX "Promotion_venueId_slug_key" ON "Promotion"("venueId", "slug");
CREATE UNIQUE INDEX "Promotion_venueId_name_key" ON "Promotion"("venueId", "name");
CREATE INDEX "Promotion_status_sortOrder_idx" ON "Promotion"("status", "sortOrder");
CREATE UNIQUE INDEX "PromotionImage_fingerprint_key" ON "PromotionImage"("fingerprint");
CREATE INDEX "PromotionImage_promotionId_createdAt_idx" ON "PromotionImage"("promotionId", "createdAt");
CREATE UNIQUE INDEX "PromotionPublication_promotionId_publicationNumber_key" ON "PromotionPublication"("promotionId", "publicationNumber");
CREATE INDEX "PromotionPublication_promotionId_publishedAt_idx" ON "PromotionPublication"("promotionId", "publishedAt");
CREATE INDEX "MenuAuditEvent_promotionId_createdAt_idx" ON "MenuAuditEvent"("promotionId", "createdAt");

ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_menuId_fkey" FOREIGN KEY ("menuId") REFERENCES "Menu"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "PromotionImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PromotionImage" ADD CONSTRAINT "PromotionImage_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionPublication" ADD CONSTRAINT "PromotionPublication_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromotionPublication" ADD CONSTRAINT "PromotionPublication_menuVersionId_fkey" FOREIGN KEY ("menuVersionId") REFERENCES "MenuVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MenuAuditEvent" ADD CONSTRAINT "MenuAuditEvent_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "Promotion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
