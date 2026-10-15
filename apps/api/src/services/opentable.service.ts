// OpenTable (free APIs) — status, preview, publish, compare, activity.
//
// Alma Suite is the source; OpenTable is a destination written to on an
// explicit, per-venue, human-approved action. The service never reads a
// draft: only MenuVersion.state = PUBLISHED snapshots of ACTIVE, PUBLIC menus
// reach the payload builder. Every attempt — including the ones the flags
// stop — leaves an OpenTableSyncRun row with the payload it would have sent,
// so the dashboard is honest about what is pending, what was accepted and
// what failed. See docs/opentable/03-design.md.

import { createHash } from 'node:crypto';
import { prisma } from '@alma/db';
import { Prisma } from '@prisma/client';
import {
  almaVenueProfileSchema,
  buildOpenTableMenusPayload,
  buildOpenTableProfilePayload,
  canonicalJson,
  canAccessMenuVenue,
  canPublishMenus,
  compareOpenTableProfile,
  compareWithRemote,
  diffOpenTableMenus,
  type AlmaVenueProfile,
  type AuthUser,
  type MenuKind,
  type MenuSnapshot,
  type OpenTableCapabilityState,
  type OpenTableConnectionStatus,
  type OpenTableMenuSource,
  type OpenTableMenusPayload,
  type OpenTableMenusPreview,
  type OpenTableMenusPublishInput,
  type OpenTableOverview,
  type OpenTableProfilePayload,
  type OpenTableProfilePreview,
  type OpenTablePublishResult,
  type OpenTableRemoteMenus,
  type OpenTableRunSummary,
  type OpenTableSyncKind,
  type OpenTableSyncStatus,
  type OpenTableVenueSettingsInput,
  type OpenTableVenueStatus
} from '@alma/shared';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import {
  OpenTableClient,
  OpenTableConfigError,
  OpenTableDisabledError,
  OpenTableHttpError,
  missingOpenTableConfig,
  type OpenTableWriteResponse
} from '../lib/opentable-client.js';

type Actor = Pick<AuthUser, 'id' | 'firstName' | 'lastName'>;

const RESTAURANT_CENTRE = 'https://restaurant.opentable.com/';
const DOCS = 'https://docs.opentable.com/';
/** A connection check older than this is re-run when the dashboard loads. */
const CONNECTION_FRESH_MS = 10 * 60 * 1000;
/** A SUBMITTED run younger than this blocks another submission for the venue. */
const IN_FLIGHT_MS = 2 * 60 * 1000;

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function actorName(actor: Actor | null | undefined): string | null {
  if (!actor) return null;
  return `${actor.firstName} ${actor.lastName}`.trim() || null;
}

// ---------------------------------------------------------------------------
// Pure state derivation — unit-tested without a database.
// ---------------------------------------------------------------------------

export type ConnectionStateInput = {
  apiEnabled: boolean;
  missingConfig: string[];
  rid: string | null;
  venueEnabled: boolean;
  lastOk: boolean | null;
  lastError: string | null;
};

export function deriveConnectionState(input: ConnectionStateInput): { state: OpenTableCapabilityState; detail: string } {
  if (!input.rid) return { state: 'NOT_CONFIGURED', detail: 'Enter the venue’s OpenTable restaurant id (rid) to begin.' };
  if (!input.venueEnabled) return { state: 'NOT_CONFIGURED', detail: 'OpenTable is switched off for this venue. Turn it on in Settings below.' };
  if (input.missingConfig.length) return { state: 'NOT_CONFIGURED', detail: `Missing on the API server: ${input.missingConfig.join(', ')}.` };
  if (!input.apiEnabled) return { state: 'AWAITING_APPROVAL', detail: 'Credentials are in place but OPENTABLE_API_ENABLED is off. Nothing is sent to OpenTable until it is turned on after approval.' };
  if (input.lastOk === true) return { state: 'CONNECTED', detail: 'OpenTable issued an access token for these credentials.' };
  if (input.lastOk === false) return { state: 'ERROR', detail: input.lastError ?? 'The last token request failed.' };
  return { state: 'AWAITING_APPROVAL', detail: 'Switched on but not yet checked. Run a connection check.' };
}

