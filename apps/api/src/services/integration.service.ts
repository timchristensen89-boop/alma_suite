import crypto from 'node:crypto';
import type { Request } from 'express';
import { Prisma, type IntegrationConnection } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AdminMetaIntegrationStatus,
  AuthUser,
  IntegrationConnectResponse,
  IntegrationProviderKey,
  IntegrationProviderStatus,
  IntegrationStatusPayload,
  SquareConfigMissingMap,
  XeroSupplierBillsImportResult,
  XeroSupplierBillsPreviewPayload,
  XeroSupplierBillPreview,
  XeroSupplierContactsImportResult,
  XeroSupplierContactsPreviewPayload,
  XeroSupplierContactPreview,
  XeroConnectionHealthPayload
} from '@alma/shared';
import {
  xeroSupplierBillsImportInputSchema,
  xeroSupplierContactsImportInputSchema
} from '@alma/shared';
import { env } from '../env.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  integrationTokenEncryptionStatus,
  safeCompareBase64
} from '../lib/integration-crypto.js';
import { HttpError } from '../lib/http.js';

type Provider = 'SQUARE' | 'XERO';
type SquareAccountKey = 'primary' | 'secondary';
type ImportRunMode = 'MANUAL' | 'SCHEDULED';

const SQUARE_ACCOUNT_KEYS: SquareAccountKey[] = ['primary', 'secondary'];
const DEFAULT_SCHEDULED_XERO_LOOKBACK_DAYS = 14;
const DEFAULT_SCHEDULED_XERO_BILLS_LIMIT = 100;
const DEFAULT_SCHEDULED_XERO_CONTACTS_LIMIT = 500;
const DEFAULT_SCHEDULED_SQUARE_SALES_LOOKBACK_DAYS = 7;
const DEFAULT_SQUARE_PAYMENT_IMPORT_LIMIT = 1000;

const SQUARE_SCOPES = [
  'MERCHANT_PROFILE_READ',
  'PAYMENTS_READ',
  'ORDERS_READ',
  'ITEMS_READ',
  'INVENTORY_READ'
];

const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.invoices.read',
  'accounting.contacts.read',
  'accounting.settings.read'
];
const XERO_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const SQUARE_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
  'pages_messaging',
  'instagram_basic',
  'business_management'
];

const META_ALLOWED_DOMAINS = [
  'alma-compliance.web.app',
  'alma-marketing.web.app'
];

const PROVIDER_COPY: Record<Provider, {
  key: IntegrationProviderKey;
  label: string;
  powers: string[];
  requiredSetup: string[];
}> = {
  SQUARE: {
    key: 'square',
    label: 'Square',
    powers: ['Live sales', 'payments', 'product movement', 'trading pace'],
    requiredSetup: ['Application ID', 'secret', 'redirect URL', 'webhook signature key']
  },
  XERO: {
    key: 'xero',
    label: 'Xero',
    powers: ['Invoices', 'bills', 'supplier spend', 'accounting status'],
    requiredSetup: ['Client ID', 'client secret', 'redirect URL', 'webhook key']
  }
};

function actorName(actor?: AuthUser | null) {
  return [actor?.firstName, actor?.lastName].filter(Boolean).join(' ') || actor?.email || 'System';
}

const integrationSchedulerActor: AuthUser = {
  id: 'system:integration-scheduler',
  firstName: 'Integration',
  lastName: 'Scheduler',
  email: null,
  roleTitle: 'System',
  venue: null,
  accountType: 'HUMAN',
  isAdmin: true,
  role: 'ADMIN',
  appAccess: []
};

function hashState(state: string) {
  return crypto.createHash('sha256').update(state).digest('hex');
}

function createSquareState(accountKey: SquareAccountKey) {
  return `${accountKey}.${crypto.randomBytes(32).toString('hex')}`;
}

