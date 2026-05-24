import { z } from 'zod';
import {
  AWARD_RATE_SETS,
  DEFAULT_STAFF_AWARD_CLASSIFICATION,
  DEFAULT_STAFF_AWARD_CODE,
  getAwardClassification,
  type AustralianAwardCode,
  type ManualFullTimePayFrequency,
  type StaffAwardEmploymentType,
  type StaffPayMode
} from './awardRates.js';

export {
  ALMA_COMPLIANCE_DOCUMENTS,
  ALMA_IMPORTED_CHECKLIST_TEMPLATES,
  type ImportedChecklistTemplate,
  type ImportedComplianceDocument
} from './complianceImports.js';

export {
  AWARD_RATE_EFFECTIVE_FROM,
  AWARD_RATE_SET_VERSION,
  AWARD_RATE_SETS,
  DEFAULT_STAFF_AWARD_CLASSIFICATION,
  DEFAULT_STAFF_AWARD_CODE,
  getAwardClassification,
  getAwardRateSet,
  type AustralianAwardCode,
  type AwardClassificationRate,
  type AwardRateSet,
  type ManualFullTimePayFrequency,
  type StaffAwardEmploymentType,
  type StaffPayMode
} from './awardRates.js';

const PASSWORD_MAX_LENGTH = 256;

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(PASSWORD_MAX_LENGTH, 'Password must be 256 characters or fewer');

export const issueStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED']);
export const issueSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const checklistRunStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']);
export const checklistItemResultSchema = z.enum(['PENDING', 'PASS', 'FAIL', 'NA']);
export const shiftTaskTypeSchema = z.enum(['CHECKLIST', 'STOCKTAKE', 'AUDIT', 'INCIDENT_CHECK']);
export const shiftTaskDueTimingSchema = z.enum([
  'BEFORE_SHIFT_START',
  'DURING_SHIFT',
  'BEFORE_SHIFT_END',
  'AFTER_SHIFT_END'
]);
export const shiftTaskAssignmentTargetSchema = z.enum([
  'ASSIGNED_STAFF',
  'VENUE_QUEUE',
  'MANAGER_ON_DUTY',
  'ALL_ON_SHIFT'
]);
export const shiftTaskAssignmentStatusSchema = z.enum([
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'OVERDUE',
  'CANCELLED'
]);
export const staffRecordTypeSchema = z.enum(['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER']);
export const staffRecordStatusSchema = z.enum(['REQUESTED', 'PENDING', 'UPLOADED', 'APPROVED', 'REJECTED', 'EXPIRED']);
export const staffHrRecordTypeSchema = z.enum(['CONTRACT', 'WARNING', 'PAY_CHANGE', 'RIGHT_TO_WORK', 'GENERAL']);
export const staffHrRecordStatusSchema = z.enum(['DRAFT', 'ISSUED', 'SENT', 'SIGNED', 'STORED', 'PENDING', 'APPROVED', 'EXPIRED', 'RE_REQUESTED']);
export const staffHrDocumentTemplateStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const incidentStatusSchema = z.enum(['OPEN', 'UNDER_REVIEW', 'CLOSED']);
export const temperatureAssetStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const temperatureLogSourceSchema = z.enum(['MANUAL', 'GOVEE']);
export const temperatureLogStatusSchema = z.enum(['IN_RANGE', 'OUT_OF_RANGE']);
export const stockItemStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const supplierStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const stocktakeStatusSchema = z.enum(['IN_PROGRESS', 'SUBMITTED']);
export const stockWastageReasonSchema = z.enum([
  'SPOILED',
  'BROKEN',
  'OVER_POURED',
  'KITCHEN_ERROR',
  'RETURNED',
  'EXPIRED',
  'STAFF_MEAL',
  'OTHER'
]);
export const stockDeliveryCheckStatusSchema = z.enum(['DRAFT', 'IN_REVIEW', 'COMPLETED', 'DISCREPANCY']);
export const stockReorderNoticeStatusSchema = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);
export const stockInvoiceMatchingStatusSchema = z.enum([
  'AUTO_MATCHED',
  'MANUAL_MATCHED',
  'NEEDS_REVIEW'
]);
export const almaAppIdSchema = z.enum(['COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'RESERVE', 'MARKETING', 'GIFTCARDS', 'TRAINING', 'SETTINGS']);
export const staffAppAccessStatusSchema = z.enum(['ENABLED', 'DISABLED', 'PENDING']);
export const staffAccountTypeSchema = z.enum(['HUMAN', 'VENUE_DEVICE']);
export const rosterShiftStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED']);
export const staffLeaveTypeSchema = z.enum(['ANNUAL', 'SICK', 'PERSONAL', 'UNPAID', 'OTHER']);
export const staffLeaveStatusSchema = z.enum(['PENDING', 'APPROVED', 'DECLINED', 'CANCELLED']);
export const timesheetStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED']);
export const staffClockSessionStatusSchema = z.enum(['OPEN', 'CLOSED', 'EXCEPTION']);
export const staffClockEventTypeSchema = z.enum(['CLOCK_IN', 'START_BREAK', 'END_BREAK', 'CLOCK_OUT', 'MANAGER_REVIEW']);
export const trainingModuleStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const staffTrainingStatusSchema = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']);
export const reserveReservationStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const reserveServicePeriodSchema = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'EVENT']);
export const marketingChannelSchema = z.enum(['EMAIL', 'SMS']);
export const marketingCampaignStatusSchema = z.enum(['DRAFT', 'READY', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED', 'ARCHIVED']);
export const guestTagTypeSchema = z.enum(['MANUAL', 'AUTOMATIC', 'SYSTEM', 'CUSTOM']);
export const guestTagAssignmentSourceSchema = z.enum(['MANUAL', 'AUTOMATIC', 'SYSTEM']);
export const marketingEmailTemplateStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const marketingAutomationTriggerTypeSchema = z.enum([
  'FIRST_VISIT_COMPLETED',
  'REPEAT_VISIT',
  'LAPSED_GUEST',
  'BIRTHDAY_UPCOMING',
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'NO_SHOW',
  'BIG_SPENDER'
]);
export const marketingAutomationRunStatusSchema = z.enum(['PENDING', 'SKIPPED', 'SENT', 'FAILED', 'SIMULATED']);
export const marketingContentAssetTypeSchema = z.enum(['IMAGE', 'VIDEO', 'DOCUMENT']);
export const marketingContentAssetStorageProviderSchema = z.enum(['LOCAL', 'CLOUD_STORAGE', 'EXTERNAL_URL']);
export const marketingContentAssetStatusSchema = z.enum(['DRAFT', 'READY', 'ARCHIVED']);
export const marketingContentAssetSourceSchema = z.enum(['UPLOAD', 'IMPORT', 'GENERATED']);
export const marketingContentPostStatusSchema = z.enum([
  'IDEA',
  'DRAFT',
  'NEEDS_REVIEW',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'CANCELLED',
  'ARCHIVED'
]);
export const socialPlatformSchema = z.enum(['FACEBOOK', 'INSTAGRAM', 'TIKTOK']);
export const marketingSocialAccountStatusSchema = z.enum(['SETUP_REQUIRED', 'CONNECTED', 'EXPIRED', 'DISABLED', 'ERROR']);
export const marketingContentPublishStatusSchema = z.enum(['SIMULATED', 'QUEUED', 'SKIPPED', 'PUBLISHED', 'FAILED']);
export const marketingContentPublishModeSchema = z.enum(['SIMULATION', 'LIVE']);
export const googleReserveIntegrationStatusSchema = z.enum(['SETUP_REQUIRED', 'PENDING', 'ACTIVE', 'ERROR']);
export const giftCardStatusSchema = z.enum(['PENDING_PAYMENT', 'ACTIVE', 'REDEEMED', 'CANCELLED', 'EXPIRED']);
export const giftCardRedemptionStatusSchema = z.enum(['COMPLETED', 'VOIDED']);

export const issueEvidenceInputSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  fileType: z.string().optional().or(z.literal(''))
});

export const issueCreateInputSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(3),
  severity: issueSeveritySchema,
  category: z.string().min(1),
  status: issueStatusSchema.default('OPEN'),
  assignee: z.string().optional().or(z.literal('')),
  dueDate: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  resolutionNotes: z.string().optional().or(z.literal('')),
  evidence: z.array(issueEvidenceInputSchema).optional()
});

export const issueUpdateInputSchema = issueCreateInputSchema;

export const issueActivityInputSchema = z.object({
  action: z.string().min(1),
  message: z.string().min(1),
  actor: z.string().min(1)
});

export const issueCompleteInputSchema = z.object({
  resolutionNotes: z.string().optional().or(z.literal(''))
});

export const checklistRunCreateInputSchema = z.object({
  templateId: z.string().min(1),
  performedBy: z.string().optional().or(z.literal('')),
  area: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const checklistTemplateItemInputSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional().or(z.literal('')),
  position: z.number().int().nonnegative().optional()
});

export const checklistTemplateInputSchema = z.object({
  name: z.string().min(2),
  area: z.string().optional().or(z.literal('')),
  items: z.array(checklistTemplateItemInputSchema).min(1)
});

const optionalMinutesOfDaySchema = z.coerce.number().int().min(0).max(24 * 60).optional();
const optionalDueOffsetMinutesSchema = z.coerce.number().int().min(-24 * 60).max(24 * 60).optional();
const daysOfWeekSchema = z.array(z.coerce.number().int().min(0).max(6)).max(7).optional();

export const shiftTaskRuleInputSchema = z.object({
  name: z.string().trim().min(2),
  enabled: z.boolean().optional().default(true),
  venue: z.string().trim().optional().or(z.literal('')),
  matchRoleTitle: z.string().trim().optional().or(z.literal('')),
  matchArea: z.string().trim().optional().or(z.literal('')),
  matchShiftLabel: z.string().trim().optional().or(z.literal('')),
  startBeforeMinutes: optionalMinutesOfDaySchema,
  startAfterMinutes: optionalMinutesOfDaySchema,
  endBeforeMinutes: optionalMinutesOfDaySchema,
  endAfterMinutes: optionalMinutesOfDaySchema,
  daysOfWeek: daysOfWeekSchema,
  taskType: shiftTaskTypeSchema.default('CHECKLIST'),
  checklistTemplateId: z.string().trim().optional().or(z.literal('')),
  stocktakeTemplate: z.string().trim().optional().or(z.literal('')),
  dueTiming: shiftTaskDueTimingSchema.default('DURING_SHIFT'),
  dueOffsetMinutes: optionalDueOffsetMinutesSchema,
  assignmentTarget: shiftTaskAssignmentTargetSchema.default('ASSIGNED_STAFF')
});

export const shiftTaskRuleUpdateInputSchema = shiftTaskRuleInputSchema.partial();

export const shiftTaskRulePreviewInputSchema = z.object({
  rule: shiftTaskRuleInputSchema,
  start: z.string().optional().or(z.literal('')),
  end: z.string().optional().or(z.literal('')),
  venue: z.string().trim().optional().or(z.literal(''))
});

export const checklistItemUpdateInputSchema = z.object({
  result: checklistItemResultSchema,
  notes: z.string().optional().or(z.literal('')),
  createIssue: z.boolean().optional(),
  issueTitle: z.string().optional().or(z.literal('')),
  issueCategory: z.string().optional().or(z.literal('')),
  issueSeverity: issueSeveritySchema.optional()
});

export const staffComplianceRecordInputSchema = z.object({
  recordType: staffRecordTypeSchema,
  title: z.string().min(2),
  issuer: z.string().optional().or(z.literal('')),
  certificateNumber: z.string().optional().or(z.literal('')),
  issueDate: z.string().optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  dueAt: z.string().optional().or(z.literal('')),
  status: staffRecordStatusSchema.default('PENDING'),
  documentName: z.string().optional().or(z.literal('')),
  documentUrl: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const staffHrRecordInputSchema = z.object({
  staffProfileId: z.string().min(1),
  recordType: staffHrRecordTypeSchema,
  title: z.string().trim().min(2).max(180),
  status: staffHrRecordStatusSchema.default('STORED'),
  issueDate: z.string().optional().or(z.literal('')),
  effectiveDate: z.string().optional().or(z.literal('')),
  expiryDate: z.string().optional().or(z.literal('')),
  followUpDate: z.string().optional().or(z.literal('')),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
  oldRateCents: z.coerce.number().int().nonnegative().optional(),
  newRateCents: z.coerce.number().int().nonnegative().optional(),
  documentName: z.string().trim().max(180).optional().or(z.literal('')),
  documentUrl: z.string().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal(''))
});

export const staffHrRecordUpdateSchema = staffHrRecordInputSchema
  .omit({ staffProfileId: true, recordType: true })
  .partial();

export const staffHrDocumentInputSchema = z.object({
  documentName: z.string().trim().min(1).max(180),
  documentUrl: z.string().min(1),
  status: staffHrRecordStatusSchema.optional()
});

export const staffHrRecordQuerySchema = z.object({
  staffProfileId: z.string().optional().or(z.literal('')),
  recordType: staffHrRecordTypeSchema.optional().or(z.literal('')),
  status: staffHrRecordStatusSchema.optional().or(z.literal(''))
});

export const staffHrDocumentTemplateVariableSchema = z.string().trim().min(1).max(80);
export const staffHrDocumentTemplateOptionalClauseSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(140),
  body: z.string().trim().max(4000),
  enabledByDefault: z.boolean().default(false)
});

export const staffHrDocumentTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(180),
  recordType: staffHrRecordTypeSchema,
  status: staffHrDocumentTemplateStatusSchema.default('DRAFT'),
  body: z.string().trim().min(10).max(20000),
  variables: z.array(staffHrDocumentTemplateVariableSchema).default([]),
  optionalClauses: z.array(staffHrDocumentTemplateOptionalClauseSchema).default([])
});

export const staffHrDocumentTemplateUpdateSchema = staffHrDocumentTemplateInputSchema.partial();

export const staffHrDocumentTemplatePreviewSchema = z.object({
  sampleData: z.record(z.string()).default({})
});

export const staffManagerNoteInputSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

const awardCodes = AWARD_RATE_SETS.map((award) => award.awardCode) as [AustralianAwardCode, ...AustralianAwardCode[]];
const staffAwardEmploymentTypes = ['CASUAL', 'PART_TIME', 'FULL_TIME'] as const satisfies readonly StaffAwardEmploymentType[];
const staffPayModes = ['AWARD', 'MANUAL_FULL_TIME'] as const satisfies readonly StaffPayMode[];
const manualFullTimePayFrequencies = ['ANNUAL_SALARY', 'HOURLY_FULL_TIME'] as const satisfies readonly ManualFullTimePayFrequency[];

export const staffAwardCodeSchema = z.enum(awardCodes);
export const staffAwardEmploymentTypeSchema = z.enum(staffAwardEmploymentTypes);
export const staffPayModeSchema = z.enum(staffPayModes);
export const manualFullTimePayFrequencySchema = z.enum(manualFullTimePayFrequencies);

export const staffPayProfileInputSchema = z.object({
  awardCode: staffAwardCodeSchema.default(DEFAULT_STAFF_AWARD_CODE),
  awardClassification: z.string().min(1).default(DEFAULT_STAFF_AWARD_CLASSIFICATION),
  employmentType: staffAwardEmploymentTypeSchema.default('CASUAL'),
  payMode: staffPayModeSchema.default('AWARD'),
  manualFullTimePayAmountCents: z.coerce.number().int().nonnegative().optional().nullable(),
  manualFullTimePayFrequency: manualFullTimePayFrequencySchema.optional().nullable(),
  manualFullTimePayNote: z.string().trim().max(1000).optional().or(z.literal(''))
}).superRefine((data, ctx) => {
  const isManual = data.employmentType === 'FULL_TIME' || data.payMode === 'MANUAL_FULL_TIME';
  if (isManual) {
    if (data.payMode !== 'MANUAL_FULL_TIME') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payMode'],
        message: 'Full-time staff require manual full-time pay mode.'
      });
    }
    if (!data.manualFullTimePayAmountCents || data.manualFullTimePayAmountCents <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manualFullTimePayAmountCents'],
        message: 'Manual full-time pay amount is required.'
      });
    }
    if (!data.manualFullTimePayFrequency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['manualFullTimePayFrequency'],
        message: 'Manual full-time pay frequency is required.'
      });
    }
  }

  if (!isManual && (data.manualFullTimePayAmountCents || data.manualFullTimePayFrequency || data.manualFullTimePayNote)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['manualFullTimePayAmountCents'],
      message: 'Manual full-time pay fields are only available for full-time manual pay.'
    });
  }
});

export const staffDefaultsInputSchema = z.object({
  defaultAwardCode: staffAwardCodeSchema.optional(),
  defaultAwardClassification: z.string().trim().optional().or(z.literal('')),
  defaultEmploymentType: staffAwardEmploymentTypeSchema.optional(),
  defaultRoleTitle: z.string().trim().max(80).optional().or(z.literal('')),
  defaultVenue: z.string().trim().max(120).optional().or(z.literal('')),
  defaultStaffAppRole: z.enum(['USER', 'MANAGER']).optional()
});

export type StaffDefaults = {
  defaultAwardCode: AustralianAwardCode;
  defaultAwardClassification: string;
  defaultEmploymentType: StaffAwardEmploymentType;
  defaultRoleTitle: string;
  defaultVenue: string;
  defaultStaffAppRole: 'USER' | 'MANAGER';
};

export const DEFAULT_STAFF_DEFAULTS: StaffDefaults = {
  defaultAwardCode: DEFAULT_STAFF_AWARD_CODE,
  defaultAwardClassification: DEFAULT_STAFF_AWARD_CLASSIFICATION,
  defaultEmploymentType: 'CASUAL',
  defaultRoleTitle: 'Staff',
  defaultVenue: '',
  defaultStaffAppRole: 'USER'
};

export function normaliseStaffDefaults(input: unknown): StaffDefaults {
  const parsed = staffDefaultsInputSchema.safeParse(input);
  const data = parsed.success ? parsed.data : {};
  const awardCode = data.defaultAwardCode ?? DEFAULT_STAFF_DEFAULTS.defaultAwardCode;
  const classification = getAwardClassification(
    awardCode,
    data.defaultAwardClassification || DEFAULT_STAFF_DEFAULTS.defaultAwardClassification
  );

  return {
    defaultAwardCode: awardCode,
    defaultAwardClassification: classification?.id ?? DEFAULT_STAFF_DEFAULTS.defaultAwardClassification,
    defaultEmploymentType:
      data.defaultEmploymentType && data.defaultEmploymentType !== 'FULL_TIME'
        ? data.defaultEmploymentType
        : DEFAULT_STAFF_DEFAULTS.defaultEmploymentType,
    defaultRoleTitle: data.defaultRoleTitle?.trim() || DEFAULT_STAFF_DEFAULTS.defaultRoleTitle,
    defaultVenue: data.defaultVenue?.trim() || '',
    defaultStaffAppRole: data.defaultStaffAppRole ?? DEFAULT_STAFF_DEFAULTS.defaultStaffAppRole
  };
}

export const staffMergeInputSchema = z.object({
  canonicalStaffProfileId: z.string().min(1),
  duplicateStaffProfileIds: z.array(z.string().min(1)).min(1),
  confirmation: z.string().trim()
}).superRefine((data, ctx) => {
  if (data.confirmation !== 'MERGE STAFF') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmation'],
      message: 'Type MERGE STAFF to confirm this staff merge.'
    });
  }

  if (data.duplicateStaffProfileIds.includes(data.canonicalStaffProfileId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['duplicateStaffProfileIds'],
      message: 'Duplicate profiles cannot include the profile being kept.'
    });
  }

  if (new Set(data.duplicateStaffProfileIds).size !== data.duplicateStaffProfileIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['duplicateStaffProfileIds'],
      message: 'Choose each duplicate profile only once.'
    });
  }
});

function leaveDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateLeaveRange(
  data: { startDate?: string; endDate?: string },
  ctx: z.RefinementCtx
) {
  if (!data.startDate || !data.endDate) return;
  const start = leaveDate(data.startDate);
  const end = leaveDate(data.endDate);
  if (!start || !end) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: !start ? ['startDate'] : ['endDate'],
      message: 'Use a valid leave date.'
    });
    return;
  }
  if (end < start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endDate'],
      message: 'Leave end date must be on or after the start date.'
    });
  }
}

export const staffLeaveRequestInputSchema = z.object({
  staffProfileId: z.string().min(1),
  type: staffLeaveTypeSchema.default('ANNUAL'),
  status: staffLeaveStatusSchema.default('PENDING'),
  startDate: z.string().min(4),
  endDate: z.string().min(4),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  managerNote: z.string().trim().max(1000).optional().or(z.literal(''))
}).superRefine(validateLeaveRange);

export const staffLeaveRequestUpdateSchema = z.object({
  staffProfileId: z.string().min(1).optional(),
  type: staffLeaveTypeSchema.optional(),
  status: staffLeaveStatusSchema.optional(),
  startDate: z.string().min(4).optional(),
  endDate: z.string().min(4).optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
  managerNote: z.string().trim().max(1000).optional().or(z.literal(''))
}).superRefine(validateLeaveRange);

