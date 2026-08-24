# Database backups & restore

The production database is a single Docker volume (`postgres` service in the
VPS compose at `/opt/alma/deploy`). It is the only copy of every order,
timesheet, guest, gift-card balance — and every uploaded file, because supplier
invoices, handbook documents and gift-card artwork are stored as bytes in the
database rather than in an object store. Backups are not optional.

## What runs

`scripts/backup-db.sh` (on the VPS) makes a compressed `pg_dump` every night,
verifies it isn't empty or corrupt, copies it offsite if a bucket is
configured, and prunes local copies older than 14 days.

`scripts/restore-db.sh <dump.sql.gz>` restores one into the database. The dumps
use `--clean --if-exists`, so a restore fully replaces current contents.

## One-time setup (on the VPS)

1. **Pick an offsite target** and put it in the cron environment. Either:
   - `BACKUP_GCS_BUCKET="gs://alma-db-backups"` (uses `gcloud storage`, already
     installed for the Firebase project — create the bucket, give the VPS a
     service account with object-create on it), or
   - `BACKUP_RCLONE_REMOTE="b2:alma-db-backups"` (Backblaze B2 via `rclone`).

2. **Set the bucket's lifecycle** to keep ~30–90 days and delete older objects,
   so retention is the bucket's job, not the disk's.

3. **Install the cron** (as root):
   ```
   0 3 * * *  BACKUP_GCS_BUCKET="gs://alma-db-backups" /opt/alma/alma-suite/scripts/backup-db.sh >> /var/log/alma-backup.log 2>&1
   ```
   3am UTC is ~1–2pm Sydney — outside both venues' service. Move it if that
   ever overlaps a lunch trade.

4. **Confirm the first run** by hand before trusting the cron:
   ```
   BACKUP_GCS_BUCKET="gs://alma-db-backups" /opt/alma/alma-suite/scripts/backup-db.sh
   ```

## The restore drill (do this once, now)

"We have backups" is a hope until a restore has actually worked. Restore last
night's dump into a throwaway database and look at a few tables:

```
# copy the dump down, then into a scratch DB inside the postgres container
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" alma_restore_test'
gunzip -c <dump.sql.gz> | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_restore_test -v ON_ERROR_STOP=1'
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d alma_restore_test -c "SELECT count(*) FROM \"PosOrder\"; SELECT count(*) FROM \"GiftCard\";"'
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" alma_restore_test'
```

If those counts look right, the backup is real.

## Recovery objective

With a nightly dump, worst-case data loss (RPO) is ~24 hours — everything since
the last 3am run. If that's too much for gift-card and payment data, move to
more frequent dumps (hourly is cheap at this size) or Postgres WAL archiving for
point-in-time recovery. Nightly is the floor, not the ceiling.
