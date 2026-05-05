ALTER TABLE "AppSettings"
ADD COLUMN "onboardingSettings" JSONB NOT NULL DEFAULT '{}';
