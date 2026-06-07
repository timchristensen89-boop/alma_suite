-- Cash wages: flat hourly rate paid in cash (not synced to Xero).
ALTER TABLE "StaffPayProfile" ADD COLUMN "cashHourlyRateCents" INTEGER;
