-- Re-link issue assignees, ignoring accents.
--
-- The first pass compared names literally, so "Rodrigo Golcalves Silva" on 99
-- issues never matched the profile "Rodrigo Golçalves Silva" — and because
-- that profile is ARCHIVED, those 99 read as healthy owned work when they are
-- the single biggest hole in the backlog.
--
-- unaccent needs an extension; translate() does the job for the characters
-- that actually occur in these names without one.
UPDATE "Issue" i
   SET "assigneeStaffId" = m.id
  FROM (
    SELECT
      lower(translate(trim(sp."firstName" || ' ' || sp."lastName"),
                      'áàâãäçéèêëíìîïñóòôõöúùûüýÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ',
                      'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY')) AS name,
      min(sp.id) AS id
    FROM "StaffProfile" sp
    GROUP BY 1
    HAVING count(*) = 1
  ) m
 WHERE i."assigneeStaffId" IS NULL
   AND i.assignee IS NOT NULL
   AND i.assignee <> ''
   AND lower(translate(trim(i.assignee),
                       'áàâãäçéèêëíìîïñóòôõöúùûüýÁÀÂÃÄÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ',
                       'aaaaaceeeeiiiinooooouuuuyAAAAACEEEEIIIINOOOOOUUUUY')) = m.name;
