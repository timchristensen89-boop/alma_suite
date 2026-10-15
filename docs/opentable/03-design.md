# OpenTable integration — design

Scope: the two free APIs only (see `02-api-capability-matrix.md`). Alma Suite is the source of truth; OpenTable is a destination that is written to on an explicit, per-venue, human-approved action. Nothing here touches the website or its booking hand-off.

## 1. Shape

```
packages/shared/src/opentable.ts     pure mapping + diff + profile schema (no I/O; unit-tested)
apps/api/src/lib/opentable-client.ts token cache, fetch with timeout/retry/X-Request-Id, hard off-switch
apps/api/src/services/opentable.service.ts  status, preview, publish, compare, activity (DB + client)
apps/api/src/routes/opentable.ts     /api/integrations/opentable/* (settings admins; venue publisher for menu pushes)
apps/admin-web/src/pages/OpenTableIntegrationPage.tsx  Settings → Integrations → OpenTable, venue switcher
packages/db: OpenTableVenueSetting, OpenTableSyncRun, IntegrationProvider.OPENTABLE
```

## 2. Data

**`OpenTableVenueSetting`** (one row per venue, created on first save)
- `venueId` (unique, FK `Venue`), `rid` (string, the OpenTable restaurant id), `enabled` (venue-level switch), `menusEnabled`, `profileEnabled`
- `profile` JSON — the approved Alma-side profile (`AlmaVenueProfile`, validated by zod in shared); `profileManagedFields` string[] — only these fields are ever sent (field-level overwrite semantics)
- `lastMenusAcceptedHash`, `lastMenusAcceptedAt`, `lastMenusRequestId`, `lastProfileAcceptedHash`, `lastProfileAcceptedAt`, `lastProfileRequestId`
- `lastConnectionCheckAt`, `lastConnectionOk`, `lastConnectionError`
- `lastRemoteMenusJson`, `lastRemoteMenusAt` (cache of the GET, when read access exists)

