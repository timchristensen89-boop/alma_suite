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

function hashState(state: string) {
  return crypto.createHash('sha256').update(state).digest('hex');
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

function providerConfig(provider: Provider) {
  if (provider === 'SQUARE') {
    const isProduction = env.integrations.square.environment === 'production';
    return {
      configured: Boolean(
        env.integrations.square.applicationId &&
          env.integrations.square.applicationSecret &&
          env.integrations.square.redirectUrl
      ),
      missingEnvVars: [
        env.integrations.square.applicationId ? null : 'SQUARE_APPLICATION_ID',
        env.integrations.square.applicationSecret ? null : 'SQUARE_APPLICATION_SECRET',
        env.integrations.square.redirectUrl ? null : 'SQUARE_REDIRECT_URI'
      ].filter((value): value is string => Boolean(value)),
      environment: isProduction ? 'production' : 'sandbox',
      oauthBaseUrl: isProduction ? 'https://connect.squareup.com/oauth2' : 'https://connect.squareupsandbox.com/oauth2',
      apiBaseUrl: isProduction ? 'https://connect.squareup.com/v2' : 'https://connect.squareupsandbox.com/v2',
      apiVersion: env.integrations.square.apiVersion,
      redirectUri: env.integrations.square.redirectUrl,
      webhookConfigured: Boolean(env.integrations.square.webhookSignatureKey && env.integrations.square.webhookUrl)
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
    webhookConfigured: Boolean(env.integrations.xero.webhookKey)
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

function connectionSelect(provider: Provider) {
  return prisma.integrationConnection.findFirst({
    where: { provider, scopeType: 'BUSINESS' },
    orderBy: { updatedAt: 'desc' }
  });
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
  existing?: unknown;
  locations?: SquareLocation[];
  syncedAt?: Date;
}): Prisma.InputJsonObject {
  const locations = input.locations?.map(squareLocationSummary).filter((location) => location.id) ?? [];
  return {
    ...metadataRecord(input.existing),
    squareEnvironment: providerConfig('SQUARE').environment,
    squareApiVersion: env.integrations.square.apiVersion,
    squareRedirectUri: env.integrations.square.redirectUrl,
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

async function providerStatus(provider: Provider): Promise<IntegrationProviderStatus> {
  const copy = PROVIDER_COPY[provider];
  const config = providerConfig(provider);
  const tokenStorage = integrationTokenEncryptionStatus();
  let connection: Awaited<ReturnType<typeof connectionSelect>> | null = null;
  let storageReady = true;
  try {
    connection = await connectionSelect(provider);
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
    ? blockedReason(provider, config.missingEnvVars, tokenStorage.configured)
    : 'Integration database setup is not active yet.';
  const status = !config.configured || !tokenStorage.configured
    ? 'NOT_CONFIGURED'
    : connection?.status ?? 'NOT_CONNECTED';
  const squareStatus = provider === 'SQUARE' ? squareMetadataStatus(connection) : null;

  return {
    provider: copy.key,
    label: copy.label,
    status,
    configured: config.configured && tokenStorage.configured,
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
    webhookConfigured: config.webhookConfigured,
    webhookStatus: config.webhookConfigured ? 'configured' : 'missing',
    powers: copy.powers,
    requiredSetup: copy.requiredSetup,
    missingEnvVars,
    actionLabel: connection?.status === 'CONNECTED' ? `Reconnect ${copy.label}` : `Connect ${copy.label}`,
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

async function exchangeSquareToken(code: string) {
  const response = await fetch(`${providerConfig('SQUARE').oauthBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: env.integrations.square.applicationId,
      client_secret: env.integrations.square.applicationSecret,
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

async function refreshSquareToken(refreshToken: string): Promise<SquareTokenResponse> {
  const response = await fetch(`${providerConfig('SQUARE').oauthBaseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: env.integrations.square.applicationId,
      client_secret: env.integrations.square.applicationSecret,
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

  const token = await refreshSquareToken(decryptIntegrationSecret(connection.refreshTokenEncrypted));
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
      metadata: squareMetadata({ existing: connection.metadata })
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

async function squareGetJsonWithAccessToken<T>(path: string, accessToken: string): Promise<T> {
  const config = providerConfig('SQUARE');
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

async function connectedSquareConnection() {
  const connection = await connectionSelect('SQUARE');
  if (!connection || connection.status !== 'CONNECTED') {
    throw new HttpError(409, 'Square is not connected.');
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
      data: await squareGetJsonWithAccessToken<T>(path, accessToken),
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

function verifySquareSignature(req: Request, rawBody: string) {
  const signature = req.header('x-square-hmacsha256-signature');
  const key = env.integrations.square.webhookSignatureKey;
  const url = env.integrations.square.webhookUrl;
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

async function recordWebhook(provider: Provider, rawBody: string) {
  const parsed = JSON.parse(rawBody || '{}') as Record<string, unknown>;
  const eventId =
    typeof parsed.event_id === 'string'
      ? parsed.event_id
      : typeof parsed.eventId === 'string'
        ? parsed.eventId
        : typeof parsed.id === 'string'
          ? parsed.id
          : crypto.createHash('sha256').update(rawBody).digest('hex');
  const eventType =
    typeof parsed.type === 'string'
      ? parsed.type
      : typeof parsed.eventType === 'string'
        ? parsed.eventType
        : Array.isArray(parsed.events)
          ? 'batch'
          : null;
  const connection = await connectionSelect(provider);

  try {
    await prisma.integrationWebhookEvent.create({
      data: {
        provider,
        connectionId: connection?.id ?? null,
        providerEventId: eventId,
        eventType,
        status: 'RECEIVED',
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
    const [square, xero, syncRuns] = await Promise.all([
      providerStatus('SQUARE'),
      providerStatus('XERO'),
      latestSyncRuns()
    ]);

    return {
      generatedAt: new Date().toISOString(),
      square,
      xero,
      meta: metaStatus(),
      latestSyncRuns: syncRuns,
      tokenStorage: integrationTokenEncryptionStatus()
    };
  },

  async checkSquareHealth(actor: AuthUser) {
    const checkedAt = new Date();
    const config = providerConfig('SQUARE');
    const tokenStorage = integrationTokenEncryptionStatus();
    const base = {
      provider: 'square' as const,
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
      connection = await connectionSelect('SQUARE');
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

  async refreshSquare(actor: AuthUser) {
    const connection = await connectedSquareConnection();
    const refreshed = await refreshSquareConnection(connection);
    await recordEvent({
      provider: 'SQUARE',
      connectionId: refreshed.id,
      eventType: 'TOKEN_REFRESHED',
      summary: 'Square OAuth token was refreshed manually.',
      actor
    });
    return {
      ok: true,
      provider: 'square' as const,
      expiresAt: toIso(refreshed.tokenExpiresAt)
    };
  },

  async syncSquareLocations(actor: AuthUser) {
    const connection = await connectedSquareConnection();
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
        syncType: 'MANUAL',
        status: 'SUCCESS',
        finishedAt: syncedAt,
        recordsImported: locations.length
      }
    });
    await recordEvent({
      provider: 'SQUARE',
      connectionId: updated.id,
      eventType: 'LOCATIONS_SYNCED',
      summary: `Square location sync finished: ${locations.length} locations read.`,
      actor,
      metadata: { locationCount: locations.length }
    });
    return {
      provider: 'square' as const,
      generatedAt: syncedAt.toISOString(),
      environment: providerConfig('SQUARE').environment,
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

  async importXeroSupplierContacts(input: unknown, actor: AuthUser): Promise<XeroSupplierContactsImportResult> {
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
          syncType: 'MANUAL',
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
      eventType: 'SUPPLIER_CONTACTS_IMPORTED',
      summary: `Xero supplier contact import finished: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      actor,
      metadata: { createdCount, updatedCount, skippedCount, conflictCount }
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

  async importXeroSupplierBills(input: unknown, actor: AuthUser): Promise<XeroSupplierBillsImportResult> {
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
          syncType: 'MANUAL',
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
      eventType: 'SUPPLIER_BILLS_IMPORTED',
      summary: `Xero supplier bill import finished: ${importedCount} imported, ${skippedCount} skipped, ${duplicateCount} duplicate.`,
      actor,
      metadata: { importedCount, skippedCount, duplicateCount, supplierCreatedCount, lineCount }
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

  async startConnect(providerInput: string, actor: AuthUser): Promise<IntegrationConnectResponse> {
    const provider = normaliseProvider(providerInput);
    const status = await providerStatus(provider);
    if (!status.canConnect) {
      throw new HttpError(503, status.connectBlockedReason ?? 'Integration connection is not configured.');
    }

    const rawState = crypto.randomBytes(32).toString('hex');
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
      summary: `${PROVIDER_COPY[provider].label} OAuth connection started.`,
      actor
    });

    if (provider === 'SQUARE') {
      const url = new URL(`${providerConfig('SQUARE').oauthBaseUrl}/authorize`);
      url.searchParams.set('client_id', env.integrations.square.applicationId);
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
    const stateRow = state
      ? await prisma.integrationOAuthState.findUnique({ where: { stateHash: hashState(state) } })
      : null;

    if (!stateRow || stateRow.provider !== provider || stateRow.consumedAt || stateRow.expiresAt < new Date()) {
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'invalid_state' });
    }

    await prisma.integrationOAuthState.update({
      where: { id: stateRow.id },
      data: { consumedAt: new Date() }
    });

    if (error || !code) {
      await recordEvent({
        provider,
        eventType: 'CONNECT_FAILED',
        summary: `${PROVIDER_COPY[provider].label} OAuth callback did not complete.`,
        metadata: { error: error || 'missing_code' }
      });
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'failed' });
    }

    try {
      if (provider === 'SQUARE') {
        const token = await exchangeSquareToken(code);
        if (!token.access_token || !token.refresh_token) throw new HttpError(502, 'Square did not return OAuth tokens.');
        const locationResponse = await squareGetJsonWithAccessToken<SquareLocationsResponse>('/locations', token.access_token);
        const syncedAt = new Date();
        const connection = await prisma.integrationConnection.upsert({
          where: { id: (await connectionSelect('SQUARE'))?.id ?? '__new_square_connection__' },
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
            metadata: squareMetadata({ locations: locationResponse.locations ?? [], syncedAt }),
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
            metadata: squareMetadata({ locations: locationResponse.locations ?? [], syncedAt }),
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
          summary: 'Square connected successfully and locations were verified.',
          metadata: {
            environment: providerConfig('SQUARE').environment,
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
      return frontendAdminRedirect({ integration: PROVIDER_COPY[provider].key, status: 'connected' });
    } catch (callbackError) {
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

  async disconnect(providerInput: string, actor: AuthUser) {
    const provider = normaliseProvider(providerInput);
    const connection = await connectionSelect(provider);
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
      summary: `${PROVIDER_COPY[provider].label} disconnected locally.`,
      actor
    });
    return { ok: true };
  },

  async test(providerInput: string, actor: AuthUser) {
    const provider = normaliseProvider(providerInput);
    if (provider === 'SQUARE') {
      return integrationService.checkSquareHealth(actor);
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

  async handleSquareWebhook(req: Request) {
    const rawBody = rawBodyFromRequest(req);
    if (!verifySquareSignature(req, rawBody)) {
      throw new HttpError(401, 'Invalid Square webhook signature.');
    }
    return recordWebhook('SQUARE', rawBody);
  },

  async handleXeroWebhook(req: Request) {
    const rawBody = rawBodyFromRequest(req);
    if (!verifyXeroSignature(req, rawBody)) {
      throw new HttpError(401, 'Invalid Xero webhook signature.');
    }
    return recordWebhook('XERO', rawBody);
  }
};