export type CapabilityStateInput = {
  connection: OpenTableCapabilityState;
  connectionDetail: string;
  flagOn: boolean;
  flagName: string;
  capabilityEnabled: boolean;
  capabilityLabel: string;
  currentHash: string;
  lastAcceptedHash: string | null;
  lastRun: { status: OpenTableSyncStatus; error: string | null } | null;
};

export function deriveCapabilityState(input: CapabilityStateInput): { state: OpenTableCapabilityState; detail: string } {
  if (input.connection === 'NOT_CONFIGURED') return { state: 'NOT_CONFIGURED', detail: input.connectionDetail };
  if (!input.capabilityEnabled) return { state: 'NOT_CONFIGURED', detail: `${input.capabilityLabel} publishing is switched off for this venue.` };
  if (!input.flagOn) return { state: 'AWAITING_APPROVAL', detail: `${input.flagName} is off. Previews and comparisons work; nothing is sent until OpenTable approves and the flag is turned on.` };
  if (input.connection === 'AWAITING_APPROVAL') return { state: 'AWAITING_APPROVAL', detail: input.connectionDetail };
  if (input.connection === 'ERROR') return { state: 'ERROR', detail: input.connectionDetail };
  if (input.lastRun && (input.lastRun.status === 'FAILED' || input.lastRun.status === 'PARTIAL')) {
    return { state: 'ERROR', detail: input.lastRun.error ?? `The last submission ended ${input.lastRun.status}.` };
  }
  if (!input.lastAcceptedHash) return { state: 'CONNECTED', detail: `Connected. ${input.capabilityLabel} has never been sent from Alma.` };
  if (input.lastAcceptedHash === input.currentHash) return { state: 'SYNCED', detail: 'What OpenTable last accepted matches Alma.' };
  return { state: 'OUT_OF_DATE', detail: 'Alma has changed since OpenTable last accepted a submission.' };
}

/** Request key: stable per venue + kind + payload, so a retry is the same request to OpenTable. */
export function requestKeyFor(venueSlug: string, kind: 'menus' | 'profile', hash: string): string {
  return `alma-${venueSlug}-${kind}-${hash.slice(0, 12)}`;
}

/** Classify a 200 from either write endpoint. The docs promise item statuses; a short count is PARTIAL. */
export function classifyWriteResponse(response: OpenTableWriteResponse | null): { status: 'ACCEPTED' | 'PARTIAL'; summary: string } {
  const total = typeof response?.totalItems === 'number' ? response.totalItems : null;
  const processed = typeof response?.totalProcessedItems === 'number' ? response.totalProcessedItems : null;
  const requestId = response?.requestId != null ? String(response.requestId) : null;
  const failed = (response?.itemStatus ?? []).filter((item) => item.status && !/^(processing|accepted|success|ok)/i.test(item.status));
  if (failed.length || (total !== null && processed !== null && processed < total)) {
    const detail = failed.length ? `${failed.length} item${failed.length === 1 ? '' : 's'} rejected` : `${processed} of ${total} items processed`;
    return { status: 'PARTIAL', summary: `OpenTable accepted the request${requestId ? ` (request ${requestId})` : ''} but ${detail}.` };
  }
  return {
    status: 'ACCEPTED',
    summary: `Accepted by OpenTable${requestId ? ` (request ${requestId})` : ''}${total !== null ? `, ${total} item${total === 1 ? '' : 's'}` : ''}. Processing is asynchronous; visibility is controlled in OpenTable for Restaurants.`
  };
}

// ---------------------------------------------------------------------------

function clientFromEnv(): OpenTableClient {
  const cfg = env.integrations.opentable;
  return new OpenTableClient({
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
    partnerName: cfg.partnerName,
    apiBase: cfg.apiBase,
    oauthBase: cfg.oauthBase,
    timeoutMs: cfg.timeoutMs
  });
}

let sharedClient: OpenTableClient | null = null;
function client(): OpenTableClient {
  if (!sharedClient) sharedClient = clientFromEnv();
  return sharedClient;
}
/** Tests swap the client; production uses the env one. */
export function setOpenTableClientForTests(next: OpenTableClient | null) {
  sharedClient = next;
}

type SettingRow = Prisma.OpenTableVenueSettingGetPayload<{ include: { venue: true } }>;

