-- POS orders link to matched guests (reservation on the same table tonight).
ALTER TABLE "PosOrder" ADD COLUMN "guestId" TEXT;
ALTER TABLE "PosOrder" ADD COLUMN "reservationId" TEXT;
ALTER TABLE "PosOrder" ADD CONSTRAINT "PosOrder_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PosOrder_guestId_idx" ON "PosOrder"("guestId");