export const staffProfileCreateInputSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  roleTemplateId: z.string().optional().or(z.literal('')),
  roleTitle: z.string().min(2).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  employmentStatus: z.string().optional().or(z.literal('')),
  startDate: z.string().optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  addressLine1: z.string().optional().or(z.literal('')),
  addressLine2: z.string().optional().or(z.literal('')),
  suburb: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  postcode: z.string().optional().or(z.literal('')),
  emergencyContactName: z.string().optional().or(z.literal('')),
  emergencyContactRelationship: z.string().optional().or(z.literal('')),
  emergencyContactPhone: z.string().optional().or(z.literal('')),
  employmentType: z.string().optional().or(z.literal('')),
  payType: z.string().optional().or(z.literal('')),
  payRateCents: z.coerce.number().int().nonnegative().optional(),
  payAward: z.string().optional().or(z.literal('')),
  taxFileNumber: z.string().optional().or(z.literal('')),
  taxResidencyStatus: z.string().optional().or(z.literal('')),
  taxFreeThreshold: z.boolean().optional(),
  hasStudyTrainingLoan: z.boolean().optional(),
  superFundName: z.string().optional().or(z.literal('')),
  superFundAbn: z.string().optional().or(z.literal('')),
  superFundUsi: z.string().optional().or(z.literal('')),
  superMemberNumber: z.string().optional().or(z.literal('')),
  bankAccountName: z.string().optional().or(z.literal('')),
  bankBsb: z.string().optional().or(z.literal('')),
  bankAccountNumber: z.string().optional().or(z.literal('')),
  visaStatus: z.string().optional().or(z.literal('')),
  visaSubclass: z.string().optional().or(z.literal('')),
  visaExpiryDate: z.string().optional().or(z.literal('')),
  workRightsNotes: z.string().optional().or(z.literal('')),
  xeroEmployeeId: z.string().optional().or(z.literal('')),
  xeroPayrollCalendarId: z.string().optional().or(z.literal('')),
  xeroEarningsRateId: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  records: z.array(staffComplianceRecordInputSchema).optional()
});

export const staffProfileUpdateInputSchema = staffProfileCreateInputSchema.partial();

export const staffInviteCreateInputSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  roleTemplateId: z.string().optional().or(z.literal('')),
  roleTitle: z.string().min(2).optional().or(z.literal('')),
  email: z.string().email().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  note: z.string().optional().or(z.literal('')),
  onboardingBaseUrl: z.string().url().optional().or(z.literal('')),
  expiresInDays: z.number().int().positive().optional()
});

export const staffReonboardInputSchema = z.object({
  email: z.string().email(),
  firstName: z.string().optional().or(z.literal('')),
  lastName: z.string().optional().or(z.literal('')),
  roleTemplateId: z.string().optional().or(z.literal('')),
  roleTitle: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  note: z.string().optional().or(z.literal('')),
  onboardingBaseUrl: z.string().url().optional().or(z.literal('')),
  expiresInDays: z.number().int().positive().optional()
});

export const staffProfileReonboardInputSchema = z.object({
  note: z.string().optional().or(z.literal('')),
  onboardingBaseUrl: z.string().url().optional().or(z.literal('')),
  expiresInDays: z.number().int().positive().optional()
});

export const staffInviteCompleteInputSchema = staffProfileCreateInputSchema.extend({
  password: passwordSchema
});

const onboardingStepInputSchema = z.object({
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  label: z.string().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal(''))
});

export const onboardingSettingsInputSchema = z.object({
  taxDeclaration: onboardingStepInputSchema.optional(),
  superannuationChoice: onboardingStepInputSchema.optional(),
  rightToWorkDocuments: onboardingStepInputSchema.optional(),
  bankAccountConfirmation: onboardingStepInputSchema.optional()
});

export type OnboardingStepSettings = {
  enabled: boolean;
  required: boolean;
  label: string;
  description: string;
};

export type OnboardingSettings = {
  taxDeclaration: OnboardingStepSettings;
  superannuationChoice: OnboardingStepSettings;
  rightToWorkDocuments: OnboardingStepSettings;
  bankAccountConfirmation: OnboardingStepSettings;
};

export const DEFAULT_ONBOARDING_SETTINGS: OnboardingSettings = {
  taxDeclaration: {
    enabled: true,
    required: true,
    label: 'Tax declaration',
    description: 'Collect tax file number, residency status, tax-free threshold, and study or training loan declarations as a web form.'
  },
  superannuationChoice: {
    enabled: true,
    required: true,
    label: 'Superannuation choice',
    description: 'Collect super fund name, ABN, USI, and member number as a web form.'
  },
  rightToWorkDocuments: {
    enabled: true,
    required: false,
    label: 'Right-to-work document',
    description: 'Optional upload for passport, visa evidence, citizenship evidence, or other work-rights support.'
  },
  bankAccountConfirmation: {
    enabled: true,
    required: false,
    label: 'Bank account confirmation',
    description: 'Optional upload for bank account proof or payroll bank-details confirmation.'
  }
};

function normaliseOnboardingStep(
  input: Partial<OnboardingStepSettings> | undefined,
  fallback: OnboardingStepSettings
): OnboardingStepSettings {
  const label = input?.label?.trim() || fallback.label;
  return {
    enabled: input?.enabled ?? fallback.enabled,
    required: input?.required ?? fallback.required,
    label,
    description: input?.description?.trim() ?? fallback.description
  };
}

export function normaliseOnboardingSettings(input: unknown): OnboardingSettings {
  const parsed = onboardingSettingsInputSchema.safeParse(input);
  const data = parsed.success ? parsed.data : {};

  return {
    taxDeclaration: normaliseOnboardingStep(data.taxDeclaration, DEFAULT_ONBOARDING_SETTINGS.taxDeclaration),
    superannuationChoice: normaliseOnboardingStep(
      data.superannuationChoice,
      DEFAULT_ONBOARDING_SETTINGS.superannuationChoice
    ),
    rightToWorkDocuments: normaliseOnboardingStep(
      data.rightToWorkDocuments,
      DEFAULT_ONBOARDING_SETTINGS.rightToWorkDocuments
    ),
    bankAccountConfirmation: normaliseOnboardingStep(
      data.bankAccountConfirmation,
      DEFAULT_ONBOARDING_SETTINGS.bankAccountConfirmation
    )
  };
}

export const staffAppAccessInputSchema = z.object({
  apps: z.array(z.object({
    appId: almaAppIdSchema,
    status: staffAppAccessStatusSchema,
    role: z.string().min(1).default('USER'),
    permissions: z.record(z.string(), z.boolean()).optional().default({}),
    notes: z.string().optional().or(z.literal(''))
  }))
});

export const staffRoleTemplateAccessInputSchema = z.object({
  appId: almaAppIdSchema,
  status: staffAppAccessStatusSchema,
  role: z.string().trim().min(1).default('USER'),
  permissions: z.record(z.string(), z.boolean()).optional().default({})
});

export const staffRoleTemplateInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  roleTitle: z.string().trim().max(120).optional().or(z.literal('')),
  venue: z.string().trim().max(120).optional().or(z.literal('')),
  isActive: z.boolean().optional().default(true),
  access: z.array(staffRoleTemplateAccessInputSchema).default([])
});

export const staffRoleTemplateUpdateInputSchema = staffRoleTemplateInputSchema.partial();

export const staffRoleTemplateApplyInputSchema = z.object({
  roleTemplateId: z.string().min(1)
});

export const adminAccessUserCreateInputSchema = z.object({
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  email: z.string().email().optional().or(z.literal('')),
  venue: z.string().trim().optional().or(z.literal('')),
  roleTitle: z.string().trim().optional().or(z.literal('')),
  staffRole: z.enum(['USER', 'MANAGER', 'ADMIN']).default('USER'),
  enableStaffApp: z.boolean().default(true)
});

export const adminStaffCostingQuerySchema = z.object({
  start: z.string().optional().or(z.literal('')),
  end: z.string().optional().or(z.literal('')),
  venue: z.string().trim().optional().or(z.literal('')),
  source: z.enum(['actual', 'scheduled', 'combined']).default('combined')
});

const pinSchema = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');

export const adminVenueDeviceCreateInputSchema = z.object({
  displayName: z.string().trim().min(2),
  email: z.string().email(),
  venue: z.string().trim().min(1),
  enabled: z.boolean().default(true)
});

export const adminVenueDeviceUpdateInputSchema = z.object({
  displayName: z.string().trim().min(2).optional(),
  email: z.string().email().optional(),
  venue: z.string().trim().min(1).optional(),
  enabled: z.boolean().optional()
});

export const devicePinLoginInputSchema = z.object({
  staffProfileId: z.string().min(1),
  pin: pinSchema
});

export const staffPinChangeInputSchema = z.object({
  currentPin: pinSchema.optional(),
  newPin: pinSchema
});

export const staffPinResetInputSchema = z.object({
  pin: pinSchema
});

export const adminAccessBulkUpdateInputSchema = z.object({
  staffProfileIds: z.array(z.string().min(1)).min(1),
  appIds: z.array(almaAppIdSchema).min(1),
  status: staffAppAccessStatusSchema,
  role: z.enum(['USER', 'MANAGER', 'ADMIN']),
  permissions: z.record(z.string(), z.boolean()).default({}),
  permissionMode: z.enum(['MERGE', 'REPLACE']).default('MERGE'),
  notes: z.string().trim().optional().or(z.literal(''))
});

export const suiteAnnouncementInputSchema = z.object({
  title: z.string().min(2),
  body: z.string().min(1),
  audience: z.string().optional().or(z.literal('')).default('ALL'),
  appId: almaAppIdSchema.optional(),
  venue: z.string().optional().or(z.literal('')),
  pinned: z.boolean().optional().default(false),
  expiresAt: z.string().optional().or(z.literal(''))
});

export const suiteAnnouncementUpdateSchema = suiteAnnouncementInputSchema.partial();

export const suiteChatChannelTypeSchema = z.enum(['GENERAL', 'VENUE', 'AREA', 'GROUP', 'DIRECT']);

export const suiteChatChannelInputSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(240).optional().or(z.literal('')),
  channelKey: z.string().max(120).optional().or(z.literal('')),
  type: suiteChatChannelTypeSchema.default('GROUP'),
  appId: almaAppIdSchema.optional(),
  venue: z.string().optional().or(z.literal('')),
  groupKey: z.string().max(80).optional().or(z.literal('')),
  isActive: z.boolean().optional().default(true),
  readPermission: z.string().max(80).optional().or(z.literal('')),
  postPermission: z.string().max(80).optional().or(z.literal('')),
  directMessagesAllowed: z.boolean().optional().default(false)
});

export const suiteChatChannelUpdateSchema = suiteChatChannelInputSchema.partial();

export const suiteChatMessageInputSchema = z.object({
  channel: z.string().optional().or(z.literal('')).default('general'),
  channelId: z.string().optional().or(z.literal('')),
  channelType: suiteChatChannelTypeSchema.optional(),
  appId: almaAppIdSchema.optional(),
  venue: z.string().optional().or(z.literal('')),
  recipientId: z.string().optional().or(z.literal('')),
  body: z.string().min(1).max(2000)
});

export const suiteChatMessageUpdateSchema = z.object({
  body: z.string().min(1).max(2000)
});

export const rosterShiftInputSchema = z.object({
  staffProfileId: z.string().min(1),
  venue: z.string().optional().or(z.literal('')),
  area: z.string().optional().or(z.literal('')),
  roleTitle: z.string().optional().or(z.literal('')),
  startsAt: z.string().min(4),
  endsAt: z.string().min(4),
  breakMinutes: z.coerce.number().int().nonnegative().default(0),
  status: rosterShiftStatusSchema.default('DRAFT'),
  notes: z.string().optional().or(z.literal(''))
});

export const rosterShiftUpdateInputSchema = rosterShiftInputSchema.partial();

export const rosterPublishInputSchema = z.object({
  start: z.string().min(4),
  end: z.string().min(4),
  venue: z.string().optional().or(z.literal('')),
  forecast: z.object({
    source: z.string().optional().or(z.literal('')),
    targetWagePercent: z.coerce.number().nonnegative(),
    forecastSalesCents: z.coerce.number().int().nonnegative(),
    wageBudgetCents: z.coerce.number().int().nonnegative(),
    rosterCostCents: z.coerce.number().int().nonnegative(),
    plannedHours: z.coerce.number().nonnegative(),
    recommendedHours: z.coerce.number().nonnegative(),
    dailySalesCents: z.record(z.string(), z.coerce.number().int().nonnegative()).default({}),
    venueBreakdown: z.array(z.object({
      venue: z.string(),
      source: z.string().nullable().optional(),
      salesCents: z.coerce.number().int().nonnegative(),
      historicalSalesCents: z.coerce.number().int().nonnegative(),
      budgetCents: z.coerce.number().int().nonnegative(),
      plannedCostCents: z.coerce.number().int().nonnegative(),
      plannedHours: z.coerce.number().nonnegative(),
      recommendedHours: z.coerce.number().nonnegative(),
      costGapCents: z.coerce.number(),
      hoursGap: z.coerce.number()
    })).default([]),
    areaBreakdown: z.array(z.object({
      venue: z.string(),
      area: z.string(),
      plannedHours: z.coerce.number().nonnegative(),
      recommendedHours: z.coerce.number().nonnegative(),
      gap: z.coerce.number(),
      day: z.string().optional(),
      dayGap: z.coerce.number().optional()
    })).default([])
  }).optional()
});

export const timesheetCreateInputSchema = z.object({
  staffProfileId: z.string().min(1),
  rosterShiftId: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  area: z.string().optional().or(z.literal('')),
  roleTitle: z.string().optional().or(z.literal('')),
  workDate: z.string().min(4),
  clockInAt: z.string().min(4),
  clockOutAt: z.string().min(4),
  breakMinutes: z.coerce.number().int().nonnegative().default(0),
  notes: z.string().optional().or(z.literal('')),
  status: timesheetStatusSchema.default('SUBMITTED'),
  xeroEmployeeId: z.string().optional().or(z.literal('')),
  xeroEarningsRateId: z.string().optional().or(z.literal('')),
  paymentMethod: z.enum(['XERO', 'CASH']).default('XERO')
});

export const timesheetUpdateInputSchema = timesheetCreateInputSchema.partial();

export const staffShiftConfirmationInputSchema = z.object({
  note: z.string().trim().max(500).optional().or(z.literal(''))
});

export const staffClockInInputSchema = z.object({
  rosterShiftId: z.string().optional().or(z.literal(''))
});

export const staffClockOutInputSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal(''))
});

export const staffClockBreakInputSchema = z.object({
  note: z.string().trim().max(1000).optional().or(z.literal(''))
});

export const staffOwnLeaveRequestInputSchema = z.object({
  type: staffLeaveTypeSchema.default('ANNUAL'),
  startDate: z.string().min(4),
  endDate: z.string().min(4),
  notes: z.string().trim().max(1000).optional().or(z.literal(''))
}).superRefine(validateLeaveRange);

export const timesheetApprovalInputSchema = z.object({
  reason: z.string().optional().or(z.literal(''))
});

export const timesheetCashPaymentInputSchema = z.object({
  notes: z.string().optional().or(z.literal(''))
});

export const timesheetExportInputSchema = z.object({
  start: z.string().min(4),
  end: z.string().min(4),
  venue: z.string().optional().or(z.literal('')),
  markExported: z.boolean().default(false)
});

export const tipsQuerySchema = z.object({
  start: z.string().min(4),
  end: z.string().min(4),
  venue: z.string().optional().or(z.literal(''))
});

export const salesActualQuerySchema = z.object({
  start: z.string().min(4),
  end: z.string().min(4),
  venue: z.string().optional().or(z.literal(''))
});

export const reportsMenuProfitabilityQuerySchema = salesActualQuerySchema.extend({
  accountKey: z.enum(['all', 'primary', 'secondary']).default('all'),
  category: z.string().trim().optional().or(z.literal('')),
  mappingStatus: z.enum(['all', 'mapped', 'unmapped', 'missing_recipe', 'missing_cost']).default('all')
});

export const salesActualImportSchema = z.object({
  source: z.string().min(1).default('manual'),
  rows: z.array(z.object({
    venue: z.string().min(1),
    serviceDate: z.string().min(4),
    salesCents: z.coerce.number().int().nonnegative(),
    externalId: z.string().optional().or(z.literal('')),
    notes: z.string().optional().or(z.literal(''))
  })).min(1).max(500)
});

export const tipsCashEntryInputSchema = z.object({
  venue: z.string().min(1),
  serviceDate: z.string().min(4),
  amountCents: z.coerce.number().int().nonnegative(),
  notes: z.string().optional().or(z.literal(''))
});

export const tipsCardImportRowSchema = z.object({
  venue: z.string().min(1),
  serviceDate: z.string().min(4),
  amountCents: z.coerce.number().int().nonnegative(),
  source: z.string().min(1).default('control'),
  externalId: z.string().optional().or(z.literal('')),
  importKey: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const tipsCardImportInputSchema = z.object({
  rows: z.array(tipsCardImportRowSchema).min(1).max(500)
});

export const tipsAdjustmentInputSchema = z.object({
  staffProfileId: z.string().min(1),
  adjustmentCents: z.coerce.number().int().default(0),
  excluded: z.boolean().default(false),
  notes: z.string().optional().or(z.literal(''))
});

export const tipsPayoutInputSchema = tipsQuerySchema.extend({
  adjustments: z.array(tipsAdjustmentInputSchema).default([])
});

export const tipsMarkPaidInputSchema = tipsQuerySchema.extend({
  adjustments: z.array(tipsAdjustmentInputSchema).default([]),
  notes: z.string().optional().or(z.literal(''))
});

export const trainingModuleInputSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().or(z.literal('')),
  category: z.string().optional().or(z.literal('')),
  level: z.coerce.number().int().min(1).max(20).default(1),
  estimatedMinutes: z.coerce.number().int().positive().optional(),
  status: trainingModuleStatusSchema.default('ACTIVE')
});

export const trainingPayRuleInputSchema = z.object({
  level: z.coerce.number().int().min(1).max(20),
  label: z.string().min(2),
  payRateCents: z.coerce.number().int().nonnegative(),
  notes: z.string().optional().or(z.literal(''))
});

export const reserveGuestInputSchema = z.object({
  venue: z.string().min(1).optional().or(z.literal('')),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  birthday: z.string().optional().or(z.literal('')),
  tags: z.array(z.string()).default([]),
  allergyNotes: z.string().optional().or(z.literal('')),
  visitNotes: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  dietaryNotes: z.string().optional().or(z.literal('')),
  preferences: z.record(z.string(), z.unknown()).optional(),
  marketingOptIn: z.boolean().default(false),
  source: z.string().optional().or(z.literal(''))
});

export const reserveTableInputSchema = z.object({
  venue: z.string().min(1),
  area: z.string().min(1),
  label: z.string().min(1),
  minCovers: z.coerce.number().int().positive().default(1),
  maxCovers: z.coerce.number().int().positive(),
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true)
});

export const reserveGuestUpdateInputSchema = reserveGuestInputSchema.partial();

export const reserveReservationInputSchema = z.object({
  venue: z.string().min(1),
  serviceDate: z.string().min(4),
  servicePeriod: reserveServicePeriodSchema,
  startsAt: z.string().min(4),
  endsAt: z.string().min(4),
  covers: z.coerce.number().int().positive(),
  status: reserveReservationStatusSchema.default('PENDING'),
  source: z.string().optional().or(z.literal('')),
  tableId: z.string().optional().or(z.literal('')),
  guestId: z.string().optional().or(z.literal('')),
  availabilityRuleId: z.string().optional().or(z.literal('')),
  guest: reserveGuestInputSchema.optional(),
  guestName: z.string().optional().or(z.literal('')),
  guestEmail: z.string().email().optional().or(z.literal('')),
  guestPhone: z.string().optional().or(z.literal('')),
  occasion: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  specialRequests: z.string().optional().or(z.literal('')),
  internalNotes: z.string().optional().or(z.literal('')),
  marketingOptIn: z.boolean().default(false)
});

export const reserveReservationUpdateInputSchema = reserveReservationInputSchema.partial();

const reserveAvailabilityRuleBaseSchema = z.object({
  venue: z.string().min(1),
  name: z.string().min(2),
  servicePeriod: reserveServicePeriodSchema.optional().nullable().or(z.literal('')),
  active: z.boolean().default(true),
  defaultDurationMinutes: z.coerce.number().int().min(30).max(480).default(120),
  minPartySize: z.coerce.number().int().min(1).max(50).default(1),
  maxPartySize: z.coerce.number().int().min(1).max(50),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  intervalMinutes: z.coerce.number().int().min(15).max(240).default(30),
  capacity: z.coerce.number().int().positive(),
  onlineEnabled: z.boolean().default(true),
  googleReserveEnabled: z.boolean().default(false)
});

