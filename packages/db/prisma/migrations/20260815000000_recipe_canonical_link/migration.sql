-- Venue-twin link: twins point at one canonical member of their title group.
ALTER TABLE "Recipe" ADD COLUMN "canonicalId" TEXT;
CREATE INDEX "Recipe_canonicalId_idx" ON "Recipe"("canonicalId");
