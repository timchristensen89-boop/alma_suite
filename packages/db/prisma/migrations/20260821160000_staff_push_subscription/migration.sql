-- Devices that have agreed to be told when a roster is published.
--
-- Keyed by endpoint, unique across everyone: if a venue phone is handed on and
-- the new holder subscribes, the row moves to them rather than leaving the
-- previous owner receiving somebody else's shifts.
CREATE TABLE "StaffPushSubscription" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StaffPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPushSubscription_endpoint_key" ON "StaffPushSubscription"("endpoint");
CREATE INDEX "StaffPushSubscription_staffProfileId_idx" ON "StaffPushSubscription"("staffProfileId");

-- Cascade: offboarding somebody should stop their phone buzzing, not leave an
-- orphan row pointed at a profile that no longer exists.
ALTER TABLE "StaffPushSubscription" ADD CONSTRAINT "StaffPushSubscription_staffProfileId_fkey"
    FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
