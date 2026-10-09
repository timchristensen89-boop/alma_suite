# Menus V2 — post-deployment audit (9 Oct 2026)

Audited from the Mac at 14:10–14:30 AEDT, about an hour after the release at `cfaa8eaf` went live. Read-only: no menu, price, booking, backup or credential was changed. Values of secrets are never written here — only their names.

## 1. Production health

| Check | Result |
|---|---|
| suite-api container | `Up`, image `009c25643308` (`deploy-suite-api:prod-cfaa8ea`), restart count 0, no error lines in the log since the switch |
| `/api/health` | `{"ok":true,"db":"up"}`; CORS header for `https://alma-menus.web.app` present |
| Other services | caddy, postgres (healthy), stock-api, compliance-api untouched; stock-api and compliance-api `/health` 200 |
| Migrations | `_prisma_migrations` 194 finished, 0 unfinished; the three `20260531*` DB-only rows remain (expected) |
| Firebase `alma-menus` | `/version.json` = `cfaa8eaf…`, served bundle hash matches the local build, sign-in page loads with no console errors |
| Public routes | `/api/public/menus/{st-alma,alma-avalon}` list the live `food` menu; `/api/public/whats-on` empty; `/api/public/menus/st-alma/food.pdf` 200, `application/pdf`, `Cache-Control: public, max-age=300` |
| Memory | 706 MB used of 1962 MB, 1256 MB available |
| Two sessions ran the runbook | `docker events` shows two `migrate` runs and two dumps 23 s apart (`pre-menus-v2-20261009-1401{13,36}`); the second `migrate deploy` found nothing pending and the second `up -d` was a no-op. No damage, but see "Next steps" — one operator per rollout. |

## 2. Security: what the deployment transcript exposed

The #313 runbook step "the shape of the production stack" ran `docker compose config`, which resolves `env_file` and prints every value. That output, plus a later `crontab -l`, went into the Claude session transcript (stored by the desktop app and, if the session is synced, by Anthropic). Treat every value below as exposed. The runbook is fixed in this PR so it cannot happen again.

**Exposed secret values (suite-api `env/suite-api.env` unless noted):**

| Variable | What it is | Also lives in |
|---|---|---|
| `DATABASE_URL` (contains `POSTGRES_PASSWORD`) | prod Postgres password | `.env` (compose), `stock-api.env`, `compliance-api.env` |
| `JWT_SECRET`, `SESSION_SECRET` (same value), `SUITE_AUTH_SECRET` | staff session signing; `SUITE_AUTH_SECRET` is the cross-app SSO secret | `compliance-api.env` (all three), `stock-api.env` (`SUITE_AUTH_SECRET`, `STOCK_JWT_SECRET` not exposed) |
| `INTEGRATION_TOKEN_ENCRYPTION_KEY` | encrypts stored Xero/Deputy/Square/Lightspeed OAuth tokens at rest | — |
| `INTEGRATION_SCHEDULER_SECRET` (= crontab `SCHED_SECRET`) | guards `/api/integration-jobs/*` | root crontab, `compliance-api.env` |
| `STRIPE_SECRET_KEY`, `STRIPE_SECRET_KEY__ST_ALMA`, `STRIPE_SECRET_KEY__ALMA_AVALON`, `STRIPE_WEBHOOK_SECRET` | live Stripe keys (gift cards, POS terminal) | Vercel website has its own `STRIPE_SECRET_KEY` (not exposed) |
| `SQUARE_PRIMARY_APPLICATION_SECRET`, `SQUARE_SECONDARY_APPLICATION_SECRET`, `SQUARE_PRIMARY_WEBHOOK_SIGNATURE_KEY`, `SQUARE_SECONDARY_WEBHOOK_SIGNATURE_KEY` | Square OAuth app secrets + webhook HMAC keys | Square developer dashboard |
| `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY` | Xero app | Xero developer portal |
| `DEPUTY_CLIENT_SECRET` | Deputy app | Deputy developer portal |
| `RESEND_API_KEY` | transactional mail (two identical lines) | `stock-api.env`; possibly the Vercel website and `/opt/alma/mail-agent` (not exposed, values unknown) |
| `GOOGLE_WALLET_PRIVATE_KEY` | service-account key `alma-wallet@alma-wallet-469812` | GCP IAM |
| `APPLE_WALLET_SIGNER_KEY` (base64 PEM) | pass-signing private key (cert expires 11 Sep 2027) | Apple developer portal (cert), Mac keychain p12 |
| `VAPID_PRIVATE_KEY` | web-push signing | — |
| `SEVENROOMS_INBOUND_TOKEN`, `LIGHTSPEED_INBOUND_TOKEN`, `ENQUIRY_INBOUND_TOKEN`, `ENQUIRY_FORWARD_TOKEN` | bearer tokens on inbound endpoints | `sevenrooms-poll.env`/`lightspeed-poll.env` (`SR_WEBHOOK_URL` carries the token), Vercel website `ENQUIRY_FORWARD_TOKEN` + `SUITE_ENQUIRY_TOKEN`, Resend inbound webhook |
| `POS_PRINT_SECRET` | only credential on the public print endpoints | print-bridge + Epson stations |
| alma-order `CRON_SECRET` (crontab bearer) | Vercel project `alma-order` cron auth | root crontab |

