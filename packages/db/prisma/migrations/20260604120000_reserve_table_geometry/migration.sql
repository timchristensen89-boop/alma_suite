-- Floor-plan geometry for Reserve tables.
-- posX/posY/width/height are percentages of the canvas (0–100), nullable until placed.
ALTER TABLE "ReserveTable" ADD COLUMN "posX" DOUBLE PRECISION;
ALTER TABLE "ReserveTable" ADD COLUMN "posY" DOUBLE PRECISION;
ALTER TABLE "ReserveTable" ADD COLUMN "width" DOUBLE PRECISION;
ALTER TABLE "ReserveTable" ADD COLUMN "height" DOUBLE PRECISION;
ALTER TABLE "ReserveTable" ADD COLUMN "rotation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ReserveTable" ADD COLUMN "shape" TEXT NOT NULL DEFAULT 'rect';
ALTER TABLE "ReserveTable" ADD COLUMN "seats" INTEGER;
