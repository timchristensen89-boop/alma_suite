# OpenTable free APIs — capability matrix

Verified against https://docs.opentable.com/ on 16 Oct 2026 (the Postman-published collection; sections "Platform Basics", "Environments", "Authorization", "Menus API", "Profile Content API", "Directory API"). Nothing below is inferred from other partners' integrations or from OpenTable's marketing pages. Where the documentation is silent, the row says so, and the integration treats the gap as **unsupported** until OpenTable confirms it in writing.

Our subscriptions (owner-stated, 16 Oct 2026):

| Product | Status | What it unlocks |
|---|---|---|
| Menus Partner | Production application in review | Menus API: publish (webhook POST) and, depending on partner type, retrieve (GET) |
| Restaurant Content Partner | Production contract awaiting signature; contract portal returning an error | Profile Content API: POST only |

Never used, never assumed **by the suite**: Booking/Consumer API, Reviews API, CRM/Sync API, Directory API (Consumer Partners only), POS API, Private Dining API, Diner Persona. The website's existing OpenTable hand-off (`restref` availability URL, see `01-audit.md` §4) stays exactly as it is. *Update 18 Oct 2026:* the group now holds a Booking Partner — Directory API (Bronze) sandbox subscription, used by the website only; see `05-subscription-review-2026-10-18.md` for the group-wide matrix.

## 1. Platform facts that bind every call

| Topic | Documented | Consequence for Alma Suite |
|---|---|---|
| Authorization | OAuth 2.0 **client credentials**. `POST {oauth}/api/v2/oauth/token?grant_type=client_credentials`, header `Authorization: Basic base64(client_id:client_secret)`, `Content-Type: application/json`, `Content-Length: 0`. Response `{access_token, scope:"DEFAULT", token_type:"Bearer", expires_in}` (example `expires_in` ≈ 23 days). Missing token → 400; invalid/expired → 401. Renewal = request a new token. | One cached token per environment, refreshed on 401 or before expiry. No per-restaurant OAuth, no refresh tokens, no browser involvement. Secrets stay server-side. |
| Hosts | OAuth pre-production `https://oauth-pp.opentable.com`, production `https://oauth.opentable.com`. API production `https://platform.opentable.com` (from the Menus GET example); pre-production `https://platform.otqa.com` (from the API Reference examples). | Both configurable by env; defaults follow the docs. |
| Sandbox | "The following APIs are currently available in the Sandbox Environment for approved partners: Authorization, Directory API, Sync API (All Tiers)." | **Menus and Profile Content are not in the sandbox.** Everything below is built on documented contracts and fixtures; the first real call happens only after production approval, behind flags. |
| Transport | HTTPS only, TLS 1.3. JSON; send `Accept: application/json`. LZ4 `Accept-Encoding` is *supported*, not required. | Plain JSON. |
| Idempotency | "All POST, PUT, and PATCH HTTP requests should contain a unique `X-Request-Id` header which is used to ensure idempotent message processing in case of a retry." | Every write carries `X-Request-Id` derived from venue + kind + payload hash, so a retry of the same payload is a no-op on OpenTable's side. |
| Rate limits | "Rate limits apply to all API requests and may vary by endpoint and use case … contact your OpenTable representative." No numbers published. | Treat 429 as retryable with backoff and `Retry-After`; cap attempts; one in-flight submission per venue. |
| Errors | Only the Sync API documents an error DTO (`status`, `error`, `message`, `OT-RequestId` response header). Menus and Profile Content document only the 200 shape. | Log status, body (truncated) and `OT-RequestId` header on every non-2xx; do not parse an error schema that is not documented. |
| Processing | Both writes return `200 {requestId, itemStatus:[{itemId, sequenceId, status:"Processing"}], totalItems, totalProcessedItems, created}`. **No status-polling endpoint is documented** for either API. | "Accepted" means OpenTable took the payload, not that it is live. The dashboard says so explicitly; the only confirmation of visibility is the restaurant's own OpenTable for Restaurants back office (or, for menus, the GET below if we are granted it). |
| Status page | Partners must subscribe to status.opentable.com. | Operational, not code. Noted in the guide. |

## 2. Menus API ("Menus Partner")

### 2a. Publish — `POST /v1/partnermenu/{partnername}/location/{rid}/menus`

