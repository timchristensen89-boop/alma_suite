# Alma Group — Donation & Sponsorship Policy

*Internal. Written August 2026.*

> Encoded in the suite. The rules below are enforced by
> `packages/shared/src/donations.ts`; the screen is Gift Cards → **Donations**.
> Change the policy here and in that file together, or they drift.

---

## The policy in five lines

1. **Vouchers, not cash.** Cash donations are off the table entirely.
2. **Twelve per year, maximum.** Roughly one a month across all venues.
3. **$50–$200 face value each.** No exceptions upward without a real reason. (Floor lowered from $150 in September 2026.)
4. **12-month expiry, dine-in only, not valid Fri/Sat night.** Protects the busy services.
5. **Once the twelve are gone, they're gone.** The answer is no until the calendar year turns.

Track them in one place. That place is now the donation register in the suite.

---

## Why vouchers and not cash

| | $200 cash | $200 voucher |
|---|---:|---:|
| Cost to you if used | $200 | ~$66 (food cost ~33%) |
| Cost if never redeemed | $200 | $0 |
| Expected cost at ~70% redemption | $200 | **~$46** |
| Brings someone into the venue | No | Yes |
| Guest usually spends above face value | n/a | Yes |

**Twelve vouchers at $200 = $2,400 of apparent generosity for somewhere around $500–800 of actual cost.**

Redemption rates on donated and prize vouchers vary a lot and are worth tracking
rather than assuming. The register measures the real rate and shows it beside
the 70% assumption, so this table can be checked rather than believed.

---

## What gets a yes

Score each request against these. Three or more, it's a candidate:

- **Local.** Their supporters are already your catchment.
- **Brings people in.** A voucher beats a hamper. The prize should walk through your door.
- **You get named.** Logo in the programme, mention from the stage, listing on the website. This is what makes it marketing rather than charity.
- **Existing relationship.** A repeat ask from someone who's supported you counts for more than a cold email.
- **DGR endorsed.** Check on [ABN Lookup](https://abr.business.gov.au/Tools/DgrListing). Not a dealbreaker, but it affects the tax treatment.

## What gets a no

- Cash requests, always.
- Anything where the prize leaves the venue and the winner never visits.
- Cold approaches with no local connection.
- Requests that arrive after the twelve are used.
- Anything asking for a Friday or Saturday night booking as the prize.

---

## Tax note

Raise this with your accountant, don't act on it from here.

The personal DGR gift deduction **doesn't apply to gifts made in the course of
carrying on a business**. So the "donation" framing is the wrong one for you.

If you're named or listed in the fundraiser, the better characterisation is
likely **sponsorship** — a business expense with a marketing purpose. That's a
cleaner deduction and it's worth structuring the arrangement deliberately so it
fits: ask for the listing, keep the email confirming it, and file it with the
invoice. The register has a **Listing** column for exactly that.

A second point worth raising: a gift card *sold* to a consumer must carry at
least three years under the Australian Consumer Law, and every card the suite
sells does. A prize voucher given away at no cost sits inside a carve-out from
that minimum, which is the basis for the 12-month term here. Worth confirming
rather than assuming.

---

## How it works in the suite

| | |
|---|---|
| **Where** | Gift Cards → Donations, or the **Donation** tab on the counter iPad |
| **Who** | Any manager. Every voucher records who approved it. |
| **The cap** | Held by a unique index on `(year, sequence)` in the database, so two managers issuing at once cannot both take the last one |
| **Money** | Issued as a comped card with no `paidAt`, so it never appears in takings or the purchases report |
| **Expiry** | 12 months from issue, not the 3 years a sold card carries |
| **Blackout** | The counter warns — loudly — when a donation voucher is presented on a Friday or Saturday evening. It warns; it does not block. |

---

## Template — the yes

> Hi [Name],
>
> Appreciate you thinking of us, and [cause] sounds like a good one.
>
> We'd be glad to put in a $200 St Alma voucher for the raffle. It's valid for 12 months, dine-in, just not Friday or Saturday nights as those services are already full.
>
> If you can list us in the programme that'd be great. Let me know where to send it and I'll get it out to you this week.
>
> Thanks,
>
> Tim Christensen
> DIRECTOR
> 0430 058 410
> tim@almagroup.com.au

---

## Template — the no

> Hi [Name],
>
> Appreciate you thinking of us, and I'm sorry to be coming back with a no on this one.
>
> We set aside a fixed number of donations each year and we've used them up for [year]. I'd rather tell you straight than leave you waiting on a maybe.
>
> Do get in touch early next year and I'll see what we can do.
>
> Thanks,
>
> Tim Christensen
> DIRECTOR
> 0430 058 410
> tim@almagroup.com.au

---

## Template — the no, when you want to leave the door open

> Hi [Name],
>
> Appreciate you thinking of us.
>
> We're fully committed on donations for this year, so I can't help with the raffle. What I can do is note you down for next year's round, and if something frees up before then I'll come back to you.
>
> Thanks,
>
> Tim Christensen
> DIRECTOR
> 0430 058 410
> tim@almagroup.com.au

---

**The point of writing this down:** so that each request is a lookup, not a
decision. The cost of these asks was never really the vouchers.
