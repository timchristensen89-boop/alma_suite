# Public booking page — Sydney research notes

Background research for the alma-reserve.web.app `/widget` redesign. Done as a step before applying the Claude Design handoff bundle (`alma-suite-design-system/project/reservation-widget.jsx`) so the new flow is informed by what's working in the local market — not just the design file.

**Method caveat:** WebFetch could not reach individual venue pages in the research environment (every URL returned 403). Notes were assembled from WebSearch result summaries (which often quoted the venues' own page copy verbatim), design-press case studies, and documented behaviour of the platforms each venue runs on (SevenRooms, Resy, OpenTable, Tock, Dish Cult). Platform-level observations (time-slot pill behaviour, group-widget switcher, "Notify Me" race, embedded vs. handed-off) are reliable; per-venue layout descriptions are best-effort inferences. For a deeper pass, send 5–10 page screenshots and we'll annotate against the patterns below.

## Venues surveyed

Fine dining / hatted: Saint Peter, Bennelong, Sixpenny, Firedoor, Cafe Paci, Margaret, Aalia, Cirrus Dining, Sean's, Ester.

Modern Australian / upscale casual: Icebergs, Catalina Rose Bay, Totti's (Bondi), Alberto's Lounge, Bistecca, Yellow.

Coastal / Northern Beaches: The Boathouse Palm Beach, Pilu at Freshwater, Manly Pavilion, Public House Petersham.

## Patterns worth stealing — applied in this rebuild

1. **Hero photography of the *room*, not just the food.** Catalina, Icebergs, Manly Pavilion. *(Hero implemented as text-led for v1; photography slot reserved in the left column.)*
2. **Booking widget embedded inline, not behind a "Book Now" pop-out.** Saint Peter, Ester, Catalina, Cafe Paci. *(Widget lives on `/widget` as a peer of the hero, not behind a CTA.)*
3. **Group widget across venues with a tab/dropdown switcher.** Aalia (Esca), Swillhouse, Merivale, Solotel, Boathouse. *(Implemented: St Alma / Alma Avalon as two side-by-side tabs in step 1.)*
4. **Time slots as a horizontal strip of pills, not a dropdown.** Dish Cult, SevenRooms, Resy. *(Implemented in step 2 as a 4-column grid of time pills with Open / Limited / Full status.)*
5. **State policy *above* the widget, not in fine print.** Saint Peter (deposit), Catalina (2-hour seating), Pilu (surcharges), Sixpenny (deposit), Bennelong (pre-theatre). *(Implemented as three pills next to the hero: 30-day release, 2-hour seating, 24-hour cancellation.)*
6. **Carve out experiences as named tiles inside the widget.** Yellow, Bennelong (restaurant / counter / bar), Cirrus (Melbourne Cup), Manly Pavilion (bottomless brunch). *(Deferred for v2 — the current step 1 collapses to a single "dinner" experience; tasting nights and PDR will surface here later.)*
7. **Honest walk-in language.** Alberto's, Bennelong Bar, Public House. *(Implemented inside step 2's walk-in note and in the hero copy.)*
8. **A waitlist or "Notify me" inside the widget.** Sixpenny, Margaret, Bistecca. *(Implemented as the alternate state on step 2 when slots are empty: same panel switches to a fully-booked card + walk-in note.)*
9. **Release-schedule transparency for hard-to-book nights.** Firedoor (T-6 months, first Wednesday), Bistecca (7am daily, T-30). *(Implemented as a policy pill — "30-day rolling release" — visible from step 1.)*
10. **A clear group threshold that routes large parties to email/concierge.** Catalina (>10), Manly Pavilion (>15), Pilu (>10). *(Implemented: party size of 8+ swaps the "Next" button for "Send a function enquiry" + inline call/email links; the existing `FunctionEnquiryPanel` sits below the widget at `#alma-booking-function-enquiry`.)*
11. **Persistent "Book" CTA in the header.** Icebergs. *(Belongs on the marketing site, not the widget itself — handed back to the marketing-web app.)*
12. **Cross-link sister venues / private dining as peers, not afterthoughts.** *(Implemented in the hero's secondary links: "See the menu" and "Functions & private dining".)*
13. **Microcopy that sounds like the room.** Boathouse (sunny), Swillhouse (louche), Sixpenny (monastic), Yellow (botanical). *(Implemented via Cormorant italic headlines on every step — "Where would you like to come to dinner?", "We have these times for you.", "You're booked." — matches the handoff bundle's voice.)*
14. **Confirmation emails with one-tap modify/cancel.** *(Backend concern — captured for the next sprint; current `/book` endpoint already returns a reservation id we can use as a token.)*
15. **Card-on-file with no charge unless no-show.** Ester is the model. *(Deferred — out of scope for this UI rebuild; needs Stripe integration on the API.)*

## Patterns avoided

- **Enquiry-only booking** (Boathouse). *(Avoided — we keep real-time availability via the existing `/availability` endpoint.)*
- **Bouncing the user off-domain.** *(Avoided — the widget is in-app at `/widget`, no SevenRooms/Resy iframe.)*
- **Long legalese policy walls** (Saint Peter). *(Avoided — three short policy pills near the hero, no fine-print block.)*
- **Generic platform chrome swallowing brand.** *(Avoided — every surface uses the Alma design tokens: Cormorant Garamond display serif, Avenir/Manrope tracked caps, warm paper background, cocoa/forest/shell palette.)*
- **Hidden waitlists.** *(Avoided — fully-booked state offers walk-in guidance up-front rather than a dead end.)*
- **Surprise surcharges at the door.** *(Avoided — when applicable, surcharges should surface in the policy-pill row.)*
- **Multiple overlapping experiences with no clear default.** *(Avoided — the widget leads with the default dinner flow; tasting nights and PDR tile in later as separate tiles.)*
- **Hero video with autoplay sound.** *(Avoided — text-led hero.)*
- **Asking party size, then re-asking on a third-party page.** *(Avoided — one form, one source of truth.)*
- **Burying private dining / events under a "More" menu.** *(Surfaced via the hero links and the 8+ overflow routing.)*

## What this rebuild changed in the codebase

- `apps/reserve-web/src/App.tsx` — `PublicBookingWidget` rewritten as a 4-step flow (venue+date+party → time → details → ticket). Same API endpoints (`/api/reserve/public-widget/{config,availability,book}`), so no server changes needed.
- `apps/reserve-web/src/styles.css` — `.alma-booking-page` design block added (scoped tokens, typography, components). Existing manager dashboard styles untouched.
- `FunctionEnquiryPanel` reused as-is below the widget, anchored at `#alma-booking-function-enquiry` so the 8+ overflow note can deep-link.

## What's deferred to follow-up

- Hero photography slot (currently text-only).
- Experience tiles inside step 1 (tasting nights, PDR, Margarita masterclass).
- "Notify me when a slot opens" — needs a new endpoint (`/api/reserve/public-widget/waitlist`) to capture name + phone + window.
- Stripe card-on-file for no-show protection.
- Confirmation-email modify/cancel deep-link.

Sources: see commit message for the 20-venue URL list (verbatim from the research run).
