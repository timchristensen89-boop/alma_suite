# Corporate gift cards (v1, staff-operated)

A company buys Alma gift cards in bulk. Staff run the whole thing from
ALMA Gift Cards → **Corporate**: create the account, place the order, take
payment, and hand the cards out to recipients as the company names them.
There is no corporate login in v1; the domain model is shaped so a portal can
be added later without touching orders or pools.

## What stays exactly as it was

- A corporate card **is** an ordinary `GiftCard`: cross-venue, same 3-year
  expiry, same redemption at the till, same balance ledger. Venue belongs to
  the redemption, never to the card. There is no venue choice on a corporate
  order.
- Consumer checkout, counter sales, GiftUp imports, donations, promo codes,
  the Stripe webhook for single cards, the scheduled-delivery drain and the
  lifecycle sweep are untouched. Every pre-existing card has `NULL` in the new
  columns and behaves as before.

## Lifecycle of an order

```
create ──► AWAITING_PAYMENT ──► PAID ──► ISSUED (pool of N UNALLOCATED cards)
                 │
                 └──► CANCELLED (owner, before issuance only)
```

1. **Create** (manager). Quantity × one face value. Price comes from the
   global quantity tiers (Admin setup → Corporate pricing) or the account's
   flat override. The terms in force are snapshotted on the order
   (`pricingSnapshot`, `discountBps`, `discountCents`); changing settings later
   never rewrites an order. Tiers apply **per order**, never lifetime spend.
   Face value is never altered: a $100 card is worth $100 whatever the
   discount.
2. **Pay.**
   - `STRIPE`: a hosted Checkout session for amount due + the same 3.5%
     card-processing fee the public shop charges. The webhook
     (`checkout.session.completed` with `metadata.corporateOrderId`) or the
     order page's poll settles it. Amount is verified against the order.
   - `MANUAL_OFFLINE`: the **owner** records the money as received (bank
     transfer, EFTPOS, cash, card at counter) with a reference and date.
   - `INVOICE`: refused at creation. Issuing entity, GST treatment of
     face-value vouchers and credit terms are open decisions; nothing is
     issued on credit until they are made.
3. **Issue.** Once, atomically: the order row is locked, the transition
   `AWAITING_PAYMENT → ISSUED` is conditional, and an existing pool is
   refused. N cards are created `ACTIVE`, `allocationStatus = UNALLOCATED`,
   `saleChannel = CORPORATE`, no recipient, no schedule, no Stripe session id
   (so the public session poll can never reach one). The order discount is
   split across the cards in whole cents (first cards carry the extra cent)
   so Σ `discountCents` equals the order's and the existing accounting treats
   them like any discounted card.

Cancelling after issuance is per card, through the ordinary gift-card
cancel, so each cancellation carries its own reason.

## Lifecycle of a pool card

```
UNALLOCATED ──allocate──► ALLOCATED ──(send now | drain when due)──► emailed
     │                        │
     │                        └──re-address (until emailed)──► ALLOCATED
     └── cancel (ordinary gift-card cancel)
```

An **unallocated** card is real outstanding liability (it is on the ledger
from issuance) but belongs to nobody yet, so:

- it is never emailed (`giftCardEmailRecipients` returns nobody; the drain
  query excludes it);
- it cannot be resent, printed, QR-coded or redeemed (all refuse);
- its code is masked in the staff pool table;
- it is unreachable through `/session/:id` (no session id).

**Allocation** fills in the card's own `recipientName`, `recipientEmail`,
`message` (falls back to the order's default), `scheduledDeliveryAt`,
`allocationReference`, `allocatedAt/By`. It is a conditional update on a card
that is still `UNALLOCATED`, so concurrent staff never get the same card. No
new card, no payment, no change to the balance. The ordinary voucher email
goes out now, **to the recipient only** (never the company contact), or
waits for the existing 10-minute drain if scheduled.

**Re-addressing** is allowed until the voucher has been emailed. After that
the recipient holds the code: cancel the card and allocate another.

**Resend** uses the existing resend path (recipient only for corporate cards).

## CSV upload

Columns: `firstName, lastName, email, message, scheduledDeliveryAt,
reference` (friendly header spellings accepted; a single `name` column works).
There is no value column. The whole file is validated first and every error
is returned at once; nothing is allocated unless every row is valid **and**
the pool covers every new row. Each row gets an `allocationKey` (a hash of
what the row says); the same file uploaded twice finds every row already
allocated and allocates nothing. Identical rows in one file are two cards.

## Permissions

| Action | Who |
| --- | --- |
| View accounts, orders, pools; create accounts; create orders at configured terms; allocate, re-address, resend; upload CSV; export | Manager (person, not a venue iPad) |
| Change an account's discount override / minimum; set global tiers; record an offline payment; cancel an unpaid order | Gift card owner (the promo-code gate) |
| Anything | Staff role, venue devices: refused |

## Reporting

Account: orders, cards purchased, face value, discount given, amount paid,
allocated / unallocated, emailed / failed, fully redeemed, redeemed value
(face − balance), outstanding balance, last order. Test-mode orders are
excluded. `GET /api/gift-cards/corporate/accounts/:id/export.csv` is a
per-card statement a manager can send the company.

## Settings

`AppSettings.giftCardSettings.corporate = { minimumQuantity, tiers: [{ minQuantity, discountBps }] }`.
Defaults: minimum 10, **no tiers** (no discount until configured). Hard cap
50% on any configured discount.

## Tests and the pre-deploy gate

Three layers, all in the repo:

- `apps/api/src/lib/corporate-gift-cards.test.ts` and `apps/api/src/routes/corporate-gift-cards.test.ts` — pure unit tests (pricing, CSV parsing/validation, lifecycle guards, route permission guards). Run by the ordinary `pnpm --filter @alma/api test`, no database.
- `apps/api/src/services/corporate-gift-card.integration.test.ts` — real-Postgres tests for pool allocation (conditional update, no double allocation, idempotent CSV re-upload, exhaustion), the drain and redemption filters (consumer `NULL` rows still eligible, `UNALLOCATED` never), resend rules, cancellation and manual payment. Opt-in through `ALMA_TEST_DATABASE_URL`; skipped otherwise.
- CI job `Postgres integration (corporate gift cards)` in `.github/workflows/ci.yml` — starts an empty `postgres:16`, applies the whole migration history with `prisma migrate deploy`, then runs the integration suite.

The workflow is `workflow_dispatch` only while the Actions minutes are exhausted, so it does **not** run automatically on a pull request. Until the `pull_request` trigger is restored, the gate before deploying anything that touches gift cards is manual and explicit:

```sh
# 1. Empty scratch database (any local Postgres 16 works).
createdb alma_corp_test
# 2. Full migration history on it.
DATABASE_URL=postgresql://localhost/alma_corp_test pnpm --filter @alma/db migrate:deploy
# 3. The integration suite against it.
ALMA_TEST_DATABASE_URL=postgresql://localhost/alma_corp_test \
  pnpm --filter @alma/api exec node --import tsx --test src/services/corporate-gift-card.integration.test.ts
# 4. Or trigger the CI job by hand: Actions → CI → Run workflow (branch).
```

"Tests passed locally" without step 2–3 (or the CI job) is not a pass for this feature.

## Deliberately not in v1

Corporate login or portal, invoice/PO purchasing and credit terms, tax
invoice issuing for corporate orders, GST decisions, issuing entity, Xero
liability mapping, CRM / API integrations, physical fulfilment, white label,
multi-level approvals, SSO.
