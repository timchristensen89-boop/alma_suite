import { randomBytes } from 'node:crypto';
import { prisma } from '@alma/db';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  normaliseOnboardingSettings,
  rosterShiftInputSchema,
  rosterPublishInputSchema,
  rosterShiftUpdateInputSchema,
  staffMergeInputSchema,
  staffAppAccessInputSchema,
  staffComplianceRecordInputSchema,
  staffHrDocumentInputSchema,
  staffHrRecordInputSchema,
  staffHrRecordQuerySchema,
  staffHrRecordUpdateSchema,
  staffManagerNoteInputSchema,
  staffPasswordResetRequestSchema,
  staffPinChangeInputSchema,
  staffPinResetInputSchema,
  staffPayProfileInputSchema,
  staffInviteCompleteInputSchema,
  staffInviteCreateInputSchema,
  staffLeaveRequestInputSchema,
  staffLeaveRequestUpdateSchema,
  staffProfileCreateInputSchema,
  staffProfileReonboardInputSchema,
  staffProfileUpdateInputSchema,
  staffReonboardInputSchema,
  timesheetApprovalInputSchema,
  staffClockBreakInputSchema,
  staffClockInInputSchema,
  staffClockOutInputSchema,
  staffHrDocumentTemplateInputSchema,
  staffHrDocumentTemplateOptionalClauseSchema,
  staffHrDocumentTemplatePreviewSchema,
  staffHrDocumentTemplateUpdateSchema,
  staffHrDocumentTemplateVariableSchema,
  staffOwnLeaveRequestInputSchema,
  staffShiftConfirmationInputSchema,
  timesheetCashPaymentInputSchema,
  timesheetCreateInputSchema,
  timesheetExportInputSchema,
  tipsCashEntryInputSchema,
  tipsCardImportInputSchema,
  tipsMarkPaidInputSchema,
  tipsPayoutInputSchema,
  tipsQuerySchema,
  timesheetUpdateInputSchema,
  AWARD_RATE_SETS,
  DEFAULT_STAFF_DEFAULTS,
  getAwardClassification,
  getAwardRateSet,
  normaliseStaffDefaults
} from '@alma/shared';
import type {
  AuthUser,
  OnboardingSettings,
  StaffDefaults,
  StaffHrDocumentTemplate,
  StaffHrDocumentTemplatePreview,
  StaffHrRecord,
  StaffLeaveStatus,
  StaffLeaveType
} from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { authService } from './auth.service.js';
import { communicationsService } from './communications.service.js';
import { mailService } from './mail.service.js';

function generateToken() {
  return randomBytes(24).toString('base64url');
}

function dateOrNull(value: string | undefined) {
  return value ? new Date(value) : null;
}

function textOrNull(value: string | undefined) {
  return value?.trim() || null;
}

const STAFF_RECORD_ATTACHMENT_MAX_DATA_URL_LENGTH = 5_700_000;
const staffRecordAttachmentDataUrlSchema = z
  .string()
  .max(STAFF_RECORD_ATTACHMENT_MAX_DATA_URL_LENGTH, 'Document uploads must be smaller than 4MB.')
  .refine(
    (value) =>
      /^data:(application\/pdf|image\/png|image\/jpeg|image\/jpg|image\/webp|image\/gif);base64,[A-Za-z0-9+/=]+$/i.test(value),
    'Upload a PDF, PNG, JPEG, WebP, or GIF document.'
  );
const staffRecordAttachmentInputSchema = z.object({
  documentName: z.string().trim().min(1, 'Document name is required').max(180, 'Document name must be 180 characters or fewer'),
  documentUrl: staffRecordAttachmentDataUrlSchema,
  status: z.literal('PENDING').optional()
});

function validateStaffRecordAttachmentOnCreate(documentUrl?: string) {
  const value = documentUrl?.trim();
  if (value?.startsWith('data:')) {
    staffRecordAttachmentDataUrlSchema.parse(value);
  }
}

function withoutStaffSecrets<T extends { passwordHash?: string | null; pinHash?: string | null }>(profile: T) {
  const { passwordHash: _passwordHash, pinHash: _pinHash, ...safeProfile } = profile;
  return safeProfile;
}

function appendRecordNote(existing: string | null | undefined, note: string) {
  return [existing?.trim(), note].filter(Boolean).join('\n');
}

function validateStaffHrDocument(documentUrl?: string) {
  validateStaffRecordAttachmentOnCreate(documentUrl);
}

function onboardingDetailCreateData(data: {
  dateOfBirth?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  emergencyContactName?: string;
  emergencyContactRelationship?: string;
  emergencyContactPhone?: string;
  employmentType?: string;
  payType?: string;
  payRateCents?: number;
  payAward?: string;
  taxFileNumber?: string;
  taxResidencyStatus?: string;
  taxFreeThreshold?: boolean;
  hasStudyTrainingLoan?: boolean;
  superFundName?: string;
  superFundAbn?: string;
  superFundUsi?: string;
  superMemberNumber?: string;
  bankAccountName?: string;
  bankBsb?: string;
  bankAccountNumber?: string;
  visaStatus?: string;
  visaSubclass?: string;
  visaExpiryDate?: string;
  workRightsNotes?: string;
  xeroEmployeeId?: string;
  xeroPayrollCalendarId?: string;
  xeroEarningsRateId?: string;
}) {
  return {
    dateOfBirth: dateOrNull(data.dateOfBirth),
    addressLine1: textOrNull(data.addressLine1),
    addressLine2: textOrNull(data.addressLine2),
    suburb: textOrNull(data.suburb),
    state: textOrNull(data.state),
    postcode: textOrNull(data.postcode),
    emergencyContactName: textOrNull(data.emergencyContactName),
    emergencyContactRelationship: textOrNull(data.emergencyContactRelationship),
    emergencyContactPhone: textOrNull(data.emergencyContactPhone),
    employmentType: textOrNull(data.employmentType),
    payType: textOrNull(data.payType),
    payRateCents: data.payRateCents ?? null,
    payAward: textOrNull(data.payAward),
    taxFileNumber: textOrNull(data.taxFileNumber),
    taxResidencyStatus: textOrNull(data.taxResidencyStatus),
    taxFreeThreshold: data.taxFreeThreshold ?? null,
    hasStudyTrainingLoan: data.hasStudyTrainingLoan ?? null,
    superFundName: textOrNull(data.superFundName),
    superFundAbn: textOrNull(data.superFundAbn),
    superFundUsi: textOrNull(data.superFundUsi),
    superMemberNumber: textOrNull(data.superMemberNumber),
    bankAccountName: textOrNull(data.bankAccountName),
    bankBsb: textOrNull(data.bankBsb),
    bankAccountNumber: textOrNull(data.bankAccountNumber),
    visaStatus: textOrNull(data.visaStatus),
    visaSubclass: textOrNull(data.visaSubclass),
    visaExpiryDate: dateOrNull(data.visaExpiryDate),
    workRightsNotes: textOrNull(data.workRightsNotes),
    xeroEmployeeId: textOrNull(data.xeroEmployeeId),
    xeroPayrollCalendarId: textOrNull(data.xeroPayrollCalendarId),
    xeroEarningsRateId: textOrNull(data.xeroEarningsRateId)
  };
}

function onboardingDetailUpdateData(data: Parameters<typeof onboardingDetailCreateData>[0]) {
  return {
    ...(data.dateOfBirth !== undefined && { dateOfBirth: dateOrNull(data.dateOfBirth) }),
    ...(data.addressLine1 !== undefined && { addressLine1: textOrNull(data.addressLine1) }),
    ...(data.addressLine2 !== undefined && { addressLine2: textOrNull(data.addressLine2) }),
    ...(data.suburb !== undefined && { suburb: textOrNull(data.suburb) }),
    ...(data.state !== undefined && { state: textOrNull(data.state) }),
    ...(data.postcode !== undefined && { postcode: textOrNull(data.postcode) }),
    ...(data.emergencyContactName !== undefined && {
      emergencyContactName: textOrNull(data.emergencyContactName)
    }),
    ...(data.emergencyContactRelationship !== undefined && {
      emergencyContactRelationship: textOrNull(data.emergencyContactRelationship)
    }),
    ...(data.emergencyContactPhone !== undefined && {
      emergencyContactPhone: textOrNull(data.emergencyContactPhone)
    }),
    ...(data.employmentType !== undefined && { employmentType: textOrNull(data.employmentType) }),
    ...(data.payType !== undefined && { payType: textOrNull(data.payType) }),
    ...(data.payRateCents !== undefined && { payRateCents: data.payRateCents ?? null }),
    ...(data.payAward !== undefined && { payAward: textOrNull(data.payAward) }),
    ...(data.taxFileNumber !== undefined && { taxFileNumber: textOrNull(data.taxFileNumber) }),
    ...(data.taxResidencyStatus !== undefined && {
      taxResidencyStatus: textOrNull(data.taxResidencyStatus)
    }),
    ...(data.taxFreeThreshold !== undefined && { taxFreeThreshold: data.taxFreeThreshold }),
    ...(data.hasStudyTrainingLoan !== undefined && {
      hasStudyTrainingLoan: data.hasStudyTrainingLoan
    }),
    ...(data.superFundName !== undefined && { superFundName: textOrNull(data.superFundName) }),
    ...(data.superFundAbn !== undefined && { superFundAbn: textOrNull(data.superFundAbn) }),
    ...(data.superFundUsi !== undefined && { superFundUsi: textOrNull(data.superFundUsi) }),
    ...(data.superMemberNumber !== undefined && {
      superMemberNumber: textOrNull(data.superMemberNumber)
    }),
    ...(data.bankAccountName !== undefined && {
      bankAccountName: textOrNull(data.bankAccountName)
    }),
    ...(data.bankBsb !== undefined && { bankBsb: textOrNull(data.bankBsb) }),
    ...(data.bankAccountNumber !== undefined && {
      bankAccountNumber: textOrNull(data.bankAccountNumber)
    }),
    ...(data.visaStatus !== undefined && { visaStatus: textOrNull(data.visaStatus) }),
    ...(data.visaSubclass !== undefined && { visaSubclass: textOrNull(data.visaSubclass) }),
    ...(data.visaExpiryDate !== undefined && { visaExpiryDate: dateOrNull(data.visaExpiryDate) }),
    ...(data.workRightsNotes !== undefined && { workRightsNotes: textOrNull(data.workRightsNotes) }),
    ...(data.xeroEmployeeId !== undefined && { xeroEmployeeId: textOrNull(data.xeroEmployeeId) }),
    ...(data.xeroPayrollCalendarId !== undefined && {
      xeroPayrollCalendarId: textOrNull(data.xeroPayrollCalendarId)
    }),
    ...(data.xeroEarningsRateId !== undefined && {
      xeroEarningsRateId: textOrNull(data.xeroEarningsRateId)
    })
  };
}

function normaliseEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

function normaliseBaseUrl(value: string | undefined) {
  const trimmed = value?.trim().replace(/\/+$/, '');
  return trimmed || process.env.PUBLIC_WEB_URL?.replace(/\/+$/, '') || null;
}

function inviteLinkFor(token: string, baseUrl: string | null) {
  return baseUrl ? `${baseUrl}/onboarding/${token}` : null;
}

const BASE_REQUIRED_ONBOARDING_FIELDS: Array<{
  key: keyof Parameters<typeof onboardingDetailCreateData>[0] | 'firstName' | 'lastName' | 'roleTitle' | 'email' | 'phone' | 'venue' | 'startDate';
  label: string;
}> = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'roleTitle', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'venue', label: 'Venue' },
  { key: 'startDate', label: 'Start date' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'addressLine1', label: 'Address line 1' },
  { key: 'suburb', label: 'Suburb' },
  { key: 'state', label: 'State' },
  { key: 'postcode', label: 'Postcode' },
  { key: 'emergencyContactName', label: 'Emergency contact name' },
  { key: 'emergencyContactRelationship', label: 'Emergency contact relationship' },
  { key: 'emergencyContactPhone', label: 'Emergency contact phone' },
  { key: 'employmentType', label: 'Employment type' },
  { key: 'payType', label: 'Pay type' },
  { key: 'bankAccountName', label: 'Bank account name' },
  { key: 'bankBsb', label: 'Bank BSB' },
  { key: 'bankAccountNumber', label: 'Bank account number' },
  { key: 'visaStatus', label: 'Visa / work rights status' }
];

const TAX_DECLARATION_FIELDS: typeof BASE_REQUIRED_ONBOARDING_FIELDS = [
  { key: 'taxFileNumber', label: 'Tax file number' },
  { key: 'taxResidencyStatus', label: 'Tax residency status' }
];

const SUPERANNUATION_CHOICE_FIELDS: typeof BASE_REQUIRED_ONBOARDING_FIELDS = [
  { key: 'superFundName', label: 'Super fund name' },
  { key: 'superFundAbn', label: 'Super fund ABN' },
  { key: 'superFundUsi', label: 'Super fund USI' },
  { key: 'superMemberNumber', label: 'Super member number' }
];

function isPresent(value: unknown) {
  return typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined;
}

function requiredOnboardingFields(settings: OnboardingSettings) {
  return [
    ...BASE_REQUIRED_ONBOARDING_FIELDS,
    ...(settings.taxDeclaration.enabled && settings.taxDeclaration.required ? TAX_DECLARATION_FIELDS : []),
    ...(settings.superannuationChoice.enabled && settings.superannuationChoice.required
      ? SUPERANNUATION_CHOICE_FIELDS
      : [])
  ];
}

function requiredOnboardingDocumentTitles(settings: OnboardingSettings) {
  return [
    settings.rightToWorkDocuments,
    settings.bankAccountConfirmation
  ]
    .filter((document) => document.enabled && document.required)
    .map((document) => document.label);
}

async function getOnboardingSettings() {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { onboardingSettings: true }
  });
  return normaliseOnboardingSettings(settings?.onboardingSettings);
}

async function getStaffDefaults() {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'singleton' },
    select: { staffDefaults: true }
  });
  return normaliseStaffDefaults(settings?.staffDefaults);
}

function validateCompleteOnboarding(
  data: ReturnType<typeof staffInviteCompleteInputSchema.parse>,
  settings: OnboardingSettings
) {
  const missing = requiredOnboardingFields(settings)
    .filter((field) => !isPresent(data[field.key as keyof typeof data]))
    .map((field) => field.label);

  if (data.visaStatus && !['Australian citizen', 'Australian permanent resident', 'New Zealand citizen'].includes(data.visaStatus)) {
    if (!isPresent(data.visaSubclass)) missing.push('Visa subclass');
    if (!isPresent(data.visaExpiryDate)) missing.push('Visa expiry date');
  }

  const uploadedDocuments = new Set(
    (data.records ?? [])
      .filter((record) => isPresent(record.documentUrl))
      .map((record) => record.title.trim().toLowerCase())
  );
  const missingDocuments = requiredOnboardingDocumentTitles(settings).filter(
    (title) => !uploadedDocuments.has(title.toLowerCase())
  );

  if (missing.length || missingDocuments.length) {
    throw new HttpError(
      400,
      [
        missing.length ? `Missing required onboarding details: ${missing.join(', ')}` : null,
        missingDocuments.length ? `Missing required uploaded documents: ${missingDocuments.join(', ')}` : null
      ].filter(Boolean).join('. ')
    );
  }
}

