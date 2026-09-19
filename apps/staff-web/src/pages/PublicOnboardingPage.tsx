// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { OnboardingSettings, StaffProfile, StaffRecordType } from '@alma/shared';
import { DEFAULT_ONBOARDING_SETTINGS, normaliseOnboardingSettings } from '@alma/shared';
import { Badge, Button, Card, EmptyState, Input, Select, Spinner, Textarea } from '@alma/ui';
import { api } from '../lib/api';
import {
  VENUE_OPTIONS,
  STAFF_DOCUMENT_ACCEPT,
  readOnboardingUpload,
  StaffDocumentViewLink,
  formatDateTime
} from './shared';

type OnboardingDocumentKey = 'rightToWorkDocuments' | 'bankAccountConfirmation';

const ONBOARDING_DOCUMENT_FALLBACKS: Record<OnboardingDocumentKey, { recordType: StaffRecordType; hint: string }> = {
  rightToWorkDocuments: {
    recordType: 'OTHER',
    hint: 'Passport, driver licence, citizenship evidence, or visa work-rights evidence.'
  },
  bankAccountConfirmation: {
    recordType: 'OTHER',
    hint: 'Bank account proof or payroll bank details confirmation.'
  }
};

type OnboardingDocumentDraft = {
  key: OnboardingDocumentKey;
  title: string;
  recordType: StaffRecordType;
  required: boolean;
  hint: string;
  documentName: string;
  documentUrl: string;
};

function onboardingDocumentsFromSettings(
  settings: OnboardingSettings,
  existing: OnboardingDocumentDraft[] = []
): OnboardingDocumentDraft[] {
  const existingByKey = new Map(existing.map((document) => [document.key, document]));
  return (Object.keys(ONBOARDING_DOCUMENT_FALLBACKS) as OnboardingDocumentKey[])
    .map((key) => {
      const step = settings[key];
      const fallback = ONBOARDING_DOCUMENT_FALLBACKS[key];
      const current = existingByKey.get(key);
      return {
        key,
        title: step.label,
        recordType: fallback.recordType,
        required: step.required,
        hint: step.description || fallback.hint,
        documentName: current?.documentName ?? '',
        documentUrl: current?.documentUrl ?? ''
      };
    })
    .filter((document) => settings[document.key].enabled);
}

type OnboardingContext = {
  token: string;
  email: string | null;
  note: string | null;
  firstName: string;
  lastName: string;
  roleTitle: string;
  venue: string;
  expiresAt: string | null;
  createdAt: string;
  onboardingSettings: OnboardingSettings;
};

// Fields we deliberately never write to localStorage — tax file number, bank details
// and the chosen password are sensitive, and `documents` is re-derived from settings.
const NON_PERSISTED_ONBOARDING_KEYS = ['taxFileNumber', 'bankBsb', 'bankAccountNumber', 'password', 'documents'];