export const reserveAvailabilityRuleInputSchema = reserveAvailabilityRuleBaseSchema.superRefine((data, ctx) => {
  if (data.maxPartySize < data.minPartySize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPartySize'],
      message: 'Max party size must be at least the minimum party size.'
    });
  }
  if (data.endTime <= data.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'End time must be after start time.'
    });
  }
});

export const reserveAvailabilityRuleUpdateInputSchema = reserveAvailabilityRuleBaseSchema.partial().superRefine((data, ctx) => {
  if (
    data.minPartySize !== undefined &&
    data.maxPartySize !== undefined &&
    data.maxPartySize < data.minPartySize
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxPartySize'],
      message: 'Max party size must be at least the minimum party size.'
    });
  }
  if (data.startTime && data.endTime && data.endTime <= data.startTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'End time must be after start time.'
    });
  }
});

export const reserveBlackoutInputSchema = z.object({
  venue: z.string().min(1),
  name: z.string().min(2),
  reason: z.string().optional().or(z.literal('')),
  startAt: z.string().min(4),
  endAt: z.string().min(4)
});

export const reservePublicAvailabilityInputSchema = z.object({
  venue: z.string().min(1),
  date: z.string().min(4),
  partySize: z.coerce.number().int().min(1).max(20),
  servicePeriod: reserveServicePeriodSchema.optional().nullable().or(z.literal(''))
});

export const reservePublicBookingInputSchema = z.object({
  venue: z.string().min(1),
  availabilityRuleId: z.string().optional().or(z.literal('')),
  serviceDate: z.string().min(4),
  startsAt: z.string().min(4),
  partySize: z.coerce.number().int().min(1).max(20),
  durationMinutes: z.coerce.number().int().min(30).max(480).default(120),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(6),
  birthday: z.string().optional().or(z.literal('')),
  anniversary: z.string().optional().or(z.literal('')),
  occasion: z.string().optional().or(z.literal('')),
  dietaryNotes: z.string().optional().or(z.literal('')),
  seatingPreference: z.string().optional().or(z.literal('')),
  highChair: z.boolean().default(false),
  accessibility: z.boolean().default(false),
  outdoorSeating: z.boolean().default(false),
  barSeating: z.boolean().default(false),
  specialRequests: z.string().optional().or(z.literal('')),
  marketingOptIn: z.boolean().default(false)
});

export const marketingSegmentDefinitionSchema = z.object({
  search: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  guestIds: z.array(z.string().min(1)).default([]),
  tagIds: z.array(z.string().min(1)).default([]),
  excludedTagIds: z.array(z.string().min(1)).default([]),
  marketingOptInOnly: z.boolean().default(false),
  emailOnly: z.boolean().default(false),
  includeUnsubscribed: z.boolean().default(false),
  minVisits: z.coerce.number().int().nonnegative().optional(),
  maxVisits: z.coerce.number().int().nonnegative().optional(),
  maxDaysSinceVisit: z.coerce.number().int().nonnegative().optional(),
  lastVisitOlderThanDays: z.coerce.number().int().nonnegative().optional(),
  lastVisitWithinDays: z.coerce.number().int().nonnegative().optional(),
  birthdaysWithinDays: z.coerce.number().int().positive().max(365).optional(),
  minSpendCents: z.coerce.number().int().nonnegative().optional(),
  hasUpcomingReservation: z.boolean().optional(),
  hasGiftCardPurchase: z.boolean().optional()
});

export const marketingContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  source: z.string().optional().or(z.literal('')),
  tags: z.array(z.string()).default([]),
  consentEmail: z.boolean().default(false),
  consentSms: z.boolean().default(false),
  totalVisits: z.coerce.number().int().nonnegative().default(0),
  lastVisitAt: z.string().optional().or(z.literal('')),
  allergyNotes: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  reserveGuestId: z.string().optional().or(z.literal(''))
});

export const marketingContactUpdateInputSchema = marketingContactInputSchema.partial();

export const marketingSegmentInputSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  rules: marketingSegmentDefinitionSchema.default({}),
  isActive: z.boolean().default(true)
});

export const marketingTagInputSchema = z.object({
  venue: z.string().optional().or(z.literal('')),
  name: z.string().min(2),
  slug: z.string().optional().or(z.literal('')),
  description: z.string().optional().or(z.literal('')),
  type: guestTagTypeSchema.default('MANUAL'),
  color: z.string().optional().or(z.literal('')),
  ruleDefinition: marketingSegmentDefinitionSchema.optional(),
  active: z.boolean().default(true)
});

export const marketingTagUpdateInputSchema = marketingTagInputSchema.partial();

export const marketingGuestTagAssignmentInputSchema = z.object({
  tagId: z.string().min(1)
});

export const marketingTemplateInputSchema = z.object({
  venue: z.string().optional().or(z.literal('')),
  name: z.string().min(2),
  subject: z.string().min(2),
  previewText: z.string().optional().or(z.literal('')),
  htmlBody: z.string().min(5),
  textBody: z.string().optional().or(z.literal('')),
  status: marketingEmailTemplateStatusSchema.default('DRAFT')
});

export const marketingTemplateUpdateInputSchema = marketingTemplateInputSchema.partial();

export const marketingCampaignInputSchema = z.object({
  venue: z.string().min(1),
  name: z.string().min(2),
  channel: marketingChannelSchema.default('EMAIL'),
  status: marketingCampaignStatusSchema.default('DRAFT'),
  audienceName: z.string().optional().or(z.literal('')),
  subject: z.string().optional().or(z.literal('')),
  previewText: z.string().optional().or(z.literal('')),
  body: z.string().min(5),
  textBody: z.string().optional().or(z.literal('')),
  scheduledFor: z.string().optional().or(z.literal('')),
  guestIds: z.array(z.string().min(1)).default([]),
  contactIds: z.array(z.string().min(1)).default([]),
  segmentDefinition: marketingSegmentDefinitionSchema.default({})
});

export const marketingCampaignUpdateInputSchema = marketingCampaignInputSchema.partial();

export const marketingSegmentPreviewInputSchema = z.object({
  venue: z.string().optional().or(z.literal('')),
  channel: marketingChannelSchema.default('EMAIL'),
  segmentDefinition: marketingSegmentDefinitionSchema.default({})
});

export const marketingAutomationInputSchema = z.object({
  venue: z.string().min(1),
  name: z.string().min(2),
  triggerType: marketingAutomationTriggerTypeSchema,
  segmentDefinition: marketingSegmentDefinitionSchema.default({}),
  emailTemplateId: z.string().optional().or(z.literal('')),
  delayHours: z.coerce.number().int().min(0).max(24 * 365).default(0),
  active: z.boolean().default(false)
});

export const marketingAutomationUpdateInputSchema = marketingAutomationInputSchema.partial();

export const marketingContentAssetInputSchema = z.object({
  venue: z.string().min(1),
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  assetType: marketingContentAssetTypeSchema,
  mimeType: z.string().trim().min(3).max(120),
  fileName: z.string().trim().min(1).max(240),
  fileSizeBytes: z.coerce.number().int().nonnegative().max(250 * 1024 * 1024),
  storageProvider: marketingContentAssetStorageProviderSchema.default('EXTERNAL_URL'),
  storagePath: z.string().trim().max(1000).optional().or(z.literal('')),
  publicUrl: z.string().trim().url().optional().or(z.literal('')),
  thumbnailUrl: z.string().trim().url().optional().or(z.literal('')),
  width: z.coerce.number().int().positive().optional().nullable(),
  height: z.coerce.number().int().positive().optional().nullable(),
  durationSeconds: z.coerce.number().int().positive().optional().nullable(),
  status: marketingContentAssetStatusSchema.default('READY'),
  tags: z.array(z.string().trim().min(1).max(50)).default([]),
  source: marketingContentAssetSourceSchema.default('UPLOAD')
});

export const marketingContentAssetUpdateInputSchema = marketingContentAssetInputSchema.partial();

export const marketingContentPostInputSchema = z.object({
  venue: z.string().min(1),
  title: z.string().trim().min(2).max(160),
  caption: z.string().trim().min(1).max(2200),
  status: marketingContentPostStatusSchema.default('DRAFT'),
  scheduledAt: z.string().optional().or(z.literal('')),
  campaignId: z.string().optional().or(z.literal('')),
  targetChannels: z.array(socialPlatformSchema).min(1).default(['FACEBOOK']),
  contentPillar: z.string().trim().max(80).optional().or(z.literal('')),
  approvalRequired: z.boolean().default(true)
});

export const marketingContentPostUpdateInputSchema = marketingContentPostInputSchema.partial();

export const marketingContentPostAssetInputSchema = z.object({
  assetId: z.string().min(1),
  sortOrder: z.coerce.number().int().nonnegative().default(0)
});

export const marketingContentScheduleInputSchema = z.object({
  scheduledAt: z.string().min(4)
});

export const marketingSocialAccountInputSchema = z.object({
  venue: z.string().min(1),
  platform: socialPlatformSchema,
  displayName: z.string().trim().min(2).max(120),
  handle: z.string().trim().max(120).optional().or(z.literal('')),
  externalAccountId: z.string().trim().max(180).optional().or(z.literal('')),
  status: marketingSocialAccountStatusSchema.default('SETUP_REQUIRED'),
  scopes: z.array(z.string().trim().min(1).max(120)).default([]),
  tokenSecretRef: z.string().trim().max(240).optional().or(z.literal('')),
  lastError: z.string().trim().max(1000).optional().or(z.literal(''))
});

export const marketingSocialAccountUpdateInputSchema = marketingSocialAccountInputSchema.partial();

export const googleReserveIntegrationSettingInputSchema = z.object({
  venue: z.string().min(1),
  enabled: z.boolean().default(false),
  merchantId: z.string().optional().or(z.literal('')),
  integrationStatus: googleReserveIntegrationStatusSchema.default('SETUP_REQUIRED'),
  lastError: z.string().optional().or(z.literal(''))
});

export const giftCardCheckoutInputSchema = z.object({
  amountCents: z.coerce.number().int().min(1000).max(200000),
  purchaserName: z.string().min(2),
  purchaserEmail: z.string().email(),
  recipientName: z.string().optional().or(z.literal('')),
  recipientEmail: z.string().email().optional().or(z.literal('')),
  message: z.string().max(500).optional().or(z.literal('')),
  promoCode: z.string().max(40).optional().or(z.literal('')),
  successUrl: z.string().url().optional().or(z.literal('')),
  cancelUrl: z.string().url().optional().or(z.literal(''))
});

export const giftCardLookupInputSchema = z.object({
  code: z.string().min(4)
});

export const giftCardRedemptionInputSchema = z.object({
  code: z.string().min(4),
  amountCents: z.coerce.number().int().positive(),
  venue: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const giftCardCancelInputSchema = z.object({
  reason: z.string().min(3).max(500),
  refundNote: z.string().max(500).optional().or(z.literal(''))
});

export const giftCardPromoDiscountTypeSchema = z.enum(['PERCENT', 'FIXED_AMOUNT']);

export const giftCardPromoCodeInputSchema = z.object({
  code: z.string().min(3).max(40),
  description: z.string().max(160).optional().or(z.literal('')),
  discountType: giftCardPromoDiscountTypeSchema,
  percentOff: z.coerce.number().int().min(1).max(95).optional(),
  amountOffCents: z.coerce.number().int().min(100).max(200000).optional(),
  isActive: z.boolean().optional().default(true),
  startsAt: z.string().optional().or(z.literal('')),
  expiresAt: z.string().optional().or(z.literal('')),
  maxRedemptions: z.coerce.number().int().min(1).max(100000).optional()
});

export const giftCardPromoCodeUpdateSchema = giftCardPromoCodeInputSchema.partial();

export const giftCardPromoQuoteInputSchema = z.object({
  code: z.string().min(3).max(40),
  amountCents: z.coerce.number().int().min(1000).max(200000)
});

const giftCardImageSettingSchema = z
  .string()
  .max(4_500_000)
  .refine(
    (value) =>
      value === '' ||
      /^https?:\/\/.+/i.test(value) ||
      /^\/.+/.test(value) ||
      /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(value),
    'Use a public image URL, a local image path, or an uploaded image.'
  );

export const giftCardSettingsInputSchema = z.object({
  testCheckoutEnabled: z.boolean().optional(),
  publicHeadline: z.string().min(4).max(90).optional(),
  publicSubheading: z.string().min(10).max(220).optional(),
  heroImageUrl: giftCardImageSettingSchema.optional().or(z.literal('')),
  artworkUrl: giftCardImageSettingSchema.optional().or(z.literal('')),
  emailSubject: z.string().min(4).max(120).optional(),
  emailIntro: z.string().min(4).max(240).optional(),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional()
});

export type GiftCardSettings = {
  testCheckoutEnabled: boolean;
  publicHeadline: string;
  publicSubheading: string;
  heroImageUrl: string;
  artworkUrl: string;
  emailSubject: string;
  emailIntro: string;
  primaryColor: string;
  accentColor: string;
};

export type GiftCardPublicConfig = {
  settings: GiftCardSettings;
  checkoutMode: 'live' | 'test' | 'setup_required';
  checkoutNotice: string | null;
};

export const DEFAULT_GIFT_CARD_SETTINGS: GiftCardSettings = {
  testCheckoutEnabled: false,
  publicHeadline: 'Gift a good table.',
  publicSubheading: 'Send lunch, dinner, margaritas or a celebration across Alma Avalon and St Alma. Choose a set amount or enter your own.',
  heroImageUrl: '/images/st-alma-food.JPG',
  artworkUrl: '/images/fish.png',
  emailSubject: 'Your ALMA gift card {{code}}',
  emailIntro: 'Your ALMA gift card is ready.',
  primaryColor: '#1f3524',
  accentColor: '#b98216'
};

export function normaliseGiftCardSettings(input: unknown): GiftCardSettings {
  const parsed = giftCardSettingsInputSchema.partial().safeParse(input);
  const patch = parsed.success ? parsed.data : {};
  return {
    ...DEFAULT_GIFT_CARD_SETTINGS,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined && value !== '')
    )
  };
}

export const staffTrainingAssignInputSchema = z.object({
  staffProfileId: z.string().min(1),
  moduleId: z.string().min(1),
  notes: z.string().optional().or(z.literal('')),
  expiresAt: z.string().optional().or(z.literal(''))
});

export const staffTrainingUpdateInputSchema = z.object({
  status: staffTrainingStatusSchema,
  completedAt: z.string().optional().or(z.literal('')),
  score: z.coerce.number().optional(),
  evidenceName: z.string().optional().or(z.literal('')),
  evidenceUrl: z.string().url().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH, 'Password must be 256 characters or fewer')
});

export const authChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH, 'Password must be 256 characters or fewer'),
  newPassword: passwordSchema
});

export const authPasswordResetRequestSchema = z.object({
  email: z.string().email(),
  resetBaseUrl: z.string().url().optional().or(z.literal('')),
  appName: z.string().trim().min(1).max(80).optional().or(z.literal(''))
});

export const authPasswordResetCompleteSchema = z.object({
  token: z.string().min(32).max(200),
  newPassword: passwordSchema
});

export const staffPasswordResetRequestSchema = z.object({
  resetBaseUrl: z.string().url().optional().or(z.literal('')),
  appName: z.string().trim().min(1).max(80).optional().or(z.literal(''))
});

export const websiteMenuItemInputSchema = z.object({
  name: z.string().min(1),
  price: z.string().optional().or(z.literal('')),
  tag: z.string().optional().or(z.literal(''))
});

export const websiteMenuSectionInputSchema = z.object({
  title: z.string().min(1),
  items: z.array(websiteMenuItemInputSchema).min(1).max(120)
});

export const websiteMenuVenueInputSchema = z.object({
  title: z.string().min(1),
  location: z.string().optional().or(z.literal('')),
  image: z.string().optional().or(z.literal('')),
  foodHref: z.string().optional().or(z.literal('')),
  drinksHref: z.string().optional().or(z.literal('')),
  setMenus: z.array(z.object({
    title: z.string().min(1),
    price: z.string().min(1)
  })).optional().default([]),
  sections: z.array(websiteMenuSectionInputSchema).min(1).max(40),
  drinks: z.array(websiteMenuSectionInputSchema).min(1).max(40)
});

export const websiteMenuUpdateInputSchema = z.object({
  updatedAt: z.string().optional().or(z.literal('')),
  message: z.string().optional().or(z.literal('')),
  dryRun: z.boolean().optional().default(false),
  venues: z.array(websiteMenuVenueInputSchema).min(1).max(10)
});

export const appSettingsUpdateSchema = z.object({
  orgName: z.string().min(1).optional(),
  primaryContactName: z.string().optional().or(z.literal('')),
  primaryContactEmail: z.string().email().optional().or(z.literal('')),
  primaryContactPhone: z.string().optional().or(z.literal('')),
  venues: z.array(z.object({
    name: z.string().min(1),
    address: z.string().optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal(''))
  })).optional(),
  handbookContent: z.record(z.string(), z.unknown()).optional(),
  onboardingSettings: onboardingSettingsInputSchema.optional(),
  staffDefaults: staffDefaultsInputSchema.optional(),
  goveeApiKey: z.string().optional().or(z.literal('')),
  goveeBaseUrl: z.string().url().optional().or(z.literal('')),
  notifyEmail: z.string().email().optional().or(z.literal('')),
  notifyOverdueIssues: z.boolean().optional(),
  notifyExpiringStaff: z.boolean().optional(),
  notifyOutOfRangeTemp: z.boolean().optional()
});

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
  accountType: z.infer<typeof staffAccountTypeSchema>;
  isAdmin: boolean;
  role: 'ADMIN' | 'MANAGER' | 'STAFF';
  appAccess: Array<Pick<StaffAppAccess, 'appId' | 'status' | 'role' | 'permissions'>>;
  deviceAccount?: {
    id: string;
    name: string;
    venue: string | null;
  } | null;
};

export type AppSettingsPayload = {
  id: string;
  orgName: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  venues: Array<{ name: string; address?: string; phone?: string }>;
  handbookContent: Record<string, unknown>;
  onboardingSettings: OnboardingSettings;
  staffDefaults: StaffDefaults;
  goveeApiKey: string | null;
  goveeBaseUrl: string | null;
  notifyEmail: string | null;
  notifyOverdueIssues: boolean;
  notifyExpiringStaff: boolean;
  notifyOutOfRangeTemp: boolean;
};

export type AdminSignalTone = 'positive' | 'warning' | 'danger' | 'info' | 'muted';

export type AdminReadinessWarning = {
  label: string;
  detail: string;
  tone: AdminSignalTone;
  href?: string;
};

export type AdminVenueSummary = {
  name: string;
  address: string | null;
  phone: string | null;
  activeStaffCount: number;
};

export type AdminBusinessSummary = {
  orgName: string;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  venues: AdminVenueSummary[];
};

export type AdminAppAccessSummary = {
  appId: AlmaAppId;
  label: string;
  enabled: number;
  pending: number;
  disabled: number;
  managerOrAdmin: number;
};

export type AdminHandoffLink = {
  label: string;
  description: string;
  appId: string;
  href: string;
};

export type AdminAuditEventSummary = {
  id: string;
  staffProfileId: string;
  staffName: string;
  staffRoleTitle: string | null;
  venue: string | null;
  eventType: string;
  summary: string;
  createdByName: string | null;
  createdAt: string;
};

export type AdminOverviewPayload = {
  generatedAt: string;
  readiness: {
    status: 'ready' | 'needs_attention';
    label: string;
    warnings: AdminReadinessWarning[];
  };
  counts: {
    activeStaff: number;
    staffMissingLoginEmail: number;
    staffMissingStaffAccess: number;
    staffWithoutPassword: number;
    mondayRosterLoaded: boolean;
    mondayRosterShiftCount: number;
    openClockSessions: number;
    pendingComplianceRecords: number;
    expiredComplianceRecords: number;
    adminUsers: number;
    staffManagersOrAdmins: number;
  };
  business: AdminBusinessSummary;
  staffDefaults: StaffDefaults;
  appAccess: AdminAppAccessSummary[];
  handoffLinks: AdminHandoffLink[];
  recentAuditEvents: AdminAuditEventSummary[];
};

export type AdminAccessUserSummary = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  venue: string | null;
  roleTitle: string;
  employmentStatus: string;
  accountType: z.infer<typeof staffAccountTypeSchema>;
  isAdmin: boolean;
  hasPassword: boolean;
  hasPin: boolean;
  pinUpdatedAt: string | null;
  appAccess: StaffAppAccess[];
};

export type AdminAccessUsersPayload = {
  generatedAt: string;
  apps: Array<{ appId: AlmaAppId; label: string }>;
  permissionKeys: Array<{ key: string; label: string; description: string; dangerous?: boolean }>;
  users: AdminAccessUserSummary[];
};

export type AdminAccessBulkUpdateResult = {
  updatedUsers: number;
  updatedRows: number;
};

