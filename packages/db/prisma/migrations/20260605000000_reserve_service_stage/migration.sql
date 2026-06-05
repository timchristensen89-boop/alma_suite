-- In-service floor map: per-reservation seated time + course stage.
ALTER TABLE "ReserveReservation" ADD COLUMN "seatedAt" TIMESTAMP(3);
ALTER TABLE "ReserveReservation" ADD COLUMN "serviceStage" TEXT;