Not secret, exposed but harmless: `STRIPE_PUBLISHABLE_KEY`, `VAPID_PUBLIC_KEY`, Apple/Google public certs, client IDs, URLs.

**Other defects found in the same file (not exposures):**

- `API_PUBLIC_URL` is set twice (line 10 → `https://alma-giftcards.web.app`, line 51 → `https://api.almagroup.com.au`). Compose takes the last line, so the container is correct today — but anyone who deletes line 51 while tidying breaks every OAuth callback and the public menu URLs.
- `MARKETING_WEB_URL` is set twice and the **last (winning) line has a typo** (`alma-marketing.web.au`). CORS still works because `CORS_ORIGIN` lists the correct origin separately, but any link the API builds to the Marketing app is wrong.
- `RESEND_API_KEY` and `RESEND_FROM` are each set twice with identical values.
- `DEPUTY_WEBHOOK_SECRET` holds the literal setup-prompt text ("Deputy webhook secret (leave blank to skip):"), not a secret. Deputy webhook signature checks, if Deputy ever sends one, compare against that string.

### Prepared fix for the env file (NOT applied)

Run on the VPS as root, outside 02:25–03:15 local. It keeps a timestamped copy, deletes the four shadowed duplicates, blanks the Deputy placeholder, and restarts only suite-api (~12 s of API downtime; pause menu editing as in the runbook). Compose reads the file at container start, so the restart is what applies it.

```bash
cd /opt/alma/deploy && F=env/suite-api.env && cp -p "$F" "$F.bak-$(date +%s)" \
 && awk '
   /^API_PUBLIC_URL=https:\/\/alma-giftcards\.web\.app$/ {next}      # shadowed duplicate (line 10)
   /^MARKETING_WEB_URL=https:\/\/alma-marketing\.web\.au$/ {next}    # typo duplicate (line 76)
   /^RESEND_API_KEY=/ && seen_rk++ {next}                            # identical duplicate (line 74)
   /^RESEND_FROM=/ && seen_rf++ {next}                               # identical duplicate (line 75)
   /^DEPUTY_WEBHOOK_SECRET=.*leave blank/ {print "DEPUTY_WEBHOOK_SECRET="; next}
   {print}' "$F.bak-"* > "$F.new" \
 && grep -oE '^[A-Z_]+=' "$F.new" | sort | uniq -d && echo "(no duplicates above = good)" \
 && diff <(grep -oE '^[A-Z_]+=' "$F" | sort -u) <(grep -oE '^[A-Z_]+=' "$F.new" | sort -u) && echo "same variable set" \
 && mv "$F.new" "$F" && chmod 600 "$F" \
 && docker compose up -d --no-deps --no-build suite-api && sleep 12 \
 && docker compose exec -T suite-api sh -c 'printenv API_PUBLIC_URL MARKETING_WEB_URL' \
 && curl -sS https://api.almagroup.com.au/api/health
```

