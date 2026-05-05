import { randomUUID } from 'node:crypto';
import { prisma } from './prisma.js';

const GOVEE_PROVIDER = 'govee';
const DEFAULT_GOVEE_BASE_URL = 'https://openapi.api.govee.com';

type JsonRecord = Record<string, unknown>;

type GoveeDevice = {
  device: string;
  deviceName?: string;
  model: string;
  sku?: string;
};

type GoveeReading = {
  humidityPct: number | null;
  raw: unknown[];
  recordedAt: Date;
  temperatureC: number;
};

type GoveeConfig = {
  apiKey: string;
  baseUrl: string;
};

type SyncOptions = {
  assetId?: string;
};

function normaliseGoveeBaseUrl(value: string | null | undefined) {
  const raw = value?.trim() || process.env.GOVEE_API_BASE_URL || DEFAULT_GOVEE_BASE_URL;
  return raw.includes('developer-api.govee.com')
    ? DEFAULT_GOVEE_BASE_URL
    : raw.replace(/\/router\/api\/v1\/?$/, '').replace(/\/$/, '');
}

function keyHint(apiKey: string) {
  return apiKey.length <= 8 ? '****' : `${apiKey.slice(0, 4)}***${apiKey.slice(-2)}`;
}

async function getConfig(): Promise<GoveeConfig> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const apiKey = (settings?.goveeApiKey || process.env.GOVEE_API_KEY || '').trim();

  if (!apiKey) {
    throw new Error('Missing govee API key. Add one in Settings > Integrations or set GOVEE_API_KEY.');
  }

  return {
    apiKey,
    baseUrl: normaliseGoveeBaseUrl(settings?.goveeBaseUrl)
  };
}

async function standardiseGoveeIntegrationRows() {
  let canonical = await prisma.temperatureIntegration.findUnique({
    where: { provider: GOVEE_PROVIDER }
  });
  const legacyRows = await prisma.temperatureIntegration.findMany({
    where: { provider: { in: ['GOVEE', 'Govee'] } },
    orderBy: { createdAt: 'asc' }
  });

  if (!canonical && legacyRows[0]) {
    canonical = await prisma.temperatureIntegration.update({
      where: { id: legacyRows[0].id },
      data: { provider: GOVEE_PROVIDER }
    });
  }

  if (!canonical) return null;

  for (const legacy of legacyRows.filter((row) => row.id !== canonical.id)) {
    const sensors = await prisma.temperatureSensor.findMany({
      where: { integrationId: legacy.id }
    });

    for (const sensor of sensors) {
      const existing = await prisma.temperatureSensor.findUnique({
        where: {
          integrationId_externalSensorId: {
            integrationId: canonical.id,
            externalSensorId: sensor.externalSensorId
          }
        }
      });

      if (existing) {
        await prisma.temperatureSensor.delete({ where: { id: sensor.id } });
      } else {
        await prisma.temperatureSensor.update({
          where: { id: sensor.id },
          data: { integrationId: canonical.id }
        });
      }
    }

    await prisma.temperatureIntegration.delete({ where: { id: legacy.id } });
  }

  return canonical;
}

async function ensureGoveeIntegration(config?: GoveeConfig) {
  const resolved = config ?? (await getConfig());
  await standardiseGoveeIntegrationRows();
  return prisma.temperatureIntegration.upsert({
    where: { provider: GOVEE_PROVIDER },
    create: {
      provider: GOVEE_PROVIDER,
      status: 'connected',
      apiKeyHint: keyHint(resolved.apiKey),
      baseUrl: resolved.baseUrl,
      lastError: null
    },
    update: {
      status: 'connected',
      apiKeyHint: keyHint(resolved.apiKey),
      baseUrl: resolved.baseUrl,
      lastError: null
    }
  });
}

