# OpenTable — subscription and capability review (18 Oct 2026)

Scope: every document in `docs/opentable/`, the Alma Suite integration merged through alma_suite PRs #319 and #329 (live since 17 Oct 2026, every outbound flag off), the website's OpenTable code in `alma-web-platform` (hand-off, Consumer API v2 flow, Directory API flow), and https://docs.opentable.com/ (Postman-published collection, read again on 18 Oct 2026: Platform Basics, Environments, Authorization, Directory API + Affiliates Guide, Booking APIs → Online Booking API (Consumer API v2), Sync APIs, CRM v3, Menus API, Profile Content API).

Our partner facts (owner-stated): **Partner ID 10005**, partner "Alma Freshwater Pty Ltd". **Approved: Booking Partner — Directory API (Bronze), sandbox.** Production pending. Separately (16 Oct): Menus Partner production application in review; Restaurant Content Partner contract awaiting signature.

Sandbox testing on 18 Oct used the pre-production OAuth client already in `apps/web/.env.local` of the website repo, read-only, Directory API only (`docs/opentable/sandbox-probe.mjs`). No Consumer, Sync or CRM endpoint was called; no booking was made; nothing in production was changed. No credential or token appears in this document, in logs, or in source.

## 1. Where OpenTable code lives today

| Piece | Repo / file | Endpoints | State |
|---|---|---|---|
| Suite: menus + profile publisher and dashboard | alma_suite `packages/shared/src/opentable.ts`, `apps/api/src/lib/opentable-client.ts`, `services/opentable.service.ts`, `routes/opentable.ts`, admin-web `/integrations/opentable` | `POST {oauth}/api/v2/oauth/token`, `POST /v1/partnermenu/{partner}/location/{rid}/menus`, `GET /v1/menus/rid/{rid}`, `POST /v2/partnerrestaurants/rid/{rid}` | **Live in prod**, flags `OPENTABLE_API_ENABLED` / `_MENUS_WRITE_` / `_MENUS_READ_` / `_PROFILE_WRITE_` all `false`; no env values set |
| Website: booking hand-off | alma-web-platform `apps/web/lib/opentable.ts`, `components/BookWidget.tsx` | none (link to `opentable.com.au/booking/restref/availability?rid&restref&partysize&datetime&ot_source=Restaurant website…`) | **Live** |
| Website: on-site booking (Consumer API v2) | `apps/web/lib/opentable-api.ts`, `app/api/booking/{availability,lock,reserve}`, `components/OnsiteBooking.tsx` (PRs #23, #24) | token, `GET /v2/availability/{rid}`, `GET /v2/experiences/{rid}/active`, `POST /v2/booking/{rid}/slot_locks`, `GET /v2/booking-policies/…`, `POST /v2/booking/{rid}/reservations`, `DELETE …/slot_locks/{token}` | Merged, **`OPENTABLE_BOOKING_MODE=off`** in production |
| Website: Directory API | `apps/web/lib/opentable-directory.ts`, `opentable-directory-map.ts`, `app/api/booking/directory/route.ts` (PR #36) | token, `GET /sync/directory?rid|country&offset&limit` | Merged, **`OPENTABLE_DIRECTORY_MODE=off`** in production |

Nothing in the suite talks to the Directory, Consumer or Sync APIs; nothing on the website talks to the Menus or Content APIs. The two code bases implement the same OAuth client-credentials pattern independently (see §10).

## 2. Capability matrix

Legend — **Implemented**: code exists and where. **Authorised**: covered by a subscription we actually hold. **Sandbox**: observed in OpenTable's pre-production on the date given. **Production**: what it takes to go live.

| # | Capability | Implemented | Authorised today | Works in sandbox | Production requires |
|---|---|---|---|---|---|
| 1 | OAuth 2.0 client-credentials token | Suite client; website `opentable-api.ts` and `opentable-directory.ts` | Yes (every approved partner) | **Yes, 18 Oct**: `POST` and `GET …/oauth/token?grant_type=client_credentials` with Basic auth both return 200, `token_type: bearer`, `scope: DEFAULT`, `expires_in` 153 982 s | Production client credentials (issued per approved product) |
| 2 | Directory API — listing of our two venues (name, address, geo, category, price band, published shifts, official URLs, photos, review score, private-dining flag) | Website only (`opentable-directory.ts`, behind flag). **Not in the suite** | **Yes — Directory (Bronze), sandbox** | **Yes, 18 Oct**: `?country=AU` → 3 913 restaurants in 4 pages, both rids found (211301 Alma Restaurant & Bar \| Avalon Beach; 211307 St. Alma \| Freshwater). `?rid=…` → **HTTP 500** "A database error occurred" for 211301, 211307 and OpenTable's own test rid 264001 (request ids `6f8abf58-0eb0-4531-84c3-30a57ecfb320`, `913961a2-7470-4794-9744-96a6c319cfc2`, `042ca999-e564-4763-8d4e-028739faf501`) — a sandbox fault, reproduced from 17 Oct | Production approval of the Directory subscription; then `OPENTABLE_DIRECTORY_MODE=production` on Vercel |
| 3 | Directory API — affiliate reservation links (`natural_profile_url` + `?ref=<referral id>`) | Website (link builder; `OPENTABLE_DIRECTORY_REF` unset) | Yes (Bronze) | URLs returned (http scheme; the site upgrades to https) | A referral ID from OpenTable, and confirmation it does not turn free website covers into network covers |
| 4 | Directory API — reservation data, availability, booking | — | — | — | **NOT PROVIDED by the Directory API** (see §7) |
| 5 | Menus API — publish all menus (`POST /v1/partnermenu/…`) | Suite (full mapping, preview, diff, guards, dashboard) | **No** — Menus Partner application in review | **Not available in sandbox** (docs: sandbox = Authorization, Directory, Sync only) | Approval + partner name + production credentials; then suite env flags |
| 6 | Menus API — read back (`GET /v1/menus/rid/{rid}`) | Suite (behind its own flag) | No; docs say the GET is for partners with distribution rights | Not available | Confirmation from OpenTable that a publishing partner may call it |
| 7 | Profile Content API — field-level profile update | Suite | **No** — contract unsigned, portal erroring | Not available | Signed contract + credentials; then suite env flag |
| 8 | Consumer API v2 — live availability, experiences, slot lock, create reservation, booking policies, release lock | Website (full flow, mock mode, certification fixes) | **No** — the Directory (Bronze) subscription does not include the Online Booking API | **Observed 14 Oct 2026** (same OAuth client): availability, lock and reserve succeeded on test RID 264001 (bookings 14642–14644); cancel returned 403 (scope not granted). Not re-run on 18 Oct because it is outside the authorised subscription | Online Booking API contract and pricing; pre-production certification review (OpenTable states ≥14 days); production credentials; production RIDs unlocked after certification; cancel scope; Spreedly/Stripe tokenisation only if card holds are ever enabled |
| 9 | Consumer API — `booking_restref_url` / `booking_url` deep links per available time | Not used | No (part of #8) | — | Same as #8; `booking_url` is for affiliates (needs `ref`), `booking_restref_url` is for restaurant groups |
| 10 | Sync API (Copper: reservations v2, guests v2; Gold: guests with opt-in filters) — reservation records for our venues | — | **No** (restaurant-partner product, separate contract) | Listed as sandbox-available for approved partners; not tested (not subscribed) | Sync API contract at the relevant tier |
| 11 | CRM v3 tags, Reviews, POS, Private Dining, In-House (Voice) Booking API | — | No | — | Separate contracts; not needed |
| 12 | Hand-off to OpenTable's booking page with venue, date, time, party and website attribution | Website, **live** | Needs no API | n/a | Nothing |

### Reading the matrix against the owner's constraints

- The 16 Oct brief ruled out paid partner APIs, including the Booking Partner API and the "paid Directory API". The Directory (Bronze) subscription is now approved for sandbox, so the website's Directory flow (built 17 Oct) is within the subscription we hold. The Consumer API flow (built 14–15 Oct) is **not** within any subscription we hold; it is finished code waiting on a commercial decision (§9).
- `docs/opentable/02-api-capability-matrix.md` line "Never used, never assumed: … Directory API (Consumer Partners only)" described the suite only and is still true of the suite. It is superseded for the group as a whole by this document.

## 3. Does the current implementation support the Directory API?

- **Alma Suite (PRs #319/#329): no.** It has no Directory client, route, model or screen. It does not need one: the suite publishes menus and profile content; the Directory is a read-only listing feed aimed at the website.
- **Website: yes, behind a flag.** PR #36 reads both venues from `/sync/directory`, caches them for 24 h, uses the official `natural_reservation_url` for the venue page "Open on OpenTable" link, and adds a "[Venue] Reservations" link under the widget that carries the guest's venue, date, time and party. Flag off in production, so nothing is called today.

## 4. What additional subscriptions or permissions are required

| Goal | Required from OpenTable |
|---|---|
| Keep official listing data and links in sync on the website | Directory (Bronze) **production** approval; referral ID (and its attribution rules) |
| Publish Alma Menus to the OpenTable profile | Menus Partner approval, partner name, production credentials |
| Publish profile content (description, cuisine, hours, photos…) | Restaurant Content Partner contract signature, credentials |
| Read menus back for verification | Written confirmation that a publishing partner may call `GET /v1/menus/rid/{rid}` |
| Live availability and completing reservations on almagroup.com.au | Online Booking API (Consumer API v2) contract, certification, production RIDs (§9) |
| Reservation records in the suite (reports, forecasting) | Sync API Copper (reservations + guests); Gold only if opt-in guest marketing fields are wanted |
| Partner ↔ venue association | OpenTable to link Partner 10005 to rids 211301 and 211307: both return `is_restaurant_in_group: false` in the sandbox |

## 5. OAuth and the sandbox configuration

**Flow (documented and observed).** `{oauth}/api/v2/oauth/token?grant_type=client_credentials` with `Authorization: Basic base64(client_id:client_secret)`. The docs show `POST` with `Content-Length: 0`; the website client sends `GET`. On 18 Oct both verbs returned 200 with `scope: DEFAULT`, `token_type: bearer`, `expires_in: 153 982` (≈1.8 days; 172 799 on 17 Oct; the docs' example is ≈23 days) — cache by `expires_in`, never by a fixed lifetime. Missing token → 400, invalid/expired → 401. One token per OAuth client per environment; no per-restaurant OAuth; no refresh token.

**Hosts.**

| Environment | OAuth | API |
|---|---|---|
| Sandbox (pre-production) | `https://oauth-pp.opentable.com` | `https://platform.otqa.com` |
| Production | `https://oauth.opentable.com` | `https://platform.opentable.com` |

**Sandbox scope.** Authorization, Directory API and Sync API only (docs, Environments). Menus and Profile Content are not in the sandbox. Sandbox responses are curated test data and "must not be employed for any live integrations". OpenTable's test restaurants (264001, 1038007, 1040230) exist for the Consumer API; the Directory sandbox nonetheless lists real AU restaurants, including ours.

**Partner ID 10005** does not appear in any Directory, Consumer, Menus or Content path. It is used only by the CRM v3 endpoints (`/api/v3/external/partners/{partner-id}/…`), which we do not use. The token response carries no partner identifier, so the sandbox cannot prove which subscription a given OAuth client belongs to.

**Exact sandbox environment (website, Vercel Preview or local only — never Production):**

```
OPENTABLE_DIRECTORY_MODE=sandbox            # refused automatically when VERCEL_ENV=production
OPENTABLE_API_BASE=https://platform.otqa.com
OPENTABLE_OAUTH_BASE=https://oauth-pp.opentable.com
OPENTABLE_CLIENT_ID=<sandbox client id>     # Sensitive; server only
OPENTABLE_CLIENT_SECRET=<sandbox secret>
OPENTABLE_DIRECTORY_CLIENT_ID / _SECRET     # only if OpenTable issued a separate client for the Directory subscription
OPENTABLE_DIRECTORY_REF=                    # leave unset until the referral ID and its attribution are confirmed
OPENTABLE_BOOKING_MODE=off                  # the Consumer flow stays off (not subscribed); 'mock' is the local UI harness
OPENTABLE_RID_AVALON / OPENTABLE_RID_ST_ALMA # test RIDs for a Consumer-API sandbox run only; ignored on Vercel production
```

**Suite equivalent** (`/opt/alma/deploy/env/suite-api.env`, only once Menus/Content are approved; there is no sandbox for them): `OPENTABLE_ENV=preprod|production`, `OPENTABLE_CLIENT_ID/SECRET`, `OPENTABLE_PARTNER_NAME`, `OPENTABLE_API_ENABLED`, `OPENTABLE_MENUS_WRITE_ENABLED`, `OPENTABLE_MENUS_READ_ENABLED`, `OPENTABLE_PROFILE_WRITE_ENABLED`, `OPENTABLE_TIMEOUT_MS`. All absent today.

**Where credentials live.** One sandbox OAuth client in `apps/web/.env.local` on the Mac (set up for the 14 Oct Consumer-API run, reused for the Directory run). Not in Vercel, not in the suite, not in either repository. The sandbox probe prints statuses, counts and public listing fields only.

## 6. Can Partner 10005 reach both venues?

- **Directory, sandbox: yes.** Both venues are returned by the `country=AU` listing with correct names, addresses, coordinates, categories, price band and shifts. Phones, photos and reviews are empty in the sandbox (sandbox data; also empty for OpenTable's San Francisco sample).
- **Not as a group.** `is_restaurant_in_group` is `false` for both, so OpenTable has not associated this partner account with the two restaurants. That flag is what the docs use to mark "member of the restaurant group associated with the partner". Ask OpenTable to link them before production.
- **Consumer API:** production RIDs are unlocked only after certification; the sandbox exposes OpenTable's test restaurants, not ours.
- **Menus / Content:** the rid in the path is ours (211301 / 211307); whether OpenTable accepts them for Partner 10005 is confirmed only at approval.

## 7. What the Directory API provides, and what it does not

| Provides (per restaurant, refreshed nightly) | Does not provide |
|---|---|
| `rid`, `name`, `address`, `address2`, `city`, `state`, `country`, `postal_code`, `latitude`, `longitude`, `phone_number`, `metro_name` | Any reservation record (that is the Sync API) |
| `reservation_url` / `profile_url` (id-based) and `natural_reservation_url` / `natural_profile_url` (slug-based) — the official OpenTable pages | Live availability, slot locks, confirmations, cancellations (Consumer API) |
| `hours` (HTML) and `hours_raw[]` shifts (`name`, `shiftStarts`, `shiftEnds`, `days`) | Special closures or holiday hours |
| `category[]`, `price_quartile`, `review_count`, `aggregate_score`, `profile_photo` (sizes) | Experiences, prices, surcharges, menus |
| `is_restaurant_in_group`, `private_dining.enabled_with_active_spaces` | Any query or link parameter for date, time or party size |

Booking links per the Affiliates Guide: `natural_profile_url` + `?ref=<referral id>`, link text restricted to "Online Reservations", "[RestaurantName]", "[RestaurantName] Reservations" or "Restaurant Reservations", placed next to or instead of the phone number. The overview states the Directory API "is only available to our Consumer Partners and is not offered to our Restaurant Partners"; OpenTable has nevertheless approved it for us, so the value on our own site is keeping official URLs, address and shifts in sync, not new booking capability.

## 8. Can dates, party sizes and times be passed into OpenTable links?

Yes, by three routes, two of them documented:

| Route | Parameters | Status |
|---|---|---|
| Restref availability page (what OpenTable's own website widget opens): `opentable.com.au/booking/restref/availability?rid=&restref=&partysize=N&datetime=YYYY-MM-DDTHH:MM&ot_source=Restaurant website&lang=en-AU` | party size, date-time, venue, attribution; `experienceId` accepted as a hint only | **Live on the site today**; counted as a free website cover in AU |
| Consumer API `booking_restref_url` (`/restref/client?rid=&dateTime=&partySize=&restref=`) and `booking_url` (`/book/validate?rid=&d=&sd=&p=&ref=…`) returned per available time | date-time, party size, dining area; `booking_url` needs the referral id and is for affiliates, `booking_restref_url` is for restaurant groups | Documented; only reachable through the (unsubscribed) Consumer API |
| Directory `natural_reservation_url` + `?covers=N&dateTime=YYYY-MM-DDTHH:MM` (+ `restref`, `ot_source`) | party size, date-time | **Observed** 17 Oct 2026 (pre-selects 4 people · 24 Oct · 7:00 pm; with `restref` it redirects to the same restref availability page). Not documented by the Directory API — used only for the secondary link |

The Directory API itself defines no such parameters; the pre-fill comes from OpenTable's consumer site.

## 9. Exact additional access for live availability and on-site reservations

Live availability and completing a reservation inside almagroup.com.au need the **Online Booking API (Consumer API v2)**, a separate Booking Partner product from the Directory. Specifically:

1. A contract for the Online Booking API (pricing is disclosed during contracting; OpenTable's docs say cost "may vary depending on the API or the selected API tier").
2. Pre-production certification: OpenTable reviews the integration in sandbox for at least 14 days against its implementation tips (terms acceptance in a visible interface, cancellation path, policy messaging, no stored card data).
3. Production credentials for that product and the unlocking of rids 211301 / 211307.
4. The reservation-cancel scope (`PUT /v2/booking/{rid}/reservations/{rid}-{conf}`) if on-site cancel is wanted; otherwise the `manage_reservation_url` hand-off satisfies the cancellation requirement.
5. Spreedly (OpenTable's preferred processor) or Stripe tokenisation only if either venue ever enables card holds or prepaid experiences; neither does today.

The code for all of this is already merged on the website and passed an end-to-end sandbox run on 14 Oct 2026; going live is `OPENTABLE_BOOKING_MODE=live` plus production credentials after certification. **This conflicts with the 16 Oct instruction never to subscribe to the paid Booking Partner API.** The decision is commercial, not technical; nothing here changes it.

## 10. Can the suite integration and the website widget share one backend?

They can share **credentials and configuration**, and should not share **runtime**:

- Both already implement the same OAuth client-credentials flow, hosts and env naming (`OPENTABLE_CLIENT_ID/SECRET`, `OPENTABLE_API_BASE/OAUTH_BASE` on the website; `OPENTABLE_ENV` picks the same hosts in the suite). One OpenTable OAuth client per environment can serve both, provided OpenTable issues it for every subscribed product (they may issue one per product — ask).
- Routing the website's booking or directory calls through the suite API on the VPS would add a network hop and couple the public site's uptime to the VPS for no gain: the website already keeps credentials server-side on Vercel and caches the Directory for 24 h. Latency for a guest-facing availability search matters; the suite's single-core VPS is the wrong place for it.
- The reverse (suite consuming the Directory) has no use today: the suite has no hours model and publishes rather than reads. If the suite ever needs OpenTable's published shifts (for example to prefill the profile's opening times), the pure mapper `opentable-directory-map.ts` can move into `@alma/shared` unchanged.
- What should be unified is the **record of truth about the partnership** (partner id, subscriptions, referral id, which OAuth client belongs to which product, certification status). This document is that record until OpenTable confirms the credentials mapping.

## 11. Simplest path to complete the integration (no rebuilding)

Everything below is configuration and OpenTable paperwork; no new code is needed for items 1–4.

1. **Now, nothing to build.** The hand-off stays live and already carries venue, date, time and party with website attribution. Both deployed integrations (suite publisher, website Directory/Consumer flows) are off by flag.
2. **Directory → production** once OpenTable approves: set `OPENTABLE_DIRECTORY_MODE=production` (and separate Directory credentials if issued) in Vercel Production, redeploy, check `/api/booking/directory` and both venue pages. Add `OPENTABLE_DIRECTORY_REF` only after OpenTable confirms the referral id keeps website-cover attribution. Report the `rid` filter 500s (request ids in §2) so the daily refresh can stop scanning 3 913 AU restaurants.
3. **Menus Partner approval** → set the suite env values and `OPENTABLE_API_ENABLED=true`, `OPENTABLE_MENUS_WRITE_ENABLED=true`, restart suite-api, enter rids in the dashboard, Check connection, Preview, Publish (first submission needs the on-screen acknowledgement). Confirm the four open questions first: partner name, envelope shape, dietary/allergen vocabulary, read access.
4. **Content Partner contract** → `OPENTABLE_PROFILE_WRITE_ENABLED=true`, tick the managed fields, publish. Confirm `timeZone` format and whether `location` is accepted.
5. **On-site booking** only if the owner reverses the no-paid-API position: Online Booking API contract → certification → `OPENTABLE_BOOKING_MODE=live`. Otherwise leave the code dormant; it costs nothing.
6. **Ask OpenTable, in one message:** (a) link Partner 10005 to rids 211301/211307 (`is_restaurant_in_group`), (b) which OAuth client belongs to which subscription and the production equivalents, (c) referral id and attribution rules, (d) the `rid` filter fault, (e) rate limits for `/sync/directory`, (f) the Menus/Content questions above, (g) whether Sync API Copper is bundled with any current tier (reservation records would let the suite's forecasting read covers without the website).

## 12. Status of each document in `docs/opentable/`

| Document | Status after this review |
|---|---|
| `01-audit.md` | Accurate for the suite; its "website" section predates the Directory flow (PR #36) and the hours change (PR #37) |
| `02-api-capability-matrix.md` | Accurate for Menus / Content; the "Directory API (Consumer Partners only), never used" line now applies to the suite only — see §2 above |
| `03-design.md`, `04-integration-guide.md` | Accurate; live since 17 Oct 2026 |
| `rollback-20261016090000.sql`, `mock/server.mjs`, screenshots | Unchanged |
| `sandbox-probe.mjs` (new) | Read-only token + Directory probe used for §2/§5/§6; run with `node --env-file=<env file> docs/opentable/sandbox-probe.mjs` |
