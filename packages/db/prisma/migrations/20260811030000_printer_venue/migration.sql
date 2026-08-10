-- Stations belong to a venue. NULL keeps the old "every venue" behaviour for
-- anything already configured.
ALTER TABLE "PosPrinterProfile" ADD COLUMN "venue" TEXT;
