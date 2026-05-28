-- Add DEPUTY to the IntegrationProvider enum so the new OAuth-based
-- Deputy integration can store an IntegrationConnection row, sync runs,
-- events, and OAuth state alongside Square and Xero. The previous
-- CSV-upload pathway in apps/api/src/services/deputy.service.ts is being
-- removed in the same change.
ALTER TYPE "IntegrationProvider" ADD VALUE 'DEPUTY';
