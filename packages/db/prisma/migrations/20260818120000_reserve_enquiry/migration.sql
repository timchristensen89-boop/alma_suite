-- Function/catering enquiries, and the conversation against each one.
--
-- recordFunctionEnquiry used to email the venue and persist nothing, so an
-- enquiry existed only as a message in somebody's mail client. These tables
-- give it a record the suite can list, reply to, and check for clashes.
-- NEW and GUEST_REPLIED are the two that want a human.
CREATE TYPE "ReserveEnquiryStatus" AS ENUM ('NEW', 'REPLIED', 'GUEST_REPLIED', 'BOOKED', 'CLOSED');
CREATE TYPE "ReserveEnquiryMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

CREATE TABLE "ReserveEnquiry" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'public-widget',
  "enquiryType" TEXT NOT NULL DEFAULT 'function',
  -- The sending system's own id, so a retried forward lands once.
  "externalRef" TEXT,
  "contactName" TEXT NOT NULL,
  "email" TEXT,
  "phone" TEXT,
  "venue" TEXT NOT NULL,
  "eventType" TEXT,
  "eventDate" TIMESTAMP(3),
  "partySize" INTEGER,
  "notes" TEXT,
  "status" "ReserveEnquiryStatus" NOT NULL DEFAULT 'NEW',
  "lastGuestReplyAt" TIMESTAMP(3),
  "lastStaffReplyAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  -- The subject every reply runs under, so the guest sees one thread.
  "emailSubject" TEXT,
  -- Filled in as the enquiry turns into a real booking.
  "guestId" TEXT,
  "reservationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ReserveEnquiry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReserveEnquiry_externalRef_key" ON "ReserveEnquiry"("externalRef");
CREATE INDEX "ReserveEnquiry_status_createdAt_idx" ON "ReserveEnquiry"("status", "createdAt");
-- The clash check: what else is already on this date at this venue.
CREATE INDEX "ReserveEnquiry_venue_eventDate_idx" ON "ReserveEnquiry"("venue", "eventDate");
CREATE INDEX "ReserveEnquiry_email_idx" ON "ReserveEnquiry"("email");

CREATE TABLE "ReserveEnquiryMessage" (
  "id" TEXT NOT NULL,
  "enquiryId" TEXT NOT NULL,
  "direction" "ReserveEnquiryMessageDirection" NOT NULL,
  "body" TEXT NOT NULL,
  "authorName" TEXT,
  "authorStaffId" TEXT,
  -- messageId is this message's RFC 5322 Message-ID (the provider's id for
  -- messages we sent); inReplyTo is what it answered. Together they are how
  -- an inbound reply finds the enquiry it belongs to.
  "messageId" TEXT,
  "inReplyTo" TEXT,
  "deliveryStatus" TEXT,
  "deliveryError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReserveEnquiryMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReserveEnquiryMessage_messageId_key" ON "ReserveEnquiryMessage"("messageId");
CREATE INDEX "ReserveEnquiryMessage_enquiryId_createdAt_idx" ON "ReserveEnquiryMessage"("enquiryId", "createdAt");

ALTER TABLE "ReserveEnquiry" ADD CONSTRAINT "ReserveEnquiry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "ReserveGuest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReserveEnquiryMessage" ADD CONSTRAINT "ReserveEnquiryMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "ReserveEnquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
