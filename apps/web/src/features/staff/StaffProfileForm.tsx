import { useState } from 'react';
import type { StaffRecordType } from '@alma/shared';
import { Button, Card, EmptyState, Input, Select, Textarea } from '@alma/ui';
import { IconPlus, IconStaff, IconTrash } from '../../lib/icons';
import { PhotoField } from './PhotoField';

export type ComplianceRecordDraft = {
  recordType: StaffRecordType;
  title: string;
  issuer: string;
  certificateNumber: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
  documentName: string;
  documentUrl: string;
};

export type StaffProfileDraft = {
  firstName: string;
  lastName: string;
  roleTitle: string;
  email: string;
  phone: string;
  venue: string;
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
  records: ComplianceRecordDraft[];
};

export function emptyRecord(): ComplianceRecordDraft {
  return {
    recordType: 'RSA',
    title: 'RSA Certificate',
    issuer: '',
    certificateNumber: '',
    issueDate: '',
    expiryDate: '',
    notes: '',
    documentName: '',
    documentUrl: ''
  };
}

export function emptyProfile(): StaffProfileDraft {
  return {
    firstName: '',
    lastName: '',
    roleTitle: '',
    email: '',
    phone: '',
    venue: '',
    startDate: '',
    dateOfBirth: '',
    addressLine1: '',
    addressLine2: '',
    suburb: '',
    state: 'NSW',
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
    taxFreeThreshold: true,
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
    notes: '',
    records: []
  };
}

export const recordTypeOptions: { label: string; value: StaffRecordType }[] = [
  { label: 'RSA', value: 'RSA' },
  { label: 'RSG', value: 'RSG' },
  { label: 'FSS', value: 'FSS' },
  { label: 'First Aid', value: 'FIRST_AID' },
  { label: 'Food Safety', value: 'FOOD_SAFETY' },
  { label: 'Allergen', value: 'ALLERGEN' },
  { label: 'Training', value: 'TRAINING' },
  { label: 'Other', value: 'OTHER' }
];

export const staffVenueOptions = [
  { label: 'Select venue / group', value: '' },
  { label: 'Alma Avalon', value: 'Alma Avalon' },
  { label: 'St Alma', value: 'St Alma' },
  { label: 'Both', value: 'Both' }
];

const employmentTypeOptions = [
  { label: 'Select employment type', value: '' },
  { label: 'Full-time', value: 'Full-time' },
  { label: 'Part-time', value: 'Part-time' },
  { label: 'Casual', value: 'Casual' },
  { label: 'Fixed term', value: 'Fixed term' },
  { label: 'Contractor', value: 'Contractor' }
];

const payTypeOptions = [
  { label: 'Select pay type', value: '' },
  { label: 'Hourly', value: 'Hourly' },
  { label: 'Salary', value: 'Salary' },
  { label: 'Contractor invoice', value: 'Contractor invoice' }
];

const taxResidencyOptions = [
  { label: 'Select tax residency', value: '' },
  { label: 'Australian resident for tax purposes', value: 'Australian resident for tax purposes' },
  { label: 'Foreign resident for tax purposes', value: 'Foreign resident for tax purposes' },
  { label: 'Working holiday maker', value: 'Working holiday maker' }
];

const visaStatusOptions = [
  { label: 'Select work rights', value: '' },
  { label: 'Australian citizen', value: 'Australian citizen' },
  { label: 'Australian permanent resident', value: 'Australian permanent resident' },
  { label: 'New Zealand citizen', value: 'New Zealand citizen' },
  { label: 'Visa holder', value: 'Visa holder' },
  { label: 'Working holiday visa', value: 'Working holiday visa' },
  { label: 'Student visa', value: 'Student visa' },
  { label: 'Other / needs review', value: 'Other / needs review' }
];

