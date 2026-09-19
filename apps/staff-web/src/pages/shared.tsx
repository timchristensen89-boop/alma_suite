// Helpers, hooks and sub-components that App.tsx and the page chunks both
// use. Moved verbatim out of App.tsx; nothing here is edited.

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type {
  AlmaAppId,
  StaffComplianceRecord,
  StaffProfile,
  StaffRoleTemplate,
  StaffHrRecord,
  StaffHrRecordStatus,
  StaffHrRecordType,
  StaffLeaveRequest,
  StaffLeaveStatus,
  StaffLeaveType
} from '@alma/shared';
import { ActionFeedback, Badge, Button, EmptyState, Input, Select, Textarea } from '@alma/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { addDays, toDateInput, formatCents } from '../lib/datetime';
import { IconBadgeCheck, IconFiles, IconFileSignature, IconTriangle, IconWallet } from '../../../web/src/lib/icons';

export const STAFF_APPS: Array<{ id: AlmaAppId; label: string; role: string }> = [
  { id: 'COMPLIANCE', label: 'Compliance', role: 'MANAGER' },
  { id: 'STOCK', label: 'Stock', role: 'USER' },
  { id: 'STAFF', label: 'Staff', role: 'MANAGER' },
  { id: 'REPORTS', label: 'Reports', role: 'USER' },
  { id: 'RESERVE', label: 'Reserve', role: 'USER' },
  { id: 'MARKETING', label: 'Marketing', role: 'USER' },
  { id: 'GIFTCARDS', label: 'Giftcards', role: 'USER' },
  { id: 'TRAINING', label: 'Academy', role: 'USER' },
  { id: 'SETTINGS', label: 'Settings', role: 'ADMIN' }
];

// ── Labour vs takings ────────────────────────────────────────────────────
// The week's roster priced against the week's ACTUAL takings (the roster
// board compares against forecast). Per person: rostered hours vs contract,
// the salary-headroom band (contract → 45, already paid for), and real
// overtime past 45 in dollars. Contract hours are editable inline — this
// page is where they matter, so this page is where they're set.
export type LabourWeekPayload = {
  weekStart: string;
  venues: string[];
  days: Array<{
    date: string;
    byVenue: Array<{
      venue: string;
      salesCents: number | null;
      rosteredHours: number;
      estCostCents: number;
      openHours: number;
      labourPct: number | null;
    }>;
  }>;
  people: Array<{
    staffProfileId: string;
    name: string;
    employmentType: string;
    contractedWeeklyHours: number | null;
    rosteredHours: number;
    headroomHours: number;
    overtimeHours: number;
    overAgreedHours: number;
    overtimeCostCents: number;
    estWeekCostCents: number;
    rateKnown: boolean;
  }>;
  totals: { salesCents: number; estCostCents: number; overtimeCostCents: number };
};

export function labourMondayOf(offsetWeeks = 0): string {
  const now = new Date();
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offsetWeeks * 7);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function labourMoney(cents: number) {
  return (cents / 100).toLocaleString('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
}

export const VENUE_OPTIONS = [
  { label: 'Select venue / group', value: '' },
  { label: 'Alma Avalon', value: 'Alma Avalon' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Both', value: 'Both' }
];

export const ROSTER_CLOSED_DAYS_STORAGE_KEY = 'alma.staff.roster.closedDays.v1';

export const ROSTER_AREA_SETTINGS_STORAGE_KEY = 'alma.staff.roster.areas.v1';

export const DEFAULT_ROSTER_AREAS = ['Floor', 'Bar', 'Kitchen', 'Management', 'Events', 'Training'];

export const LEAVE_TYPE_OPTIONS: Array<{ label: string; value: StaffLeaveType }> = [
  { label: 'Annual leave', value: 'ANNUAL' },
  { label: 'Sick leave', value: 'SICK' },
  { label: 'Personal leave', value: 'PERSONAL' },
  { label: 'Unpaid leave', value: 'UNPAID' },
  { label: 'Other leave', value: 'OTHER' }
];

export const LEAVE_STATUS_OPTIONS: Array<{ label: string; value: StaffLeaveStatus }> = [
  { label: 'Pending', value: 'PENDING' },
  { label: 'Approved', value: 'APPROVED' },
  { label: 'Declined', value: 'DECLINED' },
  { label: 'Cancelled', value: 'CANCELLED' }
];

export type StaffComplianceDocumentRecord = Omit<StaffComplianceRecord, 'status'> & {
  dueAt?: string | null;
  rejectionReason?: string | null;
  requestedAt?: string | null;
  status: string;
};

export type RosterAreaSettings = {
  order: string[];
  hidden: string[];
  deleted: string[];
};

export function staffPermissions(user: ReturnType<typeof useAuth>['user']) {
  return user?.appAccess.find((access) => access.appId === 'STAFF' && access.status === 'ENABLED')?.permissions ?? {};
}

export function canAccessSettings(user: ReturnType<typeof useAuth>['user']) {
  const settingsAccess = user?.appAccess.find((access) => access.appId === 'SETTINGS' && access.status === 'ENABLED');
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      settingsAccess?.role === 'ADMIN' ||
      settingsAccess?.permissions?.admin)
  );
}