async function venueOrThrow(venueId: string) {
  const venue = await prisma.venue.findUnique({ where: { id: venueId }, select: { id: true, name: true, slug: true } });
  if (!venue) throw new HttpError(404, 'That venue does not exist.');
  return venue;
}

async function settingFor(venueId: string): Promise<SettingRow> {
  const existing = await prisma.openTableVenueSetting.findUnique({ where: { venueId }, include: { venue: true } });
  if (existing) return existing;
  await venueOrThrow(venueId);
  return prisma.openTableVenueSetting.create({ data: { venueId }, include: { venue: true } });
}

function profileOf(setting: SettingRow): AlmaVenueProfile {
  const raw = (setting.profile ?? {}) as Record<string, unknown>;
  const parsed = almaVenueProfileSchema.safeParse({ name: setting.venue.name, ...raw });
  return parsed.success ? parsed.data : almaVenueProfileSchema.parse({ name: setting.venue.name });
}

/** Only PUBLISHED snapshots of this venue's menus. Drafts are invisible here by construction. */
async function menuSources(venueId: string): Promise<OpenTableMenuSource[]> {
  const menus = await prisma.menu.findMany({
    where: { venueId },
    orderBy: [{ kind: 'asc' }, { slug: 'asc' }],
    select: {
      slug: true,
      kind: true,
      name: true,
      status: true,
      visibility: true,
      versions: { where: { state: 'PUBLISHED' }, orderBy: { versionNumber: 'desc' }, take: 1, select: { snapshotJson: true } }
    }
  });
  return menus.map((menu) => ({
    slug: menu.slug,
    kind: menu.kind as MenuKind,
    name: menu.name,
    status: menu.status,
    visibility: menu.visibility,
    snapshot: (menu.versions[0]?.snapshotJson as unknown as MenuSnapshot | null) ?? null
  }));
}

function runSummary(run: Prisma.OpenTableSyncRunGetPayload<Record<string, never>>): OpenTableRunSummary {
  return {
    id: run.id,
    kind: run.kind as OpenTableSyncKind,
    status: run.status as OpenTableSyncStatus,
    summary: run.summary,
    payloadHash: run.payloadHash,
    requestKey: run.requestKey,
    requestId: run.requestId,
    httpStatus: run.httpStatus,
    attempts: run.attempts,
    error: run.error,
    triggeredByName: run.triggeredByName,
    createdAt: run.createdAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null
  };
}

async function lastAcceptedPayload(venueId: string, kind: 'MENUS' | 'PROFILE'): Promise<{ payload: unknown; hash: string | null } | null> {
  const run = await prisma.openTableSyncRun.findFirst({
    where: { venueId, kind, status: 'ACCEPTED' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true, payloadHash: true }
  });
  return run ? { payload: run.payload, hash: run.payloadHash } : null;
}

async function latestRun(venueId: string, kind: OpenTableSyncKind) {
  return prisma.openTableSyncRun.findFirst({ where: { venueId, kind, status: { not: 'PREPARED' } }, orderBy: { createdAt: 'desc' }, select: { status: true, error: true, createdAt: true } });
}

