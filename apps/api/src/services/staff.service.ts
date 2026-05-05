import { randomBytes } from 'node:crypto';
import { prisma } from '@alma/db';
import {
  normaliseOnboardingSettings,
  rosterShiftInputSchema,
  rosterPublishInputSchema,
  rosterShiftUpdateInputSchema,
  staffAppAccessInputSchema,
  staffComplianceRecordInputSchema,
  staffInviteCompleteInputSchema,
  staffInviteCreateInputSchema,
  staffProfileCreateInputSchema,
  staffProfileUpdateInputSchema,
  staffReonboardInputSchema,
  timesheetApprovalInputSchema,
  timesheetCashPaymentInputSchema,
  timesheetCreateInputSchema,
  timesheetExportInputSchema,
  tipsCashEntryInputSchema,
  tipsCardImportInputSchema,
  tipsMarkPaidInputSchema,
  tipsPayoutInputSchema,
  tipsQuerySchema,
  timesheetUpdateInputSchema
} from '@alma/shared';
import type { OnboardingSettings } from '@alma/shared';
import { HttpError } from '../lib/http.js';
import { authService } from './auth.service.js';
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

function timesheetHours(entry: { clockInAt: Date; clockOutAt: Date; breakMinutes: number }) {
  return Math.max(0, (entry.clockOutAt.getTime() - entry.clockInAt.getTime()) / 36e5 - entry.breakMinutes / 60);
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
  async list() {
    return prisma.staffProfile.findMany({
      where: { employmentStatus: { not: 'ARCHIVED' } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      include: {
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
  },

  async getById(id: string) {
    const profile = await prisma.staffProfile.findUnique({
      where: { id },
      include: {
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

    return profile;
  },

  async create(input: unknown) {
    const data = staffProfileCreateInputSchema.parse(input);
    const email = normaliseEmail(data.email);

    if (email) {
      const existing = await prisma.staffProfile.findUnique({ where: { email } });
      if (existing) {
        throw new HttpError(409, 'A staff profile already exists for that email');
      }
    }

    return prisma.staffProfile.create({
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        roleTitle: data.roleTitle,
        email,
        phone: data.phone || null,
        venue: data.venue || null,
        employmentStatus: data.employmentStatus || 'ACTIVE',
        startDate: data.startDate ? new Date(data.startDate) : null,
        ...onboardingDetailCreateData(data),
        notes: data.notes || null,
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
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] },
        trainingRecords: { include: { module: true }, orderBy: [{ updatedAt: 'desc' }] }
      }
    });
  },

  async update(id: string, input: unknown) {
    const existing = await this.getById(id);
    const data = staffProfileUpdateInputSchema.parse(input);
    const email =
      data.email !== undefined ? normaliseEmail(data.email) : existing.email;

    if (email && email !== existing.email) {
      const conflict = await prisma.staffProfile.findUnique({ where: { email } });
      if (conflict) {
        throw new HttpError(409, 'A staff profile already exists for that email');
      }
    }

    return prisma.staffProfile.update({
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
        appAccess: { orderBy: [{ appId: 'asc' }] },
        records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] },
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] },
        trainingRecords: { include: { module: true }, orderBy: [{ updatedAt: 'desc' }] }
      }
    });
  },

  async delete(id: string) {
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

    return { id: archived.id, archived: true };
  },

  async addRecord(staffProfileId: string, input: unknown) {
    await this.getById(staffProfileId);
    const data = staffComplianceRecordInputSchema.parse(input);

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

  async updateAppAccess(staffProfileId: string, input: unknown) {
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
            notes: app.notes || null
          },
          create: {
            staffProfileId,
            appId: app.appId,
            status: app.status,
            role: app.role,
            notes: app.notes || null
          }
        })
      )
    );

    return this.getById(staffProfileId);
  },

  async listRoster(start?: string, end?: string, staffProfileId?: string) {
    const now = new Date();
    const startDate = start ? new Date(start) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

    return prisma.rosterShift.findMany({
      where: {
        startsAt: { lt: endDate },
        endsAt: { gt: startDate },
        ...(staffProfileId ? { staffProfileId } : {})
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
        }
      }
    });
  },

  async createRosterShift(input: unknown) {
    const data = rosterShiftInputSchema.parse(input);
    await this.getById(data.staffProfileId);

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
        venue: data.venue || null,
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

  async updateRosterShift(id: string, input: unknown) {
    const data = rosterShiftUpdateInputSchema.parse(input);
    const existing = await prisma.rosterShift.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Roster shift not found');

    if (data.staffProfileId) {
      await this.getById(data.staffProfileId);
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

    return prisma.rosterShift.update({
      where: { id },
      data: {
        ...(data.staffProfileId !== undefined && { staffProfileId: data.staffProfileId }),
        ...(data.venue !== undefined && { venue: data.venue || null }),
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

  async deleteRosterShift(id: string) {
    const existing = await prisma.rosterShift.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Roster shift not found');
    await prisma.rosterShift.delete({ where: { id } });
  },

  async publishRoster(input: unknown, publishedById?: string) {
    const data = rosterPublishInputSchema.parse(input);
    const startDate = new Date(data.start);
    const endDate = new Date(data.end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new HttpError(400, 'Roster publish dates are invalid');
    }
    if (endDate <= startDate) {
      throw new HttpError(400, 'Roster publish end date must be after the start date');
    }

    await prisma.rosterShift.updateMany({
      where: {
        status: 'DRAFT',
        startsAt: { lt: endDate },
        endsAt: { gt: startDate },
        ...(data.venue ? { venue: data.venue } : {})
      },
      data: { status: 'PUBLISHED' }
    });

    if (data.forecast) {
      await prisma.rosterForecastSnapshot.deleteMany({
        where: {
          weekStart: startDate,
          weekEnd: endDate,
          venue: data.venue || null
        }
      });
      await prisma.rosterForecastSnapshot.create({
        data: {
          weekStart: startDate,
          weekEnd: endDate,
          venue: data.venue || null,
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

    return this.listRoster(startDate.toISOString(), endDate.toISOString());
  },

  async listRosterForecastSnapshots(input: { start?: string; end?: string; venue?: string }) {
    const startDate = input.start ? parseDate(input.start, 'Roster forecast start date') : undefined;
    const endDate = input.end ? parseDate(input.end, 'Roster forecast end date') : undefined;
    const snapshots = await prisma.rosterForecastSnapshot.findMany({
      where: {
        ...(startDate && endDate
          ? {
              weekStart: { gte: startDate },
              weekEnd: { lte: endDate }
            }
          : {}),
        ...(input.venue ? { venue: input.venue } : {})
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

  async listTimesheets(start?: string, end?: string, status?: string, venue?: string, staffProfileId?: string) {
    const now = new Date();
    const startDate = start ? parseDate(start, 'Timesheet start date') : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const endDate = end ? parseDate(end, 'Timesheet end date') : new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000);

    return prisma.timesheet.findMany({
      where: {
        workDate: { gte: startDate, lt: endDate },
        ...(status && status !== 'all' ? { status: status as never } : {}),
        ...(venue && venue !== 'all' ? { venue } : {}),
        ...(staffProfileId ? { staffProfileId } : {})
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

  async createTimesheet(input: unknown, actorId?: string) {
    const data = timesheetCreateInputSchema.parse(input);
    await this.getById(data.staffProfileId);
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
        approvedById: data.status === 'APPROVED' ? actorId ?? null : null,
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

  async updateTimesheet(id: string, input: unknown) {
    const existing = await prisma.timesheet.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Timesheet not found');
    if (['APPROVED', 'EXPORTED'].includes(existing.status)) {
      throw new HttpError(400, 'Approved or exported timesheets cannot be edited');
    }
    const data = timesheetUpdateInputSchema.parse(input);
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

  async approveTimesheet(id: string, approverId: string) {
    const existing = await prisma.timesheet.findUnique({ where: { id } });
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

  async markTimesheetCashPaid(id: string, approverId: string, input: unknown) {
    const data = timesheetCashPaymentInputSchema.parse(input);
    const existing = await prisma.timesheet.findUnique({ where: { id } });
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

  async rejectTimesheet(id: string, input: unknown) {
    const existing = await prisma.timesheet.findUnique({ where: { id } });
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

  async exportTimesheetsForXero(input: unknown) {
    const data = timesheetExportInputSchema.parse(input);
    const startDate = parseDate(data.start, 'Export start date');
    const endDate = parseDate(data.end, 'Export end date');
    const entries = await prisma.timesheet.findMany({
      where: {
        status: 'APPROVED',
        paymentMethod: { not: 'CASH' },
        workDate: { gte: startDate, lt: endDate },
        ...(data.venue ? { venue: data.venue } : {})
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
  async createInvite(input: unknown) {
    const data = staffInviteCreateInputSchema.parse(input);
    const days = data.expiresInDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const email = normaliseEmail(data.email);
    const onboardingBaseUrl = normaliseBaseUrl(data.onboardingBaseUrl);

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
          roleTitle: data.roleTitle,
          email,
          venue: data.venue || null,
          employmentStatus: 'PENDING',
          notes: data.note || null
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
            roleTitle: data.roleTitle,
            venue: data.venue || null,
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

  async reonboardStaff(input: unknown) {
    const data = staffReonboardInputSchema.parse(input);
    const days = data.expiresInDays ?? 30;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const email = normaliseEmail(data.email);
    if (!email) throw new HttpError(400, 'Email is required');
    const onboardingBaseUrl = normaliseBaseUrl(data.onboardingBaseUrl);

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
              roleTitle: data.roleTitle?.trim() || 'Team member',
              email,
              venue: data.venue || null,
              employmentStatus: 'PENDING',
              notes: data.note || null
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
    const onboardingSettings = await getOnboardingSettings();
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
            roleTitle: data.roleTitle,
            email,
            phone: data.phone || null,
            venue: data.venue || null,
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
          data: { completedAt: new Date(), staffProfileId: profile.id }
        });

        return profile;
      }

      const existingProfile = await tx.staffProfile.findUnique({
        where: { id: invite.staffProfileId },
        select: { venue: true }
      });

      // Normal flow — fill in the pending profile.
      const profile = await tx.staffProfile.update({
        where: { id: invite.staffProfileId },
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          roleTitle: data.roleTitle,
          email,
          phone: data.phone || null,
          venue: data.venue || existingProfile?.venue || null,
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

      return profile;
    });
  },

  async approveRecord(staffProfileId: string, recordId: string) {
    await this.getById(staffProfileId);
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

  async approveOnboarding(staffProfileId: string) {
    const profile = await this.getById(staffProfileId);
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

    return prisma.staffProfile.update({
      where: { id: staffProfileId },
      data: { employmentStatus: 'ACTIVE' },
      include: {
        appAccess: { orderBy: [{ appId: 'asc' }] },
        records: { orderBy: [{ expiryDate: 'asc' }, { createdAt: 'desc' }] },
        rosterShifts: { orderBy: [{ startsAt: 'asc' }] }
      }
    });
  },

  async summary() {
    const now = new Date();
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [totalProfiles, expired, expiringSoon, pendingApproval] = await Promise.all([
      prisma.staffProfile.count({ where: { employmentStatus: { not: 'ARCHIVED' } } }),
      prisma.staffComplianceRecord.count({
        where: {
          OR: [
            { status: 'EXPIRED' },
            { expiryDate: { lt: now } }
          ]
        }
      }),
      prisma.staffComplianceRecord.count({
        where: {
          expiryDate: {
            gte: now,
            lte: soon
          }
        }
      }),
      prisma.staffComplianceRecord.count({ where: { status: 'PENDING' } })
    ]);

    return { totalProfiles, expired, expiringSoon, pendingApproval };
  }
};