function parseDate(value: string, label: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid`);
  }
  return date;
}

const managerDashboardQuerySchema = z.object({
  date: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal(''))
});

function dateKey(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayRange(value?: string) {
  const reference = value ? parseDate(`${value}T00:00:00`, 'Dashboard date') : new Date();
  const start = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: dateKey(start) };
}

function timesheetHours(entry: { clockInAt: Date; clockOutAt: Date; breakMinutes: number }) {
  return Math.max(0, (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 36e5 - entry.breakMinutes / 60);
}

async function assertManagerCanAccessStaffProfile(staffProfileId: string, actor: AuthUser) {
  if (actor.role === 'STAFF' && !actor.isAdmin) {
    throw new HttpError(403, 'Manager access required');
  }
  return assertActorCanAccessStaffProfile(staffProfileId, actor);
}

function hasStaffHrAccess(actor: AuthUser, options: { manage?: boolean; rightToWork?: boolean; payChanges?: boolean } = {}) {
  if (actor.isAdmin || actor.role === 'ADMIN') return true;
  const staffAccess = actor.appAccess.find((access) => access.appId === 'STAFF' && access.status === 'ENABLED');
  if (!staffAccess) return false;
  const permissions = staffAccess.permissions ?? {};
  if (staffAccess.role === 'ADMIN' || permissions.admin) return true;
  if (options.rightToWork && !permissions.staffHrRightToWork) return false;
  if (options.payChanges && !permissions.staffHrPayChanges) return false;
  if (options.manage) return Boolean(permissions.staffHrManage);
  return Boolean(permissions.staffHrView || permissions.staffHrManage);
}

async function assertStaffHrAccess(actor: AuthUser, options: { manage?: boolean; rightToWork?: boolean; payChanges?: boolean } = {}) {
  if (!hasStaffHrAccess(actor, options)) {
    throw new HttpError(403, 'HR records are restricted.');
  }
}

async function assertActorCanAccessStaffProfile(staffProfileId: string, actor: AuthUser) {
  const profile = await prisma.staffProfile.findUnique({
    where: { id: staffProfileId },
    select: { id: true, venue: true }
  });

  if (!profile) {
    throw new HttpError(404, 'Staff profile not found');
  }

  if (actor.isAdmin || actor.role === 'ADMIN') {
    return profile;
  }

  if (actor.role === 'STAFF') {
    if (actor.id !== staffProfileId) {
      throw new HttpError(403, 'You can only access your own staff profile.');
    }
    return profile;
  }

  if (!actor.venue || profile.venue !== actor.venue) {
    throw new HttpError(403, 'Staff management actions are limited to staff in your venue.');
  }

  return profile;
}

function actorVenueScope(actor?: AuthUser) {
  if (!actor || actor.isAdmin || actor.role === 'ADMIN') return null;
  if (actor.role === 'STAFF') return actor.venue || null;
  return actor.venue || '__no_manager_venue__';
}

function dateToIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

type StaffHrRecordRow = Prisma.StaffHrRecordGetPayload<{
  include: {
    staffProfile: {
      select: { id: true; firstName: true; lastName: true; roleTitle: true; venue: true };
    };
  };
}>;

type StaffHrDocumentTemplateRow = Prisma.StaffHrDocumentTemplateGetPayload<Record<string, never>>;

function toStaffHrRecord(row: StaffHrRecordRow): StaffHrRecord {
  return {
    id: row.id,
    staffProfileId: row.staffProfileId,
    recordType: row.recordType as StaffHrRecord['recordType'],
    title: row.title,
    status: row.status as StaffHrRecord['status'],
    issueDate: dateToIso(row.issueDate),
    effectiveDate: dateToIso(row.effectiveDate),
    expiryDate: dateToIso(row.expiryDate),
    followUpDate: dateToIso(row.followUpDate),
    reason: row.reason,
    oldRateCents: row.oldRateCents,
    newRateCents: row.newRateCents,
    documentName: row.documentName,
    documentUrl: row.documentUrl,
    notes: row.notes,
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    staffProfile: row.staffProfile
  };
}

function templateVariables(value: Prisma.JsonValue): string[] {
  return z.array(staffHrDocumentTemplateVariableSchema).catch([]).parse(value);
}

function templateOptionalClauses(value: Prisma.JsonValue): StaffHrDocumentTemplate['optionalClauses'] {
  return z.array(staffHrDocumentTemplateOptionalClauseSchema).catch([]).parse(value);
}

function toStaffHrDocumentTemplate(row: StaffHrDocumentTemplateRow): StaffHrDocumentTemplate {
  return {
    id: row.id,
    name: row.name,
    recordType: row.recordType as StaffHrDocumentTemplate['recordType'],
    status: row.status as StaffHrDocumentTemplate['status'],
    body: row.body,
    variables: templateVariables(row.variables),
    optionalClauses: templateOptionalClauses(row.optionalClauses),
    createdById: row.createdById,
    updatedById: row.updatedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function assertStaffHrTemplateAdmin(actor: AuthUser) {
  if (!(actor.isAdmin || actor.role === 'ADMIN')) {
    throw new HttpError(403, 'HR templates are restricted to Alma admins.');
  }
}

const HR_TEMPLATE_SAMPLE_DATA: Record<string, string> = {
  dateOfLetter: '19 May 2026',
  employeeFirstName: 'Sample',
  employeeLastName: 'Employee',
  employeeFullName: 'Sample Employee',
  employeeAddress: 'Employee address',
  employerName: 'Alma Group',
  employerEntity: 'Alma Group entity',
  positionTitle: 'Team Member',
  employmentType: 'Casual',
  startDate: 'Start date',
  awardName: 'Hospitality Industry Award',
  classification: 'Classification',
  primaryLocation: 'Primary work location',
  hourlyRate: 'Hourly rate',
  baseRate: 'Base rate',
  casualLoading: 'Casual loading',
  payFrequency: 'Pay frequency',
  superannuationFund: 'Superannuation fund',
  managerName: 'Manager name',
  employerSignatureName: 'Employer signature name',
  employerJobTitle: 'Employer job title',
  additionalEntitlements: 'Additional entitlements',
  companyProperty: 'Company property',
  rightToDisconnectExamples: 'Right to disconnect examples',
  additionalBenefits: 'Additional benefits',
  venueName: 'Venue name',
  venueAddress: 'Venue address'
};

function renderHrTemplate(body: string, sampleData: Record<string, string>) {
  const unresolved = new Set<string>();
  const renderedBody = body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (match, variable: string) => {
    const value = sampleData[variable];
    if (!value) {
      unresolved.add(variable);
      return match;
    }
    return value;
  });
  return { renderedBody, unresolvedVariables: Array.from(unresolved).sort() };
}

function scopeVenueForActor(requestedVenue: string | undefined, actor?: AuthUser) {
  const venue = requestedVenue?.trim() || '';
  if (!actor || actor.isAdmin || actor.role === 'ADMIN') {
    return venue || undefined;
  }
  if (actor.role === 'STAFF') {
    return actor.venue || undefined;
  }
  if (!actor.venue) {
    throw new HttpError(403, 'Manager venue access is not configured.');
  }
  if (venue && venue !== actor.venue) {
    throw new HttpError(403, 'Managers cannot access another venue.');
  }
  return actor.venue;
}

async function assertActorCanAccessRosterShift(shiftId: string, actor: AuthUser) {
  const shift = await prisma.rosterShift.findUnique({
    where: { id: shiftId },
    include: {
      staffProfile: {
        select: { id: true, venue: true, firstName: true, lastName: true, roleTitle: true, employmentStatus: true }
      },
      shiftConfirmations: {
        orderBy: [{ confirmedAt: 'desc' }],
        take: 1
      }
    }
  });

  if (!shift) throw new HttpError(404, 'Roster shift not found');
  if (actor.isAdmin || actor.role === 'ADMIN') return shift;
  if (actor.role === 'STAFF') {
    if (shift.staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only access your own shifts.');
    }
    return shift;
  }
  const shiftVenue = shift.venue || shift.staffProfile?.venue || null;
  if (!actor.venue || shiftVenue !== actor.venue) {
    throw new HttpError(403, 'Roster access is limited to your venue.');
  }
  return shift;
}

async function assertActorCanAccessTimesheet(id: string, actor: AuthUser) {
  const entry = await prisma.timesheet.findUnique({
    where: { id },
    include: {
      staffProfile: {
        select: { id: true, venue: true, firstName: true, lastName: true, roleTitle: true, email: true }
      }
    }
  });
  if (!entry) throw new HttpError(404, 'Timesheet not found');
  if (actor.isAdmin || actor.role === 'ADMIN') return entry;
  if (actor.role === 'STAFF') {
    if (entry.staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only access your own timesheets.');
    }
    return entry;
  }
  const venue = entry.venue || entry.staffProfile?.venue || null;
  if (!actor.venue || venue !== actor.venue) {
    throw new HttpError(403, 'Timesheet access is limited to your venue.');
  }
  return entry;
}

async function assertActorCanAccessClockSession(id: string, actor: AuthUser) {
  const session = await prisma.staffClockSession.findUnique({
    where: { id },
    include: {
      staffProfile: {
        select: { id: true, venue: true, firstName: true, lastName: true, roleTitle: true }
      },
      rosterShift: {
        include: {
          staffProfile: {
            select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
          },
          shiftConfirmations: { orderBy: [{ confirmedAt: 'desc' }], take: 1 }
        }
      },
      events: { orderBy: [{ occurredAt: 'asc' }] }
    }
  });
  if (!session) throw new HttpError(404, 'Clock session not found');
  if (actor.isAdmin || actor.role === 'ADMIN') return session;
  if (actor.role === 'STAFF') {
    if (session.staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only access your own clock sessions.');
    }
    return session;
  }
  const venue = session.venue || session.staffProfile?.venue || session.rosterShift?.venue || session.rosterShift?.staffProfile?.venue || null;
  if (!actor.venue || venue !== actor.venue) {
    throw new HttpError(403, 'Clocking access is limited to your venue.');
  }
  return session;
}

function staffProfileScope(actor?: AuthUser): Prisma.StaffProfileWhereInput {
  const where: Prisma.StaffProfileWhereInput = {
    employmentStatus: { not: 'ARCHIVED' },
    accountType: 'HUMAN'
  };

  if (actor && !actor.isAdmin && actor.role !== 'ADMIN') {
    if (actor.role === 'STAFF') {
      where.id = actor.id;
    } else if (actor.venue) {
      where.venue = actor.venue;
    } else {
      where.id = '__no_manager_venue__';
    }
  }

  return where;
}

function actorName(actor: AuthUser) {
  return `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim() || actor.email || actor.roleTitle || 'Unknown manager';
}

function hasLegacyPaySetup(profile: {
  payRateCents?: number | null;
  payAward?: string | null;
  payType?: string | null;
}) {
  return Boolean(profile.payRateCents || profile.payAward || profile.payType);
}

function buildDefaultPayProfile(staffProfileId: string, defaults: StaffDefaults = DEFAULT_STAFF_DEFAULTS) {
  const award = getAwardRateSet(defaults.defaultAwardCode);
  const classification = getAwardClassification(defaults.defaultAwardCode, defaults.defaultAwardClassification);
  if (!award || !classification) return null;
  return {
    id: null,
    staffProfileId,
    awardCode: award.awardCode,
    awardName: award.awardName,
    awardClassification: classification.id,
    employmentType: defaults.defaultEmploymentType,
    payMode: 'AWARD',
    awardRateSource: award.sourceLabel,
    awardRateEffectiveFrom: award.rateEffectiveFrom,
    payGuidePublishedAt: award.payGuidePublishedAt,
    rateSetVersion: award.rateSetVersion,
    ordinaryHourlyRateCents: classification.ordinaryHourlyRateCents,
    casualLoadedHourlyRateCents: classification.casualLoadedHourlyRateCents,
    manualFullTimePayAmountCents: null,
    manualFullTimePayFrequency: null,
    manualFullTimePayNote: null,
    payUpdatedAt: null,
    payUpdatedByUserId: null,
    createdAt: null,
    updatedAt: null,
    isDefaulted: true,
    sourceUrl: award.sourceUrl
  };
}

function defaultPayProfileCreateData(actorId?: string, defaults: StaffDefaults = DEFAULT_STAFF_DEFAULTS) {
  const award = getAwardRateSet(defaults.defaultAwardCode);
  const classification = getAwardClassification(defaults.defaultAwardCode, defaults.defaultAwardClassification);
  if (!award || !classification) return undefined;
  return {
    awardCode: award.awardCode,
    awardName: award.awardName,
    awardClassification: classification.id,
    employmentType: defaults.defaultEmploymentType,
    payMode: 'AWARD',
    awardRateSource: award.sourceLabel,
    awardRateEffectiveFrom: new Date(`${award.rateEffectiveFrom}T00:00:00.000Z`),
    payGuidePublishedAt: new Date(`${award.payGuidePublishedAt}T00:00:00.000Z`),
    rateSetVersion: award.rateSetVersion,
    ordinaryHourlyRateCents: classification.ordinaryHourlyRateCents,
    casualLoadedHourlyRateCents: classification.casualLoadedHourlyRateCents,
    manualFullTimePayAmountCents: null,
    manualFullTimePayFrequency: null,
    manualFullTimePayNote: null,
    payUpdatedByUserId: actorId ?? null
  };
}

function defaultStaffAppAccessCreateData(defaults: StaffDefaults = DEFAULT_STAFF_DEFAULTS) {
  const managerPermissions = {
    staffView: true,
    rosterView: true,
    rosterManage: true,
    timesheetsApprove: true,
    chatTeam: true,
    chatDirect: true
  };
  const staffPermissions = {
    staffSelfView: true,
    timesheetsSubmit: true,
    tipsViewOwn: true,
    chatTeam: true
  };

  return {
    appId: 'STAFF' as const,
    status: 'ENABLED' as const,
    role: defaults.defaultStaffAppRole,
    permissions: defaults.defaultStaffAppRole === 'MANAGER' ? managerPermissions : staffPermissions,
    notes: 'Created from Staff Settings defaults.'
  };
}

function dateOnlyUtc(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function employmentTypeLabel(value: string) {
  switch (value) {
    case 'CASUAL':
      return 'Casual';
    case 'PART_TIME':
      return 'Part-time';
    case 'FULL_TIME':
      return 'Full-time';
    default:
      return value;
  }
}

function payTypeForProfile(input: {
  employmentType: string;
  payMode: string;
  manualFullTimePayFrequency?: string | null;
}) {
  if (input.employmentType === 'FULL_TIME' && input.payMode === 'MANUAL_FULL_TIME') {
    return input.manualFullTimePayFrequency === 'ANNUAL_SALARY' ? 'Salary' : 'Hourly';
  }
  return 'Hourly';
}

function payRateForProfile(input: {
  employmentType: string;
  payMode: string;
  ordinaryHourlyRateCents: number;
  casualLoadedHourlyRateCents?: number | null;
  manualFullTimePayAmountCents?: number | null;
  manualFullTimePayFrequency?: string | null;
}) {
  if (input.employmentType === 'FULL_TIME' && input.payMode === 'MANUAL_FULL_TIME') {
    return input.manualFullTimePayFrequency === 'HOURLY_FULL_TIME'
      ? input.manualFullTimePayAmountCents ?? null
      : null;
  }
  if (input.employmentType === 'CASUAL') {
    return input.casualLoadedHourlyRateCents ?? input.ordinaryHourlyRateCents;
  }
  return input.ordinaryHourlyRateCents;
}

function attachDefaultPayProfile<T extends {
  id: string;
  payRateCents?: number | null;
  payAward?: string | null;
  payType?: string | null;
  payProfile?: unknown | null;
}>(profile: T, defaults: StaffDefaults = DEFAULT_STAFF_DEFAULTS): T {
  if (profile.payProfile || hasLegacyPaySetup(profile)) return profile;
  return {
    ...profile,
    payProfile: buildDefaultPayProfile(profile.id, defaults)
  };
}

async function recordStaffManagementEvent(input: {
  staffProfileId: string;
  eventType: string;
  summary: string;
  actor?: AuthUser;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.staffManagementEvent.create({
    data: {
      staffProfileId: input.staffProfileId,
      eventType: input.eventType,
      summary: input.summary,
      metadata: input.metadata ?? {},
      createdById: input.actor?.id ?? null,
      createdByName: input.actor ? actorName(input.actor) : null,
      createdByEmail: input.actor?.email ?? null
    }
  });
}

const staffLeaveQuerySchema = z.object({
  start: z.string().optional().or(z.literal('')),
  end: z.string().optional().or(z.literal('')),
  status: z.enum(['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED']).optional().or(z.literal('')),
  type: z.enum(['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID', 'OTHER']).optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  staffProfileId: z.string().optional().or(z.literal(''))
});

function leaveDateOnly(value: string, label: string) {
  const raw = value.slice(0, 10);
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, `${label} is invalid.`);
  }
  return date;
}

function leaveDateRange(startDate: string, endDate: string) {
  const start = leaveDateOnly(startDate, 'Leave start date');
  const end = leaveDateOnly(endDate, 'Leave end date');
  if (end < start) {
    throw new HttpError(400, 'Leave end date must be on or after the start date.');
  }
  return { start, end };
}

function formatLeaveDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function staffName(profile: { firstName: string; lastName: string }) {
  return `${profile.firstName} ${profile.lastName}`.trim();
}

function toStaffLeaveRequest(row: Prisma.StaffLeaveRequestGetPayload<{
  include: {
    staffProfile: {
      select: { id: true; firstName: true; lastName: true; roleTitle: true; venue: true };
    };
  };
}>) {
  return {
    id: row.id,
    staffProfileId: row.staffProfileId,
    type: row.type as StaffLeaveType,
    status: row.status as StaffLeaveStatus,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    notes: row.notes,
    managerNote: row.managerNote,
    requestedByUserId: row.requestedByUserId,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    staffProfile: row.staffProfile
  };
}

