-- AlterEnum
ALTER TYPE "IssueStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';
ALTER TYPE "IssueStatus" ADD VALUE IF NOT EXISTS 'MONITORING';

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "area" TEXT;

-- AlterTable
ALTER TABLE "IssueEvidence" ADD COLUMN "note" TEXT;

-- CreateTable
CREATE TABLE "IssueAreaRule" (
    "id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "assignee" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueAreaRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueAreaRule_area_key" ON "IssueAreaRule"("area");