function errorText(error: unknown): string {
  if (error instanceof OpenTableHttpError) return error.body ? `${error.message} ${error.body.slice(0, 300)}` : error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

async function recordConnectionCheck(setting: SettingRow, actor: Actor | null): Promise<{ ok: boolean; error: string | null }> {
  const started = new Date();
  let ok = false;
  let error: string | null = null;
  let status: OpenTableSyncStatus = 'FAILED';
  let summary = '';
  try {
    const result = await client().checkConnection();
    ok = true;
    status = 'ACCEPTED';
    summary = `Token issued (${result.expiresInSeconds}s, scope ${result.scope ?? 'n/a'}) on ${env.integrations.opentable.environment}.`;
  } catch (caught) {
    if (caught instanceof OpenTableDisabledError || caught instanceof OpenTableConfigError) {
      status = 'SKIPPED';
      summary = caught.message;
      error = null;
      ok = false;
    } else {
      error = errorText(caught);
      summary = 'Token request failed.';
    }
  }
  await prisma.$transaction([
    prisma.openTableSyncRun.create({
      data: { settingId: setting.id, venueId: setting.venueId, kind: 'CONNECTION', status, summary, error, triggeredById: actor?.id ?? null, triggeredByName: actorName(actor), createdAt: started, completedAt: new Date() }
    }),
    prisma.openTableVenueSetting.update({
      where: { id: setting.id },
      data: status === 'SKIPPED' ? { lastConnectionCheckAt: started } : { lastConnectionCheckAt: started, lastConnectionOk: ok, lastConnectionError: error }
    })
  ]);
  return { ok, error };
}

function connectionStatus(setting: SettingRow): OpenTableConnectionStatus {
  const cfg = env.integrations.opentable;
  const missing = missingOpenTableConfig(cfg);
  const derived = deriveConnectionState({
    apiEnabled: cfg.enabled,
    missingConfig: missing,
    rid: setting.rid,
    venueEnabled: setting.enabled,
    lastOk: setting.lastConnectionOk,
    lastError: setting.lastConnectionError
  });
  return {
    ...derived,
    environment: cfg.environment,
    configured: { clientId: Boolean(cfg.clientId), clientSecret: Boolean(cfg.clientSecret), partnerName: Boolean(cfg.partnerName), rid: Boolean(setting.rid) },
    flags: { api: cfg.enabled, menusWrite: cfg.menusWriteEnabled, menusRead: cfg.menusReadEnabled, profileWrite: cfg.profileWriteEnabled },
    lastCheckAt: setting.lastConnectionCheckAt?.toISOString() ?? null,
    lastOk: setting.lastConnectionOk,
    lastError: setting.lastConnectionError
  };
}

async function buildMenusPreview(venueId: string): Promise<OpenTableMenusPreview> {
  const sources = await menuSources(venueId);
  const build = buildOpenTableMenusPayload(sources);
  const hash = sha256(canonicalJson(build.payload));
  const previous = await lastAcceptedPayload(venueId, 'MENUS');
  const diff = previous ? diffOpenTableMenus(previous.payload as OpenTableMenusPayload, build.payload) : null;
  return { hash, payload: build.payload, included: build.included, excluded: build.excluded, warnings: build.warnings, diff, removals: diff?.menusRemoved ?? [] };
}

async function buildProfilePreview(setting: SettingRow): Promise<OpenTableProfilePreview> {
  const built = buildOpenTableProfilePayload(profileOf(setting), setting.profileManagedFields, setting.venue.slug);
  return { hash: sha256(canonicalJson(built.payload)), payload: built.payload, sentFields: built.sentFields, skippedFields: built.skippedFields };
}

async function websiteHints(venue: { name: string; slug: string }): Promise<Partial<Record<string, string>>> {
  const [settings, pos] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: 'singleton' }, select: { venues: true } }),
    prisma.posVenueSetting.findFirst({ where: { venue: { equals: venue.name, mode: 'insensitive' } }, select: { address: true, phone: true, website: true, businessName: true } })
  ]);
  const fromSettings = ((settings?.venues as Array<{ name: string; address?: string; phone?: string }> | null) ?? []).find((entry) => entry.name.toLowerCase() === venue.name.toLowerCase());
  const hints: Partial<Record<string, string>> = {};
  const address = pos?.address ?? fromSettings?.address;
  const phone = pos?.phone ?? fromSettings?.phone;
  if (address) hints.address = address;
  if (phone) hints.phone = phone;
  if (pos?.website) hints.website = pos.website;
  hints.menuUrl = `${env.publicApiUrl.replace(/\/+$/, '')}/api/public/menus/${venue.slug}/food.pdf`;
  return hints;
}

// ---------------------------------------------------------------------------

