-- Square Terminal support for the register: paired devices, and one row per
-- charge attempt so polling can never tender the same bill twice.

CREATE TABLE "PosTerminalDevice" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceCodeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "squareDeviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PAIRING',
    "locationId" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "pairedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminalDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosTerminalDevice_deviceCodeId_key" ON "PosTerminalDevice"("deviceCodeId");
CREATE INDEX "PosTerminalDevice_venue_status_idx" ON "PosTerminalDevice"("venue", "status");

CREATE TABLE "PosTerminalCheckout" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "squarePaymentId" TEXT,
    "paymentId" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTerminalCheckout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosTerminalCheckout_orderId_idx" ON "PosTerminalCheckout"("orderId");
CREATE INDEX "PosTerminalCheckout_status_idx" ON "PosTerminalCheckout"("status");

ALTER TABLE "PosTerminalCheckout" ADD CONSTRAINT "PosTerminalCheckout_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "PosOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTerminalCheckout" ADD CONSTRAINT "PosTerminalCheckout_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "PosTerminalDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
