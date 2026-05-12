CREATE TABLE "StaffPasswordResetToken" (
    "id" TEXT NOT NULL,
    "staffProfileId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "requestedById" TEXT,
    "requestedByName" TEXT,
    "requestedByEmail" TEXT,
    "requestIp" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffPasswordResetToken_tokenHash_key" ON "StaffPasswordResetToken"("tokenHash");
CREATE INDEX "StaffPasswordResetToken_staffProfileId_createdAt_idx" ON "StaffPasswordResetToken"("staffProfileId", "createdAt");
CREATE INDEX "StaffPasswordResetToken_expiresAt_idx" ON "StaffPasswordResetToken"("expiresAt");

ALTER TABLE "StaffPasswordResetToken" ADD CONSTRAINT "StaffPasswordResetToken_staffProfileId_fkey" FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
