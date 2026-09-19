// Extracted verbatim from App.tsx so this page ships as its own chunk and
// only downloads when its route opens. Helpers shared with the rest of the
// app live in ./shared.

import { useEffect, useState } from 'react';
import type { StaffProfile, StaffHrRecord, StaffHrRecordStatus, StaffHrRecordType } from '@alma/shared';
import { ActionFeedback, Button, Card, Input, PageHeader, Select, StatCard, Textarea } from '@alma/ui';
import { api } from '../lib/api';
import { toDateInput, formatCents } from '../lib/datetime';
import { SETTINGS_WEB_URL } from '../config/suiteLinks';
import {
  HR_SECTION_LINKS,
  hrTypeLabel,
  staffLabel,
  sortStaffForSelect,
  HrRecordList,
  STAFF_DOCUMENT_ACCEPT,
  readOnboardingUpload
} from './shared';

const HR_RECORD_STATUS_OPTIONS: StaffHrRecordStatus[] = [
  'DRAFT',
  'ISSUED',
  'SENT',
  'SIGNED',
  'STORED',
  'PENDING',
  'APPROVED',
  'EXPIRED',
  'RE_REQUESTED'
];

const HR_RECORD_TYPE_OPTIONS: StaffHrRecordType[] = [
  'CONTRACT',
  'WARNING',
  'PAY_CHANGE',
  'RIGHT_TO_WORK',
  'GENERAL'
];

type HrRecordDraft = {
  staffProfileId: string;
  recordType: StaffHrRecordType;
  title: string;
  status: StaffHrRecordStatus;
  issueDate: string;
  effectiveDate: string;
  expiryDate: string;
  followUpDate: string;
  reason: string;
  oldRate: string;
  newRate: string;
  documentName: string;
  documentUrl: string;
  notes: string;
};

function centsFromCurrencyInput(value: string) {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!cleaned) return undefined;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return Math.round(amount * 100);
}

function defaultHrTitle(type: StaffHrRecordType) {
  if (type === 'CONTRACT') return 'Employment contract';
  if (type === 'WARNING') return 'Written warning';
  if (type === 'PAY_CHANGE') return 'Pay change letter';
  if (type === 'RIGHT_TO_WORK') return 'Right-to-work document';
  return 'HR document';
}

function emptyHrDraft(staff: StaffProfile[], type: StaffHrRecordType): HrRecordDraft {
  return {
    staffProfileId: staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id ?? '',
    recordType: type,
    title: defaultHrTitle(type),
    // Pay changes flow DRAFT → PENDING → APPROVED. Contracts default to ISSUED.
    // Everything else lands as STORED.
    status: type === 'CONTRACT' ? 'ISSUED' : type === 'PAY_CHANGE' ? 'DRAFT' : 'STORED',
    issueDate: toDateInput(new Date()),
    effectiveDate: '',
    expiryDate: '',
    followUpDate: '',
    reason: '',
    oldRate: '',
    newRate: '',
    documentName: '',
    documentUrl: '',
    notes: ''
  };
}

