// Gift-card accounting for the Orders dashboard, pure so the header, the
// revenue tiles, the stat cards and the tests all read the SAME ledger.
// Covered by gift-card-ledger.test.ts.
//
// Background: the dashboard showed "$14,506 outstanding across 92 active
// cards" in its header and "$66,873.14 liability · 92 active cards" in its
// revenue tile. The header summed the 100 cards the API happens to list
// (newest first, filtered by the search box); the tile's dollar figure was a
// server aggregate over every card while its "92" came from that same capped
// list. "Redeemed this month $450" was summed in the browser over the capped
// list from the browser's month start; the venue split beside it ($610) was
// a server aggregate over every redemption from the server's (UTC) month
// start. Every figure here is over every card, on venue months, and says
// what it includes.

import { venueMonthBounds, venueMonthKey, shiftMonthKey } from '@alma/shared';

export type LedgerCardInput = {
  status: 'PENDING_PAYMENT' | 'ACTIVE' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED';
  testMode: boolean;
  initialValueCents: number;
  balanceCents: number;
  paidAt: Date | string | null;
  promoCodeSnapshot: string | null;
  saleChannel: string;
};

export type LedgerRedemptionInput = {
  status: 'COMPLETED' | 'VOIDED';
  amountCents: number;
  venue: string | null;
  redeemedAt: Date | string;
  cardTestMode: boolean;
};

export type GiftCardOrigin = 'GIFTUP_IMPORT' | 'PHYSICAL_COUNTER' | 'DONATION' | 'CAMPAIGN_REWARD' | 'ONLINE' | 'COUNTER' | 'OTHER';

export const UNALLOCATED_VENUE = 'Unallocated';

/** Where a card came from, read off the same markers purchaseReport uses. */
export function giftCardOrigin(card: Pick<LedgerCardInput, 'promoCodeSnapshot' | 'saleChannel'>): GiftCardOrigin {
  const snapshot = card.promoCodeSnapshot ?? '';
  if (snapshot === 'GIFTUP_IMPORT') return 'GIFTUP_IMPORT';
  if (snapshot === 'PHYSICAL_COUNTER') return 'PHYSICAL_COUNTER';
  if (snapshot === 'DONATION' || card.saleChannel === 'DONATION') return 'DONATION';
  if (snapshot.startsWith('CAMPAIGN_REWARD')) return 'CAMPAIGN_REWARD';
  if (card.saleChannel === 'ONLINE') return 'ONLINE';
  if (card.saleChannel === 'COUNTER') return 'COUNTER';
  return 'OTHER';
}

export type GiftCardLedger = {
  /** Venue month the "this month" figures cover, YYYY-MM. */
  month: string;
  /** Liability: remaining balance on ACTIVE, non-test cards. */
  activeCards: number;
  activeBalanceCents: number;
  /** Balance still on EXPIRED cards — kept on the card, NOT in the liability figure. */
  expiredCards: number;
  expiredRetainedCents: number;
  redeemedCards: number;
  /** Face value of every live (ACTIVE + REDEEMED) non-test card, whenever issued. */
  issuedValueCents: number;
  /** issued − outstanding: everything drawn down, including before the GiftUp import. */
  drawnDownCents: number;
  /** Σ COMPLETED redemptions recorded in Alma — the part of drawnDown with a row behind it. */
  redemptionsRecordedCents: number;
  /** drawnDown − recorded: drawdown with no redemption row (pre-import history, cancellations). */
  unrecordedDrawdownCents: number;
  /** Cards issued (paidAt) in the venue month, live statuses only. */
  issuedThisMonthCents: number;
  issuedThisMonthCards: number;
  issuedLastMonthCents: number;
  /** Σ COMPLETED redemptions with redeemedAt in the venue month — equals Σ redeemedByVenue[].monthCents. */
  redeemedThisMonthCents: number;
  redeemedLastMonthCents: number;
  redeemedByVenue: Array<{ venue: string; lifetimeCents: number; monthCents: number }>;
  /** Liability composition by where the card came from. */
  byOrigin: Array<{ origin: GiftCardOrigin; activeCards: number; activeBalanceCents: number; issuedValueCents: number }>;
  testCards: number;
};

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

