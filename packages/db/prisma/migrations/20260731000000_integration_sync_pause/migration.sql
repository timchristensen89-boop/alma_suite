-- Pause a connected integration without disconnecting it.
--
-- Reports sum SalesActualEntry.salesCents across every source for a venue+day,
-- so a POS feed left running while sales are entered by hand double counts the
-- day. Pausing stops syncs while leaving the OAuth tokens connected and
-- refreshing, so switching back is one click rather than a re-authorisation.
ALTER TABLE "IntegrationConnection" ADD COLUMN IF NOT EXISTS "syncPausedAt" TIMESTAMP(3);
ALTER TABLE "IntegrationConnection" ADD COLUMN IF NOT EXISTS "syncPausedReason" TEXT;
