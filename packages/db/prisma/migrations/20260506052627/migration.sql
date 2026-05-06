-- AlterTable
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SuiteChatMessage'
      AND column_name = 'updatedAt'
  ) THEN
    ALTER TABLE "SuiteChatMessage" ALTER COLUMN "updatedAt" DROP DEFAULT;
  END IF;
END $$;
