# Invoices & receipts

*Runbook. Written September 2026.*

> Encoded in the suite. The GST rules below are enforced by
> `packages/shared/src/financial-documents.ts` (tested in
> `apps/api/src/lib/financial-documents.test.ts`); issuing, numbering, Stripe
> and email live in `apps/api/src/services/financial-document.service.ts`. The
> screen is Gift Cards → **Invoices**, plus the **Receipt** row on a card.
> Change the rules here and in that file together, or they drift.

---

## What it does

Alma issues its own accounting document for money it takes for a gift card:

| Document | When | GST |
|---|---|---|
| **Tax invoice / Receipt** | A sale with something taxable on it, by a GST-registered company (an online card with the service fee) | Shown per line |
| **Receipt** | A sale with nothing taxable on it (a counter sale at face value, a GiftUp card, a promo that brings the price under face value) | $0.00 |
| **Adjustment note / Credit note** | Money given back against a tax invoice | Reverses GST |
| **Credit note** | Money given back against a receipt | None to reverse |

Stripe stays the truth about the *payment* — that it happened, how much, when,
on which card. Alma owns the *document*: its number, which company issued it,
and the GST treatment of every line. A document names the actual legal
supplier (legal name and ABN), never "ALMA Group".

Every document is a snapshot. The company's details and each line are stored
on it when it is issued, and the PDF is re-rendered from that row on demand,
so it always says the same thing. After issue only two things change: the
email record (sent when, to whom, any error) and voiding.

Numbers are gap-free per series: `ALMA-INV-000184` for sales and
`ALMA-CN-000012` for credits (the prefix is the company's; companies that share
a prefix share a series). A number is taken inside the same database
transaction that creates the document, so a failed issue hands its number
back.

## Setting it up

Nothing is issued until this is done. Until then every issue button answers
with what is missing, and the automatic hook quietly does nothing.

Only the owner (`GIFT_CARD_OWNER_EMAIL`, default `tim@almagroup.com.au` — the
same person who manages gift card promo codes) can change settings, add
companies, raise credit notes and void documents. Managers with Gift Cards
access can view, issue and email.

1. **Add the companies.** Invoices → Companies → add each legal entity that
   sells gift cards: legal name, trading name, ABN (checked against the ABR
   checksum), whether it is registered for GST, address and contact details,
   and the document prefix (`ALMA` unless you want separate series).
2. **Choose the gift card issuer.** Invoices → Settings → *Gift card issuing
   company*. Group cards redeem at either venue, so this is a decision rather
   than something the suite can work out: pick the company that is the
   merchant of record for the Stripe account the cards are sold through.
3. **Turn on automatic issuing** (optional). *Issue a receipt or tax invoice as
   soon as Stripe confirms payment.* The moment it was last switched on is
   recorded, and only cards paid from then on are covered — switching it on,
   or back on after a pause, never sends receipts for the sales made while it
   was off. *Email it to the purchaser* is a separate switch (on by default).
4. **Footer note** (optional) is printed on every new document, e.g. a
   standing line about the gift card terms.

Anything paid before automatic issuing was switched on can still be issued by
hand from the card's **Receipt** row, with the buyer's organisation, ABN and
purchase order if they asked for them.

## The GST treatment, with worked examples

A gift card is a **face value voucher** (GST Act, Division 100). GST is not
payable when it is sold; it is accounted for when the voucher is redeemed for
a taxable supply (GSTR 2003/5, on vouchers).

The **3.5% online service fee** is a card surcharge. A surcharge is part of
the consideration for the supply it is charged on (GSTR 2014/2, on card
surcharges) — here, the voucher. **s100-5(2)** makes the supply of a voucher
taxable to the extent the consideration paid **exceeds** its face value. So
the fee is taxable only to the extent the total paid is more than the card is
worth.

| Sale | Lines | Document | GST |
|---|---|---|---|
| $100 card bought online for **$103.50** | Card $100.00 no GST · Service fee $3.50 taxable | Tax invoice | **$0.32** (3.50 ÷ 11) |
| $100 card sold at the counter for **$100** (cash, EFTPOS, card) | Card $100.00 no GST | Receipt | $0.00 |
| $100 GiftUp card (imported, paid $100) | Card $100.00 no GST | Receipt | $0.00 |
| $100 card with a $10 promo, paid **$93.15** ($90 + 3.5%) | Card $100.00 · Promo −$10.00 · Fee $3.15, all no GST | Receipt | $0.00 — nothing paid above face value |
| Any sale by a company **not registered for GST** | Every line no GST | Receipt | $0.00 — it makes no taxable supplies |

**Refunds.** A credit note splits the refund between the taxable and
non-taxable parts of what is left, in proportion; the note that takes the
remainder takes exactly the remainder, so the GST reverses to the cent. On the
$103.50 tax invoice: a $50.00 refund credits $0.16 GST (the GST still owed on
what is left decides it, so no cent is ever stranded); a second refund of the
remaining $53.50 credits the other $0.16 — $0.32 in total. The split is
printed on the note so the accountant can check it, or reallocate it if a
refund was specifically of the fee.

