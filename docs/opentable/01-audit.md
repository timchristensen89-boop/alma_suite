# OpenTable integration — Phase 1 audit (16 Oct 2026)

Read-only findings from both repositories, taken before any integration code was written. File references are to `alma_suite` unless prefixed `website:` (`alma-web-platform/apps/web`). The conclusion is at the end: what is reused, what is new, and what is deliberately left alone.

## 1. Menu architecture (reused as the authoritative source)

- Models: `Menu` (`packages/db/prisma/schema.prisma:6314`), `MenuVersion` (`:6357`), `MenuSection` (`:6413`), `MenuItem` (`:6443`), `MenuAuditEvent` (`:6493`), `Promotion` (`:6523`), `PromotionImage`, `PromotionPublication`.
- A menu has a stable `slug` (unique per venue), a `kind` (FOOD, DRINKS, FUNCTIONS, PROMOTION, PRIVATE_EVENT), `visibility` (PUBLIC/PRIVATE) and at most one DRAFT and one PUBLISHED version. Publishing freezes the document into `MenuVersion.snapshotJson` (`MenuSnapshot`, `packages/shared/src/menus.ts:221`) and stores the rendered PDF.
- Item identity across versions is `MenuItem.dishKey`; section identity is positional (title + order). Items carry `priceCents`, `priceUnit` ("pp"), `prices[]` for TABLE sections, `meta`, `note`, `flags` (STAFF_PICK, LIMITED, ON_TAP, NEW), `tags` (V, VG, GF, GFA, DF, N, A, I), `isSeafood`, `visible`.
- Publish pipeline: `menuService.publish` → `preparePublish` (validate, render, diff) → transaction `lockActiveMenu` + `commitPublish` (`apps/api/src/services/menu.service.ts:1167`, `:641`). It writes one `MenuAuditEvent` (`action: 'published'`). Promotions publish through `promotionService.publish` (`promotion.service.ts:664`) and may commit the linked card in the same transaction.
- **No publish hook exists** (no emitter, no queue, no `pg_notify`). The integration therefore does not auto-push; it reads published versions on demand and the dashboard shows "pending changes" by comparing the live snapshot hash with the last accepted submission. That matches the brief (manual publishing first, optional automation later).
- Public read surface already exists and is cached: `/api/public/menus/:venue`, `/:venue/:slug.json|.pdf`, `/api/public/whats-on`, `/api/public/promotion-images/:fingerprint` (`apps/api/src/routes/public-*.ts`). The profile publisher reuses these URLs as the `menu` link and card images.
- Prior art for an external publisher: `apps/api/src/services/website-menu.service.ts` (commits menu data to the website repo via GitHub). It is not reused — different target, different semantics — but its placement (service + admin route + env block) is followed.

## 2. Draft, approval and publishing workflow

