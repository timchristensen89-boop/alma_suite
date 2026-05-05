-- StaffProfile: password + admin flags
ALTER TABLE "StaffProfile"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "isAdmin"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lastLoginAt"  TIMESTAMP(3);

-- StaffProfile: unique email (nullable uniques are allowed and NULLs distinct)
CREATE UNIQUE INDEX "StaffProfile_email_key" ON "StaffProfile"("email");

-- AppSettings singleton
CREATE TABLE "AppSettings" (
  "id"                   TEXT NOT NULL DEFAULT 'singleton',
  "orgName"              TEXT NOT NULL DEFAULT 'Alma Hospitality',
  "primaryContactName"   TEXT,
  "primaryContactEmail"  TEXT,
  "primaryContactPhone"  TEXT,
  "venues"               JSONB NOT NULL DEFAULT '[]'::jsonb,
  "goveeApiKey"          TEXT,
  "goveeBaseUrl"         TEXT DEFAULT 'https://developer-api.govee.com/v1',
  "notifyEmail"          TEXT,
  "notifyOverdueIssues"  BOOLEAN NOT NULL DEFAULT true,
  "notifyExpiringStaff"  BOOLEAN NOT NULL DEFAULT true,
  "notifyOutOfRangeTemp" BOOLEAN NOT NULL DEFAULT true,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- Ensure one and only one settings row (defensive — id already defaults to "singleton")
INSERT INTO "AppSettings" ("id", "updatedAt") VALUES ('singleton', CURRENT_TIMESTAMP)
  ON CONFLICT ("id") DO NOTHING;
