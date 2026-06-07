// Deputy integration — OAuth 2.0 sync of roster, employee, and document data.
//
// The OAuth lifecycle (start, callback, refresh, encrypted token storage,
// admin status payload, scheduler dispatch) flows through
// integration.service.ts alongside Square and Xero. This file owns the
// per-tenant API client and the three resource sync handlers that replaced
// the old CSV import scripts (packages/db/prisma/import-deputy-*).
//
// Four sync handlers:
//   - syncRoster     → /resource/Roster        → RosterShift rows
//   - syncEmployees  → /resource/Employee      → StaffProfile rows
//   - syncDocuments  → /resource/EmployeeDocument → StaffComplianceRecord
//                                                  + StaffDocumentReview rows
//   - syncTimesheets → /resource/Timesheet     → Timesheet rows (actuals)
// Each handler is idempotent — re-running the same sync converges to the
// same Prisma state, so the scheduled job can fire as often as needed.

import crypto from 'node:crypto';
import { prisma } from '@alma/db';
import type { AuthUser } from '@alma/shared';
import type { IntegrationConnection } from '@prisma/client';
import { env } from '../env.js';
import { HttpError } from '../lib/http.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret
} from '../lib/integration-crypto.js';

// ── Per-tenant endpoint + token plumbing ──────────────────────────────────
// Deputy's OAuth handshake returns an `endpoint` field that tells us which
// install (subdomain) the token belongs to (e.g. "myinstall.au.deputy.com").
// All subsequent API and refresh calls use that host. We stash it in
// IntegrationConnection.metadata.endpoint at callback time.

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function deputyEndpointFromConnection(connection: IntegrationConnection): string {
  const meta = metadataRecord(connection.metadata);
  const endpoint = typeof meta.endpoint === 'string' ? meta.endpoint.trim() : '';
  if (!endpoint) {
    throw new HttpError(500, 'Deputy connection is missing the per-tenant endpoint host.');
  }
  return endpoint;
}

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

const MAX_FETCH_RETRIES = 3;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
// 0.6s, 1.2s, 2.4s — fast enough for an interactive "Sync now", patient enough
// to ride out Deputy's transient 5xx ("Due to internal error … please be
// patient as we fix the problem").
const retryDelayMs = (attempt: number) => 600 * 2 ** attempt;

// Deputy's API 5xx's intermittently. Retry server errors (and network faults)
// a few times with backoff before surfacing the failure; 4xx are returned
// as-is since retrying a bad request won't help.
async function fetchWithRetry(makeRequest: () => Promise<Response>): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await makeRequest();
      if (response.status >= 500 && attempt < MAX_FETCH_RETRIES) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_FETCH_RETRIES) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Deputy request failed');
}

async function refreshConnection(connection: IntegrationConnection) {
  if (!connection.refreshTokenEncrypted) {
    throw new HttpError(409, 'Deputy refresh token missing — please reconnect.');
  }
  const refreshToken = decryptIntegrationSecret(connection.refreshTokenEncrypted);
  const endpoint = deputyEndpointFromConnection(connection);
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.integrations.deputy.clientId,
    client_secret: env.integrations.deputy.clientSecret,
    refresh_token: refreshToken,
    scope: env.integrations.deputy.scope
  });
  const response = await fetch(`https://${endpoint}/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new HttpError(502, `Deputy refresh failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    scope?: string;
    endpoint?: string;
  };
  const tokenExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null;
  const updated = await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      tokenEncrypted: encryptIntegrationSecret(data.access_token),
      refreshTokenEncrypted: encryptIntegrationSecret(data.refresh_token),
      tokenExpiresAt,
      status: 'CONNECTED',
      lastError: null
    }
  });
  return { connection: updated, accessToken: data.access_token };
}

async function validAccessToken(connection: IntegrationConnection) {
  if (!connection.tokenEncrypted) {
    throw new HttpError(409, 'Deputy connection has no access token — please reconnect.');
  }
  if (
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() - Date.now() < TOKEN_REFRESH_BUFFER_MS
  ) {
    return refreshConnection(connection);
  }
  return {
    connection,
    accessToken: decryptIntegrationSecret(connection.tokenEncrypted)
  };
}

