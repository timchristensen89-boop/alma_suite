-- How an inbound enquiry reply found its thread: 'message-id' (exact) or
-- 'sender-address' (spoofable best-effort). Nullable; existing rows stay null.
ALTER TABLE "ReserveEnquiryMessage" ADD COLUMN IF NOT EXISTS "matchedBy" TEXT;