Expect: no duplicate names, `same variable set`, then `https://api.almagroup.com.au`, `https://alma-marketing.web.app`, `{"ok":true,"db":"up"}`. Note the file is mode 644 today (`compliance-api.env` and `stock-api.env` are 600); the `chmod 600` above fixes that too. The `.bak-*` copy holds the old values — remove it after the rotation below.

## 3. Credential rotation plan

Order chosen so nothing breaks mid-rotation; each row names every place the value must change. Do the rotation **after** the env-file fix above (one restart fewer) and announce a short Menus/POS pause for each API restart.

| # | Secret | Rotate where | Then update | Blast radius / notes |
|---|---|---|---|---|
| 1 | `INTEGRATION_SCHEDULER_SECRET` | generate (`openssl rand -base64 48`) | `suite-api.env`, `compliance-api.env`, root crontab `SCHED_SECRET` | None if crontab and env change together; a mismatch silently 401s every scheduled job (see the VPS cron gotcha memory) |
| 2 | `POS_PRINT_SECRET` | generate | `suite-api.env`, the print-bridge, each Epson station config | Dockets stop printing until the stations match — do it between services |
| 3 | Inbound tokens: `SEVENROOMS_INBOUND_TOKEN`, `LIGHTSPEED_INBOUND_TOKEN`, `ENQUIRY_INBOUND_TOKEN`, `ENQUIRY_FORWARD_TOKEN` | generate each | `suite-api.env`; `SR_WEBHOOK_URL` in `sevenrooms-poll.env` and `lightspeed-poll.env`; Vercel website `ENQUIRY_FORWARD_TOKEN`/`SUITE_ENQUIRY_TOKEN` (then a website redeploy — Vercel env is read at build); Resend inbound webhook URL if it embeds the token | Website redeploy is required for the enquiry token; that is a separate, approved website deploy |
| 4 | Stripe: three secret keys + `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Developers → API keys → roll (choose a grace period so the old key keeps working while env is updated); webhook endpoint → roll signing secret | `suite-api.env`; confirm the Vercel website key is a different key before touching it | Gift-card purchases and Square-Terminal-less POS card flows fail while mismatched; roll with the grace period, update env, restart, then expire the old key |
| 5 | Square app secrets + webhook signature keys (both venues) | Square developer dashboard: regenerate application secret; regenerate each webhook subscription's signature key | `suite-api.env` (`SQUARE_*_APPLICATION_SECRET`, `SQUARE_*_WEBHOOK_SIGNATURE_KEY`); `SQUARE_WEBHOOK_URL` must stay exactly `https://api.almagroup.com.au/webhooks/square` | Existing OAuth access tokens keep working; token refresh needs the new secret, so update env the same day. Send a test event per venue afterwards |
| 6 | `XERO_CLIENT_SECRET`, `XERO_WEBHOOK_KEY` | Xero developer portal: add a second client secret (two can coexist), later delete the old; regenerate webhook key | `suite-api.env`; re-run Xero's Intent-To-Receive check after the webhook key change | Payroll/timesheet push and supplier import reconnect may need Tim's re-auth if a refresh fails |
| 7 | `DEPUTY_CLIENT_SECRET` | Deputy developer portal | `suite-api.env` | Deputy sync; re-auth via OAuth if the stored refresh token stops refreshing |
| 8 | `RESEND_API_KEY` | Resend → API keys → create new, delete old | `suite-api.env` (one line after the fix), `stock-api.env`, Vercel website `RESEND_API_KEY` if it is the same key, `/opt/alma/mail-agent/agent.env` if it uses Resend | Gift-card, onboarding and enquiry mail fail while mismatched |
| 9 | `GOOGLE_WALLET_PRIVATE_KEY` | GCP → IAM → service account `alma-wallet@…` → create key, then delete the exposed key id | `suite-api.env` | Google Wallet passes already issued stay valid (signed JWT at issue time); new "Add to Google Wallet" links fail until env matches |
| 10 | `APPLE_WALLET_SIGNER_KEY` | New CSR + new Pass Type ID certificate in the Apple developer portal (p12 → PEM recipe in memory); revoke the old cert last | `suite-api.env` (`APPLE_WALLET_SIGNER_CERT` + `_KEY`) | Issued passes keep working; pass updates re-sign with the new cert |
| 11 | `VAPID_PRIVATE_KEY` (+ public) | generate a new pair (`npx web-push generate-vapid-keys`) | `suite-api.env` both keys only — staff-web fetches the public key from the API at runtime (`apps/staff-web/src/lib/push.ts`), no frontend rebuild | **Every existing push subscription dies**; staff must re-enable notifications in the Staff app |
| 12 | `JWT_SECRET`/`SESSION_SECRET`/`SUITE_AUTH_SECRET` | generate | `suite-api.env`, `compliance-api.env`, `stock-api.env` (`SUITE_AUTH_SECRET`) — all three services restart together | **Signs everyone out of every suite app, the POS and the venue iPads** the moment it restarts. Do it at close, after the smaller rotations |
| 13 | `INTEGRATION_TOKEN_ENCRYPTION_KEY` | **No re-encrypt script exists** (`apps/api/src/lib/integration-crypto.ts` only encrypts/decrypts) — write one first (decrypt every `IntegrationConnection` token row with the old key, encrypt with the new, in one transaction) or accept re-authenticating every integration | `suite-api.env` | Without re-encryption Xero, Deputy, Square ×2 and Lightspeed must all be re-connected by Tim. Lowest urgency: it only matters to someone who also holds a DB dump |
| 14 | `POSTGRES_PASSWORD` (`DATABASE_URL`) | `ALTER USER alma WITH PASSWORD …` inside the container | `.env`, `suite-api.env`, `stock-api.env`, `compliance-api.env`; restart all three APIs | Postgres is not internet-exposed, so this is hygiene; do it with #12 since it is the same restart |
| 15 | alma-order `CRON_SECRET` | Vercel project `alma-order` → env → new value + redeploy | root crontab (four lines) | Table-ordering reconcile/queue crons 401 until both sides match |

