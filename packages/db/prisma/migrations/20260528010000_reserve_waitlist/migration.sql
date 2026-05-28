-- Booking waitlist for the public reservation widget. When the desired
-- date+time is fully booked, the widget shows a name + phone capture
-- and POSTs to /api/reserve/public-widget/waitlist. The host can then
-- text/call entries when a table opens. SMS notification is a future
-- task; v1 captures only.

CREATE TYPE "ReserveWaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'BOOKED', 'EXPIRED', 'CANCELLED');

CREATE TABLE "ReserveWaitlistEntry" (
  "id"                   TEXT NOT NULL,
  "venue"                TEXT NOT NULL,
  "guestName"            TEXT NOT NULL,
  "guestPhone"           TEXT NOT NULL,
  "guestEmail"           TEXT,
  "partySize"            INTEGER NOT NULL DEFAULT 2,
  "windowStartsAt"       TIMESTAMP(3) NOT NULL,
  "windowEndsAt"         TIMESTAMP(3) NOT NULL,
  "notes"                TEXT,
  "status"               "ReserveWaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "source"               TEXT NOT NULL DEFAULT 'public-widget',
  "notifiedAt"           TIMESTAMP(3),
  "notifiedById"         TEXT,
  "notifiedByName"       TEXT,
  "matchedReservationId" TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReserveWaitlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReserveWaitlistEntry_venue_status_windowStartsAt_idx"
  ON "ReserveWaitlistEntry"("venue", "status", "windowStartsAt");

CREATE INDEX "ReserveWaitlistEntry_status_createdAt_idx"
  ON "ReserveWaitlistEntry"("status", "createdAt");