function readOnboardingDraft(key: string | null): Record<string, unknown> | null {
  if (!key || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeOnboardingDraft(key: string | null, draft: Record<string, unknown>): void {
  if (!key || typeof window === 'undefined') return;
  try {
    const safe: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(draft)) {
      if (NON_PERSISTED_ONBOARDING_KEYS.includes(field)) continue;
      safe[field] = value;
    }
    window.localStorage.setItem(key, JSON.stringify(safe));
  } catch {
    // Storage can be unavailable (private mode / quota) — losing draft persistence is non-fatal.
  }
}

function clearOnboardingDraft(key: string | null): void {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function PublicOnboardingPage() {
  const { token } = useParams();
  const [context, setContext] = useState<OnboardingContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [draft, setDraft] = useState({
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
    password: '',
    notes: '',
    documents: onboardingDocumentsFromSettings(DEFAULT_ONBOARDING_SETTINGS)
  });

  const draftStorageKey = token ? `alma-onboarding-draft-${token}` : null;
  const draftHydratedRef = useRef(false);

  useEffect(() => {
    async function load() {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const next = await api<OnboardingContext>(`/api/staff/invites/by-token/${token}`);
        const onboardingSettings = normaliseOnboardingSettings(next.onboardingSettings);
        setContext({ ...next, onboardingSettings });
        // Restore any in-progress, non-sensitive answers this person entered earlier on
        // this device (sensitive fields like TFN/bank/password are never persisted).
        const saved = readOnboardingDraft(draftStorageKey);
        setDraft((current) => ({
          ...current,
          ...(saved ?? {}),
          firstName: next.firstName,
          lastName: next.lastName,
          roleTitle: next.roleTitle,
          email: next.email ?? (typeof saved?.email === 'string' ? saved.email : ''),
          venue: next.venue,
          documents: onboardingDocumentsFromSettings(onboardingSettings, current.documents)
        }));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load invite');
      } finally {
        draftHydratedRef.current = true;
        setLoading(false);
      }
    }
    void load();
  }, [token]);

  // Save progress as the person types, but only after the initial hydrate so we never
  // clobber the restored draft with the empty starting state.
  useEffect(() => {
    if (!draftHydratedRef.current || !draftStorageKey || completed) return;
    writeOnboardingDraft(draftStorageKey, draft);
  }, [draft, draftStorageKey, completed]);

  function update<K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateDocument(index: number, updates: Partial<OnboardingDocumentDraft>) {
    setDraft((current) => ({
      ...current,
      documents: current.documents.map((document, currentIndex) =>
        currentIndex === index ? { ...document, ...updates } : document
      )
    }));
  }

  async function complete() {
    if (!token) return;
    setError(null);
    const onboardingSettings = context?.onboardingSettings ?? DEFAULT_ONBOARDING_SETTINGS;
    const requiredFields: Array<[string, string | boolean]> = [
      ['first name', draft.firstName],
      ['last name', draft.lastName],
      ['role', draft.roleTitle],
      ['email', draft.email],
      ['phone', draft.phone],
      ['venue', draft.venue],
      ['start date', draft.startDate],
      ['date of birth', draft.dateOfBirth],
      ['address', draft.addressLine1],
      ['suburb', draft.suburb],
      ['state', draft.state],
      ['postcode', draft.postcode],
      ['emergency contact name', draft.emergencyContactName],
      ['emergency contact relationship', draft.emergencyContactRelationship],
      ['emergency contact phone', draft.emergencyContactPhone],
      ['employment type', draft.employmentType],
      ['pay type', draft.payType],
      ['bank account name', draft.bankAccountName],
      ['bank BSB', draft.bankBsb],
      ['bank account number', draft.bankAccountNumber],
      ['visa / work rights status', draft.visaStatus]
    ];

    if (onboardingSettings.taxDeclaration.enabled && onboardingSettings.taxDeclaration.required) {
      requiredFields.push(
        ['tax file number', draft.taxFileNumber],
        ['tax residency status', draft.taxResidencyStatus]
      );
    }

    if (onboardingSettings.superannuationChoice.enabled && onboardingSettings.superannuationChoice.required) {
      requiredFields.push(
        ['super fund name', draft.superFundName],
        ['super fund ABN', draft.superFundAbn],
        ['super fund USI', draft.superFundUsi],
        ['super member number', draft.superMemberNumber]
      );
    }

    const missingFields = requiredFields.filter(([, value]) => !String(value ?? '').trim());

    if (missingFields.length) {
      setError(`Please complete: ${missingFields.map(([label]) => label).join(', ')}.`);
      return;
    }
    if (!['Australian citizen', 'Australian permanent resident', 'New Zealand citizen'].includes(draft.visaStatus)) {
      if (!draft.visaSubclass.trim() || !draft.visaExpiryDate.trim()) {
        setError('Please enter visa subclass and visa expiry date for visa work-rights checks.');
        return;
      }
    }
    const missingDocuments = draft.documents.filter((document) => document.required && !document.documentUrl);
    if (missingDocuments.length) {
      setError(`Please upload: ${missingDocuments.map((document) => document.title).join(', ')}.`);
      return;
    }
    if (draft.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    const payRate = Number(draft.payRate.replace(/[^0-9.]/g, ''));
    try {
      await api<StaffProfile>(`/api/staff/invites/by-token/${token}/complete`, {
        method: 'POST',
        body: JSON.stringify({
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
          notes: draft.notes.trim(),
          password: draft.password,
          records: draft.documents
            .filter((document) => document.documentUrl)
            .map((document) => ({
              recordType: document.recordType,
              title: document.title,
              status: 'PENDING',
              documentName: document.documentName,
              documentUrl: document.documentUrl,
              notes: 'Uploaded during staff onboarding'
            }))
        })
      });
      clearOnboardingDraft(draftStorageKey);
      setCompleted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete onboarding');
    }
  }

  const onboardingSettings = context?.onboardingSettings ?? DEFAULT_ONBOARDING_SETTINGS;

  return (
    <main className="public-onboarding">
      <Card
        title={completed ? 'Onboarding complete' : 'Complete your ALMA Staff onboarding'}
        subtitle={context?.expiresAt ? `Invite expires ${formatDateTime(context.expiresAt)}` : 'Staff invite'}
      >
        {loading ? <Spinner label="Loading invite…" /> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {completed ? (
          <EmptyState title="Onboarding submitted" description="Your details and documents are waiting for manager approval. You can sign in once the staff team activates your profile." />
        ) : null}
        {!loading && context && !completed ? (
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void complete();
            }}
          >
            {context.note ? <p className="subtle">{context.note}</p> : null}
            <div className="form-grid two">
              <Input label="First name" required value={draft.firstName} onChange={(event) => update('firstName', event.currentTarget.value)} />
              <Input label="Last name" required value={draft.lastName} onChange={(event) => update('lastName', event.currentTarget.value)} />
              <Input label="Role" required value={draft.roleTitle} readOnly />
              <Select label="Venue" required value={draft.venue} onChange={(event) => update('venue', event.currentTarget.value)} options={VENUE_OPTIONS} />
            </div>
            <div className="form-grid two">
              <Input label="Email" type="email" required value={draft.email} onChange={(event) => update('email', event.currentTarget.value)} />
              <Input label="Phone" required value={draft.phone} onChange={(event) => update('phone', event.currentTarget.value)} />
              <Input label="Start date" required type="date" value={draft.startDate} onChange={(event) => update('startDate', event.currentTarget.value)} />
              <Input label="Date of birth" required type="date" value={draft.dateOfBirth} onChange={(event) => update('dateOfBirth', event.currentTarget.value)} />
              <Input label="Password" type="password" required value={draft.password} onChange={(event) => update('password', event.currentTarget.value)} />
            </div>

            <Card title="Address and emergency contact">
              <div className="form-grid two">
                <Input label="Address line 1" required value={draft.addressLine1} onChange={(event) => update('addressLine1', event.currentTarget.value)} />
                <Input label="Address line 2" value={draft.addressLine2} onChange={(event) => update('addressLine2', event.currentTarget.value)} />
                <Input label="Suburb" required value={draft.suburb} onChange={(event) => update('suburb', event.currentTarget.value)} />
                <Input label="State" required value={draft.state} onChange={(event) => update('state', event.currentTarget.value)} />
                <Input label="Postcode" required value={draft.postcode} onChange={(event) => update('postcode', event.currentTarget.value)} />
                <Input label="Emergency contact name" required value={draft.emergencyContactName} onChange={(event) => update('emergencyContactName', event.currentTarget.value)} />
                <Input label="Emergency contact relationship" required value={draft.emergencyContactRelationship} onChange={(event) => update('emergencyContactRelationship', event.currentTarget.value)} />
                <Input label="Emergency contact phone" required value={draft.emergencyContactPhone} onChange={(event) => update('emergencyContactPhone', event.currentTarget.value)} />
              </div>
            </Card>

            <Card title="Employment and bank details">
              <div className="form-grid two">
                <Select label="Employment type" required value={draft.employmentType} onChange={(event) => update('employmentType', event.currentTarget.value)} options={[
                  { label: 'Select employment type', value: '' },
                  { label: 'Full-time', value: 'Full-time' },
                  { label: 'Part-time', value: 'Part-time' },
                  { label: 'Casual', value: 'Casual' },
                  { label: 'Fixed term', value: 'Fixed term' },
                  { label: 'Contractor', value: 'Contractor' }
                ]} />
                <Select label="Pay type" required value={draft.payType} onChange={(event) => update('payType', event.currentTarget.value)} options={[
                  { label: 'Select pay type', value: '' },
                  { label: 'Hourly', value: 'Hourly' },
                  { label: 'Salary', value: 'Salary' },
                  { label: 'Contractor invoice', value: 'Contractor invoice' }
                ]} />
                <Input label="Pay rate" value={draft.payRate} onChange={(event) => update('payRate', event.currentTarget.value)} placeholder="Example: 32.50" />
                <Input label="Award / classification" value={draft.payAward} onChange={(event) => update('payAward', event.currentTarget.value)} />
                <Input label="Bank account name" required value={draft.bankAccountName} onChange={(event) => update('bankAccountName', event.currentTarget.value)} />
                <Input label="BSB" required value={draft.bankBsb} onChange={(event) => update('bankBsb', event.currentTarget.value)} placeholder="000-000" />
                <Input label="Account number" required value={draft.bankAccountNumber} onChange={(event) => update('bankAccountNumber', event.currentTarget.value)} />
              </div>
            </Card>

            {onboardingSettings.taxDeclaration.enabled ? (
              <Card title={onboardingSettings.taxDeclaration.label} subtitle={onboardingSettings.taxDeclaration.description}>
                <div className="form-grid two">
                  <Input
                    label="Tax file number"
                    required={onboardingSettings.taxDeclaration.required}
                    value={draft.taxFileNumber}
                    onChange={(event) => update('taxFileNumber', event.currentTarget.value)}
                  />
                  <Select
                    label="Tax residency status"
                    required={onboardingSettings.taxDeclaration.required}
                    value={draft.taxResidencyStatus}
                    onChange={(event) => update('taxResidencyStatus', event.currentTarget.value)}
                    options={[
                      { label: 'Select tax residency', value: '' },
                      { label: 'Australian resident for tax purposes', value: 'Australian resident for tax purposes' },
                      { label: 'Foreign resident for tax purposes', value: 'Foreign resident for tax purposes' },
                      { label: 'Working holiday maker', value: 'Working holiday maker' }
                    ]}
                  />
                </div>
                <label className="check-row">
                  <input type="checkbox" checked={draft.taxFreeThreshold} onChange={(event) => update('taxFreeThreshold', event.currentTarget.checked)} />
                  Claim the tax-free threshold
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={draft.hasStudyTrainingLoan} onChange={(event) => update('hasStudyTrainingLoan', event.currentTarget.checked)} />
                  Has HELP, VSL, FS, SSL or TSL debt
                </label>
              </Card>
            ) : null}

            {onboardingSettings.superannuationChoice.enabled ? (
              <Card title={onboardingSettings.superannuationChoice.label} subtitle={onboardingSettings.superannuationChoice.description}>
                <div className="form-grid two">
                  <Input
                    label="Super fund name"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundName}
                    onChange={(event) => update('superFundName', event.currentTarget.value)}
                  />
                  <Input
                    label="Super fund ABN"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundAbn}
                    onChange={(event) => update('superFundAbn', event.currentTarget.value)}
                  />
                  <Input
                    label="Super fund USI"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superFundUsi}
                    onChange={(event) => update('superFundUsi', event.currentTarget.value)}
                  />
                  <Input
                    label="Super member number"
                    required={onboardingSettings.superannuationChoice.required}
                    value={draft.superMemberNumber}
                    onChange={(event) => update('superMemberNumber', event.currentTarget.value)}
                  />
                </div>
              </Card>
            ) : null}

            <Card title="Visa and work rights">
              <div className="form-grid two">
                <Select label="Visa / work rights status" required value={draft.visaStatus} onChange={(event) => update('visaStatus', event.currentTarget.value)} options={[
                  { label: 'Select work rights', value: '' },
                  { label: 'Australian citizen', value: 'Australian citizen' },
                  { label: 'Australian permanent resident', value: 'Australian permanent resident' },
                  { label: 'New Zealand citizen', value: 'New Zealand citizen' },
                  { label: 'Visa holder', value: 'Visa holder' },
                  { label: 'Working holiday visa', value: 'Working holiday visa' },
                  { label: 'Student visa', value: 'Student visa' },
                  { label: 'Other / needs review', value: 'Other / needs review' }
                ]} />
                <Input label="Visa subclass" value={draft.visaSubclass} onChange={(event) => update('visaSubclass', event.currentTarget.value)} />
                <Input label="Visa expiry date" type="date" value={draft.visaExpiryDate} onChange={(event) => update('visaExpiryDate', event.currentTarget.value)} />
              </div>
              <Textarea label="Work rights notes" rows={2} value={draft.workRightsNotes} onChange={(event) => update('workRightsNotes', event.currentTarget.value)} />
            </Card>

            {draft.documents.length ? (
              <Card title="Onboarding documents" subtitle="Upload any required documents and optional confirmations you want managers to review.">
                <div className="page-stack compact">
                  {draft.documents.map((document, index) => (
                    <div key={document.key} className="invite-row">
                      <span>
                        <strong>{document.title}</strong>
                        <span className="subtle">{document.hint}</span>
                        {document.documentName ? <span className="subtle">{document.documentName}</span> : null}
                        <StaffDocumentViewLink documentUrl={document.documentUrl} />
                      </span>
                      <span className="invite-row-actions">
                        <input
                          aria-label={`Upload ${document.title}`}
                          type="file"
                          accept={STAFF_DOCUMENT_ACCEPT}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (!file) return;
                            void readOnboardingUpload(file)
                              .then((upload) => updateDocument(index, { documentName: upload.name, documentUrl: upload.url }))
                              .catch((uploadError) => setError(uploadError instanceof Error ? uploadError.message : 'Could not upload file'));
                          }}
                        />
                        <Badge tone={document.documentUrl ? 'positive' : document.required ? 'warning' : 'muted'}>
                          {document.documentUrl ? 'Uploaded' : document.required ? 'Required' : 'Optional'}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}
            <Textarea label="Notes" rows={2} value={draft.notes} onChange={(event) => update('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit">Submit for approval</Button>
            </div>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
