# ALMA Staff — native app

The staff web app also ships as a native app on the App Store and Google Play,
wrapped with Capacitor. The built web app is bundled into the binary rather
than pointed at a remote URL: Apple rejects apps that are a thin wrapper
around a website, and a bundled app opens instantly on a venue's bad wifi
instead of waiting on a download before showing anything.

Everything in this repo is done. What remains needs tooling and accounts that
are not on the build machine.

## What is already wired

- `capacitor.config.ts` — app id `au.com.almagroup.staff`, name "ALMA Staff",
  brand-green background, splash held for 600ms.
- `pnpm build:native` — same env and type gates as the web build, plus a
  relative asset base so files resolve inside the app bundle. A native build
  cannot be hotfixed the way hosting can, so it must not clear fewer gates.
- Hash routing on native only. The shell serves static files out of the
  bundle, so a deep path like `/clock` has no file behind it and a history
  router shows a blank screen on any cold start into a route.
- Durable session. A webview's localStorage is not durable — iOS evicts it
  under storage pressure, and being logged out between shifts is what gets an
  app deleted. The token is mirrored into Preferences (UserDefaults /
  SharedPreferences) and restored before the first render.
- Status bar styling and splash dismissal after first paint, so there is no
  white flash between the launch image and the app.
- `resources/` — 1024px icon, Android adaptive foreground/background, and a
  2732px splash, generated from the brand mark on the house green. The icon
  has no rounded corners or transparency: iOS applies its own mask and a
  pre-rounded icon ends up double-rounded.

## What is left, and what it needs

### 1. Install Xcode (macOS, ~10GB)

The build machine has Command Line Tools only:

    xcode-select -p    # /Library/Developer/CommandLineTools

Install Xcode from the App Store, then point the toolchain at it:

    sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
    sudo xcodebuild -license accept

For Android, install Android Studio and set `ANDROID_HOME`.

### 2. Generate the native projects

    cd apps/staff-web
    pnpm build:native
    npx cap add ios
    npx cap add android

This creates `ios/` and `android/` directories. Commit them — they hold
signing config and native tweaks, and regenerating loses those.

### 3. Generate the platform icon and splash sets

    npx @capacitor/assets generate --iconBackgroundColor '#1f3524' --splashBackgroundColor '#1f3524'

Reads `resources/` and writes every size each platform wants.

### 4. Accounts

- **Apple Developer Program**, USD 99/yr. Apple verifies the business, which
  takes a few days — start this before it blocks a release.
- **Google Play developer account**, USD 25 once.

### 5. Build and submit

    pnpm cap:ios       # builds, syncs, opens Xcode
    pnpm cap:android   # builds, syncs, opens Android Studio

Then archive and upload. Expect 1–2 weeks for a first App Store review.

Store listings also need: a privacy policy URL, a data-collection disclosure
(this app collects staff name, email and worked hours), screenshots at several
device sizes, and a support URL.

### 6. After it ships

`pnpm cap:sync` rebuilds the web app and copies it into both native projects.
Web-only changes still deploy to Firebase Hosting as they always did; the
native app only picks them up on its next store release, so anything urgent
should go out on the web first.

## Tap to Pay on iPhone

Accepting cards on the phone itself (task #38) needs the Stripe Terminal iOS
SDK inside this shell, plus Apple's
`com.apple.developer.proximity-reader.payment.acceptance` entitlement, granted
per app on request. That is why the gift card counter's "Card now" tender
currently hands off to a QR the guest scans — it works today with no hardware
and no entitlement, at card-not-present pricing.
