const defaultSessionSecret =
  process.env.NODE_ENV === 'production'
    ? // In production we refuse to boot without an explicit secret.
      ''
    : // Local development: stable across restarts so beta testers do not get
      // randomly logged out when the watcher reloads.
      'alma-suite-local-development-session-secret';

const sessionSecret = process.env.JWT_SECRET ?? process.env.SESSION_SECRET ?? defaultSessionSecret;
const isProduction = process.env.NODE_ENV === 'production';

if (!sessionSecret) {
  throw new Error('JWT_SECRET or SESSION_SECRET is required in production');
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
  'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178,http://localhost:5179,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5176,http://127.0.0.1:5177,http://127.0.0.1:5178,http://127.0.0.1:5179'
);

const configuredCorsOrigins = unique([
  ...parseCorsOrigins(process.env.CORS_ORIGIN),
  ...parseCorsOrigins(process.env.FRONTEND_URL),
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
  if (!process.env.CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN is required in production');
  }
  if (configuredCorsOrigins.length === 0) {
    throw new Error(
      'At least one production frontend origin is required via CORS_ORIGIN, FRONTEND_URL, COMPLIANCE_WEB_URL, STOCK_WEB_URL, STAFF_WEB_URL, or REPORTS_WEB_URL'
    );
  }
  const localOrigin = configuredCorsOrigins.find(isLocalHttpUrl);
  if (localOrigin) {
    throw new Error(`Production CORS origin must not be localhost: ${localOrigin}`);
  }
}

export const env = {
  port: Number(process.env.PORT ?? process.env.API_PORT ?? 3018),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: isProduction ? configuredCorsOrigins : configuredCorsOrigins.length > 0 ? configuredCorsOrigins : localCorsOrigins,
  sessionSecret,
  isProduction,
  sessionCookieName: 'alma.sid',
  sessionMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  websiteMenu: {
    githubToken: process.env.WEBSITE_MENU_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '',
    repoOwner: process.env.WEBSITE_MENU_REPO_OWNER ?? 'timchristensen89-boop',
    repoName: process.env.WEBSITE_MENU_REPO_NAME ?? 'alma-web-platform',
    branch: process.env.WEBSITE_MENU_BRANCH ?? 'main',
    filePath: process.env.WEBSITE_MENU_FILE_PATH ?? 'apps/web/data/menus.ts',
    committerName: process.env.WEBSITE_MENU_COMMITTER_NAME ?? 'ALMA Reports',
    committerEmail: process.env.WEBSITE_MENU_COMMITTER_EMAIL ?? 'reports@almagroup.com.au'
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    apiVersion: '2026-04-22.dahlia' as const
  },
  giftCards: {
    webUrl: process.env.GIFTCARDS_WEB_URL ?? process.env.GIFT_CARDS_WEB_URL ?? 'http://localhost:5179'
  }
};
