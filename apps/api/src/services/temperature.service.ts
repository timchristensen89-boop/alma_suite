import type { Prisma } from '@prisma/client';
import { listGoveeDevices, prisma, syncTemperatureAssetsWithGovee } from '@alma/db';
import {
  temperatureAssetCreateInputSchema,
  temperatureExternalIngestInputSchema,
  temperatureLogCreateInputSchema,
  temperatureSensorMapInputSchema
} from '@alma/shared';
import { HttpError } from '../lib/http.js';

const GOVEE_PROVIDER = 'govee';
const DEFAULT_GOVEE_BASE_URL = 'https://openapi.api.govee.com';

function normaliseGoveeBaseUrl(value: string | null | undefined) {
  const raw = value?.trim() || DEFAULT_GOVEE_BASE_URL;
  return raw.includes('developer-api.govee.com')
    ? DEFAULT_GOVEE_BASE_URL
    : raw.replace(/\/router\/api\/v1\/?$/, '').replace(/\/$/, '');
}

function determineStatus(temperatureC: number, minTempC: number, maxTempC: number) {
  return temperatureC >= minTempC && temperatureC <= maxTempC ? 'IN_RANGE' : 'OUT_OF_RANGE';
}

function queryString(input: unknown, key: string) {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[key];
  const firstValue = Array.isArray(value) ? value[0] : value;
  return typeof firstValue === 'string' && firstValue.trim() ? firstValue.trim() : undefined;
}

function queryDate(input: unknown, key: string) {
  const raw = queryString(input, key);
  if (!raw) {
    return undefined;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `Temperature log ${key} date is invalid.`);
  }

  return date;
}

function queryLimit(input: unknown) {
  const raw = queryString(input, 'limit');
  if (!raw) {
    return 50;
  }

  const limit = Number(raw);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new HttpError(400, 'Temperature log limit is invalid.');
  }

  return Math.min(Math.floor(limit), 500);
}

async function maybeCreateIssue(asset: { id: string; name: string; minTempC: number; maxTempC: number }, temperatureC: number) {
  const existing = await prisma.issue.findFirst({
    where: {
      category: 'Temperature',
      notes: { contains: `temperature-asset:${asset.id}` },
      status: { in: ['OPEN', 'IN_PROGRESS', 'BLOCKED'] }
    }
  });

  if (existing) {
    return existing.id;
  }

  const issue = await prisma.issue.create({
    data: {
      title: `${asset.name} temperature out of range`,
      description: `Manual log recorded ${temperatureC.toFixed(1)}C outside ${asset.minTempC.toFixed(1)}C to ${asset.maxTempC.toFixed(1)}C.`,
      severity: 'HIGH',
      category: 'Temperature',
      status: 'OPEN',
      assignee: null,
      notes: `temperature-asset:${asset.id}`,
      activities: {
        create: {
          action: 'created',
          message: 'Issue created from out of range temperature log.',
          actor: 'system'
        }
      }
    }
  });

  return issue.id;
}

function integrationKeyHint(apiKey: string) {
  return apiKey ? `${apiKey.slice(0, 4)}***${apiKey.slice(-2)}` : null;
}

async function ensureGoveeIntegration(apiKeyOverride?: string) {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
  const apiKey = String(apiKeyOverride || settings?.goveeApiKey || process.env.GOVEE_API_KEY || '').trim();
  const baseUrl = normaliseGoveeBaseUrl(settings?.goveeBaseUrl || process.env.GOVEE_API_BASE_URL);

  if (apiKeyOverride) {
    await prisma.appSettings.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        goveeApiKey: apiKeyOverride,
        goveeBaseUrl: baseUrl
      },
      update: {
        goveeApiKey: apiKeyOverride,
        goveeBaseUrl: baseUrl
      }
    });
  }

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

  if (canonical) {
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
  }

  return prisma.temperatureIntegration.upsert({
    where: { provider: GOVEE_PROVIDER },
    update: {
      status: apiKey ? 'connected' : undefined,
      apiKeyHint: integrationKeyHint(apiKey) ?? undefined,
      baseUrl,
      lastError: apiKey ? null : undefined
    },
    create: {
      provider: GOVEE_PROVIDER,
      status: apiKey ? 'connected' : 'disconnected',
      apiKeyHint: integrationKeyHint(apiKey),
      baseUrl
    }
  });
}

