import { z } from 'zod';

export {
  ALMA_COMPLIANCE_DOCUMENTS,
  ALMA_IMPORTED_CHECKLIST_TEMPLATES,
  type ImportedChecklistTemplate,
  type ImportedComplianceDocument
} from './complianceImports.js';

export const issueStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'BLOCKED', 'RESOLVED', 'CLOSED']);
export const issueSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const checklistRunStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED']);
export const checklistItemResultSchema = z.enum(['PENDING', 'PASS', 'FAIL', 'NA']);
export const staffRecordTypeSchema = z.enum(['RSA', 'RSG', 'FSS', 'FIRST_AID', 'FOOD_SAFETY', 'ALLERGEN', 'TRAINING', 'OTHER']);
export const staffRecordStatusSchema = z.enum(['PENDING', 'APPROVED', 'EXPIRED']);
export const incidentStatusSchema = z.enum(['OPEN', 'UNDER_REVIEW', 'CLOSED']);
export const temperatureAssetStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const temperatureLogSourceSchema = z.enum(['MANUAL', 'GOVEE']);
export const temperatureLogStatusSchema = z.enum(['IN_RANGE', 'OUT_OF_RANGE']);
export const stockItemStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const supplierStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const stocktakeStatusSchema = z.enum(['IN_PROGRESS', 'SUBMITTED']);
export const stockInvoiceMatchingStatusSchema = z.enum([
  'AUTO_MATCHED',
  'MANUAL_MATCHED',
  'NEEDS_REVIEW'
]);
export const almaAppIdSchema = z.enum(['COMPLIANCE', 'STOCK', 'STAFF', 'REPORTS', 'RESERVE', 'MARKETING', 'GIFTCARDS', 'TRAINING', 'SETTINGS']);
export const staffAppAccessStatusSchema = z.enum(['ENABLED', 'DISABLED', 'PENDING']);
export const rosterShiftStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED']);
export const timesheetStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPORTED']);
export const trainingModuleStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const staffTrainingStatusSchema = z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED']);
export const reserveReservationStatusSchema = z.enum(['PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']);
export const reserveServicePeriodSchema = z.enum(['BREAKFAST', 'LUNCH', 'DINNER', 'EVENT']);
export const marketingChannelSchema = z.enum(['EMAIL', 'SMS']);
export const marketingCampaignStatusSchema = z.enum(['DRAFT', 'READY', 'SENT', 'ARCHIVED']);
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
  status: staffRecordStatusSchema.default('PENDING'),
  documentName: z.string().optional().or(z.literal('')),
  documentUrl: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const staffManagerNoteInputSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const staffProfileCreateInputSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  roleTitle: z.string().min(2),
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
  roleTitle: z.string().min(2),
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
  password: z.string().min(8, 'Password must be at least 8 characters')
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
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional().or(z.literal('')),
  tags: z.array(z.string()).default([]),
  allergyNotes: z.string().optional().or(z.literal('')),
  visitNotes: z.string().optional().or(z.literal(''))
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
  guest: reserveGuestInputSchema.optional(),
  occasion: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal(''))
});

export const reserveReservationUpdateInputSchema = reserveReservationInputSchema.partial();

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
  rules: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean().default(true)
});

export const marketingCampaignInputSchema = z.object({
  name: z.string().min(2),
  channel: marketingChannelSchema.default('EMAIL'),
  status: marketingCampaignStatusSchema.default('DRAFT'),
  audienceName: z.string().optional().or(z.literal('')),
  subject: z.string().optional().or(z.literal('')),
  previewText: z.string().optional().or(z.literal('')),
  body: z.string().min(5),
  scheduledFor: z.string().optional().or(z.literal('')),
  contactIds: z.array(z.string().min(1)).default([])
});

export const marketingCampaignUpdateInputSchema = marketingCampaignInputSchema.partial();

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
  password: z.string().min(1)
});

