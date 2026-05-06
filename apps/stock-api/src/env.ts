/**
 * Environment for the Stock API.
 *
 * Mirrors the compliance API layout so the two servers share a mental model,
 * but uses its own port (3019) and cookie name so the two apps can run side
 * by side on localhost without stepping on each other's sessions.
 */

const defaultSessionSecret =
  process.env.NODE_ENV === 'production'
    ? ''
    : 'alma-stock-local-development-session-secret';

const sessionSecret =
  process.env.STOCK_JWT_SECRET ??
  process.env.STOCK_SESSION_SECRET ??
  process.env.JWT_SECRET ??
  defaultSessionSecret;
const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret) {
  throw new Error('STOCK_JWT_SECRET, STOCK_SESSION_SECRET, or JWT_SECRET is required in production');
}

function parseCorsOrigins(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function isLocalHttpUrl(value: string) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
}

const localCorsOrigins = parseCorsOrigins('http://localhost:5174,http://localhost:5176,http://127.0.0.1:5174,http://127.0.0.1:5176');

const configuredCorsOrigins = unique([
  ...parseCorsOrigins(process.env.STOCK_CORS_ORIGIN),
  ...parseCorsOrigins(process.env.STOCK_FRONTEND_URL),
  ...parseCorsOrigins(process.env.COMPLIANCE_WEB_URL),
  ...parseCorsOrigins(process.env.STOCK_WEB_URL),
  ...parseCorsOrigins(process.env.STAFF_WEB_URL),
  ...parseCorsOrigins(process.env.REPORTS_WEB_URL),
  ...parseCorsOrigins(process.env.RESERVE_WEB_URL),
  ...parseCorsOrigins(process.env.MARKETING_WEB_URL),
  ...parseCorsOrigins(process.env.GIFTCARDS_WEB_URL),
  ...parseCorsOrigins(process.env.GIFT_CARDS_WEB_URL)
]);

if (isProduction) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  if (configuredCorsOrigins.length === 0) {
    throw new Error(
      'At least one production frontend origin is required via STOCK_CORS_ORIGIN, STOCK_FRONTEND_URL, COMPLIANCE_WEB_URL, STOCK_WEB_URL, STAFF_WEB_URL, REPORTS_WEB_URL, RESERVE_WEB_URL, MARKETING_WEB_URL, or GIFTCARDS_WEB_URL'
    );
  }
  const localOrigin = configuredCorsOrigins.find(isLocalHttpUrl);
  if (localOrigin) {
    throw new Error(`Production CORS origin must not be localhost: ${localOrigin}`);
  }
}

export const env = {
  port: Number(process.env.PORT ?? process.env.STOCK_API_PORT ?? 3019),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: isProduction ? configuredCorsOrigins : configuredCorsOrigins.length > 0 ? configuredCorsOrigins : localCorsOrigins,
  sessionSecret,
  suiteAuthSecret: process.env.SUITE_AUTH_SECRET ?? sessionSecret,
  isProduction,
  sessionCookieName: 'alma.stock.sid',
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000
};