export const openTableService = {
  async overview(user: AuthUser): Promise<OpenTableOverview> {
    const venues = await prisma.venue.findMany({ select: { id: true, name: true, slug: true, openTable: { select: { rid: true, enabled: true } } }, orderBy: { name: 'asc' } });
    return {
      venues: venues
        .filter((venue) => canAccessMenuVenue(user, venue.slug))
        .map((venue) => ({ id: venue.id, name: venue.name, slug: venue.slug, rid: venue.openTable?.rid ?? null, enabled: venue.openTable?.enabled ?? false })),
      environment: env.integrations.opentable.environment,
      apiEnabled: env.integrations.opentable.enabled
    };
  },

  async status(venueId: string, user: AuthUser, options: { refreshConnection?: boolean } = {}): Promise<OpenTableVenueStatus> {
    let setting = await settingFor(venueId);
    const cfg = env.integrations.opentable;
    const configured = setting.rid && setting.enabled && cfg.enabled && missingOpenTableConfig(cfg).length === 0;
    const stale = !setting.lastConnectionCheckAt || Date.now() - setting.lastConnectionCheckAt.getTime() > CONNECTION_FRESH_MS;
    if (configured && (options.refreshConnection || stale)) {
      await recordConnectionCheck(setting, user);
      setting = await settingFor(venueId);
    }
    const connection = connectionStatus(setting);
    const [menusPreview, profilePreview, lastMenusRun, lastProfileRun, runs, hints] = await Promise.all([
      buildMenusPreview(venueId),
      buildProfilePreview(setting),
      latestRun(venueId, 'MENUS'),
      latestRun(venueId, 'PROFILE'),
      prisma.openTableSyncRun.findMany({ where: { venueId }, orderBy: { createdAt: 'desc' }, take: 40 }),
      websiteHints(setting.venue)
    ]);
    const menusState = deriveCapabilityState({
      connection: connection.state,
      connectionDetail: connection.detail,
      flagOn: cfg.menusWriteEnabled,
      flagName: 'OPENTABLE_MENUS_WRITE_ENABLED',
      capabilityEnabled: setting.menusEnabled,
      capabilityLabel: 'Menu',
      currentHash: menusPreview.hash,
      lastAcceptedHash: setting.lastMenusAcceptedHash,
      lastRun: lastMenusRun ? { status: lastMenusRun.status as OpenTableSyncStatus, error: lastMenusRun.error } : null
    });
    const profileState = deriveCapabilityState({
      connection: connection.state,
      connectionDetail: connection.detail,
      flagOn: cfg.profileWriteEnabled,
      flagName: 'OPENTABLE_PROFILE_WRITE_ENABLED',
      capabilityEnabled: setting.profileEnabled,
      capabilityLabel: 'Profile',
      currentHash: profilePreview.hash,
      lastAcceptedHash: setting.lastProfileAcceptedHash,
      lastRun: lastProfileRun ? { status: lastProfileRun.status as OpenTableSyncStatus, error: lastProfileRun.error } : null
    });
    const lastSentProfile = await lastAcceptedPayload(venueId, 'PROFILE');
    const remote = setting.lastRemoteMenusJson && setting.lastRemoteMenusAt
      ? { readAt: setting.lastRemoteMenusAt.toISOString(), comparison: compareWithRemote(menusPreview.payload, setting.lastRemoteMenusJson as unknown as OpenTableRemoteMenus) }
      : null;
    return {
      venue: { id: setting.venue.id, name: setting.venue.name, slug: setting.venue.slug },
      rid: setting.rid,
      enabled: setting.enabled,
      menusEnabled: setting.menusEnabled,
      profileEnabled: setting.profileEnabled,
      connection,
      menus: {
        ...menusState,
        currentHash: menusPreview.hash,
        lastAcceptedHash: setting.lastMenusAcceptedHash,
        lastAcceptedAt: setting.lastMenusAcceptedAt?.toISOString() ?? null,
        lastRequestId: setting.lastMenusRequestId,
        included: menusPreview.included,
        excluded: menusPreview.excluded,
        warnings: menusPreview.warnings,
        diff: menusPreview.diff,
        removals: menusPreview.removals,
        remote,
        canPublish: canPublishMenus(user, setting.venue.slug)
      },
      profile: {
        ...profileState,
        profile: profileOf(setting),
        managedFields: setting.profileManagedFields,
        currentHash: profilePreview.hash,
        lastAcceptedHash: setting.lastProfileAcceptedHash,
        lastAcceptedAt: setting.lastProfileAcceptedAt?.toISOString() ?? null,
        lastRequestId: setting.lastProfileRequestId,
        comparison: compareOpenTableProfile(profileOf(setting), setting.profileManagedFields, (lastSentProfile?.payload as OpenTableProfilePayload | null) ?? null),
        websiteHints: hints
      },
      activity: runs.map(runSummary),
      links: { restaurantCentre: RESTAURANT_CENTRE, docs: DOCS }
    };
  },

  async saveSettings(venueId: string, input: OpenTableVenueSettingsInput): Promise<void> {
    const setting = await settingFor(venueId);
    const data: Prisma.OpenTableVenueSettingUpdateInput = {};
    if ('rid' in input) data.rid = input.rid ?? null;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.menusEnabled !== undefined) data.menusEnabled = input.menusEnabled;
    if (input.profileEnabled !== undefined) data.profileEnabled = input.profileEnabled;
    if (data.rid !== undefined && data.rid !== setting.rid) {
      // A different restaurant: nothing previously accepted applies to it.
      data.lastConnectionOk = null;
      data.lastConnectionError = null;
      data.lastConnectionCheckAt = null;
      data.lastRemoteMenusJson = Prisma.DbNull;
      data.lastRemoteMenusAt = null;
    }
    await prisma.openTableVenueSetting.update({ where: { id: setting.id }, data });
  },

  async saveProfile(venueId: string, profile: AlmaVenueProfile, managedFields: string[]): Promise<void> {
    const setting = await settingFor(venueId);
    await prisma.openTableVenueSetting.update({
      where: { id: setting.id },
      data: { profile: profile as unknown as Prisma.InputJsonValue, profileManagedFields: Array.from(new Set(managedFields)) }
    });
  },

  async checkConnection(venueId: string, actor: Actor): Promise<OpenTableConnectionStatus> {
    const setting = await settingFor(venueId);
    if (!setting.rid) throw new HttpError(400, 'Enter the restaurant id before checking the connection.');
    await recordConnectionCheck(setting, actor);
    return connectionStatus(await settingFor(venueId));
  },

  async previewMenus(venueId: string): Promise<OpenTableMenusPreview> {
    await venueOrThrow(venueId);
    return buildMenusPreview(venueId);
  },

  async previewProfile(venueId: string): Promise<OpenTableProfilePreview> {
    return buildProfilePreview(await settingFor(venueId));
  },

  /**
   * Replace every menu on OpenTable with Alma's published, public menus.
   * Refuses: hash drift (someone published meanwhile), unconfirmed removals,
   * a duplicate of the last accepted payload, a submission still in flight.
   * Records SKIPPED (with the payload) when the flags keep the call off.
   */
  async publishMenus(venueId: string, input: OpenTableMenusPublishInput, actor: Actor): Promise<OpenTablePublishResult> {
    const setting = await settingFor(venueId);
    if (!setting.rid) throw new HttpError(400, 'Enter the restaurant id before publishing.');
    if (!setting.enabled || !setting.menusEnabled) throw new HttpError(400, 'Menu publishing to OpenTable is switched off for this venue.');
    const preview = await buildMenusPreview(venueId);
    if (preview.hash !== input.hash) throw new HttpError(409, 'The menus changed since you previewed them. Reload the preview and check the differences again.');
    if (!preview.included.length) throw new HttpError(400, 'There is nothing to send: no published, public menu for this venue.');
    const unconfirmed = preview.removals.filter((name) => !input.confirmRemovals.includes(name));
    if (unconfirmed.length) throw new HttpError(409, `This submission would remove ${unconfirmed.join(', ')} from OpenTable. Confirm the removals to continue.`, { removals: unconfirmed });
    if (!input.force && setting.lastMenusAcceptedHash === preview.hash) throw new HttpError(409, 'OpenTable already accepted exactly this payload. Use Resend if you need to push it again.');
    const inFlight = await prisma.openTableSyncRun.findFirst({ where: { venueId, kind: 'MENUS', status: 'SUBMITTED', createdAt: { gt: new Date(Date.now() - IN_FLIGHT_MS) } }, select: { id: true } });
    if (inFlight) throw new HttpError(409, 'A submission for this venue is still in flight. Wait a moment and reload.');
    const requestKey = requestKeyFor(setting.venue.slug, 'menus', preview.hash);
    return submit({ setting, kind: 'MENUS', payload: preview.payload, hash: preview.hash, requestKey, actor, flagOn: env.integrations.opentable.menusWriteEnabled, flagName: 'OPENTABLE_MENUS_WRITE_ENABLED', send: () => client().publishMenus(setting.rid!, preview.payload, requestKey) });
  },

  /** Field-level overwrite of the profile with the managed fields only. */
  async publishProfile(venueId: string, input: { hash: string; force: boolean }, actor: Actor): Promise<OpenTablePublishResult> {
    const setting = await settingFor(venueId);
    if (!setting.rid) throw new HttpError(400, 'Enter the restaurant id before publishing.');
    if (!setting.enabled || !setting.profileEnabled) throw new HttpError(400, 'Profile publishing to OpenTable is switched off for this venue.');
    const preview = await buildProfilePreview(setting);
    if (preview.hash !== input.hash) throw new HttpError(409, 'The profile changed since you previewed it. Reload and check again.');
    if (!preview.sentFields.length) throw new HttpError(400, 'No profile fields are managed. Tick the fields Alma should own before publishing.');
    if (!input.force && setting.lastProfileAcceptedHash === preview.hash) throw new HttpError(409, 'OpenTable already accepted exactly these profile fields. Use Resend if you need to push them again.');
    const inFlight = await prisma.openTableSyncRun.findFirst({ where: { venueId, kind: 'PROFILE', status: 'SUBMITTED', createdAt: { gt: new Date(Date.now() - IN_FLIGHT_MS) } }, select: { id: true } });
    if (inFlight) throw new HttpError(409, 'A profile submission for this venue is still in flight. Wait a moment and reload.');
    const requestKey = requestKeyFor(setting.venue.slug, 'profile', preview.hash);
    const payload = { ...preview.payload, id: setting.rid };
    return submit({ setting, kind: 'PROFILE', payload, hash: preview.hash, requestKey, actor, flagOn: env.integrations.opentable.profileWriteEnabled, flagName: 'OPENTABLE_PROFILE_WRITE_ENABLED', send: () => client().publishProfile(setting.rid!, payload, requestKey) });
  },

  /** GET what OpenTable holds (only answers for partners with read rights) and cache it for comparison. */
  async readRemoteMenus(venueId: string, actor: Actor): Promise<OpenTablePublishResult> {
    const setting = await settingFor(venueId);
    if (!setting.rid) throw new HttpError(400, 'Enter the restaurant id first.');
    const started = new Date();
    const base = { settingId: setting.id, venueId, kind: 'READ' as const, triggeredById: actor.id, triggeredByName: actorName(actor), createdAt: started };
    if (!env.integrations.opentable.menusReadEnabled) {
      const run = await prisma.openTableSyncRun.create({ data: { ...base, status: 'SKIPPED', summary: 'OPENTABLE_MENUS_READ_ENABLED is off; nothing was requested.', completedAt: new Date() } });
      return { run: runSummary(run), message: 'Reading menus from OpenTable is switched off (OPENTABLE_MENUS_READ_ENABLED). Compare manually in OpenTable for Restaurants.' };
    }
    try {
      const result = await client().readMenus(setting.rid);
      const remote = result.data;
      const hosted = remote?.restaurantMenuUrl ?? null;
      const count = remote?.menus?.length ?? 0;
      const [run] = await prisma.$transaction([
        prisma.openTableSyncRun.create({ data: { ...base, status: 'ACCEPTED', httpStatus: result.status, attempts: result.attempts, response: remote as unknown as Prisma.InputJsonValue, summary: hosted ? `OpenTable serves a hosted menu link (${hosted}).` : `Read ${count} menu${count === 1 ? '' : 's'} from OpenTable.`, completedAt: new Date() } }),
        prisma.openTableVenueSetting.update({ where: { id: setting.id }, data: { lastRemoteMenusJson: (remote ?? {}) as unknown as Prisma.InputJsonValue, lastRemoteMenusAt: new Date() } })
      ]);
      return { run: runSummary(run), message: run.summary };
    } catch (caught) {
      const skipped = caught instanceof OpenTableDisabledError || caught instanceof OpenTableConfigError;
      const run = await prisma.openTableSyncRun.create({
        data: { ...base, status: skipped ? 'SKIPPED' : 'FAILED', httpStatus: caught instanceof OpenTableHttpError ? caught.status : null, attempts: caught instanceof OpenTableHttpError ? caught.attempts : 0, error: skipped ? null : errorText(caught), summary: skipped ? caught.message : 'Read failed.', completedAt: new Date() }
      });
      if (skipped) return { run: runSummary(run), message: (caught as Error).message };
      throw new HttpError(502, `OpenTable did not return menus: ${errorText(caught)}`);
    }
  },

  async activity(venueId: string, limit = 100): Promise<OpenTableRunSummary[]> {
    await venueOrThrow(venueId);
    const runs = await prisma.openTableSyncRun.findMany({ where: { venueId }, orderBy: { createdAt: 'desc' }, take: Math.min(500, Math.max(1, limit)) });
    return runs.map(runSummary);
  },

  async run(venueId: string, runId: string): Promise<OpenTableRunSummary & { payload: unknown; response: unknown }> {
    const run = await prisma.openTableSyncRun.findFirst({ where: { id: runId, venueId } });
    if (!run) throw new HttpError(404, 'That submission does not exist.');
    return { ...runSummary(run), payload: run.payload, response: run.response };
  }
};