export type AdminAccessUserCreateInput = z.infer<typeof adminAccessUserCreateInputSchema>;
export type AdminStaffCostingQuery = z.infer<typeof adminStaffCostingQuerySchema>;
export type AdminAccessBulkUpdateInput = z.infer<typeof adminAccessBulkUpdateInputSchema>;
export type AdminVenueDeviceCreateInput = z.infer<typeof adminVenueDeviceCreateInputSchema>;
export type AdminVenueDeviceUpdateInput = z.infer<typeof adminVenueDeviceUpdateInputSchema>;
export type DevicePinLoginInput = z.infer<typeof devicePinLoginInputSchema>;
export type StaffPinChangeInput = z.infer<typeof staffPinChangeInputSchema>;
export type StaffPinResetInput = z.infer<typeof staffPinResetInputSchema>;

export type AdminVenueDeviceSummary = {
  id: string;
  displayName: string;
  email: string | null;
  venue: string | null;
  employmentStatus: string;
  enabled: boolean;
  hasPassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  appAccess: StaffAppAccess[];
};

export type AdminStaffCostingPayload = {
  generatedAt: string;
  period: {
    start: string;
    end: string;
    label: string;
  };
  filters: {
    venue: string | null;
    source: 'actual' | 'scheduled' | 'combined';
  };
  totals: {
    actualHours: number;
    actualCostCents: number;
    approvedHours: number;
    approvedCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    varianceHours: number;
    varianceCostCents: number;
    averageHourlyCostCents: number | null;
    missingRateHours: number;
    missingRateCount: number;
    staffCount: number;
    shiftCount: number;
    timesheetCount: number;
  };
  sourceQuality: {
    actualTimesheets: boolean;
    scheduledRoster: boolean;
    missingRates: boolean;
    notes: string[];
  };
  byVenue: Array<{
    venue: string;
    actualHours: number;
    actualCostCents: number;
    approvedHours: number;
    approvedCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    varianceHours: number;
    varianceCostCents: number;
    averageHourlyCostCents: number | null;
    staffCount: number;
    missingRateHours: number;
  }>;
  byArea: Array<{
    area: string;
    venue: string;
    actualHours: number;
    actualCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    averageHourlyCostCents: number | null;
    staffCount: number;
    shareOfActualCost: number | null;
  }>;
  byRole: Array<{
    roleTitle: string;
    actualHours: number;
    actualCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    averageHourlyCostCents: number | null;
    staffCount: number;
  }>;
  byStaff: Array<{
    staffProfileId: string;
    staffName: string;
    venue: string;
    roleTitle: string;
    actualHours: number;
    actualCostCents: number;
    approvedHours: number;
    approvedCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    averageHourlyCostCents: number | null;
    rateCents: number | null;
    rateSource: string;
    missingRate: boolean;
  }>;
  daily: Array<{
    date: string;
    actualHours: number;
    actualCostCents: number;
    scheduledHours: number;
    scheduledCostCents: number;
    varianceCostCents: number;
  }>;
  warnings: string[];
};

export type AdminVenueDevicesPayload = {
  generatedAt: string;
  devices: AdminVenueDeviceSummary[];
};

export type DeviceStaffOption = {
  id: string;
  name: string;
  roleTitle: string;
  venue: string | null;
  email: string | null;
  hasPin: boolean;
};

export type DeviceStaffListResponse = {
  venue: string | null;
  activeUser: AuthUser | null;
  staff: DeviceStaffOption[];
};

export type IntegrationProviderKey = 'square' | 'xero';
export type AdminMetaIntegrationStatus = {
  provider: 'meta';
  label: string;
  status: 'NOT_CONFIGURED' | 'READY_TO_CONNECT' | 'CALLBACK_RECEIVED' | 'TOKEN_STORAGE_PENDING';
  configured: boolean;
  canConnect: boolean;
  connectBlockedReason: string | null;
  redirectUri: string;
  authorizationUrl: string | null;
  allowedDomains: string[];
  missingEnvVars: string[];
  scopes: string[];
  checklist: Array<{ label: string; status: 'done' | 'required' | 'not_configured'; detail: string }>;
  deauthorizeCallbackConfigured: boolean;
  dataDeletionCallbackConfigured: boolean;
};
export type IntegrationConnectionStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR' | 'REVOKED' | 'NOT_CONFIGURED';
export type IntegrationSyncStatus = 'RUNNING' | 'SUCCESS' | 'ERROR';
export type SquareAccountKey = 'primary' | 'secondary';
export type SquareMenuMappingStatus = 'UNMAPPED' | 'MAPPED' | 'IGNORED' | 'NEEDS_REVIEW';

export type SquareConfigMissingMap = {
  applicationId: boolean;
  applicationSecret: boolean;
  webhookSignatureKey: boolean;
  redirectUri: boolean;
  webhookUrl: boolean;
  apiVersion: boolean;
  environment: boolean;
};

export type SquareSetupDiagnostics = {
  accountKey: SquareAccountKey;
  label: string;
  configured: boolean;
  oauthConfigured: boolean;
  webhookConfigured: boolean;
  connected: boolean;
  missing: SquareConfigMissingMap;
  missingLabels: string[];
  redirectUri: string | null;
  webhookUrl: string | null;
  lastWebhookAt: string | null;
  webhookEventCount: number;
  locationCount: number | null;
};

export type IntegrationProviderStatus = {
  provider: IntegrationProviderKey;
  accountKey?: SquareAccountKey;
  label: string;
  status: IntegrationConnectionStatus;
  configured: boolean;
  oauthConfigured?: boolean;
  connected?: boolean;
  squareSetup?: SquareSetupDiagnostics;
  canConnect: boolean;
  connectBlockedReason: string | null;
  providerAccountId: string | null;
  providerAccountName: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: IntegrationSyncStatus | null;
  lastError: string | null;
  scopes: string[];
  environment: string | null;
  apiVersion?: string | null;
  redirectUri?: string | null;
  webhookUrl?: string | null;
  webhookConfigured: boolean;
  webhookStatus: 'configured' | 'missing';
  webhookLastReceivedAt?: string | null;
  webhookLastProcessedAt?: string | null;
  webhookEventCount?: number;
  webhookFailedEventCount?: number;
  powers: string[];
  requiredSetup: string[];
  missingEnvVars: string[];
  actionLabel: string;
  actionDisabled: boolean;
  locationCount?: number | null;
  locations?: Array<{
    id: string;
    name: string;
    status: string | null;
    businessName: string | null;
    currency: string | null;
    timezone: string | null;
  }>;
  lastLocationSyncAt?: string | null;
};

export type IntegrationSyncRunSummary = {
  id: string;
  provider: IntegrationProviderKey;
  syncType: 'MANUAL' | 'WEBHOOK' | 'SCHEDULED' | 'BACKFILL' | 'TEST' | 'OAUTH_CALLBACK';
  status: IntegrationSyncStatus;
  startedAt: string;
  finishedAt: string | null;
  recordsImported: number;
  recordsUpdated: number;
  errorSummary: string | null;
};

export type XeroScheduledImportStatus = {
  endpoint: string;
  schedulerSecretConfigured: boolean;
  safeAutomaticImportEnabled: boolean;
  lookbackDays: number;
  contactsLimit: number;
  billsLimit: number;
  lastScheduledRunAt: string | null;
  lastSuccessfulRunAt: string | null;
  lastFailedRunAt: string | null;
  lastStatus: IntegrationSyncStatus | null;
  lastError: string | null;
  recentRunCount: number;
  importScope: string[];
  excludedScope: string[];
};

export type IntegrationStatusPayload = {
  generatedAt: string;
  square: IntegrationProviderStatus;
  squareAccounts?: Record<SquareAccountKey, IntegrationProviderStatus>;
  xero: IntegrationProviderStatus;
  xeroScheduledImport?: XeroScheduledImportStatus;
  meta: AdminMetaIntegrationStatus;
  latestSyncRuns: IntegrationSyncRunSummary[];
  tokenStorage: {
    configured: boolean;
    requiredEnvVar: 'INTEGRATION_TOKEN_ENCRYPTION_KEY';
  };
};

export const squareMenuMappingStatusSchema = z.enum(['UNMAPPED', 'MAPPED', 'IGNORED', 'NEEDS_REVIEW']);

export const squareMenuMappingQuerySchema = z.object({
  accountKey: z.enum(['primary', 'secondary']).default('primary'),
  status: squareMenuMappingStatusSchema.optional().or(z.literal('')),
  search: z.string().trim().optional().or(z.literal('')),
  venue: z.string().trim().optional().or(z.literal('')),
  category: z.string().trim().optional().or(z.literal(''))
});

export const squareMenuMappingUpdateSchema = z.object({
  almaRecipeId: z.string().optional().nullable().or(z.literal('')),
  stockItemId: z.string().optional().nullable().or(z.literal('')),
  status: squareMenuMappingStatusSchema.optional(),
  notes: z.string().trim().max(1000).optional().nullable().or(z.literal(''))
});

export type SquareMenuRecipeMapping = {
  id: string;
  accountKey: SquareAccountKey;
  venue: string | null;
  squareItemId: string;
  squareVariationId: string;
  squareItemName: string;
  squareVariationName: string | null;
  categoryName: string | null;
  priceMoneyAmount: number | null;
  currency: string | null;
  almaRecipeId: string | null;
  stockItemId: string | null;
  status: SquareMenuMappingStatus;
  confidence: number | null;
  notes: string | null;
  mappedAt: string | null;
  mappedById: string | null;
  createdAt: string;
  updatedAt: string;
  almaRecipe: Pick<Recipe, 'id' | 'title' | 'venue' | 'category' | 'estimatedCost' | 'salePriceCents'> | null;
  stockItem: { id: string; name: string; unit: string; avgCostCents: number | null } | null;
  margin: {
    salePriceCents: number | null;
    recipeCostCents: number | null;
    grossProfitCents: number | null;
    foodCostPercent: number | null;
  };
};

export type SquareMenuMappingPayload = {
  generatedAt: string;
  accountKey: SquareAccountKey;
  summary: {
    total: number;
    mapped: number;
    unmapped: number;
    ignored: number;
    needsReview: number;
    lastSyncedAt: string | null;
  };
  filters: z.infer<typeof squareMenuMappingQuerySchema>;
  categories: string[];
  mappings: SquareMenuRecipeMapping[];
};

export type SquareMenuMappingSyncResult = {
  provider: 'square';
  accountKey: SquareAccountKey;
  label: string;
  syncedAt: string;
  catalogItemsRead: number;
  candidatesUpserted: number;
  mappingsCreated: number;
  mappingsPreserved: number;
  deletedMarked: number;
  warnings: string[];
};

export type SquareRecipeOption = {
  id: string;
  title: string;
  venue: string | null;
  category: string | null;
  estimatedCost: number;
  salePriceCents: number | null;
  lineCount: number;
};

export type SquareMenuRecipeOptionsPayload = {
  generatedAt: string;
  recipes: SquareRecipeOption[];
  stockItems: Array<{ id: string; name: string; unit: string; avgCostCents: number | null }>;
};

export type SquareMenuMappingQuery = z.infer<typeof squareMenuMappingQuerySchema>;
export type SquareMenuMappingUpdate = z.infer<typeof squareMenuMappingUpdateSchema>;

export type IntegrationConnectResponse = {
  provider: IntegrationProviderKey;
  authorizationUrl: string;
  expiresAt: string;
};

export type XeroConnectionHealthPayload = {
  provider: 'xero';
  connected: boolean;
  tenantName: string | null;
  tenantIdMasked: string | null;
  tenantCount: number | null;
  tenantStatus: 'reachable' | 'not_found' | 'not_selected' | 'not_checked';
  tenantSelectionRequired: boolean;
  tokenStatus:
    | 'healthy'
    | 'refreshed'
    | 'not_connected'
    | 'configuration_missing'
    | 'missing'
    | 'refresh_failed'
    | 'request_failed';
  availableScopes: string[];
  checkedAt: string;
  errorCategory: string | null;
  message: string;
  dataSyncRunning: false;
};

export type XeroSupplierContactPreview = {
  xeroContactId: string;
  xeroContactIdMasked: string;
  name: string;
  email: string | null;
  phone: string | null;
  isSupplierCandidate: boolean;
  existingSupplierId: string | null;
  existingSupplierName: string | null;
  existingSupplierMatch: boolean;
  matchReason: string | null;
  warnings: string[];
};

export type XeroSupplierContactsPreviewPayload = {
  generatedAt: string;
  connected: boolean;
  tenantName: string | null;
  contactsRead: number;
  supplierCandidates: number;
  matchedSuppliers: number;
  contacts: XeroSupplierContactPreview[];
  warnings: string[];
};

export type XeroSupplierContactsImportResult = {
  generatedAt: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  conflictCount: number;
  warnings: string[];
};

export const xeroSupplierContactsImportInputSchema = z.object({
  contactIds: z.array(z.string().min(1)).default([]),
  importAllCandidates: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).optional()
}).refine((value) => value.importAllCandidates || value.contactIds.length > 0, {
  message: 'Choose supplier contacts to import'
});

export type XeroSupplierContactsImportInput = z.infer<typeof xeroSupplierContactsImportInputSchema>;

export type XeroSupplierBillPreview = {
  xeroInvoiceId: string;
  xeroInvoiceIdMasked: string;
  supplierName: string;
  supplierEmail: string | null;
  invoiceNumber: string | null;
  reference: string | null;
  status: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currencyCode: string;
  lineCount: number;
  totalCents: number;
  supplierId: string | null;
  supplierMatchStatus: 'matched' | 'missing' | 'unknown';
  duplicateStatus: 'new' | 'duplicate' | 'possible_duplicate';
  duplicateReason: string | null;
  warnings: string[];
};

export type XeroSupplierBillsPreviewPayload = {
  generatedAt: string;
  connected: boolean;
  tenantName: string | null;
  startDate: string;
  endDate: string;
  billsRead: number;
  billsPreviewed: number;
  statusCounts: Record<string, number>;
  bills: XeroSupplierBillPreview[];
  warnings: string[];
};

export type XeroSupplierBillsImportResult = {
  generatedAt: string;
  importedCount: number;
  skippedCount: number;
  duplicateCount: number;
  supplierCreatedCount: number;
  lineCount: number;
  warnings: string[];
};

export const xeroSupplierBillsImportInputSchema = z.object({
  billIds: z.array(z.string().min(1)).min(1, 'Choose Xero bills to import'),
  allowCreateSuppliers: z.boolean().default(false),
  venue: z.string().optional().or(z.literal('')),
  startDate: z.string().optional().or(z.literal('')),
  endDate: z.string().optional().or(z.literal('')),
  limit: z.number().int().min(1).max(100).optional(),
  confirmationText: z.literal('IMPORT XERO BILLS', {
    errorMap: () => ({ message: 'Type IMPORT XERO BILLS to confirm bill import' })
  })
});

export type XeroSupplierBillsImportInput = z.infer<typeof xeroSupplierBillsImportInputSchema>;

export type AdminIntegrationProviderStatus = IntegrationProviderStatus;

export type LegacyAdminIntegrationProviderStatus = {
  provider: 'square' | 'xero';
  label: string;
  status: 'NOT_CONNECTED' | 'CONNECTED' | 'NOT_CONFIGURED';
  powers: string[];
  requiredSetup: string[];
  actionLabel: string;
  actionDisabled: boolean;
};

export type AdminIntegrationsStatusPayload = {
  generatedAt: string;
  square: AdminIntegrationProviderStatus;
  squareAccounts?: Record<SquareAccountKey, IntegrationProviderStatus>;
  xero: AdminIntegrationProviderStatus;
  xeroScheduledImport?: XeroScheduledImportStatus;
  meta: AdminMetaIntegrationStatus;
  latestSyncRuns: IntegrationSyncRunSummary[];
  tokenStorage: {
    configured: boolean;
    requiredEnvVar: 'INTEGRATION_TOKEN_ENCRYPTION_KEY';
  };
  email: {
    status: 'CONFIGURED' | 'NOT_CONFIGURED';
    provider: 'resend' | 'smtp' | 'none';
  };
  govee: {
    status: 'CONFIGURED' | 'NOT_CONFIGURED';
    baseUrl: string | null;
  };
};

export type AdminSystemHealthPayload = {
  generatedAt: string;
  api: {
    status: 'ok';
  };
  database: {
    status: 'ok' | 'error';
    detail: string;
  };
  email: {
    configured: boolean;
    provider: 'resend' | 'smtp' | 'none';
  };
  migrations: {
    status: 'available' | 'not_checked' | 'error';
    latest: string | null;
    detail: string;
  };
  appUrls: Array<{
    app: string;
    envVar: string;
    status: 'configured' | 'missing';
    url: string | null;
  }>;
};

export type AdminAuditEventsPayload = {
  eventTypes: string[];
  events: AdminAuditEventSummary[];
};

export const incidentPersonInputSchema = z.object({
  name: z.string().min(2),
  role: z.string().min(2),
  involvement: z.string().min(2),
  contactDetails: z.string().optional().or(z.literal('')),
  injuryDetails: z.string().optional().or(z.literal('')),
  witnessStatement: z.string().optional().or(z.literal(''))
});

export const incidentUpdateInputSchema = z.object({
  status: incidentStatusSchema.optional(),
  severity: issueSeveritySchema.optional(),
  immediateActions: z.string().optional().or(z.literal('')),
  treatmentProvided: z.string().optional().or(z.literal('')),
  followUpRequired: z.boolean().optional(),
  followUpNotes: z.string().optional().or(z.literal(''))
});

export const incidentCreateInputSchema = z.object({
  title: z.string().min(3),
  incidentType: z.string().min(2),
  severity: issueSeveritySchema.default('MEDIUM'),
  status: incidentStatusSchema.default('OPEN'),
  occurredAt: z.string().min(4),
  reportedBy: z.string().min(2),
  venue: z.string().optional().or(z.literal('')),
  location: z.string().optional().or(z.literal('')),
  summary: z.string().min(5),
  immediateActions: z.string().optional().or(z.literal('')),
  treatmentProvided: z.string().optional().or(z.literal('')),
  followUpRequired: z.boolean().optional(),
  followUpNotes: z.string().optional().or(z.literal('')),
  people: z.array(incidentPersonInputSchema).optional(),
  createIssue: z.boolean().optional()
});

export const temperatureAssetCreateInputSchema = z.object({
  name: z.string().min(2),
  venue: z.string().optional().or(z.literal('')),
  area: z.string().optional().or(z.literal('')),
  assetType: z.string().min(2),
  minTempC: z.coerce.number(),
  maxTempC: z.coerce.number(),
  integrationProvider: z.string().optional().or(z.literal('')),
  externalDeviceId: z.string().optional().or(z.literal('')),
  externalModel: z.string().optional().or(z.literal('')),
  externalSku: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const temperatureLogCreateInputSchema = z.object({
  recordedAt: z.string().optional().or(z.literal('')),
  temperatureC: z.coerce.number(),
  humidityPct: z.coerce.number().optional(),
  correctiveAction: z.string().optional().or(z.literal('')),
  recordedBy: z.string().optional().or(z.literal(''))
});

export const temperatureSensorMapInputSchema = z.object({
  assetId: z.string().optional().or(z.literal(''))
});

export const temperatureExternalIngestInputSchema = z.object({
  provider: z.string().optional().or(z.literal('')),
  externalSensorId: z.string().min(1),
  externalName: z.string().optional().or(z.literal('')),
  externalModel: z.string().optional().or(z.literal('')),
  measuredTemperature: z.coerce.number(),
  batteryLevel: z.coerce.number().int().optional(),
  correctiveAction: z.string().optional().or(z.literal('')),
  recordedAt: z.string().optional().or(z.literal('')),
  recordedBy: z.string().optional().or(z.literal(''))
});

export const auditFindingInputSchema = z.object({
  sectionTitle: z.string().min(1),
  finding: z.string().min(2),
  score: z.coerce.number().optional(),
  createIssue: z.boolean().optional()
});

export const auditTemplateSectionInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().or(z.literal('')),
  position: z.number().int().nonnegative().optional()
});

export const auditTemplateInputSchema = z.object({
  name: z.string().min(2),
  sections: z.array(auditTemplateSectionInputSchema).min(1)
});

export const auditRunCreateInputSchema = z.object({
  templateId: z.string().min(1),
  title: z.string().min(2),
  summary: z.string().optional().or(z.literal('')),
  score: z.coerce.number().optional(),
  findings: z.array(auditFindingInputSchema).optional()
});

export const auditRunUpdateInputSchema = z.object({
  title: z.string().min(2).optional(),
  summary: z.string().optional().or(z.literal('')),
  score: z.coerce.number().optional()
});

