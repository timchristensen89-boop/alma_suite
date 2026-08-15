# ALMA POS — Market Research & Phased Roadmap

_Research date: 8 Aug 2026. Basis: 2026 comparisons and operator reviews of Toast, Square for Restaurants, Lightspeed, TouchBistro, SumUp; r/restaurateur switching threads; POS UX design literature._

## What makes the leaders shine

**Toast** (market leader, full-service depth)
- Coursing with **hold & fire** — courses held on the ticket, fired to the kitchen when the server says so
- **Native KDS** (kitchen display screens): colour-aged tickets, timers, bump/recall, per-station routing
- **Handhelds** — order + pay at the table; operators report fewer voids and faster table turns
- **Automated tip-sharing** at shift end
- Reliable **offline mode** — service survives the internet dropping
- Why people leave: cost creep (add-ons, hardware leases, processing), contracts ("Toast tax"), support quality

**Square for Restaurants**
- **Cleanest UI in the field — a new server is productive in 20 minutes.** This is the bar for our register UX
- $0 entry tier; **bar tabs with card-on-file** (swipe once, keep the tab open)
- Why people leave: restaurant workflows are shallow — splitting, ticket routing, inventory are clunky

**Lightspeed**
- Analytics + inventory depth
- Why people leave: paywalled APIs and per-module pricing (we lived this)

**TouchBistro**
- Best-in-class **floor plans** — colour-coded tables, resize/shape, whole rooms managed from the tablet
- Tableside iPad ordering

**Universally loved (the "miss it when it's gone" list)**
1. Speed under pressure — big targets, minimal taps, no scroll hunting
2. Hold & fire coursing + seat numbers on lines
3. Modifiers that flow (forced choices + free-text notes, no sub-menus maze)
4. KDS with timers and colour ageing
5. Card-preauth bar tabs
6. 86 list (sold-out toggle) that instantly greys items on every register
7. Handheld/tableside ordering
8. Tips flowing automatically into payroll/tip-outs
9. Offline resilience
10. Real-time sales visibility from the owner's phone

**Alma's unfair advantages** (nobody else has these without integration taxes): menu/recipes with live COGS, guest CRM + reservations, rosters/tip-runs, forecasting — all in the same database as the register.

## Where ALMA POS already stands (v1–v6, all deployed)
Register-first UX · tables/floor (shared with Reserve, drag-editable) · coursed lines · split bills · merge · bill history/reopen/refunds · auto surcharges/discount rules · audited comps/discounts/price-changes/wastage (fixed reasons) · cash drawers by denomination + close-of-day gates · printer profiles + dockets · per-user homescreens (colours/folders) · guest CRM link (spend/favourites live) · SevenRooms floor overlay · Stripe Terminal (simulated; awaiting reader hardware) · staff PIN sign-in.

## The phases

**Phase 1 — Service speed & correctness** _(highest daily-use value)_
- Modifiers: forced + optional option groups on items, plus free-text line notes
- Seat numbers per line
- Hold & fire: courses hold by default on Send; "Fire Mains" per course
- 86 list: sold-out toggle, greys item on every register instantly
- Per-user default category/landing

**Phase 2 — Kitchen display (KDS)**
- /kds view: live ticket queue per printer-profile station, course-grouped
- Timers + colour ageing, bump/recall, all-day counts
- Replaces paper dockets until printers arrive (then complements)

**Phase 3 — Payments & tabs**
- WisePOS E reader in production (flow already built)
- Bar tabs with Stripe card-on-file preauth
- Email/SMS receipts; reader tip prompts

**Phase 4 — Offline resilience**
- Local-first order queue (IndexedDB) + background sync; service-worker shell
- Degraded-mode banner; cash-only failsafe

**Phase 5 — Suite fusion & insights**
- Per-venue "POS is the till" flag → SalesActualEntry (live sales intraday in Reports)
- POS card tips → tip runs automatically; per-staff shift reports (X-report per server)
- Menu engineering directly from POS lines (zero mapping)

**Phase 6 — Multi-device & roles**
- Manager PIN gates on void/refund/discount thresholds
- Device profiles (bar register opens on Drinks; pass-through printer defaults)
- Training mode (sandbox orders that never count)

_Each phase: build → smoke test → commit → deploy before moving on._

### Sources
- [RestaurantVelocity — Best Restaurant POS 2026 (Toast vs Square vs Lightspeed vs Clover vs TouchBistro)](https://restaurantvelocity.com/blog/best-restaurant-pos-systems/)
- [RestroScout — Toast vs Square vs Lightspeed](https://restroscout.com/best-restaurant-pos-systems)
- [Sonary — Toast POS review](https://sonary.com/b/toast/toast+pos/) · [Toast vs Lightspeed](https://sonary.com/content/toast-vs-lightspeed-pos-which-system-is-better-for-your-restaurant-or-retail-business/)
- [GetVMS — Leaving Toast: 7 reasons restaurants switch](https://www.getvms.com/leaving-toast-pos/)
- [Tech.co — TouchBistro vs Square](https://tech.co/pos-system/touchbistro-vs-square) · [TouchBistro review](https://tech.co/pos-system/touchbistro-pos-review)
- [Dev.pro — POS UX tactics](https://dev.pro/insights/designing-a-pos-system-ten-user-experience-tactics-that-improve-usability/) · [Agente — POS design principles](https://agentestudio.com/blog/design-principles-pos-interface)
- [Quantic — 44 restaurant POS features](https://getquantic.com/restaurant-pos-system-features/)
