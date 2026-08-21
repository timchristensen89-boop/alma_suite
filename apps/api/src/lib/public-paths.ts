/**
 * The one place that decides which API paths answer without a session.
 *
 * `authMiddleware` consults this before anything else, so a route that is not
 * listed here 401s before its handler ever runs — however open the handler
 * itself looks. If you add an endpoint that has to work for a caller who
 * cannot sign in, it needs an entry here as well as the route.
 *
 * Split out from auth-middleware so it can be tested on its own, without
 * standing up prisma and the session layer to ask a question about a string.
 */
// Publicly accessible paths — no session required.
// Every API endpoint not listed here requires a valid session cookie.
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/handoff/consume',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/auth/password-reset/request',
  '/api/auth/password-reset/complete',
  '/api/gift-cards/checkout',
  '/api/gift-cards/public/config',
  '/api/gift-cards/public/orders',
  '/api/gift-cards/settings/public',
  '/api/gift-cards/promo/quote',
  '/api/device/home-summary',
  '/api/device/pin-staff',
  '/api/device/staff-pin-login',
  '/api/integrations/square/callback',
  '/api/integrations/xero/callback',
  '/api/integrations/deputy/callback',
  '/api/integrations/meta/callback'
]);

const PUBLIC_PREFIXES = [
  // Guest QR table ordering — anonymous by design; the signed table token in
  // the query/body is the auth, and the service throttles per IP.
  '/api/qr/',
  '/api/pos/print-poll/',
  '/api/pos/print-stations',
  '/api/gift-cards/session/',
  '/api/gift-cards/print/',
  '/api/gift-cards/qr/',
  // Customer-designed card artwork, addressed by the (secret) card code —
  // same trust model as /qr/ and /print/ above.
  '/api/gift-cards/artwork/',
  '/api/gift-cards/wallet/apple/',
  '/api/gift-cards/wallet/google/',
  '/api/staff/invites/by-token/',
  '/api/reserve/public-widget/',
  '/api/reserve/public/',
  // Gift card artwork for the public buy page. Read-only image bytes the venue
  // chose to publish, and the buy page is unauthenticated by definition — the
  // whole point is that a stranger can use it. The service only ever serves
  // the two known settings image fields, never an arbitrary key.
  '/api/gift-cards/assets/',
  '/api/public/venue-snapshot',
  // The unsubscribe link in marketing emails — a guest holding the link must
  // be able to opt out with no account. The contact/guest cuid in the URL is
  // the secret, matching the gift card code trust model above.
  '/api/marketing/public/'
];

// Same trust model as the prefixes above, but written as an exact shape so a
// route added alongside one of these later doesn't quietly inherit public
// access.
const PUBLIC_PATTERNS = [
  // A staff member's roster calendar feed. Calendar.app and Google Calendar
  // fetch this on a schedule with no cookie and no way to sign in, so the long
  // random token in the URL is the auth — the same deal as the staff invite
  // token and the gift card code. It's rotatable from the staff app, and an
  // unknown token gets a flat 404, not a hint.
  /^\/api\/staff\/calendar\/[^/]+\.ics$/
];

export function isPublic(path: string) {
  if (PUBLIC_PATHS.has(path)) return true;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return PUBLIC_PATTERNS.some((pattern) => pattern.test(path));
}