type Props = {
  value: StaffProfileDraft;
  onChange: (next: StaffProfileDraft) => void;
  submitLabel?: string;
  onSubmit?: () => void;
  submitting?: boolean;
  onCancel?: () => void;
  compact?: boolean;
  /** Public self-onboarding mode: hides manager/payroll-only fields (pay rate,
      award) the new hire shouldn't set themselves. */
  onboarding?: boolean;
};

export function StaffProfileForm({
  value,
  onChange,
  submitLabel = 'Save staff profile',
  onSubmit,
  submitting = false,
  onCancel,
  compact = false,
  onboarding = false
}: Props) {
  const [showNotes, setShowNotes] = useState(false);

  function patch<K extends keyof StaffProfileDraft>(key: K, next: StaffProfileDraft[K]) {
    onChange({ ...value, [key]: next });
  }

  function patchRecord(index: number, updates: Partial<ComplianceRecordDraft>) {
    onChange({
      ...value,
      records: value.records.map((record, currentIndex) =>
        currentIndex === index ? { ...record, ...updates } : record
      )
    });
  }

  function addRecord() {
    onChange({ ...value, records: [...value.records, emptyRecord()] });
  }

  function removeRecord(index: number) {
    onChange({
      ...value,
      records: value.records.filter((_, currentIndex) => currentIndex !== index)
    });
  }

  return (
    <div className="page-stack">
      <Card title="Personal details">
        <div className="form-grid two">
          <Input
            label="First name"
            value={value.firstName}
            onChange={(event) => patch('firstName', event.target.value)}
            required
          />
          <Input
            label="Last name"
            value={value.lastName}
            onChange={(event) => patch('lastName', event.target.value)}
            required
          />
          <Input
            label="Role"
            value={value.roleTitle}
            onChange={(event) => patch('roleTitle', event.target.value)}
            required
          />
          <Select
            label="Venue"
            value={value.venue}
            onChange={(event) => patch('venue', event.target.value)}
            options={staffVenueOptions}
          />
          <Input
            label="Email"
            type="email"
            value={value.email}
            onChange={(event) => patch('email', event.target.value)}
          />
          <Input
            label="Phone"
            value={value.phone}
            onChange={(event) => patch('phone', event.target.value)}
          />
          {!compact ? (
            <Input
              label="Start date"
              type="date"
              value={value.startDate}
              onChange={(event) => patch('startDate', event.target.value)}
            />
          ) : null}
          {!compact ? (
            <Input
              label="Date of birth"
              type="date"
              value={value.dateOfBirth}
              onChange={(event) => patch('dateOfBirth', event.target.value)}
            />
          ) : null}
        </div>
        {!compact ? (
          <div style={{ marginTop: 12 }}>
            {showNotes ? (
              <Textarea
                label="Internal notes"
                value={value.notes}
                onChange={(event) => patch('notes', event.target.value)}
                rows={3}
              />
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowNotes(true)}
              >
                Add internal notes
              </Button>
            )}
          </div>
        ) : null}
      </Card>

      {!compact ? (
        <>
          <Card title="Address and emergency contact">
            <div className="form-grid two">
              <Input label="Address line 1" value={value.addressLine1} onChange={(event) => patch('addressLine1', event.target.value)} />
              <Input label="Address line 2" value={value.addressLine2} onChange={(event) => patch('addressLine2', event.target.value)} />
              <Input label="Suburb" value={value.suburb} onChange={(event) => patch('suburb', event.target.value)} />
              <Input label="State" value={value.state} onChange={(event) => patch('state', event.target.value)} />
              <Input label="Postcode" value={value.postcode} onChange={(event) => patch('postcode', event.target.value)} />
              <Input label="Emergency contact name" value={value.emergencyContactName} onChange={(event) => patch('emergencyContactName', event.target.value)} />
              <Input label="Emergency contact relationship" value={value.emergencyContactRelationship} onChange={(event) => patch('emergencyContactRelationship', event.target.value)} />
              <Input label="Emergency contact phone" value={value.emergencyContactPhone} onChange={(event) => patch('emergencyContactPhone', event.target.value)} />
            </div>
          </Card>

          <Card title="Pay and Xero payroll setup" subtitle="Used by payroll to set up the employee record and timesheet export.">
            <div className="form-grid two">
              <Select label="Employment type" value={value.employmentType} onChange={(event) => patch('employmentType', event.target.value)} options={employmentTypeOptions} />
              <Select label="Pay type" value={value.payType} onChange={(event) => patch('payType', event.target.value)} options={payTypeOptions} />
              {!onboarding ? (
                <>
                  <Input label="Pay rate" value={value.payRate} onChange={(event) => patch('payRate', event.target.value)} placeholder="Example: 32.50" />
                  <Input label="Award / classification" value={value.payAward} onChange={(event) => patch('payAward', event.target.value)} placeholder="Example: HIGA Level 2" />
                </>
              ) : null}
              <Input label="Xero employee ID" value={value.xeroEmployeeId} onChange={(event) => patch('xeroEmployeeId', event.target.value)} />
              <Input label="Xero payroll calendar ID" value={value.xeroPayrollCalendarId} onChange={(event) => patch('xeroPayrollCalendarId', event.target.value)} />
              <Input label="Xero earnings rate ID" value={value.xeroEarningsRateId} onChange={(event) => patch('xeroEarningsRateId', event.target.value)} />
            </div>
          </Card>

          <Card title="Tax declaration">
            <div className="form-grid two">
              <Input label="Tax file number" value={value.taxFileNumber} onChange={(event) => patch('taxFileNumber', event.target.value)} />
              <Select label="Tax residency status" value={value.taxResidencyStatus} onChange={(event) => patch('taxResidencyStatus', event.target.value)} options={taxResidencyOptions} />
            </div>
            <label className="check-row">
              <input type="checkbox" checked={value.taxFreeThreshold} onChange={(event) => patch('taxFreeThreshold', event.target.checked)} />
              Claim the tax-free threshold
            </label>
            <label className="check-row">
              <input type="checkbox" checked={value.hasStudyTrainingLoan} onChange={(event) => patch('hasStudyTrainingLoan', event.target.checked)} />
              Has HELP, VSL, FS, SSL or TSL debt
            </label>
          </Card>

          <Card title="Superannuation">
            <div className="form-grid two">
              <Input label="Super fund name" value={value.superFundName} onChange={(event) => patch('superFundName', event.target.value)} />
              <Input label="Fund ABN" value={value.superFundAbn} onChange={(event) => patch('superFundAbn', event.target.value)} />
              <Input label="USI" value={value.superFundUsi} onChange={(event) => patch('superFundUsi', event.target.value)} />
              <Input label="Member number" value={value.superMemberNumber} onChange={(event) => patch('superMemberNumber', event.target.value)} />
            </div>
          </Card>

          <Card title="Bank account">
            <div className="form-grid two">
              <Input label="Account name" value={value.bankAccountName} onChange={(event) => patch('bankAccountName', event.target.value)} />
              <Input label="BSB" value={value.bankBsb} onChange={(event) => patch('bankBsb', event.target.value)} placeholder="000-000" />
              <Input label="Account number" value={value.bankAccountNumber} onChange={(event) => patch('bankAccountNumber', event.target.value)} />
            </div>
          </Card>

          <Card title="Visa and work rights">
            <div className="form-grid two">
              <Select label="Visa / work rights status" value={value.visaStatus} onChange={(event) => patch('visaStatus', event.target.value)} options={visaStatusOptions} />
              {!['Australian citizen', 'Australian permanent resident', 'New Zealand citizen'].includes(value.visaStatus) ? (
                <>
                  <Input label="Visa subclass" value={value.visaSubclass} onChange={(event) => patch('visaSubclass', event.target.value)} placeholder="Example: 417, 500" />
                  <Input label="Visa expiry date" type="date" value={value.visaExpiryDate} onChange={(event) => patch('visaExpiryDate', event.target.value)} />
                </>
              ) : null}
            </div>
            {!['Australian citizen', 'Australian permanent resident', 'New Zealand citizen'].includes(value.visaStatus) ? (
              <div style={{ marginTop: 12 }}>
                <Textarea label="Work rights notes" value={value.workRightsNotes} onChange={(event) => patch('workRightsNotes', event.target.value)} rows={2} />
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      <Card
        title="Compliance records"
        subtitle="Add each certificate (RSA, First Aid, etc.) with a photo of the card"
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leftIcon={<IconPlus size={14} />}
            onClick={addRecord}
          >
            Add record
          </Button>
        }
      >
        {value.records.length === 0 ? (
          <EmptyState
            icon={<IconStaff size={22} />}
            title="No records yet"
            description="Add a record for each certificate the staff member holds."
            action={
              <Button
                type="button"
                size="sm"
                leftIcon={<IconPlus size={14} />}
                onClick={addRecord}
              >
                Add first record
              </Button>
            }
          />
        ) : (
          <div className="page-stack compact">
            {value.records.map((record, index) => (
              <article key={index} className="checklist-item-card">
                <div className="checklist-item-top">
                  <div>
                    <strong>Record {index + 1}</strong>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    leftIcon={<IconTrash size={14} />}
                    onClick={() => removeRecord(index)}
                  >
                    Remove
                  </Button>
                </div>
                <div className="form-grid two">
                  <Select
                    label="Record type"
                    value={record.recordType}
                    onChange={(event) =>
                      patchRecord(index, {
                        recordType: event.target.value as StaffRecordType
                      })
                    }
                    options={recordTypeOptions}
                  />
                  <Input
                    label="Record title"
                    value={record.title}
                    onChange={(event) => patchRecord(index, { title: event.target.value })}
                    required
                  />
                  <Input
                    label="Issuer"
                    value={record.issuer}
                    onChange={(event) => patchRecord(index, { issuer: event.target.value })}
                  />
                  <Input
                    label="Certificate #"
                    value={record.certificateNumber}
                    onChange={(event) =>
                      patchRecord(index, { certificateNumber: event.target.value })
                    }
                  />
                  <Input
                    label="Issue date"
                    type="date"
                    value={record.issueDate}
                    onChange={(event) => patchRecord(index, { issueDate: event.target.value })}
                  />
                  <Input
                    label="Expiry date"
                    type="date"
                    value={record.expiryDate}
                    onChange={(event) => patchRecord(index, { expiryDate: event.target.value })}
                  />
                </div>
                <PhotoField
                  label="Photo of certificate"
                  value={record.documentUrl}
                  onChange={(next, meta) =>
                    patchRecord(index, {
                      documentUrl: next,
                      documentName: next ? meta.name || record.documentName : ''
                    })
                  }
                />
                {!compact ? (
                  <Textarea
                    label="Notes"
                    value={record.notes}
                    onChange={(event) => patchRecord(index, { notes: event.target.value })}
                    rows={2}
                  />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Card>

      {onSubmit ? (
        <div className="toolbar-right">
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            onClick={() => onSubmit()}
            disabled={submitting}
          >
            {submitting ? 'Saving…' : submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function profileDraftToPayload(draft: StaffProfileDraft) {
  const payRate = Number(draft.payRate.replace(/[^0-9.]/g, ''));
  return {
    firstName: draft.firstName.trim(),
    lastName: draft.lastName.trim(),
    roleTitle: draft.roleTitle.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    venue: draft.venue.trim(),
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
    notes: draft.notes.trim(),
    records: draft.records
      .filter((record) => record.title.trim().length > 1)
      .map((record) => ({
        recordType: record.recordType,
        title: record.title.trim(),
        issuer: record.issuer.trim(),
        certificateNumber: record.certificateNumber.trim(),
        issueDate: record.issueDate,
        expiryDate: record.expiryDate,
        status: record.documentUrl ? 'APPROVED' : 'PENDING',
        documentName: record.documentName,
        documentUrl: record.documentUrl,
        notes: record.notes
      }))
  };
}
