import crypto from 'node:crypto';
import type { Request } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import type {
  AuthUser,
  IntegrationConnectResponse,
  IntegrationProviderKey,
  IntegrationProviderStatus,
  IntegrationStatusPayload
} from '@alma/shared';
import { env } from '../env.js';
import {
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
  'INVOICES_READ'
];

const XERO_SCOPES = [
  'offline_access',
  'accounting.transactions.read',
  'accounting.contacts.read',
  'accounting.settings.read'
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
        env.integrations.square.redirectUrl ? null : 'SQUARE_REDIRECT_URL'
      ].filter((value): value is string => Boolean(value)),
      environment: isProduction ? 'production' : 'sandbox',
      oauthBaseUrl: isProduction ? 'https://connect.squareup.com/oauth2' : 'https://connect.squareupsandbox.com/oauth2',
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
    webhookConfigured: Boolean(env.integrations.xero.webhookKey)
  };
}

function connectionSelect(provider: Provider) {
  return prisma.integrationConnection.findFirst({
    where: { provider, scopeType: 'BUSINESS' },
    orderBy: { updatedAt: 'desc' }
  });
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
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
  if (provider === 'SQUARE' && env.integrations.square.environment === 'production') {
    return 'Production Square connections are blocked until explicitly approved.';
  }
  return null;
}

async function providerStatus(provider: Provider): Promise<IntegrationProviderStatus> {
  const copy = PROVIDER_COPY[provider];
  const config = providerConfig(provider);
  const tokenStorage = integrationTokenEncryptionStatus();
  const connection = await connectionSelect(provider);
  const missingEnvVars = [
    ...config.missingEnvVars,
    ...(tokenStorage.configured ? [] : [tokenStorage.requiredEnvVar])
  ];
  const reason = blockedReason(provider, config.missingEnvVars, tokenStorage.configured);
  const status = !config.configured || !tokenStorage.configured
    ? 'NOT_CONFIGURED'
    : connection?.status ?? 'NOT_CONNECTED';

  return {
    provider: copy.key,
    label: copy.label,
    status,
    configured: config.configured && tokenStorage.configured,
    canConnect: !reason,
    connectBlockedReason: reason,
    providerAccountId: connection?.providerAccountId ?? null,
    providerAccountName: connection?.providerAccountName ?? null,
    connectedAt: toIso(connection?.connectedAt),
    disconnectedAt: toIso(connection?.disconnectedAt),
    lastSyncAt: toIso(connection?.lastSyncAt),
    lastSyncStatus: connection?.lastSyncStatus ?? null,
    lastError: connection?.lastError ?? null,
    scopes: Array.isArray(connection?.scopes) ? connection.scopes.filter((scope): scope is string => typeof scope === 'string') : [],
    environment: config.environment,
    webhookConfigured: config.webhookConfigured,
    webhookStatus: config.webhookConfigured ? 'configured' : 'missing',
    powers: copy.powers,
    requiredSetup: copy.requiredSetup,
    missingEnvVars,
    actionLabel: connection?.status === 'CONNECTED' ? `Reconnect ${copy.label}` : `Connect ${copy.label}`,
    actionDisabled: Boolean(reason)
  };
}

async function latestSyncRuns() {
  const runs = await prisma.integrationSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 8
  });

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

  return body as {
    access_token?: string;
    refresh_token?: string;
    expires_at?: string;
    merchant_id?: string;
    token_type?: string;
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
      latestSyncRuns: syncRuns,
      tokenStorage: integrationTokenEncryptionStatus()
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
        const connection = await prisma.integrationConnection.upsert({
          where: { id: (await connectionSelect('SQUARE'))?.id ?? '__new_square_connection__' },
          update: {
            status: 'CONNECTED',
            connectedAt: new Date(),
            disconnectedAt: null,
            lastError: null,
            providerAccountId: token.merchant_id ?? null,
            providerAccountName: token.merchant_id ?? null,
            scopes: SQUARE_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : null,
            updatedByUserId: stateRow.createdByUserId
          },
          create: {
            provider: 'SQUARE',
            status: 'CONNECTED',
            connectedAt: new Date(),
            providerAccountId: token.merchant_id ?? null,
            providerAccountName: token.merchant_id ?? null,
            scopes: SQUARE_SCOPES,
            tokenEncrypted: encryptIntegrationSecret(token.access_token),
            refreshTokenEncrypted: encryptIntegrationSecret(token.refresh_token),
            tokenExpiresAt: token.expires_at ? new Date(token.expires_at) : null,
            updatedByUserId: stateRow.createdByUserId
          }
        });
        await prisma.integrationSyncRun.create({
          data: { provider, connectionId: connection.id, syncType: 'OAUTH_CALLBACK', status: 'SUCCESS', finishedAt: new Date() }
        });
        await recordEvent({ provider, connectionId: connection.id, eventType: 'CONNECTED', summary: 'Square connected successfully.' });
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