async function markGoveeSyncFailure(message: string) {
  await prisma.temperatureIntegration.upsert({
    where: { provider: GOVEE_PROVIDER },
    create: {
      provider: GOVEE_PROVIDER,
      status: 'error',
      baseUrl: normaliseGoveeBaseUrl(null),
      lastError: message.slice(0, 500)
    },
    update: {
      status: 'error',
      lastError: message.slice(0, 500)
    }
  });
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asObject(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function request<T>(path: string) {
  const config = await getConfig();
  const response = await fetch(`${config.baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'Govee-API-Key': config.apiKey
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`govee request failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

function numberFromEntry(entry: unknown, keys: string[]) {
  const object = asObject(entry);
  if (!object) return null;

  for (const key of keys) {
    const direct = asNumber(object[key]);
    if (direct != null) return direct;
  }

  for (const value of Object.values(object)) {
    const nested = asObject(value);
    if (!nested) continue;

    for (const key of keys) {
      const direct = asNumber(nested[key]);
      if (direct != null) return direct;
    }

    if ('value' in nested) {
      const candidate = asNumber(nested.value);
      const text = `${asString(object.type) ?? ''} ${asString(object.instance) ?? ''} ${asString(object.property) ?? ''}`.toLowerCase();
      if (candidate != null && keys.some((key) => text.includes(key.toLowerCase()))) {
        return candidate;
      }
    }
  }

  return null;
}

function parseGoveeReading(payload: unknown): GoveeReading | null {
  const root = asObject(payload);
  const data = asObject(root?.payload ?? root?.data);
  const raw = asArray(data?.capabilities ?? data?.properties ?? []);

  let temperatureC: number | null = null;
  let humidityPct: number | null = null;

  for (const entry of raw) {
    if (temperatureC == null) {
      temperatureC = numberFromEntry(entry, ['temperature', 'temp', 'tem', 'sensorTemperature']);
    }
    if (humidityPct == null) {
      humidityPct = numberFromEntry(entry, ['humidity', 'hum', 'sensorHumidity']);
    }
  }

  if (temperatureC == null) return null;
  if (temperatureC > 30 && temperatureC < 130) temperatureC = ((temperatureC - 32) * 5) / 9;

  return {
    humidityPct,
    raw,
    recordedAt: new Date(),
    temperatureC
  };
}

function toTemperatureStatus(temperatureC: number, minTempC: number, maxTempC: number) {
  return temperatureC >= minTempC && temperatureC <= maxTempC ? 'IN_RANGE' : 'OUT_OF_RANGE';
}

async function maybeCreateTemperatureIssue(asset: {
  id: string;
  name: string;
  venue: string | null;
  minTempC: number;
  maxTempC: number;
}, reading: GoveeReading) {
  const existing = await prisma.issue.findFirst({
    where: {
      category: 'Temperature',
      notes: { contains: `temperature-asset:${asset.id}` },
      status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] },
      createdAt: { gte: new Date(Date.now() - 12 * 60 * 60 * 1000) }
    }
  });

  if (existing) return existing.id;

  const created = await prisma.issue.create({
    data: {
      title: `${asset.name} temperature out of range`,
      description: `Auto-created from govee sync. Reading ${reading.temperatureC.toFixed(1)}C is outside ${asset.minTempC.toFixed(1)}C to ${asset.maxTempC.toFixed(1)}C.`,
      severity: 'HIGH',
      category: 'Temperature',
      status: 'OPEN',
      assignee: null,
      notes: `temperature-asset:${asset.id}${asset.venue ? ` venue:${asset.venue}` : ''}`,
      activities: {
        create: {
          action: 'created',
          actor: 'system',
          message: 'Auto-created from out of range govee temperature reading.'
        }
      }
    }
  });

  return created.id;
}

export async function listGoveeDevices() {
  const response = await request<{ data?: Array<Record<string, unknown>> }>('/router/api/v1/user/devices');

  return asArray(response.data)
    .map((entry) => {
      const device = asObject(entry) ?? {};
      return {
        device: asString(device.device) ?? '',
        deviceName: asString(device.deviceName) ?? undefined,
        model: asString(device.sku) ?? asString(device.model) ?? '',
        sku: asString(device.sku) ?? undefined
      } satisfies GoveeDevice;
    })
    .filter((device) => device.device && device.model);
}

export async function getGoveeDeviceState(device: string, model: string) {
  const config = await getConfig();
  const response = await fetch(`${config.baseUrl}/router/api/v1/device/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Govee-API-Key': config.apiKey
    },
    body: JSON.stringify({
      requestId: randomUUID(),
      payload: {
        sku: model,
        device
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`govee request failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function syncTemperatureAssetsWithGovee(options: SyncOptions = {}) {
  let integration;
  try {
    integration = await ensureGoveeIntegration();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown govee configuration error';
    await markGoveeSyncFailure(message);
    throw error;
  }

  const assets = await prisma.temperatureAsset.findMany({
    where: {
      status: 'ACTIVE',
      integrationProvider: { in: [GOVEE_PROVIDER, 'GOVEE', 'Govee'] },
      externalDeviceId: { not: null },
      externalModel: { not: null },
      ...(options.assetId ? { id: options.assetId } : {})
    },
    include: {
      logs: {
        orderBy: [{ recordedAt: 'desc' }],
        take: 1
      }
    }
  });

  const results: Array<Record<string, unknown>> = [];
  const errors: string[] = [];

  for (const asset of assets) {
    try {
      const payload = await getGoveeDeviceState(asset.externalDeviceId!, asset.externalModel!);
      const reading = parseGoveeReading(payload);

      if (!reading) {
        results.push({
          assetId: asset.id,
          assetName: asset.name,
          outcome: 'skipped',
          reason: 'No temperature reading returned by Govee payload.'
        });
        continue;
      }

      const status = toTemperatureStatus(reading.temperatureC, asset.minTempC, asset.maxTempC);
      const issueId = status === 'OUT_OF_RANGE' ? await maybeCreateTemperatureIssue(asset, reading) : null;

      const log = await prisma.temperatureLog.create({
        data: {
          assetId: asset.id,
          recordedAt: reading.recordedAt,
          temperatureC: reading.temperatureC,
          humidityPct: reading.humidityPct,
          source: 'GOVEE',
          status,
          correctiveAction: issueId ? `Auto-linked issue ${issueId}` : null,
          recordedBy: 'govee',
          externalReadingId: `govee:${asset.externalDeviceId}:${reading.recordedAt.toISOString().slice(0, 16)}`
        }
      });

      await prisma.temperatureAsset.update({
        where: { id: asset.id },
        data: {
          integrationProvider: GOVEE_PROVIDER,
          lastReadingAt: log.recordedAt,
          lastSyncAt: new Date()
        }
      });

      results.push({
        assetId: asset.id,
        assetName: asset.name,
        issueId,
        outcome: 'synced',
        status,
        temperatureC: reading.temperatureC
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';
      const detail = message.includes('Device Not Found')
        ? `${message} Check the asset's externalDeviceId and externalModel mapping or re-discover the device in govee.`
        : message;
      errors.push(`${asset.name}: ${detail}`);
      results.push({
        assetId: asset.id,
        assetName: asset.name,
        error: detail,
        outcome: 'error'
      });
    }
  }

  if (errors.length > 0) {
    const message = errors.join(' | ');
    await prisma.temperatureIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'error',
        lastSyncedAt: new Date(),
        lastError: message.slice(0, 500)
      }
    });
    const error = new Error(message);
    (error as Error & { results?: Array<Record<string, unknown>> }).results = results;
    throw error;
  }

  await prisma.temperatureIntegration.update({
    where: { id: integration.id },
    data: {
      status: 'connected',
      lastSyncedAt: new Date(),
      lastError: null
    }
  });

  return {
    assetsScanned: assets.length,
    provider: GOVEE_PROVIDER,
    results,
    success: true,
    synced: results.filter((entry) => entry.outcome === 'synced').length
  };
}