function squareAccountKeyFromState(state: string) {
  const [accountKey] = state.split('.');
  return normaliseSquareAccountKey(accountKey);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signMetaStatePayload(payload: string) {
  return crypto.createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

function createMetaState(actor: AuthUser) {
  const payload = base64UrlEncode(JSON.stringify({
    provider: 'meta',
    nonce: crypto.randomBytes(16).toString('hex'),
    actorId: actor.id,
    redirectPath: '/admin#integrations',
    exp: Date.now() + 10 * 60 * 1000
  }));
  const signature = signMetaStatePayload(payload);
  return `${payload}.${signature}`;
}

function verifyMetaState(state: string) {
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;
  const expected = signMetaStatePayload(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as { provider?: unknown; exp?: unknown };
    return parsed.provider === 'meta' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function normaliseProvider(provider: string): Provider {
  const value = provider.trim().toUpperCase();
  if (value === 'SQUARE' || value === 'XERO') return value;
  throw new HttpError(404, 'Integration provider not found.');
}

function normaliseSquareAccountKey(value: unknown): SquareAccountKey {
  if (value === 'secondary') return 'secondary';
  if (value === 'primary' || value === undefined || value === null || value === '') return 'primary';
  throw new HttpError(400, 'Unknown Square account.');
}

function squareAccountConfig(accountKey: SquareAccountKey) {
  return env.integrations.square.accounts[accountKey];
}

function squareWebhookUrl(accountKey: SquareAccountKey) {
  return `${env.integrations.square.webhookUrl.replace(/\/+$/, '')}/${accountKey}`;
}

const SQUARE_CONFIG_LABELS: Record<keyof SquareConfigMissingMap, string> = {
  applicationId: 'Application ID',
  applicationSecret: 'Application secret',
  webhookSignatureKey: 'Webhook signature key',
  redirectUri: 'OAuth redirect URI',
  webhookUrl: 'Webhook URL',
  apiVersion: 'Square API version',
  environment: 'Square environment'
};

function squareMissingConfig(accountKey: SquareAccountKey): SquareConfigMissingMap {
  const account = squareAccountConfig(accountKey);
  return {
    applicationId: !account.applicationId,
    applicationSecret: !account.applicationSecret,
    webhookSignatureKey: !account.webhookSignatureKey,
    redirectUri: !env.integrations.square.configuredFromEnv.redirectUri || !env.integrations.square.redirectUrl,
    webhookUrl: !env.integrations.square.configuredFromEnv.webhookUrl || !env.integrations.square.webhookUrl,
    apiVersion: !env.integrations.square.configuredFromEnv.apiVersion || !env.integrations.square.apiVersion,
    environment: !env.integrations.square.configuredFromEnv.environment || !env.integrations.square.environment
  };
}

function squareMissingLabels(missing: SquareConfigMissingMap) {
  return (Object.entries(missing) as Array<[keyof SquareConfigMissingMap, boolean]>)
    .filter(([, isMissing]) => isMissing)
    .map(([key]) => SQUARE_CONFIG_LABELS[key]);
}

function squareMissingEnvVars(accountKey: SquareAccountKey, missing: SquareConfigMissingMap) {
  const prefix = `SQUARE_${accountKey.toUpperCase()}`;
  return [
    missing.applicationId ? `${prefix}_APPLICATION_ID` : null,
    missing.applicationSecret ? `${prefix}_APPLICATION_SECRET` : null,
    missing.webhookSignatureKey ? `${prefix}_WEBHOOK_SIGNATURE_KEY` : null,
    missing.redirectUri ? 'SQUARE_REDIRECT_URI' : null,
    missing.webhookUrl ? 'SQUARE_WEBHOOK_URL' : null,
    missing.apiVersion ? 'SQUARE_API_VERSION' : null,
    missing.environment ? 'SQUARE_ENVIRONMENT' : null
  ].filter((value): value is string => Boolean(value));
}

function providerConfig(provider: Provider, accountKey: SquareAccountKey = 'primary') {
  if (provider === 'SQUARE') {
    const isProduction = env.integrations.square.environment === 'production';
    const missing = squareMissingConfig(accountKey);
    const oauthConfigured = !missing.applicationId && !missing.applicationSecret && !missing.redirectUri && !missing.apiVersion && !missing.environment;
    const webhookConfigured = !missing.webhookSignatureKey && !missing.webhookUrl;
    return {
      configured: oauthConfigured && webhookConfigured,
      oauthConfigured,
      missingConfig: missing,
      missingLabels: squareMissingLabels(missing),
      missingEnvVars: squareMissingEnvVars(accountKey, missing),
      environment: isProduction ? 'production' : 'sandbox',
      oauthBaseUrl: isProduction ? 'https://connect.squareup.com/oauth2' : 'https://connect.squareupsandbox.com/oauth2',
      apiBaseUrl: isProduction ? 'https://connect.squareup.com/v2' : 'https://connect.squareupsandbox.com/v2',
      apiVersion: env.integrations.square.apiVersion,
      redirectUri: env.integrations.square.redirectUrl,
      webhookUrl: squareWebhookUrl(accountKey),
      webhookConfigured
    };
  }

  return {
    configured: Boolean(
      env.integrations.xero.clientId &&
        env.integrations.xero.clientSecret &&
        env.integrations.xero.redirectUrl
    ),
    missingEnvVars: [
      env.integrations.xero.clientId ? null : 'XERO_CLIENT_ID',
      env.integrations.xero.clientSecret ? null : 'XERO_CLIENT_SECRET',
      env.integrations.xero.redirectUrl ? null : 'XERO_REDIRECT_URL'
    ].filter((value): value is string => Boolean(value)),
    environment: null,
    oauthBaseUrl: 'https://login.xero.com/identity/connect',
    apiBaseUrl: null,
    apiVersion: null,
    redirectUri: env.integrations.xero.redirectUrl,
    webhookUrl: null,
    webhookConfigured: Boolean(env.integrations.xero.webhookKey),
    oauthConfigured: Boolean(env.integrations.xero.clientId && env.integrations.xero.clientSecret && env.integrations.xero.redirectUrl),
    missingConfig: null,
    missingLabels: []
  };
}

function metaConfig() {
  const configured = Boolean(env.integrations.meta.appId && env.integrations.meta.appSecret && env.integrations.meta.redirectUrl);
  const missingEnvVars = [
    env.integrations.meta.appId ? null : 'META_APP_ID',
    env.integrations.meta.appSecret ? null : 'META_APP_SECRET',
    env.integrations.meta.redirectUrl ? null : 'META_REDIRECT_URI'
  ].filter((value): value is string => Boolean(value));
  return {
    configured,
    missingEnvVars,
    redirectUri: env.integrations.meta.redirectUrl,
    graphVersion: env.marketing.socialPublishing.metaGraphApiVersion
  };
}

async function connectionSelect(provider: Provider, accountKey?: SquareAccountKey) {
  const where: Prisma.IntegrationConnectionWhereInput = { provider, scopeType: 'BUSINESS' };
  if (provider === 'SQUARE' && accountKey) {
    where.metadata = { path: ['squareAccountKey'], equals: accountKey };
  }
  const connection = await prisma.integrationConnection.findFirst({
    where,
    orderBy: { updatedAt: 'desc' }
  });
  if (connection || provider !== 'SQUARE' || accountKey !== 'primary') return connection;

  const legacyConnections = await prisma.integrationConnection.findMany({
    where: { provider, scopeType: 'BUSINESS' },
    orderBy: { updatedAt: 'desc' },
    take: 10
  });
  return legacyConnections.find((candidate) => {
    const key = optionalText(metadataRecord(candidate.metadata).squareAccountKey);
    return key !== 'primary' && key !== 'secondary';
  }) ?? null;
}

function isMissingIntegrationStorage(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2021' || error.code === 'P2022')
  );
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function scopesFromJson(value: unknown) {
  return Array.isArray(value) ? value.filter((scope): scope is string => typeof scope === 'string') : [];
}

function maskIdentifier(value: string | null | undefined) {
  if (!value) return null;
  if (value.length <= 8) return 'connected';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unknown integration error';
}

function safeXeroErrorCategory(status: number) {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'xero_unavailable';
  return 'xero_request_failed';
}

function tokenStatusFromHealthError(error: unknown): XeroConnectionHealthPayload['tokenStatus'] {
  const message = safeErrorMessage(error).toLowerCase();
  if (message.includes('refresh')) return 'refresh_failed';
  if (message.includes('token')) return 'missing';
  return 'request_failed';
}

async function safeResponseDetails(response: Response) {
  const text = await response.text().catch(() => '');
  return {
    status: response.status,
    category: safeXeroErrorCategory(response.status),
    detail: text ? text.slice(0, 300) : response.statusText
  };
}

async function recordEvent(input: {
  provider: Provider;
  connectionId?: string | null;
  eventType: string;
  summary: string;
  actor?: AuthUser | null;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.integrationEvent.create({
    data: {
      provider: input.provider,
      connectionId: input.connectionId ?? null,
      eventType: input.eventType,
      summary: input.summary,
      metadata: input.metadata ?? {},
      createdByUserId: input.actor?.id ?? null,
      createdByName: actorName(input.actor)
    }
  });
}

function blockedReason(provider: Provider, missingEnvVars: string[], encryptionConfigured: boolean) {
  if (missingEnvVars.length) return `Missing ${missingEnvVars.join(', ')}.`;
  if (!encryptionConfigured) return 'Missing INTEGRATION_TOKEN_ENCRYPTION_KEY.';
  if (!env.integrations.allowOAuthConnections) {
    return 'OAuth connection starts are disabled until Square or Xero connection is explicitly approved.';
  }
  return null;
}

type SquareLocation = {
  id?: string;
  name?: string;
  status?: string;
  business_name?: string;
  currency?: string;
  timezone?: string;
};

type SquareLocationsResponse = {
  locations?: SquareLocation[];
};

type SquareMoney = {
  amount?: number;
  currency?: string;
};

type SquarePayment = {
  id?: string;
  status?: string;
  location_id?: string;
  order_id?: string;
  receipt_number?: string;
  created_at?: string;
  updated_at?: string;
  amount_money?: SquareMoney;
  total_money?: SquareMoney;
  refunded_money?: SquareMoney;
};

type SquarePaymentsResponse = {
  payments?: SquarePayment[];
  cursor?: string;
};

type SquareTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  merchant_id?: string;
  token_type?: string;
  scope?: string;
};

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function squareAccountKeyFromConnection(connection: IntegrationConnection | null | undefined): SquareAccountKey {
  const key = optionalText(metadataRecord(connection?.metadata).squareAccountKey);
  return key === 'secondary' ? 'secondary' : 'primary';
}

function squareLocationSummary(location: SquareLocation) {
  return {
    id: optionalText(location.id) ?? '',
    name: optionalText(location.name) ?? 'Unnamed Square location',
    status: optionalText(location.status),
    businessName: optionalText(location.business_name),
    currency: optionalText(location.currency),
    timezone: optionalText(location.timezone)
  };
}

function squareMetadata(input: {
  accountKey: SquareAccountKey;
  existing?: unknown;
  locations?: SquareLocation[];
  syncedAt?: Date;
}): Prisma.InputJsonObject {
  const locations = input.locations?.map(squareLocationSummary).filter((location) => location.id) ?? [];
  return {
    ...metadataRecord(input.existing),
    squareAccountKey: input.accountKey,
    squareAccountLabel: squareAccountConfig(input.accountKey).label,
    squareEnvironment: providerConfig('SQUARE', input.accountKey).environment,
    squareApiVersion: env.integrations.square.apiVersion,
    squareRedirectUri: env.integrations.square.redirectUrl,
    squareWebhookUrl: squareWebhookUrl(input.accountKey),
    ...(input.locations ? { squareLocations: locations, squareLocationCount: locations.length } : {}),
    ...(input.syncedAt ? { squareLocationsSyncedAt: input.syncedAt.toISOString() } : {})
  };
}

function squareMetadataStatus(connection: IntegrationConnection | null | undefined) {
  const metadata = metadataRecord(connection?.metadata);
  const locationsRaw = Array.isArray(metadata.squareLocations) ? metadata.squareLocations : [];
  const locations = locationsRaw
    .map((location) => metadataRecord(location))
    .map((location) => ({
      id: optionalText(location.id) ?? '',
      name: optionalText(location.name) ?? 'Unnamed Square location',
      status: optionalText(location.status),
      businessName: optionalText(location.businessName),
      currency: optionalText(location.currency),
      timezone: optionalText(location.timezone)
    }))
    .filter((location) => location.id);
  const locationCount = typeof metadata.squareLocationCount === 'number' ? metadata.squareLocationCount : locations.length;
  return {
    locations,
    locationCount,
    lastLocationSyncAt: optionalText(metadata.squareLocationsSyncedAt)
  };
}

async function squareWebhookStats(accountKey: SquareAccountKey) {
  try {
    const [latest, latestProcessed, total, failed] = await Promise.all([
      prisma.integrationWebhookEvent.findFirst({
        where: { provider: 'SQUARE', accountKey },
        orderBy: { receivedAt: 'desc' }
      }),
      prisma.integrationWebhookEvent.findFirst({
        where: { provider: 'SQUARE', accountKey, processedAt: { not: null } },
        orderBy: { processedAt: 'desc' }
      }),
      prisma.integrationWebhookEvent.count({ where: { provider: 'SQUARE', accountKey } }),
      prisma.integrationWebhookEvent.count({ where: { provider: 'SQUARE', accountKey, status: 'ERROR' } })
    ]);
    return {
      webhookLastReceivedAt: toIso(latest?.receivedAt),
      webhookLastProcessedAt: toIso(latestProcessed?.processedAt),
      webhookEventCount: total,
      webhookFailedEventCount: failed
    };
  } catch (error) {
    if (!isMissingIntegrationStorage(error)) throw error;
    return {
      webhookLastReceivedAt: null,
      webhookLastProcessedAt: null,
      webhookEventCount: 0,
      webhookFailedEventCount: 0
    };
  }
}

async function providerStatus(provider: Provider, accountKey: SquareAccountKey = 'primary'): Promise<IntegrationProviderStatus> {
  const copy = PROVIDER_COPY[provider];
  const config = providerConfig(provider, accountKey);
  const tokenStorage = integrationTokenEncryptionStatus();
  let connection: Awaited<ReturnType<typeof connectionSelect>> | null = null;
  let storageReady = true;
  try {
    connection = await connectionSelect(provider, provider === 'SQUARE' ? accountKey : undefined);
  } catch (error) {
    if (!isMissingIntegrationStorage(error)) throw error;
    storageReady = false;
  }
  const missingEnvVars = [
    ...config.missingEnvVars,
    ...(tokenStorage.configured ? [] : [tokenStorage.requiredEnvVar]),
    ...(storageReady ? [] : ['Integration database setup'])
  ];
  const reason = storageReady
    ? provider === 'SQUARE' && config.missingLabels.length
      ? `Missing ${config.missingLabels.join(', ')}.`
      : blockedReason(provider, config.missingEnvVars, tokenStorage.configured)
    : 'Integration database setup is not active yet.';
  const status = !config.configured || !tokenStorage.configured
    ? 'NOT_CONFIGURED'
    : connection?.status ?? 'NOT_CONNECTED';
  const squareStatus = provider === 'SQUARE' ? squareMetadataStatus(connection) : null;
  const webhookStats = provider === 'SQUARE'
    ? await squareWebhookStats(accountKey)
    : {
        webhookLastReceivedAt: null,
        webhookLastProcessedAt: null,
        webhookEventCount: 0,
        webhookFailedEventCount: 0
      };
  const connected = connection?.status === 'CONNECTED';
  const squareSetup = provider === 'SQUARE'
    ? {
        accountKey,
        label: squareAccountConfig(accountKey).label,
        configured: config.configured && tokenStorage.configured,
        oauthConfigured: config.oauthConfigured,
        webhookConfigured: config.webhookConfigured,
        connected,
        missing: config.missingConfig as SquareConfigMissingMap,
        missingLabels: config.missingLabels,
        redirectUri: config.redirectUri,
        webhookUrl: config.webhookUrl,
        lastWebhookAt: webhookStats.webhookLastReceivedAt,
        webhookEventCount: webhookStats.webhookEventCount,
        locationCount: squareStatus?.locationCount ?? null
      }
    : undefined;

  return {
    provider: copy.key,
    accountKey: provider === 'SQUARE' ? accountKey : undefined,
    label: provider === 'SQUARE' ? squareAccountConfig(accountKey).label : copy.label,
    status,
    configured: config.configured && tokenStorage.configured,
    oauthConfigured: config.oauthConfigured,
    connected,
    squareSetup,
    canConnect: !reason,
    connectBlockedReason: reason,
    providerAccountId: provider === 'XERO' ? maskIdentifier(connection?.providerAccountId) : connection?.providerAccountId ?? null,
    providerAccountName: connection?.providerAccountName ?? null,
    connectedAt: toIso(connection?.connectedAt),
    disconnectedAt: toIso(connection?.disconnectedAt),
    lastSyncAt: toIso(connection?.lastSyncAt),
    lastSyncStatus: connection?.lastSyncStatus ?? null,
    lastError: connection?.lastError ?? null,
    scopes: scopesFromJson(connection?.scopes),
    environment: config.environment,
    apiVersion: config.apiVersion,
    redirectUri: config.redirectUri,
    webhookUrl: config.webhookUrl,
    webhookConfigured: config.webhookConfigured,
    webhookStatus: config.webhookConfigured ? 'configured' : 'missing',
    ...webhookStats,
    powers: copy.powers,
    requiredSetup: copy.requiredSetup,
    missingEnvVars,
    actionLabel: reason && provider === 'SQUARE'
      ? 'Complete Square config first'
      : connection?.status === 'CONNECTED'
        ? `Reconnect ${provider === 'SQUARE' ? squareAccountConfig(accountKey).label : copy.label}`
        : `Connect ${provider === 'SQUARE' ? squareAccountConfig(accountKey).label : copy.label}`,
    actionDisabled: Boolean(reason),
    locationCount: squareStatus?.locationCount ?? null,
    locations: squareStatus?.locations ?? undefined,
    lastLocationSyncAt: squareStatus?.lastLocationSyncAt ?? null
  };
}

async function latestSyncRuns() {
  let runs: Awaited<ReturnType<typeof prisma.integrationSyncRun.findMany>>;
  try {
    runs = await prisma.integrationSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 8
    });
  } catch (error) {
    if (!isMissingIntegrationStorage(error)) throw error;
    return [];
  }

  return runs.map((run) => ({
    id: run.id,
    provider: PROVIDER_COPY[run.provider as Provider].key,
    syncType: run.syncType,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: toIso(run.finishedAt),
    recordsImported: run.recordsImported,
    recordsUpdated: run.recordsUpdated,
    errorSummary: run.errorSummary
  }));
}

async function exchangeSquareToken(code: string, accountKey: SquareAccountKey) {
  const config = providerConfig('SQUARE', accountKey);
  const account = squareAccountConfig(accountKey);
  const response = await fetch(`${config.oauthBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: account.applicationId,
      client_secret: account.applicationSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: env.integrations.square.redirectUrl
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'Square token exchange failed.', body);
  }

  return body as SquareTokenResponse;
}

async function refreshSquareToken(refreshToken: string, accountKey: SquareAccountKey): Promise<SquareTokenResponse> {
  const config = providerConfig('SQUARE', accountKey);
  const account = squareAccountConfig(accountKey);
  const response = await fetch(`${config.oauthBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: account.applicationId,
      client_secret: account.applicationSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'Square token refresh failed.', {
      status: response.status,
      detail: typeof body === 'object' && body ? 'Square returned an OAuth refresh error.' : response.statusText
    });
  }

  return body as SquareTokenResponse;
}

async function refreshSquareConnection(connection: IntegrationConnection) {
  if (!connection.refreshTokenEncrypted) {
    throw new HttpError(409, 'Square refresh token is missing.');
  }

  const accountKey = squareAccountKeyFromConnection(connection);
  const token = await refreshSquareToken(decryptIntegrationSecret(connection.refreshTokenEncrypted), accountKey);
  if (!token.access_token || !token.refresh_token) {
    throw new HttpError(502, 'Square did not return refreshed OAuth tokens.');
  }

  return prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      tokenEncrypted: encryptIntegrationSecret(token.access_token),
      refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
      tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : connection.tokenExpiresAt,
      scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : scopesFromJson(connection.scopes),
      status: 'CONNECTED',
      lastError: null,
      metadata: squareMetadata({ accountKey, existing: connection.metadata })
    }
  });
}

async function validSquareToken(connection: IntegrationConnection) {
  const expiresAt = connection.tokenExpiresAt?.getTime();
  const shouldRefresh =
    !connection.tokenEncrypted ||
    !expiresAt ||
    expiresAt <= Date.now() + SQUARE_TOKEN_REFRESH_BUFFER_MS;

  if (shouldRefresh) {
    const refreshed = await refreshSquareConnection(connection);
    if (!refreshed.tokenEncrypted) throw new HttpError(409, 'Square access token is missing after refresh.');
    return {
      accessToken: decryptIntegrationSecret(refreshed.tokenEncrypted),
      connection: refreshed,
      tokenStatus: 'refreshed' as const
    };
  }

  if (!connection.tokenEncrypted) {
    throw new HttpError(409, 'Square access token is missing.');
  }

  return {
    accessToken: decryptIntegrationSecret(connection.tokenEncrypted),
    connection,
    tokenStatus: 'healthy' as const
  };
}

async function squareGetJsonWithAccessToken<T>(path: string, accessToken: string, accountKey: SquareAccountKey): Promise<T> {
  const config = providerConfig('SQUARE', accountKey);
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': env.integrations.square.apiVersion,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(502, 'Square request failed.', {
      status: response.status,
      detail: text ? text.slice(0, 300) : response.statusText
    });
  }

  return response.json() as Promise<T>;
}

async function connectedSquareConnection(accountKey: SquareAccountKey) {
  const connection = await connectionSelect('SQUARE', accountKey);
  if (!connection || connection.status !== 'CONNECTED') {
    throw new HttpError(409, `${squareAccountConfig(accountKey).label} Square is not connected.`);
  }
  return connection;
}

