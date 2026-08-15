-- POS-facing name vs. kitchen docket name. Both nullable and additive —
-- NULL means "use the existing title / name", so no existing row's printed
-- behaviour changes until someone deliberately sets an override.
ALTER TABLE "Recipe" ADD COLUMN "printTitle" TEXT;
ALTER TABLE "PosOrderLine" ADD COLUMN "printName" TEXT;