async function apiGet<T>(connection: IntegrationConnection, path: string): Promise<T> {
  let current = await validAccessToken(connection);
  const endpoint = deputyEndpointFromConnection(current.connection);
  const doFetch = (token: string) =>
    fetch(`https://${endpoint}/api/v1${path}`, {
      headers: { authorization: `OAuth ${token}`, accept: 'application/json' }
    });
  let response = await fetchWithRetry(() => doFetch(current.accessToken));
  if (response.status === 401) {
    current = await refreshConnection(current.connection);
    response = await fetchWithRetry(() => doFetch(current.accessToken));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new HttpError(response.status, `Deputy GET ${path} (${response.status}): ${detail.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

// Deputy's /resource/<Object>/QUERY endpoints are POST-only — a GET returns
// 404 "No method for resource found". search / join / max go in the JSON body,
// not the query string.
async function apiPost<T>(connection: IntegrationConnection, path: string, body: unknown): Promise<T> {
  let current = await validAccessToken(connection);
  const endpoint = deputyEndpointFromConnection(current.connection);
  const doFetch = (token: string) =>
    fetch(`https://${endpoint}/api/v1${path}`, {
      method: 'POST',
      headers: {
        authorization: `OAuth ${token}`,
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body ?? {})
    });
  let response = await fetchWithRetry(() => doFetch(current.accessToken));
  if (response.status === 401) {
    current = await refreshConnection(current.connection);
    response = await fetchWithRetry(() => doFetch(current.accessToken));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new HttpError(response.status, `Deputy POST ${path} (${response.status}): ${detail.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

async function apiGetBytes(connection: IntegrationConnection, path: string) {
  let current = await validAccessToken(connection);
  const endpoint = deputyEndpointFromConnection(current.connection);
  const doFetch = (token: string) =>
    fetch(`https://${endpoint}/api/v1${path}`, { headers: { authorization: `OAuth ${token}` } });
  let response = await fetchWithRetry(() => doFetch(current.accessToken));
  if (response.status === 401) {
    current = await refreshConnection(current.connection);
    response = await fetchWithRetry(() => doFetch(current.accessToken));
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new HttpError(response.status, `Deputy file ${path} (${response.status}): ${detail.slice(0, 240)}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type')
  };
}

async function connectedDeputyConnection(): Promise<IntegrationConnection> {
  const connection = await prisma.integrationConnection.findFirst({
    where: { provider: 'DEPUTY', scopeType: 'BUSINESS' },
    orderBy: { updatedAt: 'desc' }
  });
  if (!connection || connection.status !== 'CONNECTED') {
    throw new HttpError(409, 'Deputy is not connected. Connect it from admin > integrations.');
  }
  return connection;
}

async function markSyncRun(
  connection: IntegrationConnection,
  syncType: 'MANUAL' | 'SCHEDULED' | 'BACKFILL' | 'TEST',
  status: 'SUCCESS' | 'ERROR',
  detail: { recordsImported?: number; recordsUpdated?: number; errorSummary?: string | null }
) {
  await prisma.integrationSyncRun.create({
    data: {
      provider: 'DEPUTY',
      connectionId: connection.id,
      syncType,
      status,
      finishedAt: new Date(),
      recordsImported: detail.recordsImported ?? 0,
      recordsUpdated: detail.recordsUpdated ?? 0,
      errorSummary: detail.errorSummary ?? null
    }
  });
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: status,
      lastError: detail.errorSummary ?? null,
      status: status === 'ERROR' ? 'ERROR' : 'CONNECTED'
    }
  });
}

// ── Shared row helpers ───────────────────────────────────────────────────

function normaliseVenue(location: string | null | undefined) {
  const value = (location ?? '').toLowerCase();
  if (value.includes('freshwater')) return 'St Alma';
  if (value.includes('avalon')) return 'Alma Avalon';
  return (location ?? '').trim();
}

function normaliseArea(area: string | null | undefined) {
  return (area ?? '').trim().replace(/\s+/g, ' ');
}

function normaliseEmail(email: string | null | undefined): string | null {
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed || null;
}

function stripAccents(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const ROSTER_MARKER = 'Deputy sync: roster';
const EMPLOYEE_MARKER = 'Deputy sync: employee';
const DOCUMENT_REVIEW_SOURCE = 'deputy-document-sync';

// ── Roster sync ──────────────────────────────────────────────────────────
// Pulls a window of shifts (configurable lookback + lookforward) from
// Deputy's /resource/Roster, then deletes the previous import for that
// window before recreating — same idempotency strategy the CSV script used.

type DeputyRosterShift = {
  Id: number;
  StartTime: number;
  EndTime: number;
  MealBreak?: number;
  RestBreak?: number;
  Open?: boolean;
  Approval?: number;
  Cost?: number;
  Comment?: string;
  Employee?: number;
  OperationalUnit?: number;
  _DPMetaData?: {
    EmployeeInfo?: { FirstName?: string; LastName?: string; Email?: string };
    OperationalUnitInfo?: { OperationalUnitName?: string; CompanyName?: string };
  };
};

type RosterSyncOptions = {
  lookbackDays?: number;
  lookforwardDays?: number;
};

export async function syncRoster(connection: IntegrationConnection, options: RosterSyncOptions = {}) {
  const lookbackDays = options.lookbackDays ?? 7;
  const lookforwardDays = options.lookforwardDays ?? 14;
  const start = new Date(Date.now() - lookbackDays * 86_400_000);
  const end = new Date(Date.now() + lookforwardDays * 86_400_000);

  const shifts = await apiPost<DeputyRosterShift[]>(connection, '/resource/Roster/QUERY', {
    search: {
      s1: { field: 'StartTime', type: 'ge', data: Math.floor(start.getTime() / 1000) },
      s2: { field: 'StartTime', type: 'le', data: Math.floor(end.getTime() / 1000) }
    },
    join: ['EmployeeInfo', 'OperationalUnitInfo']
  });

  // Clear previously-imported shifts in this window before re-creating them.
  // Match on startsAt only — the Deputy query filters by StartTime, so every
  // shift we re-create has its START in [start, end]. The old predicate also
  // required endsAt <= end, which missed shifts ending after the window edge
  // (e.g. an overnight shift): they were never deleted yet re-created each run,
  // so duplicates piled up. Anchoring the delete to the same field the create
  // is keyed on keeps the two in sync.
  const deleted = await prisma.rosterShift.deleteMany({
    where: {
      startsAt: { gte: start, lte: end },
      notes: { contains: ROSTER_MARKER }
    }
  });

  let staffCreated = 0;
  let staffMatched = 0;
  let shiftsCreated = 0;
  const skipped: Array<{ id: number; reason: string }> = [];

  for (const shift of Array.isArray(shifts) ? shifts : []) {
    const startsAt = new Date(shift.StartTime * 1000);
    const endsAt = new Date(shift.EndTime * 1000);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      skipped.push({ id: shift.Id, reason: 'Invalid time' });
      continue;
    }
    if (endsAt <= startsAt) {
      skipped.push({ id: shift.Id, reason: 'End not after start' });
      continue;
    }

    const employeeInfo = shift._DPMetaData?.EmployeeInfo ?? {};
    const opUnitInfo = shift._DPMetaData?.OperationalUnitInfo ?? {};
    const firstName = employeeInfo.FirstName?.trim() ?? '';
    const lastName = employeeInfo.LastName?.trim() ?? '';
    const email = normaliseEmail(employeeInfo.Email);
    const area = normaliseArea(opUnitInfo.OperationalUnitName);
    const venue = normaliseVenue(opUnitInfo.CompanyName);

    let profile = email ? await prisma.staffProfile.findUnique({ where: { email } }) : null;
    if (!profile && firstName && lastName) {
      profile = await prisma.staffProfile.findFirst({ where: { firstName, lastName, venue } });
    }

    if (!profile) {
      // Unallocated or unmatched — create a placeholder so the shift still
      // shows up in the daily brief. Matches the CSV importer's behaviour.
      if (!firstName && !lastName) {
        profile = await prisma.staffProfile.findFirst({
          where: {
            firstName: 'Unallocated',
            lastName: area,
            venue,
            notes: { contains: 'Deputy unallocated placeholder' }
          }
        });
        if (!profile) {
          profile = await prisma.staffProfile.create({
            data: {
              firstName: 'Unallocated',
              lastName: area || 'Shift',
              roleTitle: area || 'Unallocated shift',
              venue,
              employmentStatus: 'ACTIVE',
              notes: `Deputy unallocated placeholder. ${ROSTER_MARKER}`
            }
          });
          staffCreated += 1;
        } else {
          staffMatched += 1;
        }
      } else {
        profile = await prisma.staffProfile.create({
          data: {
            firstName: firstName || 'Unknown',
            lastName: lastName || area || 'Deputy',
            roleTitle: area || 'Team member',
            email,
            venue,
            employmentStatus: 'ACTIVE',
            notes: `Created from Deputy sync. ${ROSTER_MARKER}`
          }
        });
        staffCreated += 1;
      }
    } else {
      staffMatched += 1;
    }

    const breakMinutes = (shift.MealBreak ?? 0) + (shift.RestBreak ?? 0);
    const status = shift.Open === false ? 'PUBLISHED' : 'DRAFT';
    const noteParts = [
      ROSTER_MARKER,
      `Deputy roster id: ${shift.Id}`,
      shift.Comment ? `Deputy note: ${shift.Comment}` : null,
      shift.Cost && shift.Cost > 0 ? `Deputy cost: ${shift.Cost}` : null
    ].filter(Boolean);

    await prisma.rosterShift.create({
      data: {
        staffProfileId: profile.id,
        venue,
        area,
        roleTitle: area || profile.roleTitle,
        startsAt,
        endsAt,
        breakMinutes,
        status,
        notes: noteParts.join(' | ')
      }
    });
    shiftsCreated += 1;
  }

  return {
    rowsRead: Array.isArray(shifts) ? shifts.length : 0,
    shiftsCreated,
    previousImportedShiftsDeleted: deleted.count,
    staffCreated,
    staffMatched,
    skipped,
    range: { start: start.toISOString(), end: end.toISOString() }
  };
}

// ── Employee sync ────────────────────────────────────────────────────────
// Upsert StaffProfile rows from Deputy's /resource/Employee. Idempotent —
// existing profiles get updated where fields differ; new ones are created.

type DeputyEmployee = {
  Id: number;
  FirstName?: string;
  LastName?: string;
  DisplayName?: string;
  Email?: string;
  Mobile?: string;
  Phone?: string;
  DateOfBirth?: string;
  AddressStreet1?: string;
  AddressCity?: string;
  AddressPostcode?: string;
  AddressState?: string;
  AddressCountry?: string;
  EmergencyContactName?: string;
  EmergencyContactNumber?: string;
  StartDate?: string;
  TerminationDate?: string;
  PayrollId?: string;
  Active?: boolean;
  Role?: number;
  Company?: number;
  _DPMetaData?: {
    CompanyInfo?: { CompanyName?: string };
    RoleInfo?: { Role?: string };
  };
};

function pickFirstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export async function syncEmployees(connection: IntegrationConnection) {
  const queryEmployees = (withJoins: boolean) =>
    apiPost<DeputyEmployee[]>(connection, '/resource/Employee/QUERY', {
      max: 500,
      ...(withJoins ? { join: ['CompanyInfo', 'RoleInfo'] } : {})
    });
  // Deputy intermittently 500s on the *joined* Employee query. If the joined
  // form fails with a server error, retry without joins so we still sync core
  // employee fields — the Company/Role enrichment below already treats the
  // joined metadata as optional.
  let employees: DeputyEmployee[];
  try {
    employees = await queryEmployees(true);
  } catch (error) {
    if (error instanceof HttpError && error.statusCode >= 500) {
      employees = await queryEmployees(false);
    } else {
      throw error;
    }
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const conflicts: Array<{ deputyId: number; reason: string }> = [];

  for (const employee of Array.isArray(employees) ? employees : []) {
    const firstName = (employee.FirstName ?? '').trim();
    const lastName = (employee.LastName ?? '').trim();
    if (!firstName && !lastName) {
      conflicts.push({ deputyId: employee.Id, reason: 'No name on Deputy record' });
      continue;
    }
    const email = normaliseEmail(employee.Email);
    const venue = normaliseVenue(employee._DPMetaData?.CompanyInfo?.CompanyName);
    const roleTitle = employee._DPMetaData?.RoleInfo?.Role?.trim() || 'Team member';

    let profile = email ? await prisma.staffProfile.findUnique({ where: { email } }) : null;

    if (!profile) {
      const candidates = await prisma.staffProfile.findMany({
        where: { firstName, lastName, venue },
        take: 3
      });
      if (candidates.length === 1 && candidates[0]) {
        profile = candidates[0];
      } else if (candidates.length > 1) {
        conflicts.push({ deputyId: employee.Id, reason: 'Multiple matches by name+venue' });
        continue;
      }
    }
    if (!profile) {
      const looseMatches = await prisma.staffProfile.findMany({
        where: {
          firstName: { equals: firstName, mode: 'insensitive' },
          lastName: { equals: lastName, mode: 'insensitive' }
        },
        take: 3
      });
      if (looseMatches.length === 1 && looseMatches[0]) profile = looseMatches[0];
      else if (looseMatches.length > 1) {
        conflicts.push({ deputyId: employee.Id, reason: 'Multiple loose-name matches' });
        continue;
      }
    }

    const noteMarker = `${EMPLOYEE_MARKER} id:${employee.Id}`;
    const addressLine1 = pickFirstNonEmpty(employee.AddressStreet1);
    const employmentStatus = employee.Active === false || employee.TerminationDate ? 'TERMINATED' : 'ACTIVE';
    const startDate = employee.StartDate ? new Date(employee.StartDate) : null;
    const dob = employee.DateOfBirth ? new Date(employee.DateOfBirth) : null;

    if (!profile) {
      await prisma.staffProfile.create({
        data: {
          firstName,
          lastName,
          email,
          phone: pickFirstNonEmpty(employee.Mobile, employee.Phone),
          venue,
          roleTitle,
          employmentStatus,
          startDate: startDate && Number.isFinite(startDate.getTime()) ? startDate : null,
          dateOfBirth: dob && Number.isFinite(dob.getTime()) ? dob : null,
          addressLine1,
          suburb: pickFirstNonEmpty(employee.AddressCity),
          state: pickFirstNonEmpty(employee.AddressState),
          postcode: pickFirstNonEmpty(employee.AddressPostcode),
          emergencyContactName: pickFirstNonEmpty(employee.EmergencyContactName),
          emergencyContactPhone: pickFirstNonEmpty(employee.EmergencyContactNumber),
          notes: noteMarker
        }
      });
      created += 1;
      continue;
    }

    // Don't blindly overwrite — only update fields that are empty on our
    // side. Preserves locally-edited records while still backfilling
    // anything Deputy added since the last sync.
    const updates: Record<string, unknown> = {};
    if (!profile.email && email) updates.email = email;
    if (!profile.phone && (employee.Mobile || employee.Phone)) updates.phone = pickFirstNonEmpty(employee.Mobile, employee.Phone);
    if (!profile.venue && venue) updates.venue = venue;
    if (!profile.roleTitle || profile.roleTitle === 'Team member') {
      if (roleTitle && roleTitle !== 'Team member') updates.roleTitle = roleTitle;
    }
    if (!profile.addressLine1 && addressLine1) updates.addressLine1 = addressLine1;
    if (!profile.suburb && employee.AddressCity) updates.suburb = employee.AddressCity.trim();
    if (!profile.state && employee.AddressState) updates.state = employee.AddressState.trim();
    if (!profile.postcode && employee.AddressPostcode) updates.postcode = employee.AddressPostcode.trim();
    if (!profile.emergencyContactName && employee.EmergencyContactName) updates.emergencyContactName = employee.EmergencyContactName.trim();
    if (!profile.emergencyContactPhone && employee.EmergencyContactNumber) updates.emergencyContactPhone = employee.EmergencyContactNumber.trim();
    if (!profile.dateOfBirth && dob && Number.isFinite(dob.getTime())) updates.dateOfBirth = dob;
    if (!profile.startDate && startDate && Number.isFinite(startDate.getTime())) updates.startDate = startDate;
    if (profile.employmentStatus === 'ACTIVE' && employmentStatus === 'TERMINATED') updates.employmentStatus = 'TERMINATED';

    // Append the Deputy id once for traceability — skip if it's already there.
    if (!(profile.notes ?? '').includes(noteMarker)) {
      updates.notes = [profile.notes, noteMarker].filter(Boolean).join('\n');
    }

    if (Object.keys(updates).length === 0) {
      unchanged += 1;
      continue;
    }
    await prisma.staffProfile.update({ where: { id: profile.id }, data: updates });
    updated += 1;

    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: profile.id,
        eventType: 'DEPUTY_EMPLOYEE_SYNC_IMPORTED',
        summary: `Deputy employee sync: refreshed ${Object.keys(updates).length} field${
          Object.keys(updates).length === 1 ? '' : 's'
        }.`,
        metadata: { deputyId: employee.Id, updatedFields: Object.keys(updates) }
      }
    });
  }

  return {
    rowsRead: Array.isArray(employees) ? employees.length : 0,
    created,
    updated,
    unchanged,
    conflicts
  };
}

// ── Document sync ────────────────────────────────────────────────────────
// Pulls /resource/EmployeeDocument records, downloads each file, and:
//   - If it looks like a recognised certificate type (RSA, RCG, food safety)
//     and the employee is matched, creates a StaffComplianceRecord.
//   - Otherwise creates a StaffDocumentReview row for a human to route.
// Dedup is by SHA256 of the downloaded bytes — stored on
// StaffDocumentReview.sourceFileHash. Compliance records also store the
// hash in `notes` so re-runs are safe.

type DeputyEmployeeDocument = {
  Id: number;
  Title?: string;
  FileName?: string;
  Type?: string;
  Category?: string;
  EmployeeId?: number;
  Employee?: number;
  CompanyId?: number;
  DateOfExpiry?: string;
  Comments?: string;
  _DPMetaData?: {
    EmployeeInfo?: { FirstName?: string; LastName?: string; Email?: string };
  };
};

function classifyDocument(doc: DeputyEmployeeDocument):
  | { kind: 'compliance'; recordType: 'RSA' | 'RSG' | 'FOOD_SAFETY' | 'OTHER'; title: string }
  | { kind: 'review' } {
  const text = `${doc.Title ?? ''} ${doc.FileName ?? ''} ${doc.Type ?? ''} ${doc.Category ?? ''}`.toLowerCase();
  if (text.includes('rsa') || text.includes('responsible service of alcohol')) {
    return { kind: 'compliance', recordType: 'RSA', title: doc.Title?.trim() || 'RSA Certificate' };
  }
  if (text.includes('rsg') || text.includes('rcg') || text.includes('responsible service of gambling') || text.includes('responsible conduct of gambling')) {
    return { kind: 'compliance', recordType: 'RSG', title: doc.Title?.trim() || 'RSG Certificate' };
  }
  if (text.includes('food safety') || text.includes('food handler')) {
    return { kind: 'compliance', recordType: 'FOOD_SAFETY', title: doc.Title?.trim() || 'Food Safety Certificate' };
  }
  return { kind: 'review' };
}

export async function syncDocuments(connection: IntegrationConnection) {
  let documents: DeputyEmployeeDocument[];
  try {
    documents = await apiPost<DeputyEmployeeDocument[]>(connection, '/resource/EmployeeDocument/QUERY', {
      max: 500,
      join: ['EmployeeInfo']
    });
  } catch (error) {
    // Some Deputy installs/plans don't expose the EmployeeDocument resource at
    // all — the QUERY 404s with "Invalid object requested". Treat that as
    // "no documents to sync" instead of failing the run; document sync is
    // auxiliary (compliance-cert routing), unlike roster/timesheets.
    if (error instanceof HttpError && error.statusCode === 404) {
      return { rowsRead: 0, complianceCreated: 0, reviewsCreated: 0, skippedDuplicates: 0, failures: [], resourceUnavailable: true as const };
    }
    throw error;
  }

  let complianceCreated = 0;
  let reviewsCreated = 0;
  let skippedDuplicates = 0;
  const failures: Array<{ deputyId: number; reason: string }> = [];

  for (const doc of Array.isArray(documents) ? documents : []) {
    try {
      const { bytes, contentType } = await apiGetBytes(connection, `/resource/EmployeeDocument/${doc.Id}/file`);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

      const existing = await prisma.staffDocumentReview.findFirst({
        where: { sourceFileHash: sha256 }
      });
      if (existing) {
        skippedDuplicates += 1;
        continue;
      }

      const employeeInfo = doc._DPMetaData?.EmployeeInfo ?? {};
      const email = normaliseEmail(employeeInfo.Email);
      const firstName = (employeeInfo.FirstName ?? '').trim();
      const lastName = (employeeInfo.LastName ?? '').trim();

      let profile = email ? await prisma.staffProfile.findUnique({ where: { email } }) : null;
      if (!profile && firstName && lastName) {
        profile = await prisma.staffProfile.findFirst({ where: { firstName, lastName } });
      }

      const candidates = await prisma.staffProfile.findMany({
        where: {
          OR: [
            email ? { email } : undefined,
            firstName && lastName ? { firstName, lastName } : undefined
          ].filter(Boolean) as Array<Record<string, unknown>>
        },
        select: { id: true, firstName: true, lastName: true },
        take: 5
      });

      const classification = classifyDocument(doc);
      const documentName = (doc.FileName ?? doc.Title ?? `deputy-${doc.Id}`).trim();
      const candidateName = [firstName, lastName].filter(Boolean).join(' ') || (doc.Title ?? '').trim();
      const issueDate = (() => {
        const value = doc.DateOfExpiry ? new Date(doc.DateOfExpiry) : null;
        return value && Number.isFinite(value.getTime()) ? value : null;
      })();

      if (classification.kind === 'compliance' && profile) {
        // Check we haven't already attached this file to this profile.
        const alreadyAttached = await prisma.staffComplianceRecord.findFirst({
          where: {
            staffProfileId: profile.id,
            recordType: classification.recordType,
            documentName
          }
        });
        if (alreadyAttached) {
          skippedDuplicates += 1;
          continue;
        }
        await prisma.staffComplianceRecord.create({
          data: {
            staffProfileId: profile.id,
            recordType: classification.recordType,
            title: classification.title,
            status: 'APPROVED',
            documentName,
            notes: `Synced from Deputy EmployeeDocument id:${doc.Id}. sha256:${sha256}`,
            ...(issueDate ? { issueDate } : {})
          }
        });
        complianceCreated += 1;
        continue;
      }

      await prisma.staffDocumentReview.create({
        data: {
          recordType: classification.kind === 'compliance' ? classification.recordType : 'OTHER',
          title: doc.Title?.trim() || documentName,
          status: 'PENDING_REVIEW',
          source: DOCUMENT_REVIEW_SOURCE,
          sourceFileName: documentName,
          sourceFileHash: sha256,
          candidateName: candidateName || null,
          candidateStaffIds: candidates.map((c) => c.id),
          reviewReason: classification.kind === 'compliance'
            ? 'Recognised certificate but no single staff match — please confirm.'
            : 'Document type not recognised — please route manually.',
          documentName,
          notes: [
            `Deputy EmployeeDocument id:${doc.Id}`,
            doc.Comments ? `Deputy note: ${doc.Comments}` : null,
            contentType ? `Content-Type: ${contentType}` : null
          ].filter(Boolean).join(' | ')
        }
      });
      reviewsCreated += 1;
    } catch (error) {
      failures.push({
        deputyId: doc.Id,
        reason: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return {
    rowsRead: Array.isArray(documents) ? documents.length : 0,
    complianceCreated,
    reviewsCreated,
    skippedDuplicates,
    failures
  };
}

// ── Timesheet sync ───────────────────────────────────────────────────────
// Pulls actual worked hours from Deputy's /resource/Timesheet into the
// Timesheet table. Unlike roster (planned shifts), these are actuals used for
// labour-cost reporting. Idempotent via the @unique deputyTimesheetId: each
// run upserts, so overlapping windows or retries converge to one row.

type DeputyTimesheet = {
  Id: number;
  Employee?: number;
  StartTime?: number;
  EndTime?: number;
  Mealbreak?: number | string;
  TotalTime?: number;
  Cost?: number;
  OperationalUnit?: number;
  IsInProgress?: boolean;
  Discarded?: boolean;
  TimeApproved?: boolean | number;
  _DPMetaData?: {
    EmployeeInfo?: { FirstName?: string; LastName?: string; Email?: string };
    OperationalUnitInfo?: { OperationalUnitName?: string; CompanyName?: string };
  };
};

type TimesheetSyncOptions = {
  lookbackDays?: number;
  lookforwardDays?: number;
};

// Deputy reports Mealbreak in seconds on the Timesheet resource.
function coerceBreakMinutes(value: number | string | undefined): number {
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds / 60)) : 0;
}

export async function syncTimesheets(
  connection: IntegrationConnection,
  options: TimesheetSyncOptions = {}
) {
  const lookbackDays = options.lookbackDays ?? 14;
  const lookforwardDays = options.lookforwardDays ?? 1;
  const start = new Date(Date.now() - lookbackDays * 86_400_000);
  const end = new Date(Date.now() + lookforwardDays * 86_400_000);

  const sheets = await apiPost<DeputyTimesheet[]>(connection, '/resource/Timesheet/QUERY', {
    search: {
      s1: { field: 'StartTime', type: 'ge', data: Math.floor(start.getTime() / 1000) },
      s2: { field: 'StartTime', type: 'le', data: Math.floor(end.getTime() / 1000) }
    },
    join: ['EmployeeInfo', 'OperationalUnitInfo']
  });

  let created = 0;
  let updated = 0;
  const skipped: Array<{ id: number; reason: string }> = [];

  for (const ts of Array.isArray(sheets) ? sheets : []) {
    if (ts.Discarded) {
      skipped.push({ id: ts.Id, reason: 'Discarded in Deputy' });
      continue;
    }
    if (ts.IsInProgress) {
      skipped.push({ id: ts.Id, reason: 'Shift still in progress' });
      continue;
    }
    if (!ts.StartTime || !ts.EndTime) {
      skipped.push({ id: ts.Id, reason: 'Missing start/end' });
      continue;
    }
    const clockInAt = new Date(ts.StartTime * 1000);
    const clockOutAt = new Date(ts.EndTime * 1000);
    if (!Number.isFinite(clockInAt.getTime()) || !Number.isFinite(clockOutAt.getTime())) {
      skipped.push({ id: ts.Id, reason: 'Invalid time' });
      continue;
    }
    if (clockOutAt <= clockInAt) {
      skipped.push({ id: ts.Id, reason: 'End not after start' });
      continue;
    }

    const employeeInfo = ts._DPMetaData?.EmployeeInfo ?? {};
    const opUnitInfo = ts._DPMetaData?.OperationalUnitInfo ?? {};
    const firstName = employeeInfo.FirstName?.trim() ?? '';
    const lastName = employeeInfo.LastName?.trim() ?? '';
    const email = normaliseEmail(employeeInfo.Email);
    const area = normaliseArea(opUnitInfo.OperationalUnitName);
    const venue = normaliseVenue(opUnitInfo.CompanyName);

    // Actuals must attach to a real person — never create placeholder staff.
    let profile = email ? await prisma.staffProfile.findUnique({ where: { email } }) : null;
    if (!profile && firstName && lastName) {
      profile = await prisma.staffProfile.findFirst({ where: { firstName, lastName, venue } });
    }
    if (!profile) {
      skipped.push({ id: ts.Id, reason: 'No matching staff profile' });
      continue;
    }

    const deputyTimesheetId = `deputy-${ts.Id}`;
    const breakMinutes = coerceBreakMinutes(ts.Mealbreak);
    const approved = Boolean(ts.TimeApproved);
    const noteParts = [
      'Deputy sync: timesheet',
      `Deputy timesheet id: ${ts.Id}`,
      typeof ts.TotalTime === 'number' ? `Deputy hours: ${ts.TotalTime}` : null,
      typeof ts.Cost === 'number' && ts.Cost > 0 ? `Deputy cost: ${ts.Cost}` : null
    ].filter(Boolean);

    const data = {
      staffProfileId: profile.id,
      venue: venue || null,
      area: area || null,
      roleTitle: area || profile.roleTitle,
      workDate: clockInAt,
      clockInAt,
      clockOutAt,
      breakMinutes,
      status: (approved ? 'APPROVED' : 'SUBMITTED') as 'APPROVED' | 'SUBMITTED',
      notes: noteParts.join(' | ')
    };

    const existing = await prisma.timesheet.findUnique({
      where: { deputyTimesheetId },
      select: { id: true }
    });
    await prisma.timesheet.upsert({
      where: { deputyTimesheetId },
      create: { deputyTimesheetId, ...data },
      update: data
    });
    if (existing) updated += 1;
    else created += 1;
  }

  return {
    rowsRead: Array.isArray(sheets) ? sheets.length : 0,
    created,
    updated,
    skipped
  };
}

// ── Service surface used by routes + scheduler ───────────────────────────

type SyncTrigger = 'MANUAL' | 'SCHEDULED';

async function runSyncForRoute(actor: AuthUser, trigger: SyncTrigger, task: 'roster' | 'employees' | 'documents' | 'timesheets' | 'all') {
  const connection = await connectedDeputyConnection();

  // 'all' runs each resource independently so a transient failure on one
  // (Deputy regularly 500s on a single resource — most often Employee) no
  // longer aborts the rest. Roster + timesheets feed the daily brief and the
  // labour-cost reports, so they must still import even when employee sync is
  // down. We mark ERROR only when every resource failed; a partial run stays
  // CONNECTED with the failing resource(s) noted. Order is preserved so later
  // syncs can match employees imported earlier in the same run.
  if (task === 'all') {
    const reason = (error: unknown) => (error instanceof Error ? error.message : 'failed');
    const failures: string[] = [];
    let employees: Awaited<ReturnType<typeof syncEmployees>> | undefined;
    let documents: Awaited<ReturnType<typeof syncDocuments>> | undefined;
    let roster: Awaited<ReturnType<typeof syncRoster>> | undefined;
    let timesheets: Awaited<ReturnType<typeof syncTimesheets>> | undefined;
    try { employees = await syncEmployees(connection); } catch (error) { failures.push(`employees: ${reason(error)}`); }
    try { documents = await syncDocuments(connection); } catch (error) { failures.push(`documents: ${reason(error)}`); }
    try { roster = await syncRoster(connection); } catch (error) { failures.push(`roster: ${reason(error)}`); }
    try { timesheets = await syncTimesheets(connection); } catch (error) { failures.push(`timesheets: ${reason(error)}`); }

    const allFailed = failures.length === 4;
    await markSyncRun(connection, trigger, allFailed ? 'ERROR' : 'SUCCESS', {
      recordsImported:
        (employees?.created ?? 0) +
        (documents?.complianceCreated ?? 0) +
        (documents?.reviewsCreated ?? 0) +
        (roster?.shiftsCreated ?? 0) +
        (timesheets?.created ?? 0),
      recordsUpdated:
        (employees?.updated ?? 0) + (roster?.staffMatched ?? 0) + (timesheets?.updated ?? 0),
      errorSummary: failures.length ? failures.join(' • ') : null
    });
    if (allFailed) {
      throw new HttpError(502, `Deputy sync failed — ${failures.join(' • ')}`);
    }
    return { ok: true, trigger, actorId: actor.id, employees, documents, roster, timesheets, partialFailures: failures };
  }

  // Single-resource syncs: success marks SUCCESS; any throw marks ERROR.
  try {
    if (task === 'roster') {
      const result = await syncRoster(connection);
      await markSyncRun(connection, trigger, 'SUCCESS', {
        recordsImported: result.shiftsCreated,
        recordsUpdated: result.staffMatched
      });
      return { ok: true, trigger, actorId: actor.id, roster: result };
    }
    if (task === 'employees') {
      const result = await syncEmployees(connection);
      await markSyncRun(connection, trigger, 'SUCCESS', {
        recordsImported: result.created,
        recordsUpdated: result.updated
      });
      return { ok: true, trigger, actorId: actor.id, employees: result };
    }
    if (task === 'documents') {
      const result = await syncDocuments(connection);
      await markSyncRun(connection, trigger, 'SUCCESS', {
        recordsImported: result.complianceCreated + result.reviewsCreated
      });
      return { ok: true, trigger, actorId: actor.id, documents: result };
    }
    const result = await syncTimesheets(connection);
    await markSyncRun(connection, trigger, 'SUCCESS', {
      recordsImported: result.created,
      recordsUpdated: result.updated
    });
    return { ok: true, trigger, actorId: actor.id, timesheets: result };
  } catch (error) {
    const errorSummary = error instanceof Error ? error.message : 'Deputy sync failed';
    await markSyncRun(connection, trigger, 'ERROR', { errorSummary });
    throw error;
  }
}

export const deputyService = {
  // Quick public status for the admin UI tile / pre-flight checks. The
  // full IntegrationProviderStatus shape is built by integration.service.ts
  // via providerStatus — this is just a thin summary for the legacy
  // /api/integrations/deputy/status route.
  async getStatus() {
    const connection = await prisma.integrationConnection.findFirst({
      where: { provider: 'DEPUTY', scopeType: 'BUSINESS' },
      orderBy: { updatedAt: 'desc' }
    });
    return {
      mode: 'API_SYNC' as const,
      connected: connection?.status === 'CONNECTED',
      lastSyncAt: connection?.lastSyncAt?.toISOString() ?? null,
      lastSyncStatus: connection?.lastSyncStatus ?? null,
      lastError: connection?.lastError ?? null,
      providerAccountName: connection?.providerAccountName ?? null
    };
  },

  async syncRosterNow(actor: AuthUser) {
    return runSyncForRoute(actor, 'MANUAL', 'roster');
  },
  async syncEmployeesNow(actor: AuthUser) {
    return runSyncForRoute(actor, 'MANUAL', 'employees');
  },
  async syncDocumentsNow(actor: AuthUser) {
    return runSyncForRoute(actor, 'MANUAL', 'documents');
  },
  async syncTimesheetsNow(actor: AuthUser) {
    return runSyncForRoute(actor, 'MANUAL', 'timesheets');
  },
  async syncAllNow(actor: AuthUser) {
    return runSyncForRoute(actor, 'MANUAL', 'all');
  },

  // Called by integration-jobs.ts /jobs/deputy/sync (Cloud Scheduler).
  async runScheduledSync() {
    return runSyncForRoute(
      {
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
      } as AuthUser,
      'SCHEDULED',
      'all'
    );
  },

  // Exposed so integration.service.ts can call into the sync handlers
  // directly when needed (e.g. for tests).
  _internal: {
    syncRoster,
    syncEmployees,
    syncDocuments,
    syncTimesheets,
    connectedDeputyConnection
  }
};
