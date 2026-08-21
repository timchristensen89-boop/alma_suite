-- Donation and sponsorship vouchers.
--
-- The (year, sequence) unique constraint is the annual cap expressed where it
-- cannot be raced: two managers issuing at once cannot both take number twelve.
CREATE TABLE "GiftCardDonation" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "organisation" TEXT NOT NULL,
    "cause" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "venue" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "local" BOOLEAN NOT NULL DEFAULT false,
    "bringsPeopleIn" BOOLEAN NOT NULL DEFAULT false,
    "named" BOOLEAN NOT NULL DEFAULT false,
    "existingRelationship" BOOLEAN NOT NULL DEFAULT false,
    "dgrEndorsed" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER NOT NULL DEFAULT 0,
    "listingEvidence" TEXT,
    "notes" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCardDonation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GiftCardDonation_giftCardId_key" ON "GiftCardDonation"("giftCardId");
CREATE UNIQUE INDEX "GiftCardDonation_year_sequence_key" ON "GiftCardDonation"("year", "sequence");
CREATE INDEX "GiftCardDonation_year_idx" ON "GiftCardDonation"("year");
CREATE INDEX "GiftCardDonation_organisation_idx" ON "GiftCardDonation"("organisation");
CREATE INDEX "GiftCardDonation_venue_idx" ON "GiftCardDonation"("venue");

ALTER TABLE "GiftCardDonation" ADD CONSTRAINT "GiftCardDonation_giftCardId_fkey"
    FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
