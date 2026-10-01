/**
 * What one POS trading day becomes in Xero: the line items of the daily
 * sales invoice (integration.service.ts pushPosDayToXero).
 *
 * Pure so the classification is tested directly.
 *
 * Gift card sales are not sales. Selling a voucher takes money the venue owes
 * back in food and drink later: a liability, with no GST until the card is
 * redeemed (pos.service.ts treats it as a face value voucher everywhere else —
 * no GST at sale, excluded from revenue actuals and reports). The daily push
 * used to bucket every line by recipe, and a gift card line has no recipe and
 * no course, so it fell into FOOD and posted to the sales account with
 * TaxType OUTPUT: a $100 voucher went in as $90.91 food plus $9.09 GST, and
 * the meal it later paid for was taxed again when it was redeemed.
 */

export type PosSalesBucket = 'FOOD' | 'BEVERAGE' | 'GIFT_CARD';

export type PosLineLike = {
  totalCents: number;
  isGiftCard?: boolean | null;
  course?: string | null;
};

/**
 * Which bucket a POS line belongs to. `recipeBucket` is the recipe's
 * kitchen/bar bucket when the line has a recipe (pos.service kindBucket).
 */
export function posLineBucket(line: PosLineLike, recipeBucket: 'FOOD' | 'BEVERAGE' | null): PosSalesBucket {
  if (line.isGiftCard) return 'GIFT_CARD';
  if (recipeBucket) return recipeBucket;
  return line.course === 'Drinks' ? 'BEVERAGE' : 'FOOD';
}

export type PosXeroDayFigures = {
  foodIncCents: number;
  beverageIncCents: number;
  giftCardIncCents: number;
  surchargeIncCents: number;
  discountCents: number;
  refundCents: number;
  tipCents: number;
};

export type PosXeroAccounts = {
  /** Sales account; '200' (Sales) when the venue has not set one. */
  sales: string;
  /** Blank = card tips stay off the invoice. */
  tips: string;
  /**
   * The venue's gift card liability account. Blank = gift card sales stay OFF
   * the invoice and are reported as not posted: there is no safe default for
   * a liability account code, so none is invented.
   */
  giftCard: string;
};

export type XeroLineItem = {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  TaxType: string;
};

/** Xero's tax type for an amount kept out of the BAS entirely. */
export const XERO_BAS_EXCLUDED = 'BASEXCLUDED';

export function buildPosXeroLineItems(
  figures: PosXeroDayFigures,
  accounts: PosXeroAccounts,
  dateKey: string
): { lineItems: XeroLineItem[]; giftCardNotPostedCents: number } {
  // Xero takes dollars; every figure here is GST-exclusive except tips and
  // gift cards, which carry no GST.
  const exGst = (incCents: number) => Number(((incCents * 10) / 11 / 100).toFixed(2));
  const dollars = (cents: number) => Number((cents / 100).toFixed(2));
  const lineItems: XeroLineItem[] = [];
  const pushLine = (description: string, amount: number, accountCode: string, taxType: string) => {
    if (Math.abs(amount) < 0.005) return;
    lineItems.push({ Description: description, Quantity: 1, UnitAmount: amount, AccountCode: accountCode, TaxType: taxType });
  };

  pushLine(`Food sales — ${dateKey}`, exGst(figures.foodIncCents), accounts.sales, 'OUTPUT');
  pushLine(`Beverage sales — ${dateKey}`, exGst(figures.beverageIncCents), accounts.sales, 'OUTPUT');
  pushLine('Surcharge', exGst(figures.surchargeIncCents), accounts.sales, 'OUTPUT');
  pushLine('Discounts and comps', -exGst(figures.discountCents), accounts.sales, 'OUTPUT');
  pushLine('Refunds', -exGst(figures.refundCents), accounts.sales, 'OUTPUT');
  if (accounts.tips) pushLine('Card tips (payable to staff)', dollars(figures.tipCents), accounts.tips, 'NONE');

  let giftCardNotPostedCents = 0;
  if (figures.giftCardIncCents > 0) {
    if (accounts.giftCard) {
      // The whole amount, no GST: it is owed back until the card is redeemed.
      pushLine(`Gift cards sold (voucher liability) — ${dateKey}`, dollars(figures.giftCardIncCents), accounts.giftCard, XERO_BAS_EXCLUDED);
    } else {
      giftCardNotPostedCents = figures.giftCardIncCents;
    }
  }

  return { lineItems, giftCardNotPostedCents };
}