| Aspect | Documented | Verdict |
|---|---|---|
| Semantics | "POST a request with **all menus of the restaurant** whenever there is a change in any part of any menu on a restaurant level." Async processing, "reflected on UI". | **WRITABLE**. Full-replace per restaurant. There is no partial update and no delete endpoint: a menu disappears from OpenTable by being absent from the next full POST. |
| Who chooses what is visible | "Restaurants will also be able to choose which menus they would like to display on their profile page as well as modify the order" — in OpenTable for Restaurants. | Submission ≠ visibility. The dashboard distinguishes "accepted by OpenTable" from "visible on OpenTable" and never claims the latter. |
| `partnername` | "Your agreed upon partner name. Should always be the exact same." | Env `OPENTABLE_PARTNER_NAME`, supplied by OpenTable at approval. **REQUIRES APPROVAL** (value unknown until then). |
| `locationId`/`rid` | Restaurant identifier, static per restaurant. | Per-venue setting: Alma Avalon `211301`, St Alma `211307` (the same rids the website uses for `restref`). To be confirmed by OpenTable as the rids for this partner — **REQUIRES APPROVAL**. |
| Menu object | `id`*, `name`*, `description`, `type` (DELIVERY_AND_PICKUP, DELIVERY, PICKUP, DINE_IN, CURBSIDE), `defaultCurrency`*, `ordinal`*, `createdAt`, `updatedAt`, `groups`* (RelationMapping list), `footnote`, `metadata`. | WRITABLE. We send `type: DINE_IN`, `defaultCurrency: AUD`. |
| Group | `id`*, `name`*, `description`, `subGroups`, `items`* (RelationMapping list; "Yes"), `metadata`. | WRITABLE. Groups map to Alma sections. |
| Item | `id`*, `name`*, `description`, `priceMetadata`, `modifierGroups` (**must be present, `[]` when none**), `subItems`, `sizes` (required when `priceType == SIZE_PRICE`), `metadata`. | WRITABLE. |
| ItemSize | `id`*, `name`*, `description`, `priceMetadata`. | WRITABLE. Used for Alma TABLE sections (one size per price column). |
| PriceMetadata | `priceType`* ∈ PRICE, CUSTOM_PRICE_TEXT, SIZE_PRICE; `minPrice`, `maxPrice` (double), `customPriceText`, `unit`, `tax[]`, `multiplicationFactor`. | WRITABLE. Prices are decimal majors, so cents/100. |
| Metadata | `nameTranslations`, `descriptionTranslations`, `calories`, `multiMax`, `availabilities[{dayOfWeek 1=Mon, startTime, endTime}]`, `ingredients`, `additives`, `prepackaged`, `nutritionalInfo`, `tags[]`, `images[]`, `enabled`, `allergens[]`, `dietaryTags[]`. | WRITABLE. `dietaryTags`/`allergens` are **free-form strings**; the only documented example values are VEGETARIAN, VEGAN, HALAL, KETO, PLANT_BASED (dietary) and MILK, MUSTARD (allergens). Alma's GF/GFA/DF/N codes have no documented OpenTable value — see §4. |
| Images | `thumbnailUrl`, `url`, `urlHeight`, `urlWidth`, `featured`. Must be fetchable URLs. | WRITABLE in principle. Alma menus carry no item images; promotion photos are public at `/api/public/promotion-images/<fingerprint>`. Not sent in v1 (see design). |
| Modifiers / pre-modifiers / combos | Full schema documented (ordering use case). | NOT USED. Alma menus have no modifiers; we send `modifierGroups: []` on every item as the docs require. |
| Response | `200 {requestId, itemStatus[], totalItems, totalProcessedItems, created}`. "An empty object may return HTTP 200, but it is not successfully processed." | Record `requestId` and `itemStatus`; a 200 with `totalProcessedItems < totalItems` is surfaced as a partial failure, not success. |
| Payload envelope | Example: `{"menus": [ { "<menuId>": {…menu…}, "groups": {…}, "items": {…}, "itemSizes": {…}, "modifierGroups": {…}, "modifiers": {…}, "preModifierGroups": {…}, "preModifiers": {…} } ]}` — the menu objects are keyed by their id *beside* the entity maps, inside a one-element array. | Followed exactly. The example shows one menu; with several menus we put every menu object in the same element keyed by id, with shared entity maps (ids are globally unique). **Ambiguity to confirm with OpenTable before first production push** (listed in the guide). |
| Deletion | Not documented; the "all menus" instruction implies absence = removal. | Treated as destructive: the preview shows any menu that would disappear and requires an explicit tick before publishing. |
| Status / errors | No polling endpoint; no error schema. | See §1. |