async function squareGetJson<T>(
  path: string,
  input: {
    connection: IntegrationConnection;
    retryAfterUnauthorized?: boolean;
  }
): Promise<{ data: T; connection: IntegrationConnection; tokenStatus: 'healthy' | 'refreshed' }> {
  const { accessToken, connection, tokenStatus } = await validSquareToken(input.connection);

  try {
    return {
      data: await squareGetJsonWithAccessToken<T>(path, accessToken, squareAccountKeyFromConnection(connection)),
      connection,
      tokenStatus
    };
  } catch (error) {
    const status = error instanceof HttpError && error.details && typeof error.details === 'object'
      ? Number((error.details as { status?: unknown }).status)
      : null;
    if (status === 401 && input.retryAfterUnauthorized !== false) {
      const refreshed = await refreshSquareConnection(connection);
      return squareGetJson<T>(path, {
        connection: refreshed,
        retryAfterUnauthorized: false
      });
    }
    throw error;
  }
}

async function listSquareLocations(connection: IntegrationConnection) {
  const response = await squareGetJson<SquareLocationsResponse>('/locations', { connection });
  return {
    connection: response.connection,
    locations: response.data.locations ?? [],
    tokenStatus: response.tokenStatus
  };
}

async function listSquarePayments(input: {
  connection: IntegrationConnection;
  beginTime: Date;
  endTime: Date;
  limit: number;
}) {
  let connection = input.connection;
  const payments: SquarePayment[] = [];
  let cursor: string | undefined;
  let tokenStatus: 'healthy' | 'refreshed' = 'healthy';
  const pageLimit = 100;

  while (payments.length < input.limit) {
    const params = new URLSearchParams({
      begin_time: input.beginTime.toISOString(),
      end_time: input.endTime.toISOString(),
      sort_order: 'ASC',
      limit: String(Math.min(pageLimit, input.limit - payments.length))
    });
    if (cursor) params.set('cursor', cursor);

    const response = await squareGetJson<SquarePaymentsResponse>(`/payments?${params.toString()}`, { connection });
    connection = response.connection;
    if (response.tokenStatus === 'refreshed') tokenStatus = 'refreshed';
    payments.push(...(response.data.payments ?? []));
    cursor = response.data.cursor;
    if (!cursor || payments.length >= input.limit) break;
  }

  return { connection, payments, tokenStatus, limited: Boolean(cursor) };
}

function squarePaymentAmountCents(payment: SquarePayment) {
  const total = typeof payment.total_money?.amount === 'number'
    ? payment.total_money.amount
    : typeof payment.amount_money?.amount === 'number'
      ? payment.amount_money.amount
      : 0;
  const refunded = typeof payment.refunded_money?.amount === 'number' ? payment.refunded_money.amount : 0;
  return Math.max(0, Math.round(total - refunded));
}

async function configuredVenueNames() {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { venues: true }
  });
  const venues = Array.isArray(settings?.venues) ? settings.venues : [];
  return venues
    .map((venue) => metadataRecord(venue).name)
    .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    .map((name) => name.trim());
}

function squarePaymentVenue(input: {
  accountKey: SquareAccountKey;
  location: ReturnType<typeof squareMetadataStatus>['locations'][number] | null;
  venues: string[];
}) {
  const candidates = [
    input.location?.businessName,
    input.location?.name,
    squareAccountConfig(input.accountKey).label
  ].map(optionalText).filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const exact = input.venues.find((venue) => normaliseMatchText(venue) === normaliseMatchText(candidate));
    if (exact) return exact;
  }
  return squareAccountConfig(input.accountKey).label;
}

function squareImportDateRange(input: Record<string, unknown>, defaultLookbackDays: number) {
  const end = parseXeroDate(input.endDate) ?? new Date();
  const start = parseXeroDate(input.startDate) ?? new Date(end);
  if (!input.startDate) start.setDate(start.getDate() - defaultLookbackDays);
  if (end <= start) throw new HttpError(400, 'Square sales import end date must be after the start date.');
  return { start, end };
}

async function exchangeXeroToken(code: string) {
  const credentials = Buffer.from(`${env.integrations.xero.clientId}:${env.integrations.xero.clientSecret}`).toString('base64');
  const response = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.integrations.xero.redirectUrl
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'Xero token exchange failed.', body);
  }

  return body as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    token_type?: string;
  };
}

type XeroTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

type XeroTenantConnection = {
  tenantId?: string;
  tenantName?: string;
  tenantType?: string;
};

type XeroContact = {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string;
  ContactStatus?: string;
  IsSupplier?: boolean;
  IsCustomer?: boolean;
  TaxNumber?: string;
  Phones?: Array<{ PhoneType?: string; PhoneNumber?: string; PhoneAreaCode?: string; PhoneCountryCode?: string }>;
  Addresses?: Array<{ AddressType?: string; AddressLine1?: string; City?: string; Region?: string; PostalCode?: string; Country?: string }>;
};

type XeroInvoiceLineItem = {
  LineItemID?: string;
  Description?: string;
  Quantity?: number;
  UnitAmount?: number;
  LineAmount?: number;
  TaxAmount?: number;
  AccountCode?: string;
  ItemCode?: string;
};

type XeroInvoice = {
  InvoiceID?: string;
  Type?: string;
  Contact?: XeroContact;
  InvoiceNumber?: string;
  Reference?: string;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  Status?: string;
  CurrencyCode?: string;
  SubTotal?: number;
  TotalTax?: number;
  Total?: number;
  LineItems?: XeroInvoiceLineItem[];
};

type SupplierMatch = {
  supplierId: string | null;
  supplierName: string | null;
  matchReason: string | null;
};

type ExistingSupplier = {
  id: string;
  name: string;
  email: string | null;
};

type ExistingInvoice = {
  id: string;
  source: string;
  invoiceKey: string;
  externalInvoiceId: string | null;
  invoiceNumber: string | null;
  supplierName: string;
  invoiceDate: Date | null;
  totalCents: number;
};

function trimText(value: unknown) {
  return String(value ?? '').trim();
}

function optionalText(value: unknown) {
  const text = trimText(value);
  return text ? text : null;
}

function normaliseMatchText(value: unknown) {
  return trimText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function moneyToCents(value: unknown) {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : Number(trimText(value).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function parseXeroDate(value: unknown) {
  const text = trimText(value);
  if (!text) return null;
  const xeroJsonDate = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(text);
  const date = xeroJsonDate?.[1] ? new Date(Number(xeroJsonDate[1])) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDateOnly(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function dateKeyInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : value.toISOString().slice(0, 10);
}

function startOfUtcDate(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function buildImportHash(parts: Array<string | number | null | undefined>) {
  const hash = crypto.createHash('sha1');
  hash.update(parts.map((part) => trimText(part)).join('|'));
  return hash.digest('hex');
}

function phoneFromXero(contact: XeroContact) {
  const phone = contact.Phones?.find((entry) => entry.PhoneNumber)?.PhoneNumber;
  return optionalText(phone);
}

function addressFromXero(contact: XeroContact) {
  const address = contact.Addresses?.find((entry) => entry.AddressType === 'STREET' || entry.AddressLine1) ?? null;
  if (!address) return null;
  return [
    address.AddressLine1,
    address.City,
    address.Region,
    address.PostalCode,
    address.Country
  ].map(optionalText).filter(Boolean).join(', ') || null;
}

function isSupplierCandidate(contact: XeroContact) {
  return contact.IsSupplier === true;
}

function matchSupplier(input: { name: string; email?: string | null }, suppliers: ExistingSupplier[]): SupplierMatch {
  const email = optionalText(input.email)?.toLowerCase() ?? null;
  if (email) {
    const emailMatch = suppliers.find((supplier) => supplier.email?.toLowerCase() === email);
    if (emailMatch) return { supplierId: emailMatch.id, supplierName: emailMatch.name, matchReason: 'email' };
  }

  const normalisedName = normaliseMatchText(input.name);
  if (normalisedName) {
    const exact = suppliers.find((supplier) => supplier.name === input.name);
    if (exact) return { supplierId: exact.id, supplierName: exact.name, matchReason: 'exact name' };
    const normalised = suppliers.find((supplier) => normaliseMatchText(supplier.name) === normalisedName);
    if (normalised) return { supplierId: normalised.id, supplierName: normalised.name, matchReason: 'normalised name' };
  }

  return { supplierId: null, supplierName: null, matchReason: null };
}

function xeroContactId(contact: XeroContact) {
  return optionalText(contact.ContactID);
}

function xeroBillId(invoice: XeroInvoice) {
  return optionalText(invoice.InvoiceID);
}

function billInvoiceNumber(invoice: XeroInvoice) {
  return optionalText(invoice.InvoiceNumber) ?? optionalText(invoice.Reference);
}

function lineKey(line: XeroInvoiceLineItem, index: number) {
  return optionalText(line.LineItemID) ?? buildImportHash([
    index,
    line.Description,
    line.ItemCode,
    line.Quantity,
    line.LineAmount
  ]);
}

async function refreshXeroToken(refreshToken: string): Promise<XeroTokenResponse> {
  const credentials = Buffer.from(`${env.integrations.xero.clientId}:${env.integrations.xero.clientSecret}`).toString('base64');
  const response = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'Xero token refresh failed.', {
      status: response.status,
      category: safeXeroErrorCategory(response.status)
    });
  }

  return body as XeroTokenResponse;
}

async function refreshXeroConnection(connection: IntegrationConnection) {
  if (!connection.refreshTokenEncrypted) {
    throw new HttpError(409, 'Xero refresh token is missing.');
  }

  const token = await refreshXeroToken(decryptIntegrationSecret(connection.refreshTokenEncrypted));
  if (!token.access_token || !token.refresh_token) {
    throw new HttpError(502, 'Xero did not return refreshed OAuth tokens.');
  }

  return prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      tokenEncrypted: encryptIntegrationSecret(token.access_token),
      refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
      tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
      scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : scopesFromJson(connection.scopes),
      status: 'CONNECTED',
      lastError: null
    }
  });
}

async function validXeroToken(connection: IntegrationConnection) {
  const expiresAt = connection.tokenExpiresAt?.getTime();
  const shouldRefresh =
    !connection.tokenEncrypted ||
    !expiresAt ||
    expiresAt <= Date.now() + XERO_TOKEN_REFRESH_BUFFER_MS;

  if (shouldRefresh) {
    const refreshed = await refreshXeroConnection(connection);
    if (!refreshed.tokenEncrypted) throw new HttpError(409, 'Xero access token is missing after refresh.');
    return {
      accessToken: decryptIntegrationSecret(refreshed.tokenEncrypted),
      connection: refreshed,
      tokenStatus: 'refreshed' as const
    };
  }

  if (!connection.tokenEncrypted) {
    throw new HttpError(409, 'Xero access token is missing.');
  }

  return {
    accessToken: decryptIntegrationSecret(connection.tokenEncrypted),
    connection,
    tokenStatus: 'healthy' as const
  };
}