export function canManageCommunications(user: ReturnType<typeof useAuth>['user']) {
  const permissions = staffPermissions(user);
  return Boolean(
    user &&
    (user.isAdmin ||
      user.role === 'ADMIN' ||
      user.role === 'MANAGER' ||
      permissions.admin ||
      permissions.communicationsManage ||
      permissions.announcementsManage ||
      permissions.chatModerate)
  );
}

export type StaffFormState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; member: StaffProfile };

export function normaliseEmploymentStatus(member: Pick<StaffProfile, 'employmentStatus'>) {
  return member.employmentStatus.trim().toUpperCase();
}

export function isTerminatedStaffProfile(member: Pick<StaffProfile, 'employmentStatus'>) {
  const status = normaliseEmploymentStatus(member);
  return status !== 'ACTIVE' && status !== 'PENDING';
}

/** Who a staff picker offers: current people by default, everyone on request.
 * Hundreds of past staff sit on the register, and a dropdown that lists them
 * all buries the twenty who work here. Whoever is already selected stays in
 * the list either way, so an open form never loses its person. */
export function staffForPicker<T extends Pick<StaffProfile, 'id' | 'employmentStatus'>>(
  list: T[],
  showTerminated: boolean,
  keepId?: string
): T[] {
  if (showTerminated) return list;
  return list.filter((member) => !isTerminatedStaffProfile(member) || member.id === keepId);
}

export function ShowTerminatedStaffToggle({
  staff,
  checked,
  onChange
}: {
  staff: Array<Pick<StaffProfile, 'employmentStatus'>>;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const hidden = staff.filter(isTerminatedStaffProfile).length;
  if (hidden === 0 && !checked) return null;
  return (
    <label className="check-row staff-picker-scope">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} />
      Show terminated staff{hidden > 0 ? ` (${hidden})` : ''}
    </label>
  );
}

export type StaffDraft = {
  firstName: string;
  lastName: string;
  roleTemplateId: string;
  roleTitle: string;
  email: string;
  phone: string;
  venue: string;
  employmentStatus: string;
  startDate: string;
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  employmentType: string;
  payType: string;
  payRate: string;
  payAward: string;
  taxFileNumber: string;
  taxResidencyStatus: string;
  taxFreeThreshold: boolean;
  hasStudyTrainingLoan: boolean;
  superFundName: string;
  superFundAbn: string;
  superFundUsi: string;
  superMemberNumber: string;
  bankAccountName: string;
  bankBsb: string;
  bankAccountNumber: string;
  visaStatus: string;
  visaSubclass: string;
  visaExpiryDate: string;
  workRightsNotes: string;
  xeroEmployeeId: string;
  xeroPayrollCalendarId: string;
  xeroEarningsRateId: string;
  notes: string;
};

export function emptyStaffDraft(): StaffDraft {
  return {
    firstName: '',
    lastName: '',
    roleTemplateId: '',
    roleTitle: '',
    email: '',
    phone: '',
    venue: '',
    employmentStatus: 'ACTIVE',
    startDate: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    suburb: '',
    state: '',
    postcode: '',
    emergencyContactName: '',
    emergencyContactRelationship: '',
    emergencyContactPhone: '',
    employmentType: '',
    payType: '',
    payRate: '',
    payAward: '',
    taxFileNumber: '',
    taxResidencyStatus: '',
    taxFreeThreshold: false,
    hasStudyTrainingLoan: false,
    superFundName: '',
    superFundAbn: '',
    superFundUsi: '',
    superMemberNumber: '',
    bankAccountName: '',
    bankBsb: '',
    bankAccountNumber: '',
    visaStatus: '',
    visaSubclass: '',
    visaExpiryDate: '',
    workRightsNotes: '',
    xeroEmployeeId: '',
    xeroPayrollCalendarId: '',
    xeroEarningsRateId: '',
    notes: ''
  };
}

