-- Enforce one task per source object at the DB level so concurrent
-- reconciles on multiple API instances can't insert duplicate AlmaTasks.
-- NULL sourceRefType/sourceRefId (manually-created tasks) are treated as
-- distinct by Postgres, so they remain unconstrained.
CREATE UNIQUE INDEX "AlmaTask_sourceApp_sourceRefType_sourceRefId_key"
  ON "AlmaTask"("sourceApp", "sourceRefType", "sourceRefId");
