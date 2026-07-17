/**
 * Environment for the Workforce (staff) API.
 *
 * Mirrors stock-api's env layout so the servers share a mental model, but uses
 * its own port (3020) and cookie name so all apps can run side by side locally.
 *
 * This is the destination service for the workforce engine extraction
 * (rostering, clock, timesheets, tips, pay, leave, forecasting). It will read
 * person identity from the suite's People API rather than owning StaffProfile.
 */

const defaultSessionSecret =
  process.env.NODE_ENV === 'production'
    ? ''
    : 'alma-staff-local-development-session-secret';

const sessionSecret =
  process.env.STAFF_JWT_SECRET ??
  process.env.STAFF_SESSION_SECRET ??
  process.env.JWT_SECRET ??
  defaultSessionSecret;

const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret) {
  throw new Error('STAFF_JWT_SECRET, STAFF_SESSION_SECRET, or JWT_SECRET is required in production');
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

const localCorsOrigins = parseCorsOrigins(
  'http://localhost:5173,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5175'
);

const configuredCorsOrigins = unique([
  ...parseCorsOrigins(process.env.STAFF_CORS_ORIGIN),
  ...parseCorsOrigins(process.env.STAFF_FRONTEND_URL),
  ...parseCorsOrigins(process.env.STAFF_WEB_URL),
  ...parseCorsOrigins(process.env.COMPLIANCE_WEB_URL)
]);

if (isProduction) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required in production');
  }
  if (configuredCorsOrigins.length === 0) {
    throw new Error(
      'At least one production frontend origin is required via STAFF_CORS_ORIGIN, STAFF_FRONTEND_URL, STAFF_WEB_URL, or COMPLIANCE_WEB_URL'
    );
  }
  const localOrigin = configuredCorsOrigins.find(isLocalHttpUrl);
  if (localOrigin) {
    throw new Error(`Production CORS origin must not be localhost: ${localOrigin}`);
  }
}

export const env = {
  port: Number(process.env.PORT ?? process.env.STAFF_API_PORT ?? 3020),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin:
    isProduction
      ? configuredCorsOrigins
      : configuredCorsOrigins.length > 0
        ? configuredCorsOrigins
        : localCorsOrigins,
  sessionSecret,
  suiteAuthSecret: process.env.SUITE_AUTH_SECRET ?? sessionSecret,
  /** Base URL of the suite API that owns person identity (People API). */
  peopleApiUrl: process.env.PEOPLE_API_URL ?? process.env.API_URL ?? 'http://localhost:3018',
  isProduction,
  sessionCookieName: 'alma.staff.sid',
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000
};
