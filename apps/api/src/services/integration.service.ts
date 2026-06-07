import crypto from 'node:crypto';
import type { Request } from 'express';
import { Prisma, type IntegrationConnection } from '@prisma/client';
import { prisma } from '@alma/db';
import { z } from 'zod';
import type {
  AdminMetaIntegrationStatus,
  AuthUser,
  IntegrationConnectResponse,
  IntegrationProviderKey,
  IntegrationProviderStatus,
  IntegrationStatusPayload,
  SquareConfigMissingMap,
  XeroPayRateSyncResult,
  XeroScheduledImportStatus,
  XeroSupplierBillsImportResult,
  XeroSupplierBillsPreviewPayload,
  XeroSupplierBillPreview,
  XeroSupplierContactsImportResult,
  XeroSupplierContactsPreviewPayload,
  XeroSupplierContactPreview,
  XeroConnectionHealthPayload
} from '@alma/shared';
import {
  squareMenuAutoMatchInputSchema,
  squareMenuMappingQuerySchema,
  squareMenuMappingUpdateSchema,
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
import { deputyService } from './deputy.service.js';

type Provider = 'SQUARE' | 'XERO' | 'DEPUTY';
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
  'accounting.settings.read',
  'payroll.employees.read'
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
  },
  DEPUTY: {
    key: 'deputy',
    label: 'Deputy',
    powers: ['Roster shifts', 'employee records', 'compliance documents'],
    requiredSetup: ['Client ID', 'client secret', 'redirect URL']
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
  if (value === 'SQUARE' || value === 'XERO' || value === 'DEPUTY') return value;
  throw new HttpError(404, 'Integration provider not found.');
}

function normaliseSquareAccountKey(value: unknown): SquareAccountKey {
  if (value === 'secondary') return 'secondary';
  if (value === 'primary' || value === undefined || value === null || value === '') return 'primary';
  throw new HttpError(400, 'Unknown Square account.');
}

function inferSquareAccountKeyFromVenue(venue: string): SquareAccountKey {
  const v = venue.toLowerCase().trim();
  const secondaryLabel = env.integrations.square.accounts.secondary.label.toLowerCase().trim();
  if (secondaryLabel && (v === secondaryLabel || v.includes(secondaryLabel) || secondaryLabel.includes(v))) {
    return 'secondary';
  }
  return 'primary';
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
  if (provider === 'DEPUTY') {
    const configured = Boolean(
      env.integrations.deputy.clientId &&
        env.integrations.deputy.clientSecret &&
        env.integrations.deputy.redirectUrl
    );
    return {
      configured,
      oauthConfigured: configured,
      missingConfig: null,
      missingLabels: [],
      missingEnvVars: [
        env.integrations.deputy.clientId ? null : 'DEPUTY_CLIENT_ID',
        env.integrations.deputy.clientSecret ? null : 'DEPUTY_CLIENT_SECRET',
        env.integrations.deputy.redirectUrl ? null : 'DEPUTY_REDIRECT_URL'
      ].filter((value): value is string => Boolean(value)),
      environment: null,
      oauthBaseUrl: env.integrations.deputy.authorizeUrl,
      apiBaseUrl: null,
      apiVersion: null,
      redirectUri: env.integrations.deputy.redirectUrl,
      webhookUrl: null,
      webhookConfigured: false
    };
  }
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
  tip_money?: SquareMoney;
};

type SquarePaymentsResponse = {
  payments?: SquarePayment[];
  cursor?: string;
};

type SquareOrderLineItem = {
  uid?: string;
  name?: string;
  quantity?: string;
  catalog_object_id?: string;
  catalog_version?: number;
  variation_name?: string;
  item_type?: string;
  base_price_money?: SquareMoney;
  gross_sales_money?: SquareMoney;
  total_money?: SquareMoney;
  total_discount_money?: SquareMoney;
  total_tax_money?: SquareMoney;
};

type SquareOrder = {
  id?: string;
  location_id?: string;
  state?: string;
  ticket_name?: string;
  name?: string;
  total_money?: SquareMoney;
  created_at?: string;
  closed_at?: string;
  line_items?: SquareOrderLineItem[];
};

type SquareOrdersSearchResponse = {
  orders?: SquareOrder[];
  cursor?: string;
};

type SquareCatalogMoney = {
  amount?: number;
  currency?: string;
};

type SquareCatalogObject = {
  id?: string;
  type?: string;
  is_deleted?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
  item_data?: {
    name?: string;
    category_id?: string;
    variations?: SquareCatalogObject[];
  };
  item_variation_data?: {
    name?: string;
    item_id?: string;
    sku?: string;
    price_money?: SquareCatalogMoney;
  };
  category_data?: {
    name?: string;
  };
};

type SquareCatalogListResponse = {
  objects?: SquareCatalogObject[];
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
    lastLocationSyncAt: squareStatus?.lastLocationSyncAt ?? null,
    // Tenant IDs match the masking treatment of providerAccountId on
    // Xero. The raw id stays server-side — admin UI only needs the
    // masked id + name to render the multi-tenant list.
    tenants: provider === 'XERO'
      ? xeroTenantsFromConnection(connection).map((tenant) => ({
          idMasked: maskIdentifier(tenant.id),
          name: tenant.name,
          isPrimary: tenant.id === connection?.providerAccountId
        }))
      : undefined
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

async function xeroScheduledImportStatus(): Promise<XeroScheduledImportStatus> {
  const endpoint = `${env.publicApiUrl.replace(/\/+$/, '')}/api/integration-jobs/xero/import`;
  let runs: Awaited<ReturnType<typeof prisma.integrationSyncRun.findMany>> = [];
  try {
    runs = await prisma.integrationSyncRun.findMany({
      where: { provider: 'XERO', syncType: 'SCHEDULED' },
      orderBy: { startedAt: 'desc' },
      take: 20
    });
  } catch (error) {
    if (!isMissingIntegrationStorage(error)) throw error;
  }
  const last = runs[0] ?? null;
  const lastSuccess = runs.find((run) => run.status === 'SUCCESS') ?? null;
  const lastError = runs.find((run) => run.status === 'ERROR') ?? null;
  return {
    endpoint,
    schedulerSecretConfigured: Boolean(env.integrations.schedulerSecret),
    safeAutomaticImportEnabled: Boolean(env.integrations.schedulerSecret),
    lookbackDays: DEFAULT_SCHEDULED_XERO_LOOKBACK_DAYS,
    contactsLimit: DEFAULT_SCHEDULED_XERO_CONTACTS_LIMIT,
    billsLimit: DEFAULT_SCHEDULED_XERO_BILLS_LIMIT,
    lastScheduledRunAt: toIso(last?.startedAt),
    lastSuccessfulRunAt: toIso(lastSuccess?.startedAt),
    lastFailedRunAt: toIso(lastError?.startedAt),
    lastStatus: last?.status ?? null,
    lastError: last?.errorSummary ?? null,
    recentRunCount: runs.length,
    importScope: [
      'Supplier contacts marked as suppliers in Xero',
      'New authorised or paid ACCPAY supplier bills with matched Alma suppliers',
      'Supplier invoice lines for Stock invoice review and COGS reporting'
    ],
    excludedScope: [
      'Payroll',
      'Payments',
      'Bank feeds',
      'Unmatched or duplicate bills'
    ]
  };
}

type DeputyTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  scope?: string;
  endpoint?: string;
};

async function exchangeDeputyToken(code: string): Promise<DeputyTokenResponse> {
  // Deputy's token endpoint expects x-www-form-urlencoded and returns the
  // per-tenant API host in the `endpoint` field — we stash that on the
  // connection metadata so every subsequent API call goes there.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.integrations.deputy.clientId,
    client_secret: env.integrations.deputy.clientSecret,
    redirect_uri: env.integrations.deputy.redirectUrl,
    code,
    scope: env.integrations.deputy.scope
  });
  const response = await fetch(env.integrations.deputy.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new HttpError(502, 'Deputy token exchange failed.', json);
  }
  return json as DeputyTokenResponse;
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