function toStaffShiftConfirmation(row: {
  id: string;
  rosterShiftId: string;
  staffProfileId: string;
  note: string | null;
  confirmedAt: Date;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
} | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    rosterShiftId: row.rosterShiftId,
    staffProfileId: row.staffProfileId,
    note: row.note,
    confirmedAt: row.confirmedAt.toISOString(),
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toRosterShiftPayload(row: {
  id: string;
  staffProfileId: string;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  startsAt: Date;
  endsAt: Date;
  breakMinutes: number;
  status: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  staffProfile?: { id: string; firstName: string; lastName: string; roleTitle: string; venue: string | null; employmentStatus: string } | null;
  shiftConfirmations?: Array<{
    id: string;
    rosterShiftId: string;
    staffProfileId: string;
    note: string | null;
    confirmedAt: Date;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: row.id,
    staffProfileId: row.staffProfileId,
    venue: row.venue,
    area: row.area,
    roleTitle: row.roleTitle,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    breakMinutes: row.breakMinutes,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    staffProfile: row.staffProfile ?? undefined,
    confirmation: toStaffShiftConfirmation(row.shiftConfirmations?.[0])
  };
}

function toClockEventPayload(row: {
  id: string;
  sessionId: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  eventType: string;
  occurredAt: Date;
  createdById: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    staffProfileId: row.staffProfileId,
    rosterShiftId: row.rosterShiftId,
    venue: row.venue,
    eventType: row.eventType,
    occurredAt: row.occurredAt.toISOString(),
    createdById: row.createdById,
    metadata: (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString()
  };
}

function toClockSessionPayload(row: {
  id: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  clockInAt: Date;
  clockOutAt: Date | null;
  status: string;
  currentBreakStartedAt: Date | null;
  accumulatedBreakMinutes: number;
  managerNote: string | null;
  reviewedAt: Date | null;
  reviewedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  events?: Array<{
    id: string;
    sessionId: string;
    staffProfileId: string;
    rosterShiftId: string | null;
    venue: string | null;
    eventType: string;
    occurredAt: Date;
    createdById: string | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
  }>;
  rosterShift?: {
    id: string;
    staffProfileId: string;
    venue: string | null;
    area: string | null;
    roleTitle: string | null;
    startsAt: Date;
    endsAt: Date;
    breakMinutes: number;
    status: string;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
    staffProfile?: { id: string; firstName: string; lastName: string; roleTitle: string; venue: string | null; employmentStatus: string } | null;
    shiftConfirmations?: Array<{
      id: string;
      rosterShiftId: string;
      staffProfileId: string;
      note: string | null;
      confirmedAt: Date;
      createdById: string | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
  } | null;
}) {
  return {
    id: row.id,
    staffProfileId: row.staffProfileId,
    rosterShiftId: row.rosterShiftId,
    venue: row.venue,
    area: row.area,
    roleTitle: row.roleTitle,
    clockInAt: row.clockInAt.toISOString(),
    clockOutAt: row.clockOutAt?.toISOString() ?? null,
    status: row.status,
    currentBreakStartedAt: row.currentBreakStartedAt?.toISOString() ?? null,
    accumulatedBreakMinutes: row.accumulatedBreakMinutes,
    managerNote: row.managerNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    reviewedById: row.reviewedById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    events: row.events?.map(toClockEventPayload),
    rosterShift: row.rosterShift ? toRosterShiftPayload(row.rosterShift) : null
  };
}

function liveTimesheetHours(entry: { clockInAt: Date; clockOutAt: Date; breakMinutes: number; status: string }, now: Date) {
  const effectiveOut = entry.status === 'DRAFT' && now > entry.clockInAt ? now : entry.clockOutAt;
  if (effectiveOut <= entry.clockInAt) return 0;
  return Math.max(0, (effectiveOut.getTime() - entry.clockInAt.getTime()) / 36e5 - entry.breakMinutes / 60);
}

function shiftHours(entry: { startsAt: Date; endsAt: Date; breakMinutes: number }) {
  if (entry.endsAt <= entry.startsAt) return 0;
  return Math.max(0, (entry.endsAt.getTime() - entry.startsAt.getTime()) / 36e5 - entry.breakMinutes / 60);
}

function sameDayUtc(left: Date, right: Date) {
  return left.getUTCFullYear() === right.getUTCFullYear() &&
    left.getUTCMonth() === right.getUTCMonth() &&
    left.getUTCDate() === right.getUTCDate();
}

function sessionBreakMinutes(session: { currentBreakStartedAt: Date | null; accumulatedBreakMinutes: number }, now = new Date()) {
  if (!session.currentBreakStartedAt) return session.accumulatedBreakMinutes;
  return session.accumulatedBreakMinutes + Math.max(0, Math.round((now.getTime() - session.currentBreakStartedAt.getTime()) / 60000));
}

function openSessionDurationMinutes(session: { clockInAt: Date; clockOutAt: Date | null }, now = new Date()) {
  const end = session.clockOutAt ?? now;
  return Math.max(0, Math.round((end.getTime() - session.clockInAt.getTime()) / 60000));
}

function shiftConfirmationFor(
  confirmations: Array<{
    id: string;
    rosterShiftId: string;
    staffProfileId: string;
    note: string | null;
    confirmedAt: Date;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
) {
  return toStaffShiftConfirmation(confirmations[0]);
}

function lateThreshold(shiftStart: Date) {
  return new Date(shiftStart.getTime() + 10 * 60 * 1000);
}

function staffRateCents(profile: { payRateCents: number | null; trainingPayRateCents: number | null } | null | undefined) {
  return profile?.trainingPayRateCents ?? profile?.payRateCents ?? 0;
}

function csvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toXeroCsv(rows: Array<Record<string, unknown>>) {
  const headers = [
    'Staff Name',
    'Email',
    'Xero Employee ID',
    'Xero Earnings Rate ID',
    'Work Date',
    'Start Time',
    'End Time',
    'Break Minutes',
    'Hours',
    'Venue',
    'Area',
    'Role',
    'Payment Method',
    'Notes',
    'Timesheet ID'
  ];
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

function toTipsCsv(rows: Array<Record<string, unknown>>) {
  const headers = [
    'Staff Name',
    'Venue',
    'Role',
    'Approved Hours',
    'Tips Amount',
    'Payment Method',
    'Staff Profile ID'
  ];
  return [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
}

function centsToMoney(cents: number) {
  return (cents / 100).toFixed(2);
}

type TipEntitlementRow = {
  staffProfileId: string;
  name: string;
  roleTitle: string | null;
  venue: string | null;
  approvedHours: number;
  amountCents: number;
  paymentMethod: 'CASH';
};

function applyTipAdjustments(rows: TipEntitlementRow[], input: unknown) {
  const { adjustments } = tipsPayoutInputSchema.parse(input);
  const byStaff = new Map(adjustments.map((adjustment) => [adjustment.staffProfileId, adjustment]));
  return rows.map((row) => {
    const adjustment = byStaff.get(row.staffProfileId);
    const excluded = adjustment?.excluded ?? false;
    const adjustmentCents = excluded ? -row.amountCents : adjustment?.adjustmentCents ?? 0;
    return {
      ...row,
      baseAmountCents: row.amountCents,
      adjustmentCents,
      finalAmountCents: Math.max(0, row.amountCents + adjustmentCents),
      excluded,
      notes: adjustment?.notes?.trim() || null
    };
  });
}

function tipImportKey(input: {
  source: string;
  venue: string;
  serviceDate: Date;
  amountCents: number;
  externalId?: string | null;
  importKey?: string | null;
}) {
  const source = input.source.trim().toLowerCase();
  const venue = input.venue.trim().toLowerCase();
  const day = input.serviceDate.toISOString().slice(0, 10);
  const external = input.externalId?.trim() || `${day}:${input.amountCents}`;
  return (input.importKey?.trim() || `${source}:${venue}:${external}`).slice(0, 240);
}

export const staffService = {
  listAwardRates() {
    return AWARD_RATE_SETS;
  },

  async list(actor?: AuthUser) {
    const staffDefaults = await getStaffDefaults();
    const profiles = await prisma.staffProfile.findMany({
      where: staffProfileScope(actor),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
        payProfile: true,
        appAccess: {
          orderBy: [{ appId: 'asc' }]
        },
        records: {
          orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }]
        },
        rosterShifts: {
          where: {
            startsAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            }
          },
          orderBy: [{ startsAt: 'asc' }]
        },
        trainingRecords: {
          include: { module: true },
          orderBy: [{ updatedAt: 'desc' }]
        }
      }
    });
    return profiles.map((profile) => withoutStaffSecrets(attachDefaultPayProfile(profile, staffDefaults)));
  },

  async getById(id: string, actor?: AuthUser) {
    if (actor && actor.role !== 'STAFF') {
      await assertManagerCanAccessStaffProfile(id, actor);
    }

    const profile = await prisma.staffProfile.findUnique({
      where: { id },
      include: {
        payProfile: true,
        appAccess: {
          orderBy: [{ appId: 'asc' }]
        },
        records: {
          orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }]
        },
        rosterShifts: {
          orderBy: [{ startsAt: 'asc' }]
        },
        trainingRecords: {
          include: { module: true },
          orderBy: [{ updatedAt: 'desc' }]
        }
      }
    });

    if (!profile) {
      throw new HttpError(404, 'Staff profile not found');
    }

    return withoutStaffSecrets(attachDefaultPayProfile(profile, await getStaffDefaults()));
  },

  async create(input: unknown, actor?: AuthUser) {
    const data = staffProfileCreateInputSchema.parse(input);
    const staffDefaults = await getStaffDefaults();
    const email = normaliseEmail(data.email);
    const targetVenue = data.venue || staffDefaults.defaultVenue || (actor && !actor.isAdmin && actor.role !== 'ADMIN' ? actor.venue ?? '' : '');

    if (
      actor &&
      !actor.isAdmin &&
      actor.role !== 'ADMIN' &&
      (!actor.venue || targetVenue !== actor.venue)
    ) {
      throw new HttpError(403, 'Managers cannot create staff profiles outside their venue.');
    }

    if (email) {
      const existing = await prisma.staffProfile.findUnique({ where: { email } });
      if (existing) {
        throw new HttpError(409, 'A staff profile already exists for that email');
      }
    }

    const profile = await prisma.staffProfile.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        roleTitle: data.roleTitle || staffDefaults.defaultRoleTitle,
        email,
        phone: data.phone || null,
        venue: targetVenue || null,
        employmentStatus: data.employmentStatus || 'ACTIVE',
        startDate: data.startDate ? new Date(data.startDate) : null,
        ...onboardingDetailCreateData(data),
        notes: data.notes || null,
        payProfile: !hasLegacyPaySetup(data)
          ? { create: defaultPayProfileCreateData(actor?.id, staffDefaults) }
          : undefined,
        appAccess: { create: defaultStaffAppAccessCreateData(staffDefaults) },
        records: data.records?.length
          ? {
              create: data.records.map((record) => ({
                recordType: record.recordType,
                title: record.title,
                issuer: record.issuer || null,
                certificateNumber: record.certificateNumber || null,
                issueDate: dateOrNull(record.issueDate),
                expiryDate: dateOrNull(record.expiryDate),
                status: record.status,
                documentName: record.documentName || null,
                documentUrl: record.documentUrl || null,
                notes: record.notes || null
              }))
            }
          : undefined
      },
      include: {
        records: {
          orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }]
        },
        appAccess: { orderBy: [{ appId: 'asc' }] },
        payProfile: true,
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] },
        trainingRecords: { include: { module: true }, orderBy: [{ updatedAt: 'desc' }] }
      }
    });
    return withoutStaffSecrets(attachDefaultPayProfile(profile, staffDefaults));
  },

  async update(id: string, input: unknown, actor?: AuthUser) {
    if (actor) await assertManagerCanAccessStaffProfile(id, actor);
    const existing = await this.getById(id);
    const data = staffProfileUpdateInputSchema.parse(input);
    const email =
      data.email !== undefined ? normaliseEmail(data.email) : existing.email;

    if (
      actor &&
      !actor.isAdmin &&
      actor.role !== 'ADMIN' &&
      data.venue !== undefined &&
      actor.venue &&
      data.venue &&
      data.venue !== actor.venue
    ) {
      throw new HttpError(403, 'Managers cannot move staff profiles outside their venue.');
    }

    if (email && email !== existing.email) {
      const conflict = await prisma.staffProfile.findUnique({ where: { email } });
      if (conflict) {
        throw new HttpError(409, 'A staff profile already exists for that email');
      }
    }

    const updated = await prisma.staffProfile.update({
      where: { id },
      data: {
        ...(data.firstName !== undefined && { firstName: data.firstName }),
        ...(data.lastName !== undefined && { lastName: data.lastName }),
        ...(data.roleTitle !== undefined && { roleTitle: data.roleTitle }),
        ...(data.email !== undefined && { email }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.venue !== undefined && { venue: data.venue || null }),
        ...(data.employmentStatus !== undefined && {
          employmentStatus: data.employmentStatus || 'ACTIVE'
        }),
        ...(data.startDate !== undefined && {
          startDate: data.startDate ? new Date(data.startDate) : null
        }),
        ...onboardingDetailUpdateData(data),
        ...(data.notes !== undefined && { notes: data.notes || null })
      },
      include: {
        payProfile: true,
        appAccess: { orderBy: [{ appId: 'asc' }] },
        records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] },
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] },
        trainingRecords: { include: { module: true }, orderBy: [{ updatedAt: 'desc' }] }
      }
    });

    if (actor && data.roleTitle !== undefined && data.roleTitle !== existing.roleTitle) {
      await recordStaffManagementEvent({
        staffProfileId: id,
        eventType: 'ROLE_UPDATED',
        summary: `Role changed from "${existing.roleTitle}" to "${data.roleTitle}".`,
        actor,
        metadata: { previousRoleTitle: existing.roleTitle, nextRoleTitle: data.roleTitle }
      });
    }

    return withoutStaffSecrets(attachDefaultPayProfile(updated));
  },

  async delete(id: string, actor?: AuthUser) {
    if (actor) await assertManagerCanAccessStaffProfile(id, actor);
    const existing = await this.getById(id);
    if (existing.isAdmin) {
      throw new HttpError(400, 'Admin staff profiles cannot be deleted');
    }

    const archived = await prisma.staffProfile.update({
      where: { id },
      data: {
        employmentStatus: 'ARCHIVED',
        notes: [existing.notes, `Archived ${new Date().toISOString()} during staff beta testing.`]
          .filter(Boolean)
          .join('\n')
      }
    });

    if (actor) {
      await recordStaffManagementEvent({
        staffProfileId: id,
        eventType: 'STAFF_ARCHIVED',
        summary: 'Staff profile archived.',
        actor
      });
    }

    return { id: archived.id, archived: true };
  },

  async listManagerNotes(staffProfileId: string, actor: AuthUser) {
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);

    return prisma.staffManagerNote.findMany({
      where: { staffProfileId },
      orderBy: [{ createdAt: 'desc' }]
    });
  },

  async listStaffManagementEvents(staffProfileId: string, actor: AuthUser) {
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);

    return prisma.staffManagementEvent.findMany({
      where: { staffProfileId },
      orderBy: [{ createdAt: 'desc' }],
      take: 50
    });
  },

  async listManagementEvents(input: unknown, actor: AuthUser) {
    const query = z.object({
      eventType: z.string().optional().or(z.literal('')),
      staffProfileId: z.string().optional().or(z.literal('')),
      take: z.coerce.number().int().min(1).max(100).optional()
    }).parse(input ?? {});

    if (query.staffProfileId) {
      await assertManagerCanAccessStaffProfile(query.staffProfileId, actor);
    }

    return prisma.staffManagementEvent.findMany({
      where: {
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(query.staffProfileId ? { staffProfileId: query.staffProfileId } : {}),
        staffProfile: staffProfileScope(actor)
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: [{ createdAt: 'desc' }],
      take: query.take ?? 50
    });
  },

  async listLeaveRequests(input: unknown, actor: AuthUser) {
    const query = staffLeaveQuerySchema.parse(input ?? {});
    if (query.staffProfileId) {
      await assertManagerCanAccessStaffProfile(query.staffProfileId, actor);
    }

    const where: Prisma.StaffLeaveRequestWhereInput = {
      staffProfile: staffProfileScope(actor)
    };

    if (query.staffProfileId) where.staffProfileId = query.staffProfileId;
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.venue && (actor.isAdmin || actor.role === 'ADMIN')) {
      where.staffProfile = { ...staffProfileScope(actor), venue: query.venue };
    }

    if (query.start || query.end) {
      const start = query.start ? leaveDateOnly(query.start, 'Leave calendar start') : new Date('1970-01-01T00:00:00.000Z');
      const end = query.end ? leaveDateOnly(query.end, 'Leave calendar end') : new Date('9999-12-31T00:00:00.000Z');
      where.startDate = { lte: end };
      where.endDate = { gte: start };
    }

    const rows = await prisma.staffLeaveRequest.findMany({
      where,
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: [{ startDate: 'asc' }, { createdAt: 'desc' }]
    });

    return rows.map(toStaffLeaveRequest);
  },

  async createLeaveRequest(input: unknown, actor: AuthUser) {
    const data = staffLeaveRequestInputSchema.parse(input);
    const { start, end } = leaveDateRange(data.startDate, data.endDate);
    const profile = await assertManagerCanAccessStaffProfile(data.staffProfileId, actor);
    const reviewed = ['APPROVED', 'DECLINED', 'CANCELLED'].includes(data.status);

    const row = await prisma.staffLeaveRequest.create({
      data: {
        staffProfileId: data.staffProfileId,
        type: data.type,
        status: data.status,
        startDate: start,
        endDate: end,
        notes: data.notes?.trim() || null,
        managerNote: data.managerNote?.trim() || null,
        requestedByUserId: actor.id,
        reviewedByUserId: reviewed ? actor.id : null,
        reviewedAt: reviewed ? new Date() : null
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });

    await recordStaffManagementEvent({
      staffProfileId: data.staffProfileId,
      eventType: 'STAFF_LEAVE_CREATED',
      summary: `Leave ${data.status.toLowerCase()} for ${formatLeaveDate(start)} to ${formatLeaveDate(end)}.`,
      actor,
      metadata: {
        leaveRequestId: row.id,
        type: data.type,
        status: data.status,
        startDate: formatLeaveDate(start),
        endDate: formatLeaveDate(end),
        venue: profile.venue
      }
    });

    return toStaffLeaveRequest(row);
  },

  async updateLeaveRequest(id: string, input: unknown, actor: AuthUser) {
    const existing = await prisma.staffLeaveRequest.findUnique({
      where: { id },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });
    if (!existing) throw new HttpError(404, 'Leave request not found.');
    await assertManagerCanAccessStaffProfile(existing.staffProfileId, actor);

    const data = staffLeaveRequestUpdateSchema.parse(input);
    const nextStaffProfileId = data.staffProfileId ?? existing.staffProfileId;
    if (nextStaffProfileId !== existing.staffProfileId) {
      await assertManagerCanAccessStaffProfile(nextStaffProfileId, actor);
    }

    const startInput = data.startDate ?? formatLeaveDate(existing.startDate);
    const endInput = data.endDate ?? formatLeaveDate(existing.endDate);
    const { start, end } = leaveDateRange(startInput, endInput);
    const nextStatus = data.status ?? existing.status;
    const statusChanged = nextStatus !== existing.status;
    const reviewed = statusChanged && ['APPROVED', 'DECLINED', 'CANCELLED'].includes(nextStatus);

    const row = await prisma.staffLeaveRequest.update({
      where: { id },
      data: {
        staffProfileId: nextStaffProfileId,
        ...(data.type !== undefined && { type: data.type }),
        status: nextStatus,
        startDate: start,
        endDate: end,
        ...(data.notes !== undefined && { notes: data.notes.trim() || null }),
        ...(data.managerNote !== undefined && { managerNote: data.managerNote.trim() || null }),
        ...(reviewed && { reviewedByUserId: actor.id, reviewedAt: new Date() }),
        ...(statusChanged && nextStatus === 'PENDING' && { reviewedByUserId: null, reviewedAt: null })
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });

    await recordStaffManagementEvent({
      staffProfileId: row.staffProfileId,
      eventType: statusChanged ? 'STAFF_LEAVE_STATUS_UPDATED' : 'STAFF_LEAVE_UPDATED',
      summary: statusChanged
        ? `Leave status changed from ${existing.status} to ${nextStatus}.`
        : `Leave updated for ${staffName(row.staffProfile)}.`,
      actor,
      metadata: {
        leaveRequestId: row.id,
        previousStatus: existing.status,
        nextStatus,
        type: row.type,
        startDate: formatLeaveDate(row.startDate),
        endDate: formatLeaveDate(row.endDate)
      }
    });

    return toStaffLeaveRequest(row);
  },

  async addManagerNote(staffProfileId: string, input: unknown, actor: AuthUser) {
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    const data = staffManagerNoteInputSchema.parse(input);
    const actorName = `${actor.firstName ?? ''} ${actor.lastName ?? ''}`.trim();

    return prisma.staffManagerNote.create({
      data: {
        staffProfileId,
        body: data.body,
        createdById: actor.id,
        createdByName: actorName || actor.email || 'Unknown manager',
        createdByEmail: actor.email || null
      }
    });
  },

  async requestPasswordReset(
    staffProfileId: string,
    input: unknown,
    actor: AuthUser,
    context: { requestOrigin?: string | null; requestIp?: string | null; userAgent?: string | null } = {}
  ) {
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    const data = staffPasswordResetRequestSchema.parse(input);
    const profile = await prisma.staffProfile.findUnique({
      where: { id: staffProfileId },
      select: { id: true, firstName: true, lastName: true, email: true }
    });

    if (!profile) throw new HttpError(404, 'Staff profile not found');

    const hasLoginEmail = Boolean(profile.email);
    const result = hasLoginEmail
      ? await authService.requestPasswordResetForEmail(profile.email!, {
          resetBaseUrl: data.resetBaseUrl || undefined,
          appName: data.appName || undefined,
          requestOrigin: context.requestOrigin,
          requestIp: context.requestIp,
          userAgent: context.userAgent,
          requestedBy: actor
        })
      : { accountExists: false, deliveryStatus: 'no_email' as const };

    await recordStaffManagementEvent({
      staffProfileId,
      eventType: 'PASSWORD_RESET_REQUESTED',
      summary: hasLoginEmail
        ? 'Password reset email requested.'
        : 'Password reset requested but no login email is linked to this profile.',
      actor,
      metadata: {
        targetEmail: profile.email,
        deliveryStatus: result.deliveryStatus,
        hasLoginAccount: result.accountExists
      }
    });

    return {
      ok: true,
      message: hasLoginEmail
        ? 'If this staff member has a login account, a reset link has been sent.'
        : 'No login email is linked to this profile.'
    };
  },

  async listHrDocumentTemplates(actor: AuthUser): Promise<StaffHrDocumentTemplate[]> {
    assertStaffHrTemplateAdmin(actor);
    const rows = await prisma.staffHrDocumentTemplate.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });
    return rows.map(toStaffHrDocumentTemplate);
  },

  async createHrDocumentTemplate(input: unknown, actor: AuthUser): Promise<StaffHrDocumentTemplate> {
    assertStaffHrTemplateAdmin(actor);
    const data = staffHrDocumentTemplateInputSchema.parse(input);
    const row = await prisma.staffHrDocumentTemplate.create({
      data: {
        name: data.name,
        recordType: data.recordType,
        status: data.status,
        body: data.body,
        variables: data.variables,
        optionalClauses: data.optionalClauses,
        createdById: actor.id,
        updatedById: actor.id
      }
    });
    return toStaffHrDocumentTemplate(row);
  },

  async updateHrDocumentTemplate(templateId: string, input: unknown, actor: AuthUser): Promise<StaffHrDocumentTemplate> {
    assertStaffHrTemplateAdmin(actor);
    const existing = await prisma.staffHrDocumentTemplate.findUnique({ where: { id: templateId } });
    if (!existing) throw new HttpError(404, 'HR template not found');
    const data = staffHrDocumentTemplateUpdateSchema.parse(input);
    const row = await prisma.staffHrDocumentTemplate.update({
      where: { id: templateId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.recordType !== undefined && { recordType: data.recordType }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.variables !== undefined && { variables: data.variables }),
        ...(data.optionalClauses !== undefined && { optionalClauses: data.optionalClauses }),
        updatedById: actor.id
      }
    });
    return toStaffHrDocumentTemplate(row);
  },

  async previewHrDocumentTemplate(templateId: string, input: unknown, actor: AuthUser): Promise<StaffHrDocumentTemplatePreview> {
    assertStaffHrTemplateAdmin(actor);
    const template = await prisma.staffHrDocumentTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new HttpError(404, 'HR template not found');
    const data = staffHrDocumentTemplatePreviewSchema.parse(input);
    const sampleData = { ...HR_TEMPLATE_SAMPLE_DATA, ...data.sampleData };
    const rendered = renderHrTemplate(template.body, sampleData);
    return {
      templateId: template.id,
      sampleData,
      ...rendered
    };
  },

  async listHrRecords(input: unknown, actor: AuthUser): Promise<StaffHrRecord[]> {
    await assertStaffHrAccess(actor);
    const query = staffHrRecordQuerySchema.parse(input);
    const requestedType = query.recordType || undefined;

    if (requestedType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { rightToWork: true });
    if (requestedType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { payChanges: true });

    const excludedTypes: string[] = [];
    if (!hasStaffHrAccess(actor, { rightToWork: true })) excludedTypes.push('RIGHT_TO_WORK');
    if (!hasStaffHrAccess(actor, { payChanges: true })) excludedTypes.push('PAY_CHANGE');

    const where: Prisma.StaffHrRecordWhereInput = {
      ...(query.staffProfileId && { staffProfileId: query.staffProfileId }),
      ...(requestedType ? { recordType: requestedType } : excludedTypes.length ? { recordType: { notIn: excludedTypes } } : {}),
      ...(query.status && { status: query.status })
    };

    const rows = await prisma.staffHrRecord.findMany({
      where,
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
    });

    return rows.map(toStaffHrRecord);
  },

  async listStaffHrRecords(staffProfileId: string, actor: AuthUser): Promise<StaffHrRecord[]> {
    await assertStaffHrAccess(actor);
    await assertActorCanAccessStaffProfile(staffProfileId, actor);
    return this.listHrRecords({ staffProfileId }, actor);
  },

  async createHrRecord(input: unknown, actor: AuthUser): Promise<StaffHrRecord> {
    await assertStaffHrAccess(actor, { manage: true });
    const data = staffHrRecordInputSchema.parse(input);
    if (data.recordType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { manage: true, rightToWork: true });
    if (data.recordType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { manage: true, payChanges: true });
    await assertActorCanAccessStaffProfile(data.staffProfileId, actor);
    validateStaffHrDocument(data.documentUrl);

    const row = await prisma.staffHrRecord.create({
      data: {
        staffProfileId: data.staffProfileId,
        recordType: data.recordType,
        title: data.title.trim(),
        status: data.status,
        issueDate: dateOrNull(data.issueDate),
        effectiveDate: dateOrNull(data.effectiveDate),
        expiryDate: dateOrNull(data.expiryDate),
        followUpDate: dateOrNull(data.followUpDate),
        reason: textOrNull(data.reason),
        oldRateCents: data.oldRateCents ?? null,
        newRateCents: data.newRateCents ?? null,
        documentName: textOrNull(data.documentName),
        documentUrl: textOrNull(data.documentUrl),
        notes: textOrNull(data.notes),
        createdById: actor.id,
        updatedById: actor.id
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });

    await recordStaffManagementEvent({
      staffProfileId: row.staffProfileId,
      eventType: 'STAFF_HR_RECORD_CREATED',
      summary: `HR record created: ${row.title}.`,
      actor,
      metadata: { hrRecordId: row.id, recordType: row.recordType, status: row.status }
    });

    return toStaffHrRecord(row);
  },

  async updateHrRecord(recordId: string, input: unknown, actor: AuthUser): Promise<StaffHrRecord> {
    await assertStaffHrAccess(actor, { manage: true });
    const existing = await prisma.staffHrRecord.findUnique({ where: { id: recordId } });
    if (!existing) throw new HttpError(404, 'HR record not found');
    if (existing.recordType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { manage: true, rightToWork: true });
    if (existing.recordType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { manage: true, payChanges: true });
    await assertActorCanAccessStaffProfile(existing.staffProfileId, actor);

    const data = staffHrRecordUpdateSchema.parse(input);
    validateStaffHrDocument(data.documentUrl);

    const row = await prisma.staffHrRecord.update({
      where: { id: recordId },
      data: {
        ...(data.title !== undefined && { title: data.title.trim() }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.issueDate !== undefined && { issueDate: dateOrNull(data.issueDate) }),
        ...(data.effectiveDate !== undefined && { effectiveDate: dateOrNull(data.effectiveDate) }),
        ...(data.expiryDate !== undefined && { expiryDate: dateOrNull(data.expiryDate) }),
        ...(data.followUpDate !== undefined && { followUpDate: dateOrNull(data.followUpDate) }),
        ...(data.reason !== undefined && { reason: textOrNull(data.reason) }),
        ...(data.oldRateCents !== undefined && { oldRateCents: data.oldRateCents ?? null }),
        ...(data.newRateCents !== undefined && { newRateCents: data.newRateCents ?? null }),
        ...(data.documentName !== undefined && { documentName: textOrNull(data.documentName) }),
        ...(data.documentUrl !== undefined && { documentUrl: textOrNull(data.documentUrl) }),
        ...(data.notes !== undefined && { notes: textOrNull(data.notes) }),
        updatedById: actor.id
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });

    await recordStaffManagementEvent({
      staffProfileId: row.staffProfileId,
      eventType: 'STAFF_HR_RECORD_UPDATED',
      summary: `HR record updated: ${row.title}.`,
      actor,
      metadata: { hrRecordId: row.id, recordType: row.recordType, status: row.status }
    });

    return toStaffHrRecord(row);
  },

  async attachHrDocument(staffProfileId: string, recordId: string, input: unknown, actor: AuthUser): Promise<StaffHrRecord> {
    await assertStaffHrAccess(actor, { manage: true });
    await assertActorCanAccessStaffProfile(staffProfileId, actor);
    const existing = await prisma.staffHrRecord.findFirst({ where: { id: recordId, staffProfileId } });
    if (!existing) throw new HttpError(404, 'HR record not found');
    if (existing.recordType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { manage: true, rightToWork: true });
    if (existing.recordType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { manage: true, payChanges: true });
    const data = staffHrDocumentInputSchema.parse(input);
    validateStaffHrDocument(data.documentUrl);

    return this.updateHrRecord(recordId, {
      documentName: data.documentName,
      documentUrl: data.documentUrl,
      status: data.status ?? 'STORED'
    }, actor);
  },

  async removeHrDocument(staffProfileId: string, recordId: string, actor: AuthUser): Promise<StaffHrRecord> {
    await assertStaffHrAccess(actor, { manage: true });
    await assertActorCanAccessStaffProfile(staffProfileId, actor);
    const existing = await prisma.staffHrRecord.findFirst({ where: { id: recordId, staffProfileId } });
    if (!existing) throw new HttpError(404, 'HR record not found');
    if (existing.recordType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { manage: true, rightToWork: true });
    if (existing.recordType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { manage: true, payChanges: true });
    return this.updateHrRecord(recordId, { documentName: '', documentUrl: '' }, actor);
  },

  async requestHrDocument(staffProfileId: string, recordId: string, actor: AuthUser): Promise<StaffHrRecord> {
    await assertStaffHrAccess(actor, { manage: true });
    await assertActorCanAccessStaffProfile(staffProfileId, actor);
    const existing = await prisma.staffHrRecord.findFirst({ where: { id: recordId, staffProfileId } });
    if (!existing) throw new HttpError(404, 'HR record not found');
    if (existing.recordType === 'RIGHT_TO_WORK') await assertStaffHrAccess(actor, { manage: true, rightToWork: true });
    if (existing.recordType === 'PAY_CHANGE') await assertStaffHrAccess(actor, { manage: true, payChanges: true });
    return this.updateHrRecord(recordId, { status: 'RE_REQUESTED', documentName: '', documentUrl: '' }, actor);
  },

  async addRecord(staffProfileId: string, input: unknown, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const data = staffComplianceRecordInputSchema.parse(input);
    validateStaffRecordAttachmentOnCreate(data.documentUrl);

    return prisma.staffComplianceRecord.create({
      data: {
        staffProfileId,
        recordType: data.recordType,
        title: data.title,
        issuer: data.issuer || null,
        certificateNumber: data.certificateNumber || null,
        issueDate: dateOrNull(data.issueDate),
        expiryDate: dateOrNull(data.expiryDate),
        status: data.status,
        documentName: data.documentName || null,
        documentUrl: data.documentUrl || null,
        notes: data.notes || null
      }
    });
  },

  async attachRecordDocument(staffProfileId: string, recordId: string, input: unknown, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const record = await prisma.staffComplianceRecord.findFirst({
      where: { id: recordId, staffProfileId }
    });

    if (!record) {
      throw new HttpError(404, 'Staff document not found');
    }

    const data = staffRecordAttachmentInputSchema.parse(input);

    const updated = await prisma.staffComplianceRecord.update({
      where: { id: recordId },
      data: {
        status: 'PENDING',
        documentName: data.documentName,
        documentUrl: data.documentUrl
      }
    });

    if (actor) {
      await recordStaffManagementEvent({
        staffProfileId,
        eventType: 'COMPLIANCE_DOCUMENT_ATTACHED',
        summary: `Document attached to "${record.title}".`,
        actor,
        metadata: {
          recordId,
          recordTitle: record.title,
          documentName: data.documentName
        }
      });
    }

    return updated;
  },

  async deleteRecord(staffProfileId: string, recordId: string, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const record = await prisma.staffComplianceRecord.findFirst({
      where: { id: recordId, staffProfileId }
    });

    if (!record) {
      throw new HttpError(404, 'Staff document not found');
    }

    await prisma.staffComplianceRecord.delete({ where: { id: recordId } });
    return { id: recordId, deleted: true };
  },

  async removeRecordDocument(staffProfileId: string, recordId: string, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const record = await prisma.staffComplianceRecord.findFirst({
      where: { id: recordId, staffProfileId }
    });

    if (!record) {
      throw new HttpError(404, 'Staff document not found');
    }

    return prisma.staffComplianceRecord.update({
      where: { id: recordId },
      data: {
        documentName: null,
        documentUrl: null,
        status: 'PENDING',
        notes: appendRecordNote(record.notes, `Document removed ${new Date().toISOString()}.`)
      }
    });
  },

  async requestRecordDocument(staffProfileId: string, recordId: string, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const record = await prisma.staffComplianceRecord.findFirst({
      where: { id: recordId, staffProfileId }
    });

    if (!record) {
      throw new HttpError(404, 'Staff document not found');
    }

    return prisma.staffComplianceRecord.update({
      where: { id: recordId },
      data: {
        documentName: null,
        documentUrl: null,
        status: 'PENDING',
        notes: appendRecordNote(
          record.notes,
          `Document requested again ${new Date().toISOString()}. Marked for follow-up; ask the staff member to upload again.`
        )
      }
    });
  },

  async updateAppAccess(staffProfileId: string, input: unknown, actor?: AuthUser) {
    if (actor) await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    await this.getById(staffProfileId);
    const data = staffAppAccessInputSchema.parse(input);

    await prisma.$transaction(
      data.apps.map((app) =>
        prisma.staffAppAccess.upsert({
          where: {
            staffProfileId_appId: {
              staffProfileId,
              appId: app.appId
            }
          },
          update: {
            status: app.status,
            role: app.role,
            permissions: app.permissions,
            notes: app.notes || null
          },
          create: {
            staffProfileId,
            appId: app.appId,
            status: app.status,
            role: app.role,
            permissions: app.permissions,
            notes: app.notes || null
          }
        })
      )
    );

    if (actor) {
      await recordStaffManagementEvent({
        staffProfileId,
        eventType: 'APP_ACCESS_UPDATED',
        summary: 'Staff app access updated.',
        actor,
        metadata: {
          apps: data.apps.map((app) => ({
            appId: app.appId,
            status: app.status,
            role: app.role
          }))
        }
      });
    }

    return this.getById(staffProfileId);
  },

  async updatePayProfile(staffProfileId: string, input: unknown, actor: AuthUser) {
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    const data = staffPayProfileInputSchema.parse(input);
    const award = getAwardRateSet(data.awardCode);
    const classification = getAwardClassification(data.awardCode, data.awardClassification);

    if (!award) throw new HttpError(400, 'Award code is not supported.');
    if (!classification) {
      throw new HttpError(400, 'Classification is not available for the selected award.');
    }

    const payMode = data.employmentType === 'FULL_TIME' ? 'MANUAL_FULL_TIME' : 'AWARD';
    const manualFullTimePayAmountCents =
      payMode === 'MANUAL_FULL_TIME' ? data.manualFullTimePayAmountCents ?? null : null;
    const manualFullTimePayFrequency =
      payMode === 'MANUAL_FULL_TIME' ? data.manualFullTimePayFrequency ?? null : null;
    const manualFullTimePayNote =
      payMode === 'MANUAL_FULL_TIME' ? data.manualFullTimePayNote?.trim() || null : null;

    const profilePayRateCents = payRateForProfile({
      employmentType: data.employmentType,
      payMode,
      ordinaryHourlyRateCents: classification.ordinaryHourlyRateCents,
      casualLoadedHourlyRateCents: classification.casualLoadedHourlyRateCents,
      manualFullTimePayAmountCents,
      manualFullTimePayFrequency
    });

    await prisma.$transaction(async (tx) => {
      await tx.staffPayProfile.upsert({
        where: { staffProfileId },
        create: {
          staffProfileId,
          awardCode: award.awardCode,
          awardName: award.awardName,
          awardClassification: classification.id,
          employmentType: data.employmentType,
          payMode,
          awardRateSource: award.sourceLabel,
          awardRateEffectiveFrom: dateOnlyUtc(award.rateEffectiveFrom),
          payGuidePublishedAt: dateOnlyUtc(award.payGuidePublishedAt),
          rateSetVersion: award.rateSetVersion,
          ordinaryHourlyRateCents: classification.ordinaryHourlyRateCents,
          casualLoadedHourlyRateCents: classification.casualLoadedHourlyRateCents,
          manualFullTimePayAmountCents,
          manualFullTimePayFrequency,
          manualFullTimePayNote,
          payUpdatedAt: new Date(),
          payUpdatedByUserId: actor.id
        },
        update: {
          awardCode: award.awardCode,
          awardName: award.awardName,
          awardClassification: classification.id,
          employmentType: data.employmentType,
          payMode,
          awardRateSource: award.sourceLabel,
          awardRateEffectiveFrom: dateOnlyUtc(award.rateEffectiveFrom),
          payGuidePublishedAt: dateOnlyUtc(award.payGuidePublishedAt),
          rateSetVersion: award.rateSetVersion,
          ordinaryHourlyRateCents: classification.ordinaryHourlyRateCents,
          casualLoadedHourlyRateCents: classification.casualLoadedHourlyRateCents,
          manualFullTimePayAmountCents,
          manualFullTimePayFrequency,
          manualFullTimePayNote,
          payUpdatedAt: new Date(),
          payUpdatedByUserId: actor.id
        }
      });

      await tx.staffProfile.update({
        where: { id: staffProfileId },
        data: {
          employmentType: employmentTypeLabel(data.employmentType),
          payType: payTypeForProfile({
            employmentType: data.employmentType,
            payMode,
            manualFullTimePayFrequency
          }),
          payRateCents: profilePayRateCents,
          payAward: `${award.awardName} [${award.awardCode}] - ${classification.label}`
        }
      });

      await tx.staffManagementEvent.create({
        data: {
          staffProfileId,
          eventType: 'PAY_SETUP_UPDATED',
          summary: `Award pay setup updated to ${award.awardName} [${award.awardCode}], ${classification.label}.`,
          metadata: {
            awardCode: award.awardCode,
            awardClassification: classification.id,
            employmentType: data.employmentType,
            payMode,
            rateSetVersion: award.rateSetVersion,
            manualFullTimePayFrequency,
            hasManualFullTimePay: manualFullTimePayAmountCents !== null
          },
          createdById: actor.id,
          createdByName: actorName(actor),
          createdByEmail: actor.email || null
        }
      });
    });

    return this.getById(staffProfileId);
  },

  async mergeDuplicateStaff(input: unknown, actor: AuthUser) {
    const data = staffMergeInputSchema.parse(input);
    const allIds = [data.canonicalStaffProfileId, ...data.duplicateStaffProfileIds];
    if (new Set(allIds).size < 2) {
      throw new HttpError(400, 'Choose at least two different staff profiles to merge.');
    }

    for (const staffProfileId of allIds) {
      await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    }

    const profiles = await prisma.staffProfile.findMany({
      where: { id: { in: allIds } },
      include: {
        appAccess: true,
        trainingRecords: true,
        payProfile: true,
        records: { select: { id: true } },
        managerNotes: { select: { id: true } },
        rosterShifts: { select: { id: true } },
        timesheets: { select: { id: true } },
        tipPaymentRunLines: { select: { id: true } }
      }
    });

    if (profiles.length !== allIds.length) {
      throw new HttpError(404, 'One or more selected staff profiles could not be found.');
    }

    const canonical = profiles.find((profile) => profile.id === data.canonicalStaffProfileId);
    if (!canonical) throw new HttpError(404, 'Profile to keep was not found.');
    if (canonical.employmentStatus === 'ARCHIVED') {
      throw new HttpError(400, 'Choose an active staff profile to keep.');
    }

    const duplicates = profiles.filter((profile) => data.duplicateStaffProfileIds.includes(profile.id));
    if (duplicates.some((profile) => profile.isAdmin)) {
      throw new HttpError(400, 'Admin staff profiles cannot be merged as duplicates.');
    }

    const summary = await prisma.$transaction(async (tx) => {
      const targetAccess = await tx.staffAppAccess.findMany({
        where: { staffProfileId: canonical.id },
        select: { appId: true }
      });
      const targetAccessApps = new Set(targetAccess.map((access) => access.appId));

      const targetTraining = await tx.staffTrainingRecord.findMany({
        where: { staffProfileId: canonical.id },
        select: { moduleId: true }
      });
      const targetTrainingModules = new Set(targetTraining.map((record) => record.moduleId));
      let targetHasPayProfile = Boolean(canonical.payProfile);

      const moved = {
        complianceRecords: 0,
        managerNotes: 0,
        appAccess: 0,
        trainingRecords: 0,
        payProfile: 0
      };
      const preserved = {
        appAccessConflicts: 0,
        trainingConflicts: 0,
        rosterShifts: 0,
        timesheets: 0,
        tipPaymentLines: 0,
        staffInvites: 0
      };

      for (const duplicate of duplicates) {
        moved.complianceRecords += duplicate.records.length;
        await tx.staffComplianceRecord.updateMany({
          where: { staffProfileId: duplicate.id },
          data: { staffProfileId: canonical.id }
        });

        moved.managerNotes += duplicate.managerNotes.length;
        await tx.staffManagerNote.updateMany({
          where: { staffProfileId: duplicate.id },
          data: { staffProfileId: canonical.id }
        });

        for (const access of duplicate.appAccess) {
          if (targetAccessApps.has(access.appId)) {
            preserved.appAccessConflicts += 1;
            continue;
          }
          await tx.staffAppAccess.update({
            where: { id: access.id },
            data: { staffProfileId: canonical.id }
          });
          targetAccessApps.add(access.appId);
          moved.appAccess += 1;
        }

        for (const record of duplicate.trainingRecords) {
          if (targetTrainingModules.has(record.moduleId)) {
            preserved.trainingConflicts += 1;
            continue;
          }
          await tx.staffTrainingRecord.update({
            where: { id: record.id },
            data: { staffProfileId: canonical.id }
          });
          targetTrainingModules.add(record.moduleId);
          moved.trainingRecords += 1;
        }

        if (!targetHasPayProfile && duplicate.payProfile) {
          await tx.staffPayProfile.update({
            where: { id: duplicate.payProfile.id },
            data: { staffProfileId: canonical.id }
          });
          targetHasPayProfile = true;
          moved.payProfile += 1;
        }

        preserved.rosterShifts += duplicate.rosterShifts.length;
        preserved.timesheets += duplicate.timesheets.length;
        preserved.tipPaymentLines += duplicate.tipPaymentRunLines.length;
        preserved.staffInvites += await tx.staffInvite.count({
          where: { staffProfileId: duplicate.id }
        });

        await tx.staffProfile.update({
          where: { id: duplicate.id },
          data: {
            employmentStatus: 'ARCHIVED',
            mergedIntoStaffProfileId: canonical.id,
            mergedAt: new Date(),
            mergedByUserId: actor.id,
            notes: [
              duplicate.notes,
              `Merged into ${canonical.firstName} ${canonical.lastName} (${canonical.id}) on ${new Date().toISOString()}. Roster, timesheet, tip payment and onboarding invite history remains attached to this archived duplicate for audit history.`
            ].filter(Boolean).join('\n')
          }
        });

        await tx.staffManagementEvent.create({
          data: {
            staffProfileId: duplicate.id,
            eventType: 'STAFF_DUPLICATE_ARCHIVED',
            summary: `Duplicate staff profile archived and linked to ${canonical.firstName} ${canonical.lastName}.`,
            metadata: { canonicalStaffProfileId: canonical.id },
            createdById: actor.id,
            createdByName: actorName(actor),
            createdByEmail: actor.email || null
          }
        });
      }

      await tx.staffManagementEvent.create({
        data: {
          staffProfileId: canonical.id,
          eventType: 'STAFF_DUPLICATES_MERGED',
          summary: `${duplicates.length} duplicate staff profile${duplicates.length === 1 ? '' : 's'} merged into this profile.`,
          metadata: {
            duplicateStaffProfileIds: duplicates.map((profile) => profile.id),
            moved,
            preserved
          },
          createdById: actor.id,
          createdByName: actorName(actor),
          createdByEmail: actor.email || null
        }
      });

      return {
        duplicateStaffProfileIds: duplicates.map((profile) => profile.id),
        moved,
        preserved
      };
    });

    return {
      canonicalStaffProfile: await this.getById(canonical.id),
      ...summary
    };
  },

  async listRoster(
    start?: string,
    end?: string,
    staffProfileId?: string,
    actor?: AuthUser,
    options?: { includeConfirmations?: boolean }
  ) {
    const now = new Date();
    const startDate = start ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    if (actor?.role === 'STAFF' && staffProfileId && staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only view your own roster.');
    }

    if (actor && actor.role !== 'STAFF' && staffProfileId) {
      await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    }

    const scopedVenue = scopeVenueForActor(undefined, actor);

    const rows = await prisma.rosterShift.findMany({
      where: {
        startsAt: { lt: endDate },
        endsAt: { gt: startDate },
        ...(staffProfileId ? { staffProfileId } : actor?.role === 'STAFF' ? { staffProfileId: actor.id } : {}),
        ...(scopedVenue ? { OR: [{ venue: scopedVenue }, { venue: null, staffProfile: { venue: scopedVenue } }] } : {})
      },
      orderBy: [{ startsAt: 'asc' }],
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        },
        ...(options?.includeConfirmations
          ? {
              shiftConfirmations: {
                where: actor?.role === 'STAFF' ? { staffProfileId: actor.id } : undefined,
                orderBy: [{ confirmedAt: 'desc' }],
                take: 1
              }
            }
          : {})
      }
    });

    return options?.includeConfirmations ? rows.map((row) => toRosterShiftPayload(row)) : rows;
  },

  async createRosterShift(input: unknown, actor?: AuthUser) {
    const data = rosterShiftInputSchema.parse(input);
    const profile = actor ? await assertManagerCanAccessStaffProfile(data.staffProfileId, actor) : await this.getById(data.staffProfileId);
    const targetVenue = data.venue || profile.venue || null;

    if (actor && !actor.isAdmin && actor.role !== 'ADMIN' && actor.venue && targetVenue && targetVenue !== actor.venue) {
      throw new HttpError(403, 'Managers cannot create roster shifts outside their venue.');
    }

    const startsAt = new Date(data.startsAt);
    const endsAt = new Date(data.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new HttpError(400, 'Roster shift dates are invalid');
    }
    if (endsAt <= startsAt) {
      throw new HttpError(400, 'Roster shift must end after it starts');
    }

    return prisma.rosterShift.create({
      data: {
        staffProfileId: data.staffProfileId,
        venue: targetVenue,
        area: data.area || null,
        roleTitle: data.roleTitle || null,
        startsAt,
        endsAt,
        breakMinutes: data.breakMinutes,
        status: data.status,
        notes: data.notes || null
      },
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        }
      }
    });
  },

  async updateRosterShift(id: string, input: unknown, actor?: AuthUser) {
    const data = rosterShiftUpdateInputSchema.parse(input);
    const existing = actor
      ? await assertActorCanAccessRosterShift(id, actor)
      : await prisma.rosterShift.findUnique({
          where: { id },
          include: {
            staffProfile: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                roleTitle: true,
                venue: true,
                employmentStatus: true
              }
            },
            shiftConfirmations: {
              orderBy: [{ confirmedAt: 'desc' }],
              take: 1
            }
          }
        });
    if (!existing) throw new HttpError(404, 'Roster shift not found');

    if (data.staffProfileId) {
      if (actor) {
        await assertManagerCanAccessStaffProfile(data.staffProfileId, actor);
      } else {
        await this.getById(data.staffProfileId);
      }
    }

    const startsAt = data.startsAt !== undefined ? new Date(data.startsAt) : undefined;
    const endsAt = data.endsAt !== undefined ? new Date(data.endsAt) : undefined;
    if (
      (startsAt && Number.isNaN(startsAt.getTime())) ||
      (endsAt && Number.isNaN(endsAt.getTime()))
    ) {
      throw new HttpError(400, 'Roster shift dates are invalid');
    }
    const effectiveStart = startsAt ?? existing.startsAt;
    const effectiveEnd = endsAt ?? existing.endsAt;
    if (effectiveEnd <= effectiveStart) {
      throw new HttpError(400, 'Roster shift must end after it starts');
    }
    const targetVenue = data.venue !== undefined ? (data.venue || null) : existing.venue || existing.staffProfile?.venue || null;
    if (actor && !actor.isAdmin && actor.role !== 'ADMIN' && actor.venue && targetVenue && targetVenue !== actor.venue) {
      throw new HttpError(403, 'Managers cannot move shifts outside their venue.');
    }

    return prisma.rosterShift.update({
      where: { id },
      data: {
        ...(data.staffProfileId !== undefined && { staffProfileId: data.staffProfileId }),
        ...(data.venue !== undefined && { venue: targetVenue }),
        ...(data.area !== undefined && { area: data.area || null }),
        ...(data.roleTitle !== undefined && { roleTitle: data.roleTitle || null }),
        ...(startsAt !== undefined && { startsAt }),
        ...(endsAt !== undefined && { endsAt }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.notes !== undefined && { notes: data.notes || null })
      },
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            employmentStatus: true
          }
        }
      }
    });
  },

  async deleteRosterShift(id: string, actor?: AuthUser) {
    const existing = actor ? await assertActorCanAccessRosterShift(id, actor) : await prisma.rosterShift.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Roster shift not found');
    await prisma.rosterShift.delete({ where: { id } });
  },

  async publishRoster(input: unknown, publishedById?: string, actor?: AuthUser) {
    const data = rosterPublishInputSchema.parse(input);
    const startDate = new Date(data.start);
    const endDate = new Date(data.end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new HttpError(400, 'Roster publish dates are invalid');
    }
    if (endDate <= startDate) {
      throw new HttpError(400, 'Roster publish end date must be after the start date');
    }
    const scopedVenue = scopeVenueForActor(data.venue || undefined, actor);

    await prisma.rosterShift.updateMany({
      where: {
        status: 'DRAFT',
        startsAt: { lt: endDate },
        endsAt: { gt: startDate },
        ...(scopedVenue ? { venue: scopedVenue } : {})
      },
      data: { status: 'PUBLISHED' }
    });

    if (data.forecast) {
      await prisma.rosterForecastSnapshot.deleteMany({
        where: {
          weekStart: startDate,
          weekEnd: endDate,
          venue: scopedVenue || null
        }
      });
      await prisma.rosterForecastSnapshot.create({
        data: {
          weekStart: startDate,
          weekEnd: endDate,
          venue: scopedVenue || null,
          source: data.forecast.source || null,
          targetWagePercent: data.forecast.targetWagePercent,
          forecastSalesCents: data.forecast.forecastSalesCents,
          wageBudgetCents: data.forecast.wageBudgetCents,
          rosterCostCents: data.forecast.rosterCostCents,
          plannedHours: data.forecast.plannedHours,
          recommendedHours: data.forecast.recommendedHours,
          dailySalesCents: data.forecast.dailySalesCents,
          venueBreakdown: data.forecast.venueBreakdown,
          areaBreakdown: data.forecast.areaBreakdown,
          publishedById: publishedById || null
        }
      });
    }

    return this.listRoster(startDate.toISOString(), endDate.toISOString(), undefined, actor);
  },

  async listRosterForecastSnapshots(input: { start?: string; end?: string; venue?: string }, actor?: AuthUser) {
    const startDate = input.start ? parseDate(input.start, 'Roster forecast start date') : undefined;
    const endDate = input.end ? parseDate(input.end, 'Roster forecast end date') : undefined;
    const scopedVenue = scopeVenueForActor(input.venue, actor);
    const snapshots = await prisma.rosterForecastSnapshot.findMany({
      where: {
        ...(startDate && endDate
          ? {
              weekStart: { gte: startDate },
              weekEnd: { lte: endDate }
            }
          : {}),
        ...(scopedVenue ? { venue: scopedVenue } : {})
      },
      orderBy: [{ weekStart: 'desc' }, { venue: 'asc' }]
    });
    return snapshots.map((snapshot) => ({
      ...snapshot,
      weekStart: snapshot.weekStart.toISOString(),
      weekEnd: snapshot.weekEnd.toISOString(),
      createdAt: snapshot.createdAt.toISOString(),
      updatedAt: snapshot.updatedAt.toISOString()
    }));
  },

  async getManagerDashboard(input: unknown, actor?: AuthUser) {
    const data = managerDashboardQuerySchema.parse(input);
    const venue = scopeVenueForActor(data.venue?.trim(), actor) ?? '';
    const { start, end, key } = dayRange(data.date);
    const now = new Date();
    const activeIssueStatuses = ['OPEN', 'IN_PROGRESS', 'BLOCKED'] as const;

    const [
      salesEntries,
      wageTimesheets,
      pendingTimesheets,
      pendingTimesheetCount,
      rosterShifts,
      stockItems,
      openIssues,
      openIssueCount,
      criticalIssueCount
    ] = await Promise.all([
      prisma.salesActualEntry.findMany({
        where: {
          serviceDate: { gte: start, lt: end },
          ...(venue ? { venue } : {})
        },
        orderBy: [{ venue: 'asc' }, { source: 'asc' }]
      }),
      prisma.timesheet.findMany({
        where: {
          workDate: { gte: start, lt: end },
          status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPORTED'] },
          ...(venue ? { venue } : {})
        },
        include: {
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              roleTitle: true,
              venue: true,
              email: true,
              payRateCents: true,
              trainingPayRateCents: true
            }
          }
        }
      }),
      prisma.timesheet.findMany({
        where: {
          status: 'SUBMITTED',
          ...(venue ? { venue } : {})
        },
        orderBy: [{ workDate: 'desc' }, { clockInAt: 'asc' }],
        take: 8,
        include: {
          staffProfile: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              roleTitle: true,
              venue: true,
              email: true
            }
          }
        }
      }),
      prisma.timesheet.count({
        where: {
          status: 'SUBMITTED',
          ...(venue ? { venue } : {})
        }
      }),
      prisma.rosterShift.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: { not: 'CANCELLED' },
          ...(venue ? { venue } : {})
        },
        include: {
          staffProfile: {
            select: {
              payRateCents: true,
              trainingPayRateCents: true
            }
          }
        }
      }),
      prisma.stockItem.findMany({
        where: { status: 'ACTIVE' },
        include: { category: { select: { name: true } } },
        orderBy: [{ name: 'asc' }]
      }),
      prisma.issue.findMany({
        where: { status: { in: [...activeIssueStatuses] } },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
        take: 12
      }),
      prisma.issue.count({ where: { status: { in: [...activeIssueStatuses] } } }),
      prisma.issue.count({ where: { severity: 'CRITICAL', status: { in: [...activeIssueStatuses] } } })
    ]);

    const salesByVenue = Array.from(
      salesEntries.reduce((map, entry) => {
        map.set(entry.venue, (map.get(entry.venue) ?? 0) + entry.salesCents);
        return map;
      }, new Map<string, number>())
    ).map(([entryVenue, salesCents]) => ({ venue: entryVenue, salesCents }));

    const wagesByVenueMap = new Map<string, {
      venue: string;
      actualWageCents: number;
      rosterWageCents: number;
      actualHours: number;
      rosterHours: number;
    }>();

    for (const entry of wageTimesheets) {
      const entryVenue = entry.venue || entry.staffProfile.venue || 'Unassigned';
      const current = wagesByVenueMap.get(entryVenue) ?? {
        venue: entryVenue,
        actualWageCents: 0,
        rosterWageCents: 0,
        actualHours: 0,
        rosterHours: 0
      };
      const hours = liveTimesheetHours(entry, now);
      current.actualHours += hours;
      current.actualWageCents += Math.round(hours * staffRateCents(entry.staffProfile));
      wagesByVenueMap.set(entryVenue, current);
    }

    for (const shift of rosterShifts) {
      const shiftVenue = shift.venue || 'Unassigned';
      const current = wagesByVenueMap.get(shiftVenue) ?? {
        venue: shiftVenue,
        actualWageCents: 0,
        rosterWageCents: 0,
        actualHours: 0,
        rosterHours: 0
      };
      const hours = shiftHours(shift);
      current.rosterHours += hours;
      current.rosterWageCents += Math.round(hours * staffRateCents(shift.staffProfile));
      wagesByVenueMap.set(shiftVenue, current);
    }

    const lowStock = stockItems
      .filter((item) => {
        const threshold = item.reorderPoint ?? item.parLevel;
        return threshold > 0 && item.onHand <= threshold;
      })
      .sort((a, b) => {
        const aThreshold = a.reorderPoint ?? a.parLevel;
        const bThreshold = b.reorderPoint ?? b.parLevel;
        return (a.onHand - aThreshold) - (b.onHand - bThreshold);
      })
      .slice(0, 8)
      .map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
        onHand: item.onHand,
        parLevel: item.parLevel,
        reorderPoint: item.reorderPoint,
        categoryName: item.category?.name ?? null
      }));

    const issueSeverityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
    const complianceIssues = openIssues
      .sort((a, b) => issueSeverityRank[a.severity] - issueSeverityRank[b.severity])
      .slice(0, 8)
      .map((issue) => ({
        id: issue.id,
        title: issue.title,
        severity: issue.severity,
        status: issue.status,
        category: issue.category,
        assignee: issue.assignee,
        dueDate: issue.dueDate?.toISOString() ?? null,
        createdAt: issue.createdAt.toISOString()
      }));

    const wagesByVenue = Array.from(wagesByVenueMap.values()).sort((a, b) => a.venue.localeCompare(b.venue));
    const actualWageCents = wagesByVenue.reduce((sum, row) => sum + row.actualWageCents, 0);
    const rosterWageCents = wagesByVenue.reduce((sum, row) => sum + row.rosterWageCents, 0);
    const salesCents = salesEntries.reduce((sum, entry) => sum + entry.salesCents, 0);

    return {
      date: key,
      venue,
      generatedAt: now.toISOString(),
      totals: {
        salesCents,
        actualWageCents,
        rosterWageCents,
        actualHours: Math.round(wagesByVenue.reduce((sum, row) => sum + row.actualHours, 0) * 100) / 100,
        rosterHours: Math.round(wagesByVenue.reduce((sum, row) => sum + row.rosterHours, 0) * 100) / 100,
        wagePercent: salesCents > 0 ? Math.round((actualWageCents / salesCents) * 1000) / 10 : null,
        pendingTimesheets: pendingTimesheetCount,
        lowStockItems: stockItems.filter((item) => {
          const threshold = item.reorderPoint ?? item.parLevel;
          return threshold > 0 && item.onHand <= threshold;
        }).length,
        openIssues: openIssueCount,
        criticalIssues: criticalIssueCount
      },
      salesByVenue,
      wagesByVenue: wagesByVenue.map((row) => ({
        ...row,
        actualHours: Math.round(row.actualHours * 100) / 100,
        rosterHours: Math.round(row.rosterHours * 100) / 100
      })),
      pendingTimesheets: pendingTimesheets.map((entry) => ({
        ...entry,
        workDate: entry.workDate.toISOString(),
        clockInAt: entry.clockInAt.toISOString(),
        clockOutAt: entry.clockOutAt.toISOString(),
        submittedAt: entry.submittedAt?.toISOString() ?? null,
        approvedAt: entry.approvedAt?.toISOString() ?? null,
        rejectedAt: entry.rejectedAt?.toISOString() ?? null,
        cashPaidAt: entry.cashPaidAt?.toISOString() ?? null,
        exportedAt: entry.exportedAt?.toISOString() ?? null,
        createdAt: entry.createdAt.toISOString(),
        updatedAt: entry.updatedAt.toISOString()
      })),
      lowStock,
      complianceIssues
    };
  },

  async getMyRoster(actor: AuthUser, input?: { start?: string; end?: string }) {
    const shifts = await this.listRoster(input?.start, input?.end, actor.id, actor, { includeConfirmations: true }) as Array<ReturnType<typeof toRosterShiftPayload>>;
    const now = new Date();
    return {
      shifts,
      upcomingCount: shifts.filter((shift) => new Date(shift.endsAt) >= now && shift.status !== 'CANCELLED').length,
      pastCount: shifts.filter((shift) => new Date(shift.endsAt) < now).length,
      pendingConfirmationCount: shifts.filter((shift) => shift.status === 'PUBLISHED' && !shift.confirmation && new Date(shift.endsAt) >= now).length
    };
  },

  async confirmMyShift(shiftId: string, input: unknown, actor: AuthUser) {
    const data = staffShiftConfirmationInputSchema.parse(input ?? {});
    const shift = await assertActorCanAccessRosterShift(shiftId, actor);
    if (shift.staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only confirm your own shifts.');
    }
    if (shift.status === 'CANCELLED') {
      throw new HttpError(400, 'Cancelled shifts cannot be confirmed.');
    }

    const confirmedAt = new Date();
    const confirmation = await prisma.staffShiftConfirmation.upsert({
      where: {
        rosterShiftId_staffProfileId: {
          rosterShiftId: shift.id,
          staffProfileId: actor.id
        }
      },
      create: {
        rosterShiftId: shift.id,
        staffProfileId: actor.id,
        note: data.note?.trim() || null,
        confirmedAt,
        createdById: actor.id
      },
      update: {
        note: data.note?.trim() || null,
        confirmedAt,
        createdById: actor.id
      }
    });

    return toStaffShiftConfirmation(confirmation);
  },

  async listMyLeaveRequests(actor: AuthUser) {
    const rows = await prisma.staffLeaveRequest.findMany({
      where: { staffProfileId: actor.id },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }]
    });
    return rows.map(toStaffLeaveRequest);
  },

  async createMyLeaveRequest(input: unknown, actor: AuthUser) {
    const data = staffOwnLeaveRequestInputSchema.parse(input);
    const { start, end } = leaveDateRange(data.startDate, data.endDate);
    const row = await prisma.staffLeaveRequest.create({
      data: {
        staffProfileId: actor.id,
        type: data.type,
        status: 'PENDING',
        startDate: start,
        endDate: end,
        notes: data.notes?.trim() || null,
        managerNote: null,
        requestedByUserId: actor.id
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      }
    });

    await recordStaffManagementEvent({
      staffProfileId: actor.id,
      eventType: 'STAFF_LEAVE_REQUESTED',
      summary: `Leave requested for ${formatLeaveDate(start)} to ${formatLeaveDate(end)}.`,
      actor,
      metadata: { type: data.type, startDate: formatLeaveDate(start), endDate: formatLeaveDate(end) }
    });

    return toStaffLeaveRequest(row);
  },

  async getMyClockStatus(actor: AuthUser) {
    const today = new Date();
    const rosterStart = new Date(today.getTime() - 12 * 60 * 60 * 1000);
    const rosterEnd = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
    const roster = await this.listRoster(
      rosterStart.toISOString(),
      rosterEnd.toISOString(),
      actor.id,
      actor,
      { includeConfirmations: true }
    ) as Array<ReturnType<typeof toRosterShiftPayload>>;

    const recentSessions = await prisma.staffClockSession.findMany({
      where: { staffProfileId: actor.id },
      include: {
        events: { orderBy: [{ occurredAt: 'asc' }] },
        rosterShift: {
          include: {
            staffProfile: {
              select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
            },
            shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
          }
        }
      },
      orderBy: [{ clockInAt: 'desc' }],
      take: 10
    });

    const activeSession = recentSessions.find((session) => session.status === 'OPEN' && !session.clockOutAt) ?? null;
    const upcomingShifts = roster
      .filter((shift) => shift.status !== 'CANCELLED')
      .filter((shift) => new Date(shift.endsAt) >= today)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    const currentShift =
      upcomingShifts.find((shift) => {
        const start = new Date(shift.startsAt).getTime() - 2 * 60 * 60 * 1000;
        const end = new Date(shift.endsAt).getTime() + 6 * 60 * 60 * 1000;
        const now = Date.now();
        return now >= start && now <= end;
      }) ?? null;

    return {
      activeSession: activeSession ? toClockSessionPayload(activeSession) : null,
      currentShift,
      nextShift: upcomingShifts[0] ?? null,
      recentSessions: recentSessions.map(toClockSessionPayload)
    };
  },

  async clockIn(actor: AuthUser, input: unknown) {
    const data = staffClockInInputSchema.parse(input ?? {});
    const existingOpen = await prisma.staffClockSession.findFirst({
      where: { staffProfileId: actor.id, status: 'OPEN', clockOutAt: null },
      orderBy: [{ clockInAt: 'desc' }]
    });
    if (existingOpen) {
      throw new HttpError(400, 'You already have an open clock session.');
    }

    const profile = await assertActorCanAccessStaffProfile(actor.id, actor);
    const shift = data.rosterShiftId ? await assertActorCanAccessRosterShift(data.rosterShiftId, actor) : null;
    if (shift && shift.staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only clock into your own shift.');
    }

    const clockInAt = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const session = await tx.staffClockSession.create({
        data: {
          staffProfileId: actor.id,
          rosterShiftId: shift?.id ?? null,
          venue: shift?.venue || shift?.staffProfile?.venue || profile.venue || actor.venue || null,
          area: shift?.area || null,
          roleTitle: shift?.roleTitle || shift?.staffProfile?.roleTitle || actor.roleTitle || null,
          clockInAt,
          status: 'OPEN'
        }
      });
      await tx.staffClockEvent.create({
        data: {
          sessionId: session.id,
          staffProfileId: actor.id,
          rosterShiftId: shift?.id ?? null,
          venue: session.venue,
          eventType: 'CLOCK_IN',
          occurredAt: clockInAt,
          createdById: actor.id,
          metadata: {}
        }
      });
      return tx.staffClockSession.findUniqueOrThrow({
        where: { id: session.id },
        include: {
          events: { orderBy: [{ occurredAt: 'asc' }] },
          rosterShift: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
              },
              shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
            }
          }
        }
      });
    });

    return toClockSessionPayload(created);
  },

  async clockOut(actor: AuthUser, input: unknown) {
    const data = staffClockOutInputSchema.parse(input ?? {});
    const existing = await prisma.staffClockSession.findFirst({
      where: { staffProfileId: actor.id, status: 'OPEN', clockOutAt: null },
      include: {
        events: { orderBy: [{ occurredAt: 'asc' }] },
        rosterShift: {
          include: {
            staffProfile: {
              select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
            },
            shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
          }
        }
      },
      orderBy: [{ clockInAt: 'desc' }]
    });
    if (!existing) {
      throw new HttpError(400, 'No active clock session found.');
    }

    const clockOutAt = new Date();
    const breakMinutes = sessionBreakMinutes(existing, clockOutAt);
    const updated = await prisma.$transaction(async (tx) => {
      const session = await tx.staffClockSession.update({
        where: { id: existing.id },
        data: {
          clockOutAt,
          status: 'CLOSED',
          currentBreakStartedAt: null,
          accumulatedBreakMinutes: breakMinutes,
          managerNote: data.note?.trim() || existing.managerNote || null
        }
      });
      await tx.staffClockEvent.create({
        data: {
          sessionId: existing.id,
          staffProfileId: actor.id,
          rosterShiftId: existing.rosterShiftId,
          venue: existing.venue,
          eventType: 'CLOCK_OUT',
          occurredAt: clockOutAt,
          createdById: actor.id,
          metadata: existing.currentBreakStartedAt ? { breakClosedOnClockOut: true } : {}
        }
      });
      return tx.staffClockSession.findUniqueOrThrow({
        where: { id: session.id },
        include: {
          events: { orderBy: [{ occurredAt: 'asc' }] },
          rosterShift: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
              },
              shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
            }
          }
        }
      });
    });

    return toClockSessionPayload(updated);
  },

  async startBreak(actor: AuthUser, input: unknown) {
    staffClockBreakInputSchema.parse(input ?? {});
    const existing = await prisma.staffClockSession.findFirst({
      where: { staffProfileId: actor.id, status: 'OPEN', clockOutAt: null },
      orderBy: [{ clockInAt: 'desc' }]
    });
    if (!existing) {
      throw new HttpError(400, 'No active clock session found.');
    }
    if (existing.currentBreakStartedAt) {
      throw new HttpError(400, 'A break is already in progress.');
    }

    const occurredAt = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      await tx.staffClockSession.update({
        where: { id: existing.id },
        data: { currentBreakStartedAt: occurredAt }
      });
      await tx.staffClockEvent.create({
        data: {
          sessionId: existing.id,
          staffProfileId: actor.id,
          rosterShiftId: existing.rosterShiftId,
          venue: existing.venue,
          eventType: 'START_BREAK',
          occurredAt,
          createdById: actor.id,
          metadata: {}
        }
      });
      return tx.staffClockSession.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          events: { orderBy: [{ occurredAt: 'asc' }] },
          rosterShift: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
              },
              shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
            }
          }
        }
      });
    });
    return toClockSessionPayload(updated);
  },

  async endBreak(actor: AuthUser, input: unknown) {
    staffClockBreakInputSchema.parse(input ?? {});
    const existing = await prisma.staffClockSession.findFirst({
      where: { staffProfileId: actor.id, status: 'OPEN', clockOutAt: null },
      orderBy: [{ clockInAt: 'desc' }]
    });
    if (!existing) {
      throw new HttpError(400, 'No active clock session found.');
    }
    if (!existing.currentBreakStartedAt) {
      throw new HttpError(400, 'No active break found.');
    }

    const occurredAt = new Date();
    const breakMinutes = sessionBreakMinutes(existing, occurredAt);
    const updated = await prisma.$transaction(async (tx) => {
      await tx.staffClockSession.update({
        where: { id: existing.id },
        data: {
          currentBreakStartedAt: null,
          accumulatedBreakMinutes: breakMinutes
        }
      });
      await tx.staffClockEvent.create({
        data: {
          sessionId: existing.id,
          staffProfileId: actor.id,
          rosterShiftId: existing.rosterShiftId,
          venue: existing.venue,
          eventType: 'END_BREAK',
          occurredAt,
          createdById: actor.id,
          metadata: { breakMinutes }
        }
      });
      return tx.staffClockSession.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          events: { orderBy: [{ occurredAt: 'asc' }] },
          rosterShift: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
              },
              shiftConfirmations: { where: { staffProfileId: actor.id }, orderBy: [{ confirmedAt: 'desc' }], take: 1 }
            }
          }
        }
      });
    });
    return toClockSessionPayload(updated);
  },

  async getMyHome(actor: AuthUser) {
    const member = await this.getById(actor.id, actor);
    const clock = await this.getMyClockStatus(actor);
    const announcements = await communicationsService.list(
      { appId: 'STAFF', venue: member.venue ?? '', channel: 'general' },
      actor
    );
    const leave = await prisma.staffLeaveRequest.findMany({
      where: {
        staffProfileId: actor.id,
        endDate: { gte: new Date(new Date().getTime() - 24 * 60 * 60 * 1000) },
        status: { in: ['PENDING', 'APPROVED'] }
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
        }
      },
      orderBy: [{ startDate: 'asc' }],
      take: 6
    });
    const reminderCutoff = new Date();
    reminderCutoff.setDate(reminderCutoff.getDate() + 30);
    const complianceReminders = [
      ...member.records
        .filter((record) =>
          record.status === 'PENDING' ||
          record.status === 'EXPIRED' ||
          (record.expiryDate && new Date(record.expiryDate) <= reminderCutoff)
        )
        .map((record) => ({
          id: record.id,
          kind: 'RECORD' as const,
          title: record.title,
          detail: `${record.recordType} · ${record.status}`,
          dueAt: record.expiryDate,
          status: record.status
        })),
      ...member.trainingRecords
        .filter((record) => record.status !== 'COMPLETED')
        .map((record) => ({
          id: record.id,
          kind: 'TRAINING' as const,
          title: record.module?.title ?? 'Training module',
          detail: `${record.module?.category || 'Training'} · ${record.status.replace('_', ' ')}`,
          dueAt: record.expiresAt,
          status: record.status
        }))
    ]
      .sort((left, right) => {
        const leftAt = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const rightAt = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return leftAt - rightAt;
      })
      .slice(0, 8);

    return {
      member: member
        ? {
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            roleTitle: member.roleTitle,
            venue: member.venue
          }
        : null,
      todayShift: clock.currentShift,
      nextShift: clock.nextShift,
      clock,
      upcomingLeave: leave.map(toStaffLeaveRequest),
      complianceReminders,
      announcements: announcements.announcements
    };
  },

  async getManagerOperations(input: unknown, actor: AuthUser) {
    if (actor.role === 'STAFF' && !actor.isAdmin) {
      throw new HttpError(403, 'Manager access required');
    }

    const data = managerDashboardQuerySchema.parse(input);
    const venue = scopeVenueForActor(data.venue?.trim(), actor) ?? '';
    const { start, end, key } = dayRange(data.date);
    const pendingEnd = new Date(end.getTime() + 14 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const shiftVenueWhere = venue
      ? { OR: [{ venue }, { venue: null, staffProfile: { venue } }] }
      : {};
    const sessionVenueWhere = venue
      ? { OR: [{ venue }, { venue: null, staffProfile: { venue } }, { venue: null, rosterShift: { venue } }, { venue: null, rosterShift: { venue: null, staffProfile: { venue } } }] }
      : {};

    const [todaysShifts, relevantSessions, pendingConfirmations, todaysReservations] = await Promise.all([
      prisma.rosterShift.findMany({
        where: {
          startsAt: { lt: end },
          endsAt: { gt: start },
          status: { not: 'CANCELLED' },
          ...shiftVenueWhere
        },
        include: {
          staffProfile: {
            select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
          },
          shiftConfirmations: { orderBy: [{ confirmedAt: 'desc' }], take: 1 }
        },
        orderBy: [{ startsAt: 'asc' }]
      }),
      prisma.staffClockSession.findMany({
        where: {
          clockInAt: { lt: end },
          OR: [{ clockOutAt: null }, { clockOutAt: { gte: start } }],
          ...sessionVenueWhere
        },
        include: {
          staffProfile: {
            select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
          },
          events: { orderBy: [{ occurredAt: 'asc' }] },
          rosterShift: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
              },
              shiftConfirmations: { orderBy: [{ confirmedAt: 'desc' }], take: 1 }
            }
          }
        },
        orderBy: [{ clockInAt: 'desc' }]
      }),
      prisma.rosterShift.findMany({
        where: {
          startsAt: { gte: start, lt: pendingEnd },
          status: 'PUBLISHED',
          shiftConfirmations: { none: {} },
          ...shiftVenueWhere
        },
        include: {
          staffProfile: {
            select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, employmentStatus: true }
          },
          shiftConfirmations: { orderBy: [{ confirmedAt: 'desc' }], take: 1 }
        },
        orderBy: [{ startsAt: 'asc' }],
        take: 20
      }),
      prisma.reserveReservation.findMany({
        where: {
          startsAt: { gte: start, lt: end },
          ...(venue ? { venue } : {}),
          status: { in: ['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] }
        },
        select: {
          id: true,
          venue: true,
          startsAt: true,
          covers: true,
          guestName: true,
          status: true
        },
        orderBy: [{ startsAt: 'asc' }],
        take: 20
      })
    ]);

    const sessionByShiftId = new Map<string, typeof relevantSessions[number]>();
    const openSessions = relevantSessions.filter((session) => session.status === 'OPEN' && !session.clockOutAt);
    for (const session of relevantSessions) {
      if (session.rosterShiftId && !sessionByShiftId.has(session.rosterShiftId)) {
        sessionByShiftId.set(session.rosterShiftId, session);
      }
    }

    const todaysStaff = todaysShifts.map((shift) => {
      const session = sessionByShiftId.get(shift.id) ?? null;
      let state: 'SCHEDULED' | 'CLOCKED_IN' | 'ON_BREAK' | 'LATE' | 'MISSED' | 'CLOCKED_OUT' = 'SCHEDULED';
      if (session?.status === 'OPEN' && !session.clockOutAt) {
        state = session.currentBreakStartedAt ? 'ON_BREAK' : 'CLOCKED_IN';
      } else if (session?.clockOutAt) {
        state = 'CLOCKED_OUT';
      } else if (now >= shift.endsAt) {
        state = 'MISSED';
      } else if (now >= lateThreshold(shift.startsAt)) {
        state = 'LATE';
      }

      return {
        shift: toRosterShiftPayload(shift),
        staffProfile: shift.staffProfile,
        confirmation: shiftConfirmationFor(shift.shiftConfirmations),
        activeSession: session ? toClockSessionPayload(session) : null,
        state
      };
    });

    const clockExceptions: Array<{
      id: string;
      kind: 'OPEN_SESSION' | 'BREAK_OVERDUE' | 'MISSED_CLOCK_IN' | 'LATE_CLOCK_IN';
      severity: 'warning' | 'danger';
      summary: string;
      detail: string;
      venue: string | null;
      staffProfile: { id: string; firstName: string; lastName: string; roleTitle: string; venue: string | null } | null;
      shift: ReturnType<typeof toRosterShiftPayload> | null;
      session: ReturnType<typeof toClockSessionPayload> | null;
    }> = [];

    for (const row of todaysStaff) {
      if (row.state === 'LATE') {
        clockExceptions.push({
          id: `late:${row.shift.id}`,
          kind: 'LATE_CLOCK_IN',
          severity: 'warning',
          summary: `${row.staffProfile?.firstName ?? 'Staff'} is late to clock in.`,
          detail: `${row.shift.startsAt} · ${row.shift.venue || row.staffProfile?.venue || 'No venue'}`,
          venue: row.shift.venue || row.staffProfile?.venue || null,
          staffProfile: row.staffProfile,
          shift: row.shift,
          session: row.activeSession
        });
      } else if (row.state === 'MISSED') {
        clockExceptions.push({
          id: `missed:${row.shift.id}`,
          kind: 'MISSED_CLOCK_IN',
          severity: 'danger',
          summary: `${row.staffProfile?.firstName ?? 'Staff'} missed a clock-in.`,
          detail: `${row.shift.startsAt} · ${row.shift.venue || row.staffProfile?.venue || 'No venue'}`,
          venue: row.shift.venue || row.staffProfile?.venue || null,
          staffProfile: row.staffProfile,
          shift: row.shift,
          session: null
        });
      }
    }

    for (const session of openSessions) {
      const sessionPayload = toClockSessionPayload(session);
      const breakMinutes = sessionBreakMinutes(session, now);
      const shiftEnd = session.rosterShift?.endsAt ?? null;
      if (session.currentBreakStartedAt && breakMinutes > 60) {
        clockExceptions.push({
          id: `break:${session.id}`,
          kind: 'BREAK_OVERDUE',
          severity: 'warning',
          summary: `${session.staffProfile?.firstName ?? 'Staff'} has an overdue break.`,
          detail: `${breakMinutes} minutes recorded on break.`,
          venue: session.venue || session.staffProfile?.venue || session.rosterShift?.venue || session.rosterShift?.staffProfile?.venue || null,
          staffProfile: session.staffProfile,
          shift: session.rosterShift ? toRosterShiftPayload(session.rosterShift) : null,
          session: sessionPayload
        });
      }
      if ((shiftEnd && now.getTime() > shiftEnd.getTime() + 15 * 60 * 1000) || (!shiftEnd && openSessionDurationMinutes(session, now) > 12 * 60)) {
        clockExceptions.push({
          id: `open:${session.id}`,
          kind: 'OPEN_SESSION',
          severity: 'danger',
          summary: `${session.staffProfile?.firstName ?? 'Staff'} still has an open clock session.`,
          detail: shiftEnd ? `Shift ended at ${shiftEnd.toISOString()}.` : `${openSessionDurationMinutes(session, now)} minutes since clock-in.`,
          venue: session.venue || session.staffProfile?.venue || session.rosterShift?.venue || session.rosterShift?.staffProfile?.venue || null,
          staffProfile: session.staffProfile,
          shift: session.rosterShift ? toRosterShiftPayload(session.rosterShift) : null,
          session: sessionPayload
        });
      }
    }

    const activeBookingStatuses = new Set(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED']);
    const bookingsSummary = {
      bookingsToday: todaysReservations.filter((reservation) => activeBookingStatuses.has(reservation.status)).length,
      coversToday: todaysReservations
        .filter((reservation) => activeBookingStatuses.has(reservation.status))
        .reduce((sum, reservation) => sum + reservation.covers, 0),
      upcomingBookings: todaysReservations.filter((reservation) =>
        ['PENDING', 'CONFIRMED', 'SEATED'].includes(reservation.status) && reservation.startsAt >= now
      ).length,
      cancellationsToday: todaysReservations.filter((reservation) => reservation.status === 'CANCELLED').length,
      noShowsToday: todaysReservations.filter((reservation) => reservation.status === 'NO_SHOW').length,
      nextReservations: todaysReservations
        .filter((reservation) => ['PENDING', 'CONFIRMED', 'SEATED'].includes(reservation.status) && reservation.startsAt >= now)
        .slice(0, 5)
        .map((reservation) => ({
          id: reservation.id,
          venue: reservation.venue,
          startsAt: reservation.startsAt.toISOString(),
          covers: reservation.covers,
          guestName: reservation.guestName,
          status: reservation.status
        }))
    };

    return {
      date: key,
      venue,
      generatedAt: now.toISOString(),
      metrics: {
        scheduledStaff: new Set(todaysStaff.map((row) => row.shift.staffProfileId)).size,
        clockedIn: todaysStaff.filter((row) => row.state === 'CLOCKED_IN').length,
        onBreak: todaysStaff.filter((row) => row.state === 'ON_BREAK').length,
        lateClockIns: todaysStaff.filter((row) => row.state === 'LATE').length,
        missedClockIns: todaysStaff.filter((row) => row.state === 'MISSED').length,
        pendingConfirmations: pendingConfirmations.length,
        clockExceptions: clockExceptions.length,
        bookingsToday: bookingsSummary.bookingsToday,
        coversToday: bookingsSummary.coversToday
      },
      bookingsSummary,
      todaysStaff,
      clockedIn: openSessions.map(toClockSessionPayload),
      pendingConfirmations: pendingConfirmations.map((shift) => ({
        shift: toRosterShiftPayload(shift),
        staffProfile: shift.staffProfile
      })),
      clockExceptions
    };
  },

  async listTimesheets(
    start?: string,
    end?: string,
    status?: string,
    venue?: string,
    staffProfileId?: string,
    actor?: AuthUser
  ) {
    const now = new Date();
    const startDate = start ? parseDate(start, 'Timesheet start date') : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const endDate = end ? parseDate(end, 'Timesheet end date') : new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    const scopedVenue = scopeVenueForActor(venue, actor);

    if (actor?.role === 'STAFF' && staffProfileId && staffProfileId !== actor.id) {
      throw new HttpError(403, 'You can only view your own timesheets.');
    }
    if (actor && actor.role !== 'STAFF' && staffProfileId) {
      await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    }

    return prisma.timesheet.findMany({
      where: {
        workDate: { gte: startDate, lt: endDate },
        ...(status && status !== 'all' ? { status: status as never } : {}),
        ...(scopedVenue ? { OR: [{ venue: scopedVenue }, { venue: null, staffProfile: { venue: scopedVenue } }] } : {}),
        ...(staffProfileId ? { staffProfileId } : actor?.role === 'STAFF' ? { staffProfileId: actor.id } : {})
      },
      orderBy: [{ workDate: 'desc' }, { clockInAt: 'asc' }],
      include: {
        staffProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            roleTitle: true,
            venue: true,
            email: true
          }
        }
      }
    });
  },

  async createTimesheet(input: unknown, actor?: AuthUser) {
    const data = timesheetCreateInputSchema.parse(input);
    if (actor) {
      await assertActorCanAccessStaffProfile(data.staffProfileId, actor);
      if (actor.role === 'STAFF' && !['DRAFT', 'SUBMITTED'].includes(data.status)) {
        throw new HttpError(403, 'Staff can only create draft or submitted timesheets.');
      }
    } else {
      await this.getById(data.staffProfileId);
    }
    if (data.rosterShiftId) {
      if (actor) {
        await assertActorCanAccessRosterShift(data.rosterShiftId, actor);
      } else {
        const shift = await prisma.rosterShift.findUnique({ where: { id: data.rosterShiftId } });
        if (!shift) throw new HttpError(404, 'Roster shift not found');
      }
    }
    const workDate = parseDate(data.workDate, 'Work date');
    const clockInAt = parseDate(data.clockInAt, 'Clock-in time');
    const clockOutAt = parseDate(data.clockOutAt, 'Clock-out time');
    if (clockOutAt <= clockInAt) {
      throw new HttpError(400, 'Clock-out time must be after clock-in time');
    }

    return prisma.timesheet.create({
      data: {
        staffProfileId: data.staffProfileId,
        rosterShiftId: data.rosterShiftId || null,
        venue: data.venue || null,
        area: data.area || null,
        roleTitle: data.roleTitle || null,
        workDate,
        clockInAt,
        clockOutAt,
        breakMinutes: data.breakMinutes,
        notes: data.notes || null,
        status: data.status,
        submittedAt: data.status === 'SUBMITTED' ? new Date() : null,
        approvedAt: data.status === 'APPROVED' ? new Date() : null,
        approvedById: data.status === 'APPROVED' ? actor?.id ?? null : null,
        xeroEmployeeId: data.xeroEmployeeId || null,
        xeroEarningsRateId: data.xeroEarningsRateId || null,
        paymentMethod: data.paymentMethod
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, email: true }
        }
      }
    });
  },

  async updateTimesheet(id: string, input: unknown, actor?: AuthUser) {
    const existing = actor ? await assertActorCanAccessTimesheet(id, actor) : await prisma.timesheet.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Timesheet not found');
    if (['APPROVED', 'EXPORTED'].includes(existing.status)) {
      throw new HttpError(400, 'Approved or exported timesheets cannot be edited');
    }
    const data = timesheetUpdateInputSchema.parse(input);
    if (actor?.role === 'STAFF') {
      if (data.staffProfileId && data.staffProfileId !== actor.id) {
        throw new HttpError(403, 'You can only edit your own timesheets.');
      }
      if (data.status && !['DRAFT', 'SUBMITTED'].includes(data.status)) {
        throw new HttpError(403, 'Staff cannot change timesheet approval states.');
      }
    }
    if (data.staffProfileId && actor) {
      await assertActorCanAccessStaffProfile(data.staffProfileId, actor);
    }
    if (data.rosterShiftId) {
      if (actor) {
        await assertActorCanAccessRosterShift(data.rosterShiftId, actor);
      } else {
        const shift = await prisma.rosterShift.findUnique({ where: { id: data.rosterShiftId } });
        if (!shift) throw new HttpError(404, 'Roster shift not found');
      }
    }
    const workDate = data.workDate !== undefined ? parseDate(data.workDate, 'Work date') : undefined;
    const clockInAt = data.clockInAt !== undefined ? parseDate(data.clockInAt, 'Clock-in time') : undefined;
    const clockOutAt = data.clockOutAt !== undefined ? parseDate(data.clockOutAt, 'Clock-out time') : undefined;
    const effectiveIn = clockInAt ?? existing.clockInAt;
    const effectiveOut = clockOutAt ?? existing.clockOutAt;
    if (effectiveOut <= effectiveIn) {
      throw new HttpError(400, 'Clock-out time must be after clock-in time');
    }

    return prisma.timesheet.update({
      where: { id },
      data: {
        ...(data.staffProfileId !== undefined && { staffProfileId: data.staffProfileId }),
        ...(data.rosterShiftId !== undefined && { rosterShiftId: data.rosterShiftId || null }),
        ...(data.venue !== undefined && { venue: data.venue || null }),
        ...(data.area !== undefined && { area: data.area || null }),
        ...(data.roleTitle !== undefined && { roleTitle: data.roleTitle || null }),
        ...(workDate !== undefined && { workDate }),
        ...(clockInAt !== undefined && { clockInAt }),
        ...(clockOutAt !== undefined && { clockOutAt }),
        ...(data.breakMinutes !== undefined && { breakMinutes: data.breakMinutes }),
        ...(data.notes !== undefined && { notes: data.notes || null }),
        ...(data.status !== undefined && {
          status: data.status,
          submittedAt: data.status === 'SUBMITTED' ? new Date() : existing.submittedAt
        }),
        ...(data.xeroEmployeeId !== undefined && { xeroEmployeeId: data.xeroEmployeeId || null }),
        ...(data.xeroEarningsRateId !== undefined && { xeroEarningsRateId: data.xeroEarningsRateId || null }),
        ...(data.paymentMethod !== undefined && { paymentMethod: data.paymentMethod })
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, email: true }
        }
      }
    });
  },

  async approveTimesheet(id: string, approverId: string, actor?: AuthUser) {
    const existing = actor ? await assertActorCanAccessTimesheet(id, actor) : await prisma.timesheet.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Timesheet not found');
    if (!['SUBMITTED', 'REJECTED'].includes(existing.status)) {
      throw new HttpError(400, 'Only submitted or rejected timesheets can be approved');
    }
    return prisma.timesheet.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: approverId,
        rejectedAt: null,
        rejectionReason: null
      }
    });
  },

  async markTimesheetCashPaid(id: string, approverId: string, input: unknown, actor?: AuthUser) {
    const data = timesheetCashPaymentInputSchema.parse(input);
    const existing = actor ? await assertActorCanAccessTimesheet(id, actor) : await prisma.timesheet.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Timesheet not found');
    if (existing.status !== 'APPROVED') {
      throw new HttpError(400, 'Only approved timesheets can be marked cash paid');
    }
    if (existing.paymentMethod !== 'CASH') {
      throw new HttpError(400, 'Only cash payment timesheets can be marked cash paid');
    }
    return prisma.timesheet.update({
      where: { id },
      data: {
        cashPaidAt: new Date(),
        cashPaidById: approverId,
        cashPaymentNotes: data.notes || null
      },
      include: {
        staffProfile: {
          select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true, email: true }
        }
      }
    });
  },

  async rejectTimesheet(id: string, input: unknown, actor?: AuthUser) {
    const existing = actor ? await assertActorCanAccessTimesheet(id, actor) : await prisma.timesheet.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Timesheet not found');
    if (existing.status === 'EXPORTED') {
      throw new HttpError(400, 'Exported timesheets cannot be rejected');
    }
    const data = timesheetApprovalInputSchema.parse(input);
    return prisma.timesheet.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectionReason: data.reason || null,
        approvedAt: null,
        approvedById: null
      }
    });
  },

  async exportTimesheetsForXero(input: unknown, actor?: AuthUser) {
    const data = timesheetExportInputSchema.parse(input);
    const startDate = parseDate(data.start, 'Export start date');
    const endDate = parseDate(data.end, 'Export end date');
    const scopedVenue = scopeVenueForActor(data.venue || undefined, actor);
    const entries = await prisma.timesheet.findMany({
      where: {
        status: 'APPROVED',
        paymentMethod: { not: 'CASH' },
        workDate: { gte: startDate, lt: endDate },
        ...(scopedVenue ? { OR: [{ venue: scopedVenue }, { venue: null, staffProfile: { venue: scopedVenue } }] } : {})
      },
      orderBy: [{ workDate: 'asc' }, { clockInAt: 'asc' }],
      include: {
        staffProfile: {
          select: { firstName: true, lastName: true, email: true, xeroEmployeeId: true, xeroEarningsRateId: true }
        }
      }
    });
    const exportBatchId = `xero-${Date.now()}`;
    const rows = entries.map((entry) => ({
      'Staff Name': `${entry.staffProfile.firstName} ${entry.staffProfile.lastName}`,
      Email: entry.staffProfile.email ?? '',
      'Xero Employee ID': entry.xeroEmployeeId ?? entry.staffProfile.xeroEmployeeId ?? '',
      'Xero Earnings Rate ID': entry.xeroEarningsRateId ?? entry.staffProfile.xeroEarningsRateId ?? '',
      'Work Date': entry.workDate.toISOString().slice(0, 10),
      'Start Time': entry.clockInAt.toISOString(),
      'End Time': entry.clockOutAt.toISOString(),
      'Break Minutes': entry.breakMinutes,
      Hours: timesheetHours(entry).toFixed(2),
      Venue: entry.venue ?? '',
      Area: entry.area ?? '',
      Role: entry.roleTitle ?? '',
      'Payment Method': entry.paymentMethod,
      Notes: entry.notes ?? '',
      'Timesheet ID': entry.id
    }));

    if (data.markExported && entries.length > 0) {
      await prisma.timesheet.updateMany({
        where: { id: { in: entries.map((entry) => entry.id) } },
        data: { status: 'EXPORTED', exportedAt: new Date(), xeroExportBatchId: exportBatchId }
      });
    }

    return {
      exportBatchId,
      count: entries.length,
      markedExported: data.markExported,
      csv: toXeroCsv(rows),
      rows
    };
  },

  async getTipsSummary(input: unknown) {
    const data = tipsQuerySchema.parse(input);
    const startDate = parseDate(data.start, 'Tips start date');
    const endDate = parseDate(data.end, 'Tips end date');
    const venue = data.venue || 'All venues';
    const venueWhere = data.venue ? { venue: data.venue } : {};

    const [cashEntries, cardEntries, timesheets, paidRuns] = await Promise.all([
      prisma.staffTipCashEntry.findMany({
        where: {
          serviceDate: { gte: startDate, lt: endDate },
          ...(data.venue ? { venue: data.venue } : {})
        },
        orderBy: [{ serviceDate: 'asc' }]
      }),
      prisma.staffTipCardEntry.findMany({
        where: {
          serviceDate: { gte: startDate, lt: endDate },
          ...(data.venue ? { venue: data.venue } : {})
        },
        orderBy: [{ serviceDate: 'asc' }, { source: 'asc' }]
      }),
      prisma.timesheet.findMany({
        where: {
          status: { in: ['APPROVED', 'EXPORTED'] },
          workDate: { gte: startDate, lt: endDate },
          ...venueWhere
        },
        include: {
          staffProfile: {
            select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
          }
        }
      }),
      prisma.staffTipPaymentRun.findMany({
        where: {
          weekStart: startDate,
          weekEnd: endDate,
          ...(data.venue ? { venue: data.venue } : {})
        },
        orderBy: [{ paidAt: 'desc' }],
        include: {
          lines: {
            include: {
              staffProfile: {
                select: { id: true, firstName: true, lastName: true, roleTitle: true, venue: true }
              }
            },
            orderBy: [{ createdAt: 'asc' }]
          }
        }
      })
    ]);

    const cashTipsCents = cashEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const squareTipsCents = cardEntries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const tipPoolCents = cashTipsCents + squareTipsCents;
    const byStaff = new Map<string, {
      staffProfileId: string;
      name: string;
      roleTitle: string | null;
      venue: string | null;
      approvedHours: number;
    }>();

    for (const timesheet of timesheets) {
      const hours = timesheetHours(timesheet);
      if (hours <= 0) continue;
      const existing = byStaff.get(timesheet.staffProfileId) ?? {
        staffProfileId: timesheet.staffProfileId,
        name: `${timesheet.staffProfile.firstName} ${timesheet.staffProfile.lastName}`,
        roleTitle: timesheet.roleTitle ?? timesheet.staffProfile.roleTitle,
        venue: timesheet.venue ?? timesheet.staffProfile.venue,
        approvedHours: 0
      };
      existing.approvedHours += hours;
      byStaff.set(timesheet.staffProfileId, existing);
    }

    const approvedHours = Array.from(byStaff.values()).reduce((sum, row) => sum + row.approvedHours, 0);
    let allocatedCents = 0;
    const entitlements = Array.from(byStaff.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((row, index, rows) => {
        const isLast = index === rows.length - 1;
        const amountCents = approvedHours > 0
          ? isLast
            ? tipPoolCents - allocatedCents
            : Math.round((row.approvedHours / approvedHours) * tipPoolCents)
          : 0;
        allocatedCents += amountCents;
        return {
          ...row,
          approvedHours: Math.round(row.approvedHours * 100) / 100,
          amountCents,
          paymentMethod: 'CASH' as const
        };
      });

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      venue,
      cashTipsCents,
      squareTipsCents,
      tipPoolCents,
      approvedHours: Math.round(approvedHours * 100) / 100,
      paidRuns: paidRuns.map((run) => ({
        id: run.id,
        paidAt: run.paidAt.toISOString(),
        tipPoolCents: run.tipPoolCents,
        lineCount: run.lines.length
      })),
      paidEntitlements: (paidRuns[0]?.lines ?? []).map((line) => ({
        staffProfileId: line.staffProfileId,
        name: `${line.staffProfile.firstName} ${line.staffProfile.lastName}`,
        roleTitle: line.staffProfile.roleTitle,
        venue: line.staffProfile.venue,
        approvedHours: Math.round(line.hours * 100) / 100,
        amountCents: line.amountCents,
        paymentMethod: 'CASH' as const
      })),
      cashEntries: cashEntries.map((entry) => ({
        id: entry.id,
        serviceDate: entry.serviceDate.toISOString(),
        venue: entry.venue,
        amountCents: entry.amountCents,
        notes: entry.notes
      })),
      cardEntries: cardEntries.map((entry) => ({
        id: entry.id,
        serviceDate: entry.serviceDate.toISOString(),
        venue: entry.venue,
        amountCents: entry.amountCents,
        source: entry.source,
        externalId: entry.externalId,
        notes: entry.notes
      })),
      entitlements
    };
  },

  async saveTipsCashEntry(input: unknown) {
    const data = tipsCashEntryInputSchema.parse(input);
    const serviceDate = parseDate(data.serviceDate, 'Tips service date');
    if (data.amountCents === 0) {
      await prisma.staffTipCashEntry.deleteMany({
        where: { venue: data.venue, serviceDate }
      });
      return { deleted: true };
    }
    return prisma.staffTipCashEntry.upsert({
      where: {
        venue_serviceDate: {
          venue: data.venue,
          serviceDate
        }
      },
      create: {
        venue: data.venue,
        serviceDate,
        amountCents: data.amountCents,
        notes: data.notes || null
      },
      update: {
        amountCents: data.amountCents,
        notes: data.notes || null
      }
    });
  },

  async importTipsCardEntries(input: unknown) {
    const data = tipsCardImportInputSchema.parse(input);
    const rows = data.rows.map((row) => {
      const serviceDate = parseDate(row.serviceDate, 'Card tips service date');
      const source = row.source.trim().toLowerCase() || 'control';
      const externalId = row.externalId?.trim() || null;
      return {
        venue: row.venue.trim(),
        serviceDate,
        amountCents: row.amountCents,
        source,
        externalId,
        importKey: tipImportKey({
          source,
          venue: row.venue,
          serviceDate,
          amountCents: row.amountCents,
          externalId,
          importKey: row.importKey
        }),
        notes: row.notes?.trim() || null
      };
    });

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
    });

    return { imported, updated, count: rows.length };
  },

  async exportTipsCsv(input: unknown) {
    const summary = await this.getTipsSummary(input);
    const rows = applyTipAdjustments(summary.entitlements, input);
    return toTipsCsv(rows.map((row) => ({
      'Staff Name': row.name,
      Venue: row.venue ?? '',
      Role: row.roleTitle ?? '',
      'Approved Hours': row.approvedHours.toFixed(2),
      'Base Tips': centsToMoney(row.baseAmountCents),
      'Adjustment': centsToMoney(row.adjustmentCents),
      'Tips Amount': centsToMoney(row.finalAmountCents),
      Excluded: row.excluded ? 'Yes' : 'No',
      'Payment Method': row.paymentMethod,
      Notes: row.notes ?? '',
      'Staff Profile ID': row.staffProfileId
    })));
  },

  async markTipsPaid(input: unknown, paidById?: string) {
    const data = tipsMarkPaidInputSchema.parse(input);
    if (!data.venue) throw new HttpError(400, 'Choose a venue before marking tips paid');
    const summary = await this.getTipsSummary(data);
    if (summary.tipPoolCents <= 0) throw new HttpError(400, 'No tips to mark paid for this period');
    if (summary.entitlements.length === 0) {
      throw new HttpError(400, 'No approved hours to allocate tips against');
    }
    const startDate = parseDate(data.start, 'Tips start date');
    const endDate = parseDate(data.end, 'Tips end date');
    const adjustedRows = applyTipAdjustments(summary.entitlements, data);
    return prisma.staffTipPaymentRun.create({
      data: {
        venue: data.venue,
        weekStart: startDate,
        weekEnd: endDate,
        tipPoolCents: summary.tipPoolCents,
        notes: data.notes || null,
        paidById: paidById ?? null,
        lines: {
          create: adjustedRows.map((row) => ({
            staffProfileId: row.staffProfileId,
            hours: row.approvedHours,
            baseAmountCents: row.baseAmountCents,
            adjustmentCents: row.adjustmentCents,
            amountCents: row.finalAmountCents,
            excluded: row.excluded,
            paymentMethod: 'CASH',
            notes: row.notes,
            paidAt: new Date()
          }))
        }
      },
      include: { lines: true }
    });
  },

  async listMyTips(staffProfileId: string) {
    const lines = await prisma.staffTipPaymentRunLine.findMany({
      where: {
        staffProfileId,
        excluded: false,
        amountCents: { gt: 0 }
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        paymentRun: true
      },
      take: 24
    });

    return lines.map((line) => ({
      id: line.id,
      venue: line.paymentRun.venue,
      weekStart: line.paymentRun.weekStart.toISOString(),
      weekEnd: line.paymentRun.weekEnd.toISOString(),
      paidAt: (line.paidAt ?? line.paymentRun.paidAt).toISOString(),
      hours: Math.round(line.hours * 100) / 100,
      baseAmountCents: line.baseAmountCents,
      adjustmentCents: line.adjustmentCents,
      amountCents: line.amountCents,
      notes: line.notes
    }));
  },

  async listInvites() {
    return prisma.staffInvite.findMany({
      orderBy: [{ createdAt: 'desc' }]
    });
  },

  /**
   * Create an invite AND a pending StaffProfile at the same time, linked via
   * staffProfileId on the invite. This means the new hire appears in the
   * compliance module immediately (employmentStatus = 'PENDING') so you can
   * start staging their records before they finish onboarding. Completing the
   * onboarding form updates the existing profile rather than creating a new
   * one.
   */
  async createInvite(input: unknown, actor?: AuthUser) {
    const data = staffInviteCreateInputSchema.parse(input);
    const staffDefaults = await getStaffDefaults();
    const days = data.expiresInDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const email = normaliseEmail(data.email);
    const onboardingBaseUrl = normaliseBaseUrl(data.onboardingBaseUrl);
    const targetVenue = data.venue || staffDefaults.defaultVenue || (actor && !actor.isAdmin && actor.role !== 'ADMIN' ? actor.venue ?? '' : '');

    if (
      actor &&
      !actor.isAdmin &&
      actor.role !== 'ADMIN' &&
      (!actor.venue || targetVenue !== actor.venue)
    ) {
      throw new HttpError(403, 'Managers cannot create staff invites outside their venue.');
    }

    if (email) {
      const existing = await prisma.staffProfile.findUnique({ where: { email } });
      if (existing) {
        throw new HttpError(
          409,
          'A staff profile already exists for that email — add records to their profile or remove the existing one first.'
        );
      }
    }

    const invite = await prisma.$transaction(async (tx) => {
      const profile = await tx.staffProfile.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          roleTitle: data.roleTitle || staffDefaults.defaultRoleTitle,
          email,
          venue: targetVenue || null,
          employmentStatus: 'PENDING',
          notes: data.note || null,
          payProfile: { create: defaultPayProfileCreateData(undefined, staffDefaults) },
          appAccess: { create: defaultStaffAppAccessCreateData(staffDefaults) }
        }
      });

      return tx.staffInvite.create({
        data: {
          token: generateToken(),
          email,
          note: data.note || null,
          expiresAt,
          staffProfileId: profile.id
        }
      });
    });

    const inviteLink = inviteLinkFor(invite.token, onboardingBaseUrl);
    const emailDelivery =
      email && inviteLink
        ? await mailService.sendStaffInvite({
            to: email,
            firstName: data.firstName,
            roleTitle: data.roleTitle || staffDefaults.defaultRoleTitle,
            venue: targetVenue || null,
            note: data.note || null,
            inviteLink,
            expiresAt
          })
        : ({
            status: 'skipped',
            reason: email ? 'No onboarding base URL configured' : 'No invite email provided'
          } as const);

    return { ...invite, inviteLink, emailDelivery };
  },

  async reonboardStaff(input: unknown, actor?: AuthUser) {
    const data = staffReonboardInputSchema.parse(input);
    const staffDefaults = await getStaffDefaults();
    const days = data.expiresInDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const email = normaliseEmail(data.email);
    if (!email) throw new HttpError(400, 'Email is required');
    const onboardingBaseUrl = normaliseBaseUrl(data.onboardingBaseUrl);
    const existingForScope = await prisma.staffProfile.findUnique({
      where: { email },
      select: { id: true, venue: true }
    });
    const targetVenue = data.venue || (existingForScope ? existingForScope.venue ?? '' : staffDefaults.defaultVenue) || '';

    if (
      actor &&
      !actor.isAdmin &&
      actor.role !== 'ADMIN' &&
      (!actor.venue || targetVenue !== actor.venue)
    ) {
      throw new HttpError(403, 'Managers cannot re-onboard staff outside their venue.');
    }

    const invite = await prisma.$transaction(async (tx) => {
      const existing = await tx.staffProfile.findUnique({ where: { email } });
      if (existing?.isAdmin) {
        throw new HttpError(400, 'Admin staff profiles cannot be reset through re-onboarding');
      }

      const profile = existing
        ? await tx.staffProfile.update({
            where: { id: existing.id },
            data: {
              firstName: data.firstName?.trim() || existing.firstName,
              lastName: data.lastName?.trim() || existing.lastName,
              roleTitle: data.roleTitle?.trim() || existing.roleTitle,
              venue: data.venue !== undefined ? data.venue || null : existing.venue,
              employmentStatus: 'PENDING',
              passwordHash: null,
              lastLoginAt: null,
              notes: [
                existing.notes,
                `Re-onboarding reset ${new Date().toISOString()}.`,
                data.note?.trim() ? `Re-onboarding note: ${data.note.trim()}` : null
              ]
                .filter(Boolean)
                .join('\n')
            }
          })
        : await tx.staffProfile.create({
            data: {
              firstName: data.firstName?.trim() || 'Pending',
              lastName: data.lastName?.trim() || 'Staff',
              roleTitle: data.roleTitle?.trim() || staffDefaults.defaultRoleTitle,
              email,
              venue: targetVenue || null,
              employmentStatus: 'PENDING',
              notes: data.note || null,
              payProfile: { create: defaultPayProfileCreateData(undefined, staffDefaults) },
              appAccess: { create: defaultStaffAppAccessCreateData(staffDefaults) }
            }
          });

      await tx.staffInvite.updateMany({
        where: {
          staffProfileId: profile.id,
          completedAt: null
        },
        data: { expiresAt: new Date() }
      });

      return tx.staffInvite.create({
        data: {
          token: generateToken(),
          email,
          note: data.note || null,
          expiresAt,
          staffProfileId: profile.id
        }
      });
    });

    const profile = invite.staffProfileId
      ? await prisma.staffProfile.findUnique({
          where: { id: invite.staffProfileId },
          select: { firstName: true, roleTitle: true, venue: true }
        })
      : null;
    const inviteLink = inviteLinkFor(invite.token, onboardingBaseUrl);
    const emailDelivery =
      email && inviteLink
        ? await mailService.sendStaffInvite({
            to: email,
            firstName: profile?.firstName ?? data.firstName ?? 'there',
            roleTitle: profile?.roleTitle ?? data.roleTitle ?? 'Team member',
            venue: profile?.venue ?? data.venue ?? null,
            note: data.note || null,
            inviteLink,
            expiresAt
          })
        : ({
            status: 'skipped',
            reason: email ? 'No onboarding base URL configured' : 'No invite email provided'
          } as const);

    return { ...invite, inviteLink, emailDelivery, reonboarded: true };
  },

  async reonboardProfile(id: string, input: unknown, actor?: AuthUser) {
    if (actor) await assertManagerCanAccessStaffProfile(id, actor);
    const data = staffProfileReonboardInputSchema.parse(input ?? {});
    const profile = await prisma.staffProfile.findUnique({ where: { id } });
    if (!profile) throw new HttpError(404, 'Staff profile not found');
    if (!profile.email) {
      throw new HttpError(400, 'Add an email to this staff profile before sending a re-onboarding link.');
    }

    return this.reonboardStaff({
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      roleTitle: profile.roleTitle,
      venue: profile.venue ?? '',
      note: data.note?.trim() || 'Please complete your ALMA Staff onboarding details.',
      expiresInDays: data.expiresInDays,
      onboardingBaseUrl: data.onboardingBaseUrl
    }, actor);
  },

  async resendInvite(id: string, input: unknown) {
    const data = staffInviteCreateInputSchema
      .pick({ onboardingBaseUrl: true })
      .partial()
      .parse(input ?? {});
    const onboardingBaseUrl = normaliseBaseUrl(data.onboardingBaseUrl);
    const invite = await prisma.staffInvite.findUnique({ where: { id } });
    if (!invite) throw new HttpError(404, 'Invite not found');
    if (invite.completedAt) throw new HttpError(400, 'Invite has already been completed');
    const profile = invite.staffProfileId
      ? await prisma.staffProfile.findUnique({
          where: { id: invite.staffProfileId },
          select: {
            firstName: true,
            roleTitle: true,
            venue: true,
            email: true
          }
        })
      : null;

    const inviteLink = inviteLinkFor(invite.token, onboardingBaseUrl);
    const email = invite.email ?? profile?.email ?? null;
    const expiresAt =
      invite.expiresAt && invite.expiresAt.getTime() > Date.now()
        ? invite.expiresAt
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const updated =
      expiresAt !== invite.expiresAt
        ? await prisma.staffInvite.update({ where: { id }, data: { expiresAt } })
        : invite;

    const emailDelivery =
      email && inviteLink
        ? await mailService.sendStaffInvite({
            to: email,
            firstName: profile?.firstName ?? 'there',
            roleTitle: profile?.roleTitle ?? 'Team member',
            venue: profile?.venue ?? null,
            note: invite.note,
            inviteLink,
            expiresAt
          })
        : ({
            status: 'skipped',
            reason: email ? 'No onboarding base URL configured' : 'No invite email provided'
          } as const);

    return { ...updated, inviteLink, emailDelivery };
  },

  async getInviteByToken(token: string) {
    const invite = await prisma.staffInvite.findUnique({ where: { token } });
    if (!invite) throw new HttpError(404, 'Invite not found');
    if (invite.completedAt) {
      throw new HttpError(410, 'This invite has already been completed');
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      throw new HttpError(410, 'This invite has expired');
    }
    return invite;
  },

  async getInviteOnboardingContext(token: string) {
    const invite = await this.getInviteByToken(token);
    const [profile, onboardingSettings] = await Promise.all([
      invite.staffProfileId
        ? prisma.staffProfile.findUnique({
            where: { id: invite.staffProfileId },
            select: {
              firstName: true,
              lastName: true,
              roleTitle: true,
              email: true,
              venue: true
            }
          })
        : null,
      getOnboardingSettings()
    ]);

    return { invite, profile, onboardingSettings };
  },

  async completeInvite(token: string, input: unknown) {
    const invite = await this.getInviteByToken(token);
    const data = staffInviteCompleteInputSchema.parse(input);
    const [onboardingSettings, staffDefaults] = await Promise.all([getOnboardingSettings(), getStaffDefaults()]);
    validateCompleteOnboarding(data, onboardingSettings);
    const email = normaliseEmail(data.email) ?? invite.email ?? null;
    const passwordHash = await authService.hashPassword(data.password);

    return prisma.$transaction(async (tx) => {
      if (!invite.staffProfileId) {
        // Legacy invite (created before invite-creates-profile flow). Fall
        // back to creating a fresh profile so the old tokens still work.
        const profile = await tx.staffProfile.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            roleTitle: data.roleTitle || staffDefaults.defaultRoleTitle,
            email,
            phone: data.phone || null,
            venue: data.venue || staffDefaults.defaultVenue || null,
            employmentStatus: 'PENDING',
            startDate: data.startDate ? new Date(data.startDate) : null,
            ...onboardingDetailCreateData(data),
            notes: data.notes || null,
            passwordHash,
            payProfile: !hasLegacyPaySetup(data)
              ? { create: defaultPayProfileCreateData(undefined, staffDefaults) }
              : undefined,
            appAccess: { create: defaultStaffAppAccessCreateData(staffDefaults) },
            records: data.records?.length
              ? {
                  create: data.records.map((record) => ({
                    recordType: record.recordType,
                    title: record.title,
                    issuer: record.issuer || null,
                    certificateNumber: record.certificateNumber || null,
                    issueDate: record.issueDate ? new Date(record.issueDate) : null,
                    expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
                    status: 'PENDING',
                    documentName: record.documentName || null,
                    documentUrl: record.documentUrl || null,
                    notes: record.notes || null
                  }))
                }
              : undefined
          },
          include: {
            records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] }
          }
        });

        await tx.staffInvite.update({
          where: { id: invite.id },
          data: { completedAt: new Date(), staffProfileId: profile.id }
        });

        return withoutStaffSecrets(profile);
      }

      const existingProfile = await tx.staffProfile.findUnique({
        where: { id: invite.staffProfileId },
        select: { roleTitle: true, venue: true }
      });

      // Normal flow — fill in the pending profile.
      const profile = await tx.staffProfile.update({
        where: { id: invite.staffProfileId },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          roleTitle: data.roleTitle || existingProfile?.roleTitle || staffDefaults.defaultRoleTitle,
          email,
          phone: data.phone || null,
          venue: data.venue || existingProfile?.venue || staffDefaults.defaultVenue || null,
          employmentStatus: 'PENDING',
          startDate: data.startDate ? new Date(data.startDate) : null,
          ...onboardingDetailCreateData(data),
          notes: data.notes || null,
          passwordHash,
          records: data.records?.length
            ? {
                create: data.records.map((record) => ({
                  recordType: record.recordType,
                  title: record.title,
                  issuer: record.issuer || null,
                  certificateNumber: record.certificateNumber || null,
                  issueDate: record.issueDate ? new Date(record.issueDate) : null,
                  expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
                  status: 'PENDING',
                  documentName: record.documentName || null,
                  documentUrl: record.documentUrl || null,
                  notes: record.notes || null
                }))
              }
            : undefined
        },
        include: {
          records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] }
        }
      });

      await tx.staffInvite.update({
        where: { id: invite.id },
        data: { completedAt: new Date() }
      });

      return withoutStaffSecrets(profile);
    });
  },

  async approveRecord(staffProfileId: string, recordId: string, actor?: AuthUser) {
    await this.getById(staffProfileId, actor);
    const record = await prisma.staffComplianceRecord.findFirst({
      where: { id: recordId, staffProfileId }
    });

    if (!record) {
      throw new HttpError(404, 'Staff document not found');
    }

    if (!record.documentUrl) {
      throw new HttpError(400, 'Cannot approve a document before it has been uploaded');
    }

    return prisma.staffComplianceRecord.update({
      where: { id: recordId },
      data: { status: 'APPROVED' }
    });
  },

  async approveOnboarding(staffProfileId: string, actor?: AuthUser) {
    const profile = await this.getById(staffProfileId, actor);
    const onboardingSettings = await getOnboardingSettings();
    const missingDocuments = requiredOnboardingDocumentTitles(onboardingSettings).filter((title) => {
      const record = profile.records.find(
        (candidate) => candidate.title.trim().toLowerCase() === title.toLowerCase()
      );
      return !record?.documentUrl;
    });

    if (missingDocuments.length) {
      throw new HttpError(400, `Missing required uploaded documents: ${missingDocuments.join(', ')}`);
    }

    await prisma.staffComplianceRecord.updateMany({
      where: {
        staffProfileId,
        documentUrl: { not: null },
        status: 'PENDING'
      },
      data: { status: 'APPROVED' }
    });

    const approvedProfile = await prisma.staffProfile.update({
      where: { id: staffProfileId },
      data: { employmentStatus: 'ACTIVE' },
      include: {
        appAccess: { orderBy: [{ appId: 'asc' }] },
        records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] },
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] }
      }
    });
    return withoutStaffSecrets(approvedProfile);
  },

  async changeOwnPin(actor: AuthUser, input: unknown) {
    if (actor.accountType === 'VENUE_DEVICE') {
      throw new HttpError(403, 'Device accounts cannot set a personal PIN.');
    }
    const data = staffPinChangeInputSchema.parse(input);
    const profile = await prisma.staffProfile.findFirst({
      where: {
        id: actor.id,
        accountType: 'HUMAN',
        employmentStatus: 'ACTIVE',
        mergedIntoStaffProfileId: null
      },
      select: { id: true, pinHash: true }
    });
    if (!profile) throw new HttpError(404, 'Staff profile not found.');
    if (profile.pinHash) {
      if (!data.currentPin) throw new HttpError(400, 'Current PIN is required.');
      const ok = await authService.comparePin(data.currentPin, profile.pinHash);
      if (!ok) throw new HttpError(401, 'Current PIN is incorrect.');
    }
    const pinHash = await authService.hashPin(data.newPin);
    await prisma.staffProfile.update({
      where: { id: profile.id },
      data: {
        pinHash,
        pinUpdatedAt: new Date(),
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLastFailedAt: null
      }
    });
    return { ok: true, pinUpdatedAt: new Date().toISOString() };
  },

  async resetPin(staffProfileId: string, input: unknown, actor?: AuthUser) {
    const data = staffPinResetInputSchema.parse(input);
    if (!actor) throw new HttpError(401, 'Not authenticated');
    await assertManagerCanAccessStaffProfile(staffProfileId, actor);
    const profile = await prisma.staffProfile.findFirst({
      where: { id: staffProfileId, accountType: 'HUMAN', mergedIntoStaffProfileId: null },
      select: { id: true, firstName: true, lastName: true }
    });
    if (!profile) throw new HttpError(404, 'Staff profile not found.');
    const now = new Date();
    const pinHash = await authService.hashPin(data.pin);
    await prisma.staffProfile.update({
      where: { id: profile.id },
      data: {
        pinHash,
        pinUpdatedAt: now,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        pinLastFailedAt: null
      }
    });
    await prisma.staffManagementEvent.create({
      data: {
        staffProfileId: profile.id,
        eventType: 'STAFF_PIN_RESET',
        summary: 'Staff PIN reset by manager or admin.',
        createdById: actor?.id ?? null,
        createdByName: actor ? actorName(actor) : null,
        createdByEmail: actor?.email ?? null,
        metadata: {}
      }
    });
    return { ok: true, pinUpdatedAt: now.toISOString() };
  },

  async summary(actor?: AuthUser) {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const profileScope = staffProfileScope(actor);

    const [totalProfiles, expired, expiringSoon, pendingApproval] = await Promise.all([
      prisma.staffProfile.count({ where: profileScope }),
      prisma.staffComplianceRecord.count({
        where: {
          staffProfile: profileScope,
          OR: [
            { status: 'EXPIRED' },
            { expiryDate: { lt: now } }
          ]
        }
      }),
      prisma.staffComplianceRecord.count({
        where: {
          staffProfile: profileScope,
          expiryDate: {
            gte: now,
            lte: soon
          }
        }
      }),
      prisma.staffComplianceRecord.count({
        where: {
          staffProfile: profileScope,
          status: 'PENDING'
        }
      })
    ]);

    return { totalProfiles, expired, expiringSoon, pendingApproval };
  }
};