export function buildGiftCardLedger(input: {
  cards: LedgerCardInput[];
  redemptions: LedgerRedemptionInput[];
  now?: Date;
}): GiftCardLedger {
  const now = input.now ?? new Date();
  const month = venueMonthKey(now);
  const thisMonth = venueMonthBounds(month)!;
  const lastMonth = venueMonthBounds(shiftMonthKey(month, -1)!)!;
  const inWindow = (at: Date, window: { gte: Date; lt: Date }) => at >= window.gte && at < window.lt;

  const ledger: GiftCardLedger = {
    month,
    activeCards: 0,
    activeBalanceCents: 0,
    expiredCards: 0,
    expiredRetainedCents: 0,
    redeemedCards: 0,
    issuedValueCents: 0,
    drawnDownCents: 0,
    redemptionsRecordedCents: 0,
    unrecordedDrawdownCents: 0,
    issuedThisMonthCents: 0,
    issuedThisMonthCards: 0,
    issuedLastMonthCents: 0,
    redeemedThisMonthCents: 0,
    redeemedLastMonthCents: 0,
    redeemedByVenue: [],
    byOrigin: [],
    testCards: 0
  };
  const origins = new Map<GiftCardOrigin, { activeCards: number; activeBalanceCents: number; issuedValueCents: number }>();
  let liveBalanceCents = 0;

  for (const card of input.cards) {
    if (card.testMode) {
      if (card.status === 'ACTIVE' || card.status === 'REDEEMED') ledger.testCards += 1;
      continue;
    }
    if (card.status === 'EXPIRED') {
      ledger.expiredCards += 1;
      ledger.expiredRetainedCents += card.balanceCents;
      continue;
    }
    if (card.status !== 'ACTIVE' && card.status !== 'REDEEMED') continue;

    const origin = giftCardOrigin(card);
    const bucket = origins.get(origin) ?? { activeCards: 0, activeBalanceCents: 0, issuedValueCents: 0 };
    bucket.issuedValueCents += card.initialValueCents;
    ledger.issuedValueCents += card.initialValueCents;
    liveBalanceCents += card.balanceCents;
    if (card.status === 'ACTIVE') {
      ledger.activeCards += 1;
      ledger.activeBalanceCents += card.balanceCents;
      bucket.activeCards += 1;
      bucket.activeBalanceCents += card.balanceCents;
    } else {
      ledger.redeemedCards += 1;
    }
    origins.set(origin, bucket);

    if (card.paidAt) {
      const paidAt = asDate(card.paidAt);
      if (inWindow(paidAt, thisMonth)) {
        ledger.issuedThisMonthCents += card.initialValueCents;
        ledger.issuedThisMonthCards += 1;
      } else if (inWindow(paidAt, lastMonth)) {
        ledger.issuedLastMonthCents += card.initialValueCents;
      }
    }
  }

  const byVenue = new Map<string, { lifetimeCents: number; monthCents: number }>();
  for (const redemption of input.redemptions) {
    if (redemption.status !== 'COMPLETED' || redemption.cardTestMode) continue;
    const venue = redemption.venue?.trim() || UNALLOCATED_VENUE;
    const row = byVenue.get(venue) ?? { lifetimeCents: 0, monthCents: 0 };
    row.lifetimeCents += redemption.amountCents;
    ledger.redemptionsRecordedCents += redemption.amountCents;
    const at = asDate(redemption.redeemedAt);
    if (inWindow(at, thisMonth)) {
      row.monthCents += redemption.amountCents;
      ledger.redeemedThisMonthCents += redemption.amountCents;
    } else if (inWindow(at, lastMonth)) {
      ledger.redeemedLastMonthCents += redemption.amountCents;
    }
    byVenue.set(venue, row);
  }

  ledger.drawnDownCents = Math.max(0, ledger.issuedValueCents - liveBalanceCents);
  ledger.unrecordedDrawdownCents = Math.max(0, ledger.drawnDownCents - ledger.redemptionsRecordedCents);
  ledger.redeemedByVenue = [...byVenue.entries()]
    .map(([venue, row]) => ({ venue, ...row }))
    .sort((a, b) => b.lifetimeCents - a.lifetimeCents);
  ledger.byOrigin = [...origins.entries()]
    .map(([origin, row]) => ({ origin, ...row }))
    .sort((a, b) => b.activeBalanceCents - a.activeBalanceCents);
  return ledger;
}
