-- Link an issue's assignee to a staff profile.
--
-- `assignee` is a free-text name, so when someone leaves nothing notices: the
-- area rule keeps writing their name and the issues become invisible. On this
-- database that is 99 open issues pointing at an archived profile.
ALTER TABLE "Issue" ADD COLUMN "assigneeStaffId" TEXT;

-- Resolve existing names to a profile only where exactly one matches, so an
-- ambiguous name is left unlinked rather than pinned to the wrong person.
-- Archived and merged profiles are included deliberately: the point is to be
-- able to FIND the issues owned by someone who has gone.
UPDATE "Issue" i
   SET "assigneeStaffId" = m.id
  FROM (
    SELECT lower(trim(sp."firstName" || ' ' || sp."lastName")) AS name, min(sp.id) AS id
      FROM "StaffProfile" sp
     GROUP BY 1
    HAVING count(*) = 1
  ) m
 WHERE i.assignee IS NOT NULL
   AND i.assignee <> ''
   AND lower(trim(i.assignee)) = m.name;

CREATE INDEX "Issue_assigneeStaffId_idx" ON "Issue"("assigneeStaffId");
