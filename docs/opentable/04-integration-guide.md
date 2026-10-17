# OpenTable integration — operator and developer guide

Scope: Alma Suite ↔ OpenTable using the two free partner APIs only. Nothing in this project uses, depends on, or assumes access to the Booking Partner API, Reviews Partner API, CRM API, Reservation Sync API, the paid directory, or any other paid OpenTable service. The website's booking hand-off (`apps/web/lib/opentable.ts` in `alma-web-platform`) is untouched.

Companion documents: `01-audit.md` (what existed before), `02-api-capability-matrix.md` (what the APIs can do, verified against docs.opentable.com on 16 Oct 2026), `03-design.md` (how it is built).

## 1. What was built, and its status

| Area | Status | Notes |
|---|---|---|
| Settings → Integrations → OpenTable dashboard (per venue: Connection, Menus, Restaurant profile, Activity) | **FULLY WORKING** | admin-web `/integrations/opentable`; venue tabs follow the user's Menus scope |
| Menu mapping Alma → OpenTable Menu Data envelope (groups, items, prices, sizes, dietary tags, footnotes) | **FULLY WORKING** | pure, unit-tested; built only from PUBLISHED versions of ACTIVE, PUBLIC menus |
| Preview of the exact JSON and the pending diff vs the last accepted submission | **FULLY WORKING** | hash-gated publish, removals must be confirmed |
| Publishing menus to OpenTable (`POST /v1/partnermenu/…/menus`) | **BUILT BUT BLOCKED BY APPROVAL** | Menus Partner production application in review; no sandbox exists for this API; `OPENTABLE_MENUS_WRITE_ENABLED` stays `false` |
| Reading menus back for the ALMA SUITE vs OPENTABLE comparison (`GET /v1/menus/rid/{rid}`) | **BUILT BUT BLOCKED BY APPROVAL** (and may be **NOT SUPPORTED** for a publishing partner) | the docs say the GET is for partners with distribution rights; `OPENTABLE_MENUS_READ_ENABLED` stays `false` |
| Restaurant profile editor with "Alma manages this field" ticks, comparison table, publish (`POST /v2/partnerrestaurants/rid/{rid}`) | **BUILT BUT BLOCKED BY APPROVAL** | Restaurant Content Partner contract awaiting signature (portal erroring); `OPENTABLE_PROFILE_WRITE_ENABLED` stays `false` |
| Reading the live profile from OpenTable | **NOT SUPPORTED BY THE API** | the Content API has no GET; the dashboard compares Alma with what Alma last sent, and links to OpenTable for Restaurants |
| Status polling of an accepted (asynchronous) submission | **NOT SUPPORTED BY THE API** | no endpoint; the run keeps OpenTable's `requestId` for support conversations |
| Reservations, availability, reviews, guest data, promotions/What's On on OpenTable | **NOT SUPPORTED** (paid or non-existent) | deliberately not built |
| Activity log (every attempt, payload, request id, response, actor) | **FULLY WORKING** | `OpenTableSyncRun`, viewable per run in the dashboard |
| Automatic push on Alma publish | **not built (by design)** | manual first; the service exposes `publishMenus` for a later scheduler job |

## 2. How menus flow from Alma Suite to OpenTable

1. A publisher publishes a menu in Alma Menus exactly as today.
2. Open **Admin → Integrations → OpenTable**, choose the venue.
3. The **Menus** panel lists what will be sent (every ACTIVE, PUBLIC menu of kind FOOD / DRINKS / PROMOTION / FUNCTIONS that has a published version), what is excluded and why (private-event menus, archived menus, drafts with nothing published, hidden items and sections), and any warnings (e.g. items with no price).
4. **Pending changes** shows the diff against the last submission OpenTable accepted: menus added / changed / removed, and item-level changes with the fields that moved.
5. **Preview JSON** shows the exact envelope.
6. **Publish to OpenTable** sends it. The server rebuilds the payload and refuses if the content changed since the preview, if a menu would disappear and its removal was not ticked, if the same payload was already accepted (use **Resend** to force), or if another submission for the venue is still in flight.
7. The run is recorded SUBMITTED → ACCEPTED (every item processed), PARTIAL (short count or rejected items), FAILED (non-2xx / network) or SKIPPED (flags off: the payload is stored so the preview is still honest). The panel then reads **Accepted by API · publication not verified**: processing is asynchronous, there is no status endpoint, and visibility is chosen in OpenTable for Restaurants → Menus. It only reads **verified by read-back** after step 8 matches.
   Before sending, the server refuses an empty payload, a payload that fails structural validation, unconfirmed removals, and (without the on-screen acknowledgement) a first submission or one that drops more than half of the previously accepted items — a full-menu POST replaces everything OpenTable holds.
