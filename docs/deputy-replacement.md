# Replacing Deputy with the suite

What Deputy was still doing, what in the suite now does it, and the order to
cut over in. The suite side has been live for a while for rosters, timesheets
and payroll; the two pieces that kept the subscription alive — the wall
kiosk and shift swaps — now exist here too.

## The map

| Deputy | ALMA suite |
| --- | --- |
| Rostering + publish | Staff → Roster (publish emails + push + calendar feed) |
| Kiosk clock-in on the wall | **`alma-pos.web.app/#clock`** on a wall tablet |
| Clock in/out on your phone | Staff app → Clock (PWA, works installed) |
| Timesheets → payroll | Staff → Timesheets → Xero push (per-company routing) |
| Shift swaps / offering shifts | Staff app: My shifts → *Offer to the team*; teammates claim; manager approves |
| Open shifts | Same claiming flow — a shift with nobody on it |
| Leave requests | Staff app → Leave |
| News feed / announcements | Comms (announcements + messages) |
| Break/leave import from Deputy | The Deputy sync — dies with the subscription, nothing else uses it |

## Setting up the wall kiosk (per venue, ten minutes)

1. Any spare tablet on the wall wifi. Open `https://alma-pos.web.app` and
   sign in with the venue's **device account** (same one the tills use).
2. Change the URL to `https://alma-pos.web.app/#clock`. That's the kiosk:
   big PIN pad, who's-on-now list, one-button clock in / break / out.
3. Add it to the home screen (Share → Add to Home Screen) and, on an iPad,
   turn on **Guided Access** (Settings → Accessibility) so the tablet stays
   on that screen.
4. Staff use the same PIN as the register. Someone rostered across from the
   other venue can punch here too — the PIN lookup falls back across venues.

Every punch uses the same clock sessions the staff app writes, so
timesheets, approvals and Xero cannot tell kiosk punches from phone punches.

## Shift swaps — how the loop runs

1. **Offer:** in the staff app, a shift of yours → *Offer to the team*
   (optional note). The shift stays yours, still costed on the roster, until
   a manager approves someone taking it.
2. **Claim:** teammates see it under *Shifts you can pick up*, marked as a
   swap with your name on it. Claiming is blocked for anyone double-booked,
   on approved leave, or missing a required cert — checked again at approval.
3. **Approve:** managers decide from the claims queue. Approval reassigns
   the shift, closes other claims, moves the confirmation to the new holder.
4. **Everyone hears about it** by push: the offerer when someone claims,
   both sides when it's decided, claimants if the offer is withdrawn.

## Cutting over

1. Wall tablets up at both venues (`#clock`), one week of parallel running.
2. Staff told: clock on the wall or the app, swaps in the app, Deputy dead.
3. Export any Deputy history worth keeping (timesheet archive) to CSV.
4. Remove the Deputy webhooks and the sync cron, then cancel the
   subscription. The suite's Deputy import code can stay — inert without
   credentials — until a cleanup pass removes it.
