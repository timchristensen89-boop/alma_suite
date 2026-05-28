-- GiftCard.design: which artwork the buyer chose at checkout. Free-text
-- string so the catalogue can grow without a schema change; the gift
-- cards web app validates against the known set (forest / shell /
-- avalon / stalma / thanks / summer). Older rows stay NULL and fall
-- back to the house design at render time.

ALTER TABLE "GiftCard" ADD COLUMN "design" TEXT;
