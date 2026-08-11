# ALMA POS — iOS shell (Tap to Pay)

The register stays the web app. This shell exists for the one thing a browser
cannot do: **Tap to Pay on iPhone**, which Apple restricts to native apps
holding the proximity-reader entitlement.

Everything else — menu, bill, courses, printing, floor plan — is the same web
code loaded in a WebView, so a menu change still ships in seconds without an
App Store round trip.

## How the seam works

```
web POS  ──postMessage──▶  shell           (amount, venue, order id)
                             │
                             ├─ POST /api/pos/terminal/connection-token
                             ├─ POST /api/pos/terminal/payment-intent   ← on the VENUE'S Stripe account
                             ├─ Stripe Terminal SDK: collect + confirm  ← guest taps their card
                             │
web POS  ◀──injectJS─────────┘            (paymentIntentId)
   └─ POST /api/pos/orders/:id/pay { method: STRIPE_TERMINAL, reference }
```

The web app checks for `window.almaNative.tapToPay`. In Safari that's absent
and the register behaves exactly as it does today — the shell is additive,
never a dependency.

## What Tim needs to do (needs your Apple account — I can't do these)

1. **Apple Developer Program** — enrol as *Alma Group* (~A$149/yr).
   https://developer.apple.com/programs/
2. **Request the Tap to Pay entitlement** for bundle id `au.com.almagroup.pos`:
   https://developer.apple.com/contact/request/tap-to-pay-on-iphone/
   Apple grants a *development* entitlement first, then a *distribution* one
   after internal testing. Approval is not instant — start this early.
3. Tell me when it's granted and I'll finish the build config and hand you a
   TestFlight link.

## Requirements

- iPhone XS or later, current iOS, passcode set, signed into iCloud
- Australia is supported, **including eftpos** (cheaper interchange than
  scheme credit — worth routing to it)
- PIN entry works for amounts above the contactless limit

## Build (once the entitlement is granted)

```bash
cd apps/pos-native
npm install
npx expo prebuild --platform ios --clean
npx expo run:ios          # local device build
# or, for TestFlight:
npx eas build --profile production --platform ios
```

## Notes

- No Stripe secret ships in the app. The SDK is handed a short-lived
  connection token minted by our server.
- The payment intent is created **per venue**, so St Alma and Alma Avalon
  settle to their own companies — same rule as the QR payments.
- Apple requires a "How to Tap" instructional overlay before app review; the
  Stripe SDK provides it and it must be wired before submission.
- The same shell is where silent docket printing and kiosk mode would live if
  we want them later.

## Building it (read this first — two traps)

**1. The repo path has a space in it, and React Native's codegen can't cope.**
`apps/pos-native` lives under `alma-suite-v18 3`, and RN's `Generate Specs`
build phase doesn't quote the path, so it truncates at the space:

```
/bin/sh: /Users/timothychristensen/Downloads/alma-suite-v18: No such file or directory
```

The app therefore **cannot be built where it currently sits**. Either rename
the repo folder to remove the space (the permanent fix — it has bitten the
print bridge too), or copy the app somewhere space-free to build:

```bash
rsync -a --exclude ios/build "apps/pos-native/" /tmp/almapos-build/
rsync -a "apps/pos-native/ios/build/generated" /tmp/almapos-build/ios/build/
```

**2. CocoaPods needs a UTF-8 locale**, or it dies inside `unicode_normalize`
with a stack trace that looks nothing like the real problem:

```bash
cd ios && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pod install
```

Then:

```bash
xcodebuild -workspace ios/ALMAPOS.xcworkspace -scheme ALMAPOS \
  -configuration Debug -sdk iphonesimulator \
  -destination 'id=<simulator udid>' -derivedDataPath ios/build/dd build
xcrun simctl install <udid> ios/build/dd/Build/Products/Debug-iphonesimulator/ALMAPOS.app
xcrun simctl launch <udid> au.com.almagroup.pos
```

Verified 2026-08-12 on Xcode 26.6 / iOS 26.5 simulator: builds, installs,
launches, and loads the live register.

### expo-asset

`expo-asset` was pinned at `^57.0.9`, which does not exist for Expo SDK 52 —
so npm installed nothing and the app died at launch with
`Cannot find native module 'ExpoAsset'`. It is now `~11.1.7`. If you touch
Expo versions, run `npx expo install --check` before trusting a build.
