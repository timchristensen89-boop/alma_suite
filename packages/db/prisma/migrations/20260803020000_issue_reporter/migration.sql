-- Record who raised an issue. Until now only the activity log carried the
-- reporter, as a free-text name, which cannot answer "show me what I reported".
ALTER TABLE "Issue" ADD COLUMN "reportedByStaffId" TEXT;
ALTER TABLE "Issue" ADD COLUMN "reportedByName" TEXT;

-- Backfill the name from the 'created' activity row each issue already has.
UPDATE "Issue" i
   SET "reportedByName" = a.actor
  FROM "IssueActivity" a
 WHERE a."issueId" = i.id
   AND a.action = 'created'
   AND a.actor IS NOT NULL
   AND a.actor <> 'system';

-- Resolve that name to a staff id only where exactly one live profile matches,
-- so an ambiguous name is left unlinked rather than attributed to the wrong
-- person.
UPDATE "Issue" i
   SET "reportedByStaffId" = m.id
  FROM (
    SELECT lower(trim(sp."firstName" || ' ' || sp."lastName")) AS name, min(sp.id) AS id
      FROM "StaffProfile" sp
     WHERE sp."mergedIntoStaffProfileId" IS NULL
     GROUP BY 1
    HAVING count(*) = 1
  ) m
 WHERE i."reportedByName" IS NOT NULL
   AND lower(trim(i."reportedByName")) = m.name;

CREATE INDEX "Issue_reportedByStaffId_idx" ON "Issue"("reportedByStaffId");
