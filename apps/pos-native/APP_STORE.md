# Shipping ALMA POS to the App Store

State as of 2026-08-14: the shell builds and runs (Tap to Pay deliberately
off — see App.tsx). Apple Developer Program: enrolled. This file is the
submission playbook; everything here except the build/upload commands is
already prepared.

## Phase 1 — the shell on TestFlight, then the store

The app is the web register in a WebView plus native plumbing. It ships now
WITHOUT payments — Square Terminals handle cards — so App Review sees a
business tool, not a payment app.

### Tim's steps (need your Apple sign-in; ~20 min active)

1. Open the workspace and set signing:
   `open apps/pos-native/ios/ALMAPOS.xcworkspace`
   → target ALMAPOS → Signing & Capabilities → Team: Alma Group.
   Xcode mints the distribution certificate + profile itself.
2. Product → Destination → **Any iOS Device**, then Product → **Archive**.
3. In the Organizer window: **Distribute App → App Store Connect → Upload**.
4. appstoreconnect.apple.com → My Apps → **＋ New App**:
   - Platform iOS · Name **ALMA POS** · bundle `au.com.almagroup.pos`
   - Language English (Australia) · SKU `alma-pos`
5. TestFlight tab → add yourself + managers as internal testers → install
   from the TestFlight app. Internal testing needs NO review — this is the
   same day you archive.
6. When happy, App Store tab → fill the listing (text below) → submit.
   In **App Review Information**, paste the demo sign-in (below) — reviewers
   must be able to open the register.

### Listing copy (paste-ready)

- **Name:** ALMA POS
- **Subtitle:** Alma Group's venue register
- **Category:** Business
- **Description:**
  The point-of-sale register for Alma Group's venues — Alma Avalon and
  St Alma, Freshwater. Staff ring up tables, fire courses to the kitchen,
  split and settle bills, and manage the floor. For Alma Group staff:
  sign-in requires a venue account.
- **Keywords:** pos,register,hospitality,restaurant,venue
- **Support URL:** https://almagroup.com.au/contact
- **Privacy Policy URL:** https://almagroup.com.au/privacy
- **App Privacy questionnaire:** Data collected — Contact Info (staff name,
  email) and User ID, linked to identity, used for App Functionality only,
  not used for tracking. (Staff sign in; guests never do.)

### Review-proofing

- **Demo account:** create a device account PIN that opens a TRAINING-mode
  register at a demo venue and put it in App Review Information. Never give
  reviewers a live till.
- **Guideline 4.2 (minimum functionality):** if the reviewer pushes back on
  the WebView, the response is that this is an internal business tool for a
  named company's venues with native device integration on the roadmap
  (Tap to Pay), and staff-only sign-in. Business/enterprise wrappers pass on
  this basis routinely.
- **Distribution choice:** consider requesting an **unlisted app link**
  (App Store Connect → App Distribution → unlisted) — the app passes normal
  review but is only reachable by link, which suits a staff register. Public
  listing also fine; sign-in gates everything.

## Phase 2 — Tap to Pay on iPhone

Two gates, then a build:

1. **Entitlement** — request at
   https://developer.apple.com/contact/request/tap-to-pay-on-iphone/
   while signed into the ORGANIZATION account (Individual accounts are
   refused). Request text:

   > Alma Group (ABN —, developer team —) operates two restaurants in
   > Sydney: Alma Avalon and St Alma, Freshwater. Our staff-only iOS app
   > "ALMA POS" (bundle id au.com.almagroup.pos) is the venues'
   > point-of-sale register. We request the Tap to Pay on iPhone
   > entitlement to accept contactless card payments on iPhone at the
   > table, at functions, and at off-site events, using our payment
   > provider's certified SDK (Square Mobile Payments SDK, AU). Apple Pay,
   > contactless credit/debit and eftpos would be accepted in Australia.

2. **SDK rewrite** — the shell's payment code targets Stripe Terminal, which
   predates the venues' move to Square. Before enabling, App.tsx's Stripe
   path must be rewritten against Square's Mobile Payments SDK (supports Tap
   to Pay on iPhone in AU) so money lands on the right processor, per venue.
   Until both are done `TAP_TO_PAY_ENABLED` stays false and the register
   never shows the button.

3. Build with `ALMA_TAP_TO_PAY=1` so app.config.js includes the
   proximity-reader entitlement, bump the version, archive, and ship the
   update.

## Housekeeping

- Version lives in app.json (`expo.version`); Xcode's build number bumps per
  archive upload.
- `~/alma-pos-native` is a STALE copy (pre Aug-12); this directory in the
  suite repo is the real one. Delete the stray copy when convenient.
- Never commit `ios/build/` — it filled the VPS disk once already
  (.dockerignore and .gitignore both exclude it).
