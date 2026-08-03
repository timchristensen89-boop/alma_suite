-- Link the remaining issue assignees, preferring the surviving profile.
--
-- The earlier passes refused to guess when a name matched more than one
-- profile, which was right — but the common cause of that is a duplicate pair
-- where one has been merged into the other. Once merged there is no ambiguity
-- left: the survivor is the answer.
--
-- Accents are folded because the same person can appear as both "Golcalves"
-- and "Golçalves", which is exactly how 99 issues went unlinked.
UPDATE "Issue" i
   SET "assigneeStaffId" = m.id
  FROM (
    SELECT
      lower(translate(trim(sp."firstName" || ' ' || sp."lastName"),
                      'áàâãäçéèêëíìîïñóòôõöúùûüýÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ',
                      'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY')) AS name,
      min(sp.id) AS id
    FROM "StaffProfile" sp
    WHERE sp."mergedIntoStaffProfileId" IS NULL
    GROUP BY 1
    HAVING count(*) = 1
  ) m
 WHERE i."assigneeStaffId" IS NULL
   AND i.assignee IS NOT NULL
   AND i.assignee <> ''
   AND lower(translate(trim(i.assignee),
                       'áàâãäçéèêëíìîïñóòôõöúùûüýÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ',
                       'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY')) = m.name;