**`OpenTableSyncRun`** (activity + idempotency)
- `venueId`, `kind` (MENUS | PROFILE | CONNECTION | READ), `status` (PREPARED | SKIPPED | SUBMITTED | ACCEPTED | PARTIAL | FAILED), `payloadHash`, `payload` JSON (what was or would have been sent), `requestKey` (the `X-Request-Id`), `requestId` (OpenTable's), `response` JSON, `error`, `attempts`, `httpStatus`, `triggeredById/Name`, `createdAt`, `completedAt`
- Index `[venueId, kind, createdAt]`; the latest ACCEPTED run per kind is what "last successful sync" and "pending changes" are computed from.

Migration: additive (two tables, one enum value). No existing table changes.

## 3. Environment and the off-switches

```
OPENTABLE_API_ENABLED=false            master: when not "true", no outbound call is ever made (runs are recorded SKIPPED)
OPENTABLE_ENV=preprod|production       picks the documented hosts; production also requires the master flag
OPENTABLE_CLIENT_ID / OPENTABLE_CLIENT_SECRET
OPENTABLE_PARTNER_NAME                 the {partnername} path segment OpenTable assigns
OPENTABLE_MENUS_WRITE_ENABLED=false    POST /v1/partnermenu/…
OPENTABLE_MENUS_READ_ENABLED=false     GET  /v1/menus/rid/{rid}
OPENTABLE_PROFILE_WRITE_ENABLED=false  POST /v2/partnerrestaurants/rid/{rid}
OPENTABLE_API_BASE / OPENTABLE_OAUTH_BASE  overrides; defaults from the docs per OPENTABLE_ENV
OPENTABLE_TIMEOUT_MS=15000
```
Activation after approval = set the four values and flip the flags; no code change. The dashboard's CONNECTION state is computed from these plus a real token request (`POST …/oauth/token`), never from "credentials exist".

Status vocabulary (per venue, per capability): `NOT_CONFIGURED` (missing credentials, partner name or rid) → `AWAITING_APPROVAL` (configured, flag off) → `CONNECTED` (flag on, token request succeeded) → `SYNCED` / `OUT_OF_DATE` (last accepted hash equals / differs from the current published payload hash) → `ERROR` (last run failed or token request failed).

## 4. Menu mapping (shared, pure)

Input: the venue's menus with a PUBLISHED version, `status ACTIVE`, `visibility PUBLIC`, `kind ∈ {FOOD, DRINKS, PROMOTION, FUNCTIONS}` (PRIVATE_EVENT never). Each contributes its `MenuSnapshot`.

| Alma | OpenTable | Notes |
|---|---|---|
| Menu | `menus[0][menuId]` with `id = alma-menu-<slug>`, `name = heading || menuName`, `description = [subheading, whenLine].join` , `type = DINE_IN`, `defaultCurrency = AUD`, `ordinal` by kind (FOOD 100, DRINKS 200, PROMOTION 300, FUNCTIONS 400, then slug), `updatedAt = publishedAt`, `footnote = [dietaryNote, surchargeLine, conditions].join`, `metadata.enabled = true` | Ids are slugs, not database ids, so they survive a rebuild from a backup |
| Section (visible, with ≥1 visible item, type ≠ TEXT) | Group `id = alma-group-<slug>-<n>-<title-slug>`, `name = title [/ headerSuffix]`, `description = [subheading, lead].join`, `items` ordered | TEXT sections are not sent (print prose); documented as unsupported |
| Item (visible) | `id = alma-item-<slug>-<dishKey>`, `name`, `description = [description, meta, note].join(' · ')`, `modifierGroups: []` always | |
| Price, STANDARD/SET_MENUS/COURSE with `priceCents` and `showPrices` | `priceMetadata {priceType: PRICE, minPrice = maxPrice = cents/100, unit?: priceUnit}` | `pp` is passed as `unit` |
| HEADER_PRICED section | items without `priceMetadata`; the group name carries the suffix ("Tacos / 9 each") | The sheet prices the heading, not the rows |
| TABLE section with `priceColumns` | `priceMetadata {priceType: SIZE_PRICE}` + `sizes[]` → `itemSizes` named by column, PRICE each; null columns omitted | Wine by the glass / bottle |
| LIST, or no price, or `showPrices = false` | no `priceMetadata` | |
| `tags` | `metadata.dietaryTags` (V→VEGETARIAN, VG→VEGAN, GF→GLUTEN_FREE, GFA→GLUTEN_FREE_AVAILABLE, DF→DAIRY_FREE), `metadata.allergens` (N→NUTS), `metadata.tags` (A→Australian, I→Imported) | One constant, `OPENTABLE_DIETARY_MAP`, flagged unverified beyond V/VG |
| `flags` | `metadata.tags` (Staff pick, Limited, New, On tap) | |
| `isSeafood`, `page`, `placement`, `priceColumns` labels, `pageCount`, `heroPrice*` | not sent (hero price → description text) | |

Output: `{ payload, hash, included: [{slug, kind, name, versionNumber, publishedAt, groups, items}], excluded: [{slug, reason}] }`. The hash is sha256 of the canonical (sorted-key) JSON, computed in the API from the shared `canonicalJson`.

Diff (`diffOpenTableMenus(previous, next)`): menus added / removed / changed; per menu, groups added/removed; items added/removed/changed with field-level reasons (name, description, price, sizes, dietary). "Removed menus" are shown in red and the publish request must repeat them in `confirmRemovals` to proceed, because a full POST drops anything absent.

Remote compare (`compareWithRemote(payload, remote)`): normalises the GET response and the local payload to `(menuName → groupName → itemName) → {price, description}` and reports: items missing on OpenTable, items on OpenTable not in Alma (reported, never acted on), price differences, description differences, menus not on OpenTable, and whether OpenTable serves a hosted `restaurantMenuUrl` instead of native menus.

## 5. Profile mapping (shared, pure)

`AlmaVenueProfile` (zod): `name`, `description`, `primaryCuisine` (documented list), `otherCuisines[]`, `phone` (E.164), `website` (URL), `locale` (default `en-AU`), `currency` (`AUD`), `timeZone` (`Australia/Sydney`), `priceBandId` (1–4), `diningStyle`, `dressCode` (documented enums), `publicTransit`/`privateEventDetails`/`cateringDetails` (length-capped), `executiveChef`, `crossStreet`, `menuUrl`, `profileImageUrl`, `imageUrls[]`, `tags[]`, `openingTimes` (`{monday: [{start, end}]…}`), `paymentOptions[]`, `beverages[]`, `dietaryOptions[]`, `smokingOptions[]`, `location` (held back by default). Every array/enums validated against the documented values; unknown values are rejected at save time, not at publish time.

`buildOpenTableProfilePayload(profile, managedFields, venueSlug)` emits `{ id: venueSlug, …only managed fields… }`. Field-level overwrite semantics mean an unmanaged field is never touched on OpenTable.

Comparison: Alma profile vs the last ACCEPTED payload (what OpenTable last received from us). The dashboard labels anything never submitted as "not yet sent" and links to OpenTable for Restaurants for manual checks, because the API cannot read the live profile.

## 6. Publishing workflow (menus)

1. Publisher publishes a menu in Alma Menus as today.
2. Dashboard (per venue) computes the current payload and compares its hash with `lastMenusAcceptedHash` → "Pending changes" with the diff.
3. Preview shows the exact JSON that will be sent, the included/excluded menus, and any removals.
4. Publish button → `POST /venues/:venueId/menus/publish { hash, confirmRemovals[] }`. The server rebuilds the payload, refuses on hash mismatch (someone published meanwhile) or unconfirmed removals, refuses if the same hash was already ACCEPTED (duplicate) unless `force`, refuses if a run for the venue is SUBMITTED and younger than 2 minutes (in flight).
5. Client POSTs with `X-Request-Id = alma-<venueSlug>-menus-<hash12>`; retries only on 429/5xx/network with backoff, never on 4xx; 15 s timeout per attempt.
6. Run recorded: SUBMITTED → ACCEPTED (200 with `totalProcessedItems == totalItems`), PARTIAL (200 otherwise), FAILED (non-2xx / exception), SKIPPED (flags off: the payload is stored so the preview is still useful, nothing is sent).
7. The dashboard shows "Accepted by OpenTable (request 132658925) — processing is asynchronous; visibility is controlled in OpenTable for Restaurants → Menus" and never "live on OpenTable".
8. Optional later: a scheduler-secret job that re-runs step 4 for venues with `autoPublish = true`. Not built as a setting yet; the service exposes the function.

Permissions: routes require settings admin (`requireSettingsAdmin`). Menu publish/preview additionally require `canPublishMenus(user, venueSlug)` and `assertMenuVenueAccess`, so a St Alma-limited manager cannot push Avalon even if they reach the admin app. Profile publish requires settings admin plus venue access.

## 7. Safety list (mapped to the brief)

| Risk | Control |
|---|---|
| Accidental cross-venue publish | rid is read from the venue's own setting row; the route resolves venue by id and checks `canAccessMenuVenue`; the request key includes the venue slug |
| Duplicate submissions | hash equality with last ACCEPTED → 409; in-flight run → 409; `X-Request-Id` on the wire |
| Publishing drafts | the builder reads only `MenuVersion.state = PUBLISHED` snapshots; drafts are invisible to it |
| Invalid prices | zod on the payload (non-negative finite, ≤ 2 decimals), `showPrices=false` omits prices, TABLE null columns omitted |
| Destructive sync | removals must be confirmed; never derive deletions from a partial GET; profile sends only managed fields |
| Silent overwrite | profile fields outside `profileManagedFields` are never sent |
| Partial failure shown as success | 200 with `totalProcessedItems < totalItems` → PARTIAL, red |
| Secrets in the browser | status payload carries booleans and masked ids only |
| Timeouts / retries / rate limits | AbortController per attempt, backoff with `Retry-After`, max 4 attempts, 429 counted |
| Audit | every run row has actor, hash, request key, OpenTable request id, response, error |
