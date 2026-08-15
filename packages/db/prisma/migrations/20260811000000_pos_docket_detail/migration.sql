-- Dockets must say what they are and who is accountable.
-- DINE_IN | TAKEAWAY — the kitchen plates and packs differently.
ALTER TABLE "PosOrder" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'DINE_IN';
-- Who called the course away. With sentAt this is the kitchen-performance
-- trail: ordered at (createdAt) -> fired at (sentAt) -> by whom.
ALTER TABLE "PosOrderLine" ADD COLUMN "sentByName" TEXT;
