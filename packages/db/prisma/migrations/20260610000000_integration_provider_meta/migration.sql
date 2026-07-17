-- Add META to the IntegrationProvider enum so Meta (Facebook/Instagram) OAuth
-- connections can be stored alongside Square/Xero/Deputy. ADD VALUE is safe
-- outside a transaction on PostgreSQL 12+ as long as the value isn't used in
-- the same migration (it isn't).
ALTER TYPE "IntegrationProvider" ADD VALUE IF NOT EXISTS 'META';
