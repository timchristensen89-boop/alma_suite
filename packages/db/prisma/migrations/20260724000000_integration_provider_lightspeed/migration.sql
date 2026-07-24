-- Add LIGHTSPEED to the IntegrationProvider enum so Lightspeed O-Series
-- (formerly Kounta) POS OAuth connections can be stored alongside
-- Square/Xero/Deputy/Meta/SevenRooms. ADD VALUE is safe outside a transaction
-- on PostgreSQL 12+ as long as the value isn't used in the same migration
-- (it isn't). Mirrors 20260610000000_integration_provider_meta.
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'LIGHTSPEED';
