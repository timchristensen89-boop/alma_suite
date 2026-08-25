/**
 * The loyalty programme's arithmetic, pure and in one place.
 *
 * Money → points and points → money are the two conversions that must never
 * disagree between the earn path, the redeem path and the reports. Everything
 * here is integer cents and whole points; rounding always favours the house
 * on earn (floor) and the guest on what their points are worth (exact), so
 * the liability report never understates what is owed.
 */

export type LoyaltySettings = {
  active: boolean;
  /** Points earned per whole dollar of eligible spend. */
  pointsPerDollar: number;
  /** What one point is worth at the till, in cents. */
  pointValueCents: number;
  /** Smallest redemption, in points — stops 3-cent redemptions clogging bills. */
  minRedeemPoints: number;
};

export const LOYALTY_DEFAULTS: LoyaltySettings = {
  active: false,
  pointsPerDollar: 1,
  pointValueCents: 5,
  minRedeemPoints: 200
};

export function parseLoyaltySettings(raw: unknown): LoyaltySettings {
  const value = (raw ?? {}) as Record<string, unknown>;
  const num = (input: unknown, fallback: number, min: number) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed >= min ? Math.round(parsed) : fallback;
  };
  return {
    active: value.active === true,
    pointsPerDollar: num(value.pointsPerDollar, LOYALTY_DEFAULTS.pointsPerDollar, 1),
    pointValueCents: num(value.pointValueCents, LOYALTY_DEFAULTS.pointValueCents, 1),
    minRedeemPoints: num(value.minRedeemPoints, LOYALTY_DEFAULTS.minRedeemPoints, 0)
  };
}

/**
 * What part of a bill earns points: the order total minus gift-card top-up
 * lines (buying a voucher is not consumption — it earns when it is spent)
 * and minus whatever part was paid with points (money that was never money).
 * Tips never enter — they are the staff's, not revenue.
 */
export function loyaltyEarnBaseCents(input: {
  totalCents: number;
  giftCardLineCents: number;
  loyaltyPaidCents: number;
}): number {
  return Math.max(0, input.totalCents - input.giftCardLineCents - input.loyaltyPaidCents);
}

export function pointsEarned(earnBaseCents: number, settings: LoyaltySettings): number {
  return Math.floor(earnBaseCents / 100) * settings.pointsPerDollar;
}

export function pointsNeededFor(amountCents: number, settings: LoyaltySettings): number {
  return Math.ceil(amountCents / settings.pointValueCents);
}

export function creditCentsFor(points: number, settings: LoyaltySettings): number {
  return Math.max(0, points) * settings.pointValueCents;
}
