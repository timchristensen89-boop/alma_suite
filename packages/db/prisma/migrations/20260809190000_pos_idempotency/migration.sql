ALTER TABLE "PosOrder" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "PosOrder_idempotencyKey_key" ON "PosOrder"("idempotencyKey");
