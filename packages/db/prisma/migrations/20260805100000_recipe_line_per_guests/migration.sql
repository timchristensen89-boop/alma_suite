-- Set-menu component sharing: a line can be "shared between N guests",
-- dividing its component cost into the per-person menu cost.
ALTER TABLE "RecipeLine" ADD COLUMN "perGuests" DOUBLE PRECISION;
