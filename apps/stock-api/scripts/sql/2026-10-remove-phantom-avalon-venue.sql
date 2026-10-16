-- Remove the phantom venue "Avalon" (NOT RUN — needs approval).
--
-- On 1 Sep 2026 01:39 UTC a stock manager typed "Avalon" into what was then a
-- free-text Venue box on the New stocktake form (placeholder "Freshie,
-- Avalon…") and saved the default Full count. The API accepted the string and
-- ensureVenueStockRowsForLines created one VenueStockItem row per active item
-- for the new "venue": 830 rows, all onHand NULL, par 0. The stocktake itself
-- (cmti01rjj00qgoa01uhp30tw9, 830 lines) was never counted, never submitted,
-- never applied, and nothing references it. The real Alma Avalon count was
-- started 30 minutes later. Full investigation: docs/stock-duplicate-resolution-2026-10/avalon-phantom.md
--
-- Everything removed is first copied to three backup tables; the rollback at
-- the bottom restores it byte-for-byte. Run as ONE transaction so any guard
-- aborts cleanly:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f apps/stock-api/scripts/sql/2026-10-remove-phantom-avalon-venue.sql
--
-- Expected deltas (production, 16 Oct 2026): VenueStockItem 2,489 → 1,659;
-- Stocktake 35 → 34; StocktakeLine 9,456 → 8,626. No StockItem, cost, count or
-- real-venue holding changes.

-- 1. Snapshot every row about to go (full rows, types preserved).
CREATE TABLE _avalon_phantom_vsi_backup_20261016 AS
  SELECT * FROM "VenueStockItem" WHERE venue = 'Avalon';
CREATE TABLE _avalon_phantom_stocktake_backup_20261016 AS
  SELECT * FROM "Stocktake" WHERE id = 'cmti01rjj00qgoa01uhp30tw9';
CREATE TABLE _avalon_phantom_stocktake_line_backup_20261016 AS
  SELECT * FROM "StocktakeLine" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';

-- 2. Refuse to continue if production no longer matches what was reviewed.
DO $$
DECLARE n_vsi int; n_st int; n_ln int; n_counted int; n_mv int; n_task int; n_other_st int; n_onhand int;
BEGIN
  SELECT count(*) INTO n_vsi FROM _avalon_phantom_vsi_backup_20261016;
  SELECT count(*) INTO n_onhand FROM _avalon_phantom_vsi_backup_20261016 WHERE "onHand" IS NOT NULL;
  SELECT count(*) INTO n_st FROM _avalon_phantom_stocktake_backup_20261016
    WHERE venue = 'Avalon' AND status = 'IN_PROGRESS' AND "submittedAt" IS NULL AND "appliedAt" IS NULL AND "lockedAt" IS NULL;
  SELECT count(*) INTO n_ln FROM _avalon_phantom_stocktake_line_backup_20261016;
  SELECT count(*) INTO n_counted FROM _avalon_phantom_stocktake_line_backup_20261016
    WHERE "countedQty" IS NOT NULL OR "stockValueCents" IS NOT NULL OR notes IS NOT NULL;
  SELECT count(*) INTO n_mv FROM "InventoryMovement"
    WHERE "sourceStocktakeId" = 'cmti01rjj00qgoa01uhp30tw9'
       OR "sourceStocktakeLineId" IN (SELECT id FROM _avalon_phantom_stocktake_line_backup_20261016);
  SELECT count(*) INTO n_task FROM "ShiftTaskAssignment" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';
  SELECT count(*) INTO n_other_st FROM "Stocktake" WHERE venue = 'Avalon' AND id <> 'cmti01rjj00qgoa01uhp30tw9';
  IF n_vsi <> 830 THEN RAISE EXCEPTION 'expected 830 Avalon VenueStockItem rows, found %', n_vsi; END IF;
  IF n_onhand <> 0 THEN RAISE EXCEPTION '% Avalon holdings carry an onHand value — stop and look', n_onhand; END IF;
  IF n_st <> 1 THEN RAISE EXCEPTION 'phantom stocktake is not the untouched IN_PROGRESS row that was reviewed'; END IF;
  IF n_ln <> 830 THEN RAISE EXCEPTION 'expected 830 phantom lines, found %', n_ln; END IF;
  IF n_counted <> 0 THEN RAISE EXCEPTION '% phantom lines carry a count, value or note', n_counted; END IF;
  IF n_mv <> 0 THEN RAISE EXCEPTION '% inventory movements reference the phantom', n_mv; END IF;
  IF n_task <> 0 THEN RAISE EXCEPTION '% shift tasks reference the phantom', n_task; END IF;
  IF n_other_st <> 0 THEN RAISE EXCEPTION '% other Avalon stocktakes exist', n_other_st; END IF;
END $$;

-- 3. Delete, children first.
DELETE FROM "StocktakeLine"  WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9';           -- 830
DELETE FROM "Stocktake"      WHERE id = 'cmti01rjj00qgoa01uhp30tw9' AND venue = 'Avalon';   -- 1
DELETE FROM "VenueStockItem" WHERE venue = 'Avalon';                                        -- 830

-- 4. Prove it before the transaction commits.
DO $$
BEGIN
  IF (SELECT count(*) FROM "VenueStockItem" WHERE venue = 'Avalon') <> 0 THEN RAISE EXCEPTION 'Avalon holdings remain'; END IF;
  IF (SELECT count(*) FROM "Stocktake" WHERE venue = 'Avalon') <> 0 THEN RAISE EXCEPTION 'Avalon stocktake remains'; END IF;
  IF (SELECT count(*) FROM "StocktakeLine" WHERE "stocktakeId" = 'cmti01rjj00qgoa01uhp30tw9') <> 0 THEN RAISE EXCEPTION 'phantom lines remain'; END IF;
END $$;

SELECT 'VenueStockItem' AS tbl, count(*) FROM "VenueStockItem"
UNION ALL SELECT 'Stocktake', count(*) FROM "Stocktake"
UNION ALL SELECT 'StocktakeLine', count(*) FROM "StocktakeLine";

-- ROLLBACK (run separately, as one transaction, if the deletion must be undone):
--   INSERT INTO "Stocktake"      SELECT * FROM _avalon_phantom_stocktake_backup_20261016      ON CONFLICT (id) DO NOTHING;
--   INSERT INTO "StocktakeLine"  SELECT * FROM _avalon_phantom_stocktake_line_backup_20261016 ON CONFLICT (id) DO NOTHING;
--   INSERT INTO "VenueStockItem" SELECT * FROM _avalon_phantom_vsi_backup_20261016            ON CONFLICT (venue, "stockItemId") DO NOTHING;
-- Keep the three backup tables for at least one month-end cycle.
