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
  if (configuredCorsOrigins.length === 0) {
    throw new Error(
      'At least one production frontend origin is required via CORS_ORIGIN, FRONTEND_URL, COMPLIANCE_WEB_URL, STOCK_WEB_URL, STAFF_WEB_URL, REPORTS_WEB_URL, RESERVE_WEB_URL, MARKETING_WEB_URL, or GIFTCARDS_WEB_URL'
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
  publicApiUrl: process.env.API_PUBLIC_URL ?? process.env.API_URL ?? `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 3018}`,
  corsOrigin: isProduction ? configuredCorsOrigins : configuredCorsOrigins.length > 0 ? configuredCorsOrigins : localCorsOrigins,
  sessionSecret,
  suiteAuthSecret: process.env.SUITE_AUTH_SECRET ?? sessionSecret,
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
    context: process.env.STRIPE_CONTEXT ?? process.env.STRIPE_ACCOUNT_ID ?? '',
    apiVersion: '2026-04-22.dahlia' as const
  },
  integrations: {
    tokenEncryptionKey: process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ?? '',
    allowOAuthConnections: process.env.INTEGRATION_OAUTH_CONNECTIONS_ENABLED === 'true',
    square: {
      applicationId: process.env.SQUARE_APPLICATION_ID ?? '',
      applicationSecret: process.env.SQUARE_APPLICATION_SECRET ?? '',
      environment: (process.env.SQUARE_ENVIRONMENT ?? 'sandbox').toLowerCase(),
      redirectUrl: process.env.SQUARE_REDIRECT_URL ?? `${process.env.API_PUBLIC_URL ?? process.env.API_URL ?? `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 3018}`}/api/integrations/square/callback`,
      webhookSignatureKey: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY ?? '',
      webhookUrl: process.env.SQUARE_WEBHOOK_URL ?? process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ?? `${process.env.API_PUBLIC_URL ?? process.env.API_URL ?? `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 3018}`}/webhooks/square`
    },
    xero: {
      clientId: process.env.XERO_CLIENT_ID ?? '',
      clientSecret: process.env.XERO_CLIENT_SECRET ?? '',
      redirectUrl: process.env.XERO_REDIRECT_URL ?? `${process.env.API_PUBLIC_URL ?? process.env.API_URL ?? `http://localhost:${process.env.PORT ?? process.env.API_PORT ?? 3018}`}/api/integrations/xero/callback`,
      webhookKey: process.env.XERO_WEBHOOK_KEY ?? ''
    }
  },
  giftCards: {
    webUrl: process.env.GIFTCARDS_WEB_URL ?? process.env.GIFT_CARDS_WEB_URL ?? 'http://localhost:5179',
    appleWallet: {
      passTypeIdentifier: process.env.APPLE_WALLET_PASS_TYPE_IDENTIFIER ?? '',
      teamIdentifier: process.env.APPLE_WALLET_TEAM_IDENTIFIER ?? '',
      organizationName: process.env.APPLE_WALLET_ORGANIZATION_NAME ?? 'ALMA Group',
      signerCert: process.env.APPLE_WALLET_SIGNER_CERT ?? '',
      signerKey: process.env.APPLE_WALLET_SIGNER_KEY ?? '',
      signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE ?? '',
      wwdr: process.env.APPLE_WALLET_WWDR_CERT ?? ''
    },
    googleWallet: {
      issuerId: process.env.GOOGLE_WALLET_ISSUER_ID ?? '',
      classSuffix: process.env.GOOGLE_WALLET_CLASS_SUFFIX ?? 'alma_gift_card',
      serviceAccountEmail: process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL ?? '',
      privateKey: process.env.GOOGLE_WALLET_PRIVATE_KEY ?? '',
      origins: parseCorsOrigins(process.env.GOOGLE_WALLET_ORIGINS)
    }
  }
};
