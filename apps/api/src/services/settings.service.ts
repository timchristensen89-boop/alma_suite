import { Prisma } from '@prisma/client';
import { prisma } from '@alma/db';
import {
  appSettingsUpdateSchema,
  normaliseOnboardingSettings,
  normaliseStaffDefaults,
  type AppSettingsPayload,
  type TipsAbaSettings
} from '@alma/shared';

const SINGLETON_ID = 'singleton';
const DEFAULT_GOVEE_BASE_URL = 'https://openapi.api.govee.com';

// Mask a bank account number so the GET response never exposes it in full —
// only the last 3 digits, mirroring how the Govee key is masked.
function maskAbaAccount(value: string): string {
  const digits = value.replace(/\s+/g, '');
  if (!digits) return '';
  if (digits.length <= 3) return '•••';
  return `•••• ${digits.slice(-3)}`;
}

function abaRecord(raw: unknown): Record<string, string> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, string>) : {};
}

function toAbaPayload(raw: unknown): TipsAbaSettings {
  const o = abaRecord(raw);
  const financialInstitution = String(o.financialInstitution ?? '');
  const userName = String(o.userName ?? '');
  const userId = String(o.userId ?? '');
  const remitterName = String(o.remitterName ?? '');
  const description = String(o.description ?? '');
  const traceBsb = String(o.traceBsb ?? '');
  const traceAccount = String(o.traceAccount ?? '');
  return {
    financialInstitution,
    userName,
    userId,
    remitterName,
    description,
    traceBsb,
    traceAccount: maskAbaAccount(traceAccount),
    configured: Boolean(financialInstitution && userName && userId && remitterName && traceBsb && traceAccount)
  };
}

// Merge an incoming ABA patch onto the stored (full) values. Fields are only
// changed when provided; the account number is ignored when it comes back
// masked (contains •) so re-saving the form doesn't wipe the stored number.
function mergeAbaSettings(
  existingRaw: unknown,
  incoming: Partial<Record<keyof TipsAbaSettings, string>>
): Record<string, string> {
  const out: Record<string, string> = { ...abaRecord(existingRaw) };
  const set = (key: string, val: string | undefined, guardMasked = false) => {
    if (val === undefined) return;
    if (guardMasked && val.includes('•')) return;
    out[key] = val.trim();
  };
  set('financialInstitution', incoming.financialInstitution);
  set('userName', incoming.userName);
  set('userId', incoming.userId);
  set('remitterName', incoming.remitterName);
  set('description', incoming.description);
  set('traceBsb', incoming.traceBsb);
  set('traceAccount', incoming.traceAccount, true);
  return out;
}

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
  staffDefaults?: unknown;
  tipsAbaSettings?: unknown;
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
      .filter((v): v is {
        name: string;
        address?: string;
        phone?: string;
        weeklyForecastSalesCents?: number;
        targetWagePercent?: number;
      } => typeof v === 'object' && v !== null && typeof (v as { name?: unknown }).name === 'string')
      .map((v) => ({
        name: v.name,
        address: v.address ?? '',
        phone: v.phone ?? '',
        ...(typeof v.weeklyForecastSalesCents === 'number' && Number.isFinite(v.weeklyForecastSalesCents)
          ? { weeklyForecastSalesCents: Math.max(0, Math.round(v.weeklyForecastSalesCents)) }
          : {}),
        ...(typeof v.targetWagePercent === 'number' && Number.isFinite(v.targetWagePercent)
          ? { targetWagePercent: Math.min(100, Math.max(0, v.targetWagePercent)) }
          : {})
      }));
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
    staffDefaults: normaliseStaffDefaults(row.staffDefaults),
    // Don't leak the key — only a hint.
    goveeApiKey: row.goveeApiKey ? maskKey(row.goveeApiKey) : null,
    goveeBaseUrl: normaliseGoveeBaseUrl(row.goveeBaseUrl),
    notifyEmail: row.notifyEmail,
    notifyOverdueIssues: row.notifyOverdueIssues,
    notifyExpiringStaff: row.notifyExpiringStaff,
    notifyOutOfRangeTemp: row.notifyOutOfRangeTemp,
    tipsAbaSettings: toAbaPayload(row.tipsAbaSettings)
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
    const existing = await ensureSingleton();

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
      ...(data.staffDefaults !== undefined && {
        staffDefaults: normaliseStaffDefaults(data.staffDefaults) as unknown as Prisma.InputJsonValue
      }),
      // Only update the Govee key if it's a real value, not the masked "••••" echo.
      ...(data.goveeApiKey !== undefined &&
        !data.goveeApiKey.includes('••') && { goveeApiKey: data.goveeApiKey || null }),
      ...(data.goveeBaseUrl !== undefined && { goveeBaseUrl: normaliseGoveeBaseUrl(data.goveeBaseUrl) }),
      ...(data.notifyEmail !== undefined && { notifyEmail: data.notifyEmail || null }),
      ...(data.notifyOverdueIssues !== undefined && { notifyOverdueIssues: data.notifyOverdueIssues }),
      ...(data.notifyExpiringStaff !== undefined && { notifyExpiringStaff: data.notifyExpiringStaff }),
      ...(data.notifyOutOfRangeTemp !== undefined && { notifyOutOfRangeTemp: data.notifyOutOfRangeTemp }),
      ...(data.tipsAbaSettings !== undefined && {
        tipsAbaSettings: mergeAbaSettings(
          (existing as { tipsAbaSettings?: unknown }).tipsAbaSettings,
          data.tipsAbaSettings
        ) as Prisma.InputJsonValue
      })
    };

    const updated = await prisma.appSettings.update({
      where: { id: SINGLETON_ID },
      data: updateData
    });

    return toPayload(updated);
  }
};
