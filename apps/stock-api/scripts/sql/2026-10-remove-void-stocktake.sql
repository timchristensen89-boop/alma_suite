-- Remove the venue-less "VOID" stocktake (NOT RUN — needs approval).
--
-- Stocktake cmq49xa2i0001s601z7kg0l2q ("VOID — stray count (likely 2025) —
-- 08/06/2026", venue NULL, IN_PROGRESS, 778 lines, "$31,128") is not a count.
-- It is the June 2026 New-stocktake screen's default draft: every active item
-- pre-filled with its system on-hand, saved with the venue blank and applied 48
-- seconds later — all 778 movements it wrote have quantityDelta = 0. Its $31k
-- is 80% per-case costs priced per bottle; every quantity on it exists on other
-- sheets or in the ledger (0 items are counted only here). COGS and stock
-- valuation already ignore it (IN_PROGRESS, venue NULL). Left alone it can
-- still be submitted and re-applied, which would overwrite 696 items' catalogue
-- on-hand with the June snapshot. Investigation: docs/stock-duplicate-resolution-2026-10/void-stocktake.md
--
-- Everything removed is first copied to three backup tables; the rollback at
-- the bottom restores it byte-for-byte. Run as ONE transaction:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f apps/stock-api/scripts/sql/2026-10-remove-void-stocktake.sql
--
-- Choose: Option C (below) also deletes the 778 zero-delta movements it wrote.
-- For an append-only ledger (Option C′) comment out the InventoryMovement DELETE;
-- the movements then stay with sourceStocktakeId NULL (FK ON DELETE SET NULL).

-- 1. Snapshot (schema-identical copies; CREATE TABLE AS keeps column order).
CREATE TABLE "_void_stocktake_backup_20261016"
  AS SELECT * FROM "Stocktake" WHERE id = 'cmq49xa2i0001s601z7kg0l2q';
CREATE TABLE "_void_stocktake_lines_backup_20261016"
  AS SELECT * FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';
CREATE TABLE "_void_stocktake_movements_backup_20261016"
  AS SELECT * FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';

-- 2. Guards: exactly what was reviewed, and nothing else, is about to go.
DO $$
DECLARE s int; l int; m int; nz int; rv int; v text; st text;
BEGIN
  SELECT count(*) INTO s FROM "_void_stocktake_backup_20261016";
  SELECT venue, status INTO v, st FROM "_void_stocktake_backup_20261016" LIMIT 1;
  SELECT count(*) INTO l FROM "_void_stocktake_lines_backup_20261016";
  SELECT count(*), count(*) FILTER (WHERE "quantityDelta" <> 0) INTO m, nz FROM "_void_stocktake_movements_backup_20261016";
  SELECT count(*) INTO rv FROM "InventoryMovement"
    WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q' AND "movementType" <> 'STOCKTAKE_ADJUSTMENT';
  IF s <> 1 OR v IS NOT NULL OR st <> 'IN_PROGRESS' OR l <> 778 OR m <> 778 OR nz <> 0 OR rv <> 0 THEN
    RAISE EXCEPTION 'void-stocktake snapshot mismatch: stocktake=% venue=% status=% lines=% movements=% nonzero=% other=%', s, v, st, l, m, nz, rv;
  END IF;
END $$;

-- 3. Delete. Option C: the zero-delta movements too.
DELETE FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q';   -- omit for Option C′
DELETE FROM "Stocktake" WHERE id = 'cmq49xa2i0001s601z7kg0l2q';                               -- lines go by ON DELETE CASCADE

-- 4. Verify (all four must be 0).
SELECT (SELECT count(*) FROM "Stocktake"     WHERE id = 'cmq49xa2i0001s601z7kg0l2q')            AS stocktake_left,
       (SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS lines_left,
       (SELECT count(*) FROM "InventoryMovement" WHERE "sourceStocktakeId" = 'cmq49xa2i0001s601z7kg0l2q') AS movements_left,
       (SELECT count(*) FROM "Stocktake" WHERE venue IS NULL)                                   AS venue_null_left;

-- ROLLBACK (run separately, as one transaction, before any migration deletes the items its lines point at):
--   INSERT INTO "Stocktake"         SELECT * FROM "_void_stocktake_backup_20261016";
--   INSERT INTO "StocktakeLine"     SELECT * FROM "_void_stocktake_lines_backup_20261016";
--   INSERT INTO "InventoryMovement" SELECT * FROM "_void_stocktake_movements_backup_20261016";  -- only if deleted above
-- Drop the three backup tables only after the duplicate-resolution PR is closed out.