export function draftFromStaff(member: StaffProfile): StaffDraft {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    roleTemplateId: member.roleTemplateId ?? '',
    roleTitle: member.roleTitle,
    email: member.email ?? '',
    phone: member.phone ?? '',
    venue: member.venue ?? '',
    employmentStatus: member.employmentStatus,
    startDate: member.startDate ? toDateInput(new Date(member.startDate)) : '',
    dateOfBirth: member.dateOfBirth ? toDateInput(new Date(member.dateOfBirth)) : '',
    addressLine1: member.addressLine1 ?? '',
    addressLine2: member.addressLine2 ?? '',
    suburb: member.suburb ?? '',
    state: member.state ?? '',
    postcode: member.postcode ?? '',
    emergencyContactName: member.emergencyContactName ?? '',
    emergencyContactRelationship: member.emergencyContactRelationship ?? '',
    emergencyContactPhone: member.emergencyContactPhone ?? '',
    employmentType: member.employmentType ?? '',
    payType: member.payType ?? '',
    payRate: member.payRateCents ? String(member.payRateCents / 100) : '',
    payAward: member.payAward ?? '',
    taxFileNumber: member.taxFileNumber ?? '',
    taxResidencyStatus: member.taxResidencyStatus ?? '',
    taxFreeThreshold: Boolean(member.taxFreeThreshold),
    hasStudyTrainingLoan: Boolean(member.hasStudyTrainingLoan),
    superFundName: member.superFundName ?? '',
    superFundAbn: member.superFundAbn ?? '',
    superFundUsi: member.superFundUsi ?? '',
    superMemberNumber: member.superMemberNumber ?? '',
    bankAccountName: member.bankAccountName ?? '',
    bankBsb: member.bankBsb ?? '',
    bankAccountNumber: member.bankAccountNumber ?? '',
    visaStatus: member.visaStatus ?? '',
    visaSubclass: member.visaSubclass ?? '',
    visaExpiryDate: member.visaExpiryDate ? toDateInput(new Date(member.visaExpiryDate)) : '',
    workRightsNotes: member.workRightsNotes ?? '',
    xeroEmployeeId: member.xeroEmployeeId ?? '',
    xeroPayrollCalendarId: member.xeroPayrollCalendarId ?? '',
    xeroEarningsRateId: member.xeroEarningsRateId ?? '',
    notes: member.notes ?? ''
  };
}

export function staffPayloadFromDraft(draft: StaffDraft) {
  const payRate = Number(draft.payRate.replace(/[^0-9.]/g, ''));
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    roleTemplateId: draft.roleTemplateId || undefined,
    roleTitle: draft.roleTitle.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    venue: draft.venue.trim(),
    employmentStatus: draft.employmentStatus,
    startDate: draft.startDate,
    dateOfBirth: draft.dateOfBirth,
    addressLine1: draft.addressLine1.trim(),
    addressLine2: draft.addressLine2.trim(),
    suburb: draft.suburb.trim(),
    state: draft.state.trim(),
    postcode: draft.postcode.trim(),
    emergencyContactName: draft.emergencyContactName.trim(),
    emergencyContactRelationship: draft.emergencyContactRelationship.trim(),
    emergencyContactPhone: draft.emergencyContactPhone.trim(),
    employmentType: draft.employmentType.trim(),
    payType: draft.payType.trim(),
    payRateCents: Number.isFinite(payRate) && draft.payRate.trim() ? Math.round(payRate * 100) : undefined,
    payAward: draft.payAward.trim(),
    taxFileNumber: draft.taxFileNumber.trim(),
    taxResidencyStatus: draft.taxResidencyStatus.trim(),
    taxFreeThreshold: draft.taxFreeThreshold,
    hasStudyTrainingLoan: draft.hasStudyTrainingLoan,
    superFundName: draft.superFundName.trim(),
    superFundAbn: draft.superFundAbn.trim(),
    superFundUsi: draft.superFundUsi.trim(),
    superMemberNumber: draft.superMemberNumber.trim(),
    bankAccountName: draft.bankAccountName.trim(),
    bankBsb: draft.bankBsb.trim(),
    bankAccountNumber: draft.bankAccountNumber.trim(),
    visaStatus: draft.visaStatus.trim(),
    visaSubclass: draft.visaSubclass.trim(),
    visaExpiryDate: draft.visaExpiryDate,
    workRightsNotes: draft.workRightsNotes.trim(),
    xeroEmployeeId: draft.xeroEmployeeId.trim(),
    xeroPayrollCalendarId: draft.xeroPayrollCalendarId.trim(),
    xeroEarningsRateId: draft.xeroEarningsRateId.trim(),
    notes: draft.notes.trim()
  };
}

