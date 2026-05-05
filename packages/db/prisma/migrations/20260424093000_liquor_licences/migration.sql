-- Liquor licence types
CREATE TYPE "LiquorLicenceType" AS ENUM (
  'HOTEL',
  'ON_PREMISES',
  'SMALL_BAR',
  'CLUB',
  'PACKAGED',
  'PRODUCER_WHOLESALER',
  'LIMITED',
  'OTHER'
);

-- Liquor licence status
CREATE TYPE "LiquorLicenceStatus" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'PENDING'
);

CREATE TABLE "LiquorLicence" (
  "id"            TEXT NOT NULL,
  "venue"         TEXT NOT NULL,
  "licenceNumber" TEXT NOT NULL,
  "licenceType"   "LiquorLicenceType"   NOT NULL DEFAULT 'ON_PREMISES',
  "status"        "LiquorLicenceStatus" NOT NULL DEFAULT 'ACTIVE',
  "licensee"      TEXT NOT NULL,
  "issuer"        TEXT NOT NULL DEFAULT 'NSW Liquor & Gaming',
  "issueDate"     TIMESTAMP(3),
  "expiryDate"    TIMESTAMP(3),
  "tradingHours"  TEXT,
  "conditions"    TEXT,
  "restrictions"  TEXT,
  "notes"         TEXT,
  "documentName"  TEXT,
  "documentUrl"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiquorLicence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiquorLicence_licenceNumber_key" ON "LiquorLicence"("licenceNumber");
CREATE INDEX "LiquorLicence_venue_idx" ON "LiquorLicence"("venue");
CREATE INDEX "LiquorLicence_expiryDate_idx" ON "LiquorLicence"("expiryDate");