export function HrSectionPage({
  staff,
  records,
  type,
  mode,
  loading,
  reload,
  canManage,
  canApprove = false,
  currentUserId = ''
}: {
  staff: StaffProfile[];
  records: StaffHrRecord[];
  type?: StaffHrRecordType;
  mode: 'contracts' | 'warnings' | 'pay-changes' | 'right-to-work' | 'documents';
  loading: boolean;
  reload: () => Promise<void>;
  canManage: boolean;
  // Pay-change-only workflow props. Approval is admin-only and must be a
  // different user from the manager who drafted (separation of duties).
  canApprove?: boolean;
  currentUserId?: string;
}) {
  const [staffFilter, setStaffFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'error'>('success');
  const [draft, setDraft] = useState<HrRecordDraft>(() => emptyHrDraft(staff, type ?? 'GENERAL'));

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      recordType: type ?? current.recordType,
      title: current.title || defaultHrTitle(type ?? current.recordType),
      staffProfileId: current.staffProfileId || staff.find((member) => member.employmentStatus !== 'ARCHIVED')?.id || ''
    }));
  }, [staff, type]);

  const sectionRecords = records.filter((record) => {
    if (type && record.recordType !== type) return false;
    if (staffFilter && record.staffProfileId !== staffFilter) return false;
    if (statusFilter && record.status !== statusFilter) return false;
    return true;
  });

  const staffOptions = [
    { label: 'Choose staff', value: '' },
    ...sortStaffForSelect(staff.filter((member) => member.employmentStatus !== 'ARCHIVED'))
      .map((member) => ({ label: staffLabel(member), value: member.id }))
  ];
  const filterStaffOptions = [{ label: 'All staff', value: '' }, ...staffOptions.slice(1)];
  const statusOptions = [
    { label: 'All statuses', value: '' },
    ...HR_RECORD_STATUS_OPTIONS.map((status) => ({ label: status.replaceAll('_', ' '), value: status }))
  ];

  const heading = HR_SECTION_LINKS.find((link) => link.to.endsWith(mode)) ?? HR_SECTION_LINKS[4];
  const showCreateForm = canManage && mode !== 'documents';

  function updateDraft<K extends keyof HrRecordDraft>(key: K, value: HrRecordDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function attachDraftFile(file: File) {
    try {
      const upload = await readOnboardingUpload(file);
      updateDraft('documentName', upload.name);
      updateDraft('documentUrl', upload.url);
      setMessage(null);
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not upload document.');
    }
  }

  async function createRecord() {
    if (!draft.staffProfileId) {
      setMessageTone('error');
      setMessage('Choose a staff member before filing this HR record.');
      return;
    }
    if (!draft.title.trim()) {
      setMessageTone('error');
      setMessage('Title is required.');
      return;
    }
    if (mode === 'pay-changes') {
      if (!draft.effectiveDate) {
        setMessageTone('error');
        setMessage('Set the effective date before filing this pay change.');
        return;
      }
      if (!draft.newRate) {
        setMessageTone('error');
        setMessage('Set the new rate before filing this pay change.');
        return;
      }
      // Letter attachment can be uploaded later, but is required before APPROVED.
      if ((draft.status === 'APPROVED' || draft.status === 'PENDING') && !draft.documentUrl) {
        setMessageTone('error');
        setMessage('Attach the approved pay-change letter before marking this pending or approved.');
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>('/api/staff/hr/records', {
        method: 'POST',
        body: JSON.stringify({
          staffProfileId: draft.staffProfileId,
          recordType: type ?? draft.recordType,
          title: draft.title.trim(),
          status: draft.status,
          issueDate: draft.issueDate,
          effectiveDate: draft.effectiveDate,
          expiryDate: draft.expiryDate,
          followUpDate: draft.followUpDate,
          reason: draft.reason.trim(),
          oldRateCents: centsFromCurrencyInput(draft.oldRate),
          newRateCents: centsFromCurrencyInput(draft.newRate),
          documentName: draft.documentName,
          documentUrl: draft.documentUrl,
          notes: draft.notes.trim()
        })
      });
      setDraft(emptyHrDraft(staff, type ?? 'GENERAL'));
      setMessageTone('success');
      setMessage('HR record filed.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not file HR record.');
    } finally {
      setSaving(false);
    }
  }

  async function removeDocument(record: StaffHrRecord) {
    if (!window.confirm(`Remove the document from "${record.title}"? The HR record will remain.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}`, { method: 'DELETE' });
      setMessageTone('success');
      setMessage('Document removed. HR record kept.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not remove HR document.');
    } finally {
      setSaving(false);
    }
  }

  async function requestDocument(record: StaffHrRecord) {
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/${record.staffProfileId}/hr/documents/${record.id}/request`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Replacement requested.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not request replacement.');
    } finally {
      setSaving(false);
    }
  }

  // Pay-change workflow actions. The API enforces real permissions and the
  // separation-of-duties rule, these helpers just submit cleanly and reload.
  async function submitForApproval(record: StaffHrRecord) {
    if (!record.effectiveDate || record.newRateCents === null) {
      setMessageTone('error');
      setMessage('Set the effective date and new rate before submitting for approval.');
      return;
    }
    if (!window.confirm(`Submit "${record.title}" for admin approval? You won't be able to edit it again until an admin returns it to draft.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/submit-for-approval`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Submitted. An Alma admin will be notified to approve.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not submit for approval.');
    } finally {
      setSaving(false);
    }
  }

  async function approvePayChange(record: StaffHrRecord) {
    const rateLine = record.newRateCents !== null
      ? `new rate ${formatCents(record.newRateCents)}`
      : 'new rate not recorded';
    const effective = record.effectiveDate ? new Date(record.effectiveDate).toLocaleDateString() : 'no effective date';
    if (!window.confirm(`Approve "${record.title}"?\n\n${rateLine}, effective ${effective}.\n\nAfter approval, remember to update Xero pay rates and Deputy if you use it. This is the auditable approval — keep the signed letter on file.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/approve`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Approved. Update Xero pay rates next.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not approve.');
    } finally {
      setSaving(false);
    }
  }

  async function returnToDraft(record: StaffHrRecord) {
    if (!window.confirm(`Return "${record.title}" to draft so it can be edited?`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await api<StaffHrRecord>(`/api/staff/hr/records/${record.id}/return-to-draft`, { method: 'POST' });
      setMessageTone('success');
      setMessage('Returned to draft.');
      await reload();
    } catch (err) {
      setMessageTone('error');
      setMessage(err instanceof Error ? err.message : 'Could not return to draft.');
    } finally {
      setSaving(false);
    }
  }

  // Per-mode privacy callout — every HR surface should explicitly say
  // who can see it, audited on view (#129 from the High School review).
  const privacyByMode: Record<typeof mode, { tag: string; line: string } | null> = {
    'contracts': {
      tag: 'Restricted',
      line: 'Visible to HR-authorised managers and admins. Final signed contracts only — drafts live in Alma Admin → HR templates.'
    },
    'warnings': {
      tag: 'Restricted',
      line: 'Visible to HR-authorised managers and admins. These are formal records, not casual notes.'
    },
    'pay-changes': {
      tag: 'Highly restricted',
      line: 'Visible only to users with the pay-changes permission. Every view and edit is audited.'
    },
    'right-to-work': {
      tag: 'Highly restricted',
      line: 'Visible only to users with the right-to-work permission. Never accessible on a shared device. Every view and edit is audited.'
    },
    'documents': {
      tag: 'Restricted',
      line: 'General HR documents are visible to HR-authorised managers and admins.'
    }
  };
  const privacy = privacyByMode[mode];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Restricted HR"
        title={heading.title}
        description={mode === 'right-to-work' ? 'Right-to-work records are highly sensitive and restricted to HR-authorised users.' : heading.description}
      />
      {privacy ? (
        <div className={`hr-privacy-callout ${mode === 'pay-changes' || mode === 'right-to-work' ? 'is-strict' : ''}`}>
          <span className="hr-privacy-callout-tag">{privacy.tag}</span>
          <span className="hr-privacy-callout-line">{privacy.line}</span>
        </div>
      ) : null}
      {mode === 'pay-changes' ? (
        <div className="pay-change-workflow">
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">1</span>
            <span><strong>Draft</strong><br />Manager fills the form, attaches the letter once signed.</span>
          </div>
          <span className="pay-change-workflow-arrow">→</span>
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">2</span>
            <span><strong>Submit for approval</strong><br />Sends to an admin. Another admin must review (not the drafter).</span>
          </div>
          <span className="pay-change-workflow-arrow">→</span>
          <div className="pay-change-workflow-step">
            <span className="pay-change-workflow-step-num">3</span>
            <span><strong>Approve</strong><br />Admin approves. Then update Xero pay rates and Deputy.</span>
          </div>
        </div>
      ) : null}
      {mode === 'contracts' && canManage ? (
        <Card title="Contract templates" subtitle="Admin owns editable HR templates and legal review warnings. Staff HR stores issued and signed final documents.">
          <div className="toolbar-right">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                window.location.href = SETTINGS_WEB_URL ? `${SETTINGS_WEB_URL.replace(/\/+$/, '')}/staff-hr-templates` : '/staff-hr-templates';
              }}
            >
              Open HR templates
            </Button>
          </div>
        </Card>
      ) : null}
      <div className="stats-grid">
        <StatCard label="Records" value={sectionRecords.length} hint={type ? hrTypeLabel(type) : 'All HR documents'} loading={loading} />
        {mode === 'pay-changes' ? (
          <>
            <StatCard label="Pending approval" value={sectionRecords.filter((record) => record.status === 'PENDING').length} hint="Awaiting admin sign-off" loading={loading} />
            <StatCard label="Drafts" value={sectionRecords.filter((record) => record.status === 'DRAFT').length} hint="Not yet submitted" loading={loading} />
          </>
        ) : (
          <>
            <StatCard label="Needs action" value={sectionRecords.filter((record) => record.status === 'RE_REQUESTED' || record.status === 'EXPIRED').length} hint="Replacement or expiry" loading={loading} />
            <StatCard label="With document" value={sectionRecords.filter((record) => record.documentUrl).length} hint="Viewable files" loading={loading} />
          </>
        )}
      </div>

      {showCreateForm ? (
        <Card title={`File ${heading.title.toLowerCase()}`} subtitle="Upload the signed contract, approved letter, or supporting HR document.">
          <form
            className="staff-profile-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createRecord();
            }}
          >
            <div className="form-grid three">
              <Select label="Staff member" value={draft.staffProfileId} onChange={(event) => updateDraft('staffProfileId', event.currentTarget.value)} options={staffOptions} />
              {!type ? (
                <Select label="Document type" value={draft.recordType} onChange={(event) => updateDraft('recordType', event.currentTarget.value as StaffHrRecordType)} options={HR_RECORD_TYPE_OPTIONS.map((item) => ({ label: hrTypeLabel(item), value: item }))} />
              ) : null}
              {mode === 'pay-changes' ? (
                <Input label="Status" value="Draft" readOnly />
              ) : (
                <Select label="Status" value={draft.status} onChange={(event) => updateDraft('status', event.currentTarget.value as StaffHrRecordStatus)} options={HR_RECORD_STATUS_OPTIONS.map((item) => ({ label: item.replaceAll('_', ' '), value: item }))} />
              )}
              <Input label="Title" value={draft.title} onChange={(event) => updateDraft('title', event.currentTarget.value)} />
              <Input label="Issue date" type="date" value={draft.issueDate} onChange={(event) => updateDraft('issueDate', event.currentTarget.value)} />
              <Input label="Effective date" type="date" value={draft.effectiveDate} onChange={(event) => updateDraft('effectiveDate', event.currentTarget.value)} />
              <Input label="Expiry date" type="date" value={draft.expiryDate} onChange={(event) => updateDraft('expiryDate', event.currentTarget.value)} />
              <Input label="Follow-up date" type="date" value={draft.followUpDate} onChange={(event) => updateDraft('followUpDate', event.currentTarget.value)} />
              {mode === 'pay-changes' ? (
                <>
                  <Input label="Old rate" value={draft.oldRate} onChange={(event) => updateDraft('oldRate', event.currentTarget.value)} />
                  <Input label="New rate" value={draft.newRate} onChange={(event) => updateDraft('newRate', event.currentTarget.value)} />
                </>
              ) : null}
            </div>
            <Textarea label={mode === 'warnings' ? 'Reason / category' : 'Reason'} rows={2} value={draft.reason} onChange={(event) => updateDraft('reason', event.currentTarget.value)} />
            <div className="invite-row">
              <span>
                <strong>Document upload</strong>
                <span className="subtle">PDF, PNG, JPEG, WebP or GIF under 4MB. Do not upload draft legal templates unless they have been approved.</span>
                {draft.documentName ? <span className="subtle">{draft.documentName}</span> : null}
              </span>
              <span className="invite-row-actions">
                <label className="btn btn-secondary btn-sm" style={{ cursor: saving ? 'not-allowed' : 'pointer' }}>
                  Upload file
                  <input
                    type="file"
                    accept={STAFF_DOCUMENT_ACCEPT}
                    disabled={saving}
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void attachDraftFile(file);
                    }}
                  />
                </label>
                {draft.documentUrl ? (
                  <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { updateDraft('documentName', ''); updateDraft('documentUrl', ''); }}>
                    Remove attachment
                  </Button>
                ) : null}
              </span>
            </div>
            <Textarea label="HR notes" rows={2} value={draft.notes} onChange={(event) => updateDraft('notes', event.currentTarget.value)} />
            <div className="toolbar-right">
              <Button type="submit" disabled={saving}>{saving ? 'Filing...' : 'File HR record'}</Button>
              <ActionFeedback message={message} tone={messageTone} />
            </div>
          </form>
        </Card>
      ) : null}

      <Card title={mode === 'documents' ? 'HR document register' : `${heading.title} register`} subtitle="Only authorised managers can view these documents.">
        <div className="form-grid three">
          <Select label="Staff" value={staffFilter} onChange={(event) => setStaffFilter(event.currentTarget.value)} options={filterStaffOptions} />
          <Select label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} options={statusOptions} />
        </div>
        <HrRecordList
          records={sectionRecords}
          emptyTitle="No HR records found"
          canManage={canManage}
          saving={saving}
          mode={mode}
          canApprove={canApprove}
          currentUserId={currentUserId}
          onRemoveDocument={removeDocument}
          onRequestDocument={requestDocument}
          onSubmitForApproval={mode === 'pay-changes' ? submitForApproval : undefined}
          onApprovePayChange={mode === 'pay-changes' ? approvePayChange : undefined}
          onReturnToDraft={mode === 'pay-changes' ? returnToDraft : undefined}
        />
        {!showCreateForm ? <ActionFeedback message={message} tone={messageTone} /> : null}
      </Card>
    </div>
  );
}
