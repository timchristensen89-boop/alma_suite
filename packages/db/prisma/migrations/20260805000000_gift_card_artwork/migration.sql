-- CreateTable
CREATE TABLE "GiftCardArtwork" (
    "id" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardArtwork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardArtwork_giftCardId_key" ON "GiftCardArtwork"("giftCardId");

-- AddForeignKey
ALTER TABLE "GiftCardArtwork" ADD CONSTRAINT "GiftCardArtwork_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