async function xeroGetJson<T>(
  path: string,
  input: {
    connection: IntegrationConnection;
    requireTenant?: boolean;
    retryAfterUnauthorized?: boolean;
  }
): Promise<{ data: T; connection: IntegrationConnection; tokenStatus: 'healthy' | 'refreshed' }> {
  const { accessToken, connection, tokenStatus } = await validXeroToken(input.connection);
  const requireTenant = input.requireTenant ?? true;
  if (requireTenant && !connection.providerAccountId) {
    throw new HttpError(409, 'Xero tenant is not selected.');
  }

  const response = await fetch(`https://api.xero.com${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      ...(requireTenant ? { 'xero-tenant-id': connection.providerAccountId ?? '' } : {})
    }
  });

  if (response.status === 401 && input.retryAfterUnauthorized !== false) {
    const refreshed = await refreshXeroConnection(connection);
    return xeroGetJson<T>(path, {
      connection: refreshed,
      requireTenant,
      retryAfterUnauthorized: false
    });
  }

  if (response.status === 429) {
    throw new HttpError(429, 'Xero rate limit reached. Try again later.', {
      category: 'rate_limited'
    });
  }

  if (!response.ok) {
    throw new HttpError(502, 'Xero request failed.', await safeResponseDetails(response));
  }

  return {
    data: await response.json() as T,
    connection,
    tokenStatus
  };
}

async function connectedXeroConnection() {
  const connection = await connectionSelect('XERO');
  if (!connection || connection.status !== 'CONNECTED') {
    throw new HttpError(409, 'Xero is not connected.');
  }
  if (!connection.providerAccountId) {
    throw new HttpError(409, 'Xero tenant is not selected.');
  }
  return connection;
}

function clampLimit(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

async function xeroContacts(limit: number) {
  const connection = await connectedXeroConnection();
  const response = await xeroGetJson<{ Contacts?: XeroContact[] }>(
    '/api.xro/2.0/Contacts?includeArchived=false&page=1',
    { connection }
  );
  return {
    connection: response.connection,
    contacts: (response.data.Contacts ?? []).slice(0, limit)
  };
}

function defaultBillDates(query: Record<string, unknown>) {
  const end = parseXeroDate(query.endDate) ?? new Date();
  const start = parseXeroDate(query.startDate) ?? new Date(end);
  if (!query.startDate) start.setDate(start.getDate() - 90);
  return {
    start,
    end
  };
}

async function xeroBills(query: Record<string, unknown>, limit: number) {
  const connection = await connectedXeroConnection();
  const where = encodeURIComponent('Type=="ACCPAY"');
  const response = await xeroGetJson<{ Invoices?: XeroInvoice[] }>(
    `/api.xro/2.0/Invoices?where=${where}&order=Date%20DESC&page=1`,
    { connection }
  );
  const { start, end } = defaultBillDates(query);
  const statuses = optionalText(query.statuses)
    ?.split(',')
    .map((status) => status.trim().toUpperCase())
    .filter(Boolean) ?? [];
  const invoices = (response.data.Invoices ?? [])
    .filter((invoice) => invoice.Type === 'ACCPAY' || !invoice.Type)
    .filter((invoice) => {
      const date = parseXeroDate(invoice.DateString ?? invoice.Date);
      if (!date) return true;
      return date >= start && date <= end;
    })
    .filter((invoice) => !statuses.length || statuses.includes(trimText(invoice.Status).toUpperCase()))
    .slice(0, limit);
  return {
    connection: response.connection,
    start,
    end,
    bills: invoices
  };
}

function supplierContactPreview(contact: XeroContact, suppliers: ExistingSupplier[]): XeroSupplierContactPreview | null {
  const id = xeroContactId(contact);
  const name = optionalText(contact.Name);
  if (!id || !name) return null;
  const email = optionalText(contact.EmailAddress);
  const match = matchSupplier({ name, email }, suppliers);
  const warnings: string[] = [];
  if (!isSupplierCandidate(contact)) warnings.push('Not marked as a supplier in Xero.');
  if (!email) warnings.push('No email on Xero contact.');
  return {
    xeroContactId: id,
    xeroContactIdMasked: maskIdentifier(id) ?? 'connected',
    name,
    email,
    phone: phoneFromXero(contact),
    isSupplierCandidate: isSupplierCandidate(contact),
    existingSupplierId: match.supplierId,
    existingSupplierName: match.supplierName,
    existingSupplierMatch: Boolean(match.supplierId),
    matchReason: match.matchReason,
    warnings
  };
}

function duplicateForBill(invoice: XeroInvoice, existingInvoices: ExistingInvoice[]) {
  const id = xeroBillId(invoice);
  const invoiceNumber = billInvoiceNumber(invoice);
  const supplierName = optionalText(invoice.Contact?.Name) ?? 'Unknown supplier';
  const invoiceDate = parseXeroDate(invoice.DateString ?? invoice.Date);
  const totalCents = moneyToCents(invoice.Total);

  if (id && existingInvoices.some((existing) => existing.invoiceKey === id || existing.externalInvoiceId === id)) {
    return { duplicateStatus: 'duplicate' as const, duplicateReason: 'Xero bill id already imported.' };
  }

  if (invoiceNumber) {
    const exact = existingInvoices.find((existing) =>
      existing.invoiceNumber === invoiceNumber &&
      normaliseMatchText(existing.supplierName) === normaliseMatchText(supplierName)
    );
    if (exact) return { duplicateStatus: 'possible_duplicate' as const, duplicateReason: 'Invoice number and supplier already exist.' };
  }

  const dateOnly = isoDateOnly(invoiceDate);
  const possible = existingInvoices.find((existing) =>
    normaliseMatchText(existing.supplierName) === normaliseMatchText(supplierName) &&
    isoDateOnly(existing.invoiceDate) === dateOnly &&
    existing.totalCents === totalCents
  );
  if (possible) return { duplicateStatus: 'possible_duplicate' as const, duplicateReason: 'Supplier, date and total match an existing invoice.' };

  return { duplicateStatus: 'new' as const, duplicateReason: null };
}

function billPreview(
  invoice: XeroInvoice,
  suppliers: ExistingSupplier[],
  existingInvoices: ExistingInvoice[]
): XeroSupplierBillPreview | null {
  const id = xeroBillId(invoice);
  if (!id) return null;
  const supplierName = optionalText(invoice.Contact?.Name) ?? 'Unknown supplier';
  const supplierEmail = optionalText(invoice.Contact?.EmailAddress);
  const match = matchSupplier({ name: supplierName, email: supplierEmail }, suppliers);
  const duplicate = duplicateForBill(invoice, existingInvoices);
  const warnings: string[] = [];
  if (!match.supplierId) warnings.push('Supplier is not matched in Alma.');
  if (!invoice.LineItems?.length) warnings.push('No bill lines returned.');
  if (duplicate.duplicateStatus !== 'new' && duplicate.duplicateReason) warnings.push(duplicate.duplicateReason);

  return {
    xeroInvoiceId: id,
    xeroInvoiceIdMasked: maskIdentifier(id) ?? 'connected',
    supplierName,
    supplierEmail,
    invoiceNumber: optionalText(invoice.InvoiceNumber),
    reference: optionalText(invoice.Reference),
    status: optionalText(invoice.Status) ?? 'UNKNOWN',
    invoiceDate: isoDateOnly(parseXeroDate(invoice.DateString ?? invoice.Date)),
    dueDate: isoDateOnly(parseXeroDate(invoice.DueDateString ?? invoice.DueDate)),
    currencyCode: optionalText(invoice.CurrencyCode) ?? 'AUD',
    lineCount: invoice.LineItems?.length ?? 0,
    totalCents: moneyToCents(invoice.Total),
    supplierId: match.supplierId,
    supplierMatchStatus: match.supplierId ? 'matched' : supplierName === 'Unknown supplier' ? 'unknown' : 'missing',
    duplicateStatus: duplicate.duplicateStatus,
    duplicateReason: duplicate.duplicateReason,
    warnings
  };
}

async function fetchXeroTenant(accessToken: string) {
  const response = await fetch('https://api.xero.com/connections', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) return null;
  const tenants = await response.json().catch(() => []);
  const tenant = Array.isArray(tenants) ? tenants[0] : null;
  if (!tenant || typeof tenant !== 'object') return null;
  return {
    id: typeof tenant.tenantId === 'string' ? tenant.tenantId : null,
    name: typeof tenant.tenantName === 'string' ? tenant.tenantName : null
  };
}

function frontendAdminRedirect(params: Record<string, string>) {
  const base = (process.env.COMPLIANCE_WEB_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const search = new URLSearchParams(params);
  return `${base}/admin?${search.toString()}`;
}

function squareCallbackRedirect(reason: string, accountKey?: SquareAccountKey) {
  return frontendAdminRedirect({
    integration: 'square',
    status: 'failed',
    ...(accountKey ? { account: accountKey } : {}),
    reason
  });
}

function squareCallbackReason(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const details = error instanceof HttpError ? JSON.stringify(error.details ?? '').toLowerCase() : '';
  if (message.includes('token exchange') || details.includes('oauth')) {
    if (details.includes('redirect')) return 'redirect_uri_mismatch_possible';
    return 'token_exchange_failed';
  }
  if (message.includes('unknown square account')) return 'unknown_account';
  if (message.includes('not configured') || message.includes('missing')) return 'missing_env';
  return 'token_exchange_failed';
}

async function recordSquareCallbackFailure(input: {
  reason: string;
  accountKey?: SquareAccountKey;
  provider?: Provider;
  metadata?: Record<string, unknown>;
}) {
  const provider = input.provider ?? 'SQUARE';
  console.warn('[integrations] OAuth callback failed', {
    provider,
    accountKey: input.accountKey ?? null,
    reason: input.reason
  });
  await recordEvent({
    provider,
    eventType: 'CONNECT_FAILED',
    summary: provider === 'SQUARE' && input.accountKey
      ? `${squareAccountConfig(input.accountKey).label} Square OAuth callback failed.`
      : `${PROVIDER_COPY[provider].label} OAuth callback failed.`,
    metadata: {
      reason: input.reason,
      ...(input.accountKey ? { accountKey: input.accountKey } : {}),
      ...(input.metadata ?? {})
    }
  });
}

function metaStatus(): AdminMetaIntegrationStatus {
  const config = metaConfig();
  const status = config.configured ? 'READY_TO_CONNECT' : 'NOT_CONFIGURED';
  return {
    provider: 'meta',
    label: 'Meta / Facebook / Instagram',
    status,
    configured: config.configured,
    canConnect: config.configured,
    connectBlockedReason: config.configured ? null : `Missing ${config.missingEnvVars.join(', ')}.`,
    redirectUri: config.redirectUri,
    authorizationUrl: null,
    allowedDomains: META_ALLOWED_DOMAINS,
    missingEnvVars: config.missingEnvVars,
    scopes: META_SCOPES,
    checklist: [
      {
        label: 'Valid OAuth Redirect URI added in Meta',
        status: 'required',
        detail: config.redirectUri
      },
      {
        label: 'Allowed domains added',
        status: 'required',
        detail: META_ALLOWED_DOMAINS.join(', ')
      },
      {
        label: 'Human Agent permission requested',
        status: 'required',
        detail: 'Use the Admin Human Agent demo for app review. No real customer message is sent in demo mode.'
      },
      {
        label: 'Data deletion instructions URL configured',
        status: 'required',
        detail: 'Use the public account deletion instructions page. No data deletion callback endpoint is implemented in this pass.'
      },
      {
        label: 'Deauthorize callback',
        status: 'not_configured',
        detail: 'No deauthorize callback endpoint is implemented.'
      }
    ],
    deauthorizeCallbackConfigured: false,
    dataDeletionCallbackConfigured: false
  };
}

function verifySquareSignature(req: Request, rawBody: string, accountKey: SquareAccountKey) {
  const signature = req.header('x-square-hmacsha256-signature');
  const key = squareAccountConfig(accountKey).webhookSignatureKey;
  const url = squareWebhookUrl(accountKey);
  if (!key || !url) throw new HttpError(503, 'Square webhook verification is not configured.');
  const generated = crypto.createHmac('sha256', key).update(`${url}${rawBody}`).digest('base64');
  return safeCompareBase64(signature, generated);
}

function verifyXeroSignature(req: Request, rawBody: string) {
  const signature = req.header('x-xero-signature');
  const key = env.integrations.xero.webhookKey;
  if (!key) throw new HttpError(503, 'Xero webhook verification is not configured.');
  const generated = crypto.createHmac('sha256', key).update(rawBody, 'utf8').digest('base64');
  return safeCompareBase64(signature, generated);
}

function rawBodyFromRequest(req: Request) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;
  return JSON.stringify(req.body ?? {});
}

function providerDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recordWebhook(provider: Provider, rawBody: string, accountKey: SquareAccountKey | 'default' = 'default') {
  const parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  const squareEventId = typeof parsed.event_id === 'string' ? parsed.event_id : null;
  const squareEventType = typeof parsed.type === 'string' ? parsed.type : null;
  if (provider === 'SQUARE' && (!squareEventId || !squareEventType)) {
    throw new HttpError(400, 'Invalid Square webhook payload.');
  }
  const eventId =
    squareEventId ??
    (typeof parsed.eventId === 'string'
      ? parsed.eventId
      : typeof parsed.id === 'string'
        ? parsed.id
        : crypto.createHash('sha256').update(rawBody).digest('hex'));
  const eventType =
    squareEventType ??
    (typeof parsed.eventType === 'string'
      ? parsed.eventType
      : Array.isArray(parsed.events)
        ? 'batch'
        : null);
  const merchantId = typeof parsed.merchant_id === 'string' ? parsed.merchant_id : null;
  const locationId = typeof parsed.location_id === 'string' ? parsed.location_id : null;
  const providerCreatedAt = providerDate(parsed.created_at);
  const connection = await connectionSelect(provider, provider === 'SQUARE' && accountKey !== 'default' ? accountKey : undefined);

  try {
    const webhookEvent = await prisma.integrationWebhookEvent.create({
      data: {
        provider,
        connectionId: connection?.id ?? null,
        accountKey,
        providerEventId: eventId,
        merchantId,
        locationId,
        eventType,
        providerCreatedAt,
        status: 'RECEIVED',
        payload: parsed as Prisma.InputJsonObject,
        processedAt: new Date()
      }
    });
    await prisma.integrationSyncRun.create({
      data: {
        provider,
        connectionId: connection?.id ?? null,
        syncType: 'WEBHOOK',
        status: 'SUCCESS',
        finishedAt: new Date()
      }
    });
    if (provider === 'SQUARE' && eventType === 'oauth.authorization.revoked' && connection) {
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          status: 'REVOKED',
          disconnectedAt: new Date(),
          tokenEncrypted: null,
          refreshTokenEncrypted: null,
          tokenExpiresAt: null,
          lastError: 'Square OAuth authorization revoked by merchant.'
        }
      });
      await recordEvent({
        provider,
        connectionId: connection.id,
        eventType: 'OAUTH_REVOKED',
        summary: `${accountKey === 'default' ? 'Square' : squareAccountConfig(accountKey).label} Square OAuth authorization was revoked.`,
        metadata: { accountKey, providerEventId: webhookEvent.providerEventId, merchantId }
      });
    }
    return { received: true, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { received: true, duplicate: true };
    }
    throw error;
  }
}

export const integrationService = {
  normaliseProvider,

  metaStatus,

  async startMetaConnect(actor: AuthUser) {
    const config = metaConfig();
    if (!config.configured) {
      throw new HttpError(503, `Meta Business Login is not configured. Missing ${config.missingEnvVars.join(', ')}.`);
    }

    const state = createMetaState(actor);
    const url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.searchParams.set('client_id', env.integrations.meta.appId);
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', META_SCOPES.join(','));
    return {
      provider: 'meta' as const,
      authorizationUrl: url.toString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
  },

  async handleMetaCallback(query: Record<string, unknown>) {
    const error = typeof query.error === 'string' ? query.error : '';
    const errorReason = typeof query.error_reason === 'string' ? query.error_reason : '';
    const errorDescription = typeof query.error_description === 'string' ? query.error_description : '';
    const code = typeof query.code === 'string' ? query.code : '';
    const state = typeof query.state === 'string' ? query.state : '';

    if (!state || !verifyMetaState(state)) {
      return frontendAdminRedirect({
        integration: 'meta',
        status: 'invalid_state'
      });
    }

    if (error || errorReason) {
      return frontendAdminRedirect({
        integration: 'meta',
        status: 'failed',
        reason: errorDescription || errorReason || error || 'meta_oauth_failed'
      });
    }

    if (!code) {
      return frontendAdminRedirect({
        integration: 'meta',
        status: 'missing_code'
      });
    }

    return frontendAdminRedirect({
      integration: 'meta',
      status: 'callback_received',
      next: 'store_token_secret_reference'
    });
  },

  async status(): Promise<IntegrationStatusPayload> {
    const [primarySquare, secondarySquare, xero, syncRuns] = await Promise.all([
      providerStatus('SQUARE', 'primary'),
      providerStatus('SQUARE', 'secondary'),
      providerStatus('XERO'),
      latestSyncRuns()
    ]);

    return {
      generatedAt: new Date().toISOString(),
      square: primarySquare,
      squareAccounts: {
        primary: primarySquare,
        secondary: secondarySquare
      },
      xero,
      meta: metaStatus(),
      latestSyncRuns: syncRuns,
      tokenStorage: integrationTokenEncryptionStatus()
    };
  },

  async checkSquareHealth(actor: AuthUser, accountInput?: unknown) {
    const accountKey = normaliseSquareAccountKey(accountInput);
    const checkedAt = new Date();
    const config = providerConfig('SQUARE', accountKey);
    const tokenStorage = integrationTokenEncryptionStatus();
    const base = {
      provider: 'square' as const,
      accountKey,
      label: squareAccountConfig(accountKey).label,
      checkedAt: checkedAt.toISOString(),
      environment: config.environment,
      apiVersion: config.apiVersion
    };

    if (!config.configured || !tokenStorage.configured) {
      return {
        ...base,
        connected: false,
        tokenStatus: 'configuration_missing',
        locationCount: 0,
        locations: [],
        message: 'Square health cannot run until Square env vars and token encryption are configured.'
      };
    }

    let connection: Awaited<ReturnType<typeof connectionSelect>> | null = null;
    try {
      connection = await connectionSelect('SQUARE', accountKey);
    } catch (error) {
      if (!isMissingIntegrationStorage(error)) throw error;
      return {
        ...base,
        connected: false,
        tokenStatus: 'configuration_missing',
        locationCount: 0,
        locations: [],
        message: 'Integration database setup is not active yet.'
      };
    }

    if (!connection || connection.status !== 'CONNECTED') {
      return {
        ...base,
        connected: false,
        tokenStatus: 'not_connected',
        locationCount: 0,
        locations: [],
        message: 'Square is not connected. No health check was sent to Square.'
      };
    }

    try {
      const response = await listSquareLocations(connection);
      const syncedAt = new Date();
      const locations = response.locations.map(squareLocationSummary).filter((location) => location.id);
      const updated = await prisma.integrationConnection.update({
        where: { id: response.connection.id },
        data: {
          providerAccountName: locations[0]?.businessName ?? response.connection.providerAccountName,
          lastSyncAt: syncedAt,
          lastSyncStatus: 'SUCCESS',
          lastError: null,
          metadata: squareMetadata({
            accountKey,
            existing: response.connection.metadata,
            locations: response.locations,
            syncedAt
          })
        }
      });
      await prisma.integrationSyncRun.create({
        data: {
          provider: 'SQUARE',
          connectionId: updated.id,
          syncType: 'TEST',
          status: 'SUCCESS',
          finishedAt: syncedAt,
          recordsImported: locations.length
        }
      });
      await recordEvent({
        provider: 'SQUARE',
        connectionId: updated.id,
        eventType: 'HEALTH_CHECKED',
        summary: 'Square health check completed. Locations were read; no payments or orders were synced.',
        actor,
        metadata: {
          tokenStatus: response.tokenStatus,
          accountKey,
          locationCount: locations.length
        }
      });
      return {
        ...base,
        connected: true,
        tokenStatus: response.tokenStatus,
        merchantId: updated.providerAccountId,
        merchantName: updated.providerAccountName,
        locationCount: locations.length,
        locations,
        message: 'Square is reachable. Locations were read only; no payments, orders, gift cards or inventory were synced.'
      };
    } catch (error) {
      await prisma.integrationSyncRun.create({
        data: {
          provider: 'SQUARE',
          connectionId: connection.id,
          syncType: 'TEST',
          status: 'ERROR',
          finishedAt: new Date(),
          errorSummary: safeErrorMessage(error).slice(0, 500)
        }
      });
      await prisma.integrationConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'ERROR',
          lastError: safeErrorMessage(error).slice(0, 500)
        }
      });
      await recordEvent({
        provider: 'SQUARE',
        connectionId: connection.id,
        eventType: 'HEALTH_CHECK_FAILED',
        summary: 'Square health check failed. No data was synced.',
        actor,
        metadata: {
          message: safeErrorMessage(error)
        }
      });
      return {
        ...base,
        connected: true,
        tokenStatus: 'request_failed',
        locationCount: squareMetadataStatus(connection).locationCount,
        locations: squareMetadataStatus(connection).locations,
        message: safeErrorMessage(error)
      };
    }
  },

  async refreshSquare(actor: AuthUser, accountInput?: unknown) {
    const accountKey = normaliseSquareAccountKey(accountInput);
    const connection = await connectedSquareConnection(accountKey);
    const refreshed = await refreshSquareConnection(connection);
    await recordEvent({
      provider: 'SQUARE',
      connectionId: refreshed.id,
      eventType: 'TOKEN_REFRESHED',
      summary: `${squareAccountConfig(accountKey).label} Square OAuth token was refreshed manually.`,
      actor
    });
    return {
      ok: true,
      provider: 'square' as const,
      accountKey,
      expiresAt: toIso(refreshed.tokenExpiresAt)
    };
  },

  async syncSquareLocations(actor: AuthUser, accountInput?: unknown, options?: { syncType?: ImportRunMode }) {
    const accountKey = normaliseSquareAccountKey(accountInput);
    const connection = await connectedSquareConnection(accountKey);
    const response = await listSquareLocations(connection);
    const syncedAt = new Date();
    const locations = response.locations.map(squareLocationSummary).filter((location) => location.id);
    const updated = await prisma.integrationConnection.update({
      where: { id: response.connection.id },
      data: {
        providerAccountName: locations[0]?.businessName ?? response.connection.providerAccountName,
        lastSyncAt: syncedAt,
        lastSyncStatus: 'SUCCESS',
        lastError: null,
        metadata: squareMetadata({
          accountKey,
          existing: response.connection.metadata,
          locations: response.locations,
          syncedAt
        })
      }
    });
    await prisma.integrationSyncRun.create({
      data: {
        provider: 'SQUARE',
        connectionId: updated.id,
        syncType: options?.syncType ?? 'MANUAL',
        status: 'SUCCESS',
        finishedAt: syncedAt,
        recordsImported: locations.length
      }
    });
    await recordEvent({
      provider: 'SQUARE',
      connectionId: updated.id,
      eventType: 'LOCATIONS_SYNCED',
      summary: `${squareAccountConfig(accountKey).label} Square location sync finished: ${locations.length} locations read.`,
      actor,
      metadata: { accountKey, locationCount: locations.length, syncType: options?.syncType ?? 'MANUAL' }
    });
    return {
      provider: 'square' as const,
      accountKey,
      generatedAt: syncedAt.toISOString(),
      environment: providerConfig('SQUARE', accountKey).environment,
      apiVersion: env.integrations.square.apiVersion,
      locationCount: locations.length,
      locations,
      tokenStatus: response.tokenStatus
    };
  },

  async checkXeroHealth(actor: AuthUser): Promise<XeroConnectionHealthPayload> {
    const checkedAt = new Date();
    const config = providerConfig('XERO');
    const tokenStorage = integrationTokenEncryptionStatus();
    const base = {
      provider: 'xero' as const,
      checkedAt: checkedAt.toISOString(),
      dataSyncRunning: false as const
    };

    if (!config.configured || !tokenStorage.configured) {
      return {
        ...base,
        connected: false,
        tenantName: null,
        tenantIdMasked: null,
        tenantCount: null,
        tenantStatus: 'not_checked',
        tenantSelectionRequired: false,
        tokenStatus: 'configuration_missing',
        availableScopes: [],
        errorCategory: 'configuration_missing',
        message: 'Xero connection health cannot run until Xero env vars and token encryption are configured.'
      };
    }

    let connection: Awaited<ReturnType<typeof connectionSelect>> | null = null;
    try {
      connection = await connectionSelect('XERO');
    } catch (error) {
      if (!isMissingIntegrationStorage(error)) throw error;
      return {
        ...base,
        connected: false,
        tenantName: null,
        tenantIdMasked: null,
        tenantCount: null,
        tenantStatus: 'not_checked',
        tenantSelectionRequired: false,
        tokenStatus: 'configuration_missing',
        availableScopes: [],
        errorCategory: 'integration_storage_missing',
        message: 'Integration database setup is not active yet.'
      };
    }

    if (!connection || connection.status !== 'CONNECTED') {
      return {
        ...base,
        connected: false,
        tenantName: null,
        tenantIdMasked: null,
        tenantCount: null,
        tenantStatus: 'not_checked',
        tenantSelectionRequired: false,
        tokenStatus: 'not_connected',
        availableScopes: scopesFromJson(connection?.scopes),
        errorCategory: 'not_connected',
        message: 'Xero is not connected. No health check was sent to Xero.'
      };
    }

    try {
      const response = await xeroGetJson<XeroTenantConnection[]>('/connections', {
        connection,
        requireTenant: false
      });
      const tenants = Array.isArray(response.data) ? response.data : [];
      const currentTenant = connection.providerAccountId
        ? tenants.find((tenant) => tenant.tenantId === connection.providerAccountId) ?? null
        : null;
      const tenantStatus: XeroConnectionHealthPayload['tenantStatus'] =
        !connection.providerAccountId
          ? 'not_selected'
          : currentTenant
            ? 'reachable'
            : 'not_found';
      const tenantSelectionRequired = tenants.length > 1;
      const refreshedConnection = response.connection;
      const tenantName =
        refreshedConnection.providerAccountName ??
        currentTenant?.tenantName ??
        connection.providerAccountName ??
        null;

      await prisma.integrationSyncRun.create({
        data: {
          provider: 'XERO',
          connectionId: refreshedConnection.id,
          syncType: 'TEST',
          status: 'SUCCESS',
          finishedAt: new Date()
        }
      });
      await recordEvent({
        provider: 'XERO',
        connectionId: refreshedConnection.id,
        eventType: 'HEALTH_CHECKED',
        summary: 'Xero connection health check completed. No accounting records were synced.',
        actor,
        metadata: {
          tenantCount: tenants.length,
          tenantStatus,
          tokenStatus: response.tokenStatus
        }
      });

      return {
        ...base,
        connected: true,
        tenantName,
        tenantIdMasked: maskIdentifier(refreshedConnection.providerAccountId),
        tenantCount: tenants.length,
        tenantStatus,
        tenantSelectionRequired,
        tokenStatus: response.tokenStatus,
        availableScopes: scopesFromJson(refreshedConnection.scopes),
        errorCategory: null,
        message: tenantSelectionRequired
          ? 'Xero is reachable. Multiple tenants are available, so Alma is preserving the current tenant until tenant selection is added.'
          : 'Xero is reachable. No accounting records were synced.'
      };
    } catch (error) {
      const errorCategory = error instanceof HttpError && error.details && typeof error.details === 'object' && 'category' in error.details
        ? String((error.details as { category?: unknown }).category ?? 'xero_health_failed')
        : 'xero_health_failed';
      await prisma.integrationSyncRun.create({
        data: {
          provider: 'XERO',
          connectionId: connection.id,
          syncType: 'TEST',
          status: 'ERROR',
          finishedAt: new Date(),
          errorSummary: safeErrorMessage(error).slice(0, 500)
        }
      });
      await recordEvent({
        provider: 'XERO',
        connectionId: connection.id,
        eventType: 'HEALTH_CHECK_FAILED',
        summary: 'Xero connection health check failed. No accounting records were synced.',
        actor,
        metadata: {
          category: errorCategory,
          message: safeErrorMessage(error)
        }
      });

      return {
        ...base,
        connected: true,
        tenantName: connection.providerAccountName,
        tenantIdMasked: maskIdentifier(connection.providerAccountId),
        tenantCount: null,
        tenantStatus: connection.providerAccountId ? 'not_checked' : 'not_selected',
        tenantSelectionRequired: false,
        tokenStatus: tokenStatusFromHealthError(error),
        availableScopes: scopesFromJson(connection.scopes),
        errorCategory,
        message: safeErrorMessage(error)
      };
    }
  },

  async previewXeroSupplierContacts(query: Record<string, unknown>): Promise<XeroSupplierContactsPreviewPayload> {
    const limit = clampLimit(query.limit, 100, 500);
    const [{ contacts, connection }, suppliers] = await Promise.all([
      xeroContacts(limit),
      prisma.supplier.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      })
    ]);
    const previews = contacts
      .map((contact) => supplierContactPreview(contact, suppliers))
      .filter((preview): preview is XeroSupplierContactPreview => Boolean(preview));
    const warnings: string[] = [];
    if (previews.length === limit) warnings.push(`Preview limited to ${limit} contacts.`);

    return {
      generatedAt: new Date().toISOString(),
      connected: true,
      tenantName: connection.providerAccountName,
      contactsRead: contacts.length,
      supplierCandidates: previews.filter((preview) => preview.isSupplierCandidate).length,
      matchedSuppliers: previews.filter((preview) => preview.existingSupplierMatch).length,
      contacts: previews,
      warnings
    };
  },

  async importXeroSupplierContacts(
    input: unknown,
    actor: AuthUser,
    options?: { syncType?: ImportRunMode; eventType?: string }
  ): Promise<XeroSupplierContactsImportResult> {
    const data = xeroSupplierContactsImportInputSchema.parse(input);
    const limit = data.limit ?? 500;
    const { contacts, connection } = await xeroContacts(limit);
    const suppliers = await prisma.supplier.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    });
    const previews = contacts
      .map((contact) => {
        const preview = supplierContactPreview(contact, suppliers);
        return preview ? { contact, preview } : null;
      })
      .filter((entry): entry is { contact: XeroContact; preview: XeroSupplierContactPreview } => Boolean(entry));
    const selected = data.importAllCandidates
      ? previews.filter((entry) => entry.preview.isSupplierCandidate)
      : previews.filter((entry) => data.contactIds.includes(entry.preview.xeroContactId));

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let conflictCount = 0;
    const warnings: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const entry of selected) {
        const { contact, preview } = entry;
        if (!preview.isSupplierCandidate) {
          skippedCount += 1;
          warnings.push(`${preview.name} was skipped because it is not marked as a supplier in Xero.`);
          continue;
        }

        const name = preview.name.trim();
        if (!name) {
          skippedCount += 1;
          continue;
        }

        const existing = preview.existingSupplierId
          ? await tx.supplier.findUnique({ where: { id: preview.existingSupplierId } })
          : await tx.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });

        const patch = {
          email: preview.email || existing?.email || null,
          phone: preview.phone || existing?.phone || null,
          address: addressFromXero(contact) || existing?.address || null,
          notes: existing?.notes ?? 'Imported from Xero supplier contact. Xero contact id is not stored until provider reference fields are added.'
        };

        if (existing) {
          await tx.supplier.update({
            where: { id: existing.id },
            data: patch
          });
          updatedCount += 1;
        } else {
          const duplicateMatch: Prisma.SupplierWhereInput[] = [
            { name: { equals: name, mode: 'insensitive' } }
          ];
          if (preview.email) {
            duplicateMatch.push({ email: { equals: preview.email, mode: 'insensitive' } });
          }
          const duplicate = await tx.supplier.findFirst({
            where: {
              OR: duplicateMatch
            }
          });
          if (duplicate) {
            conflictCount += 1;
            warnings.push(`${name} was skipped because it matches another supplier.`);
            continue;
          }
          await tx.supplier.create({
            data: {
              name,
              email: preview.email,
              phone: preview.phone,
              address: addressFromXero(contact),
              notes: 'Imported from Xero supplier contact. Xero contact id is not stored until provider reference fields are added.',
              status: 'ACTIVE'
            }
          });
          createdCount += 1;
        }
      }

      await tx.integrationSyncRun.create({
        data: {
          provider: 'XERO',
          connectionId: connection.id,
          syncType: options?.syncType ?? 'MANUAL',
          status: 'SUCCESS',
          finishedAt: new Date(),
          recordsImported: createdCount,
          recordsUpdated: updatedCount,
          errorSummary: warnings.length ? warnings.slice(0, 5).join(' | ') : null
        }
      });
    });

    await recordEvent({
      provider: 'XERO',
      connectionId: connection.id,
      eventType: options?.eventType ?? 'SUPPLIER_CONTACTS_IMPORTED',
      summary: `Xero supplier contact import finished: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      actor,
      metadata: { createdCount, updatedCount, skippedCount, conflictCount, syncType: options?.syncType ?? 'MANUAL' }
    });

    return {
      generatedAt: new Date().toISOString(),
      createdCount,
      updatedCount,
      skippedCount,
      conflictCount,
      warnings
    };
  },

  async previewXeroSupplierBills(query: Record<string, unknown>): Promise<XeroSupplierBillsPreviewPayload> {
    const limit = clampLimit(query.limit, 30, 100);
    const [{ bills, connection, start, end }, suppliers, existingInvoices] = await Promise.all([
      xeroBills(query, limit),
      prisma.supplier.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true, email: true },
        orderBy: { name: 'asc' }
      }),
      prisma.supplierInvoice.findMany({
        where: { source: 'XERO' },
        select: {
          id: true,
          source: true,
          invoiceKey: true,
          externalInvoiceId: true,
          invoiceNumber: true,
          supplierName: true,
          invoiceDate: true,
          totalCents: true
        },
        orderBy: { importedAt: 'desc' },
        take: 500
      })
    ]);
    const previews = bills
      .map((bill) => billPreview(bill, suppliers, existingInvoices))
      .filter((preview): preview is XeroSupplierBillPreview => Boolean(preview));
    const statusCounts = previews.reduce<Record<string, number>>((accumulator, preview) => {
      accumulator[preview.status] = (accumulator[preview.status] ?? 0) + 1;
      return accumulator;
    }, {});
    const warnings: string[] = [];
    if (previews.length === limit) warnings.push(`Preview limited to ${limit} bills.`);

    return {
      generatedAt: new Date().toISOString(),
      connected: true,
      tenantName: connection.providerAccountName,
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
      billsRead: bills.length,
      billsPreviewed: previews.length,
      statusCounts,
      bills: previews,
      warnings
    };
  },

  async importXeroSupplierBills(
    input: unknown,
    actor: AuthUser,
    options?: { syncType?: ImportRunMode; eventType?: string }
  ): Promise<XeroSupplierBillsImportResult> {
    const data = xeroSupplierBillsImportInputSchema.parse(input);
    const limit = data.limit ?? 100;
    const { bills, connection } = await xeroBills({
      startDate: data.startDate,
      endDate: data.endDate,
      limit
    }, limit);
    const suppliers = await prisma.supplier.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' }
    });
    const existingInvoices = await prisma.supplierInvoice.findMany({
      where: { source: 'XERO' },
      select: {
        id: true,
        source: true,
        invoiceKey: true,
        externalInvoiceId: true,
        invoiceNumber: true,
        supplierName: true,
        invoiceDate: true,
        totalCents: true
      },
      orderBy: { importedAt: 'desc' },
      take: 500
    });
    const matchItems = await prisma.stockItem.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' }
    });
    const selectedBills = bills.filter((bill) => {
      const id = xeroBillId(bill);
      return id ? data.billIds.includes(id) : false;
    });

    let importedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let supplierCreatedCount = 0;
    let lineCount = 0;
    const warnings: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const bill of selectedBills) {
        const id = xeroBillId(bill);
        if (!id) {
          skippedCount += 1;
          continue;
        }

        const duplicate = duplicateForBill(bill, existingInvoices);
        if (duplicate.duplicateStatus !== 'new') {
          duplicateCount += 1;
          warnings.push(`${billInvoiceNumber(bill) ?? maskIdentifier(id)} was skipped as a duplicate.`);
          continue;
        }

        const supplierName = optionalText(bill.Contact?.Name) ?? 'Unknown supplier';
        const supplierEmail = optionalText(bill.Contact?.EmailAddress);
        let supplierId = matchSupplier({ name: supplierName, email: supplierEmail }, suppliers).supplierId;
        if (!supplierId && !data.allowCreateSuppliers) {
          skippedCount += 1;
          warnings.push(`${billInvoiceNumber(bill) ?? maskIdentifier(id)} was skipped because the supplier is missing in Alma.`);
          continue;
        }
        if (!supplierId && data.allowCreateSuppliers && supplierName !== 'Unknown supplier') {
          const created = await tx.supplier.create({
            data: {
              name: supplierName,
              email: supplierEmail,
              phone: phoneFromXero(bill.Contact ?? {}),
              address: addressFromXero(bill.Contact ?? {}),
              notes: 'Created during explicit Xero bill import. Xero contact id is not stored until provider reference fields are added.',
              status: 'ACTIVE'
            }
          });
          supplierId = created.id;
          suppliers.push({ id: created.id, name: created.name, email: created.email });
          supplierCreatedCount += 1;
        }

        const invoiceDate = parseXeroDate(bill.DateString ?? bill.Date);
        const dueDate = parseXeroDate(bill.DueDateString ?? bill.DueDate);
        const invoice = await tx.supplierInvoice.create({
          data: {
            source: 'XERO',
            invoiceKey: id,
            externalInvoiceId: id,
            invoiceNumber: optionalText(bill.InvoiceNumber) ?? optionalText(bill.Reference),
            supplierId,
            supplierName,
            supplierEmail,
            venue: optionalText(data.venue),
            invoiceDate,
            dueDate,
            currencyCode: optionalText(bill.CurrencyCode) ?? 'AUD',
            status: optionalText(bill.Status) ?? 'DRAFT',
            subtotalCents: moneyToCents(bill.SubTotal),
            taxCents: moneyToCents(bill.TotalTax),
            totalCents: moneyToCents(bill.Total),
            sourceFileName: 'Xero supplier bill sync',
            sourceFileType: 'application/xero+json',
            sourceMetadata: {
              importedFrom: 'xero',
              reference: optionalText(bill.Reference),
              importedBy: actor.email ?? actor.id,
              importedAt: new Date().toISOString()
            }
          }
        });

        for (const [index, line] of (bill.LineItems ?? []).entries()) {
          const itemCode = optionalText(line.ItemCode);
          const description = optionalText(line.Description) ?? 'Xero bill line';
          const exactSkuMatch = itemCode
            ? matchItems.find((item) => item.sku && normaliseMatchText(item.sku) === normaliseMatchText(itemCode))
            : null;
          const exactNameMatch = matchItems.find((item) => normaliseMatchText(item.name) === normaliseMatchText(description));
          const itemId = exactSkuMatch?.id ?? exactNameMatch?.id ?? null;
          await tx.supplierInvoiceLine.create({
            data: {
              supplierInvoiceId: invoice.id,
              lineNumber: index + 1,
              lineKey: lineKey(line, index),
              externalLineId: optionalText(line.LineItemID),
              description,
              itemCode,
              accountCode: optionalText(line.AccountCode),
              quantity: typeof line.Quantity === 'number' ? line.Quantity : 0,
              unit: null,
              unitAmountCents: moneyToCents(line.UnitAmount),
              lineAmountCents: moneyToCents(line.LineAmount),
              taxAmountCents: moneyToCents(line.TaxAmount),
              itemId,
              matchingStatus: itemId ? 'AUTO_MATCHED' : 'NEEDS_REVIEW',
              sourceMetadata: {
                importedFrom: 'xero',
                accountCode: optionalText(line.AccountCode)
              }
            }
          });
          lineCount += 1;
        }

        existingInvoices.push({
          id: invoice.id,
          source: invoice.source,
          invoiceKey: invoice.invoiceKey,
          externalInvoiceId: invoice.externalInvoiceId,
          invoiceNumber: invoice.invoiceNumber,
          supplierName: invoice.supplierName,
          invoiceDate: invoice.invoiceDate,
          totalCents: invoice.totalCents
        });
        importedCount += 1;
      }

      await tx.integrationSyncRun.create({
        data: {
          provider: 'XERO',
          connectionId: connection.id,
          syncType: options?.syncType ?? 'MANUAL',
          status: 'SUCCESS',
          finishedAt: new Date(),
          recordsImported: importedCount,
          recordsUpdated: 0,
          errorSummary: warnings.length ? warnings.slice(0, 5).join(' | ') : null
        }
      });
    });

    await recordEvent({
      provider: 'XERO',
      connectionId: connection.id,
      eventType: options?.eventType ?? 'SUPPLIER_BILLS_IMPORTED',
      summary: `Xero supplier bill import finished: ${importedCount} imported, ${skippedCount} skipped, ${duplicateCount} duplicate.`,
      actor,
      metadata: { importedCount, skippedCount, duplicateCount, supplierCreatedCount, lineCount, syncType: options?.syncType ?? 'MANUAL' }
    });

    return {
      generatedAt: new Date().toISOString(),
      importedCount,
      skippedCount,
      duplicateCount,
      supplierCreatedCount,
      lineCount,
      warnings
    };
  },

  async importSquareSales(
    input: Record<string, unknown> = {},
    actor: AuthUser,
    options?: { syncType?: ImportRunMode; eventType?: string }
  ) {
    const accountKey = normaliseSquareAccountKey(input.account ?? input.accountKey);
    const lookbackDays = clampLimit(input.lookbackDays, DEFAULT_SCHEDULED_SQUARE_SALES_LOOKBACK_DAYS, 90);
    const limit = clampLimit(input.limit, DEFAULT_SQUARE_PAYMENT_IMPORT_LIMIT, 1000);
    const { start, end } = squareImportDateRange(input, lookbackDays);
    const connection = await connectedSquareConnection(accountKey);
    const response = await listSquarePayments({ connection, beginTime: start, endTime: end, limit });
    const squareStatus = squareMetadataStatus(response.connection);
    const locationsById = new Map(squareStatus.locations.map((location) => [location.id, location]));
    const venues = await configuredVenueNames();
    const source = `square:${accountKey}`;
    const warnings: string[] = [];
    const grouped = new Map<string, {
      venue: string;
      serviceDateKey: string;
      serviceDate: Date;
      source: string;
      externalId: string;
      salesCents: number;
      paymentCount: number;
      locationId: string;
      locationName: string;
      currency: string | null;
    }>();
    let skippedCount = 0;

    for (const payment of response.payments) {
      if (trimText(payment.status).toUpperCase() !== 'COMPLETED') {
        skippedCount += 1;
        continue;
      }
      const paymentDate = providerDate(payment.created_at);
      if (!paymentDate) {
        skippedCount += 1;
        continue;
      }
      const amountCents = squarePaymentAmountCents(payment);
      if (amountCents <= 0) {
        skippedCount += 1;
        continue;
      }

      const locationId = optionalText(payment.location_id) ?? 'account';
      const location = locationsById.get(locationId) ?? null;
      const timeZone = location?.timezone || 'Australia/Sydney';
      const serviceDateKey = dateKeyInTimeZone(paymentDate, timeZone);
      const venue = squarePaymentVenue({ accountKey, location, venues });
      const externalId = `${source}:${locationId}:${serviceDateKey}`;
      const key = `${venue}|${serviceDateKey}|${externalId}`;
      const existing = grouped.get(key) ?? {
        venue,
        serviceDateKey,
        serviceDate: startOfUtcDate(serviceDateKey),
        source,
        externalId,
        salesCents: 0,
        paymentCount: 0,
        locationId,
        locationName: location?.name ?? location?.businessName ?? squareAccountConfig(accountKey).label,
        currency: optionalText(payment.total_money?.currency ?? payment.amount_money?.currency)
      };
      existing.salesCents += amountCents;
      existing.paymentCount += 1;
      grouped.set(key, existing);
    }

    const rows = Array.from(grouped.values());
    if (response.limited) warnings.push(`Square returned the first ${limit} payments only. Run a shorter date range to import the remaining payments.`);
    if (skippedCount > 0) warnings.push(`${skippedCount} Square payments were skipped because they were not completed, had no date, or had no positive net amount.`);

    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.salesActualEntry.upsert({
          where: {
            venue_serviceDate_source_externalId: {
              venue: row.venue,
              serviceDate: row.serviceDate,
              source: row.source,
              externalId: row.externalId
            }
          },
          create: {
            venue: row.venue,
            serviceDate: row.serviceDate,
            salesCents: row.salesCents,
            source: row.source,
            externalId: row.externalId,
            notes: `${squareAccountConfig(accountKey).label} Square ${row.locationName}: ${row.paymentCount} completed payments${row.currency ? ` (${row.currency})` : ''}.`,
            importedById: actor.id
          },
          update: {
            salesCents: row.salesCents,
            notes: `${squareAccountConfig(accountKey).label} Square ${row.locationName}: ${row.paymentCount} completed payments${row.currency ? ` (${row.currency})` : ''}.`,
            importedById: actor.id
          }
        });
      }

      await tx.integrationConnection.update({
        where: { id: response.connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastError: null
        }
      });
      await tx.integrationSyncRun.create({
        data: {
          provider: 'SQUARE',
          connectionId: response.connection.id,
          syncType: options?.syncType ?? 'MANUAL',
          status: 'SUCCESS',
          finishedAt: new Date(),
          recordsImported: rows.length,
          recordsUpdated: response.payments.length,
          errorSummary: warnings.length ? warnings.slice(0, 5).join(' | ') : null
        }
      });
    });

    await recordEvent({
      provider: 'SQUARE',
      connectionId: response.connection.id,
      eventType: options?.eventType ?? 'SQUARE_SALES_IMPORTED',
      summary: `${squareAccountConfig(accountKey).label} Square sales import finished: ${rows.length} sales rows from ${response.payments.length} payments.`,
      actor,
      metadata: {
        accountKey,
        syncType: options?.syncType ?? 'MANUAL',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        paymentsRead: response.payments.length,
        salesRowsUpserted: rows.length,
        skippedCount,
        tokenStatus: response.tokenStatus,
        limited: response.limited
      }
    });

    return {
      provider: 'square' as const,
      accountKey,
      label: squareAccountConfig(accountKey).label,
      generatedAt: new Date().toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      paymentsRead: response.payments.length,
      salesRowsUpserted: rows.length,
      skippedCount,
      totalSalesCents: rows.reduce((sum, row) => sum + row.salesCents, 0),
      tokenStatus: response.tokenStatus,
      limited: response.limited,
      rows: rows.map((row) => ({
        venue: row.venue,
        serviceDate: row.serviceDateKey,
        source: row.source,
        externalId: row.externalId,
        salesCents: row.salesCents,
        paymentCount: row.paymentCount,
        locationId: row.locationId,
        locationName: row.locationName
      })),
      warnings
    };
  },

  async runScheduledXeroImport(input: Record<string, unknown> = {}) {
    const generatedAt = new Date();
    const lookbackDays = clampLimit(input.lookbackDays, DEFAULT_SCHEDULED_XERO_LOOKBACK_DAYS, 180);
    const billsLimit = clampLimit(input.billsLimit, DEFAULT_SCHEDULED_XERO_BILLS_LIMIT, 100);
    const contactsLimit = clampLimit(input.contactsLimit, DEFAULT_SCHEDULED_XERO_CONTACTS_LIMIT, 500);
    const includeContacts = input.includeContacts !== false;
    const includeBills = input.includeBills !== false;
    const warnings: string[] = [];

    let contacts: XeroSupplierContactsImportResult | null = null;
    if (includeContacts) {
      contacts = await integrationService.importXeroSupplierContacts(
        { importAllCandidates: true, limit: contactsLimit },
        integrationSchedulerActor,
        { syncType: 'SCHEDULED', eventType: 'SCHEDULED_SUPPLIER_CONTACTS_IMPORTED' }
      );
    }

    let bills: XeroSupplierBillsImportResult | null = null;
    let billCandidates = 0;
    let billIds: string[] = [];
    if (includeBills) {
      const end = generatedAt;
      const start = new Date(end);
      start.setDate(start.getDate() - lookbackDays);
      const startDate = isoDateOnly(start);
      const endDate = isoDateOnly(end);
      const preview = await integrationService.previewXeroSupplierBills({
        startDate,
        endDate,
        limit: billsLimit,
        statuses: 'AUTHORISED,PAID'
      });
      const importableBills = preview.bills.filter((bill) =>
        bill.duplicateStatus === 'new' &&
        bill.supplierMatchStatus === 'matched' &&
        bill.lineCount > 0
      );
      billCandidates = preview.bills.length;
      billIds = importableBills.map((bill) => bill.xeroInvoiceId);

      const skippedForReview = preview.bills.length - importableBills.length;
      if (skippedForReview > 0) {
        warnings.push(`${skippedForReview} Xero bills were left for manual review because they were duplicates, missing supplier matches, or had no lines.`);
      }

      if (billIds.length > 0) {
        bills = await integrationService.importXeroSupplierBills(
          {
            billIds,
            startDate,
            endDate,
            limit: billsLimit,
            allowCreateSuppliers: false,
            confirmationText: 'IMPORT XERO BILLS'
          },
          integrationSchedulerActor,
          { syncType: 'SCHEDULED', eventType: 'SCHEDULED_SUPPLIER_BILLS_IMPORTED' }
        );
      } else {
        const connection = await connectedXeroConnection();
        await prisma.integrationSyncRun.create({
          data: {
            provider: 'XERO',
            connectionId: connection.id,
            syncType: 'SCHEDULED',
            status: 'SUCCESS',
            finishedAt: new Date(),
            recordsImported: 0,
            recordsUpdated: 0,
            errorSummary: warnings.length ? warnings.slice(0, 5).join(' | ') : 'No new matched Xero supplier bills to import.'
          }
        });
        await recordEvent({
          provider: 'XERO',
          connectionId: connection.id,
          eventType: 'SCHEDULED_SUPPLIER_BILLS_SKIPPED',
          summary: 'Scheduled Xero supplier bill import found no new matched bills to import.',
          actor: integrationSchedulerActor,
          metadata: {
            lookbackDays,
            billsLimit,
            billsPreviewed: preview.bills.length,
            skippedForReview
          }
        });
        bills = {
          generatedAt: new Date().toISOString(),
          importedCount: 0,
          skippedCount: skippedForReview,
          duplicateCount: preview.bills.filter((bill) => bill.duplicateStatus !== 'new').length,
          supplierCreatedCount: 0,
          lineCount: 0,
          warnings
        };
      }
    }

    return {
      provider: 'xero' as const,
      mode: 'scheduled',
      generatedAt: generatedAt.toISOString(),
      lookbackDays,
      contactsLimit,
      billsLimit,
      includeContacts,
      includeBills,
      contacts,
      bills,
      billCandidates,
      billIdsImported: billIds.length,
      warnings
    };
  },

  async runScheduledSquareSync(input: Record<string, unknown> = {}) {
    const accountInput = optionalText(input.account);
    const accounts = accountInput
      ? [normaliseSquareAccountKey(accountInput)]
      : SQUARE_ACCOUNT_KEYS;
    const includeSales = input.includeSales !== false;
    const results: Array<{
      accountKey: SquareAccountKey;
      label: string;
      status: 'synced' | 'skipped' | 'error';
      locationCount: number;
      salesRowsUpserted: number;
      paymentsRead: number;
      message: string;
    }> = [];

    for (const accountKey of accounts) {
      const label = squareAccountConfig(accountKey).label;
      try {
        const status = await providerStatus('SQUARE', accountKey);
        if (!status.connected) {
          results.push({
            accountKey,
            label,
            status: 'skipped',
            locationCount: 0,
            salesRowsUpserted: 0,
            paymentsRead: 0,
            message: status.connectBlockedReason ?? `${label} Square is not connected.`
          });
          continue;
        }

        const sync = await integrationService.syncSquareLocations(
          integrationSchedulerActor,
          accountKey,
          { syncType: 'SCHEDULED' }
        );
        const sales = includeSales
          ? await integrationService.importSquareSales(
            {
              account: accountKey,
              lookbackDays: input.salesLookbackDays ?? input.lookbackDays ?? DEFAULT_SCHEDULED_SQUARE_SALES_LOOKBACK_DAYS,
              limit: input.salesLimit ?? input.limit ?? DEFAULT_SQUARE_PAYMENT_IMPORT_LIMIT
            },
            integrationSchedulerActor,
            { syncType: 'SCHEDULED', eventType: 'SCHEDULED_SQUARE_SALES_IMPORTED' }
          )
          : null;
        results.push({
          accountKey,
          label,
          status: 'synced',
          locationCount: sync.locationCount,
          salesRowsUpserted: sales?.salesRowsUpserted ?? 0,
          paymentsRead: sales?.paymentsRead ?? 0,
          message: includeSales
            ? 'Square locations and payment sales totals synced into Reports sales actuals. Orders and inventory were not imported.'
            : 'Square locations synced. Payments, orders and inventory were not imported in this scheduled maintenance run.'
        });
      } catch (error) {
        const connection = await connectionSelect('SQUARE', accountKey).catch(() => null);
        if (connection) {
          await prisma.integrationSyncRun.create({
            data: {
              provider: 'SQUARE',
              connectionId: connection.id,
              syncType: 'SCHEDULED',
              status: 'ERROR',
              finishedAt: new Date(),
              errorSummary: safeErrorMessage(error).slice(0, 500)
            }
          });
          await recordEvent({
            provider: 'SQUARE',
            connectionId: connection.id,
            eventType: 'SCHEDULED_LOCATION_SYNC_FAILED',
            summary: `${label} Square scheduled location sync failed.`,
            actor: integrationSchedulerActor,
            metadata: { accountKey, message: safeErrorMessage(error) }
          });
        }
        results.push({
          accountKey,
          label,
          status: 'error',
          locationCount: 0,
          salesRowsUpserted: 0,
          paymentsRead: 0,
          message: safeErrorMessage(error)
        });
      }
    }

    return {
      provider: 'square' as const,
      mode: 'scheduled',
      generatedAt: new Date().toISOString(),
      includeSales,
      accounts: results,
      syncedAccounts: results.filter((result) => result.status === 'synced').length,
      skippedAccounts: results.filter((result) => result.status === 'skipped').length,
      failedAccounts: results.filter((result) => result.status === 'error').length,
      paymentsRead: results.reduce((sum, result) => sum + result.paymentsRead, 0),
      salesRowsUpserted: results.reduce((sum, result) => sum + result.salesRowsUpserted, 0)
    };
  },

  async runScheduledIntegrationImports(input: Record<string, unknown> = {}) {
    const includeSquare = input.includeSquare !== false;
    const includeXero = input.includeXero !== false;
    const results: { square: unknown | null; xero: unknown | null } = { square: null, xero: null };
    if (includeSquare) results.square = await integrationService.runScheduledSquareSync(input.square && typeof input.square === 'object' && !Array.isArray(input.square) ? input.square as Record<string, unknown> : input);
    if (includeXero) results.xero = await integrationService.runScheduledXeroImport(input.xero && typeof input.xero === 'object' && !Array.isArray(input.xero) ? input.xero as Record<string, unknown> : input);
    return {
      generatedAt: new Date().toISOString(),
      mode: 'scheduled',
      includeSquare,
      includeXero,
      ...results
    };
  },

  async startConnect(providerInput: string, actor: AuthUser, accountInput?: unknown): Promise<IntegrationConnectResponse> {
    const provider = normaliseProvider(providerInput);
    const accountKey = provider === 'SQUARE' ? normaliseSquareAccountKey(accountInput) : undefined;
    const status = await providerStatus(provider, accountKey);
    if (!status.canConnect) {
      throw new HttpError(503, status.connectBlockedReason ?? 'Integration connection is not configured.');
    }

    const rawState = provider === 'SQUARE' && accountKey ? createSquareState(accountKey) : crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await prisma.integrationOAuthState.create({
      data: {
        provider,
        stateHash: hashState(rawState),
        createdByUserId: actor.id,
        redirectPath: '/admin#integrations',
        expiresAt
      }
    });
    await recordEvent({
      provider,
      eventType: 'CONNECT_STARTED',
      summary: provider === 'SQUARE' && accountKey
        ? `${squareAccountConfig(accountKey).label} Square OAuth connection started.`
        : `${PROVIDER_COPY[provider].label} OAuth connection started.`,
      actor,
      metadata: provider === 'SQUARE' && accountKey ? { accountKey } : {}
    });

    if (provider === 'SQUARE' && accountKey) {
      const config = providerConfig('SQUARE', accountKey);
      const account = squareAccountConfig(accountKey);
      const url = new URL(`${config.oauthBaseUrl}/authorize`);
      url.searchParams.set('client_id', account.applicationId);
      url.searchParams.set('scope', SQUARE_SCOPES.join(' '));
      url.searchParams.set('session', 'false');
      url.searchParams.set('state', rawState);
      url.searchParams.set('redirect_uri', env.integrations.square.redirectUrl);
      return { provider: 'square', authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
    }

    const url = new URL('https://login.xero.com/identity/connect/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', env.integrations.xero.clientId);
    url.searchParams.set('redirect_uri', env.integrations.xero.redirectUrl);
    url.searchParams.set('scope', XERO_SCOPES.join(' '));
    url.searchParams.set('state', rawState);
    return { provider: 'xero', authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
  },

  async handleCallback(providerInput: string, query: Record<string, unknown>) {
    const provider = normaliseProvider(providerInput);
    const state = typeof query.state === 'string' ? query.state : '';
    const error = typeof query.error === 'string' ? query.error : '';
    const code = typeof query.code === 'string' ? query.code : '';
    let squareAccountKey: SquareAccountKey | undefined;
    if (provider === 'SQUARE') {
      if (!state) {
        await recordSquareCallbackFailure({ reason: 'missing_account' });
        return squareCallbackRedirect('missing_account');
      }
      try {
        squareAccountKey = squareAccountKeyFromState(state);
      } catch {
        await recordSquareCallbackFailure({ reason: 'unknown_account' });
        return squareCallbackRedirect('unknown_account');
      }
    }
    const stateRow = state
      ? await prisma.integrationOAuthState.findUnique({ where: { stateHash: hashState(state) } })
      : null;

    if (!stateRow || stateRow.provider !== provider || stateRow.consumedAt || stateRow.expiresAt < new Date()) {
      if (provider === 'SQUARE') {
        await recordSquareCallbackFailure({ reason: 'invalid_state', accountKey: squareAccountKey });
        return squareCallbackRedirect('invalid_state', squareAccountKey);
      }
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'invalid_state' });
    }

    await prisma.integrationOAuthState.update({
      where: { id: stateRow.id },
      data: { consumedAt: new Date() }
    });

    if (error || !code) {
      if (provider === 'SQUARE') {
        const reason = error ? 'square_error_param' : 'token_exchange_failed';
        await recordSquareCallbackFailure({ reason, accountKey: squareAccountKey });
        return squareCallbackRedirect(reason, squareAccountKey);
      }
      await recordEvent({
        provider,
        eventType: 'CONNECT_FAILED',
        summary: `${PROVIDER_COPY[provider].label} OAuth callback did not complete.`,
        metadata: { error: error || 'missing_code' }
      });
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'failed' });
    }

    try {
      if (provider === 'SQUARE' && squareAccountKey) {
        const config = providerConfig('SQUARE', squareAccountKey);
        if (!config.oauthConfigured) throw new HttpError(503, 'Square OAuth configuration is missing.');
        const token = await exchangeSquareToken(code, squareAccountKey);
        if (!token.access_token || !token.refresh_token) throw new HttpError(502, 'Square did not return OAuth tokens.');
        const locationResponse = await squareGetJsonWithAccessToken<SquareLocationsResponse>('/locations', token.access_token, squareAccountKey);
        const syncedAt = new Date();
        const connection = await prisma.integrationConnection.upsert({
          where: { id: (await connectionSelect('SQUARE', squareAccountKey))?.id ?? `__new_square_${squareAccountKey}_connection__` },
          update: {
            status: 'CONNECTED',
            connectedAt: new Date(),
            disconnectedAt: null,
            lastError: null,
            lastSyncAt: syncedAt,
            lastSyncStatus: 'SUCCESS',
            providerAccountId: token.merchant_id ?? null,
            providerAccountName: locationResponse.locations?.[0]?.business_name ?? token.merchant_id ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : SQUARE_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : null,
            metadata: squareMetadata({ accountKey: squareAccountKey, locations: locationResponse.locations ?? [], syncedAt }),
            updatedByUserId: stateRow.createdByUserId
          },
          create: {
            provider: 'SQUARE',
            status: 'CONNECTED',
            connectedAt: new Date(),
            lastSyncAt: syncedAt,
            lastSyncStatus: 'SUCCESS',
            providerAccountId: token.merchant_id ?? null,
            providerAccountName: locationResponse.locations?.[0]?.business_name ?? token.merchant_id ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : SQUARE_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : null,
            metadata: squareMetadata({ accountKey: squareAccountKey, locations: locationResponse.locations ?? [], syncedAt }),
            updatedByUserId: stateRow.createdByUserId
          }
        });
        await prisma.integrationSyncRun.create({
          data: {
            provider,
            connectionId: connection.id,
            syncType: 'OAUTH_CALLBACK',
            status: 'SUCCESS',
            finishedAt: new Date(),
            recordsImported: locationResponse.locations?.length ?? 0
          }
        });
        await recordEvent({
          provider,
          connectionId: connection.id,
          eventType: 'CONNECTED',
          summary: `${squareAccountConfig(squareAccountKey).label} Square connected successfully and locations were verified.`,
          metadata: {
            accountKey: squareAccountKey,
            environment: providerConfig('SQUARE', squareAccountKey).environment,
            locationCount: locationResponse.locations?.length ?? 0
          }
        });
      } else {
        const token = await exchangeXeroToken(code);
        if (!token.access_token || !token.refresh_token) throw new HttpError(502, 'Xero did not return OAuth tokens.');
        const tenant = await fetchXeroTenant(token.access_token);
        const connection = await prisma.integrationConnection.upsert({
          where: { id: (await connectionSelect('XERO'))?.id ?? '__new_xero_connection__' },
          update: {
            status: 'CONNECTED',
            connectedAt: new Date(),
            disconnectedAt: null,
            lastError: null,
            providerAccountId: tenant?.id ?? null,
            providerAccountName: tenant?.name ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : XERO_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            updatedByUserId: stateRow.createdByUserId
          },
          create: {
            provider: 'XERO',
            status: 'CONNECTED',
            connectedAt: new Date(),
            providerAccountId: tenant?.id ?? null,
            providerAccountName: tenant?.name ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : XERO_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            updatedByUserId: stateRow.createdByUserId
          }
        });
        await prisma.integrationSyncRun.create({
          data: { provider, connectionId: connection.id, syncType: 'OAUTH_CALLBACK', status: 'SUCCESS', finishedAt: new Date() }
        });
        await recordEvent({ provider, connectionId: connection.id, eventType: 'CONNECTED', summary: 'Xero connected successfully.' });
      }
      return frontendAdminRedirect({
        integration: PROVIDER_COPY[provider].key,
        status: 'connected',
        ...(provider === 'SQUARE' && squareAccountKey ? { account: squareAccountKey } : {})
      });
    } catch (callbackError) {
      if (provider === 'SQUARE') {
        const reason = squareCallbackReason(callbackError);
        await recordSquareCallbackFailure({ reason, accountKey: squareAccountKey });
        return squareCallbackRedirect(reason, squareAccountKey);
      }
      await recordEvent({
        provider,
        eventType: 'CONNECT_FAILED',
        summary: `${PROVIDER_COPY[provider].label} OAuth callback failed.`,
        metadata: {
          message: callbackError instanceof Error ? callbackError.message : 'Unknown callback error'
        }
      });
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'failed' });
    }
  },

  async disconnect(providerInput: string, actor: AuthUser, accountInput?: unknown) {
    const provider = normaliseProvider(providerInput);
    const accountKey = provider === 'SQUARE' ? normaliseSquareAccountKey(accountInput) : undefined;
    const connection = await connectionSelect(provider, accountKey);
    if (!connection) throw new HttpError(404, 'Integration connection not found.');
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        status: 'REVOKED',
        disconnectedAt: new Date(),
        tokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        lastError: null,
        updatedByUserId: actor.id
      }
    });
    await recordEvent({
      provider,
      connectionId: connection.id,
      eventType: 'DISCONNECTED',
      summary: provider === 'SQUARE' && accountKey
        ? `${squareAccountConfig(accountKey).label} Square disconnected locally.`
        : `${PROVIDER_COPY[provider].label} disconnected locally.`,
      actor,
      metadata: provider === 'SQUARE' && accountKey ? { accountKey } : {}
    });
    return { ok: true };
  },

  async test(providerInput: string, actor: AuthUser, accountInput?: unknown) {
    const provider = normaliseProvider(providerInput);
    if (provider === 'SQUARE') {
      return integrationService.checkSquareHealth(actor, accountInput);
    }
    const connection = await connectionSelect(provider);
    if (!connection || connection.status !== 'CONNECTED') {
      throw new HttpError(409, `${PROVIDER_COPY[provider].label} is not connected.`);
    }
    await prisma.integrationSyncRun.create({
      data: {
        provider,
        connectionId: connection.id,
        syncType: 'TEST',
        status: 'SUCCESS',
        finishedAt: new Date()
      }
    });
    await recordEvent({
      provider,
      connectionId: connection.id,
      eventType: 'TEST_RECORDED',
      summary: `${PROVIDER_COPY[provider].label} local connection metadata test recorded.`,
      actor
    });
    return { ok: true, mode: 'local_metadata_only' };
  },

  async handleSquareWebhook(req: Request, accountInput?: unknown) {
    const accountKey = normaliseSquareAccountKey(accountInput);
    const rawBody = rawBodyFromRequest(req);
    if (!verifySquareSignature(req, rawBody, accountKey)) {
      throw new HttpError(401, 'Invalid Square webhook signature.');
    }
    return recordWebhook('SQUARE', rawBody, accountKey);
  },

  async handleXeroWebhook(req: Request) {
    const rawBody = rawBodyFromRequest(req);
    if (!verifyXeroSignature(req, rawBody)) {
      throw new HttpError(401, 'Invalid Xero webhook signature.');
    }
    return recordWebhook('XERO', rawBody);
  }
};
