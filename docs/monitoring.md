# Monitoring: knowing when production breaks

Three layers, cheapest first. Each is independent — any one of them alone is
better than what existed before (finding out from a staff member's text).

| Layer | Catches | Cost |
| --- | --- | --- |
| UptimeRobot | API or a frontend down / unreachable | Free tier |
| Sentry | Crashes and 500s, with stack traces | Free tier is plenty at our volume |
| Backup heartbeat | The nightly `pg_dump` silently stopping | Free (part of UptimeRobot) |

The register also has its own last line of defence independent of all of
these: a crash on a till shows a recovery screen and emails support through
the bug-report pipe automatically (see `apps/pos-web/src/ErrorBoundary.tsx`).

## 1. UptimeRobot (do this first — ten minutes)

Create a free account at <https://uptimerobot.com> (50 monitors on the free
tier, 5-minute checks). Add HTTP(s) monitors:

| Monitor | URL | Why |
| --- | --- | --- |
| API | `https://api.almagroup.com.au/api/health` | The one that matters — POS, staff, stock, QR all die with it |
| POS | `https://alma-pos.web.app/` | Firebase hosting for the tills |
| Staff | `https://alma-staff.web.app/` | |
| Stock | `https://alma-stock.web.app/` | |
| Gift cards | `https://giftcards.almagroup.com.au/` | Guest-facing, takes money |
| Website | `https://almagroup.com.au/` | |

Alerts: email is on by default; add the free mobile app for push. Point
alerts at tim@almagroup.com.au.

The `/api/health` endpoint answers without auth and checks the database, so
one monitor covers "container up" and "Postgres reachable" together.

## 2. Sentry (crash reports with stack traces)

Everything is wired and **off by default**. No DSN in the environment means
the Sentry SDK is never loaded — zero cost, nothing to opt out of. Turning it
on is config only, no code changes.

### Setup

1. Create a free account at <https://sentry.io> (org e.g. `alma-group`).
2. Create two projects: one **Node.js** project (`alma-api`) and one
   **React** project (`alma-frontends` — one project for all three apps is
   fine at our volume; the app is distinguishable from the URL on each event).
3. Each project's settings show a **DSN** (`https://…@….ingest.sentry.io/…`).
   A DSN is a public write-only key, not a secret — it ships in the JS bundle
   on the frontend side. It still doesn't belong in chat; paste it straight
   into the files below.

### Turn on for the API (VPS)

Add to `/opt/alma/deploy/env/suite-api.env`:

```
SENTRY_DSN=<the alma-api project DSN>
```

then `docker compose up -d suite-api`. The boot log prints
`[sentry] error monitoring on` when it's active. From then on every
unexpected 500 and any uncaught crash is reported with the request path and
method attached. Expected 4xx (validation, wrong PIN, not-found) is never
reported.

### Turn on for the frontends

The DSN is baked in at **build time**: set `VITE_SENTRY_DSN` in the
environment when building, e.g. in the deploy-branch build step:

```
VITE_SENTRY_DSN=<the alma-frontends project DSN> pnpm --filter @alma/pos-web build
```

or put `VITE_SENTRY_DSN=…` in `apps/pos-web/.env.production` (and the staff /
stock equivalents) on the machine that builds the dists. Unset, the check
compiles out and the Sentry chunk is never even downloaded by a till.

Wired in: `apps/api/src/lib/sentry.ts` (init + capture from the error
handler), and the top of `main.tsx` in pos-web, staff-web and stock-web.

## 3. Backup heartbeat

The nightly database backup (see `docs/backups.md`) is the classic silent
failure: cron dies, disk fills, credentials expire — and nobody notices until
a restore is needed. UptimeRobot's **heartbeat monitor** inverts it: the
backup script pings a URL on success, and UptimeRobot alerts when the ping
*stops arriving*.

1. In UptimeRobot add a monitor of type **Heartbeat**, interval 1 day. It
   gives you a URL like `https://heartbeat.uptimerobot.com/m79…`.
2. On the VPS, append the ping to the backup cron line so it only fires when
   the script exits cleanly:

   ```
   0 3 * * *  BACKUP_GCS_BUCKET="gs://alma-db-backups" /opt/alma/alma-suite/scripts/backup-db.sh >> /var/log/alma-backup.log 2>&1 && curl -fsS -m 10 <heartbeat-url> > /dev/null
   ```

No backup for ~a day (grace is configurable) → alert.

## What this deliberately doesn't include

- **Tracing / performance monitoring** — `tracesSampleRate` is 0. The
  container logs already answer "was it slow"; sampling every request buys
  noise at our scale.
- **Log shipping** — `docker compose logs` on the VPS is adequate until it
  isn't. Revisit if debugging ever means "wish I had last month's logs".
- **Paging / on-call rotas** — email + phone push to one owner matches the
  size of the operation.
