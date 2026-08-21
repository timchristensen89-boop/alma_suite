# Shipping ALMA POS to the App Store

State as of 2026-08-22: the shell builds and runs (Tap to Pay deliberately
off — see App.tsx). Apple Developer Program: enrolled. This file is the
submission playbook; everything here except the build/upload commands is
already prepared.

## Checked on 2026-08-22

Verified rather than assumed:

- **Icon** `assets/icon.png` is 1024x1024 with no alpha channel. Apple rejects
  an app icon with alpha, so this is worth re-checking after any redraw.
- **WebView target** is `https://alma-pos.web.app`, the live register, with
  `originWhitelist` limited to https.
- **Listing URLs resolve.** `/privacy` and `/contact` both exist on the
  marketing site. So does `/account-deletion`, which Apple requires of any app
  that lets you sign in — worth naming in App Review Information.

Fixed on 2026-08-22, and the reason matters for review:

- **The shipping build no longer asks for location or Bluetooth.** It used to.
  `app.json` declared `NSLocationWhenInUseUsageDescription` as "Stripe requires
  your location to accept card payments on this device" and pulled in the
  Stripe Terminal plugin with two Bluetooth strings — in a build with no
  payment feature at all. A reviewer would have been shown permission dialogs
  about card payments while looking for a payment feature that isn't there,
  which contradicts the argument in "Review-proofing" below and runs at
  Guideline 5.1.1 (do not request data the app does not use). Those three
  strings and the plugin now live behind `ALMA_TAP_TO_PAY=1` in app.config.js,
  alongside the entitlement. A normal build declares camera only, which the
  register genuinely uses for gift card and QR scanning.
- **The Terminal SDK no longer starts on launch** when Tap to Pay is off.
  Starting it is what makes the OS treat this as a payment app.

Not done, and it needs a decision (see "The reviewer's till" below).

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

- **Demo account — the reviewer's till.** The intent was a device account PIN
  that opens a TRAINING-mode register, so a reviewer never rings into a real
  till. That does not work as things stand: training mode is
  `alma.pos.training` in localStorage, a per-DEVICE toggle. A reviewer signing
  in on their own device starts with it OFF, and nothing about the account
  turns it on — so their test orders land in a live venue's takings, drawer
  and reports.

  Two ways out, and it is a decision rather than a fix:

  1. **Data only, available today.** Create a demo VENUE and an account scoped
     to it. Orders are then real but land somewhere that is nobody's takings,
     and every report already filters by venue. No code, no release.
  2. **Make training a property of the ACCOUNT, not the device.** A flag on
     the staff/device profile that forces training on at sign-in and cannot be
     switched off from that account. Correct, and useful well beyond App
     Review — it is also how you would hand a new starter a safe till. Costs
     a migration, an API change and a client change.

  Option 1 unblocks the submission; option 2 is the one worth having.
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