export type IssueStatus = z.infer<typeof issueStatusSchema>;
export type IssueSeverity = z.infer<typeof issueSeveritySchema>;
export type ChecklistRunStatus = z.infer<typeof checklistRunStatusSchema>;
export type ChecklistItemResult = z.infer<typeof checklistItemResultSchema>;
export type ShiftTaskType = z.infer<typeof shiftTaskTypeSchema>;
export type ShiftTaskDueTiming = z.infer<typeof shiftTaskDueTimingSchema>;
export type ShiftTaskAssignmentTarget = z.infer<typeof shiftTaskAssignmentTargetSchema>;
export type ShiftTaskAssignmentStatus = z.infer<typeof shiftTaskAssignmentStatusSchema>;
export type StaffRecordType = z.infer<typeof staffRecordTypeSchema>;
export type StaffRecordStatus = z.infer<typeof staffRecordStatusSchema>;
export type StaffHrRecordType = z.infer<typeof staffHrRecordTypeSchema>;
export type StaffHrRecordStatus = z.infer<typeof staffHrRecordStatusSchema>;
export type StaffHrDocumentTemplateStatus = z.infer<typeof staffHrDocumentTemplateStatusSchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
export type TemperatureAssetStatus = z.infer<typeof temperatureAssetStatusSchema>;
export type TemperatureLogSource = z.infer<typeof temperatureLogSourceSchema>;
export type TemperatureLogStatus = z.infer<typeof temperatureLogStatusSchema>;
export type StockItemStatus = z.infer<typeof stockItemStatusSchema>;
export type SupplierStatus = z.infer<typeof supplierStatusSchema>;
export type StocktakeStatus = z.infer<typeof stocktakeStatusSchema>;
export type StockInvoiceMatchingStatus = z.infer<
  typeof stockInvoiceMatchingStatusSchema
>;
export type AlmaAppId = z.infer<typeof almaAppIdSchema>;
export type StaffAppAccessStatus = z.infer<typeof staffAppAccessStatusSchema>;
export type RosterShiftStatus = z.infer<typeof rosterShiftStatusSchema>;
export type StaffLeaveType = z.infer<typeof staffLeaveTypeSchema>;
export type StaffLeaveStatus = z.infer<typeof staffLeaveStatusSchema>;
export type TimesheetStatus = z.infer<typeof timesheetStatusSchema>;
export type StaffClockSessionStatus = z.infer<typeof staffClockSessionStatusSchema>;
export type StaffClockEventType = z.infer<typeof staffClockEventTypeSchema>;
export type TrainingModuleStatus = z.infer<typeof trainingModuleStatusSchema>;
export type StaffTrainingStatus = z.infer<typeof staffTrainingStatusSchema>;
export type ReserveReservationStatus = z.infer<typeof reserveReservationStatusSchema>;
export type ReserveServicePeriod = z.infer<typeof reserveServicePeriodSchema>;
export type MarketingChannel = z.infer<typeof marketingChannelSchema>;
export type MarketingCampaignStatus = z.infer<typeof marketingCampaignStatusSchema>;
export type MarketingContentAssetType = z.infer<typeof marketingContentAssetTypeSchema>;
export type MarketingContentAssetStorageProvider = z.infer<typeof marketingContentAssetStorageProviderSchema>;
export type MarketingContentAssetStatus = z.infer<typeof marketingContentAssetStatusSchema>;
export type MarketingContentAssetSource = z.infer<typeof marketingContentAssetSourceSchema>;
export type MarketingContentPostStatus = z.infer<typeof marketingContentPostStatusSchema>;
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;
export type MarketingSocialAccountStatus = z.infer<typeof marketingSocialAccountStatusSchema>;
export type MarketingContentPublishStatus = z.infer<typeof marketingContentPublishStatusSchema>;
export type MarketingContentPublishMode = z.infer<typeof marketingContentPublishModeSchema>;
export type GiftCardStatus = z.infer<typeof giftCardStatusSchema>;
export type GiftCardRedemptionStatus = z.infer<typeof giftCardRedemptionStatusSchema>;
export type IssueFormInput = z.infer<typeof issueCreateInputSchema>;
export type StaffProfileCreateInput = z.infer<typeof staffProfileCreateInputSchema>;
export type StaffProfileUpdateInput = z.infer<typeof staffProfileUpdateInputSchema>;
export type StaffManagerNoteInput = z.infer<typeof staffManagerNoteInputSchema>;
export type StaffHrRecordInput = z.infer<typeof staffHrRecordInputSchema>;
export type StaffHrRecordUpdateInput = z.infer<typeof staffHrRecordUpdateSchema>;
export type StaffHrDocumentInput = z.infer<typeof staffHrDocumentInputSchema>;
export type StaffHrDocumentTemplateInput = z.infer<typeof staffHrDocumentTemplateInputSchema>;
export type StaffHrDocumentTemplateUpdateInput = z.infer<typeof staffHrDocumentTemplateUpdateSchema>;
export type StaffHrDocumentTemplatePreviewInput = z.infer<typeof staffHrDocumentTemplatePreviewSchema>;
export type StaffPayProfileInput = z.infer<typeof staffPayProfileInputSchema>;
export type StaffMergeInput = z.infer<typeof staffMergeInputSchema>;
export type StaffLeaveRequestInput = z.infer<typeof staffLeaveRequestInputSchema>;
export type StaffLeaveRequestUpdateInput = z.infer<typeof staffLeaveRequestUpdateSchema>;
export type AuthPasswordResetRequestInput = z.infer<typeof authPasswordResetRequestSchema>;
export type AuthPasswordResetCompleteInput = z.infer<typeof authPasswordResetCompleteSchema>;
export type StaffPasswordResetRequestInput = z.infer<typeof staffPasswordResetRequestSchema>;
export type RosterShiftInput = z.infer<typeof rosterShiftInputSchema>;
export type RosterShiftUpdateInput = z.infer<typeof rosterShiftUpdateInputSchema>;
export type TimesheetCreateInput = z.infer<typeof timesheetCreateInputSchema>;
export type TimesheetUpdateInput = z.infer<typeof timesheetUpdateInputSchema>;
export type StaffShiftConfirmationInput = z.infer<typeof staffShiftConfirmationInputSchema>;
export type StaffClockInInput = z.infer<typeof staffClockInInputSchema>;
export type StaffClockOutInput = z.infer<typeof staffClockOutInputSchema>;
export type StaffClockBreakInput = z.infer<typeof staffClockBreakInputSchema>;
export type StaffOwnLeaveRequestInput = z.infer<typeof staffOwnLeaveRequestInputSchema>;
export type ShiftTaskRuleInput = z.infer<typeof shiftTaskRuleInputSchema>;
export type ShiftTaskRuleUpdateInput = z.infer<typeof shiftTaskRuleUpdateInputSchema>;
export type ShiftTaskRulePreviewInput = z.infer<typeof shiftTaskRulePreviewInputSchema>;
export type TrainingModuleInput = z.infer<typeof trainingModuleInputSchema>;
export type TrainingPayRuleInput = z.infer<typeof trainingPayRuleInputSchema>;
export type StaffTrainingAssignInput = z.infer<typeof staffTrainingAssignInputSchema>;
export type StaffTrainingUpdateInput = z.infer<typeof staffTrainingUpdateInputSchema>;
export type ReserveGuestInput = z.infer<typeof reserveGuestInputSchema>;
export type ReserveGuestUpdateInput = z.infer<typeof reserveGuestUpdateInputSchema>;
export type ReserveTableInput = z.infer<typeof reserveTableInputSchema>;
export type ReserveReservationInput = z.infer<typeof reserveReservationInputSchema>;
export type ReserveReservationUpdateInput = z.infer<typeof reserveReservationUpdateInputSchema>;
export type ReserveAvailabilityRuleInput = z.infer<typeof reserveAvailabilityRuleInputSchema>;
export type ReserveAvailabilityRuleUpdateInput = z.infer<typeof reserveAvailabilityRuleUpdateInputSchema>;
export type ReserveBlackoutInput = z.infer<typeof reserveBlackoutInputSchema>;
export type ReservePublicAvailabilityInput = z.infer<typeof reservePublicAvailabilityInputSchema>;
export type ReservePublicBookingInput = z.infer<typeof reservePublicBookingInputSchema>;
export type MarketingSegmentDefinition = z.infer<typeof marketingSegmentDefinitionSchema>;
export type MarketingContactInput = z.infer<typeof marketingContactInputSchema>;
export type MarketingContactUpdateInput = z.infer<typeof marketingContactUpdateInputSchema>;
export type MarketingSegmentInput = z.infer<typeof marketingSegmentInputSchema>;
export type MarketingTagInput = z.infer<typeof marketingTagInputSchema>;
export type MarketingTagUpdateInput = z.infer<typeof marketingTagUpdateInputSchema>;
export type MarketingGuestTagAssignmentInput = z.infer<typeof marketingGuestTagAssignmentInputSchema>;
export type MarketingTemplateInput = z.infer<typeof marketingTemplateInputSchema>;
export type MarketingTemplateUpdateInput = z.infer<typeof marketingTemplateUpdateInputSchema>;
export type MarketingCampaignInput = z.infer<typeof marketingCampaignInputSchema>;
export type MarketingCampaignUpdateInput = z.infer<typeof marketingCampaignUpdateInputSchema>;
export type MarketingSegmentPreviewInput = z.infer<typeof marketingSegmentPreviewInputSchema>;
export type MarketingAutomationInput = z.infer<typeof marketingAutomationInputSchema>;
export type MarketingAutomationUpdateInput = z.infer<typeof marketingAutomationUpdateInputSchema>;
export type MarketingContentAssetInput = z.infer<typeof marketingContentAssetInputSchema>;
export type MarketingContentAssetUpdateInput = z.infer<typeof marketingContentAssetUpdateInputSchema>;
export type MarketingContentPostInput = z.infer<typeof marketingContentPostInputSchema>;
export type MarketingContentPostUpdateInput = z.infer<typeof marketingContentPostUpdateInputSchema>;
export type MarketingContentPostAssetInput = z.infer<typeof marketingContentPostAssetInputSchema>;
export type MarketingContentScheduleInput = z.infer<typeof marketingContentScheduleInputSchema>;
export type MarketingSocialAccountInput = z.infer<typeof marketingSocialAccountInputSchema>;
export type MarketingSocialAccountUpdateInput = z.infer<typeof marketingSocialAccountUpdateInputSchema>;
export type GoogleReserveIntegrationSettingInput = z.infer<typeof googleReserveIntegrationSettingInputSchema>;
export type GiftCardCheckoutInput = z.infer<typeof giftCardCheckoutInputSchema>;
export type GiftCardLookupInput = z.infer<typeof giftCardLookupInputSchema>;
export type GiftCardRedemptionInput = z.infer<typeof giftCardRedemptionInputSchema>;
export type GiftCardCancelInput = z.infer<typeof giftCardCancelInputSchema>;
export type IssueEvidence = {
  id: string;
  issueId: string;
  name: string;
  url: string;
  fileType: string | null;
  createdAt: string;
};

export type IssueActivity = {
  id: string;
  issueId: string;
  action: string;
  message: string;
  actor: string;
  createdAt: string;
};

export type Issue = {
  id: string;
  title: string;
  description: string;
  severity: IssueSeverity;
  category: string;
  status: IssueStatus;
  assignee: string | null;
  dueDate: string | null;
  notes: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: IssueEvidence[];
  activities: IssueActivity[];
};

export type IssueSummary = {
  total: number;
  open: number;
  overdue: number;
  critical: number;
};

export type IssueAssigneeOption = {
  id: string;
  name: string;
  label: string;
  email: string | null;
  roleTitle: string;
  venue: string | null;
};

