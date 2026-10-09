# Menus V2 — production rollout and rollback

> **Released 9 Oct 2026 ~14:02 AEDT** at `cfaa8eaf` (#313 and #315 together — #313 was never shipped on its own, so one deploy applied all three migrations `20261008093000_menu_heading`, `20261009090000_menus_v2`, `20261009120000_menus_v2_promotions`; `_prisma_migrations` 191 → 194). Section 3 (imports) and section 4 (website switch) have **not** been run. What was checked afterwards, who can publish, and what still needs the owner's call: `post-deploy-audit-2026-10-09.md`.

Scope: Alma Suite PR #315 (`claude/menus-v2-zqxw48`, stacked on #313) and the website PR timchristensen89-boop/alma-web-platform#20. This runbook assumes #313 has been released with its own runbook (`docs/menu-editor/production-runbook-multi-menu.md`), which fixes the shape of the stack: the VPS compose at `/opt/alma/deploy`, the `suite-api` image built from `/opt/alma/alma-suite`, the in-container `prisma migrate deploy`, the Firebase site `alma-menus` deployed from a Mac with `scripts/deploy-frontends.sh menus-web`, the editing pause and the tab refresh. Every command below that touches the VPS or Firebase is the same command as in that runbook; only the expectations change.

Nothing in this PR publishes anything by itself. After the deploy the website still serves its committed menus and events until two things happen in order: staff publish the menus and promotions in Alma Menus, and the website is rebuilt with `MENUS_FROM_API=1`.

## 0. What changes

- **Database**: two additive migrations, no data rewritten.
  - `20261009090000_menus_v2` — `Menu` gains `kind`, `slug` (backfilled from the name, unique per venue), `visibility`, the four private-event columns; `MenuVersion` gains the title-block, show-prices and page-count columns; `MenuSection` gains page, lead, body, price columns and four new `MenuSectionType` values; `MenuItem` gains prices, meta, note, flags. Every column has a default; the released API keeps working while it applies.
  - `20261009120000_menus_v2_promotions` — tables `Promotion`, `PromotionImage`, `PromotionPublication`; nullable `MenuAuditEvent.promotionId`.
  - `prisma migrate status` must list exactly these two as pending (plus the three DB-only rows the previous runbook describes as not found locally). Stop on anything else.
- **API**: new unauthenticated, rate-limited, read-only routes under `/api/public/menus/*`, `/api/public/whats-on*`, `/api/public/promotion-images/*` (published snapshots only); `/api/menus/promotions/*` behind the Menus access rule. No new environment variables: `API_PUBLIC_URL` (already set for the gift-card links) is what the public URLs are built from — confirm it reads `https://api.almagroup.com.au` in `env/suite-api.env`; without it the listing would link `http://localhost:3018`.
- **menus-web**: the V2 editor, home and What's On screens. The home reads new fields; the old API does not send them, so the order is still API first, then the frontend.
- **Website** (separate repo, Vercel): no behaviour change until `MENUS_FROM_API=1`.

## 1. Before the deploy

1. Section 0 of the #313 runbook (health, CORS, the live home) — identical.
2. Read-only check of the two migrations in the merge commit: `ls packages/db/prisma/migrations | tail -3` lists `20261008093000_menu_heading`, `20261009090000_menus_v2`, `20261009120000_menus_v2_promotions`.
3. Backup exactly as #313 1b, named `pre-menus-v2-<stamp>.sql.gz`. Record the size.
4. Pause editing (the #313 "Pause editing" step) **before** the migration this time: `Menu.slug` is backfilled from the current names and then made `NOT NULL UNIQUE (venueId, slug)`; a rename racing the backfill cannot break it (the slug is minted once), but a brand-new menu created between the backfill and the API switch by the old API would have no slug and the migration's `NOT NULL` would already be in place — the old API would then fail that one insert. Pausing removes the question.

## 2. Deploy

Follow #313 sections 1a–1f and 2 with these differences:

- 1a: the running image is the #313 release (`prod-<MERGE_SHORT of #313>`); tag it for rollback as before.
- 1e: expect two migrations to apply, in order; the post-check is

  ```bash
  docker compose exec -T postgres psql -U alma -d alma_suite_v18 -At -F '|' \
    -c "SELECT count(*) FILTER (WHERE finished_at IS NOT NULL) FROM _prisma_migrations;" \
    -c "SELECT \"venueId\", slug, kind, visibility FROM \"Menu\" ORDER BY 1,2;" \
    -c "SELECT count(*) FROM \"Promotion\";"
  ```

  Expect: the finished count two higher than before; every existing menu with a slug (`food` for each venue's "Food"; a renamed menu keeps the slug of its name at migration time), `kind = FOOD`, `visibility = PUBLIC`; `0` promotions.
- 1f: unchanged. Then, still on the VPS and still with editing paused, run the public read-only checks: `curl -sS https://api.almagroup.com.au/api/public/menus/st-alma` lists the live food menu (`kind FOOD`, slug `food`, a `pdfUrl`); `/api/public/whats-on` returns `{"venues":[],"promotions":[],...}`; `/api/public/menus/st-alma/food.pdf` streams the PDF with `Cache-Control: public, max-age=300`.
- Section 2 (menus-web): unchanged. After the tab refresh, the home shows each venue's menus under "Food" with a kind badge and page format; the sidebar has "What's On".

## 3. Imports (optional, drafts only)

The reference menus and the website's five What's On events can be created as drafts so the kitchen reviews them in the editor rather than typing them in:

```bash
cd /opt/alma/deploy && docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/apps/api && node --import tsx scripts/import-menus-v2.ts --dry-run'
cd /opt/alma/deploy && docker compose run --rm -T --no-deps suite-api sh -c 'cd /workspace/apps/api && node --import tsx scripts/import-menus-v2.ts'
```

Expect: nine menus and five promotions `created` (or `unchanged` on a re-run); the last line says nothing was published. The importer never publishes, never overwrites a draft a person has edited, and audits every row with its source and confidence (`docs/menus-v2/import-inventory.md` lists what each one is and what to check). The website's event photos are not in the image; attach them from the What's On screen (Choose photo) or run the importer from a machine that has both repositories with `--photos /path/to/alma-web-platform/apps/web/public`.

Before anything imported is published: the review notes in the inventory (hours that disagree between sources, prices that moved, wording the template cannot carry) are the owner's calls.

## 4. Switching the website to the API

Only after the venues' food and drinks menus (and `st-alma/functions`) are published from Alma Menus and look right at `/api/public/menus/<venue>`:

1. Merge timchristensen89-boop/alma-web-platform#20.
2. In the Vercel project, Production env: `MENUS_FROM_API=1` (and `ALMA_API_URL` only if the API is not at `https://api.almagroup.com.au`).
3. Redeploy. Check `/menu/alma-avalon`, `/menu/st-alma`, `/menus/st-alma/food` (PDF), `/whats-on`, and that the five legacy PDF paths redirect (307).
4. If the API is unreachable at build or revalidate time the site keeps the committed data and logs `[menus] … using committed menu data`; that is the designed fallback, not an error to fix at 2 am.

## 5. Rollback

Reverse order: website, menus-web, API. The database stays.

- **Website**: unset `MENUS_FROM_API` and redeploy (or roll back the Vercel deployment). The committed data and PDFs were never removed.
- **menus-web**: Firebase console → `alma-menus` → roll back to the #313 release, then the tab refresh. The #313 home ignores the new fields.
- **API**: `docker tag deploy-suite-api:prod-<#313 MERGE_SHORT> deploy-suite-api:latest && docker compose up -d --no-deps --no-build suite-api`. The #313 code never references the new columns or tables (its Prisma client selects named columns; `Menu.slug` has no default but the old code never inserts without… it does: `createMenu` on the #313 API inserts a `Menu` without a slug and would fail with a NOT NULL violation). **So while rolled back, creating a new menu fails; editing, publishing and archiving existing menus work.** Keep editing paused for the rollback as in #313 and say so to the publishers. Restore the new API, or add a temporary `DEFAULT ''` on `Menu.slug` only if the rollback must last days (a separate, approved change).
- **Columns and tables**: stay. Do not drop them or edit `_prisma_migrations`; a later clean-up is its own change.
- **Backup**: the pre-deploy dump restores the pre-V2 schema as well as the data (same caveat as #313: never run the new image against a restored database without re-running `migrate deploy`).

## 6. After

- Lift the editing pause once section 2's checks pass.
- Remove the hand-made dump when the release is confirmed, as #313 1b says.
- Open decisions that affect what gets published are in `docs/menus-v2/plan.md` §5 and the review notes in `docs/menus-v2/import-inventory.md`.