### 2b. Retrieve — `GET /v1/menus/rid/{rid}`

| Aspect | Documented | Verdict |
|---|---|---|
| Purpose | "Access Menus … allows partners to retrieve restaurant menu data from OpenTable for use in their own applications." Returns either `restaurantMenuUrl` (web-hosted menu) or `menus[]` with `menu{id,name,description,currency,updatedAt,ordinal,groups[ids]}`, `groups[{id,name,description,ordinal,items[ids]}]`, `items[{id,name,description,ordinal,price{amount},tags,modifierGroups}]`, `modifierGroups`, `modifiers`. | **READABLE — IF GRANTED.** "Menu availability is dependent on each restaurant's configuration and OpenTable's distribution rights … some restaurants may not return menu data at all." Whether a Menus *Partner* (publisher) subscription includes this read is not stated. Built behind its own flag (`OPENTABLE_MENUS_READ_ENABLED`); **REQUIRES APPROVAL**. |
| Comparison use | Enough to compare names, descriptions, prices and group membership per menu. Item ids are OpenTable's, not ours. | Comparison is by normalised (menu name, group name, item name); never by id; a missing item on OpenTable is reported as "not on OpenTable", never as "delete locally". |

## 3. Profile Content API ("Restaurant Content Partner")

### `POST /v2/partnerrestaurants/rid/{rid}` — the only endpoint

| Aspect | Documented | Verdict |
|---|---|---|
| Read | **No GET is documented.** "Restaurants will not be able to see when the last content update was pushed via the API." | **NOT SUPPORTED: reading the current OpenTable profile.** The comparison view compares Alma Suite against *what Alma Suite last submitted*, and tells the user to check OpenTable for Restaurants for anything older than that. |
| Write semantics | "Should you not have any data on one of the optional fields, please do not include it. If you would like to remove any existing data and leave the field empty, it will append the attribute and delete whatever detail is inside. To modify an existing restaurant, the same endpoint is used. Partners must supply all required information." | **WRITABLE**, field-level overwrite: a field we include replaces OpenTable's value; a field we omit is left alone; an empty value clears it. The publisher therefore sends only fields Alma Suite has marked "managed", so nothing the venue set by hand in OpenTable is wiped by accident. |
| `id` (required) | "The unique ID the partner has in their environment of the restaurant." | Venue slug (`st-alma`, `alma-avalon`). |
| `name` | Restaurant name. | WRITABLE. |
| `primaryCuisine`, `otherCuisines[]` | From the documented cuisine list (includes "Mexican", "Contemporary Mexican", "Regional Mexican", "Modern Australian", "Tapas / Small Plates", "Bar / Lounge / Bottle Service", "Wine Bar"…). | WRITABLE, validated against the list. |
| `phone` | With country code ("+13211231234"). | WRITABLE, E.164. |
| `currency`, `locale`, `timeZone` | ISO 4217; IETF tag; "Time zone of the restaurant" (example "Eastern", format not specified). | WRITABLE. We send `AUD`, `en-AU`, `Australia/Sydney` — **timeZone format REQUIRES CONFIRMATION** (example is a bare word). |
| `website` | URL. | WRITABLE. |
| `priceBandId` | 1–4 (1 = $15 and under … 4 = $51 and over; 1 is translated to 2). | WRITABLE. |
| `description` | Restaurant description in the declared locale. | WRITABLE. |
| `diningStyle` | One of: Fine Dining, Casual Dining, Home Style, Casual Elegant, Elegant Dining. | WRITABLE, enum. |
| `dressCode` | One of: Casual Dress, Jacket Required, Business Casual, Jacket and Tie Required, Formal Attire, Jacket Preferred, Smart Casual, Resort Casual. | WRITABLE, enum. |
| `publicTransit` (≤1000 chars), `privateEventDetails` (≤350), `cateringDetails` (≤350), `executiveChef`, `crossStreet` | Free text. | WRITABLE, length-validated. |
| `menu` | "The URL of the restaurant's menu." | WRITABLE. We send the public PDF/JSON URL of the live food menu. |
| `profileImage {url}` | JPEG/PNG, ≥1280×720, ≤10 MB, public URL. `images[{url}]` any count. | WRITABLE. URLs must be publicly fetchable (website images qualify). |
| `tags[]` | Free key phrases. | WRITABLE. |
| `openingTimes.standardOpeningTimes` | `{MONDAY: [{start:"HH:MM", end:"HH:MM"}], …}` (table says day names as strings; example uses upper case keys with an array of ranges). | WRITABLE. Multiple ranges per day are possible (split service). |
| `paymentOptions[]` | AMEX, Cash Only, Discover, MasterCard, Carte Blanche, Cheque Gourmet, Eurocheque Card, Sodexo Pass, Cash not accepted, Diners Club, JCB, Visa. | WRITABLE, enum. |
| `beverages[]` | Beer, Cocktails, Wine, BYO Liquor, Corkage Fee, BYO Wine, Full Bar. | WRITABLE, enum. |
| `dietaryOptions[]` | Gluten-free Options, Kosher, Vegan. | WRITABLE, enum. |
| `smokingOptions[]` | Indoor Smoking Area, Non-Smoking, Outdoor Smoking Area. | WRITABLE, enum. |
| `diversitySpotlightTags[]`, `safetyPrecautions[]` | Listed / shown in example. | WRITABLE; not used by Alma. |
| `location {address{street,city,country,province}, coordinates{latitude,longitude}, neighborhoodName}` | **Present in the example body, absent from the parameter table.** | **REQUIRES CONFIRMATION.** Built into the mapping but held back (not sent) until OpenTable confirms address edits are accepted for an existing rid. |
| Response | Same `requestId/itemStatus` shape as menus. | As §1. |
| Not covered at all | Reservation availability, experiences, closures/holiday hours, photos ordering, reviews, amenities beyond the enums above, tables/floor plans. | **NOT SUPPORTED.** Managed in OpenTable for Restaurants; the dashboard links there. |