- Drafting is open to anyone with the Menus grant on that venue; publishing needs `canPublishMenus(user, venueSlug)` (`packages/shared/src/menus.ts:1300`), enforced per route by `apps/api/src/lib/menu-access.ts` (404 outside the venue scope, 403 when not a publisher). Shipped 9 Oct 2026 (PR #317).
- Venue scope lives on the `MENUS` app-access grant: `menusPublish`, `menusVenueStAlma`, `menusVenueAlmaAvalon`. Today: Dirk publishes St Alma, Trystan publishes Alma Avalon, Caio/Citlally/Rodrigo draft only, Tim and Hamilton are admins.
- The OpenTable publisher reuses exactly this rule: pushing a venue's menus to OpenTable requires `canPublishMenus(user, venueSlug)`; nothing in the integration grants anyone a wider scope.

## 3. Existing venue permissions and admin surfaces

- Admin-only routes use `requireAdmin` / `requireSettingsAdmin` (`apps/api/src/lib/auth-middleware.ts:271,286`). Integrations admin routes: `apps/api/src/routes/integrations.ts` (OAuth callbacks public, Deputy under `requireManager`, the rest under `requireAdmin`).
- admin-web shell is `RequireAdmin`; integration pages are standalone lazy routes (`apps/admin-web/src/App.tsx:627-639`), e.g. `IntegrationHealthPage` calling `api('/api/admin/integrations/status')`. The brief's "Settings → Integrations → OpenTable" maps to a new route `/integrations/opentable` in that group.
- `@alma/ui` has Card, Badge, Button, EmptyState, Spinner, ActionFeedback, StatCard, Input, Select, Textarea; **no Tabs**. The venue switcher is built from Buttons.

## 4. Existing OpenTable code

- `alma_suite`: none. The only OpenTable notion is `Promotion.bookDestination = 'OPENTABLE'` (default) and `Promotion.startTime` "to pre-fill on OpenTable" (`packages/shared/src/promotions.ts:32-39`). No env vars, no client, no rids.
- `website:lib/opentable.ts`: rids `OPENTABLE_RID_BY_VENUE` = Avalon **211301**, St Alma **211307**; `OPENTABLE_VENUE_PAGE` (restref links); `OPENTABLE_EXPERIENCES` (bottomless 812424/812401, feasting 812689/812403, grazing 812686/812402, à la carte 812427/812404); `openTableAvailabilityUrl` builds `https://www.opentable.com.au/booking/restref/availability?rid=…&restref=…&datetime=…&partysize=…&ot_source=Restaurant+website[&experienceId=…]`. Used by `BookWidget`, `OnsiteBooking`, `VenuePage`, `/book`. **Untouched by this project.**
- `website:lib/opentable-api.ts`: a Consumer API v2 client (availability/lock/reserve) switched off by `OPENTABLE_BOOKING_MODE=off` (mock refused on Vercel production). It is the paid Booking API and stays off; the new integration shares none of its code or credentials.

## 5. Environment variables and credentials

- API env is a plain object in `apps/api/src/env.ts` (no zod); integrations under `env.integrations.<provider>`; feature flags are `=== 'true'` strings (`INTEGRATION_OAUTH_CONNECTIONS_ENABLED`, `MARKETING_*_LIVE_*_ENABLED`). Production secrets live only in `/opt/alma/deploy/env/suite-api.env` on the VPS.
- Website env for OpenTable (`OPENTABLE_CLIENT_ID/SECRET`, `OPENTABLE_RID_*`, `OPENTABLE_API_BASE`, `OPENTABLE_OAUTH_BASE`) belongs to the Consumer API client and is **not** reused: the Menus/Content partner credentials are different OpenTable client credentials and belong on the suite API.
- Secret storage pattern: `IntegrationConnection.tokenEncrypted` via AES-256-GCM (`apps/api/src/lib/integration-crypto.ts`). The OpenTable client credentials are static env values (client-credentials flow); the short-lived access token is held in memory only.

## 6. Restaurant profile information (where it lives today)

| Field | Suite | Website |
|---|---|---|
| Name, slug | `Venue` (`schema.prisma:4265`: id, name, slug, address?, lga?) | `data/venues.ts` |
| Address, phone | `AppSettings.venues[]` JSON (`{name,address?,phone?}`), `PosVenueSetting` (businessName, abn, address, phone, email, website, receiptLogo) | `data/venues.ts:79-82,167-170`; JSON-LD copy in `components/seo/RestaurantJsonLd.tsx:22-47` (phone in +61 form) |
| Description | none | `heroTitle`/`heroText` per venue |
| Cuisine | none | hard-coded `servesCuisine: "Mexican"` in JSON-LD |
| Hours | **none** (only `ReserveAvailabilityRule` for bookings and `LiquorLicence.tradingHours` free text) | `data/hours.ts` is the single source: per day `opens`, `lastSeating`, `closes`; closes flagged "REQUIRES OWNER VERIFICATION"; no kitchen/bar split |
| Photos | none | `public/images/*` (hero, terrace, interior, food, margarita, dining, group) |
| Instagram | none | `SiteFooter.tsx`, JSON-LD `sameAs` |

Conclusion: there is no single source of truth for the profile. The integration adds one small, admin-edited record per venue in the suite (`OpenTableVenueSetting.profile`), seeded by hand from the website values, and the dashboard shows the website's current values beside it for the first fill. The website is not changed.

## 7. What's On and the booking widget

- What's On is served by `/api/public/whats-on` from `Promotion` + `PromotionPublication`; the website maps `booking.destination = OPENTABLE` to its own `bookingHref(venue)` (`website:lib/whats-on-api.ts:84`). Neither free API accepts promotions/events, so What's On is out of scope for OpenTable; its printed card (a PROMOTION-kind menu) can be published as a menu.
- Booking widget: website-only, OpenTable hand-off URL, no embed. Untouched.

## 8. Audit logs and background jobs

- Integrations write `IntegrationEvent` (`schema.prisma:3148`) and `IntegrationSyncRun`; connections carry `lastSyncAt/lastSyncStatus/lastError`. Menus write `MenuAuditEvent`.
- Jobs are HTTP endpoints under `/api/integration-jobs/*` guarded by `INTEGRATION_SCHEDULER_SECRET`, called by cron on the VPS. No in-process scheduler.
- Design choice: OpenTable gets its own `OpenTableSyncRun` table (payload hash, request id, item status, error, actor) as the activity feed, plus `IntegrationProvider.OPENTABLE` so `IntegrationEvent` can carry connection-level events in the same place as the other providers. Optional automation later = one scheduler-secret job that calls the same service.

## 9. Tests

- `node --test` via tsx; `*.test.ts` unit, `*.integration.test.ts` opt-in with `ALMA_TEST_DATABASE_URL`. No HTTP mocking library; the house pattern is injectable `fetchImpl`/`sleep` (`apps/api/src/lib/forecast/http.ts`, tested in `forecast/sync.test.ts`). The OpenTable client follows that pattern so every retry, timeout and failure path is unit-tested with stub responses.

## 10. Decisions taken from this audit

| Decision | Why |
|---|---|
| Alma Suite menus (PUBLISHED, PUBLIC versions only) are the source; OpenTable is a destination | Brief; no duplicate menu system |
| Manual publish from a dashboard; no auto-push | No publish hook, and the brief asks for manual first |
| Profile data gets a small suite-side record per venue | Nothing in the suite holds hours/description/cuisine today |
| Website unchanged, booking hand-off unchanged | Brief |
| Credentials and all calls server-side in the suite API; browser sees only status | Brief, existing pattern |
| Flags keep every outbound call off by default | Neither API is approved; neither is in the sandbox |
