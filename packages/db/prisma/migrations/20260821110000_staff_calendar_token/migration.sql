-- Per-staff calendar feed token.
--
-- The token is the credential: a calendar client polling a subscription cannot
-- carry a login, so the secret has to live in the URL. Unique so a lookup by
-- token is a single indexed hit and can never match two people.
ALTER TABLE "StaffProfile" ADD COLUMN "calendarToken" TEXT;
ALTER TABLE "StaffProfile" ADD COLUMN "calendarTokenIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "StaffProfile_calendarToken_key" ON "StaffProfile"("calendarToken");
