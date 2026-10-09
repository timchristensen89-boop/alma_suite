# Menus V2 — content decisions, one table per disputed item

For the owner. Each row shows what the website says today, what the design-folder source says, and what the Menus V2 import will create as a draft unless told otherwise. Tick the column that wins, or write the answer. Nothing is imported or published until this is answered; "proposed" is the importer's default from `plan.md` §5, not a recommendation.

Sources: website = `alma-web-platform` `apps/web/data/whats-on.ts` and the PDFs under `apps/web/public/menus` (live at almagroup.com.au, 9 Oct 2026); design folder = Dropbox `/Family Room/Indesign/…` (newest export per card, checked 9 Oct 2026 — no PDF newer than the ones listed exists; the Happy hour and Lunch special `.indd` files were edited after their last export and may hold unexported changes); import = `apps/api/src/data/import/*.ts` at `cfaa8eaf`.

## 1. Alma Avalon · Happy hour — hours

| | Website today | Design folder (A5 card, 16 Aug 2025) | Jan 2026 What's On page | Proposed V2 draft |
|---|---|---|---|---|
| Days / times | **Wed–Sun** (listing cadence) · card strip "Wed–Thu · 5–6pm · Fri–Sun · 4–6pm" | **Tue–Thu · 5–6pm · Fri–Sun · 4–6pm** | Tue–Fri · 5–6pm · Sat & Sun · 4–6pm | Card when-line **Tue–Thu · 5–6pm · Fri–Sun · 4–6pm**; What's On listing validDays Wed–Sun, start 17:00, time label "Wed–Thu · 5–6pm · Fri–Sun · 4–6pm" (the card and the listing disagree on Tuesday) |
| Prices | not on website | Margaritas 12 · Beer 8 · Wine 8 · Spritz 12 · four snacks 12/12/14/5 each | — | same as the card |

**Decision needed:** Is Tuesday a happy-hour day? Pick one line for both the card and the listing.

## 2. Alma Avalon · Bottomless lunch — days, time, drinks

| | Website today | Design folder (card 18 Oct 2025, byte-identical to the website PDF) | Jun 2026 / Jan 2026 What's On sheets | Set-menu pack (5 Aug 2026, draft) | Functions menu (25 Jul 2026, live PDF) | Proposed V2 draft |
|---|---|---|---|---|---|---|
| Days / time | **Sat & Sun · 12–4pm** | not printed | Sat & Sun · **12–3pm** | Lunch only 12–4pm, up to 19 guests | Lunch 12–4pm, up to 19 guests | **Sat & Sun · 12–4pm** |
| Price | $99pp | 99 pp | — | 99 pp | 99 pp | 99 pp |
| Drinks included | — | **Classic, Watermelon and Jalapeño margaritas · Corona · house wines** | — | Classic and jalapeño margaritas · Prosecco · Corona · house Riesling and Pinot Noir | margaritas, Coronas and house wine | card's list (three margaritas, Corona, house wines) |
| Dishes | — | Guacamole · Prawn ceviche · Salmon sashimi taco · Halloumi · Chicken tinga empanada; then tacos (Beef birria, Barramundi, Pork belly, Zucchini); then Shoestring fries | — | Guacamole · Kingfish ceviche · Barramundi and Beef birria tacos · Churros | three-course shared | card's dishes |

**Decisions needed:** 12–3 or 12–4? Which drinks list is the offer (the three documents differ on Prosecco, watermelon margarita and which house wines)? Is the card's dish list current?

## 3. St Alma · Bottomless lunch — which card, days, drinks

| | Website today (serves the **8 Nov 2025** card) | Design folder (**15 Nov 2025** card, newest) | Set-menu pack | Functions menu | Proposed V2 draft |
|---|---|---|---|---|---|
| Days / time | **Fri–Sun · 12–4pm** (listing; not on the card) | not printed | Lunch only 12–4pm | Lunch 12–4pm | **Fri–Sun · 12–4pm** |
| Price | $99pp | 99 pp | 99 pp | 99 pp | 99 pp |
| Drinks included | four margaritas · R. Paulazzo Rosé · **Corona** | four margaritas · R. Paulazzo Rosé · **Balter Cerveza** | Classic and jalapeño margaritas · Prosecco · Corona · house Riesling and Pinot Noir | margaritas, Coronas and house wine | 15 Nov list (Balter Cerveza) |
| Main course line | "Roast chicken in adobo, sweet potato, coriander cashew salsa" | "Roast chicken, esquites, salsa macha" | Barramundi / Beef birria tacos | — | 15 Nov wording |
| Sitting line | "you are booked in for a 2 hour sitting" | "your booking is for a 2 hour sitting" | two hours, one drink at a time | — | 15 Nov wording |

**Decisions needed:** 8 Nov or 15 Nov card? Confirm Fri–Sun 12–4. Same drinks question as Avalon.

## 4. St Alma · Tuesday (Taco Tuesday) — prices and format