8. **Read from OpenTable** (once read access exists) fetches what OpenTable holds and reports items missing on OpenTable, items only on OpenTable (never removed automatically), price and description differences, and whether OpenTable is serving a hosted menu link instead.

The booking widget, PDF/binder generation and the public website are not involved.

### Mapping summary

| Alma | OpenTable |
|---|---|
| Menu (slug) | `alma-menu-<slug>`, name = heading or menu name, type DINE_IN, AUD, footnote = dietary note + surcharge line + conditions |
| Visible section with visible items (not TEXT) | group `alma-group-<slug>-<title>`; HEADER_PRICED suffix becomes part of the group name |
| Visible item | `alma-item-<slug>-<dishKey>`; description = description · meta · note; `modifierGroups: []` |
| `priceCents` (STANDARD / SET_MENUS / COURSE) | `PRICE` min = max, `unit` for "pp" |
| TABLE columns (`prices[]`) | `SIZE_PRICE` + `itemSizes` named by column; null columns omitted |
| HEADER_PRICED rows, LIST rows, no price, `showPrices = false` | no price |
| tags V / VG / GF / GFA / DF | dietaryTags VEGETARIAN / VEGAN / GLUTEN_FREE / GLUTEN_FREE_AVAILABLE / DAIRY_FREE (only V/VG appear in the docs' examples) |
| tag N | allergens NUTS |
| tags A / I, flags | free-text tags (Australian, Imported, Staff pick, Limited, New, On tap) |
| isSeafood, page, placement, pageCount, hero price | not sent |

Ids are slugs and dish keys, not database ids, so they survive a restore from backup.

## 3. How the restaurant profile is managed

- Each venue keeps one Alma-side profile (`OpenTableVenueSetting.profile`) validated against the documented enums (cuisines, dining style, dress code, payment options, beverages, dietary options, smoking, opening-time ranges, length caps). An invalid value is refused at save time, not at publish time.
- Tick **Alma manages …** per field. Only ticked fields are ever sent; the API overwrites field by field, so everything else on OpenTable is left alone. A ticked field that is empty is sent empty, which clears it on OpenTable (documented behaviour).
- The comparison table shows ALMA SUITE vs OPENTABLE (last accepted) with In sync / Pending / Not yet sent / Not managed. Because the API cannot read the live profile, anything not managed here must be checked and changed in OpenTable for Restaurants; the panel links there.
- Address (`location`) appears only in the docs' example and is held back by default.
- Opening hours have no source in the suite today; type them here (the website's `data/hours.ts` is the reference, and its closing times are flagged as unverified there).

## 4. Dashboard states

| State | Shown as | Meaning |
|---|---|---|
| NOT_CONFIGURED | Not configured | no rid, the venue switch is off, or the server is missing `OPENTABLE_CLIENT_ID` / `OPENTABLE_CLIENT_SECRET` / `OPENTABLE_PARTNER_NAME` (named, never shown) |
| AWAITING_APPROVAL | Awaiting approval | configured, but `OPENTABLE_API_ENABLED` or the capability flag is off, or switched on but never checked |
| CONNECTED | Connection: Connected · Menus/Profile: Ready to submit | a real token request succeeded (re-run automatically when older than 10 minutes, or on **Check connection**); nothing sent yet |
| OUT_OF_DATE | Ready to submit · changes pending | Alma has changed since the API last accepted a submission |
| SUBMITTED | Submitted to OpenTable | sent, waiting for the HTTP response |
| SYNCED | Accepted by API · publication not verified | the API accepted the current payload (request id kept). OpenTable processes it asynchronously and has no status endpoint, so publication is **not** claimed — unless a read-back from OpenTable after the acceptance matched Alma, in which case the badge reads **verified by read-back** |
| ERROR | Failed | token request failed, or the last run ended FAILED or PARTIAL |

"Connected" is never shown merely because credentials exist, and nothing on the page says "live on OpenTable" or "successfully synced".

## 5. Enabling after approval (no code change)

Set in `/opt/alma/deploy/env/suite-api.env` on the VPS, then restart `suite-api`:

```
OPENTABLE_API_ENABLED=true
OPENTABLE_ENV=production            # or preprod for OpenTable's pre-production hosts
OPENTABLE_CLIENT_ID=…               # from OpenTable
OPENTABLE_CLIENT_SECRET=…
OPENTABLE_PARTNER_NAME=…            # the {partnername} path segment OpenTable assigns
OPENTABLE_MENUS_WRITE_ENABLED=true  # once the Menus Partner application is approved
OPENTABLE_MENUS_READ_ENABLED=true   # only if OpenTable confirms read access for our partner
OPENTABLE_PROFILE_WRITE_ENABLED=true # once the Restaurant Content Partner contract is signed
```

Then, per venue in the dashboard: enter the rid (St Alma 211307, Alma Avalon 211301 — the same numbers the website's booking links use), switch the venue on, **Check connection**, preview, publish. No recurring paid service is involved; the client-credentials token is free and cached in memory.

## 6. Environment variables (server only)

| Variable | Default | Purpose |
|---|---|---|
| `OPENTABLE_API_ENABLED` | `false` | master switch; off = no outbound call, runs recorded SKIPPED |
| `OPENTABLE_ENV` | `preprod` | `production` → platform.opentable.com / oauth.opentable.com; otherwise platform.otqa.com / oauth-pp.opentable.com |
| `OPENTABLE_CLIENT_ID`, `OPENTABLE_CLIENT_SECRET` | empty | client-credentials pair |
| `OPENTABLE_PARTNER_NAME` | empty | `{partnername}` in the Menus API path |
| `OPENTABLE_MENUS_WRITE_ENABLED` / `OPENTABLE_MENUS_READ_ENABLED` / `OPENTABLE_PROFILE_WRITE_ENABLED` | `false` | per-capability switches |
| `OPENTABLE_API_BASE`, `OPENTABLE_OAUTH_BASE` | from `OPENTABLE_ENV` | overrides (used by the local mock) |
| `OPENTABLE_TIMEOUT_MS` | `15000` | per attempt |

Secrets never reach the browser: the status payload carries booleans ("client id present") and OpenTable's request ids only.

## 7. Permissions

- Every route under `/api/integrations/opentable` is **Alma-admin only** (`requireAdmin`: the `isAdmin` flag). Venue managers keep their existing venue-scoped publishing in Alma Menus and have no access to integration settings or this page. No shared middleware was changed.
- Every venue route also applies the Menus venue scope (`assertMenuVenueAccess`): a venue outside the admin's Menus scope reads as 404.
- **Publishing menus to OpenTable additionally requires `canPublishMenus(user, venueSlug)`**, the same rule as publishing in Alma Menus, so an admin whose Menus grant is limited to one venue cannot push the other's; the button is disabled in the UI and the API refuses with 403. `apps/api/src/routes/opentable-guards.test.ts` fails the build if a route is added without its guard or if the router stops being admin-only.

## 8. Safety

| Risk | Control |
|---|---|
| Publishing drafts | the builder reads only `MenuVersion.state = PUBLISHED` snapshots |
| Cross-venue publish | rid comes from the venue's own row; route resolves the venue by id and checks scope; request key includes the venue slug |
| Duplicates | same hash as last ACCEPTED → 409 unless forced; SUBMITTED run younger than 2 min → 409; `X-Request-Id = alma-<venue>-<kind>-<hash12>` on the wire, identical across retries |
| Destructive sync | an empty payload is refused (it would wipe OpenTable's menus); structural validation before the wire (dangling relations, empty menus or groups, bad prices → 422); menu removals must be confirmed by name; the first submission and any payload with under half the previously accepted items need an explicit acknowledgement that it replaces what OpenTable holds; nothing is deleted from a partial GET; profile sends only managed fields |
| Partial failure shown as success | 200 with `totalProcessedItems < totalItems` or a rejected item status → PARTIAL, shown red |
| Timeouts / retries / rate limits | AbortSignal per attempt (15 s), retry on 429/5xx/network with jittered backoff honouring `Retry-After`, max 4 attempts, never on other 4xx; one token refresh on 401 |
| Audit | every attempt has actor, payload, hash, request key, OpenTable request id, HTTP status, attempts, response, error |
| Database | migration `20261016090000_opentable_integration` is additive (two new tables, one enum value, no existing table or row touched; applied cleanly on a fresh database). Rollback: `docs/opentable/rollback-20261016090000.sql` |
| Configuration | every `OPENTABLE_*` value defaults to empty / `false`; the API boots and runs exactly as before without any of them; there is no scheduled or automatic push |

## 9. Tests

- `apps/api/src/lib/opentable-mapping.test.ts` — both venues' shapes, PRICE / SIZE_PRICE / unpriced / `showPrices=false`, dietary mapping, exclusions, diff, remote compare, profile managed fields and validation.
- `apps/api/src/lib/opentable-client.test.ts` — disabled client makes no call, token request shape, bearer + `X-Request-Id`, token cache and single 401 refresh, auth failure (no secret in the error), 429 with `Retry-After`, 5xx retry and give-up, no retry on 400, timeout, GET, non-JSON body.
- `apps/api/src/services/opentable-states.test.ts` — the state derivation and write-response classification.
- `apps/api/src/routes/opentable-guards.test.ts` — every route names its guard; only the menu push needs a publisher.

Run: `pnpm --filter @alma/api test` (part of CI's unit job). Typecheck: `pnpm typecheck`. Production build of the dashboard: `pnpm --filter @alma/admin-web build`.

## 10. Local development with a mock OpenTable

Neither free API has a sandbox, so a small mock (`docs/opentable/mock/server.mjs`; shapes from the docs) stands in: it issues tokens, accepts menu and profile posts (optionally `MOCK_PARTIAL=1` or `MOCK_FAIL=menus`), and answers the menus GET with the last post, one price nudged so the comparison shows a difference.

```
node docs/opentable/mock/server.mjs                      # port 3999
DATABASE_URL=… npx tsx apps/api/scripts/opentable-local-seed.ts   # two venues, published menus, admin + Avalon-limited publisher
OPENTABLE_API_BASE=http://localhost:3999 OPENTABLE_OAUTH_BASE=http://localhost:3999 OPENTABLE_API_ENABLED=true \
OPENTABLE_MENUS_WRITE_ENABLED=true OPENTABLE_MENUS_READ_ENABLED=true OPENTABLE_PROFILE_WRITE_ENABLED=true \
OPENTABLE_CLIENT_ID=dev OPENTABLE_CLIENT_SECRET=dev OPENTABLE_PARTNER_NAME=alma pnpm --filter @alma/api dev
pnpm --filter @alma/admin-web dev                       # http://localhost:5180/integrations/opentable
```

Screenshots taken this way on 16 Oct 2026 are in `docs/opentable/screenshots/` (01 not configured → 02 ready to submit with the first-submission acknowledgement → 03 accepted by API, publication not verified → 04 read-back comparison showing price differences → 05/06 profile pending / accepted → 07 activity detail → 08/09 mobile → 10 awaiting approval with flags off → 11 error with OpenTable unreachable). 05–07 and 10–11 were taken before the badge wording changed from “Synced” to “Accepted by API · publication not verified”; the layout is otherwise identical.

## 11. Open questions for OpenTable (needed before production)

1. Our `{partnername}` path segment and confirmation that rids 211307 / 211301 are the ids the Menus API expects.
2. Whether the `menus[]` envelope should carry one element per menu or one element holding every menu (the docs' example shows one element; the builder sends one element with every menu keyed inside it — switchable in `buildOpenTableMenusPayload` if OpenTable says otherwise).
3. The accepted vocabulary for `dietaryTags` / `allergens` beyond the examples (VEGETARIAN, VEGAN, HALAL, KETO, PLANT_BASED; MILK, MUSTARD). GLUTEN_FREE, GLUTEN_FREE_AVAILABLE, DAIRY_FREE, NUTS are our guesses and are flagged `verified: false` in `OPENTABLE_DIETARY_MAP`.
4. Whether a publishing partner may call `GET /v1/menus/rid/{rid}`.
5. The `timeZone` format and whether `location` is accepted by the Content API.
6. Rate limits (unpublished) and whether `X-Request-Id` deduplicates on their side for the Content API as it does for Menus.