async function createLogForAsset(assetId: string, input: {
  correctiveAction?: string | null;
  externalReadingId?: string | null;
  humidityPct?: number | null;
  recordedAt?: Date;
  recordedBy?: string | null;
  source: 'MANUAL' | 'GOVEE';
  temperatureC: number;
}) {
  const asset = await prisma.temperatureAsset.findUnique({ where: { id: assetId } });

  if (!asset) {
    throw new HttpError(404, 'Temperature asset not found');
  }

  const recordedAt = input.recordedAt ?? new Date();
  const status = determineStatus(input.temperatureC, asset.minTempC, asset.maxTempC);
  const issueId = status === 'OUT_OF_RANGE' ? await maybeCreateIssue(asset, input.temperatureC) : null;

  const log = await prisma.temperatureLog.create({
    data: {
      assetId,
      recordedAt,
      temperatureC: input.temperatureC,
      humidityPct: input.humidityPct ?? null,
      source: input.source,
      status,
      correctiveAction: input.correctiveAction || (issueId ? `Auto-linked issue ${issueId}` : null),
      recordedBy: input.recordedBy || null,
      externalReadingId: input.externalReadingId || null
    }
  });

  await prisma.temperatureAsset.update({
    where: { id: assetId },
    data: {
      lastReadingAt: recordedAt,
      ...(input.source === 'GOVEE' ? { lastSyncAt: new Date() } : {})
    }
  });

  return log;
}

