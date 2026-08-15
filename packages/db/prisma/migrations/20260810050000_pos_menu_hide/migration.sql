CREATE TABLE "PosMenuHide" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "hiddenBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PosMenuHide_kind_key_key" ON "PosMenuHide"("kind", "key");
