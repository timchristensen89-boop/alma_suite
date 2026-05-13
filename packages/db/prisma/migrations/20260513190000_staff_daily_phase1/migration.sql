-- Add Staff Daily clocking and shift-confirmation foundation without
-- disturbing existing roster, leave, or timesheet data.

CREATE TYPE "StaffClockSessionStatus" AS ENUM ('OPEN', 'CLOSED', 'EXCEPTION');

CREATE TYPE "StaffClockEventType" AS ENUM (
  'CLOCK_IN',
  'START_BREAK',
  'END_BREAK',
  'CLOCK_OUT',
  'MANAGER_REVIEW'
);

CREATE TABLE "StaffShiftConfirmation" (
  "id" TEXT NOT NULL,
  "rosterShiftId" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "note" TEXT,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffShiftConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffClockSession" (
  "id" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "rosterShiftId" TEXT,
  "venue" TEXT,
  "area" TEXT,
  "roleTitle" TEXT,
  "clockInAt" TIMESTAMP(3) NOT NULL,
  "clockOutAt" TIMESTAMP(3),
  "status" "StaffClockSessionStatus" NOT NULL DEFAULT 'OPEN',
  "currentBreakStartedAt" TIMESTAMP(3),
  "accumulatedBreakMinutes" INTEGER NOT NULL DEFAULT 0,
  "managerNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffClockSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffClockEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "staffProfileId" TEXT NOT NULL,
  "rosterShiftId" TEXT,
  "venue" TEXT,
  "eventType" "StaffClockEventType" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdById" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StaffClockEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffShiftConfirmation_rosterShiftId_staffProfileId_key"
ON "StaffShiftConfirmation"("rosterShiftId", "staffProfileId");

CREATE INDEX "StaffShiftConfirmation_staffProfileId_confirmedAt_idx"
ON "StaffShiftConfirmation"("staffProfileId", "confirmedAt");

CREATE INDEX "StaffShiftConfirmation_rosterShiftId_confirmedAt_idx"
ON "StaffShiftConfirmation"("rosterShiftId", "confirmedAt");

CREATE INDEX "StaffClockSession_staffProfileId_clockInAt_idx"
ON "StaffClockSession"("staffProfileId", "clockInAt");

CREATE INDEX "StaffClockSession_status_clockInAt_idx"
ON "StaffClockSession"("status", "clockInAt");

CREATE INDEX "StaffClockSession_venue_status_clockInAt_idx"
ON "StaffClockSession"("venue", "status", "clockInAt");

CREATE INDEX "StaffClockSession_rosterShiftId_idx"
ON "StaffClockSession"("rosterShiftId");

CREATE INDEX "StaffClockEvent_sessionId_occurredAt_idx"
ON "StaffClockEvent"("sessionId", "occurredAt");

CREATE INDEX "StaffClockEvent_staffProfileId_occurredAt_idx"
ON "StaffClockEvent"("staffProfileId", "occurredAt");

CREATE INDEX "StaffClockEvent_venue_occurredAt_idx"
ON "StaffClockEvent"("venue", "occurredAt");

CREATE INDEX "StaffClockEvent_eventType_occurredAt_idx"
ON "StaffClockEvent"("eventType", "occurredAt");

ALTER TABLE "StaffShiftConfirmation"
ADD CONSTRAINT "StaffShiftConfirmation_rosterShiftId_fkey"
FOREIGN KEY ("rosterShiftId") REFERENCES "RosterShift"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffShiftConfirmation"
ADD CONSTRAINT "StaffShiftConfirmation_staffProfileId_fkey"
FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffClockSession"
ADD CONSTRAINT "StaffClockSession_staffProfileId_fkey"
FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffClockSession"
ADD CONSTRAINT "StaffClockSession_rosterShiftId_fkey"
FOREIGN KEY ("rosterShiftId") REFERENCES "RosterShift"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StaffClockEvent"
ADD CONSTRAINT "StaffClockEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StaffClockSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StaffClockEvent"
ADD CONSTRAINT "StaffClockEvent_staffProfileId_fkey"
FOREIGN KEY ("staffProfileId") REFERENCES "StaffProfile"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
