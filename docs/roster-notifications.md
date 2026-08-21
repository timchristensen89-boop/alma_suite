# Telling staff their roster is out

Three things happen the moment a manager publishes a roster. They are
deliberately independent — any one of them failing still leaves the other two
carrying the news.

| What | Who gets it | Needs |
|---|---|---|
| **Email** | everyone rostered with an address on file | Resend configured |
| **Calendar feed** | anyone who has subscribed once | nothing — always on |
| **Push notification** | every device that opted in | VAPID keys on the server |

The roster page in ALMA Staff is the fourth way, and the only one that never
needs setting up: it is always the truth, whatever else did or didn't arrive.

## What a staff member does

Once, on each device they want:

1. Open ALMA Staff → **Roster**.
2. **Tell me when the roster drops** → *Notify me on this device*.
3. Allow notifications when the browser asks.

**On an iPhone or iPad there is a step before that.** Apple only delivers web
push to a site that has been added to the home screen. Tap **Share** → **Add to
Home Screen**, then open ALMA Staff from the new icon. Until they do, the card
says so rather than offering a button that cannot work.

It is per device, not per person. Someone who works off a phone and does admin
on an iPad turns it on twice, and losing one phone does not silence the other.

## What a manager sees

The publish confirmation names the outcome rather than claiming success:

> Published — 7 people emailed their shifts and calendar link, buzzed 4
> devices. Not told: Sam Rowe (no email address on file).

Devices, not people, because one person can have several. Anyone who could not
be reached is named, with the reason — a roster that silently misses somebody
is the failure this whole feature exists to prevent.

## Setting it up on the server

Generate a VAPID key pair once and put it in `env/suite-api.env`. The commands
are in `apps/api/.env.production.example`. The private key never needs to leave
the server.

Until the keys are set, `GET /api/staff/me/push` reports `configured: false` and
the card hides itself. Email and the calendar feed carry on regardless.

## How it fits together

- **`packages/shared/roster-calendar.ts`** — `rosterPushNotification()` builds
  the title and body. Shared so the tested version is the shipped one, and so
  the wording lives beside the calendar and email formatting rather than drifting
  from it.
- **`apps/api/services/push.service.ts`** — subscriptions, sending, pruning.
  Every failure here is swallowed and counted: publishing a roster must never
  roll back because a phone is flat.
- **`apps/api/lib/public-paths.ts` and the staff write allowlist** — the two
  places that have to agree before a staff member can turn notifications on for
  their own phone. Adding a route is not enough; see #204 for what happens when
  only half of it is done.
- **`apps/staff-web/public/sw.js`** — shows the notification and handles the
  tap. No caching in it on purpose: a service worker that also caches is the
  classic way to leave staff looking at last week's build with no way to force
  an update from a phone.
- **`apps/staff-web/public/manifest.webmanifest`** — what makes the app
  installable, which is what makes push possible on iOS at all.

## Things worth knowing

**Rotating the keys logs every device out of notifications.** Staff have to tap
the button again. Their old rows are pruned automatically on the first send
after the rotation, so there is nothing to clean up by hand.

**A dead subscription deletes itself.** When a push service answers 404 or 410
— app uninstalled, browser data cleared — the row goes. Anything else (a
timeout, a rate limit) is treated as temporary and left alone.

**Notifications replace rather than stack.** They all carry the same tag, so a
second publish supersedes an unread first one instead of leaving two
contradictory notifications on a lock screen.

**Terminated and archived staff are never notified**, by either route, and are
reported as skipped so the reason is visible rather than mysterious.
