# Multiple menus per venue — production deployment runbook (run from your Mac)

Target: Alma Suite `main` at merge commit `<MERGE_COMMIT>` (the merge of timchristensen89-boop/alma_suite#313; substitute the full hash once merged, and its first 7 characters wherever `<MERGE_SHORT>` appears).
Currently live, as recorded at the Menu Editor deploy on 8 Oct 2026 (server state — the repository cannot confirm any of it; the stack check before 1a and step 1a do): suite-api built from `9e6cf15` (image `deploy-suite-api:latest`, id `b07e2d8c1a4b`); `/opt/alma/alma-suite` HEAD = `9e6cf15`; Firebase site `alma-menus` at `9e6cf15`.

Same shape as the Menu Editor runbook. Each step has an **Expect** line; if the output does not match, stop there and send me only the output of that step. Three placeholders are deliberate and must be filled in before you start: `<MERGE_COMMIT>` / `<MERGE_SHORT>` (above) and `<vps>`, your SSH target for the production VPS — the host that holds `/opt/alma/deploy` and `/opt/alma/alma-suite`. The repository does not record the host; the Menu Editor runbook connected to it by IP.

Checked against PR head `6721375` (verified 8 Oct 2026; the two commits after `bdf5ada` (`c9e630e`, `6721375`) change the editor (EditorPage.tsx), the API save path's change detection (menu.service.ts, shared/menus.ts), tests/e2e and docs/menu-editor.md only — no migration, env, Dockerfile, compose or deployment-script change). If the PR gains commits before merge, re-check 1e (migration list) and section 3 wording.

## 0. Preconditions

- **The previous release (Menu Editor, `9e6cf15`) has never been confirmed live.** Its section 5 results were not reported. Before this deploy, from your Mac and a browser, confirm at least the read-only part:
  - `curl -sS https://alma-menus.web.app/version.json` reads `"commit": "9e6cf1526db4d7aedc33e571fb65a47328cb69b5"`;
  - `curl -sS https://api.almagroup.com.au/api/health` reads `{"ok":true,"db":"up"}`;
  - `curl -sSI -H 'Origin: https://alma-menus.web.app' https://api.almagroup.com.au/api/health | grep -i access-control-allow-origin` prints the Menus origin;
  - signed in at https://alma-menus.web.app, the home (still the `9e6cf15` build) shows two cards titled `St Alma` and `Alma Avalon` (subtitles `Food · freshwater alacarte` and `Food · avalon alacarte`); under each card's `LIVE` label a green `v1` badge followed by `published <date> by <name>`; each card's `Draft` line reads `No unpublished changes` and the header status reads `Everything published`; the header hint reads `PDF renderer ready`; History → v1 → `View PDF` opens and matches the printed menu. Note the two venue names — they are the venue headings in section 3. If a card shows `v2 in progress`, someone started a draft on the old release: note which venue — the row set in 1e gains a `DRAFT` row, and that draft prints `À la carte` too. If a card shows a `v2` or higher live badge, stop: a menu was republished since `9e6cf15` and this runbook's 1e expectations do not hold. (The `Food`-titled cards under a venue heading appear only after this deploy; section 3a describes them.)
  - https://alma-home.web.app shows the `MENUS` tile; Staff app → People → Profiles → open a staff profile (`/staff/<id>`): the `App access` card lists a `Menus` tile (status, role, Enable/Disable); expand the `Custom permissions` disclosure beneath it (collapsed by default) and confirm the Menus tile there shows the `Publish menus` toggle.
  - Optional, authenticated and read-only: as an admin, `GET https://api.almagroup.com.au/api/admin/system-health` must report `migrations.latest` = `20261007191211_menu_editor`. Anything else means the Menu Editor migration state differs from what this runbook assumes — stop and paste the response.
  If any of these fails, stop: this release builds on that one.
- Not between 02:25 and 03:15 on the VPS clock. Two nightly dumps run from the VPS root crontab in its local zone: 02:30 (`/opt/alma/deploy/backup.sh`, not in the repository) and 03:00 (`scripts/backup-db.sh`, `0 3 * * *`). At the `9e6cf15` deploy the VPS reported AEDT (MOTD `Thu Oct 8 04:52:29 AEDT 2026`), so the window is 02:25–03:15 AEDT; confirm it from the `%Z` that step 1 prints and stop if it is not `AEDT` (the box has changed; re-derive the window before continuing). `docs/backups.md` ("3am UTC is ~1–2pm Sydney") was written assuming a UTC host and does not describe this box — fix that doc in a later PR, not in this release.
- The migration is one statement: `ALTER TABLE "MenuVersion" ADD COLUMN "heading" TEXT NOT NULL DEFAULT ''` (`packages/db/prisma/migrations/20261008093000_menu_heading/migration.sql`). A constant `NOT NULL DEFAULT` on `ADD COLUMN` is a catalog-only change on PostgreSQL 11+, so it is instant whatever the row count; no lock worth mentioning; no other table touched. The running API keeps working while it is applied (it does not know the column and never selects `*`).
- **Migration path — ignore the repo's documented "production migration command".** `DEPLOYMENT.md`, `AGENTS.md` and `README.md` still name `pnpm db:migrate:production` as the production migration command, and `scripts/migrate-production.sh` wraps it. Do **not** run `scripts/migrate-production.sh`, `pnpm db:migrate:production` or `pnpm db:migrate:deploy` for this release. `scripts/migrate-production.sh` fetches `DATABASE_URL` from Google Secret Manager (project `alma-compliance`) and runs `prisma migrate deploy` through `cloud-sql-proxy` against the Cloud SQL instance `alma-compliance:australia-southeast1:alma-compliance-db` — that is not the production database, which is the `postgres` service in the VPS compose at `/opt/alma/deploy` (`docs/backups.md`). `pnpm db:migrate:production` and `pnpm db:migrate:deploy` are the same `prisma migrate deploy --schema prisma/schema.prisma` (`packages/db/package.json`) and migrate whatever `DATABASE_URL` your shell has (the repo default in `.env.example` is the local dev database on `localhost:5438`), not the VPS. The only migration path for this release is step 1e — `docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/packages/db && npx prisma migrate deploy --schema prisma/schema.prisma'` — run on the VPS from `/opt/alma/deploy` after the 1d build so it reads the migrations baked into the new image (the same in-container procedure as the headers of `scripts/xero-leave-dry-run.sh` and `scripts/prep-count-readiness.sh`). If the psql check in 1e does not print `heading|''::text` and a finished-row count exactly one higher than before, the migration did not reach the VPS database: stop and do not run 1f.
- No seed run. Nothing in this release creates or changes menus; every existing version — the two seeded live v1 menus and any in-progress draft found above — reads heading `''` after the migration and prints exactly as before (empty heading = the template title "À la carte"). The seed itself changed: it now skips a venue that has any menu on its template with at least one version (draft, published or archived) — whatever that menu is called now and whether or not the menu is archived — so a later accidental re-run after someone renames or archives "Food" cannot publish a duplicate. (A menu row with no versions at all, e.g. a new menu whose only draft was discarded, does not count; both live "Food" menus keep their published v1, so the guard holds for them.)
- Order matters: API first, then the menus-web frontend, without a long gap. The old frontend works against the new API (it ignores the new fields). The new frontend does **not** work properly against the old API: its home would read `Headed “undefined”` under every card, offer no `New menu` button on any venue, still show `Rename`/`Archive` to publishers (both fail with `Route not found`, since the old API has no `PATCH /api/menus/:id` or `POST /api/menus/:id/archive`), and list no archived menus. Drafting, history and PDFs would still work, so the page is wrong rather than down — never deploy menus-web first.
- Nothing else changes: no new environment variables. The API's Menus env is unchanged since `9e6cf15` (all of it dates from the Menu Editor commit `7061645`): `MENUS_WEB_URL` (CORS allow-list + links; the only one that must be set), plus the optional overrides `MENU_CHROME_PATH` (Chrome binary; unset, the renderer finds the Debian `/usr/bin/chromium` the Dockerfile installs) and `MENU_ASSETS_DIR` (print fonts/logos; unset, it uses the `apps/api/assets/menus` copied into the image). None needs touching — `apps/api/src/env.ts`, `Dockerfile` and `docker-compose.yml` are identical between `75aecfb` and the PR head, and the PR's only new `process.env` reads are in `*.integration.test.ts` and `apps/menus-web/e2e/*.mjs`. No Dockerfile or compose change, no other frontend. The merge also carries main's gift-card commit `75aecfb` (#314), which adds two scripts (`apps/api/scripts/reconcile-giftup-redemptions.ts`, `scripts/reconcile-giftup-redemptions.sh`) and no runtime API code; nothing runs them.

## 1. API on the VPS

**One operator, one lock.** On 9 Oct 2026 two sessions ran this runbook 23 s apart (two dumps, two `migrate deploy`, two `up -d`); nothing broke, but only because every step happened to be idempotent. Before step 1, take the release lock on the VPS and keep that shell open for the whole release:

```bash
ssh <vps>
exec 9>/opt/alma/deploy/.release.lock && flock -n 9 || { echo "ANOTHER RELEASE IS IN PROGRESS: $(cat /opt/alma/deploy/.release.who 2>/dev/null)"; exit 1; }
echo "$(date '+%F %T %Z') $USER@$(hostname) <your name / session>" > /opt/alma/deploy/.release.who
docker events --since 15m --filter type=container --format '{{.Time}} {{.Action}} {{.Actor.Attributes.name}}' | grep -vE 'exec_' | tail -5
```
Expect: no "ANOTHER RELEASE" line, and no `create`/`start` of a `deploy-suite-api-run-*` or `deploy-suite-api-1` container in the last 15 minutes that you did not cause. The lock is released when that shell exits; every other VPS command in this runbook runs from the same shell. A second operator who runs the block sees the name in `.release.who` and stops.


```bash
ssh <vps>
cd /opt/alma/deploy && date '+%H:%M %Z' && docker compose ps && df -h / | sed 1d
```
Expect: `%Z` prints `AEDT` and the time is outside 02:25–03:15; all five services `Up`; a few GB free.

### Before 1a — the shape of the production stack (server state; the repository cannot confirm it)

The repository's only compose file defines a local `postgres`; the production compose at `/opt/alma/deploy` is not in the repo. The five-service count, the `deploy-suite-api` image name and the `b07e2d8c1a4b` running id come from the Menu Editor runbook, so this check (plus 1a's id check) is the only confirmation of them. Record the output with the preflight evidence.

```bash
cd /opt/alma/deploy && docker compose config --services && docker compose config --no-interpolate | sed -n '/^  suite-api:/,/^  [a-z]/p' | grep -vE '^      [A-Z_]+:'
```
**`docker compose config` resolves `env_file` and prints every value in it — the production secrets — so the `grep -v` above drops the `environment:` lines; never run it bare and never paste its raw output into a chat, a ticket or a runbook (the 9 Oct 2026 deploy did, and the rotation in `docs/menus-v2/post-deploy-audit-2026-10-09.md` followed).** Expect: exactly five services listed (`caddy`, `compliance-api`, `postgres`, `stock-api`, `suite-api`); under `suite-api`: `build.context` is `/opt/alma/alma-suite` with `dockerfile: Dockerfile` (the repo root Dockerfile), NO `image:` key (so the built image is `deploy-suite-api:latest`), NO `entrypoint:` and NO `command:` other than the Dockerfile default (the image's CMD is `node apps/api/dist/apps/api/src/server.js`; nothing migrates on start), NO `volumes:` bind-mount over `/workspace` (a source mount would defeat the retag rollback in section 4), and `env_file: env/suite-api.env`. Stop if the service name, image name, build context or an entrypoint/command/volume override differs — 1a, 1c–1f and the section 4 rollback all assume this shape, and `docker compose run` in 1e replaces `command:` but still runs through any `entrypoint:`. (stock-api is built from the same Dockerfile; `docker compose build suite-api` leaves its image on the old build. That is fine for this release: the PR changes nothing under `apps/stock-api`, and stock-api never touches the Menu tables.)

```bash
grep -n 'alma-menus.web.app' /opt/alma/deploy/env/suite-api.env
```
Expect: exactly one line, either `MENUS_WEB_URL=https://alma-menus.web.app` or the origin inside `CORS_ORIGIN=…`. Note which. The API's allowlist is the union of `CORS_ORIGIN` and the `*_WEB_URL` variables read from this file at container start (`apps/api/src/env.ts`); the repository cannot tell which one carries the Menus origin. If it prints nothing, stop: the header seen in the section 0 curl is coming from somewhere other than this env file.

```bash
docker compose exec -T postgres psql -U alma -d alma_suite_v18 -At -F ' | ' -c "SELECT slug, name FROM \"Venue\" ORDER BY name;"
```
Expect exactly two rows: `alma-avalon | Alma Avalon` and `st-alma | St Alma` (the rows the Menu Editor seed created or found; the live Menus home already shows the two names as the card titles you checked in section 0). STOP on any other slug: `New menu` and the Start-from template exist only for a venue whose slug matches a print template (`st-alma`, `alma-avalon` in `packages/shared/src/menu-render.ts`), so a different slug means no `New menu` button anywhere and steps 3a.1 and 3b.4 cannot pass. A different name is not a blocker but changes the wording in section 3: the venue headings, `Copy of <venue> · Food (live v1)`, the `Rename`/`Archive <venue> · <menu>` labels and the editor header `<venue> <menu>` all print `Venue.name`.

### 1a. Tag the running image for rollback
```bash
docker inspect --format '{{.Image}}' $(docker compose ps -q suite-api) | cut -c8-19
docker tag deploy-suite-api:latest deploy-suite-api:prod-9e6cf15 && docker images deploy-suite-api
```
Expect: `b07e2d8c1a4b`; then `latest` and `prod-9e6cf15` both at `b07e2d8c1a4b` (and `prod-d8b029b` at `267137214b9f` still listed). These ids and tags are server state recorded at the previous deploy, not something the repository can confirm: treat them as the gate they are and stop if the running id differs.

Because the API exposes no build commit (health returns only `{ok, db}`; the image carries no commit label and no `.git`), prove the running image was built from `9e6cf15` rather than relying on the remembered id:
```bash
docker compose exec -T suite-api sh -c 'cd /workspace/packages/db/prisma/migrations && ls | grep -c "^[0-9]" && ls | grep "^[0-9]" | tail -1 && ls /workspace/apps/api/scripts/reconcile-giftup-redemptions.ts 2>/dev/null || echo no-giftcard-script'
```
Expect: `188`, `20261007191211_menu_editor`, `no-giftcard-script` (a `d8b029b` image shows 187 / `20261003000000_corporate_gift_cards`; a `75aecfb` image shows the gift-card script; a build of the merge shows 189 / `20261008093000_menu_heading`). Stop if the output differs.

Optional (robustness): tag the rollback image by the running container's id rather than by `latest`, so the tag cannot land on a stale rebuilt `latest`:
```bash
docker tag "$(docker inspect --format '{{.Image}}' "$(docker compose ps -q suite-api)")" deploy-suite-api:prod-9e6cf15 && docker images deploy-suite-api
```
Expect unchanged: `latest` and `prod-9e6cf15` both at `b07e2d8c1a4b`, `prod-d8b029b` at `267137214b9f`.

### 1b. Backup
```bash
cd /opt/alma/deploy && set -o pipefail && F=/opt/alma/backups/pre-menu-heading-$(date +%Y%m%d-%H%M%S).sql.gz && docker compose exec -T postgres pg_dump -U alma --no-owner --clean --if-exists alma_suite_v18 | gzip > "$F" && gzip -t "$F" && [ "$(stat -c%s "$F")" -gt 50000000 ] && ls -lh "$F" && echo "BACKUP_OK $F"
ls -lh /opt/alma/backups/pre-*
```
Expect: `BACKUP_OK …`; the size should be within a few MB of the previous `pre-menu-editor-*` dump in `/opt/alma/backups`, which was made with this same command. The nightly `alma-alma_suite_v18-*.sql.gz` files are made by `scripts/backup-db.sh` with `gzip -9` and the 02:30 `alma-suite-*.sql.gz` files by a script outside the repo, so neither is a like-for-like baseline; a size well under 50M fails the command. Record the actual size.

This dump is outside the nightly rotation: `scripts/backup-db.sh` prunes only `alma-alma_suite_v18-*.sql.gz` older than 14 days, so `pre-menu-heading-*.sql.gz` (~85 MB) stays on the VPS until removed by hand and is never copied offsite. Once the release is confirmed (end of section 3), `rm /opt/alma/backups/pre-menu-heading-*.sql.gz`, and remove the previous release's `pre-menu-editor-*.sql.gz` from the same directory if it is still there.

### 1c. Source to the merge commit
```bash
cd /opt/alma/alma-suite && [ -z "$(git status --porcelain)" ] && git fetch origin main && git merge --ff-only <MERGE_COMMIT> && echo "now HEAD=$(git rev-parse HEAD)"
```
Expect: `Fast-forward` and `now HEAD=<MERGE_COMMIT>`. Silence means a dirty tree; stop.

### 1d. Build
```bash
cd /opt/alma/deploy && docker compose build suite-api && NEW=$(docker inspect --format '{{.Id}}' deploy-suite-api:latest | cut -c8-19) && docker tag deploy-suite-api:latest deploy-suite-api:prod-<MERGE_SHORT> && echo "new image $NEW" && docker images deploy-suite-api
```
Expect: build succeeds (`pnpm install --frozen-lockfile` inside the Dockerfile accepts the committed lockfile — CI installed it the same way at `6721375`); `new image <NEW id>`; `latest` and `prod-<MERGE_SHORT>` both at that NEW id; `prod-9e6cf15` keeps `b07e2d8c1a4b`. The `prod-<MERGE_SHORT>` tag is what keeps the deployed image if section 4 ever retags `latest` back to `prod-9e6cf15`.

### 1e. Migration status, then apply

Pre-checks against the live database (the `heading` column does not exist yet, so neither query names it):
```bash
cd /opt/alma/deploy && docker compose exec -T postgres psql -U alma -d alma_suite_v18 -At -F '|' -c "SELECT ve.name, m.name, v.\"versionNumber\", v.state FROM \"MenuVersion\" v JOIN \"Menu\" m ON m.id = v.\"menuId\" JOIN \"Venue\" ve ON ve.id = m.\"venueId\" ORDER BY 1,2,3;" -c "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL), count(*) FILTER (WHERE finished_at IS NULL) FROM _prisma_migrations;"
```
Expect: after a seed-only history, exactly two rows `Alma Avalon|Food|1|PUBLISHED` and `St Alma|Food|1|PUBLISHED` (what `seed-menus.ts` produced). A `DRAFT` row is acceptable only if section 0 showed the matching `v2 in progress` badge; if the Menu Editor runbook's unreported section 5 steps 2–3 were run, St Alma also shows `Food|1|ARCHIVED` and `Food|2|PUBLISHED` — but then section 0 would have shown `v2` live, and you stopped there. Note the row set; stop on anything else. Then `191|0` — 188 repo migrations at `9e6cf15` + the three DB-only rows below, 0 unfinished. That figure is the previous runbook's expectation and was never confirmed, so record what it actually printed: the post-migration check must show exactly one more.

```bash
cd /opt/alma/deploy && docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/packages/db && npx prisma migrate status --schema prisma/schema.prisma'
```
Expect (first line on stdout, the rest on stderr; the command exits 1 whenever anything is pending — that is the normal result, not a failure):
```
189 migrations found in prisma/migrations
Your local migration history and the migrations table from your database are different:
The last common migration is: 20261007191211_menu_editor
The migration have not yet been applied:
20261008093000_menu_heading
The migrations from the database are not found locally in prisma/migrations:
20260531010000_stock_attachment
20260531020000_invoice_exclusion_rules
20260531030000_roster_area_settings
```
Pass only if the "have not yet been applied" list is exactly `20261008093000_menu_heading` and the "not found locally" list is exactly those three pre-existing DB-only names (the same three seen in the `d8b029b` and `9e6cf15` deploys; they are rows in `_prisma_migrations` with no directory in the repo and are not touched by this release). Paste the whole output back. STOP if any other name appears in either list, if `20261007191211_menu_editor` is listed as not yet applied (the Menu Editor migration never ran), or if a heading reads `Following migration(s) have failed`. If the three DB-only rows have since been resolved, the block instead reads `Following migration have not yet been applied:` followed only by `20261008093000_menu_heading`, with no "last common" line — that is also a pass.

```bash
cd /opt/alma/deploy && T=$(date +%H:%M) && echo "VPS time $T" && if [[ "$T" > "02:24" && "$T" < "03:16" ]]; then echo "NOT RUN: backup window"; else docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/packages/db && npx prisma migrate deploy --schema prisma/schema.prisma'; echo "migrate exit=$?"; fi
docker compose exec -T postgres psql -U alma -d alma_suite_v18 -At -F '|' -c "SELECT column_name, column_default FROM information_schema.columns WHERE table_name='MenuVersion' AND column_name='heading';" -c "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL), count(*) FILTER (WHERE finished_at IS NULL) FROM _prisma_migrations;" -c "SELECT ve.name, m.name, v.\"versionNumber\", v.state, v.heading FROM \"MenuVersion\" v JOIN \"Menu\" m ON m.id = v.\"menuId\" JOIN \"Venue\" ve ON ve.id = m.\"venueId\" ORDER BY 1,2,3;"
```
The gate uses the VPS clock, not the Mac's; it is only meaningful if step 1 printed `AEDT`. If it printed `NOT RUN`, wait and re-run this block.

Expect: `Applying migration \`20261008093000_menu_heading\``, `migrate exit=0`; then `heading|''::text`; `192|0` — exactly one more finished row than the pre-check printed, and 0 unfinished; then the same rows as the pre-check (normally `Alma Avalon|Food|1|PUBLISHED|` and `St Alma|Food|1|PUBLISHED|`), every row ending `|` — an empty heading each; a recorded draft row reads `…|n|DRAFT|`. Stop only if a row is missing, a heading is non-empty, the row set differs from the pre-check, or the count did not rise by exactly 1. If `heading|''::text` is missing, the migration did not reach this database — do not run 1f.

### Pause editing

**Tell the kitchens and managers to stop editing menus now and not to touch any open Menus tab until you say so.** From here until everyone has reloaded (end of section 2), a tab opened before the deploy still runs the `9e6cf15` build: it cannot see or set the printed heading, has no `New menu` / `Rename` / `Archive` controls, and if its menu is archived meanwhile it shows an ordinary save conflict (`Reload their changes`) and stays open instead of going read-only. menus-web has no in-app update check, so nothing but a reload moves a tab onto the new build. Saves also fail for the ~12 s the API restarts in 1f.

### 1f. Switch and check
```bash
docker compose up -d --no-deps --no-build suite-api && sleep 12 && docker compose ps suite-api && echo "running image: $(docker inspect --format '{{.Image}}' $(docker compose ps -q suite-api) | cut -c8-19)"
docker compose logs --since 2m suite-api | tail -20
curl -sS https://api.almagroup.com.au/api/health
curl -sSI -H 'Origin: https://alma-menus.web.app' https://api.almagroup.com.au/api/health | grep -i access-control-allow-origin
```
Expect: `Up`, the NEW id from 1d, `API listening`, no errors, `{"ok":true,"db":"up"}`, and `access-control-allow-origin: https://alma-menus.web.app` (same as section 0 — this release changes neither `apps/api/src/env.ts` nor the env file, so the new container reads the same allowlist).

## 2. menus-web on Firebase (Mac)

`scripts/deploy-frontends.sh` checks out and pulls the Mac's LOCAL `main`, seeds a missing `.env.production` from the example, runs a plain `pnpm install` (not frozen — pnpm only defaults to frozen in CI), builds `@alma/shared` then the app, stamps `dist/version.json` with `git rev-parse HEAD` of that checkout, and — unless `BUILD_ONLY=YES` — runs `firebase deploy` with no pause. Nothing in it confirms that local `main` is the merge commit, so this section pins `main` first, installs frozen itself, builds without deploying, checks the stamp, and only then deploys. `menus-web` must be present on every invocation of the script: with no argument it does not stop — it defaults to `stock-web venue-ipad-dashboard` and would rebuild and deploy those two apps to the live sites `alma-stock-v18` and `alma-ipad`, leaving `alma-menus` untouched. The deploy helpers (`scripts/deploy-frontends.sh`, `scripts/frontends-deploy-check.cjs`, `firebase.json`, `.firebaserc`) are byte-identical between `9e6cf15` and the PR head, so the script the Mac runs does not change under it.

**Mac preflight — run before anything else in this section. None of this can be checked from the repository.**

```bash
cd ~/alma_suite && git status -sb
pnpm --version
firebase projects:list 2>/dev/null | grep -c alma-compliance
if [ -f apps/menus-web/.env.production ]; then diff apps/menus-web/.env.production apps/menus-web/.env.production.example && echo ENV_OK; else echo ENV_ABSENT_WILL_BE_SEEDED; fi
```
Expect, in order:
- A single `## <branch>...origin/<branch>` line with **no `[ahead N]`** and **no file lines under it** (untracked `??` lines count — the script's `git status --porcelain` check refuses them). `[behind N]` and a branch other than `main` are fine: the next step checks out `main` and fast-forwards it. Stop on `[ahead N]`: those local commits would be built and stamped as HEAD and the live version.json would not read the merge commit.
- `10.32.1` — the `packageManager` pin in `package.json`; pnpm 10 switches itself to it inside the repo. Any other number is a pnpm too old to self-switch: stop and upgrade pnpm first, because the script runs `pnpm install` without `--frozen-lockfile` (CI does use it) and an old pnpm would rewrite `pnpm-lock.yaml` and build from unverified dependency versions.
- `1` — the firebase CLI is logged in on this Mac and can see project `alma-compliance` (the project `.firebaserc` and the script deploy to). `0` or an error: `firebase login` first.
- `ENV_OK` or `ENV_ABSENT_WILL_BE_SEEDED` (the script copies the example when the file is missing; it is gitignored). Any diff output means someone hand-edited the file: make it match the example before building. The build validator (`scripts/validate-vite-production-env.mjs`) only checks the API and cross-app URLs, not `VITE_MENUS_WEB_URL`, so a drift there would ship silently.

Then, in the Firebase console → Hosting → `alma-menus` → Release history, note the current release (its deploy time; the section 0 curl showed it is the `9e6cf15` build). That row is the rollback target in section 4.

**Pin local `main` to the merge commit.**
```bash
cd ~/alma_suite && [ -z "$(git status --porcelain)" ] && git checkout main && git fetch origin && git merge --ff-only <MERGE_COMMIT> && git rev-parse origin/main main && git log --oneline -1 main
```
Expect: `Fast-forward` (or `Already up to date.`); then two identical full hashes, both `<MERGE_COMMIT>`; the one-line subject is the #313 merge recorded in 1c (`Merge pull request #313 …` or `<PR title> (#313)`, depending on how it was merged). STOP if the merge is not a fast-forward or the two hashes differ: the Mac's `main` has local commits, and the script's `git pull` would refuse, merge or rebase them (depending on `pull.*` config) and stamp a commit that is not `<MERGE_COMMIT>`. Do not run the script until `main` equals `origin/main`. After this step the script's own `git checkout main && git pull origin main` is a no-op.

**Frozen install.**
```bash
cd ~/alma_suite && pnpm --version && pnpm install --frozen-lockfile
```
Expect: `10.32.1` and the install finishes without `ERR_PNPM_OUTDATED_LOCKFILE` — the lockfile at the merge commit is in sync with every workspace `package.json` (CI installed it frozen at `6721375`), so this is the frozen install the release requires. The script's own `pnpm install` that follows is NOT frozen, but after this step it has nothing to resolve.

**Build and stamp, deploy nothing.**
```bash
BUILD_ONLY=YES ~/alma_suite/scripts/deploy-frontends.sh menus-web
```
Expect: the second output line reads exactly `→ Apps:       menus-web` (stop — Ctrl-C — if it lists anything else); `→ At <MERGE_SHORT>` (if it shows anything else, stop: nothing has been deployed yet); `→ Building @alma/shared…`, `→ Building menus-web…`; `stamped N/12 built dists with <MERGE_SHORT>` (N is at least 1 — other apps' old `dist/` folders on this Mac are stamped too but are not deployed); then `✓ Built and stamped. BUILD_ONLY=YES, so nothing was deployed.`

```bash
cat ~/alma_suite/apps/menus-web/dist/version.json
```
Expect: `"commit": "<MERGE_COMMIT>"` and `"site": "alma-menus"`.

**Deploy `alma-menus` only.**
```bash
cd ~/alma_suite && git rev-parse HEAD && firebase deploy --only hosting:alma-menus --project alma-compliance
```
Expect: `<MERGE_COMMIT>`; the predeploy hook (`node scripts/frontends-deploy-check.cjs stamp`, from `firebase.json`) prints `stamped … with <MERGE_SHORT>` again; the firebase CLI finishes with `Deploy complete!` for `alma-menus` only (the other sites are untouched). The `--only hosting:alma-menus` is the same target the script would have resolved from `firebase.json` (`apps/menus-web/dist` → site `alma-menus`), and `alma-compliance` is `.firebaserc`'s default project.

```bash
git -C ~/alma_suite status --porcelain
curl -sS https://alma-menus.web.app/version.json
```
Expect: EMPTY output from `git status --porcelain` (`pnpm-lock.yaml` untouched — `apps/menus-web/.env.production`, `dist/` and `node_modules` are gitignored and never show); `"commit": "<MERGE_COMMIT>"`. If `git status` is not empty after the deploy, send the output and do not run any other deploy: the lockfile was rewritten by a pnpm other than 10.32.1 and the live build was not made from the committed lockfile.

**Refresh open tabs.** Ask everyone with Menus open to reload the tab (Cmd-R / pull to refresh). Anyone using the home-screen app on a phone or iPad must close it fully from the app switcher and reopen it — standalone mode has no refresh. A plain reload is enough: `index.html` is served `no-cache, no-store, must-revalidate`, the bundles under `/assets/` are content-hashed and immutable, and there is no service worker. Expect: the Menus home now shows `Headed “À la carte”` under each `Food` card and, signed in as a publisher, a `New menu` button for each venue with `Rename` and `Archive` on each card. Only then lift the editing pause and start section 3.

## 3. Live checks (browser, as a manager or the head chef)

**3a. Read-only — writes nothing.**

1. Menus home: one heading per venue, the two `Venue.name` rows from the check before 1a in name order (`Alma Avalon` then `St Alma`), each with its `Food` card showing, under the `LIVE` label, a green `v1` badge followed by `published <date> by <name>` and, under the name, `Headed “À la carte”`. Each venue heading has a `New menu` button (present only because the slug matched a template in that check); each card has `Rename` and `Archive`.
2. Under `St Alma`, press `History` on the `Food` card (the card itself is not clickable; `St Alma · Food` is how the dialogs and the archived list name the menu, not text on the grid). Expect the heading `St Alma Food history`, the v1 row badged `Live`, and `View PDF` opening the PDF unchanged. Do not start a draft on it just to look (`Editor` or `Restore as new draft`): a started-then-discarded draft permanently uses up a version number.
3. As a chef with draft-only access: no `New menu`, `Rename` or `Archive` buttons on the home, and the footer reads `You can draft; a manager or the head chef publishes and manages the list of menus.`

**3b. Optional write checks — these create a real menu with a published PDF in production.** It ends archived and stays in the database (nothing in the UI deletes). The same flow, plus the archive races and recovery cases, is already covered on a disposable database by `apps/menus-web/e2e` and the integration suites, so skip 3b unless you want to see it live.

4. `New menu` on the St Alma venue heading (not the page-header button, which preselects the first venue alphabetically) → the cursor is already in `Name`; type `Smoke test`, leave the heading blank, `Start from` is preselected as `Copy of St Alma · Food (live v1)` → `Create and open`. Expect the editor on a draft v1 with every dish from the live menu, header `St Alma Smoke test`, a `Heading` card whose `Printed heading` field has the placeholder `À la carte`.
5. Type `Tuesday` in the heading → the preview's italic title changes to `Tuesday` as you type. The toolbar reads `Unsaved changes`, then `Saving…`, and about two seconds after the last keystroke (1.5 s autosave delay plus the save round-trip) `Saved today HH:MM` appears (Sydney time, 24-hour).
6. `Publish…` → dialog `Publish v1 · first published version`, `No errors`, `What changes` lists every dish as added. Publish. Open the PDF: heading reads `Tuesday`, St Alma logo and tagline unchanged.
7. `Start another draft` on the smoke test, change only the heading to `Tuesday 2`, open `Publish…`: `What changes` reads `heading changed` with a `Heading` row `Tuesday → Tuesday 2`. Close without publishing (`Back to editing`).
8. Back to Menus: St Alma now shows two cards. `Rename` on the smoke-test card → a dialog headed `St Alma · Smoke test` with the cursor in `Name`; change it to `Smoke test 2` and press `Rename` (or Enter) → notice `Renamed to St Alma · Smoke test 2.` and the card title updates. `Archive` on that card → dialog `Archive St Alma · Smoke test 2?` (it notes `Its unpublished draft v2 is kept too.` and `The live v1 PDF stays downloadable from History.`) → `Archive menu` → notice `St Alma · Smoke test 2 archived. It is in the list at the bottom if you need it back.`; it disappears from the grid and appears under `Archived menus (1)` with `last live v1 · draft v2 kept`. `History` there still opens the PDF and offers no restore or editor buttons. `Unarchive` → notice `St Alma · Smoke test 2 is back on the home.` and it is back on the grid.
9. Still unarchived: sign in as a chef with draft-only access (no `Publish menus` toggle, not a manager/admin/head chef) and open `St Alma · Smoke test 2` from the home — its card shows `v2 in progress` under `Draft` and a `Continue draft` button (no `Rename`/`Archive`). The editor opens draft v2: the `Heading` card's `Printed heading` field is editable and reads `Tuesday 2`; the toolbar shows `Discard draft` and the note `Managers and the head chef publish.` where a publisher sees `Publish…`; every dish row offers `Copy to another menu`. Anything typed here autosaves to the smoke-test draft, so type nothing you want kept out. (For comparison, an archived menu's `/edit` URL shows only `This menu is archived` with `History` / `Back to Menus`, and the archived list offers a chef only `History`.)
10. Back as a manager: `Archive` it again and leave it archived (ask me for the SQL if you want it gone).

Once section 3 is confirmed, remove the hand-made dumps as noted in 1b.

## 4. Rollback

- **Pause menu editing before you start, and keep it paused for as long as the `9e6cf15` API is live.** Tell publishers and chefs to stop and close every Menus editor tab before the rollback, and check again after the API step that none is still open. The `9e6cf15` API has no archive check on any write: `POST`/`PUT`/`DELETE /api/menus/:id/draft`, `…/draft/preview`, `…/draft/publish`, `…/draft/items/copy-to` and `POST /api/menus/versions/:id/restore` all load the menu by id only, so a draft, save, publish, restore or dish copy aimed at an archived menu goes through. The old menus-web pages cannot open an archived menu themselves (their first call, `GET /api/menus/:id`, answers 404 because the old `get()` lists only `ACTIVE`); the exposure is an editor tab left open from before the rollback — the new editor keeps autosaving and only stops when the API answers `MENU_ARCHIVED`, which the old API never does — or a direct API call. Lift the pause only once the fixed API is running again, or after confirming no archived menu gained a version since the rollback: `SELECT m.name, v."versionNumber", v.state, v."updatedAt" FROM "MenuVersion" v JOIN "Menu" m ON m.id = v."menuId" WHERE m.status = 'ARCHIVED' ORDER BY v."updatedAt" DESC;` (every `updatedAt` must predate the rollback).
- **Order:** roll back menus-web first, then the API (the reverse of deploying), for the reason in section 0. Keep menu editing paused for the whole rollback and have every open tab reloaded again once the Firebase rollback is live: the `9e6cf15` API has no archive protection, and a new-frontend tab left against the old API reads `Headed “undefined”` (section 0).
- **Frontend**: Firebase console → Hosting → `alma-menus` → Release history → Rollback to the release that is the `9e6cf15` build (the one immediately before section 2's deploy if section 2 ran once; the console shows time and user, not the commit, so confirm with the check below). The old home ignores the new fields (it reads only `menus` and `renderer` from `GET /api/menus`, both still present). Then `curl -sS https://alma-menus.web.app/version.json` — Expect `"commit": "9e6cf1526db4d7aedc33e571fb65a47328cb69b5"`; if it still shows the merge commit, the wrong release was selected — pick again before touching the API. Ask everyone with a Menus tab open to reload it before the API is rolled back: nothing in the app detects a new build, and a tab still running the new frontend against the rolled-back API shows `Headed “undefined”` and no `New menu` (section 0). Do not use `scripts/deploy-frontends.sh` for the rollback: it always does `git checkout main && git pull origin main` and builds that, so it would redeploy the merge commit.
- **API only** (keeps the column): `cd /opt/alma/deploy && docker tag deploy-suite-api:prod-9e6cf15 deploy-suite-api:latest && docker compose up -d --no-deps --no-build suite-api`. The `9e6cf15` code never references `heading`; inserts take the `''` default, selects name their columns. No SQL needed. Roll forward again (once the fix is confirmed) with `cd /opt/alma/deploy && docker tag deploy-suite-api:prod-<MERGE_SHORT> deploy-suite-api:latest && docker compose up -d --no-deps --no-build suite-api`; the `prod-<MERGE_SHORT>` tag from 1d is what keeps the deployed image — after the rollback retag it would otherwise be untagged and a `docker image prune` would delete it, leaving only a rebuild to return to the release. What changes while rolled back: the editor preview and any version published while rolled back print the template title (`À la carte`) — the old renderer has no heading. PDFs already published with a heading (e.g. the 3b smoke test's `Tuesday` v1, or any real menu given a heading since the deploy) are stored bytes — `GET /api/menus/versions/:id/pdf` returns the saved `pdfData` without re-rendering — and keep printing that heading from Home → `Open PDF` and History → `View PDF`/`Download`/`Print` until that menu is republished under the old API; the `heading` column itself is untouched, so re-deploying the new API prints those headings again. A draft started while rolled back copies no heading (the column stays `''`), and archived menus are hidden from the home (the old code lists only `ACTIVE`) but are **not** protected at the API: the old service has no archive check on writes — `POST`/`PUT`/`DELETE /:menuId/draft`, `/draft/preview`, `/draft/publish`, `/draft/items/copy-to` and `/versions/:id/restore` all load the menu by id regardless of status — so an editor tab that was already open on a menu when it was archived (old or new build alike: the old API never answers `MENU_ARCHIVED` or reports `status`, so the new editor's read-only switch never trips) or a scripted call with a valid Menus token can still save, publish (publishers only) or restore on it. Opening an archived menu's URL fresh in the UI does not: `GET /api/menus/:id` goes through the `ACTIVE`-only list, so the editor shows `Could not load this menu — That menu does not exist.` and History shows the same error with no versions. Hence the pause above.
- **Backup**: the dump from 1b is the full restore point (`/opt/alma/alma-suite/scripts/restore-db.sh <dump>`, run on the VPS; it asks you to type the database name, and it drops and recreates every object because the dump was taken with `--clean --if-exists`). Restoring it removes every menu, draft and version created after it **and puts the schema back to pre-deploy**: `MenuVersion` comes back without `heading` and `_prisma_migrations` drops back to its pre-deploy row count (191). The new API keeps starting and `/api/health` still reads `{"ok":true,"db":"up"}` (it only runs `SELECT 1`), but every menu read and write then fails with Prisma P2022 (`MenuVersion.heading` does not exist) — so never leave the new image running on a restored database. Either restore together with the API-only rollback to `prod-9e6cf15` above, or re-run 1e's `migrate deploy` immediately after the restore (it re-applies `20261008093000_menu_heading`). In both cases finish with `docker compose restart suite-api stock-api`, as `scripts/restore-db.sh` prints (confirm those service names against `docker compose ps`). Prefer the API/frontend rollback above.
- **Column**: stays — do not drop the column or edit `_prisma_migrations`. Release instruction for this deploy: keep the additive column; do not reverse SQL or overwrite production records. The `9e6cf15` API never references `heading` (inserts take the `''` default, selects name their columns), so nothing needs or benefits from removing it. Do not run `ALTER TABLE "MenuVersion" DROP COLUMN "heading"` and do not edit `_prisma_migrations` as part of this rollback. (If a schema clean-up is ever wanted later, treat it as a separate, separately approved change: it may only run once the API is on `9e6cf15` — the `6721375` Prisma client reads `heading` on every MenuVersion read and write (menus home list, open editor, History → View, publish, save) and would fail every menu request with P2022 if the column vanished under it — it discards every heading typed since the deploy from draft rows (versions published since keep theirs inside `snapshotJson`), and because `/opt/alma/alma-suite` and the rebuilt image still carry the migration directory, `prisma migrate status` would list `20261008093000_menu_heading` as pending again and the next `migrate deploy` would re-apply it.)
- Menus created in the UI are ordinary `Menu` rows; the old code lists them too (status `ACTIVE`) and treats them like the seeded ones.
