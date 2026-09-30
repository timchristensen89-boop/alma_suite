// The request path as it may appear in a log line or a monitoring tag.
//
// Some staff routes carry a gift card code in the path itself
// (/api/invoices/gift-cards/:code). The code is the card's bearer secret —
// the public print, QR and wallet endpoints take it as proof of ownership —
// so a failed request must not write it to the container log or Sentry.
// Pure, so it is tested on its own in log-path.test.ts.

import { maskGiftCardCode } from './gift-card-documents.js';

const INVOICE_CARD_PATH = /(\/api\/invoices\/gift-cards\/)([^/?#]+)/g;

/** Any invoice gift card code in `text` cut to "***" and its last four. */
export function maskCardCodesInPath(text: string): string {
  return text.replace(INVOICE_CARD_PATH, (_match, prefix: string, code: string) => `${prefix}${maskGiftCardCode(code)}`);
}

/** `req.originalUrl` without its query string, card codes masked. */
export function loggablePath(originalUrl: string): string {
  return maskCardCodesInPath(originalUrl.split('?')[0] ?? originalUrl);
}
