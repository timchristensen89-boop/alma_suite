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

## Deliberately not in v1

Corporate login or portal, invoice/PO purchasing and credit terms, tax
invoice issuing for corporate orders, GST decisions, issuing entity, Xero
liability mapping, CRM / API integrations, physical fulfilment, white label,
multi-level approvals, SSO.