async function squarePostJson<T>(
  path: string,
  body: Prisma.InputJsonObject,
  input: {
    connection: IntegrationConnection;
    retryAfterUnauthorized?: boolean;
  }
): Promise<{ data: T; connection: IntegrationConnection; tokenStatus: 'healthy' | 'refreshed' }> {
  const { accessToken, connection, tokenStatus } = await validSquareToken(input.connection);
  const config = providerConfig('SQUARE', squareAccountKeyFromConnection(connection));
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Square-Version': env.integrations.square.apiVersion,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (response.status === 401 && input.retryAfterUnauthorized !== false) {
    const refreshed = await refreshSquareConnection(connection);
    return squarePostJson<T>(path, body, {
      connection: refreshed,
      retryAfterUnauthorized: false
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new HttpError(502, 'Square request failed.', {
      status: response.status,
      detail: text ? text.slice(0, 300) : response.statusText
    });
  }

  return {
    data: await response.json() as T,
    connection,
    tokenStatus
  };
}

async function listSquareLocations(connection: IntegrationConnection) {
  const response = await squareGetJson<SquareLocationsResponse>('/locations', { connection });
  return {
    connection: response.connection,
    locations: response.data.locations ?? [],
    tokenStatus: response.tokenStatus
  };
}

async function listSquareCatalog(connection: IntegrationConnection) {
  let currentConnection = connection;
  const objects: SquareCatalogObject[] = [];
  let cursor: string | undefined;
  let tokenStatus: 'healthy' | 'refreshed' = 'healthy';

  do {
    const params = new URLSearchParams({ types: 'ITEM,CATEGORY', limit: '1000' });
    if (cursor) params.set('cursor', cursor);
    const response = await squareGetJson<SquareCatalogListResponse>(`/catalog/list?${params.toString()}`, {
      connection: currentConnection
    });
    currentConnection = response.connection;
    if (response.tokenStatus === 'refreshed') tokenStatus = 'refreshed';
    objects.push(...(response.data.objects ?? []));
    cursor = response.data.cursor;
  } while (cursor);

  return { connection: currentConnection, objects, tokenStatus };
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function squareCatalogCandidates(objects: SquareCatalogObject[]) {
  const categories = new Map<string, string>();
  for (const object of objects) {
    if (object.type === 'CATEGORY' && object.id) {
      categories.set(object.id, optionalText(object.category_data?.name) ?? 'Uncategorised');
    }
  }

  return objects
    .filter((object) => object.type === 'ITEM' && object.id && object.item_data?.name)
    .flatMap((item) => {
      const itemId = item.id!;
      const itemName = optionalText(item.item_data?.name) ?? 'Unnamed Square item';
      const categoryName = item.item_data?.category_id ? categories.get(item.item_data.category_id) ?? null : null;
      const variations = item.item_data?.variations?.length ? item.item_data.variations : [null];
      return variations.map((variation) => {
        const variationData = variation?.item_variation_data;
        const variationId = optionalText(variation?.id) ?? '';
        const price = variationData?.price_money;
        return {
          squareItemId: itemId,
          squareVariationId: variationId,
          name: itemName,
          variationName: optionalText(variationData?.name),
          categoryName,
          sku: optionalText(variationData?.sku),
          priceMoneyAmount: typeof price?.amount === 'number' ? Math.round(price.amount) : null,
          currency: optionalText(price?.currency),
          enabledLocationIds: variation?.present_at_location_ids ?? item.present_at_location_ids ?? [],
          isDeleted: Boolean(item.is_deleted || variation?.is_deleted),
          raw: jsonSafe({ item, variation })
        };
      });
    });
}

function recipeMatchConfidence(squareName: string, recipeTitle: string) {
  const left = normaliseMenuMatchText(squareName);
  const right = normaliseMenuMatchText(recipeTitle);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.82;
  const leftWords = new Set(left.split(' ').filter(Boolean));
  const rightWords = new Set(right.split(' ').filter(Boolean));
  const intersection = Array.from(leftWords).filter((word) => rightWords.has(word)).length;
  const union = new Set([...leftWords, ...rightWords]).size || 1;
  const base = intersection / union;
  const orderedOverlap = Array.from(leftWords).some((word) => word.length > 3 && right.includes(word))
    && Array.from(rightWords).some((word) => word.length > 3 && left.includes(word));
  return orderedOverlap ? Math.max(base, 0.52) : base;
}

const MENU_MATCH_STOP_WORDS = new Set([
  'and',
  'with',
  'the',
  'for',
  'side',
  'extra',
  'add',
  'new',
  'special',
  'single',
  'double',
  'glass',
  'bottle',
  'jug',
  'pitcher',
  'small',
  'large',
  'regular',
  'main',
  'kids',
  'gf',
  'df',
  'vg',
  'vgo',
  'vegan',
  'vegetarian'
]);

const MENU_MATCH_SYNONYMS: Record<string, string> = {
  marg: 'margarita',
  margaritas: 'margarita',
  taco: 'taco',
  tacos: 'taco',
  tostadas: 'tostada',
  quesadillas: 'quesadilla',
  nacho: 'nachos',
  chips: 'chip',
  fries: 'chip',
  guac: 'guacamole',
  avo: 'avocado',
  chook: 'chicken',
  chkn: 'chicken',
  prawn: 'prawn',
  prawns: 'prawn',
  fish: 'fish',
  beef: 'beef',
  pork: 'pork',
  lamb: 'lamb',
  mushie: 'mushroom',
  mushies: 'mushroom',
  mushroom: 'mushroom',
  mushrooms: 'mushroom',
  cauli: 'cauliflower',
  cauliflower: 'cauliflower',
  potato: 'potato',
  potatoes: 'potato'
};

function normaliseMenuMatchText(value: unknown) {
  return normaliseMatchText(value)
    .split(' ')
    .map((word) => MENU_MATCH_SYNONYMS[word] ?? word.replace(/s$/, ''))
    .filter((word) => word.length > 1 && !MENU_MATCH_STOP_WORDS.has(word))
    .join(' ')
    .trim();
}

function squareMenuComparableName(input: { squareItemName?: string | null; squareVariationName?: string | null; categoryName?: string | null }) {
  return [input.squareItemName, input.squareVariationName, input.categoryName].filter(Boolean).join(' ');
}

function accountVenueName(accountKey: SquareAccountKey) {
  return squareAccountConfig(accountKey).label;
}

function venueScoreBoost(recipeVenue: string | null | undefined, accountKey: SquareAccountKey) {
  if (!recipeVenue) return 0.03;
  return normaliseMatchText(recipeVenue) === normaliseMatchText(accountVenueName(accountKey)) ? 0.08 : -0.06;
}

function scoreCandidateName(squareName: string, targetName: string, venue: string | null | undefined, accountKey: SquareAccountKey) {
  const confidence = recipeMatchConfidence(squareName, targetName) + venueScoreBoost(venue, accountKey);
  return Math.max(0, Math.min(1, Math.round(confidence * 1000) / 1000));
}

async function listSquarePayments(input: {
  connection: IntegrationConnection;
  beginTime: Date;
  endTime: Date;
  limit?: number;
  locationIds?: string[];
}) {
  let connection = input.connection;
  const payments: SquarePayment[] = [];
  let tokenStatus: 'healthy' | 'refreshed' = 'healthy';
  const limit = input.limit ?? 1000;
  const pageLimit = 100;
  const locationIds = input.locationIds?.length ? input.locationIds : [undefined];
  let limited = false;

  for (const locationId of locationIds) {
    let cursor: string | undefined;
    while (payments.length < limit) {
      const params = new URLSearchParams({
        begin_time: input.beginTime.toISOString(),
        end_time: input.endTime.toISOString(),
        sort_order: 'ASC',
        limit: String(Math.min(pageLimit, limit - payments.length))
      });
      if (locationId) params.set('location_id', locationId);
      if (cursor) params.set('cursor', cursor);

      const response = await squareGetJson<SquarePaymentsResponse>(`/payments?${params.toString()}`, { connection });
      connection = response.connection;
      if (response.tokenStatus === 'refreshed') tokenStatus = 'refreshed';
      payments.push(...(response.data.payments ?? []));
      cursor = response.data.cursor;
      if (cursor && payments.length >= limit) limited = true;
      if (!cursor || payments.length >= limit) break;
    }
    if (payments.length >= limit) break;
  }

  return { connection, payments, tokenStatus, limited };
}

async function searchSquareOrders(input: {
  connection: IntegrationConnection;
  beginTime: Date;
  endTime: Date;
  locationIds: string[];
  limit: number;
}) {
  let connection = input.connection;
  const orders: SquareOrder[] = [];
  let cursor: string | undefined;
  let tokenStatus: 'healthy' | 'refreshed' = 'healthy';
  const pageLimit = 500;

  while (orders.length < input.limit) {
    const body: Prisma.InputJsonObject = {
      location_ids: input.locationIds,
      limit: Math.min(pageLimit, input.limit - orders.length),
      return_entries: false,
      query: {
        filter: {
          date_time_filter: {
            created_at: {
              start_at: input.beginTime.toISOString(),
              end_at: input.endTime.toISOString()
            }
          },
          state_filter: {
            states: ['COMPLETED']
          }
        },
        sort: {
          sort_field: 'CREATED_AT',
          sort_order: 'ASC'
        }
      },
      ...(cursor ? { cursor } : {})
    };
    const response = await squarePostJson<SquareOrdersSearchResponse>('/orders/search', body, { connection });
    connection = response.connection;
    if (response.tokenStatus === 'refreshed') tokenStatus = 'refreshed';
    orders.push(...(response.data.orders ?? []));
    cursor = response.data.cursor;
    if (!cursor || orders.length >= input.limit) break;
  }

  return { connection, orders, tokenStatus, limited: Boolean(cursor) };
}

// Live open tickets/orders (state OPEN) for the given locations — used by the
// Reserve service map to show what each table is currently spending. No date
// filter: open tabs can have been opened any time today.
async function searchSquareOpenOrders(input: { connection: IntegrationConnection; locationIds: string[]; limit?: number }) {
  let connection = input.connection;
  const body: Prisma.InputJsonObject = {
    location_ids: input.locationIds,
    limit: Math.min(200, input.limit ?? 200),
    return_entries: false,
    query: {
      filter: { state_filter: { states: ['OPEN'] } },
      sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' }
    }
  };
  const response = await squarePostJson<SquareOrdersSearchResponse>('/orders/search', body, { connection });
  connection = response.connection;
  return { connection, orders: response.data.orders ?? [], tokenStatus: response.tokenStatus };
}

// Australian GST is 10% and built into menu prices. Square's "Net Sales"
// figure (what operators reconcile against) excludes GST and tips, but a
// payment's total_money includes both. Convert each payment to ex-GST,
// ex-tip net sales so the report matches the Square dashboard.
const AU_GST_DIVISOR = 1.1;

function squarePaymentAmountCents(payment: SquarePayment) {
  const gross = typeof payment.total_money?.amount === 'number'
    ? payment.total_money.amount
    : typeof payment.amount_money?.amount === 'number'
      ? payment.amount_money.amount
      : 0;
  const tip = typeof payment.tip_money?.amount === 'number' ? payment.tip_money.amount : 0;
  const refunded = typeof payment.refunded_money?.amount === 'number' ? payment.refunded_money.amount : 0;
  // total_money = item sales + GST + tips. Strip tips + refunds, then back out
  // the GST baked into the GST-inclusive remainder → ex-GST, ex-tip net sales.
  const gstInclusiveNet = Math.max(0, gross - tip - refunded);
  return Math.max(0, Math.round(gstInclusiveNet / AU_GST_DIVISOR));
}

function squareOrderLineGrossCents(line: SquareOrderLineItem) {
  if (typeof line.gross_sales_money?.amount === 'number') return Math.max(0, Math.round(line.gross_sales_money.amount));
  if (typeof line.total_money?.amount === 'number') return Math.max(0, Math.round(line.total_money.amount));
  const base = typeof line.base_price_money?.amount === 'number' ? line.base_price_money.amount : 0;
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? Math.round(base * quantity) : Math.max(0, Math.round(base));
}

function squareOrderLineNetCents(line: SquareOrderLineItem) {
  return typeof line.total_money?.amount === 'number'
    ? Math.max(0, Math.round(line.total_money.amount))
    : squareOrderLineGrossCents(line);
}

function squareOrderLineQuantity(line: SquareOrderLineItem) {
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
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

// Map a Xero organisation (tenant) name to a configured venue so imported
// supplier bills land on the right location instead of "Unassigned".
// Exact match first, then a contains match either way (the Xero org name is
// often "St Alma Pty Ltd" while the venue is just "St Alma").
function resolveVenueFromTenantName(tenantName: string | null, venues: string[]): string | null {
  if (!tenantName) return null;
  const target = normaliseMatchText(tenantName);
  if (!target) return null;
  const exact = venues.find((venue) => normaliseMatchText(venue) === target);
  if (exact) return exact;
  const contained = venues.find((venue) => {
    const v = normaliseMatchText(venue);
    return v.length > 0 && (target.includes(v) || v.includes(target));
  });
  return contained ?? null;
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

const squareTipsImportInputSchema = z.object({
  start: z.string().min(4),
  end: z.string().min(4),
  venue: z.string().min(1),
  accountKey: z.enum(['primary', 'secondary']).optional(),
  account: z.enum(['primary', 'secondary']).optional(),
  locationId: z.string().optional().or(z.literal(''))
});

const squareCustomerImportInputSchema = z.object({
  accountKey: z.enum(['primary', 'secondary']).optional(),
  account: z.enum(['primary', 'secondary']).optional(),
  // Venue is stored on every guest so reports/filters work. Falls back to
  // the first known venue if the operator didn't pick one.
  defaultVenue: z.string().optional().or(z.literal('')),
  // Hard cap on pages; Square returns 100 per page, so 50 = 5000 customers
  // max per run. Set higher for bigger backfills.
  maxPages: z.number().int().min(1).max(200).optional(),
  // Only import customers updated within the last N days (creation OR update).
  // Leave blank to import everyone Square has on file.
  updatedSinceDays: z.number().int().min(1).max(3650).optional()
});

function parseIntegrationDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return date;
}

function localServiceDate(value: string | undefined, timezone?: string | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  const timeZone = timezone || 'Australia/Sydney';
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  return new Date(`${lookup.get('year')}-${lookup.get('month')}-${lookup.get('day')}T00:00:00.000Z`);
}

function squareTipImportKey(input: {
  venue: string;
  paymentId: string;
}) {
  return `square:${input.venue.trim().toLowerCase()}:${input.paymentId}`.slice(0, 240);
}

function squareLocationMatchesVenue(location: SquareLocation, venue: string) {
  const venueText = normaliseMatchText(venue);
  if (!venueText) return false;
  const venueWordCount = venueText.split(' ').filter(Boolean).length;
  return [location.name, location.business_name]
    .map((value) => normaliseMatchText(value ?? ''))
    .some((locText) => {
      if (!locText) return false;
      // Location name contains full venue name — always safe
      if (locText.includes(venueText)) return true;
      // Venue name contains location name — only allow if the location name is at least as
      // specific as the venue (same word count). Prevents a short name like "alma" from
      // matching the multi-word venue "alma avalon".
      const locWordCount = locText.split(' ').filter(Boolean).length;
      return venueText.includes(locText) && locWordCount >= venueWordCount;
    });
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

/**
 * Returns the UTC instant that corresponds to 00:00:00 on the given
 * Sydney local date (YYYY-MM-DD). Picks AEST (+10) or AEDT (+11)
 * automatically by round-tripping through Intl: the offset that
 * Sydney is "really" using on that date is the one whose anchored
 * midnight, when projected back into Sydney local time, lands on the
 * same date.
 */
function sydneyMidnightUtc(localDateIso: string): Date {
  for (const offsetHours of [10, 11]) {
    const offsetStr = `+${String(offsetHours).padStart(2, '0')}:00`;
    const candidate = new Date(`${localDateIso}T00:00:00${offsetStr}`);
    if (Number.isNaN(candidate.getTime())) continue;
    if (dateKeyInTimeZone(candidate, 'Australia/Sydney') === localDateIso) {
      return candidate;
    }
  }
  // DST boundary fall-back — extremely rare; default to AEST.
  return new Date(`${localDateIso}T00:00:00+10:00`);
}

/**
 * Adds N days (positive or negative) to a YYYY-MM-DD date key in
 * Sydney-local date space. Operates on the calendar value only —
 * does not touch wall-clock time — so it's safe across the DST
 * flip. Used by the backfill chunker to walk Sydney days.
 */
function addSydneyDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

// ─── Stock rules 6/7/8 — invoice classification at import time ──────
// Mirror of the helpers in apps/stock-api/src/services/stock-rules.service.ts.
// Inlined here so this service doesn't need to cross-package import.
const WINE_SUPPLIER_HINTS = ['winery', 'wines', 'wine co', 'vineyard', 'cellar'] as const;
const WINE_LINE_KEYWORDS = /\b(wine|red|white|rosé|rose|sparkling|champagne|pinot|shiraz|chard|riesling|merlot|cabernet|sauvignon|grenache|tempranillo)\b/i;
const WET_RATE = 0.29;
const GST_TOLERANCE_CENTS = 5;

function applyInvoiceRulesAfterImport(input: {
  supplierName: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  lineCount: number;
  lineDescriptions: string[];
}): {
  isStatement: boolean;
  statementReason: string | null;
  isWine: boolean;
  wetEstimateCents: number | null;
  gstEstimateCents: number;
  gstDriftCents: number;
  gstReason: string | null;
  evaluatedAt: string;
} {
  // Rule 6: statement detection.
  const isStatement = input.lineCount === 0 && input.totalCents > 0;
  const statementReason = isStatement ? 'No line items + non-zero total — Xero treats this as a statement, not an invoice.' : null;

  // Rule 7: wine detection. Either the supplier name looks like a wine
  // business OR >=30% of line descriptions mention wine keywords.
  const supplier = input.supplierName.toLowerCase();
  const supplierLooksLikeWine = WINE_SUPPLIER_HINTS.some((hint) => supplier.includes(hint));
  const wineLineHits = input.lineDescriptions.filter((desc) => WINE_LINE_KEYWORDS.test(desc)).length;
  const isWine = supplierLooksLikeWine || (input.lineDescriptions.length > 0 && wineLineHits >= Math.max(1, Math.floor(input.lineDescriptions.length * 0.3)));

  // For wine bills with tax > 11% of subtotal, the tax bucket likely
  // includes WET on top of GST. Back-derive the WET portion at 29%.
  let wetEstimateCents: number | null = null;
  let gstEstimateCents = input.taxCents;
  if (isWine && input.subtotalCents > 0) {
    const taxRatio = input.taxCents / input.subtotalCents;
    if (taxRatio > 0.11) {
      wetEstimateCents = Math.round(input.subtotalCents * WET_RATE);
      gstEstimateCents = Math.max(input.taxCents - wetEstimateCents, 0);
    }
  }

  // Rule 8: GST drift. subtotal + tax must equal total within ±5c.
  const expectedTotal = input.subtotalCents + input.taxCents;
  const gstDriftCents = input.totalCents - expectedTotal;
  const gstReason = Math.abs(gstDriftCents) > GST_TOLERANCE_CENTS
    ? `Subtotal + tax (${expectedTotal}c) doesn't match total (${input.totalCents}c). Drift ${gstDriftCents}c. Do not file in a BAS until reconciled.`
    : null;

  return {
    isStatement,
    statementReason,
    isWine,
    wetEstimateCents,
    gstEstimateCents,
    gstDriftCents,
    gstReason,
    evaluatedAt: new Date().toISOString()
  };
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
    // When set, overrides the connection's default tenant for this call.
    // Used by the scheduler to iterate across all tenants on a single
    // OAuth connection (Xero lets one auth grant access to multiple orgs).
    tenantId?: string;
  }
): Promise<{ data: T; connection: IntegrationConnection; tokenStatus: 'healthy' | 'refreshed' }> {
  const { accessToken, connection, tokenStatus } = await validXeroToken(input.connection);
  const requireTenant = input.requireTenant ?? true;
  const tenantId = input.tenantId ?? connection.providerAccountId ?? '';
  if (requireTenant && !tenantId) {
    throw new HttpError(409, 'Xero tenant is not selected.');
  }

  const response = await fetch(`https://api.xero.com${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      ...(requireTenant ? { 'xero-tenant-id': tenantId } : {})
    }
  });

  if (response.status === 401 && input.retryAfterUnauthorized !== false) {
    const refreshed = await refreshXeroConnection(connection);
    return xeroGetJson<T>(path, {
      connection: refreshed,
      requireTenant,
      retryAfterUnauthorized: false,
      tenantId: input.tenantId
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

async function xeroContacts(limit: number, tenantId?: string) {
  const connection = await connectedXeroConnection();
  const response = await xeroGetJson<{ Contacts?: XeroContact[] }>(
    '/api.xro/2.0/Contacts?includeArchived=false&page=1',
    { connection, tenantId }
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

async function xeroBills(query: Record<string, unknown>, limit: number, tenantId?: string) {
  const connection = await connectedXeroConnection();
  const where = encodeURIComponent('Type=="ACCPAY"');
  const response = await xeroGetJson<{ Invoices?: XeroInvoice[] }>(
    `/api.xro/2.0/Invoices?where=${where}&order=Date%20DESC&page=1`,
    { connection, tenantId }
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

async function fetchXeroTenants(accessToken: string): Promise<Array<{ id: string; name: string | null }>> {
  const response = await fetch('https://api.xero.com/connections', {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => []);
  if (!Array.isArray(payload)) return [];
  return payload
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const id = typeof (entry as { tenantId?: unknown }).tenantId === 'string'
        ? (entry as { tenantId: string }).tenantId
        : null;
      if (!id) return null;
      const name = typeof (entry as { tenantName?: unknown }).tenantName === 'string'
        ? (entry as { tenantName: string }).tenantName
        : null;
      return { id, name };
    })
    .filter((entry): entry is { id: string; name: string | null } => Boolean(entry));
}

function xeroTenantsFromConnection(connection: IntegrationConnection | null | undefined): Array<{ id: string; name: string | null }> {
  const raw = metadataRecord(connection?.metadata).xeroTenants;
  if (!Array.isArray(raw)) return [];
  const result: Array<{ id: string; name: string | null }> = [];
  for (const entry of raw) {
    const record = metadataRecord(entry);
    const id = typeof record.id === 'string' ? record.id : null;
    if (!id) continue;
    const name = typeof record.name === 'string' ? record.name : null;
    result.push({ id, name });
  }
  return result;
}

function xeroMetadata(input: {
  tenants: Array<{ id: string; name: string | null }>;
  existing?: unknown;
  syncedAt?: Date;
}): Prisma.InputJsonObject {
  const existingRecord = metadataRecord(input.existing);
  // Merge by tenant id so re-authorising one organisation doesn't drop the
  // other location already on the connection. Newly-returned tenants refresh
  // the stored name; previously-known tenants are retained.
  const byId = new Map<string, { id: string; name: string | null }>();
  const existingTenants = Array.isArray(existingRecord.xeroTenants) ? existingRecord.xeroTenants : [];
  for (const entry of existingTenants) {
    const record = metadataRecord(entry);
    if (typeof record.id === 'string') {
      byId.set(record.id, { id: record.id, name: typeof record.name === 'string' ? record.name : null });
    }
  }
  for (const tenant of input.tenants) {
    byId.set(tenant.id, { id: tenant.id, name: tenant.name });
  }
  const merged = [...byId.values()];
  return {
    ...existingRecord,
    xeroTenants: merged,
    xeroTenantCount: merged.length,
    ...(input.syncedAt ? { xeroTenantsSyncedAt: input.syncedAt.toISOString() } : {})
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
  if (!key || !url) return false;
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

function verifyDeputySignature(req: Request) {
  // Deputy posts an `Authorization` header with the secret we registered
  // on the subscription. Constant-time compare against env config.
  const provided = req.header('authorization') ?? req.header('x-deputy-signature') ?? '';
  const expected = env.integrations.deputy.webhookSecret;
  if (!expected) throw new HttpError(503, 'Deputy webhook verification is not configured.');
  const bearer = /^Bearer\s+(.+)$/i.exec(provided);
  const value = bearer?.[1] ?? provided;
  if (!value || value.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
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

  // Live open Square tickets for a venue — used by the Reserve service map. Walks
  // every connected Square account, finds the location(s) matching the venue, and
  // returns each open ticket with its name (table identifier), total and items.
  async fetchOpenSquareOrders(venue: string): Promise<{
    configured: boolean;
    orders: Array<{
      ticketName: string;
      locationId: string | null;
      totalCents: number;
      itemCount: number;
      openedAt: string | null;
      lineItems: Array<{ name: string; quantity: string; totalCents: number }>;
    }>;
  }> {
    const target = venue.trim();
    if (!target) return { configured: false, orders: [] };
    let configured = false;
    const orders: Array<{
      ticketName: string;
      locationId: string | null;
      totalCents: number;
      itemCount: number;
      openedAt: string | null;
      lineItems: Array<{ name: string; quantity: string; totalCents: number }>;
    }> = [];

    for (const accountKey of SQUARE_ACCOUNT_KEYS) {
      let connection: IntegrationConnection;
      try {
        connection = await connectedSquareConnection(accountKey);
      } catch {
        continue; // account not connected — skip quietly
      }
      configured = true;

      let locations: SquareLocation[];
      try {
        const locResp = await listSquareLocations(connection);
        connection = locResp.connection;
        locations = locResp.locations;
      } catch {
        continue;
      }

      const locationIds = locations
        .filter((loc) => Boolean(loc.id) && squareLocationMatchesVenue(loc, target))
        .map((loc) => loc.id as string);
      if (locationIds.length === 0) continue;

      try {
        const result = await searchSquareOpenOrders({ connection, locationIds });
        for (const order of result.orders) {
          const ticketName = (order.ticket_name ?? order.name ?? '').trim();
          if (!ticketName) continue;
          const lineItems = (order.line_items ?? []).map((line) => ({
            name: line.name ?? line.variation_name ?? 'Item',
            quantity: line.quantity ?? '1',
            totalCents: squareOrderLineGrossCents(line)
          }));
          const orderTotalCents = typeof order.total_money?.amount === 'number'
            ? Math.max(0, Math.round(order.total_money.amount))
            : lineItems.reduce((sum, line) => sum + line.totalCents, 0);
          const itemCount = lineItems.reduce((sum, line) => {
            const qty = Number(line.quantity);
            return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
          }, 0);
          orders.push({
            ticketName,
            locationId: order.location_id ?? null,
            totalCents: orderTotalCents,
            itemCount,
            openedAt: order.created_at ?? null,
            lineItems
          });
        }
      } catch {
        continue;
      }
    }

    return { configured, orders };
  },

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
    const [primarySquare, secondarySquare, xero, deputy, xeroScheduledImport, syncRuns] = await Promise.all([
      providerStatus('SQUARE', 'primary'),
      providerStatus('SQUARE', 'secondary'),
      providerStatus('XERO'),
      providerStatus('DEPUTY'),
      xeroScheduledImportStatus(),
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
      deputy,
      xeroScheduledImport,
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

  async importSquareTips(input: unknown, actor: AuthUser) {
    const data = squareTipsImportInputSchema.parse(input ?? {});
    const accountKey = normaliseSquareAccountKey(
      data.accountKey ?? data.account ?? inferSquareAccountKeyFromVenue(data.venue)
    );
    const startDate = parseIntegrationDate(data.start, 'Tips start date');
    const endDate = parseIntegrationDate(data.end, 'Tips end date');
    if (endDate <= startDate) throw new HttpError(400, 'Tips end date must be after start date.');

    const connection = await connectedSquareConnection(accountKey);
    const locationResponse = await listSquareLocations(connection);
    const locations = locationResponse.locations.filter((location) => location.id);
    const matchedLocations = data.locationId
      ? locations.filter((location) => location.id === data.locationId)
      : locations.filter((location) => squareLocationMatchesVenue(location, data.venue));
    const locationIds = matchedLocations.map((location) => location.id).filter((id): id is string => Boolean(id));
    const paymentResponse = await listSquarePayments({
      connection: locationResponse.connection,
      beginTime: startDate,
      endTime: endDate,
      locationIds
    });
    const locationById = new Map(locations.map((location) => [location.id, location]));
    const source = 'square';
    const rows = paymentResponse.payments
      .filter((payment) => payment.status === 'COMPLETED')
      .map((payment) => {
        const paymentId = optionalText(payment.id);
        const amountCents = typeof payment.tip_money?.amount === 'number' ? Math.round(payment.tip_money.amount) : 0;
        if (!paymentId || amountCents <= 0) return null;
        const location = payment.location_id ? locationById.get(payment.location_id) : undefined;
        const serviceDate = localServiceDate(payment.created_at, location?.timezone);
        return {
          venue: data.venue.trim(),
          serviceDate,
          amountCents,
          source,
          externalId: paymentId,
          importKey: squareTipImportKey({ venue: data.venue, paymentId }),
          notes: [
            'Square tip',
            location?.name ? `Location: ${location.name}` : null,
            payment.receipt_number ? `Receipt: ${payment.receipt_number}` : null,
            payment.order_id ? `Order: ${payment.order_id}` : null
          ].filter(Boolean).join(' · ')
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    let imported = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        const existing = await tx.staffTipCardEntry.findUnique({
          where: { importKey: row.importKey },
          select: { id: true }
        });
        await tx.staffTipCardEntry.upsert({
          where: { importKey: row.importKey },
          create: row,
          update: {
            venue: row.venue,
            serviceDate: row.serviceDate,
            amountCents: row.amountCents,
            source: row.source,
            externalId: row.externalId,
            notes: row.notes
          }
        });
        if (existing) updated += 1;
        else imported += 1;
      }

      await tx.integrationSyncRun.create({
        data: {
          provider: 'SQUARE',
          connectionId: paymentResponse.connection.id,
          syncType: 'MANUAL',
          status: 'SUCCESS',
          finishedAt: new Date(),
          recordsImported: imported,
          recordsUpdated: updated
        }
      });
    });

    await recordEvent({
      provider: 'SQUARE',
      connectionId: paymentResponse.connection.id,
      eventType: 'SQUARE_TIPS_IMPORTED',
      summary: `${squareAccountConfig(accountKey).label} Square tips import finished: ${imported} new, ${updated} updated.`,
      actor,
      metadata: {
        accountKey,
        venue: data.venue,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        locationsMatched: locationIds.length,
        paymentsRead: paymentResponse.payments.length,
        imported,
        updated,
        limited: paymentResponse.limited
      }
    });

    return {
      label: squareAccountConfig(accountKey).label,
      accountKey,
      venue: data.venue,
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      paymentsRead: paymentResponse.payments.length,
      tipRows: rows.length,
      imported,
      updated,
      amountCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
      locationsMatched: locationIds.length,
      warnings: [
        ...(locationIds.length
          ? []
          : [`No Square location name clearly matched ${data.venue}; imported completed tip payments from the whole connected Square account.`]),
        ...(paymentResponse.limited ? ['Square returned more tip payments than the import limit; narrow the date range and import again.'] : [])
      ]
    };
  },

  // Square Customer Directory → ReserveGuest CRM.
  //
  // Square stores customer profiles built from POS, online ordering, gift cards,
  // and loyalty signups. Pulling these into ReserveGuest gives Marketing a
  // ready-made guest book without re-entering anyone manually.
  //
  // Dedupe strategy:
  //   1. If the customer has an email, match an existing ReserveGuest by email.
  //   2. Otherwise, match by (firstName + lastName + phone) when phone is set.
  //   3. Otherwise, insert a new guest row.
  //
  // The Square customer id is stashed in `preferences.squareCustomerId` so a
  // second run can re-find the same guest even when emails change.
  async importSquareCustomers(input: unknown, actor: AuthUser) {
    const data = squareCustomerImportInputSchema.parse(input ?? {});
    const accountKey = normaliseSquareAccountKey(data.accountKey ?? data.account);
    const maxPages = data.maxPages ?? 50; // 50 × 100 = 5,000 customers
    const updatedSince = typeof data.updatedSinceDays === 'number'
      ? new Date(Date.now() - data.updatedSinceDays * 24 * 60 * 60 * 1000)
      : null;
    let connection = await connectedSquareConnection(accountKey);

    // Default venue: first known location name if none was passed.
    let defaultVenue = data.defaultVenue?.trim() || '';
    if (!defaultVenue) {
      const locResponse = await listSquareLocations(connection);
      connection = locResponse.connection;
      defaultVenue = locResponse.locations.find((l) => l.id)?.name?.trim() || '';
    }

    type SquareCustomer = {
      id?: string;
      created_at?: string;
      updated_at?: string;
      given_name?: string;
      family_name?: string;
      nickname?: string;
      company_name?: string;
      email_address?: string;
      phone_number?: string;
      birthday?: string;
      note?: string;
      reference_id?: string;
      preferences?: { email_unsubscribed?: boolean };
      creation_source?: string;
    };
    type SquareCustomersResponse = {
      customers?: SquareCustomer[];
      cursor?: string;
    };

    const customers: SquareCustomer[] = [];
    let cursor: string | undefined;
    let pages = 0;
    let limited = false;

    do {
      const params = new URLSearchParams({ limit: '100', sort_field: 'CREATED_AT', sort_order: 'DESC' });
      if (cursor) params.set('cursor', cursor);
      const response = await squareGetJson<SquareCustomersResponse>(`/customers?${params.toString()}`, {
        connection
      });
      connection = response.connection;
      const batch = response.data.customers ?? [];
      // Apply updatedSince filter client-side — Square's sort_field=UPDATED_AT
      // works but isn't reliable across all account histories. Easier to filter
      // here and stop paging once we cross the boundary while sorting DESC.
      let crossedBoundary = false;
      for (const customer of batch) {
        if (updatedSince) {
          const ts = customer.updated_at || customer.created_at;
          if (ts && new Date(ts) < updatedSince) {
            crossedBoundary = true;
            continue;
          }
        }
        customers.push(customer);
      }
      cursor = response.data.cursor;
      pages += 1;
      if (crossedBoundary) {
        // We sorted DESC by created_at; anything further back is older than the
        // boundary, so stop paging.
        cursor = undefined;
      }
      if (pages >= maxPages) {
        limited = Boolean(cursor);
        cursor = undefined;
      }
    } while (cursor);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const warnings: string[] = [];

    for (const customer of customers) {
      const firstName = (customer.given_name || customer.nickname || '').trim();
      const lastName = (customer.family_name || '').trim();
      const email = (customer.email_address || '').trim().toLowerCase();
      const phone = (customer.phone_number || '').trim();

      // Square allows empty names entirely. Skip these — ReserveGuest needs
      // firstName.
      if (!firstName && !lastName && !email && !phone) {
        skipped += 1;
        continue;
      }

      const safeFirstName = firstName || (email ? email.split('@')[0]! : 'Guest');
      const safeLastName = lastName || '';

      // Match by email first.
      let existing = email
        ? await prisma.reserveGuest.findFirst({ where: { email } })
        : null;

      // Fallback: match by name + phone if phone is present.
      if (!existing && phone) {
        existing = await prisma.reserveGuest.findFirst({
          where: {
            phone,
            firstName: { equals: safeFirstName, mode: 'insensitive' },
            lastName: { equals: safeLastName, mode: 'insensitive' }
          }
        });
      }

      const birthday = customer.birthday
        ? new Date(`${customer.birthday}T00:00:00Z`)
        : null;
      const emailUnsub = customer.preferences?.email_unsubscribed
        ? new Date()
        : null;
      const preferences: Prisma.InputJsonObject = {
        squareCustomerId: customer.id || '',
        squareCreationSource: customer.creation_source || '',
        squareReferenceId: customer.reference_id || '',
        squareLastSeenAt: customer.updated_at || customer.created_at || ''
      };

      if (existing) {
        await prisma.reserveGuest.update({
          where: { id: existing.id },
          data: {
            firstName: existing.firstName || safeFirstName,
            lastName: existing.lastName || safeLastName,
            email: existing.email || (email || null),
            phone: existing.phone || (phone || null),
            birthday: existing.birthday ?? birthday,
            notes: existing.notes || (customer.note?.trim() || null),
            venue: existing.venue || (defaultVenue || null),
            preferences: {
              ...((existing.preferences as Prisma.JsonObject) ?? {}),
              ...preferences
            },
            emailUnsubscribedAt: existing.emailUnsubscribedAt ?? emailUnsub
          }
        });
        updated += 1;
      } else {
        await prisma.reserveGuest.create({
          data: {
            venue: defaultVenue || null,
            firstName: safeFirstName,
            lastName: safeLastName,
            email: email || null,
            phone: phone || null,
            birthday,
            notes: customer.note?.trim() || null,
            source: 'square_import',
            preferences,
            emailUnsubscribedAt: emailUnsub
          }
        });
        imported += 1;
      }
    }

    await prisma.integrationSyncRun.create({
      data: {
        provider: 'SQUARE',
        connectionId: connection.id,
        syncType: 'MANUAL',
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsImported: imported,
        recordsUpdated: updated
      }
    });

    await recordEvent({
      provider: 'SQUARE',
      connectionId: connection.id,
      eventType: 'SQUARE_CUSTOMERS_IMPORTED',
      summary: `${squareAccountConfig(accountKey).label} Square customer import finished: ${imported} new, ${updated} updated guests.`,
      actor,
      metadata: {
        accountKey,
        defaultVenue,
        customersRead: customers.length,
        pages,
        imported,
        updated,
        skipped,
        limited,
        updatedSinceDays: data.updatedSinceDays ?? null
      }
    });

    if (limited) {
      warnings.push(`Hit the ${maxPages}-page cap — there are more Square customers to import. Re-run with a smaller "updated within last N days" window, or raise maxPages.`);
    }
    if (skipped) {
      warnings.push(`${skipped} Square customer record${skipped === 1 ? '' : 's'} had no name, email, or phone and ${skipped === 1 ? 'was' : 'were'} skipped.`);
    }

    return {
      label: squareAccountConfig(accountKey).label,
      accountKey,
      defaultVenue,
      customersRead: customers.length,
      pages,
      imported,
      updated,
      skipped,
      limited,
      warnings
    };
  },

  async syncSquareCatalog(actor: AuthUser, accountInput?: unknown) {
    const accountKey = normaliseSquareAccountKey(accountInput);
    const connection = await connectedSquareConnection(accountKey);
    const response = await listSquareCatalog(connection);
    const syncedAt = new Date();
    const candidates = squareCatalogCandidates(response.objects);
    const recipes = await prisma.recipe.findMany({
      where: { status: 'ACTIVE', isPrepRecipe: false },
      select: { id: true, title: true, venue: true }
    });
    let candidatesUpserted = 0;
    let mappingsCreated = 0;
    let mappingsPreserved = 0;
    let recipePricesUpdated = 0;

    // Process each catalog candidate individually — no wrapping transaction because:
    // 1. Each upsert is already atomic on its own unique key.
    // 2. A single $transaction over 100+ items reliably exceeds the 5 s Prisma
    //    interactive-transaction timeout and causes the whole sync to fail.
    // Partial success is acceptable: re-running sync is idempotent.
    for (const candidate of candidates) {
      await prisma.squareCatalogItem.upsert({
        where: {
          accountKey_squareItemId_squareVariationId: {
            accountKey,
            squareItemId: candidate.squareItemId,
            squareVariationId: candidate.squareVariationId
          }
        },
        create: {
          accountKey,
          squareItemId: candidate.squareItemId,
          squareVariationId: candidate.squareVariationId,
          name: candidate.name,
          variationName: candidate.variationName,
          categoryName: candidate.categoryName,
          sku: candidate.sku,
          priceMoneyAmount: candidate.priceMoneyAmount,
          currency: candidate.currency,
          enabledLocationIds: candidate.enabledLocationIds,
          raw: candidate.raw,
          isDeleted: candidate.isDeleted,
          syncedAt
        },
        update: {
          name: candidate.name,
          variationName: candidate.variationName,
          categoryName: candidate.categoryName,
          sku: candidate.sku,
          priceMoneyAmount: candidate.priceMoneyAmount,
          currency: candidate.currency,
          enabledLocationIds: candidate.enabledLocationIds,
          raw: candidate.raw,
          isDeleted: candidate.isDeleted,
          syncedAt
        }
      });
      candidatesUpserted += 1;

      const existing = await prisma.squareMenuRecipeMapping.findUnique({
        where: {
          accountKey_squareItemId_squareVariationId: {
            accountKey,
            squareItemId: candidate.squareItemId,
            squareVariationId: candidate.squareVariationId
          }
        }
      });
      const bestMatch = recipes
        .map((recipe) => ({ recipe, confidence: recipeMatchConfidence(candidate.name, recipe.title) }))
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
      const confidence = bestMatch?.confidence && bestMatch.confidence >= 0.45 ? bestMatch.confidence : null;
      const suggestedStatus = confidence && confidence >= 0.75 ? 'NEEDS_REVIEW' : 'UNMAPPED';

      if (!existing) {
        await prisma.squareMenuRecipeMapping.create({
          data: {
            accountKey,
            venue: bestMatch?.recipe.venue ?? null,
            squareItemId: candidate.squareItemId,
            squareVariationId: candidate.squareVariationId,
            squareItemName: candidate.name,
            squareVariationName: candidate.variationName,
            categoryName: candidate.categoryName,
            priceMoneyAmount: candidate.priceMoneyAmount,
            currency: candidate.currency,
            status: candidate.isDeleted ? 'IGNORED' : suggestedStatus,
            confidence,
            notes: confidence ? `Suggested match: ${bestMatch?.recipe.title}` : null
          }
        });
        mappingsCreated += 1;
      } else {
        mappingsPreserved += 1;
        await prisma.squareMenuRecipeMapping.update({
          where: { id: existing.id },
          data: {
            squareItemName: candidate.name,
            squareVariationName: candidate.variationName,
            categoryName: candidate.categoryName,
            priceMoneyAmount: candidate.priceMoneyAmount,
            currency: candidate.currency,
            confidence: existing.status === 'MAPPED' || existing.status === 'IGNORED'
              ? existing.confidence
              : confidence,
            status: existing.status === 'UNMAPPED' && suggestedStatus === 'NEEDS_REVIEW'
              ? 'NEEDS_REVIEW'
              : existing.status
          }
        });
      }
    }

    // Push confirmed Square prices onto the recipes the Stock dish-margin page
    // reads. DishMarginPage and recipesService.list only look at
    // Recipe.salePriceCents, which the catalogue sync never populated before —
    // so margins rendered "No data" for every dish. Only MAPPED mappings with a
    // linked recipe and a known price are propagated, so unverified suggestions
    // never overwrite a recipe's sale price.
    const confirmedMappings = await prisma.squareMenuRecipeMapping.findMany({
      where: {
        accountKey,
        status: 'MAPPED',
        almaRecipeId: { not: null },
        // Only mirror POSITIVE prices. $0 items (tasting-menu courses "* …" and
        // bottomless "BB …" lines) must never overwrite a recipe's real price.
        priceMoneyAmount: { gt: 0 }
      },
      select: { almaRecipeId: true, priceMoneyAmount: true, venue: true }
    });
    for (const mapping of confirmedMappings) {
      if (!mapping.almaRecipeId || !mapping.priceMoneyAmount || mapping.priceMoneyAmount <= 0) continue;
      const recipeId = mapping.almaRecipeId;
      const price = mapping.priceMoneyAmount;
      const venue = mapping.venue?.trim();
      if (venue) {
        // Per-venue override: upsert the venue price, and only seed the default
        // when it has never been set (so venues don't clobber each other's default).
        await prisma.recipeVenuePrice.upsert({
          where: { recipeId_venue: { recipeId, venue } },
          create: { recipeId, venue, salePriceCents: price },
          update: { salePriceCents: price }
        });
        recipePricesUpdated += 1;
        const seeded = await prisma.recipe.updateMany({
          where: { id: recipeId, salePriceCents: null },
          data: { salePriceCents: price }
        });
        recipePricesUpdated += seeded.count;
      } else {
        // No venue on the mapping: maintain the default price as before.
        const updated = await prisma.recipe.updateMany({
          where: { id: recipeId, salePriceCents: { not: price } },
          data: { salePriceCents: price }
        });
        recipePricesUpdated += updated.count;
      }
    }

    await prisma.integrationSyncRun.create({
      data: {
        provider: 'SQUARE',
        connectionId: response.connection.id,
        syncType: 'MANUAL',
        status: 'SUCCESS',
        finishedAt: syncedAt,
        recordsImported: candidates.length,
        recordsUpdated: mappingsPreserved
      }
    });

    await recordEvent({
      provider: 'SQUARE',
      connectionId: response.connection.id,
      eventType: 'SQUARE_CATALOG_SYNCED',
      summary: `${squareAccountConfig(accountKey).label} Square catalogue sync finished: ${candidates.length} menu candidates.`,
      actor,
      metadata: { accountKey, candidates: candidates.length, mappingsCreated, mappingsPreserved, recipePricesUpdated }
    });

    return {
      provider: 'square' as const,
      accountKey,
      label: squareAccountConfig(accountKey).label,
      syncedAt: syncedAt.toISOString(),
      catalogItemsRead: candidates.length,
      candidatesUpserted,
      mappingsCreated,
      mappingsPreserved,
      recipePricesUpdated,
      deletedMarked: candidates.filter((candidate) => candidate.isDeleted).length,
      warnings: candidates.length ? [] : ['No Square catalogue item variations were returned for this account.']
    };
  },

  async listSquareMenuMappings(input: unknown) {
    const query = squareMenuMappingQuerySchema.parse(input ?? {});
    const accountKey = normaliseSquareAccountKey(query.accountKey);
    const where: Prisma.SquareMenuRecipeMappingWhereInput = {
      accountKey,
      ...(query.status ? { status: query.status } : {}),
      ...(query.venue ? { venue: query.venue } : {}),
      ...(query.category ? { categoryName: query.category } : {}),
      ...(query.search ? {
        OR: [
          { squareItemName: { contains: query.search, mode: 'insensitive' } },
          { squareVariationName: { contains: query.search, mode: 'insensitive' } },
          { categoryName: { contains: query.search, mode: 'insensitive' } },
          { almaRecipe: { title: { contains: query.search, mode: 'insensitive' } } }
        ]
      } : {})
    };
    const [mappings, summaryRows, catalogRows] = await Promise.all([
      prisma.squareMenuRecipeMapping.findMany({
        where,
        orderBy: [{ status: 'asc' }, { squareItemName: 'asc' }, { squareVariationName: 'asc' }],
        include: {
          almaRecipe: {
            select: {
              id: true,
              title: true,
              venue: true,
              category: true,
              estimatedCost: true,
              salePriceCents: true
            }
          },
          stockItem: { select: { id: true, name: true, unit: true, countUnit: true, avgCostCents: true } }
        },
        take: 500
      }),
      prisma.squareMenuRecipeMapping.groupBy({
        by: ['status'],
        where: { accountKey },
        _count: { _all: true }
      }),
      prisma.squareCatalogItem.findMany({
        where: { accountKey },
        select: { categoryName: true, syncedAt: true },
        orderBy: { syncedAt: 'desc' }
      })
    ]);
    const countFor = (status: string) => summaryRows.find((row) => row.status === status)?._count._all ?? 0;
    const categories = Array.from(new Set(catalogRows
      .map((row) => row.categoryName)
      .filter((value): value is string => Boolean(value)))).sort();
    return {
      generatedAt: new Date().toISOString(),
      accountKey,
      summary: {
        total: summaryRows.reduce((sum, row) => sum + row._count._all, 0),
        mapped: countFor('MAPPED'),
        unmapped: countFor('UNMAPPED'),
        ignored: countFor('IGNORED'),
        needsReview: countFor('NEEDS_REVIEW'),
        lastSyncedAt: catalogRows[0]?.syncedAt.toISOString() ?? null
      },
      filters: query,
      categories,
      mappings: mappings.map((mapping) => {
        const recipeCostCents = mapping.almaRecipe ? Math.round(mapping.almaRecipe.estimatedCost * 100) : null;
        const salePriceCents = mapping.priceMoneyAmount;
        const grossProfitCents = salePriceCents !== null && recipeCostCents !== null ? salePriceCents - recipeCostCents : null;
        return {
          id: mapping.id,
          accountKey: mapping.accountKey as SquareAccountKey,
          venue: mapping.venue,
          squareItemId: mapping.squareItemId,
          squareVariationId: mapping.squareVariationId,
          squareItemName: mapping.squareItemName,
          squareVariationName: mapping.squareVariationName,
          categoryName: mapping.categoryName,
          priceMoneyAmount: salePriceCents,
          currency: mapping.currency,
          almaRecipeId: mapping.almaRecipeId,
          stockItemId: mapping.stockItemId,
          status: mapping.status,
          confidence: mapping.confidence,
          notes: mapping.notes,
          mappedAt: toIso(mapping.mappedAt),
          mappedById: mapping.mappedById,
          createdAt: mapping.createdAt.toISOString(),
          updatedAt: mapping.updatedAt.toISOString(),
          almaRecipe: mapping.almaRecipe,
          stockItem: mapping.stockItem,
          margin: {
            salePriceCents,
            recipeCostCents,
            grossProfitCents,
            foodCostPercent: salePriceCents && recipeCostCents !== null
              ? Math.round((recipeCostCents / salePriceCents) * 1000) / 10
              : null
          }
        };
      })
    };
  },

  async squareRecipeOptions() {
    const [recipes, stockItems] = await Promise.all([
      prisma.recipe.findMany({
        where: { status: 'ACTIVE', isPrepRecipe: false },
        orderBy: [{ title: 'asc' }],
        include: { _count: { select: { lines: true } } }
      }),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, unit: true, countUnit: true, avgCostCents: true }
      })
    ]);
    return {
      generatedAt: new Date().toISOString(),
      recipes: recipes.map((recipe) => ({
        id: recipe.id,
        title: recipe.title,
        venue: recipe.venue,
        category: recipe.category,
        estimatedCost: recipe.estimatedCost,
        salePriceCents: recipe.salePriceCents,
        lineCount: recipe._count.lines
      })),
      stockItems
    };
  },

  async autoMatchSquareMenuMappings(input: unknown, actor: AuthUser) {
    const data = squareMenuAutoMatchInputSchema.parse(input ?? {});
    const accountKey = normaliseSquareAccountKey(data.accountKey);
    const [mappings, recipes, stockItems] = await Promise.all([
      prisma.squareMenuRecipeMapping.findMany({
        where: {
          accountKey,
          status: { in: ['UNMAPPED', 'NEEDS_REVIEW'] }
        },
        orderBy: [{ squareItemName: 'asc' }, { squareVariationName: 'asc' }],
        take: 1000
      }),
      prisma.recipe.findMany({
        where: { status: 'ACTIVE', isPrepRecipe: false },
        select: { id: true, title: true, venue: true }
      }),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, name: true }
      })
    ]);

    let mapped = 0;
    let needsReview = 0;
    let unchanged = 0;
    let skipped = 0;
    const matches: Array<{
      id: string;
      squareItemName: string;
      squareVariationName: string | null;
      targetType: 'recipe' | 'stockItem';
      targetName: string;
      confidence: number;
      status: 'MAPPED' | 'NEEDS_REVIEW';
    }> = [];

    // Each mapping update is independent — no need to wrap the whole
    // loop in a $transaction. The previous transactional version
    // blew past Prisma's 5s default on real-world catalogues (up to
    // 1000 mappings × ~hundreds of recipes + items inside one tx
    // → "Transaction not found / invalid" in prod). Run sequentially
    // so each update is its own short connection.
    for (const mapping of mappings) {
      if (mapping.almaRecipeId || mapping.stockItemId) {
        skipped += 1;
        continue;
      }

      const squareName = squareMenuComparableName(mapping);
      const bestRecipe = recipes
        .map((recipe) => ({
          type: 'recipe' as const,
          id: recipe.id,
          name: recipe.title,
          confidence: scoreCandidateName(squareName, recipe.title, recipe.venue, accountKey)
        }))
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
      const bestStockItem = stockItems
        .map((item) => ({
          type: 'stockItem' as const,
          id: item.id,
          name: item.name,
          confidence: recipeMatchConfidence(squareName, item.name)
        }))
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;
      const best = [bestRecipe, bestStockItem]
        .filter((candidate): candidate is NonNullable<typeof bestRecipe> | NonNullable<typeof bestStockItem> => Boolean(candidate))
        .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

      if (!best || best.confidence < data.reviewThreshold) {
        unchanged += 1;
        continue;
      }

      const status = best.confidence >= data.applyThreshold ? 'MAPPED' : 'NEEDS_REVIEW';
      if (status === 'NEEDS_REVIEW' && !data.includeNeedsReview) {
        unchanged += 1;
        continue;
      }

      try {
        await prisma.squareMenuRecipeMapping.update({
          where: { id: mapping.id },
          data: {
            almaRecipeId: best.type === 'recipe' ? best.id : null,
            stockItemId: best.type === 'stockItem' ? best.id : null,
            venue: mapping.venue ?? (best.type === 'recipe' ? recipes.find((recipe) => recipe.id === best.id)?.venue ?? accountVenueName(accountKey) : accountVenueName(accountKey)),
            status,
            confidence: best.confidence,
            notes: `${status === 'MAPPED' ? 'Auto-matched' : 'Suggested for review'}: ${best.name}`,
            mappedAt: status === 'MAPPED' ? new Date() : null,
            mappedById: status === 'MAPPED' ? actor.id : null
          }
        });
        if (status === 'MAPPED') mapped += 1;
        else needsReview += 1;

        // Mirror the confirmed price onto the recipe so dish margins reflect it
        // immediately — same as the manual-map and catalogue-sync paths. Only
        // POSITIVE prices: a $0 item (BB/* component) must not zero the recipe.
        if (status === 'MAPPED' && best.type === 'recipe' && mapping.priceMoneyAmount !== null && mapping.priceMoneyAmount > 0) {
          const recipeId = best.id;
          const price = mapping.priceMoneyAmount;
          const venue = mapping.venue?.trim();
          if (venue) {
            // Per-venue override: upsert the venue price, seed default only when unset.
            await prisma.recipeVenuePrice.upsert({
              where: { recipeId_venue: { recipeId, venue } },
              create: { recipeId, venue, salePriceCents: price },
              update: { salePriceCents: price }
            });
            await prisma.recipe.updateMany({
              where: { id: recipeId, salePriceCents: null },
              data: { salePriceCents: price }
            });
          } else {
            await prisma.recipe.update({
              where: { id: recipeId },
              data: { salePriceCents: price }
            });
          }
        }

        matches.push({
          id: mapping.id,
          squareItemName: mapping.squareItemName,
          squareVariationName: mapping.squareVariationName,
          targetType: best.type,
          targetName: best.name,
          confidence: best.confidence,
          status
        });
      } catch (err) {
        // Don't abort the whole batch on a single update failure — log
        // it and carry on. Auto-matcher is best-effort by design.
        console.warn('[square-auto-match] update failed', { mappingId: mapping.id, err });
        unchanged += 1;
      }
    }

    await recordEvent({
      provider: 'SQUARE',
      eventType: 'SQUARE_MENU_AUTO_MATCHED',
      summary: `${squareAccountConfig(accountKey).label} Square menu auto-match: ${mapped} mapped, ${needsReview} needs review.`,
      actor,
      metadata: {
        accountKey,
        reviewed: mappings.length,
        mapped,
        needsReview,
        unchanged,
        skipped,
        applyThreshold: data.applyThreshold,
        reviewThreshold: data.reviewThreshold
      }
    });

    return {
      provider: 'square' as const,
      accountKey,
      reviewed: mappings.length,
      mapped,
      needsReview,
      unchanged,
      skipped,
      applyThreshold: data.applyThreshold,
      reviewThreshold: data.reviewThreshold,
      matches
    };
  },

  async updateSquareMenuMapping(id: string, input: unknown, actor: AuthUser) {
    const data = squareMenuMappingUpdateSchema.parse(input ?? {});
    const existing = await prisma.squareMenuRecipeMapping.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Square menu mapping not found.');
    const almaRecipeId = data.almaRecipeId === '' ? null : data.almaRecipeId ?? existing.almaRecipeId;
    const stockItemId = data.stockItemId === '' ? null : data.stockItemId ?? existing.stockItemId;
    if (almaRecipeId) {
      const recipe = await prisma.recipe.findUnique({ where: { id: almaRecipeId }, select: { id: true, venue: true } });
      if (!recipe) throw new HttpError(400, 'Selected Alma recipe was not found.');
    }
    if (stockItemId) {
      const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId }, select: { id: true } });
      if (!stockItem) throw new HttpError(400, 'Selected stock item was not found.');
    }
    const status = data.status ?? (almaRecipeId || stockItemId ? 'MAPPED' : existing.status);
    const updated = await prisma.squareMenuRecipeMapping.update({
      where: { id },
      data: {
        almaRecipeId,
        stockItemId,
        status,
        notes: data.notes === '' ? null : data.notes ?? existing.notes,
        mappedAt: status === 'MAPPED' ? new Date() : status === 'UNMAPPED' ? null : existing.mappedAt,
        mappedById: status === 'MAPPED' ? actor.id : status === 'UNMAPPED' ? null : existing.mappedById
      }
    });
    // Once a Square item is confirmed against a recipe, push its POS price onto
    // Recipe.salePriceCents immediately so the Stock dish-margin page reflects it
    // without waiting for the next catalogue sync.
    if (updated.status === 'MAPPED' && updated.almaRecipeId && updated.priceMoneyAmount !== null && updated.priceMoneyAmount > 0) {
      const recipeId = updated.almaRecipeId;
      const price = updated.priceMoneyAmount;
      const venue = updated.venue?.trim();
      if (venue) {
        // Per-venue override: upsert the venue price, seed default only when unset.
        await prisma.recipeVenuePrice.upsert({
          where: { recipeId_venue: { recipeId, venue } },
          create: { recipeId, venue, salePriceCents: price },
          update: { salePriceCents: price }
        });
        await prisma.recipe.updateMany({
          where: { id: recipeId, salePriceCents: null },
          data: { salePriceCents: price }
        });
      } else {
        await prisma.recipe.update({
          where: { id: recipeId },
          data: { salePriceCents: price }
        });
      }
    }

    await recordEvent({
      provider: 'SQUARE',
      eventType: 'SQUARE_MENU_MAPPING_UPDATED',
      summary: `Square menu item ${updated.squareItemName} mapping updated.`,
      actor,
      metadata: { accountKey: updated.accountKey, mappingId: updated.id, status: updated.status }
    });
    return integrationService.listSquareMenuMappings({ accountKey: updated.accountKey, search: updated.squareItemName });
  },

  async ignoreSquareMenuMapping(id: string, actor: AuthUser) {
    return integrationService.updateSquareMenuMapping(id, { status: 'IGNORED' }, actor);
  },

  async clearSquareMenuMapping(id: string, actor: AuthUser) {
    return integrationService.updateSquareMenuMapping(id, {
      almaRecipeId: null,
      stockItemId: null,
      status: 'UNMAPPED',
      notes: null
    }, actor);
  },

  async getRecipeMappingForSquareItem(accountInput: unknown, squareItemId: string, squareVariationId = '') {
    const accountKey = normaliseSquareAccountKey(accountInput);
    return prisma.squareMenuRecipeMapping.findUnique({
      where: {
        accountKey_squareItemId_squareVariationId: {
          accountKey,
          squareItemId,
          squareVariationId
        }
      },
      include: { almaRecipe: { include: { lines: true } }, stockItem: true }
    });
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
    const tenantId = optionalText(query.tenantId) ?? undefined;
    const [{ contacts, connection }, suppliers] = await Promise.all([
      xeroContacts(limit, tenantId),
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
    options?: { syncType?: ImportRunMode; eventType?: string; tenantId?: string }
  ): Promise<XeroSupplierContactsImportResult> {
    const data = xeroSupplierContactsImportInputSchema.parse(input);
    const limit = data.limit ?? 500;
    const { contacts, connection } = await xeroContacts(limit, options?.tenantId);
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
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastError: warnings.length ? warnings.slice(0, 5).join(' | ') : null
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
    const tenantId = optionalText(query.tenantId) ?? undefined;
    const [{ bills, connection, start, end }, suppliers, existingInvoices] = await Promise.all([
      xeroBills(query, limit, tenantId),
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
    options?: { syncType?: ImportRunMode; eventType?: string; tenantId?: string }
  ): Promise<XeroSupplierBillsImportResult> {
    const data = xeroSupplierBillsImportInputSchema.parse(input);
    const limit = data.limit ?? 100;
    const { bills, connection } = await xeroBills({
      startDate: data.startDate,
      endDate: data.endDate,
      limit
    }, limit, options?.tenantId);
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

        // Stock rules 6 + 7 + 8: classify the imported bill so accounting
        // doesn't trip over statements, WET-bearing wine bills, or GST
        // drift. Annotates the invoice in-place via sourceMetadata + flips
        // status to STATEMENT when appropriate.
        const ruleFlags = applyInvoiceRulesAfterImport({
          supplierName,
          subtotalCents: invoice.subtotalCents,
          taxCents: invoice.taxCents,
          totalCents: invoice.totalCents,
          lineCount,
          lineDescriptions: (bill.LineItems ?? []).map((line) => optionalText(line.Description) ?? '')
        });
        if (ruleFlags.isStatement || ruleFlags.gstDriftCents !== 0 || ruleFlags.isWine) {
          await tx.supplierInvoice.update({
            where: { id: invoice.id },
            data: {
              ...(ruleFlags.isStatement && { status: 'STATEMENT' }),
              sourceMetadata: {
                ...(invoice.sourceMetadata as Record<string, unknown> | null ?? {}),
                ruleFlags
              }
            }
          });
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
      await tx.integrationConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastError: warnings.length ? warnings.slice(0, 5).join(' | ') : null
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
            notes: `${squareAccountConfig(accountKey).label} Square ${row.locationName}: net sales (ex GST + tips) from ${row.paymentCount} completed payments${row.currency ? ` (${row.currency})` : ''}.`,
            importedById: actor.id
          },
          update: {
            salesCents: row.salesCents,
            notes: `${squareAccountConfig(accountKey).label} Square ${row.locationName}: net sales (ex GST + tips) from ${row.paymentCount} completed payments${row.currency ? ` (${row.currency})` : ''}.`,
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

    const itemSales = await integrationService.importSquareItemSales(input, actor, {
      syncType: options?.syncType ?? 'MANUAL',
      eventType: options?.syncType === 'SCHEDULED' ? 'SCHEDULED_SQUARE_ITEM_SALES_IMPORTED' : 'SQUARE_ITEM_SALES_IMPORTED'
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
      itemSalesRowsUpserted: itemSales.itemSalesRowsUpserted,
      itemOrdersRead: itemSales.ordersRead,
      itemLinesRead: itemSales.linesRead,
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
      warnings: [...warnings, ...itemSales.warnings]
    };
  },

  async importSquareItemSales(
    input: Record<string, unknown> = {},
    actor: AuthUser,
    options?: { syncType?: ImportRunMode; eventType?: string }
  ) {
    const accountKey = normaliseSquareAccountKey(input.account ?? input.accountKey);
    const lookbackDays = clampLimit(input.lookbackDays, DEFAULT_SCHEDULED_SQUARE_SALES_LOOKBACK_DAYS, 90);
    const limit = clampLimit(input.orderLimit ?? input.limit, DEFAULT_SQUARE_PAYMENT_IMPORT_LIMIT, 1000);
    const { start, end } = squareImportDateRange(input, lookbackDays);
    const connection = await connectedSquareConnection(accountKey);
    const squareStatus = squareMetadataStatus(connection);
    const locationIds = squareStatus.locations.map((location) => location.id).filter(Boolean);
    if (!locationIds.length) throw new HttpError(409, `${squareAccountConfig(accountKey).label} Square locations must be synced before item sales can import.`);

    const [ordersResponse, venues, recipes, confirmedMappings] = await Promise.all([
      searchSquareOrders({ connection, beginTime: start, endTime: end, locationIds, limit }),
      configuredVenueNames(),
      prisma.recipe.findMany({
        // Production recipes (sauces, batches) are never sold directly — they're
        // ingredients of other recipes. Excluding them here stops a batch that
        // shares a name with a sellable item (e.g. a "Guacamole" prep batch vs
        // the "Guacamole" plate) from stealing that item's sales attribution.
        where: { title: { not: '' }, isPrepRecipe: false },
        select: { id: true, title: true, venue: true }
      }),
      // Manager-confirmed Square menu mappings drive attribution ahead of name
      // matching: they route same-named items to the exact linked recipe and
      // send $0 tasting/BB components to their mapped (often prep) recipe.
      prisma.squareMenuRecipeMapping.findMany({
        where: { accountKey, status: 'MAPPED', almaRecipeId: { not: null } },
        select: {
          squareItemId: true,
          squareVariationId: true,
          venue: true,
          squareItemName: true,
          almaRecipeId: true,
          priceMoneyAmount: true
        }
      })
    ]);
    const locationsById = new Map(squareStatus.locations.map((location) => [location.id, location]));
    const recipeByVenueAndName = new Map<string, { id: string; title: string; venue: string | null }>();
    const recipeByName = new Map<string, { id: string; title: string; venue: string | null }>();
    for (const recipe of recipes) {
      const nameKey = normaliseMatchText(recipe.title);
      if (!nameKey) continue;
      if (recipe.venue) recipeByVenueAndName.set(`${normaliseMatchText(recipe.venue)}|${nameKey}`, recipe);
      if (!recipeByName.has(nameKey)) recipeByName.set(nameKey, recipe);
    }

    // Confirmed Square menu mappings take priority over title matching. Catalog
    // ids are unique per Square item/variation, so they disambiguate items that
    // share a normalised name — the "$16 Guacamole" plate vs a "$0 Guacamole*"
    // tasting component both normalise to "guacamole". An order line carries the
    // variation id in catalog_object_id, so key on that first, then the item id.
    // The name fallbacks are price-aware: on a collision the higher-priced
    // mapping wins, so a real sellable item beats a $0 component sharing its name.
    const mappingByCatalogId = new Map<string, string>();
    const mappingByVenueName = new Map<string, { recipeId: string; price: number }>();
    const mappingByName = new Map<string, { recipeId: string; price: number }>();
    for (const mapping of confirmedMappings) {
      if (!mapping.almaRecipeId) continue;
      if (mapping.squareVariationId) mappingByCatalogId.set(mapping.squareVariationId, mapping.almaRecipeId);
      if (mapping.squareItemId && !mappingByCatalogId.has(mapping.squareItemId)) {
        mappingByCatalogId.set(mapping.squareItemId, mapping.almaRecipeId);
      }
      const nameKey = normaliseMatchText(mapping.squareItemName);
      if (!nameKey) continue;
      const price = mapping.priceMoneyAmount ?? 0;
      if (mapping.venue) {
        const venueNameKey = `${normaliseMatchText(mapping.venue)}|${nameKey}`;
        const prev = mappingByVenueName.get(venueNameKey);
        if (!prev || price > prev.price) {
          mappingByVenueName.set(venueNameKey, { recipeId: mapping.almaRecipeId, price });
        }
      }
      const prevName = mappingByName.get(nameKey);
      if (!prevName || price > prevName.price) {
        mappingByName.set(nameKey, { recipeId: mapping.almaRecipeId, price });
      }
    }

    const source = `square-item:${accountKey}`;
    const grouped = new Map<string, {
      venue: string;
      serviceDateKey: string;
      serviceDate: Date;
      source: string;
      externalId: string;
      itemName: string;
      variationName: string | null;
      catalogObjectId: string | null;
      catalogVersion: string | null;
      locationId: string;
      locationName: string;
      quantity: number;
      grossSalesCents: number;
      netSalesCents: number;
      orderIds: Set<string>;
      lineCount: number;
      recipeId: string | null;
    }>();
    let skippedLines = 0;

    for (const order of ordersResponse.orders) {
      const orderDate = providerDate(order.closed_at ?? order.created_at);
      const orderId = optionalText(order.id);
      const locationId = optionalText(order.location_id) ?? 'account';
      const location = locationsById.get(locationId) ?? null;
      if (!orderDate || !orderId) {
        skippedLines += order.line_items?.length ?? 0;
        continue;
      }
      const timeZone = location?.timezone || 'Australia/Sydney';
      const serviceDateKey = dateKeyInTimeZone(orderDate, timeZone);
      const venue = squarePaymentVenue({ accountKey, location, venues });
      const venueKey = normaliseMatchText(venue);
      for (const line of order.line_items ?? []) {
        if (line.item_type && line.item_type !== 'ITEM') {
          skippedLines += 1;
          continue;
        }
        const itemName = optionalText(line.name);
        if (!itemName) {
          skippedLines += 1;
          continue;
        }
        const quantity = squareOrderLineQuantity(line);
        const grossSalesCents = squareOrderLineGrossCents(line);
        const netSalesCents = squareOrderLineNetCents(line);
        // Keep $0-net lines as long as a real quantity was rung. Venues ring
        // tasting-menu courses ("* …") and bottomless-brunch components ("BB
        // …") as $0 items so the revenue sits on the priced parent. Capturing
        // them lets each component's mapped recipe cost flow into theoretical
        // COGS even though the line itself carries no revenue. (Comps/voids
        // ring as $0 too — they only affect COGS if you map them to a recipe.)
        if (quantity <= 0) {
          skippedLines += 1;
          continue;
        }
        const itemNameKey = normaliseMatchText(itemName);
        const catalogObjectId = optionalText(line.catalog_object_id);
        // Resolve the recipe: a confirmed mapping wins (catalog id → venue+name →
        // name); otherwise fall back to a non-prep recipe title match.
        const mappedRecipeId =
          (catalogObjectId ? mappingByCatalogId.get(catalogObjectId) : undefined) ??
          mappingByVenueName.get(`${venueKey}|${itemNameKey}`)?.recipeId ??
          mappingByName.get(itemNameKey)?.recipeId ??
          null;
        const nameRecipe =
          recipeByVenueAndName.get(`${venueKey}|${itemNameKey}`) ?? recipeByName.get(itemNameKey) ?? null;
        const resolvedRecipeId = mappedRecipeId ?? nameRecipe?.id ?? null;
        const variationName = optionalText(line.variation_name);
        const catalogVersion = line.catalog_version === undefined ? null : String(line.catalog_version);
        const itemKey = catalogObjectId ?? `${itemNameKey}:${normaliseMatchText(variationName)}`;
        const externalId = `${source}:${locationId}:${serviceDateKey}:${itemKey}`;
        const key = `${venue}|${serviceDateKey}|${externalId}`;
        const existing = grouped.get(key) ?? {
          venue,
          serviceDateKey,
          serviceDate: startOfUtcDate(serviceDateKey),
          source,
          externalId,
          itemName,
          variationName,
          catalogObjectId,
          catalogVersion,
          locationId,
          locationName: location?.name ?? location?.businessName ?? squareAccountConfig(accountKey).label,
          quantity: 0,
          grossSalesCents: 0,
          netSalesCents: 0,
          orderIds: new Set<string>(),
          lineCount: 0,
          recipeId: resolvedRecipeId
        };
        existing.quantity += quantity;
        existing.grossSalesCents += grossSalesCents;
        existing.netSalesCents += netSalesCents;
        existing.orderIds.add(orderId);
        existing.lineCount += 1;
        if (!existing.recipeId && resolvedRecipeId) existing.recipeId = resolvedRecipeId;
        grouped.set(key, existing);
      }
    }

    const rows = Array.from(grouped.values());
    const warnings: string[] = [];
    if (ordersResponse.limited) warnings.push(`Square returned the first ${limit} orders only. Run a shorter date range to import the remaining item sales.`);
    if (skippedLines > 0) warnings.push(`${skippedLines} Square order lines were skipped because they were not item sales, had no item name, or had no positive quantity/sales.`);
    const unmatchedRows = rows.filter((row) => !row.recipeId).length;
    if (unmatchedRows > 0) warnings.push(`${unmatchedRows} Square item sales rows did not match a Stock item recipe title yet.`);

    // Upsert in small batched transactions rather than one long-lived
    // interactive transaction. A large import (hundreds of rows) would
    // otherwise exceed the interactive-transaction timeout or lose its pooled
    // Cloud Run DB connection mid-loop, failing with "Transaction not found".
    // Each batch is a fast single-round-trip transaction; upserts are
    // idempotent (unique key) so a re-run safely fills any gap.
    const UPSERT_BATCH_SIZE = 50;
    for (let batchStart = 0; batchStart < rows.length; batchStart += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(batchStart, batchStart + UPSERT_BATCH_SIZE);
      await prisma.$transaction(
        batch.map((row) =>
          prisma.salesItemActualEntry.upsert({
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
              source: row.source,
              externalId: row.externalId,
              itemName: row.itemName,
              variationName: row.variationName,
              catalogObjectId: row.catalogObjectId,
              catalogVersion: row.catalogVersion,
              locationId: row.locationId,
              locationName: row.locationName,
              quantity: row.quantity,
              grossSalesCents: row.grossSalesCents,
              netSalesCents: row.netSalesCents,
              orderCount: row.orderIds.size,
              lineCount: row.lineCount,
              recipeId: row.recipeId,
              notes: `${squareAccountConfig(accountKey).label} Square item sales import.`,
              sourceMetadata: {
                importedFrom: 'square',
                accountKey,
                orderCount: row.orderIds.size,
                matchedRecipe: Boolean(row.recipeId)
              },
              importedById: actor.id
            },
            update: {
              itemName: row.itemName,
              variationName: row.variationName,
              catalogObjectId: row.catalogObjectId,
              catalogVersion: row.catalogVersion,
              locationId: row.locationId,
              locationName: row.locationName,
              quantity: row.quantity,
              grossSalesCents: row.grossSalesCents,
              netSalesCents: row.netSalesCents,
              orderCount: row.orderIds.size,
              lineCount: row.lineCount,
              recipeId: row.recipeId,
              notes: `${squareAccountConfig(accountKey).label} Square item sales import.`,
              sourceMetadata: {
                importedFrom: 'square',
                accountKey,
                orderCount: row.orderIds.size,
                matchedRecipe: Boolean(row.recipeId)
              },
              importedById: actor.id
            }
          })
        )
      );
    }
    await prisma.integrationSyncRun.create({
      data: {
        provider: 'SQUARE',
        connectionId: ordersResponse.connection.id,
        syncType: options?.syncType ?? 'MANUAL',
        status: 'SUCCESS',
        finishedAt: new Date(),
        recordsImported: rows.length,
        recordsUpdated: ordersResponse.orders.length,
        errorSummary: warnings.length ? warnings.slice(0, 5).join(' | ') : null
      }
    });

    await recordEvent({
      provider: 'SQUARE',
      connectionId: ordersResponse.connection.id,
      eventType: options?.eventType ?? 'SQUARE_ITEM_SALES_IMPORTED',
      summary: `${squareAccountConfig(accountKey).label} Square item sales import finished: ${rows.length} item rows from ${ordersResponse.orders.length} orders.`,
      actor,
      metadata: {
        accountKey,
        syncType: options?.syncType ?? 'MANUAL',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        ordersRead: ordersResponse.orders.length,
        itemSalesRowsUpserted: rows.length,
        skippedLines,
        unmatchedRows,
        tokenStatus: ordersResponse.tokenStatus,
        limited: ordersResponse.limited
      }
    });

    return {
      provider: 'square' as const,
      accountKey,
      label: squareAccountConfig(accountKey).label,
      generatedAt: new Date().toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      ordersRead: ordersResponse.orders.length,
      linesRead: rows.reduce((sum, row) => sum + row.lineCount, 0),
      itemSalesRowsUpserted: rows.length,
      unmatchedRows,
      skippedLines,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalNetSalesCents: rows.reduce((sum, row) => sum + row.netSalesCents, 0),
      tokenStatus: ordersResponse.tokenStatus,
      limited: ordersResponse.limited,
      warnings
    };
  },

  async runScheduledXeroImport(input: Record<string, unknown> = {}) {
    const generatedAt = new Date();
    const lookbackDays = clampLimit(input.lookbackDays, DEFAULT_SCHEDULED_XERO_LOOKBACK_DAYS, 180);
    // Cap raised from 100 → 1000 so the admin "Backfill 90d" button can
    // pull a full quarter of supplier bills without silent truncation.
    // Scheduled jobs continue to use the lower DEFAULT_…_BILLS_LIMIT
    // unless they explicitly opt in to a larger window.
    const billsLimit = clampLimit(input.billsLimit, DEFAULT_SCHEDULED_XERO_BILLS_LIMIT, 1000);
    const contactsLimit = clampLimit(input.contactsLimit, DEFAULT_SCHEDULED_XERO_CONTACTS_LIMIT, 500);
    const includeContacts = input.includeContacts !== false;
    const includeBills = input.includeBills !== false;

    // Multi-tenant: a Xero OAuth grant can cover multiple orgs (e.g.
    // both "Alma Avalon" and "St Alma" on a single connection). Iterate
    // every tenant on the connection. Fall back to the primary tenant
    // for older connections that pre-date the metadata.xeroTenants
    // capture (i.e. connections authorised before this rollout).
    const connection = await connectedXeroConnection();
    const recordedTenants = xeroTenantsFromConnection(connection);
    const targets = recordedTenants.length > 0
      ? recordedTenants
      : connection.providerAccountId
        ? [{ id: connection.providerAccountId, name: connection.providerAccountName ?? null }]
        : [];

    if (targets.length === 0) {
      throw new HttpError(409, 'No Xero tenants are connected.');
    }

    // Resolve each Xero org to a venue so bills don't all land as Unassigned.
    const venueNames = await configuredVenueNames();

    const perTenant: Array<{
      tenantId: string;
      tenantName: string | null;
      contacts: XeroSupplierContactsImportResult | null;
      bills: XeroSupplierBillsImportResult | null;
      billCandidates: number;
      billIdsImported: number;
      warnings: string[];
      error: string | null;
    }> = [];

    for (const tenant of targets) {
      const tenantWarnings: string[] = [];
      let contactsResult: XeroSupplierContactsImportResult | null = null;
      let billsResult: XeroSupplierBillsImportResult | null = null;
      let billCandidates = 0;
      let billIds: string[] = [];
      let tenantError: string | null = null;

      try {
        if (includeContacts) {
          contactsResult = await integrationService.importXeroSupplierContacts(
            { importAllCandidates: true, limit: contactsLimit },
            integrationSchedulerActor,
            { syncType: 'SCHEDULED', eventType: 'SCHEDULED_SUPPLIER_CONTACTS_IMPORTED', tenantId: tenant.id }
          );
        }
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
            statuses: 'AUTHORISED,PAID',
            tenantId: tenant.id
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
            tenantWarnings.push(`${skippedForReview} ${tenant.name ?? tenant.id} bills were left for manual review (duplicate, no supplier match, or no line items).`);
          }
          if (billIds.length > 0) {
            const tenantVenue = resolveVenueFromTenantName(tenant.name, venueNames);
            if (!tenantVenue) {
              tenantWarnings.push(
                `${tenant.name ?? tenant.id} did not match a configured venue — bills imported as Unassigned. Rename the venue or org to match.`
              );
            }
            billsResult = await integrationService.importXeroSupplierBills(
              {
                billIds,
                startDate,
                endDate,
                limit: billsLimit,
                allowCreateSuppliers: false,
                venue: tenantVenue ?? undefined,
                confirmationText: 'IMPORT XERO BILLS'
              },
              integrationSchedulerActor,
              { syncType: 'SCHEDULED', eventType: 'SCHEDULED_SUPPLIER_BILLS_IMPORTED', tenantId: tenant.id }
            );
          } else {
            billsResult = {
              generatedAt: new Date().toISOString(),
              importedCount: 0,
              skippedCount: skippedForReview,
              duplicateCount: preview.bills.filter((bill) => bill.duplicateStatus !== 'new').length,
              supplierCreatedCount: 0,
              lineCount: 0,
              warnings: tenantWarnings
            };
          }
        }
      } catch (error) {
        tenantError = safeErrorMessage(error);
      }

      perTenant.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        contacts: contactsResult,
        bills: billsResult,
        billCandidates,
        billIdsImported: billIds.length,
        warnings: tenantWarnings,
        error: tenantError
      });
    }

    // Record one combined sync run row + update connection state. Per-
    // tenant detail is in the metadata so admin UI can show it.
    const completedAt = new Date();
    const errorMessages = perTenant.filter((entry) => entry.error).map((entry) => `${entry.tenantName ?? entry.tenantId}: ${entry.error}`);
    const allWarnings = perTenant.flatMap((entry) => entry.warnings);
    const totalImported = perTenant.reduce((sum, entry) => sum + (entry.bills?.importedCount ?? 0), 0);
    const totalContactsCreated = perTenant.reduce((sum, entry) => sum + (entry.contacts?.createdCount ?? 0), 0);
    const status = errorMessages.length > 0 && perTenant.every((entry) => entry.error) ? 'ERROR' : 'SUCCESS';

    await prisma.integrationSyncRun.create({
      data: {
        provider: 'XERO',
        connectionId: connection.id,
        syncType: 'SCHEDULED',
        status,
        finishedAt: completedAt,
        recordsImported: totalImported,
        recordsUpdated: totalContactsCreated,
        errorSummary: [...errorMessages, ...allWarnings].slice(0, 5).join(' | ').slice(0, 500) || null
      }
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: completedAt,
        lastSyncStatus: status,
        lastError: errorMessages.length > 0 ? errorMessages.join(' | ').slice(0, 500) : null
      }
    });

    // If every single tenant failed, surface the first error to the
    // caller — scheduled jobs treat a thrown error as a retryable
    // outage. Partial success returns normally and the UI / warnings
    // expose which tenants didn't complete.
    if (status === 'ERROR') {
      throw new HttpError(502, `Xero scheduled import failed for all tenants: ${errorMessages.join(' | ')}`);
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
      tenants: perTenant,
      tenantCount: perTenant.length,
      warnings: allWarnings
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
      itemSalesRowsUpserted: number;
      paymentsRead: number;
      ordersRead: number;
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
            itemSalesRowsUpserted: 0,
            paymentsRead: 0,
            ordersRead: 0,
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
          itemSalesRowsUpserted: sales?.itemSalesRowsUpserted ?? 0,
          paymentsRead: sales?.paymentsRead ?? 0,
          ordersRead: sales?.itemOrdersRead ?? 0,
          message: includeSales
            ? 'Square locations, payment totals and item sales synced into Reports sales actuals. Inventory was not imported.'
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
          itemSalesRowsUpserted: 0,
          paymentsRead: 0,
          ordersRead: 0,
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
      ordersRead: results.reduce((sum, result) => sum + result.ordersRead, 0),
      salesRowsUpserted: results.reduce((sum, result) => sum + result.salesRowsUpserted, 0),
      itemSalesRowsUpserted: results.reduce((sum, result) => sum + result.itemSalesRowsUpserted, 0)
    };
  },

  async runScheduledIntegrationImports(input: Record<string, unknown> = {}) {
    const includeSquare = input.includeSquare !== false;
    const includeXero = input.includeXero !== false;
    const includeDeputy = input.includeDeputy !== false;
    const results: { square: unknown | null; xero: unknown | null; deputy: unknown | null } = {
      square: null,
      xero: null,
      deputy: null
    };
    if (includeSquare) results.square = await integrationService.runScheduledSquareSync(input.square && typeof input.square === 'object' && !Array.isArray(input.square) ? input.square as Record<string, unknown> : input);
    if (includeXero) results.xero = await integrationService.runScheduledXeroImport(input.xero && typeof input.xero === 'object' && !Array.isArray(input.xero) ? input.xero as Record<string, unknown> : input);
    if (includeDeputy) {
      // Lazy import keeps integration.service.ts free of any dependency
      // on the Deputy sync handlers; the connection plumbing here just
      // dispatches to deputy.service.ts which owns the actual sync work.
      const { deputyService } = await import('./deputy.service.js');
      results.deputy = await deputyService.runScheduledSync().catch((error) => ({
        ok: false,
        error: error instanceof Error ? error.message : 'Deputy sync failed'
      }));
    }
    return {
      generatedAt: new Date().toISOString(),
      mode: 'scheduled',
      includeSquare,
      includeXero,
      includeDeputy,
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

    if (provider === 'DEPUTY') {
      // Deputy's OAuth handshake lives on the shared once.deputy.com host;
      // the token response gives us the per-tenant subdomain to use after.
      const url = new URL(env.integrations.deputy.authorizeUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', env.integrations.deputy.clientId);
      url.searchParams.set('redirect_uri', env.integrations.deputy.redirectUrl);
      url.searchParams.set('scope', env.integrations.deputy.scope);
      url.searchParams.set('state', rawState);
      return { provider: 'deputy', authorizationUrl: url.toString(), expiresAt: expiresAt.toISOString() };
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
      } else if (provider === 'DEPUTY') {
        const config = providerConfig('DEPUTY');
        if (!config.oauthConfigured) throw new HttpError(503, 'Deputy OAuth configuration is missing.');
        const token = await exchangeDeputyToken(code);
        if (!token.access_token || !token.refresh_token) throw new HttpError(502, 'Deputy did not return OAuth tokens.');
        if (!token.endpoint) throw new HttpError(502, 'Deputy did not return a per-tenant endpoint host.');
        const existing = await connectionSelect('DEPUTY');
        const connection = await prisma.integrationConnection.upsert({
          where: { id: existing?.id ?? '__new_deputy_connection__' },
          update: {
            status: 'CONNECTED',
            connectedAt: new Date(),
            disconnectedAt: null,
            lastError: null,
            providerAccountName: token.endpoint,
            providerAccountId: token.endpoint,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : [env.integrations.deputy.scope],
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            metadata: { endpoint: token.endpoint },
            updatedByUserId: stateRow.createdByUserId
          },
          create: {
            provider: 'DEPUTY',
            status: 'CONNECTED',
            connectedAt: new Date(),
            providerAccountName: token.endpoint,
            providerAccountId: token.endpoint,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : [env.integrations.deputy.scope],
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            metadata: { endpoint: token.endpoint },
            updatedByUserId: stateRow.createdByUserId
          }
        });
        await prisma.integrationSyncRun.create({
          data: { provider, connectionId: connection.id, syncType: 'OAUTH_CALLBACK', status: 'SUCCESS', finishedAt: new Date() }
        });
        await recordEvent({
          provider,
          connectionId: connection.id,
          eventType: 'CONNECTED',
          summary: `Deputy connected — tenant endpoint ${token.endpoint}.`,
          metadata: { endpoint: token.endpoint }
        });
      } else {
        const token = await exchangeXeroToken(code);
        if (!token.access_token || !token.refresh_token) throw new HttpError(502, 'Xero did not return OAuth tokens.');
        // Xero lets a single OAuth grant cover multiple tenants when the
        // user picks more than one org on the consent screen. Store ALL
        // of them on metadata so the scheduler can iterate; the primary
        // (first) tenant keeps the providerAccountId slot for back-compat
        // with all the existing single-tenant call sites.
        const tenants = await fetchXeroTenants(token.access_token);
        const primaryTenant = tenants[0] ?? null;
        const existingConnection = await connectionSelect('XERO');
        const metadataPayload = xeroMetadata({
          tenants,
          existing: existingConnection?.metadata,
          syncedAt: new Date()
        });
        const connection = await prisma.integrationConnection.upsert({
          where: { id: existingConnection?.id ?? '__new_xero_connection__' },
          update: {
            status: 'CONNECTED',
            connectedAt: new Date(),
            disconnectedAt: null,
            lastError: null,
            providerAccountId: primaryTenant?.id ?? null,
            providerAccountName: primaryTenant?.name ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : XERO_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            metadata: metadataPayload,
            updatedByUserId: stateRow.createdByUserId
          },
          create: {
            provider: 'XERO',
            status: 'CONNECTED',
            connectedAt: new Date(),
            providerAccountId: primaryTenant?.id ?? null,
            providerAccountName: primaryTenant?.name ?? null,
            scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : XERO_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
            metadata: metadataPayload,
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
      // Acknowledge (200) so Square stops retrying — a mismatched signature will
      // never verify on retry, so 401s just create a retry storm. We deliberately
      // do NOT process the unverified payload; the 15-min sales poll backfills.
      // Fix by aligning SQUARE_<ACCOUNT>_WEBHOOK_SIGNATURE_KEY + SQUARE_WEBHOOK_URL
      // with the subscription's signature key + notification URL in Square.
      console.warn(
        `[square-webhook] signature verification failed for the ${accountKey} account — acknowledged without processing.`
      );
      return { ok: false, ignored: 'invalid_signature' as const, account: accountKey };
    }
    return recordWebhook('SQUARE', rawBody, accountKey);
  },

  async syncXeroPayRates(actor: AuthUser): Promise<XeroPayRateSyncResult> {
    const connection = await connectedXeroConnection();

    type XeroPayrollEmployee = {
      EmployeeID: string;
      FirstName: string;
      LastName: string;
      Email?: string;
      Status: string;
      PayTemplate?: {
        EarningsLines?: Array<{
          EarningsRateID?: string;
          EarningsType?: string;
          RatePerUnit?: number;
          NormalNumberOfUnits?: number;
        }>;
      };
    };

    const response = await xeroGetJson<{ Employees?: XeroPayrollEmployee[] }>(
      '/payroll.xro/1.0/Employees',
      { connection }
    );

    const xeroEmployees = (response.data.Employees ?? []).filter(
      (e) => e.Status === 'ACTIVE'
    );

    const staffProfiles = await prisma.staffProfile.findMany({
      where: { mergedIntoStaffProfileId: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        xeroEmployeeId: true,
        payRateCents: true,
        payProfile: { select: { payMode: true } }
      }
    });

    const byXeroId = new Map(
      staffProfiles
        .filter((p) => p.xeroEmployeeId)
        .map((p) => [p.xeroEmployeeId!.toLowerCase(), p])
    );
    const byEmail = new Map(
      staffProfiles
        .filter((p) => p.email)
        .map((p) => [p.email!.toLowerCase(), p])
    );
    // Name fallback (accent/case-insensitive) for staff with no Xero ID and a
    // non-matching/absent email — catches the bulk that would otherwise be
    // left unmatched. Only used when the name is unambiguous (one staffer).
    const xeroNameKey = (first: string, last: string) =>
      `${first} ${last}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
    const byName = new Map<string, typeof staffProfiles>();
    for (const p of staffProfiles) {
      const key = xeroNameKey(p.firstName, p.lastName);
      const list = byName.get(key) ?? [];
      list.push(p);
      byName.set(key, list);
    }

    const updated: XeroPayRateSyncResult['updated'] = [];
    const unmatched: XeroPayRateSyncResult['unmatched'] = [];
    let skipped = 0;

    for (const emp of xeroEmployees) {
      const earningsLine = emp.PayTemplate?.EarningsLines?.find(
        (l) => l.EarningsType === 'ORDINARYTIMEEARNINGS'
      ) ?? emp.PayTemplate?.EarningsLines?.[0];

      const ratePerUnit = earningsLine?.RatePerUnit;
      if (!ratePerUnit || ratePerUnit <= 0) {
        skipped++;
        continue;
      }

      const nameList = byName.get(xeroNameKey(emp.FirstName, emp.LastName)) ?? [];
      const profile =
        byXeroId.get(emp.EmployeeID.toLowerCase()) ??
        (emp.Email ? byEmail.get(emp.Email.toLowerCase()) : undefined) ??
        (nameList.length === 1 ? nameList[0] : undefined);

      if (!profile) {
        unmatched.push({
          xeroEmployeeId: emp.EmployeeID,
          firstName: emp.FirstName,
          lastName: emp.LastName,
          email: emp.Email ?? null
        });
        continue;
      }

      // The Alma profile is the source of truth for salaried staff: if a
      // manager has set a manual full-time salary, don't let Xero's hourly
      // rate clobber it. Still stamp the Xero link for traceability.
      if (profile.payProfile?.payMode === 'MANUAL_FULL_TIME') {
        if (!profile.xeroEmployeeId) {
          await prisma.staffProfile.update({ where: { id: profile.id }, data: { xeroEmployeeId: emp.EmployeeID } });
        }
        skipped++;
        continue;
      }

      const newPayRateCents = Math.round(ratePerUnit * 100);
      await prisma.staffProfile.update({
        where: { id: profile.id },
        // Stamp the Xero link so future syncs match by id even when first
        // matched by name/email.
        data: { payRateCents: newPayRateCents, xeroEmployeeId: emp.EmployeeID }
      });

      updated.push({
        staffId: profile.id,
        firstName: profile.firstName,
        lastName: profile.lastName,
        previousPayRateCents: profile.payRateCents,
        newPayRateCents,
        xeroEmployeeId: emp.EmployeeID
      });
    }

    await recordEvent({
      provider: 'XERO',
      connectionId: response.connection.id,
      eventType: 'DATA_IMPORTED',
      summary: `Xero pay rates synced: ${updated.length} updated, ${unmatched.length} unmatched, ${skipped} skipped.`,
      actor,
      metadata: {
        tokenStatus: response.tokenStatus,
        synced: updated.length,
        unmatched: unmatched.length,
        skipped
      }
    });

    return {
      synced: updated.length,
      skipped,
      notMatched: unmatched.length,
      updated,
      unmatched
    };
  },

  async handleXeroWebhook(req: Request) {
    const rawBody = rawBodyFromRequest(req);
    if (!verifyXeroSignature(req, rawBody)) {
      throw new HttpError(401, 'Invalid Xero webhook signature.');
    }
    return recordWebhook('XERO', rawBody);
  },

  async handleDeputyWebhook(req: Request) {
    const rawBody = rawBodyFromRequest(req);
    if (!verifyDeputySignature(req)) {
      throw new HttpError(401, 'Invalid Deputy webhook signature.');
    }
    return recordWebhook('DEPUTY', rawBody);
  },

  /**
   * Pull a longer historical window than the scheduled jobs do.
   *
   * Square sales: chunked by 7-day windows so each call stays under the
   *   1000-payment cap. Item-level sales are pulled per chunk too so
   *   Reports can do menu engineering. Auto-match runs on every line.
   *
   * Xero bills: single call with lookbackDays clamped to 180. Auto-match
   *   runs on every line during import.
   *
   * Deputy: triggers syncAllNow which already pulls roster +14d / -7d
   *   plus a full employee + document sync. Deputy's API does not expose
   *   arbitrary historical roster windows.
   */
  async backfillSquareSales(input: { days?: number; account?: string | null } = {}, actor: AuthUser) {
    const days = clampLimit(input.days, 90, 90);
    const chunkDays = 7;
    const accountKey = input.account ?? 'primary';

    // Chunk boundaries are pinned to Sydney local midnight so a single
    // Sydney service day never spans two chunks. importSquareSales
    // upserts by (venue, serviceDate, source, externalId) with
    // REPLACEMENT semantics, so a boundary inside a Sydney day would
    // let the later chunk overwrite the earlier chunk's partial totals
    // for that day — under-reporting sales on every chunk seam.
    //
    // Working in Sydney-local date space (then converting to UTC) keeps
    // the chunking honest across the AEST↔AEDT DST flip.
    const todaySydneyKey = dateKeyInTimeZone(new Date(), 'Australia/Sydney');
    const boundaryKeys: string[] = [];
    // Walk back from "tomorrow Sydney" in chunkDays steps so the final
    // boundary closes at end-of-today Sydney and every Sydney day is
    // wholly contained in exactly one chunk.
    boundaryKeys.push(addSydneyDays(todaySydneyKey, 1));
    for (let offset = chunkDays; offset < days; offset += chunkDays) {
      boundaryKeys.unshift(addSydneyDays(todaySydneyKey, 1 - offset));
    }
    boundaryKeys.unshift(addSydneyDays(todaySydneyKey, 1 - days));
    const chunkBoundaries: Date[] = boundaryKeys.map(sydneyMidnightUtc);

    let chunks = 0;
    let paymentsRead = 0;
    let salesRows = 0;
    let itemRows = 0;
    let totalSalesCents = 0;
    const warnings: string[] = [];

    for (let i = 0; i < chunkBoundaries.length - 1; i += 1) {
      const windowStart = chunkBoundaries[i]!;
      const windowEnd = chunkBoundaries[i + 1]!;
      // Pass full ISO datetimes (with the Sydney-aligned UTC time) so
      // squareImportDateRange doesn't truncate to UTC midnight.
      const startIso = windowStart.toISOString();
      const endIso = windowEnd.toISOString();
      const startLabel = dateKeyInTimeZone(windowStart, 'Australia/Sydney');
      const endLabel = dateKeyInTimeZone(new Date(windowEnd.getTime() - 1), 'Australia/Sydney');
      try {
        const sales = await integrationService.importSquareSales(
          { account: accountKey, startDate: startIso, endDate: endIso, limit: 1000 },
          actor,
          { syncType: 'MANUAL', eventType: 'admin.backfill' }
        );
        paymentsRead += sales.paymentsRead ?? 0;
        salesRows += sales.salesRowsUpserted ?? 0;
        itemRows += sales.itemSalesRowsUpserted ?? 0;
        totalSalesCents += sales.totalSalesCents ?? 0;
        if (Array.isArray(sales.warnings)) {
          warnings.push(...sales.warnings.map((w: string) => `${startLabel}..${endLabel}: ${w}`));
        }
      } catch (error) {
        warnings.push(`${startLabel}..${endLabel}: ${error instanceof Error ? error.message : String(error)}`);
      }
      chunks += 1;
    }

    return {
      provider: 'square' as const,
      account: accountKey,
      days,
      chunks,
      paymentsRead,
      salesRows,
      itemRows,
      totalSalesCents,
      warnings
    };
  },

  async backfillXeroBills(input: { days?: number } = {}, _actor: AuthUser) {
    const days = clampLimit(input.days, 90, 180);
    // Override billsLimit to 1000 (matching the raised cap in
    // runScheduledXeroImport) so a 90-day backfill on an active venue
    // doesn't silently truncate at the 100-bill scheduled default.
    const result = await integrationService.runScheduledXeroImport({
      lookbackDays: days,
      billsLimit: 1000,
      allowCreateSuppliers: false
    });
    const billsImported = result.tenants.reduce(
      (total, tenant) => total + (tenant.billIdsImported ?? 0),
      0
    );
    const billCandidates = result.tenants.reduce(
      (total, tenant) => total + (tenant.billCandidates ?? 0),
      0
    );
    return {
      provider: 'xero' as const,
      days,
      tenantCount: result.tenantCount,
      billCandidates,
      billsImported,
      warnings: result.warnings
    };
  },

  async backfillDeputy(actor: AuthUser) {
    const result = await deputyService.syncAllNow(actor);
    return {
      provider: 'deputy' as const,
      ...result
    };
  }
};