type SubmitArgs = {
  setting: SettingRow;
  kind: 'MENUS' | 'PROFILE';
  payload: unknown;
  hash: string;
  requestKey: string;
  actor: Actor;
  flagOn: boolean;
  flagName: string;
  send: () => Promise<{ data: OpenTableWriteResponse; status: number; attempts: number }>;
};

/** The one place that talks to a write endpoint. Records the run whatever happens. */
async function submit(args: SubmitArgs): Promise<OpenTablePublishResult> {
  const { setting, kind, payload, hash, requestKey, actor, flagOn, flagName } = args;
  const base = {
    settingId: setting.id,
    venueId: setting.venueId,
    kind,
    payloadHash: hash,
    payload: payload as Prisma.InputJsonValue,
    requestKey,
    triggeredById: actor.id,
    triggeredByName: actorName(actor)
  };
  if (!flagOn || !env.integrations.opentable.enabled) {
    const which = !env.integrations.opentable.enabled ? 'OPENTABLE_API_ENABLED' : flagName;
    const run = await prisma.openTableSyncRun.create({ data: { ...base, status: 'SKIPPED', summary: `${which} is off; the payload was prepared and stored but nothing was sent.`, completedAt: new Date() } });
    return { run: runSummary(run), message: `Nothing was sent: ${which} is off. The payload is stored against this attempt so you can inspect exactly what would go to OpenTable.` };
  }
  const run = await prisma.openTableSyncRun.create({ data: { ...base, status: 'SUBMITTED', summary: 'Submitting…' } });
  try {
    const result = await args.send();
    const verdict = classifyWriteResponse(result.data);
    const requestId = result.data?.requestId != null ? String(result.data.requestId) : null;
    const acceptedFields: Prisma.OpenTableVenueSettingUpdateInput =
      verdict.status === 'ACCEPTED'
        ? kind === 'MENUS'
          ? { lastMenusAcceptedHash: hash, lastMenusAcceptedAt: new Date(), lastMenusRequestId: requestId }
          : { lastProfileAcceptedHash: hash, lastProfileAcceptedAt: new Date(), lastProfileRequestId: requestId }
        : {};
    const [updated] = await prisma.$transaction([
      prisma.openTableSyncRun.update({ where: { id: run.id }, data: { status: verdict.status, summary: verdict.summary, requestId, httpStatus: result.status, attempts: result.attempts, response: (result.data ?? {}) as Prisma.InputJsonValue, completedAt: new Date() } }),
      prisma.openTableVenueSetting.update({ where: { id: setting.id }, data: acceptedFields })
    ]);
    return { run: runSummary(updated), message: verdict.summary };
  } catch (caught) {
    const skipped = caught instanceof OpenTableDisabledError || caught instanceof OpenTableConfigError;
    const updated = await prisma.openTableSyncRun.update({
      where: { id: run.id },
      data: {
        status: skipped ? 'SKIPPED' : 'FAILED',
        summary: skipped ? caught.message : 'OpenTable did not accept the submission.',
        error: skipped ? null : errorText(caught),
        httpStatus: caught instanceof OpenTableHttpError ? caught.status : null,
        attempts: caught instanceof OpenTableHttpError ? caught.attempts : 1,
        completedAt: new Date()
      }
    });
    if (skipped) return { run: runSummary(updated), message: (caught as Error).message };
    throw new HttpError(502, `OpenTable did not accept the submission: ${errorText(caught)}`, { runId: run.id });
  }
}