| Dish | Website (Sep 2026 à la carte, live) | Tuesday card (13 Jul 2026) | Proposed V2 draft |
|---|---|---|---|
| Guacamole | 17 | 16 | 16 |
| Kingfish ceviche | 33 | 32 | 32 |
| Chicken tinga empanadas | 22 | 21 | 21 |
| Grilled snapper | 40 | 39 | 39 |
| Agave beef short rib | 49 | 48 | 48 |
| Roasted cabbage | 33 | 32 | 32 |
| Polenta and Parmesan fries | 19 | 18 | 18 |
| Green leaf salad | 17 | 16 | 16 |
| Broccolini | 20 | 19 | 19 |
| Churros | 19 | 18 | 18 |
| Trust our chef | 49 / 79 / 45 | 49 / 79 / 45 + "Try them all" 20 | same as card |
| Tacos | 9 each, four kinds | $5 tacos (listing) · four kinds, names only | names only, priced in heading |

**Decisions needed:** Does the Tuesday sheet follow the Sep +$1 à la carte prices, or stay? Is Tuesday its own menu (proposed) or a derived variant of the à la carte with dishes hidden (plan §5.8)? Does Tuesday print as the A4 sheet (proposed) or an A5 card?

## 5. Alma Avalon · Lunch special — scope and days

| | Website today | Design folder (card 16 Jan 2026; `.indd` edited 6 Feb 2026, not re-exported) | Jan 2026 What's On page | 2025 St Alma sheet | Proposed V2 draft |
|---|---|---|---|---|---|
| Venue | not listed | Alma (Avalon) folder | Avalon | St Alma, Fridays | Alma Avalon only |
| Days / time | — | not printed | Saturday & Sunday · 12–3pm | Fridays 12–4pm | **left empty** |
| Price | — | 49 pp | 49 pp | — | 49 pp |
| Content | — | Classic or Sensible margarita · Prawn ceviche · shared main · shared side · add-ons (Guacamole 16, Chicken tinga empanadas 7 pp) | — | — | card's content |

**Decisions needed:** Avalon only? Which days? Does the Feb 2026 `.indd` hold a newer card that should be exported first?

## 6. Set menu packages (St Alma, group template) — approval

| | Website today | Design folder (`Set Menu Pack review.pdf`, 5 Aug 2026) | Earlier drafts (4 Aug) | Proposed V2 draft |
|---|---|---|---|---|
| Tiers | functions PDF carries only the summary tiers | **Grazing 49 · Feasting 79 · Bottomless 99** with full courses, N markers, "one drink at a time", whole-table clause | "Trust the chef" 79; Bottomless with short-rib menu | 5 Aug content, as draft (medium confidence) |

**Decision needed:** Is the 5 Aug "review" pack approved as the set-menu offer? If not, the draft is still useful to edit from, but must not be published.

## 7. Price notation on cards

| | A4 sheets (live) | Functions PDF (live) | Legacy A5 cards | Proposed |
|---|---|---|---|---|
| Style | `99 pp`, bare numbers | `$125 pp`, `+$12 pp`, `$7,000` | `$99pp` | **`99 pp`** everywhere; minimum spends print as `7000` |

**Decision needed:** keep the bare house style on cards and functions, or `$`?

## 8. A5 card look

| | Legacy St Alma card | Legacy Avalon card | Proposed |
|---|---|---|---|
| Ink | burgundy, script sign-off | forest ink, fish illustration, "Alma loves you x" | **forest ink on white, no sign-off or illustration**; group wordmark on functions, venue mark on private events |
| Orientation | portrait | portrait | St Alma **portrait** (binder is landscape) |
| Footer | "Merchant fees apply to all card transcations" (sic) | same | **dropped** |

**Decision needed:** accept the redesign defaults, or ask for terracotta accent / landscape St Alma / the sign-off back.

## 9. Taco Wednesday (Avalon) and Taco Tuesday (St Alma) listings

| | Website today | Design folder | Proposed |
|---|---|---|---|
| Taco Wednesday | "$5 tacos and $15 margaritas all night long, every Wednesday" | no card exists | listing only, no PDF |
| Taco Tuesday | "$5 tacos and midweek margaritas every Tuesday night" | the A4 Tuesday sheet (item 4) | listing links no PDF unless Tuesday becomes a card |

**Decision needed:** should either get a printed card (then it is made in the editor after import)?

## 10. Who publishes

| | Today (API rule) | Proposed (PR `feat/menus-venue-scoped-publishing`) |
|---|---|---|
| Publishers | admins, anyone with a manager-like title, anyone titled head chef — any venue | admins; a Menus grant at MANAGER level or with "Publish menus" ticked, limited to the ticked venue(s) |
| Chefs | head chefs publish | Caio (both venues), Citlally (St Alma), Rodrigo (Avalon): draft only, prices included; a venue manager publishes |
| Venue managers | both venues | Dirk → St Alma, Trystan → Alma Avalon |

**Decision needed:** confirm the five grants as listed (the prompt's spec), including that Caio drafts for both venues.
