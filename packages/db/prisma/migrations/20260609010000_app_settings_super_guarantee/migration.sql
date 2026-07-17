-- Admin-editable superannuation guarantee rate (percent, e.g. 12 = 12%).
-- Defaults to 12 to match the rate baked in previously (12% from 1 July 2025),
-- so existing costing figures are unchanged until an admin edits it.
ALTER TABLE "AppSettings" ADD COLUMN "superGuaranteePercent" DOUBLE PRECISION NOT NULL DEFAULT 12;