export type StaffComplianceRecord = {
  id: string;
  staffProfileId: string;
  recordType: StaffRecordType;
  title: string;
  issuer: string | null;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  dueAt: string | null;
  status: StaffRecordStatus;
  documentName: string | null;
  documentUrl: string | null;
  notes: string | null;
  requestedAt: string | null;
  requestedById: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  rejectedAt: string | null;
  rejectedById: string | null;
  rejectionReason: string | null;
  mergedIntoStaffProfileId: string | null;
  mergedAt: string | null;
  mergedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffManagerNote = {
  id: string;
  staffProfileId: string;
  body: string;
  createdById: string;
  createdByName: string;
  createdByEmail: string | null;
  createdAt: string;
};

export type StaffHrRecord = {
  id: string;
  staffProfileId: string;
  recordType: StaffHrRecordType;
  title: string;
  status: StaffHrRecordStatus;
  issueDate: string | null;
  effectiveDate: string | null;
  expiryDate: string | null;
  followUpDate: string | null;
  reason: string | null;
  oldRateCents: number | null;
  newRateCents: number | null;
  documentName: string | null;
  documentUrl: string | null;
  notes: string | null;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'>;
};

export type StaffHrDocumentTemplateOptionalClause = z.infer<typeof staffHrDocumentTemplateOptionalClauseSchema>;

export type StaffHrDocumentTemplate = {
  id: string;
  name: string;
  recordType: StaffHrRecordType;
  status: StaffHrDocumentTemplateStatus;
  body: string;
  variables: string[];
  optionalClauses: StaffHrDocumentTemplateOptionalClause[];
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffHrDocumentTemplatePreview = {
  templateId: string;
  renderedBody: string;
  unresolvedVariables: string[];
  sampleData: Record<string, string>;
};

export type StaffPayProfile = {
  id: string | null;
  staffProfileId: string;
  awardCode: AustralianAwardCode;
  awardName: string;
  awardClassification: string;
  employmentType: StaffAwardEmploymentType;
  payMode: StaffPayMode;
  awardRateSource: string;
  awardRateEffectiveFrom: string;
  payGuidePublishedAt: string;
  rateSetVersion: string;
  ordinaryHourlyRateCents: number;
  casualLoadedHourlyRateCents: number | null;
  manualFullTimePayAmountCents: number | null;
  manualFullTimePayFrequency: ManualFullTimePayFrequency | null;
  manualFullTimePayNote: string | null;
  payUpdatedAt: string | null;
  payUpdatedByUserId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isDefaulted: boolean;
  sourceUrl?: string;
};

export type StaffManagementEvent = {
  id: string;
  staffProfileId: string;
  eventType: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdById: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
  createdAt: string;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'>;
};

export type StaffLeaveRequest = {
  id: string;
  staffProfileId: string;
  type: StaffLeaveType;
  status: StaffLeaveStatus;
  startDate: string;
  endDate: string;
  notes: string | null;
  managerNote: string | null;
  requestedByUserId: string | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'>;
};

export type StaffAppAccess = {
  id: string;
  staffProfileId: string;
  appId: AlmaAppId;
  status: StaffAppAccessStatus;
  role: string;
  permissions: Record<string, boolean>;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffRoleTemplateAccess = {
  id: string;
  roleTemplateId: string;
  appId: AlmaAppId;
  status: StaffAppAccessStatus;
  role: string;
  permissions: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
};

export type StaffRoleTemplate = {
  id: string;
  name: string;
  description: string | null;
  roleTitle: string | null;
  venue: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  access: StaffRoleTemplateAccess[];
  assignedStaffCount?: number;
};

export type SuiteAnnouncement = {
  id: string;
  title: string;
  body: string;
  audience: string;
  appId: AlmaAppId | null;
  venue: string | null;
  pinned: boolean;
  createdById: string | null;
  createdByName: string | null;
  updatedById: string | null;
  updatedByName: string | null;
  deletedAt: string | null;
  deletedById: string | null;
  deletedByName: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

export type SuiteChatChannelType = z.infer<typeof suiteChatChannelTypeSchema>;

export type SuiteChatChannel = {
  id: string;
  name: string;
  description: string | null;
  channelKey: string;
  type: SuiteChatChannelType;
  appId: AlmaAppId | null;
  venue: string | null;
  groupKey: string | null;
  isActive: boolean;
  readPermission: string | null;
  postPermission: string | null;
  directMessagesAllowed: boolean;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SuiteChatMessage = {
  id: string;
  channelId: string | null;
  channel: string;
  channelType: SuiteChatChannelType;
  appId: AlmaAppId | null;
  venue: string | null;
  recipientId: string | null;
  recipientName: string | null;
  body: string;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deletedById: string | null;
  deletedByName: string | null;
};

export type SuiteCommunicationsPayload = {
  announcements: SuiteAnnouncement[];
  channels: SuiteChatChannel[];
  chat: SuiteChatMessage[];
};

export type SuiteAnnouncementInput = z.infer<typeof suiteAnnouncementInputSchema>;
export type SuiteAnnouncementUpdateInput = z.infer<typeof suiteAnnouncementUpdateSchema>;
export type SuiteChatChannelInput = z.infer<typeof suiteChatChannelInputSchema>;
export type SuiteChatChannelUpdateInput = z.infer<typeof suiteChatChannelUpdateSchema>;
export type SuiteChatMessageInput = z.infer<typeof suiteChatMessageInputSchema>;
export type SuiteChatMessageUpdateInput = z.infer<typeof suiteChatMessageUpdateSchema>;

export type RosterShift = {
  id: string;
  staffProfileId: string;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  status: RosterShiftStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue' | 'employmentStatus'>;
  confirmation?: StaffShiftConfirmation | null;
};

export type StaffShiftConfirmation = {
  id: string;
  rosterShiftId: string;
  staffProfileId: string;
  note: string | null;
  confirmedAt: string;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffClockEvent = {
  id: string;
  sessionId: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  eventType: StaffClockEventType;
  occurredAt: string;
  createdById: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type StaffClockSession = {
  id: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  clockInAt: string;
  clockOutAt: string | null;
  status: StaffClockSessionStatus;
  currentBreakStartedAt: string | null;
  accumulatedBreakMinutes: number;
  managerNote: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  createdAt: string;
  updatedAt: string;
  events?: StaffClockEvent[];
  rosterShift?: RosterShift | null;
};

export type RosterForecastSnapshot = {
  id: string;
  weekStart: string;
  weekEnd: string;
  venue: string | null;
  source: string | null;
  targetWagePercent: number;
  forecastSalesCents: number;
  wageBudgetCents: number;
  rosterCostCents: number;
  plannedHours: number;
  recommendedHours: number;
  dailySalesCents: Record<string, number>;
  venueBreakdown: unknown;
  areaBreakdown: unknown;
  publishedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SalesActualEntry = {
  id: string;
  venue: string;
  serviceDate: string;
  salesCents: number;
  source: string;
  externalId: string | null;
  notes: string | null;
  importedById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SalesActualSummary = {
  entries: SalesActualEntry[];
  totalSalesCents: number;
  byVenue: Array<{
    venue: string;
    salesCents: number;
    days: number;
  }>;
};

export type SalesItemActualSummary = {
  entries: Array<{
    id: string;
    venue: string;
    serviceDate: string;
    source: string;
    externalId: string;
    itemName: string;
    variationName: string | null;
    categoryName: string | null;
    sku: string | null;
    catalogObjectId: string | null;
    locationName: string | null;
    quantity: number;
    grossSalesCents: number;
    netSalesCents: number;
    orderCount: number;
    lineCount: number;
    recipeId: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  totalNetSalesCents: number;
  totalQuantity: number;
  matchedRecipeRows: number;
  unmatchedRows: number;
  byVenue: Array<{
    venue: string;
    netSalesCents: number;
    quantity: number;
    rows: number;
  }>;
};

export type ReportsMenuProfitabilityRow = {
  key: string;
  accountKey: SquareAccountKey | 'unknown';
  venue: string;
  squareItem: string;
  variationName: string | null;
  categoryName: string | null;
  catalogObjectId: string | null;
  quantitySold: number;
  grossSalesCents: number;
  netSalesCents: number;
  orderCount: number;
  lineCount: number;
  mappingStatus: 'mapped' | 'unmapped' | 'missing_recipe' | 'missing_cost';
  mappingId: string | null;
  almaRecipeId: string | null;
  almaRecipeTitle: string | null;
  recipeCostCents: number | null;
  estimatedCogsCents: number | null;
  grossProfitCents: number | null;
  foodCostPercent: number | null;
  dataQuality: Array<'actual_sales' | 'mapped_recipe_cost' | 'missing_recipe' | 'missing_cost' | 'unmapped_square_item'>;
};

export type ReportsMenuProfitabilityPayload = {
  generatedAt: string;
  period: { start: string; end: string };
  filters: z.infer<typeof reportsMenuProfitabilityQuerySchema>;
  totals: {
    itemRows: number;
    quantitySold: number;
    netSalesCents: number;
    estimatedCogsCents: number | null;
    grossProfitCents: number | null;
    foodCostPercent: number | null;
    mappedRows: number;
    unmappedRows: number;
    missingRecipeRows: number;
    missingCostRows: number;
  };
  categories: string[];
  venues: string[];
  rows: ReportsMenuProfitabilityRow[];
  warnings: string[];
};

export type ReportsPrimeCostVenueRow = {
  venue: string;
  salesCents: number;
  wageCents: number;
  approvedWageCents: number;
  rosterWageEstimateCents: number;
  cogsCents: number;
  invoiceCogsCents: number;
  wastageCents: number;
  primeCostCents: number;
  wagePercent: number | null;
  cogsPercent: number | null;
  primeCostPercent: number | null;
  timesheetHours: number;
  rosterHours: number;
  salesDays: number;
  sourceQuality: 'complete_current' | 'missing_sales' | 'missing_wages' | 'missing_cogs' | 'estimated_wages' | 'incomplete';
  missing: string[];
};

export type ReportsPrimeCostPayload = {
  period: { start: string; end: string };
  totals: Omit<ReportsPrimeCostVenueRow, 'venue' | 'sourceQuality' | 'missing'> & {
    sourceQuality: ReportsPrimeCostVenueRow['sourceQuality'];
    missing: string[];
  };
  venues: ReportsPrimeCostVenueRow[];
  sources: {
    sales: 'actual_sales_import' | 'missing';
    wages: 'timesheet_actuals' | 'roster_estimate' | 'missing';
    cogs: 'supplier_invoice_lines' | 'supplier_invoice_lines_plus_wastage' | 'wastage_only' | 'missing';
  };
  warnings: string[];
};

export type StaffManagerDashboardPayload = {
  date: string;
  venue: string;
  generatedAt: string;
  totals: {
    salesCents: number;
    actualWageCents: number;
    rosterWageCents: number;
    actualHours: number;
    rosterHours: number;
    wagePercent: number | null;
    pendingTimesheets: number;
    lowStockItems: number;
    openIssues: number;
    criticalIssues: number;
  };
  salesByVenue: Array<{
    venue: string;
    salesCents: number;
  }>;
  wagesByVenue: Array<{
    venue: string;
    actualWageCents: number;
    rosterWageCents: number;
    actualHours: number;
    rosterHours: number;
  }>;
  pendingTimesheets: Timesheet[];
  lowStock: Array<{
    id: string;
    name: string;
    unit: string;
    onHand: number;
    parLevel: number;
    reorderPoint: number | null;
    categoryName: string | null;
  }>;
  complianceIssues: Array<{
    id: string;
    title: string;
    severity: IssueSeverity;
    status: IssueStatus;
    category: string;
    assignee: string | null;
    dueDate: string | null;
    createdAt: string;
  }>;
};

export type GuestTagType = z.infer<typeof guestTagTypeSchema>;
export type GuestTagAssignmentSource = z.infer<typeof guestTagAssignmentSourceSchema>;
export type MarketingEmailTemplateStatus = z.infer<typeof marketingEmailTemplateStatusSchema>;
export type MarketingAutomationTriggerType = z.infer<typeof marketingAutomationTriggerTypeSchema>;
export type MarketingAutomationRunStatus = z.infer<typeof marketingAutomationRunStatusSchema>;
export type GoogleReserveIntegrationStatus = z.infer<typeof googleReserveIntegrationStatusSchema>;

export type GuestTag = {
  id: string;
  venue: string | null;
  name: string;
  slug: string;
  description: string | null;
  type: GuestTagType;
  color: string | null;
  ruleDefinition: MarketingSegmentDefinition;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GuestTagAssignment = {
  id: string;
  guestId: string;
  tagId: string;
  source: GuestTagAssignmentSource;
  assignedAt: string;
  assignedByStaffId: string | null;
  metadata: Record<string, unknown>;
  tag: GuestTag;
};

export type ReserveGuest = {
  id: string;
  venue: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  tags: string[];
  allergyNotes: string | null;
  visitNotes: string | null;
  notes: string | null;
  preferences: Record<string, unknown>;
  dietaryNotes: string | null;
  marketingOptIn: boolean;
  emailUnsubscribedAt: string | null;
  smsUnsubscribedAt: string | null;
  source: string;
  totalVisits: number;
  totalSpendCents: number;
  noShowCount: number;
  lastVisitAt: string | null;
  firstVisitAt: string | null;
  createdAt: string;
  updatedAt: string;
  tagAssignments?: GuestTagAssignment[];
};

export type GuestTimelineItem = {
  id: string;
  at: string;
  type:
    | 'RESERVATION_CREATED'
    | 'RESERVATION_STATUS'
    | 'TAG_ASSIGNED'
    | 'CAMPAIGN_SIMULATED'
    | 'CONTENT_TOUCHPOINT'
    | 'GIFT_CARD_ORDER'
    | 'INTERNAL_NOTE';
  title: string;
  description: string;
  venue: string | null;
  source: 'reserve' | 'marketing' | 'content' | 'gift_cards' | 'staff';
  metadata: Record<string, unknown>;
};

export type GuestTimelinePayload = {
  guest: ReserveGuest;
  generatedAt: string;
  timeline: GuestTimelineItem[];
};

export type ReserveTable = {
  id: string;
  venue: string;
  area: string;
  label: string;
  minCovers: number;
  maxCovers: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReserveAvailabilityRule = {
  id: string;
  venue: string;
  name: string;
  servicePeriod: ReserveServicePeriod | null;
  active: boolean;
  defaultDurationMinutes: number;
  minPartySize: number;
  maxPartySize: number;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  intervalMinutes: number;
  capacity: number;
  onlineEnabled: boolean;
  googleReserveEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReserveBlackout = {
  id: string;
  venue: string;
  name: string;
  reason: string | null;
  startAt: string;
  endAt: string;
  createdAt: string;
  updatedAt: string;
};

export type GoogleReserveIntegrationSetting = {
  id: string;
  venue: string;
  enabled: boolean;
  merchantId: string | null;
  integrationStatus: GoogleReserveIntegrationStatus;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReserveReservation = {
  id: string;
  venue: string;
  serviceDate: string;
  servicePeriod: ReserveServicePeriod;
  startsAt: string;
  endsAt: string;
  covers: number;
  status: ReserveReservationStatus;
  source: string;
  tableId: string | null;
  guestId: string;
  availabilityRuleId: string | null;
  guestName: string | null;
  guestEmail: string | null;
  guestPhone: string | null;
  occasion: string | null;
  notes: string | null;
  specialRequests: string | null;
  internalNotes: string | null;
  marketingOptIn: boolean;
  createdById: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  guest: ReserveGuest;
  table: ReserveTable | null;
  availabilityRule: ReserveAvailabilityRule | null;
};

export type ReserveDiarySummary = {
  start: string;
  end: string;
  venue: string;
  reservations: ReserveReservation[];
  tables: ReserveTable[];
  totals: {
    covers: number;
    confirmed: number;
    seated: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
};

export type ReserveDashboardPayload = {
  date: string;
  venue: string | null;
  todayReservations: ReserveReservation[];
  upcomingReservations: ReserveReservation[];
  recentGuests: ReserveGuest[];
  recentNoShows: ReserveReservation[];
  availabilityRules: ReserveAvailabilityRule[];
  integration: GoogleReserveIntegrationSetting | null;
  totals: {
    coversToday: number;
    todayBookings: number;
    cancellationsToday: number;
    noShowsToday: number;
    newGuests30Days: number;
    repeatGuests30Days: number;
  };
};

export type ReservePublicAvailabilitySlot = {
  startsAt: string;
  endsAt: string;
  label: string;
  capacityRemaining: number;
  availabilityRuleId: string | null;
  servicePeriod: ReserveServicePeriod | null;
};

export type ReservePublicAvailabilityResponse = {
  venue: string;
  serviceDate: string;
  partySize: number;
  slots: ReservePublicAvailabilitySlot[];
};

export type ReservePublicBookingConfirmation = {
  id: string;
  venue: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  covers: number;
  guestName: string;
  status: ReserveReservationStatus;
  source: string;
  marketingOptIn: boolean;
  occasion: string | null;
  specialRequests: string | null;
  createdAt: string;
};

export type ReservePublicWidgetConfig = {
  venues: Array<{
    name: string;
    onlineEnabled: boolean;
    activeRules: number;
    googleReserveReady: boolean;
  }>;
  limitations: string[];
};

export type MarketingContact = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  venue: string | null;
  source: string;
  tags: string[];
  consentEmail: boolean;
  consentSms: boolean;
  totalVisits: number;
  lastVisitAt: string | null;
  allergyNotes: string | null;
  notes: string | null;
  reserveGuestId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingSegment = {
  id: string;
  name: string;
  description: string | null;
  venue: string | null;
  rules: MarketingSegmentDefinition;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingEmailTemplate = {
  id: string;
  venue: string | null;
  name: string;
  subject: string;
  previewText: string | null;
  htmlBody: string;
  textBody: string | null;
  status: MarketingEmailTemplateStatus;
  createdByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingCampaignRecipient = {
  id: string;
  campaignId: string;
  contactId: string;
  guestId: string | null;
  email: string | null;
  status: string;
  skipReason: string | null;
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  error: string | null;
  createdAt: string;
  contact: MarketingContact;
  guest: ReserveGuest | null;
};

export type MarketingCampaign = {
  id: string;
  venue: string | null;
  name: string;
  channel: MarketingChannel;
  status: MarketingCampaignStatus;
  audienceName: string | null;
  subject: string | null;
  previewText: string | null;
  body: string;
  textBody: string | null;
  segmentDefinition: MarketingSegmentDefinition;
  scheduledFor: string | null;
  sentAt: string | null;
  simulatedAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  recipients: MarketingCampaignRecipient[];
};

export type MarketingAutomation = {
  id: string;
  venue: string;
  name: string;
  triggerType: MarketingAutomationTriggerType;
  segmentDefinition: MarketingSegmentDefinition;
  emailTemplateId: string | null;
  delayHours: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  emailTemplate: MarketingEmailTemplate | null;
};

export type MarketingAutomationRun = {
  id: string;
  automationId: string;
  guestId: string;
  reservationId: string | null;
  status: MarketingAutomationRunStatus;
  reason: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type MarketingSegmentPreviewPayload = {
  guestCount: number;
  includedCount: number;
  skippedCount: number;
  skippedReasons: Record<string, number>;
  estimatedReachableEmailCount: number;
  guests: ReserveGuest[];
};

export type MarketingOverview = {
  guests: ReserveGuest[];
  tags: GuestTag[];
  templates: MarketingEmailTemplate[];
  campaigns: MarketingCampaign[];
  automations: MarketingAutomation[];
  recentReservations: ReserveReservation[];
  totals: {
    guests: number;
    optedInGuests: number;
    unsubscribedGuests: number;
    repeatVisitors: number;
    bigSpenders: number;
    lapsedGuests: number;
    recentCampaigns: number;
    activeAutomations: number;
  };
};

export type MarketingContentAsset = {
  id: string;
  venue: string;
  uploadedByStaffId: string | null;
  title: string;
  description: string | null;
  assetType: MarketingContentAssetType;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  storageProvider: MarketingContentAssetStorageProvider;
  storagePath: string | null;
  publicUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  status: MarketingContentAssetStatus;
  tags: string[];
  source: MarketingContentAssetSource;
  createdAt: string;
  updatedAt: string;
};

export type MarketingContentPostAsset = {
  id: string;
  postId: string;
  assetId: string;
  sortOrder: number;
  createdAt: string;
  asset: MarketingContentAsset;
};

export type MarketingContentPost = {
  id: string;
  venue: string;
  createdByStaffId: string | null;
  title: string;
  caption: string;
  status: MarketingContentPostStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaignId: string | null;
  targetChannels: SocialPlatform[];
  contentPillar: string | null;
  approvalRequired: boolean;
  approvedByStaffId: string | null;
  approvedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  assets: MarketingContentPostAsset[];
};

export type MarketingSocialAccount = {
  id: string;
  venue: string;
  platform: SocialPlatform;
  displayName: string;
  handle: string | null;
  externalAccountId: string | null;
  status: MarketingSocialAccountStatus;
  scopes: string[];
  hasTokenSecretRef: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketingContentPublishAttempt = {
  id: string;
  postId: string;
  platform: SocialPlatform;
  socialAccountId: string | null;
  status: MarketingContentPublishStatus;
  mode: MarketingContentPublishMode;
  requestPreview: Record<string, unknown> | null;
  responsePreview: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
};

export type MarketingContentPlatformPreview = {
  platform: SocialPlatform;
  status: 'READY_TO_SIMULATE' | 'SETUP_REQUIRED' | 'MISSING_ASSET' | 'MISSING_CAPTION' | 'UNSUPPORTED_MEDIA_TYPE';
  message: string;
  requestPreview: Record<string, unknown>;
};

export type MarketingContentDashboardSummary = {
  totals: {
    assets: number;
    images: number;
    videos: number;
    drafts: number;
    scheduledPosts: number;
    needsReview: number;
    failedPosts: number;
    setupRequiredAccounts: number;
  };
  upcomingPosts: MarketingContentPost[];
  recentAssets: MarketingContentAsset[];
  socialAccounts: MarketingSocialAccount[];
};

export type MarketingContentCalendarResponse = {
  from: string;
  to: string;
  posts: MarketingContentPost[];
};

export type MarketingContentHelper = {
  id: string;
  label: string;
  contentPillar: string;
  caption: string;
  targetChannels: SocialPlatform[];
  campaignSubject: string;
  campaignPreviewText: string;
  campaignBody: string;
};

export type MarketingContentUploadConfigResponse = {
  mode: 'setup_required' | 'external_url';
  message: string;
  acceptedMimeTypes: string[];
  maxFileSizeBytes: number;
};

export type GiftCardRedemption = {
  id: string;
  giftCardId: string;
  amountCents: number;
  venue: string | null;
  notes: string | null;
  status: GiftCardRedemptionStatus;
  redeemedById: string | null;
  redeemedAt: string;
  createdAt: string;
};

export type GiftCardPromoDiscountType = z.infer<typeof giftCardPromoDiscountTypeSchema>;

export type GiftCardPromoCode = {
  id: string;
  code: string;
  description: string | null;
  discountType: GiftCardPromoDiscountType;
  percentOff: number | null;
  amountOffCents: number | null;
  isActive: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  confirmedRedemptions: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GiftCard = {
  id: string;
  code: string;
  status: GiftCardStatus;
  initialValueCents: number;
  balanceCents: number;
  discountCents: number;
  amountPaidCents: number | null;
  currency: string;
  purchaserName: string;
  purchaserEmail: string;
  recipientName: string | null;
  recipientEmail: string | null;
  message: string | null;
  promoCodeId: string | null;
  promoCodeSnapshot: string | null;
  testMode: boolean;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  emailedAt: string | null;
  emailError: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  refundNote: string | null;
  cancelledById: string | null;
  paidAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  redemptions: GiftCardRedemption[];
};

export type GiftCardPublic = Pick<
  GiftCard,
  | 'code'
  | 'status'
  | 'initialValueCents'
  | 'balanceCents'
  | 'currency'
  | 'recipientName'
  | 'message'
  | 'paidAt'
  | 'expiresAt'
  | 'emailedAt'
  | 'emailError'
> & {
  discountCents: number;
  amountPaidCents: number | null;
  promoCodeSnapshot: string | null;
  testMode: boolean;
  qrCodeUrl: string;
  redeemUrl: string;
};

export type GiftCardCheckoutResult = {
  giftCardId: string;
  checkoutUrl: string;
  checkoutSessionId: string;
  testMode?: boolean;
  discountCents?: number;
  amountPaidCents?: number;
};

export type GiftCardOverview = {
  giftCards: GiftCard[];
  totals: {
    active: number;
    pending: number;
    redeemed: number;
    test: number;
    activeBalanceCents: number;
    soldValueCents: number;
  };
};

export type GiftCardPromoQuote = {
  code: string;
  description: string | null;
  discountCents: number;
  amountDueCents: number;
};

export type GiftCardAdminSettingsResponse = {
  settings: GiftCardSettings;
  canManagePromoCodes: boolean;
};

export type Timesheet = {
  id: string;
  staffProfileId: string;
  rosterShiftId: string | null;
  venue: string | null;
  area: string | null;
  roleTitle: string | null;
  workDate: string;
  clockInAt: string;
  clockOutAt: string;
  breakMinutes: number;
  notes: string | null;
  status: TimesheetStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedById: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  xeroEmployeeId: string | null;
  xeroEarningsRateId: string | null;
  xeroTimesheetId: string | null;
  xeroExportBatchId: string | null;
  paymentMethod: 'XERO' | 'CASH';
  cashPaidAt: string | null;
  cashPaidById: string | null;
  cashPaymentNotes: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue' | 'email'>;
};

export type StaffMyRosterPayload = {
  shifts: RosterShift[];
  upcomingCount: number;
  pastCount: number;
  pendingConfirmationCount: number;
};

export type StaffClockStatusPayload = {
  activeSession: StaffClockSession | null;
  currentShift: RosterShift | null;
  nextShift: RosterShift | null;
  recentSessions: StaffClockSession[];
};

export type StaffDailyHomePayload = {
  member: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null;
  todayShift: RosterShift | null;
  nextShift: RosterShift | null;
  clock: StaffClockStatusPayload;
  upcomingLeave: StaffLeaveRequest[];
  complianceReminders: Array<{
    id: string;
    kind: 'RECORD' | 'TRAINING';
    title: string;
    detail: string;
    dueAt: string | null;
    status: string;
  }>;
  announcements: SuiteAnnouncement[];
};

export type StaffManagerOperationsPayload = {
  date: string;
  venue: string;
  generatedAt: string;
  metrics: {
    scheduledStaff: number;
    clockedIn: number;
    onBreak: number;
    lateClockIns: number;
    missedClockIns: number;
    pendingConfirmations: number;
    clockExceptions: number;
    bookingsToday?: number;
    coversToday?: number;
  };
  bookingsSummary?: {
    bookingsToday: number;
    coversToday: number;
    upcomingBookings: number;
    cancellationsToday: number;
    noShowsToday: number;
    nextReservations: Array<{
      id: string;
      venue: string;
      startsAt: string;
      covers: number;
      guestName: string | null;
      status: ReserveReservationStatus;
    }>;
  };
  todaysStaff: Array<{
    shift: RosterShift;
    staffProfile: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null;
    confirmation: StaffShiftConfirmation | null;
    activeSession: StaffClockSession | null;
    state: 'SCHEDULED' | 'CLOCKED_IN' | 'ON_BREAK' | 'LATE' | 'MISSED' | 'CLOCKED_OUT';
  }>;
  clockedIn: StaffClockSession[];
  pendingConfirmations: Array<{
    shift: RosterShift;
    staffProfile: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null;
  }>;
  clockExceptions: Array<{
    id: string;
    kind: 'OPEN_SESSION' | 'BREAK_OVERDUE' | 'MISSED_CLOCK_IN' | 'LATE_CLOCK_IN';
    severity: 'warning' | 'danger';
    summary: string;
    detail: string;
    venue: string | null;
    staffProfile: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null;
    shift: RosterShift | null;
    session: StaffClockSession | null;
  }>;
};

export type StaffTipEntitlement = {
  staffProfileId: string;
  name: string;
  roleTitle: string | null;
  venue: string | null;
  approvedHours: number;
  amountCents: number;
  paymentMethod: 'CASH';
};

export type StaffTipsSummary = {
  start: string;
  end: string;
  venue: string;
  cashTipsCents: number;
  squareTipsCents: number;
  tipPoolCents: number;
  approvedHours: number;
  paidRuns: Array<{
    id: string;
    paidAt: string;
    tipPoolCents: number;
    lineCount: number;
  }>;
  paidEntitlements: StaffTipEntitlement[];
  cashEntries: Array<{
    id: string;
    serviceDate: string;
    venue: string;
    amountCents: number;
    notes: string | null;
  }>;
  cardEntries: Array<{
    id: string;
    serviceDate: string;
    venue: string;
    amountCents: number;
    source: string;
    externalId: string | null;
    notes: string | null;
  }>;
  entitlements: StaffTipEntitlement[];
};

export type StaffTipHistory = {
  id: string;
  venue: string;
  weekStart: string;
  weekEnd: string;
  paidAt: string;
  hours: number;
  baseAmountCents: number;
  adjustmentCents: number;
  amountCents: number;
  notes: string | null;
};

export type TrainingModule = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  level: number;
  estimatedMinutes: number | null;
  status: TrainingModuleStatus;
  createdAt: string;
  updatedAt: string;
};

export type TrainingLevelPayRule = {
  id: string;
  level: number;
  label: string;
  payRateCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StaffTrainingRecord = {
  id: string;
  staffProfileId: string;
  moduleId: string;
  status: StaffTrainingStatus;
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  score: number | null;
  evidenceName: string | null;
  evidenceUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  module?: TrainingModule;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue' | 'payRateCents' | 'trainingLevel' | 'trainingPayRateCents'>;
};

export type StaffProfile = {
  id: string;
  firstName: string;
  lastName: string;
  roleTemplateId: string | null;
  roleTemplate?: Pick<StaffRoleTemplate, 'id' | 'name' | 'roleTitle' | 'isActive'> | null;
  roleTitle: string;
  email: string | null;
  phone: string | null;
  venue: string | null;
  employmentStatus: string;
  accountType: z.infer<typeof staffAccountTypeSchema>;
  pinUpdatedAt: string | null;
  startDate: string | null;
  dateOfBirth: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  emergencyContactName: string | null;
  emergencyContactRelationship: string | null;
  emergencyContactPhone: string | null;
  employmentType: string | null;
  payType: string | null;
  payRateCents: number | null;
  payAward: string | null;
  taxFileNumber: string | null;
  taxResidencyStatus: string | null;
  taxFreeThreshold: boolean | null;
  hasStudyTrainingLoan: boolean | null;
  superFundName: string | null;
  superFundAbn: string | null;
  superFundUsi: string | null;
  superMemberNumber: string | null;
  bankAccountName: string | null;
  bankBsb: string | null;
  bankAccountNumber: string | null;
  visaStatus: string | null;
  visaSubclass: string | null;
  visaExpiryDate: string | null;
  workRightsNotes: string | null;
  xeroEmployeeId: string | null;
  xeroPayrollCalendarId: string | null;
  xeroEarningsRateId: string | null;
  trainingLevel: number;
  trainingPayRateCents: number | null;
  isAdmin: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  payProfile: StaffPayProfile | null;
  records: StaffComplianceRecord[];
  appAccess: StaffAppAccess[];
  rosterShifts: RosterShift[];
  trainingRecords: StaffTrainingRecord[];
};

export type TrainingOverview = {
  modules: TrainingModule[];
  payRules: TrainingLevelPayRule[];
  records: StaffTrainingRecord[];
  staff: Array<Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue' | 'payRateCents' | 'trainingLevel' | 'trainingPayRateCents'>>;
};

export type StaffSummary = {
  totalProfiles: number;
  expiringSoon: number;
  expired: number;
  pendingApproval: number;
};

export type IncidentPerson = {
  id: string;
  incidentReportId: string;
  name: string;
  role: string;
  involvement: string;
  contactDetails: string | null;
  injuryDetails: string | null;
  witnessStatement: string | null;
  createdAt: string;
};

export type IncidentReport = {
  id: string;
  title: string;
  incidentType: string;
  severity: IssueSeverity;
  status: IncidentStatus;
  occurredAt: string;
  reportedBy: string;
  venue: string | null;
  location: string | null;
  summary: string;
  immediateActions: string | null;
  treatmentProvided: string | null;
  followUpRequired: boolean;
  followUpNotes: string | null;
  linkedIssueId: string | null;
  createdAt: string;
  updatedAt: string;
  people: IncidentPerson[];
  linkedIssue?: Pick<Issue, 'id' | 'title' | 'status' | 'severity'> | null;
};

export type IncidentSummary = {
  total: number;
  open: number;
  followUpRequired: number;
  critical: number;
};

export type TemperatureLog = {
  id: string;
  assetId: string;
  recordedAt: string;
  temperatureC: number;
  humidityPct: number | null;
  source: TemperatureLogSource;
  status: TemperatureLogStatus;
  correctiveAction: string | null;
  recordedBy: string | null;
  externalReadingId: string | null;
  createdAt: string;
  asset?: Pick<TemperatureAsset, 'id' | 'name' | 'area' | 'venue' | 'assetType' | 'minTempC' | 'maxTempC'> | null;
};

export type TemperatureIntegration = {
  id: string;
  provider: string;
  status: string;
  apiKeyHint: string | null;
  baseUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TemperatureSensor = {
  id: string;
  integrationId: string;
  externalSensorId: string;
  externalName: string | null;
  externalModel: string | null;
  assetId: string | null;
  lastSeenAt: string | null;
  lastTemperature: number | null;
  lastBatteryLevel: number | null;
  rawPayload: unknown;
  createdAt: string;
  updatedAt: string;
  asset?: Pick<TemperatureAsset, 'id' | 'name' | 'area' | 'venue'> | null;
  integration?: Pick<TemperatureIntegration, 'id' | 'provider' | 'status'> | null;
};

export type TemperatureAsset = {
  id: string;
  name: string;
  venue: string | null;
  area: string | null;
  assetType: string;
  minTempC: number;
  maxTempC: number;
  integrationProvider: string | null;
  externalDeviceId: string | null;
  externalModel: string | null;
  externalSku: string | null;
  lastReadingAt: string | null;
  lastSyncAt: string | null;
  status: TemperatureAssetStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  sensors?: TemperatureSensor[];
  logs: TemperatureLog[];
};

export type TemperatureSummary = {
  activeAssets: number;
  outOfRangeNow: number;
  missingToday: number;
  syncedToday: number;
};

export type ChecklistTemplateItem = {
  id: string;
  templateId: string;
  label: string;
  description: string | null;
  position: number;
};

export type ChecklistTemplate = {
  id: string;
  name: string;
  area: string | null;
  createdAt: string;
  updatedAt: string;
  items: ChecklistTemplateItem[];
};

export type ChecklistRunItem = {
  id: string;
  runId: string;
  templateItemId: string | null;
  label: string;
  description: string | null;
  position: number;
  result: ChecklistItemResult;
  notes: string | null;
  linkedIssueId: string | null;
  linkedIssue?: Pick<Issue, 'id' | 'title' | 'status' | 'severity'> | null;
};

export type ChecklistRun = {
  id: string;
  templateId: string;
  runDate: string;
  status: ChecklistRunStatus;
  area: string | null;
  performedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  template: ChecklistTemplate;
  items: ChecklistRunItem[];
};

export type ShiftTaskRule = {
  id: string;
  name: string;
  enabled: boolean;
  venue: string | null;
  matchRoleTitle: string | null;
  matchArea: string | null;
  matchShiftLabel: string | null;
  startBeforeMinutes: number | null;
  startAfterMinutes: number | null;
  endBeforeMinutes: number | null;
  endAfterMinutes: number | null;
  daysOfWeek: number[];
  taskType: ShiftTaskType;
  checklistTemplateId: string | null;
  stocktakeTemplate: string | null;
  dueTiming: ShiftTaskDueTiming;
  dueOffsetMinutes: number | null;
  assignmentTarget: ShiftTaskAssignmentTarget;
  createdAt: string;
  updatedAt: string;
  checklistTemplate?: Pick<ChecklistTemplate, 'id' | 'name' | 'area'> | null;
};

export type ShiftTaskAssignment = {
  id: string;
  assignmentKey: string;
  ruleId: string;
  rosterShiftId: string | null;
  staffProfileId: string | null;
  venue: string | null;
  taskType: ShiftTaskType;
  checklistTemplateId: string | null;
  checklistRunId: string | null;
  stocktakeId: string | null;
  status: ShiftTaskAssignmentStatus;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rule?: Pick<ShiftTaskRule, 'id' | 'name' | 'dueTiming' | 'assignmentTarget'> | null;
  rosterShift?: RosterShift | null;
  staffProfile?: Pick<StaffProfile, 'id' | 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null;
  checklistTemplate?: Pick<ChecklistTemplate, 'id' | 'name' | 'area'> | null;
  checklistRun?: Pick<ChecklistRun, 'id' | 'status' | 'runDate'> | null;
};

export type ShiftTaskPreviewAssignment = {
  assignmentKey: string;
  ruleId: string;
  ruleName: string;
  rosterShiftId: string;
  staffProfileId: string | null;
  staffName: string | null;
  venue: string | null;
  taskType: ShiftTaskType;
  checklistTemplateId: string | null;
  checklistTemplateName: string | null;
  dueAt: string | null;
  shiftLabel: string;
};

export type ShiftTaskRulePreviewResult = {
  matches: ShiftTaskPreviewAssignment[];
  matchCount: number;
};

export type ShiftTaskListResponse = {
  tasks: ShiftTaskAssignment[];
  generated: number;
};

export type StartAssignedChecklistResult = {
  assignment: ShiftTaskAssignment;
  run: ChecklistRun;
};

export type AuditTemplateSection = {
  id: string;
  templateId: string;
  title: string;
  description: string | null;
  position: number;
};

export type AuditTemplate = {
  id: string;
  name: string;
  sections: AuditTemplateSection[];
  createdAt: string;
  updatedAt: string;
};

export type AuditFinding = {
  id: string;
  auditRunId: string;
  sectionTitle: string;
  finding: string;
  score: number | null;
  linkedIssueId: string | null;
  linkedIssue?: Pick<Issue, 'id' | 'title' | 'status' | 'severity'> | null;
};

export type AuditRun = {
  id: string;
  templateId: string;
  title: string;
  score: number | null;
  summary: string | null;
  runDate: string;
  createdAt: string;
  updatedAt: string;
  template: AuditTemplate;
  findings: AuditFinding[];
};

export type AuditSummary = {
  totalRuns: number;
  thisMonth: number;
  averageScore: number | null;
  openFindings: number;
};

/* ------------------------------------------------------------------------- */
/* Licences and operating approvals                                           */
/* ------------------------------------------------------------------------- */

export const liquorLicenceTypes = [
  'HOTEL',
  'ON_PREMISES',
  'SMALL_BAR',
  'CLUB',
  'PACKAGED',
  'PRODUCER_WHOLESALER',
  'LIMITED',
  'OUTDOOR_SEATING',
  'FOOD_BUSINESS',
  'FOOTPATH_DINING',
  'MUSIC_ENTERTAINMENT',
  'SIGNAGE',
  'FIRE_SAFETY',
  'WASTE_TRADE',
  'OTHER'
] as const;
export type LiquorLicenceType = (typeof liquorLicenceTypes)[number];

export const liquorLicenceTypeLabels: Record<LiquorLicenceType, string> = {
  HOTEL: 'Hotel',
  ON_PREMISES: 'On-premises',
  SMALL_BAR: 'Small bar',
  CLUB: 'Registered club',
  PACKAGED: 'Packaged liquor',
  PRODUCER_WHOLESALER: 'Producer / wholesaler',
  LIMITED: 'Limited (event)',
  OUTDOOR_SEATING: 'Outdoor seating approval',
  FOOD_BUSINESS: 'Food business registration',
  FOOTPATH_DINING: 'Footpath dining permit',
  MUSIC_ENTERTAINMENT: 'Music / entertainment approval',
  SIGNAGE: 'Signage permit',
  FIRE_SAFETY: 'Fire safety statement',
  WASTE_TRADE: 'Trade waste approval',
  OTHER: 'Other'
};

export const liquorLicenceStatuses = [
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'PENDING'
] as const;
export type LiquorLicenceStatus = (typeof liquorLicenceStatuses)[number];

export type LiquorLicence = {
  id: string;
  venue: string;
  licenceNumber: string;
  licenceType: LiquorLicenceType;
  status: LiquorLicenceStatus;
  licensee: string;
  issuer: string;
  issueDate: string | null;
  expiryDate: string | null;
  tradingHours: string | null;
  conditions: string | null;
  restrictions: string | null;
  notes: string | null;
  documentName: string | null;
  documentUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LiquorLicenceSummary = {
  total: number;
  active: number;
  expiringSoon: number;
  expired: number;
  suspended: number;
};

// Accept empty strings or ISO dates. Prisma will turn empty-string into null.
const optionalDateString = z.string().optional().or(z.literal(''));

export const liquorLicenceCreateInputSchema = z.object({
  venue: z.string().min(1, 'Venue is required'),
  licenceNumber: z.string().min(2, 'Licence number is required'),
  licenceType: z.enum(liquorLicenceTypes).default('ON_PREMISES'),
  status: z.enum(liquorLicenceStatuses).default('ACTIVE'),
  licensee: z.string().min(2, 'Licensee is required'),
  issuer: z.string().optional().or(z.literal('')),
  issueDate: optionalDateString,
  expiryDate: optionalDateString,
  tradingHours: z.string().optional().or(z.literal('')),
  conditions: z.string().optional().or(z.literal('')),
  restrictions: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  documentName: z.string().optional().or(z.literal('')),
  documentUrl: z.string().optional().or(z.literal(''))
});

export const liquorLicenceUpdateInputSchema =
  liquorLicenceCreateInputSchema.partial();

export type LiquorLicenceCreateInput = z.infer<
  typeof liquorLicenceCreateInputSchema
>;
export type LiquorLicenceUpdateInput = z.infer<
  typeof liquorLicenceUpdateInputSchema
>;

/* ------------------------------------------------------------------------- */
/* Stock inventory                                                            */
/* ------------------------------------------------------------------------- */

export type StockCategory = {
  id: string;
  legacyId: string | null;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockItem = {
  id: string;
  legacyId: string | null;
  sku: string | null;
  name: string;
  categoryId: string | null;
  category: Pick<StockCategory, 'id' | 'name'> | null;
  unit: string;
  onHand: number;
  parLevel: number;
  reorderPoint: number | null;
  avgCostCents: number | null;
  status: StockItemStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  venueStock?: VenueStockItem | null;
};

export type VenueStockItem = {
  id: string;
  venue: string;
  stockItemId: string;
  parLevel: number | null;
  reorderPoint: number | null;
  onHand: number | null;
  unitOverride: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  stockItem?: Pick<
    StockItem,
    'id' | 'sku' | 'name' | 'unit' | 'category' | 'status' | 'avgCostCents' | 'parLevel' | 'reorderPoint'
  >;
};

export type StockItemsPayload = {
  items: StockItem[];
  categories: StockCategory[];
  venueStockItems?: VenueStockItem[];
  venues?: string[];
  scope?: {
    venue: string | null;
    admin: boolean;
    stockItemsVenueScoped: boolean;
  };
};

export type StockItemsSummary = {
  totalItems: number;
  activeItems: number;
  lowStockItems: number;
  outOfStockItems?: number;
  categories: number;
  totalOnHand: number;
  venueStockItems?: number;
  unconfiguredVenueStockItems?: number;
  stockItemsVenueScoped?: boolean;
};

export type StockLowStockItem = {
  id: string;
  venueStockItemId: string | null;
  venue: string | null;
  sku: string | null;
  name: string;
  category: Pick<StockCategory, 'id' | 'name'> | null;
  unit: string;
  onHand: number | null;
  parLevel: number | null;
  reorderPoint: number | null;
  status: StockItemStatus;
  updatedAt: string;
  threshold: number;
  stockStatus: 'OUT_OF_STOCK' | 'LOW_STOCK' | 'BELOW_PAR';
  suggestedAction: string;
};

export type StockWastageReason = z.infer<typeof stockWastageReasonSchema>;
export type StockDeliveryCheckStatus = z.infer<typeof stockDeliveryCheckStatusSchema>;
export type StockReorderNoticeStatus = z.infer<typeof stockReorderNoticeStatusSchema>;

export type StockWastageRecord = {
  id: string;
  stockItemId: string;
  venue: string;
  quantity: number;
  unit: string;
  reason: string;
  note: string | null;
  wastedAt: string;
  recordedById: string | null;
  costImpactCents: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  stockItem?: Pick<StockItem, 'id' | 'sku' | 'name' | 'unit' | 'avgCostCents' | 'category'> | null;
};

export type StockWastagePayload = {
  records: StockWastageRecord[];
  items: StockItem[];
  venues: string[];
  scope: { venue: string | null; admin: boolean };
};

export type StockDeliveryCheckItem = {
  id: string;
  deliveryCheckId: string;
  stockItemId: string | null;
  description: string;
  expectedQuantity: number | null;
  receivedQuantity: number | null;
  unit: string | null;
  checked: boolean;
  discrepancy: boolean;
  discrepancyReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  stockItem?: Pick<StockItem, 'id' | 'sku' | 'name' | 'unit' | 'avgCostCents'> | null;
};

export type StockDeliveryCheck = {
  id: string;
  supplierId: string | null;
  supplierName: string;
  venue: string;
  invoiceNumber: string | null;
  deliveryDate: string;
  invoiceReference: string | null;
  status: string;
  notes: string | null;
  createdById: string | null;
  completedAt: string | null;
  completedById: string | null;
  createdAt: string;
  updatedAt: string;
  supplier?: Pick<Supplier, 'id' | 'name'> | null;
  items: StockDeliveryCheckItem[];
};

export type StockDeliveryChecksPayload = {
  checks: StockDeliveryCheck[];
  items: StockItem[];
  suppliers: Supplier[];
  venues: string[];
  scope: { venue: string | null; admin: boolean };
};

export type StockReorderNotice = {
  id: string;
  stockItemId: string;
  venue: string;
  status: string;
  currentOnHand: number | null;
  parLevel: number | null;
  reorderPoint: number | null;
  reorderQuantity: number | null;
  unit: string | null;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  dismissedAt: string | null;
  updatedAt: string;
  stockItem?: Pick<StockItem, 'id' | 'sku' | 'name' | 'unit' | 'category'> | null;
};

export type StockReorderNoticesPayload = {
  notices: StockReorderNotice[];
  lowStockItems: StockLowStockItem[];
  venues: string[];
  scope: { venue: string | null; admin: boolean };
};

export type StockMenuParRecommendation = {
  stockItemId: string;
  sku: string | null;
  name: string;
  unit: string;
  venue: string;
  category: Pick<StockCategory, 'id' | 'name'> | null;
  currentOnHand: number | null;
  currentParLevel: number | null;
  currentReorderPoint: number | null;
  recommendedParLevel: number | null;
  recommendedReorderPoint: number | null;
  suggestedOrderQuantity: number;
  avgCostCents: number | null;
  estimatedOrderCostCents: number | null;
  menuRecipeCount: number;
  menuRecipes: Array<Pick<Recipe, 'id' | 'title' | 'venue' | 'category'>>;
  supplier: Pick<Supplier, 'id' | 'name' | 'email' | 'accountNumber'> | null;
  supplierSource: 'recent_invoice' | 'none';
  dataQuality: 'READY' | 'NO_ITEM_SALES' | 'NO_PAR' | 'NO_SUPPLIER' | 'NO_SALES';
  warnings: string[];
};

export type StockMenuParRecommendationsPayload = {
  period: { start: string; end: string; months: number };
  venues: string[];
  scope: { venue: string | null; admin: boolean };
  sales: {
    totalSalesCents: number;
    averageDailySalesCents: number | null;
    daysWithSales: number;
    source: 'venue_sales_actuals' | 'missing';
  };
  summary: {
    menuItemsReviewed: number;
    stockItemsReviewed: number;
    readyToOrder: number;
    missingItemSales: boolean;
    missingSupplierCount: number;
  };
  recommendations: StockMenuParRecommendation[];
  warnings: string[];
};

export type StockSupplierOrderLineInput = {
  stockItemId: string;
  name: string;
  quantity: number;
  unit: string;
  note?: string;
};

export type StockSupplierOrderEmailResult = {
  status: 'SENT' | 'EMAIL_NOT_CONFIGURED';
  supplierEmail: string;
  subject: string;
  body: string;
  sentAt: string | null;
  warning: string | null;
};

const emptyStringToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

export const venueStockItemUpdateInputSchema = z.object({
  venue: z.string().min(1, 'Venue is required'),
  parLevel: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().nonnegative('Par level cannot be negative').optional()
  ),
  reorderPoint: z.preprocess(
    emptyStringToUndefined,
    z.coerce.number().nonnegative('Reorder point cannot be negative').optional()
  ),
  unitOverride: z.string().optional().or(z.literal('')),
  active: z.boolean().optional()
});

export const stockWastageCreateInputSchema = z.object({
  stockItemId: z.string().min(1, 'Select a stock item'),
  venue: z.string().min(1, 'Venue is required'),
  quantity: z.coerce.number().positive('Quantity must be greater than zero'),
  unit: z.string().min(1, 'Unit is required'),
  reason: stockWastageReasonSchema,
  note: z.string().optional().or(z.literal('')),
  wastedAt: z.string().optional().or(z.literal(''))
});

export const stockDeliveryCheckItemInputSchema = z.object({
  stockItemId: z.string().optional().or(z.literal('')),
  description: z.string().min(1, 'Description is required'),
  expectedQuantity: z.preprocess(emptyStringToUndefined, z.coerce.number().nonnegative().optional()),
  receivedQuantity: z.preprocess(emptyStringToUndefined, z.coerce.number().nonnegative().optional()),
  unit: z.string().optional().or(z.literal('')),
  checked: z.boolean().optional(),
  discrepancy: z.boolean().optional(),
  discrepancyReason: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const stockDeliveryCheckCreateInputSchema = z.object({
  supplierId: z.string().optional().or(z.literal('')),
  supplierName: z.string().min(1, 'Supplier is required'),
  venue: z.string().min(1, 'Venue is required'),
  invoiceNumber: z.string().optional().or(z.literal('')),
  deliveryDate: z.string().optional().or(z.literal('')),
  invoiceReference: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  items: z.array(stockDeliveryCheckItemInputSchema).min(1, 'Add at least one delivery line')
});

export const stockDeliveryCheckUpdateInputSchema = stockDeliveryCheckCreateInputSchema.partial().extend({
  status: stockDeliveryCheckStatusSchema.optional(),
  items: z.array(stockDeliveryCheckItemInputSchema).optional()
});

export const stockReorderNoticeResolveInputSchema = z.object({
  status: stockReorderNoticeStatusSchema.extract(['RESOLVED', 'DISMISSED'])
});

export const stockSupplierOrderLineInputSchema = z.object({
  stockItemId: z.string().min(1, 'Stock item is required'),
  name: z.string().min(1, 'Item name is required'),
  quantity: z.coerce.number().positive('Order quantity must be greater than zero'),
  unit: z.string().min(1, 'Unit is required'),
  note: z.string().optional().or(z.literal(''))
});

export const stockSupplierOrderEmailInputSchema = z.object({
  venue: z.string().min(1, 'Venue is required'),
  supplierId: z.string().optional().or(z.literal('')),
  supplierName: z.string().min(1, 'Supplier is required'),
  supplierEmail: z.string().email('Supplier email is required'),
  note: z.string().optional().or(z.literal('')),
  lines: z.array(stockSupplierOrderLineInputSchema).min(1, 'Add at least one order line')
});

export const stockCategoryCreateInputSchema = z.object({
  name: z.string().min(2, 'Category name is required'),
  description: z.string().optional().or(z.literal(''))
});

export const stockCategoryUpdateInputSchema =
  stockCategoryCreateInputSchema.partial();

export const stockItemCreateInputSchema = z.object({
  sku: z.string().optional().or(z.literal('')),
  name: z.string().min(2, 'Item name is required'),
  categoryId: z.string().optional().or(z.literal('')),
  unit: z.string().min(1, 'Unit is required'),
  parLevel: z.coerce.number().nonnegative('Par level cannot be negative').default(0),
  reorderPoint: z.coerce.number().nonnegative('Reorder point cannot be negative').optional(),
  avgCostCents: z.coerce.number().int().nonnegative().optional(),
  status: stockItemStatusSchema.default('ACTIVE'),
  notes: z.string().optional().or(z.literal(''))
});

export const stockItemUpdateInputSchema = stockItemCreateInputSchema.partial();
export const stockItemBulkDeleteInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one item'),
  confirmationText: z.literal('DELETE ITEMS', {
    errorMap: () => ({ message: 'Type DELETE ITEMS to confirm catalogue deletion' })
  })
});

export type StockCategoryCreateInput = z.infer<
  typeof stockCategoryCreateInputSchema
>;
export type StockCategoryUpdateInput = z.infer<
  typeof stockCategoryUpdateInputSchema
>;
export type StockItemCreateInput = z.infer<typeof stockItemCreateInputSchema>;
export type StockItemUpdateInput = z.infer<typeof stockItemUpdateInputSchema>;
export type StockItemBulkDeleteInput = z.infer<
  typeof stockItemBulkDeleteInputSchema
>;
export type VenueStockItemUpdateInput = z.infer<typeof venueStockItemUpdateInputSchema>;
export type StockWastageCreateInput = z.infer<typeof stockWastageCreateInputSchema>;
export type StockDeliveryCheckCreateInput = z.infer<typeof stockDeliveryCheckCreateInputSchema>;
export type StockDeliveryCheckUpdateInput = z.infer<typeof stockDeliveryCheckUpdateInputSchema>;
export type StockReorderNoticeResolveInput = z.infer<typeof stockReorderNoticeResolveInputSchema>;
export type StockSupplierOrderEmailInput = z.infer<typeof stockSupplierOrderEmailInputSchema>;

/* ------------------------------------------------------------------------- */
/* Suppliers                                                                  */
/* ------------------------------------------------------------------------- */

export type Supplier = {
  id: string;
  legacyId: string | null;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  accountNumber: string | null;
  paymentTerms: string | null;
  notes: string | null;
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
};

export type SuppliersPayload = {
  suppliers: Supplier[];
};

export type SuppliersSummary = {
  totalSuppliers: number;
  activeSuppliers: number;
  archivedSuppliers: number;
};

// We accept blank strings for optional fields to keep the form wiring simple —
// the service layer normalises blanks to null before persisting.
export const supplierCreateInputSchema = z.object({
  name: z.string().min(2, 'Supplier name is required'),
  contactName: z.string().optional().or(z.literal('')),
  email: z
    .string()
    .email('Enter a valid email')
    .optional()
    .or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  website: z.string().optional().or(z.literal('')),
  address: z.string().optional().or(z.literal('')),
  accountNumber: z.string().optional().or(z.literal('')),
  paymentTerms: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
  status: supplierStatusSchema.default('ACTIVE')
});

export const supplierUpdateInputSchema = supplierCreateInputSchema.partial();
export const supplierBulkDeleteInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one supplier'),
  confirmationText: z.literal('DELETE SUPPLIERS', {
    errorMap: () => ({ message: 'Type DELETE SUPPLIERS to confirm supplier deletion' })
  })
});

export type SupplierCreateInput = z.infer<typeof supplierCreateInputSchema>;
export type SupplierUpdateInput = z.infer<typeof supplierUpdateInputSchema>;
export type SupplierBulkDeleteInput = z.infer<typeof supplierBulkDeleteInputSchema>;

/* ------------------------------------------------------------------------- */
/* Supplier invoices                                                          */
/* ------------------------------------------------------------------------- */

export type StockSupplierInvoiceLine = {
  id: string;
  supplierInvoiceId: string;
  lineNumber: number;
  lineKey: string;
  externalLineId: string | null;
  description: string;
  itemCode: string | null;
  accountCode: string | null;
  quantity: number;
  unit: string | null;
  unitAmountCents: number;
  lineAmountCents: number;
  taxAmountCents: number;
  itemId: string | null;
  item: { id: string; name: string; unit: string; avgCostCents: number | null } | null;
  matchingStatus: StockInvoiceMatchingStatus;
  notes: string | null;
  costAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StockSupplierInvoice = {
  id: string;
  source: string;
  invoiceKey: string;
  externalInvoiceId: string | null;
  invoiceNumber: string | null;
  supplierId: string | null;
  supplierName: string;
  supplierEmail: string | null;
  venue: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currencyCode: string;
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  sourceFileName: string | null;
  sourceFileType: string | null;
  importedAt: string;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
  matchedLineCount: number;
  needsReviewLineCount: number;
  lines?: StockSupplierInvoiceLine[];
};

export type StockInvoicesPayload = {
  invoices: StockSupplierInvoice[];
};

export type StockInvoicesSummary = {
  totalInvoices: number;
  needsReviewInvoices: number;
  needsReviewLines: number;
  matchedLines: number;
  importedThisWeek: number;
};

export type StockInvoiceImportResult = {
  importedCount: number;
  createdCount: number;
  updatedCount: number;
  lineCount: number;
  matchedLineCount: number;
  needsReviewLineCount: number;
  warnings: string[];
  invoices: StockSupplierInvoice[];
};

export type StockInvoiceRipResult = {
  invoices: Record<string, unknown>[];
  warnings: string[];
};

export const stockInvoiceImportInputSchema = z.object({
  source: z.string().min(1).default('XERO'),
  venue: z.string().optional().or(z.literal('')),
  sourceFileName: z.string().optional().or(z.literal('')),
  sourceFileType: z.string().optional().or(z.literal('')),
  sourceMetadata: z.record(z.unknown()).optional(),
  invoices: z.array(z.record(z.unknown())).min(1, 'At least one invoice is required'),
  confirmationText: z.literal('IMPORT INVOICES', {
    errorMap: () => ({ message: 'Type IMPORT INVOICES to confirm invoice import' })
  })
});

export const stockInvoiceRipInputSchema = z.object({
  text: z.string().min(10, 'Paste the invoice text first'),
  venue: z.string().optional().or(z.literal('')),
  sourceFileName: z.string().optional().or(z.literal(''))
});

export const stockInvoiceLineRematchInputSchema = z.object({
  itemId: z.string().min(1, 'Choose a stock item').or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export type StockInvoiceImportInput = z.infer<typeof stockInvoiceImportInputSchema>;
export type StockInvoiceRipInput = z.infer<typeof stockInvoiceRipInputSchema>;
export type StockInvoiceLineRematchInput = z.infer<
  typeof stockInvoiceLineRematchInputSchema
>;

/* ------------------------------------------------------------------------- */
/* Recipes                                                                    */
/* ------------------------------------------------------------------------- */

export const recipeCategoryKindSchema = z.enum(['FOOD', 'BEVERAGE', 'OTHER']);
export const recipeStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export type RecipeCategoryKind = z.infer<typeof recipeCategoryKindSchema>;
export type RecipeStatus = z.infer<typeof recipeStatusSchema>;

export type RecipeCategory = {
  id: string;
  name: string;
  kind: RecipeCategoryKind;
  description: string | null;
  recipeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecipeLine = {
  id: string;
  legacyId: string | null;
  recipeId: string;
  position: number;
  ingredientName: string;
  quantity: number | null;
  unit: string | null;
  cost: number | null;
  wastePercent: number | null;
  itemId: string | null;
  item: { id: string; name: string; unit: string; avgCostCents: number | null } | null;
  subRecipeId: string | null;
  subRecipe: { id: string; title: string; yieldQuantity: number | null; yieldUnit: string | null; estimatedCost: number; isPrepRecipe: boolean } | null;
  createdAt: string;
  updatedAt: string;
};

export type Recipe = {
  id: string;
  legacyId: string | null;
  title: string;
  kind: string | null;
  category: string | null;
  subcategory: string | null;
  venue: string | null;
  salePriceCents: number | null;
  portionSize: number | null;
  portionUnit: string | null;
  yieldQuantity: number | null;
  yieldUnit: string | null;
  isPrepRecipe: boolean;
  status: RecipeStatus;
  estimatedCost: number;
  notes: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecipeWithLines = Recipe & { lines: RecipeLine[] };

export type RecipeCostLine = {
  lineId: string;
  ingredientName: string;
  quantity: number | null;
  unit: string | null;
  wastePercent: number | null;
  source: 'STOCK_ITEM' | 'PREP_RECIPE' | 'MANUAL' | 'MISSING';
  unitCostCents: number | null;
  lineCostCents: number | null;
  warnings: string[];
};

export type RecipeCostPayload = {
  recipeId: string;
  batchCostCents: number | null;
  costPerPortionCents: number | null;
  salePriceCents: number | null;
  grossProfitCents: number | null;
  foodCostPercent: number | null;
  yieldQuantity: number | null;
  yieldUnit: string | null;
  portionSize: number | null;
  portionUnit: string | null;
  missingCostCount: number;
  warnings: string[];
  lines: RecipeCostLine[];
};

export type RecipeIngredientOption = {
  id: string;
  type: 'STOCK_ITEM' | 'PREP_RECIPE';
  label: string;
  description: string | null;
  unit: string | null;
  unitCostCents: number | null;
  missingCost: boolean;
};

export type RecipesPayload = {
  recipes: Recipe[];
  categories: string[];
  recipeCategories: RecipeCategory[];
};

export type RecipesSummary = {
  totalRecipes: number;
  totalLines: number;
  averageEstimatedCost: number;
  activeRecipes: number;
  archivedRecipes: number;
  prepRecipes: number;
  itemRecipes: number;
  missingCostRecipes: number;
  categoryCounts: Array<{ category: string; count: number }>;
};

export const recipeLineInputSchema = z.object({
  ingredientName: z.string().min(1, 'Ingredient name is required'),
  quantity: z.coerce.number().optional(),
  unit: z.string().optional().or(z.literal('')),
  cost: z.coerce.number().optional(),
  wastePercent: z.coerce.number().min(0).max(100).optional(),
  itemId: z.string().optional().or(z.literal('')),
  subRecipeId: z.string().optional().or(z.literal(''))
}).refine((line) => !(line.itemId && line.subRecipeId), {
  message: 'Choose either a stock item or a production recipe, not both',
  path: ['subRecipeId']
});

export const recipeCategoryCreateInputSchema = z.object({
  name: z.string().min(2, 'Category name is required'),
  kind: recipeCategoryKindSchema.default('FOOD'),
  description: z.string().optional().or(z.literal(''))
});

export const recipeCategoryUpdateInputSchema =
  recipeCategoryCreateInputSchema.partial();

export const recipeCreateInputSchema = z.object({
  title: z.string().min(2, 'Title is required'),
  kind: z.string().optional().or(z.literal('')),
  category: z.string().optional().or(z.literal('')),
  subcategory: z.string().optional().or(z.literal('')),
  venue: z.string().optional().or(z.literal('')),
  salePriceCents: z.coerce.number().int().nonnegative().optional(),
  portionSize: z.coerce.number().positive().optional(),
  portionUnit: z.string().optional().or(z.literal('')),
  yieldQuantity: z.coerce.number().optional(),
  yieldUnit: z.string().optional().or(z.literal('')),
  isPrepRecipe: z.boolean().optional(),
  status: recipeStatusSchema.optional(),
  estimatedCost: z.coerce.number().optional(),
  notes: z.string().optional().or(z.literal('')),
  lines: z.array(recipeLineInputSchema).optional()
});

export const recipeUpdateInputSchema = recipeCreateInputSchema.partial();
export const recipeBulkDeleteInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one recipe'),
  confirmationText: z.literal('DELETE RECIPES', {
    errorMap: () => ({ message: 'Type DELETE RECIPES to confirm recipe deletion' })
  })
});

export type RecipeLineInput = z.infer<typeof recipeLineInputSchema>;
export type RecipeCategoryCreateInput = z.infer<
  typeof recipeCategoryCreateInputSchema
>;
export type RecipeCategoryUpdateInput = z.infer<
  typeof recipeCategoryUpdateInputSchema
>;
export type RecipeCreateInput = z.infer<typeof recipeCreateInputSchema>;
export type RecipeUpdateInput = z.infer<typeof recipeUpdateInputSchema>;
export type RecipeBulkDeleteInput = z.infer<typeof recipeBulkDeleteInputSchema>;

/* ------------------------------------------------------------------------- */
/* Stocktakes                                                                 */
/* ------------------------------------------------------------------------- */

export type StocktakeLine = {
  id: string;
  legacyId: string | null;
  stocktakeId: string;
  itemId: string | null;
  item: { id: string; name: string; unit: string; onHand: number } | null;
  position: number;
  label: string;
  countedQty: number;
  unit: string | null;
  location: string | null;
  stockValueCents: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Stocktake = {
  id: string;
  legacyId: string | null;
  name: string;
  venue: string | null;
  template: string | null;
  countedAt: string;
  status: StocktakeStatus;
  notes: string | null;
  appliedAt: string | null;
  submittedAt: string | null;
  submittedByUserId: string | null;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  lineCount: number;
  totalValueCents: number;
  createdAt: string;
  updatedAt: string;
};

export type StocktakeWithLines = Stocktake & { lines: StocktakeLine[] };

export type StocktakesPayload = {
  stocktakes: Stocktake[];
};

export type StocktakesSummary = {
  totalStocktakes: number;
  inProgress: number;
  submitted: number;
  applied?: number;
  lastCountedAt: string | null;
  totalValueCents: number;
};

export type StocktakeReviewItem = Stocktake & {
  varianceLineCount: number;
  totalVarianceQuantity: number;
  positiveVarianceQuantity: number;
  negativeVarianceQuantity: number;
};

export type StockDashboardPayload = {
  generatedAt: string;
  scope: {
    venue: string | null;
    admin?: boolean;
    stockItemsVenueScoped: boolean;
  };
  venues?: string[];
  summary: StockItemsSummary & {
    openStocktakes: number;
    readyForReviewStocktakes: number;
  };
  lowStockItems: StockLowStockItem[];
  reorderNotices?: StockReorderNotice[];
  recentItems: StockItem[];
  readyForReviewStocktakes: StocktakeReviewItem[];
  recentSubmittedStocktakes: StocktakeReviewItem[];
};

export type ReportsRangeDays = 7 | 30 | 90;

export type ReportsStaffSummary = {
  totalActiveStaff: number;
  staffByVenue: Array<{ venue: string; count: number }>;
  missingRequiredCompliance: number;
  pendingLeaveCount: number;
  approvedLeaveNext30Days: number;
  recentManagementEvents: StaffManagementEvent[];
};

export type ReportsComplianceSummary = {
  pendingStaffRecords: number;
  expiredStaffRecords: number;
  expiringStaffRecordsNext30Days: number;
  outOfRangeTemperatureAssets: number;
  missingTemperatureReadingsToday: number;
  activeLicences: number;
  expiringLicencesNext30Days: number;
  topAttentionItems: Array<{
    id: string;
    label: string;
    venue: string | null;
    status: string;
    dueDate: string | null;
    source: 'STAFF_RECORD' | 'TEMPERATURE' | 'LICENCE';
  }>;
};

export type ReportsStockSummary = {
  activeStockItems: number;
  activeCatalogueItems?: number;
  venueStockItems?: number;
  unconfiguredVenueStockItems?: number;
  lowStockCount: number;
  outOfStockCount: number;
  stocktakesReadyForReview: number;
  recentlySubmittedStocktakes: StocktakeReviewItem[];
  highestVarianceLines: Array<{
    stocktakeId: string;
    stocktakeName: string;
    venue: string | null;
    itemName: string;
    countedQty: number;
    onHand: number;
    unit: string | null;
    variance: number;
    submittedAt: string | null;
  }>;
  stockItemsVenueScoped: boolean;
};

export type ReportsReserveSummary = {
  bookingsToday: number;
  coversToday: number;
  upcomingBookings: number;
  cancellations: number;
  noShows: number;
  newGuests: number;
};

export type ReportsMarketingSummary = {
  totalGuests: number;
  optedInGuests: number;
  unsubscribedGuests: number;
  repeatVisitors: number;
  campaignDrafts: number;
  simulatedSends: number;
};

export type ReportsContentSummary = {
  scheduledPostsThisWeek: number;
  postsNeedingApproval: number;
  failedSimulatedPublishAttempts: number;
  setupRequiredSocialAccounts: number;
  assetsUploaded: number;
};

export type ReportsGiftCardSummary = {
  pendingOrders: number;
  totalPendingAmountCents: number;
  fulfilledOrders: number;
};

export type ReportsOverviewPayload = {
  generatedAt: string;
  rangeDays: ReportsRangeDays;
  start: string;
  end: string;
  scope: {
    venue: string | null;
    admin: boolean;
  };
  staff: ReportsStaffSummary;
  compliance: ReportsComplianceSummary;
  stock: ReportsStockSummary;
  reserve: ReportsReserveSummary;
  marketing: ReportsMarketingSummary;
  content: ReportsContentSummary;
  giftCards: ReportsGiftCardSummary;
};

export const stocktakeLineInputSchema = z.object({
  itemId: z.string().optional().or(z.literal('')),
  label: z.string().min(1, 'Label is required'),
  countedQty: z.coerce.number(),
  unit: z.string().optional().or(z.literal('')),
  location: z.string().optional().or(z.literal('')),
  stockValueCents: z.coerce.number().int().nonnegative().optional(),
  notes: z.string().optional().or(z.literal(''))
});

export const stocktakeCreateInputSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  venue: z.string().optional().or(z.literal('')),
  template: z.string().optional().or(z.literal('')),
  countedAt: z.string().min(4, 'Counted-at date is required'),
  status: stocktakeStatusSchema.default('IN_PROGRESS'),
  notes: z.string().optional().or(z.literal('')),
  lines: z.array(stocktakeLineInputSchema).optional()
});

export const stocktakeUpdateInputSchema = stocktakeCreateInputSchema.partial();
export const stocktakeBulkDeleteInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'Select at least one stocktake'),
  confirmationText: z.literal('DELETE STOCKTAKES', {
    errorMap: () => ({ message: 'Type DELETE STOCKTAKES to confirm stocktake deletion' })
  })
});

export const inventoryMovementTypeSchema = z.enum([
  'STOCKTAKE_ADJUSTMENT',
  'STOCKTAKE_CORRECTION',
  'STOCKTAKE_REVERSAL',
  'WASTAGE',
  'DELIVERY_RECEIPT'
]);

export const stocktakeCorrectionLineInputSchema = z.object({
  sourceStocktakeLineId: z.string().min(1, 'Select a stocktake line'),
  quantityAfter: z.coerce.number(),
  reason: z.string().min(3, 'Add a short correction reason')
});

export const stocktakeCorrectionInputSchema = z.object({
  corrections: z.array(stocktakeCorrectionLineInputSchema).min(1, 'Add at least one correction')
});

export const stocktakeReversalInputSchema = z.object({
  reason: z.string().optional().or(z.literal(''))
});

export type StocktakeLineInput = z.infer<typeof stocktakeLineInputSchema>;
export type StocktakeCreateInput = z.infer<typeof stocktakeCreateInputSchema>;
export type StocktakeUpdateInput = z.infer<typeof stocktakeUpdateInputSchema>;
export type StocktakeBulkDeleteInput = z.infer<
  typeof stocktakeBulkDeleteInputSchema
>;
export type StocktakeCorrectionInput = z.infer<typeof stocktakeCorrectionInputSchema>;
export type StocktakeReversalInput = z.infer<typeof stocktakeReversalInputSchema>;

export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>;

export type InventoryMovement = {
  id: string;
  itemId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  unit: string | null;
  sourceStocktakeId: string | null;
  sourceStocktakeLineId: string | null;
  sourceWastageId?: string | null;
  sourceDeliveryCheckItemId?: string | null;
  notes: string | null;
  createdAt: string;
};

export type StocktakeMovement = InventoryMovement & {
  item: { id: string; name: string; unit: string; onHand: number } | null;
  sourceStocktakeLine: {
    id: string;
    label: string;
    countedQty: number;
    unit: string | null;
    location: string | null;
  } | null;
};

export type ApplyStocktakeResult = {
  stocktake: StocktakeWithLines;
  movements: InventoryMovement[];
};

export type StocktakeMovementHistoryPayload = {
  stocktake: Stocktake;
  movements: StocktakeMovement[];
  canReverse: boolean;
  hasReversal: boolean;
};

export type StocktakeMovementResult = {
  stocktake: StocktakeWithLines;
  movements: StocktakeMovement[];
};
