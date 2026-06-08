-- AppSettings: store ABA (direct-entry) bank-file details for staff tip payments,
-- configurable in-app via Settings (read by staff.service buildAbaConfig with an
-- env-var fallback). Additive, non-breaking: defaults to an empty JSON object.
ALTER TABLE "AppSettings" ADD COLUMN "tipsAbaSettings" JSONB NOT NULL DEFAULT '{}';