Verify after each API restart: `/api/health`, one gift-card test purchase in Stripe test mode is not possible on live keys — instead check `docker compose logs --since 5m suite-api` for `401`/`signature` errors and send a Square test webhook. Keep `suite-api.env.bak-1787348614` (22 Aug) and the new `.bak-*` only until the rotation is done, then shred them: they are plaintext copies of the old values.

## 4. Disk and backups

| Item | State |
|---|---|
| Root disk | 32 G used of 40 G (84 %), 6.4 G free. One more full `docker compose build` (2.5 GB image + cache) is the risk line |
| Docker images | 18.4 GB total, **10.6 GB reclaimable**: `prod-d8b029b`, `prod-45e5921`, `prod-34c34b07`, `release-07752f5` (suite + stock), `rollback-2e4e903` (suite + stock), dangling `node:22`. Keep `latest`/`prod-cfaa8ea` and `prod-9e6cf15` |
| Build cache | 7.4 GB, 43 MB reclaimable (the rest backs the current image layers) |
| Nightly dumps (02:30 `backup.sh`) | 12 on disk, 28 Sep – 9 Oct, 79–89 MB; offsite copies confirmed in `gcs:alma-suite-backups/2026/09` and `/10`; 14-day local prune working |
| Nightly dumps (03:00 `backup-db.sh`) | log says "done" each night, prunes `alma-alma_suite_v18-*`; none older than 14 days on disk |
| Hand-made pre-release dumps | **Twelve** `pre-*` files, 31 Jul – 9 Oct, ~900 MB total, never offsite, never pruned. Of these only `pre-menus-v2-20261009-140113.sql.gz` (and its 23-second twin `…140136`) are this release's restore points |
| Retention gap | Nothing on disk or offsite older than the bucket's 30-day lifecycle; no monthly/yearly snapshot exists. A clean `pre-financial-docs`/`pre-menus-v2` dump copied to the bucket under `archive/` would be the cheapest fix |

