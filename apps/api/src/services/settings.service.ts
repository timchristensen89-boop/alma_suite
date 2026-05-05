import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  appSettingsUpdateSchema,
  normaliseOnboardingSettings,
  type AppSettingsPayload
} from '@alma/shared';

const SINGLETON_ID = 'singleton';
const DEFAULT_GOVEE_BASE_URL = 'https://openapi.api.govee.com';

function normaliseGoveeBaseUrl(value: string | null | undefined) {
  const raw = value?.trim() || DEFAULT_GOVEE_BASE_URL;
  return raw.includes('developer-api.govee.com')
    ? DEFAULT_GOVEE_BASE_URL
    : raw.replace(/\/router\/api\/v1\/?$/, '').replace(/\/$/, '');
}

function toPayload(row: {
  id: string;
  orgName: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  venues: unknown;
  handbookContent?: unknown;
  onboardingSettings?: unknown;
  goveeApiKey: string | null;
  goveeBaseUrl: string | null;
  notifyEmail: string | null;
  notifyOverdueIssues: boolean;
  notifyExpiringStaff: boolean;
  notifyOutOfRangeTemp: boolean;
}): AppSettingsPayload {
  let venues: AppSettingsPayload['venues'] = [];
  if (Array.isArray(row.venues)) {
    venues = row.venues
      .filter((v): v is { name: string; address?: string; phone?: string } =>
        typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string'
      )
      .map((v) => ({ name: v.name, address: v.address ?? '', phone: v.phone ?? '' }));
  }

  return {
    id: row.id,
    orgName: row.orgName,
    primaryContactName: row.primaryContactName,
    primaryContactEmail: row.primaryContactEmail,
    primaryContactPhone: row.primaryContactPhone,
    venues,
    handbookContent: row.handbookContent && typeof row.handbookContent === 'object' ? (row.handbookContent as Record<string, unknown>) : {},
    onboardingSettings: normaliseOnboardingSettings(row.onboardingSettings),
    // Don't leak the key — only a hint.
    goveeApiKey: row.goveeApiKey ? maskKey(row.goveeApiKey) : null,
    goveeBaseUrl: normaliseGoveeBaseUrl(row.goveeBaseUrl),
    notifyEmail: row.notifyEmail,
    notifyOverdueIssues: row.notifyOverdueIssues,
    notifyExpiringStaff: row.notifyExpiringStaff,
    notifyOutOfRangeTemp: row.notifyOutOfRangeTemp
  };
}

function maskKey(key: string) {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

async function ensureSingleton() {
  const existing = await prisma.appSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.appSettings.create({ data: { id: SINGLETON_ID } });
}

export const settingsService = {
  async get(): Promise<AppSettingsPayload> {
    const row = await ensureSingleton();
    return toPayload(row);
  },

  async update(input: unknown): Promise<AppSettingsPayload> {
    const data = appSettingsUpdateSchema.parse(input);
    await ensureSingleton();

    const updateData: Prisma.AppSettingsUpdateInput = {
      ...(data.orgName !== undefined && { orgName: data.orgName }),
      ...(data.primaryContactName !== undefined && { primaryContactName: data.primaryContactName || null }),
      ...(data.primaryContactEmail !== undefined && { primaryContactEmail: data.primaryContactEmail || null }),
      ...(data.primaryContactPhone !== undefined && { primaryContactPhone: data.primaryContactPhone || null }),
      ...(data.venues !== undefined && { venues: data.venues }),
      ...(data.handbookContent !== undefined && {
        handbookContent: data.handbookContent as Prisma.InputJsonValue
      }),
      ...(data.onboardingSettings !== undefined && {
        onboardingSettings: normaliseOnboardingSettings(data.onboardingSettings) as Prisma.InputJsonValue
      }),
      // Only update the Govee key if it's a real value, not the masked "••••" echo.
      ...(data.goveeApiKey !== undefined &&
        !data.goveeApiKey.includes('••') && { goveeApiKey: data.goveeApiKey || null }),
      ...(data.goveeBaseUrl !== undefined && { goveeBaseUrl: normaliseGoveeBaseUrl(data.goveeBaseUrl) }),
      ...(data.notifyEmail !== undefined && { notifyEmail: data.notifyEmail || null }),
      ...(data.notifyOverdueIssues !== undefined && { notifyOverdueIssues: data.notifyOverdueIssues }),
      ...(data.notifyExpiringStaff !== undefined && { notifyExpiringStaff: data.notifyExpiringStaff }),
      ...(data.notifyOutOfRangeTemp !== undefined && { notifyOutOfRangeTemp: data.notifyOutOfRangeTemp })
    };

    const updated = await prisma.appSettings.update({
      where: { id: SINGLETON_ID },
      data: updateData
    });

    return toPayload(updated);
  }
};