export function StaffModal({
  open,
  title,
  subtitle,
  children,
  onClose,
  width = 'wide'
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  width?: 'standard' | 'wide';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without making it an effect dependency — otherwise
  // the parent's inline `onClose={() => …}` changes identity every render, the
  // effect re-runs, and `panel.focus()` yanks focus out of whatever input the
  // user is typing in (the "type one letter then it clicks out" bug).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => panelRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="staff-modal-backdrop">
      <section
        ref={panelRef}
        className={`staff-modal staff-modal-${width}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-modal-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="staff-modal-header">
          <span>
            <h2 id="staff-modal-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </span>
          <button type="button" className="staff-modal-close" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </header>
        <div className="staff-modal-body">
          {children}
        </div>
      </section>
    </div>
  );
}

export function roleTemplateAccessSummary(template?: StaffRoleTemplate | null) {
  if (!template) return 'Choose a role template to apply app access.';
  const enabled = template.access.filter((access) => access.status === 'ENABLED');
  if (!enabled.length) return 'No apps enabled by this role yet.';
  return enabled
    .map((access) => `${access.appId.toLowerCase()}: ${access.role.toLowerCase()}`)
    .slice(0, 4)
    .join(' · ');
}

export function StaffProfileForm({
  mode,
  initial,
  roleTemplates,
  onSaved,
  onCancel
}: {
  mode: 'create' | 'edit';
  initial?: StaffProfile;
  roleTemplates: StaffRoleTemplate[];
  onSaved: (member: StaffProfile) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<StaffDraft>(() => (initial ? draftFromStaff(initial) : emptyStaffDraft()));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

  function update<K extends keyof StaffDraft>(key: K, value: StaffDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function selectRoleTemplate(roleTemplateId: string) {
    const template = roleTemplates.find((item) => item.id === roleTemplateId);
    setDraft((current) => ({
      ...current,
      roleTemplateId,
      roleTitle: template ? template.roleTitle || template.name : current.roleTitle,
      venue: template?.venue || current.venue
    }));
  }

  async function submit() {
    setFeedback(null);
    if (!draft.firstName.trim() || !draft.lastName.trim() || (!draft.roleTemplateId && !draft.roleTitle.trim())) {
      setFeedback('First name, last name and role are required');
      setFeedbackTone('error');
      return;
    }
    if (roleTemplates.length && !draft.roleTemplateId) {
      setFeedback('Choose a role template before saving.');
      setFeedbackTone('error');
      return;
    }
    const payload = staffPayloadFromDraft(draft);

    setSaving(true);
    try {
      if (mode === 'edit' && initial) {
        const saved = await api<StaffProfile>(`/api/staff/${initial.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          });
        setFeedback('Staff profile saved.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(saved), 500);
      } else {
        const created = await api<StaffProfile>('/api/staff', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        setFeedback('Staff profile created.');
        setFeedbackTone('success');
        window.setTimeout(() => onSaved(created), 500);
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not save staff profile');
      setFeedbackTone('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="staff-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="form-grid two">
        <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
        <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
      </div>
      <div className="form-grid two">
        {roleTemplates.length ? (
          <Select
            label="Role"
            required
            value={draft.roleTemplateId}
            onChange={(event) => selectRoleTemplate(event.currentTarget.value)}
            options={[
              { label: 'Choose a role template', value: '' },
              ...roleTemplates.map((template) => ({
                label: template.roleTitle && template.roleTitle !== template.name ? `${template.name} (${template.roleTitle})` : template.name,
                value: template.id
              }))
            ]}
          />
        ) : (
          <Input label="Role" required value={draft.roleTitle} onChange={(event) => update('roleTitle', event.currentTarget.value)} />
        )}
        <Select label="Venue" value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
      </div>
      {roleTemplates.length ? (
        <details className="staff-role-preview">
          <summary>{draft.roleTemplateId ? 'Role access preview' : 'Choose a role to preview access'}</summary>
          <p className="subtle">{roleTemplateAccessSummary(roleTemplates.find((template) => template.id === draft.roleTemplateId))}</p>
          {mode === 'edit' && draft.roleTemplateId !== (initial?.roleTemplateId ?? '') ? (
            <p className="subtle">Changing role will update this person’s app access to match the selected role.</p>
          ) : null}
        </details>
      ) : (
        <p className="subtle">No role templates exist yet. Admins can create them in Alma Admin / Roles.</p>
      )}
      <div className="form-grid three">
        <Input label="Email" type="email" value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
        <Input label="Phone" value={draft.phone} onChange={(event) => update('phone', event.currentTarget.value)} />
        <Select
          label="Status"
          value={draft.employmentStatus}
          onChange={(event) => update('employmentStatus', event.currentTarget.value)}
          options={['ACTIVE', 'PENDING', 'ARCHIVED', 'TERMINATED'].map((status) => ({ label: status, value: status }))}
        />
      </div>
      <Input label="Start date" type="date" value={draft.startDate} onChange={(event) => update('startDate', event.currentTarget.value)} />
      <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />
      <div className="toolbar-right">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create staff'}</Button>
        <ActionFeedback message={feedback} tone={feedbackTone} />
      </div>
    </form>
  );
}

export function staffInitials(member: Pick<StaffProfile, 'firstName' | 'lastName'>) {
  return `${member.firstName?.[0] ?? ''}${member.lastName?.[0] ?? ''}`.trim().toUpperCase() || 'SP';
}

export type StaffInvite = {
  id: string;
  token: string;
  email: string | null;
  note: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  staffProfileId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedStaffInvite = StaffInvite & {
  inviteLink?: string | null;
  emailDelivery?: { status: string; reason?: string };
};

export type StaffDocumentPromptAction = 'delete' | 'request';

export const HR_SECTION_LINKS: Array<{
  to: string;
  title: string;
  description: string;
  icon: JSX.Element;
  type?: StaffHrRecordType;
}> = [
  {
    to: '/hr/contracts',
    title: 'Contracts',
    description: 'Upload signed contracts and issued employment agreements.',
    icon: <IconFileSignature />,
    type: 'CONTRACT'
  },
  {
    to: '/hr/warnings',
    title: 'Written warnings',
    description: 'Store written warnings, reasons, notes and follow-up dates.',
    icon: <IconTriangle />,
    type: 'WARNING'
  },
  {
    to: '/hr/pay-changes',
    title: 'Pay changes',
    description: 'Record approved pay-change letters and effective dates.',
    icon: <IconWallet />,
    type: 'PAY_CHANGE'
  },
  {
    to: '/hr/right-to-work',
    title: 'Right to work',
    description: 'Restricted visa and work-rights records.',
    icon: <IconBadgeCheck />,
    type: 'RIGHT_TO_WORK'
  },
  {
    to: '/hr/documents',
    title: 'Documents',
    description: 'General HR document register with staff and status filters.',
    icon: <IconFiles />
  }
];

export function hrTypeLabel(type: StaffHrRecordType) {
  return type.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

export function hrStatusTone(status: StaffHrRecordStatus): 'positive' | 'warning' | 'danger' | 'info' | 'muted' {
  if (['SIGNED', 'STORED', 'APPROVED'].includes(status)) return 'positive';
  if (['DRAFT', 'PENDING', 'SENT', 'ISSUED', 'RE_REQUESTED'].includes(status)) return 'warning';
  if (status === 'EXPIRED') return 'danger';
  return 'muted';
}

export function staffLabel(member?: Pick<StaffProfile, 'firstName' | 'lastName' | 'roleTitle' | 'venue'> | null) {
  if (!member) return 'Unknown staff';
  return `${member.firstName} ${member.lastName} · ${member.roleTitle}${member.venue ? ` · ${member.venue}` : ''}`;
}

// Order staff for dropdowns: active first, then everyone else, each group A→Z by
// name. Keeps the people you pick most (current staff) at the top of every
// selector while still listing past staff below for historical entries.
export function sortStaffForSelect<T extends { firstName?: string; lastName?: string; employmentStatus?: string }>(
  list: T[]
): T[] {
  return [...list].sort((a, b) => {
    const aActive = a.employmentStatus === 'ACTIVE' ? 0 : 1;
    const bActive = b.employmentStatus === 'ACTIVE' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return `${a.firstName ?? ''} ${a.lastName ?? ''}`
      .trim()
      .localeCompare(`${b.firstName ?? ''} ${b.lastName ?? ''}`.trim(), undefined, { sensitivity: 'base' });
  });
}

export function HrRecordList({
  records,
  emptyTitle,
  canManage = false,
  saving = false,
  mode,
  canApprove = false,
  currentUserId = '',
  onRemoveDocument,
  onRequestDocument,
  onSubmitForApproval,
  onApprovePayChange,
  onReturnToDraft
}: {
  records: StaffHrRecord[];
  emptyTitle: string;
  canManage?: boolean;
  saving?: boolean;
  mode?: 'contracts' | 'warnings' | 'pay-changes' | 'right-to-work' | 'documents';
  canApprove?: boolean;
  currentUserId?: string;
  onRemoveDocument?: (record: StaffHrRecord) => Promise<void>;
  onRequestDocument?: (record: StaffHrRecord) => Promise<void>;
  onSubmitForApproval?: (record: StaffHrRecord) => Promise<void>;
  onApprovePayChange?: (record: StaffHrRecord) => Promise<void>;
  onReturnToDraft?: (record: StaffHrRecord) => Promise<void>;
}) {
  if (!records.length) {
    return <EmptyState title={emptyTitle} description="HR records filed here stay separate from normal staff compliance documents." />;
  }

  const isPayChangePage = mode === 'pay-changes';

  return (
    <div className="staff-list">
      {records.map((record) => {
        const isPayChange = record.recordType === 'PAY_CHANGE';
        // Separation of duties: the manager who drafted cannot approve their own change.
        const draftedByMe = isPayChange && currentUserId && record.createdById === currentUserId;
        const canShowSubmit = isPayChange && canManage && onSubmitForApproval && (record.status === 'DRAFT' || record.status === 'RE_REQUESTED');
        const canShowApprove = isPayChange && canApprove && onApprovePayChange && record.status === 'PENDING' && !draftedByMe;
        const canShowReturn = isPayChange && canManage && onReturnToDraft && record.status === 'PENDING';
        const blockedBySeparation = isPayChange && canApprove && record.status === 'PENDING' && draftedByMe;

        return (
        <div key={record.id} className="staff-expiry-row">
          <span>
            <strong>{record.title}</strong>
            <span className="subtle">{hrTypeLabel(record.recordType)} · {staffLabel(record.staffProfile)} · {record.issueDate ? new Date(record.issueDate).toLocaleDateString() : 'No issue date'}</span>
            {record.effectiveDate ? <span className="subtle">Effective {new Date(record.effectiveDate).toLocaleDateString()}</span> : null}
            {record.expiryDate ? <span className="subtle">Expires {new Date(record.expiryDate).toLocaleDateString()}</span> : null}
            {record.followUpDate ? <span className="subtle">Follow up {new Date(record.followUpDate).toLocaleDateString()}</span> : null}
            {isPayChange ? (
              <span className="subtle">
                {record.oldRateCents !== null ? `Old ${formatCents(record.oldRateCents)}` : 'Old rate not recorded'}
                {' -> '}
                {record.newRateCents !== null ? `New ${formatCents(record.newRateCents)}` : 'New rate not recorded'}
              </span>
            ) : null}
            {record.reason ? <span className="subtle">{record.reason}</span> : null}
            {record.documentName ? <span className="subtle">{record.documentName}</span> : null}
            <StaffDocumentViewLink documentUrl={record.documentUrl} />
            {record.notes ? <span className="subtle">{record.notes}</span> : null}
            {isPayChange ? (
              <span className="subtle">
                {record.createdById ? `Drafted by ${record.createdById === currentUserId ? 'you' : 'a manager'}` : 'Drafted'}
                {' on '}
                {new Date(record.createdAt).toLocaleDateString()}
                {record.updatedById && record.updatedById !== record.createdById && record.status === 'APPROVED'
                  ? ` · Approved ${new Date(record.updatedAt).toLocaleDateString()}${record.updatedById === currentUserId ? ' by you' : ''}`
                  : ''}
              </span>
            ) : null}
            {blockedBySeparation ? (
              <span className="subtle" style={{ color: '#7a1f3d' }}>
                You drafted this pay change, so another admin must approve it.
              </span>
            ) : null}
          </span>
          <span className="invite-row-actions">
            <Badge tone={hrStatusTone(record.status)}>{record.status.replaceAll('_', ' ')}</Badge>
            {canShowSubmit ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void onSubmitForApproval!(record)}>
                Submit for approval
              </Button>
            ) : null}
            {canShowApprove ? (
              <Button type="button" size="sm" disabled={saving} onClick={() => void onApprovePayChange!(record)}>
                Approve pay change
              </Button>
            ) : null}
            {canShowReturn ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onReturnToDraft!(record)}>
                Return to draft
              </Button>
            ) : null}
            {canManage && record.documentUrl && onRemoveDocument && !(isPayChangePage && record.status === 'APPROVED') ? (
              <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void onRemoveDocument(record)}>
                Remove document
              </Button>
            ) : null}
            {canManage && onRequestDocument && !(isPayChangePage && record.status === 'APPROVED') ? (
              <Button type="button" size="sm" variant="secondary" disabled={saving} onClick={() => void onRequestDocument(record)}>
                Re-request
              </Button>
            ) : null}
          </span>
        </div>
        );
      })}
    </div>
  );
}