export const temperatureService = {
  async listAssets() {
    return prisma.temperatureAsset.findMany({
      orderBy: [{ venue: 'asc' }, { name: 'asc' }],
      include: {
        sensors: {
          orderBy: [{ externalName: 'asc' }]
        },
        logs: {
          orderBy: [{ recordedAt: 'desc' }],
          take: 6
        }
      }
    });
  },

  async listLogs(input: unknown = {}) {
    const from = queryDate(input, 'from');
    const to = queryDate(input, 'to');
    const assetId = queryString(input, 'assetId');
    const venue = queryString(input, 'venue');
    const where: Prisma.TemperatureLogWhereInput = {};

    if (from || to) {
      where.recordedAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {})
      };
    }

    if (assetId && assetId !== 'all') {
      where.assetId = assetId;
    }

    if (venue && venue !== 'all') {
      where.asset = { venue };
    }

    return prisma.temperatureLog.findMany({
      where,
      orderBy: [{ recordedAt: 'desc' }],
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            area: true,
            venue: true,
            assetType: true,
            minTempC: true,
            maxTempC: true
          }
        }
      },
      take: queryLimit(input)
    });
  },

  async getAssetById(id: string) {
    const asset = await prisma.temperatureAsset.findUnique({
      where: { id },
      include: {
        sensors: {
          orderBy: [{ externalName: 'asc' }]
        },
        logs: {
          orderBy: [{ recordedAt: 'desc' }],
          take: 50
        }
      }
    });

    if (!asset) {
      throw new HttpError(404, 'Temperature asset not found');
    }

    return asset;
  },

  async createAsset(input: unknown) {
    const data = temperatureAssetCreateInputSchema.parse(input);

    return prisma.temperatureAsset.create({
      data: {
        name: data.name,
        venue: data.venue || null,
        area: data.area || null,
        assetType: data.assetType,
        minTempC: data.minTempC,
        maxTempC: data.maxTempC,
        integrationProvider: data.integrationProvider ? data.integrationProvider.toLowerCase() : null,
        externalDeviceId: data.externalDeviceId || null,
        externalModel: data.externalModel || null,
        externalSku: data.externalSku || null,
        notes: data.notes || null
      },
      include: {
        sensors: {
          orderBy: [{ externalName: 'asc' }]
        },
        logs: {
          orderBy: [{ recordedAt: 'desc' }],
          take: 6
        }
      }
    });
  },

  async addLog(assetId: string, input: unknown) {
    const data = temperatureLogCreateInputSchema.parse(input);
    return createLogForAsset(assetId, {
      correctiveAction: data.correctiveAction || null,
      humidityPct: data.humidityPct ?? null,
      recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
      recordedBy: data.recordedBy || null,
      source: 'MANUAL',
      temperatureC: data.temperatureC
    });
  },

  async listIntegrations() {
    await ensureGoveeIntegration();

    return prisma.temperatureIntegration.findMany({
      orderBy: [{ provider: 'asc' }]
    });
  },

  async listSensors() {
    return prisma.temperatureSensor.findMany({
      orderBy: [{ externalName: 'asc' }, { externalSensorId: 'asc' }],
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            area: true,
            venue: true
          }
        },
        integration: {
          select: {
            id: true,
            provider: true,
            status: true
          }
        }
      }
    });
  },

  async connectGoveeIntegration(input: unknown) {
    const body = (input && typeof input === 'object' ? input : {}) as { apiKey?: string };
    return ensureGoveeIntegration(body.apiKey);
  },

  async discoverGoveeSensors(input: unknown) {
    const body = (input && typeof input === 'object' ? input : {}) as { apiKey?: string };
    const integration = await ensureGoveeIntegration(body.apiKey);
    const settings = await prisma.appSettings.findUnique({ where: { id: 'singleton' } });
    const apiKey = String(body.apiKey || settings?.goveeApiKey || process.env.GOVEE_API_KEY || '').trim();

    if (!apiKey) {
      throw new Error('No govee API key provided. Set GOVEE_API_KEY or send apiKey in the request body.');
    }

    try {
      const devices = await listGoveeDevices();

      for (const device of devices) {
        await prisma.temperatureSensor.upsert({
          where: {
            integrationId_externalSensorId: {
              integrationId: integration.id,
              externalSensorId: device.device
            }
          },
          create: {
            integrationId: integration.id,
            externalSensorId: device.device,
            externalName: device.deviceName ?? device.device,
            externalModel: device.model,
            rawPayload: device
          },
          update: {
            externalName: device.deviceName ?? device.device,
            externalModel: device.model,
            lastSeenAt: new Date(),
            rawPayload: device
          }
        });
      }

      const nextIntegration = await prisma.temperatureIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'connected',
          lastSyncedAt: new Date(),
          lastError: null
        }
      });

      return {
        importedCount: devices.length,
        integration: nextIntegration,
        sensors: await this.listSensors()
      };
    } catch (error) {
      await prisma.temperatureIntegration.update({
        where: { id: integration.id },
        data: {
          status: 'error',
          lastError: error instanceof Error ? error.message.slice(0, 500) : 'Unknown discovery error'
        }
      });

      throw error;
    }
  },

  async mapSensor(sensorId: string, input: unknown) {
    const data = temperatureSensorMapInputSchema.parse(input);
    const updated = await prisma.temperatureSensor.update({
      where: { id: sensorId },
      data: {
        assetId: data.assetId || null
      },
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            area: true,
            venue: true
          }
        },
        integration: {
          select: {
            id: true,
            provider: true,
            status: true
          }
        }
      }
    });

    return updated;
  },

  async ingestExternalReading(input: unknown) {
    const data = temperatureExternalIngestInputSchema.parse(input);
    const provider = (data.provider || GOVEE_PROVIDER).toLowerCase();
    const integration = provider === GOVEE_PROVIDER
      ? await ensureGoveeIntegration()
      : await prisma.temperatureIntegration.upsert({
          where: { provider },
          create: { provider, status: 'connected' },
          update: { status: 'connected', lastError: null, lastSyncedAt: new Date() }
        });

    const sensor = await prisma.temperatureSensor.upsert({
      where: {
        integrationId_externalSensorId: {
          integrationId: integration.id,
          externalSensorId: data.externalSensorId
        }
      },
      create: {
        integrationId: integration.id,
        externalSensorId: data.externalSensorId,
        externalName: data.externalName || data.externalSensorId,
        externalModel: data.externalModel || null,
        lastSeenAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
        lastTemperature: data.measuredTemperature,
        lastBatteryLevel: data.batteryLevel ?? null,
        rawPayload: data
      },
      update: {
        externalName: data.externalName || undefined,
        externalModel: data.externalModel || undefined,
        lastSeenAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
        lastTemperature: data.measuredTemperature,
        lastBatteryLevel: data.batteryLevel ?? null,
        rawPayload: data
      }
    });

    await prisma.temperatureIntegration.update({
      where: { id: integration.id },
      data: {
        status: 'connected',
        lastSyncedAt: new Date(),
        lastError: null
      }
    });

    if (!sensor.assetId) {
      return { mapped: false, received: true, sensorId: sensor.id };
    }

    const log = await createLogForAsset(sensor.assetId, {
      correctiveAction: data.correctiveAction || null,
      externalReadingId: `${provider}:${sensor.externalSensorId}:${data.recordedAt || new Date().toISOString()}`,
      recordedAt: data.recordedAt ? new Date(data.recordedAt) : new Date(),
      recordedBy: data.recordedBy || provider,
      source: 'GOVEE',
      temperatureC: data.measuredTemperature
    });

    return { log, mapped: true, received: true, sensorId: sensor.id };
  },

  async syncGovee(assetId?: string) {
    try {
      return await syncTemperatureAssetsWithGovee({ assetId });
    } catch (error) {
      throw new HttpError(502, error instanceof Error ? error.message : 'govee sync failed');
    }
  },

  async summary() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const assets = await prisma.temperatureAsset.findMany({
      where: { status: 'ACTIVE' },
      include: {
        logs: {
          orderBy: [{ recordedAt: 'desc' }],
          take: 1
        }
      }
    });

    const activeAssets = assets.length;
    const outOfRangeNow = assets.filter((asset) => asset.logs[0]?.status === 'OUT_OF_RANGE').length;
    const missingToday = assets.filter((asset) => !asset.logs[0] || asset.logs[0].recordedAt < todayStart).length;
    const syncedToday = assets.filter((asset) => asset.lastSyncAt && asset.lastSyncAt >= todayStart).length;

    return { activeAssets, outOfRangeNow, missingToday, syncedToday };
  }
};
