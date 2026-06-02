-- CreateTable
CREATE TABLE "NotificationMutePreference" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMutePreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationMutePreference_staffProfileId_idx" ON "NotificationMutePreference"("staffProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationMutePreference_staffProfileId_category_key" ON "NotificationMutePreference"("staffProfileId", "category");
