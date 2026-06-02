-- CreateTable
CREATE TABLE "NotificationRead" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationRead_staffProfileId_notificationId_key" ON "NotificationRead"("staffProfileId", "notificationId");

-- CreateIndex
CREATE INDEX "NotificationRead_staffProfileId_idx" ON "NotificationRead"("staffProfileId");