## 4. Alma data that has no documented OpenTable field

| Alma field | Where it goes | Rule |
|---|---|---|
| Dietary codes GF, GFA, DF | `metadata.dietaryTags` as `GLUTEN_FREE`, `GLUTEN_FREE_AVAILABLE`, `DAIRY_FREE` | **Unverified values** (the docs say the field is a list of strings and show only five examples). Centralised in one constant so they can be changed in one place once OpenTable confirms its vocabulary. Kept in Alma regardless. |
| `N` (contains nuts) | `metadata.allergens: ["NUTS"]` | Unverified value, same rule. |
| `A` / `I` (Australian / imported) | `metadata.tags: ["Australian"]` / `["Imported"]` | Free-text tags, safe. |
| Item flags STAFF_PICK, LIMITED, NEW, ON_TAP | `metadata.tags` | Free-text tags. |
| `isSeafood` | — | Not sent. |
| TEXT sections (prose), `lead`, `page`, `placement`, `priceColumns` labels, `headerSuffix` | Group `description` / group name suffix / ItemSize names; `page`/`placement` never sent | Print layout has no OpenTable meaning. |
| `showPrices = false` (guest-facing private menus) | No `priceMetadata` | And PRIVATE_EVENT menus are never sent at all. |
| `heroPriceCents` (card headline price), `whenLine`, `conditions` | Menu `description` / `footnote` | Text only. |
| Promotions / What's On listings | — | **NOT SUPPORTED** by either API; only their printed card (a PROMOTION-kind menu) can be published as a menu. |

## 5. Summary by the owner's categories

| | Menus Partner | Restaurant Content Partner |
|---|---|---|
| **READABLE** | `GET /v1/menus/rid/{rid}` — if distribution rights are granted to this partner (unconfirmed) | nothing |
| **WRITABLE** | `POST /v1/partnermenu/{partner}/location/{rid}/menus` — full replace, async, accepted ≠ visible | `POST /v2/partnerrestaurants/rid/{rid}` — field-level overwrite of the documented fields |
| **NOT SUPPORTED** | partial updates, deletes, status polling, error schema, sandbox testing, visibility control (restaurant does it in OT4R) | reading the profile, hours exceptions, availability, experiences, reviews, sandbox testing |
| **REQUIRES APPROVAL / CONFIRMATION** | partner name; rid confirmation; multi-menu envelope shape; dietary/allergen vocabulary; read access | contract signature; `timeZone` format; whether `location` is accepted on updates |
