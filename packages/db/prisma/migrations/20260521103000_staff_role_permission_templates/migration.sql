-- CreateTable
CREATE TABLE "StaffRoleTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleTitle" TEXT,
    "venue" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRoleTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffRoleTemplateAccess" (
    "id" TEXT NOT NULL,
    "roleTemplateId" TEXT NOT NULL,
    "appId" "AlmaAppId" NOT NULL,
    "status" "StaffAppAccessStatus" NOT NULL DEFAULT 'DISABLED',
    "role" TEXT NOT NULL DEFAULT 'USER',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffRoleTemplateAccess_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "StaffProfile" ADD COLUMN "roleTemplateId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StaffRoleTemplate_name_key" ON "StaffRoleTemplate"("name");

-- CreateIndex
CREATE INDEX "StaffRoleTemplate_isActive_idx" ON "StaffRoleTemplate"("isActive");

-- CreateIndex
CREATE INDEX "StaffRoleTemplate_venue_idx" ON "StaffRoleTemplate"("venue");

-- CreateIndex
CREATE UNIQUE INDEX "StaffRoleTemplateAccess_roleTemplateId_appId_key" ON "StaffRoleTemplateAccess"("roleTemplateId", "appId");

-- CreateIndex
CREATE INDEX "StaffRoleTemplateAccess_appId_status_idx" ON "StaffRoleTemplateAccess"("appId", "status");

-- CreateIndex
CREATE INDEX "StaffProfile_roleTemplateId_idx" ON "StaffProfile"("roleTemplateId");

-- AddForeignKey
ALTER TABLE "StaffRoleTemplateAccess" ADD CONSTRAINT "StaffRoleTemplateAccess_roleTemplateId_fkey" FOREIGN KEY ("roleTemplateId") REFERENCES "StaffRoleTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_roleTemplateId_fkey" FOREIGN KEY ("roleTemplateId") REFERENCES "StaffRoleTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