Recommended (not done, per instruction): once the release is signed off, delete the ten older `pre-*` files and the `…140136` twin (~800 MB), `docker image rm` the seven stale tags (~10 GB), and copy one quarterly dump to the bucket under a prefix the lifecycle rule does not delete.

## 5. Who can publish menus

**Corrected 9 Oct 2026, 15:10 AEDT (the first version of this section was wrong).** The API admits anyone with an ENABLED `MENUS` *or* `COMPLIANCE` grant into `/api/menus` (`auth-middleware.ts`), and the publish rule (`canPublishMenus`) says yes to admins, to the `MANAGER` session role — which `auth.service.ts` derives from a role title matching *manager / supervisor / lead / owner / admin* — and to anyone whose title contains "head chef", before it even looks at a Menus grant.

Production today: zero `StaffAppAccess` rows for `MENUS`, but every person below has `COMPLIANCE` enabled. So at the API:

| Person | Role title | Can reach the Menus API | Can publish, any venue |
|---|---|---|---|
| Tim Christensen, Hamilton Murphy | Admin / Venue Manager (isAdmin) | yes | yes |
| Dirk Wright, Trystan Ziemer | Venue Manager (session role MANAGER by title) | **yes** | **yes — both venues** |
| Caio Dias, Citlally Ramos, Rodrigo Golcalves Silva | Head Chef (title rule) | **yes** | **yes — both venues** |

The Menus web app's own gate (`AppAccessGate appId="MENUS"`) hides the UI from them until a Menus grant exists, so nobody has published by accident — every action so far is Tim's or the seed's — but the server-side rule is wider than the business wants (chefs draft only; venue managers publish their own venue only), and the model has **no venue scope at all**. Granting the Menus app under the current rule would hand all five of them publish rights on both venues.

Fix: PR "Menus: venue-scoped, explicit publishing" (branch `feat/menus-venue-scoped-publishing`) — publishing becomes an explicit Menus grant (level MANAGER/ADMIN or the "Publish menus" tick; admins excepted), role titles and the MANAGER session role no longer imply it, two "Limit to <venue>" ticks confine a grant to a venue for reading, drafting and publishing, every `/api/menus` route resolves the venue and refuses out-of-scope requests (404 on reads, 403 on publishes), and `/api/menus` requires the Menus grant itself rather than Compliance. The grants for the five people are prepared in that PR's description and must not be applied until it is deployed.

## 6. Imported drafts and source documents

`scripts/import-menus-v2.ts` has **not** been run: `Menu` holds only the two `food` menus, `Promotion` is empty. So there are no imported drafts to review yet — what follows is the review of what the import *would* create, from `import-inventory.md` checked against Dropbox on 9 Oct:

- Dropbox has **no PDF newer than the inventory's sources** for Happy hour, Lunch special or Bottomless (every file in `/Family Room/Indesign` carries the 8 Aug 2026 sync stamp; the design dates in the filenames match the inventory). The two `.indd` files edited after their last export (`ALMA_MENU HAPPY HOUR.indd` May 2026, `ALMA_MENU A5 LUNCH SPECIAL.indd` Feb 2026) still have no newer PDF, so the importer's text is the latest exported state.
- The St Alma drinks binder transcribes to 75 sections. `MENU_LIMITS.sectionsMax` is already **160** at the released commit (the 60 figure in the inventory's review note was stale; `st-alma-drinks.test.ts` asserts the binder fits, and the production dry-run on 9 Oct listed it as creatable). No code change needed; the note is corrected in this PR.
- Both drinks books lose the hand-set cover contents line and page eyebrows (template has no slot) — a renderer feature, not a content fix.
- Taco Tuesday has no card; Taco Wednesday has no card and no menu.

## 7. Content discrepancies needing the owner's decision (from `plan.md` §5 and the inventory)

1. **Happy hour hours** (Avalon): A5 card + Jun What's On say Tue–Thu 5–6 / Fri–Sun 4–6; Jan 2026 page says Tue–Fri 5–6 / Sat–Sun 4–6; website says Wed–Sun. Pick one.
2. **Bottomless days**: St Alma Fri–Sun 12–4 (website) — card has no days; Avalon Sat–Sun 12–4 (website) vs 12–3 (Jun sheet, Jan page).
3. **Bottomless drink inclusions** differ across four documents (A5 cards, set-menu pack, functions menu). Pick one list per venue.
4. **Which St Alma bottomless card is current**: the 15 Nov 2025 design-folder card (imported) or the 8 Nov card the website serves (two dishes/one beer differ).
5. **Set Menu Pack review.pdf** (Grazing 49 / Feasting 79 / Bottomless 99): approved or still a draft?
6. **Taco Tuesday prices**: the card is at the July 2026 level; the Sep à la carte is +$1 on every priced dish. Follow or hold?
7. **Lunch special**: Avalon-only? Days? (Card has none; Jan page says Sat & Sun 12–3.)
8. **Price notation on cards**: `99 pp` (default) or `$99 pp`.
9. **A5 look**: forest ink on white (default) or terracotta accent; St Alma portrait or landscape.
10. **Taco Tuesday**: separate menu or derived variant of the à la carte.

## 8. Live rendering and PDFs

- Live `food` PDFs for both venues: 1 page, **210 × 297 mm (A4)** — correct for `freshwater_alacarte`/`avalon_alacarte`; logo, tagline, dietary legend and surcharge line render; St Alma's four-tier Trust-our-chef band fits.
- A5 rendering at the deployed commit: `pnpm --filter @alma/api menus:previews` on the Mac (same renderer, fonts and marks as publish) produced all six families — `avalon_card_a5` Happy hour **148 × 210 mm**, 1 page, fill 89 %; St Alma bottomless card 93 %; Avalon lunch special 95 %; St Alma private event 2 pages 73 %/72 %; Avalon drinks book 3 pages 77/49/55 %; functions A4 2 pages 59/85 % — identical fill ratios to the checked-in `docs/menus-v2/previews/README.md`, no overflow. The Happy hour card was rasterised and inspected: logo, tagline, when-line, five sections, legend and surcharge footer all in place.
- The preview script died after the first PDF because `pdftoppm` (poppler) is not on the Mac; fixed in this PR to warn and continue. `brew install poppler` restores the PNGs.
- No A5 menu exists in production yet (only the two A4 food menus are published), so the public PDF route for an A5 card has not been exercised live. The first published card is the moment to check it from `/api/public/menus/<venue>/<slug>.pdf` on a phone.

## 9. Publication checklist (per venue)

Before anything is published:

- [ ] Owner answers §7 items 1–10 (or accepts the defaults in `plan.md` §5).
- [ ] Menus access granted to the head chef and venue manager (§5); each signs in once and reloads any old tab.
- [ ] Run the import as drafts: `docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/apps/api && node --import tsx scripts/import-menus-v2.ts --dry-run'`, read the summary, then without `--dry-run`. Expect nine menus + five promotions `created`, nothing published. Photos come from the website repo's `apps/web/public` via `--photos` or the What's On "Choose photo" button.

**St Alma**

- [ ] Food (A4, live v1): unchanged; confirm it still matches the printed Sep 2026 sheet.
- [ ] Drinks (A5L binder, 23 pp): review cover line, eyebrows, pages 20–23 overflow probe; acknowledge 11 no-price warnings; publish.
- [ ] Tuesday (A4): decide prices (+$1?) and the four-tier band; publish or hold.
- [ ] Bottomless (A5P): choose 8 Nov vs 15 Nov text, confirm Fri–Sun 12–4, drink list; publish.
- [ ] Functions & groups (A4, 5 pp): matches the live website PDF; publish.
- [ ] Set menu packages (A4, 4 pp): only if §7.5 approved.
- [ ] What's On: Bottomless lunch (link card), Taco Tuesday (no card); publish listings.
- [ ] Open each published PDF from `/api/public/menus/st-alma/<slug>.pdf` on a phone and a desktop; check the fill, the legend and the surcharge line.

**Alma Avalon**

- [ ] Food (A4, live v4; v5 draft open by Tim): finish or discard v5 before anyone else edits.
- [ ] Drinks (A5P book, 15 pp): review cover "Menu" subheading, eyebrows, pages 11–14 overflow; acknowledge 11 warnings; publish.
- [ ] Happy hour (A5P): confirm hours (§7.1) and that no newer `.indd` export is wanted; publish.
- [ ] Bottomless (A5P): confirm Sat–Sun 12–4 vs 12–3 and the drink list; publish.
- [ ] Lunch special (A5P): confirm days and venue scope; publish.
- [ ] What's On: Happy hour, Bottomless lunch (link cards), Taco Wednesday (no card); publish listings.
- [ ] Same PDF spot-check from `/api/public/menus/alma-avalon/<slug>.pdf`.

**After both venues look right at `/api/public/menus/<venue>`** (and only then): set `MENUS_FROM_API=1` in Vercel → alma-web-platform → Production, redeploy the website, check `/menu/st-alma`, `/menu/alma-avalon`, `/menus/st-alma/food` (PDF), `/whats-on`, and that the five legacy PDF paths 307-redirect. Rollback is unsetting the variable and redeploying.

## 10. Next steps, in order

1. Apply the env-file fix (§2) at a quiet moment — 12 s API restart.
2. Rotate rows 1–8 of §3 this week (no sign-out, no push loss); schedule 9–15 for a closing-time window with the next frontend deploy.
3. Deploy the venue-scoped publishing PR, then grant Menus access to the three head chefs and two venue managers (§5) — not before.
4. Owner decisions §7; then run the import as drafts and work the checklist (§9).
5. Housekeeping after sign-off: delete the ten older `pre-*` dumps and the twin, remove seven stale image tags (§4), shred the `.bak-*` env copies once rotation is done.
6. Process: one operator per production rollout — check `docker events --since 15m` on the VPS before starting, and never run a bare `docker compose config` (runbook fixed in this PR).

## 11. Addendum — PR #317 rollout and the probe incident (9 Oct 2026, 15:56–16:30 AEDT)

**Rolled out:** merge commit `9efcd27c` (venue-scoped, explicit publishing). suite-api image `b6a0a0260051` (`prod-9efcd27`; previous `prod-cfaa8ea` kept), dump `pre-menus-perms-20261009-155611.sql.gz` (90 MB), no migration (`migrate status`: up to date), Firebase `alma-menus` and `alma-staff` at `9efcd27c`. Release lock taken (`/opt/alma/deploy/.release.who`). Grants applied in one guarded transaction: Caio (both venues, no publish), Citlally (St Alma, no publish), Rodrigo (Alma Avalon, no publish), Dirk (St Alma, publish), Trystan (Alma Avalon, publish); admins untouched. Stale image tags removed (six; `deploy-stock-api:release-07752f5` kept because it is the running stock-api image): root disk 89 % → 80 %.

**Incident.** The first authenticated production probe, run before the grants, called `POST /api/menus/:id/draft/publish` for the admin identity with a body it assumed the schema would reject. The schema ignores unknown keys, so **Alma Avalon Food draft v5 was published at 16:01:55 AEDT, attributed to Tim Christensen**, who had opened that draft at 12:43 and not changed it. The publish diff recorded "No content changes": v5 is identical to v4, the public API and PDF serve the same content under a new version id (`cmv0axgep1e4rmt017gma7756`), and the website (committed data, `MENUS_FROM_API` unset) was never affected. v4 is now ARCHIVED, the open draft is gone, and a version number was consumed.

**Decision (owner, 9 Oct):** leave v5 published, preserve the audit history, no manual reversal, no MenuVersion rows modified or deleted.

**Rule from here on** (also in the probe script on the VPS, `perm-probe-ro.sh`): production authorisation probes use GET requests only, or writes the guard is proven to refuse for that identity (403/404 before the service runs). Positive publish rights are verified on a local or test database (`menu-access.integration.test.ts`), never live.