**What the ATO needs on a tax invoice** (all printed): that it is intended to
be a tax invoice; the seller's identity and ABN; the date of issue; what was
sold, including the extent to which each sale is taxable; and the GST amount.
For a tax invoice of **$1,000 or more** the buyer's identity or ABN is also
required — enter the organisation (and its ABN) when issuing by hand. A
registered buyer who asks for a tax invoice must be given one within 28 days.
A reduction in GST after a tax invoice is documented with an
**adjustment note**, which is what a credit against a tax invoice is issued as.

Sources: *A New Tax System (Goods and Services Tax) Act 1999* Division 100
(s100-5) and Division 29 (adjustment notes, s29-75); GSTR 2003/5 (vouchers);
GSTR 2014/2 (card surcharges); the ATO's *Tax invoices* guidance on
ato.gov.au.

## Stripe Dashboard

The gift card webhook endpoint already exists
(`https://<giftcards-domain>/api/gift-cards/webhook`). **Add three events to
it** so a refund made in the Stripe Dashboard becomes a credit note:

```text
charge.refunded
refund.created
refund.updated
```

The full list the endpoint should be subscribed to is in `DEPLOYMENT.md`.

One refund sends all three; the handler looks at every refund on the payment
and credits the ones that have no live note yet, keyed on the Stripe refund id
(`re_…`), so repeats and replays do nothing — and neither does a refund that
was already credited by hand with its refund id. A refund larger than what is
left to credit is logged and skipped rather than failed — a failure would make
Stripe retry for days a request that can never succeed. If Stripe later
reports a credited refund as failed, the note stays and a warning is logged;
void it by hand if the money did not go back.

The same check runs once, right after a Stripe-paid card's sale document is
issued: a refund made before the document existed — before it was issued at
all, or while the card's previous document was void — is credited against the
new document straight away. It is a single short attempt; if Stripe does not
answer, the next refund event for that payment catches up.

## Scheduler

Add one line to the scheduler that already calls `/api/integration-jobs/*`
with the scheduler secret (the VPS crontab). Hourly is plenty:

```bash
curl -fsS -X POST -H "Authorization: Bearer $INTEGRATION_SCHEDULER_SECRET" \
  https://<api-host>/api/integration-jobs/invoices/catch-up
```

It issues for Stripe-paid cards the automatic hook missed (a webhook that
never arrived, an outage mid-issue) — only cards paid since automatic issuing
was switched on, at most 100 a run, oldest first — and emails them if
automatic email is on. It never reissues for a card whose document was
voided: a void is a person's decision. It returns
`{ eligible, issued, failed, skippedReason, generatedAt }`; `skippedReason`
says why it did nothing (automatic issuing off, no issuer chosen).

## Day to day

- **Invoices** lists every document with search, type and date filters and a
  net total (sales minus credits, void excluded). Open one to see its lines,
  view the PDF, email it, raise a credit note or void it.
- **Email** sends the PDF from the gift card sender (`GIFTCARD_FROM`) to the
  customer, or to any address entered. Failures are recorded on the document.
- **Void** is for a document that should not exist (wrong company, wrong
  buyer). It cannot be undone. A sale document with live credit notes must
  have them voided first. Voiding a card's sale document frees the card to
  have a corrected one issued by hand.
- **Credit note** records money given back. It does not move money and does
  not cancel the card — refund in Stripe (or at the counter) and cancel the
  card as you do today. A Stripe refund is normally credited by the webhook
  without anyone touching it. To credit one by hand, choose refund method
  Stripe and paste the **Stripe refund id** (`re_…`, on the refund in the
  Stripe Dashboard); it is required. When Stripe is configured the suite checks
  that it is a succeeded refund of this sale's payment and that the credit is
  no more than the refund. The refund id is the same key the webhook credits
  on, so the webhook never raises a second note for it, and a refund already
  credited is refused with the number of the note that covers it.
- **Voiding a Stripe credit note** releases its refund: the refund id moves
  from the note to its payment reference, and the refund can be credited
  again — by the next refund event for that payment, by issuing a corrected
  sale document, or by hand with the same refund id (to credit a different
  amount, say).
- **Issuing by hand for a card that already has a live document** is refused
  with that document's number. Email it from its row, or void it and issue
  again to change the details.

## Known limits

- **Refunds are not made from Alma.** Refund in the Stripe Dashboard; the
  webhook raises the credit note. Counter refunds are credited by hand.
- **Partial credits split in proportion** between taxable and non-taxable. A
  refund that is specifically of the fee needs the accountant to reallocate.
- **Counter and POS sales are not issued automatically.** They already get a
  POS receipt; issue a tax invoice by hand if the buyer asks for one.
- **No Xero push yet.** Documents are Alma's record; the Stripe payouts still
  reach Xero as they do today.
- Gift cards are the only source today. The engine is generic, so other sales
  can be added without changing how documents are numbered or stored.