export const authChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
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
  isAdmin: boolean;
  role: 'ADMIN' | 'MANAGER' | 'STAFF';
  appAccess: Array<Pick<StaffAppAccess, 'appId' | 'status' | 'role' | 'permissions'>>;
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
  goveeApiKey: string | null;
  goveeBaseUrl: string | null;
  notifyEmail: string | null;
  notifyOverdueIssues: boolean;
  notifyExpiringStaff: boolean;
  notifyOutOfRangeTemp: boolean;
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
export type StaffRecordType = z.infer<typeof staffRecordTypeSchema>;
export type StaffRecordStatus = z.infer<typeof staffRecordStatusSchema>;
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
export type TimesheetStatus = z.infer<typeof timesheetStatusSchema>;
export type TrainingModuleStatus = z.infer<typeof trainingModuleStatusSchema>;
export type StaffTrainingStatus = z.infer<typeof staffTrainingStatusSchema>;
export type ReserveReservationStatus = z.infer<typeof reserveReservationStatusSchema>;
export type ReserveServicePeriod = z.infer<typeof reserveServicePeriodSchema>;
export type MarketingChannel = z.infer<typeof marketingChannelSchema>;
export type MarketingCampaignStatus = z.infer<typeof marketingCampaignStatusSchema>;
export type GiftCardStatus = z.infer<typeof giftCardStatusSchema>;
export type GiftCardRedemptionStatus = z.infer<typeof giftCardRedemptionStatusSchema>;
export type IssueFormInput = z.infer<typeof issueCreateInputSchema>;
export type StaffProfileCreateInput = z.infer<typeof staffProfileCreateInputSchema>;
export type StaffProfileUpdateInput = z.infer<typeof staffProfileUpdateInputSchema>;
export type StaffManagerNoteInput = z.infer<typeof staffManagerNoteInputSchema>;
export type RosterShiftInput = z.infer<typeof rosterShiftInputSchema>;
export type RosterShiftUpdateInput = z.infer<typeof rosterShiftUpdateInputSchema>;
export type TimesheetCreateInput = z.infer<typeof timesheetCreateInputSchema>;
export type TimesheetUpdateInput = z.infer<typeof timesheetUpdateInputSchema>;
export type TrainingModuleInput = z.infer<typeof trainingModuleInputSchema>;
export type TrainingPayRuleInput = z.infer<typeof trainingPayRuleInputSchema>;
export type StaffTrainingAssignInput = z.infer<typeof staffTrainingAssignInputSchema>;
export type StaffTrainingUpdateInput = z.infer<typeof staffTrainingUpdateInputSchema>;
export type ReserveGuestInput = z.infer<typeof reserveGuestInputSchema>;
export type ReserveTableInput = z.infer<typeof reserveTableInputSchema>;
export type ReserveReservationInput = z.infer<typeof reserveReservationInputSchema>;
export type ReserveReservationUpdateInput = z.infer<typeof reserveReservationUpdateInputSchema>;
export type MarketingContactInput = z.infer<typeof marketingContactInputSchema>;
export type MarketingContactUpdateInput = z.infer<typeof marketingContactUpdateInputSchema>;
export type MarketingSegmentInput = z.infer<typeof marketingSegmentInputSchema>;
export type MarketingCampaignInput = z.infer<typeof marketingCampaignInputSchema>;
export type MarketingCampaignUpdateInput = z.infer<typeof marketingCampaignUpdateInputSchema>;
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

export type StaffComplianceRecord = {
  id: string;
  staffProfileId: string;
  recordType: StaffRecordType;
  title: string;
  issuer: string | null;
  certificateNumber: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  status: StaffRecordStatus;
  documentName: string | null;
  documentUrl: string | null;
  notes: string | null;
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

export type ReserveGuest = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  allergyNotes: string | null;
  visitNotes: string | null;
  createdAt: string;
  updatedAt: string;
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
  occasion: string | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  guest: ReserveGuest;
  table: ReserveTable | null;
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
  rules: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingCampaignRecipient = {
  id: string;
  campaignId: string;
  contactId: string;
  status: string;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  contact: MarketingContact;
};

export type MarketingCampaign = {
  id: string;
  name: string;
  channel: MarketingChannel;
  status: MarketingCampaignStatus;
  audienceName: string | null;
  subject: string | null;
  previewText: string | null;
  body: string;
  scheduledFor: string | null;
  sentAt: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  recipients: MarketingCampaignRecipient[];
};

export type MarketingOverview = {
  contacts: MarketingContact[];
  segments: MarketingSegment[];
  campaigns: MarketingCampaign[];
  totals: {
    contacts: number;
    emailConsent: number;
    smsConsent: number;
    draftCampaigns: number;
    readyCampaigns: number;
    reserveGuestContacts: number;
  };
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
  roleTitle: string;
  email: string | null;
  phone: string | null;
  venue: string | null;
  employmentStatus: string;
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
};

export type StockItemsPayload = {
  items: StockItem[];
  categories: StockCategory[];
};

export type StockItemsSummary = {
  totalItems: number;
  activeItems: number;
  lowStockItems: number;
  categories: number;
  totalOnHand: number;
};

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
  parLevel: z.coerce.number().default(0),
  reorderPoint: z.coerce.number().optional(),
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
export type RecipeCategoryKind = z.infer<typeof recipeCategoryKindSchema>;

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
  itemId: string | null;
  item: { id: string; name: string; unit: string } | null;
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
  estimatedCost: number;
  notes: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
};

export type RecipeWithLines = Recipe & { lines: RecipeLine[] };

export type RecipesPayload = {
  recipes: Recipe[];
  categories: string[];
  recipeCategories: RecipeCategory[];
};

export type RecipesSummary = {
  totalRecipes: number;
  totalLines: number;
  averageEstimatedCost: number;
  categoryCounts: Array<{ category: string; count: number }>;
};

export const recipeLineInputSchema = z.object({
  ingredientName: z.string().min(1, 'Ingredient name is required'),
  quantity: z.coerce.number().optional(),
  unit: z.string().optional().or(z.literal('')),
  cost: z.coerce.number().optional(),
  itemId: z.string().optional().or(z.literal(''))
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
  lastCountedAt: string | null;
  totalValueCents: number;
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
  'STOCKTAKE_REVERSAL'
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