export function leaveStatusTone(status: StaffLeaveStatus): 'positive' | 'warning' | 'danger' | 'muted' {
  if (status === 'APPROVED') return 'positive';
  if (status === 'PENDING') return 'warning';
  if (status === 'DECLINED') return 'danger';
  return 'muted';
}

export function leaveTypeLabel(value: StaffLeaveType) {
  return LEAVE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function leaveStatusLabel(value: StaffLeaveStatus) {
  return LEAVE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function leaveOverlapsDay(leave: StaffLeaveRequest, day: Date) {
  const start = new Date(leave.startDate);
  const end = new Date(leave.endDate);
  const target = new Date(day);
  target.setHours(0, 0, 0, 0);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return target >= start && target <= end;
}

export function weekDays(reference: Date, length = 7) {
  return Array.from({ length }, (_, index) => {
    return addDays(reference, index);
  });
}

// Pure date/time/format helpers moved to ./lib/datetime (staff-web breakup).

export function rosterClosedDaysScopeKey(weekStart: Date, boardDays: number, venue: string) {
  return `${toDateInput(weekStart)}:${boardDays}:${normaliseRosterAreaName(venue)}`;
}

export function loadRosterClosedDays(): Record<string, string[]> {
  try {
    const raw = window.localStorage.getItem(ROSTER_CLOSED_DAYS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.entries(parsed).reduce((draft, [scope, value]) => {
      if (Array.isArray(value)) {
        draft[scope] = value.filter((item): item is string => typeof item === 'string');
      }
      return draft;
    }, {} as Record<string, string[]>);
  } catch {
    return {};
  }
}

export function normaliseRosterAreaName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function normaliseRosterAreaKey(value: string) {
  return normaliseRosterAreaName(value).toLowerCase();
}

export function loadRosterAreaSettings(): RosterAreaSettings {
  const fallback: RosterAreaSettings = {
    order: DEFAULT_ROSTER_AREAS,
    hidden: [],
    deleted: []
  };

  try {
    const raw = window.localStorage.getItem(ROSTER_AREA_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<RosterAreaSettings>;
    return {
      order: Array.isArray(parsed.order) ? uniqueRosterAreaNames(parsed.order) : fallback.order,
      hidden: Array.isArray(parsed.hidden) ? uniqueRosterAreaNames(parsed.hidden) : fallback.hidden,
      deleted: Array.isArray(parsed.deleted) ? uniqueRosterAreaNames(parsed.deleted) : fallback.deleted
    };
  } catch {
    return fallback;
  }
}

export function uniqueRosterAreaNames(values: unknown[]) {
  const seen = new Set<string>();
  return values.reduce<string[]>((areas, value) => {
    if (typeof value !== 'string') return areas;
    const name = normaliseRosterAreaName(value);
    const key = normaliseRosterAreaKey(name);
    if (!name || seen.has(key)) return areas;
    seen.add(key);
    areas.push(name);
    return areas;
  }, []);
}

export function mergeRosterAreas(settings: RosterAreaSettings, rosterAreas: string[]) {
  const deleted = new Set(settings.deleted.map(normaliseRosterAreaKey));
  const ordered = uniqueRosterAreaNames(settings.order);
  const discovered = uniqueRosterAreaNames([...DEFAULT_ROSTER_AREAS, ...rosterAreas]);
  const merged = uniqueRosterAreaNames([...ordered, ...discovered]);
  return merged.filter((areaName) => !deleted.has(normaliseRosterAreaKey(areaName)));
}

export const AREA_THEMES: Record<string, { bg: string; border: string; text: string }> = {
  // Alma design-system role palette (Roster Redesign 1A)
  bar: { bg: '#F7E4D8', border: '#9A3A2E', text: '#6E2419' },
  'floor day': { bg: '#EAF0E1', border: '#4F6B47', text: '#2F4129' },
  'floor night': { bg: '#EAF0E1', border: '#4F6B47', text: '#2F4129' },
  floor: { bg: '#EAF0E1', border: '#4F6B47', text: '#2F4129' },
  kitchen: { bg: '#EFE7E4', border: '#684A4A', text: '#5E4444' },
  management: { bg: '#DFE7DF', border: '#1F3524', text: '#1F3524' },
  'host / floor manager': { bg: '#E1E7F0', border: '#4D5E7A', text: '#2F3C50' },
  host: { bg: '#E1E7F0', border: '#4D5E7A', text: '#2F3C50' },
  'avalon manager': { bg: '#DFE7DF', border: '#1F3524', text: '#1F3524' },
  events: { bg: '#F6E5CC', border: '#B5772F', text: '#6F4915' },
  training: { bg: '#E1E7F0', border: '#4D5E7A', text: '#2F3C50' }
};

export function areaStyle(area: string): CSSProperties {
  const theme = AREA_THEMES[area.trim().toLowerCase()] ?? {
    bg: '#f8fafc',
    border: '#64748b',
    text: '#334155'
  };
  return {
    '--shift-bg': theme.bg,
    '--shift-border': theme.border,
    '--shift-text': theme.text
  } as CSSProperties;
}

export function isDeputyImportedProfile(member: { notes?: string | null; email?: string | null } | null | undefined) {
  return Boolean(member?.notes?.includes('Created from Deputy roster import') || member?.notes?.includes('Deputy unallocated placeholder'));
}

export function isUnallocatedProfile(member: { firstName?: string | null; notes?: string | null } | null | undefined) {
  return Boolean(member?.firstName === 'Unallocated' || member?.notes?.includes('Deputy unallocated placeholder'));
}

export function StaffDocumentActionPrompt({
  action,
  saving,
  feedback,
  onCancel,
  onConfirm
}: {
  action: StaffDocumentPromptAction;
  saving: boolean;
  feedback?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isDelete = action === 'delete';
  return (
    <div className={`staff-document-confirm ${isDelete ? 'is-danger' : ''}`} role="group" aria-label={isDelete ? 'Remove this document confirmation' : 'Request this document again confirmation'}>
      <span>
        <strong>{isDelete ? 'Remove this document?' : 'Request this document again?'}</strong>
        <span className="subtle">
          {isDelete
            ? 'This clears the uploaded file from the record. The staff record will stay in Alma.'
            : 'This clears the current upload and marks the document for follow-up. Ask the staff member to upload the correct document again.'}
        </span>
      </span>
      <span className="staff-document-confirm-actions">
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" variant={isDelete ? 'danger' : 'secondary'} disabled={saving} onClick={onConfirm}>
          {saving ? (isDelete ? 'Removing...' : 'Requesting...') : isDelete ? 'Remove document' : 'Request again'}
        </Button>
        <ActionFeedback
          message={feedback ?? null}
          tone={feedback?.includes('Could') ? 'error' : 'success'}
        />
      </span>
    </div>
  );
}

// Venue Readiness (#20/#21) — green/amber/red checklist status for today.
// Built on the existing ChecklistRun data; the API method is
// /api/checklists/today-readiness?date=&venue=.
export type ReadinessRow = {
  templateId: string;
  templateName: string;
  area: string | null;
  kind: 'opening' | 'closing' | 'service';
  itemsTotal: number;
  itemsPassed: number;
  itemsFailed: number;
  itemsPending: number;
  status: 'GREEN' | 'AMBER' | 'RED' | 'MISSING';
  runId: string | null;
  updatedAt: string | null;
  performedBy: string | null;
};

export type ReadinessPayload = {
  date: string;
  venue: string | null;
  generatedAt: string;
  overall: { opening: ReadinessRow['status']; closing: ReadinessRow['status']; overall: ReadinessRow['status'] };
  rows: ReadinessRow[];
};

export function readinessLabel(status: ReadinessRow['status']): string {
  if (status === 'GREEN') return 'Ready';
  if (status === 'AMBER') return 'In progress';
  if (status === 'RED') return 'Failed item';
  return 'Not started';
}

export function downloadTextFile(filename: string, contents: string, type = 'text/csv') {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseMoneyCents(value: string | undefined) {
  const numeric = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

export function inviteLink(token: string) {
  return `${window.location.origin}/onboarding/${token}`;
}

export function readUploadAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export const ONBOARDING_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const STAFF_DOCUMENT_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp,image/gif,.pdf,.png,.jpg,.jpeg,.webp,.gif';

export const STAFF_DOCUMENT_DATA_URL_PATTERN = /^data:(application\/pdf|image\/png|image\/jpeg|image\/jpg|image\/webp|image\/gif);base64,[A-Za-z0-9+/=]+$/i;

export const ONBOARDING_UPLOAD_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export const ONBOARDING_UPLOAD_EXTENSION_TYPES = new Map([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif']
]);

export function safeUploadName(name: string) {
  const cleaned = name
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'uploaded-document').slice(0, 180);
}

export function uploadMimeType(file: File) {
  if (ONBOARDING_UPLOAD_TYPES.has(file.type)) return file.type;
  const lowerName = file.name.toLowerCase();
  const match = Array.from(ONBOARDING_UPLOAD_EXTENSION_TYPES.entries()).find(([extension]) => lowerName.endsWith(extension));
  return match?.[1] ?? '';
}

export function normaliseUploadDataUrl(dataUrl: string, mimeType: string) {
  if (!mimeType) return dataUrl;
  return dataUrl.replace(/^data:(?:application\/octet-stream)?;base64,/i, `data:${mimeType};base64,`);
}

export async function readOnboardingUpload(file: File) {
  if (file.size > ONBOARDING_UPLOAD_MAX_BYTES) {
    throw new Error('Please upload a file smaller than 4MB.');
  }
  const mimeType = uploadMimeType(file);
  if (!mimeType) {
    throw new Error('Upload a PDF, PNG, JPEG, WebP, or GIF document.');
  }

  return {
    name: safeUploadName(file.name),
    url: normaliseUploadDataUrl(await readUploadAsDataUrl(file), mimeType)
  };
}

export function staffDocumentExternalUrl(documentUrl?: string | null) {
  const value = documentUrl?.trim();
  if (!value) return null;
  if (value.startsWith('data:')) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function staffDocumentBlobUrl(documentUrl: string) {
  const value = documentUrl.trim();
  if (!STAFF_DOCUMENT_DATA_URL_PATTERN.test(value)) return null;
  const [metadata, payload] = value.split(',');
  const mimeType = metadata?.match(/^data:([^;]+);base64$/i)?.[1] ?? 'application/octet-stream';
  const binary = window.atob(payload ?? '');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return window.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function openStaffDocument(documentUrl: string) {
  const blobUrl = staffDocumentBlobUrl(documentUrl);
  if (!blobUrl) return;
  const opened = window.open(blobUrl, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
  if (!opened) {
    window.location.assign(blobUrl);
  }
}

export function StaffDocumentViewLink({ documentUrl }: { documentUrl?: string | null }) {
  const value = documentUrl?.trim();
  if (!value) {
    return <span className="subtle">No document attached</span>;
  }

  const externalUrl = staffDocumentExternalUrl(value);
  if (externalUrl) {
    return (
      <a href={externalUrl} target="_blank" rel="noreferrer" className="invite-link">
        View document
      </a>
    );
  }

  if (STAFF_DOCUMENT_DATA_URL_PATTERN.test(value)) {
    return (
      <button type="button" className="invite-link document-view-button" onClick={() => openStaffDocument(value)}>
        View document
      </button>
    );
  }

  return <span className="subtle">Document link unavailable</span>;
}

export function staffComplianceDocumentRecord(record: StaffComplianceRecord): StaffComplianceDocumentRecord {
  return record as StaffComplianceDocumentRecord;
}

export function recordDocumentRequested(record: Pick<StaffComplianceRecord, 'notes' | 'documentUrl'> & { status: string }) {
  return !record.documentUrl && (record.status === 'REQUESTED' || (record.status === 'PENDING' && Boolean(record.notes?.includes('Document requested again'))));
}

export function staffRecordStatusTone(status: string) {
  if (status === 'APPROVED') return 'positive';
  if (status === 'EXPIRED' || status === 'REJECTED') return 'danger';
  if (status === 'UPLOADED') return 'info';
  if (status === 'REQUESTED' || status === 'PENDING') return 'warning';
  return 'muted';
}

export function staffRecordStatusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (value) => value.toUpperCase());
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
